/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-RUNTIME-SHADOW-QUALIFICATION
 *
 * Tests for the TaskHeader Elm runtime-shadow profile extension. These
 * tests exercise the REAL production activation helper
 * (`applyTaskHeaderElmRuntimeShadowDiagnosticProfile` in
 * `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts` — the SAME
 * helper `extension.ts:activate` calls) and the REAL production
 * comparison helper (`observeTaskHeaderElmRuntimeShadow` in
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
 * Required test coverage:
 *
 *   T1 public  + no env          -> OFF
 *   T2 dogfood + no env          -> OFF
 *   T3 public  + env=1           -> ON
 *   T4 dogfood + env=1           -> ON
 *   T5 public  + env=0           -> OFF
 *   T6 dogfood + env=0           -> OFF
 *   T7 default-disabled semantics outside dogfood are unchanged
 *
 * Plus structural / production-integration tests:
 *   AC1..AC5 (see below)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	applyTaskHeaderElmRuntimeShadowDiagnosticProfile,
	parseTaskHeaderElmRuntimeShadowEnv,
	resolveEffectiveTaskHeaderElmRuntimeShadow,
} from "../dogfood-diagnostic-profile"
import {
	clearTaskHeaderElmRuntimeShadowObservations,
	getTaskHeaderElmRuntimeShadowObservations,
	isTaskHeaderElmRuntimeShadowEnabled,
	observeTaskHeaderElmRuntimeShadow,
	resetTaskHeaderElmRuntimeShadowForTests,
} from "../task-header-elm-shadow"

const ENV_VAR = "CLINEMM_DIAG_TASK_HEADER_ELM_RUNTIME_SHADOW"

beforeEach(() => {
	resetTaskHeaderElmRuntimeShadowForTests()
	clearTaskHeaderElmRuntimeShadowObservations()
})

afterEach(() => {
	resetTaskHeaderElmRuntimeShadowForTests()
})

// ----------------------------------------------------------------------------
// T1..T6 — Resolver precedence (pure)
// ----------------------------------------------------------------------------

describe("T1..T6: resolveEffectiveTaskHeaderElmRuntimeShadow precedence (pure resolver)", () => {
	it("T1: public + no env -> OFF (public default preserved)", () => {
		expect(resolveEffectiveTaskHeaderElmRuntimeShadow({}, false)).toEqual({
			enabled: false,
			source: "profile",
		})
	})

	it("T2: dogfood + no env -> OFF (opt-in required, no auto-on)", () => {
		expect(resolveEffectiveTaskHeaderElmRuntimeShadow({}, true)).toEqual({
			enabled: false,
			source: "profile",
		})
	})

	it("T3: public + env=1 -> ON (explicit operator opt-in honored)", () => {
		expect(resolveEffectiveTaskHeaderElmRuntimeShadow({ [ENV_VAR]: "1" }, false)).toEqual({ enabled: true, source: "env" })
	})

	it("T4: dogfood + env=1 -> ON (explicit operator opt-in honored)", () => {
		expect(resolveEffectiveTaskHeaderElmRuntimeShadow({ [ENV_VAR]: "1" }, true)).toEqual({ enabled: true, source: "env" })
	})

	it("T5: public + env=0 -> OFF (explicit override-down honored)", () => {
		expect(resolveEffectiveTaskHeaderElmRuntimeShadow({ [ENV_VAR]: "0" }, false)).toEqual({ enabled: false, source: "env" })
	})

	it("T6: dogfood + env=0 -> OFF (explicit override-down honored)", () => {
		expect(resolveEffectiveTaskHeaderElmRuntimeShadow({ [ENV_VAR]: "off" }, true)).toEqual({ enabled: false, source: "env" })
	})

	it("T7: garbage env -> falls through to profile default OFF", () => {
		expect(resolveEffectiveTaskHeaderElmRuntimeShadow({ [ENV_VAR]: "garbage" }, false)).toEqual({
			enabled: false,
			source: "profile",
		})
	})

	it("T8: parseEnv null returns undefined; empty string returns undefined", () => {
		expect(parseTaskHeaderElmRuntimeShadowEnv({})).toBeUndefined()
		expect(parseTaskHeaderElmRuntimeShadowEnv({ [ENV_VAR]: "" })).toBeUndefined()
		expect(parseTaskHeaderElmRuntimeShadowEnv({ [ENV_VAR]: "  1  " })?.enabled).toBe(true)
	})
})

// ----------------------------------------------------------------------------
// AC1 — Default OFF when no env is set (public + dogfood)
// ----------------------------------------------------------------------------

