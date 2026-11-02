//! The New York Stock Exchange's clock (the same table as convex/stonks/market.ts).
use chrono::{Datelike, TimeZone, Timelike, Weekday};
use chrono_tz::America::New_York;

const HOLIDAYS: &[&str] = &[
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
];
const EARLY: &[&str] = &["2026-11-27", "2026-12-24", "2027-11-26"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Session {
    Pre,
    Regular,
    Post,
    Closed,
}

impl Session {
    /// Anything trading at all: 4am to 8pm.
    pub fn trading(self) -> bool {
        self != Session::Closed
    }
}

/// New York's date for an instant, "2026-10-30".
pub fn ny_date(ms: i64) -> String {
    New_York.timestamp_millis_opt(ms).unwrap().format("%Y-%m-%d").to_string()
}

pub fn session(ms: i64) -> Session {
    let t = New_York.timestamp_millis_opt(ms).unwrap();
    let day = t.format("%Y-%m-%d").to_string();
    if matches!(t.weekday(), Weekday::Sat | Weekday::Sun) || HOLIDAYS.contains(&day.as_str()) {
        return Session::Closed;
    }
    let m = t.hour() * 60 + t.minute();
    let close = if EARLY.contains(&day.as_str()) { 13 * 60 } else { 16 * 60 };
    match m {
        m if m < 4 * 60 => Session::Closed,
        m if m < 9 * 60 + 30 => Session::Pre,
        m if m < close => Session::Regular,
        m if m < 20 * 60 => Session::Post,
        _ => Session::Closed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn et(s: &str) -> i64 {
        chrono::DateTime::parse_from_rfc3339(s).unwrap().timestamp_millis()
    }
    #[test]
    fn sessions() {
        assert_eq!(session(et("2026-10-30T10:00:00-04:00")), Session::Regular);
        assert_eq!(session(et("2026-10-30T05:00:00-04:00")), Session::Pre);
        assert_eq!(session(et("2026-10-30T17:00:00-04:00")), Session::Post);
        assert_eq!(session(et("2026-10-30T21:00:00-04:00")), Session::Closed);
        assert_eq!(session(et("2026-10-31T12:00:00-04:00")), Session::Closed); // Saturday
        assert_eq!(session(et("2026-11-02T09:30:00-05:00")), Session::Regular); // after the clocks change
        assert_eq!(session(et("2026-11-26T12:00:00-05:00")), Session::Closed); // Thanksgiving
        assert_eq!(session(et("2026-11-27T14:00:00-05:00")), Session::Post); // a 1pm close
        assert_eq!(ny_date(et("2026-10-30T23:30:00-04:00")), "2026-10-30");
    }
}
