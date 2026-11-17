import { useEffect, useSyncExternalStore } from "react";
import { useLocation } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircleIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Tiles } from "@/Tiles";

declare const __BUILD_ID__: string;

const CHECK_EVERY_MS = 60_000;
const SHOW_MS = 1100;
const TARGET_KEY = "updating-to";
const RECOVERED_KEY = "recovered-on";
const SHELL_WAIT_MS = 5000;

type Phase = "idle" | "updating" | "updated";
let phase: Phase = "idle";
let pending: string | null = null;
let holds = 0;
const listeners = new Set<() => void>();
const set = (p: Phase) => {
  phase = p;
  listeners.forEach((l) => l());
};

async function latestBuild(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { id?: string }).id ?? null;
  } catch {
    return null;
  }
}

function refreshShell(): Promise<void> {
  const worker = navigator.serviceWorker?.controller;
  if (!worker) return Promise.resolve();
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    setTimeout(resolve, SHELL_WAIT_MS);
    worker.postMessage({ type: "refresh-shell" }, [channel.port2]);
  });
}

export async function reloadFresh() {
  await refreshShell();
  location.reload();
}

export function recover() {
  if (sessionStorage.getItem(RECOVERED_KEY) === __BUILD_ID__) return false;
  sessionStorage.setItem(RECOVERED_KEY, __BUILD_ID__);
  void reloadFresh();
  return true;
}

function update(latest: string) {
  pending = latest;
  if ((holds > 0 && document.visibilityState === "visible") || phase === "updating") return;
  if (sessionStorage.getItem(TARGET_KEY) === latest) {
    toast("A new version is ready", { id: "update", duration: Infinity, action: { label: "Update", onClick: () => void reloadFresh() } });
    return;
  }
  sessionStorage.setItem(TARGET_KEY, latest);
  set("updating");
  void Promise.all([refreshShell(), new Promise((resolve) => setTimeout(resolve, SHOW_MS))]).then(() => {
    if (holds > 0 && document.visibilityState === "visible") {
      sessionStorage.removeItem(TARGET_KEY);
      set("idle");
      return;
    }
    location.reload();
  });
}

async function check() {
  if (import.meta.env.DEV) return;
  const latest = await latestBuild();
  if (latest && latest !== __BUILD_ID__) update(latest);
}

export function useHoldUpdates(hold: boolean) {
  useEffect(() => {
    if (!hold) return;
    holds++;
    return () => {
      holds--;
      if (holds === 0 && pending) update(pending);
    };
  }, [hold]);
}

export function HoldUpdates() {
  useHoldUpdates(true);
  return null;
}

export function useVersionCheck() {
  const { pathname } = useLocation();
  useEffect(() => {
    const target = sessionStorage.getItem(TARGET_KEY);
    if (target && target === __BUILD_ID__) {
      sessionStorage.removeItem(TARGET_KEY);
      set("updated");
      setTimeout(() => phase === "updated" && set("idle"), 2600);
    }
    const first = setTimeout(() => void check(), 1500);
    const timer = setInterval(() => void check(), CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
      else if (pending && holds > 0) update(pending);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  useEffect(() => void check(), [pathname]);
}

const usePhase = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => phase,
  );

export function UpdateOverlay() {
  const p = usePhase();
  return (
    <AnimatePresence>
      {p === "updating" && (
        <motion.div
          key="updating"
          role="status"
          aria-label="Updating"
          className="fixed inset-x-0 top-0 pin-bottom z-[100] grid place-items-center bg-background/85 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <motion.div
            className="flex flex-col items-center gap-5"
            initial={{ scale: 0.9, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: "spring", bounce: 0.35, duration: 0.5 }}
          >
            <Tiles word="UPDATE" states={["green", "yellow", "green", "yellow", "green", "yellow"]} size="md" flip label="Updating" />
            <p className="font-display text-heading">Getting the new version</p>
            <span className="flex gap-1.5" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="size-2 rounded-full bg-primary"
                  animate={{ opacity: [0.25, 1, 0.25], y: [0, -4, 0] }}
                  transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
                />
              ))}
            </span>
          </motion.div>
        </motion.div>
      )}
      {p === "updated" && (
        <motion.div
          key="updated"
          role="status"
          className="fixed inset-x-0 bottom-[calc(var(--safe-bottom)+104px)] z-[100] flex justify-center"
          initial={{ opacity: 0, y: 30, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ type: "spring", bounce: 0.4, duration: 0.5 }}
        >
          <span className="flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 font-semibold text-primary-foreground shadow-lg">
            <motion.span
              initial={{ scale: 0, rotate: -45 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", bounce: 0.6, duration: 0.5, delay: 0.15 }}
            >
              <CheckCircleIcon size={20} weight="fill" />
            </motion.span>
            You're up to date
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
