import { expect, type Page } from "@playwright/test";

export type Insets = { top: number; right: number; bottom: number; left: number };

export const PORTRAIT = { width: 393, height: 852 };
export const LANDSCAPE = { width: 852, height: 393 };
export const SAFE_PORTRAIT: Insets = { top: 59, right: 0, bottom: 34, left: 0 };
export const SAFE_LANDSCAPE: Insets = { top: 0, right: 59, bottom: 21, left: 59 };

const SAFE_KEY = "e2e-safe-areas";

const SIDES = ["top", "right", "bottom", "left"] as const;

export async function simulateSafeAreas(page: Page, insets: Insets) {
  await page.addInitScript(
    ([key, sides]) => {
      const saved = sessionStorage.getItem(key);
      if (!saved) return;
      const insets = JSON.parse(saved) as Record<string, number>;
      for (const side of sides) document.documentElement.style.setProperty(`--safe-${side}`, `${insets[side]}px`);
    },
    [SAFE_KEY, SIDES] as const,
  );
  await setInsets(page, insets);
}

async function setInsets(page: Page, insets: Insets) {
  await page.evaluate(
    ([key, value, sides]) => {
      sessionStorage.setItem(key, value);
      const insets = JSON.parse(value) as Record<string, number>;
      for (const side of sides) document.documentElement.style.setProperty(`--safe-${side}`, `${insets[side]}px`);
    },
    [SAFE_KEY, JSON.stringify(insets), SIDES] as const,
  );
}

export async function rotate(page: Page, to: "portrait" | "landscape") {
  await page.setViewportSize(to === "landscape" ? LANDSCAPE : PORTRAIT);
  await setInsets(page, to === "landscape" ? SAFE_LANDSCAPE : SAFE_PORTRAIT);
}

const INTERACTIVE =
  'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="radio"], [role="switch"], [role="slider"], [role="tab"], [role="checkbox"], [role="link"]';

export async function screenProblems(page: Page, safe: Insets) {
  return page.evaluate(
    ([selector, safe]) => {
      const problems: string[] = [];
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const doc = document.scrollingElement ?? document.documentElement;
      if (doc.scrollWidth > vw + 1) problems.push(`the page scrolls sideways (${doc.scrollWidth}px wide in ${vw}px)`);

      const name = (el: Element) => {
        const label = el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
        return `<${el.tagName.toLowerCase()}> "${label}"`;
      };
      const hidden = (el: Element) => !!el.closest("[inert], [aria-hidden='true']");
      const invisible = (el: Element) => {
        for (let e: Element | null = el; e; e = e.parentElement) {
          const s = getComputedStyle(e);
          if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return true;
        }
        return false;
      };
      const pinned = (el: Element) => {
        for (let e: Element | null = el; e; e = e.parentElement) if (getComputedStyle(e).position === "fixed") return true;
        return false;
      };
      const clipped = (el: Element) => {
        let r = el.getBoundingClientRect();
        let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
          const s = getComputedStyle(e);
          if (s.overflowX === "visible" && s.overflowY === "visible") continue;
          r = e.getBoundingClientRect();
          box = {
            left: Math.max(box.left, s.overflowX === "visible" ? -Infinity : r.left),
            right: Math.min(box.right, s.overflowX === "visible" ? Infinity : r.right),
            top: Math.max(box.top, s.overflowY === "visible" ? -Infinity : r.top),
            bottom: Math.min(box.bottom, s.overflowY === "visible" ? Infinity : r.bottom),
          };
        }
        return box.right - box.left > 1 && box.bottom - box.top > 1 ? box : null;
      };

      const hitArea = (el: Element) => {
        const r = el.getBoundingClientRect();
        let { width, height } = r;
        for (const pseudo of ["::before", "::after"]) {
          const p = getComputedStyle(el, pseudo);
          if (p.content === "none" || p.position !== "absolute") continue;
          const out = (v: string) => Math.max(0, -(parseFloat(v) || 0));
          width = Math.max(width, r.width + out(p.left) + out(p.right));
          height = Math.max(height, r.height + out(p.top) + out(p.bottom));
        }
        return { width, height };
      };

      for (const el of document.querySelectorAll(selector)) {
        if (hidden(el) || invisible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const box = clipped(el);
        if (!box) continue;
        if (box.left < safe.left - 1 || box.right > vw - safe.right + 1)
          problems.push(`${name(el)} reaches into the side safe area (${Math.round(box.left)}..${Math.round(box.right)} of ${vw})`);
        if (pinned(el) && (box.top < -1 || box.bottom > vh + 1))
          problems.push(`${name(el)} is pinned off screen (${Math.round(box.top)}..${Math.round(box.bottom)} of ${vh})`);
        const target = hitArea(el);
        if (target.width < 43.5 || target.height < 43.5)
          problems.push(`${name(el)} is ${Math.round(target.width)}x${Math.round(target.height)}, under 44px`);
      }

      const main = document.querySelector("main");
      if (main) {
        const r = main.getBoundingClientRect();
        if (r.left < -1 || r.right > vw + 1) problems.push(`<main> runs off the side (${Math.round(r.left)}..${Math.round(r.right)})`);
      }
      const blocks = document.querySelectorAll("[data-game-board], [data-slot='drawer-content'], [role='alertdialog']");
      for (const el of blocks) {
        if (hidden(el) || invisible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.left < -1 || r.right > vw + 1 || r.top < -1 || r.bottom > vh + 1)
          problems.push(
            `${name(el)} isn't fully on screen (${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)})`,
          );
      }
      return problems;
    },
    [INTERACTIVE, safe] as const,
  );
}

export async function expectFitsScreen(page: Page, safe: Insets = SAFE_LANDSCAPE) {
  expect(await screenProblems(page, safe), `fits ${new URL(page.url()).pathname} on screen`).toEqual([]);
}

export async function barGap(page: Page) {
  return page.locator("nav[aria-label='Main']").evaluate((nav) => {
    const vv = window.visualViewport;
    const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    return Math.round(bottom - nav.getBoundingClientRect().bottom);
  });
}
