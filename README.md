# PixelPilot

A **visual-oracle engine for pixel-perfect UI migration.** It captures the
rendered ground truth of your source app, diffs a target (migrated) app against
it, and gives an AI agent the exact, machine-actionable deltas — then gates or
dispatches work until the pixels match.

The core idea: **pixel-perfection is a property of the rendered output, not the
source code.** An agent that reads source in one framework and rewrites it in
another is optimizing the wrong representation — it translates abstractions and
hopes they resolve to the same pixels. PixelPilot makes the *render* the ground
truth and the *visual diff* the objective function. The agent stops guessing and
starts minimizing a measured error.

> Status: working reference implementation. The engine (capture + diff), CLI,
> MCP server, Claude Code hooks, and the daemon are all implemented and tested.

---

## Why this isn't "just an agent/skill"

An agent translating source → source has no visual ground truth and no feedback
signal, so it stalls at ~80–90%: the last 10% (exact line-height, sub-pixel
spacing, baseline alignment) isn't recoverable from source semantics — it only
exists in the render. PixelPilot supplies the three things the agent lacks:

1. **Eyes** — render + screenshot the source and target across a matrix.
2. **A scoreboard** — per-region deltas (`#cta moved 0,+4px; padding-top 10px vs 12px`).
3. **A stopping condition** — pass/fail vs a tolerance.

## Honest scope

- **Same rendering engine** (React → Vue → Svelte, all web): true pixel-perfect
  is achievable. This is the implemented case.
- **Cross engine** (web → SwiftUI/RN): byte-identical is physically impossible
  (different text rasterization, line-height math, color spaces). The target is
  *perceptual-within-tolerance*. Swap the `Capturer` (the only engine-specific
  seam) for a native snapshotter and everything else here is reused.

---

## Architecture — three portable layers + a daemon

```
Engine (CLI)         agent-agnostic ground truth: capture, diff, check, watch
   │                 src/capture, src/diff, src/engine.ts, src/cli.ts
Protocol (MCP)       structured tools + diff image for any MCP client
   │                 src/mcp/server.ts
Orchestration        Claude Code hooks (in-session gate) — thin, per-agent
   │                 hooks/pixelpilot-hook.mjs
Daemon               out-of-session control loop: watch → diff → gate/dispatch
                     src/daemon/*  (cannot be a plugin — must be standalone)
```

The engine and protocol are portable across agents (Claude Code, Codex, CI, a
human). Only the orchestration layer is agent-specific, and it's small.

---

## Install

```bash
cd pixelpilot
npm install
# Playwright browsers: already cached on this machine. Otherwise:
#   npx playwright install chromium
npm run build          # compiles to dist/  (or just use `npx tsx` in dev)
```

## Try the demo (no config needed)

`examples/source.html` and `examples/target.html` are identical in structure but
the target has subtle hand-migration drift (font-size 20→19, line-height 24→22,
padding 12→10, radius 8→6).

```bash
npx tsx src/cli.ts capture examples/source.html --name demo   # baseline the source
npx tsx src/cli.ts diff    examples/target.html --name demo   # diff the target
```

Output:

```
PixelPilot FAIL — "demo" (1 cell(s))
  [OFF] demo__desktop__light  diff=0.333%  ssim=0.9845

Top deltas (demo__desktop__light):
- #body:  moved 0,+3.5px; size 0,-4px; line-height: 22px (want 24px); color: rgb(107,114,128) (want rgb(75,85,99))
- #title: moved 0,+4.5px; font-size: 19px (want 20px); color: rgb(31,41,55) (want rgb(17,24,39))
- #cta:   size 0,-4px; padding-top: 10px (want 12px); padding-bottom: 10px (want 12px); border-radius: 6px (want 8px)
```

The diff image is written to `.pixelpilot/diffs/`. Self-test the diff math with
no browser: `npm run selftest`.

---

## CLI

| Command | What it does |
| --- | --- |
| `pixelpilot init` | Write a starter `pixelpilot.config.json` |
| `pixelpilot capture [url]` | Render the **source** app, store baseline (PNG + resolved layout) |
| `pixelpilot diff [url]` | Render the **target**, diff vs baseline, print deltas (exit 1 on fail) |
| `pixelpilot check [url]` | Pass/fail gate for hooks & CI (exit 0/1); no-ops to pass if no baseline |
| `pixelpilot watch` | Daemon: watch UI paths, re-diff on change, gate/dispatch |

