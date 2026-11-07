import type { Id } from "../../../convex/_generated/dataModel";
import type { Player } from "@/games/types";
import { ThinkingDots, useHere } from "@/presence";

// Whose move it is, live: "Your move", "Chris is on it" (with thinking dots, while they've got the game open)
// or "Waiting for Chris".
export function useTurnText(up: Player | undefined, meId: Id<"users"> | undefined, mine = "Your move") {
  const { here } = useHere(up?.userId);
  if (!up) return { text: null, thinking: false };
  if (up.userId === meId) return { text: mine, thinking: false };
  return { text: here ? `${up.name} is on it` : `Waiting for ${up.name}`, thinking: here };
}

export function TurnText({ up, meId, mine }: { up: Player | undefined; meId: Id<"users"> | undefined; mine?: string }) {
  const { text, thinking } = useTurnText(up, meId, mine);
  return (
    <>
      {text}
      {thinking && <ThinkingDots />}
    </>
  );
}
