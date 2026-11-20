import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { ClipboardTextIcon } from "@phosphor-icons/react";
import { api } from "../../../convex/_generated/api";
import { dailyGame, parseShare, SHARE_MAX } from "../../../convex/daily/games";
import { AsyncButton } from "@/components/AsyncButton";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useToday } from "./today";

async function readClipboard() {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

export function PasteButton({ size = "xl", variant, className }: { size?: "xl" | "sm"; variant?: "secondary"; className?: string }) {
  const post = useMutation(api.daily.post);
  const day = useToday();
  const [draft, setDraft] = useState<string | null>(null);
  const send = (text: string) =>
    post({ text, day }).then((r) => {
      toast.success(`${dailyGame(r.game).name} ${r.display} posted`);
      setDraft(null);
    });
  const paste = async () => {
    const text = await readClipboard();
    if (text && parseShare(text)) return send(text);
    setDraft(text?.slice(0, SHARE_MAX) ?? "");
  };
  const parsed = draft ? parseShare(draft) : null;
  return (
    <>
      <AsyncButton size={size} variant={variant} className={className} icon={<ClipboardTextIcon weight="bold" />} onClick={paste}>
        {size === "xl" ? "Paste result" : "Paste"}
      </AsyncButton>
      <Sheet open={draft !== null} onClose={() => setDraft(null)} title="Paste your result">
        {/* platform: a textarea, since iOS offers saved passwords on single-line text fields. */}
        <textarea
          name="daily-result"
          aria-label="Result"
          rows={6}
          value={draft ?? ""}
          maxLength={SHARE_MAX}
          placeholder={"Scrandle 8/10\n🟩🟩🟥🟩🟩🟩🟩🟥🟩🟩"}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          data-form-type="other"
          onChange={(e) => setDraft(e.target.value)}
          className="w-full resize-none rounded-md bg-muted p-3 text-body outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p
          data-recognized={parsed ? parsed.game : undefined}
          className={cn("px-1 text-callout", parsed ? "font-semibold" : "text-muted-foreground")}
        >
          {parsed
            ? `${dailyGame(parsed.game).name} ${parsed.display}`
            : draft
              ? "Not a result from a daily we know"
              : "Paste what the game copied"}
        </p>
        <AsyncButton size="xl" disabled={!parsed} onClick={() => send(draft ?? "")}>
          Post
        </AsyncButton>
      </Sheet>
    </>
  );
}
