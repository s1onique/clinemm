/**
 * ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01-CORRECTION02
 *
 * T0 host-ownership diagnostic capture helper. Synchronous end-to-end:
 * identity is stamped, host facts are read, and the ring is appended
 * inside ONE JavaScript turn with NO microtask boundary.
 *
 * The previous CORRECTION01 used `async`/`await` everywhere. The await
 * of an already-resolved Promise yields execution to the microtask
 * queue; that introduced a microtask boundary between the snapshot
 * identity stamp and the host-facts read, which means the same labels
 * could end up stamped onto a later observation. CORRECTION02 restores
 * the synchronous chain so the record is genuinely
 * "snapshot identity -> host facts -> ring append" in one turn.
 *
 * Hard constraints (per Factory C1: GO EVIDENCE):
 *   - DEFAULT_OFF
 *   - explicitly opt-in (call `enableHostOwnershipDiagnostic()`)
 *   - bounded (default 64 records; settable for tests)
 *   - removable (single boolean enables/disables; no production state
 *     depends on the read path)
 *   - zero semantic delta while disabled
 *   - no public product API surface beyond the explicitly-labeled
 *     `RuntimeHost.captureHostOwnershipFacts?` interface method and
 *     `ClineCore.captureHostOwnershipFacts` class method (both carry
 *     `PUBLIC API DELTA: yes / PROVISIONAL` JSDoc, matching the
 *     existing `getActiveRuntimeSnapshot` precedent).
 *   - no message/protocol field
 *   - no mutation of runtime/session state
 *   - no timers, no polling state machine
 *
 * Removal trigger (per Factory §12):
 *   first of (root cause classified, capture insufficient,
 *   successor evidence supersedes this diagnostic) -- then this module
 *   is deleted in its entirety.
 */

import type { AgentFinishReason } from "@cline/shared"
import type { ActiveSession as VscodeActiveSession } from "@/sdk/cline-session-factory"
import {
	recordHostOwnershipFacts,
	isHostOwnershipDiagnosticEnabled,
	deriveCandidateAwaitingFollowup,
	type HostOwnershipFactsSnapshot,
} from "@/shared/host-ownership-diagnostic"

/**
 * The shape of the host-specific probe. This is intentionally a duck-typed
 * local interface, NOT `SdkSessionHost` -- the host ownership observation
 * is host-only (`VscodeSessionHost.readHostFacts`) following the precedent
 * of `cancelBackgroundCommand`. Hub/Remote hosts that don't extend the
 * local shape will read as `undefined` and produce correlated unavailable
 * rows.
 *
 * SYNCHRONOUS by design (CORRECTION02). The probe must read host facts
 * and return them without crossing an `await` boundary; the underlying
 * `LocalRuntimeHost.captureHostOwnershipFacts` is already synchronous
 * and the chain stays synchronous end-to-end.
 */
export interface HostOwnershipProbe {
	readonly readHostFacts?: (
		sessionId: string | undefined,
	) => HostOwnershipHostFacts | undefined
}

export interface HostOwnershipHostFacts {
	readonly lastInteractiveTurnFinishReason?: AgentFinishReason
	readonly sessionStatus?: string
	readonly pendingPromptCount?: number
	readonly drainingPendingPrompts?: boolean
	readonly agentCanStartRun?: boolean
}

export interface CaptureHostOwnershipFactsArgs {
	readonly stateVersion: number
	readonly _ptadPushId?: number
	readonly taskId?: string
	readonly epoch?: number
	readonly sessionId: string | undefined
	readonly sessionIsRunning: boolean | undefined
	readonly probe: HostOwnershipProbe | undefined
}

/**
 * Append one record to the diagnostic ring. SYNCHRONOUS end-to-end:
 *
 *   disable-check -> probe check -> probe.readHostFacts() -> ring.append
 *
 * No `await`, no `Promise`. The probe is invoked synchronously and its
 * return value is stamped onto the ring in the same JavaScript turn.
 *
 * ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01-CORRECTION02:
 * The `sessionId` parameter is now genuinely "available from the same
 * state-post invocation as the identity fields" -- NOT from a
 * later-obtained `ActiveSession.sdkHost`. The caller (`captureFromActiveSession`
 * OR the new `captureIdentityOnly` path) is responsible for ensuring
 * that identity and sessionId come from the same synchronous tuple.
 *
 * When the diagnostic is disabled, no record is appended.
 * When the probe is absent OR `probe.readHostFacts` is absent OR the
 * probe returns `undefined`, a correlated `observationAvailable: false`
 * row is appended (identity fields stamped verbatim, six raw facts
 * undefined). This is the CORRECTION01 absence-explicit contract.
 */
export function captureAndRecordHostOwnershipFacts(args: CaptureHostOwnershipFactsArgs): void {
	if (!isHostOwnershipDiagnosticEnabled()) return

	const probeHasRead = !!args.probe && typeof args.probe.readHostFacts === "function"
	const rawFacts = probeHasRead && args.probe ? args.probe.readHostFacts(args.sessionId) : undefined

	const enriched: HostOwnershipFactsSnapshot = {
		stateVersion: args.stateVersion,
		_ptadPushId: args._ptadPushId,
		taskId: args.taskId,
		epoch: args.epoch,
		sessionId: args.sessionId,
		sessionIsRunning: args.sessionIsRunning,
		observationAvailable: rawFacts !== undefined,
		...rawFacts,
		candidateAwaitingFollowup: rawFacts
			? deriveCandidateAwaitingFollowup({
					...rawFacts,
					sessionIsRunning: args.sessionIsRunning,
				})
			: undefined,
		capturedAt: Date.now(),
	}
	recordHostOwnershipFacts(enriched)
}

/**
 * Helper for callers that have the `SdkSessionLifecycle`-tracked
 * `ActiveSession` in hand. SYNCHRONOUS end-to-end (CORRECTION02).
 *
 * Behavior matrix:
 *   - diagnostic disabled           -> no record
 *   - activeSession undefined       -> correlated observationAvailable=false
 *                                       row stamped with identity fields
 *   - activeSession.sdkHost absent  -> correlated observationAvailable=false
 *                                       row stamped with identity fields
 *   - successful probe read         -> observationAvailable=true row
 *
 * NEVER synthesizes host facts (lastInteractiveTurnFinishReason, status,
 * pendingPromptCount, drainingPendingPrompts, agentCanStartRun). When the
 * probe is absent or returns undefined, those fields are undefined.
 */
export function captureFromActiveSession(
	stateVersion: number,
	_ptadPushId: number | undefined,
	taskId: string | undefined,
	epoch: number | undefined,
	activeSession: VscodeActiveSession | undefined,
): void {
	if (!activeSession) {
		// CORRECTION02 P1 fix: emit a correlated unavailable row using the
		// identity fields the caller already has. The diagnostic ring is
		// allowed to record `observationAvailable: false` rows -- they
		// prove that the capture ran at this identity even when the host
		// session was absent.
		captureAndRecordHostOwnershipFacts({
			stateVersion,
			_ptadPushId,
			taskId,
			epoch,
			sessionId: undefined,
			sessionIsRunning: undefined,
			probe: undefined,
		})
		return
	}

	captureAndRecordHostOwnershipFacts({
		stateVersion,
		_ptadPushId,
		taskId,
		epoch,
		sessionId: activeSession.sessionId,
		sessionIsRunning: activeSession.isRunning,
		probe: activeSession.sdkHost as unknown as HostOwnershipProbe,
	})
}
