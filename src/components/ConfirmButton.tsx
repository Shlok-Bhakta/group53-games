import { useState, type ReactNode } from "react";
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

export function ConfirmButton({
  trigger,
  title,
  detail,
  keep,
  confirm,
  tone = "destructive",
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  detail: ReactNode;
  keep: string;
  confirm: string;
  tone?: "destructive" | "default";
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
          <Button variant={tone} size="lg" pending={pending} onClick={() => void run(async () => (await onConfirm(), setOpen(false)))}>
            {confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
