import { toast } from "sonner";

// Native share sheet on phones, clipboard as the fallback. Discord caches a preview per exact URL,
// so each share gets a short random tag and unfurls fresh with whatever is happening right now.
export async function shareLink(path: string, text: string) {
  const link = new URL(path, location.origin);
  link.searchParams.set("s", Math.random().toString(36).slice(2, 7));
  const url = link.toString();
  if (navigator.share) {
    try {
      await navigator.share({ url, text });
      return;
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
    }
  }
  await navigator.clipboard.writeText(url);
  toast.success("Link copied");
}
