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

import { realpathSync } from "node:fs";

import type { CommandCapability } from "../types";
import { SandboxError } from "../types";

/**
 * Deterministic ordering of the canonical subpaths that are ALWAYS
 * writable in a sandboxed invocation. These are the absolute minimum
 * required for almost every dev tool to function (process startup,
 * redirection targets).
 *
 * The capability's `tempRoot` is for per-invocation synthesized scratch
 * space (allocated under `os.tmpdir()` and torn down on completion).
 * It is NOT a substitute for canonical `/tmp` — many tools hard-code
 * literal `/tmp` (which on darwin resolves to `/private/tmp`) and BSD
 * `mktemp` ignores `$TMPDIR` per Apple's platform contract. See
 * {@link ALWAYS_WRITABLE_TEMP_SUBPATHS} for the explicit `/tmp`
 * compatibility grant.
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
 *
 * Note: this constant does NOT carry the system-temp grant.
 * That lives in {@link ALWAYS_WRITABLE_TEMP_SUBPATHS}, which
 * has a dedicated category because it is
 *   (a) ALWAYS allowed (independent of capability),
 *   (b) bounded to canonical temp roots only (NOT `/var/folders`
 *       blanket or arbitrary per-user dirs), and
 *   (c) load-bearing for ordinary tooling (compilers, package
 *       managers, shell pipelines, archive tools, test runners,
 *       language runtimes that hard-code `/tmp`).
 */
export const ALWAYS_WRITABLE_SYSTEM_SUBPATHS: readonly string[] = Object.freeze(
	[],
);

/**
 * ACT-CLINEMM-SEATBELT-TEMP-WRITE-AUTHORITY01:
 *
 * Canonical `/tmp` granted as an always-writable subpath in seatbelt
 * workspace-write mode. This is an EXPLICIT PRODUCT-POLICY CHOICE for
 * `/tmp` compatibility (many tools hard-code literal `/tmp` and BSD
 * `mktemp` ignores `$TMPDIR`), not a "capability-private scratch area"
 * pattern. The blast radius is documented in the kernel matrix test
 * `darwin-seatbelt-temp-write-authority01.c1-green.test.ts` T9.
 *
 * The invariant: write authority for `os.tmpdir()` (the per-user
 * `/private/var/folders/.../T`) is NOT included here. Tooling that
 * honors `$TMPDIR` (Node.js, GNU coreutils, most non-BSD tools) is
 * steered into the capability's private `tempRoot` via
 * {@link materializeEnvironment} setting `TMPDIR`/`TMP`/`TEMP` to
 * the synthesized per-invocation root. That is the bounded path.
 *
 * Why canonicalize `/tmp`:
 *
 *   macOS exposes `/tmp` as a synthetic symlink to `/private/tmp`.
 *   Seatbelt subpath filters match the RESOLVED vnode path (per
 *   canonical-paths.ts and the recon), so the textual `/tmp` in a
 *   profile would NOT match a process opening `/tmp/foo` (which the
 *   kernel resolves to `/private/tmp/foo`). We must canonicalize.
 *
 * Why NOT also canonicalize `os.tmpdir()`:
 *
 *   `os.tmpdir()` returns the current process's per-user temp root
 *   (`/private/var/folders/<user>/T`). Granting that entire subtree
 *   as always-writable lets a sandboxed command overwrite, delete,
 *   or rename ANY temp artifact owned by that user — not just its
 *   own scratch area. That is a materially larger authority expansion
 *   than `/tmp` (which is a shared system temp, not user-owned). The
 *   bounded pattern is to keep per-user temp authority inside the
 *   capability-private `tempRoot` (one subtree per invocation, with
 *   `TMPDIR`/`TMP`/`TEMP` materialization to steer tooling).
 *
 * Resolution: compute the canonical subpath LAZILY at module load
 * via `realpathSync`. If `realpathSync` fails (defensive; on linux
 * `/tmp` resolves to the linux tmp root which the Seatbelt backend
 * never sees), the array is empty — the profile generator emits
 * nothing. The Seatbelt backend itself only activates on darwin.
 *
 * Module-private: the constant is consumed by `buildWriteRule` only.
 * Test coverage asserts on the RENDERED profile SBPL (the real
 * authority surface), not on this constant's contents — no SDK
 * surface is added for test introspection.
 */
