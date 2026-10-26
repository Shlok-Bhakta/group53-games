import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { AppWindowIcon, BellRingingIcon } from "@phosphor-icons/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Button } from "@/components/ui/button";
import { platform } from "@/install";
import { errorText } from "@/lib/errors";
import { listNames } from "@/lib/text";
import { cn } from "@/lib/utils";

// A game link opened in a browser (Discord's, or Safari), where nobody's signed in. Pick yourself and the
// game is pushed to your phone; the notification opens the app right in it. See convex/links.ts.
export function LinkHandoff({ path }: { path: string }) {
  const view = useQuery(api.links.preview, { path });
  const handoff = useMutation(api.links.handoff);
  const [sent, setSent] = useState<{ to: Id<"users">; result: "sent" | "no-push" | "wait" } | null>(null);
  const [busy, setBusy] = useState<Id<"users"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (view === undefined) return <div className="h-40" />;
  if (view === null) return null;

  const pick = async (userId: Id<"users">) => {
    setBusy(userId);
    setError(null);
    try {
      setSent({ to: userId, result: await handoff({ path, userId }) });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const title = view.status === "waiting" ? `${view.host} wants ${view.title}` : `${view.game}: ${listNames(view.players.map((p) => p.name))}`;
  // Android can hand a link to the installed app when the system lets it.
  const intent = `intent://${location.host}${path}#Intent;scheme=https;action=android.intent.action.VIEW;end`;

  return (
    <section aria-label="Open this game" className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-title">{title}</h1>
        <div className="mt-3 flex -space-x-2">
          {view.players.map((p) => (
            <PlayerAvatar key={p._id} name={p.name} image={p.image ?? undefined} size={40} className="rounded-full ring-2 ring-background" />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-display text-heading">Which one's you?</h2>
        <ul className="grid grid-cols-4 gap-x-2 gap-y-3" aria-label="Crew">
          {view.crew.map((p) => (
            <li key={p._id}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void pick(p._id)}
                aria-label={`I'm ${p.name}`}
                className={cn("flex w-full touch-manipulation flex-col items-center gap-1.5 rounded-lg py-1.5 transition-transform duration-100 active:scale-[0.95]", sent?.to === p._id && "bg-primary/12")}
              >
                <PlayerAvatar name={p.name} image={p.image ?? undefined} size={56} />
                <span className="w-full truncate text-footnote font-semibold">{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <AnimatePresence mode="wait">
        {(sent || error) && (
          <motion.p
            key={error ?? sent!.result}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="status"
            className="flex items-start gap-3 rounded-lg bg-card p-4 ring-2 ring-primary/50"
          >
            <motion.span initial={{ rotate: -20 }} animate={{ rotate: [0, -18, 16, -10, 6, 0] }} transition={{ duration: 0.7 }} className="mt-0.5 shrink-0 text-primary">
              <BellRingingIcon size={22} weight="fill" />
            </motion.span>
            <span>
              {error ??
                (sent!.result === "no-push"
                  ? "Your notifications are off. Open Group 53 from your home screen and turn them on; the game is waiting on Home."
                  : sent!.result === "wait"
                    ? "Already on its way. Check your notifications."
                    : "Sent to your phone. Tap the notification to jump in.")}
            </span>
          </motion.p>
        )}
      </AnimatePresence>

      {platform === "android" && (
        <Button size="xl" variant="secondary" asChild>
          <a href={intent}>
            <AppWindowIcon weight="bold" /> Open in the app
          </a>
        </Button>
      )}
    </section>
  );
}
