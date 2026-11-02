//! Yahoo's batch quotes, for what the stream doesn't give: what each thing is (its name, currency, type,
//! exchange, whether its market's open) and a price for whatever isn't ticking, which covers futures,
//! some currencies, funds and thin stocks. One request carries everything due, so this costs a few a minute.
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{bail, Result};
use convex::Value;
use tokio::sync::{mpsc, watch};

use crate::rest::Rest;
use crate::sink::Write;
use crate::types::{log, now_ms};

const BATCH: usize = 150;
/// Not ticking, in a market that's open: this is its price feed, so often.
const SILENT_OPEN_MS: i64 = 20_000;
/// Ticking, or its market's shut: only the stats go stale, so rarely.
const QUIET_MS: i64 = 300_000;

fn num(v: &serde_json::Value) -> Option<Value> {
    v.as_f64().filter(|x| x.is_finite()).map(Value::Float64)
}
fn text(v: &serde_json::Value) -> Option<Value> {
    v.as_str().map(|s| Value::String(s.trim().to_string()))
}

/// One row for `stonks:snapshot`, and its market's state. Yahoo's last regular-session trade is what fills
/// orders, so a row without one is skipped.
pub fn parse(v: &serde_json::Value) -> Result<Vec<(String, String, Value)>> {
    let Some(rows) = v["quoteResponse"]["result"].as_array() else { bail!("no result: {}", v["quoteResponse"]["error"]) };
    Ok(rows
        .iter()
        .filter_map(|x| {
            let symbol = x["symbol"].as_str()?;
            let price = x["regularMarketPrice"].as_f64().filter(|p| p.is_finite() && *p > 0.0)?;
            let time = x["regularMarketTime"].as_i64()? * 1000;
            let state = x["marketState"].as_str().unwrap_or("").to_string();
            let name = if x["longName"].is_string() { &x["longName"] } else { &x["shortName"] };
            let fields = [
                ("name", text(name)),
                ("prevClose", num(&x["regularMarketPreviousClose"])),
                ("dayHigh", num(&x["regularMarketDayHigh"])),
                ("dayLow", num(&x["regularMarketDayLow"])),
                ("volume", num(&x["regularMarketVolume"]).filter(|v| *v != Value::Float64(0.0))),
                ("yearHigh", num(&x["fiftyTwoWeekHigh"])),
                ("yearLow", num(&x["fiftyTwoWeekLow"])),
                ("currency", text(&x["currency"])),
                ("type", text(&x["quoteType"])),
                ("exchange", text(&x["exchange"])),
                ("state", text(&x["marketState"])),
                ("hint", num(&x["priceHint"])),
            ];
            let mut o: BTreeMap<String, Value> = fields.into_iter().filter_map(|(k, v)| Some((k.to_string(), v?))).collect();
            o.insert("symbol".into(), Value::String(symbol.to_string()));
            o.insert("price".into(), Value::Float64(price));
            o.insert("time".into(), Value::Float64(time as f64));
            Some((symbol.to_string(), state, Value::Object(o)))
        })
        .collect())
}

/// What's due, given when each was last asked about, whether its market was open, and its last tick.
pub fn due(symbols: &BTreeSet<String>, asked: &HashMap<String, (i64, bool)>, ticks: &HashMap<String, i64>, now: i64) -> Vec<String> {
    symbols
        .iter()
        .filter(|s| match asked.get(*s) {
            None => true,
            Some((at, open)) => {
                let ticking = ticks.get(*s).is_some_and(|t| now - t < SILENT_OPEN_MS);
                now - at >= if *open && !ticking { SILENT_OPEN_MS } else { QUIET_MS }
            }
        })
        .cloned()
        .collect()
}

pub async fn run(rest: Arc<Rest>, mut want: watch::Receiver<BTreeSet<String>>, out: mpsc::Sender<Write>, ticks: Arc<Mutex<HashMap<String, i64>>>) {
    let mut asked: HashMap<String, (i64, bool)> = HashMap::new();
    loop {
        let symbols = want.borrow_and_update().clone();
        let now = now_ms();
        let list = due(&symbols, &asked, &ticks.lock().unwrap(), now);
        if list.is_empty() {
            tokio::select! {
                _ = want.changed() => {}
                _ = tokio::time::sleep(Duration::from_secs(2)) => {}
            }
            continue;
        }
        for chunk in list.chunks(BATCH) {
            match rest.quotes(chunk).await.and_then(|v| parse(&v)) {
                Ok(rows) => {
                    // Asked about and not in the answer: not a real symbol, or nothing's known. Leave it a while.
                    for s in chunk {
                        asked.insert(s.clone(), (now, false));
                    }
                    let mut values = vec![];
                    for (symbol, state, row) in rows {
                        // Anything but REGULAR is shut, as far as filling goes.
                        asked.insert(symbol, (now, state == "REGULAR"));
                        values.push(row);
                    }
                    if !values.is_empty() {
                        out.send(Write::Snapshot(values)).await.ok();
                    }
                }
                Err(e) => {
                    log(format!("snapshot: {e:#}"));
                    tokio::time::sleep(Duration::from_secs(15)).await;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_batch_quotes_for_anything() {
        let v: serde_json::Value = serde_json::from_str(include_str!("../tests/fixtures/quotes-mixed.json")).unwrap();
        let rows = parse(&v).unwrap();
        let find = |s: &str| rows.iter().find(|r| r.0 == s).unwrap();
        let (_, state, Value::Object(toyota)) = find("7203.T") else { panic!() };
        assert_eq!(toyota["currency"], Value::String("JPY".into()));
        assert_eq!(toyota["type"], Value::String("EQUITY".into()));
        assert!(!state.is_empty());
        let (_, _, Value::Object(vod)) = find("VOD.L") else { panic!() };
        assert_eq!(vod["currency"], Value::String("GBp".into()));
        let (_, _, Value::Object(btc)) = find("BTC-USD") else { panic!() };
        assert_eq!(btc["type"], Value::String("CRYPTOCURRENCY".into()));
        assert!(matches!(btc["time"], Value::Float64(t) if t > 1_790_000_000_000.0));
        assert!(find("EURUSD=X").1 != "");
    }
    #[test]
    fn what_comes_due_when() {
        let symbols: BTreeSet<String> = ["NEW", "TICKING", "SILENT", "SHUT"].map(String::from).into();
        let now = 1_000_000;
        let asked = HashMap::from([("TICKING".to_string(), (now - 60_000, true)), ("SILENT".to_string(), (now - 25_000, true)), ("SHUT".to_string(), (now - 60_000, false))]);
        let ticks = HashMap::from([("TICKING".to_string(), now - 2_000)]);
        assert_eq!(due(&symbols, &asked, &ticks, now), ["NEW", "SILENT"]);
        assert!(due(&symbols, &asked, &ticks, now + 300_000).contains(&"SHUT".to_string()));
    }
}
