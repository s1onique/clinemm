/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (twenty-ninth-pass) — production-dump command registration
 * witness. Mirrors the CMD02 / CMD01 patterns in
 * `turn-state-writer-provenance.wprov.test.ts`.
 *
 * Asserts:
 *   - registry.ts exposes `DumpWCarrierTrace` as a debug command ID
 *     (source-only contract)
 *   - package.json contributes `cline.debug.dumpWCarrierTrace`
 *     with a palette-searchable title (source-only contract)
 *   - extension.ts:activate registers the dump command via
 *     `vscode.commands.registerCommand` against the registry
 *     constant (source-only contract)
 */

import { readFileSync as readFileSyncFs } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const COMMAND_REGISTRY_PATH = resolve(__dirname, "../../registry.ts")
const COMMAND_PACKAGE_JSON_PATH = resolve(__dirname, "../../../package.json")
const COMMAND_EXTENSION_PATH = resolve(__dirname, "../../extension.ts")

function readCommandSource(path: string): string {
	return readFileSyncFs(path, "utf8")
}

describe("WTRACE-CMD01: package.json contributes the dump command", () => {
	it("WTRACE-CMD01.1: dump command is declared in package.json with palette-searchable title", () => {
		const pkg = readCommandSource(COMMAND_PACKAGE_JSON_PATH)
		expect(pkg).toContain("cline.debug.dumpWCarrierTrace")
		expect(pkg).toMatch(
			/"command":\s*"cline\.debug\.dumpWCarrierTrace"[\s\S]*?"title":\s*"[^"]*[Dd]ump [Ww] [Cc]arrier [Tt]race[^"]*/,
		)
	})
})

describe("WTRACE-CMD02: registry exposes the dump command constant and extension.ts registers it", () => {
	it("WTRACE-CMD02.1: registry exposes DumpWCarrierTrace under .debug.*", () => {
		const registry = readCommandSource(COMMAND_REGISTRY_PATH)
		expect(registry).toContain("DumpWCarrierTrace")
		expect(registry).toMatch(/prefix\s*\+\s*"\.debug\.dumpWCarrierTrace"/)
	})

	it("WTRACE-CMD02.2: extension.ts registers the dump command via vscode.commands.registerCommand", () => {
		const ext = readCommandSource(COMMAND_EXTENSION_PATH)
		expect(ext).toMatch(/vscode\.commands\.registerCommand\([^)]*commands\.DumpWCarrierTrace/s)
	})
})
