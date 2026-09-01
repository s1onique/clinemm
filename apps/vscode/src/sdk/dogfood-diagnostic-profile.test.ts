/**
 * ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01 -
 * closed-runtime diagnostic-profile resolver tests.
 */

import { describe, expect, it } from "vitest"
import {
	composeEffectiveDiagnosticKnobs,
	formatEffectiveKnobLetters,
	resolveEffectiveDiagnosticKnobs,
	resolveEffectiveTurnStateWriterProvenanceD,
} from "./dogfood-diagnostic-profile"

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
		// D is OFF in public (identity is the SOLE gate; explicit ON
		// env vars are dropped on the public path per the C2 invariant).
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

	it("C3: dogfood + no env + no path -> V/I/A/P (V/I/A/P only; D has its own resolver)", () => {
		// A now lands via CANCEL-AFFORDANCE-AUTHORITY-RECON: identity-gated,
		// default-on in dogfood regardless of the V capture path. The
		// activity record is gated by the PTAD workspace toggle, NOT the V
		// path; the A knob only reports whether the diagnostic-profile
		// resolver would arm the probe. The capture sink itself still
		// requires the PTAD toggle to be enabled (which is identity-gated
		// and auto-arms in dogfood via CLINEMM_PTAD or the workspace flag).
		// ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-DIAGNOSABILITY01: D is
		// identity-gated, default-on in dogfood; follows the same
		// precedence as I, A, P.
		expect(resolveEffectiveDiagnosticKnobs({}, true, EMPTY_PATH)).toEqual({
			v: false,
			i: true,
			a: true,
			p: true,
		})
	})

	it("C4: dogfood + no env + auto path -> VIAPD (canonical indicator, D landed)", () => {
		const knobs = composeEffectiveDiagnosticKnobs({}, true, AUTO_PATH, null)
		expect(knobs).toEqual({ v: true, i: true, a: true, p: true, d: true })
		expect(formatEffectiveKnobLetters(knobs)).toBe("VIAPD")
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

	it("C8: empty-string env values fall through to default (V/I/A/P on in dogfood)", () => {
		const knobs = resolveEffectiveDiagnosticKnobs(
			{
				CLINEMM_CAPTURE_V2_PATH: "",
				CLINEMM_DIAG_INPUT_SHAPE_V2: "",
				CLINEMM_DIAG_APPROVAL_PUBLICATION_V2: "",
				CLINEMM_DIAG_TURNSTATE_WRITER_PROVENANCE: "",
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

// ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-DIAGNOSABILITY01 (Round 2 fix):
// D precedence tests now exercise the SOLE D-knob authority
// (resolveEffectiveTurnStateWriterProvenanceD). The raw
// resolveEffectiveDiagnosticKnobs D field was REMOVED — it no
// longer encodes D, so the D1..D6/D9 tests are obsolete and
// were deleted. The D precedence is fully pinned by the
// activation-seam test file (AC8) for completeness.
describe("resolveEffectiveTurnStateWriterProvenanceD (Round 2)", () => {
	it("public + env=1 + no workspace -> d=true (env override-up honored in public)", () => {
		const r = resolveEffectiveTurnStateWriterProvenanceD({ CLINEMM_DIAG_TURNSTATE_WRITER_PROVENANCE: "1" }, false, undefined)
		expect(r).toEqual({ d: true, source: "env" })
	})
	it("public + env=0 + no workspace -> d=false (env override-down)", () => {
		const r = resolveEffectiveTurnStateWriterProvenanceD({ CLINEMM_DIAG_TURNSTATE_WRITER_PROVENANCE: "0" }, false, undefined)
		expect(r).toEqual({ d: false, source: "env" })
	})
	it("public + env garbage + workspace=true -> d=true (workspace beats profile default)", () => {
		const r = resolveEffectiveTurnStateWriterProvenanceD({ CLINEMM_DIAG_TURNSTATE_WRITER_PROVENANCE: "banana" }, false, true)
		expect(r).toEqual({ d: true, source: "workspace" })
	})
	it("dogfood + env garbage + workspace=false -> d=false (workspace override-down in dogfood)", () => {
		const r = resolveEffectiveTurnStateWriterProvenanceD({ CLINEMM_DIAG_TURNSTATE_WRITER_PROVENANCE: "banana" }, true, false)
		expect(r).toEqual({ d: false, source: "workspace" })
	})
	it("dogfood + no env + no workspace -> d=true (profile default ON)", () => {
		const r = resolveEffectiveTurnStateWriterProvenanceD({}, true, undefined)
		expect(r).toEqual({ d: true, source: "profile" })
	})
	it("public + no env + no workspace -> d=false (profile default OFF)", () => {
		const r = resolveEffectiveTurnStateWriterProvenanceD({}, false, undefined)
		expect(r).toEqual({ d: false, source: "profile" })
	})
})

describe("formatEffectiveKnobLetters", () => {
	it("empty string when all OFF", () => {
		expect(formatEffectiveKnobLetters({ v: false, i: false, a: false, p: false, d: false })).toBe("")
	})

	it("'V' when only V is ON", () => {
		expect(formatEffectiveKnobLetters({ v: true, i: false, a: false, p: false, d: false })).toBe("V")
	})

	it("'VIP' for the legacy pre-A dogfood initial render (frozen for historical-context)", () => {
		// This test pins the LEGACY header value (before A landed). The
		// current dogfood initial render is "VIAPD"; see C4 above and the
		// "VIAPD for the current canonical dogfood initial render" test.
		// D is OFF here (pre-D historical value); the formatter therefore
		// returns "VIP", not "VIPD".
		expect(formatEffectiveKnobLetters({ v: true, i: true, a: false, p: true, d: false })).toBe("VIP")
	})

	it("'VIAP' when A is ON but D is OFF (pre-D canonical dogfood initial render)", () => {
		// ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-DIAGNOSABILITY01: D
		// is OFF in the historical pre-D canonical render. The D8
		// test pins the "VIAP" render so the post-D canonical
		// "VIAPD" does not silently invalidate prior dumps.
		expect(formatEffectiveKnobLetters({ v: true, i: true, a: true, p: true, d: false })).toBe("VIAP")
	})

	it("'VIAPD' when D is ON (current canonical dogfood initial render, D landed)", () => {
		expect(formatEffectiveKnobLetters({ v: true, i: true, a: true, p: true, d: true })).toBe("VIAPD")
	})

	it("'IAPD' when V is overridden off in dogfood (A still ON, D still ON)", () => {
		expect(formatEffectiveKnobLetters({ v: false, i: true, a: true, p: true, d: true })).toBe("IAPD")
	})

	it("'IAP' when V is overridden off AND D is overridden off in dogfood (no D in render)", () => {
		expect(formatEffectiveKnobLetters({ v: false, i: true, a: true, p: true, d: false })).toBe("IAP")
	})
})
