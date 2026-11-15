self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
