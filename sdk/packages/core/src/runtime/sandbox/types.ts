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
 *
 * - `createOnlyRoots`: canonical filesystem roots under which the
 *   command is permitted to CREATE new filesystem objects (files,
 *   directories, hardlinks, symlinks) but is NOT permitted to mutate
 *   or unlink existing ones. When provided, the Seatbelt backend
 *   emits:
 *
 *     (allow file-write-create (subpath "<root>"))
 *
 *   per root, plus a deny-after-allow for the existing-file
 *   mutation operations (the kernel conservatively denies
 *   file-write-data and file-write-set-attributes against existing
 *   objects under the same subpath). The narrower `file-write-create`
 *   Seatbelt operation is the load-bearing primitive; this is the
 *   exact primitive proven sufficient in the C1 kernel matrix
 *   (spec ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01).
 *
 *   Distinct from `writableRoots`: that grants full read+write
 *   (existing AND new objects), this grants create-only. Use
 *   `createOnlyRoots` for "may create a new temp file here" (mktemp),
 *   `writableRoots` for "may freely edit files here" (workspace).
 *
 *   Each entry MUST be canonical (realpath-resolved) by the caller.
 *   The backend canonicalizes again as a fail-closed gate.
 */
/**
 * ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01:
 * Optional ssh-agent authority surface on {@link CommandCapability}.
 *
 * Frozen contract (per ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-RECON01
 * §15, FROZEN at c700b0d92):
 *
 *   - `mode: "deny"` (default when omitted): no ssh-agent authority.
 *     The backend MUST NOT emit any ssh-agent-specific SBPL rule
 *     and MUST NOT reintroduce `SSH_AUTH_SOCK` into the child env.
 *
 *   - `mode: "agent"`: the backend MAY reintroduce `SSH_AUTH_SOCK`
 *     into the child env (from `process.env.SSH_AUTH_SOCK`, the
 *     OpenSSH-defined source of truth for the agent socket path,
 *     after canonicalization) and MUST emit SBPL rules granting
 *     AF_UNIX socket connect authority scoped to that exact
 *     canonical socket path. Raw private-key reads (e.g.
 *     `~/.ssh/id_rsa`) MUST remain denied; the parent socket
 *     directory MUST NOT gain filesystem write authority; sibling
 *     Unix sockets MUST remain inaccessible.
 *
 *   - The socket path is INTENTIONALLY NOT a field on this type.
 *     There is one source of truth: `process.env.SSH_AUTH_SOCK`
 *     (OpenSSH's contract). Callers may not inject a different
 *     socket path through the capability — that would create a
 *     divergence between the profile's path-literal authorization
 *     and the child env's SSH_AUTH_SOCK value, which would either
 *     leak or wedge depending on the divergence direction. The
 *     backend reads `process.env.SSH_AUTH_SOCK` once, canonicalizes
 *     it once, and uses that ONE value for both the SBPL rule and
 *     the materialized env. Derivation failure is fail-closed
 *     (`SandboxError`, reason `canonicalization-failed`).
 *
 * This field is capability-driven ONLY. There is no `executable
 * === "ssh"` branch, no `~/.ssh` grant, no `SECRET_BLOCKLIST`
 * weakening, no parent-tree widening.
 */
export type SshAuthenticationAuthority = {
	readonly mode: "deny" | "agent";
};

