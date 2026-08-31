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

	it("C2: public + env with explicit capture path -> V=true (legacy opt-in preserved)", () => {
		// V is a structural mirror of the writer's effective state
		// (per ACT followup review). If the caller passes a non-null
		// `vCapturePath`, V=true regardless of profile. Public + env
		// with the legacy explicit path preserves the old opt-in. The
		// diagnostic-profile resolver never SILENTLY auto-enables V in
		// public; the env var is the long-standing opt-in surface.
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
		).toEqual({ v: true, i: false, a: false, p: false })
	})

	it("C3: dogfood + no env + no path -> V/I/P partial; A off", () => {
		// A now lands via CANCEL-AFFORDANCE-AUTHORITY-RECON: identity-gated,
		// default-on in dogfood regardless of the V capture path. The
		// activity record is gated by the PTAD workspace toggle, NOT the V
		// path; the A knob only reports whether the diagnostic-profile
		// resolver would arm the probe. The capture sink itself still
		// requires the PTAD toggle to be enabled (which is identity-gated
		// and auto-arms in dogfood via CLINEMM_PTAD or the workspace flag).
		expect(resolveEffectiveDiagnosticKnobs({}, true, EMPTY_PATH)).toEqual({
			v: false,
			i: true,
			a: true,
			p: true,
		})
	})

	it("C4: dogfood + no env + auto path -> VIAP (canonical indicator, A landed)", () => {
		const knobs = resolveEffectiveDiagnosticKnobs({}, true, AUTO_PATH)
		expect(knobs).toEqual({ v: true, i: true, a: true, p: true })
		expect(formatEffectiveKnobLetters(knobs)).toBe("VIAP")
	})

	it("C5: dogfood + I=0 -> I forced OFF; A follows its own precedence", () => {
		const knobs = resolveEffectiveDiagnosticKnobs({ CLINEMM_DIAG_INPUT_SHAPE_V2: "0" }, true, AUTO_PATH)
		expect(knobs.i).toBe(false)
		expect(knobs.v).toBe(true)
		expect(knobs.a).toBe(true)
		expect(knobs.p).toBe(true)
	})

	it("C5b: dogfood + emitter-disabled path (null) -> V OFF (header mirrors writer)", () => {
		// V override-down (`CLINEMM_CAPTURE_V2_PATH=0`) is honored at
		// the EMITTER layer in v2-capture.ts. The resolver reflects
		// the writer's effective state: if the caller passes `null`
		// as the third argument, V=false (writer disabled). This
		// test verifies the resolver correctly mirrors an emitter
		// that has honored the override-down.
		const knobs = resolveEffectiveDiagnosticKnobs({ CLINEMM_CAPTURE_V2_PATH: "0" }, true, null)
		expect(knobs.v).toBe(false)
		expect(knobs.i).toBe(true)
		expect(knobs.a).toBe(true)
		expect(knobs.p).toBe(true)
	})

	it("C5c: dogfood + P=false -> P forced OFF; A follows its own precedence", () => {
		const knobs = resolveEffectiveDiagnosticKnobs({ CLINEMM_DIAG_APPROVAL_PUBLICATION_V2: "false" }, true, AUTO_PATH)
		expect(knobs.p).toBe(false)
		expect(knobs.v).toBe(true)
		expect(knobs.i).toBe(true)
		expect(knobs.a).toBe(true)
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

	it("C7: A is governed by dogfood + env precedence (LANDED by CANCEL-AFFORDANCE-AUTHORITY-RECON)", () => {
		// C7a: explicit-on "1" in dogfood -> A=true
		expect(
			resolveEffectiveDiagnosticKnobs({ CLINEMM_DIAG_ACTIVITY_STATE_V1: "1" }, true, AUTO_PATH).a,
		).toBe(true)
		// C7b: explicit-off "0" in dogfood -> A=false (override-down)
		expect(
			resolveEffectiveDiagnosticKnobs({ CLINEMM_DIAG_ACTIVITY_STATE_V1: "0" }, true, AUTO_PATH).a,
		).toBe(false)
		// C7c: no env var in dogfood -> A=true (auto-on, same as I/P)
		expect(resolveEffectiveDiagnosticKnobs({}, true, AUTO_PATH).a).toBe(true)
		// C7d: explicit-on in public -> A=false (no public product setting;
		// identity is the SOLE gate per ACT section 18 invariant)
		expect(
			resolveEffectiveDiagnosticKnobs({ CLINEMM_DIAG_ACTIVITY_STATE_V1: "1" }, false, EMPTY_PATH).a,
		).toBe(false)
		// C7e: garbage env value falls through to dogfood default
		expect(
			resolveEffectiveDiagnosticKnobs({ CLINEMM_DIAG_ACTIVITY_STATE_V1: "banana" }, true, AUTO_PATH).a,
		).toBe(true)
	})

	it("C8: empty-string env values fall through to default (A on in dogfood)", () => {
		const knobs = resolveEffectiveDiagnosticKnobs(
			{
				CLINEMM_CAPTURE_V2_PATH: "",
				CLINEMM_DIAG_INPUT_SHAPE_V2: "",
				CLINEMM_DIAG_APPROVAL_PUBLICATION_V2: "",
			},
			true,
			AUTO_PATH,
		)
		expect(knobs).toEqual({ v: true, i: true, a: true, p: true })
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

	it("'VIP' for the legacy pre-A dogfood initial render (frozen for historical-context)", () => {
		// This test pins the LEGACY header value (before A landed). The
		// current dogfood initial render is "VIAP"; see C4 above and the
		// "VIAP for the current canonical dogfood initial render" test.
		expect(formatEffectiveKnobLetters({ v: true, i: true, a: false, p: true })).toBe("VIP")
	})

	it("'VIAP' when A is ON (current canonical dogfood initial render)", () => {
		expect(formatEffectiveKnobLetters({ v: true, i: true, a: true, p: true })).toBe("VIAP")
	})

	it("'IAP' when V is overridden off in dogfood (A still ON)", () => {
		expect(formatEffectiveKnobLetters({ v: false, i: true, a: true, p: true })).toBe("IAP")
	})
})
