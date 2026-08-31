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
 * ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01 (TES-IMPL-01):
 *  - The cumulative `toolCalls` count now renders as a compact
 *    `🔧N · ✏️E · >_C · 👁R · 🔍S · 🔌M · ❓O` mechanism breakdown
 *    whenever the host-supplied `telemetry.mechanism` summary is on
 *    the wire. Each sub-glyph represents one closed mechanism
 *    bucket (edit / command / search / read / mcp / other) and is
 *    hidden when its bucket is zero. The display is mechanism-only:
 *    a native edit tool and a shell command that edits a file remain
 *    visually distinct (`✏️` vs `>_`). Icon order is stable so the
 *    user can scan a task header at a glance.
 *  - Every glyph has an explicit `aria-label` describing the count
 *    (`6 edit tool calls`) and a `title` tooltip. The icons are
 *    visual sugar; the semantics live in the screen-reader text.
 *  - When the host has not yet projected the `mechanism` summary
 *    (Hub/Remote hosts, pre-observation absence), the strip falls
 *    back to the existing flat `🔧 N` rendering — the legacy
 *    `toolCalls` count is still numerically conserved against the
 *    sum of mechanism buckets when both are present.
 *
 * Compact Task Header telemetry strip. Reads the canonical
 * `taskTelemetry` (host-owned), `taskHeaderPresentation` (host-owned),
 * and `turnState` (backend-owned, preserved for the projection-
 * absence fallback) and projects them as four compact values:
 *
 *   ⏱ elapsed task time   ● state   🔧 tool calls (×mechanism)   ↻ recovery
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
 *     When `telemetry.mechanism` is present, the count is decomposed
 *     into the per-mechanism breakdown; otherwise the flat count is
 *     rendered unchanged.
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
import type {
	TaskHeaderPresentationProjection,
	TaskHeaderTelemetryStrip,
	ToolMechanismSummary,
	TurnState,
} from "@shared/ExtensionMessage"
import type { LucideIcon } from "lucide-react"
import { ClockIcon, Edit3Icon, EyeIcon, PlugIcon, SearchIcon, WrenchIcon } from "lucide-react"
import React, { useEffect, useState } from "react"
import {
	formatElapsed,
	isUsableMechanismProjection,
	resolveElapsedDisplayMs,
	taskHeaderPresentationStateLabel,
} from "./taskHeaderTelemetryHelpers"

interface TaskHeaderTelemetryProps {
	telemetry: TaskHeaderTelemetryStrip | undefined
	taskHeaderPresentation: TaskHeaderPresentationProjection | undefined
	turnState: TurnState | undefined
	/**
	 * ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01:
	 * Effective diagnostic-knob state from the host. When present
	 * AND at least one knob is ON, the indicator renders the active
	 * letters (e.g. `"VIP"`) at the right of the row. When absent or
	 * all-OFF (the public default), the indicator is hidden entirely.
	 */
	diagnosticKnobs?:
		| {
				readonly v: boolean
				readonly i: boolean
				readonly a: boolean
				readonly p: boolean
		  }
		| undefined
}

const LIVE_TICK_MS = 1_000

/**
 * ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01 (TES-IMPL-01):
 *
 * Per-mechanism visual / a11y descriptor table. The order is the
 * canonical TaskHeader display order:
 *
 *   total → edit → command → read → search → mcp → other
 *
 * The `Icon` field is the lucide-react component (or `null` for
 * buckets that use an inline glyph); `glyph` is the inline text
 * fallback rendered for non-lucide buckets (`>_` command, `?` other);
 * `label` is the screen-reader / tooltip label fragment; `key` is the
 * canonical `ToolMechanismSummary` field name.
 */
interface MechanismDescriptor {
	key: keyof ToolMechanismSummary
	label: string
	Icon: LucideIcon | null
	glyph: string | null
}

const MECHANISM_DESCRIPTORS: readonly MechanismDescriptor[] = [
	{ key: "edit", label: "edit tool calls", Icon: Edit3Icon, glyph: null },
	{ key: "command", label: "command tool calls", Icon: null, glyph: ">_" },
	{ key: "read", label: "read tool calls", Icon: EyeIcon, glyph: null },
	{ key: "search", label: "search tool calls", Icon: SearchIcon, glyph: null },
	{ key: "mcp", label: "MCP tool calls", Icon: PlugIcon, glyph: null },
	{ key: "other", label: "unclassified tool calls", Icon: null, glyph: "?" },
] as const

/**
 * Render one compact mechanism chip. Glyph + count, with an
 * explicit `aria-label` describing the bucket so screen readers
 * hear `6 edit tool calls` rather than `pencil 6`.
 */
