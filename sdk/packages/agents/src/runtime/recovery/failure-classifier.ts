/**
 * Provenance-first tool-outcome classifier (C1.1).
 *
 * Classifies the typed observation at the runtime boundary into a
 * `ToolRuntimeOutcome` discriminated union. Pure, stateless,
 * browser-safe, non-mutating. The classifier is the **truth** for
 * "what did the runtime see?"; `RecoveryTracker` decisions are made
 * by the C1.2 wiring layer from the typed outcome this function
 * returns — NEVER from `result.isError` alone.
 *
 * ## Classification priority (normative)
 *
 *   1. Explicit control-plane outcome → `control_plane` (outranks
 *      `result.isError`).
 *   2. Registry miss (`toolExists=false`) → `failure / tool_not_found`.
 *      Fires regardless of `toolExecutionInvoked`, because the
 *      production shape of an unknown tool is `toolExists=false ∧
 *      toolExecutionInvoked=false` (the unknown-tool path does NOT
 *      then invoke `tool.execute(...)`).
 *   3. Input-parse provenance → `failure / tool_input_invalid`. When
 *      only prose is available, the stable code is `unknown /
 *      fallback / familyEligible=false`. The classifier does NOT
 *      invent `schema:missing_required` from text.
 *   4. `toolExecutionInvoked=false` (only reached when `toolExists=true`)
 *      → `control_plane / runtime_skipped`. Structurally excluded from
 *      failure so C1.2 cannot feed a never-executed action into
 *      `RecoveryTracker`.
 *   5. Executor throw — structured `err.code` (ENOENT / EACCES / any
 *      other string code) → `failure / tool_execution_error /
 *      <code> / structured / familyEligible`. Otherwise → `failure /
 *      tool_execution_error / unknown / fallback / familyEligible=false`.
 *   6. Result-level failure (`isError=true` with no throw) — only
 *      `exitCode` is structured today; otherwise `unknown / fallback
 *      / familyEligible=false`. No prose scraping.
 *   7. Otherwise → `success`.
 */

import type {
	ControlPlaneOutcome,
	RecoveryClassification,
	StableFailureCode,
	ToolRuntimeOutcome,
} from "@cline/shared";
import { serializeFailureCode } from "@cline/shared";

// ---------------------------------------------------------------------------
// Input shape — small typed observation at the runtime boundary.
// ---------------------------------------------------------------------------

/**
 * Boundary observation passed into the classifier. Mirrors the
 * provenances that already exist in `AgentRuntime`:
 *
 *   - `toolExists` — registry lookup result (true iff `tools.get`
 *     returned a real tool).
 *   - `toolExecutionInvoked` — whether the real `tool.execute(...)`
 *     function was actually invoked. Distinct from registry: an
 *     unknown tool has `toolExists=false ∧ toolExecutionInvoked=false`,
 *     a real-but-skipped tool has `toolExists=true ∧ toolExecutionInvoked=false`,
 *     and a real-thrown tool has both true.
 *   - `inputParseError` — parse-provenance (no prose scraping).
 *   - `skipReason` — free-form skip reason (canonical classifier for
 *     skip paths is `control_plane / runtime_skipped`).
 *   - `executionError` — verbatim throw carrying `err.code`.
 *   - `result` — `AgentToolResult` returned by the boundary.
 *   - `controlPlaneOutcome` — explicit control-plane signal;
 *     outranks every other provenance.
 *
 * The classifier does NOT receive `RecoveryTracker`, the agent
 * runtime, or any mutable runtime state.
 */
export interface ToolOutcomeClassificationInput {
	toolName: string;
	toolCallId: string;

	/**
	 * True iff `tools.get(toolName)` returned a real tool. Determines
	 * whether registry-miss classification is in scope.
	 */
	toolExists: boolean;

	/**
	 * True iff `tool.execute(...)` was actually invoked. Distinct from
	 * `toolExists`: the boundary may prepare but never invoke a known
	 * tool (policy / hook / approval skip), and an unknown tool has
	 * both `toolExists=false ∧ toolExecutionInvoked=false`.
	 */
	toolExecutionInvoked: boolean;

	/** Structured input-parse error provenance (NOT prose). */
	inputParseError?: unknown;

	/** Free-form skip reason from `prepareToolExecution`. */
	skipReason?: string;

	/** Verbatim throw from `tool.execute(...)` carrying `err.code`. */
	executionError?: unknown;

	/** `AgentToolResult` returned by the boundary. */
	result?: {
		isError?: boolean;
		output?: unknown;
		/** Optional structured exit code (for shell-style tools). */
		exitCode?: number;
	};

