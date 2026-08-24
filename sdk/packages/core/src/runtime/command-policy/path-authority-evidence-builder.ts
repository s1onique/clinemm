/**
 * ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION01
 * REALPATH_WORKSPACE_CONFINEMENT
 *
 * Host-side helper for building `WorkspacePathAuthorityEvidence`.
 *
 * ARCHITECTURE INVARIANT:
 *   policy = pure (no filesystem I/O)
 *   filesystem = host authority
 *
 * This module is the ONLY sanctioned place in the policy stack
 * where `fs.realpathSync` is called. It lives here, in the SDK,
 * so CLI and VS Code both use the SAME realpath-resolution
 * policy. The host calls one of the `build*Evidence` helpers,
 * packages the result, and passes it through
 * `CommandHostAuthorization.pathAuthorityEvidence`.
 *
 * FAIL-CLOSED CONTRACT:
 *   - ENOENT (path does not exist)         → resolvedRealPath = null
 *   - EACCES (permission denied)           → resolvedRealPath = null
 *   - ELOOP  (symlink loop)                → resolvedRealPath = null
 *   - ENOTDIR (a path component is not a dir) → resolvedRealPath = null
 *   - Any other fs error                   → resolvedRealPath = null
 *   - resolvedRealPath === null            ⇒ ASK (never ALLOW)
 *
 * The function NEVER throws on a realpath failure; it always
 * packages the failure as `resolvedRealPath: null` so the policy
 * layer can fail closed uniformly.
 *
 * ACT-CLINEMM-COMMAND-APPROVAL-SPLIT-UNDEFINED-REGRESSION01
 * PRODUCTION-BOUNDARY NORMALIZATION:
 *
 * The `command` field is typed `unknown` (not `NormalizedCommand`).
 * Host adapters (VSCode `SdkController.buildPathAuthorityEvidence`,
 * CLI `cliEvaluateCommandToolApproval`) pass the RAW `toolInput`
 * straight through — they do NOT pre-normalize. Forgetting the
 * pre-normalize step was the source of the P0 regression where
 * `pwd` and other trivial commands threw
 * `TypeError: Cannot read properties of undefined (reading 'split')`
 * in `extractPathOperands` because the input shape was not a
 * `NormalizedCommand`.
 *
 * This function is the SDK boundary that normalizes the input via
 * the canonical `normalizeRunCommandsInput` (the SAME normalizer
 * the policy layer uses internally in `normalizeForPolicy`). On
 * normalization failure, we return `ok: false` with a new
 * `unparseable-command` reason — the host treats that the same
 * way it treats `no-workspace-roots` (path authority disabled,
 * fail-closed posture per CORRECTION02).
 */

import { realpathSync } from "node:fs";
import { isAbsolute, resolve as resolvePath } from "node:path";

import { normalizeRunCommandsInput } from "../../extensions/tools/helpers";
import type { NormalizedCommand } from "./command-policy-types";
import { extractPathOperands } from "./path-authority";
import type {
	WorkspacePathAuthorityEvidence,
	WorkspacePathOperandEvidence,
} from "./path-authority-evidence";

// ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION01
// REALPATH_WORKSPACE_CONFINEMENT:
//
// Re-export the evidence types from this module so the
// top-level `@cline/core` index can re-export them in a single
// statement. The canonical definition lives in
// `path-authority-evidence.ts`.
export type { WorkspacePathAuthorityEvidence, WorkspacePathOperandEvidence };

/** Reason codes captured per operand for diagnostics. */
type OperandReason = WorkspacePathOperandEvidence["reason"];

/**
 * Safely resolve a single path operand to its canonical
 * pathname. Returns `null` on any error.
 *
 * For relative operands, `cwd` is required; without it, the
 * operand is unresolved.
 */
