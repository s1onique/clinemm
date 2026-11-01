/**
 * ACT-CLINEMM-DOGFOOD-MODEL-BEHAVIOR-TRACE-VIAPDT01 — RED witnesses for the
 * dogfood default-ON model-behavior flight recorder and the `T` diagnostic
 * knob.
 *
 * These witnesses use the REAL production resolver and recorder functions —
 * no copied orchestration, no re-implementation of the precedence.
 *
 * Gates covered here:
 *   T01  Public, no persisted override -> recorder OFF.
 *   T02  Dogfood, no persisted override -> recorder ON.
 *   T03  Dogfood, explicit false -> recorder OFF.
 *   T04  Dogfood implicit ON, first toggle -> OFF.
 *   T05  Second toggle -> ON.
 *   T06  Explicit OFF persists across extension activation.
 *   T07  Public explicit ON remains supported.
 *   T08  Recorder ON with all other knobs ON -> "VIAPDT".
 *   T09  Recorder OFF with other knobs ON -> "VIAPD".
 *   T10  Recorder ON alone -> "T".
 *   T11  All knobs OFF -> indicator hidden.
 *   T12  Host `t` mirrors real recorder state.
 *   T13  Live toggle updates the displayed state.
 *   T14  Existing V/I/A/P/D output remains unchanged.
 *   T15  Dump works after disabling, without clearing evidence.
 */
import { readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
	composeEffectiveDiagnosticKnobs,
	formatEffectiveKnobLetters,
	resolveEffectiveModelBehaviorTraceT,
} from "./dogfood-diagnostic-profile"
import {
	_resetModelBehaviorTrace,
	dumpModelBehaviorTrace,
	getModelBehaviorTraceRecords,
	isModelBehaviorTraceEnabled,
	readModelBehaviorTraceWorkspaceOverride,
	recordModelBehaviorTrace,
	syncModelBehaviorTraceEnabled,
	toggleModelBehaviorTraceWorkspaceEnabled,
} from "./model-behavior-trace-runtime"

/** A minimal `ExtensionContext` stand-in with an inspectable workspaceState. */
function makeContext(initial?: boolean) {
	const state = new Map<string, unknown>()
	if (initial !== undefined) {
		state.set("modelBehaviorTraceEnabled", initial)
	}
	return {
		globalStorageUri: { fsPath: join(tmpdir(), `mbt-viapdt-${Math.random().toString(36).slice(2)}`) },
		workspaceState: {
			get: <T>(key: string): T | undefined => state.get(key) as T | undefined,
			update: async (key: string, value: unknown): Promise<void> => {
				state.set(key, value)
			},
		},
	}
}

/** The production activation seam for the dogfood default-ON contract. */
function activate(context: ReturnType<typeof makeContext>, isDogfood: boolean): Promise<boolean> {
	return syncModelBehaviorTraceEnabled(context, { isDogfood })
}

