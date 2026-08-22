/**
 * ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01
 *
 * T0 host-ownership diagnostic. Captures the six host-side facts that
 * the LIVE-T1 symptom reproduction needs (per recon, dc3e2a129), at
 * the SAME publication identity as the existing PTAD snapshot
 * (`stateVersion` + `_ptadPushId`):
 *
 *   lastInteractiveTurnFinishReason
 *   session.status
 *   session.isRunning (host-side mirror, not @cline/core session.status)
 *   pendingPrompts.length
 *   drainingPendingPrompts
 *   agent.canStartRun()
 *
 * Plus an optional DIAGNOSTIC_DERIVATION_ONLY `candidateAwaitingFollowup`
 * field, computed from the raw host facts as a HYPOTHESIS_ONLY formula
 * for forensic comparison only. NEVER participates in production
 * projection (see ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01
 * recon doc §"Provisional working-vs-waiting truth table (NOT FROZEN)"
 * for why the formula is not yet trustworthy).
 *
 * Hard constraints (per Factory guidance, C1: GO EVIDENCE):
 *   - DEFAULT_OFF
 *   - explicitly opt-in (call `enableHostOwnershipDiagnostic()`)
 *   - bounded (default 64 records; settable for tests)
 *   - removable (single boolean enables/disables; no production state
 *     depends on the read path)
 *   - zero semantic delta while disabled
 *   - no public product API (NO state field, NO wire field)
 *   - no message/protocol field
 *   - no mutation of runtime/session state
 *   - no side effects inside functional React updaters
 *   - no timers, no polling state machine
 *
 * Removal trigger (per Factory §12):
 *   first of (root cause classified, capture insufficient,
 *   successor evidence supersedes this diagnostic) -- then this module
 *   is deleted in its entirety.
 */

import type { AgentFinishReason } from "@cline/shared"

const DEFAULT_BUFFER_SIZE = 64

/**
 * Raw host-side facts, as observed at the SAME state-post identity
 * (`stateVersion` + `_ptadPushId`) as the rest of the PTAD snapshot.
 * Every field is optional so a partial read (e.g. session has been
 * disposed, host accessor absent on a non-LocalRuntimeHost) records
 * as `undefined` rather than synthesizing a default value.
 */
export interface HostOwnershipFactsSnapshot {
	/** Last user-interactive turn's `AgentFinishReason`. Stale through the idle gap. */
	readonly lastInteractiveTurnFinishReason?: AgentFinishReason
	/** `@cline/core` `ActiveSession.status`. Flips to "idle" at `markTurnIdle`. */
	readonly sessionStatus?: string
	/** Host-side mirror in `SdkSessionLifecycle`. Flips to `false` at the same moment. */
	readonly sessionIsRunning?: boolean
	/** Number of queued prompts awaiting drain. */
	readonly pendingPromptCount?: number
	/** True while `PendingPromptsController.drain()` is in flight. */
	readonly drainingPendingPrompts?: boolean
	/** True iff the agent runtime reports it can start a new run. */
	readonly agentCanStartRun?: boolean

	/**
	 * DIAGNOSTIC_DERIVATION_ONLY. Hypothetical `awaitingFollowup`
	 * computed by a HYPOTHESIS_ONLY formula from the raw facts above.
	 * NEVER consumed by the canonical TaskHeader projection. Exists
	 * only so the forensic analyzer can compare this derivation
	 * against the eventual truthful projection. Production projection
	 * NEVER reads this field.
	 */
	readonly candidateAwaitingFollowup?: boolean

	/**
	 * Correlates this snapshot with the rest of the PTAD capture on
	 * the same `_ptadPushId`. Set by the caller; the diagnostic does
	 * not mint the id.
	 */
	readonly _ptadPushId?: number
	/** Wall-clock at capture. Diagnostic-only; not authoritative. */
	readonly capturedAt: number
}

