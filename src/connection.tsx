import { useEffect, useState } from "react";
import { useConvex } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { WifiSlashIcon } from "@phosphor-icons/react";

const SHOW_AFTER_MS = 3000;

function useDownSince() {
  const convex = useConvex();
  const [downSince, setDownSince] = useState<number | null>(null);
  useEffect(() => {
    const read = () => {
      const down = !convex.connectionState().isWebSocketConnected && document.visibilityState === "visible";
      setDownSince((since) => (down ? (since ?? Date.now()) : null));
    };
    read();
    const unsubscribe = convex.subscribeToConnectionState(read);
    document.addEventListener("visibilitychange", read);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", read);
    };
  }, [convex]);
  return downSince;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function ConnectionLost() {
  const downSince = useDownSince();
  const now = useNow(downSince !== null);
  const shown = downSince !== null && now - downSince >= SHOW_AFTER_MS;
  const seconds = downSince === null ? 0 : Math.max(0, Math.floor((now - downSince) / 1000));
  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          key="offline"
          role="status"
          aria-label="Reconnecting"
          data-offline-for={seconds}
          className="fixed inset-x-0 top-0 pin-bottom z-[90] bg-background/40 backdrop-grayscale"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <span className="fixed inset-x-0 bottom-[calc(var(--safe-bottom)+104px)] flex justify-center">
            <span className="flex items-center gap-2 rounded-full bg-muted px-4 py-2.5 font-semibold text-foreground shadow-lg">
              <WifiSlashIcon size={20} weight="bold" />
              Reconnecting
              <span className="font-mono tabular-nums text-muted-foreground">{seconds}s</span>
            </span>
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
