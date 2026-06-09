# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-09

Initial public release.

### Added

- **Engine** — Playwright capturer (screenshot + resolved computed-style layout
  tree) across a viewport × theme matrix.
- **Diff** — pixel diff (`pixelmatch`, anti-alias tolerant), mean-SSIM, and a
  selector-keyed layout diff producing machine-actionable move/resize/style
  deltas.
- **CLI** — `init`, `capture`, `diff`, `check`, `watch`.
- **MCP server** — `capture_baseline`, `visual_diff` (returns text + structured
  deltas + the diff image), `list_scenarios`.
- **Claude Code hooks** — `PostToolUse` delta-injection and `Stop` tolerance gate
  (loop-guarded).
- **Daemon** — `watch` control loop with `notify` / `command` / `claude` /
  `codex` dispatch and an `ask` / `auto` safety gate.
- Tolerance config, a bundled demo, and a browserless self-test (15 assertions).

[0.1.0]: https://github.com/overseek944/pixelpilot/releases/tag/v0.1.0
