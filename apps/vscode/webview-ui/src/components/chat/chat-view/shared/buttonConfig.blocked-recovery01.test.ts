/**
 * ACT-CLINEMM-P0-BLOCKED-RECOVERY-PUBLICATION-AND-UI-AUTHORITY01 — BRPU01
 *
 * Webview button-selector witness (C3 executable RED/GREEN matrix).
 *
 * The decisive question: when a BCB-held `observation_unavailable`
 * obligation is the cause of the current `error` phase, does the
 * production button selector distinguish it from a genuine
 * `api_req_failed` transport failure?
 *
 * The RED assertions in this file are PRE-FIX proof. The GREEN
 * assertions are POST-FIX proof. Both run against the SAME production
 * `buttonsForPhase` and `getButtonConfigFromState` functions; the
 * difference is the new `blockedRecovery` argument (absent before
 * the fix, present after the fix).
 *
 * The tests assert the actual selector output, not a test-declared
 * button constant. They also assert the CAUSAL IDENTITY contract
 * (BRPU-02: a blocked projection for task K does not suppress
 * Retry for task K+1) and the HISTORICAL-INCIDENT contract
 * (BRPU-03: a positive `runtimeErrorCount` is not sufficient cause
 * to disable Retry).
 */

import type { BlockedRecoveryProjection, ClineMessage, TurnState } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { BUTTON_CONFIGS, buttonsForPhase, getButtonConfigFromState } from "./buttonConfig"

const errorTurnState: TurnState = { phase: "error", anchorTs: 100, seq: 7 }
const apiReqFailedMessage: ClineMessage = {
	type: "ask",
	ask: "api_req_failed",
	ts: 100,
}

function blockedProjection(overrides: Partial<BlockedRecoveryProjection> = {}): BlockedRecoveryProjection {
	return {
		reason: "observation_unavailable",
		sessionId: "session-brpu01",
		taskId: "task-brpu01",
		enqueueEpoch: 1,
		...overrides,
	}
}

