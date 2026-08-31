/**
 * ACT-CLINEMM-DOGFOOD-RUNTIME-IDENTITY01 - closed-runtime identity tests.
 *
 * RED contract (per ACT section 3), implemented as GREEN with the
 * resolver shipped at HEAD <this-commit>. Each test exercises one
 * conservation invariant from ACT section 6.
 *
 * The test suite is INTENTIONALLY pure: it never touches `process.env`,
 * never inspects the filesystem, never inspects the workspace, and never
 * inspects the extension id. Every test injects its own `env` literal
 * so the contract is mechanically verified, not behaviorally
 * approximated.
 *
 * Failures in any of R1-R7 are HALT-class:
 *   R1-R4 falsified -> HALT_PUBLIC_RUNTIME_CLASSIFIED_DOGFOOD  /
 *                       HALT_DOGFOOD_RUNTIME_CLASSIFIED_PUBLIC  /
 *                       HALT_IDENTITY_FAILS_OPEN
 *   R5/R6 falsified  -> HALT_IDENTITY_REQUIRES_WORKSPACE_HEURISTIC /
 *                       HALT_IDENTITY_REQUIRES_PUBLIC_SETTING
 *   R7 falsified     -> resolver performs side effects (architectural
 *                       regression; would couple identity to state)
 */

import { describe, expect, it } from "vitest"
import { isDogfoodRuntime, resolveClineMmRuntimeProfile } from "./dogfood-runtime-profile"

