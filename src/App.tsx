import { Link, Navigate, Route, Routes, useLocation } from "react-router";
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { api } from "../convex/_generated/api";
import { Wordle } from "./games/wordle/Wordle";
import { ChessHub } from "./games/chess/ChessHub";
import { ChessMatch } from "./games/chess/ChessMatch";
import { ModePage } from "./games/chess/ModePage";
import { InstallGate } from "./InstallGate";
import { TabBar } from "@/components/TabBar";
import { TopEdge } from "@/components/TopEdge";
import { NotificationsRequired } from "@/components/NotificationsRequired";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { Crew } from "@/pages/Crew";
import { Home } from "@/pages/Home";
import { SignIn } from "@/pages/SignIn";
import { You } from "@/pages/You";
import { ArrivalPills, TapLayer, usePresenceReporter } from "@/presence";
import { useVersionCheck } from "@/version";
import { useDeepLinks } from "@/deepLinks";

const TAB_ROUTES = ["/", "/crew", "/you"];

export function App() {
  useVersionCheck();
  return (
    <MotionConfig reducedMotion="user">
      <InstallGate>
        <AuthLoading>
          <div className="mx-auto flex max-w-md flex-col gap-4 px-4 pt-[calc(env(safe-area-inset-top)+44px)]">
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
        <Toaster position="top-center" offset={{ top: "calc(env(safe-area-inset-top) + 40px)" }} />
        <TopEdge />
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
  useDeepLinks();

  return (
    <>
      <main className={`mx-auto w-full max-w-md px-4 ${inTabs ? "pb-[calc(env(safe-area-inset-bottom)+92px)]" : "pb-[calc(env(safe-area-inset-bottom)+24px)]"}`}>
        <AnimatePresence mode="popLayout">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <Routes location={location}>
              <Route path="/" element={<Home />} />
              <Route path="/crew" element={<Crew />} />
              <Route path="/you" element={<You />} />
              <Route path="/settings" element={<Navigate to="/you" replace />} />
              <Route path="/wordle" element={<Wordle />} />
              <Route path="/chess" element={<NotificationsRequired><ChessHub /></NotificationsRequired>} />
              <Route path="/chess/mode/:slug" element={<NotificationsRequired><ModePage /></NotificationsRequired>} />
              <Route path="/chess/:id" element={<NotificationsRequired><ChessMatch /></NotificationsRequired>} />
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
    <div className="flex flex-col items-start gap-3 pt-[calc(env(safe-area-inset-top)+48px)]">
      <h1 className="font-display text-2xl">Nothing here</h1>
      <Link to="/" className="text-primary underline underline-offset-4">
        Back to games
      </Link>
    </div>
  );
}