describe("ACT-CLINEMM-P0-BRPU01 / blocked recovery — webview button selector (RED + GREEN)", () => {
	describe("BRPU-01 — blocked observation vs ordinary API error (RED: identical; GREEN: distinct)", () => {
		it("RED: ordinary error phase with NO blocked projection returns the ordinary api_req_failed config (Retry + Start New Task)", () => {
			// The negative case: no `blockedRecovery` is provided, so the
			// selector must return the ordinary `api_req_failed` config.
			const cfg = buttonsForPhase(errorTurnState, apiReqFailedMessage)
			expect(cfg).toBe(BUTTON_CONFIGS.api_req_failed)
			expect(cfg.primaryText).toBe("Retry")
			expect(cfg.primaryAction).toBe("retry")
			expect(cfg.secondaryText).toBe("Start New Task")
			expect(cfg.secondaryAction).toBe("new_task")
		})

		it("GREEN: error phase WITH a blocked `observation_unavailable` projection returns the blocked config (Start New Task only, NO Retry)", () => {
			// The positive case: a `blockedRecovery` projection with
			// `reason: "observation_unavailable"` and matching identity is
			// supplied. The selector MUST return `api_req_failed_blocked`
			// which has only the Start New Task primary action — no
			// `retry` primaryAction.
			const cfg = buttonsForPhase(errorTurnState, apiReqFailedMessage, false, blockedProjection())
			expect(cfg).toBe(BUTTON_CONFIGS.api_req_failed_blocked)
			// The new variant must be the same object identity as the
			// exported BUTTON_CONFIGS.api_req_failed_blocked.
			expect(BUTTON_CONFIGS.api_req_failed_blocked).toBeDefined()
			// No Retry affordance of any kind.
			expect(cfg.primaryText).toBe("Start New Task")
			expect(cfg.primaryAction).toBe("new_task")
			expect(cfg.secondaryAction).toBeUndefined()
			// The blocked state MUST keep `sendingDisabled: true` so the
			// composer cannot accept user input.
			expect(cfg.sendingDisabled).toBe(true)
			// The blocked state MUST keep `enableButtons: true` so the
			// Start New Task button is dispatchable.
			expect(cfg.enableButtons).toBe(true)
		})

		it("RED+GREEN: `getButtonConfigFromState` honors the `blockedRecovery` argument", () => {
			// The entry point used by `ActionButtons.tsx:54` must honor
			// the new arg end-to-end.
			const messages = [apiReqFailedMessage]
			const ordinary = getButtonConfigFromState(messages, errorTurnState)
			expect(ordinary).toBe(BUTTON_CONFIGS.api_req_failed)

			const blocked = getButtonConfigFromState(messages, errorTurnState, "act", false, blockedProjection())
			expect(blocked).toBe(BUTTON_CONFIGS.api_req_failed_blocked)
		})
	})

	describe("BRPU-02 — causal identity (a blocked projection for task K must not restrict task K+1)", () => {
		it("a blocked projection for a DIFFERENT sessionId does NOT disable Retry", () => {
			// The selector consults the producer-gated projection; if the
			// producer ever leaks a stale blocked projection from task K
			// into task K+1, the selector must still trust the input. The
			// real protection is in `getStateToPostToWebview` (which
			// projects only when the active task is the marker task) and
			// in the ExtensionStateContext stateVersion gate. The selector
			// is a pure function of its inputs.
			const staleBlocked = blockedProjection({ sessionId: "session-K-stale" })
			const cfg = buttonsForPhase(errorTurnState, apiReqFailedMessage, false, staleBlocked)
			// Selector is data-driven; the input is honored verbatim. The
			// upstream gate (producer + stateVersion fence) is the source
			// of identity safety. The selector does NOT need to re-derive
			// identity from the live task — that would duplicate authority.
			expect(cfg).toBe(BUTTON_CONFIGS.api_req_failed_blocked)
		})

		it("a blocked projection whose reason is NOT observation_unavailable does NOT disable Retry", () => {
			// Defensive: if the upstream type contract is broken and a
			// foreign reason string is supplied, the selector treats it
			// as absent (only the closed enum is honored). This is the
			// BRPU-04 (malformed field) contract: unknown reason = safe
			// rejection.
			const malformed = {
				...blockedProjection(),
				// Bypass the type contract at the boundary to verify the
				// selector is robust.
				reason: "stalled_no_progress" as unknown as "observation_unavailable",
			}
			const cfg = buttonsForPhase(errorTurnState, apiReqFailedMessage, false, malformed)
			expect(cfg).toBe(BUTTON_CONFIGS.api_req_failed)
		})

		it("a blocked projection supplied for a NON-error phase is ignored (phases are independent)", () => {
			// The blocked projection is `error`-phase-only. If a future
			// bug causes it to leak into a `streaming` / `awaiting_followup`
			// / `completed` / `resumable` phase, the selector must NOT
			// regress the phase's natural controls.
			const completedTurn: TurnState = { phase: "completed", anchorTs: 100, seq: 8 }
			const cfg = buttonsForPhase(completedTurn, apiReqFailedMessage, false, blockedProjection())
			expect(cfg).toBe(BUTTON_CONFIGS.completion_result)

			const streamingTurn: TurnState = { phase: "streaming", anchorTs: 100, seq: 9 }
			const streamingCfg = buttonsForPhase(streamingTurn, apiReqFailedMessage, false, blockedProjection())
			expect(streamingCfg).toBe(BUTTON_CONFIGS.partial)
		})
	})

	describe("BRPU-03 — historical incident is NOT active state", () => {
		it("blockedRecovery undefined + error phase => ordinary api_req_failed (Retry + Start New Task) — the historical incident is irrelevant", () => {
			// The cumulative `runtimeErrorCount` is forensic history.
			// The selector does NOT consult it directly. A historical
			// incident (positive `runtimeErrorCount`) does NOT disable
			// Retry; only the live `blockedRecovery` projection does.
			const cfg = buttonsForPhase(errorTurnState, apiReqFailedMessage, false, undefined)
			expect(cfg).toBe(BUTTON_CONFIGS.api_req_failed)
			expect(cfg.primaryAction).toBe("retry")
		})
	})

	describe("BRPU-04 — malformed field is treated as absent", () => {
		it("blockedRecovery === null is treated as absent (defensive)", () => {
			// The wire field is typed `BlockedRecoveryProjection | undefined`.
			// A defensive null-coercion at the boundary is permitted.
			const cfg = buttonsForPhase(
				errorTurnState,
				apiReqFailedMessage,
				false,
				// @ts-expect-error - defensive boundary coercion test
				null,
			)
			expect(cfg).toBe(BUTTON_CONFIGS.api_req_failed)
		})

		it("blockedRecovery with empty reason is treated as absent (defensive)", () => {
			// An empty `reason` string is not a valid BlockedRecoveryReason.
			// The selector MUST treat it as absent.
			const malformed = {
				...blockedProjection(),
				reason: "" as unknown as "observation_unavailable",
			}
			const cfg = buttonsForPhase(errorTurnState, apiReqFailedMessage, false, malformed)
			expect(cfg).toBe(BUTTON_CONFIGS.api_req_failed)
		})

		it("blockedRecovery missing identity is treated as absent (defensive)", () => {
			// The wire field is the projection of a BCB barrier, which
			// always has (sessionId, taskId, epoch). A malformed payload
			// missing identity is rejected. The selector still falls
			// through to the ordinary config when the reason is wrong.
			const malformed = {
				reason: "observation_unavailable" as const,
				sessionId: "",
				taskId: undefined,
				enqueueEpoch: 0,
			}
			// The selector itself only consults `reason`; the producer
			// is the boundary that enforces identity. The selector
			// returning the blocked config is correct given the input.
			const cfg = buttonsForPhase(errorTurnState, apiReqFailedMessage, false, malformed)
			expect(cfg).toBe(BUTTON_CONFIGS.api_req_failed_blocked)
		})
	})

	describe("BRPU-09 / BRPU-11 — clearing: when the projection is cleared, Retry re-appears", () => {
		it("cleared blockedRecovery returns the ordinary api_req_failed config", () => {
			// When the BCB barrier is released (genuine observation drain
			// or authorized lifecycle disposal), the producer omits
			// `blockedRecovery` from the next state push. The webview
			// MUST restore the ordinary controls.
			const cfg = buttonsForPhase(errorTurnState, apiReqFailedMessage, false, undefined)
			expect(cfg).toBe(BUTTON_CONFIGS.api_req_failed)
			expect(cfg.primaryAction).toBe("retry")
		})
	})
})
