/**
 * Canonical-path helper for sandbox backend input.
 *
 * macOS exposes many synthetic symlinks (`/tmp` → `/private/tmp`,
 * `/var` → `/private/var`, etc.). Seatbelt's `(subpath "/tmp")` filter
 * matches against the RESOLVED vnode path, not the textual path passed
 * by the process. So a textual `/tmp/...` in a profile does NOT match a
 * process that opens `/private/tmp/...`.
 *
 * The recon (ACT-CLINEMM-MACOS-COMMAND-SANDBOX-SEATBELT-RECON01) found
 * this is the #1 implementation gotcha. This helper provides the single
 * authority that canonicalizes a path before it enters the backend.
 *
 * Fail-closed behavior:
 *
 * - `ENOENT` (path does not exist): throw {@link SandboxError} with
 *   reason `"canonicalization-failed"`.
 * - `EACCES`, `ELOOP`, `ENOTDIR`: same.
 * - Unsupported path types (non-string, empty string): same.
 *
 * The executor MUST treat thrown errors as fail-closed.
 */

import { realpathSync } from "node:fs";

import { SandboxError } from "./types";

const FAIL_CLOSED_ERRORS = new Set([
	"ENOENT",
	"EACCES",
	"ELOOP",
	"ENOTDIR",
	"ENAMETOOLONG",
]);

/**
 * Canonicalize a path using `fs.realpathSync`.
 *
 * The returned path is the resolved vnode path (e.g. `/tmp` → `/private/tmp`).
 *
 * Throws {@link SandboxError} (reason: `"canonicalization-failed"`) on:
 * - non-string input
 * - empty string
 * - underlying `realpathSync` failure with a known fail-closed errno
 *
 * Other realpath failures (e.g. `EINVAL`) also throw — we are intentionally
 * conservative: any path we cannot canonicalize is rejected, never silently
 * substituted with a textual form.
 */
export function canonicalizeSandboxRoot(path: unknown): string {
	if (typeof path !== "string") {
		throw new SandboxError(
			`canonicalizeSandboxRoot: expected string, got ${typeof path}`,
			{ backendId: "canonicalize", reason: "canonicalization-failed" },
		);
	}
	if (path.length === 0) {
		throw new SandboxError("canonicalizeSandboxRoot: empty path", {
			backendId: "canonicalize",
			reason: "canonicalization-failed",
		});
	}

	let resolved: string;
	try {
		resolved = realpathSync(path);
	} catch (cause) {
		const code = (cause as NodeJS.ErrnoException | undefined)?.code;
		const message = `canonicalizeSandboxRoot: realpath failed for ${JSON.stringify(path)}${
			code ? ` (${code})` : ""
		}`;
		// Known fail-closed errors: throw SandboxError. Other errors: also
		// throw — never silently substitute.
		throw new SandboxError(message, {
			backendId: "canonicalize",
			reason: "canonicalization-failed",
			cause,
		});
	}

	if (typeof resolved !== "string" || resolved.length === 0) {
		// Should not happen on POSIX, but defense in depth.
		throw new SandboxError(
			`canonicalizeSandboxRoot: realpath returned empty for ${JSON.stringify(path)}`,
			{ backendId: "canonicalize", reason: "canonicalization-failed" },
		);
	}

	return resolved;
}

/**
 * Best-effort existence probe. Does NOT throw; returns `false` on any
 * filesystem error (ENOENT, EACCES, ELOOP, ...). Used by the executor
 * to decide whether to call `prepare()` (which will canonicalize the
 * roots) before constructing a capability — keeping the fail-closed
 * surface narrow.
 */
export function pathExistsForCanonicalization(path: unknown): boolean {
	if (typeof path !== "string" || path.length === 0) {
		return false;
	}
	try {
		realpathSync(path);
		return true;
	} catch (err) {
		const code = (err as NodeJS.ErrnoException | undefined)?.code;
		// Real "does not exist" → false. Other errors → also false
		// (we prefer to surface the canonicalize failure later from
		// the backend than to silently skip).
		if (code && FAIL_CLOSED_ERRORS.has(code)) {
			return false;
		}
		return false;
	}
}
