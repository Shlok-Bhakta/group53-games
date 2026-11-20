import { localDay } from "../../../convex/daily/days";
import { useNow } from "@/lib/time";

export function useToday() {
  const now = useNow(60_000);
  return localDay(new Date(now));
}
