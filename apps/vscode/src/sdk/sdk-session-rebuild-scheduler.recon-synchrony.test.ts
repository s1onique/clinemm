// ACT-CLINEMM-ELM-SEAM12-SESSION-REBUILD-AUTHORITY-RECON
// SYNCHRONY DISCRIMINATOR
//
// This recon-only probe establishes the OBSERVED synchronous ordering of
// `SdkSessionRebuildScheduler.request()` against the real production class.
// It exists to decide whether Elm can own the scheduling state machine
// without breaking the synchronous-effect-start contract that production
// callers implicitly depend on (or that the drainIfIdle() body relies on
// for snapshot/pending semantics).
//
// The test is NOT a passing test in the normal suite — it is a recon
// artifact. If the future migration is approved, the synchrony
// invariants this probe proves will become part of the bounded
// successor contract. If the migration is rejected, this file is
// removed in the same ACT.
//
// SAFETY: this file is named *.test.ts so vitest picks it up, but it
// only proves observation. It is NOT a "passing test" that production
// would regress against. The recon review is what gates it.

import { describe, expect, it, vi } from "vitest"
import { SdkSessionRebuildScheduler } from "./sdk-session-rebuild-scheduler"

type ActiveSession = { isRunning: boolean }

function makeScheduler(active: ActiveSession) {
	return new SdkSessionRebuildScheduler({
		sessions: {
			getActiveSession: () => active as never,
		},
	})
}

describe("SdkSessionRebuildScheduler — synchrony recon (ELM SEAM12)", () => {
	it("OBSERVED: synchronous request() synchronously invokes the rebuild callback when the session is already idle", () => {
		const active: ActiveSession = { isRunning: false }
		const scheduler = makeScheduler(active)

		const events: string[] = []
		const rebuild = () => {
			events.push("rebuild-entered")
			// Return an unresolved promise so the drain is paused; we
			// observe "rebuild-entered" before "request-returned".
			return new Promise<void>(() => {})
		}

		scheduler.request("provider", rebuild)
		events.push("request-returned")

		expect(events).toEqual(["rebuild-entered", "request-returned"])
	})

	it("OBSERVED: synchronous request() with isRunning=true defers callback execution", () => {
		const active: ActiveSession = { isRunning: true }
		const scheduler = makeScheduler(active)

		const events: string[] = []
		const rebuild = vi.fn(() => {
			events.push("rebuild-entered")
			return new Promise<void>(() => {})
		})

		scheduler.request("provider", rebuild)
		events.push("request-returned")

		expect(events).toEqual(["request-returned"])
		expect(rebuild).not.toHaveBeenCalled()
	})

	it("OBSERVED: sessionBecameIdle() synchronously triggers the pending callback", () => {
		const active: ActiveSession = { isRunning: true }
		const scheduler = makeScheduler(active)

		const events: string[] = []
		scheduler.request("provider", () => {
			events.push("rebuild-entered")
			return new Promise<void>(() => {})
		})

		active.isRunning = false
		scheduler.sessionBecameIdle()
		events.push("sessionBecameIdle-returned")

		expect(events).toEqual(["rebuild-entered", "sessionBecameIdle-returned"])
	})

	it("OBSERVED: runExclusive() synchronously enters the operation and reserves drainInFlight", async () => {
		const active: ActiveSession = { isRunning: false }
		const scheduler = makeScheduler(active)

		let release!: () => void
		const events: string[] = []
		const exclusiveP = scheduler.runExclusive(
			() =>
				new Promise<void>((resolve) => {
					release = resolve
				}),
		)

		events.push("runExclusive-returned")

		// While the exclusive is in flight, a passive request must
		// NOT invoke the rebuild callback. The drainInFlight gate is
		// the synchrony boundary for exclusivity.
		const passive = vi.fn(() => {
			events.push("rebuild-entered")
			return new Promise<void>(() => {})
		})
		scheduler.request("provider", passive)
		events.push("request-returned")

		expect(events).toEqual(["runExclusive-returned", "request-returned"])
		expect(passive).not.toHaveBeenCalled()

		release()
		await exclusiveP
		// After the exclusive releases, the auto-drain synchronously
		// enters the passive callback.
		events.push("after-release")
		expect(events[events.length - 1]).toBe("after-release")
		expect(passive).toHaveBeenCalledOnce()
	})

	it("OBSERVED: cancel() is synchronous and removes the pending entry", () => {
		const active: ActiveSession = { isRunning: true }
		const scheduler = makeScheduler(active)

		const events: string[] = []
		const rebuild = vi.fn(() => {
			events.push("rebuild-entered")
			return new Promise<void>(() => {})
		})

		scheduler.request("provider", rebuild)
		scheduler.cancel("provider")
		events.push("cancel-returned")

		// Drain cannot fire because the session is busy AND pending is
		// empty. Releasing isRunning should also not invoke the
		// cancelled callback.
		active.isRunning = false
		scheduler.sessionBecameIdle()

		expect(events).toEqual(["cancel-returned"])
		expect(rebuild).not.toHaveBeenCalled()
	})
})
