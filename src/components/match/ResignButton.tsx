import { useMutation } from "convex/react";
import { FlagIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { MatchView } from "../../../convex/matches";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ConfirmButton";
import { cn } from "@/lib/utils";

// Resign, behind a confirmation. `detail` says what happens next in this game.
export function ResignButton({ match, detail, className }: { match: MatchView; detail: string; className?: string }) {
  const resign = useMutation(api.matches.resign);
  return (
    <ConfirmButton
      trigger={
        <Button variant="secondary" className={cn("text-destructive", className)}>
          <FlagIcon weight="bold" /> Resign
        </Button>
      }
      title="Resign this game?"
      detail={detail}
      keep="Keep playing"
      confirm="Resign"
      onConfirm={() => resign({ id: match._id })}
    />
  );
}
