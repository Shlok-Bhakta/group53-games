import { useAuthActions } from "@convex-dev/auth/react";
import { SignOutIcon } from "@phosphor-icons/react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ListRow } from "@/components/ListRow";
import { Section } from "@/components/parts";
import { SettingsIcon } from "./SettingsRow";
import { TINT } from "./palette";

export function AccountGroup() {
  const { signOut } = useAuthActions();
  return (
    <Section title="Account">
      <ConfirmButton
        trigger={
          <ListRow
            size="sm"
            leading={<SettingsIcon icon={SignOutIcon} tint={TINT.red} />}
            title={<span className="font-medium text-destructive">Sign out</span>}
            onClick={() => {}}
          />
        }
        title="Sign out?"
        detail="You'll need to sign in with Discord again to play."
        keep="Stay signed in"
        confirm="Sign out"
        onConfirm={() => signOut()}
      />
    </Section>
  );
}
