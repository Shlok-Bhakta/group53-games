import type { ComponentProps } from "react";
import { useMutation } from "convex/react";
import { FlagIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { MatchView } from "../../../convex/matches";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ConfirmButton";
import { cn } from "@/lib/utils";

type ButtonProps = ComponentProps<typeof Button>;

// Resign, behind a confirmation. `detail` says what happens next in this game; `variant` and `size` let a dock
// make it one of its own buttons.
export function ResignButton({
  match,
  detail,
  variant = "secondary",
  size,
  className,
}: {
  match: MatchView;
  detail: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}) {
  const resign = useMutation(api.matches.resign);
  return (
    <ConfirmButton
      trigger={
        <Button variant={variant} size={size} className={cn("text-destructive", className)}>
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
