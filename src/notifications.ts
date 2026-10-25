import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

export type PushState = "loading" | "unsupported" | "blocked" | "off" | "on";

export const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function base64UrlToBytes(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function keyToBase64(key: ArrayBuffer | null) {
  return key ? btoa(String.fromCharCode(...new Uint8Array(key))) : "";
}

export function useNotifications() {
  const vapidKey = useQuery(api.notifications.vapidPublicKey);
  const saveSubscription = useMutation(api.notifications.subscribe);
  const removeSubscription = useMutation(api.notifications.unsubscribe);
  const sendTest = useMutation(api.notifications.sendTest);

  // undefined while we ask the service worker, null when this device has no subscription.
  const [endpoint, setEndpoint] = useState<string | null | undefined>(pushSupported ? undefined : null);
  const [permission, setPermission] = useState(pushSupported ? Notification.permission : "denied");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pushSupported) return;
    let cancelled = false;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => !cancelled && setEndpoint(sub?.endpoint ?? null))
      .catch(() => !cancelled && setEndpoint(null));
    return () => {
      cancelled = true;
    };
  }, []);

  const serverHas = useQuery(api.notifications.hasEndpoint, endpoint ? { endpoint } : "skip");

  let state: PushState;
  if (!pushSupported) state = "unsupported";
  else if (permission === "denied") state = "blocked";
  else if (endpoint === undefined || (endpoint && serverHas === undefined)) state = "loading";
  else if (endpoint && serverHas && permission === "granted") state = "on";
  else state = "off";

  const enable = useCallback(async () => {
    if (!pushSupported) return;
    setBusy(true);
    try {
      // iOS only shows the prompt when this is the first await in the tap handler.
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") return;
      if (!vapidKey) throw new Error("The server has no push key yet.");
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(vapidKey) }));
      await saveSubscription({
        endpoint: sub.endpoint,
        p256dh: keyToBase64(sub.getKey("p256dh")),
        auth: keyToBase64(sub.getKey("auth")),
      });
      setEndpoint(sub.endpoint);
    } finally {
      setBusy(false);
    }
  }, [vapidKey, saveSubscription]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removeSubscription({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setEndpoint(null);
    } finally {
      setBusy(false);
    }
  }, [removeSubscription]);

  return { state, busy, enable, disable, sendTest: () => sendTest({}) };
}
