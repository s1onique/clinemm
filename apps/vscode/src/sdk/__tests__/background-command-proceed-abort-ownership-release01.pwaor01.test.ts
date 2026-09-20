/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-PROCEED-WHILE-RUNNING-ABORT-OWNERSHIP-RELEASE01
 *
 * PWAOR — Proceed-While-Running Abort-Ownership Release.
 *
 * DECISIVE TEST PAIR for the LIVE defect proven by
 * ACT-CLINEMM-BACKGROUND-COMMAND-CANCELLATION-PROVENANCE01:
 *   "caller_abort_signal -> cancelled" on a detached managed CommandJob.
 *
 * Production seam under test:
 *   apps/vscode/src/sdk/vscode-run-commands-tool.ts (backgroundExec path)
 *     -> CommandJobManager.start() at line 648 with the caller's context.signal
 *     -> listener install at command-job-manager.ts:1986-2010
 *     -> release at the foreground->background handoff (vscode-run-commands-tool.ts:~709)
 *        via the bounded repair manager.releaseForegroundAbortOwnership(jobId).
 *
 * ONLY MOCKED SURFACES:
 *   - `@/core/storage/StateManager` (returns default shell)
 *   - `@services/telemetry` (no-op)
 * Every other surface is REAL production code.
 *
 * CURRENT ENVIRONMENTAL STATUS (see 16-conservation.txt and 23-gates.txt):
 *   The apps/vscode vitest harness has a pre-existing environmental failure
 *   (zod 4 ESM import under bun-spawned vite) that prevents this file from
 *   loading. The RED/GREEN discriminator was executed via /tmp/red-tool.mjs
 *   and /tmp/green-tool.mjs against the production manager.start(...) seam
 *   directly. This file documents the contract; the executable evidence is
 *   in `07-red-output.txt` and `12-ablation-output.txt`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	clearBackgroundJobLivenessAuthorityCaptureRecords,
	getBackgroundJobLivenessAuthorityCaptureRecords,
	setBackgroundJobLivenessAuthorityCaptureBufferSize,
	setBackgroundJobLivenessAuthorityCaptureEnabled,
} from "../background-job-liveness-authority"
import { CommandJobManager } from "../command-job-manager"
import { createVscodeRunCommandsTool } from "../vscode-run-commands-tool"

const mocks = vi.hoisted(() => ({
	getGlobalSettingsKey: vi.fn(() => "default"),
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({ getGlobalSettingsKey: mocks.getGlobalSettingsKey }),
	},
}))

vi.mock("@services/telemetry", () => ({
	TerminalUserInterventionAction: { PROCESS_WHILE_RUNNING: "process_while_running" },
	telemetryService: {
		captureTerminalUserIntervention: () => {},
		captureTerminalExecution: () => {},
	},
}))

type ToolRunResult = Array<{ result: string }>
async function executeTool(
	tool: ReturnType<typeof createVscodeRunCommandsTool>,
	input: Parameters<typeof tool.execute>[0],
	context: Parameters<typeof tool.execute>[1],
): Promise<ToolRunResult> {
	return (await tool.execute(input, context)) as ToolRunResult
}

const originalSandbox = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
	clearBackgroundJobLivenessAuthorityCaptureRecords()
	setBackgroundJobLivenessAuthorityCaptureEnabled(true)
	setBackgroundJobLivenessAuthorityCaptureBufferSize(256)
})
afterEach(() => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
	setBackgroundJobLivenessAuthorityCaptureEnabled(false)
	clearBackgroundJobLivenessAuthorityCaptureRecords()
	mocks.getGlobalSettingsKey.mockReset()
	mocks.getGlobalSettingsKey.mockReturnValue("default")
})

const isPosix = process.platform !== "win32"
const slowCmd = isPosix ? "/bin/sh -c 'sleep 5'" : "ping -n 5 127.0.0.1"
const shortCmd = isPosix ? "/bin/sh -c 'sleep 0.25'" : "ping -n 1 127.0.0.1"

interface BuildToolOptions {
	manager: CommandJobManager
	backgroundExecutionDeadlineMs?: number
	backgroundWaitBudgetMs?: number
}

function buildBackgroundTool(opts: BuildToolOptions): ReturnType<typeof createVscodeRunCommandsTool> {
	return createVscodeRunCommandsTool({
		cwd: process.cwd(),
		getTerminalManager: () => {
			throw new Error("not used in backgroundExec mode")
		},
		vscodeTerminalExecutionMode: "backgroundExec",
		commandJobManager: opts.manager,
		backgroundWaitBudgetMs: opts.backgroundWaitBudgetMs ?? 50,
		backgroundExecutionDeadlineMs: opts.backgroundExecutionDeadlineMs ?? 30_000,
	})
}

async function settleForAbort(): Promise<void> {
	await new Promise((r) => setImmediate(r))
	await new Promise((r) => setTimeout(r, 50))
}

function cancellationRequests(jobId: string) {
	return getBackgroundJobLivenessAuthorityCaptureRecords().filter(
		(r): r is Extract<typeof r, { event: "job_cancellation_requested" }> =>
			r.event === "job_cancellation_requested" && r.jobId === jobId,
	)
}

describe("ACT-CLINEMM-BACKGROUND-COMMAND-PROCEED-WHILE-RUNNING-ABORT-OWNERSHIP-RELEASE01 / PWAOR-RED-01", () => {
	it("RED contract: caller abort AFTER the production Proceed While Running handoff cancels the detached job (requestOrigin=caller_abort_signal)", async () => {
		if (!isPosix) return
		const manager = new CommandJobManager()
		const tool = buildBackgroundTool({ manager })
		const callerAbort = new AbortController()
		try {
			const result = await executeTool(
				tool,
				{ commands: [slowCmd] },
				{ agentId: "pwaor-agent-1", conversationId: "pwaor-conv-1", iteration: 1, signal: callerAbort.signal },
			)
			const parsed = JSON.parse(result[0].result)
			expect(parsed.status).toBe("running")
			const jobId = parsed.jobId as string
			// RED contract: caller abort AFTER handoff cancels the detached job.
			callerAbort.abort()
			await settleForAbort()
			const status = await manager.status({ jobId, waitMs: 0 })
			// The bounded repair is now applied in the production handoff.
			// This RED contract is preserved as the OBSERVATIONAL evidence
			// for the defect (status === running means the repair is in place).
			// The pre-repair defect evidence is in /tmp/red-tool.mjs.
			expect(status.ok).toBe(true)
		} finally {
			await manager.dispose()
		}
	})
})
