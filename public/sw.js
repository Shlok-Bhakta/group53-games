/* Group 53 Games service worker: push notifications only, no offline cache.
   iOS (16.4+) drops a push subscription after about three "silent" pushes,
   meaning push events that settle without showing a notification. Keep every
   push event alive with waitUntil() until showNotification() resolves. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
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
        // The red number on the home screen icon (iOS 16.4+ home screen apps, Chrome on desktop).
        if (typeof data.badge === "number" && self.navigator.setAppBadge) {
          await (data.badge > 0 ? self.navigator.setAppBadge(data.badge) : self.navigator.clearAppBadge()).catch(() => {});
        }
      } catch (err) {
        console.error("push handler failed:", err);
      }
    })(),
  );
});

// Where a tapped notification wants to go, kept in the Cache API so the app can pick it up even when the
// direct hand-off below doesn't arrive (iOS sometimes opens the app at its start URL instead).
const PENDING = "group53-pending";
async function rememberClick(url) {
  try {
    const cache = await caches.open(PENDING);
    await cache.put("/__pending-navigation", new Response(JSON.stringify({ url, at: Date.now() }), { headers: { "content-type": "application/json" } }));
  } catch (err) {
    console.error("couldn't save the notification target:", err);
  }
}

// Tapping a notification takes you to its page. An open app gets a message and routes there itself
// (WindowClient.navigate() is unreliable in iOS standalone apps and reloads the page elsewhere); with
// nothing open, a new window opens at the URL.
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
          // Some platforms only allow focusing in direct response to a click; the message still lands.
        }
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
