//! What every price source hands the router: ticks and how it's doing.

/// A trade. Symbols are always ours, Yahoo's spelling ("AAPL", "BRK-B", "^GSPC"); each source maps its own.
#[derive(Debug, Clone, PartialEq)]
pub struct Tick {
    pub symbol: String,
    pub price: f64,
    /// When the source says it traded, and when we heard about it (ms since the epoch).
    pub time: i64,
    pub recv: i64,
    pub source: &'static str,
    pub day_high: Option<f64>,
    pub day_low: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Status {
    pub source: &'static str,
    pub live: bool,
    pub detail: Option<String>,
}

#[derive(Debug, Clone)]
pub enum Event {
    Tick(Tick),
    Status(Status),
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64
}

pub fn log(msg: impl AsRef<str>) {
    eprintln!("{} {}", chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ"), msg.as_ref());
}
