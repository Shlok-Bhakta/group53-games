//! Nasdaq.com's quote API, polled: the standby for US stocks in the regular session. No key.
//!
//! Nasdaq gives the last sale but not when it happened, and an order fills on the first trade stamped after the tap.
//! So a poll is only a trade when the day's volume went up since the poll before, and it's stamped with that earlier
//! poll's time, the earliest it can have happened. A stale last sale (the first poll at the open, a stock that hasn't
//! traded for minutes) never counts as a trade after anyone's tap.
use std::collections::{BTreeSet, HashMap};
use std::time::Duration;

use anyhow::{bail, Context, Result};
use tokio::sync::{mpsc, watch};

use crate::types::{log, now_ms, Event, Status, Tick};

pub const NAME: &str = "nasdaq";
const EVERY: Duration = Duration::from_secs(3);

pub async fn run(http: reqwest::Client, mut want: watch::Receiver<BTreeSet<String>>, out: mpsc::Sender<Event>) {
    let mut seen: HashMap<String, Poll> = HashMap::new();
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
                Ok((price, volume)) => {
                    let now = now_ms();
                    let poll = Poll { price, volume, at: now };
                    if let Some(time) = traded_since(seen.get(s), &poll) {
                        out.send(Event::Tick(Tick { symbol: s.clone(), price, time, recv: now, source: NAME, day_high: None, day_low: None, volume: None, session: "regular" })).await.ok();
                    }
                    seen.insert(s.clone(), poll);
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

/// One answer from Nasdaq: the last sale and the day's volume so far.
#[derive(Debug, Clone, PartialEq)]
pub struct Poll {
    pub price: f64,
    pub volume: Option<f64>,
    pub at: i64,
}

/// When a trade provably happened since the poll before: just after it, if the day's volume went up. None if nothing
/// shows a new trade (first poll, same volume, a new day's volume starting over, or no volume at all).
pub fn traded_since(before: Option<&Poll>, now: &Poll) -> Option<i64> {
    let before = before?;
    (now.volume? > before.volume?).then_some(before.at + 1)
}

async fn quote(http: &reqwest::Client, symbol: &str) -> Result<(f64, Option<f64>)> {
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

pub fn parse(v: &serde_json::Value) -> Result<(f64, Option<f64>)> {
    let data = &v["data"]["primaryData"];
    let s = data["lastSalePrice"].as_str().context("no lastSalePrice")?;
    let p: f64 = s.replace(['$', ','], "").trim().parse().context("bad price")?;
    if !(p.is_finite() && p > 0.0) {
        bail!("bad price {p}");
    }
    let volume = data["volume"].as_str().and_then(|s| s.replace(',', "").trim().parse::<f64>().ok()).filter(|v| v.is_finite());
    Ok((p, volume))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_last_sale_and_volume() {
        let v = serde_json::json!({"data": {"primaryData": {"lastSalePrice": "$1,344.63", "volume": "127,267"}}});
        assert_eq!(parse(&v).unwrap(), (1344.63, Some(127_267.0)));
        let no_volume = serde_json::json!({"data": {"primaryData": {"lastSalePrice": "$0.77", "volume": "N/A"}}});
        assert_eq!(parse(&no_volume).unwrap(), (0.77, None));
        assert!(parse(&serde_json::json!({"data": null})).is_err());
    }
    fn poll(price: f64, volume: f64, at: i64) -> Poll {
        Poll { price, volume: Some(volume), at }
    }
    #[test]
    fn a_stale_last_sale_is_never_a_trade() {
        // The first poll at the open sees yesterday's or the pre-market's last sale: no way to know when it happened.
        assert_eq!(traded_since(None, &poll(0.94, 1_000.0, 100)), None);
        // Same volume, same trade, however long it's been.
        assert_eq!(traded_since(Some(&poll(0.94, 1_000.0, 100)), &poll(0.94, 1_000.0, 60_100)), None);
        // A new day's volume starting over isn't a trade either, and nor is a quote without volume.
        assert_eq!(traded_since(Some(&poll(0.94, 9_000.0, 100)), &poll(0.95, 200.0, 3_100)), None);
        assert_eq!(traded_since(Some(&poll(0.94, 1_000.0, 100)), &Poll { price: 0.99, volume: None, at: 3_100 }), None);
    }
    #[test]
    fn a_trade_is_stamped_with_the_earliest_it_can_have_happened() {
        // Volume went up between the polls at 100 and 3,100: the trade was after 100, so it's stamped 101. An order
        // tapped at 2,000 doesn't fill on it (it may have happened before the tap); it fills on the next one.
        assert_eq!(traded_since(Some(&poll(0.94, 1_000.0, 100)), &poll(0.99, 1_200.0, 3_100)), Some(101));
        assert_eq!(traded_since(Some(&poll(0.99, 1_200.0, 3_100)), &poll(0.98, 1_300.0, 6_100)), Some(3_101));
    }
}
