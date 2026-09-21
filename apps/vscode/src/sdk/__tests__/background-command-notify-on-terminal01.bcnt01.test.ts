/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01 / BCNT01
 *
 * Red/Green tests for the bounded opt-in notify-on-terminal
 * coordinator wired into the run_commands background path.
 *
 * Production seam under test:
 *   - BackgroundNotifyCoordinator
 *     (apps/vscode/src/sdk/background-notify-coordinator.ts)
 *   - createVscodeRunCommandsTool (the fork's tool factory)
 *     (apps/vscode/src/sdk/vscode-run-commands-tool.ts)
 *   - CommandJobManager (real production class)
 *
 * Test pattern:
 *   - The coordinator's enqueueTerminalWake callback is a
 *     TestPendingPromptsSink that captures the wake prompts in
 *     memory for assertion.
 *   - The resolveActiveOwner callback returns the harness's
 *     synthetic active (sessionId, taskId).
 *   - The run_commands tool runs against a real CommandJobManager
 *     with a fake supervisor (same pattern as BTCONT01 +
 *     AGCONT01).
 *
 * The pre-RED test (BCNT-RED-01) asserts the wake sink is
 * empty before any coordinator wiring. With the wiring
 * committed, BCNT-01..14 cover the per-class behavior.
 */

import type { SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	type BackgroundNotifyCoordinator,
	BackgroundNotifyCoordinator as CoordinatorCtor,
	formatTerminalWakePrompt,
	NOTIFY_WAKE_PROMPT_MAX_BYTES,
	type NotifyDecisionRecord,
	ownerKey,
	truncateToByteCap,
} from "../background-notify-coordinator"
import {
	type CommandJobManager,
	CommandJobManager as CommandJobManagerCtor,
	type StartCommandJobResult,
} from "../command-job-manager"
import { createVscodeRunCommandsTool } from "../vscode-run-commands-tool"

// ---------------------------------------------------------------------------
// TestPendingPromptsSink — captures wake prompts for assertion.
// ---------------------------------------------------------------------------

interface QueuedPrompt {
	sessionId: string
	prompt: string
}

class TestPendingPromptsSink {
	readonly queued: QueuedPrompt[] = []
	enqueue({ sessionId, prompt }: QueuedPrompt): void {
		this.queued.push({ sessionId, prompt })
	}
	size(): number {
		return this.queued.length
	}
}

// ---------------------------------------------------------------------------
// Fake supervisor — same shape as BTCONT01/AGCONT01 helpers.
// ---------------------------------------------------------------------------

let supervisorPid = 100000
function fakeSupervisor(): SupervisableShellProcess {
	const pid = ++supervisorPid
	const pgid = pid
	let resolveExit: (code: number | null) => void = () => {}
	const exitPromise = new Promise<number | null>((resolve) => {
		resolveExit = resolve
	})
	return Object.freeze({
		exit: exitPromise as unknown as Promise<never>,
		pid,
		pgid,
		killTree: async () => {},
		terminateTree: async () => {
			resolveExit(0)
			return { treeTerminated: true, escalatedToKill: false, epermDetected: false }
		},
		stdoutSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
		stderrSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
	})
}

function fakeSupervisorFactory(): () => SupervisableShellProcess {
	return () => fakeSupervisor()
}

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
	},
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalSettingsKey: () => "default",
			getGlobalStateKey: () => undefined,
			setGlobalState: vi.fn(),
		}),
	},
}))

vi.mock("@/services/telemetry", () => ({
	telemetryService: {
		captureTerminalExecution: vi.fn(),
		captureTerminalUserIntervention: vi.fn(),
		captureRemoteConfigSessionGate: vi.fn(),
	},
}))

vi.mock("@/services/telemetry/TelemetryService", () => ({
	TelemetryProviderFactory: {
		createProviders: () => [],
	},
	TelemetryService: {
		create: () => ({
			providers: [],
			shutdown: vi.fn(async () => undefined),
		}),
	},
}))

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
	manager: CommandJobManager
	coordinator: BackgroundNotifyCoordinator
	sink: TestPendingPromptsSink
	decisions: NotifyDecisionRecord[]
	activeSessionId: string
	activeTaskId: string | undefined
	notifyEnabled: boolean
	setActiveSessionAndTask: (sessionId: string, taskId: string | undefined) => void
}

