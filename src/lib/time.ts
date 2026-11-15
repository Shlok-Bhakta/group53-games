import { useEffect, useState } from "react";

export function ago(ms: number, { seconds = false } = {}) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (seconds && s < 60) return `${s}s ago`;
  const m = Math.max(1, Math.round(s / 60));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function useNow(every: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}
