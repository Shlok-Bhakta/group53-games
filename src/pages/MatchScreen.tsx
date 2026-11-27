import { useHoldUpdates } from "@/version";
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { MODES, gameOf, matchPath, settingsOf, type ModeKey } from "../../convex/modes";
import { NavBar, useGoBack } from "@/components/AppHeader";
import { GameChrome } from "@/components/game/GameFrame";
import { CrashBoundary } from "@/components/CrashBoundary";
import { Skeleton } from "@/components/ui/skeleton";
import { GameMenu, MenuButton } from "@/components/GameMenu";
import { Lobby } from "@/components/match";
import type { GameUI } from "@/games";

export function MatchScreen({ game }: { game: GameUI }) {
  const { id } = useParams<{ id: string }>();
  const match = useQuery(api.matches.get, { id: id ?? "" });
  const me = useQuery(api.users.me);
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [menuSlot, setMenuSlot] = useState<HTMLElement | null>(null);
  const goBack = useGoBack("/");
  useHoldUpdates(true);
  const sawEnd = useMutation(api.matches.sawEnd);
  const meId = me?._id;
  const unseenEnd =
    !!match && !!meId && match.status === "finished" && match.players.some((p) => p.userId === meId) && !match.endSeen?.includes(meId);
  const matchId = match?._id;
  useEffect(() => {
    if (unseenEnd && matchId) void sawEnd({ id: matchId });
  }, [unseenEnd, matchId, sawEnd]);

  if (match === undefined) {
    return (
      <div>
        <NavBar title={game.name} back="/" />
        <Skeleton className="mt-16 aspect-square w-full rounded-sm" />
      </div>
    );
  }
  if (match === null) {
    return (
      <div>
        <NavBar title={game.name} back="/" />
        <p className="pt-4 text-callout text-muted-foreground">This game doesn't exist.</p>
      </div>
    );
  }
  if (gameOf(match.mode) !== game.key) return <Navigate to={matchPath(match)} replace />;

  const mode = MODES[match.mode as ModeKey];
  const Game = game.Game;
  if (match.status !== "waiting" && match.status !== "cancelled" && game.fullscreen?.(match))
    return (
      <CrashBoundary title="This screen hit a bug">
        <Game match={match} meId={me?._id} />
      </CrashBoundary>
    );

  return (
    <div className="group/match flex min-h-[calc(100svh-var(--safe-bottom)-16px)] flex-col">
      <NavBar
        title={mode.name}
        back="/"
        action={<MenuButton onClick={() => setMenu(true)} />}
        className="phone-landscape:group-has-[[data-game-frame]]/match:hidden"
      />
      <GameMenu
        open={menu}
        onOpenChange={setMenu}
        match={match}
        title={mode.name}
        rules={game.rules(match.mode as ModeKey, settingsOf(match.mode, match.settings))}
        slot={setMenuSlot}
      />
      {match.status === "waiting" || match.status === "cancelled" ? (
        <Lobby match={match} meId={me?._id} onLeave={() => navigate("/", { replace: true })} setup={game.setup} />
      ) : (
        <GameChrome title={mode.name} onBack={goBack} onMenu={() => setMenu(true)} menuSlot={menuSlot}>
          <CrashBoundary title="This screen hit a bug">
            <Game match={match} meId={me?._id} />
          </CrashBoundary>
        </GameChrome>
      )}
    </div>
  );
}