export function safeRealpathSync(
	operand: string,
	cwd: string | null,
):
	| {
			resolvedRealPath: string;
			reason: "resolved-and-contained" | "resolved-but-outside-roots";
	  }
	| { resolvedRealPath: null; reason: OperandReason } {
	const trimmed = operand.trim();
	if (trimmed.length === 0) {
		return { resolvedRealPath: null, reason: "realpath-failed-other" };
	}
	if (trimmed.startsWith("~")) {
		return { resolvedRealPath: null, reason: "realpath-failed-other" };
	}
	const isAbs = isAbsolute(trimmed);
	if (!isAbs && (cwd === null || cwd.length === 0)) {
		return { resolvedRealPath: null, reason: "realpath-failed-other" };
	}
	let resolved: string;
	try {
		resolved = isAbs ? resolvePath(trimmed) : resolvePath(cwd ?? "", trimmed);
	} catch {
		return { resolvedRealPath: null, reason: "realpath-failed-other" };
	}
	try {
		const canonical = realpathSync(resolved);
		return { resolvedRealPath: canonical, reason: "resolved-and-contained" };
	} catch (err) {
		const code = (err as NodeJS.ErrnoException)?.code;
		switch (code) {
			case "ENOENT":
				return { resolvedRealPath: null, reason: "realpath-failed-enoent" };
			case "EACCES":
			case "EPERM":
				return { resolvedRealPath: null, reason: "realpath-failed-eacces" };
			case "ELOOP":
				return { resolvedRealPath: null, reason: "realpath-failed-eloop" };
			default:
				return { resolvedRealPath: null, reason: "realpath-failed-other" };
		}
	}
}

/**
 * Containment on canonical paths: identical to the policy
 * layer's rule (`root + path.sep` boundary, "/" catch-all).
 */
function isCanonicalContained(
	canonical: string,
	roots: ReadonlyArray<string>,
): boolean {
	for (const root of roots) {
		if (root.length === 0) {
			continue;
		}
		if (canonical === root) {
			return true;
		}
		if (root === "/") {
			return true;
		}
		if (canonical.startsWith(`${root}/`)) {
			return true;
		}
	}
	return false;
}

export interface BuildPathEvidenceOptions {
	workspaceRoots: ReadonlyArray<string>;
	cwd: string | null;
	/**
	 * The command to build evidence for.
	 *
	 * ACT-CLINEMM-COMMAND-APPROVAL-SPLIT-UNDEFINED-REGRESSION01:
	 * typed `unknown` because the host adapters (CLI / VSCode) pass
	 * the RAW `toolInput` (which is a JSON object the model emitted),
	 * NOT a pre-normalized `NormalizedCommand`. The canonical
	 * `normalizeRunCommandsInput` runs INSIDE this function so the
	 * host never has to remember to pre-normalize.
	 *
	 * Accepting a pre-normalized `NormalizedCommand` directly is
	 * also supported for unit-test fixtures that already have a
	 * normalized value.
	 */
	command: unknown;
}

export interface BuildPathEvidenceFailure {
	ok: false;
	reason:
		| "no-workspace-roots"
		| "realpath-threw-uncaught"
		| "unparseable-command";
	error?: unknown;
}

export interface BuildPathEvidenceSuccess {
	ok: true;
	evidence: WorkspacePathAuthorityEvidence;
}

export type BuildPathEvidenceResult =
	| BuildPathEvidenceSuccess
	| BuildPathEvidenceFailure;

/**
 * Run the canonical input normalizer and collapse the result
 * into a list of `NormalizedCommand` values. Returns `null`
 * when the input is unparseable.
 *
 * ACT-CLINEMM-COMMAND-APPROVAL-SPLIT-UNDEFINED-REGRESSION01:
 * Host adapters used to bypass this normalization at the
 * production boundary, which caused `extractPathOperands` to
 * throw `TypeError: Cannot read properties of undefined
 * (reading 'split')` for inputs like `{ commands: ["pwd"] }`,
 * `{ cmd: "x" }`, arrays, and other shapes the policy layer's
 * own normalizer accepts. We now normalize at the SDK boundary.
 */
