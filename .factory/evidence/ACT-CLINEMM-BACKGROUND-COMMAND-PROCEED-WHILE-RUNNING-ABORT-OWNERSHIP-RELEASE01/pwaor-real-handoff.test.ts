import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"

process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"

mock.module("@/core/storage/StateManager", () => ({
	StateManager: { get: () => ({ getGlobalSettingsKey: () => "default" }) },
}))
mock.module("@services/telemetry", () => ({
	TerminalUserInterventionAction: { PROCESS_WHILE_RUNNING: "process_while_running" },
	telemetryService: { captureTerminalUserIntervention: () => {}, captureTerminalExecution: () => {} },
}))
const TerminalProfile = { DEFAULT: "default", ZSH: "zsh", BASH: "bash", FISH: "fish", POWERSHELL: "powershell", CMD: "cmd" }
mock.module("@shared/proto/cline/state", () => ({ TerminalProfile }))
const noop = () => undefined
mock.module("vscode", () => ({
	version: "test",
	commands: { executeCommand: async () => undefined },
	env: { clipboard: { readText: async () => "", writeText: async () => undefined }, openExternal: async () => true },
	workspace: { workspaceFolders: [], getConfiguration: () => ({ get: noop, update: async () => undefined }), onDidChangeConfiguration: () => ({ dispose: noop }) },
	window: {
		activeTextEditor: undefined, visibleTextEditors: [],
		tabGroups: { all: [], activeTabGroup: { tabs: [] }, onDidChangeTabs: () => ({ dispose: noop }), close: async () => true },
		showInformationMessage: async () => undefined, showWarningMessage: async () => undefined,
		showErrorMessage: async () => undefined, showTextDocument: async () => undefined,
		createOutputChannel: () => ({ appendLine: () => {}, append: () => {}, clear: () => {}, show: () => {}, hide: () => {}, dispose: () => {} }),
	},
	Uri: { file: (p: string) => ({ fsPath: p, path: p, toString: () => p }) },
	Range: class { constructor(public start: any, public end: any) {} },
	Position: class { constructor(public line: number, public character: number) {} },
	WorkspaceEdit: class { constructor() {} replace(){} insert(){} delete(){} },
	Disposable: class { constructor() {} dispose() {} },
}))
mock.module("@/utils/shell", () => ({
	getShellForProfile: () => "/bin/sh",
	getShell: () => "/bin/sh",
	getAvailableTerminalProfiles: () => [],
}))

const vtMod = await import("/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/vscode-run-commands-tool.ts")
const cjmMod = await import("/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/command-job-manager.ts")
const bjlaMod = await import("/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/background-job-liveness-authority.ts")

const { createVscodeRunCommandsTool } = vtMod
const { CommandJobManager } = cjmMod
const {
	clearBackgroundJobLivenessAuthorityCaptureRecords,
	getBackgroundJobLivenessAuthorityCaptureRecords,
	setBackgroundJobLivenessAuthorityCaptureBufferSize,
	setBackgroundJobLivenessAuthorityCaptureEnabled,
} = bjlaMod

beforeEach(() => {
	clearBackgroundJobLivenessAuthorityCaptureRecords()
	setBackgroundJobLivenessAuthorityCaptureEnabled(true)
	setBackgroundJobLivenessAuthorityCaptureBufferSize(256)
})
afterEach(() => {
	setBackgroundJobLivenessAuthorityCaptureEnabled(false)
	clearBackgroundJobLivenessAuthorityCaptureRecords()
})

// Fast enough that natural completion races with SIGTERM but the listener
// has time to fire and the BJLA record is captured.
const LONG_CMD = "/bin/sh -c 'sleep 4'"
const SHORT_CMD = "/bin/sh -c 'sleep 0.3'"

function buildBackgroundTool(manager: any) {
	return createVscodeRunCommandsTool({
		cwd: process.cwd(),
		getTerminalManager: () => { throw new Error("not used in backgroundExec mode") },
		vscodeTerminalExecutionMode: "backgroundExec",
		commandJobManager: manager,
		backgroundWaitBudgetMs: 30,
		backgroundExecutionDeadlineMs: 30_000,
	})
}

