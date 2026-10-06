/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION01-DOGFOOD-DIAGNOSTICS
 *
 * Tests for the Command Palette diagnostic command:
 *   cline.taskHeaderElmShadowDiagnostics
 *
 * EVIDENCE CLASSIFICATION:
 *   - `selectTaskHeaderElmRuntimeShadowDiagnosticsAction` is tested
 *     directly as a pure function.
 *   - `applyTaskHeaderElmRuntimeShadowDiagnosticsAction` is exercised
 *     against the real HostProvider (`@/hosts/host-provider`) mock
 *     installed by `apps/vscode/src/test/vitest-setup.ts` (the same
 *     setup the broader SDK-adapter vitest sweep uses).
 *   - The `vscode.commands.registerCommand` smoke test is a
 *     SOURCE-ONLY contract pin (parses extension.ts + the registry +
 *     package.json). This keeps the test free of elaborate
 *     vscode-runtime mocking per the Factory doctrine
 *     ("prefer executable semantic evidence over elaborate mocking
 *     infrastructure").
 *
 * Required test coverage (per ACT §C12):
 *
 *   CMD-01: no observations -> action selection is safe
 *   CMD-03: Copy Report -> clipboard receives report
 *   CMD-04: Reset Observations -> ring cleared
 *   CMD-05: outside dogfood / shadow disabled -> bounded
 *           disabled message
 *   CMD-REG: source-only contract for command registration
 *           (registry entry + package.json + extension.ts handler)
 */

import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { applyTaskHeaderElmRuntimeShadowDiagnosticProfile } from "../dogfood-diagnostic-profile"
import {
	applyTaskHeaderElmRuntimeShadowDiagnosticsAction,
	buildTaskHeaderElmRuntimeShadowDiagnosticsActionOptions,
	buildTaskHeaderElmRuntimeShadowDiagnosticsDisabledMessage,
	buildTaskHeaderElmRuntimeShadowDiagnosticsReport,
	isTaskHeaderElmRuntimeShadowDiagnosticsEnabled,
	selectTaskHeaderElmRuntimeShadowDiagnosticsAction,
} from "../task-header-elm-shadow-diagnostics"
import {
	clearTaskHeaderElmRuntimeShadowObservations,
	getTaskHeaderElmRuntimeShadowObservations,
	invokeElmKernel,
	observeTaskHeaderElmRuntimeShadow,
	resetTaskHeaderElmRuntimeShadowForTests,
	setTaskHeaderElmRuntimeShadowEnabled,
	setTaskHeaderElmRuntimeShadowSink,
	type TaskHeaderElmFactsJson,
	type TaskHeaderElmRuntimeShadowObservation,
	type TaskHeaderElmRuntimeShadowSink,
} from "../task-header-elm-shadow"
import { HostProvider } from "@/hosts/host-provider"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"

class CapturingSink implements TaskHeaderElmRuntimeShadowSink {
	readonly captured: TaskHeaderElmRuntimeShadowObservation[] = []

	push(observation: TaskHeaderElmRuntimeShadowObservation): void {
		this.captured.push(observation)
	}

	get size(): number {
		return this.captured.length
	}

	get snapshot(): readonly TaskHeaderElmRuntimeShadowObservation[] {
		return this.captured
	}

	clear(): void {
		this.captured.length = 0
	}
}

const SAMPLE_FACTS: TaskHeaderElmFactsJson = {
	canonicalShadowPhase: "idle",
	currentLegacyPhase: "idle",
	seq: 1,
	canonicalShadowObservedTurnSeq: 1,
}
const SAMPLE_TS = { phase: "idle" as const, source: "shadow" as const, seq: 1 }

beforeEach(() => {
	resetTaskHeaderElmRuntimeShadowForTests()
	clearTaskHeaderElmRuntimeShadowObservations()
	setTaskHeaderElmRuntimeShadowSink(null)
})

beforeAll(() => {
	setVscodeHostProviderMock()
})

afterAll(() => {
	HostProvider.reset()
})

describe("ACT-CLINEMM-...-CORRECTION01 / CMD-01..05: selectTaskHeaderElmRuntimeShadowDiagnosticsAction", () => {
	it("CMD-01: 'Copy Report' -> 'copy'", () => {
		expect(selectTaskHeaderElmRuntimeShadowDiagnosticsAction("Copy Report")).toBe("copy")
	})

	it("CMD-01b: 'Reset Observations' -> 'reset'", () => {
		expect(selectTaskHeaderElmRuntimeShadowDiagnosticsAction("Reset Observations")).toBe("reset")
	})

	it("CMD-01c: undefined / unrecognized / 'Close' -> 'close'", () => {
		expect(selectTaskHeaderElmRuntimeShadowDiagnosticsAction("Close")).toBe("close")
		expect(selectTaskHeaderElmRuntimeShadowDiagnosticsAction(undefined)).toBe("close")
		expect(selectTaskHeaderElmRuntimeShadowDiagnosticsAction("Random")).toBe("close")
	})

	it("CMD-01d: empty ring + safe report build", () => {
		expect(getTaskHeaderElmRuntimeShadowObservations().length).toBe(0)
		const report = buildTaskHeaderElmRuntimeShadowDiagnosticsReport()
		expect(report).toContain("evaluations:      0")
		expect(report).toContain("matches:          0")
	})

	it("CMD-01e: QuickPick option labels are exactly the three expected", () => {
		expect(buildTaskHeaderElmRuntimeShadowDiagnosticsActionOptions()).toEqual([
			"Copy Report",
			"Reset Observations",
			"Close",
		])
	})
})

describe("ACT-CLINEMM-...-CORRECTION01 / CMD-04: applyAction('reset') clears the ring", () => {
	it("CMD-04: reset action clears the bounded observation ring without throwing", async () => {
		setTaskHeaderElmRuntimeShadowEnabled(true)
		await observeTaskHeaderElmRuntimeShadow({ ts: SAMPLE_TS, facts: SAMPLE_FACTS })
		await invokeElmKernel(SAMPLE_FACTS)
		expect(getTaskHeaderElmRuntimeShadowObservations().length).toBeGreaterThan(0)
		const result = await applyTaskHeaderElmRuntimeShadowDiagnosticsAction("reset")
		expect(result).toBe("Observations cleared.")
		expect(getTaskHeaderElmRuntimeShadowObservations().length).toBe(0)
	})
})

describe("ACT-CLINEMM-...-CORRECTION01 / CMD-03: applyAction('copy') writes the report", () => {
	it("CMD-03: copy action invokes the clipboardWriteText host bridge with the report", async () => {
		// Re-initialize HostProvider with a custom env stub that captures
		// the clipboard write (the default `setVscodeHostProviderMock`
		// uses the real `vscodeHostBridgeClient` which dials gRPC;
		// a clean re-init with a vi.fn is more robust for this test).
		const clipboardWriteText = vi.fn()
		HostProvider.reset()
		setVscodeHostProviderMock({
			hostBridgeClient: {
				envClient: { clipboardWriteText } as never,
				windowClient: {} as never,
				diffClient: {} as never,
			} as never,
		})
		setTaskHeaderElmRuntimeShadowEnabled(true)
		const sink = new CapturingSink()
		setTaskHeaderElmRuntimeShadowSink(sink)
		await observeTaskHeaderElmRuntimeShadow({ ts: SAMPLE_TS, facts: SAMPLE_FACTS })
		const result = await applyTaskHeaderElmRuntimeShadowDiagnosticsAction("copy")
		expect(clipboardWriteText).toHaveBeenCalledTimes(1)
		const writtenArg = clipboardWriteText.mock.calls[0]?.[0]
		expect(writtenArg).toBeDefined()
		expect(writtenArg?.value).toContain("Task Header Elm Runtime Shadow")
		expect(writtenArg?.value).toContain("evaluations:")
		expect(result).toMatch(/^Report copied to clipboard \(/)
	})
})

describe("ACT-CLINEMM-...-CORRECTION01 / CMD-05: outside dogfood / shadow disabled", () => {
	it("CMD-05: public profile -> isTaskHeaderElmRuntimeShadowDiagnosticsEnabled = false", () => {
		applyTaskHeaderElmRuntimeShadowDiagnosticProfile({}, false)
		expect(isTaskHeaderElmRuntimeShadowDiagnosticsEnabled()).toBe(false)
	})

	it("CMD-05b: disabled message is the bounded spec text", () => {
		expect(buildTaskHeaderElmRuntimeShadowDiagnosticsDisabledMessage()).toBe(
			"Task Header Elm runtime shadow is disabled in this profile.",
		)
	})
})

// ----------------------------------------------------------------------------
// CMD-REG: source-only contract for command registration
// (registry entry + package.json + extension.ts handler).
// ----------------------------------------------------------------------------

const REGISTRY_PATH = resolve(__dirname, "../../registry.ts")
const PACKAGE_JSON_PATH = resolve(__dirname, "../../../package.json")
const EXTENSION_TS_PATH = resolve(__dirname, "../../extension.ts")

function readSource(path: string): string {
	if (!existsSync(path)) {
		throw new Error(`source-only contract pin failed: file does not exist at ${path}`)
	}
	return readFileSync(path, "utf8")
}

describe("CMD-REG: source-only contract for cline.taskHeaderElmShadowDiagnostics", () => {
	it("CMD-REG.1: registry.ts exposes TaskHeaderElmShadowDiagnostics constant with the canonical id-suffix", () => {
		const src = readSource(REGISTRY_PATH)
		expect(src).toContain("TaskHeaderElmShadowDiagnostics")
		expect(src).toMatch(/TaskHeaderElmShadowDiagnostics:\s*prefix\s*\+\s*"\.taskHeaderElmShadowDiagnostics"/)
	})

	it("CMD-REG.2: package.json declares cline.taskHeaderElmShadowDiagnostics with the palette-searchable title", () => {
		const src = readSource(PACKAGE_JSON_PATH)
		expect(src).toContain("cline.taskHeaderElmShadowDiagnostics")
		expect(src).toMatch(
			/"command":\s*"cline\.taskHeaderElmShadowDiagnostics"[\s\S]*?"title":\s*"ClineMM: Task Header Elm Shadow Diagnostics"/,
		)
	})

	it("CMD-REG.3: extension.ts registers commands.TaskHeaderElmShadowDiagnostics via vscode.commands.registerCommand", () => {
		const src = readSource(EXTENSION_TS_PATH)
		expect(src).toMatch(
			/vscode\.commands\.registerCommand\([^)]*commands\.TaskHeaderElmShadowDiagnostics/s,
		)
	})

	it("CMD-REG.4: NO env-var `CLINEMM_DIAG_TASK_HEADER_ELM_RUNTIME_SHADOW` is referenced in extension.ts:activate wiring", () => {
		const src = readSource(EXTENSION_TS_PATH)
		// The wiring block must not consult the legacy env var.
		// (The string may legitimately appear in a CHANGELOG / migration
		// note — we only assert against the active wiring line.)
		const wiringLines = src
			.split("\n")
			.filter((l) => /applyTaskHeaderElmRuntimeShadowDiagnosticProfile\(/.test(l))
		for (const line of wiringLines) {
			expect(line).not.toContain("CLINEMM_DIAG_TASK_HEADER_ELM_RUNTIME_SHADOW")
		}
	})
})
