import { motion } from "motion/react";
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
      <section className="rounded-3xl border border-destructive/30 bg-destructive/8 p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-2xl bg-destructive/15 text-destructive">
            <BellSlashIcon size={22} weight="fill" />
          </span>
          <h2 className="font-display text-lg">Notifications are blocked</h2>
        </div>
        <p className="mt-3 text-[0.95rem] leading-relaxed text-muted-foreground">{blockedFix()}</p>
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
    <motion.section
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 26 }}
      className="rounded-3xl bg-primary p-5 text-primary-foreground shadow-xl shadow-primary/20"
    >
      <div className="flex items-start gap-3.5">
        <motion.span
          className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary-foreground/15"
          animate={{ rotate: [0, -14, 12, -8, 6, 0] }}
          transition={{ duration: 0.9, repeat: Infinity, repeatDelay: 2.6, ease: "easeInOut" }}
        >
          <BellRingingIcon size={24} weight="fill" />
        </motion.span>
        <div>
          <h2 className="font-display text-xl leading-tight">Turn on notifications to play</h2>
          <p className="mt-1 text-[0.95rem] leading-snug opacity-85">So you know when it's your turn or someone hits you.</p>
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
    </motion.section>
  );
}

function blockedFix() {
  if (platform === "ios") return "Open the Settings app, tap Notifications, find Group 53, and turn on Allow Notifications. Then reopen the app.";
  if (platform === "android") return "Long-press the Group 53 icon, tap App info, then Notifications, and turn them on. Then reopen the app.";
  return "Click the icon at the left of the address bar, set Notifications to Allow, then reload the page.";
}
