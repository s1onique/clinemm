/**
 * Host-owned supervised command execution.
 *
 * This module is the single owner of command execution lifetime for the
 * VS Code extension's `run_commands` background path. It separates two
 * clocks that the upstream `createShellExecutor` couples:
 *
 *   - WAIT_BUDGET_MS: how long this tool invocation waits before
 *     returning control to the model. Expiry does NOT terminate the
 *     process — it returns a `RUNNING` snapshot with a stable jobId.
 *     The wait budget is clamped DOWN to the execution deadline; it can
 *     never extend the deadline.
 *
 *   - EXECUTION_DEADLINE_MS: maximum wall-clock lifetime the host
 *     permits the command. The deadline is host-authoritative: callers
 *     cannot raise it. Expiry terminates the owned process tree and
 *     records `DEADLINE_EXCEEDED`.
 *
 * Five invariants:
 *   1. RUNNING is not a failure.
 *   2. The host may stop waiting without stopping the command, but it
 *      must never stop owning it.
 *   3. Cancellation is idempotent — calling cancel on an already-terminal
 *      job is a no-op.
 *   4. The deadline is host-authoritative; wait budget never extends it.
 *   5. The terminal outcome reflects why the host initiated termination,
 *      not what the child happened to do — if the host sent SIGTERM on
 *      deadline, the outcome is `deadline_exceeded` even if the child
 *      voluntarily exited 0 milliseconds later.
 *
 * Cancellation is exposed via the separate `cancel_command` tool
 * (see command-status-tool.ts). Observation via `command_status` is
 * read-only and does not require host command policy.
 */
import {
	SandboxError,
	type StructuredCommandInput,
	type SupervisableShellProcess,
	spawnSupervisableShellCommand,
} from "@cline/core"
import { type AgentToolContext, getDefaultShell, getShellInvocation, type InternalExecutionCapability } from "@cline/shared"
import {
	buildExperimentalReconCapability,
	defaultSandboxBackendResolver,
	resolveExperimentalSandboxMode,
	resolveSafeYoloCapabilityFromState,
	type SafeYoloCapabilitySnapshot,
	type SandboxBackendResolver,
} from "./sandbox-policy"

export type CommandJobState = "running" | "exited" | "deadline_exceeded" | "cancelled" | "spawn_failed"

/**
 * Why the host initiated termination, if it did. Latched onto the job
 * so the terminal outcome reflects host authority rather than the
 * child's last will.
 */
export type TerminationReason = "natural" | "deadline" | "cancel"

/** A snapshot of a job's observable state. Safe to copy across boundaries. */
export interface CommandJobSnapshot {
	id: string
	state: CommandJobState

	startedAtMs: number
	deadlineAtMs: number
	nowMs: number

	exitCode?: number
	signal?: string

	stdout: string
	stderr: string
	outputTruncated: boolean

	/** Convenience fields for tool results. */
	elapsedMs: number
	deadlineRemainingMs: number

	// NOTE (CORRECTION03): real authority-bearing capabilities
	// (e.g. FilesystemCreateOnlyCapability with the canonical
	// Darwin user temp root) are NOT projected into this snapshot.
	// The snapshot is the public status projection observed by
	// tool consumers and telemetry; surfacing authority data
	// here would re-introduce the leak that an earlier ACT
	// (CORRECTION02 of C1) deliberately removed by deleting the
	// legacy `executionCapability` field. Tests that need to
	// observe per-job stamping wrap `manager.start` (or
	// `tool.execute`) and inspect the captured context — see
	// `darwin-seatbelt-darwin-mktemp-capability01.c2-mixed-isolation.test.ts`.
}

/** Caller-supplied input to {@link CommandJobManager.start}. */
export interface StartCommandJobOptions {
	command: string | StructuredCommandInput
	cwd: string
	shell?: string
	env?: Record<string, string>

	/** How long to wait before returning control. Expiry ≠ termination. Clamped DOWN to the effective deadline. */
	waitBudgetMs: number
	/**
	 * Requested execution deadline. The host clamps this DOWN to its
	 * authoritative ceiling (the manager's `maxExecutionDeadlineMs`);
	 * callers can never extend execution.
	 */
	executionDeadlineMs: number
	/** Cap on per-call response output (chars). */
	maxOutputChars?: number
	/** Cap on per-job retained output (chars). */
	maxRetainedOutputChars?: number
}

/**
 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03: terminal
 * transition metadata. `becameIdle` is true iff this terminal
 * completion was the >0->0 cardinality transition (this was the
 * last active job). Captured at the manager's `finalize()` mutation
 * seam — race-safe under concurrent terminal-completions because
 * the check + delete happen in a single synchronous burst.
 */
export interface TerminalTransition {
	becameIdle: boolean
}

export interface StartCommandJobResult {
	jobId: string
	state: CommandJobState
	elapsedMs: number
	deadlineRemainingMs: number
	stdout: string
	/** Stderr for terminal results — combined into stdout for the model-facing result text. */
	stderr: string
	outputTruncated: boolean
	process: SupervisableShellProcess
	exitCode?: number
	signal?: string
	/**
	 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01: terminal-state promise.
	 * Resolves when the job reaches a terminal state (any of
	 * exited/deadline_exceeded/cancelled/spawn_failed). The runner
	 * attaches a `.then()` listener to react to the async completion
	 * — in particular, to flip the host's `backgroundCommandRunning`
	 * projection back to false when the tool returns RUNNING but the
	 * process later completes asynchronously. The runner's in-tool
	 * callback chain closes the moment the tool returns, so without
	 * this promise the projection would stay true forever.
	 *
	 * Always resolves (never rejects) — the runner can attach a
	 * `.then()` callback without a `.catch()`.
	 *
	 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03: the
	 * resolved value carries `TerminalTransition` with `becameIdle`
	 * — true iff this terminal completion was the >0->0 cardinality
	 * transition. The runner uses this flag directly to decide
	 * whether to fire the (false, undefined) projection, instead
	 * of a post-hoc `getActiveJobIds()` count (which would be racy
	 * under concurrent starts).
	 */
	terminalPromise: Promise<TerminalTransition>
	/**
	 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03: was this
	 * start a 0->1 cardinality transition? The runner uses this flag
	 * directly to decide whether to fire the (true, jobId) projection,
	 * instead of a post-hoc `getActiveJobIds()` count (which would be
	 * racy under concurrent starts).
	 */
	becameActive: boolean
}

/** Caller-supplied input to {@link CommandJobManager.status}. */
export interface StatusCommandJobOptions {
	jobId: string
	/** How long to wait for state transition (clamped to MAX_STATUS_WAIT_MS). */
	waitMs: number
}

/** Caller-supplied input to {@link CommandJobManager.cancel}. */
export interface CancelCommandJobOptions {
	jobId: string
}

