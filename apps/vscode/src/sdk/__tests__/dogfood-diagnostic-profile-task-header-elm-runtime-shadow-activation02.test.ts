/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION01-DOGFOOD-DIAGNOSTICS
 *
 * Tests for the TaskHeader Elm runtime-shadow profile extension after the
 * dogfood-default-ON correction. These tests exercise the REAL production
 * activation helper (`applyTaskHeaderElmRuntimeShadowDiagnosticProfile` in
 * `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts` — the SAME helper
 * `extension.ts:activate` calls) and the REAL production comparison
 * helper (`observeTaskHeaderElmRuntimeShadow` in
 * `apps/vscode/src/sdk/task-header-elm-shadow.ts`).
 *
 * EVIDENCE CLASSIFICATION: SYNTHETIC_REAL.
 *   The suite invokes the REAL activation helper + the REAL comparison
 *   helper (no shadowing, no re-implementation), but it does NOT
 *   execute `extension.ts:activate()` itself. The fact that the helper
 *   is called BEFORE SdkController construction in
 *   `apps/vscode/src/extension.ts` is STRUCTURAL evidence (visible at
 *   review time, not under test). Together with the in-test seam-arm
 *   proof (AC3 below), this is a reasonable proof of the activation
 *   ordering.
 *
 * Frozen contract (per ACT §C1, §C8):
 *
 *   public profile  -> shadow OFF (no env override path)
 *   dogfood profile -> shadow ON  (no env override path)
 *
 * The env-var branch (`CLINEMM_DIAG_TASK_HEADER_ELM_RUNTIME_SHADOW`) was
 * REMOVED by this ACT — the user-facing workflow is profile-identity
 * only. NO env var reads; NO env override constants; NO env parser.
 *
 * Required test coverage (per ACT §C8):
 *
 *   PROFILE-01:
 *     public + no override
 *     -> disabled
 *   PROFILE-02:
 *     dogfood + no override
 *     -> enabled
 *   PROFILE-03:
 *     activation helper applies OFF for public
 *   PROFILE-04:
 *     activation helper applies ON for dogfood
 *
 * Plus structural / production-integration tests:
 *   AC1..AC5 (see below)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	applyTaskHeaderElmRuntimeShadowDiagnosticProfile,
	resolveEffectiveTaskHeaderElmRuntimeShadow,
} from "../dogfood-diagnostic-profile"
import {
	clearTaskHeaderElmRuntimeShadowObservations,
	getTaskHeaderElmRuntimeShadowObservations,
	isTaskHeaderElmRuntimeShadowEnabled,
	observeTaskHeaderElmRuntimeShadow,
	resetTaskHeaderElmRuntimeShadowForTests,
} from "../task-header-elm-shadow"

beforeEach(() => {
	resetTaskHeaderElmRuntimeShadowForTests()
	clearTaskHeaderElmRuntimeShadowObservations()
})

afterEach(() => {
	resetTaskHeaderElmRuntimeShadowForTests()
})

// ----------------------------------------------------------------------------
// PROFILE-01..PROFILE-04 — Resolver + activation contract
// (dogfood default ON, public default OFF, no env override)
// ----------------------------------------------------------------------------

describe("PROFILE-01..02: resolveEffectiveTaskHeaderElmRuntimeShadow identity (pure resolver)", () => {
	it("PROFILE-01: public + no env -> OFF (public default preserved)", () => {
		expect(resolveEffectiveTaskHeaderElmRuntimeShadow({}, false)).toEqual({
			enabled: false,
			source: "profile",
		})
	})

	it("PROFILE-02: dogfood + no env -> ON (dogfood default ON, no opt-in required)", () => {
		expect(resolveEffectiveTaskHeaderElmRuntimeShadow({}, true)).toEqual({
			enabled: true,
			source: "profile",
		})
	})

	it("PROFILE-01b: public + env var does NOT change the result (env branch removed)", () => {
		expect(resolveEffectiveTaskHeaderElmRuntimeShadow({ CLINEMM_DIAG_TASK_HEADER_ELM_RUNTIME_SHADOW: "1" }, false)).toEqual({
			enabled: false,
			source: "profile",
		})
		expect(resolveEffectiveTaskHeaderElmRuntimeShadow({ CLINEMM_DIAG_TASK_HEADER_ELM_RUNTIME_SHADOW: "0" }, false)).toEqual({
			enabled: false,
			source: "profile",
		})
		expect(resolveEffectiveTaskHeaderElmRuntimeShadow({ CLINEMM_DIAG_TASK_HEADER_ELM_RUNTIME_SHADOW: "garbage" }, false)).toEqual({
			enabled: false,
			source: "profile",
		})
	})

	it("PROFILE-02b: dogfood + env var does NOT change the result (env branch removed)", () => {
		expect(resolveEffectiveTaskHeaderElmRuntimeShadow({ CLINEMM_DIAG_TASK_HEADER_ELM_RUNTIME_SHADOW: "1" }, true)).toEqual({
			enabled: true,
			source: "profile",
		})
		expect(resolveEffectiveTaskHeaderElmRuntimeShadow({ CLINEMM_DIAG_TASK_HEADER_ELM_RUNTIME_SHADOW: "0" }, true)).toEqual({
			enabled: true,
			source: "profile",
		})
		expect(resolveEffectiveTaskHeaderElmRuntimeShadow({ CLINEMM_DIAG_TASK_HEADER_ELM_RUNTIME_SHADOW: "garbage" }, true)).toEqual({
			enabled: true,
			source: "profile",
		})
	})
})

