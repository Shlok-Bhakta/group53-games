//! Each company's key stats (Yahoo's quote summary) and news (its search and ticker feed), for what's open
//! on a phone, held, or at the top. Crypto, currencies, futures and indexes have news only.
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{bail, Result};
use convex::Value;
use tokio::sync::{mpsc, watch};

use crate::market;
use crate::rest::Rest;
use crate::sink::Write;
use crate::types::{log, now_ms};

fn raw(v: &serde_json::Value) -> Option<f64> {
    v["raw"].as_f64().or(v.as_f64()).filter(|x| x.is_finite())
}

/// The quote summary, as the fields convex/stonks/profile.ts takes. Missing ones are left out.
pub fn parse_stats(v: &serde_json::Value) -> Result<BTreeMap<String, Value>> {
    let r = &v["quoteSummary"]["result"][0];
    if r.is_null() {
        bail!("no result: {}", v["quoteSummary"]["error"]);
    }
    let (sd, ks, fd, ce, ap) = (&r["summaryDetail"], &r["defaultKeyStatistics"], &r["financialData"], &r["calendarEvents"], &r["assetProfile"]);
    let ms = |x: Option<f64>| x.map(|s| s * 1000.0);
    let nums = [
        ("marketCap", raw(&sd["marketCap"])),
        ("trailingPE", raw(&sd["trailingPE"])),
        ("forwardPE", raw(&sd["forwardPE"]).or(raw(&ks["forwardPE"]))),
        ("eps", raw(&ks["trailingEps"])),
        ("dividendYield", raw(&sd["dividendYield"])),
        ("exDividend", ms(raw(&sd["exDividendDate"]))),
        ("beta", raw(&sd["beta"]).or(raw(&ks["beta"]))),
        ("avgVolume", raw(&sd["averageVolume"])),
        ("fiftyDay", raw(&sd["fiftyDayAverage"])),
        ("twoHundredDay", raw(&sd["twoHundredDayAverage"])),
        ("shares", raw(&ks["sharesOutstanding"])),
        ("shortOfFloat", raw(&ks["shortPercentOfFloat"])),
        ("profitMargin", raw(&fd["profitMargins"])),
        ("revenueGrowth", raw(&fd["revenueGrowth"])),
        ("earnings", ms(raw(&ce["earnings"]["earningsDate"][0]))),
        ("epsEstimate", raw(&ce["earnings"]["earningsAverage"])),
        ("targetLow", raw(&fd["targetLowPrice"])),
        ("targetMean", raw(&fd["targetMeanPrice"])),
        ("targetHigh", raw(&fd["targetHighPrice"])),
        ("analysts", raw(&fd["numberOfAnalystOpinions"])),
        ("employees", raw(&ap["fullTimeEmployees"])),
    ];
    let mut out: BTreeMap<String, Value> = nums.into_iter().filter_map(|(k, v)| Some((k.to_string(), Value::Float64(v?)))).collect();
    let summary: String = ap["longBusinessSummary"].as_str().unwrap_or("").chars().take(1500).collect();
    let strs = [("rating", fd["recommendationKey"].as_str().filter(|s| *s != "none")), ("sector", ap["sector"].as_str()), ("industry", ap["industry"].as_str()), ("website", ap["website"].as_str()), ("summary", Some(summary.as_str()).filter(|s| !s.is_empty()))];
    out.extend(strs.into_iter().filter_map(|(k, v)| Some((k.to_string(), Value::String(v?.to_string())))));
    Ok(out)
}

/// A story from either source: the search's have a publisher and thumbnail, the feed's a summary.
#[derive(Debug, Clone, Default)]
pub struct Story {
    pub id: String,
    pub title: String,
    pub link: String,
    pub publisher: String,
    pub time: i64, // ms
    pub thumb: Option<String>,
    pub summary: String,
}

