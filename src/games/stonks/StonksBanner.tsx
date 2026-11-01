import { motion } from "motion/react";
import { Tiles } from "@/Tiles";

// Stonks' card art on the Games tab: a line that dips, then goes to the moon, drawn in once.
const LINE = "M4,58 L30,50 L52,62 L74,46 L96,54 L118,64 L140,42 L160,48 L182,26 L204,32 L236,6";

export function StonksBanner() {
  return (
    <div className="flex flex-col items-center gap-3">
      <svg viewBox="0 0 240 70" className="h-[70px] w-[240px] overflow-visible" role="img" aria-label="A stock chart going to the moon">
        <line x1={4} x2={236} y1={58} y2={58} stroke="var(--muted-foreground)" strokeOpacity={0.5} strokeDasharray="1 4" strokeLinecap="round" />
        <motion.path
          d={LINE}
          fill="none"
          stroke="var(--up)"
          strokeWidth={3}
          strokeLinejoin="round"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.3, ease: [0.4, 0, 0.2, 1] }}
        />
        <motion.circle cx={236} cy={6} r={5} fill="var(--up)" stroke="var(--muted)" strokeWidth={2} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 1.25, type: "spring", bounce: 0.5, duration: 0.5 }} />
      </svg>
      <Tiles word="STONKS" states={["green", "green", "green", "green", "green", "green"]} size="sm" flip label="Stonks" />
    </div>
  );
}
