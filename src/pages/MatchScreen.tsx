import { Component, useState, type ReactNode } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MODES, gameOf, matchPath, settingsOf, type ModeKey } from "../../convex/modes";
import { NavBar } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { GameMenu, MenuButton } from "@/components/GameMenu";
import { Lobby } from "@/components/match";
import type { GameUI } from "@/games";

// Any game, at /<game>/<id>: a compact bar on top (back, the mode, and the game menu), then the lobby while it fills, or the game itself.
export function MatchScreen({ game }: { game: GameUI }) {
  const { id } = useParams<{ id: string }>();
  const match = useQuery(api.matches.get, { id: id as Id<"matches"> });
  const me = useQuery(api.users.me);
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);

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
  // A link with the wrong game in it still finds the game.
  if (gameOf(match.mode) !== game.key) return <Navigate to={matchPath(match)} replace />;

  const mode = MODES[match.mode as ModeKey];
  const Game = game.Game;
  if (match.status === "active" && game.fullscreen?.(match))
    return (
      <GameCrash>
        <Game match={match} meId={me?._id} />
      </GameCrash>
    );

  return (
    <div className="flex min-h-[calc(100svh-env(safe-area-inset-bottom)-16px)] flex-col">
      <NavBar title={mode.name} back="/" action={<MenuButton onClick={() => setMenu(true)} />} />
      <GameMenu open={menu} onOpenChange={setMenu} match={match} title={mode.name} rules={game.rules(match.mode as ModeKey, settingsOf(match.mode, match.settings))} />
      {match.status === "waiting" || match.status === "cancelled" ? (
        <Lobby match={match} meId={me?._id} onLeave={() => navigate("/", { replace: true })} />
      ) : (
        <GameCrash>
          <Game match={match} meId={me?._id} />
        </GameCrash>
      )}
    </div>
  );
}

// A bug in a game's screen shows a way out instead of blanking the whole app.
class GameCrash extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
        <h2 className="font-display text-title">This screen hit a bug</h2>
        <p className="max-w-[30ch] font-mono text-footnote text-muted-foreground">{this.state.error.message}</p>
        <Button size="xl" onClick={() => location.reload()}>
          Reload
        </Button>
      </section>
    );
  }
}
