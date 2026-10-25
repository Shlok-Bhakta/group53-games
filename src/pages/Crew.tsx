import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "convex/react";
import { motion } from "motion/react";
import { api } from "../../convex/_generated/api";
import type { PlayerCard as Card } from "../../convex/profiles";
import { LargeTitle } from "@/components/AppHeader";
import { PlayerCard } from "@/components/PlayerCard";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { usePresence } from "@/presence";

export function Crew() {
  const me = useQuery(api.users.me);
  const crew = useQuery(api.profiles.crew);
  const { isOnline, byUser } = usePresence();
  const navigate = useNavigate();
  const [open, setOpen] = useState<Card | null>(null);

  // Online first, then you, then join order.
  const sorted =
    crew &&
    [...crew].sort(
      (a, b) =>
        Number(isOnline(b._id)) - Number(isOnline(a._id)) ||
        Number(b._id === me?._id) - Number(a._id === me?._id) ||
        a.joinedAt - b.joinedAt,
    );
  const onlineCount = crew?.filter((p) => isOnline(p._id)).length ?? 0;

  return (
    <div>
      <LargeTitle
        title="Crew"
        subtitle={
          crew && (
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-[#34d058]" />
              {onlineCount} online · {crew.length} total
            </span>
          )
        }
      />
      {sorted === undefined ? (
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="aspect-[3/4] rounded-[22px]" />
          ))}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3">
          {sorted.map((p, i) => (
            <motion.li
              key={p._id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 320, damping: 28, delay: i * 0.05 }}
            >
              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                className="block w-full touch-manipulation rounded-[22px] text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={() => (p._id === me?._id ? navigate("/you") : setOpen(p))}
              >
                <PlayerCard player={p} online={isOnline(p._id)} />
              </motion.button>
            </motion.li>
          ))}
        </ul>
      )}

      <Drawer open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DrawerContent className="px-5 pb-[calc(env(safe-area-inset-bottom)+20px)]">
          {open && (
            <div className="mx-auto w-full max-w-sm pt-3">
              <DrawerTitle className="sr-only">{open.name}</DrawerTitle>
              <PlayerCard player={open} online={isOnline(open._id)} size="hero" />
              <DrawerDescription className="mt-4 text-center text-[0.95rem]">
                {lastSeenText(isOnline(open._id), byUser.get(open._id)?.lastSeen)}
              </DrawerDescription>
            </div>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function lastSeenText(online: boolean, lastSeen: number | undefined) {
  if (online) return "On the app right now";
  if (!lastSeen) return "Hasn't opened the app yet";
  const mins = Math.round((Date.now() - lastSeen) / 60_000);
  if (mins < 60) return `Last on ${Math.max(1, mins)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Last on ${hours}h ago`;
  return `Last on ${Math.round(hours / 24)}d ago`;
}
