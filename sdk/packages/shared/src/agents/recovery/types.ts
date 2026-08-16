/**
 * Bounded recovery contract types — cross-package surface.
 *
 * These types MUST remain dependency-free (no Node builtins, no
 * `@cline/core` / `@cline/agents` imports). They are the structural
 * contracts that the runtime policy implementation (`@cline/agents`)
 * consumes and that higher layers (hosts, telemetry, persistence)
 * observe.
 *
 * Privacy discipline:
 *   - `RecoverySnapshot.blockedExactKeys` and
 *     `RecoveryStateChangeEvent.failureFamily` carry opaque diagnostic
 *     identifiers, NOT raw canonical tool input.
 *   - Raw control identities (`controlKey`, `controlFamily`) MUST NOT
 *     be emitted through `RecoverySnapshot`, `RecoveryStateChangeEvent`,
 *     or host telemetry. They are exposed on
 *     `ToolAttemptIdentity` / `ToolFamilyIdentity` only because the
 *     runtime wiring layer needs them at the boundary; the tracker
 *     always projects them to 8-char FNV-1a hex before they leave the
 *     state machine.
 */

export type ToolFailureClass =
	| "tool_not_found"
	| "tool_input_invalid"
	| "tool_execution_error"
	| "tool_result_invalid"
	| "tool_protocol_error";

export type ControlPlaneOutcome =
	| "user_rejected"
	| "host_policy_denied"
	| "approval_pending"
	| "provider_rate_limit"
	| "provider_transport_error"
	| "context_length_exceeded"
	| "task_cancelled"
	| "runtime_aborted"
	/**
	 * The tool was never executed (prepare-tool short-circuit). Captures
	 * policy-disabled, hook-skip, and any other path where the
	 * boundary did not invoke `tool.execute(...)`. More-specific
	 * outcomes (user_rejected, host_policy_denied, approval_pending)
	 * still outrank this.
	 */
	| "runtime_skipped";

export type ToolFailureReason = ToolFailureClass | ControlPlaneOutcome;

export type StableFailureCode =
	| "unknown"
	| "ENOENT"
	| "EACCES"
	| "EXIT_NOT_FOUND"
	| { exit: number }
	| {
			schema: "missing_required" | "invalid_type" | "unknown_property";
			field?: string;
	  }
	| "tool:not_found"
	| "protocol:malformed_result"
	| "protocol:encoding_error"
	| { code: string };

export function serializeFailureCode(code: StableFailureCode): string {
	if (typeof code === "string") return code;
	if ("exit" in code) return `exit:${code.exit}`;
	if ("code" in code) return `code:${code.code}`;
	if ("schema" in code)
		return `schema:${code.schema}${code.field ? `:${code.field}` : ""}`;
	return JSON.stringify(code);
}

// -------------------------------------------------------------------------
// Recovery state machine
// -------------------------------------------------------------------------

export type RecoveryState = "idle" | "recovering" | "warning" | "circuit_open";

/**
 * Snapshot of the bounded recovery state machine at a point in time.
 *
 * The opaque `blockedExactKeys` and `currentFailureFamily` fields are
 * short diagnostic identifiers — NOT raw canonical input. They are safe
 * to include in telemetry, runtime events, and host projections. Raw
 * `controlKey` / `controlFamily` values are not exposed here.
 */
export interface RecoverySnapshot {
	state: RecoveryState;
	currentRepairAttempts: number;
	equivalentRepeatCount: number;
	currentFailureClass?: ToolFailureClass;
	currentToolName?: string;
	/** Opaque diagnostic identifier for the active failure family. */
	currentFailureFamily?: string;
	circuitReason?: string;
	/** Opaque diagnostic identifiers for currently-blocked exact attempts. */
	blockedExactKeys: string[];
	/** Opaque diagnostic identifiers for currently-blocked families. */
	blockedFamilies: string[];
}

/**
 * C1.5 second-stage continuation lifecycle, projected for external
 * observers.
 *
 *   - `idle`        — no bounded-continuation pressure.
 *   - `armed`       — non-convergence proved; the model has EXACTLY ONE
 *                     remaining provider request as its bounded
 *                     continuation opportunity.
 *   - `terminating` — terminal latch set; no further provider request
 *                     will be issued for this run.
 */
export type RecoverySecondStage = "idle" | "armed" | "terminating";

/**
 * C1.5 typed cause that armed the second-stage continuation. Enum-only;
 * carries no canonical tool input, no command text, and no error prose.
 */
export type RecoverySecondStageTrigger =
	| "exact_blocked"
	| "family_exhausted"
	| "exact_only_capped"
	| "episode_exhausted";

