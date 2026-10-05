import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { isDogfoodRuntime } from "../dogfood-runtime-profile"
import {
	getLifecycleClearSnapshot,
	type LifecycleClearReason,
	recordLifecycleClear,
	resetLifecycleClearSnapshot,
} from "../lifecycle-clear-recorder"

/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01 — CALLER-REASON DISCRIMINATOR.
 *
 * These tests exercise the recorder in isolation (no SdkSessionLifecycle
 * instance). A separate integration test drives the REAL
 * `SdkSessionLifecycle.endActiveSession(reason)` funnel and asserts that
 * the snapshot picks up the funnel reason. Together they prove the
 * §11 invariants:
 *
 *   C1 `public` profile              -> no recording, snapshot disabled
 *   C2 `dogfood`, no clear           -> snapshot enabled, total=0
 *   C3 `dogfood`, one clear          -> snapshot.lastClearReason <value>
 *   C4 `dogfood`, multiple clears    -> total accumulates; last wins
 *   C5 reason outside enum           -> snapshot.lastClearReason === "unrecognized",
 *                                       snapshot.lastUnrecognizedReason === <raw>
 *   C6 reason === "" (empty)         -> snapshot.lastClearReason === "empty"
 *   C7 reset / test isolation        -> counters cleared
 *
 * Env-var flips are restored in `afterEach` so the test process does not
 * poison the next case.
 */

const ORIGINAL_ENV = { ...process.env }

function setProfile(profile: "public" | "dogfood"): void {
	if (profile === "dogfood") {
		process.env.CLINEMM_RUNTIME_PROFILE = "dogfood"
	} else {
		delete process.env.CLINEMM_RUNTIME_PROFILE
	}
	// Defensive paranoia: the snapshot reads `isDogfoodRuntime()` at call
	// time, but the recorder's `INTERNAL_STATE` is module-scope. Reset it
	// here so each case starts from a clean counter regardless of profile.
	resetLifecycleClearSnapshot()
}

describe("lifecycle-clear-recorder (CLCREC01)", () => {
	afterEach(() => {
		process.env = { ...ORIGINAL_ENV }
		resetLifecycleClearSnapshot()
	})

	describe("C1 — public profile", () => {
		beforeEach(() => setProfile("public"))

		it("C1a: getLifecycleClearSnapshot returns enabled=false, total=0", () => {
			const snap = getLifecycleClearSnapshot()
			expect(snap.enabled).toBe(false)
			expect(snap.total).toBe(0)
			expect(snap.lastClearReason).toBeUndefined()
			expect(snap.lastUnrecognizedReason).toBeUndefined()
		})

		it("C1b: recordLifecycleClear is a no-op (counter does not advance)", () => {
			recordLifecycleClear("startNewSession")
			recordLifecycleClear("clearTask")
			recordLifecycleClear("autoApprovalRebuildFailure")
			const snap = getLifecycleClearSnapshot()
			expect(snap.enabled).toBe(false)
			expect(snap.total).toBe(0)
		})

		it("C1c: isDogfoodRuntime() returns false in public", () => {
			expect(isDogfoodRuntime()).toBe(false)
		})
	})

	describe("C2 — dogfood profile, no clear fired", () => {
		beforeEach(() => setProfile("dogfood"))

		it("C2a: snapshot enabled, total=0, lastClearReason undefined", () => {
			const snap = getLifecycleClearSnapshot()
			expect(snap.enabled).toBe(true)
			expect(snap.total).toBe(0)
			expect(snap.lastClearReason).toBeUndefined()
			expect(snap.lastUnrecognizedReason).toBeUndefined()
		})

		it("C2b: isDogfoodRuntime() returns true", () => {
			expect(isDogfoodRuntime()).toBe(true)
		})
	})

	describe("C3 — dogfood profile, one clear fired (per enum value)", () => {
		beforeEach(() => setProfile("dogfood"))

		const ENUM_VALUES: LifecycleClearReason[] = [
			"startNewSession",
			"replaceActiveSession",
			"dispose",
			"clearTask",
			"showTaskWithId",
			"followupTargetChange",
			"autoApprovalRebuildFailure",
			"remoteConfigToggle",
		]

		for (const reason of ENUM_VALUES) {
			it(`C3[${reason}]: records the reason verbatim, total=1, lastUnrecognizedReason=undefined`, () => {
				recordLifecycleClear(reason)
				const snap = getLifecycleClearSnapshot()
				expect(snap.enabled).toBe(true)
				expect(snap.total).toBe(1)
				expect(snap.lastClearReason).toBe(reason)
				expect(snap.lastUnrecognizedReason).toBeUndefined()
			})
		}
	})

	describe("C4 — dogfood profile, multiple clears (last wins)", () => {
		beforeEach(() => setProfile("dogfood"))

		it("C4a: total accumulates; lastClearReason reflects most recent", () => {
			recordLifecycleClear("startNewSession")
			recordLifecycleClear("clearTask")
			recordLifecycleClear("dispose")
			const snap = getLifecycleClearSnapshot()
			expect(snap.total).toBe(3)
			expect(snap.lastClearReason).toBe("dispose")
			expect(snap.lastUnrecognizedReason).toBeUndefined()
		})

		it("C4b: in-set after unrecognized wipes lastUnrecognizedReason", () => {
			recordLifecycleClear("unknown_site_xyz")
			expect(getLifecycleClearSnapshot().lastUnrecognizedReason).toBe("unknown_site_xyz")
			recordLifecycleClear("clearTask")
			const snap = getLifecycleClearSnapshot()
			expect(snap.lastClearReason).toBe("clearTask")
			expect(snap.lastUnrecognizedReason).toBeUndefined()
		})
	})

	describe("C5 — reason outside the bounded enum", () => {
		beforeEach(() => setProfile("dogfood"))

		it("C5a: snapshot.lastClearReason === 'unrecognized'; raw preserved in lastUnrecognizedReason", () => {
			recordLifecycleClear("bogus-string-from-non-obvious-callsite")
			const snap = getLifecycleClearSnapshot()
			expect(snap.total).toBe(1)
			expect(snap.lastClearReason).toBe("unrecognized")
			expect(snap.lastUnrecognizedReason).toBe("bogus-string-from-non-obvious-callsite")
		})
	})

	describe("C6 — empty reason", () => {
		beforeEach(() => setProfile("dogfood"))

		it("C6a: empty string maps to 'empty' enum value (in-set, not unrecognized)", () => {
			recordLifecycleClear("")
			const snap = getLifecycleClearSnapshot()
			expect(snap.total).toBe(1)
			expect(snap.lastClearReason).toBe("empty")
			expect(snap.lastUnrecognizedReason).toBeUndefined()
		})
	})

	describe("C7 — reset isolation", () => {
		beforeEach(() => setProfile("dogfood"))

		it("C7a: resetLifecycleClearSnapshot clears total, lastClearReason, lastUnrecognizedReason", () => {
			recordLifecycleClear("startNewSession")
			recordLifecycleClear("unknown_xyz")
			expect(getLifecycleClearSnapshot().total).toBe(2)
			resetLifecycleClearSnapshot()
			const snap = getLifecycleClearSnapshot()
			expect(snap.enabled).toBe(true) // profile unchanged
			expect(snap.total).toBe(0)
			expect(snap.lastClearReason).toBeUndefined()
			expect(snap.lastUnrecognizedReason).toBeUndefined()
		})
	})
})