/** Constructor options for {@link CommandJobManager}. */
export interface CommandJobManagerOptions {
	/**
	 * Maximum number of terminal jobs retained in memory. Bounded FIFO
	 * eviction (not LRU — status access does not refresh recency). Older
	 * jobs are evicted past the cap. Injectable so tests can prove
	 * eviction deterministically.
	 */
	maxTerminalJobs?: number
	/**
	 * Host-authoritative ceiling on execution deadline. Caller-supplied
	 * deadlines are clamped DOWN to this value. Defaults to
	 * `DEFAULT_EXECUTION_DEADLINE_MS`.
	 */
	maxExecutionDeadlineMs?: number
	/**
	 * Maximum wait budget the caller may request. Defaults to
	 * `DEFAULT_WAIT_BUDGET_MS`. Also clamped DOWN to
	 * `effectiveExecutionDeadlineMs` for any given job.
	 */
	maxWaitBudgetMs?: number
	/**
	 * ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01:
	 * Optional sandbox backend resolver. When set, overrides the
	 * production default (`defaultSandboxBackendResolver`).
	 *
	 * The resolver is the SOLE dependency-injection seam for the
	 * experimental sandbox integration. Tests use it to:
	 *   - simulate substrate-unavailable (return `undefined`)
	 *   - inject a backend whose `prepare()` throws `SandboxError`
	 *   - assert what was passed to the supervisor
	 *
	 * Production code never sets this; it remains on the default. The
	 * constructor never touches the Seatbelt substrate or SBPL.
	 */
	sandboxBackendResolver?: SandboxBackendResolver
	/**
	 * ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01:
	 * Canonical absolute paths treated as WRITE-allowed regions in
	 * the Wave-1 capability. Each invocation under Seatbelt (the new
	 * ACT-CLINEMM-SEATBELT-DEFAULT-ON01 default) builds a capability
	 * with these as `writableRoots` (Seatbelt write-allow regions).
	 *
	 * Optional. When omitted, the Wave-1 capability has empty
	 * `writableRoots` (no workspace writes protected from the kernel
	 * side). Production host code is responsible for supplying the
	 * actual workspace roots.
	 */
	experimentalSandboxWorkspaceRoots?: readonly string[]
	/**
	 * ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01:
	 * Optional source for setting-driven capability overrides. When
	 * supplied, the production `buildExperimentalReconCapability`
	 * builder reads this snapshot at every command-start and applies
	 * it as the runtime source of truth; when omitted, the legacy
	 * env-only path runs (every existing test suite stays green).
	 *
	 * The SdkController supplies a closure that reads the persisted
	 * state keys `clinemmSafeYoloAllowNetwork` /
	 * `clinemmSafeYoloAllowSshAgent`. A user who has never opened
	 * the Settings UI reads `undefined` here and the builder falls
	 * through to the env-only path — exactly the pre-ACT runtime.
	 */
	safeYoloCapabilitySource?: () => {
		readonly network: boolean | undefined
		readonly sshAgent: boolean | undefined
	}
}

/**
 * Default wait budget for run_commands. The tool call returns control
 * to the model after this much wall-clock time when the child is
 * still alive — and the child keeps running under the job manager's
 * supervision.
 */
export const DEFAULT_WAIT_BUDGET_MS = 15_000

/**
 * Default execution deadline. The host terminates the owned process
 * tree after this much wall-clock time regardless of whether anyone is
 * observing it. Also the default host-authoritative ceiling for
 * caller-supplied deadlines.
 */
export const DEFAULT_EXECUTION_DEADLINE_MS = 600_000 // 10 min

/**
 * Maximum response output per tool call (UTF-16 code units, "chars").
 * The retained snapshot is bounded separately and may be larger;
 * every model-facing response is projected through this cap.
 *
 * Note: this is consistent with upstream `createShellExecutor`'s
 * `MAX_COMMAND_OUTPUT_CHARS` and the SDK's `truncateCommandOutput`.
 * True UTF-8 byte accounting is a separate concern; treat this as a
 * model-context budget.
 */
export const MAX_RESPONSE_OUTPUT_CHARS = 65_536

/**
 * Maximum retained output per job for follow-up status inspection
 * (UTF-16 code units). Applied per stream (stdout, stderr); total
 * retained output per job can be up to ~2× this value.
 */
export const MAX_RETAINED_JOB_OUTPUT_CHARS = 4 * 1024 * 1024

/** Hard cap on `command_status(jobId, waitMs)`. */
export const MAX_STATUS_WAIT_MS = 30_000

/** Bounded retention for terminal jobs (FIFO eviction; not LRU). */
export const MAX_TERMINAL_JOBS = 128

/** SIGTERM grace before SIGKILL. Matches the bash executor's `5_000` watchdog. */
export const TERM_GRACE_MS = 5_000

