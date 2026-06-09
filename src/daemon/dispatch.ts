import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Config, DiffReport } from "../types.js";
import { describeRegions } from "../diff/layout-diff.js";

/**
 * When the daemon detects drift, it hands work to an agent. Adapters are
 * deliberately agent-agnostic: the engine and the daemon stay portable, and
 * only this thin layer knows how to invoke a specific tool.
 *
 * SAFETY: the default mode is "notify" and the default gate is "ask". Auto-mode
 * that edits code should run against an isolated worktree, never your live tree
 * (see README). We never inject into a *live interactive* session — that's the
 * one thing these tools don't support cleanly. We spawn a fresh scoped run.
 */
export async function dispatch(
  config: Config,
  report: DiffReport,
  cwd: string,
): Promise<void> {
  const worst = report.cells.find((c) => c.cellId === report.worstCellId) ?? report.cells[0];
  const deltas = worst ? describeRegions(worst.regions) : "(no deltas)";
  const prompt = buildPrompt(report, deltas);
  const { mode, gate } = config.dispatch;

  // Always surface what happened.
  notify(`PixelPilot: drift in "${report.name}" — worst ${worst?.cellId ?? "?"}`);

  if (gate === "ask" && mode !== "notify") {
    // Queue the task instead of auto-editing. A human (or the next agent turn)
    // picks it up. This is the safe default.
    const queue = path.join(cwd, config.outDir, "pending.json");
    fs.writeFileSync(
      queue,
      JSON.stringify({ name: report.name, worst: worst?.cellId, prompt }, null, 2),
    );
    console.log(`[dispatch] gate=ask -> queued fix to ${queue} (mode "${mode}" not auto-run)`);
    return;
  }

  switch (mode) {
    case "notify":
      console.log("[dispatch] notify only.\n" + prompt);
      return;
    case "command":
      if (!config.dispatch.command) {
        console.error("[dispatch] mode=command but no dispatch.command configured.");
        return;
      }
      await run(config.dispatch.command, [], cwd, true, {
        PIXELPILOT_PROMPT: prompt,
        PIXELPILOT_DELTAS: deltas,
      });
      return;
    case "claude": {
      const args = [
        "-p",
        prompt,
        "--permission-mode",
        "acceptEdits",
        "--allowedTools",
        config.dispatch.allowedTools ?? "Read,Edit,Write,Bash,Glob,Grep",
      ];
      if (config.dispatch.model) args.push("--model", config.dispatch.model);
      await run("claude", args, cwd);
      return;
    }
    case "codex":
      await run("codex", ["exec", prompt], cwd);
      return;
  }
}

function buildPrompt(report: DiffReport, deltas: string): string {
  return [
    `The migrated UI has drifted from the source design (scenario "${report.name}").`,
    `Fix the target code so the rendered output matches the baseline.`,
    ``,
    `Worst cell: ${report.worstCellId}`,
    `Deltas (target vs intended baseline):`,
    deltas,
    ``,
    `After editing, run \`pixelpilot check\` and keep going until it passes (exit 0).`,
  ].join("\n");
}

function run(
  cmd: string,
  args: string[],
  cwd: string,
  useShell = false,
  extraEnv: Record<string, string> = {},
): Promise<void> {
  return new Promise((resolve) => {
    console.log(`[dispatch] spawning: ${cmd} ${args.length ? "(+args)" : ""}`);
    const child = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      env: { ...process.env, ...extraEnv },
      shell: useShell,
    });
    child.on("error", (e) => {
      console.error(`[dispatch] failed to spawn ${cmd}:`, e.message);
      resolve();
    });
    child.on("exit", (code) => {
      console.log(`[dispatch] ${cmd} exited ${code}`);
      resolve();
    });
  });
}

function notify(message: string): void {
  console.log(`\n🔔 ${message}`);
  if (process.platform === "darwin") {
    spawn("osascript", ["-e", `display notification "${message.replace(/"/g, "'")}" with title "PixelPilot"`], {
      stdio: "ignore",
    }).on("error", () => {});
  }
}
