/**
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A
 *
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION02:
 *  - `recoveryFailures` is renamed to `recoveryBudgetFailures` on the
 *    wire. The display remains `↻ N`, but the tooltip and aria-label
 *    are corrected to "failures counted toward bounded-recovery episode
 *    limits" — faithful to the underlying `episodeFailures` counter,
 *    which is a bounded-recovery control-plane metric (only increments
 *    while the recovery second stage is `idle`).
 *  - The elapsed clock is REOPENABLE: a same-task continuation
 *    (`streaming` / `awaiting_approval`) on the same task identity
 *    clears `endedAt`, so the display resumes ticking after a
 *    completed/follow-up cycle, a resume, or a retry-after-error.
 *
 * ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01:
 *  - State label now reads the `taskHeaderPresentation` projection
 *    (preferred) when present, falling back to `turnState.phase` only
 *    when the projection is absent (Hub/Remote / pre-observation).
 *    The projection carries the host's three-source precedence
 *    (host-owned compaction override / canonical shadow /
 *    legacy absence fallback) so the TaskHeader no longer needs to
 *    independently interpret stale legacy `turnState.phase` in
 *    normal operation.
 *
 * Compact Task Header telemetry strip. Reads the canonical
 * `taskTelemetry` (host-owned), `taskHeaderPresentation` (host-owned),
 * and `turnState` (backend-owned, preserved for the projection-
 * absence fallback) and projects them as four compact values:
 *
 *   ⏱ elapsed task time   ● state   🔧 tool calls   ↻ recovery
 *
 * Source of truth rules (all pinned by the parent ACT test matrix):
 *
 *   - Elapsed time: derived from `taskTelemetry.startedAt`. The
 *     webview's `setInterval(1000)` is PRESENTATION ONLY — never the
 *     authority. `endedAt` (if set) freezes the display at the
 *     canonical terminal timestamp (see THA28: terminal remount does
 *     not advance). A subsequent same-task continuation clears
 *     `endedAt`, so the clock resumes ticking while preserving
 *     `startedAt` and the cumulative counters.
 *   - State label: derived from `taskHeaderPresentation` (when
 *     present) via `taskHeaderPresentationStateLabel`. The projection
 *     carries the host's three-source precedence; the legacy
 *     `turnState.phase` is consulted ONLY when the projection is
 *     absent. NO message-tail inference. NO local duplicate
 *     `isWorking` state.
 *   - Tool count: cumulative `taskTelemetry.toolCalls` (incremented
 *     exactly once per canonical `tool-started` runtime event).
 *   - Recovery-budget-failure count: cumulative
 *     `taskTelemetry.recoveryBudgetFailures` (positive deltas of
 *     `RecoverySnapshot.episodeFailures` only). HIDDEN at zero per
 *     ACT plan §29.
 *   - Missing telemetry: render "—" (em-dash) rather than fabricating
 *     values from `clineMessages`.
 *
 * Accessible: every counter has a text label and aria-label;
 * tooltips describe semantics.
 */
import type { TaskHeaderPresentationProjection, TaskHeaderTelemetryStrip, TurnState } from "@shared/ExtensionMessage"
import { ClockIcon, WrenchIcon } from "lucide-react"
import React, { useEffect, useState } from "react"
import { formatElapsed, resolveElapsedDisplayMs, taskHeaderPresentationStateLabel } from "./taskHeaderTelemetryHelpers"

interface TaskHeaderTelemetryProps {
	telemetry: TaskHeaderTelemetryStrip | undefined
	taskHeaderPresentation: TaskHeaderPresentationProjection | undefined
	turnState: TurnState | undefined
}

const LIVE_TICK_MS = 1_000

const TaskHeaderTelemetry: React.FC<TaskHeaderTelemetryProps> = ({ telemetry, taskHeaderPresentation, turnState }) => {
	const state = taskHeaderPresentationStateLabel(taskHeaderPresentation, turnState)
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
	const showRecovery = telemetry.recoveryBudgetFailures > 0

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
					aria-label={`Recovery budget failures: ${telemetry.recoveryBudgetFailures}`}
					className="inline-flex items-center gap-1"
					data-testid="task-header-recovery-count"
					title="Cumulative failures counted toward bounded-recovery episode limits (the recovery second-stage counter). Only grows while the recovery second stage is idle — armed / terminating state does not increment it.">
					<span aria-hidden>↻</span>
					<span className="font-mono">{telemetry.recoveryBudgetFailures}</span>
				</span>
			) : null}
		</div>
	)
}

export default TaskHeaderTelemetry
