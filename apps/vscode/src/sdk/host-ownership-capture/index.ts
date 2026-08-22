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
 */
export interface HostOwnershipProbe {
	readonly readHostFacts?: (
		sessionId: string | undefined,
	) => Promise<HostOwnershipHostFacts | undefined> | HostOwnershipHostFacts | undefined
}

export interface HostOwnershipHostFacts {
	readonly lastInteractiveTurnFinishReason?: import("@cline/shared").AgentFinishReason
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
	readonly sessionIsRunning: boolean
	readonly probe: HostOwnershipProbe | undefined
}

/**
 * Synchronously capture and record the host-ownership facts. No-op
 * when the diagnostic is disabled or any of the required reads
 * returns `undefined`. The composed snapshot's `capturedAt` is the
 * call-time `Date.now()`; the `_ptadPushId` is forwarded verbatim
 * from the caller so the PTAD-synchronized identity holds.
 */
export async function captureAndRecordHostOwnershipFacts(args: CaptureHostOwnershipFactsArgs): Promise<void> {
	if (!isHostOwnershipDiagnosticEnabled()) return
	const observationAvailable = !!args.probe && typeof args.probe.readHostFacts === "function"
	let rawFacts: HostOwnershipHostFacts | undefined
	if (observationAvailable && args.probe) {
		rawFacts = await args.probe.readHostFacts(args.sessionId)
	}
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
 * `ActiveSession` in hand and do not want to extract the
 * `sessionIsRunning` + `sdkHost` fields themselves.
 */
export async function captureFromActiveSession(
	stateVersion: number,
	_ptadPushId: number | undefined,
	taskId: string | undefined,
	epoch: number | undefined,
	activeSession: VscodeActiveSession | undefined,
): Promise<void> {
	if (!activeSession) return
	await captureAndRecordHostOwnershipFacts({
		stateVersion,
		_ptadPushId,
		taskId,
		epoch,
		sessionId: activeSession.sessionId,
		sessionIsRunning: activeSession.isRunning,
		probe: activeSession.sdkHost as unknown as HostOwnershipProbe,
	})
}