/**
 * C1.5 CANONICAL RUNTIME RECOVERY PROJECTION.
 *
 * This is the single externally-observable representation of bounded
 * recovery truth. It is the ONLY shape a host, UI, log, or future
 * task-header projection may consume. Consumers MUST NOT re-derive
 * recovery state by parsing chat history, tool-result prose (e.g. the
 * `bounded_recovery_exhausted` output code), or approval UI state.
 *
 * ## Composition, not extension
 *
 * `tracker` embeds the existing {@link RecoverySnapshot} verbatim rather
 * than flattening its fields. The tracker substrate is generic (C1.0) and
 * must not be turned into an AgentRuntime-specific contract; the
 * runtime-owned second-stage/episode dimensions (C1.3/C1.4) are therefore
 * composed alongside it instead of being merged into it.
 *
 * ## Privacy
 *
 * Every field is either a bounded counter, a typed enum, or an opaque
 * 8-char diagnostic identifier produced by the tracker's FNV-1a
 * projection. Raw `controlKey` / `controlFamily` values, canonical tool
 * input, command strings, provider errors, and the private
 * `pendingBatchOutcomes` buffer are structurally absent.
 */
export interface AgentRuntimeRecoverySnapshot {
	/**
	 * Visible recovery state machine value. Mirrors
	 * `tracker.state`; hoisted so consumers that only need the
	 * headline state do not have to reach through `tracker`.
	 */
	state: RecoveryState;
	/** Full tracker projection (already privacy-projected by C1.0). */
	tracker: RecoverySnapshot;
	/** C1.4 second-stage continuation lifecycle. */
	secondStage: RecoverySecondStage;
	/** Typed cause of the second-stage arming, when armed/terminating. */
	secondStageTrigger?: RecoverySecondStageTrigger;
	/** C1.4 recoverable failures observed in the current episode. */
	episodeFailures: number;
	/** Policy ceiling for {@link episodeFailures}. */
	maxEpisodeFailures: number;
	/**
	 * Number of `bounded_recovery_exhausted` circuit notices surfaced to
	 * the model during the current episode.
	 */
	circuitNoticeCount: number;
}

/**
 * Event emitted when the recovery state transitions.
 *
 * `failureFamily` is the opaque diagnostic identifier of the family whose
 * state changed. Raw canonical tool input is never included.
 */
export interface RecoveryStateChangeEvent {
	previousState: RecoveryState;
	currentState: RecoveryState;
	repairAttempts: number;
	failureClass?: ToolFailureClass;
	toolName?: string;
	/** Opaque diagnostic identifier for the family whose state changed. */
	failureFamily?: string;
	recoveryEpisode?: string | null;
}

// -------------------------------------------------------------------------
// Structured runtime outcome (C1.1 classifier)
// -------------------------------------------------------------------------

/**
 * Discriminated union of every outcome the tool-execution boundary can
 * produce. This is the authoritative source of truth for what the runtime
 * saw happen. Control-plane outcomes MUST NOT feed the recovery tracker.
 *
 *   - `success`         → `recordToolSuccess`
 *   - `failure`         → `recordFailure` (subject to `familyConfidence`/`familyEligible`)
 *   - `control_plane`   → structurally excluded from the recovery tracker
 */
export type ToolRuntimeOutcome =
	| {
			kind: "success";
			toolName: string;
			toolCallId: string;
	  }
	| {
			kind: "failure";
			toolName: string;
			toolCallId: string;
			failureClass: ToolFailureClass;
			stableCode: StableFailureCode;
			familyConfidence: "structured" | "fallback";
			familyEligible: boolean;
			error?: unknown;
	  }
	| {
			kind: "control_plane";
			outcome: ControlPlaneOutcome;
			toolName?: string;
			toolCallId?: string;
	  };

/**
 * Structured classification produced at the runtime boundary.
 *
 *   - `familyConfidence = "structured"` → use `failureClass` + `stableCode` directly
 *   - `familyConfidence = "fallback"`    → conservative family convergence if `familyEligible`
 *   - `familyEligible = false`           → exact-only protection; never merged into one family
 */
export interface RecoveryClassification {
	failureClass: ToolFailureClass;
	stableCode: StableFailureCode;
	familyEligible: boolean;
	familyConfidence: "structured" | "fallback";
}

// -------------------------------------------------------------------------
// Typed exhaustion (low-level AgentRunResult discriminator)
// -------------------------------------------------------------------------

export interface RecoveryExhaustedDetails {
	repairAttempts: number;
	failureFamily?: string;
	toolName?: string;
	episodeId?: string | null;
	reason: "circuit_intercepted" | "second_stage_breach";
}
