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
 *
 *   - EXECUTION_DEADLINE_MS: maximum wall-clock lifetime the host
 *     permits the command. Expiry terminates the owned process tree
 *     and records `DEADLINE_EXCEEDED`.
 *
 * Three invariants:
 *   1. RUNNING is not a failure.
 *   2. The host may stop waiting without stopping the command, but it
 *      must never stop owning it.
 *   3. Cancellation is idempotent — calling cancel on an already-terminal
 *      job is a no-op.
 */
import { type StructuredCommandInput, type SupervisableShellProcess, spawnSupervisableShellCommand } from "@cline/core"
import { type AgentToolContext, getDefaultShell, getShellInvocation } from "@cline/shared"

export type CommandJobState = "running" | "exited" | "deadline_exceeded" | "cancelled" | "spawn_failed"

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

	/** How long to wait before returning control. Expiry ≠ termination. */
	waitBudgetMs: number
	/** Maximum lifetime the host permits. Expiry terminates the process. */
	executionDeadlineMs: number
	/** Cap on per-call response output (chars). */
	maxOutputChars?: number
	/** Cap on per-job retained output (chars). */
	maxRetainedOutputChars?: number
}

export interface StartCommandJobResult {
	jobId: string
	state: CommandJobState
	elapsedMs: number
	deadlineRemainingMs: number
	stdout: string
	outputTruncated: boolean
	process: SupervisableShellProcess
	exitCode?: number
	signal?: string
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
 * observing it.
 */
export const DEFAULT_EXECUTION_DEADLINE_MS = 600_000 // 10 min

/** Maximum output returned in a single tool call (chars). */
export const MAX_RESPONSE_OUTPUT_BYTES = 65_536

/** Maximum output retained per job for follow-up status inspection (chars). */
export const MAX_RETAINED_JOB_OUTPUT_BYTES = 4 * 1024 * 1024

/** Hard cap on `command_status(jobId, waitMs)`. */
export const MAX_STATUS_WAIT_MS = 30_000

/** Bounded retention for terminal jobs (LRU eviction). */
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

interface CommandJob {
	id: string
	state: CommandJobState
	startedAtMs: number
	deadlineAtMs: number
	maxRetainedOutputChars: number

	process: SupervisableShellProcess

	exitCode?: number
	signal?: string

	waiters: Array<(snap: CommandJobSnapshot) => void>
	finalized: boolean

	cancelRequested: boolean
	killIssued: boolean
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

	async start(options: StartCommandJobOptions, context?: AgentToolContext): Promise<StartCommandJobResult> {
		const waitBudgetMs = Math.max(0, options.waitBudgetMs)
		const executionDeadlineMs = Math.max(waitBudgetMs, options.executionDeadlineMs)
		const maxRetainedOutputChars = options.maxRetainedOutputChars ?? MAX_RETAINED_JOB_OUTPUT_BYTES
		const maxResponseOutputChars = options.maxOutputChars ?? MAX_RESPONSE_OUTPUT_BYTES

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
		const deadlineAtMs = startedAtMs + executionDeadlineMs

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
				// truncation happens at the snapshot boundary.
				maxOutputChars: maxRetainedOutputChars,
				combineOutput: true,
			},
		)

		const job: CommandJob = {
			id,
			state: "running",
			startedAtMs,
			deadlineAtMs,
			maxRetainedOutputChars,
			process: childProcess,
			waiters: [],
			finalized: false,
			cancelRequested: false,
			killIssued: false,
		}
		this.active.set(id, job)

		// Track exit; finalize to the appropriate terminal state.
		const exitTransition = childProcess.exit
			.then((result: { exitCode: number | null; signal: NodeJS.Signals | null }) => {
				if (job.finalized) return
				if (job.cancelRequested) {
					this.finalize(job, "cancelled", { exitCode: result.exitCode, signal: result.signal })
					return
				}
				if (Date.now() >= job.deadlineAtMs && (result.exitCode === null || result.exitCode !== 0)) {
					this.finalize(job, "deadline_exceeded", { exitCode: result.exitCode, signal: result.signal })
					return
				}
				this.finalize(job, "exited", { exitCode: result.exitCode, signal: result.signal })
			})
			.catch((error: Error) => {
				if (job.finalized) return
				this.finalize(job, "spawn_failed", { signal: error.message })
			})
		this.exitTransitions.set(id, exitTransition)

		// Deadline watchdog — the only timer allowed to call killTree.
		const deadlineTimer = setTimeout(() => {
			if (job.finalized || job.state !== "running") return
			void this.terminate(job, "deadline")
		}, executionDeadlineMs)
		deadlineTimer.unref()