Ad-hoc mode takes a URL + `--name`/`--viewport`/`--selector`. Config mode
(`pixelpilot.config.json`) drives scenarios across a viewport × theme matrix.

### Config

```jsonc
{
  "baselineUrlBase": "http://localhost:3000",   // source app
  "targetUrlBase":   "http://localhost:5173",   // migrated app
  "scenarios": [{ "name": "home", "url": "/", "targetUrl": "/" }],
  "defaultViewports": [{ "width": 1280, "height": 800, "label": "desktop" }],
  "defaultThemes": ["light"],
  "tolerance": { "maxDiffRatio": 0.001, "minSsim": 0.99, "pixelmatchThreshold": 0.1 },
  "uiPaths": ["src"],
  "outDir": ".pixelpilot",
  "dispatch": { "mode": "notify", "gate": "ask" }
}
```

---

## Integration path A — Claude Code hooks (in-session)

Keeps an active migration session honest, reacting to the agent's *own* edits.
Configure once; fires automatically forever.

- **PostToolUse** (Edit|Write): after a UI edit, runs `pixelpilot check`; if it
  drifted, injects the deltas back as `additionalContext` so Claude fixes it.
- **Stop**: refuses to let Claude finish while the diff is over tolerance
  (loop-guarded via `stop_hook_active`).

Merge `hooks/settings.snippet.json` into your project `.claude/settings.json`
(adjust the absolute path). For dev without a global install:

```bash
export PIXELPILOT_CMD="npx tsx /abs/path/pixelpilot/src/cli.ts"
```

## Integration path B — MCP server (cross-agent)

Gives the agent structured tools mid-migration. `visual_diff` returns three
things — a text verdict, structured per-region deltas, **and the diff image** —
which is what makes the loop converge.

```bash
claude mcp add pixelpilot -- node /abs/path/pixelpilot/dist/mcp/server.js
# or copy .mcp.json into your project root
```

Tools: `capture_baseline`, `visual_diff`, `list_scenarios`.

## Integration path C — the daemon (out-of-session)

`pixelpilot watch` is the always-on control loop. It cannot be a Claude Code
plugin (plugins live inside a session) — that's why the engine is standalone. On
drift it **spawns a fresh scoped agent run**; it never injects into a live
interactive session, which isn't a supported primitive.

`dispatch.mode`: `notify` | `command` | `claude` | `codex`.
`dispatch.gate`: `ask` (surface + queue to `.pixelpilot/pending.json`, never
auto-edit) or `auto` (dispatch immediately).

**Safety:** the defaults are `notify` + `ask`. If you enable `auto`, run the
agent against an isolated git worktree, never your live tree, with the tolerance
and `--max-turns` as stop conditions. If an interactive session is active, let
path A's hooks handle it so the daemon and the human don't race on the same files.

---

## How the diff works

- **Pixel diff** — `pixelmatch` with `includeAA: false` so text anti-aliasing is
  not counted as a difference (the single most important setting).
- **SSIM** — mean structural similarity over luma; catches structural drift the
  raw ratio can miss.
- **Layout diff** — compares resolved layout trees (bounding boxes + curated
  computed styles) by selector → the actionable `move/resize/style` deltas.
- **Determinism** — fixed `deviceScaleFactor`, `scale: "css"`, animations
  disabled, and `document.fonts.ready` awaited before every screenshot.

A cell passes when `diffRatio ≤ maxDiffRatio` **and** `ssim ≥ minSsim` **and**
there's no size mismatch.

## Layout on disk (`.pixelpilot/`)

```
baseline/<cellId>.png            screenshot of the SOURCE app
baseline/<cellId>.layout.json    resolved layout tree of the SOURCE app
diffs/<cellId>.diff.png          last visual diff image
diffs/report.json                last machine-readable report
```

## Extending to native (cross-engine)

Implement `Capturer` (`src/capture/capturer.ts`) with a native snapshotter
(SwiftUI/RN snapshot + accessibility tree) and register it. Diffing, reporting,
the daemon, MCP, and hooks all work unchanged — only the capture seam differs.
```