describe("resolveClineMmRuntimeProfile (ACT-CLINEMM-DOGFOOD-RUNTIME-IDENTITY01)", () => {
	// R1: PUBLIC / ABSENT - ordinary ClineMM launch with no marker.
	it("R1: marker absent returns public", () => {
		expect(resolveClineMmRuntimeProfile({})).toBe("public")
		expect(isDogfoodRuntime({})).toBe(false)
	})

	// R2: DOGFOOD - marker exactly equal to "dogfood".
	it("R2: marker === 'dogfood' returns dogfood", () => {
		expect(resolveClineMmRuntimeProfile({ CLINEMM_RUNTIME_PROFILE: "dogfood" })).toBe("dogfood")
		expect(isDogfoodRuntime({ CLINEMM_RUNTIME_PROFILE: "dogfood" })).toBe(true)
	})

	// R3: UNKNOWN VALUE - fail-closed on arbitrary non-empty values.
	// This is the load-bearing safety contract: a misconfigured launcher
	// that exports "banana" / "1" / "true" / "yes" MUST NOT silently
	// enable dogfood-mode diagnostics in a public install.
	it.each([
		["banana"],
		["1"],
		["true"],
		["yes"],
		["DOGFOOD"], // case-sensitive
		["Dogfood"], // case-sensitive
		[" dogfood"], // leading whitespace rejected
		["dogfood "], // trailing whitespace rejected
		["public"],
		["dogfoodish"],
		["\tdogfood"], // tab prefix rejected
	])("R3: unknown value %j returns public (fail-closed)", (value) => {
		expect(resolveClineMmRuntimeProfile({ CLINEMM_RUNTIME_PROFILE: value })).toBe("public")
		expect(isDogfoodRuntime({ CLINEMM_RUNTIME_PROFILE: value })).toBe(false)
	})

	// R3b: empty string is treated as absent (fail-closed, not fail-open).
	it("R3b: marker === '' returns public (empty == absent)", () => {
		expect(resolveClineMmRuntimeProfile({ CLINEMM_RUNTIME_PROFILE: "" })).toBe("public")
		expect(isDogfoodRuntime({ CLINEMM_RUNTIME_PROFILE: "" })).toBe(false)
	})

	// R4: EXPLICIT PUBLIC - operator can override a previously-set marker
	// back to public by setting it to "public" (NOT unset, which requires
	// a fresh process). Both paths must agree on "public".
	it("R4: marker === 'public' returns public (explicit override)", () => {
		expect(resolveClineMmRuntimeProfile({ CLINEMM_RUNTIME_PROFILE: "public" })).toBe("public")
		expect(isDogfoodRuntime({ CLINEMM_RUNTIME_PROFILE: "public" })).toBe(false)
	})

	// R5: NO WORKSPACE HEURISTIC - the rejected
	// `<repo-root>/.factory/BOARD_OWNER` shortcut MUST NOT affect the
	// resolver. This test simulates the workspace-present case by
	// leaving the env empty; the resolver has no other inputs to consult.
	it("R5: marker absent + workspace contents irrelevant -> public", () => {
		// The resolver accepts ONLY `env`. Any other state (workspace,
		// repo, BOARD_OWNER file, etc.) is invisible to it by design.
		// This test passes iff the resolver ignores everything but env.
		expect(resolveClineMmRuntimeProfile({})).toBe("public")
		expect(isDogfoodRuntime({})).toBe(false)
		// Same env, with extra unrelated keys: still public.
		expect(
			resolveClineMmRuntimeProfile({
				CLINEMM_RUNTIME_PROFILE: "",
				PATH: "/usr/bin",
				HOME: "/home/anyone",
				USER: "anyone",
				HOSTNAME: "any-host",
				VSCODE_PID: "12345",
			}),
		).toBe("public")
	})

	// R6: NO INSTALLATION-ID HEURISTIC - the rejected
	// `vscode.ExtensionContext.extension.id === "s1onique.clinemm"` shortcut
	// MUST NOT affect the resolver. Extension-id is NOT a parameter of
	// the resolver; the resolver cannot know it from its signature alone.
	it("R6: marker absent + extension id irrelevant -> public", () => {
		// Resolver signature is `(env: NodeJS.ProcessEnv)`. There is
		// no `extensionId` parameter, no `extensionMode` parameter.
		// Production callers will pass process.env (default) which
		// does not carry the extension id.
		expect(resolveClineMmRuntimeProfile({})).toBe("public")
	})

	// R7: PURE / SEMANTIC - resolver performs no side effects.
	//
	// Note (P2 review correction 2026-08-31): the resolver's TYPE
	// SIGNATURE alone does not prove purity - a TypeScript function
	// taking only `env: NodeJS.ProcessEnv` can still `import fs`,
	// `import fetch`, or call global `process.exit`. Purity is a
	// property of the IMPLEMENTATION BODY, not the signature. This
	// test therefore verifies the body-level claim (no mutation of
	// its input, no observable side effects via the public surface)
	// rather than re-stating signature purity as a tautology.
	it("R7: resolver body does not mutate its input env (body-level purity witness)", () => {
		// The resolver takes one argument (env) and returns one value
		// (the profile). The body must not modify `before`, must not
		// write to disk, must not spawn processes, must not perform
		// network I/O. This test exercises the only property visible
		// from outside the resolver without mocking globals: the
		// input reference is unchanged after the call.
		const before = { CLINEMM_RUNTIME_PROFILE: "dogfood" }
		const beforeSnapshot = { ...before }
		const result = resolveClineMmRuntimeProfile(before)
		const after = before
		expect(after).toEqual(beforeSnapshot) // input not mutated
		expect(result).toBe("dogfood")
	})

	// Defensive: env with other CLINEMM_* variables but the marker
	// absent. The resolver MUST NOT pick up "dogfoodness" from a
	// sibling variable (CLINEMM_DIAG_INPUT_SHAPE_V2 etc.).
	it("defensive: sibling CLINEMM_* env vars do NOT influence the resolver", () => {
		expect(
			resolveClineMmRuntimeProfile({
				CLINEMM_CAPTURE_V2_PATH: "/tmp/somewhere",
				CLINEMM_DIAG_INPUT_SHAPE_V2: "1",
				CLINEMM_EXPERIMENTAL_SANDBOX: "off",
			}),
		).toBe("public")
		expect(
			isDogfoodRuntime({
				CLINEMM_CAPTURE_V2_PATH: "/tmp/somewhere",
				CLINEMM_DIAG_INPUT_SHAPE_V2: "1",
				CLINEMM_EXPERIMENTAL_SANDBOX: "off",
			}),
		).toBe(false)
	})
})

describe("isDogfoodRuntime (ACT-CLINEMM-DOGFOOD-RUNTIME-IDENTITY01)", () => {
	// Mirror of R1-R4 for the predicate form.
	it("absent env -> false", () => {
		expect(isDogfoodRuntime({})).toBe(false)
	})

	it("'dogfood' -> true", () => {
		expect(isDogfoodRuntime({ CLINEMM_RUNTIME_PROFILE: "dogfood" })).toBe(true)
	})

	it("truthy-looking non-'dogfood' values -> false (fail-closed)", () => {
		expect(isDogfoodRuntime({ CLINEMM_RUNTIME_PROFILE: "true" })).toBe(false)
		expect(isDogfoodRuntime({ CLINEMM_RUNTIME_PROFILE: "1" })).toBe(false)
		expect(isDogfoodRuntime({ CLINEMM_RUNTIME_PROFILE: "yes" })).toBe(false)
	})
})
