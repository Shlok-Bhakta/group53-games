import { useState, type ReactNode } from "react";
import { CheckIcon as Check, CopyIcon as Copy, DotsThreeVerticalIcon as EllipsisVertical, DownloadSimpleIcon as Download, ExportIcon as Share, PlusSquareIcon as SquarePlus } from "@phosphor-icons/react";
import { Tiles } from "@/Tiles";
import { Button } from "@/components/ui/button";
import { GAMES } from "../convex/modes";
import { LinkHandoff } from "@/components/LinkHandoff";
import { inAppBrowser, platform, useInstallPrompt, useStandalone } from "./install";

// Phones only get in from the installed app, because web push on iOS only works there.
export function InstallGate({ children }: { children: ReactNode }) {
  const standalone = useStandalone();
  if (standalone || platform === "desktop") return <>{children}</>;
  // A game link: let people who already have the app send it there. Everyone else gets the install steps.
  const gameLink = Object.values(GAMES).some((g) => new RegExp(`^${g.path}/[a-z0-9]+$`).test(location.pathname)) ? location.pathname + location.search : null;
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-7 px-5 pb-10 pt-[calc(env(safe-area-inset-top)+40px)]">
      <Tiles word="53" states={["green", "yellow"]} size="lg" flip label="Group 53" />
      {gameLink && <LinkHandoff path={gameLink} />}
      <div>
        <h1 className={gameLink ? "font-display text-heading" : "font-display text-title"}>{gameLink ? "New here? Put Group 53 on your home screen" : "Put Group 53 on your home screen"}</h1>
        <p className="mt-3 text-callout text-muted-foreground">
          The games run as an app so they can ping you when it's your turn or someone comes for you. It takes about ten seconds.
        </p>
      </div>
      {inAppBrowser ? <OpenInBrowser /> : platform === "ios" ? <IosSteps /> : <AndroidSteps />}
    </div>
  );
}

function Steps({ steps }: { steps: ReactNode[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {steps.map((step, i) => (
        <li key={i} className="flex items-start gap-3.5 px-1">
          <span className="grid size-7 shrink-0 place-items-center rounded-sm bg-primary text-footnote font-bold text-primary-foreground">{i + 1}</span>
          <span className="pt-0.5">{step}</span>
        </li>
      ))}
    </ol>
  );
}

const Key = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex items-center gap-1 font-semibold [&_svg]:size-4 [&_svg]:-translate-y-px">{children}</span>
);

function OpenInBrowser() {
  const browser = platform === "ios" ? "Safari" : "Chrome";
  const [copied, setCopied] = useState(false);
  return (
    <>
      <Steps
        steps={[
          <>
            You're inside another app's browser. Tap its menu and choose <Key>Open in {browser}</Key>.
          </>,
          <>Follow the install steps there.</>,
        ]}
      />
      <Button size="xl" variant="outline" onClick={() => void navigator.clipboard.writeText(location.origin).then(() => setCopied(true))}>
        {copied ? <Check /> : <Copy />}
        {copied ? "Link copied" : `Copy link for ${browser}`}
      </Button>
    </>
  );
}

function IosSteps() {
  return (
    <Steps
      steps={[
        <>
          Tap{" "}
          <Key>
            <Share /> Share
          </Key>{" "}
          in Safari's toolbar.
        </>,
        <>
          Scroll down and tap{" "}
          <Key>
            <SquarePlus /> Add to Home Screen
          </Key>
          . Not there? Tap Edit Actions and add it.
        </>,
        <>
          Tap <Key>Add</Key>, then open <Key>Group 53</Key> from your home screen.
        </>,
      ]}
    />
  );
}

function AndroidSteps() {
  const { canInstall, install, installed } = useInstallPrompt();
  if (installed) {
    return (
      <div className="flex items-start gap-3 rounded-lg bg-card p-4 ring-2 ring-tile-green">
        <Check size={20} weight="bold" className="mt-0.5 shrink-0 text-tile-green" />
        <p>
          Installed. Open <Key>Group 53</Key> from your home screen or app drawer.
        </p>
      </div>
    );
  }
  return (
    <>
      {canInstall && (
        <Button size="xl" className="w-full" onClick={() => void install()}>
          <Download /> Install Group 53
        </Button>
      )}
      <Steps
        steps={[
          <>
            Tap Chrome's menu{" "}
            <Key>
              <EllipsisVertical />
            </Key>{" "}
            in the top right.
          </>,
          <>
            Tap <Key>Add to Home screen</Key> or <Key>Install app</Key>, then <Key>Install</Key>.
          </>,
          <>
            Open <Key>Group 53</Key> from your home screen or app drawer.
          </>,
        ]}
      />
    </>
  );
}
