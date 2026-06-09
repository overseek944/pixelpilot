import type {
  CellDiff,
  DiffReport,
  ImageDiff,
  LayoutNode,
  Tolerance,
} from "../types.js";
import { diffImages } from "./image-diff.js";
import { ssimImages } from "./ssim.js";
import { diffLayouts } from "./layout-diff.js";

export interface CellInputs {
  cellId: string;
  scenario: string;
  baselinePng: Buffer;
  targetPng: Buffer;
  baselineLayout: LayoutNode[];
  targetLayout: LayoutNode[];
}

/** Diff one cell across all three signals and decide pass/fail vs tolerance. */
export function diffCell(input: CellInputs, tolerance: Tolerance): CellDiff {
  const image: ImageDiff = diffImages(
    input.baselinePng,
    input.targetPng,
    tolerance.pixelmatchThreshold,
  );
  const ssim = ssimImages(input.baselinePng, input.targetPng);
  const regions = diffLayouts(input.baselineLayout, input.targetLayout);

  const pass =
    image.ratio <= tolerance.maxDiffRatio &&
    ssim >= tolerance.minSsim &&
    !image.sizeMismatch;

  return { cellId: input.cellId, scenario: input.scenario, image, ssim, regions, pass };
}

export function buildReport(
  name: string,
  cells: CellDiff[],
  tolerance: Tolerance,
): DiffReport {
  const pass = cells.every((c) => c.pass);
  const worst = [...cells].sort((a, b) => b.image.ratio - a.image.ratio)[0];
  return { name, pass, tolerance, cells, worstCellId: worst?.cellId };
}

/** A short human summary suitable for a terminal or a hook message. */
export function summarize(report: DiffReport): string {
  const status = report.pass ? "PASS" : "FAIL";
  const lines = [`PixelPilot ${status} — "${report.name}" (${report.cells.length} cell(s))`];
  for (const c of report.cells) {
    const flag = c.pass ? "ok " : "OFF";
    lines.push(
      `  [${flag}] ${c.cellId}  diff=${(c.image.ratio * 100).toFixed(3)}%  ssim=${c.ssim.toFixed(4)}` +
        (c.image.sizeMismatch
          ? `  size!=(${c.image.baselineSize?.width}x${c.image.baselineSize?.height} vs ${c.image.targetSize?.width}x${c.image.targetSize?.height})`
          : ""),
    );
  }
  return lines.join("\n");
}
