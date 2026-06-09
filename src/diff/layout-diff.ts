import type { LayoutNode, RegionDelta, StyleDelta } from "../types.js";

/**
 * Compare two resolved layout trees and produce localized, machine-actionable
 * deltas. THIS is what makes the agent loop converge: instead of "92% match",
 * the agent gets "#cta moved +0,-4px and padding-top is 10px vs 12px" — a
 * specific instruction it can act on. Without this, a model just flails.
 */
export function diffLayouts(
  baseline: LayoutNode[],
  target: LayoutNode[],
): RegionDelta[] {
  const baseMap = new Map(baseline.map((n) => [n.selector, n]));
  const tgtMap = new Map(target.map((n) => [n.selector, n]));
  const deltas: RegionDelta[] = [];

  for (const [sel, b] of baseMap) {
    const t = tgtMap.get(sel);
    if (!t) {
      deltas.push({ selector: sel, status: "missing", styleDeltas: [], severity: 60 });
      continue;
    }
    const dx = round(t.rect.x - b.rect.x);
    const dy = round(t.rect.y - b.rect.y);
    const dw = round(t.rect.width - b.rect.width);
    const dh = round(t.rect.height - b.rect.height);

    const styleDeltas: StyleDelta[] = [];
    for (const prop of Object.keys(b.styles)) {
      const before = b.styles[prop];
      const after = t.styles[prop] ?? "";
      if (before !== after) styleDeltas.push({ prop, before, after });
    }

    const moved = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
    const resized = Math.abs(dw) > 0.5 || Math.abs(dh) > 0.5;
    if (!moved && !resized && styleDeltas.length === 0) continue;

    const severity =
      Math.abs(dx) +
      Math.abs(dy) +
      Math.abs(dw) +
      Math.abs(dh) +
      styleDeltas.length * 3;

    deltas.push({
      selector: sel,
      status: "changed",
      positionDelta: moved ? { dx, dy } : undefined,
      sizeDelta: resized ? { dw, dh } : undefined,
      styleDeltas,
      severity,
    });
  }

  for (const sel of tgtMap.keys()) {
    if (!baseMap.has(sel)) {
      deltas.push({ selector: sel, status: "added", styleDeltas: [], severity: 40 });
    }
  }

  return deltas.sort((a, b) => b.severity - a.severity);
}

/** Render the top deltas as a compact, instruction-shaped string for an agent. */
export function describeRegions(regions: RegionDelta[], limit = 8): string {
  if (regions.length === 0) return "No layout/style deltas.";
  const lines = regions.slice(0, limit).map((r) => {
    if (r.status === "missing") return `- ${r.selector}: MISSING in target`;
    if (r.status === "added") return `- ${r.selector}: EXTRA in target`;
    const bits: string[] = [];
    if (r.positionDelta) bits.push(`moved ${fmt(r.positionDelta.dx)},${fmt(r.positionDelta.dy)}px`);
    if (r.sizeDelta) bits.push(`size ${fmt(r.sizeDelta.dw)},${fmt(r.sizeDelta.dh)}px`);
    for (const s of r.styleDeltas.slice(0, 4)) {
      bits.push(`${s.prop}: ${s.after} (want ${s.before})`);
    }
    return `- ${r.selector}: ${bits.join("; ")}`;
  });
  const extra = regions.length > limit ? `\n  …and ${regions.length - limit} more` : "";
  return lines.join("\n") + extra;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmt(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}
