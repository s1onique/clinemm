/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-RUN-IDENTITY-LIVE-REPAIR01
 *
 * PRODUCTION-SEAM helpers for the run-start authority and the
 * agent-turn-done capture sites.
 *
 * Why extracted:
 *   The `VscodeSessionHost` wires these captures inline (closure
 *   inside the constructor). Tests that exercise the REAL seam
 *   must invoke the SAME function that production invokes,
 *   otherwise the test mirrors production in its own harness and
 *   cannot observe a regression (or repair) of the production
 *   code. Per ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-
 *   EXTENSION01-CORRECTION01 reviewer P0 ("Wrong RED seam —
 *   synthetic adapter input presented as proof of production
 *   capture"), this pattern is forbidden.
 *
 * Contract:
 *   - `recordRunStart(...)`: caller-side C7 capture. PRE-repair
 *     emits `run_turn_started` here. POST-repair this helper is a
 *     no-op (the authoritative emission moved to the
 *     canonical-event subscription). The hook input is preserved
 *     so callers may still observe C7 entry if they need to.
 *   - `recordAgentTurnDone(...)`: C8 capture. PRE-repair emits
 *     `agent_turn_done` with NO `runId`. POST-repair reads the
 *     runId retained by `canonical-event-subscription.ts` and
 *     emits `agent_turn_done` with the same runId as its
 *     authoritative `run_turn_started`.
 *   - `deriveOrigin(...)`: same derivation as
 *     `vscode-session-host.ts` (delivery precedence + jobId
 *     fallback). Extracted so the test seam uses the SAME
 *     function.
 *
 * Diagnostic-only: never read on any production code path that
 * influences run-whether / run-completion / continuation /
 * completion authorization / queueing / presentation / MCP / myc.
 * Zero semantic delta when the capture seam is OFF.
 */

import { getRunIdForSession } from "./canonical-event-subscription"
import { captureContinuationCardinalityAuthorityRecord } from "./continuation-cardinality-authority"

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
 * Caller-side C7 capture. PRE-repair: emits `run_turn_started`
 * with the caller-side origin (no runId). POST-repair: no-op
 * because the authoritative `run_turn_started` emission moved to
 * the canonical-event subscription.
 *
 * Toggle via `setCallerSideRunStartCaptureEnabled(...)`. Default
 * OFF (post-repair state). The toggle exists so the test can
 * reproduce the pre-repair dual-emission defect by flipping it
 * ON — and so the production default stays correct (zero
 * semantic delta, single authority).
 */
let callerSideRunStartCaptureEnabled = false

export function setCallerSideRunStartCaptureEnabled(enabled: boolean): void {
	callerSideRunStartCaptureEnabled = enabled
}

export function isCallerSideRunStartCaptureEnabled(): boolean {
	return callerSideRunStartCaptureEnabled
}

export function recordRunStart(input: { sessionId: string; delivery: "queue" | "steer" | undefined; jobId?: string }): void {
	if (!callerSideRunStartCaptureEnabled) return
	captureContinuationCardinalityAuthorityRecord({
		stage: "run_turn_started",
		origin: deriveOrigin(input.delivery, input.jobId),
		sessionId: input.sessionId,
		...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
	})
}

/**
 * C8 capture. ALWAYS emits `agent_turn_done` with the factual
 * runtime runId retained by the canonical-event subscription
 * (populated when the `run-started` event arrived). If no
 * `run-started` arrived yet (or retention was cleared) the
 * capture still fires but without a runId.
 *
 * Toggle `setAgentTurnDoneReadsRunId(false)` reproduces the
 * pre-repair defect state (capture fires WITHOUT runId). Default
 * ON (post-repair state).
 */
let agentTurnDoneReadsRunId = true

export function setAgentTurnDoneReadsRunId(enabled: boolean): void {
	agentTurnDoneReadsRunId = enabled
}

export function isAgentTurnDoneReadsRunId(): boolean {
	return agentTurnDoneReadsRunId
}

export function recordAgentTurnDone(input: {
	sessionId: string
	finishReason: string
	delivery: "queue" | "steer" | undefined
	jobId?: string
}): void {
	const runId = agentTurnDoneReadsRunId ? getRunIdForSession(input.sessionId) : undefined
	captureContinuationCardinalityAuthorityRecord({
		stage: "agent_turn_done",
		origin: deriveOrigin(input.delivery, input.jobId),
		sessionId: input.sessionId,
		...(runId !== undefined ? { runId } : {}),
		...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
	})
	// ACT-CLINEMM-COMPLETION-AUTHORITY-POST-RUN-REEVALUATION01:
	// Always fire the semantic trigger (independent of `captureEnabled`).
	// The trigger is the load-bearing post-run liveness seam: it drives
	// `coordinator.notifyAgentTurnDone(sessionId)` which (a) flushes
	// Elm authority so `agent_turn_done` is processed before the next
	// consult, and (b) re-evaluates the deferred-completion barrier.
	// This is NOT gated on the diagnostic `captureEnabled` flag because
	// the trigger is a SEMANTIC event (post-run reevaluation), not a
	// diagnostic observation. Per ACT §9 the diagnostic ring may be
	// OFF and Elm authority may still be ON; the liveness seam MUST
	// work in that configuration.
	const trigger = getAgentTurnDoneSemanticTrigger()
	if (trigger) {
		try {
			const result = trigger(input.sessionId)
			if (result && typeof (result as { then?: unknown }).then === "function") {
				// Fire-and-forget; the coordinator reevaluation is
				// internally bounded (the marker is cleared on commit
				// and on epoch supersession) so no leak risk. Cast
				// to Promise<unknown> to keep .catch type-safe.
				Promise.resolve(result).catch(() => {})
			}
		} catch {
			// Never propagate; the semantic trigger MUST NOT break
			// the CCARD capture path.
		}
	}
}

/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-POST-RUN-REEVALUATION01:
 *
 * Module-level semantic trigger installed by `SdkController` at
 * construction time. When `recordAgentTurnDone` fires (from
 * `LocalRuntimeHost.runTurn`'s post-resolution `onAgentTurnDone`
 * callback), this trigger invokes
 * `SdkSessionEventCoordinator.notifyAgentTurnDone(sessionId)` which:
 *   1. flushes the per-session Elm authority queue so the
 *      `agent_turn_done` record clears `activeRun`, and
 *   2. re-evaluates the deferred-completion barrier (the
 *      existing `reevaluateDeferredCompletionBarrier` already wired
 *      through `SdkController.maybeReevaluateDeferredContinuation`).
 *
 * The trigger is a SEMANTIC event (post-run liveness), independent
 * of the CCARD diagnostic capture gate. The trigger may be `undefined`
 * when no coordinator is wired (e.g. in unit tests that exercise the
 * capture module standalone).
 *
 * Default: undefined (no-op). The trigger is set by `SdkController`
 * at activation.
 */
let agentTurnDoneSemanticTrigger: ((sessionId: string) => void | Promise<void>) | undefined

export function setAgentTurnDoneSemanticTrigger(trigger: ((sessionId: string) => void | Promise<void>) | undefined): void {
	agentTurnDoneSemanticTrigger = trigger
}

export function getAgentTurnDoneSemanticTrigger(): ((sessionId: string) => void | Promise<void>) | undefined {
	return agentTurnDoneSemanticTrigger
}
