#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  defaultConfig,
  loadConfig,
  parseViewport,
  resolveScenarios,
} from "./config.js";
import type { Config, ResolvedScenario, Viewport } from "./types.js";
import {
  captureBaseline,
  diffAgainstBaseline,
  hasBaseline,
} from "./engine.js";
import { summarize } from "./diff/report.js";
import { describeRegions } from "./diff/layout-diff.js";
import { runWatch } from "./daemon/watcher.js";

const cwd = process.cwd();

/** Turn a positional URL/path into an absolute file:// URL when it's a local file. */
function normalizeUrl(input: string): string {
  if (/^https?:\/\//.test(input) || input.startsWith("file:")) return input;
  return pathToFileURL(path.resolve(cwd, input)).href;
}

/** Build scenarios from either the config file or an ad-hoc URL + flags. */
function getScenarios(
  opts: { config?: string; name?: string; viewport?: string[]; selector?: string },
  url: string | undefined,
  which: "source" | "target",
): { config: Config; scenarios: ResolvedScenario[] } {
  const config = loadConfig(cwd, opts.config);
  if (url) {
    const base = config.scenarios.length ? config : defaultConfig();
    const viewports: Viewport[] =
      opts.viewport && opts.viewport.length
        ? opts.viewport.map(parseViewport)
        : base.defaultViewports;
    const scenario: ResolvedScenario = {
      name: opts.name ?? "default",
      url: normalizeUrl(url),
      selector: opts.selector,
      viewports,
      themes: base.defaultThemes,
    };
    return { config: base, scenarios: [scenario] };
  }
  if (config.scenarios.length === 0) {
    throw new Error(
      "No URL given and no scenarios in pixelpilot.config.json. Pass a URL or add scenarios.",
    );
  }
  return { config, scenarios: resolveScenarios(config, which) };
}

const program = new Command();
program
  .name("pixelpilot")
  .description(
    "Visual-oracle engine for pixel-perfect UI migration. Capture rendered ground truth, diff a target against it, and gate AI migration work until the pixels match.",
  )
  .version("0.1.0");

program
  .command("init")
  .description("Write a starter pixelpilot.config.json")
  .action(() => {
    const p = path.join(cwd, "pixelpilot.config.json");
    if (fs.existsSync(p)) {
      console.error("pixelpilot.config.json already exists.");
      process.exit(1);
    }
    const starter: Config = {
      baselineUrlBase: "http://localhost:3000",
      targetUrlBase: "http://localhost:5173",
      scenarios: [{ name: "home", url: "/", targetUrl: "/" }],
      defaultViewports: [
        { width: 1280, height: 800, label: "desktop" },
        { width: 390, height: 844, label: "mobile" },
      ],
      defaultThemes: ["light"],
      tolerance: { maxDiffRatio: 0.001, minSsim: 0.99, pixelmatchThreshold: 0.1 },
      uiPaths: ["src"],
      outDir: ".pixelpilot",
      dispatch: { mode: "notify", gate: "ask" },
    };
    fs.writeFileSync(p, JSON.stringify(starter, null, 2));
    console.log(`Wrote ${p}`);
  });

program
  .command("capture")
  .argument("[url]", "URL or local file of the SOURCE app to baseline")
  .option("-c, --config <path>", "config file")
  .option("-n, --name <name>", "scenario name (ad-hoc mode)")
  .option("-v, --viewport <WxH...>", "viewport(s), e.g. 1280x800:desktop")
  .option("-s, --selector <css>", "scope capture to an element")
  .description("Capture the source app as the baseline ground truth")
  .action(async (url, opts) => {
    const { config, scenarios } = getScenarios(opts, url, "source");
    const { cells } = await captureBaseline(config, scenarios, cwd);
    console.log(`Captured ${cells} baseline cell(s) -> ${path.join(config.outDir, "baseline")}`);
  });

program
  .command("diff")
  .argument("[url]", "URL or local file of the TARGET app to compare")
  .option("-c, --config <path>", "config file")
  .option("-n, --name <name>", "scenario name (ad-hoc mode)")
  .option("-v, --viewport <WxH...>", "viewport(s)")
  .option("-s, --selector <css>", "scope capture to an element")
  .option("--json", "print machine-readable JSON report")
  .description("Diff the target app against the stored baseline")
  .action(async (url, opts) => {
    const { config, scenarios } = getScenarios(opts, url, "target");
    const report = await diffAgainstBaseline(
      config,
      scenarios,
      cwd,
      opts.name ?? "diff",
    );
    if (opts.json) {
      console.log(
        JSON.stringify(
          { ...report, cells: report.cells.map((c) => ({ ...c, image: { ...c.image, diffPngBase64: undefined } })) },
          null,
          2,
        ),
      );
    } else {
      console.log(summarize(report));
      const worst = report.cells.find((c) => c.cellId === report.worstCellId);
      if (worst && !worst.pass) {
        console.log("\nTop deltas (" + worst.cellId + "):");
        console.log(describeRegions(worst.regions));
      }
    }
    process.exit(report.pass ? 0 : 1);
  });

program
  .command("check")
  .argument("[url]", "TARGET url (ad-hoc); omit to use config")
  .option("-c, --config <path>", "config file")
  .option("-n, --name <name>", "scenario name")
  .option("-v, --viewport <WxH...>", "viewport(s)")
  .option("-s, --selector <css>", "scope capture to an element")
  .description("Pass/fail gate for hooks & CI. Exit 0 if within tolerance, else 1. No-ops (pass) if no baseline.")
  .action(async (url, opts) => {
    const config = loadConfig(cwd, opts.config);
    if (!hasBaseline(config, cwd)) {
      console.log("PixelPilot: no baseline found; skipping (pass).");
      process.exit(0);
    }
    const { scenarios } = getScenarios(opts, url, "target");
    try {
      const report = await diffAgainstBaseline(config, scenarios, cwd, opts.name ?? "check");
      console.log(summarize(report));
      if (!report.pass) {
        const worst = report.cells.find((c) => c.cellId === report.worstCellId);
        if (worst) console.log(describeRegions(worst.regions));
      }
      process.exit(report.pass ? 0 : 1);
    } catch (err) {
      // A capture error shouldn't hard-block a dev's workflow; warn and pass.
      console.error("PixelPilot check error (passing):", (err as Error).message);
      process.exit(0);
    }
  });

program
  .command("watch")
  .option("-c, --config <path>", "config file")
  .description("Daemon: watch UI paths, re-diff on change, and gate/dispatch fixes")
  .action(async (opts) => {
    const config = loadConfig(cwd, opts.config);
    await runWatch(config, cwd);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error("Error:", (err as Error).message);
  process.exit(1);
});
