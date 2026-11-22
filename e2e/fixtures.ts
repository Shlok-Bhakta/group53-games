import { test as base, devices, expect, type BrowserContext, type BrowserContextOptions, type Frame, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import {
  anyApi,
  getFunctionName,
  makeFunctionReference,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
  type FunctionType,
  type FunctionVisibility,
} from "convex/server";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const STATE_FILE = path.resolve(process.env.E2E_STATE ?? "e2e/.state/backend.json");

type State = { url: string; adminKey: string };
export const backend = (): State => JSON.parse(readFileSync(STATE_FILE, "utf8"));

// platform: the backend sometimes closed a pooled keep-alive socket just as a call went out on it ("fetch failed"), so every call gets its own connection.
const closingFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("connection", "close");
  return fetch(input, { ...init, headers });
};

const failedToFetch = (e: unknown) => e instanceof Error && /fetch failed/.test(e.message);
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

type Ref<K extends FunctionType> = FunctionReference<K, FunctionVisibility>;
type Call<K extends FunctionType> = <F extends Ref<K>>(fn: F, args?: FunctionArgs<F>) => Promise<FunctionReturnType<F>>;
export type Admin = { query: Call<"query">; mutation: Call<"mutation">; action: Call<"action"> };

// platform: ConvexHttpClient's types only take public functions, though admin auth reaches internal ones; calling by name needs no cast.
const byName = <K extends FunctionType, F extends Ref<K>>(fn: F) =>
  makeFunctionReference<K, FunctionArgs<F>, FunctionReturnType<F>>(getFunctionName(fn));

let cached: { url: string; admin: Admin } | null = null;

export function admin(): Admin {
  const { url, adminKey } = backend();
  if (cached?.url === url) return cached.admin;
  const http = new ConvexHttpClient(url, { fetch: closingFetch });
  (http as unknown as { setAdminAuth: (k: string) => void }).setAdminAuth(adminKey);
  const client: Admin = {
    query: (fn, args) => retrying(() => http.query(byName<"query", typeof fn>(fn), args ?? {}), failedToFetch),
    mutation: (fn, args) => retrying(() => http.mutation(byName<"mutation", typeof fn>(fn), args ?? {}), neverSent),
    action: (fn, args) => retrying(() => http.action(byName<"action", typeof fn>(fn), args ?? {}), neverSent),
  };
  cached = { url, admin: client };
  return client;
}

export const getMatch = (id: string) => admin().query(anyApi.testing.getMatch, { id });

export const matchIdOf = (page: Page) => new URL(page.url()).pathname.split("/")[2];

export type Player = { userId: string; token: string; refreshToken: string; name: string };

export async function createPlayer(name: string, profile: Record<string, unknown> = {}): Promise<Player> {
  const p = await admin().action(anyApi.testing.createPlayer, { name, ...profile });
  return { ...p, name };
}

export type PhoneOptions = {
  installed?: boolean;
  player?: Player;
  notifications?: "default" | "granted" | "denied";
  colorScheme?: "light" | "dark";
  pushEndpoint?: string;
};

