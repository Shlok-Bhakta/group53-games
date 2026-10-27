import { Navigate, useNavigate, useParams } from "react-router";
import { useQuery } from "convex/react";
import { ShareNetworkIcon } from "@phosphor-icons/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MODES, gameOf, matchPath, type ModeKey } from "../../convex/modes";
import { NavBar } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Lobby } from "@/components/match";
import type { GameUI } from "@/games";
import { shareLink } from "@/share";

// Any game, at /<game>/<id>: a compact bar on top, then the lobby while it fills, or the game itself.
export function MatchScreen({ game }: { game: GameUI }) {
  const { id } = useParams<{ id: string }>();
  const match = useQuery(api.matches.get, { id: id as Id<"matches"> });
  const me = useQuery(api.users.me);
  const navigate = useNavigate();

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
  const share = (
    <Button variant="ghost" size="icon" aria-label="Share this game" onClick={() => void shareLink(matchPath(match), `${mode.name} ${game.name.toLowerCase()} on Group 53:`)}>
      <ShareNetworkIcon size={22} weight="bold" />
    </Button>
  );
  const Game = game.Game;
  if (match.status === "active" && game.fullscreen?.(match)) return <Game match={match} meId={me?._id} />;

  return (
    <div className="flex min-h-[calc(100svh-env(safe-area-inset-bottom)-16px)] flex-col">
      <NavBar title={mode.name} back="/" action={share} />
      {match.status === "waiting" || match.status === "cancelled" ? (
        <Lobby match={match} meId={me?._id} onLeave={() => navigate("/", { replace: true })} />
      ) : (
        <Game match={match} meId={me?._id} />
      )}
    </div>
  );
}
