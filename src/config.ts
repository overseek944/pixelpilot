import fs from "node:fs";
import path from "node:path";
import type {
  Config,
  ResolvedScenario,
  ScenarioConfig,
  Theme,
  Viewport,
} from "./types.js";

export const DEFAULT_VIEWPORTS: Viewport[] = [
  { width: 1280, height: 800, label: "desktop" },
];

export const DEFAULT_THEMES: Theme[] = ["light"];

export const DEFAULT_TOLERANCE = {
  maxDiffRatio: 0.001, // 0.1% of pixels
  minSsim: 0.99,
  pixelmatchThreshold: 0.1,
};

export function defaultConfig(): Config {
  return {
    scenarios: [],
    defaultViewports: DEFAULT_VIEWPORTS,
    defaultThemes: DEFAULT_THEMES,
    tolerance: { ...DEFAULT_TOLERANCE },
    uiPaths: ["src"],
    outDir: ".pixelpilot",
    dispatch: { mode: "notify", gate: "ask" },
  };
}

/** Load pixelpilot.config.json if present, else return defaults. */
export function loadConfig(cwd: string, configPath?: string): Config {
  const p = configPath
    ? path.resolve(cwd, configPath)
    : path.join(cwd, "pixelpilot.config.json");
  const base = defaultConfig();
  if (!fs.existsSync(p)) return base;
  const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<Config>;
  return {
    ...base,
    ...raw,
    defaultViewports: raw.defaultViewports ?? base.defaultViewports,
    defaultThemes: raw.defaultThemes ?? base.defaultThemes,
    tolerance: { ...base.tolerance, ...(raw.tolerance ?? {}) },
    dispatch: { ...base.dispatch, ...(raw.dispatch ?? {}) },
    scenarios: raw.scenarios ?? base.scenarios,
  };
}

export function parseViewport(spec: string): Viewport {
  const m = /^(\d+)x(\d+)(?::(.+))?$/.exec(spec.trim());
  if (!m) throw new Error(`Invalid viewport "${spec}" (expected WxH or WxH:label)`);
  return {
    width: Number(m[1]),
    height: Number(m[2]),
    label: m[3],
  };
}

export function viewportLabel(vp: Viewport): string {
  return vp.label ?? `${vp.width}x${vp.height}`;
}

/** Resolve a config scenario against config defaults, choosing which URL to use. */
export function resolveScenario(
  s: ScenarioConfig,
  config: Config,
  which: "source" | "target",
): ResolvedScenario {
  const rawUrl =
    which === "target" ? s.targetUrl ?? s.url : s.url;
  const baseSub =
    which === "target" ? config.targetUrlBase : config.baselineUrlBase;
  const url = applyBase(rawUrl, baseSub);
  return {
    name: s.name,
    url,
    selector: s.selector,
    viewports: s.viewports ?? config.defaultViewports,
    themes: s.themes ?? config.defaultThemes,
    waitForSelector: s.waitForSelector,
    waitMs: s.waitMs,
  };
}

/** If a base is set and url is a path/relative, join; else return url. */
function applyBase(url: string, base?: string): string {
  if (!base) return url;
  if (/^https?:\/\//.test(url) || url.startsWith("file:")) return url;
  return base.replace(/\/$/, "") + "/" + url.replace(/^\//, "");
}

export function resolveScenarios(
  config: Config,
  which: "source" | "target",
): ResolvedScenario[] {
  return config.scenarios.map((s) => resolveScenario(s, config, which));
}
