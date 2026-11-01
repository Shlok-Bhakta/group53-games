//! Price history from Yahoo's chart endpoint, kept fresh per symbol and range. The 1D range includes
//! pre-market and after hours (4am to 8pm) and brings the previous close and the company's name.
use std::collections::{BTreeSet, HashMap};
use std::time::Duration;

use anyhow::{bail, Context, Result};
use tokio::sync::{mpsc, watch};

use crate::market;
use crate::sink::Write;
use crate::types::{log, now_ms};

pub struct Range {
    pub key: &'static str,
    range: &'static str,
    interval: &'static str,
    pre_post: bool,
    /// How often to refresh while stocks trade, and otherwise (minutes).
    fresh: i64,
    quiet: i64,
}

pub const RANGES: [Range; 5] = [
    Range { key: "1D", range: "1d", interval: "1m", pre_post: true, fresh: 5, quiet: 60 },
    Range { key: "1W", range: "5d", interval: "5m", pre_post: false, fresh: 15, quiet: 360 },
    Range { key: "1M", range: "1mo", interval: "30m", pre_post: false, fresh: 30, quiet: 360 },
    Range { key: "1Y", range: "1y", interval: "1d", pre_post: false, fresh: 360, quiet: 360 },
    Range { key: "5Y", range: "5y", interval: "1wk", pre_post: false, fresh: 720, quiet: 720 },
];

#[derive(Debug, Clone, PartialEq)]
pub struct Series {
    pub points: Vec<(i64, f64)>,
    pub prev_close: Option<f64>,
    pub name: Option<String>,
}

pub async fn fetch(http: &reqwest::Client, symbol: &str, range: &str, interval: &str, pre_post: bool) -> Result<Series> {
    let url = format!(
        "https://query1.finance.yahoo.com/v8/finance/chart/{}?range={range}&interval={interval}&includePrePost={pre_post}",
        symbol.replace('^', "%5E")
    );
    let v: serde_json::Value = http.get(url).send().await?.error_for_status()?.json().await?;
    parse(&v)
}

pub fn parse(v: &serde_json::Value) -> Result<Series> {
    let r = &v["chart"]["result"][0];
    if r.is_null() {
        bail!("no result: {}", v["chart"]["error"]);
    }
    let ts = r["timestamp"].as_array().map(Vec::as_slice).unwrap_or_default();
    let closes = r["indicators"]["quote"][0]["close"].as_array().context("no closes")?;
    let points = ts
        .iter()
        .zip(closes)
        .filter_map(|(t, c)| Some((t.as_i64()? * 1000, c.as_f64().filter(|p| p.is_finite() && *p > 0.0)?)))
        .collect();
    let meta = &r["meta"];
    Ok(Series {
        points,
        prev_close: meta["chartPreviousClose"].as_f64().or(meta["previousClose"].as_f64()),
        name: meta["longName"].as_str().or(meta["shortName"].as_str()).map(String::from),
    })
}

/// The close on a New York date, from daily points.
pub fn close_on(points: &[(i64, f64)], date: &str) -> Option<f64> {
    points.iter().find(|(t, _)| market::ny_date(*t) == date).map(|p| p.1)
}

pub async fn run(http: reqwest::Client, mut want: watch::Receiver<BTreeSet<String>>, out: mpsc::Sender<Write>) {
    let mut due: HashMap<(String, &'static str), i64> = HashMap::new();
    loop {
        let symbols = want.borrow_and_update().clone();
        let now = now_ms();
        let trading = market::session(now).trading();
        // Every symbol's day first, so the board fills in fast after a restart, then the longer ranges.
        let next = RANGES.iter().flat_map(|r| symbols.iter().map(move |s| (s, r))).find(|(s, r)| due.get(&((*s).clone(), r.key)).is_none_or(|&at| at <= now));
        let Some((symbol, r)) = next else {
            tokio::select! {
                _ = want.changed() => {}
                _ = tokio::time::sleep(Duration::from_secs(5)) => {}
            }
            continue;
        };
        let wait = match fetch(&http, symbol, r.range, r.interval, r.pre_post).await {
            Ok(s) => {
                let one_day = r.key == "1D";
                out.send(Write::Series { symbol: symbol.clone(), range: r.key, points: s.points, prev_close: s.prev_close.filter(|_| one_day), name: s.name.filter(|_| one_day) }).await.ok();
                if trading { r.fresh } else { r.quiet }
            }
            Err(e) => {
                log(format!("history: {symbol} {}: {e:#}", r.key));
                5
            }
        };
        due.insert((symbol.clone(), r.key), now + wait * 60_000);
        tokio::time::sleep(Duration::from_millis(250)).await; // gentle on Yahoo
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_a_real_day_with_pre_and_post_market() {
        let v: serde_json::Value = serde_json::from_str(include_str!("../tests/fixtures/chart-aapl-1d.json")).unwrap();
        let s = parse(&v).unwrap();
        assert_eq!(s.prev_close, Some(348.91));
        assert_eq!(s.name.as_deref(), Some("Apple Inc."));
        assert!(s.points.len() > 800, "{}", s.points.len());
        let first = s.points[0].0;
        assert_eq!(market::session(first), market::Session::Pre);
        assert_eq!(market::session(s.points.last().unwrap().0), market::Session::Post);
        assert!(s.points.windows(2).all(|w| w[0].0 < w[1].0));
    }
    #[test]
    fn finds_a_days_close() {
        let pts = [(1793280600000, 1.0), (1793367000000, 2.0)]; // Oct 29 and Oct 30, 9:30am New York
        assert_eq!(close_on(&pts, "2026-10-30"), Some(2.0));
        assert_eq!(close_on(&pts, "2026-10-28"), None);
    }
}
