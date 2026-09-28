/**
 * ACT-MYC-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE01 — RED tests for the
 * M (myc-prime live diag) and R (provider-request capture) knobs of
 * the central dogfood diagnostic profile.
 *
 * EVIDENCE CLASSIFICATION: SYNTHETIC_REAL.
 *   The suite drives the REAL `resolveEffectiveMycPrimeLiveDiag` /
 *   `applyMycPrimeLiveDiagDiagnosticProfile` /
 *   `resolveEffectiveProviderRequestCapture` /
 *   `applyProviderRequestCaptureDiagnosticProfile` production
 *   resolvers and activation helpers, plus the REAL
 *   `setMycPrimeLiveDiagEnabled` module seam setter and the REAL
 *   `isMycPrimeLiveDiagEnabled` module seam getter.
 *
 *   The bounded env adapter (applyProviderRequestCaptureDiagnosticProfile)
 *   writes `process.env.CLINE_CAPTURE_*` and `process.env.CLINE_DATA_DIR`.
 *   Tests snapshot/restore the env around the call to keep state
 *   isolation honest.
 *
 * Tests covered (per ACT §25-§29):
 *   M1 (MDP-01) public + env absent          -> myc diag OFF
 *   M2 (MDP-02) dogfood + env absent         -> myc diag ON
 *   M3 (MDP-03) dogfood + explicit OFF       -> OFF
 *   M4 (MDP-04) public + explicit ON         -> ON (the legacy
 *                                              operator opt-in is
 *                                              preserved in either
 *                                              profile; matches the
 *                                              legacy ACT-03 contract
 *                                              that `=1` enables)
 *   M5 (MDP-05) garbage value                -> profile default
 *   M6 (MDP-06) activation applies resolved state to module seam
 *   M7 (MDP-07) activation is idempotent
 *   M8 (MDP-08) public default leaves singleton untouched on record attempt
 *
 *   R1 (MDP-09) public + capture env absent  -> provider capture off
 *   R2 (MDP-10) dogfood + capture env absent -> provider capture full
 *   R3 (MDP-11) dogfood + explicit off       -> off
 *   R4 (MDP-12) public + explicit full       -> full
 *   R5 (MDP-13) explicit summary             -> summary
 *   R6 (MDP-14) dogfood default              -> wire capture false
 *   R7 (MDP-15) explicit CLINE_CAPTURE_WIRE=true -> true
 *   R8 (MDP-16) dogfood capture root resolves outside repository
 *   R9 (MDP-17) cleanup default              -> on
 *   R10(MDP-18) explicit cleanup OFF         -> honored
 *
 *   AC1 (ACT §27) activation order: myc seam armed before provider
 *       capture effective config established before the recorder runs
 *   AC2 (ACT §28) public conservation: zero diagnostic state writes
 *       when public + no env
 *   AC3 (ACT §29) dogfood integration: full set of effective values
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	__resetMycPrimeLiveDiagDiagnosticProfileForTests,
	applyMycPrimeLiveDiagDiagnosticProfile,
	applyProviderRequestCaptureDiagnosticProfile,
	DOGFOOD_PROVIDER_CAPTURE_CLEANUP_DEFAULT,
	DOGFOOD_PROVIDER_CAPTURE_MODE_DEFAULT,
	DOGFOOD_PROVIDER_WIRE_CAPTURE_DEFAULT,
	resolveEffectiveMycPrimeLiveDiag,
	resolveEffectiveProviderRequestCapture,
} from "../dogfood-diagnostic-profile"
import {
	getMycPrimeLiveDiag,
	isMycPrimeLiveDiagEnabled,
	recordMycPrimeLiveAcquisition,
	setMycPrimeLiveDiagEnabled,
	startMycPrimeLiveDiag,
} from "../myc-prime-live-diag"

const ENV_KEYS = [
	"CLINEMM_MYC_PRIME_DIAG",
	"CLINE_CAPTURE_PROVIDER_REQUEST",
	"CLINE_CAPTURE_WIRE",
	"CLINE_CAPTURE_CLEANUP",
	"CLINE_CAPTURE_DIR",
	"CLINE_DATA_DIR",
	"CLINE_CAPTURE_MAX_PREVIEW_BYTES",
	"CLINEMM_RUNTIME_PROFILE",
] as const

function snapshotEnv(): Record<string, string | undefined> {
	const snap: Record<string, string | undefined> = {}
	for (const k of ENV_KEYS) {
		snap[k] = process.env[k]
	}
	return snap
}

function restoreEnv(snap: Record<string, string | undefined>): void {
	for (const k of ENV_KEYS) {
		if (snap[k] === undefined) {
			delete process.env[k]
		} else {
			process.env[k] = snap[k]
		}
	}
}

let tmpRoot = ""
const savedEnv = snapshotEnv()

beforeEach(() => {
	__resetMycPrimeLiveDiagDiagnosticProfileForTests()
	for (const k of ENV_KEYS) {
		delete process.env[k]
	}
	tmpRoot = mkdtempSync(join(tmpdir(), "clinemm-dp-myc01-"))
})

afterEach(() => {
	restoreEnv(savedEnv)
	__resetMycPrimeLiveDiagDiagnosticProfileForTests()
	if (tmpRoot) {
		rmSync(tmpRoot, { recursive: true, force: true })
	}
})

// ============================================================================
// M knob — myc prime live diagnostic precedence (MDP-01..MDP-05)
// ============================================================================

describe("MDP-01..MDP-05: resolveEffectiveMycPrimeLiveDiag precedence", () => {
	it("MDP-01: public + env absent -> OFF", () => {
		const r = resolveEffectiveMycPrimeLiveDiag({}, false)
		expect(r).toEqual({ enabled: false, source: "profile" })
	})

	it("MDP-02: dogfood + env absent -> ON (auto-on, the live-qual operator no longer needs the env)", () => {
		const r = resolveEffectiveMycPrimeLiveDiag({}, true)
		expect(r).toEqual({ enabled: true, source: "profile" })
	})

	it("MDP-03: dogfood + explicit OFF -> OFF (env override-down wins)", () => {
		for (const v of ["0", "off", "false"]) {
			const r = resolveEffectiveMycPrimeLiveDiag({ CLINEMM_MYC_PRIME_DIAG: v }, true)
			expect(r).toEqual({ enabled: false, source: "env" })
		}
	})

	it("MDP-04a: public + explicit ON -> ON (legacy ACT-03 opt-in preserved)", () => {
		for (const v of ["1", "true", "yes"]) {
			const r = resolveEffectiveMycPrimeLiveDiag({ CLINEMM_MYC_PRIME_DIAG: v }, false)
			expect(r).toEqual({ enabled: true, source: "env" })
		}
	})

	it("MDP-04b: dogfood + explicit ON -> ON (env override-up wins)", () => {
		const r = resolveEffectiveMycPrimeLiveDiag({ CLINEMM_MYC_PRIME_DIAG: "1" }, true)
		expect(r).toEqual({ enabled: true, source: "env" })
	})

	it("MDP-05: garbage value -> profile default", () => {
		const r = resolveEffectiveMycPrimeLiveDiag({ CLINEMM_MYC_PRIME_DIAG: "banana" }, true)
		expect(r).toEqual({ enabled: true, source: "profile" })
		const r2 = resolveEffectiveMycPrimeLiveDiag({ CLINEMM_MYC_PRIME_DIAG: "BANANA" }, false)
		expect(r2).toEqual({ enabled: false, source: "profile" })
	})
})

// ============================================================================
// M knob — activation applies resolved state to module seam (MDP-06, MDP-07)
// ============================================================================

describe("MDP-06..MDP-07: applyMycPrimeLiveDiagDiagnosticProfile activation", () => {
	it("MDP-06a: dogfood + env absent arms the module seam ON (one-shot)", () => {
		const result = applyMycPrimeLiveDiagDiagnosticProfile(true, {})
		expect(result).toEqual({ enabled: true, flipped: true })
		expect(isMycPrimeLiveDiagEnabled()).toBe(true)
	})

	it("MDP-06b: public + env absent arms the module seam OFF", () => {
		const result = applyMycPrimeLiveDiagDiagnosticProfile(false, {})
		expect(result).toEqual({ enabled: false, flipped: false })
		expect(isMycPrimeLiveDiagEnabled()).toBe(false)
	})

	it("MDP-06c: dogfood + explicit OFF overrides auto-on to OFF", () => {
		const result = applyMycPrimeLiveDiagDiagnosticProfile(true, { CLINEMM_MYC_PRIME_DIAG: "0" })
		expect(result).toEqual({ enabled: false, flipped: false })
		expect(isMycPrimeLiveDiagEnabled()).toBe(false)
	})

	it("MDP-07: activation is idempotent (calling twice with same state -> flipped=false on second call)", () => {
		const r1 = applyMycPrimeLiveDiagDiagnosticProfile(true, {})
		expect(r1.flipped).toBe(true)
		const r2 = applyMycPrimeLiveDiagDiagnosticProfile(true, {})
		expect(r2.flipped).toBe(false)
		expect(r2.enabled).toBe(true)
		expect(isMycPrimeLiveDiagEnabled()).toBe(true)
	})

	it("MDP-07b: flipping from ON to OFF is detected and applied", () => {
		applyMycPrimeLiveDiagDiagnosticProfile(true, {})
		expect(isMycPrimeLiveDiagEnabled()).toBe(true)
		const result = applyMycPrimeLiveDiagDiagnosticProfile(true, { CLINEMM_MYC_PRIME_DIAG: "0" })
		expect(result).toEqual({ enabled: false, flipped: true })
		expect(isMycPrimeLiveDiagEnabled()).toBe(false)
	})
})

// ============================================================================
// M knob — public default leaves singleton untouched (MDP-08)
// ============================================================================

describe("MDP-08: public default leaves the myc diag singleton untouched", () => {
	it("public + no env -> recorders are no-ops, no entries written", () => {
		applyMycPrimeLiveDiagDiagnosticProfile(false, {})
		startMycPrimeLiveDiag("hs-public")
		recordMycPrimeLiveAcquisition("hs-public", {
			attempted: true,
			serverDetected: true,
			status: "ok",
			textPresent: true,
			textBytes: 42,
			phase: "tool_call",
			sessionConnectionStatus: "spawned",
			toolFound: true,
		})
		expect(getMycPrimeLiveDiag("hs-public")).toBeUndefined()
	})
})

// ============================================================================
// R knob — provider-request capture precedence (MDP-09..MDP-13)
// ============================================================================

describe("MDP-09..MDP-13: resolveEffectiveProviderRequestCapture precedence", () => {
	it("MDP-09: public + capture env absent -> capture off (public default OFF)", () => {
		const r = resolveEffectiveProviderRequestCapture({}, false, null)
		expect(r.captureMode).toBe("off")
		expect(r.source.captureMode).toBe("profile")
	})

	it("MDP-10: dogfood + capture env absent -> capture full", () => {
		const r = resolveEffectiveProviderRequestCapture({}, true, tmpRoot)
		expect(r.captureMode).toBe(DOGFOOD_PROVIDER_CAPTURE_MODE_DEFAULT)
		expect(r.captureMode).toBe("full")
		expect(r.source.captureMode).toBe("profile")
	})

	it("MDP-11: dogfood + explicit off -> off (env override-down wins)", () => {
		const r = resolveEffectiveProviderRequestCapture({ CLINE_CAPTURE_PROVIDER_REQUEST: "off" }, true, tmpRoot)
		expect(r.captureMode).toBe("off")
		expect(r.source.captureMode).toBe("env")
	})

	it("MDP-12: public + explicit full -> full (operator opt-up honored)", () => {
		const r = resolveEffectiveProviderRequestCapture({ CLINE_CAPTURE_PROVIDER_REQUEST: "full" }, false, null)
		expect(r.captureMode).toBe("full")
		expect(r.source.captureMode).toBe("env")
	})

	it("MDP-13: explicit summary -> summary (both profiles)", () => {
		const r1 = resolveEffectiveProviderRequestCapture({ CLINE_CAPTURE_PROVIDER_REQUEST: "summary" }, false, null)
		expect(r1.captureMode).toBe("summary")
		expect(r1.source.captureMode).toBe("env")
		const r2 = resolveEffectiveProviderRequestCapture({ CLINE_CAPTURE_PROVIDER_REQUEST: "summary" }, true, tmpRoot)
		expect(r2.captureMode).toBe("summary")
		expect(r2.source.captureMode).toBe("env")
	})

	it("MDP-NEG-1: garbage capture env -> profile default", () => {
		const r = resolveEffectiveProviderRequestCapture({ CLINE_CAPTURE_PROVIDER_REQUEST: "banana" }, true, tmpRoot)
		expect(r.captureMode).toBe("full")
		expect(r.source.captureMode).toBe("profile")
	})
})

// ============================================================================
// R knob — wire capture default and override (MDP-14, MDP-15)
// ============================================================================

describe("MDP-14..MDP-15: wire capture", () => {
	it("MDP-14: dogfood default -> wire capture false (matches DOGFOOD_PROVIDER_WIRE_CAPTURE_DEFAULT)", () => {
		const r = resolveEffectiveProviderRequestCapture({}, true, tmpRoot)
		expect(r.wireCapture).toBe(DOGFOOD_PROVIDER_WIRE_CAPTURE_DEFAULT)
		expect(r.wireCapture).toBe(false)
		expect(r.source.wireCapture).toBe("profile")
	})

	it("MDP-15a: explicit CLINE_CAPTURE_WIRE=true -> true", () => {
		const r = resolveEffectiveProviderRequestCapture({ CLINE_CAPTURE_WIRE: "true" }, true, tmpRoot)
		expect(r.wireCapture).toBe(true)
		expect(r.source.wireCapture).toBe("env")
	})

	it("MDP-15b: explicit CLINE_CAPTURE_WIRE=1 -> true", () => {
		const r = resolveEffectiveProviderRequestCapture({ CLINE_CAPTURE_WIRE: "1" }, true, tmpRoot)
		expect(r.wireCapture).toBe(true)
		expect(r.source.wireCapture).toBe("env")
	})

	it("MDP-15c: explicit CLINE_CAPTURE_WIRE=false -> false", () => {
		const r = resolveEffectiveProviderRequestCapture({ CLINE_CAPTURE_WIRE: "false" }, true, tmpRoot)
		expect(r.wireCapture).toBe(false)
		expect(r.source.wireCapture).toBe("env")
	})

	it("MDP-15d: garbage CLINE_CAPTURE_WIRE -> profile default", () => {
		const r = resolveEffectiveProviderRequestCapture({ CLINE_CAPTURE_WIRE: "banana" }, true, tmpRoot)
		expect(r.wireCapture).toBe(DOGFOOD_PROVIDER_WIRE_CAPTURE_DEFAULT)
		expect(r.source.wireCapture).toBe("profile")
	})
})

// ============================================================================
// R knob — capture root resolution (MDP-16)
// ============================================================================

describe("MDP-16: capture root resolves outside repository", () => {
	it("dogfood + dataDir -> dataDir binding is set", () => {
		const r = resolveEffectiveProviderRequestCapture({}, true, tmpRoot)
		expect(r.dataDir).toBe(tmpRoot)
	})

	it("public + dataDir -> dataDir binding is null (we do NOT inject in public)", () => {
		const r = resolveEffectiveProviderRequestCapture({}, false, tmpRoot)
		expect(r.dataDir).toBeNull()
	})

	it("dogfood + empty dataDir -> dataDir binding is null", () => {
		const r = resolveEffectiveProviderRequestCapture({}, true, "")
		expect(r.dataDir).toBeNull()
	})

	it("tmpRoot does NOT equal the forbidden /tmp/clinemm-live04-capture sentinel", () => {
		const r = resolveEffectiveProviderRequestCapture({}, true, tmpRoot)
		expect(r.dataDir).not.toBe("/tmp/clinemm-live04-capture")
		expect(r.dataDir).toBe(tmpRoot)
	})
})

// ============================================================================
// R knob — cleanup default and override (MDP-17, MDP-18)
// ============================================================================

describe("MDP-17..MDP-18: cleanup", () => {
	it("MDP-17: dogfood default -> cleanup on (DOGFOOD_PROVIDER_CAPTURE_CLEANUP_DEFAULT)", () => {
		const r = resolveEffectiveProviderRequestCapture({}, true, tmpRoot)
		expect(r.cleanup).toBe(DOGFOOD_PROVIDER_CAPTURE_CLEANUP_DEFAULT)
		expect(r.cleanup).toBe("on")
		expect(r.source.cleanup).toBe("profile")
	})

	it("MDP-17b: public default -> cleanup on", () => {
		const r = resolveEffectiveProviderRequestCapture({}, false, null)
		expect(r.cleanup).toBe("on")
	})

	it("MDP-18: explicit CLINE_CAPTURE_CLEANUP=off -> cleanup off (env wins)", () => {
		const r = resolveEffectiveProviderRequestCapture({ CLINE_CAPTURE_CLEANUP: "off" }, true, tmpRoot)
		expect(r.cleanup).toBe("off")
		expect(r.source.cleanup).toBe("env")
	})

	it("MDP-18b: explicit CLINE_CAPTURE_CLEANUP=on -> cleanup on (no-op profile default)", () => {
		const r = resolveEffectiveProviderRequestCapture({ CLINE_CAPTURE_CLEANUP: "on" }, true, tmpRoot)
		expect(r.cleanup).toBe("on")
	})
})

// ============================================================================
// R knob — applyProviderRequestCaptureDiagnosticProfile activation
// ============================================================================

describe("applyProviderRequestCaptureDiagnosticProfile activation", () => {
	it("writes the EFFECTIVE values to process.env ONCE (dogfood default)", () => {
		const result = applyProviderRequestCaptureDiagnosticProfile(true, {}, tmpRoot)
		expect(result.captureMode).toBe("full")
		expect(result.wireCapture).toBe(false)
		expect(result.cleanup).toBe("on")
		expect(result.dataDir).toBe(tmpRoot)
		expect(result.flipped).toBe(true)
		// Bounded env adapter policy: only the values that differ from
		// upstream defaults are written. CLINE_CAPTURE_WIRE and
		// CLINE_CAPTURE_CLEANUP stay unset because their upstream
		// defaults already match the resolved dogfood values (false
		// and "on" respectively).
		expect(process.env.CLINE_CAPTURE_PROVIDER_REQUEST).toBe("full")
		expect(process.env.CLINE_CAPTURE_WIRE).toBeUndefined()
		expect(process.env.CLINE_CAPTURE_CLEANUP).toBeUndefined()
		expect(process.env.CLINE_DATA_DIR).toBe(tmpRoot)
	})

	it("public default leaves process.env untouched (no auto-injection)", () => {
		const result = applyProviderRequestCaptureDiagnosticProfile(false, {}, tmpRoot)
		expect(result.captureMode).toBe("off")
		expect(result.dataDir).toBeNull()
		expect(result.flipped).toBe(false)
		expect(process.env.CLINE_CAPTURE_PROVIDER_REQUEST).toBeUndefined()
		expect(process.env.CLINE_CAPTURE_WIRE).toBeUndefined()
		expect(process.env.CLINE_CAPTURE_CLEANUP).toBeUndefined()
		expect(process.env.CLINE_DATA_DIR).toBeUndefined()
	})

	it("operator-explicit values WIN over the profile default (helper does NOT mutate operator-set vars)", () => {
		process.env.CLINE_CAPTURE_PROVIDER_REQUEST = "summary"
		process.env.CLINE_CAPTURE_WIRE = "true"
		process.env.CLINE_CAPTURE_CLEANUP = "off"
		const result = applyProviderRequestCaptureDiagnosticProfile(
			true,
			{
				CLINE_CAPTURE_PROVIDER_REQUEST: "summary",
				CLINE_CAPTURE_WIRE: "true",
				CLINE_CAPTURE_CLEANUP: "off",
			},
			tmpRoot,
		)
		// Resolver respects operator values; helper does not overwrite them.
		expect(result.captureMode).toBe("summary")
		expect(result.wireCapture).toBe(true)
		expect(result.cleanup).toBe("off")
		expect(process.env.CLINE_CAPTURE_PROVIDER_REQUEST).toBe("summary")
		expect(process.env.CLINE_CAPTURE_WIRE).toBe("true")
		expect(process.env.CLINE_CAPTURE_CLEANUP).toBe("off")
		// CLINE_DATA_DIR IS still set (operator did not set it).
		expect(process.env.CLINE_DATA_DIR).toBe(tmpRoot)
	})

	it("activation is idempotent (flipped=false on second call when state already matches)", () => {
		const r1 = applyProviderRequestCaptureDiagnosticProfile(true, {}, tmpRoot)
		expect(r1.flipped).toBe(true)
		const r2 = applyProviderRequestCaptureDiagnosticProfile(true, {}, tmpRoot)
		expect(r2.flipped).toBe(false)
		expect(r2.captureMode).toBe("full")
	})
})

// ============================================================================
// Activation ordering (ACT §27)
// ============================================================================

describe("AC1: activation order — myc seam armed BEFORE provider capture effective config BEFORE recorder runs", () => {
	it("drives the real activation helpers in the production-declared order", () => {
		const myc = applyMycPrimeLiveDiagDiagnosticProfile(true, {})
		expect(myc.enabled).toBe(true)
		expect(isMycPrimeLiveDiagEnabled()).toBe(true)

		const cap = applyProviderRequestCaptureDiagnosticProfile(true, {}, tmpRoot)
		expect(cap.captureMode).toBe("full")
		expect(process.env.CLINE_CAPTURE_PROVIDER_REQUEST).toBe("full")

		startMycPrimeLiveDiag("hs-order")
		expect(getMycPrimeLiveDiag("hs-order")).toBeDefined()
	})
})

// ============================================================================
// Public conservation (ACT §28)
// ============================================================================

describe("AC2: public conservation — zero diagnostic state when public + no env", () => {
	it("public + env absent leaves the myc module seam OFF and the provider capture mode OFF", () => {
		applyMycPrimeLiveDiagDiagnosticProfile(false, {})
		applyProviderRequestCaptureDiagnosticProfile(false, {}, tmpRoot)
		expect(isMycPrimeLiveDiagEnabled()).toBe(false)
		expect(process.env.CLINE_CAPTURE_PROVIDER_REQUEST).toBeUndefined()
		expect(process.env.CLINE_CAPTURE_WIRE).toBeUndefined()
		expect(process.env.CLINE_CAPTURE_CLEANUP).toBeUndefined()
		expect(process.env.CLINE_DATA_DIR).toBeUndefined()
		startMycPrimeLiveDiag("hs-pub")
		expect(getMycPrimeLiveDiag("hs-pub")).toBeUndefined()
	})
})

// ============================================================================
// Dogfood integration (ACT §29)
// ============================================================================

describe("AC3: dogfood integration — full set of effective values", () => {
	it("dogfood + env absent -> myc ON, capture full, wire false, cleanup on, dataDir set", () => {
		const myc = applyMycPrimeLiveDiagDiagnosticProfile(true, {})
		const cap = applyProviderRequestCaptureDiagnosticProfile(true, {}, tmpRoot)
		expect(myc.enabled).toBe(true)
		expect(cap.captureMode).toBe("full")
		expect(cap.wireCapture).toBe(false)
		expect(cap.cleanup).toBe("on")
		expect(cap.dataDir).toBe(tmpRoot)
	})
})

// ============================================================================
// Imports sanity
// ============================================================================

describe("imports sanity", () => {
	it("setMycPrimeLiveDiagEnabled is exported from myc-prime-live-diag and armable directly", () => {
		setMycPrimeLiveDiagEnabled(true)
		expect(isMycPrimeLiveDiagEnabled()).toBe(true)
		setMycPrimeLiveDiagEnabled(false)
		expect(isMycPrimeLiveDiagEnabled()).toBe(false)
	})
})