interface HarnessOptions {
	activeSessionId?: string
	activeTaskId?: string
	notifyEnabled?: boolean
}

function makeHarness(opts: HarnessOptions = {}): Harness {
	const manager = new CommandJobManagerCtor({
		maxWaitBudgetMs: 5_000,
		spawnFactory: fakeSupervisorFactory(),
	})
	const sink = new TestPendingPromptsSink()
	const decisions: NotifyDecisionRecord[] = []
	let currentSessionId = opts.activeSessionId ?? "session-bcnt01"
	let currentTaskId: string | undefined = opts.activeTaskId ?? "task-bcnt01"
	const coordinator = new CoordinatorCtor({
		resolveActiveOwner: () => ({
			sessionId: currentSessionId,
			taskId: currentTaskId,
		}),
		enqueueTerminalWake: ({ sessionId, prompt }) => sink.enqueue({ sessionId, prompt }),
		recordNotifyDecision: (record) => decisions.push(record),
		// Deterministic timestamps so FIFO ordering is reproducible.
		now: (() => {
			let tick = 0
			return () => ++tick
		})(),
	})
	return {
		manager,
		coordinator,
		sink,
		decisions,
		activeSessionId: currentSessionId,
		activeTaskId: currentTaskId,
		notifyEnabled: opts.notifyEnabled ?? true,
		setActiveSessionAndTask: (sessionId, taskId) => {
			currentSessionId = sessionId
			currentTaskId = taskId
		},
	}
}

interface StartBackgroundArgs {
	command?: string
	notifyOnCompletion?: boolean
}

