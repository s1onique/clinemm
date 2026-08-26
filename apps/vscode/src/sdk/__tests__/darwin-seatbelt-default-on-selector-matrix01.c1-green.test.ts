/**
 * ACT-CLINEMM-SEATBELT-DEFAULT-ON01 — selector unit matrix (D1..D10).
 *
 * Pins the new `resolveExperimentalSandboxMode()` contract end-to-end.
 *
 * Test matrix (from the ACT plan §6):
 *
 *   D1  Darwin + unset           → "seatbelt-experimental"  (secure default)
 *   D2  Darwin + "" (empty)      → "seatbelt-experimental"  (secure default)
 *   D3  Darwin + "seatbelt"      → "seatbelt-experimental"  (explicit / legacy)
 *   D4  Darwin + "off"           → undefined                (explicit break-glass)
 *   D5  Darwin + "typo"          → throws InvalidSandbox…   (fail closed)
 *   D6  Linux  + unset           → undefined                (no substrate)
 *   D7  Linux  + "off"           → undefined                (explicit break-glass)
 *   D8  Linux  + "seatbelt"      → throws InvalidSandbox…   (fail closed)
 *   D9  CLINE_SANDBOX=anything + CLINEMM_EXPERIMENTAL_SANDBOX unset
 *                               → determined solely by ClineMM selector
 *                                  (NOT by upstream CLI CLINE_SANDBOX)
 *   D10 SHARED SDK CONSERVATION (CORRECTION02): the shared SDK helper
 *       `readExperimentalSandboxOptIn` keeps its HISTORICAL opt-in-only
 *       semantics — unset / "" / "off" / garbage all return undefined.
 *       Only "seatbelt" returns the opt-in. This guarantees that CLI,
 *       JetBrains, SDK embeddings, and non-darwin hosts see no
 *       semantic delta from this ACT.
 *
 * These tests are pure structural and work on every platform. They do
 * NOT require `sandbox-exec` — the substrate probe is downstream of
 * the selector. Real-kernel GREEN proof lives in the companion file
 * `darwin-seatbelt-default-on-real-kernel01.c1-green.test.ts`.
 */

import { afterEach, describe, expect, it } from "vitest"
import { readExperimentalSandboxOptIn } from "@cline/core"
import { InvalidSandboxConfigurationError, resolveExperimentalSandboxMode } from "../sandbox-policy"

const SANDBOX_OPTIN_ENV = "CLINEMM_EXPERIMENTAL_SANDBOX"
const UPSTREAM_CLI_ENV = "CLINE_SANDBOX"
const ORIGINAL_OPTIN_ENV = process.env[SANDBOX_OPTIN_ENV]
const ORIGINAL_UPSTREAM_ENV = process.env[UPSTREAM_CLI_ENV]

afterEach(() => {
	if (ORIGINAL_OPTIN_ENV === undefined) delete process.env[SANDBOX_OPTIN_ENV]
	else process.env[SANDBOX_OPTIN_ENV] = ORIGINAL_OPTIN_ENV
	if (ORIGINAL_UPSTREAM_ENV === undefined) delete process.env[UPSTREAM_CLI_ENV]
	else process.env[UPSTREAM_CLI_ENV] = ORIGINAL_UPSTREAM_ENV
})

function setOptIn(value: string | undefined): void {
	if (value === undefined) delete process.env[SANDBOX_OPTIN_ENV]
	else process.env[SANDBOX_OPTIN_ENV] = value
}

const isDarwin = process.platform === "darwin"

describe.skipIf(!isDarwin)("D1-D5: darwin selector matrix", () => {
	it("D1: Darwin + unset → seatbelt-experimental", () => {
		setOptIn(undefined)
		expect(resolveExperimentalSandboxMode()).toBe("seatbelt-experimental")
	})

	it("D2: Darwin + '' (empty) → seatbelt-experimental", () => {
		setOptIn("")
		expect(resolveExperimentalSandboxMode()).toBe("seatbelt-experimental")
	})

	it("D3: Darwin + 'seatbelt' → seatbelt-experimental (legacy synonym)", () => {
		setOptIn("seatbelt")
		expect(resolveExperimentalSandboxMode()).toBe("seatbelt-experimental")
	})

	it("D4: Darwin + 'off' → undefined (explicit break-glass)", () => {
		setOptIn("off")
		expect(resolveExperimentalSandboxMode()).toBeUndefined()
	})

	it("D5: Darwin + 'typo' → throws InvalidSandboxConfigurationError (fail closed)", () => {
		for (const garbage of ["Seatbelt", "seatbelt2", "true", "1", "allow", "yes"]) {
			setOptIn(garbage)
			expect(() => resolveExperimentalSandboxMode()).toThrow(InvalidSandboxConfigurationError)
		}
	})
})

