//! Every request to Yahoo's REST endpoints goes through here, one at a time, so however much the sidecar
//! wants at once Yahoo sees a slow steady trickle. A 429 pauses all of it, longer each time, until one
//! gets through. (Prices themselves come over the stream, one connection; what's left is batched
//! and cached: see snapshot.rs, and the `freshness` a restart picks up from.)
use std::time::{Duration, Instant};

use anyhow::{bail, Result};
use tokio::sync::Mutex;

use crate::types::log;

const SPACING: Duration = Duration::from_millis(250);
const FIRST_PAUSE: Duration = Duration::from_secs(30);
const LONGEST_PAUSE: Duration = Duration::from_secs(600);

/// Hands out evenly spaced slots. Each caller reserves the next one and sleeps until it, so nobody
/// queues behind a backlog: the sidecar's loops each hold at most one slot at a time.
pub struct Pacer {
    state: Mutex<PaceState>,
    spacing: Duration,
}
struct PaceState {
    next: Instant,
    pause: Duration,
}

impl Pacer {
    pub fn new(spacing: Duration) -> Self {
        Self { state: Mutex::new(PaceState { next: Instant::now(), pause: FIRST_PAUSE }), spacing }
    }
    pub async fn slot(&self) {
        let at = {
            let mut s = self.state.lock().await;
            let at = s.next.max(Instant::now());
            s.next = at + self.spacing;
            at
        };
        tokio::time::sleep_until(at.into()).await;
    }
    /// Yahoo said slow down: everything waits, and longer if it says so again. Returns how long.
    pub async fn limited(&self) -> Duration {
        let mut s = self.state.lock().await;
        let pause = s.pause;
        s.next = s.next.max(Instant::now() + pause);
        s.pause = (pause * 2).min(LONGEST_PAUSE);
        pause
    }
    pub async fn ok(&self) {
        self.state.lock().await.pause = FIRST_PAUSE;
    }
}

const SUMMARY: &str = "price,summaryDetail,defaultKeyStatistics,financialData,calendarEvents,assetProfile";

pub struct Rest {
    pub http: reqwest::Client,
    pace: Pacer,
    crumb: Mutex<Option<String>>,
}

impl Rest {
    pub fn new() -> Result<Self> {
        let http = reqwest::Client::builder().cookie_store(true).user_agent("Mozilla/5.0 (group53 stonks)").timeout(Duration::from_secs(20)).build()?;
        Ok(Self { http, pace: Pacer::new(SPACING), crumb: Mutex::new(None) })
    }

    async fn send(&self, url: &str) -> Result<reqwest::Response> {
        self.pace.slot().await;
        let r = self.http.get(url).send().await?;
        if r.status() == 429 {
            let pause = self.pace.limited().await;
            log(format!("yahoo: rate limited, pausing requests for {pause:?}"));
            bail!("rate limited");
        }
        self.pace.ok().await;
        Ok(r)
    }

    async fn json(&self, url: &str) -> Result<serde_json::Value> {
        Ok(self.send(url).await?.error_for_status()?.json().await?)
    }

    /// The quote endpoints want a cookie from fc.yahoo.com and a crumb tied to it.
    async fn crumb(&self) -> Result<String> {
        let mut held = self.crumb.lock().await;
        if let Some(c) = held.as_ref() {
            return Ok(c.clone());
        }
        // fc.yahoo.com answers 404 but sets the cookie.
        let _ = self.send("https://fc.yahoo.com").await;
        let c = self.send("https://query1.finance.yahoo.com/v1/test/getcrumb").await?.error_for_status()?.text().await?;
        if c.is_empty() || c.len() > 64 || c.contains('<') || c.contains(' ') {
            bail!("no crumb ({c:.40})");
        }
        *held = Some(c.clone());
        Ok(c)
    }

    async fn with_crumb(&self, url: impl Fn(&str) -> String) -> Result<serde_json::Value> {
        for _ in 0..2 {
            let crumb = self.crumb().await?;
            let r = self.send(&url(&crumb)).await?;
            if r.status() == 401 || r.status() == 403 {
                *self.crumb.lock().await = None; // stale: shake hands again
                continue;
            }
            return Ok(r.error_for_status()?.json().await?);
        }
        bail!("Yahoo refused a fresh crumb")
    }

    pub async fn chart(&self, symbol: &str, range: &str, interval: &str, pre_post: bool) -> Result<serde_json::Value> {
        self.json(&format!("https://query1.finance.yahoo.com/v8/finance/chart/{}?range={range}&interval={interval}&includePrePost={pre_post}", encode(symbol))).await
    }

    pub async fn summary(&self, symbol: &str) -> Result<serde_json::Value> {
        let s = encode(symbol);
        self.with_crumb(|c| format!("https://query1.finance.yahoo.com/v10/finance/quoteSummary/{s}?modules={SUMMARY}&crumb={c}")).await
    }

    /// Hundreds of symbols in one request.
    pub async fn quotes(&self, symbols: &[String]) -> Result<serde_json::Value> {
        let list = symbols.iter().map(|s| encode(s)).collect::<Vec<_>>().join(",");
        self.with_crumb(|c| format!("https://query1.finance.yahoo.com/v7/finance/quote?symbols={list}&crumb={c}")).await
    }

    pub async fn search(&self, q: &str, news: u32, quotes: u32) -> Result<serde_json::Value> {
        self.json(&format!("https://query1.finance.yahoo.com/v1/finance/search?q={}&newsCount={news}&quotesCount={quotes}", encode(q))).await
    }

    pub async fn feed(&self, symbol: &str) -> Result<String> {
        Ok(self.send(&format!("https://feeds.finance.yahoo.com/rss/2.0/headline?s={}&region=US&lang=en-US", encode(symbol))).await?.error_for_status()?.text().await?)
    }
}

/// Tickers hold ^ and = (^GSPC, EURUSD=X), and searches hold anything.
pub fn encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encodes_what_tickers_hold() {
        assert_eq!(encode("^GSPC"), "%5EGSPC");
        assert_eq!(encode("EURUSD=X"), "EURUSD%3DX");
        assert_eq!(encode("BRK-B"), "BRK-B");
        assert_eq!(encode("7203.T"), "7203.T");
        assert_eq!(encode("s&p 500"), "s%26p%20500");
    }
    #[tokio::test(start_paused = true)]
    async fn spaces_requests_and_pauses_when_limited() {
        let p = Pacer::new(Duration::from_millis(250));
        let t0 = tokio::time::Instant::now();
        p.slot().await;
        p.slot().await;
        p.slot().await;
        assert!(t0.elapsed() >= Duration::from_millis(500), "{:?}", t0.elapsed());
        assert_eq!(p.limited().await, Duration::from_secs(30));
        assert_eq!(p.limited().await, Duration::from_secs(60));
        let t1 = tokio::time::Instant::now();
        p.slot().await;
        assert!(t1.elapsed() >= Duration::from_secs(29), "{:?}", t1.elapsed());
        p.ok().await;
        assert_eq!(p.limited().await, Duration::from_secs(30));
    }
}
