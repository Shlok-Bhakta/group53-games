import { Tiles } from "@/Tiles";
import { NavBar } from "@/components/AppHeader";

export function Wordle() {
  return (
    <div className="flex flex-col gap-5">
      <NavBar title="PvP Wordle" />
      <Tiles word="SOON" states={["gray", "gray", "yellow", "gray"]} flip />
      <p className="text-callout text-muted-foreground">The rules are still being argued about. Check back soon.</p>
    </div>
  );
}
