# The deployer

Whatever lands on `main` deploys itself. The `deployer` service in `compose.yaml` runs on kiwi next to the rest of the stack. Every minute it fetches `main` from the public repo over https (no credentials, nothing on GitHub can reach kiwi), and when `main` has moved past the last deployed commit it checks that commit out and runs its `deploy/run.mjs`.

- `loop.sh` is the loop, baked into the image. Keep it small: changing it, `Dockerfile` or the `deployer` block in `compose.yaml` means rebuilding the deployer by hand (below).
- `run.mjs` is the deploy itself. It's read from the commit being deployed, so it ships with `main` and needs no rebuild.

A deploy never interrupts anyone. Convex, the tunnel and the dashboard are never touched (`--no-deps`, and checked after every deploy); nginx keeps running while the app is swapped under it; og and stonks restart only when their own code changed; and phones hold the update while a game is open (`useHoldUpdates` in `src/version.tsx`), applying it once they leave the game or the app is in the background.

In this order (Convex functions go live before the web app; see "Order of changes" in AGENTS.md):

1. reads the public Convex URL from the stack's `.env` (`CONVEX_URL`, which must be https) and notes the Convex, tunnel and dashboard containers;
2. waits for Convex to answer at `http://convex:3210`;
3. `npm ci` in its own checkout (on the `deployer` volume, with the npm cache);
4. builds the app (`vite build`) against that URL with a new build ID, and stops here, deploying nothing, if the bundle talks to anything else;
5. `npx convex deploy -y` against the local backend, with the admin key from `secrets/admin_key`;
6. rsyncs the checkout into `~/Services/group53`, leaving `secrets/`, `.env*`, `site/` and `deploy-status.json` alone;
7. publishes the build in place: it goes into `site/builds/<id>`, its assets are added to `site/assets` (where every recent build's assets stay, so a phone still on the previous build can load its chunks), nginx's config goes to `site/nginx` (a graceful `nginx -s reload` if it changed), and `site/current` is swapped to the new build with an atomic rename. The web container is plain nginx serving `site/`, so it's only recreated when its own setup in `compose.yaml` changes, which happened once, when this design arrived;
8. checks `/`, `/version.json` and `/sw.js` answer 200, `/version.json` names the new build, and the live bundle talks to the public Convex URL. If anything's off, `site/current` goes straight back to the previous build and the deploy fails;
9. `docker compose up -d --no-deps --build og stonks`, which only recreates what changed;
10. checks Convex, the tunnel and the dashboard are still the same containers;
11. prunes builds past the newest five, assets older than two weeks that no kept build uses, the stack's untagged images and build cache older than a week.

Every `docker compose` it runs gets a clean environment (PATH and HOME only), so the stack's `.env` is the only thing compose's `${...}` substitutions read. The deployer's own settings are named `DEPLOY_*` so they can't collide with them: the first deploy leaked the deployer's `CONVEX_URL=http://convex:3210` into compose, which recreated Convex with that as its public origin and built the app against it.

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
- A failure after step 5 means the new Convex functions are live but the web app may still be the old one. That's the safe direction (see "Order of changes"), but don't leave it: fix it or revert.
- **Roll the site back by hand** to any build in `site/builds`: `ssh kiwi 'cd Services/group53/site && ln -sfn builds/<id> current.next && mv -T current.next current'`. It's instant and nginx keeps running.

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
