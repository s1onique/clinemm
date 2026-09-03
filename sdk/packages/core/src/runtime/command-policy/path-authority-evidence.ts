/**
 * ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION01
 * REALPATH_WORKSPACE_CONFINEMENT
 *
 * This module defines the HOST-PRODUCED evidence shape consumed by the
 * canonical command policy's workspace path authority gate.
 *
 * ARCHITECTURE INVARIANT:
 *   policy = pure (no filesystem I/O)
 *   filesystem = host authority
 *
 * The host (CLI or VS Code) is the ONLY component allowed to call
 * `fs.realpathSync` / `fs.realpath`. The policy layer receives a
 * pre-built `WorkspacePathAuthorityEvidence` object whose `roots` and
 * `operands[i].resolvedRealPath` fields have ALREADY been canonicalized
 * against the filesystem. Containment is then tested purely against
 * strings, with no further I/O.
 *
 * FAIL-CLOSED CONTRACT:
 *   - `resolvedRealPath: null`            ⇒ ASK (resolution failed;
 *                                             do not guess)
 *   - `resolvedRealPath: string` but
 *     `contained: false`                  ⇒ ASK (escaped the root)
 *   - missing evidence for an operand     ⇒ ASK (host did not
 *                                             resolve it)
 *   - realpath ENOENT / EACCES / ELOOP    ⇒ ASK (resolution threw)
 *
 * `fs.realpathSync` is the standard Node API that resolves `.`, `..`,
 * and symbolic links into a canonical pathname; it throws on ENOENT
 * and surfaces other filesystem errors as exceptions. This module
 * documents what the host must do with those errors.
 */

/**
 * Per-operand path authority evidence, produced by the host.
 *
 * The host MUST resolve `operand` via the filesystem (typically via
 * `fs.realpathSync(operand)` after resolving it against the host cwd
 * for relative paths). The resulting `resolvedRealPath` is the
 * canonical pathname that the path authority tests for containment.
 *
 * If the host cannot resolve the operand (nonexistent path, permission
 * denied, broken symlink, etc.), the host sets
 * `resolvedRealPath: null`. The policy treats null as "ASK" — we
 * fail closed rather than guess.
 */
export interface WorkspacePathOperandEvidence {
	/**
	 * The raw operand text as it appears in the command's argv.
	 * Retained verbatim for diagnostics and the policy's
	 * downstream reasoning.
	 */
	operand: string;
	/**
	 * The canonical pathname `operand` resolves to, AFTER the host
	 * has followed symbolic links and collapsed `.` / `..`
	 * dot-segments via `fs.realpathSync` (or equivalent).
	 *
	 * `null` means the host could not resolve this operand (e.g.
	 * the path does not exist, permission was denied, the symlink
	 * chain was broken, etc.). The policy MUST treat `null` as
	 * ASK.
	 *
	 * For operands the host intentionally leaves unresolved (e.g.
	 * the path does not exist yet but the user has explicitly
	 * declared it as an expected target), the host sets
	 * `resolvedRealPath: null` and the policy will require user
	 * approval — which is the conservative default.
	 */
	resolvedRealPath: string | null;
	/**
	 * `true` iff `resolvedRealPath` sits inside one of the
	 * canonical workspace roots (also supplied by the host).
	 * Mirrors the lexical containment check the policy would have
	 * applied, but on REALPATH-resolved strings instead of
	 * `path.resolve`-only strings.
	 */
	contained: boolean;
	/**
	 * Reason the host produced this evidence entry. Useful for
	 * telemetry and for the policy's user-facing `reason` field.
	 */
	reason:
		| "resolved-and-contained"
		| "resolved-but-outside-roots"
		| "realpath-failed-enoent"
		| "realpath-failed-eacces"
		| "realpath-failed-eloop"
		| "realpath-failed-other"
		/**
		 * ACT-CLINEMM-COMMAND-RISK-V2-CD-CWD-PATH-AUTHORITY-COMPOSITION01:
		 * The operand resolved (realpath succeeded) but is NOT a
		 * directory. Used for `cd` workspace-transition operands
		 * whose resolved target is a regular file or other
		 * non-directory filesystem object.
		 */
		| "realpath-failed-not-a-directory";
}

