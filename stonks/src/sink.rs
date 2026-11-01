//! Everything the sidecar writes to Convex, through the internal mutations in convex/stonks.ts (the
//! admin key lets it call them; phones can't). Prices go in at most once a second, at once if the
//! last write was longer ago, so a trade reaches phones in tens of milliseconds.
use std::collections::{BTreeMap, HashMap};
use std::time::{Duration, Instant};

use convex::{ConvexClient, FunctionResult, Value};
use tokio::sync::mpsc;

use crate::market;
use crate::types::{log, Status, Tick};

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
        ("session", str(market::session(t.time).name())),
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

pub async fn run(mut client: ConvexClient, mut rx: mpsc::Receiver<Write>) {
    let mut ticks: HashMap<String, Tick> = HashMap::new();
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
                        ticks.insert(t.symbol.clone(), t);
                        count += 1;
                        if last.elapsed() >= Duration::from_secs(1) { flush.reset_immediately(); }
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
                            let stats = [("prevClose", s.prev_close), ("dayHigh", s.day_high), ("dayLow", s.day_low), ("volume", s.volume), ("yearHigh", s.year_high), ("yearLow", s.year_low)];
                            for (k, v) in stats { if let Some(v) = v { args.insert(k.into(), Value::Float64(v)); } }
                            if let Some(n) = s.name { args.insert("name".into(), Value::String(n)); }
                        }
                        call(&mut client, "stonks:series", args).await;
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
            _ = flush.tick() => {
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
    #[test]
    fn leaves_missing_fields_out() {
        let t = Tick { symbol: "AAPL".into(), price: 1.5, time: 1793367000000, recv: 1793367000050, source: "yahoo", day_high: None, day_low: Some(1.0), volume: None };
        let Value::Object(o) = tick_value(&t) else { panic!() };
        assert!(!o.contains_key("dayHigh"));
        assert_eq!(o["dayLow"], Value::Float64(1.0));
        assert_eq!(o["session"], Value::String("regular".into()));
    }
}