function normalizeForEvidence(
	input: unknown,
): ReadonlyArray<NormalizedCommand> | null {
	if (input == null) {
		return null;
	}

	// Fast path: already a NormalizedCommand (string or
	// `{command, args?}`). This preserves the existing test
	// fixtures that hand-build `{ command: "..." }` shapes
	// without paying the schema-validation cost.
	if (typeof input === "string") {
		return input.length > 0 ? [input] : null;
	}
	if (typeof input === "object") {
		const obj = input as Record<string, unknown>;
		if (
			typeof obj.command === "string" &&
			obj.command.length > 0 &&
			(obj.args === undefined || Array.isArray(obj.args))
		) {
			return [obj as unknown as NormalizedCommand];
		}
	}

	let normalized: ReadonlyArray<unknown>;
	try {
		normalized = normalizeRunCommandsInput(input);
	} catch {
		return null;
	}
	if (normalized.length === 0) {
		return null;
	}

	// Each element must be a string or `{command, args?}` to be a
	// valid NormalizedCommand — anything else (e.g. arrays that
	// the schema accepted but `renderNormalizedCommand` cannot
	// reduce to a single string) is rejected here.
	const out: NormalizedCommand[] = [];
	for (const element of normalized) {
		if (typeof element === "string") {
			if (element.length === 0) {
				return null;
			}
			out.push(element);
			continue;
		}
		if (element && typeof element === "object") {
			const obj = element as Record<string, unknown>;
			if (
				typeof obj.command === "string" &&
				obj.command.length > 0 &&
				(obj.args === undefined || Array.isArray(obj.args))
			) {
				out.push(element as NormalizedCommand);
				continue;
			}
		}
		return null;
	}
	return out;
}

/**
 * Build the complete `WorkspacePathAuthorityEvidence` for a
 * single command. See module header for the fail-closed
 * contract.
 *
 * Returns `ok: false` (with reason `no-workspace-roots`) when
 * ANY configured workspace root fails to realpath-resolve. The
 * host MUST treat that as a configuration error and not pass
 * the (incomplete) evidence to the policy layer.
 *
 * Returns `ok: false` (with reason `unparseable-command`) when
 * the input cannot be normalized to a `NormalizedCommand`. The
 * host treats this identically to `no-workspace-roots`: path
 * authority is disabled; under CORRECTION02 the policy
 * downgrades the path-bearing R0 rule to ASK.
 *
 * The function NEVER throws on a realpath failure or a
 * normalization failure — both are packaged as `ok: false` so
 * the policy layer can fail closed uniformly.
 */
export function buildPathAuthorityEvidence(
	options: BuildPathEvidenceOptions,
): BuildPathEvidenceResult {
	const { workspaceRoots, cwd } = options;

	// ACT-CLINEMM-COMMAND-APPROVAL-SPLIT-UNDEFINED-REGRESSION01:
	// Normalize the raw host input through the canonical normalizer
	// BEFORE any path-authority work. Failure here is fail-closed.
	const normalizedCommands = normalizeForEvidence(options.command);
	if (normalizedCommands === null) {
		return { ok: false, reason: "unparseable-command" };
	}

	const canonicalRoots: string[] = [];
	for (const root of workspaceRoots) {
		try {
			canonicalRoots.push(realpathSync(root));
		} catch {
			return { ok: false, reason: "no-workspace-roots" };
		}
	}

	let canonicalCwd: string | null = cwd;
	if (cwd !== null) {
		try {
			canonicalCwd = realpathSync(cwd);
		} catch {
			canonicalCwd = cwd;
		}
	}

	// ACT-CLINEMM-COMMAND-APPROVAL-SPLIT-UNDEFINED-REGRESSION01:
	// Multi-command inputs (e.g. `{ commands: ["ls /etc", "ls /var"] }`)
	// are flattened into a single operands array. The CORRECTION02
	// operand identity binding is checked per-command later in the
	// policy layer (it sees a single `NormalizedCommand` per call),
	// so flattening at the evidence builder is the right seam.
	const operandEvidence: WorkspacePathOperandEvidence[] = [];
	for (const command of normalizedCommands) {
		const operands = extractPathOperands(command);
		for (const op of operands) {
			const resolved = safeRealpathSync(op, canonicalCwd);
			if (resolved.resolvedRealPath === null) {
				operandEvidence.push({
					operand: op,
					resolvedRealPath: null,
					contained: false,
					reason: resolved.reason,
				});
				continue;
			}
			const contained = isCanonicalContained(
				resolved.resolvedRealPath,
				canonicalRoots,
			);
			operandEvidence.push({
				operand: op,
				resolvedRealPath: resolved.resolvedRealPath,
				contained,
				reason: contained
					? "resolved-and-contained"
					: "resolved-but-outside-roots",
			});
		}
	}

	return {
		ok: true,
		evidence: {
			roots: canonicalRoots,
			cwd: canonicalCwd,
			operands: operandEvidence,
		},
	};
}
