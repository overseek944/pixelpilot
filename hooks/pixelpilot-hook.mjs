#!/usr/bin/env node
// PixelPilot Claude Code hook. Registered for BOTH PostToolUse and Stop; it
// branches on hook_event_name. Reads the hook payload on stdin and emits the
// hook JSON contract on stdout.
//
//   PostToolUse: after Claude edits a UI file, run `pixelpilot check`. If the
//   render drifted, inject the deltas back as additionalContext so Claude fixes
//   it. (PostToolUse cannot undo the edit; it nudges.)
//
//   Stop: before Claude is allowed to finish, run `pixelpilot check`. If still
//   over tolerance, block the stop and tell it to keep going. Guarded against
//   infinite loops via stop_hook_active.
//
// Configure the command via PIXELPILOT_CMD (default "pixelpilot"). For dev:
//   export PIXELPILOT_CMD="npx tsx /abs/path/pixelpilot/src/cli.ts"
import { spawnSync } from "node:child_process";

const UI_RE = /\.(tsx?|jsx?|vue|svelte|css|scss|sass|less|html|astro)$/i;
const CMD = process.env.PIXELPILOT_CMD || "pixelpilot";

function readStdin() {
  return new Promise((resolve) => {
    let d = "";
    process.stdin.on("data", (c) => (d += c));
    process.stdin.on("end", () => resolve(d));
  });
}

function runCheck() {
  const parts = CMD.split(" ").filter(Boolean);
  const r = spawnSync(parts[0], [...parts.slice(1), "check"], {
    encoding: "utf8",
  });
  return { code: r.status ?? 0, out: `${r.stdout || ""}${r.stderr || ""}`.trim() };
}

const raw = await readStdin();
let input = {};
try {
  input = JSON.parse(raw);
} catch {
  process.exit(0);
}

const event = input.hook_event_name;

if (event === "PostToolUse") {
  const fp = input.tool_input?.file_path || "";
  if (!UI_RE.test(fp)) process.exit(0);
  const { code, out } = runCheck();
  if (code === 0) process.exit(0);
  process.stdout.write(
    JSON.stringify({
      systemMessage: "PixelPilot: visual regression detected",
      additionalContext:
        `PixelPilot visual diff FAILED after editing ${fp}.\n${out}\n` +
        "Adjust the target UI so `pixelpilot check` passes before continuing.",
    }),
  );
  process.exit(0);
}

if (event === "Stop") {
  if (input.stop_hook_active) process.exit(0); // loop guard
  const { code, out } = runCheck();
  if (code === 0) process.exit(0);
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason:
        "PixelPilot: visual diff is still over tolerance — do not stop yet. " +
        "Keep fixing the target UI until `pixelpilot check` exits 0.\n" +
        out,
    }),
  );
  process.exit(0);
}

process.exit(0);
