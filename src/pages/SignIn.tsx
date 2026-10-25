import { useAuthActions } from "@convex-dev/auth/react";
import { Tiles } from "@/Tiles";
import { Button } from "@/components/ui/button";
import { DiscordLogo } from "@/components/DiscordLogo";

export function SignIn() {
  const { signIn } = useAuthActions();
  return (
    <div className="flex min-h-[80dvh] flex-col justify-center gap-8">
      <div className="flex flex-col gap-1.5">
        <Tiles word="GROUP" states={["blank", "green", "blank", "yellow", "blank"]} flip label="Group" />
        <Tiles word="53" states={["green", "hit"]} flip label="53" />
      </div>
      <div>
        <h1 className="font-display text-4xl leading-[1.05]">Group 53 Games</h1>
        <p className="mt-3 max-w-[34ch] text-lg text-muted-foreground">
          Little games for the group, built so you can mess with each other.
        </p>
      </div>
      <Button
        size="xl"
        className="w-full bg-[#5865F2] text-white hover:bg-[#4752c4]"
        onClick={() => void signIn("discord", { redirectTo: window.location.href })}
      >
        <DiscordLogo size={22} /> Sign in with Discord
      </Button>
    </div>
  );
}
