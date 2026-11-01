//! The S&P 500's biggest companies and their weights, from State Street's daily SPY holdings file
//! (SPY holds the index, so its weights are the index's). Refreshed every six hours; the file changes
//! once a day, after the close. Each holding also gets its price on the file's day, so live weights can
//! follow prices (convex/stonks/board.ts).
use std::io::Cursor;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use calamine::{open_workbook_from_rs, Data, Reader, Xlsx};
use tokio::sync::mpsc;

use crate::history;
use crate::sink::{Holding, Write};
use crate::types::log;

const URL: &str = "https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx";
/// The board shows 20; a few more stream so the ranking can change hands during the day.
pub const KEEP: usize = 25;
pub const INDEX: &str = "^GSPC";

pub fn parse(bytes: &[u8]) -> Result<(String, Vec<Holding>)> {
    let mut book: Xlsx<_> = open_workbook_from_rs(Cursor::new(bytes))?;
    let sheet = book.worksheet_range_at(0).context("no sheet")??;
    let text = |c: &Data| match c {
        Data::String(s) => s.trim().to_string(),
        Data::Float(f) => f.to_string(),
        Data::Int(i) => i.to_string(),
        _ => String::new(),
    };
    let num = |c: &Data| match c {
        Data::Float(f) => Some(*f),
        Data::Int(i) => Some(*i as f64),
        Data::String(s) => s.trim().parse().ok(),
        _ => None,
    };
    let mut as_of = None;
    let mut cols: Option<(usize, usize, usize)> = None;
    let mut out = vec![];
    for row in sheet.rows() {
        let cells: Vec<String> = row.iter().map(text).collect();
        if let Some(s) = cells.iter().find_map(|c| c.strip_prefix("As of ")) {
            as_of = Some(chrono::NaiveDate::parse_from_str(s.trim(), "%d-%b-%Y").context("bad date")?.format("%Y-%m-%d").to_string());
        }
        match cols {
            None => {
                let at = |name: &str| cells.iter().position(|c| c == name);
                if let (Some(n), Some(t), Some(w)) = (at("Name"), at("Ticker"), at("Weight")) {
                    cols = Some((n, t, w));
                }
            }
            Some((n, t, w)) => {
                let ticker = cells.get(t).cloned().unwrap_or_default();
                let Some(weight) = row.get(w).and_then(num) else { continue };
                // Cash and futures rows have no real ticker.
                if ticker.is_empty() || ticker == "-" || !ticker.chars().all(|c| c.is_ascii_uppercase() || c == '.') {
                    continue;
                }
                out.push(Holding { symbol: ticker.replace('.', "-"), name: cells.get(n).cloned().unwrap_or_default(), weight, base: None });
            }
        }
    }
    let as_of = as_of.context("no as-of date")?;
    if out.len() < 100 {
        bail!("only {} holdings", out.len());
    }
    out.sort_by(|a, b| b.weight.total_cmp(&a.weight));
    out.truncate(KEEP);
    Ok((as_of, out))
}

pub async fn run(http: reqwest::Client, out: mpsc::Sender<Write>) {
    loop {
        let wait = match once(&http, &out).await {
            Ok(()) => Duration::from_secs(6 * 3600),
            Err(e) => {
                log(format!("holdings: {e:#}"));
                Duration::from_secs(600)
            }
        };
        tokio::time::sleep(wait).await;
    }
}

async fn once(http: &reqwest::Client, out: &mpsc::Sender<Write>) -> Result<()> {
    let bytes = http.get(URL).send().await?.error_for_status()?.bytes().await?;
    let (as_of, mut holdings) = parse(&bytes)?;
    // Each one's close on the file's day, from a month of daily prices.
    let base = |sym: String| {
        let http = http.clone();
        let as_of = as_of.clone();
        async move { history::fetch(&http, &sym, "1mo", "1d", false).await.ok().and_then(|s| history::close_on(&s.points, &as_of)) }
    };
    for h in holdings.iter_mut() {
        h.base = base(h.symbol.clone()).await;
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    let index_base = base(INDEX.to_string()).await;
    log(format!("holdings: {} as of {as_of}, top {} ({})", holdings.len(), holdings[0].symbol, holdings.iter().filter(|h| h.base.is_some()).count()));
    out.send(Write::Holdings { as_of, holdings, index_base }).await.ok();
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads_the_spy_file() {
        let (as_of, h) = super::parse(include_bytes!("../tests/fixtures/spy-2026-10-29.xlsx")).unwrap();
        assert_eq!(as_of, "2026-10-29");
        assert_eq!(h.len(), super::KEEP);
        assert_eq!((h[0].symbol.as_str(), h[0].name.as_str()), ("NVDA", "NVIDIA CORP"));
        assert!((h[0].weight - 7.771259).abs() < 1e-9);
        assert!(h.iter().any(|x| x.symbol == "BRK-B"), "Berkshire's ticker uses our spelling");
        assert!(h.windows(2).all(|w| w[0].weight >= w[1].weight));
    }
}
