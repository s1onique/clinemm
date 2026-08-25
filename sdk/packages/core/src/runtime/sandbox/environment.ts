/**
 * Environment-variable materialization for sandboxed commands.
 *
 * Disabled mode (`mode: "inherit"`):
 *   - Pass through the parent environment unchanged.
 *   - The executor adds the parent env via `{ ...process.env, ...env }`,
 *     so an "inherit" capability returns an empty overrides object.
 *
 * Sandboxed mode (`mode: "sanitized"`):
 *   - Pass ONLY the explicit allowlist, plus a small safe baseline.
 *   - Secret-shaped variables (SSH_AUTH_SOCK, AWS_*, AZURE_*, GITHUB_TOKEN,
 *     NPM_TOKEN, OPENAI_API_KEY, ANTHROPIC_API_KEY, *_SECRET*, *_TOKEN,
 *     DOCKER_HOST, KUBECONFIG, NIX_SSL_CERT_FILE, ...) are NEVER inherited
 *     automatically.
 *   - HOME and TMPDIR are derived from the capability when provided
 *     (synthetic HOME / synthetic TMPDIR). When the capability does not
 *     provide a `tempRoot`, the caller is responsible for allocating one
 *     before invoking `materializeEnvironment`.
 *
 * This module is intentionally a pure function with no I/O. Side effects
 * (allocating a private temp root) belong to the Seatbelt backend.
 */

import type { EnvironmentCapability, EnvironmentSemantics } from "./types";

/**
 * Compute the {@link EnvironmentSemantics} a prepared invocation MUST
 * carry given a capability.
 *
 *   - `mode: "inherit"` → `"overlay"` (the executor spreads process.env
 *     underneath the prepared env).
 *   - `mode: "sanitized"` → `"complete"` (the prepared env IS the
 *     entire child env; the executor MUST NOT spread process.env).
 *
 * This is the type-safe replacement for the magic
 * `completeness: "complete"` env key that CORRECTION01 used. The
 * capability's intent (inherit vs sanitized) is now expressed as a
 * typed metadata field on the invocation itself.
 */
export function getEnvironmentSemantics(
	capability: EnvironmentCapability,
): EnvironmentSemantics {
	return capability.mode === "sanitized" ? "complete" : "overlay";
}

/**
 * The default safe baseline for sandboxed environment.
 *
 * These variables are commonly needed by basic tools (PATH, LANG,
 * TERM, ...) and contain no credential material. They are emitted in
 * every sandboxed invocation regardless of the caller's `allow` list.
 *
 * Order matters for determinism in profile-hash tests; keep alphabetical.
 */
export const SAFE_ENVIRONMENT_BASELINE: Readonly<Record<string, string>> =
	Object.freeze({
		CLICOLOR: "1",
		FORCE_COLOR: "1",
		// Git's interactive progress bar would otherwise leak into
		// non-tty sandbox output and confuse the model.
		GIT_PAGER: "cat",
		GIT_TERMINAL_PROGRESS: "0",
		LANG: "en_US.UTF-8",
		LANGUAGE: "en_US.UTF-8",
		LC_ALL: "en_US.UTF-8",
		LSCOLORS: "Gxfxcxdxbxegedabagacad",
		NO_COLOR: "0",
		// `cat` is intentional: less, more, and most pagers try to be
		// interactive even when stdout is not a tty.
		PAGER: "cat",
		PATH:
			process.env.PATH ??
			"/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
		// TERM is required by many CLIs; "dumb" is the safest portable
		// value when stdout is not a tty.
		TERM: process.env.TERM ?? "dumb",
	});

/**
 * Variables whose presence in a sandboxed child environment would
 * grant the child access to a credential, agent, or system service
 * without any policy decision.
 *
 * These are NEVER inherited automatically. The only way they appear
 * in a sandboxed environment is if the caller explicitly puts them in
 * the `allow` list — at which point the caller's policy has explicitly
 * granted that capability.
 */
export const SECRET_BLOCKLIST: readonly string[] = Object.freeze([
	"ANTHROPIC_API_KEY",
	"AWS_ACCESS_KEY_ID",
	"AWS_PROFILE",
	"AWS_REGION",
	"AWS_SECRET_ACCESS_KEY",
	"AWS_SESSION_TOKEN",
	"AZURE_CLIENT_SECRET",
	"CLINE_API_KEY",
	"DOCKER_HOST",
	"GITHUB_TOKEN",
	"KUBECONFIG",
	"NIX_SSL_CERT_FILE",
	"NPM_TOKEN",
	"OPENAI_API_KEY",
	"SSH_AGENT_PID",
	"SSH_AUTH_SOCK",
]);

/**
 * Wildcard patterns that block any environment variable matching them.
 *
 * Used for family-shaped credentials the user might not have thought
 * of. We accept the risk of false positives over accidentally inheriting
 * e.g. `AWS_SECRET_FOO`.
 */
const SECRET_WILDCARD_PATTERNS: RegExp[] = [
	/^.*_SECRET.*$/,
	/^.*_TOKEN.*$/,
];

/**
 * Decide whether a variable name is "secret-shaped" and therefore must
 * not be inherited automatically. Public for testing.
 */
export function isSecretShapedEnvName(name: string): boolean {
	if (SECRET_BLOCKLIST.includes(name)) {
		return true;
	}
	for (const re of SECRET_WILDCARD_PATTERNS) {
		if (re.test(name)) return true;
	}
	return false;
}

