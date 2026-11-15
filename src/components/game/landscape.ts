import { useSyncExternalStore } from "react";

const PHONE_LANDSCAPE = "(orientation: landscape) and (max-height: 500px)";

const subscribe = (onChange: () => void) => {
  const media = window.matchMedia(PHONE_LANDSCAPE);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

export const usePhoneLandscape = () => useSyncExternalStore(subscribe, () => window.matchMedia(PHONE_LANDSCAPE).matches);
