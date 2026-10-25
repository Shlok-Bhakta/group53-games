// iOS 26 blurs ("dissolves") whatever sits in a band under the status bar, about 30pt deep, in standalone
// web apps, and there's no switch to turn it off. This strip keeps that band a solid page color, so
// nothing legible ever sits in it, and content scrolling up fades out under it instead of turning blurry.
// Keep page text below TOP_CLEAR (see AppHeader).
export const TOP_CLEAR = "calc(env(safe-area-inset-top) + 32px)";

export function TopEdge() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-40">
      <div className="bg-background" style={{ height: "calc(env(safe-area-inset-top) + 28px)" }} />
      <div className="h-3 bg-gradient-to-b from-background to-transparent" />
    </div>
  );
}
