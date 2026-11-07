import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "convex/react";
import { ChartLineUpIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import { api } from "../../convex/_generated/api";
import { LargeTitle } from "@/components/AppHeader";
import { CardEditor } from "@/components/CardEditor";
import { PlayerCard } from "@/components/PlayerCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountGroup } from "./you/AccountGroup";
import { AppearanceGroup } from "./you/AppearanceGroup";
import { NotificationsGroup } from "./you/NotificationsGroup";
import { SoundGroup } from "./you/SoundGroup";

export function You() {
  const mine = useQuery(api.profiles.mine);
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex flex-col gap-7">
      <div>
        <LargeTitle title="You" />
        {mine ? <PlayerCard player={mine} online size="hero" /> : <Skeleton className="aspect-[5/6] rounded-lg" />}
        <Button size="xl" variant="secondary" className="mt-3 w-full" onClick={() => setEditing(true)} disabled={!mine}>
          <PencilSimpleIcon weight="bold" /> Edit card
        </Button>
        {mine && (
          <Button size="xl" variant="secondary" className="mt-2.5 w-full" asChild>
            <Link to={`/stonks/u/${mine._id}`}>
              <ChartLineUpIcon weight="bold" /> Stonks profile
            </Link>
          </Button>
        )}
      </div>

      {mine && <CardEditor open={editing} onOpenChange={setEditing} player={mine} />}

      <NotificationsGroup />
      <SoundGroup />
      <AppearanceGroup />
      <AccountGroup />
    </div>
  );
}