/** Stable, opaque job id. Format: `cmd_<base36>`. */
function generateJobId(): string {
	return `cmd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/** Snap a job to an immutable snapshot the caller can store/return. */
function snapshot(job: CommandJob): CommandJobSnapshot {
	const nowMs = Date.now()
	const stdoutSnap = job.process.stdoutSnapshot()
	const stderrSnap = job.process.stderrSnapshot()
	return {
		id: job.id,
		state: job.state,
		startedAtMs: job.startedAtMs,
		deadlineAtMs: job.deadlineAtMs,
		nowMs,
		exitCode: job.exitCode,
		signal: job.signal,
		stdout: stdoutSnap.text,
		stderr: stderrSnap.text,
		outputTruncated: stdoutSnap.dropped || stderrSnap.dropped,
		elapsedMs: nowMs - job.startedAtMs,
		deadlineRemainingMs: Math.max(0, job.deadlineAtMs - nowMs),
		// CORRECTION03: do NOT project job.executionCapability
		// (which may carry real FilesystemCreateOnlyCapability
		// roots) into the snapshot. The merged capability lives
		// on the internal job record for the Seatbelt backend's
		// consumption; the public snapshot is the status-only
		// projection observed by tool consumers / telemetry.
	}
}

/**
 * Project an internal snapshot to a model-facing snapshot with the
 * response cap applied. Distinct from `snapshot()` so the retained
 * spool can be larger than any individual response.
 *
 * The cap is a TOTAL model-context budget — not a per-stream budget.
 * The invariant is:
 *
 *   length(stdout) + length(separator) + length(stderr) <= totalCap
 *
 * where separator is the literal `\n[stderr]\n` (10 chars) used when
 * the run_commands tool concatenates the two streams, and `length`
 * either is just the stream itself when stderr is empty. This is the
 * SUBJECT promise to the model: every response costs at most
 * `MAX_RESPONSE_OUTPUT_CHARS` of context, period.
 *
 * ACT-CLINEMM-TRUSTED-BOUNDED-COMMAND-EXECUTION01-CORRECTION02:
 * The previous per-stream cap allowed `2 × MAX_RESPONSE_OUTPUT_CHARS`
 * to leak into the model context. The function now allocates a single
 * total budget across both streams, with a deterministic priority:
 *
 *   - stderr is preserved first (it is the diagnostic signal; loss
 *     of stderr obscures failure modes),
 *   - stdout gets the remainder of the stream budget,
 *   - whatever overflows is dropped, with `outputTruncated=true`.
 *
 * ACT-CLINEMM-TRUSTED-BOUNDED-COMMAND-EXECUTION01-CORRECTION03
 * (cleanup): the docblock no longer contradicts itself. The actual
 * priority is stderr > stdout, which is what the allocation code
 * implements.
 */
function projectResponseSnapshot(snap: CommandJobSnapshot, maxResponseOutputChars: number): CommandJobSnapshot {
	const stdoutRaw = snap.stdout
	const stderrRaw = snap.stderr
	// Combined-text separator is 10 chars (`\n[stderr]\n`) when stderr
	// is non-empty; zero when stderr is empty.
	const separatorLength = stderrRaw.length > 0 ? 10 : 0
	// Reserve budget for the separator; the rest is split between
	// stdout and stderr.
	const streamTotal = Math.max(0, maxResponseOutputChars - separatorLength)
	// Allocate stderr first (diagnostic priority). Then stdout gets
	// whatever remains. This means a large stderr can shrink stdout
	// to zero — the diagnostic signal is preserved at the cost of
	// some stdout content. Documented contract.
	const stderrCap = stderrRaw.length > 0 ? Math.min(stderrRaw.length, streamTotal) : 0
	const stdoutCap = Math.max(0, streamTotal - stderrCap)

	const truncatedStdout = stdoutRaw.length > stdoutCap
	const truncatedStderr = stderrRaw.length > stderrCap
	const truncatedCombined = stdoutRaw.length + stderrRaw.length > streamTotal

	return {
		...snap,
		stdout: truncatedStdout ? stdoutRaw.slice(0, stdoutCap) : stdoutRaw,
		stderr: truncatedStderr ? stderrRaw.slice(0, stderrCap) : stderrRaw,
		outputTruncated: truncatedStdout || truncatedStderr || truncatedCombined || snap.outputTruncated,
	}
}

interface CommandJob {
	id: string
	state: CommandJobState
	startedAtMs: number
	deadlineAtMs: number
	maxRetainedOutputChars: number
	maxResponseOutputChars: number

	process: SupervisableShellProcess

	exitCode?: number
	signal?: string

	/**
	 * ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01
	 * C2 plumbing: closed runtime-owned authority slot captured from
	 * the call site's `AgentToolContext.executionCapability` at job
	 * construction time. NEVER read from generic metadata.
	 */
	executionCapability?: InternalExecutionCapability

	/**
	 * Latched when the host initiates termination. Survives natural exit.
	 * First-writer-wins: a cancel that arrives after the deadline has
	 * already initiated termination does NOT downgrade the recorded
	 * reason. The terminal outcome reflects the host's first decision,
	 * not the most recent call.
	 */
	terminationReason: TerminationReason
	/**
	 * The in-flight terminate() promise, set once by the first caller.
	 * Subsequent callers receive this same promise instead of starting
	 * a new SIGTERM sequence. Avoids racing two terminate() flows
	 * against each other.
	 */
	terminationPromise?: Promise<void>
	finalized: boolean

	/**
	 * CORRECTION03: set when the process tree was not observed gone
	 * after the grace + SIGKILL sequence. This is a diagnostic flag
	 * indicating an exceptional condition (stuck kernel, setpgid()
	 * escape, or sandbox-swallowed signals). The job is still
	 * considered terminal from the manager's perspective; the flag
	 * is observable through the snapshot for telemetry.
	 */
	treeEscapee?: boolean

	/** Tracked so finalize() can clear them — no leftover listeners. */
	deadlineTimer?: NodeJS.Timeout
	abortListener?: () => void
	abortSignal?: AbortSignal
	/**
	 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03: resolver
	 * for the terminal-transition promise. Set by `start()` at job
	 * creation time (BEFORE the active Map is mutated, so the
	 * resolver is registered before the exit transition can
	 * resolve and call `finalize()`). Called by `finalize()` with
	 * `{ becameIdle: boolean }` after the job is removed from the
	 * active Map. The flag is computed at the mutation seam (size
	 * before delete) so it is race-safe.
	 */
	terminalTransitionResolve?: (transition: TerminalTransition) => void
	/**
	 * ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01:
	 * Optional sandbox-side cleanup hook (e.g. Seatbelt profile temp
	 * dir removal). Set by `start()` when the experimental sandbox
	 * was used; called by `finalize()` best-effort. Cleanup failure
	 * MUST NOT alter the command's exit classification.
	 */
	sandboxCleanup?: () => Promise<void>
	/**
	 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03:
	 * terminal-transition promise. Pre-created in `start()` so the
	 * resolver is registered before the exit transition can fire
	 * `finalize()`. Resolves with `{ becameIdle: boolean }` after
	 * the job is removed from the active Map. The flag is computed
	 * at the mutation seam (size before delete) so it is race-safe.
	 * The runner attaches `.then(({becameIdle}) => ...)` to this
	 * promise instead of post-hoc-querying `getActiveJobIds()`.
	 */
	terminalTransitionPromise?: Promise<TerminalTransition>
} /**
 * CommandJobManager — the single host owner of command execution
 * lifetime for the VS Code extension's `run_commands` background path.
 *
 * Lifetime is the host's session/runtime lifetime: created with the
 * session, disposed when the session ends. Active jobs are tracked in
 * memory; terminal jobs are kept in a bounded LRU so the model can
 * follow up on recently-finished work without unbounded growth.
 */
export class CommandJobManager {
	private readonly active = new Map<string, CommandJob>()
	private readonly terminal = new Map<string, CommandJob>()
	private readonly terminalOrder: string[] = []
	private readonly exitTransitions = new Map<string, Promise<void>>()
	/**
	 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03:
	 * terminal-transition promises keyed by jobId. Each job's
	 * `terminalPromise` is derived from this map at start time and
	 * is resolved from `finalize()` with `{ becameIdle: boolean }`.
	 * The runner uses the transition flag directly to decide whether
	 * to fire the host's `backgroundCommandRunning` projection
	 * reset — never a post-hoc `getActiveJobIds()` count.
	 */
	private readonly terminalTransitions = new Map<string, Promise<TerminalTransition>>()

	private readonly maxTerminalJobs: number
	private readonly maxExecutionDeadlineMs: number
	private readonly maxWaitBudgetMs: number
	/**
	 * ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01:
	 * Sandbox backend resolver (DI seam). Falls back to the production
	 * default that reads `CLINEMM_EXPERIMENTAL_SANDBOX=seatbelt` and
	 * resolves through `getSandboxBackend`. Frozen so callers cannot
	 * accidentally mutate it post-construction (mutating the resolver
	 * would silently change the fail-closed contract for in-flight jobs).
	 */
	private readonly sandboxBackendResolver: SandboxBackendResolver
	/**
	 * ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01:
	 * Canonical workspace roots treated as write-confined regions in
	 * the Wave-1 experimental capability. Frozen.
	 */
	private readonly experimentalSandboxWorkspaceRoots: readonly string[]
	/**
	 * ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01:
	 * Optional source for setting-driven capability overrides. When
	 * supplied, the production capability builder reads this
	 * snapshot at every command-start and applies it as the runtime
	 * source of truth; when omitted, the legacy env-only path runs
	 * (every existing test suite stays green).
	 */
	private readonly safeYoloCapabilitySource:
		| (() => {
				readonly network: boolean | undefined
				readonly sshAgent: boolean | undefined
		  })
		| undefined

	constructor(options: CommandJobManagerOptions = {}) {
		this.maxTerminalJobs = Math.max(1, options.maxTerminalJobs ?? MAX_TERMINAL_JOBS)
		this.maxExecutionDeadlineMs = Math.max(0, options.maxExecutionDeadlineMs ?? DEFAULT_EXECUTION_DEADLINE_MS)
		this.maxWaitBudgetMs = Math.max(0, options.maxWaitBudgetMs ?? DEFAULT_WAIT_BUDGET_MS)
		this.sandboxBackendResolver = options.sandboxBackendResolver ?? defaultSandboxBackendResolver
		this.experimentalSandboxWorkspaceRoots = Object.freeze([...(options.experimentalSandboxWorkspaceRoots ?? [])])
		this.safeYoloCapabilitySource = options.safeYoloCapabilitySource
	}

	async start(options: StartCommandJobOptions, context?: AgentToolContext): Promise<StartCommandJobResult> {
		// INVARIANT 4: the deadline is host-authoritative. The caller's
		// requested deadline is clamped DOWN to the manager's ceiling.
		const effectiveDeadlineMs = Math.min(Math.max(0, options.executionDeadlineMs), this.maxExecutionDeadlineMs)
		// Wait budget is also clamped DOWN — to the manager's ceiling AND
		// to the effective deadline. Waiting can never extend execution.
		const effectiveWaitBudgetMs = Math.min(Math.max(0, options.waitBudgetMs), this.maxWaitBudgetMs, effectiveDeadlineMs)
		const maxRetainedOutputChars = options.maxRetainedOutputChars ?? MAX_RETAINED_JOB_OUTPUT_CHARS
		const maxResponseOutputChars = options.maxOutputChars ?? MAX_RESPONSE_OUTPUT_CHARS

		const shell = options.shell ?? getDefaultShell(process.platform)
		let executable: string
		let args: string[]
		let input: string | undefined
		if (typeof options.command === "string") {
			const invocation = getShellInvocation(shell, options.command)
			executable = shell
			args = invocation.args
			input = invocation.input
		} else {
			const structured = options.command
			executable = structured.command
			args = structured.args ?? []
			input = undefined
		}

		const id = generateJobId()
		const startedAtMs = Date.now()
		const deadlineAtMs = startedAtMs + effectiveDeadlineMs

		// ----------------------------------------------------------------
		// ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01:
		// Experimental opt-in integration.
		//
		// ACT-CLINEMM-SEATBELT-DEFAULT-ON01: the contract changed from
		// DEFAULT_OFF to SECURE-BY-DEFAULT on darwin. `resolveExperimental
		// SandboxMode()` returns `"seatbelt-experimental"` for any unset,
		// empty, or "seatbelt" value, and `undefined` ONLY for the
		// explicit break-glass `CLINEMM_EXPERIMENTAL_SANDBOX=off`.
		// Unknown values now THROW `InvalidSandboxConfigurationError`
		// (fail closed; a typo must never silently disable Seatbelt).
		//
		// Fail-closed contract (P0 invariant, ACT-CLINEMM-SEATBELT-DEFAULT-ON01):
		//   - default (unset / "" / "seatbelt") → seatbelt path
		//   - "off"                              → legacy path (break-glass)
		//   - selector throws InvalidSandboxConfig → bubble out (no spawn)
		//   - seatbelt + no backend              → sandbox-unavailable, no spawn
		//   - seatbelt + prepare throws          → fail-closed, no spawn
		//   - seatbelt + prepare ok              → use prepared invocation as-is
		//                                        (executable/args/cwd/env come
		//                                        from the backend, NOT from the
		//                                        original)
		// ----------------------------------------------------------------
		const sandboxMode = resolveExperimentalSandboxMode()
		let preparedEnvSemantics: "overlay" | "complete" | undefined
		let sandboxCleanup: (() => Promise<void>) | undefined
		// The env passed to the supervisor. When the sandbox prepared
		// an invocation, we MUST use `prepared.env` (which contains the
		// sanitized allowlist) and NOT `options.env` (which may contain
		// secrets that the parent wants to pass to an unsandboxed
		// shell). The `envSemantics` field tells the supervisor how to
		// merge this `env` with the parent's `process.env`.
		let spawnEnv: Record<string, string> = options.env ?? {}
		// ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01-C2-P1:
		// The cwd passed to Node's spawn() MUST come from the prepared
		// invocation when the sandbox prepared one, not from the caller's
		// `options.cwd`. The Seatbelt backend canonicalizes cwd before
		// emitting the prepared invocation (e.g. /tmp/... -> /private/tmp/...);
		// the canonicalized form is what must reach spawn(). Node's
		// `spawn({ cwd })` is the working directory of the explicit
		// child -- this is not cosmetic metadata.
		let spawnCwd: string = options.cwd

		if (sandboxMode !== undefined) {
			// Opt-in recognized: route through the sandbox abstraction.
			const backend = await this.sandboxBackendResolver(sandboxMode)
			if (!backend) {
				// Fail-closed: opt-in recognized but no backend applies
				// (substrate unavailable, gate failed, etc.). The
				// command is NOT executed unsandboxed.
				return this.buildSandboxUnavailableResult({
					id,
					startedAtMs,
					deadlineAtMs,
					maxRetainedOutputChars,
					maxResponseOutputChars,
					signal: `sandbox-unavailable: opt-in ${sandboxMode} but no backend resolved`,
				})
			}

			// Build the Wave-1 capability. This function lives in the
			// sandbox-policy module so the executor stays agnostic of
			// Seatbelt-specific semantics.
			//
			// ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01:
			// when a setting-driven capability source has been injected
			// into the manager (the production path through
			// VscodeSessionHost), read it here and pass the override
			// values through. When no source was injected (legacy
			// callers and existing test suites), the builder's env-only
			// fallback runs unchanged — every pre-existing test stays
			// green.
			let capability: ReturnType<typeof buildExperimentalReconCapability>
			if (this.safeYoloCapabilitySource) {
				const snap = this.safeYoloCapabilitySource()
				const convertedSnap = resolveSafeYoloCapabilityFromState(snap)
				capability = buildExperimentalReconCapability({
					cwd: options.cwd,
					workspaceRoots: this.experimentalSandboxWorkspaceRoots,
					networkOverride: convertedSnap.network,
					sshAgentOverride: convertedSnap.sshAgent,
				})
			} else {
				capability = buildExperimentalReconCapability({
					cwd: options.cwd,
					workspaceRoots: this.experimentalSandboxWorkspaceRoots,
				})
			}

			// ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2:
			// map the typed per-command channel into the Seatbelt
			// sandbox capability. The `jobExecutionCapability`
			// variable is constructed later (line 706 below) on
			// purpose; for the sandbox-prepare call we read directly
			// from `context` here, which is the single trusted source
			// for the typed channel.
			//
			// Mapping (exhaustive, spec §17 / §45):
			//   case "filesystem-create-only":
			//     createOnlyRoots = cap.roots (Seatbelt emits
			//      (allow file-write-create (subpath "<root>")))
			//   case "factory-binding-probe":
			//   case undefined:
			//     createOnlyRoots = []  (recon default applies)
			//
			// Future InternalExecutionCapability variants force a
			// switch update (compile error otherwise); prevents
			// silent authority drop (spec §18).
			const createOnlyRootsForThisJob = capabilityFromJobExecution(
				context?.perCommandExecutionCapability !== undefined
					? context.perCommandExecutionCapability
					: context?.executionCapability,
			)

			let prepared
			try {
				prepared = await backend.prepare({
					capability: {
						...capability,
						// ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2:
						// attach the typed per-command create-only roots
						// (if any) so the Seatbelt profile generator
						// emits (allow file-write-create (subpath ...)).
						// [] is the safe no-op (no narrowing).
						...(createOnlyRootsForThisJob.length > 0 ? { createOnlyRoots: createOnlyRootsForThisJob } : {}),
					},
					command: {
						executable,
						args,
						cwd: options.cwd,
						env: options.env ?? {},
						input,
					},
				})
			} catch (err) {
				// Fail-closed: prepare threw (canonicalize, profile,
				// launch-prepare, etc.). The command is NOT executed
				// unsandboxed. The error is surfaced via `signal` on
				// a `spawn_failed` result.
				const reason =
					err instanceof SandboxError
						? `${err.reason}: ${err.message}`
						: err instanceof Error
							? err.message
							: String(err)
				return this.buildSandboxUnavailableResult({
					id,
					startedAtMs,
					deadlineAtMs,
					maxRetainedOutputChars,
					maxResponseOutputChars,
					signal: `sandbox-prepare-failed: ${reason}`,
				})
			}

			// STRUCTURAL spawn binding (reviewer evidence 2): the
			// prepared invocation is the authoritative spawn shape for
			// ALL spawn() fields, not just executable/args/env. We replace
			// each field with what the backend produced, and thread
			// `prepared.envSemantics` through the supervisor so the
			// env-merge site honors the contract.
			executable = prepared.executable
			args = [...prepared.args]
			input = prepared.input
			// CRITICAL: use the BACKEND'S cwd. Node's spawn({ cwd }) is
			// the actual working directory of the spawned child, not
			// metadata. The Seatbelt backend canonicalizes cwd in
			// prepare(); honoring `options.cwd` would silently drop that
			// canonicalization (e.g. /tmp/... -> /private/tmp/...).
			spawnCwd = prepared.cwd
			// CRITICAL: use the BACKEND'S env, not the caller's. The
			// caller's `options.env` may carry secrets that the parent
			// (run_commands host) wants to forward to an unsandboxed
			// shell. Under sanitized mode, those must NOT reach the
			// child. The backend's env is the authoritative allowlist.
			spawnEnv = prepared.env
			preparedEnvSemantics = prepared.envSemantics
			sandboxCleanup = prepared.cleanup
		}

		// ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01-C2-P2:
		// If the supervisor throws synchronously (rare, but possible:
		// e.g. a malformed SpawnConfig that the supervisor validates
		// before calling spawn()), ensure the sandbox-prepared cleanup
		// hook still runs. Without this, a profile temp dir from a
		// successful prepare() could leak because cleanup was attached
		// to the job only after this line.
		let childProcess
		try {
			childProcess = spawnSupervisableShellCommand(
				{
					executable,
					args,
					cwd: spawnCwd,
					env: spawnEnv,
					input,
					// When `undefined` (legacy / disabled / unrecognized
					// opt-in) the supervisor preserves the existing
					// `{ ...process.env, ...config.env }` merge. When the
					// sandbox produced a sanitized env, this is "complete"
					// and the supervisor uses `config.env` AS-IS.
					envSemantics: preparedEnvSemantics,
				},
				{
					// Retain enough for follow-up status checks; response
					// truncation happens at the snapshot projection.
					maxOutputChars: maxRetainedOutputChars,
					combineOutput: true,
				},
			)
		} catch (err) {
			if (sandboxCleanup) {
				void sandboxCleanup().catch(() => {
					// Swallow: cleanup is best-effort, synchronous
					// supervisor throw is the load-bearing error.
				})
			}
			throw err
		}

		// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03:
		// set up the terminal-transition promise BEFORE the active
		// Map mutation so the resolver is registered before the
		// exit transition can resolve and call `finalize()`. The
		// previous order (set up the deferred in `makeStartResult`
		// after the race) had a race: if the child process completes
		// synchronously (the fast-path case), the exit transition's
		// `.then()` callback fires before `makeStartResult` runs,
		// and the resolver is undefined when `finalize` tries to
		// resolve it. Pre-creating the deferred here removes the
		// race.
		let resolveTerminalTransition!: (transition: TerminalTransition) => void
		const terminalTransitionPromise = new Promise<TerminalTransition>((resolve) => {
			resolveTerminalTransition = resolve
		}).then(
			(value) => value,
			() => ({ becameIdle: false }) as TerminalTransition,
		)
		this.terminalTransitions.set(id, terminalTransitionPromise)

		// ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01
		// C2 plumbing: closed runtime-owned authority slot stamped from
		// the call-site `AgentToolContext.executionCapability`. This is
		// the ONLY writer -- it is NEVER derived from `context.metadata`
		// or any other partially-untrusted channel.
		//
		// ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2
		// CORRECTION01 (typed-channel separation):
		// Read from the typed per-command channel when present; the
		// legacy tool-call channel is reserved for the synthetic
		// `factory-binding-probe` capability (zero real authority)
		// and must not be widened here. This honors the
		// channel-separation contract: real authority-bearing
		// variants (`filesystem-create-only`, ...) flow through
		// `perCommandExecutionCapability` only.
		const jobExecutionCapability: InternalExecutionCapability | undefined =
			context?.perCommandExecutionCapability !== undefined
				? context.perCommandExecutionCapability
				: context?.executionCapability

		const job: CommandJob = {
			id,
			state: "running",
			startedAtMs,
			deadlineAtMs,
			maxRetainedOutputChars,
			maxResponseOutputChars,
			process: childProcess,
			terminationReason: "natural",
			finalized: false,
			terminalTransitionResolve: resolveTerminalTransition,
			terminalTransitionPromise,
			// ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01
			// C2 plumbing: closed runtime-owned authority slot stamped at
			// construction time. Recorded on the job record for snapshot
			// inspection by tests; not consumed by the sandbox in C2 of
			// THIS ACT (Seatbelt integration resumes in
			// ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2).
			executionCapability: jobExecutionCapability,
			// ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01:
			// Stash the sandbox-prepared cleanup hook (e.g. Seatbelt
			// profile temp dir removal). `finalize()` will run it
			// best-effort. Always `undefined` for non-sandboxed jobs.
			sandboxCleanup,
		}
		// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03: capture
		// the cardinality transition at the manager's mutation seam.
		// The check happens BEFORE `this.active.set` so the value is
		// race-safe under concurrent `start()` calls — between this
		// check and the `set` no other code can run (single-threaded JS).
		// After this insertion, `wasBecomingActive` is true iff this
		// was a 0->1 cardinality transition. The runner uses this
		// flag directly instead of a post-hoc `getActiveJobIds()`
		// count, which would be racy.
		const wasBecomingActive = this.active.size === 0
		this.active.set(id, job)

		// Track exit; finalize using the latched terminationReason so
		// host-initiated termination wins over the child's cooperation.
		const exitTransition = childProcess.exit
			.then((result: { exitCode: number | null; signal: NodeJS.Signals | null }) => {
				if (job.finalized) return
				const state: CommandJobState =
					job.terminationReason === "deadline"
						? "deadline_exceeded"
						: job.terminationReason === "cancel"
							? "cancelled"
							: "exited"
				this.finalize(job, state, { exitCode: result.exitCode, signal: result.signal })
			})
			.catch((error: Error) => {
				if (job.finalized) return
				this.finalize(job, "spawn_failed", { signal: error.message })
			})
		this.exitTransitions.set(id, exitTransition)

		// Deadline watchdog — the only timer allowed to call killTree.
		// Tracked on the job so finalize() can clear it.
		job.deadlineTimer = setTimeout(() => {
			if (job.finalized || job.state !== "running") return
			void this.terminate(job, "deadline")
		}, effectiveDeadlineMs)
		job.deadlineTimer.unref()

		// Honor caller-supplied AbortSignal as a cancel, not a deadline.
		if (context?.signal) {
			job.abortSignal = context.signal
			job.abortListener = () => {
				if (job.finalized || job.state !== "running") return
				void this.terminate(job, "cancel")
			}
			if (context.signal.aborted) {
				job.abortListener()
			} else {
				context.signal.addEventListener("abort", job.abortListener, { once: true })
			}
		}

		// Race the wait budget against the exit. Wait budget does NOT
		// kill the process — it returns a RUNNING snapshot if the child
		// is still alive after the budget. Fast commands resolve their
		// `process.exit` synchronously after spawn and the finalize()
		// callback runs before this Promise.race resolves, so the tool
		// sees the terminal state without spurious RUNNING.
		return this.awaitOrSnapshot(job, effectiveWaitBudgetMs, wasBecomingActive)
	}

	private async awaitOrSnapshot(
		job: CommandJob,
		waitBudgetMs: number,
		wasBecomingActive: boolean,
	): Promise<StartCommandJobResult> {
		const remaining = Math.max(0, waitBudgetMs - (Date.now() - job.startedAtMs))
		if (remaining > 0 && job.state === "running") {
			// Wait for terminal transition or budget — whichever first.
			// No mutable waiter list: race the existing exitTransition
			// promise against a one-shot timer. Each status() call creates
			// its own ad-hoc promise, so the cost is bounded by the
			// active status callers — not by repeated polls.
			// Critical: clear the timer reference so it does not stay
			// registered for the full remaining duration when the exit
			// wins the race.
			let timer: NodeJS.Timeout | undefined
			await Promise.race([
				this.exitTransitions.get(job.id) ?? Promise.resolve(),
				new Promise<void>((resolve) => {
					timer = setTimeout(resolve, remaining)
					timer.unref()
				}),
			])
			if (timer) {
				clearTimeout(timer)
			}
		}
		return this.makeStartResult(job, wasBecomingActive)
	}

	private makeStartResult(job: CommandJob, wasBecomingActive: boolean): StartCommandJobResult {
		const snap = projectResponseSnapshot(snapshot(job), job.maxResponseOutputChars)
		// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03: the
		// terminal-transition promise is pre-created in `start()`
		// BEFORE the active Map is mutated, so the resolver is
		// registered before the exit transition can resolve and
		// call `finalize()`. This removes the fast-path race where
		// the deferred didn't exist yet when finalize ran. See the
		// creation site in `start()` for the full rationale.
		if (!job.terminalTransitionPromise) {
			// Defensive fallback — should never trigger in practice
			// because the deferred is created at job construction
			// time. If it does, return a never-resolving promise so
			// the runner's `.then()` is a no-op rather than crashing.
			throw new Error("terminalTransitionPromise missing on job")
		}
		return {
			jobId: job.id,
			state: job.state,
			elapsedMs: snap.elapsedMs,
			deadlineRemainingMs: snap.deadlineRemainingMs,
			stdout: snap.stdout,
			stderr: snap.stderr,
			outputTruncated: snap.outputTruncated,
			process: job.process,
			terminalPromise: job.terminalTransitionPromise,
			becameActive: wasBecomingActive,
			...(snap.exitCode !== undefined ? { exitCode: snap.exitCode } : {}),
			...(snap.signal !== undefined ? { signal: snap.signal } : {}),
		}
	}

	/**
	 * ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01:
	 * Build a `spawn_failed` result for sandbox fail-closed paths.
	 *
	 * Used when:
	 *   - opt-in recognized, but `sandboxBackendResolver` returns `undefined`
	 *     (substrate unavailable, gate failed)
	 *   - opt-in recognized, backend available, but `prepare()` throws
	 *     a `SandboxError` (canonicalize, profile, etc.)
	 *
	 * The job never enters the active Map (no spawn occurred), so
	 * `terminalPromise` resolves immediately with `becameIdle: true` —
	 * the runner's `.then()` chain is a no-op.
	 *
	 * The `process` field is a synthetic "never-spawned" shell process
	 * whose `killTree()`/`terminateTree()` are no-ops. This is required
	 * by the type but never invoked because `state` is already terminal.
	 */
	private buildSandboxUnavailableResult(input: {
		id: string
		startedAtMs: number
		deadlineAtMs: number
		maxRetainedOutputChars: number
		maxResponseOutputChars: number
		signal: string
	}): StartCommandJobResult {
		const never = (): Promise<never> => new Promise<never>(() => {})
		const emptySnap = () => ({ text: "", totalChars: 0, dropped: false })
		const syntheticProcess: SupervisableShellProcess = Object.freeze({
			exit: never(),
			killTree: async () => {},
			terminateTree: async () => ({ treeTerminated: true, escalatedToKill: false }),
			stdoutSnapshot: emptySnap,
			stderrSnapshot: emptySnap,
			pid: undefined,
		})
		return {
			jobId: input.id,
			state: "spawn_failed",
			elapsedMs: Math.max(0, Date.now() - input.startedAtMs),
			deadlineRemainingMs: Math.max(0, input.deadlineAtMs - Date.now()),
			stdout: "",
			stderr: "",
			outputTruncated: false,
			process: syntheticProcess,
			// The job never entered the active Map, so there is no
			// cardinality transition to observe. Resolve immediately
			// with `becameIdle: true` so any downstream `.then()` is a
			// no-op rather than holding a pending promise.
			terminalPromise: Promise.resolve({ becameIdle: true }),
			becameActive: false,
			signal: input.signal,
		}
	}

	private async terminate(job: CommandJob, reason: "deadline" | "cancel"): Promise<void> {
		if (job.finalized || job.state !== "running") return
		// FIRST-WRITER-WINS: if termination is already in flight, return
		// the existing promise. The deadline-vs-cancel race produces a
		// stable outcome from the first call, not the most recent.
		if (job.terminationPromise) {
			return job.terminationPromise
		}
		// Latch the reason and start the termination flow.
		job.terminationReason = reason
		job.terminationPromise = this.runTerminationSequence(job)
		return job.terminationPromise
	}

	private async runTerminationSequence(job: CommandJob): Promise<void> {
		// CORRECTION03 P0: terminate the OWNED PROCESS TREE, not just
		// the shell's exit promise. The previous implementation raced
		// against `job.process.exit` and skipped the SIGKILL escalation
		// whenever the shell cooperated — even if SIGTERM-ignoring
		// descendants remained in the owned process group.
		//
		// The primitive handles PGID existence polling and SIGKILL
		// escalation internally (see SupervisableShellProcess.terminateTree).
		// The manager's job here is to:
		//   1) ask the primitive to terminate the tree
		//   2) await the canonical terminal transition so the caller
		//      (cancel/deadline) can read job.state directly without
		//      synthesizing it.
		const treeResult = await job.process.terminateTree({
			gracefulSignal: "SIGTERM",
			graceMs: TERM_GRACE_MS,
		})
		// After terminateTree resolves, the tree is observed gone OR
		// the escalation completed. The shell's exit promise will
		// resolve shortly (the shell was part of the tree). Await it
		// so the caller can read job.state as the canonical terminal
		// state — fixes P1 (synthesized state before finalization).
		try {
			await job.process.exit
		} catch {
			// Spawn failure or kill-induced exit; finalize() will have
			// already handled classification.
		}
		// Surface the tree outcome through the job for telemetry/diagnostics.
		if (!treeResult.treeTerminated) {
			// The OS still reports the PG as existing after grace +
			// SIGKILL. This is exceptional — typically a stuck kernel
			// state, a process that called setpgid() to escape our
			// group, or a sandbox that swallowed signals. Record it
			// as a structured detail so the caller can diagnose; do
			// not retry (no further escalation is safe here).
			job.treeEscapee = true
		}
	}

	private finalize(
		job: CommandJob,
		state: Exclude<CommandJobState, "running">,
		detail: { exitCode?: number | null; signal?: NodeJS.Signals | string | null },
	): void {
		if (job.finalized) return
		job.finalized = true
		job.state = state
		if (detail.exitCode !== undefined && detail.exitCode !== null) {
			job.exitCode = detail.exitCode
		}
		if (typeof detail.signal === "string") {
			job.signal = detail.signal
		}
		// INVARIANT (timer hygiene): clear any leftover watchdog / abort
		// listener so high command volume doesn't accumulate timers.
		if (job.deadlineTimer) {
			clearTimeout(job.deadlineTimer)
			job.deadlineTimer = undefined
		}
		if (job.abortListener && job.abortSignal) {
			job.abortSignal.removeEventListener("abort", job.abortListener)
			job.abortSignal = undefined
			job.abortListener = undefined
		}
		// ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01:
		// Run the sandbox cleanup hook best-effort. For Seatbelt this
		// removes the profile temp dir. MUST NOT alter the command's
		// exit classification — failures are swallowed and `state` /
		// `signal` already reflect the original command outcome.
		if (job.sandboxCleanup) {
			const cleanup = job.sandboxCleanup
			job.sandboxCleanup = undefined
			void cleanup().catch(() => {
				// Swallow: cleanup failures are non-fatal.
			})
		}
		// Move from active → terminal (bounded FIFO).
		// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03: capture
		// the cardinality transition at the manager's mutation seam.
		// The check happens BEFORE `this.active.delete` so the value
		// is race-safe under concurrent terminal-completions — between
		// this check and the delete no other code can run
		// (single-threaded JS). After this delete, `wasBecomingIdle`
		// is true iff this was a >0->0 cardinality transition. The
		// runner uses this flag directly instead of a post-hoc
		// `getActiveJobIds()` count.
		const wasBecomingIdle = this.active.size === 1
		this.active.delete(job.id)
		// Resolve the terminal-transition promise with the captured
		// flag. This is the single source of truth for the
		// >0->0 transition identity; the runner reads the flag
		// from the resolved value.
		if (job.terminalTransitionResolve) {
			job.terminalTransitionResolve({ becameIdle: wasBecomingIdle })
			job.terminalTransitionResolve = undefined
		}
		this.terminal.set(job.id, job)
		this.terminalOrder.push(job.id)
		while (this.terminalOrder.length > this.maxTerminalJobs) {
			const evictId = this.terminalOrder.shift()
			if (evictId) {
				this.terminal.delete(evictId)
				this.exitTransitions.delete(evictId)
				// Also drop the terminal-transition promise so the
				// map doesn't grow unbounded for the lifetime of the
				// manager.
				this.terminalTransitions.delete(evictId)
			}
		}
	}

	/**
	 * Observe a job's state. If still running, blocks up to `waitMs`
	 * (clamped to MAX_STATUS_WAIT_MS) for the first terminal transition.
	 *
	 * Returns a structured error for unknown jobs (NOT a thrown exception
	 * — the caller needs a deterministic shape to surface to the model).
	 *
	 * Polling pattern is bounded: each call creates its own ad-hoc timer
	 * and races against the job's `exitTransitions` promise; the per-call
	 * promise is dropped once the call returns. Repeated polling therefore
	 * does NOT accumulate waiters on the job.
	 */
	async status(
		options: StatusCommandJobOptions,
	): Promise<{ ok: true; snapshot: CommandJobSnapshot } | { ok: false; code: "unknown_job" }> {
		const job = this.lookup(options.jobId)
		if (!job) {
			return { ok: false, code: "unknown_job" }
		}
		const waitMs = Math.max(0, Math.min(options.waitMs, MAX_STATUS_WAIT_MS))

		if (job.state !== "running") {
			return { ok: true, snapshot: projectResponseSnapshot(snapshot(job), job.maxResponseOutputChars) }
		}

		if (waitMs === 0) {
			return { ok: true, snapshot: projectResponseSnapshot(snapshot(job), job.maxResponseOutputChars) }
		}

		// Race the existing exitTransition promise against a one-shot
		// timer. No mutable waiter list — the timer is local to this
		// call and never registered on the job. Clear the timer
		// reference once the race resolves so it does not stay
		// registered for the full waitMs duration when the exit wins.
		let timer: NodeJS.Timeout | undefined
		const timeout = new Promise<void>((resolve) => {
			timer = setTimeout(resolve, waitMs)
			timer.unref()
		})
		await Promise.race([this.exitTransitions.get(job.id) ?? Promise.resolve(), timeout])
		if (timer) {
			clearTimeout(timer)
		}
		return { ok: true, snapshot: projectResponseSnapshot(snapshot(job), job.maxResponseOutputChars) }
	}

	/**
	 * Cancel a running job. Idempotent: re-cancelling a terminal or
	 * already-cancelled job is a no-op.
	 *
	 * CORRECTION03 P1: by the time `terminate()` returns, the
	 * process tree has been observed gone (grace + escalation),
	 * `job.process.exit` has resolved, and `finalize()` has set
	 * `job.state` to its canonical terminal value (e.g. "cancelled").
	 * We return that value directly — no synthesis. The earlier
	 * `job.state === "running" ? "cancelled" : job.state` formula
	 * could briefly report "cancelled" while `job.state` was still
	 * "running", since killTree() only sends the kill and does not
	 * await the subsequent close event.
	 */
	async cancel(
		options: CancelCommandJobOptions,
	): Promise<{ ok: true; state: CommandJobState } | { ok: false; code: "unknown_job" }> {
		const job = this.lookup(options.jobId)
		if (!job) {
			return { ok: false, code: "unknown_job" }
		}
		if (job.state !== "running") {
			return { ok: true, state: job.state }
		}
		await this.terminate(job, "cancel")
		return { ok: true, state: job.state }
	}

	private lookup(jobId: string): CommandJob | undefined {
		return this.active.get(jobId) ?? this.terminal.get(jobId)
	}

	get activeCount(): number {
		return this.active.size
	}

	get terminalCount(): number {
		return this.terminal.size
	}

	/**
	 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01: enumerate the active job
	 * ids. Returns a snapshot (Array.from) so the caller can iterate
	 * without holding a reference to the underlying `active` Map. The
	 * host's Cancel button iterates this list to cancel every still-
	 * running background command before tearing down the task.
	 */
	getActiveJobIds(): string[] {
		return Array.from(this.active.keys())
	}

	/**
	 * Dispose the manager: cancel every still-running job and drop all
	 * retained state. Call from the host's session teardown.
	 */
	async dispose(): Promise<void> {
		const activeIds = Array.from(this.active.keys())
		for (const id of activeIds) {
			const job = this.active.get(id)
			if (job) {
				await this.terminate(job, "cancel")
			}
		}
		this.active.clear()
		this.terminal.clear()
		this.terminalOrder.length = 0
		this.exitTransitions.clear()
		// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03: drop
		// any terminal-transition promises. The terminal maps have
		// been cleared by `terminate()` above (which finalizes each
		// job), so these should be empty in practice; this is a
		// belt-and-suspenders cleanup.
		this.terminalTransitions.clear()
	}
}

