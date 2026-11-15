// platform: iOS 26 blurs a band about 30pt deep under the status bar in standalone web apps, with no way to turn it off.
export const TOP_CLEAR = "calc(var(--safe-top) + 32px)";

export function TopEdge() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-40 [[data-fullbleed]_&]:hidden">
      <div className="bg-background" style={{ height: "calc(var(--safe-top) + 28px)" }} />
      <div className="h-3 bg-gradient-to-b from-background to-transparent" />
    </div>
  );
}
