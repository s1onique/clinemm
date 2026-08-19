// ============================================================================
// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-LIVE-CONTEXT-DIMENSIONS01-C1-FIXUP04
//
// Structural witness for the user-facing discoverability of the LCD01
// dump command. Mirrors the W5-5 pattern from
// `post-terminal-authority-diagnostic-wiring.test.ts`:
//
//   - The handler is registered at runtime via
//     `vscode.commands.registerCommand(commands.DumpLiveContextDimensions01,
//     ...)` in extension.ts.
//   - The registry exports the constant
//     `DumpLiveContextDimensions01 = prefix + ".debug.dumpLiveContextDimensions01"`.
//   - For the Command Palette to surface it, the extension manifest MUST
//     declare it under `contributes.commands`. Without that entry,
//     `registerCommand` alone leaves the command programmatic-only.
//
// This test pins the manifest so the user-invocation route frozen for
// C3 (live walk) stays intact.
// ============================================================================

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const PACKAGE_JSON_PATH = resolve(__dirname, "../../../package.json")
const REGISTRY_PATH = resolve(__dirname, "../../registry.ts")
const EXTENSION_TS_PATH = resolve(__dirname, "../../extension.ts")

function readSource(path: string): string {
	return readFileSync(path, "utf8")
}

describe("ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-LIVE-CONTEXT-DIMENSIONS01-C1-FIXUP04 / wiring", () => {
	describe("M1: command manifest discoverability", () => {
		it("M1-1: package.json declares the LCD01 dump command under contributes.commands", () => {
			const source = readSource(PACKAGE_JSON_PATH)
			expect(source).toContain("cline.debug.dumpLiveContextDimensions01")
		})

		it("M1-2: the registry exports the DumpLiveContextDimensions01 constant", () => {
			const source = readSource(REGISTRY_PATH)
			expect(source).toContain("DumpLiveContextDimensions01")
		})

		it("M1-3: extension.ts registers the LCD01 dump command at runtime", () => {
			const source = readSource(EXTENSION_TS_PATH)
			expect(source).toMatch(
				/vscode\.commands\.registerCommand\(\s*commands\.DumpLiveContextDimensions01/s,
			)
		})
	})
})