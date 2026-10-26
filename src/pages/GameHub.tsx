import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { isMode, modePath, type ModeKey } from "../../convex/modes";
import { NavBar } from "@/components/AppHeader";
import { ModePicker } from "@/components/ModePicker";
import { MatchRow, ResultChip, Section } from "@/components/parts";
import type { GameUI } from "@/games";

// A game's page, opened from its card on Games: every mode with my Elo on it, then the crew's latest games.
export function GameHub({ game }: { game: GameUI }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const inbox = useQuery(api.matches.inbox);
  const ratings = useQuery(api.ratings.mine);
  const recent = useQuery(api.matches.recent, { game: game.key });
  const me = useQuery(api.users.me);

  // Old links pointed at /chess?mode=...
  const legacy = params.get("mode");
  useEffect(() => {
    if (legacy && isMode(legacy)) navigate(modePath(legacy), { replace: true });
  }, [legacy, navigate]);

  const count = (mode: ModeKey, key: "myTurn" | "live" | "open" | "invites") => inbox?.[key].filter((m) => m.mode === mode).length ?? 0;

  return (
    <div className="flex flex-col gap-7">
      <NavBar title={game.name} back="/games" />
      <ModePicker
        game={game.key}
        art={game.modeArt}
        rating={(mode) => (ratings ? (ratings[mode] ?? { rating: 1200, games: 0 }) : null)}
        badge={(mode) =>
          count(mode, "invites") ? `${count(mode, "invites")} challenge${count(mode, "invites") > 1 ? "s" : ""}`
          : count(mode, "myTurn") ? "Your move"
          : count(mode, "live") ? "Live"
          : count(mode, "open") ? `${count(mode, "open")} open`
          : null
        }
      />
      {recent && recent.length > 0 && (
        <Section title="Recent games">
          {recent.map((m) => (
            <MatchRow key={m._id} match={m} meId={me?._id} vs status={<ResultChip match={m} meId={me?._id} />} />
          ))}
        </Section>
      )}
    </div>
  );
}
