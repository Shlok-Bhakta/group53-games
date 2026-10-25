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
      } catch (err) {
        console.error("push handler failed:", err);
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
