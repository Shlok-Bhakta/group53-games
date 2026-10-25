import { Navigate, Route, Routes, useLocation, useParams } from "react-router";
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import { AnimatePresence, MotionConfig } from "motion/react";
import { api } from "../convex/_generated/api";
import { modeBySlug, MODES } from "../convex/modes";
import { Wordle } from "./games/wordle/Wordle";
import { ChessMatch } from "./games/chess/ChessMatch";
import { InstallGate } from "./InstallGate";
import { TAB_BAR_SPACE, TabBar } from "@/components/TabBar";
import { TopEdge } from "@/components/TopEdge";
import { NavBar, useGoBack } from "@/components/AppHeader";
import { NewGameSheet } from "@/components/NewGameSheet";
import { NotificationsRequired } from "@/components/NotificationsRequired";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { Crew } from "@/pages/Crew";
import { Play } from "@/pages/Play";
import { SignIn } from "@/pages/SignIn";
import { You } from "@/pages/You";
import { ArrivalPills, TapLayer, usePresenceReporter } from "@/presence";
import { Page, TAB_ROUTES, useAppBadge, useNavDirection, useScrollMemory } from "@/shell";
import { useVersionCheck } from "@/version";
import { useDeepLinks } from "@/deepLinks";

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
  const direction = useNavDirection();
  const goBack = useGoBack("/");
  // Taps are shared in the main UI only, not inside games.
  usePresenceReporter({ shareTaps: inTabs });
  useDeepLinks();
  useScrollMemory(direction);
  useAppBadge();

  return (
    <>
      <main className="relative mx-auto w-full max-w-md overflow-x-clip px-4">
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <Page key={location.pathname} direction={direction} onBack={inTabs ? null : goBack}>
            <div style={{ paddingBottom: inTabs ? TAB_BAR_SPACE : "calc(env(safe-area-inset-bottom) + 16px)" }}>
              <Routes location={location}>
                <Route path="/" element={<Play />} />
                <Route path="/crew" element={<Crew />} />
                <Route path="/you" element={<You />} />
                <Route path="/settings" element={<Navigate to="/you" replace />} />
                <Route path="/wordle" element={<Wordle />} />
                {/* The chess hub and mode pages became the Play tab and the New game sheet. */}
                <Route path="/chess" element={<LegacyChess />} />
                <Route path="/chess/mode/:slug" element={<LegacyMode />} />
                <Route path="/chess/:id" element={<NotificationsRequired><ChessMatch /></NotificationsRequired>} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </div>
          </Page>
        </AnimatePresence>
      </main>
      {inTabs && <TabBar />}
      {inTabs && <TapLayer meId={me?._id} />}
      <NewGameSheet />
      <ArrivalPills />
    </>
  );
}

// Old links: /chess?mode=chess:four and /chess/mode/four open the New game sheet on that mode.
function LegacyChess() {
  const mode = new URLSearchParams(useLocation().search).get("mode");
  return <Navigate to={mode && mode in MODES ? `/?new=${MODES[mode as keyof typeof MODES].slug}` : "/"} replace />;
}
function LegacyMode() {
  const { slug } = useParams<{ slug: string }>();
  return <Navigate to={slug && modeBySlug(slug) ? `/?new=${slug}` : "/"} replace />;
}

function NotFound() {
  return (
    <div>
      <NavBar title="Not found" />
      <p className="pt-4 text-callout text-muted-foreground">Nothing lives at this address.</p>
    </div>
  );
}
