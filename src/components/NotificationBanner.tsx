import { BellRingingIcon, BellSlashIcon, SpinnerGapIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { platform } from "@/install";
import type { useNotifications } from "@/notifications";

type Push = ReturnType<typeof useNotifications>;

// The big ask. Shown on Games until notifications are on; games stay locked behind it.
export function NotificationBanner({ push }: { push: Push }) {
  if (push.state === "on" || push.state === "loading" || push.state === "unsupported") return null;

  if (push.state === "blocked") {
    return (
      <section className="rounded-lg bg-destructive/10 p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-sm bg-destructive/15 text-destructive">
            <BellSlashIcon size={22} weight="fill" />
          </span>
          <h2 className="font-display text-heading">Notifications are blocked</h2>
        </div>
        <p className="mt-3 text-callout text-muted-foreground">{blockedFix()}</p>
      </section>
    );
  }

  const turnOn = async () => {
    try {
      await push.enable();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <section className="rounded-lg bg-primary p-4 text-primary-foreground">
      <div className="flex items-start gap-3.5">
        <span className="grid size-11 shrink-0 place-items-center rounded-sm bg-primary-foreground/15">
          <BellRingingIcon size={24} weight="fill" />
        </span>
        <div>
          <h2 className="font-display text-heading">Turn on notifications to play</h2>
          <p className="mt-1 text-callout opacity-85">So you know when it's your turn or someone hits you.</p>
        </div>
      </div>
      <Button
        size="xl"
        onClick={() => void turnOn()}
        disabled={push.busy}
        className="mt-4 w-full bg-primary-foreground text-primary hover:bg-primary-foreground/90"
      >
        {push.busy ? <SpinnerGapIcon className="animate-spin" /> : null}
        Turn on notifications
      </Button>
    </section>
  );
}

function blockedFix() {
  if (platform === "ios") return "Open the Settings app, tap Notifications, find Group 53, and turn on Allow Notifications. Then reopen the app.";
  if (platform === "android") return "Long-press the Group 53 icon, tap App info, then Notifications, and turn them on. Then reopen the app.";
  return "Click the icon at the left of the address bar, set Notifications to Allow, then reload the page.";
}
