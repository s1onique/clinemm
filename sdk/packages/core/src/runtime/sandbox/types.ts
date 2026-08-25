/**
 * SandboxBackend abstraction — types only.
 *
 * Wave-1 (this ACT): two values for {@link SandboxMode}: `"disabled"` and
 * `"seatbelt-experimental"`. The former is the default; the latter is an
 * experimental macOS-only Seatbelt (`/usr/bin/sandbox-exec`) backend.
 *
 * The types here describe the *capability contract* a sandbox backend
 * accepts and the *invocation contract* it must return. Upstream callers
 * (the executor seams — `createShellExecutor`, `spawnSupervisableShellCommand`,
 * `CommandJobManager.start`) never see SBPL, `sandbox-exec`, or any
 * backend-specific concepts; they only ever consume
 * {@link SandboxPreparedInvocation}, which is structurally identical to
 * the existing `SpawnConfig`.
 *
 * ACT: ACT-CLINEMM-COMMAND-SANDBOX-BACKEND-ABSTRACTION01
 */

/**
 * The command-execution sandbox mode selected by configuration.
 *
 * - `"disabled"`: no sandbox. The executor runs the command exactly as it
 *   does today, against the existing production seam. This is the
 *   DEFAULT and is the only value honored until the host explicitly opts
 *   into an experimental mode.
 *
 * - `"seatbelt-experimental"`: macOS Seatbelt (`/usr/bin/sandbox-exec`),
 *   applied on a per-command basis. EXPERIMENTAL_UNSUPPORTED_INTERFACE
 *   per Apple posture (see recon evidence). Default OFF in production;
 *   only available on darwin hosts where `/usr/bin/sandbox-exec` exists
 *   and passes the availability probe. Failure to prepare is fail-closed:
 *   the executor never silently falls back to unsandboxed execution.
 *
 * Future modes (e.g. `"app-sandbox-helper"`, `"vm"`) can be added without
 * changing this contract.
 */
export type SandboxMode = "disabled" | "seatbelt-experimental";

/**
 * The networking posture for a sandboxed command.
 *
 * Wave-1 only. Hostname allowlists and per-port rules are intentionally
 * not in this ACT's scope.
 */
export type SandboxNetwork = "deny" | "allow";

/**
 * Environment-variable materialization policy.
 *
 * Two modes are supported in Wave-1:
 *
 * - `"inherit"`: pass the parent process environment through unchanged.
 *   This is the only mode valid when the sandbox is disabled.
 *
 * - `"sanitized"`: pass ONLY the variables explicitly listed in `allow`,
 *   plus a small safe baseline (PATH, LANG, LC_*, TERM, SHELL, USER, PWD,
 *   LSCOLORS, CLICOLOR, FORCE_COLOR, NO_COLOR, GIT_TERMINAL_PROGRESS=0,
 *   GIT_PAGER=cat, PAGER=cat, and a synthetic HOME/TMPDIR derived from
 *   the capability when provided). Secret-shaped variables
 *   (SSH_AUTH_SOCK, AWS_*, AZURE_*, GITHUB_TOKEN, NPM_TOKEN,
 *   OPENAI_API_KEY, ANTHROPIC_API_KEY, *_SECRET*, *_TOKEN, DOCKER_HOST,
 *   KUBECONFIG, NIX_SSL_CERT_FILE, ...) are NOT inherited unless the
 *   caller explicitly adds them to `allow`. See {@link ./environment}.
 */
export type EnvironmentCapability =
	| {
			readonly mode: "inherit";
	  }
	| {
			readonly mode: "sanitized";
			readonly allow: readonly string[];
	  };

/**
 * The capability contract a sandbox backend accepts.
 *
 * Semantics:
 *
 * - `readonlyRoots`: filesystem roots that the command may READ (and
 *   stat for metadata). Writes inside these paths are denied.
 *
 * - `writableRoots`: filesystem roots that the command may READ and WRITE.
 *   Reads are allowed; writes are allowed; nothing outside these
 *   regions is writable.
 *
 * - `denyReadSubpaths`: filesystem subpaths that are explicitly denied
 *   for READS even though `(allow file-read*)` is broad. This is the
 *   "outside containment" hook — pass the canonical paths of any
 *   sibling directories the sandboxed process must not see.
 *
 *   For Seatbelt this generates `(deny file-read* (subpath X))` lines
 *   after the broad allow. The recon validated this pattern as the
 *   cleanest containment shape (see sandbox/types.ts notes; recon
 *   final-assessment.md gotcha #2).
 *
 * - `network`: outbound networking. `"deny"` blocks all socket creation
 *   subject to the backend's rules (Seatbelt: `(deny network*)`).
 *   `"allow"` does not impose a network rule on the profile — networking
 *   behaves as the kernel default.
 *
 * - `environment`: see {@link EnvironmentCapability}.
 *
 * - `cwd`: the working directory for the command. Always canonicalized
 *   by the backend before profile generation; the canonicalized value
 *   is what appears in the prepared invocation.
 *
 * - `tempRoot`: a canonical, capability-private temp directory the
 *   command may write to. When provided, the backend:
 *   - grants writes to this directory;
 *   - (for `environment.mode="sanitized"`) sets `TMPDIR` to it.
 *
 *   When `tempRoot` is omitted and `environment.mode="sanitized"`, the
 *   backend synthesizes one under the system temp root.
 */
