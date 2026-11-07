import { useEffect, useState } from "react";

// How long ago, short: "5m ago", "3h ago", "2d ago". With `seconds`, the first minute counts up ("12s ago");
// without, it reads "1m ago".
export function ago(ms: number, { seconds = false } = {}) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (seconds && s < 60) return `${s}s ago`;
  const m = Math.max(1, Math.round(s / 60));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

// The time, re-read every `every` ms. Queries only re-run when data changes, so anything that reads "how long
// ago" or counts down needs this to move on its own.
export function useNow(every: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}
