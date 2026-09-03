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

import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
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

	/**
	 * Build a context whose dump target is a real temporary directory.
	 * The directory path is registered for cleanup; the dump helper
	 * writes to `<globalStorageUri.fsPath>/w-carrier-trace.jsonl`
	 * (mirrors the production path). This is the only way to
	 * mechanically prove that `recordWCarrierTrace` did NOT bail.
	 */
	function makeRealContext(): { ctx: WCarrierTraceContext; dir: string } {
		const dir = mkdtempSync(join(tmpdir(), "w-carrier-trace-integration-"))
		dirs.push(dir)
		const ctx: WCarrierTraceContext = {
			workspaceState: {
				get: () => undefined as never,
				update: async () => {},
			},
			globalStorageUri: { fsPath: dir },
			subscriptions: [],
		}
		return { ctx, dir }
	}

	it("effective ON -> recordWCarrierTrace appends a sentinel; dump persists it", async () => {
		// Activate the dogfood default (no env var).
		applyWCarrierTraceDiagnosticProfile({}, true)
		const { ctx, dir } = makeRealContext()
		// One sentinel. After activation the seam is ON; the recorder
		// MUST append. Then we dump and read back the JSONL line.
		recordWCarrierTrace(ctx, {
			t: 1234,
			kind: "state_publish",
			sessionId: "session-on",
			publishedW: 100,
		})
		const filePath = await dumpWCarrierTrace(ctx)
		expect(filePath).toBe(join(dir, "w-carrier-trace.jsonl"))
		const lines = readFileSync(filePath as string, "utf8")
			.trim()
			.split("\n")
		expect(lines).toHaveLength(1)
		const parsed = JSON.parse(lines[0])
		expect(parsed).toEqual({
			t: 1234,
			kind: "state_publish",
			sessionId: "session-on",
			publishedW: 100,
		})
	})

	it("effective OFF -> recordWCarrierTrace is a no-op; dump returns undefined and writes no file", async () => {
		// Activate the public default (no env var).
		applyWCarrierTraceDiagnosticProfile({}, false)
		const { ctx, dir } = makeRealContext()
		// One sentinel while OFF. The recorder MUST bail.
		recordWCarrierTrace(ctx, {
			t: 1234,
			kind: "state_publish",
			sessionId: "session-off",
			publishedW: 100,
		})
		const filePath = await dumpWCarrierTrace(ctx)
		expect(filePath).toBeUndefined()
		// Defensive: the dump path must not have been created on disk
		// (recordWCarrierTrace bailed; dump returned undefined before
		// touching fs).
		expect(existsSync(join(dir, "w-carrier-trace.jsonl"))).toBe(false)
	})

	it("explicit env override-down flips an ON activation to OFF; subsequent records are no-ops", async () => {
		// Start ON (dogfood default).
		applyWCarrierTraceDiagnosticProfile({}, true)
		const { ctx } = makeRealContext()
		recordWCarrierTrace(ctx, {
			t: 1,
			kind: "state_publish",
			sessionId: "s",
			publishedW: 1,
		})
		// Re-apply with `CLINEMM_W_TRACE=0` -> override-down.
		const r = applyWCarrierTraceDiagnosticProfile({ CLINEMM_W_TRACE: "0" }, true)
		expect(r.flipped).toBe(true)
		expect(r.enabled).toBe(false)
		// While OFF, recordWCarrierTrace is a no-op (verified via
		// the OFF integration test above; the recorder consults the
		// same seam). Try a second record — it MUST be bailed.
		recordWCarrierTrace(ctx, {
			t: 2,
			kind: "state_publish",
			sessionId: "s",
			publishedW: 2,
		})
		// dumpWCarrierTrace ALSO gates on the seam, so while OFF
		// it returns undefined. To inspect the buffer, flip the
		// seam back ON transiently (preserves the buffer; only the
		// gate is what matters).
		applyWCarrierTraceDiagnosticProfile({ CLINEMM_W_TRACE: "1" }, true)
		const filePath = await dumpWCarrierTrace(ctx)
		expect(filePath).toBeDefined()
		const lines = readFileSync(filePath as string, "utf8")
			.trim()
			.split("\n")
		// Only the FIRST sentinel is on disk — the second record was
		// correctly bailed by the OFF seam.
		expect(lines).toHaveLength(1)
		expect(JSON.parse(lines[0]).publishedW).toBe(1)
	})

	it("explicit env override-up flips an OFF activation to ON", async () => {
		applyWCarrierTraceDiagnosticProfile({}, false)
		const { ctx } = makeRealContext()
		recordWCarrierTrace(ctx, {
			t: 1,
			kind: "state_publish",
			sessionId: "s",
			publishedW: 1,
		})
		// No file should have been written yet.
		const filePath0 = await dumpWCarrierTrace(ctx)
		expect(filePath0).toBeUndefined()
		// Re-apply with `CLINEMM_W_TRACE=1` -> override-up.
		const r = applyWCarrierTraceDiagnosticProfile({ CLINEMM_W_TRACE: "1" }, false)
		expect(r.flipped).toBe(true)
		expect(r.enabled).toBe(true)
		// Subsequent records persist.
		recordWCarrierTrace(ctx, {
			t: 2,
			kind: "state_publish",
			sessionId: "s",
			publishedW: 2,
		})
		const filePath = await dumpWCarrierTrace(ctx)
		expect(filePath).toBeDefined()
		const lines = readFileSync(filePath as string, "utf8")
			.trim()
			.split("\n")
		expect(lines).toHaveLength(1)
		expect(JSON.parse(lines[0]).publishedW).toBe(2)
	})

	it("is idempotent (no flip on repeated call with same effective state)", () => {
		const r1 = applyWCarrierTraceDiagnosticProfile({}, true)
		const r2 = applyWCarrierTraceDiagnosticProfile({}, true)
		expect(r1.flipped).toBe(true)
		expect(r2.flipped).toBe(false)
	})

	it("post-activation process.env mutation does NOT change runtime semantic without re-activation", async () => {
		applyWCarrierTraceDiagnosticProfile({}, true)
		const { ctx } = makeRealContext()
		recordWCarrierTrace(ctx, {
			t: 1,
			kind: "state_publish",
			sessionId: "s",
			publishedW: 1,
		})
		// Mutate process.env AFTER activation.
		const envAfter = { CLINEMM_W_TRACE: "0" }
		// The resolver evaluates the new env as OFF, but the seam
		// (the recorder's authority) is unchanged unless we call
		// the activation helper again. This is the THSICAP / D-knob
		// semantic.
		expect(resolveEffectiveWCarrierTrace(envAfter, true)).toEqual({
			enabled: false,
			source: "env",
		})
		// Prove the seam is still ON by recording and dumping.
		recordWCarrierTrace(ctx, {
			t: 2,
			kind: "state_publish",
			sessionId: "s",
			publishedW: 2,
		})
		const filePath = await dumpWCarrierTrace(ctx)
		const lines = readFileSync(filePath as string, "utf8")
			.trim()
			.split("\n")
		expect(lines).toHaveLength(2) // both sentinels persisted (no env replay)
		// Demonstrate: re-activation with the new env flips the seam.
		const r = applyWCarrierTraceDiagnosticProfile(envAfter, true)
		expect(r.flipped).toBe(true)
		expect(r.enabled).toBe(false)
	})
})
