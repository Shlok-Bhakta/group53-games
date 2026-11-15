import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { toast } from "sonner";
import { Button, IconButton } from "@/components/ui/button";
import { errorText } from "@/lib/errors";

export function usePending() {
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => void (mounted.current = false);
  }, []);
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

type Action = () => Promise<unknown> | unknown;

export function AsyncButton({ onClick, ...rest }: Omit<ComponentProps<typeof Button>, "onClick" | "pending"> & { onClick: Action }) {
  const [pending, run] = usePending();
  return <Button {...rest} pending={pending} onClick={() => void run(onClick)} />;
}

export function AsyncIconButton({
  onClick,
  ...rest
}: Omit<ComponentProps<typeof IconButton>, "onClick" | "pending"> & { onClick: Action }) {
  const [pending, run] = usePending();
  return <IconButton {...rest} pending={pending} onClick={() => void run(onClick)} />;
}
