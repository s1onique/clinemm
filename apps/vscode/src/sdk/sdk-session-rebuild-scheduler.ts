import { Logger } from "@/shared/services/Logger"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"

export type SessionRebuildReason =
	| "provider"
	| "mcpTools"
	| "terminalExecutionMode"
	| "sessionAutoApprovalOverride"
	| "checkpoints"

/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01-CORRECTION03-MCP-TOOL-RESTART-CAUSAL-REPRODUCTION:
 *
 * Optional `isDeferredCompletionOutstanding` predicate gates the drain in
 * addition to the legacy `!isRunning` predicate. When wired (e.g. by
 * `SdkController` from the `SdkSessionEventCoordinator`), the scheduler
 * MUST NOT drain passive rebuilds while a deferred-completion obligation
 * is outstanding for the active session — the replacement transaction
 * would otherwise clear the active-session pointer mid-flight, the
 * post-run reevaluation would observe `getActiveSession() === undefined`,
 * and the deferred marker would be destroyed before the
 * terminal-accounting branch could drain it. This is the LIVE-class
 * failure ACT §0 documented: the rebuild fires while a deferred
 * obligation is still pending.
 *
 * Default: undefined -> predicate returns false -> predecessor semantics.
 * Existing tests (`sdk-session-rebuild-scheduler.test.ts`) pass with no
 * option wiring, preserving green.
 */
export interface SdkSessionRebuildSchedulerOptions {
	sessions: Pick<SdkSessionLifecycle, "getActiveSession">
	/**
	 * Optional predicate consulted on every drain cycle. Returning true means
	 * "the active session still owns a deferred-completion obligation that
	 * must be settled before any passive rebuild is allowed to fire".
	 * The scheduler treats a true return identically to `isRunning=true`
	 * for drain purposes: it stops checking the pending map and waits for
	 * the next `sessionBecameIdle` / `request` / `runExclusive` trigger.
	 *
	 * Optional. When absent, the predicate is treated as `false`
	 * (no deferred obligation), preserving the predecessor ACT's
	 * scheduler contract.
	 */
	isDeferredCompletionOutstanding?: () => boolean
}

/**
 * A rebuild replaces the session, so it may only run between turns. Core
 * drains its own prompt queue the moment a turn ends, so a session with
 * queued prompts is about to run again: treat it as busy until Core has
 * emptied the queue.
 *
 * ACT-CLINEMM-FORK-UPSTREAM-MERGE01: a session that does not REPORT a
 * queued-prompt count is not evidence of a busy session. `undefined` must
 * therefore be treated as "no queued prompts known" (idle), not as
 * "queued count unknown" (busy) — otherwise every session whose
 * `ActiveSession` predates the `queuedPromptCount` field (or whose host
 * does not populate it) can NEVER be rebuilt, and the pending rebuild
 * silently wedges forever.
 */
function isIdle(session: ReturnType<SdkSessionLifecycle["getActiveSession"]>): boolean {
	if (session === undefined || session.isRunning) {
		return false
	}
	return session.queuedPromptCount === undefined || session.queuedPromptCount === 0
}

export interface SessionRebuildContext {
	/**
	 * True until a newer request for the same reason arrives. A superseded
	 * rebuild should stop before replacing the session, or leave work it has
	 * not yet started to the newer rebuild, which runs next in the same drain.
	 */
	isCurrent: () => boolean
}

interface ScheduledRebuild {
	run: (context: SessionRebuildContext) => Promise<void>
	generation: number
}

/** Serializes passive session rebuilds and drains them only while the session is idle (see isIdle). */
export class SdkSessionRebuildScheduler {
	private readonly pending = new Map<SessionRebuildReason, ScheduledRebuild>()
	private drainInFlight: Promise<void> | undefined
	private deferredOutstandingPredicate: () => boolean
	private readonly latestGeneration = new Map<SessionRebuildReason, number>()

	constructor(private readonly options: SdkSessionRebuildSchedulerOptions) {
		// Bind the predicate to a stable reference; `setIsDeferredCompletionOutstanding`
		// mutates the reference (not the options field) so callers don't have to
		// reconstruct the scheduler.
		this.deferredOutstandingPredicate = options.isDeferredCompletionOutstanding ?? (() => false)
	}

	/**
	 * ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01-CORRECTION03-MCP-TOOL-RESTART-CAUSAL-REPRODUCTION:
	 *
	 * Lazily install (or replace) the deferred-completion-outstanding predicate
	 * consulted on every drain cycle. Wired by `SdkController` after
	 * `sessionEvents` is constructed (the scheduler is constructed earlier in
	 * the boot sequence to break a circular dep). Replaces the predicate
	 * reference; subsequent drain cycles consult the new predicate.
	 */
	setIsDeferredCompletionOutstanding(predicate: () => boolean): void {
		this.deferredOutstandingPredicate = predicate
	}

