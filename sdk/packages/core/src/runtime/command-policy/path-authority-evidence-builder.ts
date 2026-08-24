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
 */

import { realpathSync } from "node:fs";
import { isAbsolute, resolve as resolvePath } from "node:path";

import type { NormalizedCommand } from "./command-policy-types";
import { extractPathOperands } from "./path-authority";
import {
	type WorkspacePathAuthorityEvidence,
	type WorkspacePathOperandEvidence,
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
	| { resolvedRealPath: string; reason: "resolved-and-contained" | "resolved-but-outside-roots" }
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
		if (canonical.startsWith(root + "/")) {
			return true;
		}
	}
	return false;
}

export interface BuildPathEvidenceOptions {
	workspaceRoots: ReadonlyArray<string>;
	cwd: string | null;
	command: NormalizedCommand;
}

export interface BuildPathEvidenceFailure {
	ok: false;
	reason: "no-workspace-roots" | "realpath-threw-uncaught";
	error?: unknown;
}

export interface BuildPathEvidenceSuccess {
	ok: true;
	evidence: WorkspacePathAuthorityEvidence;
}

export type BuildPathEvidenceResult = BuildPathEvidenceSuccess | BuildPathEvidenceFailure;

/**
 * Build the complete `WorkspacePathAuthorityEvidence` for a
 * single command. See module header for the fail-closed
 * contract.
 *
 * Returns `ok: false` (with reason `no-workspace-roots`) when
 * ANY configured workspace root fails to realpath-resolve. The
 * host MUST treat that as a configuration error and not pass
 * the (incomplete) evidence to the policy layer.
 */
export function buildPathAuthorityEvidence(
	options: BuildPathEvidenceOptions,
): BuildPathEvidenceResult {
	const { workspaceRoots, cwd, command } = options;

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

	const operands = extractPathOperands(command);
	const operandEvidence: WorkspacePathOperandEvidence[] = [];
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

	return {
		ok: true,
		evidence: {
			roots: canonicalRoots,
			cwd: canonicalCwd,
			operands: operandEvidence,
		},
	};
}