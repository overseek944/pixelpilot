import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  defaultConfig,
  loadConfig,
  resolveScenarios,
} from "../config.js";
import type { Config, ResolvedScenario } from "../types.js";
import {
  captureBaseline,
  diffAgainstBaseline,
  hasBaseline,
} from "../engine.js";
import { describeRegions } from "../diff/layout-diff.js";

/**
 * MCP wrapper around the engine. The same capture/diff capability, exposed as
 * structured tools so an agent (Claude Code et al.) can call it mid-migration.
 *
 * The key design choice: visual_diff returns THREE things — a text summary, a
 * structuredContent object with per-region deltas, and the diff IMAGE. The agent
 * needs all three to converge: the image to see, the deltas to know exactly what
 * to change, and the pass flag to know when to stop.
 */
const cwd = process.cwd();

function normalizeUrl(input: string): string {
  if (/^https?:\/\//.test(input) || input.startsWith("file:")) return input;
  return pathToFileURL(path.resolve(cwd, input)).href;
}

function buildScenarios(
  config: Config,
  url: string | undefined,
  name: string | undefined,
  which: "source" | "target",
): ResolvedScenario[] {
  if (url) {
    const base = config.scenarios.length ? config : defaultConfig();
    return [
      {
        name: name ?? "default",
        url: normalizeUrl(url),
        viewports: base.defaultViewports,
        themes: base.defaultThemes,
      },
    ];
  }
  return resolveScenarios(config, which);
}

const server = new McpServer({ name: "pixelpilot", version: "0.1.0" });

server.registerTool(
  "capture_baseline",
  {
    title: "Capture baseline",
    description:
      "Render the SOURCE app and store it as the pixel-perfect baseline (screenshots + resolved layout). Run this once on the app you are migrating FROM.",
    inputSchema: {
      url: z.string().optional().describe("Source URL or local file. Omit to use config scenarios."),
      name: z.string().optional().describe("Scenario name for ad-hoc capture."),
    },
  },
  async ({ url, name }) => {
    const config = loadConfig(cwd);
    const scenarios = buildScenarios(config, url, name, "source");
    const { cells } = await captureBaseline(config, scenarios, cwd);
    return {
      content: [{ type: "text", text: `Captured ${cells} baseline cell(s).` }],
    };
  },
);

server.registerTool(
  "visual_diff",
  {
    title: "Visual diff",
    description:
      "Render the TARGET app and diff it against the baseline. Returns a pass/fail verdict, per-region deltas (move/resize/style), and the diff image. Use the deltas to make precise edits, then call again until pass=true.",
    inputSchema: {
      url: z.string().optional().describe("Target URL or local file. Omit to use config scenarios."),
      name: z.string().optional().describe("Scenario name for ad-hoc diff."),
    },
    outputSchema: {
      pass: z.boolean(),
      worstCellId: z.string().optional(),
      cells: z.array(
        z.object({
          cellId: z.string(),
          pass: z.boolean(),
          diffRatio: z.number(),
          ssim: z.number(),
          sizeMismatch: z.boolean(),
          topRegions: z.array(z.string()),
        }),
      ),
    },
  },
  async ({ url, name }) => {
    const config = loadConfig(cwd);
    if (!hasBaseline(config, cwd)) {
      return {
        content: [
          { type: "text", text: "No baseline found. Call capture_baseline first." },
        ],
        isError: true,
      };
    }
    const scenarios = buildScenarios(config, url, name, "target");
    const report = await diffAgainstBaseline(config, scenarios, cwd, name ?? "mcp");

    const structured = {
      pass: report.pass,
      worstCellId: report.worstCellId,
      cells: report.cells.map((c) => ({
        cellId: c.cellId,
        pass: c.pass,
        diffRatio: c.image.ratio,
        ssim: c.ssim,
        sizeMismatch: c.image.sizeMismatch,
        topRegions: describeRegions(c.regions, 6).split("\n"),
      })),
    };

    const worst = report.cells.find((c) => c.cellId === report.worstCellId);
    const text =
      `${report.pass ? "PASS" : "FAIL"} — ${report.cells.length} cell(s).\n` +
      report.cells
        .map(
          (c) =>
            `${c.pass ? "ok " : "OFF"} ${c.cellId} diff=${(c.image.ratio * 100).toFixed(3)}% ssim=${c.ssim.toFixed(4)}`,
        )
        .join("\n") +
      (worst && !worst.pass ? `\n\nTop deltas (${worst.cellId}):\n${describeRegions(worst.regions)}` : "");

    const content: Array<
      | { type: "text"; text: string }
      | { type: "image"; data: string; mimeType: string }
    > = [{ type: "text", text }];

    if (worst?.image.diffPngBase64) {
      content.push({
        type: "image",
        data: worst.image.diffPngBase64,
        mimeType: "image/png",
      });
    }

    return { content, structuredContent: structured };
  },
);

server.registerTool(
  "list_scenarios",
  {
    title: "List scenarios",
    description: "List configured migration scenarios and tolerance settings.",
    inputSchema: {},
  },
  async () => {
    const config = loadConfig(cwd);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { scenarios: config.scenarios, tolerance: config.tolerance },
            null,
            2,
          ),
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("pixelpilot MCP server running on stdio.");
