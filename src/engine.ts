import fs from "node:fs";
import path from "node:path";
import type {
  CapturedCell,
  CellDiff,
  Config,
  DiffReport,
  LayoutNode,
  ResolvedScenario,
} from "./types.js";
import { PlaywrightCapturer } from "./capture/playwright.js";
import type { Capturer } from "./capture/capturer.js";
import { buildReport, diffCell, type CellInputs } from "./diff/report.js";

/**
 * On-disk layout under <outDir>:
 *   baseline/<cellId>.png            screenshot of the SOURCE app
 *   baseline/<cellId>.layout.json    resolved layout tree of the SOURCE app
 *   diffs/<cellId>.diff.png          visual diff image (last run)
 *   diffs/report.json                machine-readable last report
 */

export function baselineDir(config: Config, cwd: string): string {
  return path.join(cwd, config.outDir, "baseline");
}
export function diffsDir(config: Config, cwd: string): string {
  return path.join(cwd, config.outDir, "diffs");
}

/** Capture the SOURCE app and persist it as the baseline ground truth. */
export async function captureBaseline(
  config: Config,
  scenarios: ResolvedScenario[],
  cwd: string,
  capturer: Capturer = new PlaywrightCapturer(),
): Promise<{ cells: number }> {
  const dir = baselineDir(config, cwd);
  fs.mkdirSync(dir, { recursive: true });
  let total = 0;
  try {
    for (const scenario of scenarios) {
      const cells = await capturer.capture(scenario);
      for (const cell of cells) {
        fs.writeFileSync(path.join(dir, `${cell.cellId}.png`), cell.png);
        fs.writeFileSync(
          path.join(dir, `${cell.cellId}.layout.json`),
          JSON.stringify(cell.layout),
        );
        total++;
      }
    }
  } finally {
    await capturer.close();
  }
  return { cells: total };
}

function loadBaselineCell(
  config: Config,
  cwd: string,
  cellId: string,
): { png: Buffer; layout: LayoutNode[] } | null {
  const dir = baselineDir(config, cwd);
  const pngPath = path.join(dir, `${cellId}.png`);
  const layoutPath = path.join(dir, `${cellId}.layout.json`);
  if (!fs.existsSync(pngPath) || !fs.existsSync(layoutPath)) return null;
  return {
    png: fs.readFileSync(pngPath),
    layout: JSON.parse(fs.readFileSync(layoutPath, "utf8")) as LayoutNode[],
  };
}

export function hasBaseline(config: Config, cwd: string): boolean {
  const dir = baselineDir(config, cwd);
  return fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith(".png"));
}

/** Capture the TARGET app and diff every cell against the stored baseline. */
export async function diffAgainstBaseline(
  config: Config,
  scenarios: ResolvedScenario[],
  cwd: string,
  name: string,
  capturer: Capturer = new PlaywrightCapturer(),
): Promise<DiffReport> {
  const cellDiffs: CellDiff[] = [];
  const outDir = diffsDir(config, cwd);
  fs.mkdirSync(outDir, { recursive: true });

  try {
    for (const scenario of scenarios) {
      const captured: CapturedCell[] = await capturer.capture(scenario);
      for (const cell of captured) {
        const base = loadBaselineCell(config, cwd, cell.cellId);
        if (!base) {
          throw new Error(
            `No baseline for cell "${cell.cellId}". Run \`pixelpilot capture\` first.`,
          );
        }
        const inputs: CellInputs = {
          cellId: cell.cellId,
          scenario: cell.scenario,
          baselinePng: base.png,
          targetPng: cell.png,
          baselineLayout: base.layout,
          targetLayout: cell.layout,
        };
        const cd = diffCell(inputs, config.tolerance);
        if (cd.image.diffPngBase64) {
          const diffPath = path.join(outDir, `${cell.cellId}.diff.png`);
          fs.writeFileSync(diffPath, Buffer.from(cd.image.diffPngBase64, "base64"));
          cd.diffImagePath = diffPath;
        }
        cellDiffs.push(cd);
      }
    }
  } finally {
    await capturer.close();
  }

  const report = buildReport(name, cellDiffs, config.tolerance);
  // Persist a slim report (drop base64 blobs to keep it readable).
  const slim = {
    ...report,
    cells: report.cells.map((c) => ({
      ...c,
      image: { ...c.image, diffPngBase64: undefined },
    })),
  };
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(slim, null, 2));
  return report;
}
