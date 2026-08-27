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

import type {
	TaskHeaderPresentationProjection,
	TaskHeaderTelemetryStrip,
	ThinkingPresentationProjection,
	TurnState,
} from "@shared/ExtensionMessage"
import type { PostTerminalAuthoritySnapshot } from "@shared/post-terminal-authority-diagnostic"
import type { MessageTranslatorState } from "./message-translator"
import type { ArbiterSnapshot } from "./task-state-shadow-recorder"

export interface BuildExtensionSnapshotArgs {
	state: {
		stateVersion?: number
		_ptadPushId?: number
		epoch?: number
		taskId?: string
		sessionId?: string
		turnState?: TurnState
		thinkingPresentation?: ThinkingPresentationProjection
		taskHeaderPresentation?: TaskHeaderPresentationProjection
		taskTelemetry?: TaskHeaderTelemetryStrip
	}
	shadow: ArbiterSnapshot | undefined
	runtime?: {
		status?: string
		executionModelStreaming?: boolean
		executionAwaitingApproval?: boolean
		pendingToolCalls?: number
	}
	/**
	 * ACT-CLINEMM-COMPLETION-PTAD-EXTEND01:
	 * Optional reference to the canonical translator state. When
	 * provided, the builder reads the two turn-outcome booleans
	 * (`wasAttemptCompletionSeen`,
	 * `wasTerminalResponseCommittedThisTurn`) and stamps them into
	 * the snapshot's `attemptCompletionSeen` and
	 * `terminalResponseCommittedThisTurn` fields.
	 *
	 * The `Pick<>` structural type deliberately limits the surface
	 * area: the builder cannot call `setAttemptCompletionSeen()` or
	 * `setTerminalResponseCommittedThisTurn()`, so it cannot mutate
	 * the translator. This is the structural embodiment of the
	 * `HALT_DIAGNOSTIC_MUTATES_MESSAGE_TRANSLATOR_SEMANTICS` stop
	 * condition — the type system forbids it.
	 *
	 * The caller's lifecycle owns this object; the builder does NOT
	 * retain the reference.
	 */
	readonly messageTranslatorState?: Pick<
		MessageTranslatorState,
		"wasAttemptCompletionSeen" | "wasTerminalResponseCommittedThisTurn"
	>
}

export function buildExtensionSnapshotFromState(args: BuildExtensionSnapshotArgs): PostTerminalAuthoritySnapshot {
	const { state, shadow, runtime } = args
	// The shadow IS the canonical runtime projection (per
	// task-state-shadow-recorder.ts:150 — the host wiring ensures these
	// reflect `AgentRuntime.snapshot()` at the moment of the observation).
	// When the caller does not pass an explicit runtime arg, derive the
	// runtime fields from the shadow so the post-terminal triage verdict
	// (which depends on the runtime truth source upstream of the trackers)
	// is always populated.
	return {
		origin: "extension",
		captureKind: "extension-push",
		stateVersion: state.stateVersion ?? 0,
		_ptadPushId: state._ptadPushId,
		capturedAt: Date.now(),
		epoch: state.epoch,
		sessionId: state.sessionId,
		taskId: state.taskId,
		runtimeStatus: runtime?.status ?? shadow?.status,
		runtimeModelStreaming: runtime?.executionModelStreaming ?? shadow?.execution?.modelStreaming,
		runtimeAwaitingApproval: runtime?.executionAwaitingApproval ?? shadow?.execution?.awaitingApproval,
		runtimePendingToolCount: runtime?.pendingToolCalls ?? shadow?.pendingToolCalls?.length,
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
		taskHeaderPresentation: state.taskHeaderPresentation,
		taskTelemetry: state.taskTelemetry,
		// ACT-CLINEMM-COMPLETION-PTAD-EXTEND01:
		// Read-only access via public accessors. The structural
		// `Pick<>` type on the args interface forbids calling any
		// setter method. `undefined` propagates verbatim when no
		// `messageTranslatorState` was supplied (e.g. PTAD-off path,
		// or the call site pre-EXTEND01).
		attemptCompletionSeen: args.messageTranslatorState?.wasAttemptCompletionSeen(),
		terminalResponseCommittedThisTurn: args.messageTranslatorState?.wasTerminalResponseCommittedThisTurn(),
	}
}
