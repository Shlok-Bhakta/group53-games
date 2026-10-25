import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { CheckIcon, HourglassMediumIcon, LightningIcon, ShuffleIcon, SpinnerGapIcon, SwordIcon, UsersFourIcon, UsersIcon, XIcon } from "@phosphor-icons/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MODES, MODE_KEYS, modeBySlug, type ModeKey } from "../../convex/modes";
import { Rules } from "@/games/chess/Rules";
import { Group } from "@/games/chess/parts";
import { AsyncButton, usePending } from "@/components/AsyncButton";
import { NotificationBanner } from "@/components/NotificationBanner";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Segmented } from "@/components/Segmented";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { useNotifications } from "@/notifications";
import { OnlineDot, lastSeenText, usePresence } from "@/presence";
import { cn } from "@/lib/utils";

const KINDS = {
  async: { title: "Async", blurb: "Take turns over the day. We ping you when it's your move.", icon: HourglassMediumIcon },
  realtime: { title: "Real-time", blurb: "Everyone on at once. No turns, just speed.", icon: LightningIcon },
} as const;
type Kind = keyof typeof KINDS;

// The second line on each seat option.
const NOTES: Record<ModeKey, string> = {
  "chess:classic": "Classic chess",
  "chess:four": "Free-for-all",
  "chess:realtime": "Kung Fu rules",
  "chess:realtime4": "Last king standing",
};

const LAST_MODE = "lastMode";
const seatLabel = (mode: ModeKey) => (MODES[mode].players === 2 ? "1v1" : `${MODES[mode].players}-Player`);

// Opened from the + button anywhere, or a link with ?new=<mode slug> (pushes use that too). `new=1` opens on
// the last mode you started.
export function NewGameSheet() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const raw = params.get("new");
  const open = raw !== null;
  const initial = (raw && modeBySlug(raw)) || (localStorage.getItem(LAST_MODE) as ModeKey | null) || "chess:classic";

  const clearParam = () => {
    const next = new URLSearchParams(location.search);
    next.delete("new");
    navigate({ pathname: location.pathname, search: next.size ? `?${next}` : "" }, { replace: true });
  };
  // Leave the sheet's URL out of history, so Back from the new game doesn't reopen it.
  const go = (path: string) => {
    clearParam();
    navigate(path);
  };

  return (
    <Drawer open={open} onOpenChange={(o) => !o && clearParam()}>
      <DrawerContent className="max-h-[92dvh]">
        {open && <Body key={initial} initial={MODES[initial] ? initial : "chess:classic"} onClose={clearParam} onGo={go} />}
      </DrawerContent>
    </Drawer>
  );
}

