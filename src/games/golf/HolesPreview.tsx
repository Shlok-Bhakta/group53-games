import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { DiceFiveIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { Course } from "../../../convex/golf/engine";
import { rollSeed, settingsOf, type ModeKey, type Settings } from "../../../convex/modes";
import { Section } from "@/components/parts";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { refreshTheme, still } from "./toy";

const PREVIEW_DEBOUNCE_MS = 300;

export function GolfHoles({
  mode,
  settings,
  onChange,
  editable = true,
}: {
  mode: ModeKey;
  settings: Settings;
  onChange: (next: Settings) => void;
  editable?: boolean;
}) {
  const s = settingsOf(mode, settings);
  const generated = s.course === 0;
  const rollFirstSeed = useEffectEvent(() => {
    if (editable) onChange({ ...settings, seed: rollSeed() });
  });
  useEffect(() => {
    if (generated && !s.seed) rollFirstSeed();
  }, [generated, s.seed]);
  const args = {
    mode,
    settings: { course: s.course, holes: s.holes, terrain: s.terrain, style: s.style, hazards: s.hazards, seed: s.seed, boxes: s.boxes },
  };
  const key = JSON.stringify(args);
  const data = useQuery(api.golf.preview, generated && !s.seed ? "skip" : args);
  const request = useMutation(api.golf.requestPreview);
  const askForHoles = useEffectEvent(() => void request(args).catch(() => {}));
  useEffect(() => {
    if (!generated || !s.seed) return;
    const id = setTimeout(askForHoles, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [key, generated, s.seed]);
  const [open, setOpen] = useState<number | null>(null);
  const total = data?.total ?? s.holes ?? 9;
  const holes = data?.holes ?? Array.from({ length: total }, () => null);
  const shown = open !== null ? holes[open] : null;
  return (
    <Section
      title="Holes"
      bare
      action={
        generated && s.seed && !editable ? (
          <span className="font-display text-callout text-muted-foreground">Seed {s.seed}</span>
        ) : generated && s.seed ? (
          <Button
            variant="bare"
            size="chip"
            onClick={() => onChange({ ...settings, seed: rollSeed() })}
            aria-label={`Seed ${s.seed}, roll another`}
            className="-my-2 rounded-full px-2 font-display text-callout text-primary active:scale-[0.97]"
          >
            Seed {s.seed}
            <DiceFiveIcon size={20} weight="fill" />
          </Button>
        ) : undefined
      }
    >
      <ul className="grid grid-cols-3 gap-2" aria-label="The holes">
        {holes.map((c, n) => (
          <li key={n}>
            {c ? (
              <Button
                variant="bare"
                size="card"
                onClick={() => setOpen(n)}
                aria-label={`Hole ${n + 1}, ${c.name}, par ${c.par}`}
                className="flex flex-col items-stretch gap-1"
              >
                <Thumb c={c} />
                <span className="block truncate px-0.5 text-footnote font-semibold">
                  {n + 1}. {c.name}
                </span>
                <span className="-mt-1 block px-0.5 text-caption text-muted-foreground">Par {c.par}</span>
              </Button>
            ) : (
              <div className="flex flex-col gap-1" aria-busy="true" aria-label={`Hole ${n + 1}, being made`}>
                <Skeleton className="aspect-[3/4] w-full rounded-sm" />
                <span className="px-0.5 text-footnote text-muted-foreground">{n + 1}.</span>
                <span className="-mt-1 block h-[15px]" />
              </div>
            )}
          </li>
        ))}
      </ul>
      <Sheet open={!!shown} onClose={() => setOpen(null)} title={shown ? `${open! + 1}. ${shown.name}` : ""} closable>
        {shown && (
          <>
            <Thumb c={shown} big />
            <p className="text-center text-callout text-muted-foreground">Par {shown.par}</p>
          </>
        )}
      </Sheet>
    </Section>
  );
}

function Thumb({ c, big = false }: { c: Course; big?: boolean }) {
  const src = useMemo(() => {
    refreshTheme();
    return still(c, big ? 720 : 300).toDataURL("image/png");
  }, [c, big]);
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className={
        big
          ? "mx-auto max-h-[60dvh] w-auto rounded-sm bg-background object-contain"
          : "aspect-[3/4] w-full rounded-sm bg-background object-contain"
      }
    />
  );
}
