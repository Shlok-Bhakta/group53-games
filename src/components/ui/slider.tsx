import type { ComponentProps } from "react";
import { Slider as Primitive } from "radix-ui";
import { cn } from "@/lib/utils";

// One thumb on a track, 44px tall to grab.
export function Slider({ className, label, ...props }: Omit<ComponentProps<typeof Primitive.Root>, "aria-label"> & { label: string }) {
  return (
    <Primitive.Root className={cn("relative flex h-11 touch-none select-none items-center", className)} aria-label={label} {...props}>
      <Primitive.Track className="relative h-2 grow overflow-hidden rounded-full bg-muted">
        <Primitive.Range className="absolute h-full bg-primary" />
      </Primitive.Track>
      <Primitive.Thumb className="block size-7 rounded-full border-2 border-primary bg-background shadow outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={label} />
    </Primitive.Root>
  );
}