pub fn search_stories(v: &serde_json::Value) -> Vec<Story> {
    v["news"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|n| {
            let link = n["link"].as_str()?;
            let thumb = n["thumbnail"]["resolutions"]
                .as_array()
                .and_then(|rs| rs.iter().filter(|r| r["width"].as_i64().unwrap_or(0) >= 120).min_by_key(|r| r["width"].as_i64().unwrap_or(i64::MAX)))
                .and_then(|r| r["url"].as_str())
                .filter(|t| t.starts_with("https://"))
                .map(String::from);
            Some(Story {
                id: n["uuid"].as_str().unwrap_or(link).to_string(),
                title: n["title"].as_str()?.to_string(),
                link: link.to_string(),
                publisher: n["publisher"].as_str().unwrap_or("").to_string(),
                time: n["providerPublishTime"].as_i64()? * 1000,
                thumb,
                summary: String::new(),
            })
        })
        .filter(|s| s.link.starts_with("https://"))
        .collect()
}

/// Yahoo's RSS feed for a ticker, read with a few string searches (it's small and regular).
pub fn feed_stories(xml: &str) -> Vec<Story> {
    let tag = |item: &str, name: &str| -> String {
        let (open, close) = (format!("<{name}"), format!("</{name}>"));
        let Some(at) = item.find(&open) else { return String::new() };
        let Some(gt) = item[at..].find('>') else { return String::new() };
        let body = &item[at + gt + 1..];
        let text = body.find(&close).map_or("", |end| &body[..end]);
        let text = text.trim().trim_start_matches("<![CDATA[").trim_end_matches("]]>");
        unescape(text)
    };
    xml.split("<item>")
        .skip(1)
        .filter_map(|item| {
            let item = item.split("</item>").next()?;
            let link = tag(item, "link");
            let time = chrono::DateTime::parse_from_rfc2822(&tag(item, "pubDate")).ok()?.timestamp_millis();
            let host = link.split('/').nth(2).unwrap_or("").trim_start_matches("www.").to_string();
            Some(Story { id: tag(item, "guid"), title: tag(item, "title"), link, publisher: publisher_of(&host), time, thumb: None, summary: tag(item, "description") })
        })
        .filter(|s| !s.title.is_empty() && s.link.starts_with("https://"))
        .collect()
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&apos;", "'").replace("&amp;", "&")
}

fn publisher_of(host: &str) -> String {
    match host {
        "fool.com" => "Motley Fool",
        "finance.yahoo.com" => "Yahoo Finance",
        "investors.com" => "Investor's Business Daily",
        "barrons.com" => "Barron's",
        "reuters.com" => "Reuters",
        "bloomberg.com" => "Bloomberg",
        "cnbc.com" => "CNBC",
        "wsj.com" => "The Wall Street Journal",
        "thestreet.com" => "TheStreet",
        "benzinga.com" => "Benzinga",
        "zacks.com" => "Zacks",
        other => other,
    }
    .to_string()
}

// What a company goes by in headlines, beyond its legal name's first word.
const ALIASES: &[(&str, &[&str])] = &[
    ("GOOGL", &["Google", "Alphabet"]),
    ("GOOG", &["Google", "Alphabet"]),
    ("META", &["Meta", "Facebook", "Instagram"]),
    ("BRK-B", &["Berkshire", "Buffett"]),
    ("LLY", &["Lilly"]),
    ("JPM", &["JPMorgan", "JP Morgan", "Dimon"]),
    ("AMZN", &["Amazon", "AWS"]),
    ("TSLA", &["Tesla", "Musk"]),
    ("NVDA", &["Nvidia", "Jensen Huang"]),
    ("XOM", &["Exxon"]),
    ("MA", &["Mastercard"]),
    ("V", &["Visa"]),
    ("JNJ", &["Johnson & Johnson", "J&J"]),
    ("WMT", &["Walmart"]),
    ("PG", &["Procter"]),
];

/// The words that make a story about this company: its name's first word (or two, when the first is
/// short, like "Eli Lilly"), its aliases, and its ticker as a whole word in capitals.
pub fn keywords(symbol: &str, name: Option<&str>) -> Vec<String> {
    let mut k: Vec<String> = ALIASES.iter().filter(|(s, _)| *s == symbol).flat_map(|(_, a)| a.iter().map(|w| w.to_string())).collect();
    if let Some(name) = name {
        let words: Vec<&str> = name.split(|c: char| c.is_whitespace() || c == ',').filter(|w| !w.is_empty()).collect();
        if let Some(first) = words.first() {
            let first = first.trim_end_matches(".com");
            k.push(if first.len() <= 3 && words.len() > 1 { format!("{first} {}", words[1]) } else { first.to_string() });
        }
    }
    k
}

