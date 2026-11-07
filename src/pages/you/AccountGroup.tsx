import { useAuthActions } from "@convex-dev/auth/react";
import { SignOutIcon } from "@phosphor-icons/react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ListRow } from "@/components/ListRow";
import { Section } from "@/components/parts";

export function AccountGroup() {
  const { signOut } = useAuthActions();
  return (
    <Section title="Account">
      <ConfirmButton
        // The dialog's trigger hands the row its own onClick.
        trigger={<ListRow size="sm" className="text-destructive" leading={<SignOutIcon size={22} weight="bold" />} title="Sign out" onClick={() => {}} />}
        title="Sign out?"
        detail="You'll need to sign in with Discord again to play."
        keep="Stay signed in"
        confirm="Sign out"
        onConfirm={() => signOut()}
      />
    </Section>
  );
}
