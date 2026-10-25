import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { BackHeader } from "@/components/AppHeader";
import { NotificationBanner } from "@/components/NotificationBanner";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/notifications";

// Games are locked until push is on, including when someone opens a game link straight from Discord.
export function NotificationsRequired({ children }: { children: ReactNode }) {
  const push = useNotifications();
  if (push.state === "on" || push.state === "unsupported") return <>{children}</>;
  if (push.state === "loading") return null;
  return (
    <div className="flex flex-col gap-4">
      <BackHeader
        title="Almost there"
        back={
          <Button variant="ghost" size="icon" asChild aria-label="Back to games">
            <Link to="/">
              <ArrowLeftIcon size={24} weight="bold" />
            </Link>
          </Button>
        }
      />
      <NotificationBanner push={push} />
    </div>
  );
}
