/**
 * Parser Helper Protocol — V2 internal wire format
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-SHIPPING01
 *
 * The V2 structured-classifier consumes a `ParsedShell` from a
 * trusted parser helper. The helper is a small Go binary that wraps
 * `mvdan.cc/sh/v3` (pinned to v3.13.1) and emits the DELIBERATELY
 * NARROW projection documented here.
 *
 * DO NOT widen this protocol without an explicit ACT. The narrow
 * projection is the security boundary: the helper never sees shell
 * evaluation, never executes commands, and never returns the full
 * upstream AST.
 *
 * ## Wire format
 *
 * Helper invocation (host → helper):
 *
 *   argv[0]: helper binary path (no shell)
 *   stdin:   JSON request = { dialect, source }
 *   stdout:  JSON response (see ParsedShellJSON below)
 *   stderr:  diagnostic messages only
 *
 * ## Security contract
 *
 * 1. NO SHELL INVOCATION. The helper is executed directly via
 *    `child_process.spawn(helperPath, [], { stdio: ... })`, NEVER via
 *    `sh -c <helper>`.
 * 2. STDIN is the source bytes only. No env-driven config. No
 *    remote fetches. No network requirement.
 * 3. STDOUT is bounded (see BoundedStdout below). Timeout enforced
 *    (see BoundedTimeoutMs below).
 * 4. PROTOCOL is JSON only. Any other output (e.g. helpful panic
 *    message from Go runtime) is treated as malformed and V1-only
 *    behavior is preserved.
 *
 * ## Versioning
 *
 * PROTOCOL_VERSION = 2 (matches STRUCTURED_PROTO_VERSION).
 * Bumping requires updating STRUCTURED_PROTO_VERSION and the V2
 * classifier's protocolVersion check.
 */

/** Protocol version. MUST match STRUCTURED_PROTO_VERSION. */
export const PARSER_HELPER_PROTOCOL_VERSION = 2 as const;

/** Dialects accepted by the helper. Matches `ShellDialect`. */
export type ParserHelperDialect = "bash" | "posix" | "mksh" | "zsh" | "unknown";

/** Helper stdin request shape. */
export interface ParserHelperRequest {
	/** Target dialect. Defaults to "bash" if omitted. */
	dialect?: ParserHelperDialect;
	/** Source bytes to parse. The host has already joined multi-command input. */
	source: string;
}

/** Helper stdout response shape (mirrors ParsedShell but uses JSON-compatible types). */
export interface ParsedShellJSON {
	readonly protocolVersion: typeof PARSER_HELPER_PROTOCOL_VERSION;
	readonly dialect: ParserHelperDialect;
	readonly sourceSha256: string;
	readonly parseStatus: "complete" | "failed";
	readonly hasCommandSubstitution: boolean;
	readonly program: StructuredProgramJSON | null;
	readonly errors: ReadonlyArray<string>;
}

export interface StructuredProgramJSON {
	readonly stmts: ReadonlyArray<StructuredStmtJSON>;
}

export type StructuredStmtJSON =
	| { readonly kind: "cmd"; readonly cmd: StructuredCmdJSON }
	| {
			readonly kind: "and";
			readonly left: StructuredStmtJSON;
			readonly rhs: StructuredStmtJSON;
	  }
	| {
			readonly kind: "or";
			readonly left: StructuredStmtJSON;
			readonly rhs: StructuredStmtJSON;
	  }
	| {
			readonly kind: "pipe";
			readonly left: StructuredStmtJSON;
			readonly rhs: StructuredStmtJSON;
	  }
	| { readonly kind: "subshell"; readonly inner: StructuredStmtJSON }
	| { readonly kind: "opaque" };

export interface StructuredCmdJSON {
	readonly name: string;
	readonly args: ReadonlyArray<string>;
	readonly assigns: ReadonlyArray<{
		readonly name: string;
		readonly value: string;
	}>;
	readonly redirects: ReadonlyArray<{
		readonly op: string;
		readonly path: string;
	}>;
	readonly isWrapper: boolean;
	readonly wrapperOf: ParserHelperDialect | "";
	readonly inner: string;
}

/** Helper stderr non-fatal diagnostic. */
export interface ParserHelperDiagnostic {
	readonly message: string;
}

/** Spawn bound — maximum source length accepted by the helper. */
export const BoundedSourceChars = 32 * 1024;

/** Spawn bound — maximum stdout size accepted by the helper. */
export const BoundedStdoutChars = 4 * 1024 * 1024;

/** Spawn timeout — maximum wall-clock time for one helper invocation. */
export const BoundedTimeoutMs = 500;