/**
 * Materialize an environment record from a capability.
 *
 * Returns a plain `Record<string, string>` suitable for `spawn`.
 * For `"inherit"` mode the returned object is EMPTY (the executor adds
 * `process.env` itself via `{ ...process.env, ...env }`); for
 * `"sanitized"` mode the returned object is the only environment the
 * child sees.
 *
 * @param capability    The capability to materialize from.
 * @param options.parentEnv The parent's `process.env` (only consulted
 *                          when looking up baseline values that the
 *                          parent already has set, like PATH and TERM).
 * @param options.syntheticHome Optional synthetic HOME for sandbox mode
 *                              (caller-provided). Ignored in "inherit".
 * @param options.syntheticTempDir Optional synthetic TMPDIR for sandbox
 *                              mode (caller-provided). Ignored in "inherit".
 */
export function materializeEnvironment(
	capability: EnvironmentCapability,
	options: {
		readonly parentEnv?: NodeJS.ProcessEnv;
		readonly syntheticHome?: string;
		readonly syntheticTempDir?: string;
	},
): Record<string, string> {
	if (capability.mode === "inherit") {
		// Disabled mode: pass nothing; the executor adds process.env.
		// Returning `{}` is the "no overrides" signal.
		return {};
	}

	// CORRECTION01 (P0-2): Sanitized mode produces a COMPLETE
	// environment. The executor MUST NOT spread `process.env` underneath
	// it; the contract is enforced by `envSemantics: "complete"` on
	// the prepared invocation (NOT a magic key inside `env`, which
	// would pollute the child's environment — see types.ts
	// EnvironmentSemantics).
	//
	// Prior implementation relied on the executor's spread-merge
	// behavior to filter secrets by emitting only an "override" record
	// containing empty strings for known secret-shaped names. This is a
	// DENYLIST and is fundamentally leaky: any parent var NOT matching
	// the blocklist (e.g. `CLINEMM_UNKNOWN_CREDENTIAL`) leaks through the
	// spread.
	//
	// The new contract: sanitized mode returns ONLY the keys we
	// intentionally placed. Unknown parent keys do not appear at all.
	// The known secret-shaped keys (SSH_AUTH_SOCK, AWS_*, ...) are
	// still emitted as empty strings so that a buggy executor that
	// ignores envSemantics and does legacy spread-merge at least
	// neutralizes them.
	const out: Record<string, string> = {};

	// 1) Safe baseline. We pull from `parentEnv` for variables whose
	// values come from the host (PATH, TERM); others get the constant
	// safe defaults.
	const parentEnv = options.parentEnv ?? {};
	for (const [key, fallback] of Object.entries(SAFE_ENVIRONMENT_BASELINE)) {
		const fromParent = parentEnv[key];
		out[key] =
			typeof fromParent === "string" && fromParent.length > 0
				? fromParent
				: fallback;
	}

	// 2) Synthetic HOME / TMPDIR override the baseline when the
	// caller has computed them.
	if (options.syntheticHome) {
		out.HOME = options.syntheticHome;
	}
	if (options.syntheticTempDir) {
		out.TMPDIR = options.syntheticTempDir;
	}

	// 3) Caller-provided allow list. The allow list is a positive
	// grant: only variables explicitly named here that are also
	// present in `parentEnv` are inherited. We DO NOT enumerate a
	// secret blocklist; unknown parent vars are simply not carried
	// over.
	for (const key of capability.allow) {
		if (typeof key !== "string" || key.length === 0) {
			continue;
		}
		const fromParent = parentEnv[key];
		if (typeof fromParent === "string" && fromParent.length > 0) {
			out[key] = fromParent;
		}
	}

	// 4) Defensive: emit empty strings for any name in the blocklist
	// OR matching a secret-shaped wildcard that is also present in
	// parentEnv. This protects against a buggy executor that ignores
	// the completeness marker and does legacy spread-merge. A correct
	// executor using `out` as the whole environment already gets the
	// right answer; this step is purely defensive.
	for (const key of SECRET_BLOCKLIST) {
		if (
			typeof parentEnv[key] === "string" &&
			parentEnv[key].length > 0 &&
			out[key] === undefined
		) {
			out[key] = "";
		}
	}
	for (const re of SECRET_WILDCARD_PATTERNS) {
		for (const key of Object.keys(parentEnv)) {
			if (
				re.test(key) &&
				typeof parentEnv[key] === "string" &&
				parentEnv[key].length > 0 &&
				out[key] === undefined
			) {
				out[key] = "";
			}
		}
	}

	return out;
}

/**
 * Default allowlist for sandboxed read-only commands.
 *
 * Conservative: only the variables a typical dev tool genuinely needs.
 * The caller can extend this list.
 */
export const DEFAULT_READONLY_ALLOW: readonly string[] = Object.freeze([
	// Node / JS tooling
	"NODE_ENV",
	"NODE_PATH",
	// Git identity (read-only) — many tools look at these for author info.
	"GIT_AUTHOR_EMAIL",
	"GIT_AUTHOR_NAME",
	"GIT_COMMITTER_EMAIL",
	"GIT_COMMITTER_NAME",
	// Editor / IDE — many CLIs shell out to `$EDITOR` for prompts.
	"EDITOR",
	"VISUAL",
	// Common XDG locations — usually safe and many tools expect them.
	"XDG_CONFIG_HOME",
	"XDG_CACHE_HOME",
	"XDG_DATA_HOME",
	"XDG_RUNTIME_DIR",
	// User identification.
	"USER",
	"LOGNAME",
]);