describe("ACT-CLINEMM-DOGFOOD-MODEL-BEHAVIOR-TRACE-VIAPDT01 — effective T authority", () => {
	afterEach(() => {
		_resetModelBehaviorTrace()
	})

	it("T01: public, no persisted override -> recorder OFF", async () => {
		_resetModelBehaviorTrace()
		const context = makeContext()
		const enabled = await activate(context, false)
		expect(enabled).toBe(false)
		expect(isModelBehaviorTraceEnabled()).toBe(false)
		// Public default OFF is conserved: no records are captured.
		recordModelBehaviorTrace("model_request_start", { sessionId: "s1", payload: {} })
		expect(getModelBehaviorTraceRecords()).toHaveLength(0)
	})

	it("T02: dogfood, no persisted override -> recorder ON", async () => {
		_resetModelBehaviorTrace()
		const context = makeContext()
		const enabled = await activate(context, true)
		expect(enabled).toBe(true)
		expect(isModelBehaviorTraceEnabled()).toBe(true)
	})

	it("T03: dogfood, explicit false -> recorder OFF", async () => {
		_resetModelBehaviorTrace()
		const context = makeContext(false)
		const enabled = await activate(context, true)
		expect(enabled).toBe(false)
		expect(isModelBehaviorTraceEnabled()).toBe(false)
	})

	it("T04: dogfood implicit ON, first toggle -> OFF", async () => {
		_resetModelBehaviorTrace()
		const context = makeContext()
		await activate(context, true)
		expect(isModelBehaviorTraceEnabled()).toBe(true)
		// The FIRST toggle must invert the EFFECTIVE state (ON -> OFF), not
		// re-arm a boolean that treats "unset" as OFF.
		const next = await toggleModelBehaviorTraceWorkspaceEnabled(context, { isDogfood: true })
		expect(next).toBe(false)
		expect(isModelBehaviorTraceEnabled()).toBe(false)
	})

	it("T05: second toggle -> ON", async () => {
		_resetModelBehaviorTrace()
		const context = makeContext()
		await activate(context, true)
		await toggleModelBehaviorTraceWorkspaceEnabled(context, { isDogfood: true })
		const next = await toggleModelBehaviorTraceWorkspaceEnabled(context, { isDogfood: true })
		expect(next).toBe(true)
		expect(isModelBehaviorTraceEnabled()).toBe(true)
	})

	it("T06: explicit OFF persists across extension activation", async () => {
		_resetModelBehaviorTrace()
		const context = makeContext(false)
		await activate(context, true)
		expect(isModelBehaviorTraceEnabled()).toBe(false)
		// Re-activation (extension reload) must honor the persisted explicit OFF.
		const enabled = await activate(context, true)
		expect(enabled).toBe(false)
		expect(isModelBehaviorTraceEnabled()).toBe(false)
	})

	it("T07: public explicit ON remains supported", async () => {
		_resetModelBehaviorTrace()
		const context = makeContext(true)
		const enabled = await activate(context, false)
		expect(enabled).toBe(true)
		expect(isModelBehaviorTraceEnabled()).toBe(true)
	})

	it("T12: the host `t` mirrors the real recorder state", async () => {
		_resetModelBehaviorTrace()
		const context = makeContext()
		await activate(context, true)
		// The projected `t` comes from the ACTUAL recorder state, not from a
		// recomputation of the profile default.
		expect(isModelBehaviorTraceEnabled()).toBe(true)
		const knobs = composeEffectiveDiagnosticKnobs({}, true, null, null, isModelBehaviorTraceEnabled())
		expect(knobs.t).toBe(true)

		// A live manual OFF (with the profile still dogfood) must project t=false.
		await toggleModelBehaviorTraceWorkspaceEnabled(context, { isDogfood: true })
		expect(isModelBehaviorTraceEnabled()).toBe(false)
		const knobsAfter = composeEffectiveDiagnosticKnobs({}, true, null, null, isModelBehaviorTraceEnabled())
		expect(knobsAfter.t).toBe(false)
	})

	it("T13: live toggle updates the displayed state", async () => {
		_resetModelBehaviorTrace()
		const context = makeContext()
		await activate(context, true)
		// The dogfood profile also defaults I/A/P ON, so the composed knob set
		// carries those letters too. What matters for this gate is that the
		// `T` letter — and ONLY the `T` letter — follows the live recorder.
		const before = composeEffectiveDiagnosticKnobs({}, true, null, null, isModelBehaviorTraceEnabled())
		expect(before.t).toBe(true)
		expect(formatEffectiveKnobLetters(before)).toContain("T")
		const beforeWithoutT = formatEffectiveKnobLetters({ ...before, t: false })
		expect(formatEffectiveKnobLetters(before)).toBe(`${beforeWithoutT}T`)

		await toggleModelBehaviorTraceWorkspaceEnabled(context, { isDogfood: true })
		const after = composeEffectiveDiagnosticKnobs({}, true, null, null, isModelBehaviorTraceEnabled())
		expect(after.t).toBe(false)
		expect(formatEffectiveKnobLetters(after)).toBe(beforeWithoutT)
	})

	it("T15: dump works after disabling, without clearing evidence", async () => {
		_resetModelBehaviorTrace()
		const context = makeContext()
		await activate(context, true)
		recordModelBehaviorTrace("model_request_start", { sessionId: "s1", payload: {} })
		expect(getModelBehaviorTraceRecords()).toHaveLength(1)

		await toggleModelBehaviorTraceWorkspaceEnabled(context, { isDogfood: true })
		expect(isModelBehaviorTraceEnabled()).toBe(false)

		const dump = await dumpModelBehaviorTrace(context)
		expect(dump.recordCount).toBe(1)
		const raw = await readFile(dump.filePath, "utf8")
		const lines = raw.trim().split("\n")
		expect(lines.length).toBe(2) // one record + one summary
		expect(() => JSON.parse(lines[0])).not.toThrow()
		expect(() => JSON.parse(lines[1])).not.toThrow()
		await rm(dump.filePath, { force: true })
	})
})