const ALWAYS_WRITABLE_TEMP_SUBPATHS: readonly string[] = Object.freeze(
	(() => {
		try {
			return [realpathSync("/tmp")];
		} catch {
			return [];
		}
	})(),
);

/**
 * Escape a string for safe embedding into SBPL between double quotes.
 *
 * SBPL string literals are delimited by `"`. Inside a literal:
 *
 *   - `\` must be escaped as `\\`;
 *   - `"` must be escaped as `\"`;
 *   - newline, tab, NUL, and any other C0 control character (0x00–0x1F)
 *     or DEL (0x7F) are NOT legal in SBPL string literals.
 *
 * CORRECTION01: We DO NOT silently strip control characters. Silently
 * stripping them changes the identity of the path (e.g. `/tmp/foo\nbar`
 * would be rendered as `/tmp/foobar`, which is a different path the
 * kernel might authorize). Stripping is exactly the same defect class
 * as the canonical-path aliasing errors we spent prior ACTs eliminating.
 *
 * The function THROWS `SandboxError` (reason: `profile-generation-failed`)
 * when the input contains a control character. The caller MUST treat
 * this as fail-closed.
 */
export function escapeSbplString(input: string): string {
	if (input.length === 0) return "";

	let out = "";
	for (let i = 0; i < input.length; i++) {
		const code = input.charCodeAt(i);
		if (code <= 0x1f || code === 0x7f) {
			throw new SandboxError(
				`escapeSbplString: control character 0x${code.toString(16)} at index ${i} in ${JSON.stringify(input)} — refusing to silently alias`,
				{ backendId: "seatbelt-profile", reason: "profile-generation-failed" },
			);
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
 * CORRECTION01 (P0-1): Read-permission rule.
 *
 * Architecture: macOS Seatbelt cannot enforce a true positive read
 * allow set without enumerating EVERY path dyld opens during process
 * startup. The empirically-correct shape (validated by the recon and
 * used by Anthropic's sandbox-runtime) is:
 *
 *     (allow file-read*)                        ; broad read allow
 *     (deny file-read* (subpath "<deny1>"))    ; one per denyReadSubpath
 *     (deny file-read* (subpath "<deny2>"))
 *     ...
 *
 * The kernel processes rules in order; deny-after-allow wins on
 * overlapping paths. This makes the SECURE boundary the deny list,
 * not a missing-allow list.
 *
 * `readonlyRoots` becomes load-bearing in the WRITE direction:
 *   - We emit `(deny file-write* (subpath "<readonlyRoot>"))` for each
 *     readonlyRoot, ensuring the command CANNOT write to a path it
 *     was only authorized to read. This is the load-bearing meaning
 *     of "readonly" in the capability.
 *   - The read allow on these paths is preserved by the broad
 *     `(allow file-read*)` above.
 *
 * This is the documented "broad deny regions plus narrower re-allows"
 * pattern (per Anthropic's macos-sandbox-utils). The capability
 * contract is now truthful:
 *   - readonlyRoots = paths the command may READ but NOT WRITE
 *   - writableRoots = paths the command may READ AND WRITE
 *   - denyReadSubpaths = paths the command may NOT READ (and may NOT WRITE)
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
 * Build the write-deny rules for readonlyRoots.
 *
 * Each readonlyRoot is a path the command is permitted to read but
 * MUST NOT write to. We emit an explicit `(deny file-write* (subpath
 * "<X>"))` per readonlyRoot, AFTER the write allow rule, so that
 * Seatbelt's "last match wins" semantics guarantee the deny wins even
 * if a writableRoots subpath happens to be a descendant of a
 * readonlyRoot (the planner is responsible for keeping these disjoint,
 * but the deny-after-allow makes the contract robust).
 *
 * NOTE: deny-write is emitted in buildWriteRule (next to the write
 * allow) so the Seatbelt rule ordering places deny AFTER allow.
 */
function buildWriteDenyRule(readonlyRoots: readonly string[]): string {
	if (readonlyRoots.length === 0) return "";
	return readonlyRoots
		.map((p) => `(deny file-write* (subpath "${escapeSbplString(p)}"))`)
		.join("\n");
}

/**
 * Build the write-permission rule.
 *
 * Emits `(allow file-write* ...)` with explicit subpaths and literals
 * (the capability's `writableRoots`, the capability's `tempRoot`, and
 * the always-writable set), followed by `(deny file-write* (subpath
 * "<readonlyRoot>"))` for each readonlyRoot. The deny-after-allow
 * ordering makes the readonlyRoots contract load-bearing: even if a
 * readonlyRoot is a descendant of a writableRoot, the deny wins.
 */
function buildWriteRule(
	writableRoots: readonly string[],
	tempRoot: string | undefined,
	readonlyRoots: readonly string[],
	createOnlyRoots: readonly string[] | undefined,
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
		subpaths.push(`(subpath "${escapeSbplString(p)}")`);
	}
	// ACT-CLINEMM-SEATBELT-TEMP-WRITE-AUTHORITY01:
	// Explicit /tmp compatibility grant. Emits `(subpath "<canonical /tmp>")`
	// (which on darwin resolves to /private/tmp via realpath). The
	// capability-private `tempRoot` (synthesized under `os.tmpdir()`)
	// is already in `subpaths` above; this loop only ADDS the canonical
	// `/tmp` root. Per-user `os.tmpdir()` is deliberately NOT in this
	// list — that authority is bounded to the capability's `tempRoot`
	// (one subtree per invocation, steered via TMPDIR/TMP/TEMP env
	// materialization in `materializeEnvironment`).
	//
	// If the capability's `tempRoot` happens to equal the canonical
	// /tmp root (extremely unusual), the Seatbelt `(subpath ...)` duplicate
	// is harmless — the kernel collapses overlapping subpath allows.
	//
	// Each entry is canonical (realpath-resolved) by construction;
	// see ALWAYS_WRITABLE_TEMP_SUBPATHS docstring. Untrusted callers
	// cannot inject non-canonical paths here because the constant
	// is computed once at module load from the host filesystem.
	for (const p of ALWAYS_WRITABLE_TEMP_SUBPATHS) {
		subpaths.push(`(subpath "${escapeSbplString(p)}")`);
	}
	const allowPart = `(allow file-write*\n  ${subpaths.join("\n  ")})`;
	const denyPart = buildWriteDenyRule(readonlyRoots);
	const writeRule = denyPart.length > 0 ? `${allowPart}\n${denyPart}` : allowPart;

	// ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2:
	// emit the narrower `file-write-create` allow. The kernel op
	// `file-write-create` covers mkstemp / mkdir / creat / atomic
	// rename-into-place but does NOT cover file-write-data against
	// existing files. This is the proven primitive from the C1
	// kernel matrix (c1 seatbelt-operation-matrix.tsv). Adding the
	// narrower allow AFTER the broad allow is strictly permissive
	// (additive, not widening): it grants ONE MORE operation
	// (file-write-create) but does not affect existing-file
	// mutations because the broad `file-write*` allow never granted
	// `file-write-data` on the `createOnlyRoots` (`writableRoots`
	// is disjoint from `createOnlyRoots` by construction; see
	// CommandJobManager.start).
	const createOnlyAllow = buildCreateOnlyAllowRule(createOnlyRoots);

	return createOnlyAllow.length > 0
		? `${writeRule}\n${createOnlyAllow}`
		: writeRule;
}

/**
 * Build the narrower `file-write-create` allow rule for `createOnlyRoots`.
 *
 * Returns empty string when there are no roots to allow.
 *
 * The kernel op `file-write-create` covers CREATE of new filesystem
 * objects (open(O_CREAT) / mkstemp / creat / mkdir / symlink /
 * hard link) and atomic rename-into-place when the destination is a
 * NEW object. It does NOT cover write-data / truncate / chmod /
 * unlink / rename-from-existing. This is the load-bearing
 * distinction proven in the C1 matrix:
 *
 *   (allow file-write-create (subpath "<canonical-DARWIN_ROOT>"))
 *
 * lets Apple mktemp(1) succeed (mkstemp + chmod) while denying
 * overwrite / unlink / rename-from-existing of an existing sentinel.
 */
function buildCreateOnlyAllowRule(createOnlyRoots: readonly string[] | undefined): string {
	if (!createOnlyRoots || createOnlyRoots.length === 0) {
		return "";
	}
	const subpaths = createOnlyRoots.map((p) => `(subpath "${escapeSbplString(p)}")`);
	return `(allow file-write-create\n  ${subpaths.join("\n  ")})`;
}

/**
 * CORRECTION01 (P1): Build the network rule explicitly.
 *
 * `"deny"` → `(deny network*)`. `"allow"` → `(allow network*)`.
 *
 * Prior implementation emitted NOTHING for `"allow"` and relied on
 * kernel default behavior; this was untestable as a positive property.
 * The fix makes the allow explicit so a causal test pair
 * (allow → connection succeeds, deny → connection fails) can prove
 * the property.
 */
function buildNetworkRule(network: CommandCapability["network"]): string {
	if (network === "deny") {
		return "(deny network*)";
	}
	return "(allow network*)";
}

/**
 * ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01:
 * Build the ssh-agent AF_UNIX socket rules.
 *
 * Returns empty string when `canonicalSocketPath` is omitted (the
 * common case: `mode: "deny"` or capability.authority omitted). The
 * caller is the Seatbelt backend, which is the only place that knows
 * the canonicalized socket path.
 *
 * The emitted rules are EXACT:
 *
 *   (allow system-socket
 *     (socket-domain AF_UNIX))
 *
 *   (allow network-outbound
 *     (remote unix-socket
 *       (path-literal "<CANONICAL>")))   ;; NOT (subpath ...)
 *
 * `path-literal` is the correct AF_UNIX remote-endpoint filter per
 * Apple Sandbox Guide v1.0; it is distinct from the filesystem
 * `literal` primitive and from `subpath`. Using `subpath` here would
 * widen authority to the entire parent directory tree (regression).
 *
 * The path is escaped via {@link escapeSbplString} — control
 * characters throw (CORRECTION01 P0-3 invariant preserved).
 */
function buildSshAgentSocketRules(canonicalSocketPath: string | undefined): string {
	if (typeof canonicalSocketPath !== "string" || canonicalSocketPath.length === 0) {
		return "";
	}
	const escaped = escapeSbplString(canonicalSocketPath);
	return [
		"(allow system-socket",
		"  (socket-domain AF_UNIX))",
		"(allow network-outbound",
		`  (remote unix-socket (path-literal "${escaped}")))`,
	].join("\n");
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
 * @param options.sshAgentCanonicalSocketPath  ACT-IMPL01: When the
 *                       capability opts into `mode: "agent"`, the
 *                       backend passes the canonicalized
 *                       `SSH_AUTH_SOCK` here. The generator emits
 *                       the AF_UNIX socket rule pair scoped to that
 *                       exact endpoint (`path-literal`). When
 *                       omitted (the deny case) the generator emits
 *                       no ssh-agent rules.
 */
export function generateSeatbeltProfile(
	capability: CommandCapability,
	options: {
		readonly denyReadSubpaths?: readonly string[];
		readonly sshAgentCanonicalSocketPath?: string;
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
		// CORRECTION01 (P0-1): Read permission — broad allow with
		// deny-subpaths carve-outs. The deny list IS the secure
		// boundary; see buildReadRule doc.
		buildReadRule(denyRead),
		// Write permission — explicit allowlist plus deny-rules for
		// readonlyRoots (load-bearing meaning of "readonly").
		buildWriteRule(
			capability.writableRoots,
			capability.tempRoot,
			capability.readonlyRoots,
			capability.createOnlyRoots,
		),
		// File metadata read for path resolution (stat, lstat).
		"(allow file-read-metadata (subpath \"/\"))",
	];
	const networkRule = buildNetworkRule(capability.network);
	if (networkRule) {
		lines.push(networkRule);
	}
	const sshAgentRules = buildSshAgentSocketRules(
		options.sshAgentCanonicalSocketPath,
	);
	if (sshAgentRules) {
		lines.push(sshAgentRules);
	}
	return lines.join("\n") + "\n";
}


