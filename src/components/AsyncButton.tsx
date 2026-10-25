import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { SpinnerGapIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorText } from "@/lib/errors";

// Runs an async action at most once at a time. Extra taps while it's running are ignored, and errors
// become a toast.
export function usePending() {
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);
  const run = useCallback(async (action: () => Promise<unknown> | unknown) => {
    if (running.current) return;
    running.current = true;
    setPending(true);
    try {
      await action();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      running.current = false;
      if (mounted.current) setPending(false);
    }
  }, []);
  return [pending, run] as const;
}

type Props = Omit<ComponentProps<typeof Button>, "onClick"> & {
  onClick: () => Promise<unknown> | unknown;
  icon?: ReactNode;
};

// A button that shows a spinner and can't be pressed again until its action finishes.
export function AsyncButton({ onClick, icon, children, disabled, ...rest }: Props) {
  const [pending, run] = usePending();
  return (
    <Button {...rest} disabled={disabled || pending} aria-busy={pending} onClick={() => void run(onClick)}>
      {pending ? <SpinnerGapIcon className="animate-spin" weight="bold" /> : icon}
      {children}
    </Button>
  );
}
