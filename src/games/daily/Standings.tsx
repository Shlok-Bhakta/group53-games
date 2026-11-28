import { useMutation, useQuery } from "convex/react";
import { TrashIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ListRow } from "@/components/ListRow";
import { PlayerAvatar, type Face } from "@/components/PlayerAvatar";
import { RankTile } from "@/components/parts";
import { ConfirmButton } from "@/components/ConfirmButton";
import { IconButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type Entry = {
  _id: Id<"dailyResults">;
  userId: Id<"users">;
  display: string;
  grid: string | null;
  solved: boolean;
  place: number;
};

export function useFaces() {
  const crew = useQuery(api.profiles.crew);
  return new Map<string, Face>((crew ?? []).map((p) => [p._id, p]));
}

export function Standings({
  label,
  entries,
  meId,
  removable,
}: {
  label: string;
  entries: Entry[];
  meId: Id<"users"> | undefined;
  removable?: boolean;
}) {
  const faces = useFaces();
  const remove = useMutation(api.daily.remove);
  const trashColumn = removable && entries.some((e) => e.userId === meId);
  return (
    <ol data-slot="card" aria-label={label} className="divide-y divide-border overflow-hidden rounded-lg bg-card">
      {entries.map((e) => {
        const face = faces.get(e.userId);
        const mine = e.userId === meId;
        return (
          <li key={e._id} data-entry={mine ? "mine" : "theirs"}>
            <ListRow
              selected={mine}
              leading={
                <>
                  <RankTile rank={entries.length > 1 ? e.place : null} />
                  <PlayerAvatar player={face} name={face?.name ?? "Player"} size={34} />
                </>
              }
              title={mine ? "You" : (face?.name ?? "Player")}
              detail={e.grid && <span className="whitespace-normal tracking-tight">{e.grid}</span>}
              trailing={
                <span className="flex items-center gap-1">
                  <span className={cn("font-display text-heading tabular-nums", !e.solved && "text-muted-foreground")}>{e.display}</span>
                  {trashColumn && !mine && <span aria-hidden className="-mr-2 size-11" />}
                  {mine && removable && (
                    <ConfirmButton
                      trigger={
                        <IconButton label="Remove my result" className="-mr-2 text-muted-foreground">
                          <TrashIcon weight="bold" />
                        </IconButton>
                      }
                      title="Remove your result?"
                      detail="You can paste it again after."
                      keep="Keep it"
                      confirm="Remove"
                      onConfirm={() => remove({ id: e._id })}
                    />
                  )}
                </span>
              }
            />
          </li>
        );
      })}
    </ol>
  );
}