export async function phone(context: BrowserContext, opts: PhoneOptions = {}): Promise<Page> {
  await watchForNestedCards(context);
  const { url } = backend();
  const ns = url.replace(/[^a-zA-Z0-9]/g, "");
  await context.addInitScript(
    ([installed, ns, token, refresh, notifications, endpoint]) => {
      if (installed) Object.defineProperty(navigator, "standalone", { get: () => true });
      (window as unknown as { __sfx: string[] }).__sfx = [];
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

      type Net = { open: number; last: number; sent: number; acked: number; inflight: Set<string>; chunks: string[] };
      const net: Net = { open: 0, last: 0, sent: 0, acked: 0, inflight: new Set(), chunks: [] };
      (window as unknown as { __convexNet: Net }).__convexNet = net;
      const parsed = (data: unknown) => {
        if (typeof data !== "string") return null;
        try {
          return JSON.parse(data);
        } catch {
          return null;
        }
      };
      const onServer = (msg: {
        type?: string;
        requestId?: string;
        endVersion?: { querySet: number };
        chunk?: string;
        partNumber?: number;
        totalParts?: number;
      }) => {
        if (msg.type === "TransitionChunk") {
          net.chunks[msg.partNumber!] = msg.chunk!;
          if (net.chunks.filter((c) => c !== undefined).length < msg.totalParts!) return;
          const whole = parsed(net.chunks.join(""));
          net.chunks = [];
          if (whole) onServer(whole);
          return;
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
            net.sent = net.acked = 0;
            net.inflight.clear();
          });
          this.addEventListener("message", (e) => {
            net.last = performance.now();
            const msg = parsed(e.data);
            if (msg) onServer(msg);
          });
        }
        send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
          const msg = parsed(data);
          if (msg?.type === "ModifyQuerySet") net.sent = Math.max(net.sent, msg.newVersion);
          if (msg?.type === "Mutation" || msg?.type === "Action") net.inflight.add(String(msg.requestId));
          super.send(data);
        }
      }
      window.WebSocket = Tracked as unknown as typeof WebSocket;

      // platform: headless Chromium has no push service, so a fake one stands in, keeping its subscription and permission across reloads like a phone.
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
      const sw = Object.assign(new EventTarget(), { ready: Promise.resolve(reg), register: async () => reg, startMessages() {} });
      Object.defineProperty(navigator, "serviceWorker", { value: sw, configurable: true });
    },
    [
      opts.installed ?? true,
      ns,
      opts.player?.token ?? "",
      opts.player?.refreshToken ?? "",
      opts.notifications ?? "default",
      opts.pushEndpoint ?? "",
    ] as const,
  );
  return await context.newPage();
}

export const iPhone = { ...devices["iPhone 15 Pro"], browserName: "chromium" as const, defaultBrowserType: "chromium" as const };
const OTHER_PHONE: BrowserContextOptions = { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true };

export type OpenOptions = PhoneOptions & {
  push?: "on";
  reducedMotion?: boolean;
  context?: BrowserContextOptions;
};

export type Phones = {
  open(opts?: OpenOptions): Promise<Page>;
  context(opts: BrowserContextOptions): Promise<BrowserContext>;
};

const OCC = /OptimisticConcurrencyControlFailure/;

async function resetDatabase() {
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await admin().mutation(anyApi.testing.reset, {})).done) return;
    } catch (error) {
      if (attempt < 5 && OCC.test(String(error))) continue;
      throw error;
    }
  }
}

async function seedPush(player: Player) {
  const endpoint = `https://push.example.com/${randomBytes(6).toString("hex")}`;
  await admin().mutation(anyApi.testing.seedPush, { userId: player.userId, endpoint });
  return endpoint;
}

export async function enablePush(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Turn on notifications" }).click();
  await expect(page.getByText("Turn on notifications to play")).toHaveCount(0);
}

export async function convexIdle(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const n = (window as unknown as { __convexNet?: { open: number; sent: number; acked: number; inflight: Set<string> } })
            .__convexNet;
          return !!n && n.open > 0 && n.acked >= n.sent && n.inflight.size === 0;
        }),
      { message: "Convex has answered everything the page asked for" },
    )
    .toBe(true);
}