	/**
	 * Queues a rebuild, replacing any queued rebuild for the same reason. A
	 * rebuild for the same reason that is already running is superseded: its
	 * context.isCurrent() turns false and this request runs after it.
	 */
	request(reason: SessionRebuildReason, run: (context: SessionRebuildContext) => Promise<void>): void {
		const generation = (this.latestGeneration.get(reason) ?? 0) + 1
		this.latestGeneration.set(reason, generation)
		this.pending.set(reason, { run, generation })
		this.drainIfIdle()
	}

	/**
	 * Cancels a queued rebuild for the given reason.
	 *
	 * ACT-CLINEMM-SESSION-REBUILD-SCHEDULER-CANCEL01 (fork-owned behavior
	 * that upstream removed): upstream folded cancellation into
	 * `runTaskTransition` (which clears the whole pending map), but the
	 * fork needs to drop a SINGLE reason — e.g. a terminal-execution-mode
	 * change that is superseded by a newer request for the same reason,
	 * where the newer request must still be delivered.
	 *
	 * Cancelling bumps the reason's generation so an in-flight rebuild for
	 * the same reason observes `context.isCurrent() === false` and stops
	 * before replacing the session.
	 */
	cancel(reason: SessionRebuildReason): void {
		this.pending.delete(reason)
		this.latestGeneration.set(reason, (this.latestGeneration.get(reason) ?? 0) + 1)
	}

