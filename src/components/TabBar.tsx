import { NavLink } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { GameControllerIcon, UserCircleIcon, UsersThreeIcon, type Icon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useOnlineOthers } from "@/presence";

const TABS: { to: string; label: string; icon: Icon; end: boolean }[] = [
  { to: "/", label: "Games", icon: GameControllerIcon, end: true },
  { to: "/crew", label: "Crew", icon: UsersThreeIcon, end: false },
  { to: "/you", label: "You", icon: UserCircleIcon, end: false },
];

// Native-height tab bar: 50px of targets, sitting on the home indicator inset like iOS does.
export function TabBar() {
  const onlineCount = useOnlineOthers().length;
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border/60 bg-background/80 backdrop-blur-xl backdrop-saturate-150"
      style={{ paddingBottom: "max(calc(env(safe-area-inset-bottom) - 10px), 6px)" }}
    >
      <ul className="mx-auto grid max-w-md grid-cols-3 px-2 pt-1.5">
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "relative flex h-[50px] touch-manipulation flex-col items-center justify-center gap-0.5 text-[11px] font-semibold tracking-wide transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="tab-pill"
                      className="absolute inset-x-5 inset-y-0.5 -z-10 rounded-2xl bg-primary/12"
                      transition={{ type: "spring", stiffness: 500, damping: 38 }}
                    />
                  )}
                  <motion.span className="relative" whileTap={{ scale: 0.85 }} transition={{ type: "spring", stiffness: 600, damping: 20 }}>
                    <Icon size={26} weight={isActive ? "fill" : "regular"} />
                    {to === "/crew" && <OnlineBadge count={onlineCount} />}
                  </motion.span>
                  {label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// How many other people have the app open. Pops in and bumps when the number changes.
function OnlineBadge({ count }: { count: number }) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.span
          key="badge"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          exit={{ scale: 0 }}
          transition={{ type: "spring", stiffness: 600, damping: 22 }}
          className="absolute -bottom-1 -right-2.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#34d058] px-1 text-[11px] font-bold leading-none text-[#06240f] ring-2 ring-background"
          aria-label={`${count} online`}
        >
          <motion.span key={count} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 700, damping: 26 }}>
            {count}
          </motion.span>
        </motion.span>
      )}
    </AnimatePresence>
  );
}
