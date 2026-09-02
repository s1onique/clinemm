/**
 * ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-TASKHEADER-CAPTURE01
 *
 * Tests for the THSICAP (TaskHeader selector-input capture) profile
 * extension. These tests exercise the REAL production activation
 * helper (`applyTaskHeaderSelectorInputCaptureDiagnosticProfile` in
 * `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts` -- the SAME
 * helper that `extension.ts:activate` calls) and the REAL production
 * capture helper (`captureTaskHeaderSelectorInput` in
 * `apps/vscode/src/sdk/task-header-selector-input-capture.ts`).
 *
 * EVIDENCE CLASSIFICATION: SYNTHETIC_REAL.
 *   The suite invokes the REAL activation helper + the REAL capture
 *   helper (no shadowing, no re-implementation), but it does NOT
 *   execute `extension.ts:activate()` itself. The fact that the helper
 *   is called BEFORE SdkController construction in
 *   `apps/vscode/src/extension.ts` is STRUCTURAL evidence (visible at
 *   review time, not under test). Together with the in-test seam-arm
 *   proof (AC3 below), this is a reasonable proof of the activation
 *   ordering — but calling AC3 alone an "order proof of extension
 *   activation" would be a slight overstatement. See the reviewer's
 *   P2 evidence-label calibration.
 *
 * Required test coverage (per Factory disposition 2026-09-02):
 *
 *   T1 dogfood + no env          -> ON
 *   T2 public  + no env          -> OFF
 *   T3 dogfood + env=0           -> OFF
 *   T4 public  + env=1           -> ON
 *   T5 existing dump roundtrip   -> unchanged (operator dump still
 *                                   works regardless of the gate)
 *   T6 default-disabled semantics outside dogfood -> unchanged
 *
 * Plus structural / production-integration tests:
 *   AC1..AC6 (see below)
 *
 * Mirrors the AC1..AC8 pattern of
 * `dogfood-diagnostic-profile-tswpd-activation.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	applyTaskHeaderSelectorInputCaptureDiagnosticProfile,
	resolveEffectiveTaskHeaderSelectorInputCapture,
} from "../dogfood-diagnostic-profile"
import {
	captureTaskHeaderSelectorInput,
	clearTaskHeaderSelectorInputRecords,
	getTaskHeaderSelectorInputRecords,
	isTaskHeaderSelectorInputCaptureEnabled,
	setTaskHeaderSelectorInputBufferSize,
	setTaskHeaderSelectorInputCaptureEnabled,
} from "../task-header-selector-input-capture"

beforeEach(() => {
	clearTaskHeaderSelectorInputRecords()
	setTaskHeaderSelectorInputBufferSize(64)
	setTaskHeaderSelectorInputCaptureEnabled(false)
})

afterEach(() => {
	setTaskHeaderSelectorInputCaptureEnabled(false)
	clearTaskHeaderSelectorInputRecords()
})

describe("T1..T4: resolveEffectiveTaskHeaderSelectorInputCapture precedence (pure resolver)", () => {
	it("T1: dogfood + no env -> ON (profile default)", () => {
		const r = resolveEffectiveTaskHeaderSelectorInputCapture({}, true)
		expect(r).toEqual({ enabled: true, source: "profile" })
	})

	it("T2: public + no env -> OFF (public default preserved)", () => {
		const r = resolveEffectiveTaskHeaderSelectorInputCapture({}, false)
		expect(r).toEqual({ enabled: false, source: "profile" })
	})

	it("T3: dogfood + env=0 -> OFF (explicit override-down wins in dogfood)", () => {
		const r = resolveEffectiveTaskHeaderSelectorInputCapture({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "0" }, true)
		expect(r).toEqual({ enabled: false, source: "env" })
		expect(resolveEffectiveTaskHeaderSelectorInputCapture({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "off" }, true)).toEqual({
			enabled: false,
			source: "env",
		})
		expect(resolveEffectiveTaskHeaderSelectorInputCapture({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "false" }, true)).toEqual({
			enabled: false,
			source: "env",
		})
	})

	it("T4: public + env=1 -> ON (operator opt-in preserved in public)", () => {
		const r = resolveEffectiveTaskHeaderSelectorInputCapture({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "1" }, false)
		expect(r).toEqual({ enabled: true, source: "env" })
		expect(resolveEffectiveTaskHeaderSelectorInputCapture({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "true" }, false)).toEqual({
			enabled: true,
			source: "env",
		})
		expect(resolveEffectiveTaskHeaderSelectorInputCapture({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "yes" }, false)).toEqual({
			enabled: true,
			source: "env",
		})
	})

	it("garbage env value falls through to the profile default", () => {
		expect(resolveEffectiveTaskHeaderSelectorInputCapture({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "banana" }, true)).toEqual({
			enabled: true,
			source: "profile",
		})
		expect(resolveEffectiveTaskHeaderSelectorInputCapture({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "DOGFOOD" }, false)).toEqual({
			enabled: false,
			source: "profile",
		})
	})

	it("empty-string env values fall through to the profile default", () => {
		expect(resolveEffectiveTaskHeaderSelectorInputCapture({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "" }, true)).toEqual({
			enabled: true,
			source: "profile",
		})
		expect(resolveEffectiveTaskHeaderSelectorInputCapture({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "" }, false)).toEqual({
			enabled: false,
			source: "profile",
		})
	})

	it("explicit env override beats the profile default in BOTH directions", () => {
		expect(resolveEffectiveTaskHeaderSelectorInputCapture({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "0" }, true).enabled).toBe(false)
		expect(resolveEffectiveTaskHeaderSelectorInputCapture({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "1" }, false).enabled).toBe(true)
	})

	it("resolver body does not mutate its input env", () => {
		const before = {
			CLINEMM_RUNTIME_PROFILE: "dogfood",
			CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "0",
		}
		const beforeSnapshot = { ...before }
		const result = resolveEffectiveTaskHeaderSelectorInputCapture(before, true)
		expect(before).toEqual(beforeSnapshot)
		expect(result.enabled).toBe(false)
	})
})

describe("AC1: production activation arms the THSICAP seam", () => {
	it("dogfood + no env -> activation arms the seam (capture active by default)", () => {
		expect(isTaskHeaderSelectorInputCaptureEnabled()).toBe(false)
		const result = applyTaskHeaderSelectorInputCaptureDiagnosticProfile({}, true)
		expect(result.enabled).toBe(true)
		expect(result.source).toBe("profile")
		expect(result.flipped).toBe(true)
		expect(isTaskHeaderSelectorInputCaptureEnabled()).toBe(true)
	})

	it("after activation, captureTaskHeaderSelectorInput appends to the ring", () => {
		applyTaskHeaderSelectorInputCaptureDiagnosticProfile({}, true)
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
		expect(getTaskHeaderSelectorInputRecords().length).toBe(1)
	})
})

describe("AC2: public default + override-down disarms the seam", () => {
	it("public + no env -> seam stays disabled (default-OFF outside dogfood)", () => {
		expect(isTaskHeaderSelectorInputCaptureEnabled()).toBe(false)
		const result = applyTaskHeaderSelectorInputCaptureDiagnosticProfile({}, false)
		expect(result.enabled).toBe(false)
		expect(result.source).toBe("profile")
		expect(isTaskHeaderSelectorInputCaptureEnabled()).toBe(false)
	})

	it("dogfood + env=0 -> seam disarmed (explicit override-down honored)", () => {
		applyTaskHeaderSelectorInputCaptureDiagnosticProfile({}, true)
		expect(isTaskHeaderSelectorInputCaptureEnabled()).toBe(true)
		const result = applyTaskHeaderSelectorInputCaptureDiagnosticProfile({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "0" }, true)
		expect(result.enabled).toBe(false)
		expect(result.source).toBe("env")
		expect(isTaskHeaderSelectorInputCaptureEnabled()).toBe(false)
	})

	it("public + env=1 -> seam armed (operator opt-in preserved)", () => {
		expect(isTaskHeaderSelectorInputCaptureEnabled()).toBe(false)
		const result = applyTaskHeaderSelectorInputCaptureDiagnosticProfile({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: "1" }, false)
		expect(result.enabled).toBe(true)
		expect(result.source).toBe("env")
		expect(isTaskHeaderSelectorInputCaptureEnabled()).toBe(true)
	})

	it("after disarming in public, capture is a complete no-op", () => {
		applyTaskHeaderSelectorInputCaptureDiagnosticProfile({}, false)
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
		expect(getTaskHeaderSelectorInputRecords().length).toBe(0)
	})
})

describe("AC3: helper arms the seam in time for a synthetic first capture (post-activation env flips have no effect)", () => {
	it("the helper arms the seam in time for the first capture (no race window)", () => {
		expect(isTaskHeaderSelectorInputCaptureEnabled()).toBe(false)
		applyTaskHeaderSelectorInputCaptureDiagnosticProfile({}, true)
		expect(isTaskHeaderSelectorInputCaptureEnabled()).toBe(true)
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
		expect(getTaskHeaderSelectorInputRecords().length).toBe(1)
	})

	it("production capture path consults the profile authority -- NOT a copy (structural proof)", () => {
		// Apply the activation helper exactly as extension.ts:activate does.
		applyTaskHeaderSelectorInputCaptureDiagnosticProfile({}, true)
		expect(isTaskHeaderSelectorInputCaptureEnabled()).toBe(true)

		// Flip process.env AFTER activation. If the capture path secretly
		// re-reads env, this would disarm it. The capture path consults
		// the seam, NOT env -- the env flip after activation has no effect.
		process.env.CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1 = "0"
		captureTaskHeaderSelectorInput({
			stateVersion: 1,
			publicationShadowBinding: "UNBOUND",
			canonicalShadowPhase: "idle",
			localShadowTurnSeq: undefined,
			currentLegacyPhase: "streaming",
			seq: 1,
			selectedPhase: "idle",
			selectedSource: "shadow",
		})
		expect(getTaskHeaderSelectorInputRecords().length).toBe(1)
		delete process.env.CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1
	})
})

describe("AC4: idempotent re-arm is a no-op", () => {
	it("calling the helper twice with enabled=true does not double-arm", () => {
		const first = applyTaskHeaderSelectorInputCaptureDiagnosticProfile({}, true)
		expect(first.flipped).toBe(true)
		const second = applyTaskHeaderSelectorInputCaptureDiagnosticProfile({}, true)
		expect(second.flipped).toBe(false)
		expect(isTaskHeaderSelectorInputCaptureEnabled()).toBe(true)
	})

	it("calling the helper twice with enabled=false on a default-off seam does not flip", () => {
		expect(isTaskHeaderSelectorInputCaptureEnabled()).toBe(false)
		const first = applyTaskHeaderSelectorInputCaptureDiagnosticProfile({}, false)
		expect(first.flipped).toBe(false)
		const second = applyTaskHeaderSelectorInputCaptureDiagnosticProfile({}, false)
		expect(second.flipped).toBe(false)
	})
})

describe("AC5: existing TUSIX dump roundtrip is preserved (T5 contract)", () => {
	it("dump produces the same JSONL when the seam is OFF (capture disabled)", async () => {
		setTaskHeaderSelectorInputCaptureEnabled(false)
		const { readFile, mkdtemp, rm } = await import("node:fs/promises")
		const { tmpdir } = await import("node:os")
		const { join } = await import("node:path")
		const tmp = await mkdtemp(join(tmpdir(), "thsicap-resolver-"))
		const file = join(tmp, "task-header-selector-input-capture.jsonl")
		const { dumpExtensionSideTaskHeaderSelectorInputDiagnostic } = await import(
			"../task-header-selector-input-capture-runtime"
		)
		const out = await dumpExtensionSideTaskHeaderSelectorInputDiagnostic({ globalStorageUri: { fsPath: tmp } })
		expect(out.file).toBe(file)
		expect(out.recordCount).toBe(0)
		const contents = await readFile(file, "utf8")
		expect(contents).toBe("")
		await rm(tmp, { recursive: true, force: true })
	})

	it("dump captures the LIVE-shape record when the seam is ON (capture enabled, then dump)", async () => {
		applyTaskHeaderSelectorInputCaptureDiagnosticProfile({}, true)
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
		const { readFile, mkdtemp, rm } = await import("node:fs/promises")
		const { tmpdir } = await import("node:os")
		const { join } = await import("node:path")
		const tmp = await mkdtemp(join(tmpdir(), "thsicap-resolver-"))
		const { dumpExtensionSideTaskHeaderSelectorInputDiagnostic } = await import(
			"../task-header-selector-input-capture-runtime"
		)
		const { file, recordCount } = await dumpExtensionSideTaskHeaderSelectorInputDiagnostic({
			globalStorageUri: { fsPath: tmp },
		})
		expect(recordCount).toBe(1)
		const contents = await readFile(file, "utf8")
		const lines = contents.split("\n").filter((l) => l.length > 0)
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
		await rm(tmp, { recursive: true, force: true })
	})
})

describe("AC6: default-disabled semantics outside dogfood are unchanged (T6 contract)", () => {
	it("public + no env -> resolver returns OFF and helper does NOT arm the seam", () => {
		const r = resolveEffectiveTaskHeaderSelectorInputCapture({}, false)
		expect(r.enabled).toBe(false)
		expect(r.source).toBe("profile")
		const helper = applyTaskHeaderSelectorInputCaptureDiagnosticProfile({}, false)
		expect(helper.enabled).toBe(false)
		expect(helper.flipped).toBe(false)
		expect(isTaskHeaderSelectorInputCaptureEnabled()).toBe(false)
	})

	it("public + env='0' / 'off' / 'false' / empty / unset -> OFF (full env semantics preserved)", () => {
		for (const v of ["0", "off", "false", ""]) {
			const r = resolveEffectiveTaskHeaderSelectorInputCapture({ CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1: v }, false)
			expect(r.enabled).toBe(false)
		}
		const r = resolveEffectiveTaskHeaderSelectorInputCapture({}, false)
		expect(r.enabled).toBe(false)
	})
})