	async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
		while (this.drainInFlight) {
			await this.drainInFlight
		}
		let resolveExclusive: () => void = () => {}
		const exclusive = new Promise<void>((resolve) => {
			resolveExclusive = resolve
		})
		this.drainInFlight = exclusive
		try {
			return await operation()
		} finally {
			resolveExclusive()
			if (this.drainInFlight === exclusive) {
				this.drainInFlight = undefined
			}
			this.drainIfIdle()
		}
	}

	/**
	 * Moves the displayed task at the session-rebuild consistency boundary.
	 * Queued rebuilds belong to the outgoing session, so the transition drops
	 * them before ending that session. Rebuilds requested during the transition
	 * remain queued until the new task view is complete.
	 */
	async runTaskTransition<T>(operation: () => Promise<T>): Promise<T> {
		return this.runExclusive(async () => {
			this.pending.clear()
			return operation()
		})
	}

	sessionBecameIdle(): void {
		this.drainIfIdle()
	}

	/**
	 * ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01-CORRECTION03-MCP-TOOL-RESTART-CAUSAL-REPRODUCTION:
	 *
	 * External wake point used by `SdkController` (or its delegate) when a
	 * deferred-completion obligation settles (terminal count transitions
	 * to zero, or the marker is consumed through the terminal-accounting
	 * branch). The scheduler re-evaluates `drainIfIdle` immediately. If a
	 * passive rebuild was previously held behind the deferred predicate,
	 * it now drains.
	 *
	 * Idempotent. Safe to call repeatedly. Has no effect when no rebuild
	 * is pending or when the rebuild is not eligible (e.g. active session
	 * is running, no active session).
	 */
	deferredCompletionSettled(): void {
		this.drainIfIdle()
	}

	async waitUntilSettled(): Promise<void> {
		while (this.drainInFlight) {
			await this.drainInFlight
		}
	}

	private isDeferredCompletionOutstanding(): boolean {
		return this.deferredOutstandingPredicate()
	}

	private drainIfIdle(): void {
		const activeSession = this.options.sessions.getActiveSession()
		if (
			this.drainInFlight ||
			this.pending.size === 0 ||
			!activeSession ||
			activeSession.isRunning ||
			this.isDeferredCompletionOutstanding() ||
			!isIdle(activeSession)
		) {
			return
		}
		// Cloud sessions run on the sandbox with its own tools/provider; local
		// MCP, provider and terminal changes do not apply and must not rebuild
		// the sandbox conversation into a local one.
		if (activeSession.sdkHost && "isCloud" in activeSession.sdkHost) {
			this.pending.clear()
			return
		}

		// ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01-CORRECTION03-MCP-TOOL-RESTART-CAUSAL-REPRODUCTION:
		// Coalescing: snapshot the pending entries at drain-start. New
		// `request()` calls during the drain that REUSE an already-drained
		// reason are skipped by the auto-drain `drainedReasons` check
		// below (they belong to the same coalescing window as the
		// in-flight drain's snapshot). New entries whose reasons were not
		// in the snapshot (e.g. different rebuild reasons arriving
		// mid-drain) trigger a follow-on drain cycle.
		const snapshot: Array<[SessionRebuildReason, ScheduledRebuild]> = Array.from(this.pending.entries())
		// Mark every snapshotted reason as in-flight (delete from
		// `pending`) BEFORE any rebuild runs so a concurrent
		// `request(reason)` re-queues a fresh entry instead of being
		// absorbed by the in-flight drain.
		for (const [reason] of snapshot) {
			this.pending.delete(reason)
		}
		const drainedReasons: ReadonlySet<SessionRebuildReason> = new Set(snapshot.map(([reason]) => reason))

		// ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01-CORRECTION04-P1-CONSERVATION-SUFFIX:
		// Both early-return branches re-queue the SUFFIX of the snapshot
		// from `currentIndex` onward, not the entire snapshot. The
		// predecessor CORRECTION03 requeued the whole snapshot, which
		// re-inserted already-executed entries (e.g. `mcpTools` after the
		// first rebuild) into `pending`; the next drain cycle then
		// re-executed them, violating the conservation invariant
		// "requeue unexecuted entries, not replay executed ones".
		// Track the current index inside the async drain so the
		// branches below can slice from `snapshot[currentIndex..]`.
		let currentIndex = 0

		const drain = async (): Promise<void> => {
			for (; currentIndex < snapshot.length; currentIndex++) {
				const [reason, rebuild] = snapshot[currentIndex]
				const activeSession = this.options.sessions.getActiveSession()
				if (!activeSession) {
					// ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01-CORRECTION03-P1-CONSERVATION:
					// Session disappeared entirely (clear-task, dispose).
					// No reason to preserve the remaining snapshot — the
					// session is gone. Clear pending and bail.
					this.pending.clear()
					return
				}
				if (activeSession.isRunning) {
					// ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01-CORRECTION04-P1-CONSERVATION-SUFFIX:
					// The session became running mid-drain (a turn started).
					// Re-queue only the SUFFIX starting at `currentIndex`
					// (the unexecuted snapshot entries plus any that
					// arrived after the snapshot was taken). Already-
					// executed entries (snapshot[0..currentIndex]) must
					// NOT be re-inserted; otherwise the next drain cycle
					// re-runs them. Without the suffix slice, the
					// snapshot's `pending.delete(reason)` (executed BEFORE
					// the loop) would also have permanently removed the
					// unexecuted entries — that was the CORRECTION03
					// motivation for the requeue.
					for (const [requeueReason, requeueRebuild] of snapshot.slice(currentIndex)) {
						if (!this.pending.has(requeueReason)) {
							this.pending.set(requeueReason, requeueRebuild)
						}
					}
					return
				}
				if (!isIdle(activeSession)) {
					// ACT-CLINEMM-FORK-UPSTREAM-MERGE01: upstream added this
					// branch WITHOUT the suffix requeue that the
					// `isRunning` branch above performs. Returning here
					// DROPS the unexecuted snapshot entries permanently —
					// the `pending.delete(reason)` happened before the
					// loop — so a session that became busy mid-drain
					// silently loses its pending rebuilds and never
					// rebuilds again.
					//
					// The fork's conservation invariant ("requeue
					// unexecuted entries, not replay executed ones") applies
					// to EVERY early-return branch, not just the isRunning
					// one. Requeue the same suffix.
					for (const [requeueReason, requeueRebuild] of snapshot.slice(currentIndex)) {
						if (!this.pending.has(requeueReason)) {
							this.pending.set(requeueReason, requeueRebuild)
						}
					}
					return
				}
				if (this.isDeferredCompletionOutstanding()) {
					// ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01-CORRECTION04-P1-CONSERVATION-SUFFIX:
					// Hold the rebuild until the deferred obligation
					// settles. Same suffix-only requeue as the isRunning
					// branch above; the predecessor branch requeued the
					// whole snapshot and would replay already-executed
					// entries after the obligation settles.
					for (const [requeueReason, requeueRebuild] of snapshot.slice(currentIndex)) {
						if (!this.pending.has(requeueReason)) {
							this.pending.set(requeueReason, requeueRebuild)
						}
					}
					return
				}

				try {
					await rebuild.run({ isCurrent: () => rebuild.generation === this.latestGeneration.get(reason) })
				} catch (error) {
					Logger.error(`[SdkController] Failed scheduled ${reason} session rebuild:`, error)
				}
			}
		}

		this.drainInFlight = drain().finally(() => {
			this.drainInFlight = undefined
			// ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01-CORRECTION03:
			// Auto-drain if pending has entries with reasons NOT in the
			// just-completed snapshot. New `request(reason)` calls for an
			// already-drained reason are SKIPPED — they belong to the same
			// coalescing window as the just-finished drain. New entries
			// whose reasons were not in the snapshot (e.g. different
			// rebuild reasons) trigger a follow-on drain.
			let hasFollowOn = false
			for (const [reason] of this.pending.entries()) {
				if (!drainedReasons.has(reason)) {
					hasFollowOn = true
					break
				}
			}
			if (hasFollowOn) {
				this.drainIfIdle()
			}
		})
	}
}
