import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useAnimate } from "motion/react";
import { cardName, type Card } from "../../../convex/uno/cards";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { UnoCard } from "./Card";

const PAD = 16;
const MIN_STEP = 44;
const LIFT = 18;
const TOP = 5;
const ARC = 1.5;

export const handHeight = (cardW: number, arcs = true) => Math.round(cardW * 1.4 + LIFT + TOP * 2 + (arcs ? ARC * 12 : 0));

export function Hand({
  cards,
  playable,
  myTurn,
  drawn,
  loaded,
  cardW,
  shake,
  onTap,
}: {
  cards: Card[];
  playable: Set<Card>;
  myTurn: boolean;
  drawn: Card | null;
  loaded: boolean;
  cardW: number;
  shake: number;
  onTap: (card: Card, rect: DOMRect) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [scope, animate] = useAnimate<HTMLDivElement>();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (shake && scope.current) void animate(scope.current, { x: [0, -12, 10, -7, 4, 0] }, { duration: 0.45 });
  }, [shake, animate, scope]);

  const n = cards.length;
  const avail = Math.max(0, w - 2 * PAD);
  const fit = n > 1 ? (avail - cardW) / (n - 1) : 0;
  const step = n > 1 ? Math.max(MIN_STEP, Math.min(cardW * 0.8, fit)) : 0;
  const total = cardW + step * (n - 1);
  const scrolls = total > avail + 0.5;
  const start = scrolls ? PAD : (w - total) / 2;
  const mid = (n - 1) / 2;
  const slack = Math.max(0, (w - total) / 2 - 4);
  const tilt = (Math.asin(Math.min(1, slack / (cardW * 1.4))) * 180) / Math.PI;
  const spread = scrolls || n < 2 ? 0 : Math.min(3, tilt / mid);
  const height = handHeight(cardW);
  const seen = new Map<Card, number>();

  return (
    <div
      ref={ref}
      className="-mx-3 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] phone-landscape:mx-0"
      style={{ height }}
      aria-label="Your hand"
      role="group"
      aria-busy={!loaded || undefined}
      data-cards={n}
    >
      <div ref={scope} className="relative h-full" style={{ width: scrolls ? total + 2 * PAD : "100%" }}>
        <AnimatePresence initial={false}>
          {cards.map((card, i) => {
            const k = seen.get(card) ?? 0;
            seen.set(card, k + 1);
            const can = playable.has(card);
            const lifted = can && myTurn;
            const arc = scrolls ? 0 : (i - mid) * (i - mid) * ARC;
            const left = start + i * step;
            return (
              <motion.div
                key={`${card}:${k}`}
                className="absolute top-0 left-0"
                style={{ zIndex: i, transformOrigin: "50% 100%" }}
                initial={{ x: left, y: -90, opacity: 0, scale: 0.8 }}
                animate={{ x: left, y: (lifted ? TOP : TOP + LIFT) + arc, rotate: (i - mid) * spread, opacity: 1, scale: 1 }}
                exit={{ y: -140, opacity: 0, scale: 1.1, transition: { duration: 0.2 } }}
                transition={{ type: "spring", bounce: 0.22, duration: 0.42 }}
              >
                <Button
                  variant="bare"
                  size="piece"
                  data-card={card}
                  data-playable={can || undefined}
                  aria-label={can ? `Play ${cardName(card)}` : cardName(card)}
                  onClick={(e) => onTap(card, e.currentTarget.getBoundingClientRect())}
                  className={cn("rounded-sm", drawn === card && myTurn && "ring-3 ring-primary ring-offset-1 ring-offset-background")}
                >
                  <UnoCard card={card} width={cardW} dim={myTurn && !can} />
                </Button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
