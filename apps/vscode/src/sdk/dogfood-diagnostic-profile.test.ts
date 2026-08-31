/**
 * ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01 -
 * closed-runtime diagnostic-profile resolver tests.
 */

import { describe, expect, it } from "vitest"
import { formatEffectiveKnobLetters, resolveEffectiveDiagnosticKnobs } from "./dogfood-diagnostic-profile"

const EMPTY_PATH: string | null = null
const AUTO_PATH = "/tmp/clinemm-runtime-diag/abc123.jsonl"

describe("resolveEffectiveDiagnosticKnobs", () => {
	it("C1: public + no env + no path -> all OFF", () => {
		expect(resolveEffectiveDiagnosticKnobs({}, false, EMPTY_PATH)).toEqual({
			v: false,
			i: false,
			a: false,
			p: false,
		})
	})

	it("C2: public + env tries to enable -> still OFF (public wins)", () => {
		expect(
			resolveEffectiveDiagnosticKnobs(
				{
					CLINEMM_DIAG_INPUT_SHAPE_V2: "1",
					CLINEMM_DIAG_APPROVAL_PUBLICATION_V2: "1",
					CLINEMM_CAPTURE_V2_PATH: "/tmp/capture.jsonl",
				},
				false,
				"/tmp/capture.jsonl",
			),
		).toEqual({ v: false, i: false, a: false, p: false })
	})

	it("C3: dogfood + no env + no path -> V/I/P partial; A off", () => {
		expect(resolveEffectiveDiagnosticKnobs({}, true, EMPTY_PATH)).toEqual({
			v: false,
			i: true,
			a: false,
			p: true,
		})
	})

	it("C4: dogfood + no env + auto path -> VIP (canonical indicator)", () => {
		const knobs = resolveEffectiveDiagnosticKnobs({}, true, AUTO_PATH)
		expect(knobs).toEqual({ v: true, i: true, a: false, p: true })
		expect(formatEffectiveKnobLetters(knobs)).toBe("VIP")
	})

	it("C5: dogfood + I=0 -> I forced OFF", () => {
		const knobs = resolveEffectiveDiagnosticKnobs({ CLINEMM_DIAG_INPUT_SHAPE_V2: "0" }, true, AUTO_PATH)
		expect(knobs.i).toBe(false)
		expect(knobs.v).toBe(true)
		expect(knobs.p).toBe(true)
	})

	it("C5b: dogfood + V=0 -> V forced OFF", () => {
		const knobs = resolveEffectiveDiagnosticKnobs({ CLINEMM_CAPTURE_V2_PATH: "0" }, true, AUTO_PATH)
		expect(knobs.v).toBe(false)
		expect(knobs.i).toBe(true)
		expect(knobs.p).toBe(true)
	})

	it("C5c: dogfood + P=false -> P forced OFF", () => {
		const knobs = resolveEffectiveDiagnosticKnobs({ CLINEMM_DIAG_APPROVAL_PUBLICATION_V2: "false" }, true, AUTO_PATH)
		expect(knobs.p).toBe(false)
		expect(knobs.v).toBe(true)
		expect(knobs.i).toBe(true)
	})

	it("C5d: dogfood + ' OFF ' -> I forced OFF (case + whitespace tolerant)", () => {
		const knobs = resolveEffectiveDiagnosticKnobs({ CLINEMM_DIAG_INPUT_SHAPE_V2: " OFF " }, true, AUTO_PATH)
		expect(knobs.i).toBe(false)
	})

	it("C6a: explicit-on 'true' honored in dogfood", () => {
		const knobs = resolveEffectiveDiagnosticKnobs({ CLINEMM_DIAG_INPUT_SHAPE_V2: "true" }, true, AUTO_PATH)
		expect(knobs.i).toBe(true)
	})

	it.each(["banana", "DOGFOOD", "2", " on"])("C6b: garbage value falls through to dogfood default", (value) => {
		const knobs = resolveEffectiveDiagnosticKnobs({ CLINEMM_DIAG_INPUT_SHAPE_V2: value }, true, AUTO_PATH)
		expect(knobs.i).toBe(true)
	})

	it("C7: A is hard-coded false regardless of dogfood or env", () => {
		const knobs = resolveEffectiveDiagnosticKnobs({ CLINEMM_DIAG_ACTIVITY_STATE_V1: "1" }, true, AUTO_PATH)
		expect(knobs.a).toBe(false)
	})

	it("C8: empty-string env values fall through to default", () => {
		const knobs = resolveEffectiveDiagnosticKnobs(
			{
				CLINEMM_CAPTURE_V2_PATH: "",
				CLINEMM_DIAG_INPUT_SHAPE_V2: "",
				CLINEMM_DIAG_APPROVAL_PUBLICATION_V2: "",
			},
			true,
			AUTO_PATH,
		)
		expect(knobs).toEqual({ v: true, i: true, a: false, p: true })
	})

	it("V: dogfood + explicit user path -> V ON", () => {
		const userPath = "/tmp/user-supplied.jsonl"
		const knobs = resolveEffectiveDiagnosticKnobs({ CLINEMM_CAPTURE_V2_PATH: userPath }, true, userPath)
		expect(knobs.v).toBe(true)
	})

	it("R7: resolver body does not mutate its input env", () => {
		const before = {
			CLINEMM_RUNTIME_PROFILE: "dogfood",
			CLINEMM_DIAG_INPUT_SHAPE_V2: "0",
		}
		const beforeSnapshot = { ...before }
		const result = resolveEffectiveDiagnosticKnobs(before, true, AUTO_PATH)
		expect(before).toEqual(beforeSnapshot)
		expect(result.i).toBe(false)
	})
})

describe("formatEffectiveKnobLetters", () => {
	it("empty string when all OFF", () => {
		expect(formatEffectiveKnobLetters({ v: false, i: false, a: false, p: false })).toBe("")
	})

	it("'V' when only V is ON", () => {
		expect(formatEffectiveKnobLetters({ v: true, i: false, a: false, p: false })).toBe("V")
	})

	it("'VIP' for the canonical dogfood initial render", () => {
		expect(formatEffectiveKnobLetters({ v: true, i: true, a: false, p: true })).toBe("VIP")
	})

	it("'VIAP' when A is hypothetically ON", () => {
		expect(formatEffectiveKnobLetters({ v: true, i: true, a: true, p: true })).toBe("VIAP")
	})

	it("'IP' when V is overridden off in dogfood", () => {
		expect(formatEffectiveKnobLetters({ v: false, i: true, a: false, p: true })).toBe("IP")
	})
})