	/** Explicit control-plane signal observed at the boundary. */
	controlPlaneOutcome?: ControlPlaneOutcome;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * `err.code` policy: see `./failure-code.ts`. ENOENT / EACCES are
 * surfaced as first-class enum members; any other string `err.code`
 * exposed by the boundary is surfaced as `{ code }` and treated as a
 * structured family.
 */
import {
	readErrorCode,
	classifyErrnoCode,
	controlPlaneOutcomeShape,
	successOutcomeShape,
	failureOutcomeShape,
} from "./failure-code";


// ---------------------------------------------------------------------------
// Public classifier
// ---------------------------------------------------------------------------

/**
 * Classify a tool-runtime observation into the canonical
 * `ToolRuntimeOutcome`. Pure, stateless, browser-safe.
 *
 * @see {@link ToolOutcomeClassificationInput} for the input shape.
 */
export function classifyToolRuntimeOutcome(
	input: ToolOutcomeClassificationInput,
): ToolRuntimeOutcome {
	// Priority 1 — explicit control-plane provenance.
	// Outranks every other signal, including `result.isError`.
	if (input.controlPlaneOutcome !== undefined) {
		return controlPlaneOutcomeShape(
			input.controlPlaneOutcome,
			input.toolName,
			input.toolCallId,
		);
	}

	// Priority 2 — registry miss (`toolExists=false`). Provenance-driven,
	// NOT prose-scrape. Fires regardless of `toolExecutionInvoked`
	// because the production shape of an unknown tool is
	// `toolExists=false ∧ toolExecutionInvoked=false` (the unknown-tool
	// path does NOT then invoke `tool.execute(...)`).
	if (!input.toolExists) {
		return failureOutcomeShape(
			input.toolName,
			input.toolCallId,
			"tool_not_found",
			"tool:not_found",
			"structured",
			true,
			input.executionError,
		);
	}

	// Priority 3 — input-parse provenance. The production boundary
	// surfaces only a string message today; we do NOT invent
	// `schema:missing_required` from prose because the prose cannot
	// distinguish `missing_required` / `invalid_type` / `unknown_property`.
	// All three would otherwise collapse into one convergence family.
	if (input.inputParseError !== undefined) {
		return failureOutcomeShape(
			input.toolName,
			input.toolCallId,
			"tool_input_invalid",
			"unknown",
			"fallback",
			false,
			input.inputParseError,
		);
	}

	// Priority 4 — runtime skip (`toolExists=true` ∧
	// `toolExecutionInvoked=false`). `controlPlaneOutcome` would have
	// already returned at Priority 1 if the caller had a more specific
	// reason. We surface this as `control_plane / runtime_skipped` so
	// C1.2 cannot accidentally feed a never-executed action into
	// `RecoveryTracker`. At this point registry-miss is impossible
	// (`toolExists=true` is proven by Priority 2).
	if (!input.toolExecutionInvoked) {
		return controlPlaneOutcomeShape(
			"runtime_skipped",
			input.toolName,
			input.toolCallId,
		);
	}

	// Priority 5 — executor throw. Read structured `err.code` if
	// present; everything else is opaque.
	if (input.executionError !== undefined) {
		const code = readErrorCode(input.executionError);
		if (code !== undefined) {
			return failureOutcomeShape(
				input.toolName,
				input.toolCallId,
				"tool_execution_error",
				classifyErrnoCode(code),
				"structured",
				true,
				input.executionError,
			);
		}
		// Opaque throw.
		return failureOutcomeShape(
			input.toolName,
			input.toolCallId,
			"tool_execution_error",
			"unknown",
			"fallback",
			false,
			input.executionError,
		);
	}

	// Priority 6 — result-level failure (`isError=true` with no
	// throw). Only `exitCode` is structured today.
	if (input.result?.isError === true) {
		const exit = input.result.exitCode;
		if (typeof exit === "number" && Number.isFinite(exit)) {
			return failureOutcomeShape(
				input.toolName,
				input.toolCallId,
				"tool_execution_error",
				{ exit },
				"structured",
				true,
				input.result.output,
			);
		}
		// Opaque `isError=true` — no stable family, no prose scrape.
		return failureOutcomeShape(
			input.toolName,
			input.toolCallId,
			"tool_execution_error",
			"unknown",
			"fallback",
			false,
			input.result.output,
		);
	}

	// Priority 7 — success.
	return successOutcomeShape(input.toolName, input.toolCallId);
}

// ---------------------------------------------------------------------------
// Narrowing helper
// ---------------------------------------------------------------------------

/**
 * Narrow a `ToolRuntimeOutcome` to the failure branch. Useful in
 * C1.2+ when the runtime wiring layer decides how to update the
 * tracker; TypeScript prevents accidental access to failure
 * properties on `control_plane` outcomes.
 */
export function isRecoverableToolFailure(
	outcome: ToolRuntimeOutcome,
): outcome is Extract<ToolRuntimeOutcome, { kind: "failure" }> {
	return outcome.kind === "failure";
}

// ---------------------------------------------------------------------------
// Handoff helpers (Stage-1 → C1.2)
// ---------------------------------------------------------------------------

/**
 * Project a failure outcome to the `RecoveryClassification` shape
 * that Stage 1 already locks. The typed handoff C1.2 will consume to
 * build `ToolFamilyIdentity` and route through `RecoveryTracker`.
 *
 * The parameter type is the failure-narrowed outcome, so callers
 * MUST narrow first (`isRecoverableToolFailure`). Pure — no
 * `RecoveryTracker` calls here.
 */
export function toRecoveryClassification(
	outcome: Extract<ToolRuntimeOutcome, { kind: "failure" }>,
): RecoveryClassification {
	return {
		failureClass: outcome.failureClass,
		stableCode: outcome.stableCode,
		familyEligible: outcome.familyEligible,
		familyConfidence: outcome.familyConfidence,
	};
}

/**
 * Serialize a `StableFailureCode` via the Stage-1 owner.
 * Re-exported here so C1.2 callers don't need to import from
 * `@cline/shared` directly. Single owner of serialisation — the
 * classifier does not maintain a parallel implementation.
 */
export function serializeStableFailureCode(code: StableFailureCode): string {
	return serializeFailureCode(code);
}
