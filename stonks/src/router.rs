//! Which source to believe, per symbol. Sources are ranked (Yahoo, then Nasdaq). A tick goes through
//! unless a better-ranked source has priced that symbol recently and is up. The standby only polls what
//! the primary isn't covering (`uncovered`), during the regular session, when a quiet primary means
//! something's wrong rather than that nothing's trading.
use std::collections::{BTreeSet, HashMap, HashSet};

use crate::types::Tick;

pub const RANK: [&str; 2] = [crate::yahoo::NAME, crate::nasdaq::NAME];
pub const STALE_MS: i64 = 30_000;

#[derive(Default)]
pub struct Router {
    last: HashMap<String, HashMap<&'static str, i64>>,
    down: HashSet<&'static str>,
}

impl Router {
    pub fn status(&mut self, source: &'static str, live: bool) {
        if live {
            self.down.remove(source);
        } else {
            self.down.insert(source);
        }
    }

    fn fresh(&self, symbol: &str, source: &str, now: i64) -> bool {
        !self.down.contains(source) && self.last.get(symbol).and_then(|m| m.get(source)).is_some_and(|&at| now - at < STALE_MS)
    }

    /// Records the tick and says whether to pass it on.
    pub fn accept(&mut self, t: &Tick) -> bool {
        self.last.entry(t.symbol.clone()).or_default().insert(t.source, t.recv);
        let rank = RANK.iter().position(|s| *s == t.source).unwrap_or(RANK.len());
        !RANK[..rank].iter().any(|better| self.fresh(&t.symbol, better, t.recv))
    }

    /// Symbols the primary hasn't priced for a while (all of them if it's down).
    pub fn uncovered(&self, watch: &BTreeSet<String>, now: i64) -> BTreeSet<String> {
        watch.iter().filter(|s| !self.fresh(s, RANK[0], now)).cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tick(symbol: &str, source: &'static str, recv: i64) -> Tick {
        Tick { symbol: symbol.into(), price: 1.0, time: recv, recv, source, day_high: None, day_low: None, volume: None }
    }
    #[test]
    fn primary_wins_while_fresh_and_standby_takes_over_when_it_goes_quiet() {
        let mut r = Router::default();
        assert!(r.accept(&tick("AAPL", "yahoo", 1_000)));
        assert!(!r.accept(&tick("AAPL", "nasdaq", 2_000)));
        assert!(r.accept(&tick("MSFT", "nasdaq", 2_000))); // Yahoo has nothing for MSFT
        assert!(r.accept(&tick("AAPL", "nasdaq", 1_000 + STALE_MS)));
        let watch: BTreeSet<String> = ["AAPL", "MSFT"].map(String::from).into();
        assert_eq!(r.uncovered(&watch, 1_000 + STALE_MS), watch);
        assert!(r.accept(&tick("AAPL", "yahoo", 40_000)));
        assert_eq!(r.uncovered(&watch, 41_000), ["MSFT".to_string()].into());
    }
    #[test]
    fn a_down_source_is_skipped_at_once() {
        let mut r = Router::default();
        r.accept(&tick("AAPL", "yahoo", 1_000));
        r.status("yahoo", false);
        assert!(r.accept(&tick("AAPL", "nasdaq", 1_500)));
        r.status("yahoo", true);
        assert!(!r.accept(&tick("AAPL", "nasdaq", 1_600)));
    }
}
