import { WORDS } from "./words";

let words: Set<string> | null = null;

export function isWord(word: string) {
  words ??= new Set(WORDS.split("\n"));
  return words.has(word.toLowerCase());
}
