import chokidar from "chokidar";
import path from "node:path";
import type { Config } from "../types.js";
import { resolveScenarios } from "../config.js";
import { diffAgainstBaseline, hasBaseline } from "../engine.js";
import { summarize } from "../diff/report.js";
import { dispatch } from "./dispatch.js";

/**
 * The out-of-session control loop. Watches UI paths, and on change re-renders
 * the target + diffs it against the baseline. If it drifted, it gates/dispatches
 * a fix per config.dispatch. This is the "daemon that forces the AI to work"
 * path — but it works by *spawning a fresh scoped run*, not by interrupting a
 * live interactive session (which isn't a supported primitive).
 */
export async function runWatch(config: Config, cwd: string): Promise<void> {
  if (!hasBaseline(config, cwd)) {
    console.error(
      "No baseline yet. Run `pixelpilot capture` against your source app first.",
    );
    process.exit(1);
  }

  const watchPaths = config.uiPaths.map((p) => path.resolve(cwd, p));
  console.log(`PixelPilot watching:\n  ${watchPaths.join("\n  ")}`);
  console.log(
    `Dispatch: mode=${config.dispatch.mode} gate=${config.dispatch.gate}\n`,
  );

  let running = false;
  let queued = false;

  const runCycle = async (trigger: string) => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      console.log(`\n[${stamp()}] change (${trigger}) -> re-diffing target…`);
      const scenarios = resolveScenarios(config, "target");
      const report = await diffAgainstBaseline(config, scenarios, cwd, "watch");
      console.log(summarize(report));
      if (!report.pass) {
        await dispatch(config, report, cwd);
      } else {
        console.log("[watch] within tolerance — nothing to do.");
      }
    } catch (err) {
      console.error("[watch] cycle error:", (err as Error).message);
    } finally {
      running = false;
      if (queued) {
        queued = false;
        void runCycle("queued");
      }
    }
  };

  const debounced = debounce((p: string) => void runCycle(path.basename(p)), 400);

  const watcher = chokidar.watch(watchPaths, {
    ignoreInitial: true,
    ignored: (p: string) => /node_modules|\.git|\.pixelpilot/.test(p),
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });
  watcher.on("all", (_event, p) => debounced(p));

  process.on("SIGINT", () => {
    console.log("\nPixelPilot watcher stopped.");
    void watcher.close().then(() => process.exit(0));
  });
}

function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout> | undefined;
  return ((...args: any[]) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}

function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}
