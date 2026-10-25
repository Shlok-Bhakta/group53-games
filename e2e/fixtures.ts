import { test as base, devices, type BrowserContext, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { readFileSync } from "node:fs";
import path from "node:path";

const STATE_FILE = path.resolve("e2e/.state/backend.json");

type State = { url: string; adminKey: string };
const state = (): State => JSON.parse(readFileSync(STATE_FILE, "utf8"));

export function admin() {
  const { url, adminKey } = state();
  const client = new ConvexHttpClient(url);
  (client as unknown as { setAdminAuth: (k: string) => void }).setAdminAuth(adminKey);
  return client;
}

export type Player = { userId: string; token: string; refreshToken: string; name: string };

export async function createPlayer(name: string, profile: Record<string, unknown> = {}): Promise<Player> {
  const p = await admin().action(anyApi.testing.createPlayer, { name, ...profile });
  return { ...p, name };
}

export type PhoneOptions = {
  installed?: boolean;
  player?: Player;
  // "default" leaves notifications off; "granted" also fakes a working push subscription.
  notifications?: "default" | "granted" | "denied";
  colorScheme?: "light" | "dark";
};

// An iPhone-sized Chromium page that looks like the installed PWA, optionally signed in.
export async function phone(context: BrowserContext, opts: PhoneOptions = {}): Promise<Page> {
  const { url } = state();
  const ns = url.replace(/[^a-zA-Z0-9]/g, "");
  await context.addInitScript(
    ([installed, ns, token, refresh, notifications]) => {
      if (installed) Object.defineProperty(navigator, "standalone", { get: () => true });
      if (token && !sessionStorage.getItem("e2e-seeded")) {
        localStorage.setItem(`__convexAuthJWT_${ns}`, token);
        localStorage.setItem(`__convexAuthRefreshToken_${ns}`, refresh);
        sessionStorage.setItem("e2e-seeded", "1");
      }
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
    [opts.installed ?? true, ns, opts.player?.token ?? "", opts.player?.refreshToken ?? "", opts.notifications ?? "default"] as const,
  );
  return await context.newPage();
}

export const iPhone = { ...devices["iPhone 15 Pro"], browserName: "chromium" as const, defaultBrowserType: "chromium" as const };

export const test = base.extend<{ resetDb: void }>({
  resetDb: [
    async ({}, use) => {
      await admin().mutation(anyApi.testing.reset, {});
      await use();
    },
    { auto: true },
  ],
});
export { expect } from "@playwright/test";