fn mentions(text: &str, symbol: &str, words: &[String]) -> bool {
    let lower = text.to_lowercase();
    let whole = |hay: &str, needle: &str| {
        hay.match_indices(needle).any(|(i, m)| {
            let before = hay[..i].chars().next_back();
            let after = hay[i + m.len()..].chars().next();
            !before.is_some_and(char::is_alphanumeric) && !after.is_some_and(char::is_alphanumeric)
        })
    };
    let ticker = symbol.replace('-', ".");
    (ticker.len() >= 2 && whole(text, &ticker)) || words.iter().any(|w| whole(&lower, &w.to_lowercase()))
}

/// Stories about this company, newest first: the two sources merged by story, kept if the headline or
/// the summary names it. The index (`keep_all`) takes the market's news as it comes.
pub fn pick_news(search: &[Story], feed: &[Story], symbol: &str, name: Option<&str>, keep_all: bool) -> Vec<Value> {
    let mut by_id: Vec<Story> = search.to_vec();
    for f in feed {
        match by_id.iter_mut().find(|s| s.id == f.id || s.title == f.title) {
            Some(s) => s.summary = f.summary.clone(),
            None => by_id.push(f.clone()),
        }
    }
    let words = keywords(symbol, name);
    let mut picked: Vec<Story> = by_id.into_iter().filter(|s| keep_all || mentions(&s.title, symbol, &words) || mentions(&s.summary, symbol, &words)).collect();
    picked.sort_by_key(|s| -s.time);
    picked.dedup_by(|a, b| a.title == b.title);
    picked
        .into_iter()
        .take(8)
        .map(|s| {
            let mut o = BTreeMap::from([
                ("title".to_string(), Value::String(s.title)),
                ("publisher".to_string(), Value::String(s.publisher)),
                ("link".to_string(), Value::String(s.link)),
                ("time".to_string(), Value::Float64(s.time as f64)),
            ]);
            if let Some(t) = s.thumb {
                o.insert("thumb".into(), Value::String(t));
            }
            Value::Object(o)
        })
        .collect()
}

/// A company has stats, and news worth filtering to its name. A pair or an index just has news.
fn is_company(symbol: &str) -> bool {
    !(symbol.contains('=') || symbol.contains('^') || symbol.ends_with("-USD"))
}

