import { v, type Infer } from "convex/values";

const n = v.optional(v.number());
const str = v.optional(v.string());

export const profileStats = {
  marketCap: n,
  trailingPE: n,
  forwardPE: n,
  eps: n,
  dividendYield: n,
  exDividend: n,
  beta: n,
  avgVolume: n,
  fiftyDay: n,
  twoHundredDay: n,
  shares: n,
  shortOfFloat: n,
  profitMargin: n,
  revenueGrowth: n,
  earnings: n,
  epsEstimate: n,
  targetLow: n,
  targetMean: n,
  targetHigh: n,
  analysts: n,
  rating: str,
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