/**
 * Identity fields kept identical to `PostTerminalAuthoritySnapshot` so
 * the analyzer can join on `stateVersion` + `_ptadPushId` without a
 * separate key. The diagnostic intentionally does NOT re-export or
 * subclass the PTAD type -- it remains a side-channel that the analyzer
 * correlates on identity fields.
 */
export interface HostOwnershipIdentity {
	readonly stateVersion: number
	readonly _ptadPushId?: number
	readonly taskId?: string
	readonly sessionId?: string
	readonly epoch?: number
}

// =============================================================================
// Bounded ring buffer
// =============================================================================

interface SideBuffer {
	enabled: boolean
	records: HostOwnershipFactsSnapshot[]
	seq: number
	bufferSize: number
}

function emptySideBuffer(): SideBuffer {
	return { enabled: false, records: [], seq: 0, bufferSize: DEFAULT_BUFFER_SIZE }
}

const extensionSide: SideBuffer = emptySideBuffer()

export function enableHostOwnershipDiagnostic(): void {
	extensionSide.enabled = true
}

export function disableHostOwnershipDiagnostic(): void {
	extensionSide.enabled = false
}

export function setHostOwnershipDiagnosticBufferSize(n: number): void {
	extensionSide.bufferSize = Math.max(0, Math.floor(n))
}

export function isHostOwnershipDiagnosticEnabled(): boolean {
	return extensionSide.enabled
}

export function clearHostOwnershipDiagnostic(): void {
	extensionSide.records = []
	extensionSide.seq = 0
}

/**
 * Append one record. No-op when disabled. The bounded ring is FIFO:
 * when the buffer is full, drop the oldest record. The internal `seq`
 * counter is independent of the wire `stateVersion` so callers can use
 * it for assertion without coupling to the wire protocol.
 */
export function recordHostOwnershipFacts(snapshot: HostOwnershipFactsSnapshot): void {
	if (!extensionSide.enabled) return
	extensionSide.seq += 1
	extensionSide.records.push(snapshot)
	const overflow = extensionSide.records.length - extensionSide.bufferSize
	if (overflow > 0) {
		extensionSide.records.splice(0, overflow)
	}
}

export function getHostOwnershipDiagnostic(): HostOwnershipFactsSnapshot[] {
	return extensionSide.records.slice()
}

/**
 * The HYPOTHESIS_ONLY candidate formula, isolated here so the
 * FACTORY_REVIEWER-attested restriction "do not implement the
 * provisional awaitingFollowup formula" is enforced by code: this
 * function is only reachable via the opt-in diagnostic capture, and
 * its result is stamped onto `HostOwnershipFactsSnapshot` with the
 * `DIAGNOSTIC_DERIVATION_ONLY` field. Production projection paths do
 * NOT import this function and do NOT read the field.
 *
 * The formula (from the recon doc, NOT frozen):
 *
 *   awaitingFollowup =
 *     (lastInteractiveTurnFinishReason === "completed")    // user-owned previous turn
 *   AND NOT (
 *     pendingPromptCount > 0                              // queued successor will run
 *     AND agentCanStartRun === true                       // session can accept it
 *   )
 *   AND NOT (
 *     drainingPendingPrompts === true                      // queued drain in flight now
 *   )
 */
export function deriveCandidateAwaitingFollowup(
	facts: Omit<HostOwnershipFactsSnapshot, "candidateAwaitingFollowup" | "capturedAt" | "_ptadPushId">,
): boolean | undefined {
	if (facts.lastInteractiveTurnFinishReason === undefined) return undefined
	const previousTurnWasUserOwned = facts.lastInteractiveTurnFinishReason === "completed"
	const queuedSuccessorWillRun =
		(facts.pendingPromptCount ?? 0) > 0 && facts.agentCanStartRun === true
	const drainInFlight = facts.drainingPendingPrompts === true
	return previousTurnWasUserOwned && !queuedSuccessorWillRun && !drainInFlight
}

/** Canonical diagnostic identity constant for test assertions. */
export const HOST_OWNERSHIP_DIAGNOSTIC_ID = "host-ownership-diagnostic@1" as const