// ----------------------------------------------------------------------------
// AC1 — Default-OFF (public) / default-ON (dogfood) activation
// ----------------------------------------------------------------------------

describe("AC1: profile-default activation", () => {
	it("PROFILE-03: public + no env -> resolver returns OFF and helper does NOT arm the seam", () => {
		const r = resolveEffectiveTaskHeaderElmRuntimeShadow({}, false)
		expect(r.enabled).toBe(false)
		expect(r.source).toBe("profile")
		const helper = applyTaskHeaderElmRuntimeShadowDiagnosticProfile({}, false)
		expect(helper.enabled).toBe(false)
		expect(helper.flipped).toBe(false)
		expect(isTaskHeaderElmRuntimeShadowEnabled()).toBe(false)
	})

	it("PROFILE-04: dogfood + no env -> resolver returns ON and helper ARMS the seam (no env var needed)", () => {
		const r = resolveEffectiveTaskHeaderElmRuntimeShadow({}, true)
		expect(r.enabled).toBe(true)
		expect(r.source).toBe("profile")
		const helper = applyTaskHeaderElmRuntimeShadowDiagnosticProfile({}, true)
		expect(helper.enabled).toBe(true)
		expect(helper.flipped).toBe(true)
		expect(isTaskHeaderElmRuntimeShadowEnabled()).toBe(true)
	})
})

// ----------------------------------------------------------------------------
// AC2 — Public OFF conservation in the presence of any env var
// ----------------------------------------------------------------------------

describe("AC2: public OFF is the default public identity (env var is ignored)", () => {
	it("public + env=1 -> resolver returns OFF; helper does NOT arm the seam", () => {
		const r = resolveEffectiveTaskHeaderElmRuntimeShadow({ CLINEMM_DIAG_TASK_HEADER_ELM_RUNTIME_SHADOW: "1" }, false)
		expect(r.enabled).toBe(false)
		expect(r.source).toBe("profile")
		const helper = applyTaskHeaderElmRuntimeShadowDiagnosticProfile(
			{ CLINEMM_DIAG_TASK_HEADER_ELM_RUNTIME_SHADOW: "1" },
			false,
		)
		expect(helper.enabled).toBe(false)
		expect(helper.flipped).toBe(false)
		expect(isTaskHeaderElmRuntimeShadowEnabled()).toBe(false)
	})

	it("public + env=0/off/false/garbage -> OFF (full env garbage semantics preserved)", () => {
		for (const v of ["0", "off", "false", "garbage", ""]) {
			expect(resolveEffectiveTaskHeaderElmRuntimeShadow({ CLINEMM_DIAG_TASK_HEADER_ELM_RUNTIME_SHADOW: v }, false).enabled).toBe(
				false,
			)
		}
		expect(resolveEffectiveTaskHeaderElmRuntimeShadow({}, false).enabled).toBe(false)
	})
})

// ----------------------------------------------------------------------------
// AC3 — Idempotent seam flips (public can be flipped OFF; dogfood flipped ON)
// ----------------------------------------------------------------------------

