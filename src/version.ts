import { useEffect } from "react";
import { useLocation } from "react-router";
import { toast } from "sonner";
import { GAMES } from "../convex/modes";

declare const __BUILD_ID__: string;

const CHECK_EVERY_MS = 60_000;
// In a game, never yank the page out from under the player; offer the update instead.
const inGame = (path: string) => Object.values(GAMES).some((g) => new RegExp(`^${g.path}/[a-z0-9]+$`).test(path));

// Reload at most once per new build; if the page still disagrees afterwards (say a stale cache), offer
// the update instead of looping.
function reloadFor(latest: string) {
  if (sessionStorage.getItem("reloaded-for") === latest) return false;
  sessionStorage.setItem("reloaded-for", latest);
  location.reload();
  return true;
}
const offer = () => toast("A new version is ready", { id: "update", duration: Infinity, action: { label: "Update", onClick: () => location.reload() } });

async function latestBuild(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { id?: string }).id ?? null;
  } catch {
    return null;
  }
}

// Keeps installed apps on the newest build: checks on launch, every minute, and whenever the app comes back
// to the foreground.
export function useVersionCheck() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (import.meta.env.DEV) return;
    let stopped = false;
    const check = async () => {
      const latest = await latestBuild();
      if (stopped || !latest || latest === __BUILD_ID__) return;
      if (inGame(location.pathname) || !reloadFor(latest)) offer();
    };
    const first = setTimeout(() => void check(), 1500);
    const timer = setInterval(() => void check(), CHECK_EVERY_MS);
    const onVisible = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  // Leaving a game is a good moment to pick up a pending update.
  useEffect(() => {
    if (import.meta.env.DEV || inGame(pathname)) return;
    void latestBuild().then((latest) => latest && latest !== __BUILD_ID__ && reloadFor(latest));
  }, [pathname]);
}