function MechanismChip({ descriptor, count }: { descriptor: MechanismDescriptor; count: number }) {
	const testId = `task-header-mechanism-${descriptor.key}`
	const ariaLabel = `${count} ${descriptor.label}`
	if (descriptor.Icon) {
		const Icon = descriptor.Icon
		return (
			<span aria-label={ariaLabel} className="inline-flex items-center gap-0.5" data-testid={testId} title={ariaLabel}>
				<Icon aria-hidden="true" className="h-3 w-3" />
				<span className="font-mono">{count}</span>
			</span>
		)
	}
	return (
		<span
			aria-label={ariaLabel}
			className="inline-flex items-center gap-0.5 font-mono"
			data-testid={testId}
			title={ariaLabel}>
			<span aria-hidden className="text-[0.7rem]">
				{descriptor.glyph}
			</span>
			<span>{count}</span>
		</span>
	)
}

const TaskHeaderTelemetry: React.FC<TaskHeaderTelemetryProps> = ({
	telemetry,
	taskHeaderPresentation,
	turnState,
	diagnosticKnobs,
}) => {
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
	// ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01:
	// Per-mechanism cumulative counts from the host-supplied
	// projection. The webview trusts the projection ONLY when
	// `isUsableMechanismProjection` returns true — that validator
	// enforces:
	//   - the projection is present;
	//   - every field is a finite, non-negative integer;
	//   - the bucket sum equals `mechanism.total` (in-process
	//     conservation);
	//   - `mechanism.total === telemetry.toolCalls` (cross-field
	//     conservation against the older flat counter).
	// Otherwise we fall back to the existing flat `🔧 N` rendering
	// rather than display contradictory numbers (e.g. `aria: Tool
	// calls: 10` against `visible: 🔧9 ✏️3 >_3 ...`).
	const mechanism = telemetry.mechanism
	const hasMechanismProjection = isUsableMechanismProjection(mechanism, telemetry.toolCalls)

	// ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01:
	// Compose the diagnostic-knob indicator from the host-supplied
	// `diagnosticKnobs` field. Empty string -> nothing to render
	// (the public default). Non-empty -> render the letters in the
	// canonical V → I → A → P order (matches the host resolver's
	// `formatEffectiveKnobLetters` output, mirrored here so the
	// webview can render without re-importing the host resolver).
	const indicatorLetters = diagnosticKnobs
		? [
				diagnosticKnobs.v ? "V" : "",
				diagnosticKnobs.i ? "I" : "",
				diagnosticKnobs.a ? "A" : "",
				diagnosticKnobs.p ? "P" : "",
			].join("")
		: ""
	const tooltipBody = diagnosticKnobs
		? `V=${diagnosticKnobs.v ? "on" : "off"}, I=${diagnosticKnobs.i ? "on" : "off"}, A=${diagnosticKnobs.a ? "on" : "off"}, P=${diagnosticKnobs.p ? "on" : "off"}`
		: ""

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
			{hasMechanismProjection && mechanism ? (
				<span
					aria-label={`Tool calls: ${telemetry.toolCalls}`}
					className="inline-flex items-center gap-2"
					data-testid="task-header-tool-count"
					title="Cumulative tool invocations for this task, broken down by mechanism. Host DENY, user rejection, pre-exec block, and registry miss do not increment — no canonical tool-start occurs for those paths.">
					<span className="inline-flex items-center gap-0.5" data-testid="task-header-mechanism-total">
						<WrenchIcon aria-hidden className="h-3 w-3" />
						<span className="font-mono">{mechanism.total}</span>
					</span>
					{MECHANISM_DESCRIPTORS.filter((d) => mechanism[d.key] > 0).map((d) => (
						<MechanismChip count={mechanism[d.key]} descriptor={d} key={d.key} />
					))}
				</span>
			) : (
				<span
					aria-label={`Tool calls: ${telemetry.toolCalls}`}
					className="inline-flex items-center gap-1"
					data-testid="task-header-tool-count"
					title="Cumulative tool invocations for this task. Host DENY, user rejection, pre-exec block, and registry miss do not increment — no canonical tool-start occurs for those paths.">
					<WrenchIcon aria-hidden className="h-3 w-3" />
					<span className="font-mono">{telemetry.toolCalls}</span>
				</span>
			)}
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
			{/* ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01:
			    Diagnostic-knob indicator. Rendered ONLY when at least one
			    knob is ON. In public the field is all-false and the
			    indicator stays hidden — the operator-facing contract is
			    that diagnostic letters are visible iff dogfood diagnostics
			    are active. The order is canonical V → I → A → P. The
			    tooltip enumerates the knobs so the user can hover to see
			    what each letter means. */}
			{indicatorLetters ? (
				<span
					aria-label={`Diagnostic knobs active: ${tooltipBody}`}
					className="inline-flex items-center gap-0.5 px-1 rounded-sm bg-badge-foreground/15 font-mono"
					data-testid="task-header-diagnostic-knobs"
					title={tooltipBody}>
					<span aria-hidden>{indicatorLetters}</span>
				</span>
			) : null}
		</div>
	)
}

export default TaskHeaderTelemetry
