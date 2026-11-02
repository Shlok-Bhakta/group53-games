//! Every US listing, from Nasdaq's daily symbol files, so search is instant for most of what anyone
//! types. Anything else on Yahoo (other countries, crypto, futures...) joins through lookups.rs.
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use tokio::sync::mpsc;

use crate::rest::Rest;
use crate::sink::{Symbol, Write};
use crate::types::log;

const NASDAQ: &str = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt";
const OTHER: &str = "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt";
const NOT_SHARES: &[&str] = &["Warrant", "Warrants", "Right", "Rights", "Unit", "Units", "Preferred", "Notes", "Note", "Debentures"];

fn clean_name(name: &str) -> String {
    let name = name.split(" - ").next().unwrap_or(name);
    let mut n = name.trim();
    for tail in ["Common Stock", "Common Shares", "Ordinary Shares", "Class A Common Stock"] {
        n = n.strip_suffix(tail).unwrap_or(n).trim_end();
    }
    n.trim_end_matches(',').to_string()
}

fn row(symbol: &str, name: &str, etf: bool, exchange: &str) -> Option<Symbol> {
    // Plain tickers and share classes (BRK.B). Preferreds ($), warrants and units have their own marks.
    let (base, class) = symbol.split_once('.').unwrap_or((symbol, ""));
    if base.is_empty() || !base.chars().all(|c| c.is_ascii_uppercase()) || class.len() > 1 || (!class.is_empty() && !class.chars().all(|c| c.is_ascii_uppercase())) || matches!(class, "U" | "W" | "R") {
        return None;
    }
    if !etf && name.split(|c: char| !c.is_alphanumeric()).any(|w| NOT_SHARES.contains(&w)) {
        return None;
    }
    Some(Symbol { symbol: symbol.replace('.', "-"), name: clean_name(name), kind: Some(if etf { "ETF" } else { "EQUITY" }.to_string()), exchange: Some(exchange.to_string()) })
}

/// nasdaqlisted.txt: Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
pub fn parse_nasdaq(text: &str) -> Vec<Symbol> {
    text.lines()
        .skip(1)
        .filter_map(|l| {
            let f: Vec<&str> = l.split('|').collect();
            if f.len() < 8 || f[3] != "N" {
                return None;
            }
            row(f[0], f[1], f[6] == "Y", "NASDAQ")
        })
        .collect()
}

/// otherlisted.txt: ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
pub fn parse_other(text: &str) -> Vec<Symbol> {
    text.lines()
        .skip(1)
        .filter_map(|l| {
            let f: Vec<&str> = l.split('|').collect();
            if f.len() < 8 || f[6] != "N" {
                return None;
            }
            let exchange = match f[2] {
                "N" => "NYSE",
                "A" => "NYSE American",
                "P" => "NYSE Arca",
                "Z" => "Cboe",
                "V" => "IEX",
                other => other,
            };
            row(f[0], f[1], f[4] == "Y", exchange)
        })
        .collect()
}

async fn once(rest: &Rest, out: &mpsc::Sender<Write>) -> Result<usize> {
    let a = rest.http.get(NASDAQ).send().await?.error_for_status()?.text().await?;
    let b = rest.http.get(OTHER).send().await?.error_for_status()?.text().await?;
    let mut rows = parse_nasdaq(&a);
    rows.extend(parse_other(&b));
    let n = rows.len();
    for chunk in rows.chunks(500) {
        out.send(Write::Symbols(chunk.to_vec())).await.ok();
    }
    Ok(n)
}

pub async fn run(rest: Arc<Rest>, out: mpsc::Sender<Write>) {
    loop {
        let wait = match once(&rest, &out).await {
            Ok(n) => {
                log(format!("universe: {n} US listings"));
                24 * 3600
            }
            Err(e) => {
                log(format!("universe: {e:#}"));
                1800
            }
        };
        tokio::time::sleep(Duration::from_secs(wait)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_nasdaqs_file() {
        let t = "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares\nAAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N\nAAAP|Pacer Barings CLO Market Flex ETF|G|N|N|100|Y|N\nZZZT|Test Co - Common Stock|Q|Y|N|100|N|N\nABCDW|Abc Corp - Warrants|Q|N|N|100|N|N\nFile Creation Time: 1030202618:01|||||||\n";
        let r = parse_nasdaq(t);
        assert_eq!(r.iter().map(|s| s.symbol.as_str()).collect::<Vec<_>>(), ["AAPL", "AAAP"]);
        assert_eq!(r[0].name, "Apple Inc.");
        assert_eq!(r[1].kind.as_deref(), Some("ETF"));
    }
    #[test]
    fn reads_the_others_file() {
        let t = "ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol\nA|Agilent Technologies, Inc. Common Stock|N|A|N|100|N|A\nBRK.B|Berkshire Hathaway Inc. Class B Common Stock|N|BRK.B|N|100|N|BRK=B\nABR$D|Arbor Realty Trust 6.375% Preferred|N|ABRpD|N|100|N|ABR-D\nAAC.U|Ares Acquisition Units|N|AAC.U|N|100|N|AAC=\nSPY|SPDR S&P 500|P|SPY|Y|100|N|SPY\n";
        let r = parse_other(t);
        assert_eq!(r.iter().map(|s| s.symbol.as_str()).collect::<Vec<_>>(), ["A", "BRK-B", "SPY"]);
        assert_eq!(r[0].name, "Agilent Technologies, Inc.");
        assert_eq!(r[2].exchange.as_deref(), Some("NYSE Arca"));
    }
}
