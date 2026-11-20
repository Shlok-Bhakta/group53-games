import { Tiles } from "@/Tiles";

export function DailyBanner() {
  return <Tiles word="DAILY" states={["green", "yellow", "green", "gray", "green"]} flip label="Dailies" />;
}
