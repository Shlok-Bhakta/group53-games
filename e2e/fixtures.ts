import { test as base, devices, expect, type BrowserContext, type BrowserContextOptions, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { anyApi, type FunctionReference } from "convex/server";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const STATE_FILE = path.resolve("e2e/.state/backend.json");

type State = { url: string; adminKey: string };
const state = (): State => JSON.parse(readFileSync(STATE_FILE, "utf8"));

// --- The admin client -----------------------------------------------------------------------------

// Every call on its own connection. Pooled keep-alive sockets were sometimes closed by the backend just
// as a call went out on one, which failed the call with "fetch failed" though the backend was fine.
const closingFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("connection", "close");
  return fetch(input, { ...init, headers });
};

const failedToFetch = (e: unknown) => e instanceof Error && /fetch failed/.test(e.message);
// Only a call that never reached the backend is safe to send again whatever it does.
const neverSent = (e: unknown) => {
  const code = (e as { cause?: { code?: string } }).cause?.code;
  return failedToFetch(e) && (code === "ECONNREFUSED" || code === "UND_ERR_CONNECT_TIMEOUT");
};

async function retrying<T>(call: () => Promise<T>, again: (e: unknown) => boolean): Promise<T> {
  try {
    return await call();
  } catch (e) {
    if (!again(e)) throw e;
    await new Promise((r) => setTimeout(r, 200));
    return await call();
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Admin = {
  query(fn: FunctionReference<"query", any>, args?: Record<string, unknown>): Promise<any>;
  mutation(fn: FunctionReference<"mutation", any>, args?: Record<string, unknown>): Promise<any>;
  action(fn: FunctionReference<"action", any>, args?: Record<string, unknown>): Promise<any>;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

let cached: { url: string; admin: Admin } | null = null;

// The throwaway backend with its admin key, which can call internal functions (convex/testing.ts and
// the sidecar's). One client for the whole run. Queries are retried once if the request fails; mutations
// and actions only when it never got out, since running one twice isn't always harmless.
export function admin(): Admin {
  const { url, adminKey } = state();
  if (cached?.url === url) return cached.admin;
  const http = new ConvexHttpClient(url, { fetch: closingFetch });
  (http as unknown as { setAdminAuth: (k: string) => void }).setAdminAuth(adminKey);
  const client: Admin = {
    query: (fn, args = {}) => retrying(() => http.query(fn, args), failedToFetch),
    mutation: (fn, args = {}) => retrying(() => http.mutation(fn, args), neverSent),
    action: (fn, args = {}) => retrying(() => http.action(fn, args), neverSent),
  };
  cached = { url, admin: client };
  return client;
}

export const getMatch = (id: string) => admin().query(anyApi.testing.getMatch, { id });

// The match a game screen (/chess/:id, /scrabble/:id?accept=1...) is showing.
export const matchIdOf = (page: Page) => new URL(page.url()).pathname.split("/")[2];

export type Player = { userId: string; token: string; refreshToken: string; name: string };

export async function createPlayer(name: string, profile: Record<string, unknown> = {}): Promise<Player> {
  const p = await admin().action(anyApi.testing.createPlayer, { name, ...profile });
  return { ...p, name };
}

// --- Phones -------------------------------------------------------------------------------------

export type PhoneOptions = {
  installed?: boolean;
  player?: Player;
  // "default" leaves notifications off; "granted" also fakes a working push subscription.
  notifications?: "default" | "granted" | "denied";
  colorScheme?: "light" | "dark";
  // A push subscription this phone already has (and the server knows about): push is on from the start.
  pushEndpoint?: string;
};

// An iPhone-sized Chromium page that looks like the installed PWA, optionally signed in.
export async function phone(context: BrowserContext, opts: PhoneOptions = {}): Promise<Page> {
  const { url } = state();
  const ns = url.replace(/[^a-zA-Z0-9]/g, "");
  await context.addInitScript(
    ([installed, ns, token, refresh, notifications, endpoint]) => {
      if (installed) Object.defineProperty(navigator, "standalone", { get: () => true });
      // src/sound.ts logs every effect it's asked to play here, so tests can hear them.
      (window as unknown as { __sfx: string[] }).__sfx = [];
      // Once per tab, so a reload (or signing out) keeps what the app did with it since.
      if (!sessionStorage.getItem("e2e-seeded")) {
        if (token) {
          localStorage.setItem(`__convexAuthJWT_${ns}`, token);
          localStorage.setItem(`__convexAuthRefreshToken_${ns}`, refresh);
        }
        if (endpoint) {
          localStorage.setItem("e2e-push-endpoint", endpoint);
          localStorage.setItem("e2e-push-permission", "granted");
        }
        sessionStorage.setItem("e2e-seeded", "1");
      }

      // Convex's traffic on this page, so tests can wait until every query on screen has its answer and
      // nothing's in flight instead of guessing how long that takes (see convexIdle).
      type Net = { open: number; last: number; sent: number; acked: number; inflight: Set<string>; chunks: string[] };
      const net: Net = { open: 0, last: 0, sent: 0, acked: 0, inflight: new Set(), chunks: [] };
      (window as unknown as { __convexNet: Net }).__convexNet = net;
      const onServer = (msg: { type?: string; requestId?: string; endVersion?: { querySet: number }; chunk?: string; partNumber?: number; totalParts?: number }) => {
        if (msg.type === "TransitionChunk") {
          net.chunks[msg.partNumber!] = msg.chunk!;
          if (net.chunks.filter((c) => c !== undefined).length < msg.totalParts!) return;
          const whole = net.chunks.join("");
          net.chunks = [];
          return onServer(JSON.parse(whole));
        }
        if (msg.type === "Transition") net.acked = Math.max(net.acked, msg.endVersion?.querySet ?? 0);
        if (msg.type === "MutationResponse" || msg.type === "ActionResponse") net.inflight.delete(String(msg.requestId));
      };
      const Real = window.WebSocket;
      class Tracked extends Real {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          this.addEventListener("open", () => void net.open++);
          this.addEventListener("close", () => {
            net.open--;
            // A new connection starts its queries over from version 0, and resends what was in flight.
            net.sent = net.acked = 0;
            net.inflight.clear();
          });
          this.addEventListener("message", (e) => {
            net.last = performance.now();
            try {
              if (typeof e.data === "string") onServer(JSON.parse(e.data));
            } catch {}
          });
        }
        send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
          try {
            const msg = typeof data === "string" ? JSON.parse(data) : null;
            if (msg?.type === "ModifyQuerySet") net.sent = Math.max(net.sent, msg.newVersion);
            if (msg?.type === "Mutation" || msg?.type === "Action") net.inflight.add(String(msg.requestId));
          } catch {}
          super.send(data);
        }
      }
      window.WebSocket = Tracked as unknown as typeof WebSocket;

      // Headless Chromium has no push service, so stand in a fake one. Like a real phone, the
      // subscription and permission survive reloads.
      let permission = (localStorage.getItem("e2e-push-permission") ?? notifications) as NotificationPermission;
      const makeSub = (endpoint: string) =>
        ({
          endpoint,
          getKey: () => new Uint8Array([1, 2, 3]).buffer,
          unsubscribe: async () => {
            localStorage.removeItem("e2e-push-endpoint");
            sub = null;
            return true;
          },
        }) as unknown as PushSubscription;
      const saved = localStorage.getItem("e2e-push-endpoint");
      let sub: PushSubscription | null = saved ? makeSub(saved) : null;
      const subscribe = async () => {
        const endpoint = `https://push.example.com/${Math.random().toString(36).slice(2)}`;
        localStorage.setItem("e2e-push-endpoint", endpoint);
        return (sub = makeSub(endpoint));
      };
      class FakeNotification {
        static get permission() {
          return permission;
        }
        static async requestPermission() {
          if (permission === "default") permission = "granted";
          localStorage.setItem("e2e-push-permission", permission);
          return permission;
        }
      }
      Object.defineProperty(window, "Notification", { value: FakeNotification, configurable: true });
      Object.defineProperty(window, "PushManager", { value: function PushManager() {}, configurable: true });
      const reg = {
        pushManager: {
          getSubscription: async () => sub,
          subscribe,
        },
      };
      // An event target, so tests can deliver the messages public/sw.js posts on a notification tap.
      const sw = Object.assign(new EventTarget(), { ready: Promise.resolve(reg), register: async () => reg, startMessages() {} });
      Object.defineProperty(navigator, "serviceWorker", { value: sw, configurable: true });
    },
    [opts.installed ?? true, ns, opts.player?.token ?? "", opts.player?.refreshToken ?? "", opts.notifications ?? "default", opts.pushEndpoint ?? ""] as const,
  );
  return await context.newPage();
}

export const iPhone = { ...devices["iPhone 15 Pro"], browserName: "chromium" as const, defaultBrowserType: "chromium" as const };
// What every phone after a test's first gets (the first is the test's own context, from the config).
const OTHER_PHONE: BrowserContextOptions = { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true };

export type OpenOptions = PhoneOptions & {
  // "on": push is already on for this phone, so games are unlocked from the first screen. Only the
  // tests about the gate itself turn it on through the UI (enablePush).
  push?: "on";
  // Plays every animation's end at once: the poker table jumps straight to where the show ends.
  reducedMotion?: boolean;
  // Its own browser context with these options (a different phone or browser).
  context?: BrowserContextOptions;
};

export type Phones = {
  // A phone for this test. The first one is the test's own context; each after it gets its own, and all
  // of them close when the test ends, however it ends.
  open(opts?: OpenOptions): Promise<Page>;
};

async function seedPush(player: Player) {
  const endpoint = `https://push.example.com/${randomBytes(6).toString("hex")}`;
  await admin().mutation(anyApi.testing.seedPush, { userId: player.userId, endpoint });
  return endpoint;
}

// Turns push on the way a player would; game screens stay locked until it's on.
export async function enablePush(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Turn on notifications" }).click();
  await expect(page.getByText("Turn on notifications to play")).toHaveCount(0);
}

// --- Waiting for the screen ---------------------------------------------------------------------

// Every query the page has asked Convex for has its answer, and no mutation or action is waiting on one.
export async function convexIdle(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const n = (window as unknown as { __convexNet?: { open: number; sent: number; acked: number; inflight: Set<string> } }).__convexNet;
          return !!n && n.open > 0 && n.acked >= n.sent && n.inflight.size === 0;
        }),
      { message: "Convex has answered everything the page asked for" },
    )
    .toBe(true);
}

