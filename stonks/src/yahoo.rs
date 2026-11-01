//! Yahoo Finance's streamer: wss://streamer.finance.yahoo.com/?version=2. No key. Each message is
//! {"type":"pricing","message": base64 of a PricingData protobuf}. Unofficial, so everything it sends
//! is checked, and the router falls back to Nasdaq if it goes quiet.
use std::collections::BTreeSet;
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use base64::Engine;
use futures::{SinkExt, StreamExt};
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::tungstenite::Message;

use crate::market;
use crate::types::{log, now_ms, Event, Status, Tick};

pub const NAME: &str = "yahoo";
const URL: &str = "wss://streamer.finance.yahoo.com/?version=2";

/// The fields we use from PricingData: id 1, price 2 (float), time 3 (zigzag ms), dayHigh 10, dayLow 11.
pub fn decode(b64: &str, recv: i64) -> Result<Tick> {
    let buf = base64::engine::general_purpose::STANDARD.decode(b64)?;
    let mut i = 0usize;
    let varint = |i: &mut usize| -> Result<u64> {
        let (mut r, mut s) = (0u64, 0u32);
        loop {
            let b = *buf.get(*i).context("truncated varint")?;
            *i += 1;
            if s > 63 {
                bail!("varint too long");
            }
            r |= ((b & 0x7f) as u64) << s;
            s += 7;
            if b & 0x80 == 0 {
                return Ok(r);
            }
        }
    };
    let mut t = Tick { symbol: String::new(), price: 0.0, time: 0, recv, source: NAME, day_high: None, day_low: None };
    while i < buf.len() {
        let key = varint(&mut i)?;
        let (field, wire) = (key >> 3, key & 7);
        match wire {
            0 => {
                let v = varint(&mut i)?;
                if field == 3 {
                    t.time = ((v >> 1) as i64) ^ -((v & 1) as i64);
                }
            }
            1 => i += 8,
            5 => {
                let b: [u8; 4] = buf.get(i..i + 4).context("truncated float")?.try_into()?;
                i += 4;
                let f = tidy(f32::from_le_bytes(b));
                match field {
                    2 => t.price = f,
                    10 if f > 0.0 => t.day_high = Some(f),
                    11 if f > 0.0 => t.day_low = Some(f),
                    _ => {}
                }
            }
            2 => {
                let n = varint(&mut i)? as usize;
                let bytes = buf.get(i..i + n).context("truncated string")?;
                if field == 1 {
                    t.symbol = String::from_utf8(bytes.to_vec())?;
                }
                i += n;
            }
            w => bail!("unknown wire type {w}"),
        }
    }
    if t.symbol.is_empty() || !(t.price.is_finite() && t.price > 0.0) || t.time <= 0 {
        bail!("incomplete tick {t:?}");
    }
    Ok(t)
}

/// Prices come as float32 (344.63 arrives as 344.6300048828125): back to 7 significant digits.
fn tidy(x: f32) -> f64 {
    let d = x as f64;
    if d == 0.0 || !d.is_finite() {
        return d;
    }
    let p = 10f64.powi(6 - d.abs().log10().floor() as i32);
    (d * p).round() / p
}

pub async fn run(mut want: watch::Receiver<BTreeSet<String>>, out: mpsc::Sender<Event>) {
    let mut backoff = Duration::from_secs(1);
    loop {
        let started = Instant::now();
        let why = match once(&mut want, &out).await {
            Ok(()) => return,
            Err(e) => format!("{e:#}"),
        };
        log(format!("yahoo: down ({why}), retrying in {backoff:?}"));
        out.send(Event::Status(Status { source: NAME, live: false, detail: Some(why) })).await.ok();
        if started.elapsed() > Duration::from_secs(120) {
            backoff = Duration::from_secs(1);
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_secs(60));
    }
}

