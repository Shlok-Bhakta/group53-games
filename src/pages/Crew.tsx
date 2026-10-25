import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "convex/react";
import { motion } from "motion/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { LargeTitle } from "@/components/AppHeader";
import { PlayerCard } from "@/components/PlayerCard";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { lastSeenText, usePresence } from "@/presence";

// The people: everyone's card, whoever's on first.
export function Crew() {
  const me = useQuery(api.users.me);
  const crew = useQuery(api.profiles.crew);
  const { isOnline, byUser } = usePresence();
  const navigate = useNavigate();
  const [openId, setOpenId] = useState<Id<"users"> | null>(null);
  const show = (id: Id<"users">) => (id === me?._id ? navigate("/you") : setOpenId(id));

  // Online first, then you, then join order.
  const sorted =
    crew &&
    [...crew].sort(
      (a, b) =>
        Number(isOnline(b._id)) - Number(isOnline(a._id)) ||
        Number(b._id === me?._id) - Number(a._id === me?._id) ||
        a.joinedAt - b.joinedAt,
    );
  const open = crew?.find((p) => p._id === openId) ?? null;

  return (
    <div className="flex flex-col gap-7">
      <LargeTitle title="Crew" />

      <section aria-label="Cards" className="-mt-2">
        {sorted === undefined ? (
          <div className="grid grid-cols-2 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="aspect-[3/4] rounded-lg" />
            ))}
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3">
            {sorted.map((p) => (
              <motion.li key={p._id} layout transition={{ type: "spring", bounce: 0, duration: 0.4 }}>
                <button
                  type="button"
                  className="block w-full touch-manipulation rounded-lg text-left outline-none transition-transform duration-100 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]"
                  onClick={() => show(p._id)}
                >
                  <PlayerCard player={p} online={isOnline(p._id)} />
                </button>
              </motion.li>
            ))}
          </ul>
        )}
      </section>

      <Drawer open={open !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <DrawerContent className="px-5 pb-[calc(env(safe-area-inset-bottom)+20px)]">
          {open && (
            <div className="mx-auto w-full max-w-sm pt-3">
              <DrawerTitle className="sr-only">{open.name}</DrawerTitle>
              <PlayerCard player={open} online={isOnline(open._id)} size="hero" />
              <DrawerDescription className="mt-4 text-center">{lastSeenText(isOnline(open._id), byUser.get(open._id)?.lastSeen)}</DrawerDescription>
            </div>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}
