/**
 * `err.code` reader + policy.
 *
 * `ENOENT` and `EACCES` are first-class enum members of
 * `StableFailureCode`; we surface them by literal so
 * `serializeFailureCode` keeps them readable.
 *
 * Any other string `err.code` exposed by the boundary is surfaced
 * as `{ code }` and IS treated as a structured family
 * (`familyEligible=true`). The runtime chose to expose the code,
 * so the classifier trusts it. The pure-prose error path is
 * reserved for true unknowns (no `.code`).
 *
 * This is NOT a conservative allowlist; it is a typed canonical
 * shortcut. C1.2+ may revisit the policy when runtime-tool
 * contracts for arbitrary codes are clearer.
 *
 * Browser-safe (no globals, no Node builtins).
 */
import type {
	ControlPlaneOutcome,
	StableFailureCode,
	ToolFailureClass,
	ToolRuntimeOutcome,
} from "@cline/shared";

/** First-class enum members surfaced by literal. */
const STRUCTURED_ERRNO_CODES = new Set(["ENOENT", "EACCES"]);

/**
 * Read `err.code` from a thrown value. Returns `undefined` when the
 * value is not an Error-shaped object with a string `.code`.
 */
export function readErrorCode(err: unknown): string | undefined {
	if (err === null || typeof err !== "object") return undefined;
	const code = (err as { code?: unknown }).code;
	if (typeof code !== "string") return undefined;
	return code;
}

/**
 * Produce a `StableFailureCode` for an `err.code`. ENOENT / EACCES
 * are returned literally; any other string code is returned as the
 * `{ code }` shape. Both are structured families, so the caller
 * still sets `familyEligible=true`.
 */
export function classifyErrnoCode(code: string): StableFailureCode {
	if (STRUCTURED_ERRNO_CODES.has(code)) {
		return code as StableFailureCode;
	}
	return { code };
}

/**
 * Shape constructors for `ToolRuntimeOutcome`. Centralised so the
 * classifier's priority logic stays focused on branch ordering, not
 * literal construction.
 */
export function controlPlaneOutcomeShape(
	outcome: ControlPlaneOutcome,
	toolName: string,
	toolCallId: string,
): ToolRuntimeOutcome {
	return { kind: "control_plane", outcome, toolName, toolCallId };
}

export function successOutcomeShape(
	toolName: string,
	toolCallId: string,
): ToolRuntimeOutcome {
	return { kind: "success", toolName, toolCallId };
}

export function failureOutcomeShape(
	toolName: string,
	toolCallId: string,
	failureClass: ToolFailureClass,
	stableCode: StableFailureCode,
	familyConfidence: "structured" | "fallback",
	familyEligible: boolean,
	error?: unknown,
): Extract<ToolRuntimeOutcome, { kind: "failure" }> {
	return {
		kind: "failure",
		toolName,
		toolCallId,
		failureClass,
		stableCode,
		familyConfidence,
		familyEligible,
		error,
	};
}
