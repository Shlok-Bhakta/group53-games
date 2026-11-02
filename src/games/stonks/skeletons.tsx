import { useParams } from "react-router";
import { NavBar } from "@/components/AppHeader";
import { Group } from "@/components/parts";
import { Skeleton } from "@/components/ui/skeleton";
import { display, INDEX } from "../../../convex/stonks/market";

// Stand-ins the exact size of what they stand in for, so nothing moves when the data lands. Every height
// here is the real one's (S below): change one, change both. They're in the main bundle, since they're
// what shows while Stonks' code is still on its way.

export const S = {
  heroTop: "h-6", // the name and the market's state
  heroPrice: "h-10", // text-title-lg
  heroLine: "h-6", // a change line
  chart: 200,
  segmented: "h-[52px]",
  row: "h-16",
  mover: "h-9",
  range: "h-[68px]",
  stat: "h-12",
  crew: "h-14",
  search: "h-11",
  crewChart: 190,
} as const;

export const MOVERS = 6;
export const STATS = 6;

function SectionHead({ wide = "w-24" }: { wide?: string }) {
  return (
    <div className="flex h-[34px] items-start px-1">
      <Skeleton className={`h-6 ${wide}`} />
    </div>
  );
}

export function HeroSkeleton({ extended }: { extended?: boolean }) {
  return (
    <div className="px-1">
      <div className={`flex ${S.heroTop} items-center justify-between`}>
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3.5 w-32" />
      </div>
      <div className={`flex ${S.heroPrice} items-center`}>
        <Skeleton className="h-9 w-48" />
      </div>
      <div className={`flex ${S.heroLine} items-center`}>
        <Skeleton className="h-4 w-40" />
      </div>
      {extended && <div className={S.heroLine} />}
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="relative w-full" style={{ height: S.chart }} aria-hidden>
      <div className="absolute inset-x-0 top-[38%] border-t border-dotted border-muted-foreground/30" />
      <Skeleton className="absolute inset-x-0 bottom-0 h-[55%] rounded-sm opacity-60" />
    </div>
  );
}

export function RowSkeleton() {
  return (
    <div className={`flex ${S.row} items-center gap-3 px-4`}>
      <Skeleton className="h-3.5 w-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className="h-4 w-14" />
        <Skeleton className="h-3 w-28" />
      </div>
      <Skeleton className="h-[30px] w-16 shrink-0 opacity-60" />
      <div className="flex w-[92px] shrink-0 flex-col items-end gap-1.5">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  );
}

export function BoardSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <NavBar title="Stonks" back="/games" />
      <Skeleton className={`${S.search} w-full rounded-md`} />
      <HeroSkeleton extended />
      <section>
        <SectionHead wide="w-16" />
        <div className="pb-3" aria-hidden>
          <Skeleton className="w-full rounded-sm opacity-60" style={{ height: S.crewChart }} />
        </div>
        <Group>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={`flex ${S.crew} items-center gap-3 px-4`}>
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="h-4 w-20 shrink-0" />
            </div>
          ))}
        </Group>
      </section>
      <section className="flex flex-col gap-3">
        <HeroSkeleton />
        <ChartSkeleton />
        <Skeleton className={`${S.segmented} w-full rounded-md`} />
      </section>
      <Group>
        {[0, 1].map((i) => (
          <div key={i} className={`${S.range} px-4 py-3`}>
            <Skeleton className="h-full w-full" />
          </div>
        ))}
      </Group>
      <section>
        <SectionHead wide="w-36" />
        <Group>
          {Array.from({ length: MOVERS }, (_, i) => (
            <div key={i} className={`flex ${S.mover} items-center px-4`}>
              <Skeleton className="h-3.5 w-full" />
            </div>
          ))}
        </Group>
      </section>
      <section>
        <SectionHead />
        <Group>
          {Array.from({ length: 20 }, (_, i) => (
            <RowSkeleton key={i} />
          ))}
        </Group>
      </section>
    </div>
  );
}

export function StatsSkeleton() {
  return (
    <section>
      <SectionHead wide="w-16" />
      <Group>
        {[0, 1].map((i) => (
          <div key={`r${i}`} className={`${S.range} px-4 py-3`}>
            <Skeleton className="h-full w-full" />
          </div>
        ))}
        {Array.from({ length: STATS }, (_, i) => (
          <div key={i} className={`flex ${S.stat} items-center justify-between px-4`}>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </Group>
    </section>
  );
}

export function StockSkeleton() {
  const { symbol = "" } = useParams();
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <NavBar title={display(symbol)} subtitle={<span className="inline-block h-[17px]" />} back="/stonks" />
      <section className="flex flex-col gap-3">
        <HeroSkeleton extended={symbol !== INDEX} />
        <ChartSkeleton />
        <Skeleton className={`${S.segmented} w-full rounded-md`} />
      </section>
      <StatsSkeleton />
      <div className="sticky bottom-0 -mx-4 flex gap-2.5 bg-background px-4 pt-5" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)", marginBottom: "calc(-1 * (env(safe-area-inset-bottom) + 16px))" }}>
        <Skeleton className="h-14 flex-1 rounded-lg" />
        <Skeleton className="h-14 flex-1 rounded-lg" />
      </div>
    </div>
  );
}

export function PlayerSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <NavBar title="" subtitle={<span className="inline-block h-[17px]" />} back="/stonks" />
      <div className="flex gap-4">
        <Skeleton className="aspect-[3/4] w-[132px] shrink-0 rounded-lg" />
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
      <ChartSkeleton />
      <Skeleton className="mx-auto size-[220px] rounded-full opacity-60" />
      <section>
        <SectionHead wide="w-28" />
        <Group>
          {Array.from({ length: 4 }, (_, i) => (
            <RowSkeleton key={i} />
          ))}
        </Group>
      </section>
    </div>
  );
}