function Body({ initial, onClose, onGo }: { initial: ModeKey; onClose: () => void; onGo: (path: string) => void }) {
  const push = useNotifications();
  const [mode, setMode] = useState<ModeKey>(initial);
  const locked = push.state !== "on" && push.state !== "unsupported";
  useEffect(() => localStorage.setItem(LAST_MODE, mode), [mode]);

  const kind = MODES[mode].kind as Kind;
  const modesOf = (k: Kind) => MODE_KEYS.filter((m) => MODES[m].game === MODES[mode].game && MODES[m].kind === k);
  const pickKind = (k: Kind) => {
    if (k === kind) return;
    const options = modesOf(k);
    setMode(options.find((m) => MODES[m].players === MODES[mode].players) ?? options[0]);
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between px-4 pb-3 pt-2">
        <DrawerTitle className="text-title">New game</DrawerTitle>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="grid size-11 touch-manipulation place-items-center rounded-full text-muted-foreground transition-transform duration-100 active:scale-[0.94]"
        >
          <span className="grid size-8 place-items-center rounded-full bg-muted">
            <XIcon size={16} weight="bold" />
          </span>
        </button>
      </div>
      {locked ? (
        <div className="px-4 pb-[calc(env(safe-area-inset-bottom)+20px)]">
          <NotificationBanner push={push} />
        </div>
      ) : (
        <div className="overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+12px)]">
          <Segmented
            label="Kind"
            value={kind}
            onChange={pickKind}
            options={(Object.keys(KINDS) as Kind[]).map((k) => {
              const Icon = KINDS[k].icon;
              return { value: k, label: KINDS[k].title, icon: <Icon weight="fill" /> };
            })}
          />
          <p className="px-1 pb-3.5 pt-2.5 text-callout text-muted-foreground">{KINDS[kind].blurb}</p>

          <div role="radiogroup" aria-label="Players" className="grid grid-cols-2 gap-2.5">
            {modesOf(kind).map((m) => {
              const on = m === mode;
              const Icon = MODES[m].players > 2 ? UsersFourIcon : UsersIcon;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={seatLabel(m)}
                  onClick={() => setMode(m)}
                  className={cn(
                    "flex min-h-[68px] touch-manipulation items-center gap-3 rounded-lg px-3.5 text-left transition-[transform,background-color] duration-100 active:scale-[0.98]",
                    on ? "bg-primary/12 ring-2 ring-primary" : "bg-muted",
                  )}
                >
                  <Icon size={24} weight={on ? "fill" : "regular"} className={on ? "text-primary" : "text-muted-foreground"} />
                  <span className="min-w-0">
                    <span className="block font-display text-heading">{seatLabel(m)}</span>
                    <span className="block truncate text-footnote text-muted-foreground">{NOTES[m]}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <Opponents key={mode} mode={mode} onGo={onGo} />

          <div className="pt-2">
            <Rules mode={mode} defaultOpen={false} title={`How ${MODES[mode].name} works`} />
          </div>
        </div>
      )}
    </div>
  );
}

// Who to play: anyone (join a waiting game or open one for the crew), or pick people. Two-player modes send
// on one tap; bigger games let you pick several, and seats you leave empty are open to the rest of the crew.
function Opponents({ mode, onGo }: { mode: ModeKey; onGo: (path: string) => void }) {
  const me = useQuery(api.users.me);
  const crew = useQuery(api.profiles.crew);
  const lobby = useQuery(api.matches.lobby, { mode });
  const board = useQuery(api.ratings.leaderboard, { mode });
  const queue = useMutation(api.matches.queue);
  const challenge = useMutation(api.matches.challenge);
  const { isOnline, byUser } = usePresence();
  const [pending, run] = usePending();
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<Id<"users">[]>([]);
  const m = MODES[mode];
  const multi = m.players > 2;
  const max = m.players - 1;
  const ratings = new Map((board ?? []).map((r) => [r.userId, r]));
  const others = (crew ?? []).filter((p) => p._id !== me?._id).sort((a, b) => Number(isOnline(b._id)) - Number(isOnline(a._id)) || a.name.localeCompare(b.name));

  const act = (key: string, action: () => Promise<string | undefined>) =>
    run(async () => {
      setBusy(key);
      try {
        const path = await action();
        if (path) onGo(path);
      } finally {
        setBusy(null);
      }
    });
  const send = (opponents: Id<"users">[]) => act(opponents.length === 1 ? opponents[0] : "send", async () => `/chess/${await challenge({ mode, opponents })}`);
  const tap = (id: Id<"users">) => {
    if (!multi) return void send([id]);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < max ? [...p, id] : p));
  };

  const mine = lobby?.waiting[0];
  const joinable = lobby?.open[0];
  const host = joinable && (joinable.players.find((p) => p.userId === joinable.createdBy) ?? joinable.players[0]);
  const anyone = mine
    ? { title: "Your game is waiting", sub: multi ? `${mine.players.length} of ${m.players} in. Tap to share or cancel.` : "Tap to share or cancel", run: async () => `/chess/${mine._id}` }
    : joinable
      ? { title: `Join ${host?.name}'s game`, sub: multi ? `${joinable.players.length} of ${m.players} in` : "Waiting for an opponent", run: async () => `/chess/${await queue({ mode })}` }
      : { title: "Anyone", sub: "First of the crew to join. We ping everyone.", run: async () => `/chess/${await queue({ mode })}` };
  const free = max - picked.length;

  return (
    <>
      <h2 className="px-1 pb-2.5 pt-6 font-display text-heading">Play against</h2>
      <Group className="bg-muted/60">
        <button
          type="button"
          disabled={pending || lobby === undefined}
          onClick={() => void act("anyone", anyone.run)}
          className="flex min-h-16 w-full touch-manipulation items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-muted disabled:opacity-60"
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            {busy === "anyone" ? <SpinnerGapIcon size={20} weight="bold" className="animate-spin" /> : <ShuffleIcon size={20} weight="bold" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{anyone.title}</span>
            <span className="block truncate text-footnote text-muted-foreground">{anyone.sub}</span>
          </span>
        </button>
        {others.map((p) => {
          const on = picked.includes(p._id);
          const r = ratings.get(p._id);
          return (
            <button
              key={p._id}
              type="button"
              disabled={pending}
              aria-pressed={multi ? on : undefined}
              aria-label={multi ? p.name : `Challenge ${p.name}`}
              onClick={() => tap(p._id)}
              className={cn("flex min-h-16 w-full touch-manipulation items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-muted disabled:opacity-60", on && "bg-primary/10")}
            >
              <span className="relative shrink-0">
                <PlayerAvatar name={p.name} image={p.image} frame={p.frame} frameColor={p.frameColor} size={44} />
                <span className="absolute -bottom-0.5 -right-0.5 [--dot-ring:var(--muted)]">
                  <OnlineDot online={isOnline(p._id)} />
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{p.name}</span>
                <span className="block truncate text-footnote text-muted-foreground">{lastSeenText(isOnline(p._id), byUser.get(p._id)?.lastSeen)}</span>
              </span>
              {r && r.games > 0 && <span className="font-display text-callout tabular-nums text-muted-foreground">{r.rating}</span>}
              {busy === p._id ? (
                <SpinnerGapIcon size={20} weight="bold" className="animate-spin text-muted-foreground" />
              ) : multi ? (
                <span className={cn("grid size-7 place-items-center rounded-full border-2", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")}>
                  {on && <CheckIcon size={16} weight="bold" />}
                </span>
              ) : (
                <SwordIcon size={20} weight="bold" className="text-muted-foreground" />
              )}
            </button>
          );
        })}
        {crew && others.length === 0 && <p className="px-4 py-5 text-center text-callout text-muted-foreground">Nobody else has signed in yet.</p>}
      </Group>
      {multi && picked.length > 0 && (
        <AsyncButton size="xl" className="mt-3 w-full" icon={<SwordIcon weight="bold" />} onClick={() => send(picked)}>
          {free > 0 ? `Challenge ${picked.length}, open ${free} seat${free > 1 ? "s" : ""}` : "Send challenge"}
        </AsyncButton>
      )}
      {m.kind === "realtime" && <p className="px-1 pt-2.5 text-footnote text-muted-foreground">Real-time needs everyone on at once. A green dot means they're on now.</p>}
    </>
  );
}