export async function holdsStill(page: Page | Frame) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const running = document.getAnimations().some((a) => a.playState === "running" && a.effect?.getTiming().iterations !== Infinity);
          const layout = () =>
            [...document.querySelectorAll("button, a, h1, h2, [role=img]")]
              .map((el) => {
                const r = el.getBoundingClientRect();
                return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`;
              })
              .join(" ");
          const before = layout();
          await new Promise((r) => setTimeout(r, 120));
          return !running && layout() === before;
        }),
      { message: "the screen holds still" },
    )
    .toBe(true);
  expect(await clippedRings(page), CLIPPED_RINGS).toEqual([]);
}

const CLIPPED_RINGS = "a ring or outline is cut off by a scrolling or clipping parent: give the parent room for it";

export function clippedRings(page: Page | Frame) {
  return page.evaluate(() => {
    const reach = (el: Element) => {
      const s = getComputedStyle(el);
      let out = 0;
      if (s.boxShadow && s.boxShadow !== "none")
        for (const shadow of s.boxShadow.split(/,(?![^(]*\))/)) {
          if (shadow.includes("inset") || /rgba\(0, 0, 0, 0\)|transparent/.test(shadow)) continue;
          const n = (shadow.replace(/(rgba?|oklch|oklab|color|hsla?|lab|lch)\([^)]*\)/g, "").match(/-?[\d.]+px/g) ?? []).map(parseFloat);
          const [x = 0, y = 0, blur = 0, spread = 0] = n;
          if (blur === 0 && spread >= 1) out = Math.max(out, spread + Math.max(Math.abs(x), Math.abs(y)));
        }
      if (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0 && el.matches(":focus-visible"))
        out = Math.max(out, parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset || "0"));
      return out;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      for (let e: Element | null = el; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
      }
      return !el.closest("[inert]");
    };
    const looping = (el: Element) => el.getAnimations().some((a) => a.effect?.getTiming().iterations === Infinity);
    const named = (el: Element) => {
      const label = el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
      return `<${el.tagName.toLowerCase()} class="${String(el.getAttribute("class") ?? "").slice(0, 70)}"> "${label}"`;
    };
    const problems: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      const out = reach(el);
      if (!out || !visible(el) || looping(el)) continue;
      const r = el.getBoundingClientRect();
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a);
        const clipsX = s.overflowX !== "visible";
        const clipsY = s.overflowY !== "visible";
        if (!clipsX && !clipsY) continue;
        const box = a.getBoundingClientRect();
        const scrollsX = s.overflowX === "auto" || s.overflowX === "scroll";
        const scrollsY = s.overflowY === "auto" || s.overflowY === "scroll";
        const left = box.left + a.clientLeft - (scrollsX ? a.scrollLeft : 0);
        const top = box.top + a.clientTop - (scrollsY ? a.scrollTop : 0);
        const width = scrollsX ? Math.max(a.scrollWidth, a.clientWidth) : a.clientWidth;
        const height = scrollsY ? Math.max(a.scrollHeight, a.clientHeight) : a.clientHeight;
        const cut: string[] = [];
        if (clipsX && r.left - out < left - 0.5) cut.push("left");
        if (clipsX && r.right + out > left + width + 0.5) cut.push("right");
        if (clipsY && r.top - out < top - 0.5) cut.push("top");
        if (clipsY && r.bottom + out > top + height + 0.5) cut.push("bottom");
        if (cut.length) {
          problems.push(`${named(el)} loses its ${cut.join(" and ")} edge inside ${named(a)} on ${location.pathname}`);
          break;
        }
      }
    }
    return problems;
  });
}

export async function ready(page: Page) {
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(page.locator("[aria-busy=true], [data-slot=skeleton]")).toHaveCount(0);
  await convexIdle(page);
  await holdsStill(page);
  expect([...(nestedCards.get(page.context()) ?? []), ...(await nestedCardsOn(page))], NESTED_CARDS).toEqual([]);
}

export async function readyForShot(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          await document.fonts.ready;
          return [...document.images].every((img) => img.complete || img.loading === "lazy");
        }),
      { message: "fonts and images have loaded" },
    )
    .toBe(true);
  await holdsStill(page);
}

const nestedCards = new Map<BrowserContext, string[]>();
const NESTED_CARDS = "a card sits inside another card (AGENTS.md: never put cards inside cards)";

type NestingWindow = { __nestedCards: () => string[]; __nestedCard: (report: string) => Promise<void> };

async function nestedCardsOn(page: Page) {
  const reports = await page.evaluate(() => (window as unknown as Partial<NestingWindow>).__nestedCards?.() ?? []);
  const path = new URL(page.url()).pathname;
  return reports.map((r) => `${r} on ${path}`);
}

async function watchForNestedCards(context: BrowserContext) {
  if (nestedCards.has(context)) return;
  const found: string[] = [];
  nestedCards.set(context, found);
  await context.exposeBinding("__nestedCard", ({ page }, report: string) => {
    const where = `${report} on ${new URL(page.url()).pathname}`;
    if (!found.includes(where)) found.push(where);
  });
  await context.addInitScript(() => {
    const CARD = '[data-slot="card"]';
    const named = (el: Element) => {
      const label = el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      return `<${el.tagName.toLowerCase()} class="${String(el.getAttribute("class") ?? "").slice(0, 60)}"> "${label}"`;
    };
    const nested = () => [...document.querySelectorAll(`${CARD} ${CARD}`)];
    const describe = (inner: Element) => `${named(inner.parentElement!.closest(CARD)!)} holds the card ${named(inner)}`;
    const w = window as unknown as NestingWindow;
    w.__nestedCards = () => nested().map(describe);
    const reported = new WeakSet<Element>();
    const addsElements = (records: MutationRecord[]) =>
      records.some((r) => r.type === "attributes" || [...r.addedNodes].some((n) => n.nodeType === Node.ELEMENT_NODE));
    new MutationObserver((records) => {
      if (!addsElements(records)) return;
      for (const inner of nested()) {
        if (reported.has(inner)) continue;
        reported.add(inner);
        w.__nestedCard(describe(inner)).catch(() => {});
      }
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-slot"] });
  });
}

export const onScreen = (page: Page) => page.locator("[data-screen]:not([inert])");

export async function resign(page: Page) {
  await page.getByRole("button", { name: "Resign" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Resign" }).click();
}

export async function openLobby(host: Page, game: string, mode: string, settings: Record<string, string> = {}) {
  await host.goto(`/${game}/mode/${mode}`);
  if (Object.keys(settings).length) {
    await host.getByRole("button", { name: "Settings" }).click();
    for (const [group, option] of Object.entries(settings))
      await host.getByRole("radiogroup", { name: group }).getByRole("radio", { name: option, exact: true }).click();
  }
  await host.getByRole("button", { name: "Open a game" }).click();
  await expect(host.getByRole("heading", { name: "Waiting for players" })).toBeVisible();
  return matchIdOf(host);
}

export async function fillLobby(host: Page, guests: Page[]) {
  const id = matchIdOf(host);
  const game = new URL(host.url()).pathname.split("/")[1];
  for (const [i, guest] of guests.entries()) {
    await guest.goto(`/${game}/${id}?accept=1`);
    await expect(host.getByRole("heading", { name: `${i + 2} in` })).toBeVisible();
  }
  await host.getByRole("button", { name: `Start with ${guests.length + 1}` }).click();
}

export async function realtimePair(phones: Phones, settings?: { cooldown?: number; speed?: number }) {
  const [shlok, chris] = await Promise.all([createPlayer("Shlok"), createPlayer("Chris")]);
  const id: string = await admin().action(anyApi.testing.startMatch, {
    mode: "chess:realtime",
    a: shlok.userId,
    b: chris.userId,
    settings,
  });
  const [white, black] = await Promise.all([phones.open({ player: shlok, push: "on" }), phones.open({ player: chris, push: "on" })]);
  await Promise.all([white.goto(`/chess/${id}`), black.goto(`/chess/${id}`)]);
  for (const p of [white, black])
    await expect(p.getByRole("grid", { name: "Real-time chess board" })).toHaveAttribute("data-playing", "true", { timeout: 15_000 });
  return { id, white, black, whitePlayer: shlok, blackPlayer: chris };
}

export async function settled<T>(read: () => Promise<T>, window = 600): Promise<T> {
  let last = JSON.stringify(await read());
  let since = Date.now();
  for (const end = Date.now() + 10_000; Date.now() < end;) {
    await new Promise((r) => setTimeout(r, 150));
    const value = await read();
    const now = JSON.stringify(value);
    if (now !== last) [last, since] = [now, Date.now()];
    else if (Date.now() - since >= window) return value;
  }
  throw new Error(`Never settled: ${last}`);
}

export const test = base.extend<{ phones: Phones }>({
  phones: [
    async ({ browser, context }, use) => {
      await resetDatabase();
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
        async context(opts) {
          const ctx = await browser.newContext(opts);
          owned.push(ctx);
          return ctx;
        },
      });
      const nested = [...nestedCards.values()].flat();
      nestedCards.clear();
      await Promise.all(owned.map((c) => c.close().catch(() => {})));
      expect(nested, NESTED_CARDS).toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };
