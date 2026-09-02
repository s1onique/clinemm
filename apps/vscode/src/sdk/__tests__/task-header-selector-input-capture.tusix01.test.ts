// ===========================================================================
// ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01-CORRECTION01
//
// Tests for the bounded selector-input diagnostic capture.
//
// What this proves (per the reviewer disposition 2026-09-02):
//   - the diagnostic is OPT-IN (env-var gated; default-off)
//   - when enabled, it captures the four selector-input fields the bounded
//     guard inspects PLUS the post-selection phase/source
//   - when disabled, it is a complete no-op (no records)
//   - the field-name split (PUBLICATION_SHADOW_BINDING vs
//     LOCAL_SHADOW_TURNSEQ) is mechanically enforced: a record can
//     carry publicationShadowBinding="UNBOUND" AND
//     localShadowTurnSeq=<number> simultaneously, which is the
//     alternative LIVE subcase the bounded guard does NOT cover
//     (the P0 gap the predecessor ACT did not detect)
//
// EVIDENCE CLASSIFICATION:
//   SYNTHETIC_REAL via the real capture helper, exercised against the
//   real env-var gate (no shadowing, no re-implementation).
// ===========================================================================

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resolveEffectiveTaskHeaderSelectorInputCapture } from "../dogfood-diagnostic-profile"
import {
	captureTaskHeaderSelectorInput,
	clearTaskHeaderSelectorInputRecords,
	getTaskHeaderSelectorInputRecords,
	isTaskHeaderSelectorInputCaptureEnabled,
	setTaskHeaderSelectorInputBufferSize,
	setTaskHeaderSelectorInputCaptureEnabled,
	type TaskHeaderSelectorInputRecord,
} from "../task-header-selector-input-capture"
import {
	clearExtensionSideTaskHeaderSelectorInputDiagnostic,
	dumpExtensionSideTaskHeaderSelectorInputDiagnostic,
	type TaskHeaderSelectorInputDiagnosticContext,
} from "../task-header-selector-input-capture-runtime"

// ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-TASKHEADER-CAPTURE01 (P1-fix turn):
// the env-var parsing function
// (`isTaskHeaderSelectorInputDiagnosticEnabled`) was REMOVED from the
// capture module. The central dogfood diagnostic profile resolver
// (`resolveEffectiveTaskHeaderSelectorInputCapture`) is the SOLE parser
// of the env var. These gate tests now exercise the central resolver
// directly — they pin the env-var reading contract at its sole
// authority. Profile=public (isDogfood=false) is used so the gate
// defaults are deterministic.
describe("ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-TASKHEADER-CAPTURE01 / central-resolver gate (was ACT-...-CORRECTION01 / gate)", () => {
	it("TUSIX01-GATE_OFF: default env (no CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1) returns false (public profile)", () => {
		expect(resolveEffectiveTaskHeaderSelectorInputCapture({}, false)).toEqual({ enabled: false, source: "profile" })
	})

	it("TUSIX01-GATE_ON: env=1 / true / yes (case-insensitive) returns enabled=true source=env", () => {
		expect(resolveEffectiveTaskHeaderSelectorInputCapture({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "1" }, false)).toEqual({
			enabled: true,
			source: "env",
		})
		expect(resolveEffectiveTaskHeaderSelectorInputCapture({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "true" }, false)).toEqual({
			enabled: true,
			source: "env",
		})
		expect(resolveEffectiveTaskHeaderSelectorInputCapture({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "YES" }, false)).toEqual({
			enabled: true,
			source: "env",
		})
		expect(resolveEffectiveTaskHeaderSelectorInputCapture({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: " 1 " }, false)).toEqual({
			enabled: true,
			source: "env",
		})
	})

	it("TUSIX01-GATE_OTHER: env=0 / off / false / empty / garbage returns enabled=false (public profile)", () => {
		// explicit OFF (env-driven, but the result is OFF)
		expect(resolveEffectiveTaskHeaderSelectorInputCapture({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "0" }, false)).toEqual({
			enabled: false,
			source: "env",
		})
		expect(resolveEffectiveTaskHeaderSelectorInputCapture({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "off" }, false)).toEqual({
			enabled: false,
			source: "env",
		})
		// empty / unset -> falls through to profile default (public = OFF)
		expect(resolveEffectiveTaskHeaderSelectorInputCapture({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "" }, false)).toEqual({
			enabled: false,
			source: "profile",
		})
		// garbage -> falls through to profile default (public = OFF)
		expect(resolveEffectiveTaskHeaderSelectorInputCapture({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "banana" }, false)).toEqual({
			enabled: false,
			source: "profile",
		})
	})
})

