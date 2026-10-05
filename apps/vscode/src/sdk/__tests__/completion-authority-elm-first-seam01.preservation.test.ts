/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01
 *
 * Source-preservation tests. These lock the bounded authority-seam
 * wiring so it cannot be silently removed in a future refactor.
 *
 * Per ACT §20 "Repository / factory discipline": maximum one
 * review/fix cycle; the architecture must not regress.
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// Resolve the repo root relative to this test file (portable across worktrees / operator machines).
// File: apps/vscode/src/sdk/__tests__/<this>.ts → 5 levels up reaches the monorepo root.
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, "..", "..", "..", "..", "..")
const COORDINATOR_PATH = join(REPO_ROOT, "apps/vscode/src/sdk/sdk-session-event-coordinator.ts")
const AUTHORITY_MODULE_PATH = join(REPO_ROOT, "apps/vscode/src/sdk/completion-authority-elm-authority.ts")

describe("ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01 — source preservation", () => {
	it("EAS01-PRES-01: authority module exists and exports the closed discriminated union", () => {
		const source = readFileSync(AUTHORITY_MODULE_PATH, "utf8")
		expect(source).toMatch(/export\s+type\s+ElmCompletionAuthorityDecision\s*=/)
		expect(source).toMatch(/kind:\s*"authorize"/)
		expect(source).toMatch(/kind:\s*"hold"/)
		expect(source).toMatch(/kind:\s*"failure"/)
	})

	it("EAS01-PRES-02: authority module exports the closed discriminated union (no default-Authorize fallback)", () => {
		// ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY:
		// the legacy silent default-Authorize fallback (which used to
		// return kind=authorize unconditionally) has been DELETED. The
		// module now exports only the closed discriminated union type.
		// The failure classification must include elm_authority_unavailable
		// so a missing runtime is fail-closed.
		const source = readFileSync(AUTHORITY_MODULE_PATH, "utf8")
		expect(source).not.toMatch(/defaultGetElmCompletionAuthorityDecision/)
		expect(source).not.toMatch(/defaultElmCompletionAuthorityDecision/)
		expect(source).toMatch(/elm_authority_unavailable/)
	})

	it("EAS01-PRES-03: coordinator imports the authority decision type", () => {
		const source = readFileSync(COORDINATOR_PATH, "utf8")
		expect(source).toMatch(/from\s+["']\.\/completion-authority-elm-authority["']/)
		expect(source).toMatch(/ElmCompletionAuthorityDecision/)
	})

	it("EAS01-PRES-04: coordinator constructor option is REQUIRED (no optional, no default fallback)", () => {
		// ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY:
		// the `getElmCompletionAuthorityDecision` option is REQUIRED
		// (no `?` in the type declaration) and has NO `??` fallback
		// in the constructor. There is no silent default-Authorize.
		const source = readFileSync(COORDINATOR_PATH, "utf8")
		// Option declared on the options interface (no `?`)
		expect(source).toMatch(/getElmCompletionAuthorityDecision:\s*\(sessionId\?: string\)/)
		// Option captured into the class private field
		expect(source).toMatch(/private\s+readonly\s+getElmCompletionAuthorityDecision:/)
		// Option captured in constructor (NO `??` fallback to a
		// silent default-Authorize provider — that provider has been
		// deleted)
		expect(source).toMatch(/this\.getElmCompletionAuthorityDecision\s*=\s*options\.getElmCompletionAuthorityDecision\b/)
		expect(source).not.toMatch(/options\.getElmCompletionAuthorityDecision\s*\?\?/)
	})

	it("EAS01-PRES-05: coordinator consults Elm authority at BOTH commit-effect sites", () => {
		const source = readFileSync(COORDINATOR_PATH, "utf8")
		// Site 1: deferred-completion re-entry
		expect(source).toMatch(/checkElmCompletionAuthority\(["']session-event-turn-complete-completed["']\)/)
		// The Elm check MUST appear at least twice (once at each site).
		const matches = source.match(/checkElmCompletionAuthority\(["']session-event-turn-complete-completed["']\)/g)
		expect(matches?.length).toBeGreaterThanOrEqual(2)
	})

	it("EAS01-PRES-06: helper is fail-closed on Elm failure (no silent TS fallback)", () => {
		const source = readFileSync(COORDINATOR_PATH, "utf8")
		expect(source).toMatch(/no silent TS fallback/i)
		// The helper surfaces the bounded classification when Elm reports failure.
		expect(source).toMatch(/Elm completion-authority returned FAILURE/)
		expect(source).toMatch(/classification=\${decision\.classification}/)
	})
})
