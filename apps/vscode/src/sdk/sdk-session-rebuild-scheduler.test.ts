import { describe, expect, it, vi } from "vitest"
import { SdkSessionRebuildScheduler } from "./sdk-session-rebuild-scheduler"

describe("SdkSessionRebuildScheduler", () => {
	it("drains a rebuild when the running session becomes idle", async () => {
		const activeSession = { isRunning: true }
		const scheduler = makeScheduler(activeSession)
		const rebuild = vi.fn().mockResolvedValue(undefined)

		scheduler.request("terminalExecutionMode", rebuild)
		expect(rebuild).not.toHaveBeenCalled()

		activeSession.isRunning = false
		scheduler.sessionBecameIdle()
		await scheduler.waitUntilSettled()

		expect(rebuild).toHaveBeenCalledOnce()
	})

	it("coalesces repeated requests for the same reason", async () => {
		const activeSession = { isRunning: true }
		const scheduler = makeScheduler(activeSession)
		const first = vi.fn().mockResolvedValue(undefined)
		const latest = vi.fn().mockResolvedValue(undefined)

		scheduler.request("provider", first)
		scheduler.request("provider", latest)
		activeSession.isRunning = false
		scheduler.sessionBecameIdle()
		await scheduler.waitUntilSettled()

		expect(first).not.toHaveBeenCalled()
		expect(latest).toHaveBeenCalledOnce()
	})

	it("leaves pending work dormant when there is no active session", async () => {
		const scheduler = new SdkSessionRebuildScheduler({ sessions: { getActiveSession: () => undefined } })
		const rebuild = vi.fn().mockResolvedValue(undefined)

		scheduler.request("provider", rebuild)
		await Promise.resolve()

		expect(rebuild).not.toHaveBeenCalled()
	})

	it("serializes rebuilds for different reasons", async () => {
		const activeSession = { isRunning: false }
		const scheduler = makeScheduler(activeSession)
		let resolveFirst: () => void = () => {}
		const first = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveFirst = resolve
				}),
		)
		const second = vi.fn().mockResolvedValue(undefined)

		scheduler.request("mcpTools", first)
		scheduler.request("terminalExecutionMode", second)
		await vi.waitFor(() => expect(first).toHaveBeenCalledOnce())
		expect(second).not.toHaveBeenCalled()

		resolveFirst()
		await scheduler.waitUntilSettled()
		expect(second).toHaveBeenCalledOnce()
	})

	it("holds scheduled rebuilds behind an exclusive mode rebuild", async () => {
		const activeSession = { isRunning: false }
		const scheduler = makeScheduler(activeSession)
		let resolveMode: () => void = () => {}
		const modeRebuild = scheduler.runExclusive(
			() =>
				new Promise<void>((resolve) => {
					resolveMode = resolve
				}),
		)
		const passiveRebuild = vi.fn().mockResolvedValue(undefined)

		scheduler.request("provider", passiveRebuild)
		await Promise.resolve()
		expect(passiveRebuild).not.toHaveBeenCalled()

		resolveMode()
		await modeRebuild
		await scheduler.waitUntilSettled()
		expect(passiveRebuild).toHaveBeenCalledOnce()
	})

	// ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01-CORRECTION03-P1-CONSERVATION:
	// Pending-entry conservation when the snapshot drain takes an
	// early-return branch (isRunning flips, or deferredCompletionOutstanding
	// transitions true). The unexecuted snapshot entries MUST be
	// re-queued into `pending` so the next drain cycle (when the
	// session is idle / settled) picks them up. The predecessor
	// `while (pending.size > 0)` loop avoided the loss mode by always
	// looping back to read the live map; the snapshot rewrite must do
	// it explicitly via re-queue.
	it("re-queues unexecuted snapshot entries when isRunning flips mid-drain (P1 conservation)", async () => {
		const activeSession: { isRunning: boolean } = { isRunning: false }
		const scheduler = makeScheduler(activeSession as { isRunning: boolean })

		const mcpTools = vi.fn().mockImplementation(async () => {
			// The first rebuild flips the session to running, simulating
			// a turn starting mid-rebuild.
			activeSession.isRunning = true
		})
		const provider = vi.fn().mockResolvedValue(undefined)
		const terminal = vi.fn().mockResolvedValue(undefined)

		// ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01-CORRECTION04-P1-CONSERVATION-SUFFIX:
		// Hold `drainInFlight` via `runExclusive` so the three
		// `request()` calls accumulate in `pending` instead of
		// triggering a synchronous drain with just `mcpTools` in the
		// snapshot. The bug (whole-snapshot requeue) only fires when
		// the snapshot has ≥2 entries at drain-start so iter ≥1 hits
		// the isRunning check.
		let releaseExclusive!: () => void
		const exclusivePromise = scheduler.runExclusive(
			() =>
				new Promise<void>((resolve) => {
					releaseExclusive = resolve
				}),
		)
		scheduler.request("mcpTools", mcpTools)
		scheduler.request("provider", provider)
		scheduler.request("terminalExecutionMode", terminal)
		// All three pending entries land in `pending` while the
		// exclusive is in flight.

		// Release the exclusive. The scheduler sets
		// `drainInFlight = undefined` and calls `drainIfIdle()` with
		// `pending.size = 3`. The snapshot now contains all three
		// entries. The drain processes `mcpTools` (flipping
		// isRunning=true), and on iter 1 the isRunning check triggers
		// the requeue branch.
		releaseExclusive()
		await exclusivePromise
		await scheduler.waitUntilSettled()
		expect(mcpTools).toHaveBeenCalledOnce()
		expect(provider).not.toHaveBeenCalled()
		expect(terminal).not.toHaveBeenCalled()

		// Idle the session. The unexecuted entries MUST be re-queued
		// and now drain. The already-executed `mcpTools` MUST NOT be
		// replayed (CORRECTION04 suffix-slice invariant — without the
		// suffix slice, the requeue branch re-inserts `mcpTools` and
		// the next drain replays it).
		activeSession.isRunning = false
		scheduler.sessionBecameIdle()
		await scheduler.waitUntilSettled()

		expect(mcpTools).toHaveBeenCalledOnce()
		expect(provider).toHaveBeenCalledOnce()
		expect(terminal).toHaveBeenCalledOnce()
	})

	// ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01-CORRECTION03-P1-CONSERVATION:
	// Same chronology via the deferred predicate flipping true mid-drain
	// (mirrors the LIVE-class failure: a rebuild fires while a
	// deferred obligation settles, the obligation then settles again
	// and a follow-on drain must process the held snapshot entries).
	it("re-queues unexecuted snapshot entries when deferredOutstanding flips mid-drain (P1 conservation)", async () => {
		const activeSession = { isRunning: false }
		let outstanding = false
		const scheduler = new SdkSessionRebuildScheduler({
			sessions: {
				getActiveSession: () =>
					activeSession as ReturnType<SdkSessionRebuildSchedulerOptions["sessions"]["getActiveSession"]>,
			},
			isDeferredCompletionOutstanding: () => outstanding,
		})

		const mcpTools = vi.fn().mockImplementation(async () => {
			// The first rebuild flips the deferred predicate true,
			// simulating the BCB01 barrier arriving mid-rebuild.
			outstanding = true
		})
		const provider = vi.fn().mockResolvedValue(undefined)

		// ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01-CORRECTION04-P1-CONSERVATION-SUFFIX:
		// Hold `drainInFlight` via `runExclusive` so the two
		// `request()` calls accumulate in `pending` instead of
		// triggering a synchronous drain with just `mcpTools` in the
		// snapshot. The bug (whole-snapshot requeue) only fires when
		// the snapshot has ≥2 entries at drain-start so iter ≥1 hits
		// the deferredOutstanding check.
		let releaseExclusive!: () => void
		const exclusivePromise = scheduler.runExclusive(
			() =>
				new Promise<void>((resolve) => {
					releaseExclusive = resolve
				}),
		)
		scheduler.request("mcpTools", mcpTools)
		scheduler.request("provider", provider)

		// Release the exclusive. The scheduler sets
		// `drainInFlight = undefined` and calls `drainIfIdle()` with
		// `pending.size = 2`. The snapshot contains both entries.
		// `mcpTools` runs (flipping deferred=true); on iter 1 the
		// deferredOutstanding check triggers the requeue branch.
		releaseExclusive()
		await exclusivePromise
		await scheduler.waitUntilSettled()
		expect(mcpTools).toHaveBeenCalledOnce()
		expect(provider).not.toHaveBeenCalled()

		// Settle the deferred obligation. The held snapshot entries
		// MUST drain. The already-executed `mcpTools` MUST NOT be
		// replayed (CORRECTION04 suffix-slice invariant).
		outstanding = false
		scheduler.deferredCompletionSettled()
		await scheduler.waitUntilSettled()

		expect(mcpTools).toHaveBeenCalledOnce()
		expect(provider).toHaveBeenCalledOnce()
	})
})

function makeScheduler(activeSession: { isRunning: boolean }) {
	return new SdkSessionRebuildScheduler({
		sessions: {
			getActiveSession: () =>
				activeSession as ReturnType<SdkSessionRebuildSchedulerOptions["sessions"]["getActiveSession"]>,
		},
	})
}

type SdkSessionRebuildSchedulerOptions = ConstructorParameters<typeof SdkSessionRebuildScheduler>[0]
