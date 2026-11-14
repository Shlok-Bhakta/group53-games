import { motion } from "motion/react";

// The Landlord card's art: a hand of deeds dealt into a fan, then a house dropped on the last. About a second,
// once.
const DEEDS = [
  { group: "sky", name: "Pier Street", price: "$100" },
  { group: "orange", name: "Kiln Avenue", price: "$200" },
  { group: "red", name: "Crown Avenue", price: "$240" },
  { group: "green", name: "Ivy Terrace", price: "$300" },
  { group: "navy", name: "Summit Heights", price: "$400" },
];

function DeedCard({ group, name, price, width }: { group: string; name: string; price: string; width: number }) {
  return (
    <span className="ll-deed flex flex-col overflow-hidden" style={{ width, height: width * 1.3 }}>
      <span className="ll-swatch block" data-group={group} style={{ height: width * 0.32 }} />
      <span className="flex flex-1 flex-col items-center justify-center gap-1 px-1 text-center">
        <span className="font-semibold leading-tight" style={{ fontSize: width * 0.15 }}>
          {name}
        </span>
        <span className="tabular-nums opacity-70" style={{ fontSize: width * 0.13 }}>
          {price}
        </span>
      </span>
    </span>
  );
}

export function LandlordBanner() {
  return (
    <div className="relative mx-auto flex h-[150px] w-full max-w-[320px] items-end justify-center" aria-label="Landlord" role="img">
      {DEEDS.map((d, i) => (
        <motion.span
          key={d.name}
          className="absolute bottom-2"
          style={{ transformOrigin: "50% 120%" }}
          initial={{ opacity: 0, y: -40, rotate: 0, x: 0 }}
          animate={{ opacity: 1, y: Math.abs(i - 2) * 6, rotate: (i - 2) * 11, x: (i - 2) * 38 }}
          transition={{ type: "spring", bounce: 0.3, duration: 0.5, delay: i * 0.09 }}
        >
          <DeedCard {...d} width={76} />
        </motion.span>
      ))}
      <motion.span
        className="ll-house-art absolute bottom-[88px]"
        style={{ x: 82 }}
        initial={{ opacity: 0, y: -30, scale: 0.6 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", bounce: 0.5, duration: 0.5, delay: 0.7 }}
      />
    </div>
  );
}

export function LandlordModeArt() {
  return (
    <span className="relative block size-20" aria-hidden="true">
      {DEEDS.slice(1, 4).map((d, i) => (
        <motion.span
          key={d.name}
          className="absolute bottom-1 left-1/2"
          style={{ transformOrigin: "50% 130%", marginLeft: -17 }}
          initial={{ opacity: 0, y: -12, rotate: 0 }}
          animate={{ opacity: 1, rotate: (i - 1) * 16, x: (i - 1) * 14 }}
          transition={{ type: "spring", bounce: 0.35, duration: 0.45, delay: 0.1 + i * 0.07 }}
        >
          <DeedCard {...d} width={34} />
        </motion.span>
      ))}
    </span>
  );
}
