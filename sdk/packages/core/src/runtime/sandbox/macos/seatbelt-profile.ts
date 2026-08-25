/**
 * SBPL profile generator for the macOS Seatbelt backend.
 *
 * Ports the recon-proven form (ACT-CLINEMM-MACOS-COMMAND-SANDBOX-SEATBELT-RECON01)
 * into a production generator. The shape is intentionally minimal:
 *
 *   (version 1)
 *   (deny default)
 *   (allow process-exec) (allow process-fork)
 *   (allow signal (target self))
 *   (allow sysctl-read) (allow mach-lookup)
 *   (allow file-read* ...with optional require-all require-not exclusions...)
 *   (allow file-write* ...with explicit subpaths and literals...)
 *   (allow file-read-metadata (subpath "/"))
 *   (deny network*)   ;; when capability.network === "deny"
 *   ;; or no network rule at all when capability.network === "allow"
 *
 * Load-bearing rules from the recon (see final-assessment.md):
 *
 *   1. Every path MUST be canonical (realpath) before reaching this
 *      module. `(subpath "/tmp")` does NOT match `/private/tmp/...`
 *      because Seatbelt matches the resolved vnode path.
 *
 *   2. Multiple `(require-not X) (require-not Y)` clauses at the same
 *      filter level behave as OR. We use `(require-all (require-not X)
 *      (require-not Y) ...)` to get AND semantics — i.e. "deny ONLY
 *      if path matches X AND Y AND ...". The profile uses the
 *      "allow file-read* with require-all require-not" form when there
 *      are explicit deny-regions; otherwise it uses the simpler
 *      "allow file-read*" + "deny file-read* (subpath X)" containment
 *      pattern, which is the cleanest form the recon validated.
 *
 *   3. Network denial is `(deny network*)`. There is no per-port
 *      allowlist in Wave-1 (the recon's net-local-only profile used
 *      `(remote ip "localhost:*")` syntax which is parseable only with
 *      that exact string).
 *
 *   4. Every path embedded into SBPL goes through {@link escapeSbplString}.
 *      Naive template-literal interpolation is unsafe; the recon
 *      explicitly called out the need for a tested escape function.
 */

import type { CommandCapability } from "../types";

/**
 * Deterministic ordering of the canonical subpaths that are ALWAYS
 * writable in a sandboxed invocation. These are the absolute minimum
 * required for almost every dev tool to function (process startup,
 * redirection targets).
 *
 * We intentionally do NOT include `/private/var/folders` or `/tmp`
 * here: those are too broad and would let a sandboxed process write
 * to any per-user temp file on the host, which is exactly the kind
 * of damage the sandbox is supposed to bound. Tools that need a
 * scratch dir must use the capability's `tempRoot`.
 *
 * `/dev/null` is the canonical redirection target; `/dev/tty` is
 * needed for interactive prompts; `/dev/zero` is occasionally needed
 * by low-level tools.
 */
export const ALWAYS_WRITABLE_LITERALS: readonly string[] = Object.freeze([
	"/dev/null",
	"/dev/tty",
]);

/**
 * Empty in Wave-1. Reserved for future ACTs that need to add
 * platform-required writable subpaths (e.g. for system service
 * sockets). Keep EMPTY by default — broad write grants defeat
 * defense-in-depth.
 */
export const ALWAYS_WRITABLE_SYSTEM_SUBPATHS: readonly string[] = Object.freeze(
	[],
);

/**
 * Escape a string for safe embedding into SBPL between double quotes.
 *
 * SBPL string literals are delimited by `"`. Inside a literal:
 *
 *   - `\` must be escaped as `\\`;
 *   - `"` must be escaped as `\"`;
 *   - newlines and other control characters are rejected by the
 *     Seatbelt parser. We strip them;
 *   - non-printable / non-ASCII bytes are passed through (Seatbelt's
 *     string parser is byte-oriented on macOS).
 *
 * Adversarial fixture paths the test suite must cover:
 *
 *   - space        → unchanged
 *   - `"`          → `\"`
 *   - `\`          → `\\`
 *   - `(` `)`      → unchanged (parens are NOT special inside a string)
 *   - newline      → stripped (Seatbelt rejects them in string literals)
 *   - tab          → stripped
 *   - unicode      → unchanged
 *   - leading `/`  → unchanged
 *   - empty string → empty string
 */
