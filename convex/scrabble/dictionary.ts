import { EXPANDED, WORDS } from "./words";

let words: Set<string> | null = null;
let expanded: Set<string> | null = null;

export function isWord(word: string, wide = false) {
  const lower = word.toLowerCase();
  words ??= new Set(WORDS.split("\n"));
  if (words.has(lower)) return true;
  if (!wide) return false;
  expanded ??= new Set(EXPANDED.split("\n"));
  return expanded.has(lower);
}
