import { useState, type ReactNode } from "react";
import { SpinnerGapIcon } from "@phosphor-icons/react";
import { usePending } from "@/components/AsyncButton";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

// Anything destructive goes behind this: the trigger opens a question, and only the red button does it. The
// action runs once however often it's tapped, and an error becomes a toast.
export function ConfirmButton({
  trigger,
  title,
  detail,
  keep,
  confirm,
  onConfirm,
}: {
  // The button that asks, usually a Button.
  trigger: ReactNode;
  title: string;
  detail: ReactNode;
  // What the two buttons say: "Keep playing" and "Resign".
  keep: string;
  confirm: string;
  onConfirm: () => Promise<unknown> | unknown;
}) {
  const [open, setOpen] = useState(false);
  const [pending, run] = usePending();
  return (
    <AlertDialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{detail}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{keep}</AlertDialogCancel>
          <Button variant="destructive" size="lg" disabled={pending} aria-busy={pending} onClick={() => void run(async () => (await onConfirm(), setOpen(false)))}>
            {pending && <SpinnerGapIcon className="animate-spin" weight="bold" />}
            {confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
