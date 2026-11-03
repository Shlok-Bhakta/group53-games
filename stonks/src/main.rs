//! The stonks sidecar: live prices for Group 53's Stonks, from the market's streams into Convex.
//!
//! Anything on Yahoo Finance can be traded, so it streams only what someone's holding or looking at
//! (`stonks:watchlist`, followed live) over one WebSocket. Everything else from
//! Yahoo goes through one paced client (rest.rs) and is batched and remembered: batch quotes for whatever
//! isn't ticking (snapshot.rs), history and news only for what's open on a phone (history.rs, profile.rs),
//! searches answered once a week (lookups.rs). Nasdaq stands by for US stocks; SPY's file gives the index's
//! weights; Nasdaq's symbol files seed search. It all goes through convex/stonks.ts with the admin key.
//!
//!   CONVEX_URL       the backend (http://convex:3210 on kiwi)
//!   ADMIN_KEY_FILE   a file holding the admin key (or ADMIN_KEY itself)
mod history;
mod holdings;
mod lookups;
mod market;
mod nasdaq;
mod profile;
mod rest;
mod router;
mod sink;
mod snapshot;
mod types;
mod universe;
mod yahoo;

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{Context, Result};
use convex::{ConvexClient, ConvexClientBuilder, FunctionResult, Value};
use futures::StreamExt;
use tokio::sync::{mpsc, watch};

use types::{log, now_ms, Event};

/// A Convex query that returns a list of strings, followed live. The client re-delivers the same result
/// after every transition, so only real changes go on.
async fn follow(client: &mut ConvexClient, name: &'static str) -> Result<watch::Receiver<BTreeSet<String>>> {
    let (tx, rx) = watch::channel(BTreeSet::new());
    let mut sub = client.subscribe(name, BTreeMap::new()).await?;
    tokio::spawn(async move {
        while let Some(r) = sub.next().await {
            match r {
                FunctionResult::Value(Value::Array(xs)) => {
                    let set: BTreeSet<String> = xs.into_iter().filter_map(|v| if let Value::String(s) = v { Some(s) } else { None }).collect();
                    tx.send_if_modified(|cur| {
                        if *cur == set {
                            return false;
                        }
                        log(format!("{name}: {} now", set.len()));
                        *cur = set;
                        true
                    });
                }
                other => log(format!("{name}: {other:?}")),
            }
        }
        log(format!("{name}: subscription ended"));
    });
    Ok(rx)
}

/// When Convex last got each (symbol, kind), so a restart doesn't ask Yahoo for everything again.
async fn freshness(client: &mut ConvexClient) -> Vec<(String, String, i64)> {
    let Ok(FunctionResult::Value(Value::Array(rows))) = client.query("stonks:freshness", BTreeMap::new()).await else {
        log("freshness: unavailable, fetching everything");
        return vec![];
    };
    rows.into_iter()
        .filter_map(|r| {
            let Value::Object(o) = r else { return None };
            match (o.get("symbol")?, o.get("kind")?, o.get("at")?) {
                (Value::String(s), Value::String(k), Value::Float64(at)) => Some((s.clone(), k.clone(), *at as i64)),
                _ => None,
            }
        })
        .collect()
}

#[tokio::main]
async fn main() -> Result<()> {
    rustls::crypto::ring::default_provider().install_default().ok();
    let url = std::env::var("CONVEX_URL").context("set CONVEX_URL")?;
    let key = match std::env::var("ADMIN_KEY_FILE") {
        Ok(path) => std::fs::read_to_string(&path).with_context(|| format!("reading {path}"))?.trim().to_string(),
        Err(_) => std::env::var("ADMIN_KEY").context("set ADMIN_KEY_FILE or ADMIN_KEY")?,
    };
    let rest = Arc::new(rest::Rest::new()?);
    let nasdaq_http = reqwest::Client::builder().user_agent("Mozilla/5.0 (group53 stonks)").timeout(Duration::from_secs(20)).build()?;

    log(format!("stonks: starting, connecting to {url}"));
    let (state_tx, mut state_rx) = mpsc::channel(16);
    let mut client = ConvexClientBuilder::new(&url).with_on_state_change(state_tx).build().await?;
    client.set_admin_auth(key, None).await;
    tokio::spawn(async move {
        while let Some(s) = state_rx.recv().await {
            log(format!("convex: {s:?}"));
        }
    });
    log("stonks: connected");

    // What to stream, what to keep history for, and what phones are searching for, all live.
    let want_rx = follow(&mut client, "stonks:watchlist").await?;
    let deep_rx = follow(&mut client, "stonks:deepWatch").await?;
    let lookups_rx = follow(&mut client, "stonks:pendingLookups").await?;
    let hot_rx = follow(&mut client, "stonks:hot").await?;
    let fresh = freshness(&mut client).await;

    let (write_tx, write_rx) = mpsc::channel(4096);
    let (event_tx, mut event_rx) = mpsc::channel::<Event>(4096);
    let (standby_tx, standby_rx) = watch::channel(BTreeSet::<String>::new());
    // When each symbol last ticked: what's ticking needs no polling.
    let ticks: Arc<Mutex<HashMap<String, i64>>> = Arc::default();
    tokio::spawn(sink::run(client.clone(), write_rx, hot_rx));
    tokio::spawn(universe::run(rest.clone(), write_tx.clone()));
    tokio::spawn(holdings::run(rest.clone(), write_tx.clone()));
    tokio::spawn(lookups::run(rest.clone(), lookups_rx, write_tx.clone()));
    tokio::spawn(snapshot::run(rest.clone(), want_rx.clone(), write_tx.clone(), ticks.clone()));
    tokio::spawn(history::run(rest.clone(), deep_rx.clone(), write_tx.clone(), ticks.clone(), fresh.clone()));
    tokio::spawn(profile::run(rest.clone(), deep_rx, write_tx.clone(), ticks.clone(), fresh));
    tokio::spawn(yahoo::run(want_rx.clone(), event_tx.clone()));
    tokio::spawn(nasdaq::run(nasdaq_http, standby_rx, event_tx.clone()));

    let mut router = router::Router::default();
    let mut every = tokio::time::interval(Duration::from_secs(5));
    loop {
        tokio::select! {
            Some(ev) = event_rx.recv() => match ev {
                Event::Tick(t) => {
                    ticks.lock().unwrap().insert(t.symbol.clone(), t.recv);
                    if router.accept(&t) { write_tx.send(sink::Write::Tick(t)).await.ok(); }
                }
                Event::Status(s) => {
                    router.status(s.source, s.live);
                    write_tx.send(sink::Write::Status(s)).await.ok();
                }
            },
            _ = every.tick() => {
                // The standby covers what Yahoo isn't, only while the regular session's on (it's quiet otherwise).
                let now = now_ms();
                let need = if market::session(now) == market::Session::Regular {
                    router.uncovered(&want_rx.borrow().iter().filter(|s| router::us_ticker(s)).cloned().collect(), now)
                } else {
                    BTreeSet::new()
                };
                standby_tx.send_if_modified(|cur| {
                    if *cur == need { return false; }
                    if !need.is_empty() { log(format!("standby: nasdaq covering {}", need.iter().cloned().collect::<Vec<_>>().join(","))); }
                    *cur = need;
                    true
                });
            }
        }
    }
}
