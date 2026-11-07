import type { AriaAttributes, ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

const HEIGHT = { sm: "min-h-[52px]", md: "min-h-14", lg: "min-h-16" } as const;

type Props = {
  // An avatar, an icon tile or a rank, at the start.
  leading?: ReactNode;
  title: ReactNode;
  // One line under the title: a mode, a record, a time.
  detail?: ReactNode;
  // A chip, a value, a control or a spinner at the end.
  trailing?: ReactNode;
  size?: keyof typeof HEIGHT;
  // Me, or what's picked.
  selected?: boolean;
  className?: string;
} & AriaAttributes & // an aria-label or aria-pressed, for a row that needs one
  ({ to: string; onClick?: never; disabled?: never } | { onClick: () => void; to?: never; disabled?: boolean } | { to?: never; onClick?: never; disabled?: never });

// One row in a Group: what's at the start, a title with a line under it, and what's at the end. With `to` it's a
// link and with `onClick` a button, both pressing in; with neither, it's just a row. Anything else a wrapper
// hands it (a dialog trigger's ref and aria) goes on the element.
export function ListRow({ leading, title, detail, trailing, size = "md", selected, className, to, onClick, disabled, ...rest }: Props) {
  const action = { to, onClick, disabled };
  const cls = cn("flex w-full items-center gap-3 px-4 py-2 text-left", HEIGHT[size], selected && "bg-primary/8", (action.to || action.onClick) && "touch-manipulation transition-colors active:bg-muted disabled:opacity-60", className);
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
  if (action.to)
    return (
      <Link {...rest} to={action.to} className={cls}>
        {inner}
      </Link>
    );
  if (action.onClick)
    return (
      <button type="button" {...rest} className={cls} onClick={action.onClick} disabled={action.disabled}>
        {inner}
      </button>
    );
  return <div {...rest} className={cls}>{inner}</div>;
}
