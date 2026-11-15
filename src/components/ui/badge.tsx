import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "group/badge inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-footnote font-bold whitespace-nowrap [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground",
        live: "bg-tile-hit text-[var(--tile-hit-ink)]",
        win: "bg-tile-green text-tile-ink",
        quiet: "px-0 font-medium text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "primary",
    },
  },
);

function Badge({
  className,
  variant = "primary",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";
  return <Comp data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
