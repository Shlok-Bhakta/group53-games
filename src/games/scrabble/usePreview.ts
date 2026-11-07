import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { evaluate, type Placed, type Placement, type Rules, type Tile } from "../../../convex/scrabble/engine";
import { sfx } from "@/sound";

// The live preview of what I've laid out: its words, its score, and whether the dictionary knows them.
export function usePreview({ placed, rack, tiles, rules }: { placed: Placement[]; rack: Tile[] | null | undefined; tiles: Placed[]; rules: Rules }) {
  const evaluation = useMemo(() => (placed.length && rack ? evaluate(tiles, placed, rack, rules) : null), [placed, rack, tiles, rules]);
  const words = evaluation?.ok ? evaluation.words.map((w) => w.word) : [];
  const unknown = useQuery(api.scrabble.check, words.length ? { words } : "skip");
  const checking = words.length > 0 && unknown === undefined;
  const bad = unknown?.filter((w) => words.includes(w)) ?? [];
  const tone: "idle" | "ok" | "bad" = !evaluation ? "idle" : !evaluation.ok || bad.length ? "bad" : checking ? "idle" : "ok";
  // Shake (and a soft "nope") the moment a layout stops making real words.
  const [shake, setShake] = useState(0);
  const lastTone = useRef(tone);
  useEffect(() => {
    if (tone === "bad" && lastTone.current !== "bad" && evaluation?.ok) {
      setShake((n) => n + 1);
      sfx("invalid");
    }
    lastTone.current = tone;
  }, [tone, evaluation?.ok]);
  const bubble = useMemo(() => {
    if (!evaluation?.ok) return null;
    const main = evaluation.words[0].cells.at(-1)!;
    return { x: main[0], y: main[1], text: String(evaluation.score) };
  }, [evaluation]);
  return { evaluation, bad, checking, tone, bubble, shake, setShake };
}
