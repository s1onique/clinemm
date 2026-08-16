/**
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A
 *
 * Pure helpers for the Task Header telemetry strip:
 *   - `formatElapsed`: deterministic elapsed-time formatter
 *     (mm:ss / h:mm:ss / d hh:mm) with the canonical epoch as
 *     authoritative source.
 *   - `stateLabel`: pure projection from `TurnPhase` to the user-facing
 *     label + icon glyph.
 *   - `taskHeaderStateLabel`: convenience selector that reads the
 *     canonical TurnPhase (NOT a message-tail fallback).
 *
 * No React. No DOM. No chat-derived inference.
 */
import type { TurnPhase, TurnState } from "@shared/ExtensionMessage"

const MS_PER_SECOND = 1_000
const MS_PER_MINUTE = 60 * MS_PER_SECOND
const MS_PER_HOUR = 60 * MS_PER_MINUTE
const MS_PER_DAY = 24 * MS_PER_HOUR

/**
 * Format an elapsed duration in milliseconds as a compact
 * deterministic string.
 *
 *   < 1 hour  -> "mm:ss"
 *   < 1 day   -> "h:mm:ss"
 *   >= 1 day  -> "d hh:mm"
 *
 * Negative or non-finite inputs fall back to "0:00" rather than NaN.
 */
export function formatElapsed(durationMs: number): string {
	if (!Number.isFinite(durationMs) || durationMs <= 0) {
		return "00:00"
	}
	const totalSeconds = Math.floor(durationMs / MS_PER_SECOND)
	const days = Math.floor(totalSeconds / (24 * 60 * 60))
	const remainderAfterDays = totalSeconds - days * 24 * 60 * 60
	const hours = Math.floor(remainderAfterDays / (60 * 60))
	const remainderAfterHours = remainderAfterDays - hours * 60 * 60
	const minutes = Math.floor(remainderAfterHours / 60)
	const seconds = remainderAfterHours - minutes * 60
	if (days > 0) {
		return `${days}d ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
	}
	if (hours > 0) {
		return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
	}
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

/**
 * Resolve the elapsed duration to display, given the canonical
 * `startedAt` / `endedAt` from `TaskHeaderTelemetry`. While the task
 * is live, `now - startedAt` ticks; once `endedAt` is set (terminal
 * task), the value freezes at `endedAt - startedAt`.
 */
export function resolveElapsedDisplayMs(startedAt: number, endedAt: number | undefined, now: number): number {
	if (!Number.isFinite(startedAt)) {
		return 0
	}
	if (endedAt !== undefined && Number.isFinite(endedAt) && endedAt >= startedAt) {
		return endedAt - startedAt
	}
	const delta = now - startedAt
	return Number.isFinite(delta) && delta > 0 ? delta : 0
}

export interface StateLabelProjection {
	/** Short user-visible label. */
	label: string
	/** Single-character glyph for the state badge (no icons import). */
	glyph: string
	/** True when the task is actively doing something (timer should tick). */
	live: boolean
}

/**
 * Pure projection from canonical `TurnPhase` to the user-visible
 * label + glyph. Mirrors the upstream ACT-CLINEMM-COMPLETION-CHANGESET-
 * UI-STATE-TRUTH01 vocabulary so the header state is consistent with
 * the composer / buttons.
 */
export function stateLabel(phase: TurnPhase | undefined): StateLabelProjection {
	switch (phase) {
		case "idle":
			return { label: "Idle", glyph: "○", live: false }
		case "streaming":
			return { label: "Working", glyph: "●", live: true }
		case "awaiting_approval":
			return { label: "Approval", glyph: "?", live: true }
		case "awaiting_followup":
			return { label: "Waiting", glyph: "…", live: false }
		case "completed":
			return { label: "Complete", glyph: "✓", live: false }
		case "error":
			return { label: "Error", glyph: "!", live: false }
		case "resumable":
			return { label: "Paused", glyph: "↻", live: false }
		default:
			return { label: "Unknown", glyph: "?", live: false }
	}
}

/**
 * Convenience selector that derives the header-state label directly
 * from a `TurnState`. Falls back to `undefined` rendering when no
 * canonical state is on the wire — the consumer MUST render "—"
 * rather than reconstructing from chat prose.
 */
export function taskHeaderStateLabel(turnState: TurnState | undefined): StateLabelProjection {
	return stateLabel(turnState?.phase)
}
