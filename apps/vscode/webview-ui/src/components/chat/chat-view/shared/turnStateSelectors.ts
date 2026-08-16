// ACT-CLINEMM-COMPLETION-CHANGESET-UI-STATE-TRUTH01:
//
// Pure selectors for the two consumer shapes that derive
// runtime-task activity from the backend-owned `TurnState`.
// Centralising the projection keeps the two consumers in
// lockstep and gives us a single target for the regression
// suite (see `turnStateSelectors.test.ts`).
//
// The selectors are intentionally pure and read no global
// state. The previous `lastMessage.partial` /
// `api_req_started` fallback that lived inline in
// `InputSection.tsx` and `useMessageHandlers.ts` is gone:
// `TurnState` is always set on the state payload by
// `SdkController.getStateToPostToWebview` (the tracker is
// constructed in the SdkController constructor and starts at
// phase `idle`), so a `undefined` value is a missing-canonical-
// state condition, not a license to parse chat history.
//
// ===========================================================================
// TRANSPORT-RECON PROVENANCE
// ===========================================================================
//
// The "TurnState is always present" claim above is from reading the
// surrounding codebase in the parent ACT's recon pass, NOT from
// any file this ACT modifies. The relevant call sites are:
//
//   apps/vscode/src/sdk/SdkController.ts:337
//     `this.turnStateTracker = new TurnStateTracker(...)`
//     instantiated in the constructor, starts at phase `idle`.
//   apps/vscode/src/sdk/SdkController.ts:2317
//     `turnState: this.turnStateTracker.get()`
//     included in every `getStateToPostToWebview` payload.
//   apps/vscode/src/sdk/turn-state-tracker.ts
//     tracker implementation; `get()` always returns a defined object.
//
// None of those three files changed in the subject commit
// (c3d63376c). The conservative `undefined → false` policy
// these selectors implement is therefore a defense against a
// transport regression that did not occur in this ACT and
// whose absence was not independently re-verified by the
// subject range. If a future ACT removes `turnState` from
// the webview payload, the CUI10 test in
// `turnStateSelectors.test.ts` will fail loudly here.
// ===========================================================================

import type { TurnPhase, TurnState } from "@shared/ExtensionMessage"

/**
 * "Should Enter-on-composer submit as a follow-up to an
 * existing conversation?"
 *
 * Continuable phases mirror the original `turnAllowsFollowup`
 * rule: `completed` (after attempt_completion), `awaiting_followup`
 * (after ask_question / plan_mode_respond), and `streaming`
 * (interrupt a live turn with feedback). `awaiting_approval`
 * is intentionally NOT in this set: the existing flow has its
 * own dedicated `clineAsk` branch that sends `noButtonClicked`
 * / `messageResponse` for typed feedback during approvals, and
 * the `messages.length > 0 && !clineAsk` branch is for the case
 * where the SDK did not emit a trailing ask — that case does not
 * happen while an approval is pending.
 */
export function turnAllowsFollowup(turnState: TurnState | undefined): boolean {
	if (!turnState) {
		return false
	}
	return turnState.phase === "completed" || turnState.phase === "awaiting_followup" || turnState.phase === "streaming"
}

/**
 * "Should the textarea allow queued submit while the run is
 * mid-flight?"
 *
 * Queued submit is the composer-override path that lets the
 * user keep typing feedback while a turn is running. The two
 * phases that need it are `streaming` (queue feedback against
 * the running model) and `awaiting_approval` (queue typed
 * feedback that the SDK will route as a rejection).
 */
export function allowsQueuedSubmit(turnState: TurnState | undefined): boolean {
	if (!turnState) {
		return false
	}
	return turnState.phase === "streaming" || turnState.phase === "awaiting_approval"
}

/**
 * "Is the runtime currently doing something that prevents
 * completion-change actions?" — i.e. is the run live?
 *
 * Distinct from `turnAllowsFollowup`: this is the "terminal vs
 * non-terminal" question used by buttons and the completion
 * changeset surface. Phases `idle`, `completed`, `error`,
 * `resumable`, and `awaiting_followup` are terminal from the
 * UI's perspective (no model/tool/approval is in flight);
 * `streaming` and `awaiting_approval` are non-terminal.
 */
export function isRunLive(turnState: TurnState | undefined): boolean {
	if (!turnState) {
		return false
	}
	return turnState.phase === "streaming" || turnState.phase === "awaiting_approval"
}

/**
 * "Has the run reached a terminal phase from the webview's
 * perspective?" — presentation terminology, NOT canonical
 * AgentRuntime lifecycle semantics. The SDK's runtime
 * lifecycle distinguishes `completed` / `aborted` / `failed`
 * (those live on `@cline/agents`' `AgentRunStatus` and are
 * reachable via `AgentRuntime.snapshot().status`); this
 * selector is intentionally a webview-side projection that
 * folds a small set of UI-presentation-relevant phases into
 * one boolean for terminal-gated buttons. The mapping is
 * documented inline and pinned by CUI11 + M5.
 *
 * Includes `idle` (no run), `completed` (run finished),
 * `error` (run failed; retry/recovery UI is the next step,
 * not freeform input), `resumable` (cancelled/interrupted;
 * Resume is its own surface), and `awaiting_followup` (agent
 * explicitly asked for user input — not a model/tool/
 * approval in flight).
 *
 * `streaming` and `awaiting_approval` are the only two phases
 * that are NOT terminal.
 */
export function isRunTerminal(turnState: TurnState | undefined): boolean {
	if (!turnState) {
		return false
	}
	const phase: TurnPhase = turnState.phase
	return (
		phase === "idle" || phase === "completed" || phase === "error" || phase === "resumable" || phase === "awaiting_followup"
	)
}
