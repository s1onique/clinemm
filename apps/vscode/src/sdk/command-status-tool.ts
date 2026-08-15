/**
 * `command_status` — host-owned follow-up API for supervised commands.
 *
 * One tool, three operations:
 *   - observe a job's current state (`waitMs` ≤ MAX_STATUS_WAIT_MS)
 *   - cancel a running job (`cancel: true`)
 *   - both (cancel, then return the post-cancel state)
 *
 * Status is read-only/auto-approved by the existing tool-policy machinery;
 * cancellation is mutating and must follow the host authority for command
 * execution (ALLOW/ASK/DENY preserved by the run_commands policy that
 * already governs this surface).
 */
import { type AgentTool, createTool } from "@cline/shared"
import { CommandJobManager, MAX_STATUS_WAIT_MS } from "./command-job-manager"

export interface CommandStatusInput {
	jobId: string
	waitMs?: number
	cancel?: boolean
}

export interface CommandStatusOutput {
	ok: boolean
	jobId?: string
	state?: string
	elapsedMs?: number
	deadlineRemainingMs?: number
	stdout?: string
	stderr?: string
	outputTruncated?: boolean
	exitCode?: number
	signal?: string
	error?: string
}

/**
 * Read the typed fields off a `command_status` input that arrives
 * shape-validated by the runtime's JSON-Schema check. Every field
 * here is declared `required: ["jobId"]` so a missing jobId is
 * rejected before this helper runs.
 */
function readStatusInput(input: unknown): CommandStatusInput {
	if (input === null || typeof input !== "object") {
		throw new Error("command_status input must be an object")
	}
	const record = input as Record<string, unknown>
	const jobId = record.jobId
	if (typeof jobId !== "string" || jobId.length === 0) {
		throw new Error("command_status input.jobId must be a non-empty string")
	}
	const waitMs = record.waitMs
	if (waitMs !== undefined && (typeof waitMs !== "number" || !Number.isFinite(waitMs))) {
		throw new Error("command_status input.waitMs must be a finite number when provided")
	}
	const cancel = record.cancel
	if (cancel !== undefined && typeof cancel !== "boolean") {
		throw new Error("command_status input.cancel must be a boolean when provided")
	}
	return {
		jobId,
		waitMs: typeof waitMs === "number" ? waitMs : undefined,
		cancel: typeof cancel === "boolean" ? cancel : undefined,
	}
}

export function createCommandStatusTool(manager: CommandJobManager): AgentTool {
	return createTool({
		name: "command_status",
		description:
			"Inspect or cancel a long-running shell command previously launched via run_commands. " +
			"Pass the jobId returned by run_commands. Optional waitMs (clamped to " +
			MAX_STATUS_WAIT_MS +
			"ms) blocks until the job reaches a terminal state or the budget elapses; " +
			"the call returns whatever state is observed. Pass cancel:true to terminate " +
			"the owned process tree (SIGTERM, then SIGKILL after a 5s grace). " +
			"Terminal jobs remain queryable for the host session lifetime; jobs are evicted " +
			"from the bounded retention once the limit is reached.",
		inputSchema: {
			type: "object",
			properties: {
				jobId: { type: "string", description: "Job identifier returned by run_commands." },
				waitMs: {
					type: "number",
					description:
						"How long to wait for a state transition. Clamped to [0, " +
						MAX_STATUS_WAIT_MS +
						"]. 0 means return current state immediately.",
				},
				cancel: {
					type: "boolean",
					description: "Terminate the owned process tree and finalize the job as cancelled.",
				},
			},
			required: ["jobId"],
		},
		timeoutMs: MAX_STATUS_WAIT_MS + 5_000,
		retryable: false,
		maxRetries: 0,
		execute: async (input: unknown) => {
			let typed: CommandStatusInput
			try {
				typed = readStatusInput(input)
			} catch (error) {
				return [{ ok: false, error: error instanceof Error ? error.message : String(error) }]
			}
			const jobId = typed.jobId
			const waitMs = Math.max(0, Math.min(typed.waitMs ?? 0, MAX_STATUS_WAIT_MS))

			// Cancel first if requested. The cancel is idempotent.
			if (typed.cancel) {
				const result = await manager.cancel({ jobId })
				if (!result.ok) {
					return [{ ok: false, error: `unknown_job: ${jobId}` }]
				}
			}

			// Then observe (post-cancel if applicable).
			const status = await manager.status({ jobId, waitMs })
			if (!status.ok) {
				return [{ ok: false, error: `unknown_job: ${jobId}` }]
			}

			const snap = status.snapshot
			return [
				{
					ok: true,
					jobId: snap.id,
					state: snap.state,
					elapsedMs: snap.elapsedMs,
					deadlineRemainingMs: snap.deadlineRemainingMs,
					stdout: snap.stdout,
					stderr: snap.stderr,
					outputTruncated: snap.outputTruncated,
					...(snap.exitCode !== undefined ? { exitCode: snap.exitCode } : {}),
					...(snap.signal !== undefined ? { signal: snap.signal } : {}),
				},
			]
		},
	})
}