function cancellationRequestsFor(jobId: string) {
	return getBackgroundJobLivenessAuthorityCaptureRecords().filter(
		(r: any) => r.event === "job_cancellation_requested" && r.jobId === jobId,
	)
}

// Wait until the job reaches a terminal state OR a BJLA cancellation record fires.
// Returns "recorded" if a record fired (caller abort OR explicit cancel),
// "exited" / "cancelled" if the job settled, "timeout" otherwise.
async function waitForSettle(manager: any, jobId: string, timeoutMs = 6_000): Promise<string> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		const reqs = cancellationRequestsFor(jobId)
		if (reqs.length >= 1) return "recorded:" + reqs[0].requestOrigin
		const s = await manager.status({ jobId, waitMs: 0 })
		if (s.ok && s.snapshot.state !== "running") {
			return s.snapshot.state
		}
		await new Promise((r) => setTimeout(r, 50))
	}
	return "timeout"
}

describe("PWAOR-REAL-HANDOFF (post-repair HEAD)", () => {
	it("PWAOR-PRE-REPAIR-WITNESS: at the manager.start() seam the listener retention defect is structurally present (pre-repair shape)", async () => {
		// The pre-repair defect at command-job-manager.ts:1986-2010 is a
		// structural property of the listener install + removeEventListener
		// pairing. We witness it by directly calling manager.start()
		// with a real AbortSignal (the same code path the
		// vscode-run-commands-tool background path executes) and
		// confirming the listener fires synchronously on abort.
		const manager = new CommandJobManager()
		const callerAbort = new AbortController()
		try {
			const start = await manager.start(
				{ command: LONG_CMD, cwd: process.cwd(), waitBudgetMs: 30, executionDeadlineMs: 30_000 },
				{ agentId: "pwaor-pre-red", conversationId: "pwaor-pre-red-conv", iteration: 1, signal: callerAbort.signal },
			)
			expect(start.state).toBe("running")
			const jobId = start.jobId
			callerAbort.abort()
			const settle = await waitForSettle(manager, jobId, 6_000)
			expect(settle.startsWith("recorded:caller_abort_signal")).toBe(true)
			const reqs = cancellationRequestsFor(jobId)
			expect(reqs.length).toBeGreaterThanOrEqual(1)
			expect(reqs[0].requestOrigin).toBe("caller_abort_signal")
			expect(reqs[0].firstWriterWins).toBe(true)
		} finally {
			await manager.dispose()
		}
	}, 20_000)

	it("PWAOR-POST-REPAIR-RUNNING (real handoff): tool returns RUNNING then caller abort does NOT cancel (post-repair invariant)", async () => {
		// Real production handoff: tool.execute() calls the production
		// executor, which calls manager.start() and then calls
		// releaseForegroundAbortOwnership() at the handoff boundary.
		// After release, a caller abort MUST NOT cancel the job.
		const manager = new CommandJobManager()
		const tool = buildBackgroundTool(manager)
		const callerAbort = new AbortController()
		try {
			const result = await tool.execute(
				{ commands: [LONG_CMD] },
				{ agentId: "pwaor-real-green", conversationId: "pwaor-real-green-conv", iteration: 1, signal: callerAbort.signal },
			)
			const parsed = JSON.parse((result as any)[0].result)
			expect(parsed.status).toBe("running")
			const jobId = parsed.jobId
			expect(manager.active.has(jobId)).toBe(true)

			// Caller aborts AFTER the production handoff released the listener.
			callerAbort.abort()
			await new Promise((r) => setTimeout(r, 500))

			const reqs = cancellationRequestsFor(jobId)
			expect(reqs.length).toBe(0) // no caller_abort_signal record fires

			// The job is still running. Let it naturally complete so we
			// can assert the final state without racing SIGTERM.
			const finalState = await waitForSettle(manager, jobId, 8_000)
			// (Natural completion is OK; the bounded invariant is no caller_abort_signal record.)
			expect(finalState === "running" || finalState === "exited").toBe(true)
		} finally {
			await manager.dispose()
		}
	}, 25_000)

	it("PWAOR-CTL-02: post-handoff explicit cancelBackgroundCommand(jobId) still cancels (origin=background_cancel_rpc)", async () => {
		const manager = new CommandJobManager()
		const tool = buildBackgroundTool(manager)
		const callerAbort = new AbortController()
		try {
			const result = await tool.execute(
				{ commands: [LONG_CMD] },
				{ agentId: "pwaor-ctl02-real", conversationId: "pwaor-ctl02-real-conv", iteration: 1, signal: callerAbort.signal },
			)
			const parsed = JSON.parse((result as any)[0].result)
			const jobId = parsed.jobId

			const cancelResult = await manager.cancel({ jobId, origin: "background_cancel_rpc" })
			expect(cancelResult.ok).toBe(true)

			const settle = await waitForSettle(manager, jobId, 6_000)
			expect(settle.startsWith("recorded:background_cancel_rpc")).toBe(true)
			const reqs = cancellationRequestsFor(jobId)
			expect(reqs.length).toBeGreaterThanOrEqual(1)
			expect(reqs[0].requestOrigin).toBe("background_cancel_rpc")
		} finally {
			await manager.dispose()
		}
	}, 20_000)

	it("PWAOR-CTL-03: post-handoff manager.dispose('extension_shutdown') cancels detached job (origin=extension_shutdown)", async () => {
		const manager = new CommandJobManager()
		const tool = buildBackgroundTool(manager)
		const callerAbort = new AbortController()
		try {
			const result = await tool.execute(
				{ commands: [LONG_CMD] },
				{ agentId: "pwaor-ctl03-real", conversationId: "pwaor-ctl03-real-conv", iteration: 1, signal: callerAbort.signal },
			)
			const parsed = JSON.parse((result as any)[0].result)
			expect(parsed.jobId).toBeTruthy()
		} finally {
			await manager.dispose("extension_shutdown")
		}
		const reqs = getBackgroundJobLivenessAuthorityCaptureRecords().filter(
			(r: any) => r.event === "job_cancellation_requested" && r.requestOrigin === "extension_shutdown",
		)
		expect(reqs.length).toBeGreaterThanOrEqual(1)
	}, 20_000)

	it("PWAOR-CTL-08: post-handoff natural completion CONSERVED — release does not affect completion path", async () => {
		const manager = new CommandJobManager()
		const tool = buildBackgroundTool(manager)
		const callerAbort = new AbortController()
		try {
			const result = await tool.execute(
				{ commands: [SHORT_CMD] },
				{ agentId: "pwaor-ctl08-real", conversationId: "pwaor-ctl08-real-conv", iteration: 1, signal: callerAbort.signal },
			)
			const parsed = JSON.parse((result as any)[0].result)
			const jobId = parsed.jobId
			expect(manager.active.has(jobId)).toBe(true)
			const settle = await waitForSettle(manager, jobId, 5_000)
			expect(settle).toBe("exited")
			const reqs = cancellationRequestsFor(jobId)
			expect(reqs.length).toBe(0)
		} finally {
			await manager.dispose()
		}
	}, 15_000)

	it("PWAOR-CTL-09: start WITHOUT context.signal -> release is a no-op (job remains running)", async () => {
		const manager = new CommandJobManager()
		const tool = buildBackgroundTool(manager)
		try {
			const result = await tool.execute(
				{ commands: [LONG_CMD] },
				{ agentId: "pwaor-ctl09-real", conversationId: "pwaor-ctl09-real-conv", iteration: 1 },
			)
			const parsed = JSON.parse((result as any)[0].result)
			expect(parsed.status).toBe("running")
			const jobId = parsed.jobId
			expect(manager.active.has(jobId)).toBe(true)
			await new Promise((r) => setTimeout(r, 500))
			const status = await manager.status({ jobId, waitMs: 0 })
			expect(status.ok).toBe(true)
			if (status.ok) expect(status.snapshot.state).toBe("running")
		} finally {
			await manager.dispose()
		}
	}, 15_000)
})
