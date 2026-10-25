import type { ReactNode } from "react";
import { NavBar } from "@/components/AppHeader";
import { NotificationBanner } from "@/components/NotificationBanner";
import { useNotifications } from "@/notifications";

// Games are locked until push is on, including when someone opens a game link straight from Discord.
export function NotificationsRequired({ children }: { children: ReactNode }) {
  const push = useNotifications();
  if (push.state === "on" || push.state === "unsupported") return <>{children}</>;
  if (push.state === "loading") return null;
  return (
    <div className="flex flex-col gap-4">
      <NavBar title="Almost there" />
      <NotificationBanner push={push} />
    </div>
  );
}
