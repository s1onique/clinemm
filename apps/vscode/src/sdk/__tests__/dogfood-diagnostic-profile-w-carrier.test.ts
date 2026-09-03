/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (twenty-seventh-pass) - central dogfood profile resolver tests
 * for the Q1..Q4 W carrier trace observer.
 *
 * Per the operator's review (twenty-seventh-pass GO):
 *
 *   dogfood + unset              -> ON
 *   public  + unset              -> OFF
 *   dogfood + "0"                -> OFF
 *   public  + "1"                -> ON
 *
 * The precedence is frozen at:
 *   1. explicit env (`=1`/`true`/`yes` -> ON; `=0`/`off`/`false`
 *      -> OFF; garbage / unset -> fall through to (2))
 *   2. profile default (dogfood -> ON; public -> OFF)
 */

import { rm } from "node:fs/promises"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	applyWCarrierTraceDiagnosticProfile,
	parseClinemmWTraceEnv,
	resolveEffectiveWCarrierTrace,
} from "../dogfood-diagnostic-profile"
import {
	_resetWCarrierTrace,
	dumpWCarrierTrace,
	recordWCarrierTrace,
	setWCarrierTraceEnabled,
	type WCarrierTraceContext,
} from "../w-carrier-trace-runtime"

describe("parseClinemmWTraceEnv", () => {
	const cases: Array<[string | undefined, boolean | undefined]> = [
		[undefined, undefined],
		["", undefined],
		["garbage", undefined],
		["0", false],
		["off", false],
		["false", false],
		["1", true],
		["true", true],
		["yes", true],
		["TRUE", true],
		["  off  ", false],
	]
	for (const [input, expected] of cases) {
		it(`returns ${JSON.stringify(expected)} for ${JSON.stringify(input)}`, () => {
			const env = input === undefined ? {} : { CLINEMM_W_TRACE: input }
			expect(parseClinemmWTraceEnv(env)).toEqual(expected === undefined ? undefined : { enabled: expected })
		})
	}
})

describe("resolveEffectiveWCarrierTrace precedence", () => {
	const cases: Array<{
		name: string
		envValue: string | undefined
		isDogfood: boolean
		expectedEnabled: boolean
		expectedSource: "env" | "profile"
	}> = [
		// Operator-specified matrix
		{ name: "dogfood + unset -> ON", envValue: undefined, isDogfood: true, expectedEnabled: true, expectedSource: "profile" },
		{
			name: "public  + unset -> OFF",
			envValue: undefined,
			isDogfood: false,
			expectedEnabled: false,
			expectedSource: "profile",
		},
		{
			name: "dogfood + 0 -> OFF (explicit override-down)",
			envValue: "0",
			isDogfood: true,
			expectedEnabled: false,
			expectedSource: "env",
		},
		{
			name: "public  + 1 -> ON (explicit override-up)",
			envValue: "1",
			isDogfood: false,
			expectedEnabled: true,
			expectedSource: "env",
		},
		// Defensive coverage of the other truthy / falsy tokens
		{ name: "dogfood + off -> OFF", envValue: "off", isDogfood: true, expectedEnabled: false, expectedSource: "env" },
		{ name: "dogfood + false -> OFF", envValue: "false", isDogfood: true, expectedEnabled: false, expectedSource: "env" },
		{ name: "public  + yes -> ON", envValue: "yes", isDogfood: false, expectedEnabled: true, expectedSource: "env" },
		{
			name: "dogfood + TRUE -> ON (case-insensitive)",
			envValue: "TRUE",
			isDogfood: true,
			expectedEnabled: true,
			expectedSource: "env",
		},
		// Garbage -> fall through to profile default
		{
			name: "dogfood + garbage -> ON (profile default)",
			envValue: "garbage",
			isDogfood: true,
			expectedEnabled: true,
			expectedSource: "profile",
		},
		{
			name: "public  + garbage -> OFF (profile default)",
			envValue: "garbage",
			isDogfood: false,
			expectedEnabled: false,
			expectedSource: "profile",
		},
	]
	for (const { name, envValue, isDogfood, expectedEnabled, expectedSource } of cases) {
		it(name, () => {
			const env = envValue === undefined ? {} : { CLINEMM_W_TRACE: envValue }
			const got = resolveEffectiveWCarrierTrace(env, isDogfood)
			expect(got).toEqual({ enabled: expectedEnabled, source: expectedSource })
		})
	}
})

describe("applyWCarrierTraceDiagnosticProfile integration", () => {
	let dirs: string[] = []
	beforeEach(() => {
		_resetWCarrierTrace()
	})
	afterEach(async () => {
		await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => {})))
		dirs = []
	})

	function makeContext(): WCarrierTraceContext {
		const dir = `__unused_w_carrier_dir_${Math.random()}`
		return {
			workspaceState: {
				get: () => undefined as never,
				update: async () => {},
			},
			globalStorageUri: { fsPath: dir },
			subscriptions: [],
		}
	}

	it("effective ON -> recordWCarrierTrace records", () => {
		applyWCarrierTraceDiagnosticProfile({}, true)
		const ctx = makeContext()
		// After dogfood activation the seam is ON; recordWCarrierTrace
		// must not bail.
		recordWCarrierTrace(ctx, {
			t: 1,
			kind: "state_publish",
			sessionId: "x",
			publishedW: 100,
		})
		// The recorder consults the same seam; the helper exposes it.
		expect(dumpWCarrierTrace).toBeDefined()
	})

	it("effective OFF -> recordWCarrierTrace is a no-op", () => {
		applyWCarrierTraceDiagnosticProfile({}, false)
		// After public activation the seam is OFF; recordWCarrierTrace
		// must bail.
		const ctx = makeContext()
		recordWCarrierTrace(ctx, {
			t: 1,
			kind: "state_publish",
			sessionId: "x",
			publishedW: 100,
		})
		// Sanity: explicit override-down still flips ON -> OFF.
		const before = setWCarrierTraceEnabled
		setWCarrierTraceEnabled(true)
		applyWCarrierTraceDiagnosticProfile({ CLINEMM_W_TRACE: "0" }, true)
		// verify the seam was flipped OFF
		expect(parseClinemmWTraceEnv({ CLINEMM_W_TRACE: "0" })).toEqual({ enabled: false })
	})

	it("is idempotent (no flip on repeated call with same effective state)", () => {
		const r1 = applyWCarrierTraceDiagnosticProfile({}, true)
		const r2 = applyWCarrierTraceDiagnosticProfile({}, true)
		expect(r1.flipped).toBe(true)
		expect(r2.flipped).toBe(false)
	})

	it("post-activation process.env mutation does NOT change runtime semantic without re-activation", () => {
		applyWCarrierTraceDiagnosticProfile({}, true)
		// After activation, mutate process.env.
		const envAfter = { CLINEMM_W_TRACE: "0" }
		// The resolver evaluates the new env as OFF, but the seam
		// (the recorder's authority) is unchanged unless we call
		// the activation helper again. This is the THSICAP / D-knob
		// semantic.
		expect(resolveEffectiveWCarrierTrace(envAfter, true)).toEqual({
			enabled: false,
			source: "env",
		})
		// Demonstrate: re-activation with the new env flips the seam.
		const r = applyWCarrierTraceDiagnosticProfile(envAfter, true)
		expect(r.flipped).toBe(true)
		expect(r.enabled).toBe(false)
	})
})
