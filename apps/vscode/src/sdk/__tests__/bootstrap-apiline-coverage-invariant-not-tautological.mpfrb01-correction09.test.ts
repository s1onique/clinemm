/**
 * ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / CORRECTION09
 *
 * Negative discriminator for the new apiLine coverage invariant
 * (HALT_MINIMAX_APILINE_NOT_CAPTURED).
 *
 * Reviewer panel on the CORRECTION08 commit flagged P1
 * BOOTSTRAP_APILINE_COVERAGE_INVARIANT_TAUTOLOGICAL:
 *
 *   const apiLineRequired = apiLineResolved  // <- tautology
 *
 * If resolveApiLine regresses tomorrow and returns undefined
 * for minimax, both sides of the guard would be false, and
 * ok=true would still be reported -- defeating the entire
 * purpose of the invariant.
 *
 * This file is the bounded fix-and-discriminator: it stubs
 * resolveApiLine so that it returns undefined for minimax,
 * and asserts that the invariant returns ok=false with
 * apiLineRequired=true && apiLineResolved=false on the
 * minimax diagnostic.
 *
 * The fix to bootstrap-coverage-invariants.ts is in
 * PRODUCTION: apiLineRequired is now derived from
 * PROVIDER_APILINE_FIELD (the authority that declares "this
 * provider OWNS an apiLine legacy field"), NOT from
 * apiLineResolved.
 *
 * Run via:
 *   cd apps/vscode && TMPDIR=/tmp bun test \
 *     src/sdk/__tests__/bootstrap-apiline-coverage-invariant-not-tautological.mpfrb01-correction09.test.ts
 */

import { describe, expect, it, mock } from "bun:test"
import * as actualSessionFactory from "../cline-session-factory"

// mock.module must be registered BEFORE the SUT is imported.
// The SUT (bootstrap-coverage-invariants.ts) imports the
// cline-session-factory via the relative specifier
// "../cline-session-factory" -- but module resolution at
// import time resolves that to the absolute path of the
// file. Bun's mock.module works with both the relative
// specifier and the absolute resolved path; covering both
// is the safest bet for cross-version behavior.
mock.module("../cline-session-factory", () => ({
	...actualSessionFactory,
	resolveApiLine: () => undefined,
}))

const { assertBootstrapCoverageIsWellFormed } = await import("../profile-store/bootstrap-coverage-invariants")

describe("MPFRB01_C09_NEGATIVE_DISCRIMINATOR: apiLine coverage invariant is not tautological", () => {
	it("reports ok=false when resolveApiLine regresses to undefined for minimax", () => {
		const result = assertBootstrapCoverageIsWellFormed()
		expect(result.ok).toBe(false)

		const minimaxDiag = result.diagnostics.find((d) => d.provider === "minimax")
		expect(minimaxDiag).toBeDefined()
		// The invariant must observe apiLineRequired=true (because
		// minimax is in PROVIDER_APILINE_FIELD) AND apiLineResolved=false
		// (because the stubbed resolver returns undefined). The
		// (apiLineRequired && !apiLineResolved) clause must fire.
		expect(minimaxDiag?.apiLineRequired).toBe(true)
		expect(minimaxDiag?.apiLineResolved).toBe(false)
	})
})
