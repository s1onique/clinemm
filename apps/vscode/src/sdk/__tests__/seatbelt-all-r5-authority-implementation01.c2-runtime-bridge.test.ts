/**
 * ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01
 * CORRECTION02 (REAL_MANDATORY_SEATBELT_PRODUCER) --
 * Witness A.
 *
 * Reviewer disposition (2026-08-30) on CORRECTION01:
 *
 *   "The conditional behavior only exists if production constructs
 *    CommandHostAuthorization{mode:"all", mandatorySeatbelt:true}.
 *    I do not see the actual production code that decides that."
 *
 * This test pins the producer seam: the pure function
 * `applySeatbeltAuthorityEnvelope` derives the conditional authority
 * from the kernel-envelope invariant (`sandboxMode`), NOT from any
 * user-facing toggle. The SdkController's `resolveHostAuthorization`
 * closure is the only production caller; this test exercises the
 * pure helper directly with the exact shape the closure passes in.
 *
 * The four cases:
 *   A1: all + seatbelt-experimental => mandatorySeatbelt=true
 *   A2: all + (any other sandbox mode) => mandatorySeatbelt undefined
 *   A3: all + undefined sandbox mode => mandatorySeatbelt undefined
 *   A4: safe-only + seatbelt-experimental => mandatorySeatbelt undefined
 *       (mode "all" is required for the stamp; safe-only is not)
 *
 * All assertions are at the pure helper boundary -- no I/O, no env
 * vars, no SdkController. The tests pass identical inputs to identical
 * code, but they pin the precise shape of the producer's output for
 * the production call site.
 */
import { describe, expect, it } from "vitest"
import { applySeatbeltAuthorityEnvelope } from "../sdk-tool-policies"
import { commandHostAuthorization } from "@cline/core"
import type { CommandHostAuthorization } from "@cline/core"

describe("ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01 C2 - Witness A producer", () => {
	it("A1: mode=all + sandboxMode=seatbelt-experimental => mandatorySeatbelt=true", () => {
		const auth: CommandHostAuthorization = commandHostAuthorization({ mode: "all" })
		const out = applySeatbeltAuthorityEnvelope(auth, "seatbelt-experimental")
		expect(out.mode).toBe("all")
		expect(out.mandatorySeatbelt).toBe(true)
	})

	it("A2: mode=all + sandboxMode=disabled => mandatorySeatbelt=undefined (R5 fires)", () => {
		const auth: CommandHostAuthorization = commandHostAuthorization({ mode: "all" })
		const out = applySeatbeltAuthorityEnvelope(auth, "disabled")
		expect(out.mode).toBe("all")
		expect(out.mandatorySeatbelt).toBeUndefined()
	})

	it("A3: mode=all + sandboxMode=undefined => mandatorySeatbelt=undefined", () => {
		const auth: CommandHostAuthorization = commandHostAuthorization({ mode: "all" })
		const out = applySeatbeltAuthorityEnvelope(auth, undefined)
		expect(out.mode).toBe("all")
		expect(out.mandatorySeatbelt).toBeUndefined()
	})

	it("A4: mode=safe-only + sandboxMode=seatbelt-experimental => mandatorySeatbelt=undefined", () => {
		// The stamp fires ONLY when the user's authority envelope is
		// "all". safe-only commands are already gated by the canonical
		// safe-rule engine; promoting them to seatbelt-conditional would
		// be a surprise and is intentionally NOT supported.
		const auth: CommandHostAuthorization = commandHostAuthorization({ mode: "safe-only" })
		const out = applySeatbeltAuthorityEnvelope(auth, "seatbelt-experimental")
		expect(out.mode).toBe("safe-only")
		expect(out.mandatorySeatbelt).toBeUndefined()
	})

	it("idempotence: a second application does not stack or change anything", () => {
		const auth: CommandHostAuthorization = commandHostAuthorization({ mode: "all" })
		const stamped = applySeatbeltAuthorityEnvelope(auth, "seatbelt-experimental")
		const twice = applySeatbeltAuthorityEnvelope(stamped, "seatbelt-experimental")
		expect(twice.mandatorySeatbelt).toBe(true)
		expect(twice.mode).toBe("all")
		// Same object identity for the explicitDenyRules / explicitAllowRules
		// (no accidental deep clone).
		expect(twice.explicitDenyRules).toBe(stamped.explicitDenyRules)
	})
})
