import type { ReactNode } from "react";
import { CaretRightIcon, type Icon } from "@phosphor-icons/react";
import { ListRow } from "@/components/ListRow";
import { TINT_GLYPH } from "./palette";

export function SettingsIcon({ icon: TileIcon, tint }: { icon: Icon; tint: string }) {
  return (
    <span className="grid size-[30px] shrink-0 place-items-center rounded-sm" style={{ background: tint, color: TINT_GLYPH }}>
      <TileIcon size={18} weight="fill" />
    </span>
  );
}

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
    leading: <SettingsIcon icon={RowIcon} tint={tint} />,
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
