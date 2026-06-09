# Contributing to PixelPilot

Thanks for your interest! PixelPilot is small, focused, and easy to hack on.

## Development setup

```bash
git clone https://github.com/overseek944/pixelpilot
cd pixelpilot
npm install
npx playwright install chromium   # if browsers aren't already cached
```

Run everything from source with `tsx` (no build step needed):

```bash
npx tsx src/cli.ts <command>      # the CLI
npm run selftest                  # engine math, no browser
npm run demo                      # capture + diff the bundled example
npm run build                     # type-check + compile to dist/
```

## Before opening a PR

1. `npm run build` passes (type-check is part of the build).
2. `npm run selftest` passes (15/15).
3. If you touched the diff engine, add an assertion to `scripts/selftest.ts`.
4. Keep the code style consistent with what's around it (2-space indent, ESM,
   `.js` extensions on relative imports — required by NodeNext).

## Project shape

The one rule that keeps this maintainable: **the engine never knows about the
agent, and the agent never knows about the rendering technology.**

- `src/capture/` — the only rendering-engine-specific code (the `Capturer` seam).
- `src/diff/` — pure functions over buffers + layout trees. No I/O, no browser.
- `src/engine.ts` — orchestration + persistence.
- `src/cli.ts`, `src/mcp/`, `src/daemon/`, `hooks/` — thin consumers of the engine.

## Good first issues

- A native `Capturer` (SwiftUI / React Native snapshot + accessibility tree).
- An `odiff` backend behind the `diffImages` interface for large full-page shots.
- A VLM-based diff interpreter that turns the diff image into prose guidance.
- HTML report output (`pixelpilot diff --report html`).

## Reporting bugs

Open an issue with: the two URLs/files, your `pixelpilot.config.json`, the
command you ran, and the `.pixelpilot/diffs/report.json` it produced.

By contributing you agree your contributions are licensed under the MIT License.
