import { Link } from "react-router";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { Tiles } from "@/Tiles";
import { Button } from "@/components/ui/button";
import { BackHeader } from "@/components/AppHeader";

export function Wordle() {
  return (
    <div className="flex flex-col gap-5">
      <BackHeader
        title="PvP Wordle"
        back={
          <Button variant="ghost" size="icon" asChild aria-label="Back to games">
            <Link to="/">
              <ArrowLeftIcon size={24} weight="bold" />
            </Link>
          </Button>
        }
      />
      <Tiles word="SOON" states={["gray", "gray", "yellow", "gray"]} flip />
      <p className="text-muted-foreground">The rules are still being argued about. Check back soon.</p>
    </div>
  );
}