describe("ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01-CORRECTION01 / capture", () => {
	let savedEnv: NodeJS.ProcessEnv

	beforeEach(() => {
		savedEnv = process.env
		clearTaskHeaderSelectorInputRecords()
		setTaskHeaderSelectorInputBufferSize(64)
		// ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-TASKHEADER-CAPTURE01:
		// capture path consults the module seam (set by the activation
		// helper in production). Tests bypass activation and toggle the
		// seam directly.
		setTaskHeaderSelectorInputCaptureEnabled(false)
	})

	afterEach(() => {
		process.env = savedEnv
		clearTaskHeaderSelectorInputRecords()
		setTaskHeaderSelectorInputCaptureEnabled(false)
	})

	it("TUSIX01-CAPTURE_OFF: captureTaskHeaderSelectorInput is a complete no-op when disabled", () => {
		setTaskHeaderSelectorInputCaptureEnabled(false)
		expect(isTaskHeaderSelectorInputCaptureEnabled()).toBe(false)
		captureTaskHeaderSelectorInput({
			stateVersion: 27546,
			publicationShadowBinding: "UNBOUND",
			canonicalShadowPhase: "idle",
			localShadowTurnSeq: undefined,
			currentLegacyPhase: "streaming",
			seq: 27545,
			selectedPhase: "idle",
			selectedSource: "shadow",
		})
		expect(getTaskHeaderSelectorInputRecords().length).toBe(0)
	})

	it("TUSIX01-CAPTURE_LIVE_PATH_A: the LIVE-shaped tuple is recorded with localShadowTurnSeq=undefined", () => {
		setTaskHeaderSelectorInputCaptureEnabled(true)
		captureTaskHeaderSelectorInput({
			stateVersion: 27546,
			publicationShadowBinding: "UNBOUND",
			canonicalShadowPhase: "idle",
			localShadowTurnSeq: undefined,
			currentLegacyPhase: "streaming",
			seq: 27545,
			selectedPhase: "idle",
			selectedSource: "shadow",
		})
		const records = getTaskHeaderSelectorInputRecords()
		expect(records.length).toBe(1)
		const r = records[0]
		expect(r).toMatchObject({
			stateVersion: 27546,
			publicationShadowBinding: "UNBOUND",
			canonicalShadowPhase: "idle",
			localShadowTurnSeq: undefined,
			currentLegacyPhase: "streaming",
			seq: 27545,
			selectedPhase: "idle",
			selectedSource: "shadow",
		})
	})

	it("TUSIX01-CAPTURE_LIVE_PATH_B: ALTERNATIVE subcase the bounded guard does NOT cover (localShadowTurnSeq=27545)", () => {
		// The P0 reviewer's alternative LIVE-shape path: shadow's last
		// "idle" observation stamped at the matching TurnState seq.
		// The bounded guard does NOT fire (localShadowTurnSeq !== undefined)
		// AND the explicit-staleness gate does NOT fire either
		// (seq === localShadowTurnSeq, not stale). The capture records
		// this shape so the next recurrence can mechanically detect it.
		setTaskHeaderSelectorInputCaptureEnabled(true)
		captureTaskHeaderSelectorInput({
			stateVersion: 27546,
			publicationShadowBinding: "UNBOUND",
			canonicalShadowPhase: "idle",
			localShadowTurnSeq: 27545,
			currentLegacyPhase: "streaming",
			seq: 27545,
			selectedPhase: "idle",
			selectedSource: "shadow",
		})
		const r = getTaskHeaderSelectorInputRecords()[0]
		expect(r.publicationShadowBinding).toBe("UNBOUND")
		expect(r.localShadowTurnSeq).toBe(27545)
		expect(r.canonicalShadowPhase).toBe("idle")
		expect(r.currentLegacyPhase).toBe("streaming")
	})

	it("TUSIX01-CAPTURE_FIELD_INDEPENDENCE: publicationShadowBinding and localShadowTurnSeq are independent fields", () => {
		setTaskHeaderSelectorInputCaptureEnabled(true)
		captureTaskHeaderSelectorInput({
			stateVersion: 1,
			publicationShadowBinding: "UNBOUND",
			canonicalShadowPhase: "idle",
			localShadowTurnSeq: 1,
			currentLegacyPhase: "streaming",
			seq: 1,
			selectedPhase: "idle",
			selectedSource: "shadow",
		})
		const r = getTaskHeaderSelectorInputRecords()[0]
		expect(r.publicationShadowBinding).toBe("UNBOUND")
		expect(r.localShadowTurnSeq).toBe(1)
	})

	it("TUSIX01-RING_BUFFER: setBufferSize truncates oldest entries", () => {
		setTaskHeaderSelectorInputCaptureEnabled(true)
		setTaskHeaderSelectorInputBufferSize(2)
		for (let i = 1; i <= 5; i++) {
			captureTaskHeaderSelectorInput({
				stateVersion: i,
				publicationShadowBinding: "MISSING",
				canonicalShadowPhase: undefined,
				localShadowTurnSeq: undefined,
				currentLegacyPhase: "idle",
				seq: i,
				selectedPhase: "idle",
				selectedSource: "legacy",
			})
		}
		const records = getTaskHeaderSelectorInputRecords()
		expect(records.length).toBe(2)
		expect(records[0].stateVersion).toBe(4)
		expect(records[1].stateVersion).toBe(5)
	})

	it("TUSIX01-CLEAR: clear removes all records", () => {
		setTaskHeaderSelectorInputCaptureEnabled(true)
		captureTaskHeaderSelectorInput({
			stateVersion: 1,
			publicationShadowBinding: "MISSING",
			canonicalShadowPhase: undefined,
			localShadowTurnSeq: undefined,
			currentLegacyPhase: "idle",
			seq: 1,
			selectedPhase: "idle",
			selectedSource: "legacy",
		})
		expect(getTaskHeaderSelectorInputRecords().length).toBe(1)
		clearTaskHeaderSelectorInputRecords()
		expect(getTaskHeaderSelectorInputRecords().length).toBe(0)
	})
})