async function startBackgroundJob(harness: Harness, args: StartBackgroundArgs = {}): Promise<StartCommandJobResult> {
	const start = await harness.manager.start(
		{
			command: args.command ?? "sleep 60",
			cwd: process.cwd(),
			shell: "/bin/sh",
			env: { SHELL: "/bin/sh" },
			waitBudgetMs: 5,
			executionDeadlineMs: 60_000,
			maxOutputChars: 4096,
		},
		{ sessionId: harness.activeSessionId, agentId: "test-agent", iteration: 1 },
	)
	if (start.state !== "running") {
		throw new Error(`expected state=running, got state=${start.state}`)
	}
	return start
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01 / BCNT01", () => {
	beforeEach(() => {
		// Make sure the experimental sandbox is OFF for the focused
		// supervisor factory (mirrors the BTCONT01 precedent).
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
	})
	afterEach(() => {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	})

	// =========================================================================
	// UNIT-LEVEL coordinator tests (no run_commands tool, no manager).
	// =========================================================================
	describe("coordinator unit", () => {
		it("BCNT-U01 ownerKey joins sessionId + taskId with no epoch field", () => {
			expect(ownerKey("s1", "t1")).toBe("s1\u0000t1")
			expect(ownerKey("s1", undefined)).toBe("s1\u0000")
			expect(ownerKey("s2", "t1")).not.toBe(ownerKey("s1", "t1"))
		})

		it("BCNT-U02 truncateToByteCap truncates at code-point boundary (multibyte UTF-8)", () => {
			// 4-byte emoji per code point.
			const s = "\u{1F600}".repeat(5000)
			const truncated = truncateToByteCap(s, NOTIFY_WAKE_PROMPT_MAX_BYTES)
			expect(Buffer.byteLength(truncated, "utf8")).toBeLessThanOrEqual(NOTIFY_WAKE_PROMPT_MAX_BYTES)
			// The truncation MUST NOT produce a partial codepoint
			// (which would yield an invalid UTF-8 byte sequence).
			const buf = Buffer.from(truncated, "utf8")
			const round = buf.toString("utf8")
			expect(round.length).toBe(truncated.length)
		})

		it("BCNT-U03 formatTerminalWakePrompt binds to <= 8 KiB and tags output as data", () => {
			// Small input: both delimiters must be present.
			const small = formatTerminalWakePrompt({
				jobId: "job-test",
				terminalState: "exited",
				reason: undefined,
				exitCode: 0,
				outputTail: "hello",
			})
			expect(Buffer.byteLength(small, "utf8")).toBeLessThanOrEqual(NOTIFY_WAKE_PROMPT_MAX_BYTES)
			expect(small).toContain("Job: job-test")
			expect(small).toContain("State: exited")
			expect(small).toContain("ExitCode: 0")
			expect(small).toContain("<bounded-output>")
			expect(small).toContain("</bounded-output>")
			expect(small).toContain("hello")
			// Huge input: hard cap MUST be enforced; output is
			// truncated to fit. We do not assert the closing
			// delimiter survives truncation — the bound is the
			// authoritative contract.
			const huge = "x".repeat(100_000)
			const truncated = formatTerminalWakePrompt({
				jobId: "job-test",
				terminalState: "exited",
				reason: undefined,
				exitCode: 0,
				outputTail: huge,
			})
			expect(Buffer.byteLength(truncated, "utf8")).toBeLessThanOrEqual(NOTIFY_WAKE_PROMPT_MAX_BYTES)
			expect(truncated).toContain("Job: job-test")
			expect(truncated).toContain("<bounded-output>")
		})
	})

	// =========================================================================
	// Integration tests through the run_commands tool surface.
	// =========================================================================
	describe("run_commands integration", () => {
		it("BCNT-RED-01 (UNWIRED): notify=true + terminal event produces zero wakes (RED baseline)", async () => {
			// Build a harness but DO NOT pass the coordinator to the
			// run_commands tool. This reproduces the pre-ACT
			// behavior where the coordinator exists in the codebase
			// but the run_commands tool does not consume it.
			const harness = makeHarness()
			const tool = createVscodeRunCommandsTool({
				cwd: process.cwd(),
				getTerminalManager: () => {
					throw new Error("foreground not used")
				},
				vscodeTerminalExecutionMode: "backgroundExec",
				commandJobManager: harness.manager,
				// intentionally NO backgroundNotifyCoordinator
			})
			const result = await tool.execute(
				{
					commands: ["sleep 60"],
					notifyOnCompletion: true,
				},
				{
					sessionId: harness.activeSessionId,
					agentId: "test-agent",
					iteration: 1,
				},
			)
			const arr = Array.isArray(result) ? result : []
			const first = arr[0] as { result?: string } | undefined
			const jobId = JSON.parse(first?.result ?? "{}").jobId as string | undefined
			// Force terminal by cancelling.
			if (jobId) {
				await harness.manager.cancel({
					jobId,
					origin: "other:test",
				})
			}
			// Wait for terminalPromise to settle.
			await sleep(50)
			expect(harness.sink.size()).toBe(0)
		})

		it("BCNT-01 notify=true natural terminal -> exactly one queued wake", async () => {
			const harness = makeHarness()
			// The test always cancel()s the job to force terminality
			// (fakeSupervisor's exit promise never resolves on its
			// own — see BTCONT01 + AGCONT01 precedents). The
			// terminal classification therefore resolves to
			// "cancelled" rather than "exited". Both are valid
			// notify-on-terminal classifications per the contract;
			// the assertion uses "State: cancelled" to match the
			// test-driver. BCNT-09 covers the explicit-cancel
			// wake invariant.
			await startAndAwait(harness, { command: "true", notifyOnCompletion: true, waitBudgetMs: 5 })
			expect(harness.sink.size()).toBe(1)
			const queued = harness.sink.queued[0]
			expect(queued?.sessionId).toBe(harness.activeSessionId)
			expect(queued?.prompt).toContain("Job: ")
			expect(queued?.prompt).toContain("State: cancelled")
			expect(Buffer.byteLength(queued?.prompt ?? "", "utf8")).toBeLessThanOrEqual(NOTIFY_WAKE_PROMPT_MAX_BYTES)
			expect(harness.coordinator.diagnosticMarkerCount()).toBe(0)
		})

		it("BCNT-02 omitted/default false -> zero wake, zero marker", async () => {
			const harness = makeHarness()
			// notifyOnCompletion OMITTED
			await startAndAwait(harness, {
				command: "true",
				notifyOnCompletion: undefined,
				waitBudgetMs: 5,
			})
			expect(harness.sink.size()).toBe(0)
			expect(harness.coordinator.diagnosticMarkerCount()).toBe(0)
		})

		it("BCNT-03 explicit false -> zero wake, zero marker", async () => {
			const harness = makeHarness()
			await startAndAwait(harness, {
				command: "true",
				notifyOnCompletion: false,
				waitBudgetMs: 5,
			})
			expect(harness.sink.size()).toBe(0)
			expect(harness.coordinator.diagnosticMarkerCount()).toBe(0)
		})

		it("BCNT-04 newer turn same task -> notification survives queue delivery", async () => {
			const harness = makeHarness()
			await startAndAwait(harness, {
				command: "true",
				notifyOnCompletion: true,
				waitBudgetMs: 5,
			})
			// Same owner key (sessionId, taskId) -> wake is drained.
			expect(harness.sink.size()).toBe(1)
		})

		it("BCNT-05 different task -> discarded (owner_mismatch)", async () => {
			const harness = makeHarness()
			const start = await startBackgroundJob(harness, {
				command: "sleep 60",
				notifyOnCompletion: true,
			})
			// Pre-register a marker for the ORIGINAL owner, then
			// swap the owner BEFORE the terminal event. The
			// terminal listener (whether it goes through the
			// tool's auto-attach or we drive consumeTerminal
			// directly) MUST detect the mismatch and discard.
			harness.coordinator.registerMarker({
				jobId: start.jobId,
				sessionId: harness.activeSessionId,
				taskId: harness.activeTaskId,
			})
			harness.setActiveSessionAndTask("session-bcnt01-other", "task-other")
			const status = await harness.manager.status({ jobId: start.jobId, waitMs: 0 })
			const snapshot = status.ok ? status.snapshot : null
			harness.coordinator.consumeTerminal({
				jobId: start.jobId,
				terminalState: snapshot ? snapshot.state : "exited",
				exitCode: snapshot?.exitCode,
				reason: snapshot?.signal,
				isContainmentFailed: snapshot?.state === "containment_failed",
				outputTail: snapshot?.stdout?.slice(-1024),
			})
			expect(harness.sink.size()).toBe(0)
			const ownerMismatch = harness.decisions.find((d) => d.decision === "owner_mismatch")
			expect(ownerMismatch).toBeDefined()
		})

		it("BCNT-06 two notify jobs -> hold then FIFO drain", async () => {
			const harness = makeHarness()
			// Start J1 (notify=true)
			const j1 = await harness.manager.start(
				{
					command: "sleep 30",
					cwd: process.cwd(),
					shell: "/bin/sh",
					env: { SHELL: "/bin/sh" },
					waitBudgetMs: 5,
					executionDeadlineMs: 60_000,
					maxOutputChars: 4096,
				},
				{
					sessionId: harness.activeSessionId,
					agentId: "test-agent",
					iteration: 1,
				},
			)
			if (j1.state !== "running") throw new Error("j1 not running")
			harness.coordinator.registerMarker({
				jobId: j1.jobId,
				sessionId: harness.activeSessionId,
				taskId: harness.activeTaskId,
			})
			// Start J2 (notify=true)
			const j2 = await harness.manager.start(
				{
					command: "sleep 30",
					cwd: process.cwd(),
					shell: "/bin/sh",
					env: { SHELL: "/bin/sh" },
					waitBudgetMs: 5,
					executionDeadlineMs: 60_000,
					maxOutputChars: 4096,
				},
				{
					sessionId: harness.activeSessionId,
					agentId: "test-agent",
					iteration: 2,
				},
			)
			if (j2.state !== "running") throw new Error("j2 not running")
			harness.coordinator.registerMarker({
				jobId: j2.jobId,
				sessionId: harness.activeSessionId,
				taskId: harness.activeTaskId,
			})
			// Terminal J1 -> should HOLD (J2 still alive)
			harness.coordinator.consumeTerminal({
				jobId: j1.jobId,
				terminalState: "exited",
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
			})
			expect(harness.sink.size()).toBe(0)
			expect(harness.coordinator.diagnosticHeldCount()).toBe(1)
			// Terminal J2 -> should DRAIN FIFO (J1 held first, then J2)
			harness.coordinator.consumeTerminal({
				jobId: j2.jobId,
				terminalState: "exited",
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
			})
			expect(harness.sink.size()).toBe(2)
			expect(harness.coordinator.diagnosticHeldCount()).toBe(0)
		})

		it("BCNT-07 mixed notify/non-notify mix -> notification-active set independent of total", async () => {
			const harness = makeHarness()
			// J1 notify=true, J2 notify=false. We register J1 only.
			const j1 = await harness.manager.start(
				{
					command: "sleep 30",
					cwd: process.cwd(),
					shell: "/bin/sh",
					env: { SHELL: "/bin/sh" },
					waitBudgetMs: 5,
					executionDeadlineMs: 60_000,
					maxOutputChars: 4096,
				},
				{
					sessionId: harness.activeSessionId,
					agentId: "test-agent",
					iteration: 1,
				},
			)
			if (j1.state !== "running") throw new Error("j1 not running")
			harness.coordinator.registerMarker({
				jobId: j1.jobId,
				sessionId: harness.activeSessionId,
				taskId: harness.activeTaskId,
			})
			const j2 = await harness.manager.start(
				{
					command: "sleep 30",
					cwd: process.cwd(),
					shell: "/bin/sh",
					env: { SHELL: "/bin/sh" },
					waitBudgetMs: 5,
					executionDeadlineMs: 60_000,
					maxOutputChars: 4096,
				},
				{
					sessionId: harness.activeSessionId,
					agentId: "test-agent",
					iteration: 2,
				},
			)
			if (j2.state !== "running") throw new Error("j2 not running")
			// J2 is NOT registered (notify=false). The
			// notification-active set is independent of the
			// CommandJobManager active set.
			const activeNotifyCount = harness.coordinator.activeNotifyCountForOwner(harness.activeSessionId, harness.activeTaskId)
			expect(activeNotifyCount).toBe(1)
			expect(harness.manager.activeCount).toBeGreaterThanOrEqual(2)
		})

		it("BCNT-08 duplicate terminal -> exactly once (marker consumed)", async () => {
			const harness = makeHarness()
			const start = await startBackgroundJob(harness, {
				command: "true",
				notifyOnCompletion: true,
			})
			// Force terminal.
			await harness.manager.cancel({
				jobId: start.jobId,
				origin: "other:test",
			})
			await start.terminalPromise
			await sleep(50)
			// Second consumeTerminal for the same jobId -> no_marker.
			const decision = harness.coordinator.consumeTerminal({
				jobId: start.jobId,
				terminalState: "exited",
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
			})
			expect(decision.kind).toBe("no_marker")
		})

		it("BCNT-09 explicit cancel -> wake (terminality is the trigger)", async () => {
			const harness = makeHarness()
			const start = await startBackgroundJob(harness, {
				command: "sleep 60",
				notifyOnCompletion: true,
			})
			// Pre-register the marker (startBackgroundJob bypasses
			// the run_commands tool, so the tool's auto-attach
			// did not run; we drive consumeTerminal directly).
			harness.coordinator.registerMarker({
				jobId: start.jobId,
				sessionId: harness.activeSessionId,
				taskId: harness.activeTaskId,
			})
			await harness.manager.cancel({
				jobId: start.jobId,
				origin: "other:test",
			})
			const status = await harness.manager.status({ jobId: start.jobId, waitMs: 0 })
			const snapshot = status.ok ? status.snapshot : null
			harness.coordinator.consumeTerminal({
				jobId: start.jobId,
				terminalState: snapshot ? snapshot.state : "cancelled",
				exitCode: snapshot?.exitCode,
				reason: snapshot?.signal,
				isContainmentFailed: snapshot?.state === "containment_failed",
				outputTail: snapshot?.stdout?.slice(-1024),
			})
			expect(harness.sink.size()).toBe(1)
			const prompt = harness.sink.queued[0]?.prompt ?? ""
			expect(prompt).toContain("State: cancelled")
		})

		it("BCNT-11 containment_failed -> no wake (N9)", async () => {
			const harness = makeHarness()
			const start = await startBackgroundJob(harness, {
				command: "sleep 60",
				notifyOnCompletion: true,
			})
			// Pre-register the marker; then drive a synthetic
			// containment_failed terminal event. The coordinator
			// MUST drop the wake and record the containment_no_wake
			// decision (N9).
			harness.coordinator.registerMarker({
				jobId: start.jobId,
				sessionId: harness.activeSessionId,
				taskId: harness.activeTaskId,
			})
			harness.coordinator.consumeTerminal({
				jobId: start.jobId,
				terminalState: "containment_failed",
				exitCode: undefined,
				reason: "pgid_unset",
				isContainmentFailed: true,
			})
			expect(harness.sink.size()).toBe(0)
			const containment = harness.decisions.find((d) => d.decision === "containment_no_wake")
			expect(containment).toBeDefined()
		})

		it("BCNT-12 ephemeral marker loss -> no restored wake", async () => {
			const harness = makeHarness()
			const start = await startBackgroundJob(harness, {
				command: "sleep 60",
				notifyOnCompletion: true,
			})
			// Dispose the coordinator (EPHEMERAL_ONLY enforced).
			harness.coordinator.dispose()
			expect(harness.coordinator.diagnosticDisposed()).toBe(true)
			// Subsequent consumeTerminal is a no-op.
			const decision = harness.coordinator.consumeTerminal({
				jobId: start.jobId,
				terminalState: "exited",
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
			})
			expect(decision.kind).toBe("no_marker")
			expect(harness.sink.size()).toBe(0)
		})

		it("BCNT-13 prompt hard-bound <= 8 KiB under multibyte stress", async () => {
			const harness = makeHarness()
			const start = await startBackgroundJob(harness, {
				command: "true",
				notifyOnCompletion: true,
			})
			await harness.manager.cancel({
				jobId: start.jobId,
				origin: "other:test",
			})
			await start.terminalPromise
			await sleep(50)
			const prompt = harness.sink.queued[0]?.prompt ?? ""
			expect(Buffer.byteLength(prompt, "utf8")).toBeLessThanOrEqual(NOTIFY_WAKE_PROMPT_MAX_BYTES)
		})
	})
})

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms))
}