pub async fn run(rest: Arc<Rest>, mut want: watch::Receiver<BTreeSet<String>>, out: mpsc::Sender<Write>, ticks: Arc<Mutex<HashMap<String, i64>>>, fresh: Vec<(String, String, i64)>) {
    // (symbol, "stats" | "news") -> when it's next due. A restart picks up from what Convex has.
    let mut due: HashMap<(String, &'static str), i64> = HashMap::new();
    let wait_for = |kind: &str, trading: bool| match (kind, trading) {
        ("news", true) => 10,
        ("news", false) => 60,
        (_, true) => 30,
        _ => 360,
    };
    let trading_now = market::session(now_ms()).trading();
    for (symbol, kind, at) in fresh {
        if kind == "stats" || kind == "news" {
            let key: &'static str = if kind == "stats" { "stats" } else { "news" };
            due.insert((symbol, key), at + wait_for(key, trading_now) * 60_000);
        }
    }
    // Company names from the quote summary, so news can be checked for what it's about.
    let mut names: HashMap<String, String> = HashMap::new();
    loop {
        let symbols = want.borrow_and_update().clone();
        let now = now_ms();
        let next = ["stats", "news"]
            .iter()
            .flat_map(|kind| symbols.iter().map(move |s| (s, *kind)))
            .filter(|(s, kind)| *kind == "news" || is_company(s))
            .find(|(s, kind)| due.get(&((*s).clone(), *kind)).is_none_or(|&at| at <= now));
        let Some((symbol, kind)) = next else {
            tokio::select! {
                _ = want.changed() => {}
                _ = tokio::time::sleep(Duration::from_secs(10)) => {}
            }
            continue;
        };
        let trading = market::session(now).trading() || ticks.lock().unwrap().get(symbol).is_some_and(|t| now - t < 300_000);
        let result = if kind == "stats" {
            rest.summary(symbol).await.and_then(|v| {
                if let Some(n) = v["quoteSummary"]["result"][0]["price"]["shortName"].as_str() {
                    names.insert(symbol.clone(), n.to_string());
                }
                parse_stats(&v)
            })
            .map(|stats| Write::Profile { symbol: symbol.clone(), stats: Some(stats), news: None })
        } else {
            match (rest.search(symbol, 40, 0).await, rest.feed(symbol).await) {
                (Ok(search), Ok(rss)) => {
                    let news = pick_news(&search_stories(&search), &feed_stories(&rss), symbol, names.get(symbol).map(String::as_str), !is_company(symbol));
                    Ok(Write::Profile { symbol: symbol.clone(), stats: None, news: Some(news) })
                }
                (Err(e), _) | (_, Err(e)) => Err(e),
            }
        };
        let wait_min = match result {
            Ok(w) => {
                out.send(w).await.ok();
                wait_for(kind, trading)
            }
            Err(e) => {
                log(format!("profile: {symbol} {kind}: {e:#}"));
                // Yahoo's "no summary for that" won't change soon.
                if e.to_string().contains("no result") { 360 } else { 15 }
            }
        };
        due.insert((symbol.clone(), kind), now + wait_min * 60_000);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_a_real_quote_summary() {
        let v: serde_json::Value = serde_json::from_str(include_str!("../tests/fixtures/summary-aapl.json")).unwrap();
        let s = parse_stats(&v).unwrap();
        let num = |k: &str| match s.get(k) {
            Some(Value::Float64(x)) => *x,
            other => panic!("{k}: {other:?}"),
        };
        assert!(num("marketCap") > 1e12);
        assert!(num("trailingPE") > 1.0 && num("eps") > 0.0 && num("avgVolume") > 1e6);
        assert_eq!(num("earnings"), 1793653200000.0);
        assert!(num("targetLow") <= num("targetMean") && num("targetMean") <= num("targetHigh"));
        assert_eq!(s.get("rating"), Some(&Value::String("buy".into())));
        assert_eq!(s.get("sector"), Some(&Value::String("Technology".into())));
        assert!(matches!(s.get("summary"), Some(Value::String(t)) if t.len() > 100));
    }
    #[test]
    fn keeps_only_news_about_the_company() {
        let search: serde_json::Value = serde_json::from_str(include_str!("../tests/fixtures/news-nvda.json")).unwrap();
        let s = search_stories(&search);
        let f = feed_stories(include_str!("../tests/fixtures/rss-nvda.xml"));
        assert!(s.len() > 20 && f.len() > 10, "{} {}", s.len(), f.len());
        assert!(f.iter().all(|x| x.time > 1_790_000_000_000 && !x.summary.is_empty()));
        let news = pick_news(&s, &f, "NVDA", Some("NVIDIA Corporation"), false);
        let titles: Vec<String> = news.iter().map(|v| if let Value::Object(o) = v { if let Value::String(t) = &o["title"] { t.clone() } else { String::new() } } else { String::new() }).collect();
        assert!(!titles.is_empty());
        assert!(titles.iter().any(|t| t.contains("Huang")), "{titles:?}");
        assert!(!titles.iter().any(|t| t.contains("Tilray") || t.contains("Medtronic")), "{titles:?}");
        // The market's news for the index isn't filtered.
        assert!(pick_news(&s, &f, "^GSPC", None, true).len() == 8);
    }
    #[test]
    fn what_a_company_goes_by() {
        assert!(keywords("LLY", Some("Eli Lilly and Company")).contains(&"Eli Lilly".to_string()));
        assert!(keywords("AMZN", Some("Amazon.com, Inc.")).contains(&"Amazon".to_string()));
        assert!(mentions("Visa beats estimates", "V", &keywords("V", Some("Visa Inc."))));
        assert!(!mentions("A VIP event", "V", &keywords("V", Some("Visa Inc."))));
        assert!(mentions("Why BRK.B is rallying", "BRK-B", &[]));
        assert!(!mentions("Nvidiana Jones", "NVDA", &["Nvidia".into()]));
    }
    #[test]
    fn a_missing_result_is_an_error() {
        assert!(parse_stats(&serde_json::json!({"quoteSummary": {"result": null, "error": {"code": "Not Found"}}})).is_err());
    }
}
