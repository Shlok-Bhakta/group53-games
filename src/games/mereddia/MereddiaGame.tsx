import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, ArrowCounterClockwiseIcon, PersonSimpleRunIcon } from "@phosphor-icons/react";
import { NavBar } from "@/components/AppHeader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useSoundSettings } from "@/sound";
import { cn } from "@/lib/utils";
import { Chest, EnemyArt, Gate, HEAD, ITEM, NpcArt, Sprite, WORLD } from "./art";
import { cuesFor } from "./cues";
import { act, attackOf, defenseOf, groundAt, isState, maxHp, newGame, xpToNext, type Action, type Dir, type State } from "./engine";
import { ENEMIES, HEIGHT, WIDTH, type Entity, type NpcKind } from "./world";

// Journey Across Mereddia: a small single-player RPG. Walk the map with the pad (or the arrow keys or
// WASD), bump into things, win the fights. The rules are in engine.ts; this is only the screen. The
// game saves itself on this phone after every move.

const SAVE = "mereddia:save";

function load(): State {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE) ?? "null");
    if (isState(saved)) return saved;
  } catch {
    // No storage, or something that isn't ours: start fresh.
  }
  return newGame();
}

function save(s: State) {
  try {
    localStorage.setItem(SAVE, JSON.stringify(s));
  } catch {
    // Private windows can refuse; the game still plays.
  }
}

function Bar({ value, max, label, tone = "primary" }: { value: number; max: number; label: string; tone?: "primary" | "destructive" }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none", tone === "primary" ? "bg-primary" : "bg-destructive")} style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} />
    </div>
  );
}

function Stat({ icon, value, label }: { icon: string; value: ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5" aria-label={`${label}: ${value}`}>
      <Sprite name={icon} className="size-6" />
      <span className="font-display text-callout tabular-nums">{value}</span>
    </span>
  );
}

function Hud({ s }: { s: State }) {
  const top = maxHp(s.level);
  return (
    <section aria-label="Wilfred" className="rounded-lg bg-card p-3">
      <div className="flex items-center gap-3">
        <Sprite name={HEAD.hero} className="size-12 rounded-sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between">
            <span className="font-display text-heading">Wilfred · Lv {s.level}</span>
            <span className="text-footnote tabular-nums text-muted-foreground">
              {s.hp}/{top} HP
            </span>
          </div>
          <Bar value={s.hp} max={top} label="Health" />
          <div className="mt-1.5 flex items-center justify-between text-caption text-muted-foreground">
            <span>
              XP {s.xp}/{xpToNext(s.level)}
            </span>
            <span>
              Attack {attackOf(s)} · Defense {defenseOf(s.level)}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <Stat icon={ITEM.coin} value={s.gold} label="Gold" />
        <Stat icon={ITEM.potion} value={s.potions} label="Potions" />
        <Stat icon={ITEM.crystal} value={s.crystals} label="Crystals" />
        <Stat icon={ITEM.key} value={s.keys} label="Keys" />
        <Stat icon={ITEM.sword} value={s.sword ? "Yes" : "No"} label="Sword" />
      </div>
    </section>
  );
}

const cell = (n: number) => `${n * 100}%`;
const place = (x: number, y: number) => ({ left: cell(x / WIDTH), top: cell(y / HEIGHT), width: cell(1 / WIDTH), height: cell(1 / HEIGHT) });

function EntityView({ e }: { e: Entity }) {
  const size = "size-full p-[6%]";
  return (
    <div className="absolute" style={place(e.x, e.y)}>
      {e.kind === "chest" && <Chest open={e.done} className={size} />}
      {e.kind === "gate" && <Gate className={size} />}
      {e.kind === "npc" && <NpcArt npc={e.what as NpcKind} className={size} />}
      {e.kind === "enemy" && <EnemyArt kind={e.what} className={size} />}
    </div>
  );
}

