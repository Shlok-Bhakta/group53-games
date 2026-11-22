import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useAnimate } from "motion/react";
import { cardName, type Card } from "../../../convex/uno/cards";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { UnoCard } from "./Card";

const PAD = 8;
const MIN_STEP = 40;
const LIFT = 18;
const TOP = 5;
const ARC = 1.5;
const ROW = 44;

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
  const height = handHeight(cardW);
  const lay = layout(n, w, cardW, height);
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
      data-rows={lay.rows}
    >
      <div ref={scope} className="relative h-full" style={{ width: lay.scrolls ? lay.width : "100%" }}>
        <AnimatePresence initial={false}>
          {cards.map((card, i) => {
            const k = seen.get(card) ?? 0;
            seen.set(card, k + 1);
            const can = playable.has(card);
            const lifted = can && myTurn;
            const at = lay.place(i, lifted);
            return (
              <motion.div
                key={`${card}:${k}`}
                className="absolute top-0 left-0"
                style={{ zIndex: at.z, transformOrigin: "50% 100%" }}
                initial={{ x: at.x, y: -90, opacity: 0, scale: lay.scale * 0.8 }}
                animate={{ x: at.x, y: at.y, rotate: at.rotate, opacity: 1, scale: lay.scale }}
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

function layout(n: number, w: number, cardW: number, height: number) {
  const avail = Math.max(0, w - 2 * PAD);
  const cardH = cardW * 1.4;
  const rowOf = (count: number, width: number) => {
    const fit = count > 1 ? (avail - width) / (count - 1) : 0;
    const step = count > 1 ? Math.max(MIN_STEP, Math.min(width * 0.8, fit)) : 0;
    return { step, total: width + step * Math.max(0, count - 1) };
  };
  if (n < 2 || cardW + MIN_STEP * (n - 1) <= avail) {
    const { step, total } = rowOf(n, cardW);
    const start = (w - total) / 2;
    const mid = (n - 1) / 2;
    const slack = Math.max(0, (w - total) / 2 - 4);
    const tilt = (Math.asin(Math.min(1, slack / cardH)) * 180) / Math.PI;
    const spread = n < 2 ? 0 : Math.min(3, tilt / mid);
    return {
      rows: 1,
      scale: 1,
      scrolls: false,
      width: w,
      place: (i: number, lifted: boolean) => ({
        x: start + i * step,
        y: (lifted ? TOP : TOP + LIFT) + (i - mid) * (i - mid) * ARC,
        rotate: (i - mid) * spread,
        z: i,
      }),
    };
  }
  const scale = (height - 2 * TOP - ROW) / cardH;
  const small = cardW * scale;
  const back = Math.ceil(n / 2);
  const rows = [rowOf(back, small), rowOf(n - back, small)];
  const scrolls = rows[0].total > avail + 0.5;
  const shiftX = (cardW * (1 - scale)) / 2;
  const shiftY = cardH * (1 - scale);
  return {
    rows: 2,
    scale,
    scrolls,
    width: rows[0].total + 2 * PAD,
    place: (i: number) => {
      const row = i < back ? 0 : 1;
      const j = row ? i - back : i;
      const start = scrolls ? PAD : (w - rows[row].total) / 2;
      return {
        x: start + j * rows[row].step - shiftX,
        y: TOP + row * ROW - shiftY,
        rotate: 0,
        z: row * 100 + j,
      };
    },
  };
}
