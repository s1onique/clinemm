/**
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A
 *
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION01:
 *  - `recoveryInterventions` is renamed to `recoveryFailures` on the
 *    wire (single-counter authority: episodeFailures only).
 *  - Tooltip is updated to "recoverable tool failures observed during
 *    this task" (more truthful than "interventions").
 *  - Tool-count tooltip is corrected to "Host DENY / user rejection /
 *    pre-exec block / registry miss do not increment — no canonical
 *    tool-start occurs" (UNKNOWN_TOOL is a registry miss, not a
 *    control-plane outcome).
 *
 * Compact Task Header telemetry strip. Reads the canonical
 * `taskTelemetry` (host-owned) and `turnState` (backend-owned) and
 * projects them as four compact values:
 *
 *   ⏱ elapsed task time   ● state   🔧 tool calls   ↻ recovery
 *
 * Source of truth rules (all pinned by the parent ACT test matrix):
 *
 *   - Elapsed time: derived from `taskTelemetry.startedAt`. The
 *     webview's `setInterval(1000)` is PRESENTATION ONLY — never the
 *     authority. `endedAt` (if set) freezes the display at the
 *     canonical terminal timestamp (see THA28: terminal remount does
 *     not advance). `awaiting_followup` does NOT freeze — the same
 *     task continues when the user replies.
 *   - State label: pure projection from `turnState.phase` (reuses
 *     `taskHeaderStateLabel`). NO message-tail inference.
 *   - Tool count: cumulative `taskTelemetry.toolCalls` (incremented
 *     exactly once per canonical `tool-started` runtime event).
 *   - Recovery count: cumulative `taskTelemetry.recoveryFailures`
 *     (positive deltas of `RecoverySnapshot.episodeFailures` only).
 *     HIDDEN at zero per ACT plan §29.
 *   - Missing telemetry: render "—" (em-dash) rather than fabricating
 *     values from `clineMessages`.
 *
 * Accessible: every counter has a text label and aria-label;
 * tooltips describe semantics.
 */
import type { TaskHeaderTelemetryStrip, TurnState } from "@shared/ExtensionMessage"
import { ClockIcon, WrenchIcon } from "lucide-react"
import React, { useEffect, useState } from "react"
import { formatElapsed, resolveElapsedDisplayMs, taskHeaderStateLabel } from "./taskHeaderTelemetryHelpers"

interface TaskHeaderTelemetryProps {
	telemetry: TaskHeaderTelemetryStrip | undefined
	turnState: TurnState | undefined
}

const LIVE_TICK_MS = 1_000

const TaskHeaderTelemetry: React.FC<TaskHeaderTelemetryProps> = ({ telemetry, turnState }) => {
	const state = taskHeaderStateLabel(turnState)
	// Local presentation timer — DOES NOT mutate telemetry authority.
	// We re-read telemetry.startedAt/endedAt each tick so the value
	// remains a pure projection of canonical timestamps.
	const [now, setNow] = useState(() => Date.now())
	useEffect(() => {
		if (!state.live) {
			return
		}
		const handle = setInterval(() => setNow(Date.now()), LIVE_TICK_MS)
		return () => clearInterval(handle)
	}, [state.live])

	if (!telemetry) {
		// No authority on the wire — render the canonical placeholder.
		return (
			<div
				aria-label="Task header telemetry not yet available"
				className="flex items-center gap-3 text-xs text-muted-foreground"
				data-testid="task-header-telemetry-empty">
				<span aria-hidden>—</span>
			</div>
		)
	}

	const elapsedMs = resolveElapsedDisplayMs(telemetry.startedAt, telemetry.endedAt, now)
	const elapsedText = formatElapsed(elapsedMs)
	const showRecovery = telemetry.recoveryFailures > 0

	return (
		<div
			aria-label="Task header runtime telemetry"
			className="flex items-center gap-3 text-xs"
			data-testid="task-header-telemetry">
			<span
				aria-label={`Elapsed task time: ${elapsedText}`}
				className="inline-flex items-center gap-1"
				data-testid="task-header-elapsed"
				title={`Task started at ${new Date(telemetry.startedAt).toISOString()}`}>
				<ClockIcon aria-hidden className="h-3 w-3" />
				<span className="font-mono">{elapsedText}</span>
			</span>
			<span
				aria-label={`Task state: ${state.label}`}
				className="inline-flex items-center gap-1"
				data-testid="task-header-state"
				title={`Task state: ${state.label}`}>
				<span aria-hidden>{state.glyph}</span>
				<span>{state.label}</span>
			</span>
			<span
				aria-label={`Tool calls: ${telemetry.toolCalls}`}
				className="inline-flex items-center gap-1"
				data-testid="task-header-tool-count"
				title="Cumulative tool invocations for this task. Host DENY, user rejection, pre-exec block, and registry miss do not increment — no canonical tool-start occurs for those paths.">
				<WrenchIcon aria-hidden className="h-3 w-3" />
				<span className="font-mono">{telemetry.toolCalls}</span>
			</span>
			{showRecovery ? (
				<span
					aria-label={`Recoverable tool failures observed: ${telemetry.recoveryFailures}`}
					className="inline-flex items-center gap-1"
					data-testid="task-header-recovery-count"
					title="Cumulative recoverable tool failures observed during this task. Counts positive deltas of episodeFailures only (family pressure and circuit notices are overlapping consequences of the same failure).">
					<span aria-hidden>↻</span>
					<span className="font-mono">{telemetry.recoveryFailures}</span>
				</span>
			) : null}
		</div>
	)
}

export default TaskHeaderTelemetry
