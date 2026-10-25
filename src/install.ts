import { useEffect, useState } from "react";

export type Platform = "ios" | "android" | "desktop";

const ua = navigator.userAgent;

export const platform: Platform =
  /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
    ? "ios"
    : /Android/.test(ua)
      ? "android"
      : "desktop";

// In-app browsers (Discord, Instagram, and so on) can't add to the home screen.
// On iOS they're WKWebViews without the "Safari/" token; on Android, WebViews say "; wv)".
export const inAppBrowser =
  (platform === "ios" && !/Safari\//.test(ua)) || (platform === "android" && /; wv\)/.test(ua));

function standaloneNow() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function useStandalone() {
  const [standalone, setStandalone] = useState(standaloneNow);
  useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    const update = () => setStandalone(standaloneNow());
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return standalone;
}

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

// Chrome on Android fires beforeinstallprompt when the app is installable, which lets us offer a one-tap install.
export function useInstallPrompt() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setPrompt(null);
  };
  return { canInstall: prompt !== null, install, installed };
}
