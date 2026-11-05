import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CaretLeftIcon,
  CheckCircleIcon,
  CircleIcon,
  HourglassIcon,
  LightningIcon,
  PersonSimpleRunIcon,
  PersonSimpleThrowIcon,
  ShieldChevronIcon,
  SwordIcon,
  WarningIcon,
  ScrollIcon,
  SparkleIcon,
  TreeIcon,
  CubeIcon,
} from "@phosphor-icons/react";
import { useGoBack } from "@/components/AppHeader";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
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
import { useSoundSettings, wantMusic } from "@/sound";
import { cn } from "@/lib/utils";
import { Crystal, ELEMENT_NAME, EntityArt, HEAD, ITEM, NpcArt, Pickaxe, RockShadow, Boulder, Ricky, Sprite, TrailTile, WORLD, WeaponIcon } from "./art";
import * as audio from "./audio";
import { cuesFor, loopsFor } from "./cues";
import { MiniMap, resetSeen } from "./MiniMap";
import { CUTSCENES, type Aim, type Step } from "./cutscenes";
import { act, attackOf, boulderTile, COMBO_MAX, DODGE_COST, type Intent, defenseOf, groundAt, isState, maxHp, maxMana, newGame, potionCap, slimesLeft, STAMINA_MAX, xpToNext, type Action, type Dir, type State } from "./engine";
import { NAMES, NODES, type Who } from "./story";
import { ELEMENT_COLOR } from "./art";
import type { EffectWant, Stage } from "./three/stage";
import { AREAS, ELEMENTS, bound, isIndoor, zoneAt, ENEMIES, QUESTS, SPELLS, WEAPONS, SPECIAL_MAX, sizeOf, type EnemyKind } from "./world";

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

function Bar({ value, max, label, tone = "primary" }: { value: number; max: number; label: string; tone?: "primary" | "destructive" | "mana" | "stamina" }) {
  const color = { primary: "bg-primary", destructive: "bg-destructive", mana: "bg-sky-500", stamina: "bg-amber-500" }[tone];
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none", color)} style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} />
    </div>
  );
}

function Stat({ icon, value, label }: { icon: ReactNode; value: ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5" aria-label={`${label}: ${value}`}>
      {icon}
      <span className="font-display text-callout tabular-nums">{value}</span>
    </span>
  );
}

function Hud({ s, dispatch }: { s: State; dispatch: (a: Action) => void }) {
  const top = maxHp(s.level);
  return (
    <section aria-label="Mallakoth" className="rounded-lg bg-card p-2 md:p-3 landscape:p-2">
      <div className="flex items-center gap-3">
        <Sprite name={HEAD.mallakoth!} className="size-10 shrink-0 rounded-sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between">
            <span className="font-display text-heading">Mallakoth · Lv {s.level}</span>
            <span className="text-footnote tabular-nums text-muted-foreground">
              {s.hp}/{top} HP
            </span>
          </div>
          <Bar value={s.hp} max={top} label="Health" />
          <div className="mt-1 flex items-baseline justify-between text-caption text-muted-foreground">
            <span className="tabular-nums">
              {s.mana}/{maxMana(s)} MP
            </span>
            <span>
              XP {s.xp}/{xpToNext(s.level)} · Attack {attackOf(s)} · Defense {defenseOf(s)}
            </span>
          </div>
          <Bar value={s.mana} max={maxMana(s)} label="Mana" tone="mana" />
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Stat icon={<Sprite name={ITEM.coin} className="size-5" />} value={s.gold} label="Gold" />
        <Stat icon={<Sprite name={ITEM.potion} className="size-5" />} value={`${s.potions}/${potionCap(s)}`} label="Potions" />
        <Stat icon={<Sprite name={ITEM.key} className="size-5" />} value={s.keys} label="Keys" />
        {(s.wood ?? 0) > 0 && <Stat icon={<TreeIcon size={20} weight="fill" />} value={s.wood ?? 0} label="Wood" />}
        {(s.stone ?? 0) > 0 && <Stat icon={<CubeIcon size={20} weight="fill" />} value={s.stone ?? 0} label="Stone" />}
        {s.items.pickaxe && <Stat icon={<Pickaxe className="size-5" />} value="Pickaxe" label="Item" />}
        {s.shield && <Stat icon={<Sprite name={ITEM.shield} className="size-5" />} value="Shield" label="Shield" />}
        {s.items.prismGel && <Stat icon={<Crystal el="universal" className="size-5" />} value="Prism Gel" label="Item" />}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {s.weapons.length > 1 ? (
          s.weapons.map((w) => (
            <Button key={w} size="sm" variant={s.weapon === w ? "default" : "secondary"} disabled={s.mode !== "explore"} aria-label={`Equip ${WEAPONS[w].name}`} aria-pressed={s.weapon === w} onClick={() => dispatch({ type: "equip", weapon: w })}>
              <WeaponIcon id={w} className="size-5" /> {WEAPONS[w].name}
            </Button>
          ))
        ) : (
          <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
            <WeaponIcon id={s.weapon} className="size-5" /> {WEAPONS[s.weapon].name}
          </span>
        )}
        {s.poisoned && <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-caption text-destructive">Poisoned · no regeneration</span>}
        {s.companion && <span className="rounded-full bg-muted px-2 py-0.5 text-caption">Ricky the Chest</span>}
        {s.flags.blade && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-caption tabular-nums" aria-label={`Flame Strike charge ${s.special} of ${SPECIAL_MAX}`}>
            Flame {s.special}/{SPECIAL_MAX}
          </span>
        )}
      </div>
    </section>
  );
}

const cell = (n: number) => `${n * 100}%`;

