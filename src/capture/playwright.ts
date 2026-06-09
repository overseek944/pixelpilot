import { chromium, type Browser } from "playwright";
import type {
  CapturedCell,
  LayoutNode,
  ResolvedScenario,
} from "../types.js";
import { viewportLabel } from "../config.js";
import type { Capturer } from "./capturer.js";

/**
 * Web capturer. Renders a URL across the viewport x theme matrix and extracts,
 * per cell, (1) a deterministic screenshot and (2) the resolved layout tree
 * (bounding boxes + curated computed styles). Computed styles are the key: they
 * resolve the entire cascade, inheritance, media queries and design tokens down
 * to the concrete values that actually hit the screen.
 */
export class PlaywrightCapturer implements Capturer {
  private browser?: Browser;

  private async init(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
    }
    return this.browser;
  }

  async capture(scenario: ResolvedScenario): Promise<CapturedCell[]> {
    const browser = await this.init();
    const cells: CapturedCell[] = [];

    for (const vp of scenario.viewports) {
      for (const theme of scenario.themes) {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: 1, // fixed for determinism
          colorScheme: theme,
        });
        const page = await context.newPage();
        try {
          // Some bundlers (esbuild/tsx) inject a `__name` helper into functions
          // serialized for page.evaluate. Define a no-op in page context so the
          // extraction function runs regardless of how this file was loaded.
          await page.addInitScript({
            content:
              "globalThis.__name = globalThis.__name || function (f) { return f; };",
          });
          await page.goto(scenario.url, { waitUntil: "networkidle" });
          if (scenario.waitForSelector) {
            await page.waitForSelector(scenario.waitForSelector, {
              timeout: 10_000,
            });
          }
          // Deterministic text: don't shoot until webfonts are ready.
          await page.evaluate(() => document.fonts.ready.then(() => true));
          if (scenario.waitMs) await page.waitForTimeout(scenario.waitMs);

          const png = scenario.selector
            ? await page
                .locator(scenario.selector)
                .first()
                .screenshot({ animations: "disabled", scale: "css" })
            : await page.screenshot({
                fullPage: true,
                animations: "disabled",
                scale: "css",
              });

          const layout = await page.evaluate(
            extractLayout,
            scenario.selector ?? null,
          );

          cells.push({
            cellId: `${scenario.name}__${viewportLabel(vp)}__${theme}`,
            scenario: scenario.name,
            viewport: vp,
            theme,
            png,
            layout,
          });
        } finally {
          await context.close();
        }
      }
    }
    return cells;
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
  }
}

/**
 * Runs inside the page. Walks the DOM under `root` (or body) and returns a
 * stable selector + bounding rect + curated computed styles per visible element.
 * Must be self-contained (no outer-scope references) since it is serialized.
 */
function extractLayout(rootSelector: string | null): LayoutNode[] {
  const PROPS = [
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "letter-spacing",
    "text-align",
    "color",
    "background-color",
    "opacity",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "border-top-width",
    "border-bottom-width",
    "border-top-style",
    "border-top-color",
    "border-radius",
    "box-shadow",
    "display",
    "flex-direction",
    "justify-content",
    "align-items",
    "gap",
  ];

  function cssPath(el: Element): string {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== "html") {
      let part = node.tagName.toLowerCase();
      const parent: Element | null = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter(
          (c) => c.tagName === node!.tagName,
        );
        if (sameTag.length > 1) {
          part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
        }
      }
      parts.unshift(part);
      if (node.id) {
        parts[0] = `#${CSS.escape(node.id)}`;
        break;
      }
      node = parent;
    }
    return parts.join(" > ");
  }

  const root: ParentNode = rootSelector
    ? document.querySelector(rootSelector) ?? document.body
    : document.body;

  const out: LayoutNode[] = [];
  for (const el of Array.from(root.querySelectorAll("*"))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    const styles: Record<string, string> = {};
    for (const p of PROPS) styles[p] = cs.getPropertyValue(p);
    out.push({
      selector: cssPath(el),
      rect: {
        x: Math.round(r.x * 100) / 100,
        y: Math.round(r.y * 100) / 100,
        width: Math.round(r.width * 100) / 100,
        height: Math.round(r.height * 100) / 100,
      },
      styles,
    });
  }
  return out;
}