/**
 * Complete workspace path authority evidence for a single command.
 * The host builds this for every R0 read-only command whose
 * matched-rule source is path-bearing (today `host_safe_ls` and
 * `host_safe_find`).
 *
 * The host is responsible for:
 *   1. Resolving every configured workspace root via
 *      `fs.realpathSync` BEFORE passing the array in. Roots MUST
 *      be canonical absolute paths; the policy never calls
 *      `fs.realpathSync` itself.
 *   2. For every path operand in the command, attempting
 *      `fs.realpathSync` (catching ENOENT, EACCES, ELOOP, and other
 *      exceptions explicitly) and populating
 *      `operands[i].resolvedRealPath` + `operands[i].contained`.
 *   3. Never passing partial evidence: if the host supplies
 *      `pathAuthorityEvidence`, it MUST include one
 *      `WorkspacePathOperandEvidence` per extracted path operand.
 *      A missing operand entry is treated by the policy as
 *      ASK (fail-closed).
 */
export interface WorkspacePathAuthorityEvidence {
	/**
	 * Canonical absolute paths of the workspace roots, after the
	 * host has followed all symbolic links via `fs.realpathSync`.
	 * Containment is tested against this list.
	 */
	roots: ReadonlyArray<string>;
	/**
	 * The host's current working directory, AFTER the host has
	 * resolved it via `fs.realpathSync`. Used as the base for
	 * relative-path operand resolution. May be `undefined` if the
	 * host does not declare a cwd.
	 */
	cwd: string | null;
	/**
	 * One entry per path operand in the command, in the same order
	 * the operands appear in the command's argv. The policy does
	 * NOT re-extract operands when consuming this evidence — the
	 * host is the source of truth for which operands were
	 * resolved.
	 */
	operands: ReadonlyArray<WorkspacePathOperandEvidence>;
	/**
	 * ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01:
	 *
	 * Already-filtered (now < expiresAt) AND already-canonicalized
	 * (`fs.realpathSync`) absolute paths from the persisted
	 * `clinemmTemporaryExternalPathAuthorities` Settings array.
	 *
	 * The host (VS Code / CLI) is responsible for:
	 *   1. Reading the persisted array from StateManager.
	 *   2. Filtering expired entries (now >= expiresAt → drop).
	 *   3. Canonicalizing each remaining path via `fs.realpathSync`.
	 *   4. Passing the surviving canonical paths in here.
	 *
	 * Containment is tested against the UNION of `roots` and
	 * `temporaryExternalCanonicalRoots`. The temporary roots do
	 * NOT relax containment — they only widen the accepted set.
	 * An operand outside BOTH sets still reports `contained: false`
	 * and the policy downgrades the R0 rule to ASK.
	 *
	 * Defaults to `[]` (the pre-ACT contract;
	 * MIGRATION_OR_DEFAULT_AUTHORITY_DELTA = 0 for the absent-key
	 * category).
	 */
	temporaryExternalCanonicalRoots?: ReadonlyArray<string>;
}

/**
 * ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01:
 *
 * Public type for a single user-enabled temporary external path
 * authority entry. The host validator rejects entries whose
 * `expiresAt` exceeds `now + 24h` at write time; the SDK
 * `filterActiveTemporaryExternalPathEntries` helper (in the
 * app-layer storage module) re-applies the same temporal +
 * ceiling invariant at consumption time as defense-in-depth.
 *
 * Re-exported from `@cline/core` for use by the host.
 */
export interface TemporaryExternalPathAuthority {
	/** Absolute path on disk. Canonicalized via `fs.realpathSync` at consumption. */
	path: string;
	/**
	 * ISO-8601 timestamp. The entry is INACTIVE iff `Date.parse(expiresAt) <= now`
	 * OR `Date.parse(expiresAt) > now + 24h`. The host validator rejects
	 * `expiresAt > now + 24h` at write time so this backstop is rarely
	 * hit in normal operation.
	 */
	expiresAt: string;
}
