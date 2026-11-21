#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
enable=$(mktemp)
wordnik=$(mktemp)
base=$(mktemp)
curl -sSL https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt -o "$enable"
curl -sSL https://raw.githubusercontent.com/wordnik/wordlist/main/wordlist-20210729.txt -o "$wordnik"
(tr -d '\r' < "$enable"; printf 'qi\nza\nok\new\n') | awk 'length($0)<=21' | LC_ALL=C sort -u > "$base"
joined() { tr '\n' '|' | sed 's/|$//' | sed 's/|/\\n/g'; }
{
  printf '// The word lists, lowercase, one word per line, up to 21 letters (the big board). Server-only: never import it from src/.\n'
  printf '// WORDS: ENABLE (public domain, the list Words With Friends started from), plus qi, za, ok and ew.\n'
  printf '// EXPANDED: the Wordnik word list (MIT, wordlist-20210729) words not in WORDS, for the Expanded setting.\n'
  printf '// Regenerate with scripts/gen-words.sh.\nexport const WORDS = "'
  joined < "$base"
  printf '";\nexport const EXPANDED = "'
  tr -d '"\r' < "$wordnik" | grep -E '^[a-z]+$' | awk 'length($0)<=21' | LC_ALL=C sort -u | LC_ALL=C comm -23 - "$base" | joined
  printf '";\n'
} > convex/scrabble/words.ts
rm "$enable" "$wordnik" "$base"
