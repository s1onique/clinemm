/**
 * ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01:
 *
 * Captures the six host-ownership facts at the SAME state-post
 * identity (`stateVersion` + `_ptadPushId`) as the existing PTAD
 * snapshot. Wraps the diagnostic ring-buffer with a synchronous,
 * opt-in side channel that lives next to the existing
 * `recordPostTerminalAuthoritySnapshot(...)` call site.
 *
 * The function is a pure, no-side-effects composer: it reads through
 * `sdkHost.captureHostOwnershipFacts?.(sessionId)` (the new
 * `@cline/core` accessor added for this ACT) and the
 * `SdkSessionLifecycle` host-side mirror `isRunning`, then records
 * the assembled snapshot into the diagnostic ring buffer.
 *
 * Never read by production projection. Privacy-safe: no message
 * prose, no tool arguments/outputs, no model output, no API payloads.
 */

import type { SdkSessionHost } from "@/sdk/session-host"
import type { ActiveSession as VscodeActiveSession } from "@/sdk/cline-session-factory"
import {
	recordHostOwnershipFacts,
	isHostOwnershipDiagnosticEnabled,
	deriveCandidateAwaitingFollowup,
	type HostOwnershipFactsSnapshot,
} from "@/shared/host-ownership-diagnostic"

export interface CaptureHostOwnershipFactsArgs {
	readonly stateVersion: number
	readonly _ptadPushId?: number
	readonly sessionId: string | undefined
	readonly sessionIsRunning: boolean
	readonly sdkHost: SdkSessionHost
}

/**
 * Synchronously capture and record the host-ownership facts. No-op
 * when the diagnostic is disabled or any of the required reads
 * returns `undefined`. The composed snapshot's `capturedAt` is the
 * call-time `Date.now()`; the `_ptadPushId` is forwarded verbatim
 * from the caller so the PTAD-synchronized identity holds.
 */
export function captureAndRecordHostOwnershipFacts(args: CaptureHostOwnershipFactsArgs): void {
	if (!isHostOwnershipDiagnosticEnabled()) return
	const rawFacts = args.sdkHost.captureHostOwnershipFacts?.(args.sessionId)
	if (!rawFacts) return
	const enriched: HostOwnershipFactsSnapshot = {
		...rawFacts,
		sessionIsRunning: args.sessionIsRunning,
		candidateAwaitingFollowup: deriveCandidateAwaitingFollowup({
			...rawFacts,
			sessionIsRunning: args.sessionIsRunning,
		}),
		_ptadPushId: args._ptadPushId,
		capturedAt: Date.now(),
	}
	recordHostOwnershipFacts(enriched)
}

/**
 * Helper for callers that have the `SdkSessionLifecycle`-tracked
 * `ActiveSession` in hand and do not want to extract the
 * `sessionIsRunning` + `sdkHost` fields themselves.
 */
export function captureFromActiveSession(
	stateVersion: number,
	_ptadPushId: number | undefined,
	activeSession: VscodeActiveSession | undefined,
): void {
	if (!activeSession) return
	captureAndRecordHostOwnershipFacts({
		stateVersion,
		_ptadPushId,
		sessionId: activeSession.sessionId,
		sessionIsRunning: activeSession.isRunning,
		sdkHost: activeSession.sdkHost,
	})
}
