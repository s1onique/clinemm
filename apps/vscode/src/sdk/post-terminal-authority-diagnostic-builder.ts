/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01
 *
 * Extension-side helper that builds a PostTerminalAuthoritySnapshot
 * from the post-construction state object the SdkController hands to
 * the webview. The pure type/utility code lives in
 * `apps/vscode/src/shared/post-terminal-authority-diagnostic.ts` so
 * the webview bundle can also import it; this file is the
 * extension-only "rich" helper that pulls the shadow detail from the
 * `ArbiterSnapshot`.
 *
 * Pure: no side effects, no I/O, no allocation beyond the returned
 * object. Called by SdkController.getStateToPostToWebview() just
 * before the return statement, gated by the diagnostic enable flag.
 */

import type { TaskHeaderTelemetryStrip, ThinkingPresentationProjection, TurnState } from "@shared/ExtensionMessage"
import type { PostTerminalAuthoritySnapshot } from "@shared/post-terminal-authority-diagnostic"
import type { ArbiterSnapshot } from "./task-state-shadow-recorder"

export interface BuildExtensionSnapshotArgs {
	state: {
		stateVersion?: number
		epoch?: number
		taskId?: string
		sessionId?: string
		turnState?: TurnState
		thinkingPresentation?: ThinkingPresentationProjection
		taskTelemetry?: TaskHeaderTelemetryStrip
	}
	shadow: ArbiterSnapshot | undefined
	runtime?: {
		status?: string
		executionModelStreaming?: boolean
		executionAwaitingApproval?: boolean
		pendingToolCalls?: number
	}
}

export function buildExtensionSnapshotFromState(args: BuildExtensionSnapshotArgs): PostTerminalAuthoritySnapshot {
	const { state, shadow, runtime } = args
	return {
		origin: "extension",
		stateVersion: state.stateVersion ?? 0,
		capturedAt: Date.now(),
		epoch: state.epoch,
		sessionId: state.sessionId,
		taskId: state.taskId,
		runtimeStatus: runtime?.status,
		runtimeModelStreaming: runtime?.executionModelStreaming,
		runtimeAwaitingApproval: runtime?.executionAwaitingApproval,
		runtimePendingToolCount: runtime?.pendingToolCalls,
		shadowStatus: shadow?.status,
		shadowRecoveryState: shadow?.recoveryState,
		shadowModelStreaming: shadow?.execution?.modelStreaming,
		shadowTooling: shadow?.execution?.tooling,
		shadowAwaitingApproval: shadow?.execution?.awaitingApproval,
		shadowPendingToolCount: shadow?.pendingToolCalls?.length,
		legacyPhase: state.turnState?.phase,
		legacySeq: state.turnState?.seq,
		legacyAnchorTs: state.turnState?.anchorTs,
		thinkingPresentation: state.thinkingPresentation,
		taskTelemetry: state.taskTelemetry,
	}
}
