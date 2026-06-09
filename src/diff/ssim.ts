import { PNG } from "pngjs";

/**
 * Mean-SSIM (structural similarity) over luma, computed on non-overlapping
 * blocks. 1.0 = identical. SSIM is a perceptual companion to the raw pixel
 * ratio: it tolerates tiny intensity shifts but punishes structural change
 * (text moving, edges shifting), which is exactly the failure mode that matters
 * in a migration. Constants follow Wang et al. 2004 (K1=0.01, K2=0.03, L=255).
 */
export function ssimImages(baseline: Buffer, target: Buffer, window = 8): number {
  const a = PNG.sync.read(baseline);
  const b = PNG.sync.read(target);
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  if (w < window || h < window) return a.width === b.width && a.height === b.height ? 1 : 0;
  const la = toLuma(a.data, a.width, w, h);
  const lb = toLuma(b.data, b.width, w, h);
  return meanSsim(la, lb, w, h, window);
}

function toLuma(
  data: Buffer,
  stride: number,
  w: number,
  h: number,
): Float64Array {
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = (y * stride + x) * 4;
      out[y * w + x] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
    }
  }
  return out;
}

function meanSsim(
  a: Float64Array,
  b: Float64Array,
  w: number,
  h: number,
  win: number,
): number {
  const C1 = 6.5025; // (0.01*255)^2
  const C2 = 58.5225; // (0.03*255)^2
  let total = 0;
  let count = 0;
  for (let y = 0; y + win <= h; y += win) {
    for (let x = 0; x + win <= w; x += win) {
      let sx = 0,
        sy = 0,
        sxx = 0,
        syy = 0,
        sxy = 0;
      const n = win * win;
      for (let dy = 0; dy < win; dy++) {
        for (let dx = 0; dx < win; dx++) {
          const i = (y + dy) * w + (x + dx);
          const va = a[i];
          const vb = b[i];
          sx += va;
          sy += vb;
          sxx += va * va;
          syy += vb * vb;
          sxy += va * vb;
        }
      }
      const mx = sx / n;
      const my = sy / n;
      const vx = (sxx - n * mx * mx) / (n - 1);
      const vy = (syy - n * my * my) / (n - 1);
      const cxy = (sxy - n * mx * my) / (n - 1);
      total +=
        ((2 * mx * my + C1) * (2 * cxy + C2)) /
        ((mx * mx + my * my + C1) * (vx + vy + C2));
      count++;
    }
  }
  return count === 0 ? 1 : total / count;
}
