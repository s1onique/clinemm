/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01 — command registration + logger adapter
 * witnesses.
 *
 * Gates covered here:
 *   - The two Command Palette commands exist with the ACT's exact IDs and
 *     titles.
 *   - The ACTUAL SDK logger adapter (`createSdkLogger` in
 *     `cline-session-factory.ts`) forwards the SDK's structured log calls to
 *     the host logger, and the compaction diagnostics reach it.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const COMMAND_PACKAGE_JSON_PATH = resolve(__dirname, "../../../package.json")
const COMMAND_REGISTRY_PATH = resolve(__dirname, "../../registry.ts")
const COMMAND_EXTENSION_PATH = resolve(__dirname, "../../extension.ts")
const SESSION_FACTORY_PATH = resolve(__dirname, "../cline-session-factory.ts")

function readCommandSource(path: string): string {
	return readFileSync(path, "utf8")
}

describe("model behavior trace command registration", () => {
	it("CMD01.1: package.json declares both debug commands with palette-searchable titles", () => {
		const source = readCommandSource(COMMAND_PACKAGE_JSON_PATH)
		expect(source).toMatch(
			/"command":\s*"cline\.debug\.toggleModelBehaviorTrace"[\s\S]*?"title":\s*"Cline Debug: Toggle Model Behavior Trace"/,
		)
		expect(source).toMatch(
			/"command":\s*"cline\.debug\.dumpModelBehaviorTrace"[\s\S]*?"title":\s*"Cline Debug: Dump Model Behavior Trace"/,
		)
	})

	it("CMD01.2: the registry exposes both IDs under .debug.*", () => {
		const source = readCommandSource(COMMAND_REGISTRY_PATH)
		expect(source).toMatch(/ToggleModelBehaviorTrace:\s*prefix\s*\+\s*"\.debug\.toggleModelBehaviorTrace"/)
		expect(source).toMatch(/DumpModelBehaviorTrace:\s*prefix\s*\+\s*"\.debug\.dumpModelBehaviorTrace"/)
	})

	it("CMD01.3: extension.ts registers both commands via vscode.commands.registerCommand", () => {
		const source = readCommandSource(COMMAND_EXTENSION_PATH)
		expect(source).toMatch(/vscode\.commands\.registerCommand\(\s*commands\.ToggleModelBehaviorTrace/)
		expect(source).toMatch(/vscode\.commands\.registerCommand\(\s*commands\.DumpModelBehaviorTrace/)
	})

	it("CMD01.4: the recorder is default OFF — no build profile arms it", () => {
		// The toggle is the ONLY thing that can arm the recorder: the
		// persisted workspace flag, written solely by the toggle command.
		const source = readCommandSource(COMMAND_REGISTRY_PATH)
		expect(source).toContain("ToggleModelBehaviorTrace")
		// There is no dogfood/public profile that enables the trace.
		const extensionSource = readCommandSource(COMMAND_EXTENSION_PATH)
		expect(extensionSource).not.toContain("applyModelBehaviorTraceDiagnosticProfile")
		expect(extensionSource).not.toContain("CLINEMM_MODEL_BEHAVIOR_TRACE")
	})
})

describe("the ACTUAL SDK logger adapter", () => {
	it("LOG01.1: createSdkLogger forwards the SDK's debug/log/error calls to the host logger", () => {
		const source = readCommandSource(SESSION_FACTORY_PATH)
		// The adapter exists and forwards all three channels.
		expect(source).toContain("function createSdkLogger()")
		expect(source).toMatch(/debug:\s*\(message:\s*string,\s*metadata\?:\s*Record<string, unknown>\)\s*=>/)
		expect(source).toMatch(/log:\s*\(message:\s*string,\s*metadata\?:\s*Record<string, unknown>\)\s*=>/)
		expect(source).toMatch(/error:\s*\(message:\s*string,\s*metadata\?:\s*Record<string, unknown>\)\s*=>/)
		expect(source).toContain("Logger.debug(message, metadata)")
		expect(source).toContain("Logger.log(message, metadata)")
		expect(source).toContain("Logger.error(message, metadata)")
	})

	it("LOG01.2: the logger adapter is the one handed to the SDK session", () => {
		const source = readCommandSource(SESSION_FACTORY_PATH)
		// The adapter instance is wired into the SDK session config.
		expect(source).toContain("const sdkLogger = createSdkLogger()")
		expect(source).toMatch(/logger:\s*sdkLogger/)
	})

	it("LOG01.3: the SDK logger adapter is the seam the compaction diagnostics use", () => {
		// The compaction diagnostics are emitted through `config.logger?.debug`
		// in the SDK core, which the adapter above forwards to the host
		// logger. Assert the production call site exists.
		const compactionSource = readCommandSource(
			resolve(__dirname, "../../../../../sdk/packages/core/src/extensions/context/compaction.ts"),
		)
		expect(compactionSource).toContain('config.logger?.debug("Context compaction diagnostics"')
		expect(compactionSource).toContain('config.logger?.log("Context compaction completed"')
	})
})