// Nothing on screen is moving: no finite animation running and every control where it was a frame
// later. Looping ones (card frames, live dots) are left out, since they never end.
export async function holdsStill(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const running = document.getAnimations().some((a) => a.playState === "running" && a.effect?.getTiming().iterations !== Infinity);
          const layout = () => [...document.querySelectorAll("button, a, h1, h2, [role=img]")].map((el) => {
            const r = el.getBoundingClientRect();
            return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`;
          }).join(" ");
          const before = layout();
          await new Promise((r) => setTimeout(r, 120));
          return !running && layout() === before;
        }),
      { message: "the screen holds still" },
    )
    .toBe(true);
}

// A tab or screen that has finished arriving: its title is up, nothing's loading, Convex has answered,
// and it's stopped moving.
export async function ready(page: Page) {
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(page.locator("[aria-busy=true], [data-slot=skeleton]")).toHaveCount(0);
  await convexIdle(page);
  await holdsStill(page);
}

// The screen on top of the stack. While one slides away it's still drawn (and found by text and CSS
// locators), but it's inert: role locators already skip it, and this skips it for the rest.
export const onScreen = (page: Page) => page.locator("[data-screen]:not([inert])");

// --- Games --------------------------------------------------------------------------------------

export async function resign(page: Page) {
  await page.getByRole("button", { name: "Resign" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Resign" }).click();
}

// The host opens a lobby for a game the host starts (Scrabble, Poker), choosing settings on the mode
// page first: radio group name to option name, as on the screen.
export async function openLobby(host: Page, game: string, mode: string, settings: Record<string, string> = {}) {
  await host.goto(`/${game}/mode/${mode}`);
  if (Object.keys(settings).length) {
    await host.getByRole("button", { name: "Settings" }).click();
    for (const [group, option] of Object.entries(settings)) await host.getByRole("radiogroup", { name: group }).getByRole("radio", { name: option, exact: true }).click();
  }
  await host.getByRole("button", { name: "Open a game" }).click();
  await expect(host.getByRole("heading", { name: "Waiting for players" })).toBeVisible();
  return matchIdOf(host);
}

// Everyone else takes a seat through the link a push carries, then the host starts the game.
export async function fillLobby(host: Page, guests: Page[]) {
  const id = matchIdOf(host);
  const game = new URL(host.url()).pathname.split("/")[1];
  for (const [i, guest] of guests.entries()) {
    await guest.goto(`/${game}/${id}?accept=1`);
    await expect(host.getByRole("heading", { name: `${i + 2} in` })).toBeVisible();
  }
  await host.getByRole("button", { name: `Start with ${guests.length + 1}` }).click();
}

// A real-time chess game already under way on two phones, the countdown over. Fast settings make a test
// that has to wait out travel and cooldowns quicker (Cooldown and Piece speed, as in convex/modes.ts).
export async function realtimePair(phones: Phones, settings?: { cooldown?: number; speed?: number }) {
  const [shlok, chris] = await Promise.all([createPlayer("Shlok"), createPlayer("Chris")]);
  const id: string = await admin().action(anyApi.testing.startMatch, { mode: "chess:realtime", a: shlok.userId, b: chris.userId, settings });
  // startMatch seats its first player as white.
  const [white, black] = await Promise.all([phones.open({ player: shlok, push: "on" }), phones.open({ player: chris, push: "on" })]);
  await Promise.all([white.goto(`/chess/${id}`), black.goto(`/chess/${id}`)]);
  for (const p of [white, black]) await expect(p.getByRole("grid", { name: "Real-time chess board" })).toHaveAttribute("data-playing", "true", { timeout: 15_000 });
  return { id, white, black, whitePlayer: shlok, blackPlayer: chris };
}

// Polls until the value stops changing (the same over `window` ms), and returns it: for counting what a
// burst of taps made once the last of them has landed.
export async function settled<T>(read: () => Promise<T>, window = 600): Promise<T> {
  let last = JSON.stringify(await read());
  let since = Date.now();
  for (const end = Date.now() + 10_000; Date.now() < end; ) {
    await new Promise((r) => setTimeout(r, 150));
    const value = await read();
    const now = JSON.stringify(value);
    if (now !== last) [last, since] = [now, Date.now()];
    else if (Date.now() - since >= window) return value;
  }
  throw new Error(`Never settled: ${last}`);
}

// --- The test -----------------------------------------------------------------------------------

export const test = base.extend<{ resetDb: void; phones: Phones }>({
  resetDb: [
    async ({}, use) => {
      while (!(await admin().mutation(anyApi.testing.reset, {})).done);
      await use();
    },
    { auto: true },
  ],
  phones: async ({ browser, context }, use) => {
    const owned: BrowserContext[] = [];
    let first = true;
    await use({
      async open(opts = {}) {
        let ctx = context;
        if (!first || opts.context) {
          ctx = await browser.newContext({ ...OTHER_PHONE, ...opts.context });
          owned.push(ctx);
        }
        if (!opts.context) first = false;
        const endpoint = opts.push === "on" ? await seedPush(opts.player!) : undefined;
        const page = await phone(ctx, { notifications: opts.push === "on" ? "granted" : undefined, ...opts, pushEndpoint: endpoint });
        if (opts.reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" });
        return page;
      },
    });
    await Promise.all(owned.map((c) => c.close().catch(() => {})));
  },
});
export { expect };