export function escapeSbplString(input: string): string {
	if (input.length === 0) return "";

	let out = "";
	for (let i = 0; i < input.length; i++) {
		const code = input.charCodeAt(i);
		// Strip control characters (0x00-0x1F, 0x7F). Newlines, tabs,
		// NULs etc. are not legal in SBPL string literals.
		if (code <= 0x1f || code === 0x7f) {
			continue;
		}
		const ch = input[i];
		if (ch === "\\") {
			out += "\\\\";
		} else if (ch === '"') {
			out += '\\"';
		} else {
			out += ch;
		}
	}
	return out;
}

/**
 * Build the read-permission rule.
 *
 * If `denySubpaths` is empty, emits `(allow file-read*)` — a flat
 * allow with no exclusions.
 *
 * If `denySubpaths` is non-empty, emits the recon-validated containment
 * pattern:
 *
 *     (allow file-read*)
 *     (deny file-read* (subpath "<X>"))
 *     ...
 *
 * The kernel matches the resolved vnode path, so symlink escapes are
 * contained as long as the deny-subpaths are themselves canonical.
 */
function buildReadRule(denySubpaths: readonly string[]): string {
	const head = "(allow file-read*)";
	if (denySubpaths.length === 0) {
		return head;
	}
	const denyLines = denySubpaths
		.map((p) => `(deny file-read* (subpath "${escapeSbplString(p)}"))`)
		.join("\n");
	return `${head}\n${denyLines}`;
}

/**
 * Build the write-permission rule.
 *
 * Emits `(allow file-write* ...)` with explicit subpaths and literals:
 * the capability's `writableRoots`, the capability's `tempRoot`, and
 * the always-writable set (`/dev/null`, `/dev/tty`, `/private/var/folders`).
 */
function buildWriteRule(
	writableRoots: readonly string[],
	tempRoot: string | undefined,
): string {
	const subpaths: string[] = [];
	for (const p of writableRoots) {
		subpaths.push(`(subpath "${escapeSbplString(p)}")`);
	}
	if (tempRoot) {
		subpaths.push(`(subpath "${escapeSbplString(tempRoot)}")`);
	}
	for (const p of ALWAYS_WRITABLE_LITERALS) {
		subpaths.push(`(literal "${p}")`);
	}
	for (const p of ALWAYS_WRITABLE_SYSTEM_SUBPATHS) {
		subpaths.push(`(subpath "${p}")`);
	}
	return `(allow file-write*\n  ${subpaths.join("\n  ")})`;
}

/**
 * Build the network rule.
 *
 * `"deny"` → `(deny network*)`. `"allow"` → empty (kernel default).
 */
function buildNetworkRule(network: CommandCapability["network"]): string {
	if (network === "deny") {
		return "(deny network*)";
	}
	return "";
}

/**
 * Build the full SBPL profile from a capability.
 *
 * Inputs MUST be canonical (realpath-resolved) by the caller. This
 * function does NOT canonicalize; canonicalization is the responsibility
 * of {@link ../canonical-paths}.
 *
 * The output is deterministic for a given capability: same capability
 * in → same bytes out. The profile determinism test asserts this so we
 * can hash profiles for evidence.
 *
 * @param capability     The capability (canonicalized paths).
 * @param options.denyReadSubpaths  Paths to add as `(deny file-read*
 *                       (subpath X))`. Use this for "outside"
 *                       containment. Default: `[]` (no deny).
 */
export function generateSeatbeltProfile(
	capability: CommandCapability,
	options: {
		readonly denyReadSubpaths?: readonly string[];
	} = {},
): string {
	const denyRead = options.denyReadSubpaths ?? [];

	const lines: string[] = [
		"(version 1)",
		"(deny default)",
		// Process / signal allowances — required for ANY process to run.
		"(allow process-exec)",
		"(allow process-fork)",
		"(allow signal (target self))",
		"(allow sysctl-read)",
		"(allow mach-lookup)",
		// Read permission with explicit denylist regions.
		buildReadRule(denyRead),
		// Write permission with explicit allowlist regions.
		buildWriteRule(capability.writableRoots, capability.tempRoot),
		// File metadata read for path resolution (stat, lstat).
		"(allow file-read-metadata (subpath \"/\"))",
	];
	const networkRule = buildNetworkRule(capability.network);
	if (networkRule) {
		lines.push(networkRule);
	}
	return lines.join("\n") + "\n";
}


