# The deployer

Whatever lands on `main` deploys itself. The `deployer` service in `compose.yaml` runs on kiwi next to the rest of the stack. Every minute it fetches `main` from the public repo over https (no credentials, nothing on GitHub can reach kiwi), and when `main` has moved past the last deployed commit it checks that commit out and runs its `deploy/run.mjs`.

- `loop.sh` is the loop, baked into the image. Keep it small: changing it, `Dockerfile` or the `deployer` block in `compose.yaml` means rebuilding the deployer by hand (below).
- `run.mjs` is the deploy itself. It's read from the commit being deployed, so it ships with `main` and needs no rebuild.

A deploy, in this order (Convex functions go live before the web app; see "Order of changes" in AGENTS.md):

1. waits for Convex to answer at `http://convex:3210`;
2. `npm ci` in its own checkout (on the `deployer` volume, with the npm cache);
3. `npx convex deploy -y` against the local backend, with the admin key from `secrets/admin_key`;
4. rsyncs the checkout into `~/Services/group53`, leaving `secrets/`, `.env*`, `deploy-status.json` and build output alone;
5. `docker compose up -d --build web og stonks`;
6. prunes the stack's untagged images and build cache older than a week;
7. checks `/`, `/version.json` and `/sw.js` on `https://group53.shlokbhakta.dev` answer 200;
8. if the web image changed, checks `/version.json` names a new build, which is what makes phones show "Updating". A commit that doesn't touch anything the web image is built from (only `stonks/`, `og/` or `e2e/`, say) keeps the same build, and phones don't reload.

The deployer never rebuilds or restarts itself: compose would kill the process doing the work. When a deploy brings a new `deploy/Dockerfile`, `deploy/loop.sh` or `deployer` service, the log says so in yellow and `deploy-status.json` lists it under `deployerOutdated`. Rebuild it by hand once that deploy is ok.

## Watching it

```sh
ssh kiwi 'cd Services/group53 && docker compose logs -f --tail 200 deployer'   # every deploy, step by step
ssh kiwi 'cat Services/group53/deploy-status.json'                             # the last one: sha, state, step, error
```

`deploy-status.json` has `state` (`running`, `ok` or `failed`), the `step` it reached, the `error`, the build IDs before and after, and the times.

## When a deploy fails

A commit that failed isn't tried again on its own; the deployer waits for the next commit on `main`.

- **Fix forward or revert:** push a fix or `git revert` the bad commit on `main`. The next commit deploys within a minute or two.
- **Retry the same commit** (kiwi was busy, the network blipped, Convex was restarting): `ssh kiwi 'cd Services/group53 && docker compose restart deployer'`. A restart tries the latest `main` once more. A deploy in progress is allowed to finish before the container stops (`stop_grace_period`).
- A failure after step 3 means the new Convex functions are live but the web app may still be the old one. That's the safe direction (see "Order of changes"), but don't leave it: fix it or revert.

## Installing it on kiwi (once)

The stack directory is a copy, not a checkout, so the first time the deployer's files go over by hand. This can happen before the branch that adds the deployer is merged: until `main` has `deploy/run.mjs`, the deployer logs that it's waiting and deploys the first `main` that does. From this repo, on the commit that has `deploy/`:

```sh
ssh -o BatchMode=yes kiwi true
rsync -a compose.yaml kiwi:Services/group53/compose.yaml
rsync -a --delete deploy/ kiwi:Services/group53/deploy/
ssh kiwi 'cd Services/group53 && docker compose config --quiet && docker compose up -d --build deployer'
ssh kiwi 'cd Services/group53 && docker compose logs -f deployer'
```

`docker compose up -d --build deployer` only creates the deployer; the services that are already running are left alone. With no record of a deploy yet, its first run deploys whatever `main` is (if `main` has `run.mjs`).

The service assumes kiwi's layout: the stack at `/home/shlok/Services/group53`, mounted at that same path inside the container so the bind mounts and build contexts compose hands the Docker daemon are real host paths, and the Docker socket owned by group 988. If either changes, set `STACK_DIR` or `DOCKER_GID` in the stack's `.env`.

## Rebuilding the deployer

After a change to `deploy/Dockerfile`, `deploy/loop.sh` or the `deployer` service has deployed (the stack directory then has the new files):

```sh
ssh kiwi 'cd Services/group53 && docker compose up -d --build deployer'
```

## Trying it without touching anything

`DRY_RUN=1` fetches and decides for real, then prints every command a deploy would run instead of running it, and keeps its own record (`/work/state/deployed-dry`). Against a scratch stack directory with a `compose.yaml` and a `.env` (`INSTANCE_SECRET=x`, `STACK_DIR=<that dir>`):

```sh
docker build -t group53-deployer deploy
docker run --rm -e DRY_RUN=1 -e INTERVAL=5 -e STACK_DIR=/tmp/stack -v /tmp/stack:/tmp/stack group53-deployer
```

`REPO_URL` and `BRANCH` point it at another repo (a local bare one, `file:///...`, mounted in) to try new commits, a failing `run.mjs` and a commit without one.
