// Browserless self-test for the diff engine math. Verifies image diff, SSIM,
// and layout diff on synthetic inputs — no Playwright required. Run:
//   npm run selftest
import { PNG } from "pngjs";
import { diffImages } from "../src/diff/image-diff.js";
import { ssimImages } from "../src/diff/ssim.js";
import { diffLayouts } from "../src/diff/layout-diff.js";
import type { LayoutNode } from "../src/types.js";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

function solid(w: number, h: number, rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    png.data[i * 4] = rgba[0];
    png.data[i * 4 + 1] = rgba[1];
    png.data[i * 4 + 2] = rgba[2];
    png.data[i * 4 + 3] = rgba[3];
  }
  return PNG.sync.write(png);
}

function withBlock(
  w: number,
  h: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): Buffer {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inBlock = x >= bx && x < bx + bw && y >= by && y < by + bh;
      png.data[i] = inBlock ? 255 : 255;
      png.data[i + 1] = inBlock ? 0 : 255;
      png.data[i + 2] = inBlock ? 0 : 255;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

console.log("PixelPilot self-test (no browser)\n");

console.log("image-diff:");
{
  const base = solid(64, 64, [255, 255, 255, 255]);
  const same = solid(64, 64, [255, 255, 255, 255]);
  const drift = withBlock(64, 64, 10, 10, 8, 8); // 64 red px

  const identical = diffImages(base, same);
  assert(identical.diffPixels === 0, "identical images -> 0 diff pixels");
  assert(identical.ratio === 0, "identical images -> ratio 0");

  const changed = diffImages(base, drift);
  assert(changed.diffPixels >= 60 && changed.diffPixels <= 70, `8x8 block -> ~64 diff px (got ${changed.diffPixels})`);
  assert(changed.ratio > 0 && changed.ratio < 0.05, `small block -> small ratio (got ${changed.ratio.toFixed(4)})`);
  assert(!!changed.diffPngBase64 && changed.diffPngBase64.length > 0, "produces a diff image");

  const mismatch = diffImages(solid(64, 64, [255, 255, 255, 255]), solid(48, 64, [255, 255, 255, 255]));
  assert(mismatch.sizeMismatch === true, "different sizes -> sizeMismatch flag");
  assert(mismatch.diffPixels > 0, "size mismatch counts non-overlap as diff");
}

console.log("\nssim:");
{
  const base = solid(64, 64, [255, 255, 255, 255]);
  const same = solid(64, 64, [255, 255, 255, 255]);
  const drift = withBlock(64, 64, 10, 10, 16, 16);
  assert(ssimImages(base, same) > 0.999, "identical -> SSIM ~1.0");
  const s = ssimImages(base, drift);
  assert(s < 1 && s >= 0, `structural change -> SSIM < 1 (got ${s.toFixed(4)})`);
}

console.log("\nlayout-diff:");
{
  const baseLayout: LayoutNode[] = [
    { selector: "#a", rect: { x: 0, y: 0, width: 100, height: 20 }, styles: { "font-size": "16px", color: "rgb(0, 0, 0)" } },
    { selector: "#gone", rect: { x: 0, y: 40, width: 50, height: 10 }, styles: {} },
  ];
  const tgtLayout: LayoutNode[] = [
    { selector: "#a", rect: { x: 2, y: 0, width: 100, height: 20 }, styles: { "font-size": "15px", color: "rgb(0, 0, 0)" } },
    { selector: "#new", rect: { x: 0, y: 60, width: 30, height: 10 }, styles: {} },
  ];
  const deltas = diffLayouts(baseLayout, tgtLayout);
  const a = deltas.find((d) => d.selector === "#a");
  assert(!!a && a.status === "changed", "#a flagged changed");
  assert(!!a?.positionDelta && a.positionDelta.dx === 2, `#a moved dx=+2 (got ${a?.positionDelta?.dx})`);
  assert(!!a?.styleDeltas.find((s) => s.prop === "font-size"), "#a font-size delta captured");
  assert(!!deltas.find((d) => d.selector === "#gone" && d.status === "missing"), "#gone -> missing");
  assert(!!deltas.find((d) => d.selector === "#new" && d.status === "added"), "#new -> added");
}

console.log(`\n${failures === 0 ? "ALL PASS ✅" : `${failures} FAILURE(S) ❌`}`);
process.exit(failures === 0 ? 0 : 1);