export interface CommandCapability {
	readonly readonlyRoots: readonly string[];
	readonly writableRoots: readonly string[];
	readonly denyReadSubpaths?: readonly string[];
	readonly network: SandboxNetwork;
	readonly environment: EnvironmentCapability;
	readonly cwd?: string;
	readonly tempRoot?: string;
	readonly createOnlyRoots?: readonly string[];
	/**
	 * ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01:
	 * ssh-agent authority surface. See {@link SshAuthenticationAuthority}.
	 * Default (omitted or `mode: "deny"`) = no agent authority.
	 */
	readonly sshAuthenticationAuthority?: SshAuthenticationAuthority;
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
 * How the executor MUST apply `env` to the child process.
 *
 * This is a metadata field on {@link SandboxPreparedInvocation}, NOT a
 * magic key inside `env` itself. The two values:
 *
 *   - `"overlay"`: legacy semantics. The executor spreads `process.env`
 *     UNDERNEATH `env`:
 *
 *         env_to_pass = { ...process.env, ...prepared.env }
 *
 *     This is the correct behavior for `inherit` mode (the capability
 *     explicitly asked for parent-environment inheritance) and for
 *     `NoSandboxBackend` (the executor is responsible for the merge).
 *
 *   - `"complete"`: the sandbox's `env` IS the entire environment the
 *     child process MUST see. The executor MUST NOT spread `process.env`
 *     underneath:
 *
 *         env_to_pass = prepared.env
 *
 *     This is the load-bearing property of CORRECTION01 (P0-2): under
 *     sanitized mode, the sandboxed env is COMPLETE — it does not
 *     overlay `process.env`. Encoding the distinction as a magic key
 *     inside `env` (the CORRECTION01 implementation) had two failure
 *     modes:
 *
 *       1. The key was visible to the child as `completeness=complete`,
 *          polluting the child's environment.
 *       2. The security property was hidden in an ordinary env var,
 *          making it easy for an executor to miss the contract.
 *
 *     A typed metadata field on the invocation makes the contract
 *     impossible to misunderstand: the executor MUST check
 *     `envSemantics` before applying `env` to the spawn options.
 */
export type EnvironmentSemantics = "overlay" | "complete";

/**
 * The result of a successful {@link SandboxBackend.prepare}.
 *
 * Structurally identical to {@link CommandInvocation} plus a typed
 * `envSemantics` metadata field. The executor passes this directly to
 * `spawnSupervisableShellCommand` (or to `node:child_process.spawn`).
 * No backend-specific concepts leak out.
 *
 * For Seatbelt, the `executable` becomes `/usr/bin/sandbox-exec` and
 * `args` is prefixed with `["-f", <profile-file>]` followed by the
 * original executable/args. For `NoSandboxBackend`, the prepared
 * invocation is byte-equivalent to the input invocation.
 *
 * The executor MUST apply `env` according to `envSemantics` (see
 * {@link EnvironmentSemantics}). The default behavior (when the
 * executor predates this field) is `"overlay"` for backwards
 * compatibility, but a CORRECTION01-aware executor honors `"complete"`
 * to enforce the sanitized-env security property.
 */
export interface SandboxPreparedInvocation {
	readonly executable: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly env: Record<string, string>;
	readonly input?: string;
	/**
	 * How the executor MUST apply `env` to the child process. See
	 * {@link EnvironmentSemantics}.
	 *
	 * Default for executors that do not read this field: assume
	 * `"overlay"`. Newer executors MUST read this field and apply the
	 * corresponding contract.
	 */
	readonly envSemantics: EnvironmentSemantics;
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
	override readonly cause?: unknown;

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

/**
 * ACT-CLINEMM-SEATBELT-NETWORK-LIVE-DOWNSTREAM-RECON01:
 * DEFAULT-OFF diagnostic observer for a sandbox backend's `prepare()`.
 *
 * The observer records at three seams in the REAL backend's causal
 * chain — see the seatbelt-backend.ts implementation for the exact
 * call order. The observer MUST NOT mutate, wrap, or substitute
 * the backend. When the observer is absent (the DEFAULT), the
 * backend's code path is byte-for-byte unchanged.
 *
 * Semantics contract:
 *   - All callbacks are OPTIONAL; the backend MAY call any
 *     subset depending on which seam was reached.
 *   - Backends MUST catch and best-effort-ignore observer
 *     exceptions. A diagnostic hook MUST NOT be a production
 *     availability hazard. The contract here is
 *     fail-open-for-diagnostics: command semantics MUST be
 *     preserved even if an observer throws.
 *   - The observer receives READ-ONLY references to the backend's
 *     internal state; mutating the passed object MUST NOT affect
 *     backend behavior (it is `readonly` per TypeScript, but the
 *     contract is a deep one — do not rely on TypeScript alone).
 *   - The observer is intended for forensic capture (e.g. to
 *     $CLINE_DIR/data/sandbox-diag/<RUN_ID>.jsonl) and is
 *     NEVER part of any public protocol.
 *
 * Correlation: the backend passes the prepared invocation
 * (which contains profilePath) to `onInvocationPrepared`. The
 * caller MAY correlate the three callbacks within a single
 * prepare() call by reference equality of the input objects
 * (the `capability` and `command` references are the SAME
 * across the three calls) or by using an existing stable
 * identifier. Backends MUST NOT introduce a public protocol
 * field for correlation.
 */
export interface SandboxBackendDiagnosticObserver {
	onPrepareInput?(input: {
		readonly capability: CommandCapability;
		readonly command: CommandInvocation;
	}): void;
	onProfileWritten?(info: {
		readonly profilePath: string;
		readonly sha256: string;
		readonly networkRule: string | undefined;
	}): void;
	onInvocationPrepared?(info: {
		readonly prepared: SandboxPreparedInvocation;
	}): void;
}

