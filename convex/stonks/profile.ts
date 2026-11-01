import { v, type Infer } from "convex/values";

// What Stonks keeps about a company beyond its price, as the sidecar sends it (from Yahoo's quote
// summary and search): every field optional, since Yahoo leaves out what doesn't apply (no dividend,
// no analysts). Dates are ms since the epoch.

const n = v.optional(v.number());
const str = v.optional(v.string());

export const profileStats = {
  marketCap: n,
  trailingPE: n,
  forwardPE: n,
  eps: n,
  dividendYield: n, // a fraction: 0.0031 is 0.31%
  exDividend: n,
  beta: n,
  avgVolume: n,
  fiftyDay: n,
  twoHundredDay: n,
  shares: n,
  shortOfFloat: n, // a fraction
  profitMargin: n, // a fraction
  revenueGrowth: n, // a fraction, year on year
  earnings: n, // the next report
  epsEstimate: n,
  targetLow: n,
  targetMean: n,
  targetHigh: n,
  analysts: n,
  rating: str, // "buy", "strong_buy", "hold"...
  sector: str,
  industry: str,
  employees: n,
  website: str,
  summary: str,
};
export const statsValidator = v.object(profileStats);
export type ProfileStats = Infer<typeof statsValidator>;

export const newsItem = v.object({
  title: v.string(),
  publisher: v.string(),
  link: v.string(),
  time: v.number(),
  thumb: v.optional(v.string()),
});
export type NewsItem = Infer<typeof newsItem>;
