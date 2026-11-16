/**
 * ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01
 *
 * The SINGLE pure `TurnPhase -> user-visible label` mapping.
 *
 * ORIGIN
 *
 *   This mapping was defined inside the webview-only module
 *   `apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts`
 *   (`stateLabel`). The MCP control seam needs the SAME label for the
 *   published TaskHeader phase, but the extension host cannot import
 *   webview code (the webview bundle cannot import host code either —
 *   see the mirror note in `tool-mechanism-classifier.ts`).
 *
 *   Rather than introduce a SECOND switch statement with its own
 *   permanent semantics, the mapping is EXTRACTED here into the shared
 *   layer (`@shared/*` is aliased on BOTH sides:
 *   `apps/vscode/tsconfig.json` and `apps/vscode/webview-ui/tsconfig.app.json`).
 *   The webview helper now DELEGATES to this module, so there is exactly
 *   ONE mapping authority.
 *
 * CONTRACT
 *
 *   - Pure. No React. No DOM. No I/O. No chat-derived inference.
 *   - The input is the canonical `TurnPhase` vocabulary from
 *     `@shared/ExtensionMessage`. An unknown phase yields `undefined`
 *     (the caller decides what to render) — it NEVER invents a phase.
 *   - The label vocabulary is EXACTLY the one the TaskHeader renders:
 *     idle -> Idle, streaming -> Working, awaiting_approval -> Approval,
 *     awaiting_followup -> Your turn, compacting -> Compacting,
 *     completed -> Complete, error -> Error, resumable -> Paused.
 */

import type { TurnPhase } from "./ExtensionMessage"

/**
 * The canonical phase -> label vocabulary.
 *
 * A `Map` (not a switch) so the lookup is total over the declared
 * `TurnPhase` union and an unknown value simply misses.
 */
const TASK_HEADER_STATE_LABELS: ReadonlyMap<TurnPhase, string> = new Map<TurnPhase, string>([
	["idle", "Idle"],
	["streaming", "Working"],
	["awaiting_approval", "Approval"],
	["awaiting_followup", "Your turn"],
	["compacting", "Compacting"],
	["completed", "Complete"],
	["error", "Error"],
	["resumable", "Paused"],
])

/**
 * The user-visible label for a canonical `TurnPhase`.
 *
 * Returns `undefined` for `undefined` or for a phase outside the
 * canonical vocabulary — the consumer must then omit the label rather
 * than fabricate one. This is the ONLY label mapping for the TaskHeader
 * phase vocabulary.
 *
 * The name deliberately differs from the webview module's legacy
 * `taskHeaderStateLabel(turnState)` selector so the two are never
 * confused: this one takes a PHASE, that one takes a `TurnState`.
 */
export function taskHeaderPhaseLabel(phase: TurnPhase | undefined): string | undefined {
	if (phase === undefined) {
		return undefined
	}
	return TASK_HEADER_STATE_LABELS.get(phase)
}

/**
 * The exact set of canonical `TurnPhase` values.
 *
 * The MCP control seam's strict validator uses this to reject an
 * unknown phase value rather than passing it through.
 */
export const TASK_HEADER_STATE_PHASES: readonly TurnPhase[] = [...TASK_HEADER_STATE_LABELS.keys()]

/** True when `value` is one of the canonical `TurnPhase` values. */
export function isTaskHeaderStatePhase(value: unknown): value is TurnPhase {
	return typeof value === "string" && TASK_HEADER_STATE_LABELS.has(value as TurnPhase)
}
