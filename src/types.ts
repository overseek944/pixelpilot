// Shared types for the PixelPilot visual-oracle engine.
//
// The whole design rests on one idea: pixel-perfection is a property of the
// *rendered output*, not the source code. So every type here describes what was
// actually painted (screenshots + resolved/computed layout), never the source.

export interface Viewport {
  width: number;
  height: number;
  /** Human label used in cell ids, e.g. "desktop". Defaults to `${w}x${h}`. */
  label?: string;
}

export type Theme = "light" | "dark";

/** A scenario as written in pixelpilot.config.json (loosely specified). */
export interface ScenarioConfig {
  name: string;
  /** Source / baseline URL (the app you are migrating FROM). */
  url: string;
  /** Target URL (the migrated app you are migrating TO). Used by `diff`. */
  targetUrl?: string;
  /** Optional element to scope capture to (CSS selector). */
  selector?: string;
  viewports?: Viewport[];
  themes?: Theme[];
  /** Wait for this selector before screenshotting. */
  waitForSelector?: string;
  /** Extra settle time in ms before screenshotting. */
  waitMs?: number;
}

/** A scenario with all defaults filled in. */
export interface ResolvedScenario {
  name: string;
  url: string;
  selector?: string;
  viewports: Viewport[];
  themes: Theme[];
  waitForSelector?: string;
  waitMs?: number;
}

/** One node of the resolved layout tree — the "what it actually looks like" IR. */
export interface LayoutNode {
  selector: string;
  rect: { x: number; y: number; width: number; height: number };
  /** Curated set of *computed* (resolved) styles, not authored CSS. */
  styles: Record<string, string>;
}

/** A single captured cell: one scenario at one viewport and one theme. */
export interface CapturedCell {
  cellId: string; // `${scenario}__${viewportLabel}__${theme}`
  scenario: string;
  viewport: Viewport;
  theme: Theme;
  png: Buffer;
  layout: LayoutNode[];
}

export interface StyleDelta {
  prop: string;
  before: string;
  after: string;
}

/** A localized, machine-actionable difference for one element. */
export interface RegionDelta {
  selector: string;
  status: "changed" | "missing" | "added";
  /** Pixels the element moved (target minus baseline). */
  positionDelta?: { dx: number; dy: number };
  /** Pixels the element grew/shrank (target minus baseline). */
  sizeDelta?: { dw: number; dh: number };
  styleDeltas: StyleDelta[];
  /** Higher = more visually significant. Used to sort + pick what to fix first. */
  severity: number;
}

export interface ImageDiff {
  width: number;
  height: number;
  diffPixels: number;
  totalPixels: number;
  ratio: number;
  sizeMismatch: boolean;
  baselineSize?: { width: number; height: number };
  targetSize?: { width: number; height: number };
  diffPngBase64?: string;
}

export interface CellDiff {
  cellId: string;
  scenario: string;
  image: ImageDiff;
  ssim: number;
  regions: RegionDelta[];
  pass: boolean;
  diffImagePath?: string;
}

export interface DiffReport {
  name: string;
  pass: boolean;
  tolerance: Tolerance;
  cells: CellDiff[];
  worstCellId?: string;
}

export interface Tolerance {
  /** Max fraction of pixels allowed to differ, e.g. 0.001 = 0.1%. */
  maxDiffRatio: number;
  /** Minimum acceptable mean-SSIM, e.g. 0.99. */
  minSsim: number;
  /** pixelmatch per-pixel sensitivity (0-1, lower = stricter). */
  pixelmatchThreshold: number;
}

export interface DispatchConfig {
  /** notify = print/desktop only; command/claude/codex = hand work to an agent. */
  mode: "notify" | "command" | "claude" | "codex";
  /** ask = surface + queue, never auto-edit; auto = dispatch immediately. */
  gate: "ask" | "auto";
  /** Shell command template for mode=command. */
  command?: string;
  /** Model for mode=claude (e.g. "sonnet", "claude-opus-4-7"). */
  model?: string;
  /** Comma-separated allowed tools for mode=claude. */
  allowedTools?: string;
}

export interface Config {
  /** Optional base used to rewrite scenario URLs for the source app. */
  baselineUrlBase?: string;
  /** Optional base used to rewrite scenario URLs for the target app. */
  targetUrlBase?: string;
  scenarios: ScenarioConfig[];
  defaultViewports: Viewport[];
  defaultThemes: Theme[];
  tolerance: Tolerance;
  /** Globs/paths the daemon watches for UI changes. */
  uiPaths: string[];
  /** Where baselines, diffs and reports are written (relative to cwd). */
  outDir: string;
  dispatch: DispatchConfig;
}
