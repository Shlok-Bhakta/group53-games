import type { ReactNode } from "react";
import { CaretRightIcon, type Icon } from "@phosphor-icons/react";
import { ListRow } from "@/components/ListRow";

// The icon tiles are colored like iOS Settings on purpose, the same in every theme, with a white glyph.
export const TINT = {
  red: "#ff453a",
  green: "#30d158",
  purple: "#bf5af2",
  orange: "#ff9f0a",
  gray: "#8e8e93",
  cyan: "#64d2ff",
} as const;

// An iOS settings row: tinted icon tile, label, then a control, a value with a chevron, or nothing.
export function SettingsRow({
  icon: RowIcon,
  tint,
  label,
  value,
  onClick,
  htmlFor,
  children,
}: {
  icon: Icon;
  tint: string;
  label: string;
  value?: string;
  onClick?: () => void;
  htmlFor?: string;
  children?: ReactNode;
}) {
  const row = {
    size: "sm" as const,
    leading: (
      <span className="grid size-[30px] shrink-0 place-items-center rounded-sm text-white" style={{ background: tint }}>
        <RowIcon size={18} weight="fill" />
      </span>
    ),
    title: htmlFor ? (
      <label htmlFor={htmlFor} className="block font-medium">
        {label}
      </label>
    ) : (
      <span className="font-medium">{label}</span>
    ),
    trailing: (
      <>
        {value && <span className="text-callout text-muted-foreground">{value}</span>}
        {onClick && <CaretRightIcon size={16} weight="bold" className="text-muted-foreground/70" />}
        {children}
      </>
    ),
  };
  return onClick ? <ListRow {...row} onClick={onClick} /> : <ListRow {...row} />;
}
