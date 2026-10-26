#!/usr/bin/env bash
# Rebuilds convex/scrabble/words.ts from the ENABLE word list.
set -euo pipefail
cd "$(dirname "$0")/.."
src=$(mktemp)
curl -sSL https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt -o "$src"
{
  printf '// The word list: ENABLE (public domain, the list Words With Friends started from), plus qi, za, ok and ew.\n'
  printf '// Lowercase, one word per line, up to 21 letters (the big board). Server-only: never import it from src/.\n'
  printf '// Regenerate with scripts/gen-words.sh.\nexport const WORDS = "'
  (tr -d '\r' < "$src"; printf 'qi\nza\nok\new\n') | awk 'length($0)<=21' | sort -u | tr '\n' '|' | sed 's/|$//' | sed 's/|/\\n/g'
  printf '";\n'
} > convex/scrabble/words.ts
rm "$src"
