import { Logger } from "@/shared/services/Logger"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"

export type SessionRebuildReason = "provider" | "mcpTools" | "terminalExecutionMode" | "sessionAutoApprovalOverride"

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

/** Serializes passive session rebuilds and drains them only while the session is idle. */
export class SdkSessionRebuildScheduler {
	private readonly pending = new Map<SessionRebuildReason, () => Promise<void>>()
	private drainInFlight: Promise<void> | undefined
	private deferredOutstandingPredicate: () => boolean

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

	request(reason: SessionRebuildReason, rebuild: () => Promise<void>): void {
		this.pending.set(reason, rebuild)
		this.drainIfIdle()
	}

	cancel(reason: SessionRebuildReason): void {
		this.pending.delete(reason)
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
			this.isDeferredCompletionOutstanding()
		) {
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
		const snapshot: Array<[SessionRebuildReason, () => Promise<void>]> = Array.from(this.pending.entries())
		// Mark every snapshotted reason as in-flight (delete from
		// `pending`) BEFORE any rebuild runs so a concurrent
		// `request(reason)` re-queues a fresh entry instead of being
		// absorbed by the in-flight drain.
		for (const [reason] of snapshot) {
			this.pending.delete(reason)
		}
		const drainedReasons: ReadonlySet<SessionRebuildReason> = new Set(snapshot.map(([reason]) => reason))

		const drain = async (): Promise<void> => {
			for (const [reason, rebuild] of snapshot) {
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
					// ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01-CORRECTION03-P1-CONSERVATION:
					// The session became running mid-drain (a turn started).
					// Re-queue the remaining snapshot entries (and any that
					// arrived after the snapshot was taken) so the next
					// drain cycle, when the session is idle again, picks
					// them up. Without this re-queue, the snapshot's
					// `pending.delete(reason)` (executed BEFORE the loop)
					// would have permanently removed them.
					for (const [requeueReason, requeueRebuild] of snapshot) {
						if (!this.pending.has(requeueReason)) {
							this.pending.set(requeueReason, requeueRebuild)
						}
					}
					return
				}
				if (this.isDeferredCompletionOutstanding()) {
					// ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01-CORRECTION03:
					// Hold the rebuild until the deferred obligation settles.
					// Re-queue the remaining snapshot entries (same P1
					// conservation rationale as the isRunning branch —
					// see above).
					for (const [requeueReason, requeueRebuild] of snapshot) {
						if (!this.pending.has(requeueReason)) {
							this.pending.set(requeueReason, requeueRebuild)
						}
					}
					return
				}

				try {
					await rebuild()
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
