import { useEffect } from "react";
import { useNavigate } from "react-router";

// Notification taps (public/sw.js) arrive two ways: a message to the open app, and a note in the Cache
// API for when the app was opened fresh at the wrong page. Either way, route to the target once.
const PENDING = "group53-pending";
const KEY = "/__pending-navigation";
const FRESH_MS = 2 * 60 * 1000;

const here = () => location.pathname + location.search;

async function takePending(): Promise<string | null> {
  if (!("caches" in window)) return null;
  try {
    const cache = await caches.open(PENDING);
    const res = await cache.match(KEY);
    if (!res) return null;
    await cache.delete(KEY);
    const { url, at } = (await res.json()) as { url: string; at: number };
    return Date.now() - at < FRESH_MS ? url : null;
  } catch {
    return null;
  }
}

export function useDeepLinks() {
  const navigate = useNavigate();
  useEffect(() => {
    const go = (raw: string) => {
      const url = new URL(raw, location.origin);
      if (url.origin !== location.origin) return;
      const path = url.pathname + url.search;
      if (path !== here()) navigate(path);
    };
    const check = () => void takePending().then((url) => url && go(url));
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== "navigate" || typeof e.data.url !== "string") return;
      go(e.data.url);
      // Handled; don't route there again on the next foreground.
      void takePending();
    };
    const onVisible = () => document.visibilityState === "visible" && check();
    navigator.serviceWorker?.addEventListener("message", onMessage);
    navigator.serviceWorker?.startMessages?.();
    document.addEventListener("visibilitychange", onVisible);
    check();
    return () => {
      navigator.serviceWorker?.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [navigate]);
}
