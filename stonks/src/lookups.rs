//! Searches phones have asked about, answered from Yahoo's search one at a time (the rate limit lives
//! here, not on phones), and remembered by Convex for a week. Whatever Yahoo returns can be traded.
use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{mpsc, watch};

use crate::rest::Rest;
use crate::sink::{Symbol, Write};
use crate::types::{log, now_ms};

const TRADABLE: &[&str] = &["EQUITY", "ETF", "MUTUALFUND", "CRYPTOCURRENCY", "CURRENCY", "FUTURE", "INDEX"];

pub fn parse(v: &serde_json::Value) -> Vec<Symbol> {
    v["quotes"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|q| {
            let kind = q["quoteType"].as_str()?;
            if !TRADABLE.contains(&kind) {
                return None;
            }
            let symbol = q["symbol"].as_str()?;
            let name = q["longname"].as_str().or(q["shortname"].as_str()).unwrap_or(symbol);
            Some(Symbol { symbol: symbol.to_string(), name: name.trim().to_string(), kind: Some(kind.to_string()), exchange: q["exchDisp"].as_str().map(String::from) })
        })
        .collect()
}

pub async fn run(rest: Arc<Rest>, mut want: watch::Receiver<BTreeSet<String>>, out: mpsc::Sender<Write>) {
    let mut retry: HashMap<String, i64> = HashMap::new();
    loop {
        let pending = want.borrow_and_update().clone();
        let now = now_ms();
        let next = pending.iter().find(|q| retry.get(*q).is_none_or(|at| *at <= now)).cloned();
        let Some(q) = next else {
            tokio::select! {
                _ = want.changed() => {}
                _ = tokio::time::sleep(Duration::from_secs(5)) => {}
            }
            continue;
        };
        match rest.search(&q, 0, 12).await {
            Ok(v) => {
                // Asked and answered: it leaves the pending list once Convex has it.
                retry.insert(q.clone(), now + 30_000);
                out.send(Write::LookedUp { q, rows: parse(&v) }).await.ok();
            }
            Err(e) => {
                log(format!("lookup {q}: {e:#}"));
                retry.insert(q, now + 60_000);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn keeps_what_can_be_traded() {
        let v = serde_json::json!({"quotes": [
            {"symbol": "7203.T", "longname": "Toyota Motor Corporation", "quoteType": "EQUITY", "exchDisp": "Tokyo Stock Exchange"},
            {"symbol": "BTC-USD", "shortname": "Bitcoin USD", "quoteType": "CRYPTOCURRENCY", "exchDisp": "CCC"},
            {"symbol": "AAPL261120C00300000", "shortname": "AAPL Nov 2026 300 call", "quoteType": "OPTION"},
            {"index": "quotes", "name": "not a security"}
        ]});
        let r = super::parse(&v);
        assert_eq!(r.iter().map(|s| s.symbol.as_str()).collect::<Vec<_>>(), ["7203.T", "BTC-USD"]);
        assert_eq!(r[0].name, "Toyota Motor Corporation");
        assert_eq!(r[1].kind.as_deref(), Some("CRYPTOCURRENCY"));
    }
}
