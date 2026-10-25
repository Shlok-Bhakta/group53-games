import { Link, Navigate, Route, Routes, useLocation } from "react-router";
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { api } from "../convex/_generated/api";
import { Wordle } from "./games/wordle/Wordle";
import { InstallGate } from "./InstallGate";
import { TabBar } from "@/components/TabBar";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { Crew } from "@/pages/Crew";
import { Home } from "@/pages/Home";
import { SignIn } from "@/pages/SignIn";
import { You } from "@/pages/You";
import { ArrivalPills, TapLayer, usePresenceReporter } from "@/presence";

const TAB_ROUTES = ["/", "/crew", "/you"];

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <InstallGate>
        <AuthLoading>
          <div className="mx-auto flex max-w-md flex-col gap-4 px-4 pt-[calc(env(safe-area-inset-top)+24px)]">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-72 w-full rounded-3xl" />
          </div>
        </AuthLoading>
        <Unauthenticated>
          <div className="mx-auto max-w-md px-5 pt-[env(safe-area-inset-top)]">
            <SignIn />
          </div>
        </Unauthenticated>
        <Authenticated>
          <SignedIn />
        </Authenticated>
        <Toaster position="top-center" offset={{ top: "calc(env(safe-area-inset-top) + 12px)" }} />
      </InstallGate>
    </MotionConfig>
  );
}

function SignedIn() {
  const location = useLocation();
  const me = useQuery(api.users.me);
  const inTabs = TAB_ROUTES.includes(location.pathname);
  // Taps are shared in the main UI only, not inside games.
  usePresenceReporter({ shareTaps: inTabs });

  return (
    <>
      <main className={`mx-auto w-full max-w-md px-4 ${inTabs ? "pb-[calc(env(safe-area-inset-bottom)+92px)]" : "pb-[calc(env(safe-area-inset-bottom)+24px)]"}`}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <Routes location={location}>
              <Route path="/" element={<Home />} />
              <Route path="/crew" element={<Crew />} />
              <Route path="/you" element={<You />} />
              <Route path="/settings" element={<Navigate to="/you" replace />} />
              <Route path="/wordle" element={<Wordle />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </main>
      {inTabs && <TabBar />}
      {inTabs && <TapLayer meId={me?._id} />}
      <ArrivalPills />
    </>
  );
}

function NotFound() {
  return (
    <div className="flex flex-col items-start gap-3 pt-[calc(env(safe-area-inset-top)+40px)]">
      <h1 className="font-display text-2xl">Nothing here</h1>
      <Link to="/" className="text-primary underline underline-offset-4">
        Back to games
      </Link>
    </div>
  );
}
