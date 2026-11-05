/**
 * ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-PRODUCTION-DISCRIMINATOR01
 *
 * PROCESS-FREE tests for the TRUSTED HOST-SIDE opt-in gate that
 * arms the one-shot Seatbelt signal-rule substitution.
 *
 * The load-bearing property of this gate is that it CANNOT be
 * activated by untrusted command content:
 *
 *   - command text / arguments / stdout / the `run_commands`
 *     environment never activate the substitution;
 *   - only the extension host's OWN process environment (operator
 *     controlled at launch) can;
 *   - and even then the EXACT command identity must also match.
 *
 * These tests are process-free: they never spawn anything.
 */

import { afterEach, describe, expect, it } from "vitest"
import { clearSeatbeltSignalRuleAuthorization, getSeatbeltSignalRuleAuthorization } from "../../test/cline-core-vitest-stub"
import {
	armSameSandboxDiagnosticIfOptedIn,
	CLINEMM_SAME_SANDBOX_DISCRIMINATOR_MARKER,
	resolveSameSandboxDiagnosticOptIn,
} from "../sandbox-policy"

const DIAGNOSTIC_ARGV = ["-c", `/usr/bin/env node /tmp/${CLINEMM_SAME_SANDBOX_DISCRIMINATOR_MARKER}/probe.mjs`]

function baseEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
	return {
		CLINEMM_RUNTIME_PROFILE: "dogfood",
		CLINEMM_EXPERIMENTAL_SANDBOX: "seatbelt",
		CLINEMM_DIAG_SAME_SANDBOX_SIGNAL: "1",
		CLINEMM_DIAG_SAME_SANDBOX_SIGNAL_COMMAND: JSON.stringify(["/bin/bash", ...DIAGNOSTIC_ARGV]),
		...overrides,
	}
}

afterEach(() => {
	clearSeatbeltSignalRuleAuthorization()
	delete process.env.CLINEMM_DIAG_SAME_SANDBOX_SIGNAL
	delete process.env.CLINEMM_DIAG_SAME_SANDBOX_SIGNAL_COMMAND
})

describe("ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-PRODUCTION-DISCRIMINATOR01 — trusted opt-in gate", () => {
	it("DEFAULT_OFF: with no opt-in env the gate is disarmed", () => {
		const optIn = resolveSameSandboxDiagnosticOptIn({})
		expect(optIn.armed).toBe(false)
		expect(optIn.executable).toBe("")
		expect(optIn.argv).toEqual([])
	})

	it("DEFAULT_OFF: armSameSandboxDiagnosticIfOptedIn is a no-op without the env", () => {
		expect(armSameSandboxDiagnosticIfOptedIn({})).toBe(false)
		expect(getSeatbeltSignalRuleAuthorization()).toBeUndefined()
	})

	it("T2: the trusted env + exact identity arms the gate", () => {
		const optIn = resolveSameSandboxDiagnosticOptIn(baseEnv())
		expect(optIn.armed).toBe(true)
		expect(optIn.executable).toBe("/bin/bash")
		expect(optIn.argv).toEqual(DIAGNOSTIC_ARGV)
	})

	it("T4: a PUBLIC runtime profile can never arm the gate", () => {
		const optIn = resolveSameSandboxDiagnosticOptIn(baseEnv({ CLINEMM_RUNTIME_PROFILE: "public" }))
		expect(optIn.armed).toBe(false)
	})

	it("T4: a missing runtime profile can never arm the gate", () => {
		const optIn = resolveSameSandboxDiagnosticOptIn(baseEnv({ CLINEMM_RUNTIME_PROFILE: undefined }))
		expect(optIn.armed).toBe(false)
	})

	it("fail-closed: an unrecognized opt-in value does not arm the gate", () => {
		for (const value of ["", "0", "yes", "TRUE", "enabled"]) {
			const optIn = resolveSameSandboxDiagnosticOptIn(baseEnv({ CLINEMM_DIAG_SAME_SANDBOX_SIGNAL: value }))
			expect(optIn.armed).toBe(false)
		}
	})

	it("fail-closed: a malformed exact-identity payload does not arm the gate", () => {
		const malformed = [undefined, "", "not json", "{}", "[]", "[1, 2]", '["/bin/bash", 5]', '["/bin/bash", ""]']
		for (const payload of malformed) {
			const optIn = resolveSameSandboxDiagnosticOptIn(baseEnv({ CLINEMM_DIAG_SAME_SANDBOX_SIGNAL_COMMAND: payload }))
			expect(optIn.armed).toBe(false)
		}
	})

	it("fail-closed: with the Seatbelt sandbox OFF the gate does not arm", () => {
		const optIn = resolveSameSandboxDiagnosticOptIn(baseEnv({ CLINEMM_EXPERIMENTAL_SANDBOX: "off" }))
		expect(optIn.armed).toBe(false)
	})

	it("T2: armSameSandboxDiagnosticIfOptedIn installs the exact identity", () => {
		expect(armSameSandboxDiagnosticIfOptedIn(baseEnv())).toBe(true)
		expect(getSeatbeltSignalRuleAuthorization()).toEqual({
			executable: "/bin/bash",
			argv: DIAGNOSTIC_ARGV,
		})
	})

	it("T4: armSameSandboxDiagnosticIfOptedIn installs NOTHING for a public profile", () => {
		expect(armSameSandboxDiagnosticIfOptedIn(baseEnv({ CLINEMM_RUNTIME_PROFILE: "public" }))).toBe(false)
		expect(getSeatbeltSignalRuleAuthorization()).toBeUndefined()
	})
})