describe("ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01-CORRECTION01 / type surface", () => {
	it("TUSIX01-TYPE: TaskHeaderSelectorInputRecord is readonly + has all nine fields", () => {
		const r: TaskHeaderSelectorInputRecord = {
			stateVersion: 1,
			publicationShadowBinding: "MISSING",
			canonicalShadowPhase: undefined,
			localShadowTurnSeq: undefined,
			currentLegacyPhase: "idle",
			seq: 1,
			selectedPhase: "idle",
			selectedSource: "legacy",
			capturedAt: 0,
		}
		const keys = Object.keys(r).sort()
		expect(keys).toEqual([
			"canonicalShadowPhase",
			"capturedAt",
			"currentLegacyPhase",
			"localShadowTurnSeq",
			"publicationShadowBinding",
			"selectedPhase",
			"selectedSource",
			"seq",
			"stateVersion",
		])
	})
})

describe("ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01-CORRECTION01-FIX01 / operator dump roundtrip", () => {
	let tmp: string
	let context: TaskHeaderSelectorInputDiagnosticContext
	let savedEnv: NodeJS.ProcessEnv

	function fakeContext(storagePath: string): TaskHeaderSelectorInputDiagnosticContext {
		return { globalStorageUri: { fsPath: storagePath } }
	}

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "thsicap-roundtrip-"))
		context = fakeContext(tmp)
		savedEnv = process.env
		clearTaskHeaderSelectorInputRecords()
		setTaskHeaderSelectorInputBufferSize(64)
		// ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-TASKHEADER-CAPTURE01:
		// operator-dump tests bypass activation and toggle the seam
		// directly. See the companion comment in the capture describe
		// block above.
		setTaskHeaderSelectorInputCaptureEnabled(false)
	})

	afterEach(() => {
		process.env = savedEnv
		clearTaskHeaderSelectorInputRecords()
		setTaskHeaderSelectorInputCaptureEnabled(false)
		if (existsSync(tmp)) {
			rmSync(tmp, { recursive: true, force: true })
		}
	})

	/**
	 * ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01-CORRECTION01-FIX01
	 *
	 * The bounded dogfood cycle's missing link: prove that a record
	 * captured in the in-memory ring survives an operator dump to the
	 * globalStorage JSONL file with the EXACT selector-input fields
	 * intact, including the P0 reviewer's alternative LIVE-shape
	 * subcase (publicationShadowBinding=UNBOUND with
	 * localShadowTurnSeq=<number> matching the current seq).
	 *
	 * If this test fails the operator cannot inspect a recurrence and
	 * the diagnostic has zero production value.
	 */
	it("TUSIX01-OPERATOR_DUMP_ROUNDTRIP: record -> dump -> exact selector fields survive for the alternative LIVE-shape subcase", async () => {
		setTaskHeaderSelectorInputCaptureEnabled(true)

		// Step 1: simulate the production seam capturing the
		// alternative LIVE-shape subcase (P0 reviewer's path B) where
		// the bounded guard does NOT cover the LIVE defect because the
		// shadow's last idle observation is stamped at the matching seq.
		captureTaskHeaderSelectorInput({
			stateVersion: 27546,
			publicationShadowBinding: "UNBOUND",
			canonicalShadowPhase: "idle",
			localShadowTurnSeq: 27545,
			currentLegacyPhase: "streaming",
			seq: 27545,
			selectedPhase: "idle",
			selectedSource: "shadow",
		})

		// Step 2: invoke the operator dump command.
		const { file, recordCount } = await dumpExtensionSideTaskHeaderSelectorInputDiagnostic(context)

		expect(existsSync(file)).toBe(true)
		expect(file).toContain("task-header-selector-input-capture.jsonl")
		expect(recordCount).toBe(1)

		// Step 3: read the JSONL file back and verify the EXACT
		// selector fields the bounded guard inspects are present and
		// bit-identical to what was captured.
		const lines = readFileSync(file, "utf8")
			.split("\n")
			.filter((l) => l.length > 0)
		expect(lines.length).toBe(1)
		const dumped = JSON.parse(lines[0])

		expect(dumped.stateVersion).toBe(27546)
		expect(dumped.publicationShadowBinding).toBe("UNBOUND")
		expect(dumped.canonicalShadowPhase).toBe("idle")
		expect(dumped.localShadowTurnSeq).toBe(27545)
		expect(dumped.currentLegacyPhase).toBe("streaming")
		expect(dumped.seq).toBe(27545)
		expect(dumped.selectedPhase).toBe("idle")
		expect(dumped.selectedSource).toBe("shadow")
		expect(typeof dumped.capturedAt).toBe("number")
	})

	/**
	 * The empty case: the dump is still reachable even when the
	 * diagnostic never fired. Operator must be able to inspect the
	 * state and distinguish "no ring" from "no records".
	 */
	it("TUSIX01-OPERATOR_DUMP_EMPTY: empty ring produces an empty file (operator-distinguishable from missing)", async () => {
		setTaskHeaderSelectorInputCaptureEnabled(false)
		const { file, recordCount } = await dumpExtensionSideTaskHeaderSelectorInputDiagnostic(context)
		expect(existsSync(file)).toBe(true)
		expect(readFileSync(file, "utf8")).toBe("")
		expect(recordCount).toBe(0)
	})

	/**
	 * The clear command also unlinks the file so a re-dump after a
	 * clear is observable on disk.
	 */
	it("TUSIX01-OPERATOR_CLEAR: clear removes both the ring and the dump file", async () => {
		setTaskHeaderSelectorInputCaptureEnabled(true)
		captureTaskHeaderSelectorInput({
			stateVersion: 1,
			publicationShadowBinding: "MISSING",
			canonicalShadowPhase: undefined,
			localShadowTurnSeq: undefined,
			currentLegacyPhase: "idle",
			seq: 1,
			selectedPhase: "idle",
			selectedSource: "legacy",
		})
		const { file } = await dumpExtensionSideTaskHeaderSelectorInputDiagnostic(context)
		expect(existsSync(file)).toBe(true)
		const clearedFile = await clearExtensionSideTaskHeaderSelectorInputDiagnostic(context)
		expect(clearedFile).toBe(file)
		expect(existsSync(file)).toBe(false)
		expect(getTaskHeaderSelectorInputRecords().length).toBe(0)
	})
})
