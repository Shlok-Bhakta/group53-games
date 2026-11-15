import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { SpinnerGapIcon } from "@phosphor-icons/react";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

const PRESSABLE =
  "shrink-0 justify-center rounded-md border border-transparent bg-clip-padding text-callout font-semibold whitespace-nowrap active:scale-[0.97] [&_svg:not([class*='size-'])]:size-4";

const buttonVariants = cva(
  "group/button inline-flex touch-manipulation items-center transition-[transform,background-color,color,opacity] duration-100 ease-out outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost: "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:ring-destructive dark:bg-destructive/20 dark:hover:bg-destructive/30",
        link: "text-primary underline-offset-4 hover:underline",
        card: "bg-card text-card-foreground hover:bg-[color-mix(in_oklch,var(--card),var(--foreground)_5%)]",
        float: "pointer-events-auto bg-card/90 shadow-md backdrop-blur-md",
        row: "active:bg-muted",
      },
      size: {
        default: `${PRESSABLE} h-11 gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3`,
        sm: `${PRESSABLE} h-11 gap-1.5 px-3.5 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5`,
        lg: `${PRESSABLE} h-12 gap-2 rounded-lg px-5 text-body has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4 [&_svg:not([class*='size-'])]:size-5`,
        xl: `${PRESSABLE} h-14 gap-2.5 rounded-lg px-6 text-body [&_svg:not([class*='size-'])]:size-5`,
        dock: `${PRESSABLE} h-[60px] flex-col gap-1 rounded-lg px-2 text-footnote [&_svg:not([class*='size-'])]:size-[22px]`,
        "dock-square": `${PRESSABLE} size-14 rounded-lg [&_svg:not([class*='size-'])]:size-6`,
        icon: `${PRESSABLE} size-11 rounded-full`,
        "icon-lg": `${PRESSABLE} size-12 rounded-full`,
        "icon-square": `${PRESSABLE} size-11 rounded-md active:scale-[0.94]`,
        float: "grid size-11 shrink-0 place-items-center rounded-full active:scale-[0.94]",
        pill: "flex min-h-11 min-w-0 gap-2 rounded-full text-left",
        row: "flex w-full gap-3 px-4 py-2 text-left transition-colors duration-150 focus-visible:ring-inset focus-visible:ring-offset-0 disabled:opacity-60",
        tile: "flex w-full flex-col justify-center gap-1.5 rounded-lg py-1.5 active:scale-[0.95]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    pending?: boolean;
    icon?: React.ReactNode;
  };

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  pending = false,
  icon,
  type = "button",
  disabled,
  children,
  ...props
}: ButtonProps) {
  const look = {
    "data-slot": variant === "card" ? "card" : "button",
    "data-variant": variant,
    "data-size": size,
    className: cn(buttonVariants({ variant, size, className })),
  };
  if (asChild)
    return (
      <Slot.Root {...look} {...props}>
        {children}
      </Slot.Root>
    );
  return (
    <button {...look} type={type} disabled={disabled || pending} aria-busy={pending || undefined} {...props}>
      {pending ? <SpinnerGapIcon className="animate-spin" weight="bold" /> : icon}
      {children}
    </button>
  );
}

type IconButtonProps = Omit<ButtonProps, "aria-label" | "children" | "icon"> & {
  label: string;
  children: React.ReactNode;
};

function IconButton({ label, variant = "ghost", size = "icon", children, ...props }: IconButtonProps) {
  return <Button aria-label={label} variant={variant} size={size} icon={children} {...props} />;
}

export { Button, IconButton, buttonVariants, type ButtonProps, type IconButtonProps };
