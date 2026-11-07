import { BookOpenTextIcon } from "@phosphor-icons/react";
import { Disclosure } from "@/components/ui/disclosure";

// The rules for a mode, folded away once you've played it.
export function Rules({ rules, defaultOpen, title = "How to play" }: { rules: string[]; defaultOpen: boolean; title?: string }) {
  return (
    <Disclosure icon={<BookOpenTextIcon size={20} weight="fill" />} title={title} defaultOpen={defaultOpen}>
      <ol className="flex flex-col gap-2.5 px-1 pb-2 pt-1">
        {rules.map((rule, i) => (
          <li key={i} className="flex gap-3 text-callout">
            <span className="mt-px grid size-6 shrink-0 place-items-center rounded-sm bg-primary/12 text-footnote font-bold text-primary">{i + 1}</span>
            <span>{rule}</span>
          </li>
        ))}
      </ol>
    </Disclosure>
  );
}
