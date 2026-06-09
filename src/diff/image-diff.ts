import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import type { ImageDiff } from "../types.js";

/**
 * Pixel diff with anti-aliasing tolerance (includeAA: false) — this is what
 * stops text anti-aliasing from being counted as a difference, which is the
 * single most important setting for UI diffing. Returns counts, a ratio, and a
 * base64 PNG diff image highlighting changed regions in red.
 *
 * Size mismatches are handled by diffing the common (top-left) region and
 * counting the non-overlapping area as differing, so the ratio stays honest.
 */
export function diffImages(
  baseline: Buffer,
  target: Buffer,
  pixelmatchThreshold = 0.1,
): ImageDiff {
  const a = PNG.sync.read(baseline);
  const b = PNG.sync.read(target);

  const sizeMismatch = a.width !== b.width || a.height !== b.height;
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);

  const ca = sizeMismatch ? cropTo(a, width, height) : a;
  const cb = sizeMismatch ? cropTo(b, width, height) : b;

  const diff = new PNG({ width, height });
  const overlapDiff = pixelmatch(ca.data, cb.data, diff.data, width, height, {
    threshold: pixelmatchThreshold,
    includeAA: false, // ignore anti-aliased (text) edges
    alpha: 0.1,
    diffColor: [255, 0, 0],
    aaColor: [255, 255, 0],
  });

  // Penalize the non-overlapping area so a smaller/larger target can't "hide".
  const maxTotal = Math.max(a.width * a.height, b.width * b.height);
  const overlapTotal = width * height;
  const nonOverlap = sizeMismatch ? maxTotal - overlapTotal : 0;
  const diffPixels = overlapDiff + nonOverlap;

  return {
    width,
    height,
    diffPixels,
    totalPixels: maxTotal,
    ratio: maxTotal === 0 ? 0 : diffPixels / maxTotal,
    sizeMismatch,
    baselineSize: { width: a.width, height: a.height },
    targetSize: { width: b.width, height: b.height },
    diffPngBase64: PNG.sync.write(diff).toString("base64"),
  };
}

function cropTo(png: PNG, w: number, h: number): PNG {
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    const srcStart = y * png.width * 4;
    const dstStart = y * w * 4;
    png.data.copy(out.data, dstStart, srcStart, srcStart + w * 4);
  }
  return out;
}
