import type { AriaAttributes, ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const HEIGHT = { sm: "min-h-[52px]", md: "min-h-14", lg: "min-h-16" } as const;

type Props = {
  leading?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
  size?: keyof typeof HEIGHT;
  selected?: boolean;
  className?: string;
} & AriaAttributes &
  (
    | { to: string; onClick?: never; disabled?: never }
    | { onClick: () => void; to?: never; disabled?: boolean }
    | { to?: never; onClick?: never; disabled?: never }
  );

export function ListRow({ leading, title, detail, trailing, size = "md", selected, className, to, onClick, disabled, ...rest }: Props) {
  const cls = cn(HEIGHT[size], selected && "bg-primary/8", className);
  const inner = (
    <>
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{title}</span>
        {detail && <span className="block truncate text-footnote text-muted-foreground">{detail}</span>}
      </span>
      {trailing}
    </>
  );
  if (to)
    return (
      <Button {...rest} asChild variant="row" size="row" className={cls}>
        <Link to={to}>{inner}</Link>
      </Button>
    );
  if (onClick)
    return (
      <Button {...rest} variant="row" size="row" className={cls} onClick={onClick} disabled={disabled}>
        {inner}
      </Button>
    );
  return (
    <div {...rest} className={cn("flex w-full items-center gap-3 px-4 py-2 text-left", cls)}>
      {inner}
    </div>
  );
}
