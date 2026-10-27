#!/usr/bin/env bash
# Ships Group 53 to kiwi: backend first, then the web app and preview service, then tidies up.
#   npm run deploy            # needs a clean, committed tree
#   npm run deploy -- --dirty # ship uncommitted changes anyway
# Removing or renaming a Convex function? Ship the frontend that stops using it first (see AGENTS.md).
set -euo pipefail
cd "$(dirname "$0")/.."

HOST=kiwi
DIR=Services/group53
SITE=https://group53.shlokbhakta.dev

if [[ "${1:-}" != "--dirty" ]] && [[ -n "$(git status --porcelain)" ]]; then
  echo "Uncommitted changes. Commit them, or run with --dirty." >&2
  git status --short >&2
  exit 1
fi

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

liveBuild() { curl -s "$SITE/version.json?t=$(date +%s%N)" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p'; }
before=$(liveBuild || true)

step "Backend: Convex functions"
npx convex deploy -y
echo "Backend deployed."

step "Copying the repo to $HOST:$DIR"
# --delete keeps kiwi's copy identical to this one; excluded paths (secrets, env files) are left alone.
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude .git --exclude secrets --exclude '.env*' \
  --exclude .convex --exclude e2e/.state --exclude test-results --exclude playwright-report \
  ./ "$HOST:$DIR/"

step "Rebuilding web and og on $HOST"
ssh "$HOST" "cd $DIR && docker compose up -d --build web og"

step "Cleaning up old images"
# Each rebuild leaves the previous image behind untagged. Only ours, plus build cache older than a week.
ssh "$HOST" 'docker image prune -f --filter label=com.docker.compose.project=group53 | tail -1; docker builder prune -f --filter until=168h | tail -1'

step "Checking the site"
for path in / /version.json /sw.js; do
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE$path" || true)
    [[ "$code" == 200 ]] && break
    sleep 2
  done
  echo "$path $code"
  [[ "$code" == 200 ]] || { echo "Site check failed for $path" >&2; exit 1; }
done

# Phones update when /version.json names a build other than the one they run, so a deploy only counts once
# a new ID is being served.
step "Checking phones will update"
after=""
for _ in $(seq 1 30); do
  after=$(liveBuild || true)
  [[ -n "$after" && "$after" != "$before" ]] && break
  sleep 2
done
if [[ -z "$after" || "$after" == "$before" ]]; then
  echo "Still serving build ${before:-?}: the new web build isn't live, so phones won't update." >&2
  exit 1
fi
echo "Build ${before:-none} -> $after. Phones show Updating within a minute, or as soon as they're opened."
echo "Live: {\"id\":\"$after\"}"
