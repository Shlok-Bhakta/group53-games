import { use } from "react";
import type { ConvexReactClient } from "convex/react";
import { BoardSkeleton, PlayerSkeleton, StockSkeleton } from "./skeletons";
import type * as StonksScreens from "./Stonks";
import { warmBoard } from "./warm";

// platform: React.lazy shows its fallback for a frame even when the code's already here; `use` on a settled, tracked promise returns at once.

type Mod = typeof StonksScreens;
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
        loading = null;
      },
    );
    loading = p;
  }
  return loading;
}

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
