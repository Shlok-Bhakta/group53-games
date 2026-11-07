// Stonks: the S&P 500's twenty biggest companies, ranked by their share of the index, live, and $10,000 each to
// trade anything on Yahoo Finance. Prices stream in from the stonks sidecar through convex/stonks.ts; every phone
// sees each trade the moment Convex has it. Pre-market and after hours count: the day's chart runs 4am to 8pm
// New York.
//
// This file is the code ./load.tsx downloads: the three screens, and everything they use comes with them.
//
// Fast on purpose: what you can tap next is already subscribed (./warm.ts), so a stock opens from cache
// in the frame you tap it; every height is fixed and the skeletons are the same size (./skeletons.tsx),
// so nothing moves when data lands; rows only re-render when their own numbers change.

export { StonksBoard } from "./Board";
export { StockPage } from "./StockPage";
export { PlayerPage } from "./Profile";
