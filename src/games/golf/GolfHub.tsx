import { useMemo } from "react";
import { Link, Navigate, useParams } from "react-router";
import { useQuery } from "convex/react";
import { PlayIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { Course } from "../../../convex/golf/engine";
import { COURSES, courseById } from "../../../convex/golf/holes";
import { SANDBOX } from "../../../convex/golf/sandbox";
import { NavBar } from "@/components/AppHeader";
import { Group, SectionTitle } from "@/components/parts";
import { AvatarStack } from "@/components/PlayerAvatar";
import { Button } from "@/components/ui/button";
import { usePlayingIn } from "@/presence";
import GolfWorld from "./GolfWorld";
import { refreshTheme, still } from "./toy";

// Golf's page: the courses, hole by hole, with your best and the crew's, and the open world. Each hole
// is its own live world, with whoever else is on it.

const holePath = (course: string, n: number) => `/golf/${course}/${n}`;

function Thumb({ c }: { c: Course }) {
  const src = useMemo(() => {
    refreshTheme();
    return still(c, 112).toDataURL("image/png");
  }, [c]);
  return <img src={src} alt="" draggable={false} className="size-14 shrink-0 rounded-sm bg-background object-contain" />;
}

function HoleRow({ c, to, detail, best, leader }: { c: Course; to: string; detail: string; best?: number; leader?: string }) {
  const here = usePlayingIn(to);
  return (
    <Link to={to} aria-label={`${c.name}, ${detail}`} className="flex min-h-[72px] items-center gap-3 px-3 py-2 transition-transform duration-100 active:scale-[0.97]">
      <Thumb c={c} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-body">{c.name}</span>
        <span className="block truncate text-footnote text-muted-foreground">{leader ? `${detail}, ${leader}` : detail}</span>
      </span>
      <AvatarStack people={here.map((p) => ({ name: p.name, image: p.image }))} />
      {best !== undefined && <span className="shrink-0 font-display text-heading">{best}</span>}
    </Link>
  );
}

export function GolfHub() {
  const me = useQuery(api.users.me);
  const scores = useQuery(api.golf.scores);
  const mine = (hole: string) => scores?.find((r) => r.hole === hole && r.userId === me?._id);
  const leader = (hole: string) => {
    const rows = (scores ?? []).filter((r) => r.hole === hole);
    if (rows.length === 0) return undefined;
    const top = rows.reduce((a, b) => (b.best < a.best ? b : a));
    return `${top.name.split(" ")[0]} ${top.best}`;
  };
  return (
    <div className="flex flex-col gap-6">
      <NavBar title="Golf" back="/games" />
      {COURSES.map((co) => {
        const par = co.holes.reduce((a, h) => a + h.par, 0);
        const played = co.holes.filter((h) => mine(h.id));
        const total = played.reduce((a, h) => a + mine(h.id)!.best, 0);
        // Pick up at the first hole you haven't finished.
        const nextUp = co.holes.findIndex((h) => !mine(h.id));
        const resume = nextUp < 0 ? 0 : nextUp;
        return (
          <section key={co.id} className="flex flex-col gap-3">
            <SectionTitle className="items-baseline px-0 pb-0" action={<span className="text-footnote text-muted-foreground">{played.length === co.holes.length ? `You ${total}, par ${par}` : `Par ${par}`}</span>}>
              {co.name}
            </SectionTitle>
            <Group>
              {co.holes.map((h, i) => (
                <HoleRow key={h.id} c={h} to={holePath(co.id, i + 1)} detail={`Hole ${i + 1}, par ${h.par}`} best={mine(h.id)?.best} leader={leader(h.id)} />
              ))}
            </Group>
            <Button size="xl" asChild>
              <Link to={holePath(co.id, resume + 1)} aria-label={`Play ${co.name}`}>
                <PlayIcon weight="fill" /> {resume > 0 ? `Play from hole ${resume + 1}` : "Play"}
              </Link>
            </Button>
          </section>
        );
      })}
      <section className="flex flex-col gap-3">
        <SectionTitle className="px-0 pb-0">Open world</SectionTitle>
        <Group>
          <HoleRow c={SANDBOX} to="/golf/world" detail="No par, no rules" />
        </Group>
      </section>
    </div>
  );
}

export function GolfOpenWorld() {
  return <GolfWorld course={SANDBOX} />;
}

export function GolfHole() {
  const { course, hole } = useParams();
  const co = courseById(course ?? "");
  const n = Number(hole);
  const c = co?.holes[n - 1];
  if (!co || !c) return <Navigate to="/golf" replace />;
  return <GolfWorld key={c.id} course={c} hole={{ number: n, total: co.holes.length, next: n < co.holes.length ? holePath(co.id, n + 1) : null }} />;
}
