import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { NavBar, useGoBack } from "@/components/AppHeader";
import { TOP_CLEAR } from "@/components/TopEdge";
import { useTheme } from "@/theme";
import { useSoundSettings, wantMusic } from "@/sound";

// A game built apart from the app (convex/hosted.ts), in an iframe. Nothing of it downloads until this page opens.
// Until the game says it's up, this page's own bar is there, so a slow or failed download can still go back.
export function HostedGame({ game, title }: { game: string; title: string }) {
  const url = useQuery(api.hosted.current, { game });
  const goBack = useGoBack("/games");
  const { resolved, palette, font } = useTheme();
  const { sfx, music } = useSoundSettings();
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  // What the game needs to know about the phone's settings. They can't change while it's open.
  const [hash] = useState(() => new URLSearchParams({ dark: resolved === "dark" ? "1" : "0", palette, font, sfx, music }).toString());
  // The URL it opened with stays, even if a new build is published while it's being played.
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (url) setSrc((was) => was ?? `${url}#${hash}`);
  }, [url, hash]);

  useEffect(() => {
    const listen = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      if (e.data?.type === "ready") setReady(true);
      if (e.data?.type === "back") goBack();
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [goBack]);

  // The game brings its own music, so the app's steps aside.
  useEffect(() => {
    wantMusic(false);
    return () => wantMusic(true);
  }, []);

  return (
    <div className="fixed inset-0 z-30 bg-background">
      {src && (
        <iframe
          ref={frame}
          src={src}
          title={title}
          sandbox="allow-scripts allow-same-origin"
          allow="autoplay; fullscreen"
          className="absolute inset-x-0 w-full border-0"
          style={{ top: TOP_CLEAR, bottom: "env(safe-area-inset-bottom)", height: `calc(100% - (${TOP_CLEAR}) - env(safe-area-inset-bottom))` }}
        />
      )}
      {!ready && (
        <div className="absolute inset-0 bg-background px-4">
          <NavBar title={title} back="/games" />
          {url === null && <p className="py-10 text-center text-callout text-muted-foreground">It isn't up yet.</p>}
          {src && (
            <div role="status" aria-label="Loading" className="flex justify-center py-16">
              <span className="size-8 animate-spin rounded-full border-3 border-muted border-t-primary" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