async fn once(want: &mut watch::Receiver<BTreeSet<String>>, out: &mpsc::Sender<Event>) -> Result<()> {
    let (mut ws, _) = tokio::time::timeout(Duration::from_secs(15), tokio_tungstenite::connect_async(URL)).await.context("connect timed out")??;
    log("yahoo: connected");
    out.send(Event::Status(Status { source: NAME, live: true, detail: None })).await.ok();
    let mut have = BTreeSet::new();
    let first = want.borrow_and_update().clone();
    for m in diff(&mut have, &first) {
        ws.send(m).await?;
    }
    let mut check = tokio::time::interval(Duration::from_secs(30));
    let mut heard = Instant::now();
    loop {
        tokio::select! {
            changed = want.changed() => {
                if changed.is_err() { return Ok(()); }
                let next = want.borrow_and_update().clone();
                for m in diff(&mut have, &next) { ws.send(m).await?; }
            }
            msg = ws.next() => {
                let msg = msg.context("closed by Yahoo")??;
                heard = Instant::now();
                match msg {
                    Message::Text(txt) => {
                        let v: serde_json::Value = match serde_json::from_str(&txt) { Ok(v) => v, Err(_) => continue };
                        if v["type"] != "pricing" { continue; }
                        match decode(v["message"].as_str().unwrap_or_default(), now_ms()) {
                            Ok(t) if have.contains(&t.symbol) => { out.send(Event::Tick(t)).await.ok(); }
                            Ok(_) => {}
                            Err(e) => log(format!("yahoo: skipped a message: {e:#}")),
                        }
                    }
                    Message::Ping(p) => ws.send(Message::Pong(p)).await?,
                    Message::Close(c) => bail!("closed by Yahoo: {c:?}"),
                    _ => {}
                }
            }
            _ = check.tick() => {
                // Open but silent for three minutes while stocks are trading: treat it as dead. The big
                // names trade every second from 4am to 8pm.
                if !have.is_empty() && market::session(now_ms()).trading() && heard.elapsed() > Duration::from_secs(180) {
                    bail!("silent for three minutes");
                }
            }
        }
    }
}

fn diff(have: &mut BTreeSet<String>, next: &BTreeSet<String>) -> Vec<Message> {
    let add: Vec<_> = next.difference(have).cloned().collect();
    let del: Vec<_> = have.difference(next).cloned().collect();
    *have = next.clone();
    let mut m = vec![];
    if !add.is_empty() {
        log(format!("yahoo: subscribe {}", add.join(",")));
        m.push(Message::text(serde_json::json!({ "subscribe": add }).to_string()));
    }
    if !del.is_empty() {
        log(format!("yahoo: unsubscribe {}", del.join(",")));
        m.push(Message::text(serde_json::json!({ "unsubscribe": del }).to_string()));
    }
    m
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decodes_a_real_message() {
        // BTC-USD from the streamer on 2026-10-31.
        let t = decode("CgdCVEMtVVNEFRoxl0cYsJiHvLJoIgNVU0QqA0NDQzApOAFFbHRXP0iA8KDcY1UMlpdHXXZklkdlAIQhRH0zyZZHsAGA8KDcY9gBBOABgPCg3GPoAYDwoNxj8gEDQlRDgQIAAABAiSxzQYkCAACiIN+mdkL1AgCEIUT9Amx0Vz8=", 1).unwrap();
        assert_eq!(t.symbol, "BTC-USD");
        assert!(t.price > 10_000.0 && t.price < 200_000.0, "{}", t.price);
        assert!(t.time > 1_790_000_000_000, "{}", t.time);
        assert!(t.day_high.unwrap() >= t.day_low.unwrap());
    }
    #[test]
    fn refuses_junk() {
        assert!(decode("AAAA", 1).is_err());
        assert!(decode("!!!", 1).is_err());
        assert!(decode("CgdCVEMtVVNE", 1).is_err()); // a symbol and nothing else
    }
    #[test]
    fn tidies_float32() {
        assert_eq!(tidy(344.63_f32), 344.63);
        assert_eq!(tidy(6812.34_f32), 6812.34);
    }
}