		// Honor caller-supplied AbortSignal as a cancel, not a deadline.
		if (context?.signal) {
			const onAbort = () => {
				if (job.finalized || job.state !== "running") return
				void this.terminate(job, "cancel")
			}
			if (context.signal.aborted) {
				onAbort()
			} else {
				context.signal.addEventListener("abort", onAbort, { once: true })
			}
		}

		// Race the wait budget against the exit. Wait budget does NOT
		// kill the process — it returns a RUNNING snapshot if the child
		// is still alive after the budget. Fast commands resolve their
		// `process.exit` synchronously after spawn and the finalize()
		// callback runs before this Promise.race resolves, so the tool
		// sees the terminal state without spurious RUNNING.
		return this.awaitOrSnapshot(job, waitBudgetMs, maxResponseOutputChars)
	}

	private async awaitOrSnapshot(
		job: CommandJob,
		waitBudgetMs: number,
		maxResponseOutputChars: number,
	): Promise<StartCommandJobResult> {
		const remaining = Math.max(0, waitBudgetMs - (Date.now() - job.startedAtMs))
		if (remaining > 0 && job.state === "running") {
			// Wait for terminal transition or budget — whichever first.
			await Promise.race([
				this.exitTransitions.get(job.id) ?? Promise.resolve(),
				new Promise<void>((resolve) => {
					const t = setTimeout(resolve, remaining)
					t.unref()
				}),
			])
		}
		return this.makeStartResult(job, maxResponseOutputChars)
	}

	private makeStartResult(job: CommandJob, maxResponseOutputChars: number): StartCommandJobResult {
		const snap = snapshot(job)
		const truncatedStdout =
			snap.stdout.length > maxResponseOutputChars ? snap.stdout.slice(0, maxResponseOutputChars) : snap.stdout
		return {
			jobId: job.id,
			state: job.state,
			elapsedMs: snap.elapsedMs,
			deadlineRemainingMs: snap.deadlineRemainingMs,
			stdout: truncatedStdout,
			outputTruncated: snap.stdout.length > maxResponseOutputChars || snap.outputTruncated,
			process: job.process,
			...(snap.exitCode !== undefined ? { exitCode: snap.exitCode } : {}),
			...(snap.signal !== undefined ? { signal: snap.signal } : {}),
		}
	}

	private async terminate(job: CommandJob, reason: "deadline" | "cancel"): Promise<void> {
		if (job.finalized || job.state !== "running") return
		if (reason === "cancel") {
			job.cancelRequested = true
		}
		// Step 1: SIGTERM (best-effort; on Windows we fall through).
		try {
			if (job.process.pid && process.platform !== "win32") {
				process.kill(-job.process.pid, "SIGTERM")
			}
		} catch {
			// Process may have exited; we'll fall through.
		}
		// Step 2: grace → SIGKILL via the supervisable primitive's
		// killTree (which already targets the whole group / uses
		// taskkill on Windows).
		await new Promise<void>((done) => setTimeout(done, TERM_GRACE_MS).unref())
		job.killIssued = true
		await job.process.killTree()
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
		// Move from active → terminal (bounded LRU).
		this.active.delete(job.id)
		this.terminal.set(job.id, job)
		this.terminalOrder.push(job.id)
		while (this.terminalOrder.length > MAX_TERMINAL_JOBS) {
			const evictId = this.terminalOrder.shift()
			if (evictId) {
				this.terminal.delete(evictId)
				this.exitTransitions.delete(evictId)
			}
		}
		// Resolve any pending status waiters.
		const snap = snapshot(job)
		for (const waiter of job.waiters) waiter(snap)
		job.waiters.length = 0
	}

	/**
	 * Observe a job's state. If still running, blocks up to `waitMs`
	 * (clamped to MAX_STATUS_WAIT_MS) for the first terminal transition.
	 *
	 * Returns a structured error for unknown jobs (NOT a thrown exception
	 * — the caller needs a deterministic shape to surface to the model).
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
			return { ok: true, snapshot: snapshot(job) }
		}

		if (waitMs === 0) {
			return { ok: true, snapshot: snapshot(job) }
		}

		// Wait up to waitMs for terminal state.
		const snap = await Promise.race<CommandJobSnapshot>([
			new Promise<CommandJobSnapshot>((resolve) => {
				job.waiters.push(resolve)
			}),
			new Promise<CommandJobSnapshot>((resolve) => {
				const t = setTimeout(() => {
					resolve(snapshot(job))
				}, waitMs)
				t.unref()
			}),
		])
		return { ok: true, snapshot: snap }
	}

	/**
	 * Cancel a running job. Idempotent: re-cancelling a terminal or
	 * already-cancelled job is a no-op.
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
		return { ok: true, state: job.state === "running" ? "cancelled" : job.state }
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
	}
}
