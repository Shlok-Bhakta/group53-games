import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import { AnimatePresence, MotionConfig } from "motion/react";
import { canonicalGamePath } from "../convex/modes";
import { api } from "../convex/_generated/api";
import { Wordle } from "./games/wordle/Wordle";
import { GAME_UI } from "./games";
import { HostedGame } from "./games/HostedGame";
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
import { Page, TAB_ROUTES, useAppBadge, useNavDirection, useScrollMemory, useViewportGap } from "@/shell";
import { HoldUpdates, recover, UpdateOverlay, useVersionCheck } from "@/version";
import { CrashBoundary } from "@/components/CrashBoundary";
import { ConnectionLost } from "@/connection";
import { wantMusic } from "@/sound";
import { useDeepLinks } from "@/deepLinks";
import { BoardSkeleton, PlayerRoute, PlayerSkeleton, StockRoute, StockSkeleton, StonksBoardRoute } from "./games/stonks/load";

const GolfHub = lazy(() => import("./games/golf/GolfHub").then((m) => ({ default: m.GolfHub })));
const GolfOpenWorld = lazy(() => import("./games/golf/GolfHub").then((m) => ({ default: m.GolfOpenWorld })));
const GolfHole = lazy(() => import("./games/golf/GolfHub").then((m) => ({ default: m.GolfHole })));
const golfRoute = (path: string, element: ReactNode) => (
  <Route
    path={path}
    element={
      <NotificationsRequired>
        <Suspense fallback={<Skeleton className="mt-[calc(var(--safe-top)+44px)] h-96 w-full rounded-lg" />}>{element}</Suspense>
      </NotificationsRequired>
    }
  />
);

export function App() {
  useViewportGap();
  useVersionCheck();
  return (
    <MotionConfig reducedMotion="user">
      <InstallGate>
        <CrashBoundary title="Group 53 hit a bug" onCrash={recover} className="min-h-[100dvh] px-page">
          <AuthLoading>
            <div className="mx-auto flex max-w-md flex-col gap-4 px-page pt-[calc(var(--safe-top)+44px)]">
              <Skeleton className="h-10 w-32" />
              <Skeleton className="h-48 w-full rounded-lg" />
            </div>
          </AuthLoading>
          <Unauthenticated>
            <div className="mx-auto max-w-md px-5 pt-[var(--safe-top)]">
              <SignIn />
            </div>
          </Unauthenticated>
          <Authenticated>
            <SignedIn />
          </Authenticated>
        </CrashBoundary>
        {/* platform: sonner uses mobileOffset on phones, not offset. */}
        <Toaster
          position="top-center"
          offset={{ top: "calc(var(--safe-top) + 44px)" }}
          mobileOffset={{ top: "calc(var(--safe-top) + 44px)" }}
        />
        <ConnectionLost />
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
  usePresenceReporter({ shareTaps: inTabs });
  useDeepLinks();
  useScrollMemory(direction);
  useAppBadge();
  useEffect(() => {
    wantMusic(true);
    return () => wantMusic(false);
  }, []);

  return (
    <>
      <main className="relative mx-auto w-full max-w-md overflow-x-clip px-page phone-landscape:max-w-[calc(36rem+var(--gutter-left)+var(--gutter-right))] phone-landscape:has-[[data-wide]]:max-w-none">
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <Page key={location.pathname} direction={direction} onBack={inTabs ? null : goBack}>
            <div style={{ paddingBottom: inTabs ? TAB_BAR_SPACE : "calc(var(--safe-bottom) + 16px)" }}>
              <Routes location={location}>
                <Route path="/" element={<Home />} />
                <Route path="/games" element={<Games />} />
                <Route path="/crew" element={<Crew />} />
                <Route path="/you" element={<You />} />
                <Route path="/settings" element={<Navigate to="/you" replace />} />
                <Route path="/wordle" element={<Wordle />} />
                {golfRoute("/mereddia", <HostedGame game="mereddia" title="Journey Across Mereddia" />)}
                {golfRoute("/golf/practice", <GolfHub />)}
                {golfRoute(
                  "/golf/world",
                  <>
                    <HoldUpdates />
                    <GolfOpenWorld />
                  </>,
                )}
                {golfRoute(
                  "/golf/:course/:hole",
                  <>
                    <HoldUpdates />
                    <GolfHole />
                  </>,
                )}
                <Route
                  path="/stonks"
                  element={
                    <NotificationsRequired>
                      <Suspense fallback={<BoardSkeleton />}>
                        <StonksBoardRoute />
                      </Suspense>
                    </NotificationsRequired>
                  }
                />
                <Route
                  path="/stonks/u/:id"
                  element={
                    <NotificationsRequired>
                      <Suspense fallback={<PlayerSkeleton />}>
                        <PlayerRoute />
                      </Suspense>
                    </NotificationsRequired>
                  }
                />
                <Route
                  path="/stonks/:symbol"
                  element={
                    <NotificationsRequired>
                      <Suspense fallback={<StockSkeleton />}>
                        <StockRoute />
                      </Suspense>
                    </NotificationsRequired>
                  }
                />
                {Object.values(GAME_UI).flatMap((g) => [
                  <Route
                    key={g.key}
                    path={g.path}
                    element={
                      <NotificationsRequired>
                        <GameHub game={g} />
                      </NotificationsRequired>
                    }
                  />,
                  <Route
                    key={`${g.key}-mode`}
                    path={`${g.path}/mode/:slug`}
                    element={
                      <NotificationsRequired>
                        <ModePage game={g} />
                      </NotificationsRequired>
                    }
                  />,
                  <Route
                    key={`${g.key}-match`}
                    path={`${g.path}/:id`}
                    element={
                      <NotificationsRequired>
                        <MatchScreen game={g} />
                      </NotificationsRequired>
                    }
                  />,
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
  const { pathname, search, hash } = useLocation();
  const canonical = canonicalGamePath(pathname);
  if (canonical !== pathname) return <Navigate to={canonical + search + hash} replace />;

  return (
    <div>
      <NavBar title="Not found" />
    </div>
  );
}
