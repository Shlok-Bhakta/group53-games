self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("push", (event) => {
  // platform: iOS (16.4+) drops a subscription after about three pushes that settle without showing a notification, so each stays alive until showNotification() resolves.
  event.waitUntil(
    (async () => {
      try {
        let data = { title: "Group 53 Games", body: "", url: "/", tag: "group53" };
        if (event.data) {
          try {
            data = { ...data, ...event.data.json() };
          } catch {
            data.body = event.data.text();
          }
        }
        await self.registration.showNotification(data.title, {
          body: data.body,
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
          tag: data.tag,
          data: { url: data.url },
        });
        if (typeof data.badge === "number" && self.navigator.setAppBadge) {
          await (data.badge > 0 ? self.navigator.setAppBadge(data.badge) : self.navigator.clearAppBadge()).catch(() => {});
        }
      } catch (err) {
        console.error("push handler failed:", err);
      }
    })(),
  );
});

// platform: iOS sometimes opens the app at its start URL instead of the notification's, so the target also waits in the Cache API for src/deepLinks.ts.
const PENDING = "group53-pending";
async function rememberClick(url) {
  try {
    const cache = await caches.open(PENDING);
    await cache.put("/__pending-navigation", new Response(JSON.stringify({ url, at: Date.now() }), { headers: { "content-type": "application/json" } }));
  } catch (err) {
    console.error("couldn't save the notification target:", err);
  }
}

// platform: iOS standalone apps ignore WindowClient.navigate(), so an open app is sent a message and routes itself.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      await rememberClick(url);
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const client = clients.find((c) => new URL(c.url).origin === self.location.origin) ?? clients[0];
      if (client) {
        client.postMessage({ type: "navigate", url });
        try {
          await client.focus();
        } catch {
          // platform: some browsers only allow focus() in direct response to a click; the message still lands.
        }
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

// platform: iOS paints white until a reopened app's HTML arrives, so page loads answer from the last copy at once (its first script paints the saved theme) and refresh it for next time.
const SHELL = "group53-shell";
const SHELL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

self.addEventListener("activate", (event) => event.waitUntil(caches.delete(SHELL).then(() => self.clients.claim())));

async function saveShell(response) {
  const res = await response;
  if (!res.ok || !res.headers.get("content-type")?.includes("text/html")) return res;
  const html = await res.clone().text();
  if (html.includes("</html>")) {
    const copy = new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "x-saved-at": String(Date.now()) } });
    await (await caches.open(SHELL)).put("/", copy);
  }
  return res;
}

async function savedShell() {
  try {
    const saved = await (await caches.open(SHELL)).match("/");
    return saved && Date.now() - Number(saved.headers.get("x-saved-at")) < SHELL_MAX_AGE_MS ? saved : undefined;
  } catch {
    return undefined;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.mode !== "navigate" || req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/og/")) return;
  const fresh = saveShell(fetch(req));
  event.waitUntil(fresh.catch(() => {}));
  event.respondWith(savedShell().then((saved) => saved ?? fresh));
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "refresh-shell") return;
  const reply = (ok) => event.ports[0]?.postMessage({ ok });
  event.waitUntil(saveShell(fetch("/", { cache: "no-store" })).then((res) => reply(res.ok), () => reply(false)));
});
