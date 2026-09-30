/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-RUN-IDENTITY-LIVE-REPAIR01
 *
 * PRODUCTION-SEAM capture-object factory for
 * `VscodeSessionHost`. The returned `pendingPromptCapture`
 * object is passed verbatim to the `LocalRuntimeHost` constructor
 * at `apps/vscode/src/sdk/vscode-session-host.ts`. Tests import
 * this SAME factory so they exercise the SAME code path.
 *
 * Why extracted:
 *   Per ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01-
 *   CORRECTION01 reviewer P0 ("Wrong RED seam — synthetic adapter
 *   input presented as proof of production capture"), tests must
 *   not mirror production inline; they must invoke the SAME
 *   callbacks production invokes. This factory is the single
 *   source of truth for the six capture sites
 *   (`onEnqueue`, `onBeforeDrain`, `onBeforeDispatch`,
 *   `onRunTurnStarted`, `onAgentTurnDone`,
 *   `onExecuteTurnPreludeEnter`).
 *
 * Diagnostic-only: the returned object never influences
 * run-whether / run-completion / continuation / completion
 * authorization / queueing / presentation / MCP / myc. When the
 * CCARD seam is OFF, every callback is a complete no-op.
 */

import { setHeldContinuationPromptForSession } from "./canonical-event-subscription"
import { captureContinuationCardinalityAuthorityRecord } from "./continuation-cardinality-authority"
import { recordAgentTurnDone, recordRunStart } from "./continuation-cardinality-authority.runtime-capture"

export function deriveOrigin(
	delivery: "queue" | "steer" | undefined,
	jobId?: string,
): "pending_prompt_drain" | "deferred_continuation" | "explicit_user" {
	if (delivery === "queue") return "pending_prompt_drain"
	if (delivery === "steer") return "deferred_continuation"
	if (jobId !== undefined) return "pending_prompt_drain"
	return "explicit_user"
}

/**
 * Build the production-shape `pendingPromptCapture` object. The
 * SAME object is passed to `LocalRuntimeHost` in production
 * (`vscode-session-host.ts`) and in tests (the
 * `completion-authority-run-identity-live-repair01.test.ts`
 * bridge test). Any change here changes BOTH surfaces.
 */
export function createProductionPendingPromptCapture(): {
	onEnqueue: (input: { sessionId: string; delivery: "queue" | "steer" | undefined; jobId?: string; promptId: string }) => void
	onBeforeDrain: (input: {
		sessionId: string
		delivery: "queue" | "steer" | undefined
		jobId?: string
		promptId: string
	}) => void
	onBeforeDispatch: (input: {
		sessionId: string
		delivery: "queue" | "steer" | undefined
		jobId?: string
		promptId: string
	}) => void
	onRunTurnStarted: (input: { sessionId: string; delivery: "queue" | "steer" | undefined; jobId?: string }) => void
	onAgentTurnDone: (input: {
		sessionId: string
		finishReason: string
		delivery: "queue" | "steer" | undefined
		jobId?: string
	}) => void
	onExecuteTurnPreludeEnter?: (input: { sessionId: string; delivery: "queue" | "steer" | undefined; jobId?: string }) => void
} {
	return {
		onEnqueue: (input) => {
			captureContinuationCardinalityAuthorityRecord({
				stage: "pending_prompt_enqueued",
				origin: deriveOrigin(input.delivery, input.jobId),
				sessionId: input.sessionId,
				promptId: input.promptId,
				...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
			})
		},
		onBeforeDrain: (input) => {
			captureContinuationCardinalityAuthorityRecord({
				stage: "pending_prompt_dequeued",
				origin: deriveOrigin(input.delivery, input.jobId),
				sessionId: input.sessionId,
				promptId: input.promptId,
				...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
			})
		},
		onBeforeDispatch: (input) => {
			captureContinuationCardinalityAuthorityRecord({
				stage: "continuation_scheduled",
				origin: deriveOrigin(input.delivery, input.jobId),
				sessionId: input.sessionId,
				promptId: input.promptId,
				...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
			})
			setHeldContinuationPromptForSession(input.sessionId, input.promptId)
		},
		onRunTurnStarted: (input) => {
			recordRunStart(input)
		},
		onAgentTurnDone: (input) => {
			recordAgentTurnDone(input)
		},
		onExecuteTurnPreludeEnter: (input) => {
			captureContinuationCardinalityAuthorityRecord({
				stage: "execute_turn_prelude_enter",
				origin: deriveOrigin(input.delivery, input.jobId),
				sessionId: input.sessionId,
				...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
			})
		},
	}
}
