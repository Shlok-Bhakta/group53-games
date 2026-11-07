import { use } from "react";
import type { ConvexReactClient } from "convex/react";
import { BoardSkeleton, PlayerSkeleton, StockSkeleton } from "./skeletons";
import { warmBoard } from "./warm";

// Stonks' code downloads on its own (it's charts nobody else needs), but never while you wait: the Games
// card starts it, and the board, as soon as the card is on screen. React.lazy shows its fallback for a
// frame even when the code's already here, so the routes read a tracked promise with `use`, which React
// returns synchronously once it's settled.

type Mod = typeof import("./Stonks");
type Tracked = Promise<Mod> & { status?: "pending" | "fulfilled" | "rejected"; value?: Mod; reason?: unknown };
let loading: Tracked | null = null;

function loadStonks(): Promise<Mod> {
  if (!loading) {
    const p: Tracked = import("./Stonks");
    p.status = "pending";
    p.then(
      (m) => Object.assign(p, { status: "fulfilled", value: m }),
      (e) => {
        Object.assign(p, { status: "rejected", reason: e });
        loading = null; // a failed download (offline) tries again next time
      },
    );
    loading = p;
  }
  return loading;
}

/** Everything the board needs before it's opened: the code and the data. */
export function prefetchStonks(convex: ConvexReactClient) {
  void loadStonks();
  warmBoard(convex);
}

export function StonksBoardRoute() {
  const m = use(loadStonks());
  return <m.StonksBoard />;
}

export function StockRoute() {
  const m = use(loadStonks());
  return <m.StockPage />;
}

export function PlayerRoute() {
  const m = use(loadStonks());
  return <m.PlayerPage />;
}

export { BoardSkeleton, PlayerSkeleton, StockSkeleton };
