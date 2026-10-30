import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import { AnimatePresence, MotionConfig } from "motion/react";
import { api } from "../convex/_generated/api";
import { Wordle } from "./games/wordle/Wordle";
import { GAME_UI } from "./games";
import { InstallGate } from "./InstallGate";
import { TAB_BAR_SPACE, TabBar } from "@/components/TabBar";
import { TopEdge } from "@/components/TopEdge";
import { NavBar, useGoBack } from "@/components/AppHeader";
import { NotificationsRequired } from "@/components/NotificationsRequired";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { Crew } from "@/pages/Crew";
import { Games } from "@/pages/Games";
import { GameHub } from "@/pages/GameHub";
import { MatchScreen } from "@/pages/MatchScreen";
import { ModePage } from "@/pages/ModePage";
import { Home } from "@/pages/Home";
import { SignIn } from "@/pages/SignIn";
import { You } from "@/pages/You";
import { ArrivalPills, TapLayer, usePresenceReporter } from "@/presence";
import { Page, TAB_ROUTES, useAppBadge, useNavDirection, useScrollMemory } from "@/shell";
import { UpdateOverlay, useVersionCheck } from "@/version";
import { wantMusic } from "@/sound";
import { useDeepLinks } from "@/deepLinks";

// Golf loads only when someone opens it, so chess and Scrabble players never download it.
const GolfWorld = lazy(() => import("./games/golf/GolfWorld"));

export function App() {
  useVersionCheck();
  return (
    <MotionConfig reducedMotion="user">
      <InstallGate>
        <AuthLoading>
          <div className="mx-auto flex max-w-md flex-col gap-4 px-4 pt-[calc(env(safe-area-inset-top)+44px)]">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-48 w-full rounded-lg" />
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
        {/* Phones use mobileOffset, not offset. Toasts sit below the band iOS blurs under the status bar. */}
        <Toaster position="top-center" offset={{ top: "calc(env(safe-area-inset-top) + 44px)" }} mobileOffset={{ top: "calc(env(safe-area-inset-top) + 44px)" }} />
        <UpdateOverlay />
        <TopEdge />
      </InstallGate>
    </MotionConfig>
  );
}

function SignedIn() {
  const location = useLocation();
  const me = useQuery(api.users.me);
  const inTabs = TAB_ROUTES.includes(location.pathname);
  const direction = useNavDirection();
  const goBack = useGoBack("/");
  // Taps are shared in the main UI only, not inside games.
  usePresenceReporter({ shareTaps: inTabs });
  useDeepLinks();
  useScrollMemory(direction);
  useAppBadge();
  // Music plays all over the app once you're signed in, not just in games.
  useEffect(() => {
    wantMusic(true);
    return () => wantMusic(false);
  }, []);

  return (
    <>
      <main className="relative mx-auto w-full max-w-md overflow-x-clip px-4">
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <Page key={location.pathname} direction={direction} onBack={inTabs ? null : goBack}>
            <div style={{ paddingBottom: inTabs ? TAB_BAR_SPACE : "calc(env(safe-area-inset-bottom) + 16px)" }}>
              <Routes location={location}>
                <Route path="/" element={<Home />} />
                <Route path="/games" element={<Games />} />
                <Route path="/crew" element={<Crew />} />
                <Route path="/you" element={<You />} />
                <Route path="/settings" element={<Navigate to="/you" replace />} />
                <Route path="/wordle" element={<Wordle />} />
                <Route
                  path="/golf"
                  element={
                    <NotificationsRequired>
                      <Suspense fallback={<Skeleton className="mt-[calc(env(safe-area-inset-top)+44px)] h-96 w-full rounded-lg" />}>
                        <GolfWorld />
                      </Suspense>
                    </NotificationsRequired>
                  }
                />
                {Object.values(GAME_UI).flatMap((g) => [
                  <Route key={g.key} path={g.path} element={<NotificationsRequired><GameHub game={g} /></NotificationsRequired>} />,
                  <Route key={`${g.key}-mode`} path={`${g.path}/mode/:slug`} element={<NotificationsRequired><ModePage game={g} /></NotificationsRequired>} />,
                  <Route key={`${g.key}-match`} path={`${g.path}/:id`} element={<NotificationsRequired><MatchScreen game={g} /></NotificationsRequired>} />,
                ])}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </div>
          </Page>
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
    <div>
      <NavBar title="Not found" />
      <p className="pt-4 text-callout text-muted-foreground">Nothing lives at this address.</p>
    </div>
  );
}
