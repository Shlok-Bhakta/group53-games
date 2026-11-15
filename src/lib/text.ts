import { reasonOf } from "../../convex/modes";

export const reasonText = (reason: string, mode: string) => reasonOf(reason, mode).label;

export function listNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "nobody";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
