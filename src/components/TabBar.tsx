import { NavLink, useSearchParams } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { GameControllerIcon, PlusIcon, UserCircleIcon, UsersThreeIcon, type Icon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useOnlineOthers } from "@/presence";

const TABS: { to: string; label: string; icon: Icon; end: boolean }[] = [
  { to: "/", label: "Play", icon: GameControllerIcon, end: true },
  { to: "/crew", label: "Crew", icon: UsersThreeIcon, end: false },
  { to: "/you", label: "You", icon: UserCircleIcon, end: false },
];

// How much room the tab bar takes at the bottom of a tab, for the page's bottom padding.
export const TAB_BAR_SPACE = "calc(env(safe-area-inset-bottom) + 104px)";

// iOS 26 style: a floating glass capsule with the tabs, and the New game button beside it in thumb reach.
// A soft fade behind it lets content scroll under without a hard edge.
export function TabBar() {
  const onlineCount = useOnlineOthers().length;
  const [, setParams] = useSearchParams();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t [pointer-events:none] from-background from-40% to-transparent px-4 pt-8"
      style={{ paddingBottom: "max(calc(env(safe-area-inset-bottom) - 4px), 14px)" }}
    >
      <div className="pointer-events-auto mx-auto flex max-w-md items-center gap-3">
        <ul className="grid h-[62px] flex-1 grid-cols-3 rounded-full bg-card/85 p-1 shadow-lg shadow-black/15 ring-1 ring-border backdrop-blur-xl backdrop-saturate-150">
          {TABS.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "relative flex h-full touch-manipulation flex-col items-center justify-center gap-0.5 rounded-full text-caption font-semibold transition-colors",
                    isActive ? "text-primary" : "text-muted-foreground",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.span layoutId="tab-pill" className="absolute inset-0 -z-10 rounded-full bg-primary/12" transition={{ type: "spring", bounce: 0, duration: 0.35 }} />
                    )}
                    <span className="relative">
                      <Icon size={25} weight={isActive ? "fill" : "regular"} />
                      {to === "/crew" && <OnlineBadge count={onlineCount} />}
                    </span>
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
        <button
          type="button"
          aria-label="New game"
          onClick={() => setParams((p) => (p.set("new", "1"), p), { replace: true })}
          className="grid size-[62px] shrink-0 touch-manipulation place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 outline-none transition-transform duration-100 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.94]"
        >
          <PlusIcon size={28} weight="bold" />
        </button>
      </div>
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
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.5, opacity: 0 }}
          transition={{ type: "spring", bounce: 0.3, duration: 0.35 }}
          className="absolute -right-3 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-online px-1 text-caption font-bold leading-none text-[var(--online-ink)] ring-2 ring-card"
          aria-label={`${count} online`}
        >
          <motion.span key={count} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", bounce: 0, duration: 0.3 }}>
            {count}
          </motion.span>
        </motion.span>
      )}
    </AnimatePresence>
  );
}
