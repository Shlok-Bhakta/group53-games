import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import type { NewsItem } from "../../../convex/stonks/profile";
import { Section } from "@/components/parts";
import { ago } from "@/lib/time";

// Stories, each opening outside the app: the market's on the board, a company's on its page.
export function News({ title, items, now }: { title: string; items: NewsItem[]; now: number }) {
  return (
    <Section title={title}>
      {items.map((n) => (
        <a
          key={n.link}
          href={n.link}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-[84px] items-center gap-3 px-4 py-3 transition-transform duration-100 active:scale-[0.97]"
        >
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 text-callout font-semibold">{n.title}</span>
            <span className="mt-1 flex items-center gap-1 text-footnote text-muted-foreground">
              <span className="truncate">{n.publisher}</span>
              <span className="shrink-0">· {ago(now - n.time, { seconds: true })}</span>
              <ArrowSquareOutIcon className="shrink-0" aria-label="opens outside the app" />
            </span>
          </span>
          {n.thumb ? <img src={n.thumb} alt="" width={56} height={56} loading="lazy" decoding="async" className="size-14 shrink-0 rounded-sm bg-muted object-cover" /> : null}
        </a>
      ))}
    </Section>
  );
}