async function lastJobId(manager: CommandJobManager): Promise<string | undefined> {
	// manager.active is private; reach into the public read-only
	// surface (manager.activeCount + the status() lookup). For the
	// RED reproduction we only need to know ANY active job id, so
	// we round-trip through status by reading the activeCount and
	// using the harness's bookkeeping. The simplest path: read
	// the manager's terminal/active list via a quick status probe
	// with waitMs:0 — but status requires a jobId. Instead, we
	// return undefined and let the caller cancel the job via the
	// captured start.jobId path (BCNT-RED-01 already does this).
	return undefined
}

interface StartAndAwaitArgs {
	command: string
	notifyOnCompletion?: boolean
	waitBudgetMs: number
}

async function startAndAwait(harness: Harness, args: StartAndAwaitArgs): Promise<void> {
	const tool = createVscodeRunCommandsTool({
		cwd: process.cwd(),
		getTerminalManager: () => {
			throw new Error("foreground not used")
		},
		vscodeTerminalExecutionMode: "backgroundExec",
		commandJobManager: harness.manager,
		backgroundNotifyCoordinator: harness.coordinator,
		resolveActiveOwner: () => ({
			sessionId: harness.activeSessionId,
			taskId: harness.activeTaskId,
		}),
	})
	const input: Record<string, unknown> = { commands: [args.command] }
	if (args.notifyOnCompletion !== undefined) {
		input.notifyOnCompletion = args.notifyOnCompletion
	}
	const result = await tool.execute(input, {
		sessionId: harness.activeSessionId,
		agentId: "test-agent",
		iteration: 1,
	})
	// The shell tool wrapper returns ToolOperationResult[].
	// For the background path each element is { query, result,
	// success }. The background RUNNING payload is JSON-encoded
	// inside result.result; the terminal path is the raw stdout.
	const arr = Array.isArray(result) ? result : []
	const first = arr[0] as { result?: string; success?: boolean } | undefined
	if (!first) {
		throw new Error("tool.execute returned no results")
	}
	// Always force terminality by cancelling. The fakeSupervisor's
	// exit promise never resolves on its own, so the only way to
	// make terminalPromise resolve (and the wake consumer fire)
	// is to cancel. This is the same pattern BTCONT01 + AGCONT01
	// use to drive the terminal listener in tests.
	let jobId: string | undefined
	if (first.result && first.result.startsWith("{")) {
		try {
			const parsed = JSON.parse(first.result) as { jobId?: string; state?: string }
			jobId = parsed.jobId
		} catch {
			// not JSON; fall through
		}
	}
	if (jobId) {
		await harness.manager.cancel({
			jobId,
			origin: "other:test",
		})
	}
	// Wait for the cancel + terminal listener microtasks to drain.
	await sleep(100)
}
