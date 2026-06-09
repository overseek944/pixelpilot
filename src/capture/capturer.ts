import type { CapturedCell, ResolvedScenario } from "../types.js";

/**
 * A Capturer turns a scenario into rendered ground truth (screenshot + resolved
 * layout) for each viewport/theme cell.
 *
 * This is the ONLY framework/engine-specific seam in the whole system. The web
 * implementation uses Playwright; a native implementation (SwiftUI/RN snapshot
 * + accessibility tree) would implement the same interface and everything
 * downstream — diffing, reporting, the daemon, the MCP server, the hooks —
 * works unchanged.
 */
export interface Capturer {
  capture(scenario: ResolvedScenario): Promise<CapturedCell[]>;
  close(): Promise<void>;
}