describe("AC3: idempotent activation flips", () => {
	it("two consecutive dogfood ON calls -> second call flipped=false", () => {
		const first = applyTaskHeaderElmRuntimeShadowDiagnosticProfile({}, true)
		expect(first.flipped).toBe(true)
		const second = applyTaskHeaderElmRuntimeShadowDiagnosticProfile({}, true)
		expect(second.flipped).toBe(false)
		expect(second.enabled).toBe(true)
		expect(isTaskHeaderElmRuntimeShadowEnabled()).toBe(true)
	})

	it("dogfood ON then public OFF -> second call flipped=true and seam is disabled", () => {
		applyTaskHeaderElmRuntimeShadowDiagnosticProfile({}, true)
		expect(isTaskHeaderElmRuntimeShadowEnabled()).toBe(true)
		const off = applyTaskHeaderElmRuntimeShadowDiagnosticProfile({}, false)
		expect(off.flipped).toBe(true)
		expect(off.enabled).toBe(false)
		expect(isTaskHeaderElmRuntimeShadowEnabled()).toBe(false)
	})

	it("public OFF then dogfood ON -> second call flipped=true and seam is enabled", () => {
		applyTaskHeaderElmRuntimeShadowDiagnosticProfile({}, false)
		expect(isTaskHeaderElmRuntimeShadowEnabled()).toBe(false)
		const on = applyTaskHeaderElmRuntimeShadowDiagnosticProfile({}, true)
		expect(on.flipped).toBe(true)
		expect(on.enabled).toBe(true)
		expect(isTaskHeaderElmRuntimeShadowEnabled()).toBe(true)
	})
})

// ----------------------------------------------------------------------------
// AC4 — Disabled-mode comparison helper conservation
// ----------------------------------------------------------------------------

describe("AC4: disabled-mode comparison helper is conservation-tight", () => {
	it("with the seam OFF, the comparison helper short-circuits and writes nothing", async () => {
		applyTaskHeaderElmRuntimeShadowDiagnosticProfile({}, false)
		expect(isTaskHeaderElmRuntimeShadowEnabled()).toBe(false)
		const ts = { phase: "streaming" as const, source: "legacy" as const, seq: 1 }
		const facts = {
			canonicalShadowPhase: "idle" as const,
			currentLegacyPhase: "streaming" as const,
			seq: 1,
			canonicalShadowObservedTurnSeq: null,
		}
		const out = await observeTaskHeaderElmRuntimeShadow({ ts, facts })
		expect(out).toStrictEqual(ts)
		expect(getTaskHeaderElmRuntimeShadowObservations().length).toBe(0)
	})

	it("with the seam OFF and a fake Elm that would throw, no observation is recorded and the return is unchanged", async () => {
		applyTaskHeaderElmRuntimeShadowDiagnosticProfile({}, false)
		const ts = { phase: "idle" as const, source: "shadow" as const, seq: 7 }
		const facts = {
			canonicalShadowPhase: "idle" as const,
			currentLegacyPhase: "idle" as const,
			seq: 7,
			canonicalShadowObservedTurnSeq: 7,
		}
		const fakeThrowing = async (): Promise<never> => {
			throw new Error("should-never-be-called")
		}
		const out = await observeTaskHeaderElmRuntimeShadow({
			ts,
			facts,
			invokeElmForProduction: fakeThrowing,
		})
		expect(out).toStrictEqual(ts)
		expect(getTaskHeaderElmRuntimeShadowObservations().length).toBe(0)
	})
})

// ----------------------------------------------------------------------------
// AC5 — Public default conservation (env-var path removed)
// ----------------------------------------------------------------------------

describe("AC5: public default is OFF regardless of any env var contents", () => {
	it("public + no env -> OFF; helper is a no-op", () => {
		const helper = applyTaskHeaderElmRuntimeShadowDiagnosticProfile({}, false)
		expect(helper.enabled).toBe(false)
		expect(helper.source).toBe("profile")
		expect(helper.flipped).toBe(false)
		expect(isTaskHeaderElmRuntimeShadowEnabled()).toBe(false)
	})

	it("public + env=0/off/false/garbage -> OFF (env branch removed; identity is the SOLE gate)", () => {
		for (const v of ["0", "off", "false", "garbage", ""]) {
			expect(resolveEffectiveTaskHeaderElmRuntimeShadow({ CLINEMM_DIAG_TASK_HEADER_ELM_RUNTIME_SHADOW: v }, false).enabled).toBe(
				false,
			)
		}
		expect(resolveEffectiveTaskHeaderElmRuntimeShadow({}, false).enabled).toBe(false)
	})
})
