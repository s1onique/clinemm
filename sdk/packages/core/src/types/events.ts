import type { CoreSessionSnapshot } from "../session/session-snapshot";

export interface SessionChunkEvent {
	sessionId: string;
	stream: "stdout" | "stderr" | "agent";
	chunk: string;
	ts: number;
}

export interface SessionEndedEvent {
	sessionId: string;
	reason: string;
	ts: number;
}

export interface SessionToolEvent {
	sessionId: string;
	hookEventName:
		| "tool_call"
		| "tool_result"
		| "agent_end"
		| "agent_error"
		| "session_shutdown";
	agentId?: string;
	conversationId?: string;
	parentAgentId?: string;
	iteration?: number;
	toolName?: string;
	inputTokens?: number;
	outputTokens?: number;
	ts?: string;
}

export interface SessionTeamProgressEvent {
	sessionId: string;
	teamName: string;
	lifecycle: import("@cline/shared").TeamProgressLifecycleEvent;
	summary: import("@cline/shared").TeamProgressSummary;
}

export interface SessionPendingPrompt {
	id: string;
	prompt: string;
	delivery: "queue" | "steer";
	attachmentCount: number;
	userImages?: string[];
	userFiles?: string[];
	/**
	 * ACT-CLINEMM-P0-POST-TERMINAL-WORKING-CANCEL-REPRO01-CORRECTION01-PROMPT-ORIGIN01
	 * / B2PO01: the STRUCTURAL ORIGIN discriminator, carried alongside
	 * the pending prompt so the hub transport can forward it to the
	 * extension host unchanged.
	 *
	 * See `SessionPendingPromptSubmittedEvent.runtimeControlKind` for the
	 * full rationale. The inline `import(...)` form avoids a circular
	 * import (the `pending-prompt-service` module imports this module).
	 */
	runtimeControlKind?: import("../runtime/turn-queue/pending-prompt-service").RuntimeControlKind;
}

export interface SessionPendingPromptsEvent {
	sessionId: string;
	prompts: SessionPendingPrompt[];
}

export interface SessionPendingPromptSubmittedEvent {
	sessionId: string;
	id: string;
	prompt: string;
	delivery: "queue" | "steer";
	attachmentCount: number;
	userImages?: string[];
	userFiles?: string[];
	/**
	 * ACT-CLINEMM-P0-POST-TERMINAL-WORKING-CANCEL-REPRO01-CORRECTION01-PROMPT-ORIGIN01
	 * / B2PO01: the STRUCTURAL ORIGIN discriminator of the drained
	 * prompt.
	 *
	 * WHY THIS FIELD EXISTS:
	 *   The `pending_prompt_submitted` event is the ONLY signal the
	 *   extension host receives when the runtime queue dispatches a
	 *   prompt. Until now it carried NO origin bit, so the host could
	 *   not tell the host-owned BCB continuation apart from an
	 *   INDEPENDENT USER-TYPED follow-up — even though BOTH travel
	 *   through the SAME queue with `delivery: "queue"`:
	 *
	 *     - the BCB's own continuation:
	 *       `SdkController.buildSdkControllerEnqueueCompletionContinuation`
	 *       -> `sdkHost.send({ ..., delivery: "queue",
	 *           runtimeControlKind: "completion_continuation_control" })`
	 *     - a user-typed follow-up:
	 *       `SdkFollowupCoordinator.queueToActiveSession`
	 *       -> `sessions.fireAndForgetSend(..., "queue")`
	 *       (NO `runtimeControlKind`)
	 *
	 *   `PendingPromptEntry.runtimeControlKind` ALREADY existed and
	 *   already survived the queue round-trip — but `snapshotPrompt`
	 *   DROPPED it and `emitSubmitted` never forwarded it, so the
	 *   discriminator was LOST exactly at the event boundary the host
	 *   reads.
	 *
	 *   The consequence was a real production-reachable mismatch: the
	 *   B2 BCB-hold guard (which suppresses the `streaming` phase
	 *   re-assertion while the barrier holds) suppressed it for an
	 *   INDEPENDENT user prompt too, leaving the runtime genuinely
	 *   running while the committed phase stayed `resumable`.
	 *
	 *   The inline `import(...)` form avoids a circular import: the
	 *   `pending-prompt-service` module already imports this module.
	 */
	runtimeControlKind?: import("../runtime/turn-queue/pending-prompt-service").RuntimeControlKind;
}

export interface SessionSnapshotEvent {
	sessionId: string;
	snapshot: CoreSessionSnapshot;
}

export type CoreSessionEvent =
	| { type: "chunk"; payload: SessionChunkEvent }
	| {
			type: "agent_event";
			payload: {
				sessionId: string;
				event: import("@cline/shared").AgentEvent;
				/** Identifies the named agent within the team (e.g. "educator", "assessor", "coordinator") for both lead and teammate agents */
				teamAgentId?: string;
				/** Whether this is the lead agent or a teammate */
				teamRole?: "lead" | "teammate";
			};
	  }
	| { type: "team_progress"; payload: SessionTeamProgressEvent }
	| { type: "pending_prompts"; payload: SessionPendingPromptsEvent }
	| {
			type: "pending_prompt_submitted";
			payload: SessionPendingPromptSubmittedEvent;
	  }
	| { type: "session_snapshot"; payload: SessionSnapshotEvent }
	| { type: "ended"; payload: SessionEndedEvent }
	| { type: "hook"; payload: SessionToolEvent }
	| { type: "status"; payload: { sessionId: string; status: string } };
