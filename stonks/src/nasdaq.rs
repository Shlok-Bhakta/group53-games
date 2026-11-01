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
    loop {
        let symbols = want.borrow_and_update().clone();
        if symbols.is_empty() {
            if want.changed().await.is_err() {
                return;
            }
            continue;
        }
        let mut ok = true;
        for s in symbols.iter().filter(|s| !s.starts_with('^')) {
            match quote(&http, s).await {
                Ok(price) => {
                    // A poll that returns the same trade again isn't a tick.
                    if seen.insert(s.clone(), price) != Some(price) {
                        let now = now_ms();
                        out.send(Event::Tick(Tick { symbol: s.clone(), price, time: now, recv: now, source: NAME, day_high: None, day_low: None })).await.ok();
                    }
                }
                Err(e) => {
                    ok = false;
                    log(format!("nasdaq: {s}: {e:#}"));
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
    let url = format!("https://api.nasdaq.com/api/quote/{}/info?assetclass=stocks", symbol.replace('-', "."));
    let v: serde_json::Value = http.get(url).header("Accept", "application/json").send().await?.error_for_status()?.json().await?;
    parse(&v)
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
