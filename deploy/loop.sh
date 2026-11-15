#!/bin/sh
# The deployer's loop (deploy/README.md). Every INTERVAL seconds it fetches main from the public repo, and when
# main has moved past the last deployed commit it checks that commit out and runs its own deploy/run.mjs, so the
# deploy logic ships with main. Keep this file small: changing it means rebuilding the deployer by hand.
set -u

REPO_URL=${REPO_URL:-https://github.com/Shlok-Bhakta/group53-games.git}
BRANCH=${BRANCH:-main}
INTERVAL=${INTERVAL:-60}
REPO=/work/repo
STATE=/work/state

# A dry run keeps its own record, so trying one never marks a commit as deployed.
deployed_file=$STATE/deployed
[ "${DRY_RUN:-0}" = 1 ] && deployed_file=$STATE/deployed-dry

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) deployer: $*"; }

# docker stop during a deploy waits for it to finish (traps run once the foreground command is done).
trap 'log "stopping"; exit 0' TERM INT

mkdir -p "$STATE" "$HOME"
if [ ! -d "$REPO/.git" ]; then
  git init -q "$REPO" && git -C "$REPO" remote add origin "$REPO_URL"
fi
git -C "$REPO" remote set-url origin "$REPO_URL"

log "watching $REPO_URL $BRANCH every ${INTERVAL}s; last deployed: $(cat "$deployed_file" 2>/dev/null || echo none)"

# The commit tried since this container started. A failed one isn't retried until main moves or the deployer restarts.
tried=""
fetch_failing=""
while :; do
  if git -C "$REPO" fetch -q --depth 1 origin "$BRANCH" 2>"$STATE/fetch.err"; then
    [ -n "$fetch_failing" ] && log "fetching works again"
    fetch_failing=""
    sha=$(git -C "$REPO" rev-parse FETCH_HEAD)
    deployed=$(cat "$deployed_file" 2>/dev/null || true)
    if [ "$sha" != "$deployed" ] && [ "$sha" != "$tried" ]; then
      tried=$sha
      if ! git -C "$REPO" checkout -q -f --detach "$sha" || ! git -C "$REPO" clean -q -ffdx -e node_modules; then
        log "couldn't check out $sha"
      elif [ ! -f "$REPO/deploy/run.mjs" ]; then
        log "$sha has no deploy/run.mjs yet; waiting for a $BRANCH that does"
      else
        log "deploying $sha: $(git -C "$REPO" log -1 --format=%s)"
        if (cd "$REPO" && DEPLOY_SHA=$sha node deploy/run.mjs); then
          echo "$sha" >"$deployed_file"
          log "deployed $sha"
        else
          log "deploy of $sha failed; waiting for the next commit on $BRANCH (or restart the deployer to retry it)"
        fi
      fi
    fi
  else
    [ -z "$fetch_failing" ] && log "fetch failed, will keep trying: $(tr '\n' ' ' <"$STATE/fetch.err")"
    fetch_failing=1
  fi
  sleep "$INTERVAL" &
  wait $!
done
