//! The stonks sidecar: live prices for Group 53's Stonks, from the market's streams into Convex.
//!
//! It follows `stonks:watchlist` live (the index and its top holdings), streams those symbols from
//! Yahoo, polls Nasdaq for anything Yahoo stops covering during the regular session, keeps their
//! history fresh from Yahoo's charts, keeps each company's key stats and news, reads the index's weights from SPY's holdings file, and writes it
//! all through convex/stonks.ts's internal mutations with the deployment's admin key.
//!
//!   CONVEX_URL       the backend (http://convex:3210 on kiwi)
//!   ADMIN_KEY_FILE   a file holding the admin key (or ADMIN_KEY itself)
mod history;
mod holdings;
mod market;
mod nasdaq;
mod profile;
mod router;
mod sink;
mod types;
mod yahoo;

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use anyhow::{Context, Result};
use convex::{ConvexClientBuilder, FunctionResult, Value};
use futures::StreamExt;
use tokio::sync::{mpsc, watch};

use types::{log, now_ms, Event};

#[tokio::main]
async fn main() -> Result<()> {
    rustls::crypto::ring::default_provider().install_default().ok();
    let url = std::env::var("CONVEX_URL").context("set CONVEX_URL")?;
    let key = match std::env::var("ADMIN_KEY_FILE") {
        Ok(path) => std::fs::read_to_string(&path).with_context(|| format!("reading {path}"))?.trim().to_string(),
        Err(_) => std::env::var("ADMIN_KEY").context("set ADMIN_KEY_FILE or ADMIN_KEY")?,
    };
    let http = reqwest::Client::builder().user_agent("Mozilla/5.0 (group53 stonks)").timeout(Duration::from_secs(20)).build()?;

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

    // The watch list, live. The client re-delivers the same result after every transition, so only
    // real changes go on.
    let (want_tx, want_rx) = watch::channel(BTreeSet::<String>::new());
    let mut sub = client.subscribe("stonks:watchlist", BTreeMap::new()).await?;
    tokio::spawn(async move {
        while let Some(r) = sub.next().await {
            match r {
                FunctionResult::Value(Value::Array(xs)) => {
                    let set: BTreeSet<String> = xs.into_iter().filter_map(|v| if let Value::String(s) = v { Some(s) } else { None }).collect();
                    want_tx.send_if_modified(|cur| {
                        if *cur == set {
                            return false;
                        }
                        log(format!("watchlist: {}", set.iter().cloned().collect::<Vec<_>>().join(",")));
                        *cur = set;
                        true
                    });
                }
                other => log(format!("watchlist: {other:?}")),
            }
        }
        log("watchlist: subscription ended");
    });

    let (write_tx, write_rx) = mpsc::channel(4096);
    let (event_tx, mut event_rx) = mpsc::channel::<Event>(4096);
    let (standby_tx, standby_rx) = watch::channel(BTreeSet::<String>::new());
    tokio::spawn(sink::run(client.clone(), write_rx));
    tokio::spawn(holdings::run(http.clone(), write_tx.clone()));
    tokio::spawn(history::run(http.clone(), want_rx.clone(), write_tx.clone()));
    tokio::spawn(profile::run(want_rx.clone(), write_tx.clone()));
    tokio::spawn(yahoo::run(want_rx.clone(), event_tx.clone()));
    tokio::spawn(nasdaq::run(http.clone(), standby_rx, event_tx.clone()));

    let mut router = router::Router::default();
    let mut every = tokio::time::interval(Duration::from_secs(5));
    loop {
        tokio::select! {
            Some(ev) = event_rx.recv() => match ev {
                Event::Tick(t) => if router.accept(&t) { write_tx.send(sink::Write::Tick(t)).await.ok(); },
                Event::Status(s) => {
                    router.status(s.source, s.live);
                    write_tx.send(sink::Write::Status(s)).await.ok();
                }
            },
            _ = every.tick() => {
                // The standby covers what Yahoo isn't, only while the regular session's on (it's quiet otherwise).
                let now = now_ms();
                let need = if market::session(now) == market::Session::Regular {
                    router.uncovered(&want_rx.borrow().iter().filter(|s| !s.starts_with('^')).cloned().collect(), now)
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
