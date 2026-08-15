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
	| { schema: "missing_required" | "invalid_type" | "unknown_property"; field?: string }
	| "tool:not_found"
	| "protocol:malformed_result"
	| "protocol:encoding_error"
	| { code: string };

export function serializeFailureCode(code: StableFailureCode): string {
	if (typeof code === "string") return code;
	if ("exit" in code) return `exit:${code.exit}`;
	if ("code" in code) return `code:${code.code}`;
	if ("schema" in code) return `schema:${code.schema}${code.field ? `:${code.field}` : ""}`;
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