export interface CommandCapability {
	readonly readonlyRoots: readonly string[];
	readonly writableRoots: readonly string[];
	readonly denyReadSubpaths?: readonly string[];
	readonly network: SandboxNetwork;
	readonly environment: EnvironmentCapability;
	readonly cwd?: string;
	readonly tempRoot?: string;
}

/**
 * A command invocation as the executor sees it.
 *
 * This is the same shape `spawnSupervisableShellCommand` consumes
 * internally; the sandbox backend produces a
 * {@link SandboxPreparedInvocation} with the same fields populated.
 */
export interface CommandInvocation {
	readonly executable: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly env: Record<string, string>;
	readonly input?: string;
}

/**
 * The result of a successful {@link SandboxBackend.prepare}.
 *
 * Structurally identical to {@link CommandInvocation}. The executor
 * passes this directly to `spawnSupervisableShellCommand` (or to
 * `node:child_process.spawn`). No backend-specific concepts leak out.
 *
 * For Seatbelt, the `executable` becomes `/usr/bin/sandbox-exec` and
 * `args` is prefixed with `["-f", <profile-file>]` followed by the
 * original executable/args. For `NoSandboxBackend`, the prepared
 * invocation is byte-equivalent to the input invocation.
 */
export interface SandboxPreparedInvocation {
	readonly executable: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly env: Record<string, string>;
	readonly input?: string;
	/**
	 * Optional cleanup hook called by the executor once the spawned
	 * process has been waited on (or terminated). For Seatbelt, this
	 * removes the profile temp file. For `NoSandboxBackend`, this is
	 * a no-op. Failures of `cleanup` MUST NOT alter the command's exit
	 * classification.
	 */
	readonly cleanup?: () => Promise<void>;
	/**
	 * Stable identifier of the backend that produced this prepared
	 * invocation. Useful for logs.
	 */
	readonly backendId: string;
}

/**
 * Errors raised by {@link SandboxBackend.prepare}.
 *
 * The executor treats these as fail-closed: the command is NOT executed
 * unsandboxed. The caller (upstream) decides whether to surface as
 * `ASK`, `ERROR`, or `SANDBOX_UNAVAILABLE` depending on its own semantics.
 *
 * `cause` carries the underlying Node error (canonicalize failure,
 * availability probe failure, profile write failure, etc.) for diagnostics.
 */
export class SandboxError extends Error {
	readonly backendId: string;
	readonly reason:
		| "backend-unavailable"
		| "canonicalization-failed"
		| "profile-generation-failed"
		| "profile-write-failed"
		| "launch-prepare-failed";
	readonly cause?: unknown;

	constructor(
		message: string,
		options: {
			readonly backendId: string;
			readonly reason: SandboxError["reason"];
			readonly cause?: unknown;
		},
	) {
		super(message);
		this.name = "SandboxError";
		this.backendId = options.backendId;
		this.reason = options.reason;
		this.cause = options.cause;
	}
}

/**
 * The sandbox backend contract.
 *
 * A backend answers:
 *
 * 1. `id`: stable identifier for diagnostics.
 * 2. `isAvailable()`: is the underlying substrate present and functional
 *    on this host right now? For Seatbelt: darwin + sandbox-exec present
 *    + a minimal probe (e.g. `sandbox-exec -p "(version 1)" true`)
 *    succeeds. For `NoSandboxBackend`: always `true`.
 * 3. `prepare(input)`: given a capability and a command invocation,
 *    return a {@link SandboxPreparedInvocation} the executor can launch.
 *    On failure (canonicalize error, profile error, substrate gone) throw
 *    a {@link SandboxError}. The executor MUST treat thrown errors as
 *    fail-closed.
 */
export interface SandboxBackend {
	readonly id: string;

	isAvailable(): Promise<boolean>;

	prepare(input: {
		readonly capability: CommandCapability;
		readonly command: CommandInvocation;
	}): Promise<SandboxPreparedInvocation>;
}

