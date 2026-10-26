import { WORDS } from "./words";

// Built on first use and kept for as long as the isolate lives.
let words: Set<string> | null = null;

export function isWord(word: string) {
  words ??= new Set(WORDS.split("\n"));
  return words.has(word.toLowerCase());
}
