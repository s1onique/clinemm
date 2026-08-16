import { describe, expect, it } from "vitest"
import { MessageIdMinter } from "./message-id-minter"
import { TurnStateTracker } from "./turn-state-tracker"

describe("TurnStateTracker", () => {
	it("starts idle", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		expect(tracker.get().phase).toBe("idle")
		expect(tracker.currentPhase).toBe("idle")
	})

	it("advances seq on every transition so the webview keeps the newest", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		const s0 = tracker.get().seq
		tracker.set("streaming")
		const s1 = tracker.get().seq
		tracker.set("completed")
		const s2 = tracker.get().seq
		expect(s1).toBeGreaterThan(s0)
		expect(s2).toBeGreaterThan(s1)
	})

	it("records the phase and anchor ts", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.set("awaiting_approval", 42)
		expect(tracker.get()).toMatchObject({ phase: "awaiting_approval", anchorTs: 42 })
		tracker.set("streaming")
		// anchor cleared when not provided
		expect(tracker.get().anchorTs).toBeUndefined()
		expect(tracker.get().phase).toBe("streaming")
	})

	it("shares the minter's seq space (seq is globally monotonic)", () => {
		const minter = new MessageIdMinter()
		const tracker = new TurnStateTracker(minter)
		const a = tracker.get().seq
		// An unrelated message mint advances the shared seq counter.
		minter.nextSeq()
		tracker.set("completed")
		expect(tracker.get().seq).toBeGreaterThan(a)
	})

	describe("subscribe (ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION01)", () => {
		it("notifies listeners on every set() call including no-op transitions", () => {
			const tracker = new TurnStateTracker(new MessageIdMinter())
			const phases: string[] = []
			tracker.subscribe((phase) => {
				phases.push(phase)
			})
			tracker.set("streaming")
			tracker.set("streaming") // same phase — still notifies
			tracker.set("completed")
			expect(phases).toEqual(["streaming", "streaming", "completed"])
		})

		it("forwards anchorTs as the second argument", () => {
			const tracker = new TurnStateTracker(new MessageIdMinter())
			let lastAnchor: number | undefined
			tracker.subscribe((_phase, anchorTs) => {
				lastAnchor = anchorTs
			})
			tracker.set("awaiting_approval", 99)
			expect(lastAnchor).toBe(99)
			tracker.set("streaming") // no anchor provided
			expect(lastAnchor).toBeUndefined()
		})

		it("unsubscribe detaches the listener; later set() calls do not notify", () => {
			const tracker = new TurnStateTracker(new MessageIdMinter())
			const phases: string[] = []
			const unsub = tracker.subscribe((phase) => {
				phases.push(phase)
			})
			tracker.set("streaming")
			unsub()
			tracker.set("completed")
			expect(phases).toEqual(["streaming"])
		})

		it("multiple subscribers all receive the notification", () => {
			const tracker = new TurnStateTracker(new MessageIdMinter())
			let aCount = 0
			let bCount = 0
			tracker.subscribe(() => {
				aCount++
			})
			tracker.subscribe(() => {
				bCount++
			})
			tracker.set("completed")
			expect(aCount).toBe(1)
			expect(bCount).toBe(1)
		})

		it("unsubscribe is idempotent", () => {
			const tracker = new TurnStateTracker(new MessageIdMinter())
			const unsub = tracker.subscribe(() => {})
			unsub()
			unsub() // must not throw
		})
	})

	// ===== ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION03 =====
	// Observer isolation. A throwing subscriber must not be able to
	// veto the authoritative turn-state transition.

	describe("observer isolation (CORRECTION03)", () => {
		it("THA42: a throwing subscriber cannot veto set() and later listeners still run", () => {
			const tracker = new TurnStateTracker(new MessageIdMinter())
			let laterReceivedPhase: string | undefined
			let laterCallCount = 0
			tracker.subscribe(() => {
				throw new Error("observer exploded")
			})
			tracker.subscribe((phase) => {
				laterReceivedPhase = phase
				laterCallCount += 1
			})

			// set() must NOT throw even though the first listener does.
			expect(() => tracker.set("streaming")).not.toThrow()
			// The state mutation is committed.
			expect(tracker.get().phase).toBe("streaming")
			// The later listener (registered AFTER the throwing one) still
			// receives the notification.
			expect(laterReceivedPhase).toBe("streaming")
			expect(laterCallCount).toBe(1)
		})

		it("THA42b: a throwing subscriber does not leak state across multiple set() calls", () => {
			const tracker = new TurnStateTracker(new MessageIdMinter())
			tracker.subscribe(() => {
				throw new Error("always throws")
			})
			expect(() => tracker.set("streaming")).not.toThrow()
			expect(() => tracker.set("completed")).not.toThrow()
			expect(() => tracker.set("resumable")).not.toThrow()
			expect(() => tracker.set("error")).not.toThrow()
			expect(tracker.get().phase).toBe("error")
		})

		it("THA42c: every terminal-phase transition commits even with a throwing subscriber", () => {
			// Production-shape proof. cancelTask sets resumable, the SDK
			// turn coordinator sets completed/error/awaiting_followup —
			// none of those may unwind the caller because of a buggy
			// observer.
			const tracker = new TurnStateTracker(new MessageIdMinter())
			tracker.subscribe(() => {
				throw new Error("observer is buggy today")
			})

			for (const terminal of ["error", "resumable", "completed", "awaiting_followup"] as const) {
				expect(() => tracker.set(terminal)).not.toThrow()
				expect(tracker.get().phase).toBe(terminal)
			}
		})

		it("THA42d: unsubscribe from another listener during iteration does not affect later listeners", () => {
			// The set() implementation iterates over [...this.listeners]
			// (a snapshot). Verifies that one listener unsubscribing
			// itself or another during the same set() call does not
			// affect the iteration order or count.
			const tracker = new TurnStateTracker(new MessageIdMinter())
			let bCount = 0
			let cCount = 0
			const unsubA: () => void = tracker.subscribe(() => {
				unsubA() // unsubscribe self during iteration
			})
			tracker.subscribe(() => {
				bCount += 1
			})
			tracker.subscribe(() => {
				cCount += 1
			})
			expect(() => tracker.set("completed")).not.toThrow()
			expect(bCount).toBe(1)
			expect(cCount).toBe(1)
		})

		it("THA42e: unsub after a throwing listener was invoked still works", () => {
			const tracker = new TurnStateTracker(new MessageIdMinter())
			let laterCallCount = 0
			tracker.subscribe(() => {
				throw new Error("first listener explodes")
			})
			const laterUnsub = tracker.subscribe(() => {
				laterCallCount += 1
			})
			expect(() => tracker.set("streaming")).not.toThrow()
			expect(laterCallCount).toBe(1)
			laterUnsub()
			expect(() => tracker.set("completed")).not.toThrow()
			expect(laterCallCount).toBe(1) // detached, still 1
		})

		// M8 mutation-proof: this test would fail if the try/catch
		// isolation around listener invocation in set() were removed.
		// To verify: revert the try/catch in turn-state-tracker.set()
		// and re-run; THA42 must fail with "expect(...).not.toThrow()".
		it("M8 mutation-proof: removing listener isolation breaks THA42", () => {
			const tracker = new TurnStateTracker(new MessageIdMinter())
			tracker.subscribe(() => {
				throw new Error("observe isolation removed")
			})
			tracker.subscribe(() => {
				// This listener would be skipped if a thrown error
				// propagated out of set().
				// We pin its behavior so a future refactor that
				// accidentally loses try/catch becomes observable in
				// this test.
			})
			expect(() => tracker.set("streaming")).not.toThrow()
			expect(tracker.get().phase).toBe("streaming")
		})
	})
})