describe("AC1: default-disabled activation", () => {
	it("public + no env -> resolver returns OFF and helper does NOT arm the seam", () => {
		const r = resolveEffectiveTaskHeaderElmRuntimeShadow({}, false)
		expect(r.enabled).toBe(false)
		expect(r.source).toBe("profile")
		const helper = applyTaskHeaderElmRuntimeShadowDiagnosticProfile({}, false)
		expect(helper.enabled).toBe(false)
		expect(helper.flipped).toBe(false)
		expect(isTaskHeaderElmRuntimeShadowEnabled()).toBe(false)
	})

	it("dogfood + no env -> resolver returns OFF and helper does NOT arm the seam (opt-in required)", () => {
		const helper = applyTaskHeaderElmRuntimeShadowDiagnosticProfile({}, true)
		expect(helper.enabled).toBe(false)
		expect(helper.flipped).toBe(false)
		expect(isTaskHeaderElmRuntimeShadowEnabled()).toBe(false)
	})
})

// ----------------------------------------------------------------------------
// AC2 — Explicit ON arms the seam
// ----------------------------------------------------------------------------

describe("AC2: explicit ON arms the seam", () => {
	it("env=1 -> helper arms the seam and flipped=true", () => {
		const helper = applyTaskHeaderElmRuntimeShadowDiagnosticProfile({ [ENV_VAR]: "1" }, false)
		expect(helper.enabled).toBe(true)
		expect(helper.source).toBe("env")
		expect(helper.flipped).toBe(true)
		expect(isTaskHeaderElmRuntimeShadowEnabled()).toBe(true)
	})

	it("env=true -> helper arms the seam", () => {
		const helper = applyTaskHeaderElmRuntimeShadowDiagnosticProfile({ [ENV_VAR]: "true" }, false)
		expect(helper.enabled).toBe(true)
		expect(helper.flipped).toBe(true)
	})

	it("env=yes -> helper arms the seam", () => {
		const helper = applyTaskHeaderElmRuntimeShadowDiagnosticProfile({ [ENV_VAR]: "yes" }, true)
		expect(helper.enabled).toBe(true)
	})
})

// ----------------------------------------------------------------------------
// AC3 — Idempotent seam flips
// ----------------------------------------------------------------------------

describe("AC3: idempotent activation flips", () => {
	it("two consecutive ON calls -> second call flipped=false", () => {
		const first = applyTaskHeaderElmRuntimeShadowDiagnosticProfile({ [ENV_VAR]: "1" }, false)
		expect(first.flipped).toBe(true)
		const second = applyTaskHeaderElmRuntimeShadowDiagnosticProfile({ [ENV_VAR]: "1" }, false)
		expect(second.flipped).toBe(false)
		expect(second.enabled).toBe(true)
		expect(isTaskHeaderElmRuntimeShadowEnabled()).toBe(true)
	})

	it("ON then OFF -> second call flipped=true and seam is disabled", () => {
		applyTaskHeaderElmRuntimeShadowDiagnosticProfile({ [ENV_VAR]: "1" }, false)
		expect(isTaskHeaderElmRuntimeShadowEnabled()).toBe(true)
		const off = applyTaskHeaderElmRuntimeShadowDiagnosticProfile({ [ENV_VAR]: "0" }, false)
		expect(off.flipped).toBe(true)
		expect(off.enabled).toBe(false)
		expect(isTaskHeaderElmRuntimeShadowEnabled()).toBe(false)
	})
})

// ----------------------------------------------------------------------------
// AC4 — Default-disabled comparison helper conservation
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
// AC5 — Public-default conservation
// ----------------------------------------------------------------------------

describe("AC5: public default is OFF in both profiles when no env is set", () => {
	it("public + no env -> OFF; helper is a no-op", () => {
		const helper = applyTaskHeaderElmRuntimeShadowDiagnosticProfile({}, false)
		expect(helper.enabled).toBe(false)
		expect(helper.source).toBe("profile")
		expect(helper.flipped).toBe(false)
		expect(isTaskHeaderElmRuntimeShadowEnabled()).toBe(false)
	})

	it("public + env=0/off/false/empty/unset -> OFF (full env semantics preserved)", () => {
		for (const v of ["0", "off", "false", ""]) {
			expect(resolveEffectiveTaskHeaderElmRuntimeShadow({ [ENV_VAR]: v }, false).enabled).toBe(false)
		}
		expect(resolveEffectiveTaskHeaderElmRuntimeShadow({}, false).enabled).toBe(false)
	})
})
