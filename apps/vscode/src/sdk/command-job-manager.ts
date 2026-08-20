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
import { type StructuredCommandInput, type SupervisableShellProcess, spawnSupervisableShellCommand } from "@cline/core"
import { type AgentToolContext, getDefaultShell, getShellInvocation } from "@cline/shared"

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

	constructor(options: CommandJobManagerOptions = {}) {
		this.maxTerminalJobs = Math.max(1, options.maxTerminalJobs ?? MAX_TERMINAL_JOBS)
		this.maxExecutionDeadlineMs = Math.max(0, options.maxExecutionDeadlineMs ?? DEFAULT_EXECUTION_DEADLINE_MS)
		this.maxWaitBudgetMs = Math.max(0, options.maxWaitBudgetMs ?? DEFAULT_WAIT_BUDGET_MS)
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

		const childProcess = spawnSupervisableShellCommand(
			{
				executable,
				args,
				cwd: options.cwd,
				env: options.env ?? {},
				input,
			},
			{
				// Retain enough for follow-up status checks; response
				// truncation happens at the snapshot projection.
				maxOutputChars: maxRetainedOutputChars,
				combineOutput: true,
			},
		)

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