describe("ACT-CLINEMM-DOGFOOD-MODEL-BEHAVIOR-TRACE-VIAPDT01 — T precedence resolver", () => {
	it("resolves the frozen precedence: explicit override > dogfood default > public OFF", () => {
		// Dogfood, unset -> ON.
		expect(resolveEffectiveModelBehaviorTraceT(true, undefined)).toEqual({
			t: true,
			source: "profile",
		})
		// Dogfood, explicit true -> ON.
		expect(resolveEffectiveModelBehaviorTraceT(true, true)).toEqual({
			t: true,
			source: "workspace",
		})
		// Dogfood, explicit false -> OFF.
		expect(resolveEffectiveModelBehaviorTraceT(true, false)).toEqual({
			t: false,
			source: "workspace",
		})
		// Public, unset -> OFF.
		expect(resolveEffectiveModelBehaviorTraceT(false, undefined)).toEqual({
			t: false,
			source: "profile",
		})
		// Public, explicit true -> ON.
		expect(resolveEffectiveModelBehaviorTraceT(false, true)).toEqual({
			t: true,
			source: "workspace",
		})
		// Public, explicit false -> OFF.
		expect(resolveEffectiveModelBehaviorTraceT(false, false)).toEqual({
			t: false,
			source: "workspace",
		})
	})

	it("preserves `undefined` as distinct from `false` in the persisted override", () => {
		const unset = makeContext()
		expect(readModelBehaviorTraceWorkspaceOverride(unset)).toBeUndefined()
		const explicitFalse = makeContext(false)
		expect(readModelBehaviorTraceWorkspaceOverride(explicitFalse)).toBe(false)
		const explicitTrue = makeContext(true)
		expect(readModelBehaviorTraceWorkspaceOverride(explicitTrue)).toBe(true)
	})
})

describe("ACT-CLINEMM-DOGFOOD-MODEL-BEHAVIOR-TRACE-VIAPDT01 — VIAPDT presentation", () => {
	const ALL_ON = { v: true, i: true, a: true, p: true, d: true } as const

	it("T08: recorder ON with all other knobs ON -> VIAPDT", () => {
		expect(formatEffectiveKnobLetters({ ...ALL_ON, t: true })).toBe("VIAPDT")
	})

	it("T09: recorder OFF with other knobs ON -> VIAPD", () => {
		expect(formatEffectiveKnobLetters({ ...ALL_ON, t: false })).toBe("VIAPD")
	})

	it("T10: recorder ON alone -> T", () => {
		expect(formatEffectiveKnobLetters({ v: false, i: false, a: false, p: false, d: false, t: true })).toBe("T")
	})

	it("T11: all knobs OFF -> indicator hidden (empty string)", () => {
		expect(formatEffectiveKnobLetters({ v: false, i: false, a: false, p: false, d: false, t: false })).toBe("")
	})

	it("T14: existing V/I/A/P/D output remains unchanged", () => {
		// The pre-existing canonical renders are pinned: the T knob is purely
		// ADDITIVE and never perturbs the V/I/A/P/D letters or their order.
		expect(formatEffectiveKnobLetters({ ...ALL_ON, t: false })).toBe("VIAPD")
		expect(formatEffectiveKnobLetters({ v: true, i: true, a: false, p: true, d: false, t: false })).toBe("VIP")
		expect(formatEffectiveKnobLetters({ v: true, i: true, a: true, p: true, d: false, t: false })).toBe("VIAP")
		expect(formatEffectiveKnobLetters({ v: false, i: true, a: false, p: true, d: false, t: false })).toBe("IP")
		expect(formatEffectiveKnobLetters({ v: false, i: false, a: false, p: false, d: true, t: false })).toBe("D")
	})
})
