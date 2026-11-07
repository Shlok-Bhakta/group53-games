import { BellRingingIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Section } from "@/components/parts";
import { Switch } from "@/components/ui/switch";
import { useNotifications } from "@/notifications";
import { SettingsRow, TINT } from "./SettingsRow";

export function NotificationsGroup() {
  const push = useNotifications();
  const toggle = async (next: boolean) => {
    try {
      await (next ? push.enable() : push.disable());
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  // Only when there's something to do about it.
  const footer = push.state === "blocked" ? "Notifications are blocked for Group 53. Turn them on in your phone's settings, then reopen the app." : undefined;
  return (
    <Section title="Notifications" footer={footer}>
      <SettingsRow icon={BellRingingIcon} tint={TINT.red} label="Notifications" htmlFor="push-switch">
        <Switch
          id="push-switch"
          checked={push.state === "on"}
          disabled={push.busy || push.state === "blocked" || push.state === "unsupported" || push.state === "loading"}
          onCheckedChange={(v) => void toggle(v)}
        />
      </SettingsRow>
      {push.state === "on" && (
        <SettingsRow
          icon={PaperPlaneTiltIcon}
          tint={TINT.green}
          label="Send a test notification"
          onClick={() => void push.sendTest().then(() => toast.success("Sent. It should land in a few seconds."))}
        />
      )}
    </Section>
  );
}
