import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Toggle as TogglePrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

const toggleVariants = cva(
  "inline-flex min-h-11 touch-manipulation items-center gap-1 rounded-full px-3.5 text-footnote font-semibold transition-transform duration-100 outline-none select-none active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        chip: "bg-muted text-muted-foreground line-through decoration-muted-foreground/60 data-[state=on]:bg-primary/15 data-[state=on]:text-foreground data-[state=on]:no-underline data-[state=on]:ring-1 data-[state=on]:ring-primary/50",
        solid: "bg-muted data-[state=on]:bg-primary data-[state=on]:text-primary-foreground",
      },
    },
    defaultVariants: {
      variant: "chip",
    },
  },
);

function Toggle({
  className,
  variant = "chip",
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return <TogglePrimitive.Root data-slot="toggle" className={cn(toggleVariants({ variant, className }))} {...props} />;
}

export { Toggle, toggleVariants };
