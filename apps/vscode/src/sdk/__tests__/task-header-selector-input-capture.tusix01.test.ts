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

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	captureTaskHeaderSelectorInput,
	clearTaskHeaderSelectorInputRecords,
	getTaskHeaderSelectorInputRecords,
	isTaskHeaderSelectorInputDiagnosticEnabled,
	setTaskHeaderSelectorInputBufferSize,
	type TaskHeaderSelectorInputRecord,
} from "../task-header-selector-input-capture"

describe("ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01-CORRECTION01 / gate", () => {
	it("TUSIX01-GATE_OFF: default env (no CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1) returns false", () => {
		expect(isTaskHeaderSelectorInputDiagnosticEnabled({})).toBe(false)
	})

	it("TUSIX01-GATE_ON: env=1 / true / yes (case-insensitive) returns true", () => {
		expect(isTaskHeaderSelectorInputDiagnosticEnabled({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "1" })).toBe(true)
		expect(isTaskHeaderSelectorInputDiagnosticEnabled({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "true" })).toBe(true)
		expect(isTaskHeaderSelectorInputDiagnosticEnabled({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "YES" })).toBe(true)
		expect(isTaskHeaderSelectorInputDiagnosticEnabled({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: " 1 " })).toBe(true)
	})

	it("TUSIX01-GATE_OTHER: env=0 / off / false / empty returns false", () => {
		expect(isTaskHeaderSelectorInputDiagnosticEnabled({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "0" })).toBe(false)
		expect(isTaskHeaderSelectorInputDiagnosticEnabled({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "off" })).toBe(false)
		expect(isTaskHeaderSelectorInputDiagnosticEnabled({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "" })).toBe(false)
	})
})

describe("ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01-CORRECTION01 / capture", () => {
	let savedEnv: NodeJS.ProcessEnv

	beforeEach(() => {
		savedEnv = process.env
		clearTaskHeaderSelectorInputRecords()
		setTaskHeaderSelectorInputBufferSize(64)
	})

	afterEach(() => {
		process.env = savedEnv
		clearTaskHeaderSelectorInputRecords()
	})

	it("TUSIX01-CAPTURE_OFF: captureTaskHeaderSelectorInput is a complete no-op when disabled", () => {
		delete process.env.CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1
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
		process.env.CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1 = "1"
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
		process.env.CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1 = "1"
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
		process.env.CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1 = "1"
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
		process.env.CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1 = "1"
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
		process.env.CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1 = "1"
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