function MapView({ s }: { s: State }) {
  const { width: W, height: H } = sizeOf(s.area);
  const def = AREAS[s.area];
  const pal = WORLD[def.theme];
  const place = (x: number, y: number) => ({ left: cell(x / W), top: cell(y / H), width: cell(1 / W), height: cell(1 / H) });
  const boulder = boulderTile(s);
  const ents = s.entities.filter((e) => e.area === s.area && !(e.kind === "panel" && e.open));
  return (
    <div role="img" aria-label={`${def.name}. Mallakoth is at column ${s.pos.x + 1}, row ${s.pos.y + 1}.`} className="relative w-full overflow-hidden rounded-lg" style={{ aspectRatio: `${W} / ${H}`, background: pal.floor }}>
      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${W}, 1fr)`, gridTemplateRows: `repeat(${H}, 1fr)` }}>
        {Array.from({ length: W * H }, (_, i) => {
          const x = i % W;
          const y = Math.floor(i / W);
          const g = groundAt(s, x, y);
          const alt = (x + y) % 2 === 1;
          const bg = g === "#" ? (alt ? pal.wall : pal.wallAlt) : g === "~" ? (alt ? pal.water : pal.waterAlt) : g === "=" ? "#a9825a" : g === "w" ? "#bfe3f5" : g === "s" ? "#7fd0e8" : alt ? pal.floor : pal.floorAlt;
          return <div key={i} style={{ background: bg }} />;
        })}
      </div>
      {s.trails
        .filter((t) => t.area === s.area)
        .map((t) => (
          <div key={`${t.x},${t.y}`} className="pointer-events-none absolute" style={place(t.x, t.y)}>
            <TrailTile el={t.el} />
          </div>
        ))}
      {ents.map((e) => (
        <div key={e.id} className="absolute" style={place(e.x, e.y)}>
          <EntityArt e={e} className={cn("size-full", e.kind === "exit" ? "p-[18%]" : e.kind === "panel" || e.kind === "button" ? "" : "p-[6%]")} />
        </div>
      ))}
      {s.hazards.map((h) => (
        <div key={`${h.x},${h.y}`} className="pointer-events-none absolute" style={place(h.x, h.y)}>
          <RockShadow fuse={h.fuse} className="size-full p-[6%]" />
        </div>
      ))}
      {boulder && (
        <div className="pointer-events-none absolute" style={place(boulder.x, boulder.y)}>
          <Boulder className="size-full scale-125" />
        </div>
      )}
      {s.ricky && s.companion && !def.indoor && (
        <div className="absolute transition-[left,top] duration-150 motion-reduce:transition-none" style={place(s.ricky.x, s.ricky.y)}>
          <Ricky className="size-full p-[10%]" />
        </div>
      )}
      <div className="absolute transition-[left,top] duration-100 motion-reduce:transition-none" style={place(s.pos.x, s.pos.y)}>
        <Sprite name={HEAD.mallakoth!} className="size-full rounded-[2px] p-[4%] ring-2 ring-primary" label="Mallakoth" />
      </div>
    </div>
  );
}


// The same map as MapView, but as the project's own 3D scene: its tiles, its lighting, its voxel models.
// Everything that moves is drawn from the game state; the stage only animates between states.
type Cast = { model?: { kind: "characters" | "objects"; name: string }; x?: number; y?: number; h?: number; face?: number; scale?: number; shot?: { name: string; n: number }; glide?: number; hidden?: boolean };
type Over = { bars: boolean; fade: number; fadeMs: number; title: string };
const CLEAR: Over = { bars: false, fade: 0, fadeMs: 0, title: "" };
// The people of the sanctum in the Finale: Wilfred and Vastios at the altar, Drawf kneeling beside Mallakoth.
const FINALE_CAST: { who: string; name: string; x: number; y: number; rotY: number; anim?: string }[] = [
  { who: "wilfred", name: "Wilfred_tuah", x: 21, y: 8, rotY: 0 },
  { who: "vastios", name: "Vastios_Threea", x: 22, y: 8, rotY: 0 },
  { who: "drawf", name: "Drawf_move2", x: 21, y: 10, rotY: Math.PI, anim: "kneel" },
];

// The usual view, unless the area says otherwise.
// Over the shoulder: close, low, and off to the right of Mallakoth.
const DEF_PITCH = 0.6;
const DEF_DIST = 5.6;

function MapView3D({ s, scene, onDone }: { s: State; scene?: { id: string; n: number }; onDone?: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Stage | null>(null);
  const [ready, setReady] = useState(false);
  const latest = useRef(s);
  latest.current = s;
  const primed = useRef(false);
  const lastTreeHp = useRef<number | undefined>(undefined);
  const def = AREAS[s.area];
  const m3 = def.map3d!;

  const cast = useRef<Record<string, Cast>>({});
  const doorsOpen = useRef<Set<string> | undefined>(undefined);
  const doorsArea = useRef<string | undefined>(undefined);
  const slabSeen = useRef(new Map<string, number>());
  const opening = useRef(new Set<string>());
  const [over, setOver] = useState<Over>(CLEAR);
  const skip = useRef<() => void>(() => {});

  const apply = useCallback(async () => {
    const st = stage.current;
    if (!st) return;
    const { desired, world, ROT, CHARACTER_SCALE } = await import("./three/bind");
    const cur = latest.current;
    const d = AREAS[cur.area].map3d!;
    const list = desired(cur.entities.filter((e) => e.area === cur.area && !(e.kind === "panel" && e.open)), d.x0, d.y0);
    // The golem turns to face whoever it is fighting.
    if (cur.flags.golemAwake && !cur.flags.golemDown) for (const l of list) if (l.name === "Golem") {
      const at = cur.entities.find((e) => e.id === l.key);
      if (at) l.rotY = Math.atan2(cur.pos.x - at.x, cur.pos.y - at.y);
    }
    // Once the golem has woken it stands and walks with its eyes open: the project's second idle and walk (the first pair are the sleeper's, eyes shut).
    if (cur.flags.golemAwake && !cur.flags.golemDown) for (const l of list) if (l.name === "Golem") Object.assign(l, { restAnim: "idle2", moveAnim: "walk2" });
    list.push({
      key: "hero",
      kind: "characters",
      name: "Mallakoth_red_2",
      ...world(cur.pos.x, cur.pos.y, d.x0, d.y0),
      // Mallakoth's model faces north at rest, the other way round from everyone else's.
      rotY: ROT[cur.facing] + Math.PI,
      scale: CHARACTER_SCALE,
      // Wading in the spring: down in the water to the knees, not standing on top of it.
      ...(groundAt(cur, cur.pos.x, cur.pos.y) === "s" ? { y: -0.5 } : {}),
      ...(cur.sprinting ? { moveAnim: "sprint" } : {}),
      ...(cur.area === "finale" ? { anim: "kneel", rotY: 0 } : {}),
      ...(cur.act ? { shot: cur.act } : {}),
    });
    if (cur.area === "finale") for (const c of FINALE_CAST) list.push({ key: `cast:${c.who}`, kind: "characters", name: c.name, ...world(c.x, c.y, d.x0, d.y0), rotY: c.rotY, scale: CHARACTER_SCALE, ...(c.anim ? { anim: c.anim } : {}) });
    if (cur.ricky && cur.companion && !AREAS[cur.area].indoor) list.push({ key: "ricky", kind: "characters", name: "rikycharacter1", ...world(cur.ricky.x, cur.ricky.y, d.x0, d.y0), rotY: 0, scale: CHARACTER_SCALE });
    // The pigeon: on the old tree's branch until it's felled, then on Mallakoth's head if it chose to stay.
    const tree = cur.entities.find((e) => e.area === cur.area && e.kind === "prop" && e.what === "tree");
    // The four flame pillars the golem's waking lights (the project puts them on the tiles named torch1 to torch4) stay for the whole fight, and
    // once the golem is down the project switches them to their second animation, the sacred flame.
    if (cur.area === "caves" && cur.flags.golemAwake) for (const [x, y] of [[18, 53], [10, 53], [18, 47], [10, 47]]) list.push({ key: `pillar${x},${y}`, kind: "objects", name: "torch_lamp", ...world(x, y, d.x0, d.y0), y: 0.05, rotY: 0, scale: 1.4, anim: cur.flags.golemDown ? "default2" : "default" });
    // The golem's rocks, seen coming: each red square has a rock above it that comes down as its fuse runs out.
    for (const h of cur.hazards) list.push({ key: `fall:${h.x},${h.y}`, kind: "objects", name: "boulder", ...world(h.x, h.y, d.x0, d.y0), y: 0.3 + h.fuse * 1.5, rotY: (h.x * 1.7 + h.y) % 6, scale: 0.7, anim: "idle" });
    const boulder = boulderTile(cur);
    if (boulder) list.push({ key: "boulder", kind: "characters", name: "Boulder", ...world(boulder.x, boulder.y, d.x0, d.y0), rotY: 0, scale: 3.2, xray: true, anim: cur.boulder ? "walk" : "idle" });
    // The slabs that close behind you or around you are cave stone, the project's own wall pieces, three high and two cells wide, and they
    // crash down into place. (Only a temple's own seals are temple stone.)
    for (const id of [...slabSeen.current.keys()]) if (!cur.entities.some((e) => e.id === id && !e.open)) slabSeen.current.delete(id);
    for (const e of cur.entities) {
      if (e.area !== cur.area || e.kind !== "panel" || !e.what.startsWith("slab") || e.open) continue;
      const wall = cur.area === "caves";
      // A slab only drops once you are past its tile, so it never looks as if it came down on you (or, if you linger, after a moment).
      if (wall) {
        const first = slabSeen.current.get(e.id) ?? Date.now();
        if (!slabSeen.current.has(e.id)) {
          slabSeen.current.set(e.id, first);
          setTimeout(() => void apply(), 1600);
        }
        const past = Math.abs(cur.pos.x - e.x) >= 2 || Math.abs(cur.pos.y - e.y) >= 2;
        if (!past && Date.now() - first < 1500) continue;
      }
      const second = wall && AREAS.caves.seals?.[e.what.slice(5)]?.findIndex((c) => c.x === e.x && c.y === e.y) === 1;
      const pieces = wall
        ? e.what === "slab:boulder"
          ? second
            ? ["cave_walls_door_2", "cave_wall_door_4", "cave_walls_door_6"]
            : ["calls_walls_door1", "cave_wall_door_3", "cave_wall_door_5"]
          : second
            ? ["knowledge_exit_2", "knowledge_exit_4", "knowledge_exit_6"]
            : ["knowledge_exit_1", "knowledge_exit_3", "knowledge_exit_5"]
        : ["stone_wall_5"];
      pieces.forEach((name, i) =>
        list.push({ key: `${e.id}:${i}`, kind: wall && e.what === "slab:boulder" ? "tiles" : "objects", name, ...world(e.x, e.y, d.x0, d.y0), y: wall ? 0.05 + i * 0.8 : 0, rotY: 0, scale: 1, ...(wall ? { anim: "shut", drop: 4 } : {}) }),
      );
    }
    // It is in its tree from the moment it has delivered the letter (the intro scene flies it there first).
    if (cur.flags.intro && cur.area === "field" && !(cur.cut?.id === "intro" && !cast.current.pigeon)) {
      if (tree) {
        // On the right-hand branch as you come up to the tree from the north (east of the trunk), in close to the trunk. The tree
        // is placed on a cell but its middle is half a tile (0.4) south-east of it, and it is drawn 1.5 times life size, so that
        // branch at model x 0.4 comes out 0.6 east of the middle with its top at 1.3. The pigeon has its feet gone and its body
        // 1.8 above its origin at this scale, so it sits right on the wood, facing north (towards the player's side of it).
        const w = world(tree.x, tree.y, d.x0, d.y0);
        list.push({ key: "pigeon", kind: "characters", name: "Pigeon", x: w.x + 0.4 + 0.6, z: w.z + 0.4, y: 1.3 - 1.8 * 0.7 - 0.1, rotY: Math.PI, scale: 0.7, anim: "idle" });
      }
    }
    // A cutscene moves some of them about: by the key of whoever it names, or a new face it brings in.
    const keyOf = (who: string) => (who === "hero" || who === "pigeon" || who === "robes" ? who : list.find((l) => l.key === `cast:${who}`)?.key ?? cur.entities.find((e) => e.area === cur.area && e.what === who)?.id ?? who);
    const made: typeof list = [];
    for (const [who, c] of Object.entries(cast.current)) {
      const key = keyOf(who);
      const at = list.findIndex((l) => l.key === key);
      if (c.hidden) {
        if (at >= 0) list.splice(at, 1);
        continue;
      }
      const w = c.x !== undefined && c.y !== undefined ? world(c.x, c.y, d.x0, d.y0) : undefined;
      const patch = { ...(w ?? {}), ...(c.h !== undefined ? { y: c.h } : {}), ...(c.face !== undefined ? { rotY: c.face + (key === "hero" ? Math.PI : 0) } : {}), ...(c.scale !== undefined ? { scale: c.scale } : {}), ...(c.shot ? { shot: c.shot } : {}), glide: c.glide };
      if (at >= 0) Object.assign(list[at], patch);
      else if (c.model && w) made.push({ key, ...c.model, x: w.x, z: w.z, rotY: 0, scale: 1, ...patch, ...(who === "pigeon" ? { anim: "walk" } : {}) } as (typeof list)[number]);
    }
    list.push(...made);
    const ahead = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[cur.facing];
    st.lead.set(ahead[0] * 0.9, 0, ahead[1] * 0.9);
    st.sync(list, "hero");
    // Scenery the rules have taken over or removed: people, enemies, a felled tree, a sword in a statue's hands.
    const hide = new Set<string>();
    // A door that has opened (a panel the rules mark open) is gone from the scene too, with all the pieces it is built from.
    const present = new Set(cur.entities.filter((e) => !(e.kind === "panel" && e.open)).map((e) => e.id));
    // Something taken away as you watch (a door that opens, a pot smashed, the gate unlocked) plays its own animation first, and goes a moment
    // later. (Coming into an area to find it already gone just finds it gone.)
    const before = doorsArea.current === cur.area ? doorsOpen.current : undefined;
    doorsArea.current = cur.area;
    doorsOpen.current = present;
    if (before) {
      for (const b of bound(cur.area)) {
        if (b.dynamic || present.has(b.id) || !before.has(b.id)) continue;
        const how = b.src.includes("pot@") ? { anim: "break", ms: 650, wait: 380 } : b.src.includes("Locked_door@") ? { anim: "open_door", ms: 1300 } : b.src.includes("knowledge_exit") ? { anim: "open", ms: 1500, ...(cur.cut?.id === "golemdoor" ? { wait: 3900 } : {}) } : undefined;
        if (!how) continue;
        const keys = b.src.split("|");
        // (A pot goes to pieces as the foot lands, a moment into the kick.)
        if (how.wait) setTimeout(() => st.playScenery(keys, how.anim), how.wait);
        else st.playScenery(keys, how.anim);
        for (const k of keys) opening.current.add(k);
        setTimeout(() => {
          for (const k of keys) opening.current.delete(k);
          void apply();
        }, how.ms + (how.wait ?? 0));
      }
    }
    // A bound cell can be several pieces of scenery, "a|b|c".
    for (const b of bound(cur.area)) if (b.dynamic || !present.has(b.id)) for (const k of b.src.split("|")) if (!opening.current.has(k)) hide.add(k);
    // The rock the pickaxe was in crumbles to rubble once it has been struck down.
    if (cur.area === "caves" && cur.items.pickaxe && !cur.entities.some((e) => e.what === "rock" || e.what === "pickrock")) st.playScenery(["boulder@-3,8"], "break");
    // The plate he stands on sinks.
    st.setPressed(`Pressure_plate@${cur.pos.x + d.x0},${cur.pos.y + d.y0}`);
    if (cur.area === "finale") for (const k of ["Wilfred_tuah@-3,-18", "Vastios_Threea@-2,-18", "Secret Master@-22,-13", "rikycharcter2@-3,-26", "rikycharacter1@-19,-9"]) hide.add(k);
    // The pigeon the map hovers over the start is the intro scene's; the rules draw it after that, on its branch.
    if (cur.area === "field") hide.add("Pigeon@7,-13");
    // The old tree shows what has been done to it: a notch per chop, and a shudder as each lands.
    const oldTree = cur.area === "field" ? cur.entities.find((e) => e.area === "field" && e.kind === "prop" && e.what === "tree") : undefined;
    if (oldTree) {
      const hp = oldTree.hp ?? 3;
      const w = world(oldTree.x, oldTree.y, d.x0, d.y0);
      // The trunk's south face: 0.4 south-east of the cell's middle to the tree's middle, then 0.39 out to the bark.
      st.setDamage("tree", w.x + 0.4 + 0.04, w.z + 0.4 + 0.39, 3 - hp);
      if (primed.current && lastTreeHp.current !== undefined && hp < lastTreeHp.current) st.shudder("tree_me@7,6");
      lastTreeHp.current = hp;
    } else {
      st.setDamage("tree", 0, 0, 0);
      lastTreeHp.current = undefined;
    }
    if (cur.flags.blade) hide.add("sword@-1,-8");
    if (cur.items.axe) hide.add("axe@-2,-1");
    // The boulder is drawn from the rules, wherever it is; the one the map placed always goes.
    hide.add("Boulder@-29,6");
    if (cur.companion) hide.add("rikycharacter1@-19,-9");
    st.setHidden(hide);
    // The spikes rise as the trap's timer runs out, and stay up once it has done its work.
    if (cur.area === "spikes") st.setTileFrame("wooden_floor_with_trap", cur.mode === "lost" ? 1 : cur.spike ? 1 - cur.spike.left / cur.spike.total : 0);
    // Effects: poison smoke in the plate room, torches around the waking golem, the sacred flame, rain.
    const fx: EffectWant[] = [];
    if (cur.area === "caves" && cur.poisoned) for (const x of [33, 35, 37, 39]) for (const y of [8.6, 10.6]) fx.push({ key: `poison${x},${y}`, name: "poison_smoke", ...world(x, y, d.x0, d.y0), y: 0.7, size: 2.4 });
    if (cur.area === "temple" || cur.area === "finale") fx.push({ key: "sacredflame", name: "fire", ...world(21, 6.7, d.x0, d.y0), y: 1.05, tint: [0.7, 0.35, 1], size: 1.8 });
    if (cur.flags.rainy && cur.area === "field") fx.push({ key: "rain", name: "Rain", ...world(cur.pos.x, cur.pos.y, d.x0, d.y0), y: 5, size: 2.2 });
    st.setEffects(fx);
    for (const f of cur.fx ?? []) {
      const key = `fx${f.n}`;
      if (!primed.current) st.ignore(key);
      else if (f.area === cur.area) st.burst({ key, name: f.name, ...world(f.x, f.y, d.x0, d.y0), y: f.name === "smoke" ? 0.5 : 0.1, duration: { Ground: 0.7, smoke: 2.4 }[f.name] ?? 1.8, size: f.name === "Ground" ? 2 : 1.3 });
    }
    primed.current = true;
    st.setIndoors(isIndoor(cur.area, cur.pos.x, cur.pos.y));
    const treeTile = cur.area === "slimes" && cur.flags.treeHint ? cur.entities.find((e) => e.area === "slimes" && e.kind === "exit" && e.what === "treehouse") : undefined;
    // On the spiked floor the tile to run for is lit green, the way out.
    const spikeExit = cur.area === "spikes" ? cur.entities.find((e) => e.area === "spikes" && e.kind === "exit") : undefined;
    st.setMarkers([
      ...(spikeExit ? [{ ...world(spikeExit.x, spikeExit.y, d.x0, d.y0), color: "#5dff8a", opacity: 0.75 }] : []),
      ...(treeTile ? [{ ...world(treeTile.x, treeTile.y, d.x0, d.y0), color: "#c78cff", opacity: 0.7 }] : []),
      ...cur.trails.filter((t) => t.area === cur.area).map((t) => ({ ...world(t.x, t.y, d.x0, d.y0), color: ELEMENT_COLOR[t.el], opacity: 0.55 })),
      ...cur.hazards.map((h) => ({ ...world(h.x, h.y, d.x0, d.y0), color: "#d9334a", opacity: h.fuse <= 1 ? 0.8 : 0.45 })),
    ]);
  }, []);

  useEffect(() => {
    let alive = true;
    let made: Stage | null = null;
    setReady(false);
    (async () => {
      const { Stage } = await import("./three/stage");
      if (!alive || !canvas.current) return;
      made = new Stage(canvas.current);
      stage.current = made;
      made.pitch = m3.pitch ?? DEF_PITCH;
      if (m3.pitch === undefined) {
        made.camera.fov = 52;
        made.camera.updateProjectionMatrix();
        made.shoulder = 0;
        // Behind him, wherever he faces.
        made.followYaw = true;
      }
      made.distance = m3.distance ?? DEF_DIST;
      made.summer = !!m3.summer;
      await made.loadMap(m3.name, m3.mountains, m3.cutZ);
      if (!alive) return;
      await apply();
      const { world } = await import("./three/bind");
      const p = world(latest.current.pos.x, latest.current.pos.y, m3.x0, m3.y0);
      made.focus.set(p.x, 0, p.z);
      made.start();
      setReady(true);
    })();
    return () => {
      alive = false;
      stage.current = null;
      made?.dispose();
    };
  }, [m3.name, m3.x0, m3.y0, m3.mountains, m3.cutZ, apply]);

  useEffect(() => {
    void apply();
  }, [s, apply]);

  // The scene itself: each step in turn, with the game paused underneath.
  useEffect(() => {
    if (!scene || !ready) return;
    const steps = CUTSCENES[scene.id];
    if (!steps) {
      onDone?.();
      return;
    }
    let live = true;
    let skipping = false;
    let wake: (() => void) | undefined;
    let shots = 1000 * scene.n;
    const sleep = (ms: number) =>
      skipping || ms <= 0
        ? Promise.resolve()
        : new Promise<void>((r) => {
            const h = setTimeout(r, ms);
            wake = () => {
              clearTimeout(h);
              r();
            };
          });
    skip.current = () => {
      skipping = true;
      wake?.();
    };
    cast.current = {};
    stage.current?.setCinema(true);
    void (async () => {
      const st = stage.current;
      const { world } = await import("./three/bind");
      const base = { dist: m3.distance ?? DEF_DIST, pitch: m3.pitch ?? DEF_PITCH };
      const grid = (p: { x: number; y: number }) => world(p.x, p.y, m3.x0, m3.y0);
      // Where to look: a cell, or somebody, followed if they are on stage.
      const aim = (a: Aim): { key?: string; x: number; z: number } => {
        if (typeof a !== "string") return grid(a);
        const c = latest.current;
        const e = c.entities.find((o) => o.area === c.area && o.what === a);
        const key = a === "hero" || a === "pigeon" || a === "boulder" ? a : e?.id;
        const spot = a === "hero" ? c.pos : (e ?? (cast.current[a]?.x !== undefined ? { x: cast.current[a].x!, y: cast.current[a].y! } : c.pos));
        return { key: key && st?.positionOf(key) ? key : undefined, ...grid(spot) };
      };
      await sleep(350);
      let k = 0;
      for (const step of steps as Step[]) {
        if (!live) return;
        k++;
        switch (step.do) {
          case "bars":
            setOver((o) => ({ ...o, bars: step.on }));
            break;
          case "fade":
            setOver((o) => ({ ...o, fade: step.to, fadeMs: skipping ? 0 : step.ms }));
            await sleep(step.ms);
            break;
          case "title":
            setOver((o) => ({ ...o, title: step.text }));
            await sleep(step.ms);
            setOver((o) => ({ ...o, title: "" }));
            break;
          case "wait":
            await sleep(step.ms);
            break;
          case "sfx":
            if (!skipping) audio.play(step.name);
            break;
          case "fx":
            if (!skipping) {
              const p = aim(step.at);
              st?.burst({ key: `sc${scene.n}-${k}`, name: step.name, x: p.x, z: p.z + (step.toward ?? 0), y: step.y ?? 0.1, ...(step.hand ? { hand: "hero" } : {}), tint: step.tint, size: step.size ?? 1.3, duration: step.secs ?? 1.8 });
            }
            break;
          case "cam": {
            if (skipping) break;
            st?.moveCamera(aim(step.at), step.dist ?? base.dist, step.pitch ?? base.pitch, step.ms / 1000, step.shake ?? 0);
            if (step.wait !== false) await sleep(step.ms);
            break;
          }
          case "actor": {
            const c: Cast = { ...cast.current[step.who] };
            if (step.model) c.model = step.model;
            if (step.at) {
              c.x = step.at.x;
              c.y = step.at.y;
              c.glide = skipping ? 0 : (step.ms ?? 0) / 1000;
            }
            if (step.y !== undefined) c.h = step.y;
            if (step.face !== undefined) c.face = (step.face * Math.PI) / 180;
            if (step.scale !== undefined) c.scale = step.scale;
            if (step.shot && !skipping) c.shot = { name: step.shot, n: ++shots };
            if (step.hide) c.hidden = true;
            else if (step.at || step.model) c.hidden = false;
            cast.current[step.who] = c;
            await apply();
            if (step.wait !== false) await sleep(step.ms ?? 0);
            break;
          }
        }
      }
      if (!live) return;
      cast.current = {};
      st?.releaseCamera(base.dist, base.pitch);
      setOver(CLEAR);
      await apply();
      onDone?.();
    })();
    return () => {
      live = false;
      skip.current = () => {};
      stage.current?.setCinema(false);
      cast.current = {};
      stage.current?.releaseCamera(m3.distance ?? DEF_DIST, m3.pitch ?? DEF_PITCH);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.id, scene?.n, ready]);

  return (
    <div role="img" aria-label={`${def.name}. Mallakoth is at column ${s.pos.x + 1}, row ${s.pos.y + 1}.`} className="relative size-full overflow-hidden bg-muted">
      <canvas ref={canvas} className="block size-full" />
      {!ready && <div className="absolute inset-0 grid place-items-center text-footnote text-muted-foreground">Loading the world…</div>}
      {!scene && <MiniMap s={s} />}
      {scene && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 bg-black transition-[height] duration-700 motion-reduce:transition-none" style={{ height: over.bars ? "12%" : 0 }} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black transition-[height] duration-700 motion-reduce:transition-none" style={{ height: over.bars ? "12%" : 0 }} />
          <div className="pointer-events-none absolute inset-0 bg-black transition-opacity motion-reduce:transition-none" style={{ opacity: ready ? over.fade : 1, transitionDuration: `${over.fadeMs}ms` }} />
          {over.title && <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center font-display text-heading text-white">{over.title}</div>}
          <Button size="sm" variant="secondary" className="absolute right-2 bottom-2" onClick={() => skip.current()}>
            Skip
          </Button>
        </>
      )}
    </div>
  );
}

const PAD: { dir: Dir; Icon: typeof ArrowUpIcon; at: string }[] = [
  { dir: "up", Icon: ArrowUpIcon, at: "col-start-2 row-start-1" },
  { dir: "left", Icon: ArrowLeftIcon, at: "col-start-1 row-start-2" },
  { dir: "right", Icon: ArrowRightIcon, at: "col-start-3 row-start-2" },
  { dir: "down", Icon: ArrowDownIcon, at: "col-start-2 row-start-3" },
];

// What turning left, right or round means from each way of facing.
const TURN: Record<Dir, { left: Dir; right: Dir; back: Dir }> = {
  up: { left: "left", right: "right", back: "down" },
  right: { left: "up", right: "down", back: "left" },
  down: { left: "right", right: "left", back: "up" },
  left: { left: "down", right: "up", back: "right" },
};

// Milliseconds per step while a direction is held: about the pace Mallakoth walks at.
const STEP_MS = 150;

function Pad({ onPress, onRelease, relative }: { onPress: (d: Dir) => void; onRelease: (d: Dir) => void; relative: boolean }) {
  return (
    <div className="grid grid-cols-3 grid-rows-3 gap-1.5">
      {PAD.map(({ dir, Icon, at }) => (
        <Button key={dir} variant="secondary" aria-label={relative ? { up: "Walk forward", down: "Step back", left: "Turn left", right: "Turn right" }[dir] : `Move ${dir}`} className={cn("size-12 touch-none select-none rounded-lg [@media(max-height:500px)]:size-10 lg:size-14", at)} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onPress(dir); }} onPointerUp={() => onRelease(dir)} onPointerCancel={() => onRelease(dir)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!e.repeat) onPress(dir); } }} onKeyUp={(e) => { if (e.key === "Enter" || e.key === " ") onRelease(dir); }}>
          {relative && dir === "left" ? <ArrowCounterClockwiseIcon size={24} weight="bold" /> : relative && dir === "right" ? <ArrowClockwiseIcon size={24} weight="bold" /> : <Icon size={24} weight="bold" />}
        </Button>
      ))}
    </div>
  );
}

function Elements({ s, dispatch }: { s: State; dispatch: (a: Action) => void }) {
  return (
    <div role="radiogroup" aria-label="Element" className="flex items-center justify-between gap-1">
      {ELEMENTS.map((el) => (
        <Button key={el} size="sm" variant={s.element === el ? "default" : "secondary"} role="radio" aria-checked={s.element === el} aria-label={`${ELEMENT_NAME[el]}, power ${s.magic[el]}`} className="flex-1 gap-1 px-1.5" onClick={() => dispatch({ type: "element", el })}>
          <Crystal el={el} className="size-5" />
          <span className="text-caption tabular-nums">{s.magic[el]}</span>
        </Button>
      ))}
    </div>
  );
}

// The goal, the story so far and the quest list, in a drawer, so none of it takes room from the map.
function Journal({ s }: { s: State }) {
  const done = QUESTS.filter((q) => s.quests[q.id]).length;
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Journal">
          <ScrollIcon size={22} weight="bold" />
        </Button>
      </DrawerTrigger>
      <DrawerContent className="data-[vaul-drawer-direction=bottom]:max-h-[85dvh]">
        <DrawerHeader className="text-left">
          <DrawerTitle>Journal</DrawerTitle>
          <DrawerDescription>
            Goal: {objective(s)} ({done}/{QUESTS.length} quests)
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
          <div aria-label="Story so far" className="rounded-lg bg-card px-3 py-2.5 text-footnote">
            {s.log.map((l, i) => (
              <p key={`${i}-${l}`} className={i === s.log.length - 1 ? "text-foreground" : "text-muted-foreground"}>
                {l}
              </p>
            ))}
          </div>
          <ul className="flex flex-col gap-1.5 text-footnote">
            {QUESTS.map((q) => (
              <li key={q.id} className="flex items-start gap-2">
                {s.quests[q.id] ? <CheckCircleIcon size={16} weight="fill" className="mt-0.5 shrink-0 text-primary" /> : <CircleIcon size={16} className="mt-0.5 shrink-0 text-muted-foreground" />}
                <span className={cn(s.quests[q.id] && "text-muted-foreground line-through")}>
                  <span className="font-medium">{q.title}</span>
                  {q.optional ? <span className="text-muted-foreground"> · optional</span> : null}
                  <span className="block text-caption text-muted-foreground no-underline">
                    {q.text} +{q.xp} XP
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// What to do next, in plain words.
function objective(s: State): string {
  if (s.flags.epilogue) return "Chapter 1 begins in Dresden. (Coming soon.)";
  if (s.area === "spikes") return "Run for the far end before the spikes rise!";
  if (s.flags.bigSpawned) return "Defeat the Great Slime.";
  if (s.flags.wave) return `Defeat every slime (${slimesLeft(s)} left).`;
  if (s.flags.trialStarted) return "Wake the statue of Atronius.";
  if (s.flags.leversDone) return "Find Vastios outside the Temple, near the path by the river.";
  if (s.flags.sanctumIntro) return "Talk to Vastios, then pull the lever that opens the way out.";
  if (s.flags.puzzleDone) return "Hurry through the sanctum door before it shuts.";
  if (s.flags.armed) return "Press the red button at the bottom of the hall's right wall.";
  if (s.flags.drawfJoins) return "In the hall: the blue button at the bottom of the left wall, then the gold one, then the red one on the right.";
  if (s.quests.run) return "Meet Drawf and enter the Temple of the Sacred Flame.";
  if (s.boulder) return "RUN! The exit is at the north end of the hall. You can outrun it.";
  if (s.quiz.done) return "Reach the long hall on the west side of the caves and get through to the Valley of Time.";
  if (s.quests.caves) return "Find a way through the caves to the Temple of the Sacred Flame.";
  return "Find the Temple of the Sacred Flame in the Unyielding Mountains.";
}

// The fight, in 3D: Mallakoth and the enemy face each other on a patch of ground and play the project's own
// animations (the hero's sword swing, the slimes' lunge) as each turn lands.
function BattleStage({ s }: { s: State }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Stage | null>(null);
  const latest = useRef(s);
  latest.current = s;
  const cave = s.area === "caves";

  const apply = useCallback(() => {
    const st = stage.current;
    const cur = latest.current;
    const b = cur.battle;
    if (!st || !b) return;
    const ratio = Math.max(0, b.hp) / b.maxHp;
    const gesture = { attack: cur.weapon === "axe" ? "swing_axe" : "sword_attack", cast: "touch_flame", dodge: "sprint" }[b.last.hero];
    st.setEffects(b.stun > 0 || b.broken > 0 ? [{ key: "stun", name: "Stun", x: 1.4, z: 0, y: 1.6, size: 1.6 }] : []);
    st.sync([
      { key: "hero", kind: "characters", name: "Mallakoth_red_2", x: -1.4, z: 0, rotY: -Math.PI / 2, scale: 1, ...(gesture ? { shot: { name: gesture, n: b.turn } } : {}) },
      {
        key: "foe",
        kind: "characters",
        name: b.kind === "bigslime" ? "Boss_slime" : `${b.kind}_slime`,
        x: 1.4,
        z: 0,
        rotY: -Math.PI / 2,
        // The Great Slime shrinks as it is hurt.
        scale: b.kind === "bigslime" ? 1.2 + 1.8 * ratio : b.kind === "rainbow" ? 2.2 : 1.7,
        ...(b.last.foe === "attack" ? { shot: { name: "attack", n: b.turn } } : {}),
      },
    ]);
  }, []);

  useEffect(() => {
    let alive = true;
    let made: Stage | null = null;
    (async () => {
      const { Stage } = await import("./three/stage");
      if (!alive || !canvas.current) return;
      made = new Stage(canvas.current);
      stage.current = made;
      made.loadArena(cave);
      made.distance = 6.2;
      made.pitch = 0.5;
      made.focus.set(0, 0.35, 0);
      made.start();
      apply();
    })();
    return () => {
      alive = false;
      stage.current = null;
      made?.dispose();
    };
  }, [cave, apply]);

  useEffect(() => {
    apply();
  }, [s.battle?.turn, s.battle?.hp, s.battle?.stun, s.battle?.broken, apply]);

  return (
    <div role="img" aria-label="The fight" className="relative size-full overflow-hidden bg-muted">
      <canvas ref={canvas} className="block size-full" />
    </div>
  );
}

const INTENT_UI: Record<Intent, { text: string; hint: string; tone: string }> = {
  strike: { text: "Strike", hint: "A plain blow. Attack, or guard it for a chance to strike back.", tone: "text-foreground" },
  heavy: { text: "Heavy blow", hint: "Slow and brutal. Dodge it, or guard to take a fraction.", tone: "text-destructive" },
  swift: { text: "Flurry", hint: "Two quick hits. Guard if you're hurt. Hard to dodge.", tone: "text-amber-600 dark:text-amber-400" },
};

function BattleControls({ s, dispatch }: { s: State; dispatch: (a: Action) => void }) {
  const b = s.battle!;
  const foe = ENEMIES[b.kind];
  const spell = SPELLS[s.element];
  const intent = INTENT_UI[b.intent];
  const breakAt = b.maxHp * (foe.boss ? 0.4 : 0.5);
  return (
    <>
      <section aria-label={`Fighting ${foe.name}`} className="rounded-lg bg-card p-2">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-heading">{foe.name}</h2>
          <p className="text-footnote tabular-nums text-muted-foreground">
            {Math.max(0, b.hp)}/{b.maxHp} HP{b.burn > 0 ? " · burning" : ""}
            {b.stun > 0 ? " · stunned" : ""}
          </p>
        </div>
        <Bar value={b.hp} max={b.maxHp} label={`${foe.name} health`} tone="destructive" />
        <div className="mt-2 flex items-center gap-2">
          <span className="text-caption text-muted-foreground">Break</span>
          <div className="flex-1">
            <Bar value={b.broken > 0 ? breakAt : b.stagger} max={breakAt} label="Stagger" tone="stamina" />
          </div>
          {b.combo > 0 && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-caption font-medium tabular-nums text-primary" aria-label={`Combo ${b.combo} of ${COMBO_MAX}`}>
              Combo ×{b.combo}
            </span>
          )}
        </div>
        <div role="status" aria-live="polite" className={cn("mt-1.5 flex items-start gap-2 rounded-md bg-muted/60 px-2 py-1.5 text-footnote", intent.tone)}>
          {b.broken > 0 || b.stun > 0 ? <SparkleIcon weight="fill" className="mt-0.5 shrink-0" /> : <WarningIcon weight="fill" className="mt-0.5 shrink-0" />}
          <span>
            <span className="font-medium">{b.broken > 0 ? "Reeling!" : b.stun > 0 ? "Stunned!" : `Next: ${intent.text}`}</span>
            <span className="block text-caption text-muted-foreground">{b.broken > 0 ? "It can't act. Your next blow lands hard." : b.stun > 0 ? "It loses its turn." : intent.hint}</span>
          </span>
        </div>
      </section>
      <Elements s={s} dispatch={dispatch} />
      <div className="grid grid-cols-3 gap-1.5">
        <Button size="default" className="h-auto min-h-11 whitespace-normal px-2 py-1 text-footnote leading-tight" onClick={() => dispatch({ type: "attack" })}>
          <WeaponIcon id={s.weapon} className="size-6" /> Attack
        </Button>
        <Button size="default" className="h-auto min-h-11 whitespace-normal px-2 py-1 text-footnote leading-tight" variant="secondary" onClick={() => dispatch({ type: "guard" })}>
          <ShieldChevronIcon weight="bold" /> Guard
        </Button>
        <Button size="default" className="h-auto min-h-11 whitespace-normal px-2 py-1 text-footnote leading-tight" variant="secondary" disabled={s.stamina < DODGE_COST} onClick={() => dispatch({ type: "dodge" })} aria-label={`Dodge, ${DODGE_COST} stamina`}>
          <PersonSimpleThrowIcon weight="bold" /> Dodge ({s.stamina})
        </Button>
        <Button size="default" className="h-auto min-h-11 whitespace-normal px-2 py-1 text-footnote leading-tight" variant="secondary" disabled={s.mana < spell.cost} onClick={() => dispatch({ type: "spell" })} aria-label={`${spell.name}, ${spell.cost} mana. ${spell.blurb}`}>
          <Crystal el={s.element} className="size-6" /> {spell.name} ({spell.cost})
        </Button>
        {s.flags.blade ? (
          <Button size="default" className="h-auto min-h-11 whitespace-normal px-2 py-1 text-footnote leading-tight" variant="secondary" disabled={s.special < SPECIAL_MAX} onClick={() => dispatch({ type: "special" })}>
            <SwordIcon weight="fill" /> Flame Strike ({s.special}/{SPECIAL_MAX})
          </Button>
        ) : (
          <Button size="default" className="h-auto min-h-11 whitespace-normal px-2 py-1 text-footnote leading-tight" variant="ghost" disabled>
            <SparkleIcon /> No special yet
          </Button>
        )}
        <Button size="default" className="h-auto min-h-11 whitespace-normal px-2 py-1 text-footnote leading-tight" variant="secondary" disabled={s.potions === 0 || (s.hp >= maxHp(s.level) && !s.poisoned)} onClick={() => dispatch({ type: "potion" })}>
          <Sprite name={ITEM.potion} className="size-6" /> Potion ({s.potions})
        </Button>
        <Button size="default" className="h-auto min-h-11 whitespace-normal px-2 py-1 text-footnote leading-tight" variant="ghost" disabled={foe.boss} onClick={() => dispatch({ type: "flee" })}>
          <PersonSimpleRunIcon weight="bold" /> {foe.boss ? "No escape" : "Run"}
        </Button>
      </div>
    </>
  );
}

function Portrait({ who, className }: { who: Who; className?: string }) {
  if (who === "narrator") return <SparkleIcon className={cn("text-muted-foreground", className)} weight="duotone" />;
  if (who === "note") return <ScrollIcon className={cn("text-muted-foreground", className)} weight="duotone" />;
  return <NpcArt who={who} className={className} />;
}

// Whether there is a keyboard to press: a fine pointer that can hover (a computer), not a finger on a phone.
function useKeyboard(): boolean {
  const query = "(hover: hover) and (pointer: fine)";
  const [yes, setYes] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const on = () => setYes(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return yes;
}

// A small key cap on a button that a key also presses (shown only where there is a keyboard).
function KeyCap({ keys }: { keys: string }) {
  if (!useKeyboard()) return null;
  return (
    <kbd aria-hidden className="ml-2 rounded border border-current/40 px-1.5 py-0.5 font-sans text-caption leading-none opacity-80">
      {keys}
    </kbd>
  );
}

function DialogueView({ s, dispatch }: { s: State; dispatch: (a: Action) => void }) {
  const d = s.dlg!;
  const node = NODES[d.node];
  if (!node) return null;
  const text = d.text ?? (typeof node.text === "function" ? node.text(s) : node.text);
  const choices = typeof node.choices === "function" ? node.choices(s) : (node.choices ?? []);
  const speaker = NAMES[node.who];
  return (
    <div className="flex max-h-[46dvh] flex-col gap-2 overflow-y-auto md:max-h-none landscape:max-h-none">
      <section aria-label={speaker ? `${speaker} speaking` : "Story"} className="flex items-start gap-3 rounded-lg bg-card p-3">
        <Portrait who={node.who} className="size-12 shrink-0 rounded-sm" />
        <div className="min-w-0">
          {speaker && <h2 className="font-display text-heading">{speaker}</h2>}
          <p className={cn("whitespace-pre-line text-body", (node.who === "narrator" || node.who === "note") && "text-callout")}>{text}</p>
        </div>
      </section>
      {choices.length ? (
        <div className="flex flex-col gap-1.5">
          {choices.map((c, i) => (
            <Button key={i} size="lg" variant={i === 0 ? "default" : "secondary"} className="h-auto min-h-12 whitespace-normal py-2" onClick={() => dispatch({ type: "choose", i })}>
              {c.label}
              {i === 0 && <KeyCap keys="Enter" />}
            </Button>
          ))}
        </div>
      ) : (
        <Button size="lg" onClick={() => dispatch({ type: "next" })}>
          {node.next ? "Next" : "Done"}
          <KeyCap keys="Enter" />
        </Button>
      )}
    </div>
  );
}

function Ending({ s, onRestart, dispatch }: { s: State; onRestart: () => void; dispatch: (a: Action) => void }) {
  const won = s.mode === "won";
  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-3 overflow-y-auto bg-background p-3">
      <section aria-label={won ? "Victory" : "Defeat"} className="rounded-lg bg-card p-5 text-center">
        <Sprite name={HEAD.mallakoth!} className="mx-auto mb-3 size-24 rounded-sm" />
        <h2 className="font-display text-title">{won ? "Arc 0 complete" : "Defeated"}</h2>
        <p className="mt-1 text-callout text-muted-foreground">
          {won
            ? `A sworn Lightbringer at level ${s.level}, after ${s.steps} steps, ${s.deaths} ${s.deaths === 1 ? "defeat" : "defeats"} and ${Object.keys(s.quests).length} of ${QUESTS.length} quests.`
            : s.log.at(-1) ?? "The journey ends here."}
        </p>
        {won && <p className="mt-2 text-footnote text-muted-foreground">Every run has different riddles, different slimes and different secrets. Try the other cave path.</p>}
      </section>
      {won && (
        <Button size="xl" onClick={() => dispatch({ type: "continue" })}>
          <PersonSimpleRunIcon weight="bold" /> Walk to Dresden
          <KeyCap keys="Enter" />
        </Button>
      )}
      {!won && (
        <Button size="xl" onClick={() => dispatch({ type: "retry" })}>
          <ArrowCounterClockwiseIcon weight="bold" /> Try again from the start of this area
          <KeyCap keys="Enter" />
        </Button>
      )}
      <Button size="xl" variant="secondary" onClick={onRestart}>
        <ArrowCounterClockwiseIcon weight="bold" /> {won ? "Play again" : "Start over"}
      </Button>
    </div>
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
  q: { type: "dash" },
  e: { type: "swing" },
  ".": { type: "wait" },
};

const BATTLE_KEYS = { "1": "attack", "2": "guard", "3": "dodge", "4": "spell", "5": "special", "6": "potion", "7": "flee" } as const;

// The project's music for where Mallakoth is: the forest in the open, the cave ambience underground, and the golem's
// own theme from the moment it wakes until it falls. Indoors the forest goes quiet.
function trackFor(s: State): { name: audio.Track; volume: number } {
  if (s.area === "caves") return s.flags.golemAwake && !s.flags.golemDown ? { name: "GolemTheme", volume: 0.6 } : { name: "cave_ambiance", volume: 0.6 };
  return { name: "Forest_with_leaves_woodpecker_LONG", volume: isIndoor(s.area, s.pos.x, s.pos.y) ? 0.2 : 0.45 };
}

// Sound for the whole game: effects for what each move did, the music and the looping ambience, all following
// the app's own sound settings. The app's lo-fi music steps aside while the game's own plays.
function useGameAudio(s: State) {
  const { sfx, music } = useSoundSettings();
  useEffect(() => {
    audio.setEnabled({ sfx: sfx !== "off", music: music !== "off" });
  }, [sfx, music]);
  useEffect(() => {
    const unlock = () => audio.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);
  useEffect(() => {
    if (music !== "off") wantMusic(false);
    return () => {
      audio.dispose();
      wantMusic(true);
    };
  }, [music]);
  const track = trackFor(s);
  useEffect(() => {
    audio.setMusic(track.name, track.volume);
  }, [track.name, track.volume]);
  const loops = loopsFor(s);
  const key = loops.map((l) => `${l.id}:${l.name}:${l.volume.toFixed(1)}`).join("|");
  useEffect(() => {
    for (const l of ["boulder", "waterfall", "river"]) if (!loops.some((x) => x.id === l)) audio.setLoop(l, "", 0);
    for (const l of loops) audio.setLoop(l.id, l.name, l.volume);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

function useCues() {
  const { sfx } = useSoundSettings();
  const on = useRef(true);
  on.current = sfx !== "off";
  return useCallback((prev: State, next: State) => {
    audio.unlock();
    if (!on.current) return;
    for (const { name, delay, volume, rate } of cuesFor(prev, next)) audio.play(name, { delay, volume, rate });
  }, []);
}

export function MereddiaGame() {
  const [state, setState] = useState<State>(load);
  const [sprint, setSprint] = useState(false);
  const latest = useRef(state);
  const cues = useCues();
  useGameAudio(state);

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
    resetSeen();
    const fresh = newGame();
    latest.current = fresh;
    setState(fresh);
    save(fresh);
  }, []);

  // Holding a direction walks: one step every STEP_MS, so the walk is one smooth stride and not a stutter of key repeats.
  const sprintRef = useRef(sprint);
  sprintRef.current = sprint;
  const held = useRef<{ dirs: Dir[]; timer?: number; shift: boolean; tick: number }>({ dirs: [], shift: false, tick: 0 });
  const stopWalking = useCallback(() => {
    const h = held.current;
    h.dirs = [];
    if (h.timer !== undefined) window.clearInterval(h.timer);
    h.timer = undefined;
  }, []);
  const stepHeld = useCallback(() => {
    const h = held.current;
    const cur = latest.current;
    const dir = h.dirs.at(-1);
    if (!dir || cur.mode !== "explore" || cur.cut) return stopWalking();
    const n = h.tick++;
    if (!AREAS[cur.area].map3d || AREAS[cur.area].map3d?.pitch !== undefined) return void dispatch({ type: "move", dir, sprint: h.shift || sprintRef.current });
    // With the camera behind him, the pad is his: forward, back, and turn left or right.
    const f = cur.facing;
    if (dir === "up") dispatch({ type: "move", dir: f, sprint: h.shift || sprintRef.current });
    else if (dir === "down") dispatch({ type: "move", dir: TURN[f].back, keep: true });
    else if (n % 3 === 0) dispatch({ type: "turn", dir: dir === "left" ? TURN[f].left : TURN[f].right });
  }, [dispatch, stopWalking]);
  const startWalking = useCallback(
    (dir: Dir, shift = false) => {
      const h = held.current;
      h.shift = shift;
      h.dirs = [...h.dirs.filter((d) => d !== dir), dir];
      h.tick = 0;
      if (h.timer === undefined) {
        stepHeld();
        h.timer = window.setInterval(stepHeld, STEP_MS);
      }
    },
    [stepHeld],
  );
  const stopDir = useCallback(
    (dir: Dir) => {
      const h = held.current;
      h.dirs = h.dirs.filter((d) => d !== dir);
      if (!h.dirs.length) stopWalking();
    },
    [stopWalking],
  );
  useEffect(() => stopWalking, [stopWalking]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (latest.current.cut) return;
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement | null)?.closest("button, input, textarea, summary, [role=dialog]")) return;
      const cur = latest.current;
      let action: Action | undefined;
      if (cur.mode === "battle") {
        const k = BATTLE_KEYS[e.key as "1"];
        action = k ? ({ type: k } as Action) : undefined;
      } else if (cur.mode === "dialogue") {
        // Enter or E takes the highlighted (green) answer: the first choice, or Next/Done when there is nothing to choose.
        const node = cur.dlg ? NODES[cur.dlg.node] : undefined;
        const choices = node ? (typeof node.choices === "function" ? node.choices(cur) : (node.choices ?? [])) : [];
        if (/^[1-9]$/.test(e.key)) action = { type: "choose", i: Number(e.key) - 1 };
        else if (e.key === "Enter" || e.key === "e" || e.key === "E") {
          // (Holding the key down does not race through everything.)
          if (e.repeat) return;
          action = choices.length ? { type: "choose", i: 0 } : { type: "next" };
        }
        else action = KEYS[e.key];
      } else if (cur.mode === "won" || cur.mode === "lost") {
        // The end screens: the green button, "Walk to Dresden" or "Try again from the start of this area".
        if ((e.key === "Enter" || e.key === "e" || e.key === "E") && !e.repeat) action = cur.mode === "won" ? { type: "continue" } : { type: "retry" };
      } else if (e.key === "r" || e.key === "R") {
        action = { type: "element", el: ELEMENTS[(ELEMENTS.indexOf(cur.element) + 1) % ELEMENTS.length] };
      } else {
        const k = KEYS[e.key] ?? KEYS[e.key.toLowerCase()];
        if (k && k.type === "move") {
          e.preventDefault();
          if (!e.repeat) startWalking(k.dir, e.shiftKey);
          else held.current.shift = e.shiftKey;
          return;
        }
        action = k;
      }
      if (!action) return;
      e.preventDefault();
      dispatch(action);
    };
    const onUp = (e: KeyboardEvent) => {
      const k = KEYS[e.key] ?? KEYS[e.key.toLowerCase()];
      if (k && k.type === "move") stopDir(k.dir);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", stopWalking);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", stopWalking);
    };
  }, [dispatch, startWalking, stopDir, stopWalking]);

  // A scene that cannot be drawn (no 3D map here) is simply over.
  useEffect(() => {
    if (state.cut && !(CUTSCENES[state.cut.id] && AREAS[state.area].map3d)) dispatch({ type: "seen" });
  }, [state.cut, state.area, dispatch]);

  const s = state;
  const exploring = s.mode === "explore";
  const goBack = useGoBack("/games");
  const def = AREAS[s.area];
  const stage =
    s.cut && CUTSCENES[s.cut.id] && def.map3d ? (
      <MapView3D s={s} scene={s.cut} onDone={() => dispatch({ type: "seen" })} />
    ) : s.mode === "battle" ? (
      <BattleStage s={s} />
    ) : s.mode === "won" || s.mode === "lost" ? (
      <Ending s={s} onRestart={restart} dispatch={dispatch} />
    ) : def.map3d ? (
      <>
        <MapView3D s={s} />
        <div className="pointer-events-none absolute top-2 left-2 flex max-w-[55%] items-center gap-2 rounded-md bg-black/55 px-2 py-1 text-footnote font-medium text-white backdrop-blur-sm">
          <span className="truncate">{zoneAt(s.area, s.pos.x, s.pos.y)?.name ?? def.name}</span>
          {s.boulder && <span className="shrink-0 text-red-300">Run!</span>}
        </div>
        {s.mode === "explore" && s.log.length > 0 && (
          <p aria-live="polite" className="pointer-events-none absolute inset-x-2 bottom-2 rounded-md bg-black/55 px-2.5 py-1.5 text-footnote text-white backdrop-blur-sm">
            {s.log.at(-1)}
          </p>
        )}
      </>
    ) : (
      <div className="grid size-full place-items-center bg-muted p-2">
        <div className="w-full max-w-lg">
          <MapView s={s} />
        </div>
      </div>
    );
  const controls =
    s.cut ? null : s.mode === "battle" ? (
      <BattleControls s={s} dispatch={dispatch} />
    ) : s.mode === "dialogue" ? (
      <DialogueView s={s} dispatch={dispatch} />
    ) : s.mode === "explore" ? (
      <>
        <Elements s={s} dispatch={dispatch} />
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="grid grid-cols-2 gap-1.5">
              <Button variant="secondary" disabled={s.potions === 0 || (s.hp >= maxHp(s.level) && !s.poisoned)} onClick={() => dispatch({ type: "potion" })}>
                <Sprite name={ITEM.potion} className="size-5" /> Potion ({s.potions})
              </Button>
              <Button variant="secondary" disabled={!exploring || s.mana < 2 || !!s.boulder} onClick={() => dispatch({ type: "dash" })} aria-label={`Dash, 2 mana. Leaves ${ELEMENT_NAME[s.element]} behind.`}>
                <PersonSimpleThrowIcon weight="bold" /> Dash
              </Button>
              <Button variant={sprint ? "default" : "secondary"} aria-pressed={sprint} onClick={() => setSprint((v) => !v)}>
                <LightningIcon weight="fill" /> Sprint
              </Button>
              <Button variant="secondary" onClick={() => dispatch({ type: "wait" })} aria-label="Wait a moment">
                <HourglassIcon weight="bold" /> Wait
              </Button>
            </div>
            {(() => {
              // The swing button says what it would do: what stands in front of you, and the tool for it. It is there whenever there is
              // something to swing at, or a tool to swing, so a phone has the same prompt the E key gives.
              const step = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[s.facing];
              const ahead = s.entities.filter((e) => e.area === s.area && e.x === s.pos.x + step[0] && e.y === s.pos.y + step[1]);
              const has = (f: (e: (typeof ahead)[number]) => boolean) => ahead.some(f);
              const what = has((e) => e.kind === "pot")
                ? { text: "Kick the pot", pick: false }
                : has((e) => e.kind === "prop" && e.what === "rock") && s.items.pickaxe
                  ? { text: "Strike the rock", pick: true }
                  : has((e) => e.kind === "prop" && (e.what === "tree" || e.what === "treeblock")) && s.items.axe
                    ? { text: "Chop the tree", pick: false }
                    : has((e) => e.kind === "enemy" && e.what === "golem")
                      ? { text: s.items.pickaxe ? "Strike the golem" : "Hit the golem", pick: true }
                      : undefined;
              if (!what && !s.items.axe && !s.items.pickaxe) return null;
              return (
                <Button variant={what ? "default" : "secondary"} onClick={() => dispatch({ type: "swing" })} aria-label={`${what?.text ?? "Swing"} (E)`}>
                  {what?.pick || (!what && !s.items.axe) ? <Pickaxe className="size-5" /> : <WeaponIcon id="axe" className="size-5" />} {what?.text ?? "Swing"} (E)
                </Button>
              );
            })()}
            <Bar value={s.stamina} max={STAMINA_MAX} label="Stamina" tone="stamina" />
          </div>
          <Pad relative={def.map3d?.pitch === undefined} onPress={(dir) => startWalking(dir)} onRelease={stopDir} />
        </div>
      </>
    ) : null;

  // A full-screen layer: the whole game is always on screen at once, with nothing to scroll. On a phone held upright
  // the map is on top and the controls under it; on a wide or sideways screen the controls move to the side.
  return createPortal(
    <div className="fixed inset-0 z-40 flex flex-col bg-background text-foreground" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <header className="mx-auto grid h-11 w-full max-w-6xl shrink-0 grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-1 px-1">
        <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={goBack}>
          <CaretLeftIcon size={22} weight="bold" />
        </Button>
        <p className="min-w-0 truncate text-center text-footnote">
          <span className="text-muted-foreground">Goal: </span>
          {objective(s)}
        </p>
        <div className="flex items-center">
          <Journal s={s} />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Start over">
                <ArrowCounterClockwiseIcon size={22} weight="bold" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Start over?</AlertDialogTitle>
                <AlertDialogDescription>Your journey so far is erased, and the riddles and slimes are shuffled.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep playing</AlertDialogCancel>
                <AlertDialogAction onClick={restart}>Start over</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </header>
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-2 px-2 pb-2 md:flex-row landscape:flex-row">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg bg-muted">{stage}</div>
        <aside className="flex shrink-0 flex-col gap-2 md:w-96 md:overflow-y-auto landscape:w-96 landscape:overflow-y-auto">
          <Hud s={s} dispatch={dispatch} />
          {controls}
        </aside>
      </div>
    </div>,
    document.body,
  );
}