function MapView({ s }: { s: State }) {
  return (
    <div role="img" aria-label={`Map of Mereddia. Wilfred is at column ${s.pos.x + 1}, row ${s.pos.y + 1}.`} className="relative w-full overflow-hidden rounded-lg" style={{ aspectRatio: `${WIDTH} / ${HEIGHT}`, background: WORLD.grass }}>
      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${WIDTH}, 1fr)`, gridTemplateRows: `repeat(${HEIGHT}, 1fr)` }}>
        {Array.from({ length: WIDTH * HEIGHT }, (_, i) => {
          const x = i % WIDTH;
          const y = Math.floor(i / WIDTH);
          const g = groundAt(x, y);
          const bg = g === "#" ? ((x + y) % 2 ? WORLD.wall : WORLD.wallLight) : g === "~" ? ((x + y) % 2 ? WORLD.water : WORLD.waterLight) : (x + y) % 2 ? WORLD.grass : WORLD.grassDark;
          return <div key={i} style={{ background: bg }} />;
        })}
      </div>
      {s.entities.map((e) => (
        <EntityView key={e.id} e={e} />
      ))}
      <div className="absolute transition-[left,top] duration-100 motion-reduce:transition-none" style={place(s.pos.x, s.pos.y)}>
        <Sprite name={HEAD.hero} className="size-full rounded-[2px] p-[4%] ring-2 ring-primary" label="Wilfred" />
      </div>
    </div>
  );
}

const PAD: { dir: Dir; Icon: typeof ArrowUpIcon; at: string }[] = [
  { dir: "up", Icon: ArrowUpIcon, at: "col-start-2 row-start-1" },
  { dir: "left", Icon: ArrowLeftIcon, at: "col-start-1 row-start-2" },
  { dir: "right", Icon: ArrowRightIcon, at: "col-start-3 row-start-2" },
  { dir: "down", Icon: ArrowDownIcon, at: "col-start-2 row-start-3" },
];

function Pad({ onMove }: { onMove: (d: Dir) => void }) {
  return (
    <div className="grid grid-cols-3 grid-rows-3 gap-1.5">
      {PAD.map(({ dir, Icon, at }) => (
        <Button key={dir} variant="secondary" aria-label={`Move ${dir}`} className={cn("size-14 rounded-lg", at)} onClick={() => onMove(dir)}>
          <Icon size={24} weight="bold" />
        </Button>
      ))}
    </div>
  );
}

function Log({ lines }: { lines: string[] }) {
  return (
    <div aria-live="polite" aria-label="Story so far" className="min-h-[104px] rounded-lg bg-card px-3 py-2.5 text-footnote">
      {lines.map((l, i) => (
        <p key={`${i}-${l}`} className={i === lines.length - 1 ? "text-foreground" : "text-muted-foreground"}>
          {l}
        </p>
      ))}
    </div>
  );
}

function BattleView({ s, dispatch }: { s: State; dispatch: (a: Action) => void }) {
  const b = s.battle!;
  const foe = ENEMIES[b.kind];
  return (
    <>
      <section aria-label={`Fighting ${foe.name}`} className="rounded-lg bg-card p-4">
        <div className="flex items-center gap-4">
          <EnemyArt kind={b.kind} className="size-24 shrink-0 rounded-sm bg-muted/60 p-2" />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-heading">{foe.name}</h2>
            <p className="mb-1.5 text-footnote tabular-nums text-muted-foreground">
              {Math.max(0, b.hp)}/{foe.hp} HP
            </p>
            <Bar value={b.hp} max={foe.hp} label={`${foe.name} health`} tone="destructive" />
          </div>
        </div>
      </section>
      <div className="grid grid-cols-2 gap-2.5">
        <Button size="xl" onClick={() => dispatch({ type: "attack" })}>
          <Sprite name={ITEM.sword} className="size-6" /> Attack
        </Button>
        <Button size="xl" variant="secondary" onClick={() => dispatch({ type: "guard" })}>
          <Sprite name={ITEM.shield} className="size-6" /> Guard
        </Button>
        <Button size="xl" variant="secondary" disabled={s.crystals === 0} onClick={() => dispatch({ type: "crystal" })}>
          <Sprite name={ITEM.crystal} className="size-6" /> Crystal ({s.crystals})
        </Button>
        <Button size="xl" variant="secondary" disabled={s.potions === 0 || s.hp >= maxHp(s.level)} onClick={() => dispatch({ type: "potion" })}>
          <Sprite name={ITEM.potion} className="size-6" /> Potion ({s.potions})
        </Button>
        <Button size="xl" variant="ghost" className="col-span-2" disabled={foe.boss} onClick={() => dispatch({ type: "flee" })}>
          <PersonSimpleRunIcon weight="bold" /> {foe.boss ? "No escape" : "Run"}
        </Button>
      </div>
    </>
  );
}

function DialogueView({ s, dispatch }: { s: State; dispatch: (a: Action) => void }) {
  const d = s.dialogue!;
  const last = d.i === d.lines.length - 1;
  return (
    <>
      <section aria-label={`${d.speaker} speaking`} className="flex items-start gap-3 rounded-lg bg-card p-4">
        <NpcArt npc={d.sprite} className="size-16 shrink-0 rounded-sm" />
        <div className="min-w-0">
          <h2 className="font-display text-heading">{d.speaker}</h2>
          <p className="text-body">{d.lines[d.i]}</p>
        </div>
      </section>
      <Button size="xl" onClick={() => dispatch({ type: "next" })}>
        {last ? "Done" : "Next"}
      </Button>
    </>
  );
}

function Ending({ s, onRestart }: { s: State; onRestart: () => void }) {
  const won = s.mode === "won";
  return (
    <>
      <section aria-label={won ? "Victory" : "Defeat"} className="rounded-lg bg-card p-5 text-center">
        <Sprite name={won ? HEAD.hero : HEAD.mallakoth} className="mx-auto mb-3 size-24 rounded-sm" />
        <h2 className="font-display text-title">{won ? "Mereddia is free" : "Defeated"}</h2>
        <p className="mt-1 text-callout text-muted-foreground">
          {won ? `Level ${s.level}, in ${s.steps} steps.` : "Mallakoth's shadow grows. Try again, a little stronger."}
        </p>
      </section>
      <Button size="xl" onClick={onRestart}>
        <ArrowCounterClockwiseIcon weight="bold" /> {won ? "Play again" : "Try again"}
      </Button>
    </>
  );
}

const KEYS: Record<string, Action> = {
  ArrowUp: { type: "move", dir: "up" },
  ArrowDown: { type: "move", dir: "down" },
  ArrowLeft: { type: "move", dir: "left" },
  ArrowRight: { type: "move", dir: "right" },
  w: { type: "move", dir: "up" },
  s: { type: "move", dir: "down" },
  a: { type: "move", dir: "left" },
  d: { type: "move", dir: "right" },
  " ": { type: "next" },
  Enter: { type: "next" },
  p: { type: "potion" },
};

function useCues() {
  const { sfx } = useSoundSettings();
  const on = useRef(true);
  on.current = sfx !== "off";
  return useCallback((prev: State, next: State) => {
    if (!on.current) return;
    for (const { name, delay } of cuesFor(prev, next)) {
      setTimeout(() => {
        const a = new Audio(`/mereddia/sfx/${name}.wav`);
        a.volume = 0.5;
        a.play().catch(() => {});
      }, delay);
    }
  }, []);
}

export function MereddiaGame() {
  const [state, setState] = useState<State>(load);
  const latest = useRef(state);
  const cues = useCues();

  const dispatch = useCallback(
    (a: Action) => {
      const prev = latest.current;
      const next = act(prev, a);
      if (next === prev || JSON.stringify(next) === JSON.stringify(prev)) return;
      latest.current = next;
      setState(next);
      save(next);
      cues(prev, next);
    },
    [cues],
  );

  const restart = useCallback(() => {
    const fresh = newGame();
    latest.current = fresh;
    setState(fresh);
    save(fresh);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement | null)?.closest("button, input, textarea, [role=dialog]")) return;
      const a = KEYS[e.key];
      const battleKey = latest.current.mode === "battle" ? ({ "1": "attack", "2": "guard", "3": "crystal", "4": "potion", "5": "flee" } as const)[e.key as "1"] : undefined;
      const action: Action | undefined = battleKey ? { type: battleKey } : a;
      if (!action) return;
      e.preventDefault();
      dispatch(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);

  const s = state;
  return (
    <div className="flex flex-col gap-3">
      <NavBar
        title="Journey Across Mereddia"
        back="/games"
        action={
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Start over">
                <ArrowCounterClockwiseIcon size={22} weight="bold" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Start over?</AlertDialogTitle>
                <AlertDialogDescription>Your journey so far is erased.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep playing</AlertDialogCancel>
                <AlertDialogAction onClick={restart}>Start over</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        }
      />
      <Hud s={s} />
      {s.mode === "battle" ? (
        <BattleView s={s} dispatch={dispatch} />
      ) : s.mode === "dialogue" ? (
        <DialogueView s={s} dispatch={dispatch} />
      ) : s.mode === "won" || s.mode === "lost" ? (
        <Ending s={s} onRestart={restart} />
      ) : (
        <>
          <MapView s={s} />
          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="flex flex-col gap-2.5">
              <Button variant="secondary" size="lg" disabled={s.potions === 0 || s.hp >= maxHp(s.level)} onClick={() => dispatch({ type: "potion" })}>
                <Sprite name={ITEM.potion} className="size-6" /> Potion ({s.potions})
              </Button>
            </div>
            <Pad onMove={(dir) => dispatch({ type: "move", dir })} />
          </div>
        </>
      )}
      <Log lines={s.log} />
    </div>
  );
}
