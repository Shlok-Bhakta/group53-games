// What the game needs from the app, when it's running on its own in the app's iframe. The app says what the phone's
// settings are in the URL's hash and listens for these messages (src/games/HostedGame.tsx on main).
const settings = new URLSearchParams(location.hash.slice(1));
const sound = { sfx: settings.get("sfx") ?? "wood", music: settings.get("music") ?? "lofi" };

export const useSoundSettings = () => sound;
// The app stops its own music while this page is open.
export const wantMusic = (_on: boolean) => {};
export const useGoBack = (_fallback?: string) => () => {
  if (parent !== window) parent.postMessage({ type: "back" }, "*");
  else history.back();
};
