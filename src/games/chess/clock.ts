import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

// Largest correction applied per millisecond of real time once synced, so re-syncs never make pieces jump.
const SLEW_PER_MS = 0.1;

// Estimates server time = Date.now() + offset, using the fastest of a few round trips (NTP-style).
// The returned object is stable, so it can be used inside animation loops.
export function useServerClock() {
  const ping = useMutation(api.time.now);
  const [ready, setReady] = useState(false);
  const target = useRef<number | null>(null);
  const applied = useRef<{ offset: number; at: number } | null>(null);
  const latency = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      let best: { rtt: number; offset: number } | null = null;
      for (let i = 0; i < 5 && !cancelled; i++) {
        const sent = Date.now();
        try {
          const server = await ping({});
          const rtt = Date.now() - sent;
          const sample = { rtt, offset: server - (sent + rtt / 2) };
          if (!best || rtt < best.rtt) best = sample;
        } catch {
          // Try again next round.
        }
      }
      if (cancelled || !best) return;
      latency.current = best.rtt / 2;
      target.current = best.offset;
      if (!applied.current) applied.current = { offset: best.offset, at: Date.now() };
      setReady(true);
    };
    void sync();
    const timer = setInterval(() => void sync(), 20_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [ping]);

  const clock = useMemo(
    () => ({
      now() {
        const wall = Date.now();
        const a = applied.current;
        if (!a || target.current === null) return wall;
        const step = SLEW_PER_MS * (wall - a.at);
        const diff = target.current - a.offset;
        const offset = Math.abs(diff) <= step ? target.current : a.offset + Math.sign(diff) * step;
        applied.current = { offset, at: wall };
        return wall + offset;
      },
      latency: () => latency.current,
    }),
    [],
  );
  return useMemo(() => ({ ...clock, ready }), [clock, ready]);
}