describe.skipIf(isDarwin)("D6-D8: non-darwin selector matrix", () => {
	it("D6: Linux + unset → undefined (no substrate; classic)", () => {
		setOptIn(undefined)
		expect(resolveExperimentalSandboxMode()).toBeUndefined()
	})

	it("D7: Linux + 'off' → undefined (explicit break-glass; classic)", () => {
		setOptIn("off")
		expect(resolveExperimentalSandboxMode()).toBeUndefined()
	})

	it("D8: Linux + 'seatbelt' → throws InvalidSandboxConfigurationError (substrate unavailable)", () => {
		setOptIn("seatbelt")
		expect(() => resolveExperimentalSandboxMode()).toThrow(InvalidSandboxConfigurationError)
	})
})

describe("D9: upstream CLINE_SANDBOX has NO effect on ClineMM VS Code Seatbelt selection", () => {
	const cases = [
		{ label: "unset upstream + unset ClineMM", upstream: undefined, optIn: undefined },
		{ label: "CLINE_SANDBOX=0 + unset ClineMM", upstream: "0", optIn: undefined },
		{ label: "CLINE_SANDBOX=1 + unset ClineMM", upstream: "1", optIn: undefined },
		{ label: "CLINE_SANDBOX=off + unset ClineMM", upstream: "off", optIn: undefined },
		{ label: "CLINE_SANDBOX=garbage + unset ClineMM", upstream: "garbage", optIn: undefined },
		{ label: "CLINE_SANDBOX=1 + ClineMM='off'", upstream: "1", optIn: "off" },
	]

	for (const c of cases) {
		it(`${c.label} → ${isDarwin ? "darwin path" : "linux path"}`, () => {
			if (c.upstream === undefined) delete process.env[UPSTREAM_CLI_ENV]
			else process.env[UPSTREAM_CLI_ENV] = c.upstream
			setOptIn(c.optIn)

			// Decision is driven EXCLUSIVELY by the ClineMM selector. CLINE_SANDBOX
			// must NOT be aliased, must NOT leak into Seatbelt selection.
			const result = resolveExperimentalSandboxMode()
			if (isDarwin) {
				expect(result).toBe(c.optIn === "off" ? undefined : "seatbelt-experimental")
			} else {
				// On linux, the only safe states are undefined. If the test
				// accidentally set "seatbelt" via upstream CLINE_SANDBOX (it
				// didn't), the ClineMM selector would still throw — proving
				// upstream doesn't accidentally trigger Seatbelt.
				expect(result).toBeUndefined()
			}
		})
	}
})

describe("D10: shared SDK helper conservation (CORRECTION02)", () => {
	// This is the load-bearing conservation witness required by
	// the reviewer's HALT_SHARED_SDK_DEFAULT_SCOPE_EXPANSION
	// correction. The shared SDK helper
	// `readExperimentalSandboxOptIn()` MUST keep its historical
	// opt-in-only semantics for ALL consumers (CLI, JetBrains, SDK
	// embeddings, non-darwin hosts). Only the VS Code ClineMM
	// selector is allowed to default-on.
	it("returns undefined when env var is unset (shared SDK opt-in-only contract)", () => {
		setOptIn(undefined)
		expect(readExperimentalSandboxOptIn()).toBeUndefined()
	})

	it("returns undefined when env var is empty", () => {
		setOptIn("")
		expect(readExperimentalSandboxOptIn()).toBeUndefined()
	})

	it("returns undefined when env var is 'off'", () => {
		setOptIn("off")
		expect(readExperimentalSandboxOptIn()).toBeUndefined()
	})

	it("returns undefined for garbage values (typo cannot accidentally opt-in)", () => {
		for (const v of ["Seatbelt", "seatbelt2", "true", "1", "allow", "yes"]) {
			setOptIn(v)
			expect(readExperimentalSandboxOptIn()).toBeUndefined()
		}
	})

	it("returns the seatbelt-experimental opt-in ONLY when env var is exactly 'seatbelt'", () => {
		setOptIn("seatbelt")
		expect(readExperimentalSandboxOptIn()).toEqual({ mode: "seatbelt-experimental" })
	})

	it("D10 divergence: ClineMM VS Code selector returns Seatbelt on unset but shared SDK helper returns undefined", () => {
		// This is the CORE divergence that proves the default-on
		// semantics is correctly LOCALIZED to apps/vscode and does
		// NOT bleed into the shared SDK. On darwin with unset env:
		setOptIn(undefined)
		if (isDarwin) {
			// VS Code selector: secure default → Seatbelt active
			expect(resolveExperimentalSandboxMode()).toBe("seatbelt-experimental")
		} else {
			// Non-darwin: no substrate → classic (undefined)
			expect(resolveExperimentalSandboxMode()).toBeUndefined()
		}
		// Shared SDK helper (any platform): opt-in-only → undefined
		expect(readExperimentalSandboxOptIn()).toBeUndefined()
	})
})

describe("InvalidSandboxConfigurationError", () => {
	it("is a distinct Error subclass with a useful message", () => {
		const err = new InvalidSandboxConfigurationError("test message")
		expect(err).toBeInstanceOf(Error)
		expect(err).toBeInstanceOf(InvalidSandboxConfigurationError)
		expect(err.name).toBe("InvalidSandboxConfigurationError")
		expect(err.message).toBe("test message")
	})
})
