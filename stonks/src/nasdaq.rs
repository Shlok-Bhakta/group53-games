//! Nasdaq.com's quote API, polled: the standby for US stocks in the regular session. No key.
use std::collections::{BTreeSet, HashMap};
use std::time::Duration;

use anyhow::{bail, Context, Result};
use tokio::sync::{mpsc, watch};

use crate::types::{log, now_ms, Event, Status, Tick};

pub const NAME: &str = "nasdaq";
const EVERY: Duration = Duration::from_secs(3);

pub async fn run(http: reqwest::Client, mut want: watch::Receiver<BTreeSet<String>>, out: mpsc::Sender<Event>) {
    let mut seen: HashMap<String, f64> = HashMap::new();
    let mut live: Option<bool> = None;
    // Funds and anything else Nasdaq doesn't quote: don't keep asking.
    let mut unknown: HashMap<String, i64> = HashMap::new();
    loop {
        let symbols = want.borrow_and_update().clone();
        if symbols.is_empty() {
            if want.changed().await.is_err() {
                return;
            }
            continue;
        }
        let mut ok = true;
        let now = now_ms();
        let asking: Vec<String> = symbols.iter().filter(|s| unknown.get(*s).is_none_or(|at| *at <= now)).cloned().collect();
        for s in &asking {
            match quote(&http, s).await {
                Ok(price) => {
                    // A poll that returns the same trade again isn't a tick.
                    if seen.insert(s.clone(), price) != Some(price) {
                        let now = now_ms();
                        out.send(Event::Tick(Tick { symbol: s.clone(), price, time: now, recv: now, source: NAME, day_high: None, day_low: None, volume: None, session: "regular" })).await.ok();
                    }
                }
                Err(e) if e.is::<reqwest::Error>() => {
                    ok = false;
                    log(format!("nasdaq: {s}: {e:#}"));
                }
                Err(_) => {
                    unknown.insert(s.clone(), now + 600_000);
                }
            }
        }
        if live != Some(ok) {
            live = Some(ok);
            out.send(Event::Status(Status { source: NAME, live: ok, detail: (!ok).then(|| "requests failing".into()) })).await.ok();
        }
        tokio::time::sleep(EVERY).await;
    }
}

async fn quote(http: &reqwest::Client, symbol: &str) -> Result<f64> {
    let mut last = None;
    for class in ["stocks", "etf"] {
        let url = format!("https://api.nasdaq.com/api/quote/{}/info?assetclass={class}", symbol.replace('-', "."));
        let v: serde_json::Value = http.get(url).header("Accept", "application/json").send().await?.error_for_status()?.json().await?;
        match parse(&v) {
            Ok(p) => return Ok(p),
            Err(e) => last = Some(e),
        }
    }
    Err(last.unwrap())
}

pub fn parse(v: &serde_json::Value) -> Result<f64> {
    let s = v["data"]["primaryData"]["lastSalePrice"].as_str().context("no lastSalePrice")?;
    let p: f64 = s.replace(['$', ','], "").trim().parse().context("bad price")?;
    if !(p.is_finite() && p > 0.0) {
        bail!("bad price {p}");
    }
    Ok(p)
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses_last_sale() {
        let v = serde_json::json!({"data": {"primaryData": {"lastSalePrice": "$1,344.63"}}});
        assert_eq!(super::parse(&v).unwrap(), 1344.63);
        assert!(super::parse(&serde_json::json!({"data": null})).is_err());
    }
}
