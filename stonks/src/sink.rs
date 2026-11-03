//! Everything the sidecar writes to Convex, through the internal mutations in convex/stonks.ts (the
//! admin key lets it call them; phones can't). Prices go in at most once a second, at once if the
//! last write was longer ago, so a trade reaches phones in tens of milliseconds. That's while someone's
//! looking, or an order's waiting on it (`stonks:hot`). Convex keeps the old version of every write for
//! days, so everything else goes in once a minute: the last trade of each minute, which is all the
//! charts and net worth need. When someone arrives, what's held back goes in at once.
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::time::{Duration, Instant};

use convex::{ConvexClient, FunctionResult, Value};
use tokio::sync::{mpsc, watch};

use crate::types::{log, now_ms, Status, Tick};

const MINUTE_MS: i64 = 60_000;

/// `stonks:hot`: symbols written trade by trade, and "*" for all of them.
fn is_hot(hot: &BTreeSet<String>, symbol: &str) -> bool {
    hot.contains("*") || hot.contains(symbol)
}

/// The latest trade of each symbol nobody's looking at, waiting for its minute to end.
#[derive(Default)]
struct HeldBack(HashMap<String, Tick>);

impl HeldBack {
    fn hold(&mut self, t: Tick) {
        self.0.insert(t.symbol.clone(), t);
    }
    fn forget(&mut self, symbol: &str) {
        self.0.remove(symbol);
    }
    /// Whatever was received in a minute that's now over.
    fn due(&mut self, now: i64) -> Vec<Tick> {
        self.take(|t| t.recv / MINUTE_MS < now / MINUTE_MS)
    }
    /// Whatever someone's just started looking at.
    fn now_hot(&mut self, hot: &BTreeSet<String>) -> Vec<Tick> {
        self.take(|t| is_hot(hot, &t.symbol))
    }
    fn take(&mut self, want: impl Fn(&Tick) -> bool) -> Vec<Tick> {
        let symbols: Vec<String> = self.0.values().filter(|t| want(t)).map(|t| t.symbol.clone()).collect();
        symbols.iter().filter_map(|s| self.0.remove(s)).collect()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Holding {
    pub symbol: String,
    pub name: String,
    pub weight: f64,
    pub base: Option<f64>,
}

pub enum Write {
    Tick(Tick),
    Status(Status),
    Series { symbol: String, range: &'static str, series: crate::history::Series, one_day: bool },
    Holdings { as_of: String, holdings: Vec<Holding>, index_base: Option<f64> },
    Profile { symbol: String, stats: Option<BTreeMap<String, Value>>, news: Option<Vec<Value>> },
    Snapshot(Vec<Value>),
    Symbols(Vec<Symbol>),
    LookedUp { q: String, rows: Vec<Symbol> },
}

/// Something that can be traded, for search.
#[derive(Debug, Clone, PartialEq)]
pub struct Symbol {
    pub symbol: String,
    pub name: String,
    pub kind: Option<String>,
    pub exchange: Option<String>,
}

fn symbol_values(rows: Vec<Symbol>) -> Value {
    Value::Array(rows.iter().map(|s| obj(vec![("symbol", str(&s.symbol)), ("name", str(&s.name)), ("type", s.kind.as_deref().and_then(str)), ("exchange", s.exchange.as_deref().and_then(str))])).collect())
}

// Convex's optional fields take a missing key, not null, so None leaves the key out.
fn obj(fields: Vec<(&str, Option<Value>)>) -> Value {
    Value::Object(fields.into_iter().filter_map(|(k, v)| Some((k.to_string(), v?))).collect())
}
fn num(x: f64) -> Option<Value> {
    Some(Value::Float64(x))
}
fn str(s: &str) -> Option<Value> {
    Some(Value::String(s.to_string()))
}

pub fn tick_value(t: &Tick) -> Value {
    obj(vec![
        ("symbol", str(&t.symbol)),
        ("price", num(t.price)),
        ("time", num(t.time as f64)),
        ("recv", num(t.recv as f64)),
        ("source", str(t.source)),
        ("session", str(t.session)),
        ("dayHigh", t.day_high.and_then(num)),
        ("dayLow", t.day_low.and_then(num)),
        ("volume", t.volume.and_then(num)),
    ])
}

async fn call(client: &mut ConvexClient, name: &str, args: BTreeMap<String, Value>) -> bool {
    match client.mutation(name, args).await {
        Ok(FunctionResult::Value(_)) => true,
        Ok(FunctionResult::ErrorMessage(m)) => {
            log(format!("convex: {name} failed: {}", m.lines().next().unwrap_or("")));
            false
        }
        Ok(FunctionResult::ConvexError(e)) => {
            log(format!("convex: {name} failed: {e:?}"));
            false
        }
        Err(e) => {
            log(format!("convex: {name}: {e:#}"));
            false
        }
    }
}

pub async fn run(mut client: ConvexClient, mut rx: mpsc::Receiver<Write>, mut hot: watch::Receiver<BTreeSet<String>>) {
    let mut ticks: HashMap<String, Tick> = HashMap::new();
    let mut held = HeldBack::default();
    let mut feeds: HashMap<&'static str, Status> = HashMap::new();
    let mut flush = tokio::time::interval(Duration::from_secs(1));
    let mut last = Instant::now() - Duration::from_secs(10);
    let (mut wrote, mut count, mut report) = (0usize, 0usize, Instant::now());
    loop {
        tokio::select! {
            msg = rx.recv() => {
                let Some(msg) = msg else { return };
                match msg {
                    Write::Tick(t) => {
                        count += 1;
                        if is_hot(&hot.borrow(), &t.symbol) {
                            held.forget(&t.symbol);
                            ticks.insert(t.symbol.clone(), t);
                            if last.elapsed() >= Duration::from_secs(1) { flush.reset_immediately(); }
                        } else {
                            held.hold(t);
                        }
                    }
                    Write::Status(s) => {
                        feeds.insert(s.source, s);
                        flush.reset_immediately();
                    }
                    Write::Series { symbol, range, series: s, one_day } => {
                        let pts = s.points.iter().map(|(t, p)| Value::Array(vec![Value::Float64(*t as f64), Value::Float64(*p)])).collect();
                        let mut args = BTreeMap::from([("symbol".into(), Value::String(symbol)), ("range".into(), Value::String(range.into())), ("points".into(), Value::Array(pts))]);
                        // The day's own stats ride along with the 1D history only.
                        if one_day {
                            let stats = [("prevClose", s.prev_close), ("dayHigh", s.day_high), ("dayLow", s.day_low), ("volume", s.volume), ("yearHigh", s.year_high), ("yearLow", s.year_low), ("hint", s.hint), ("periodOpen", s.period_open), ("periodClose", s.period_close)];
                            for (k, v) in stats { if let Some(v) = v { args.insert(k.into(), Value::Float64(v)); } }
                            let texts = [("name", s.name), ("currency", s.currency), ("type", s.kind), ("exchange", s.exchange)];
                            for (k, v) in texts { if let Some(v) = v { args.insert(k.into(), Value::String(v)); } }
                        }
                        call(&mut client, "stonks:series", args).await;
                    }
                    Write::Snapshot(rows) => {
                        call(&mut client, "stonks:snapshot", BTreeMap::from([("rows".into(), Value::Array(rows))])).await;
                    }
                    Write::Symbols(rows) => {
                        call(&mut client, "stonks:addSymbols", BTreeMap::from([("rows".into(), symbol_values(rows))])).await;
                    }
                    Write::LookedUp { q, rows } => {
                        call(&mut client, "stonks:lookedUp", BTreeMap::from([("q".into(), Value::String(q)), ("rows".into(), symbol_values(rows))])).await;
                    }
                    Write::Profile { symbol, stats, news } => {
                        let mut args = BTreeMap::from([("symbol".into(), Value::String(symbol))]);
                        if let Some(s) = stats { args.insert("stats".into(), Value::Object(s)); }
                        if let Some(n) = news { args.insert("news".into(), Value::Array(n)); }
                        call(&mut client, "stonks:setProfile", args).await;
                    }
                    Write::Holdings { as_of, holdings, index_base } => {
                        let hs = holdings.iter().map(|h| obj(vec![("symbol", str(&h.symbol)), ("name", str(&h.name)), ("weight", num(h.weight)), ("base", h.base.and_then(num))])).collect();
                        let mut args = BTreeMap::from([("asOf".into(), Value::String(as_of)), ("holdings".into(), Value::Array(hs))]);
                        if let Some(b) = index_base { args.insert("indexBase".into(), Value::Float64(b)); }
                        call(&mut client, "stonks:holdings", args).await;
                    }
                }
            }
            Ok(()) = hot.changed() => {
                let released = held.now_hot(&hot.borrow_and_update());
                if !released.is_empty() {
                    for t in released { ticks.entry(t.symbol.clone()).or_insert(t); }
                    flush.reset_immediately();
                }
            }
            _ = flush.tick() => {
                for t in held.due(now_ms()) { ticks.entry(t.symbol.clone()).or_insert(t); }
                if ticks.is_empty() && feeds.is_empty() { continue; }
                last = Instant::now();
                let batch: Vec<Value> = ticks.drain().map(|(_, t)| tick_value(&t)).collect();
                let fs: Vec<Value> = feeds.drain().map(|(_, s)| obj(vec![("source", str(s.source)), ("state", str(if s.live { "live" } else { "down" })), ("detail", s.detail.as_deref().and_then(str))])).collect();
                let n = batch.len();
                if call(&mut client, "stonks:ingest", BTreeMap::from([("ticks".into(), Value::Array(batch)), ("feeds".into(), Value::Array(fs))])).await { wrote += n; }
                if report.elapsed() > Duration::from_secs(300) {
                    log(format!("sink: {count} ticks in, {wrote} written in the last 5 minutes"));
                    (count, wrote, report) = (0, 0, Instant::now());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tick(symbol: &str, price: f64, recv: i64) -> Tick {
        Tick { symbol: symbol.into(), price, time: recv, recv, source: "yahoo", day_high: None, day_low: None, volume: None, session: "regular" }
    }
    #[test]
    fn nobody_looking_means_the_last_trade_of_each_minute() {
        let mut held = HeldBack::default();
        let minute = 29_000_000 * MINUTE_MS;
        held.hold(tick("AAPL", 1.0, minute + 1_000));
        held.hold(tick("AAPL", 2.0, minute + 59_000));
        assert!(held.due(minute + 59_500).is_empty(), "its minute isn't over");
        let due = held.due(minute + MINUTE_MS);
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].price, 2.0);
        assert!(held.due(minute + 2 * MINUTE_MS).is_empty(), "written once");
    }
    #[test]
    fn someone_arriving_gets_what_was_held_back_at_once() {
        let mut held = HeldBack::default();
        let minute = 29_000_000 * MINUTE_MS;
        held.hold(tick("AAPL", 1.0, minute));
        held.hold(tick("MSFT", 2.0, minute));
        let order: BTreeSet<String> = ["MSFT".to_string()].into();
        assert!(!is_hot(&order, "AAPL"));
        assert!(is_hot(&order, "MSFT"));
        let released = held.now_hot(&order);
        assert_eq!(released.iter().map(|t| t.symbol.as_str()).collect::<Vec<_>>(), ["MSFT"]);
        let everyone: BTreeSet<String> = ["*".to_string()].into();
        assert_eq!(held.now_hot(&everyone).len(), 1);
    }
    #[test]
    fn leaves_missing_fields_out() {
        let t = Tick { symbol: "AAPL".into(), price: 1.5, time: 1793367000000, recv: 1793367000050, source: "yahoo", day_high: None, day_low: Some(1.0), volume: None, session: "regular" };
        let Value::Object(o) = tick_value(&t) else { panic!() };
        assert!(!o.contains_key("dayHigh"));
        assert_eq!(o["dayLow"], Value::Float64(1.0));
        assert_eq!(o["session"], Value::String("regular".into()));
    }
}