/**
 * ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2:
 *
 * Map a job-level typed `InternalExecutionCapability` into the
 * Seatbelt `CommandCapability.createOnlyRoots` field. Exhaustive
 * switch over the union (spec §17 / §45):
 *
 *   case "filesystem-create-only":
 *     return roots (passed verbatim; the Seatbelt backend
 *     canonicalizes each root again as a fail-closed gate at
 *     prepare() time).
 *   case "factory-binding-probe":
 *   case undefined:
 *     return []  (no narrowing; recon default applies)
 *
 * Future variants of `InternalExecutionCapability` MUST be added
 * here. The TypeScript exhaustiveness check (the trailing
 * `assertNever`) makes a missing branch a compile error, which
 * prevents silent dropping of authority (spec §18: "do not silently
 * drop a capability that was required for the approved
 * execution").
 *
 * Why this is a separate helper:
 *   - testable in isolation
 *   - keeps the sandbox-policy module agnostic of
 *     `InternalExecutionCapability` (the union is policy-layer, not
 *     sandbox-layer)
 *   - future capability variants only need to be wired here, not in
 *     every consumer of CommandJobManager
 */
function capabilityFromJobExecution(capability: InternalExecutionCapability | undefined): readonly string[] {
	switch (capability?.kind) {
		case "filesystem-create-only":
			return capability.roots
		case "factory-binding-probe":
		case undefined:
			return []
		default:
			return assertNeverExhaustiveCapabilityKind(capability)
	}
}

/**
 * TypeScript exhaustiveness helper. If the
 * `InternalExecutionCapability` union grows, this branch becomes
 * unreachable; the `never` annotation then makes the call site
 * a compile error: any caller of `capabilityFromJobExecution`
 * must be updated. Without this, a future variant could silently
 * fall through to `return []`, dropping authority that the
 * approved execution required (spec §18).
 */
function assertNeverExhaustiveCapabilityKind(x: never): never {
	throw new Error(`capabilityFromJobExecution: unhandled InternalExecutionCapability kind ${JSON.stringify(x)}`)
}
