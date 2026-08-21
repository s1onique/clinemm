/**
 * Node-side mirror of the webview's `taskHeaderTelemetryHelpers` for
 * production-seam tests under `apps/vscode/src/sdk/__tests__/`.
 *
 * The webview-ui source is the production authority (apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts).
 * This mirror is byte-equivalent at the time of authoring and is used
 * ONLY because vitest under `apps/vscode/vitest.config.ts` does not
 * resolve webview-ui subpath imports.
 *
 * Any drift from the webview helpers MUST be repaired in BOTH files
 * (the webview is the authority). The test file that imports from
 * here asserts on behavior that depends on these helpers staying in
 * lock-step.
 */
import type { TaskHeaderPresentationProjection, TurnPhase, TurnState } from "@shared/ExtensionMessage"

const MS_PER_SECOND = 1_000
const MS_PER_MINUTE = 60 * MS_PER_SECOND
const MS_PER_HOUR = 60 * MS_PER_MINUTE
const MS_PER_DAY = 24 * MS_PER_HOUR

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
	label: string
	glyph: string
	live: boolean
}

export function stateLabel(phase: TurnPhase | undefined): StateLabelProjection {
	switch (phase) {
		case "idle":
			return { label: "Idle", glyph: "○", live: false }
		case "streaming":
			return { label: "Working", glyph: "●", live: true }
		case "awaiting_approval":
			return { label: "Approval", glyph: "?", live: true }
		case "awaiting_followup":
			return { label: "Waiting", glyph: "…", live: true }
		case "compacting":
			return { label: "Compacting", glyph: "⌄", live: true }
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

export function taskHeaderPresentationStateLabel(
	taskHeaderPresentation: TaskHeaderPresentationProjection | undefined,
	turnState: TurnState | undefined,
): StateLabelProjection {
	if (taskHeaderPresentation) {
		return stateLabel(taskHeaderPresentation.phase)
	}
	return stateLabel(turnState?.phase)
}
