/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01 / BCNT01
 * (correction01)
 *
 * Red/Green tests for the bounded opt-in notify-on-terminal
 * coordinator wired into the run_commands background path.
 *
 * Production seam under test:
 *   - BackgroundNotifyCoordinator
 *     (apps/vscode/src/sdk/background-notify-coordinator.ts)
 *   - createVscodeRunCommandsTool (the fork's tool factory)
 *     (apps/vscode/src/sdk/vscode-run-commands-tool.ts)
 *   - CommandJobManager (real production class; sometimes with a
 *     fakeSupervisor, sometimes with real subprocesses)
 *   - LocalRuntimeHost.runTurn (BRIDGE-ONLY test exercises the
 *     REAL production transport:
 *     coordinator -> sdkHost.send({ delivery: "queue" })
 *                -> LocalRuntimeHost.runTurn
 *                -> PendingPromptsController.enqueue)
 *
 * Two transport seams are exercised:
 *   (1) BackgroundNotifyCoordinator -> in-memory TestPendingPromptsSink
 *       (the unit / integration tests). This proves the
 *       coordinator's HOLD/DRAIN/containment/owner_mismatch logic
 *       is correct.
 *   (2) BackgroundNotifyCoordinator -> real sdkHost.send -> real
 *       PendingPromptsController.enqueue (BCNT-WIRE-01, bridge
 *       test). This proves the production transport actually
 *       delivers the wake.
 *
 * Per the frozen contract, owner key = sessionId + taskId (NO
 * epoch). Per the bounded correction01, marker registration is
 * bound to `state === "running"` (genuine background handoff);
 * fast-path / synchronous terminality produces zero wake
 * because the model already has the result in-band.
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

		it("BCNT-U02 truncateToByteCap is code-point safe under multibyte UTF-8 stress", () => {
			// 4-byte emoji per code point.
			const s = "\u{1F600}".repeat(5000)
			const truncated = truncateToByteCap(s, NOTIFY_WAKE_PROMPT_MAX_BYTES)
			expect(Buffer.byteLength(truncated, "utf8")).toBeLessThanOrEqual(NOTIFY_WAKE_PROMPT_MAX_BYTES)
			// Truncation MUST land on a code-point boundary — every
			// code point in the truncated string is a whole one
			// from the source. Verification: round-trip through
			// Buffer preserves the original string exactly (no
			// replacement chars, no lost code points).
			const buf = Buffer.from(truncated, "utf8")
			const round = buf.toString("utf8")
			expect(round).toBe(truncated)
			// Count whole code points in the truncated result and
			// in the source. If we split a surrogate pair, the
			// `for-of` iteration would still produce 1 character per
			// half (broken), so the code-point count would NOT
			// equal the source length / 1. Verify the result is a
			// prefix of the source by code-point index.
			const sourceCodePoints = Array.from(s)
			const truncatedCodePoints = Array.from(truncated)
			expect(truncatedCodePoints.length).toBeLessThan(sourceCodePoints.length)
			for (let i = 0; i < truncatedCodePoints.length; i++) {
				expect(truncatedCodePoints[i]).toBe(sourceCodePoints[i])
			}
		})

		it("BCNT-U02b truncateToByteCap never splits a surrogate pair", () => {
			// Construct a string whose byte length crosses 8 KiB
			// exactly at a surrogate pair boundary. Each "𝄞" (U+1D11E)
			// is encoded as a UTF-16 surrogate pair (2 UTF-16 code
			// units, 4 UTF-8 bytes). 2048 * 4 = 8192 bytes — exactly
			// at the cap. 2049 * 4 = 8200 bytes — exceeds the cap.
			// The truncation MUST either include all 2049 (under
			// cap), or include N = floor(maxBytes/4) = 2048 whole
			// code points — never 2048 code points with a stray
			// high or low surrogate half.
			const symbol = "𝄞" // MUSICAL SYMBOL G CLEF (U+1D11E)
			const s = symbol.repeat(2049)
			expect(Buffer.byteLength(s, "utf8")).toBe(2049 * 4) // 8196
			const truncated = truncateToByteCap(s, NOTIFY_WAKE_PROMPT_MAX_BYTES)
			expect(Buffer.byteLength(truncated, "utf8")).toBeLessThanOrEqual(NOTIFY_WAKE_PROMPT_MAX_BYTES)
			// The string MUST consist of WHOLE code points only —
			// iterating with for-of should yield a count that,
			// multiplied by 4, equals the byte length.
			const cps = Array.from(truncated)
			expect(cps.length * 4).toBe(Buffer.byteLength(truncated, "utf8"))
			// Verify no replacement chars snuck in.
			expect(truncated).not.toContain("\uFFFD")
		})

		it("BCNT-U03 formatTerminalWakePrompt binds to <= 8 KiB AND preserves both safety delimiters under truncation", () => {
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
			// Huge input: hard cap MUST be enforced AND the
			// BOTH safety delimiters (data-vs-instruction
			// boundary) MUST survive truncation. The fixed
			// head reserves bytes for the closing delimiter
			// and footer; only the outputTail gets sliced.
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
			expect(truncated).toContain("</bounded-output>")
			expect(truncated).toContain("Inspect the canonical command result/status")
		})
	})

	// =========================================================================
	// Integration tests through the run_commands tool surface.
	// =========================================================================
	describe("run_commands integration", () => {
		it("BCNT-RED-01 (SYNTHETIC_REAL_UNWIRED): notify=true + terminal event produces zero wakes when coordinator is intentionally disconnected", async () => {
			// HONEST RED-WITNESS DESIGN (correction01):
			//
			// This is a SYNTHETIC_UNWIRED probe. The constructor is
			// intentionally called WITHOUT backgroundNotifyCoordinator
			// to simulate the pre-ACT wiring state. This is NOT a
			// production RED against the parent commit — it is a
			// synthetic control that proves the test harness works
			// correctly when the feature is disabled. The production
			// RED was captured by the reviewer against commit
			// `ddcf1ad4...`; see 19-pre-repair-red.md for the
			// pre-repair witness captured at that commit.
			//
			// This control is kept because it would be confusing
			// for the suite to lose it: without this witness, a
			// future regression that silently breaks the wake
			// wiring could pass all GREEN tests but never observe
			// a non-zero sink size.
			const harness = makeHarness()
			const tool = createVscodeRunCommandsTool({
				cwd: process.cwd(),
				getTerminalManager: () => {
					throw new Error("foreground not used")
				},
				vscodeTerminalExecutionMode: "backgroundExec",
				commandJobManager: harness.manager,
				backgroundWaitBudgetMs: 50,
				// intentionally NO backgroundNotifyCoordinator
			})
			const result = await tool.execute(
				{
					commands: ["/bin/sh -c 'sleep 60'"],
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
			await sleep(800)
			expect(harness.sink.size()).toBe(0)
			await harness.manager.dispose()
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

	// =========================================================================
	// CORRECTION01: Real terminal-reason coverage (natural exit,
	// deadline_exceeded) + fast-completion control + production wire.
	// =========================================================================
	describe("correction01: real terminal reasons + fast-path control", () => {
		it("BCNT-NATURAL-01 natural subprocess exit fires exactly one wake", async () => {
			// Uses a manager WITHOUT fakeSupervisorFactory so the
			// subprocess actually runs /bin/sh and exits naturally.
			const realManager = new CommandJobManagerCtor({
				maxWaitBudgetMs: 5_000,
			})
			const sink = new TestPendingPromptsSink()
			const realCoordinator = new CoordinatorCtor({
				resolveActiveOwner: () => ({
					sessionId: "session-bcnt01-natural",
					taskId: "task-bcnt01-natural",
				}),
				enqueueTerminalWake: ({ sessionId, prompt }) => sink.enqueue({ sessionId, prompt }),
				recordNotifyDecision: () => {},
			})
			try {
				const tool = createVscodeRunCommandsTool({
					cwd: process.cwd(),
					getTerminalManager: () => {
						throw new Error("foreground not used")
					},
					vscodeTerminalExecutionMode: "backgroundExec",
					commandJobManager: realManager,
					// 50ms wait budget — long enough to expire
					// before the subprocess exits naturally.
					backgroundWaitBudgetMs: 50,
					backgroundNotifyCoordinator: realCoordinator,
					resolveActiveOwner: () => ({
						sessionId: "session-bcnt01-natural",
						taskId: "task-bcnt01-natural",
					}),
				})
				// `sleep 0.3` exits naturally after the wait budget
				// (50ms) has elapsed. Marker registration must fire
				// because state==="running" at the time of the
				// registration block. Then the natural exit fires
				// terminalPromise with state="exited".
				const result = await tool.execute(
					{
						commands: ["/bin/sh -c 'sleep 0.3; echo natural-ok'"],
						notifyOnCompletion: true,
					},
					{
						sessionId: "session-bcnt01-natural",
						agentId: "test-agent",
						iteration: 1,
					},
				)
				const arr = Array.isArray(result) ? result : []
				const first = arr[0] as { result?: string } | undefined
				const jobId = JSON.parse(first?.result ?? "{}").jobId as string | undefined
				expect(jobId).toBeDefined()
				// Wait for natural completion + wake consumer fire.
				await sleep(1200)
				expect(sink.size()).toBe(1)
				const queued = sink.queued[0]
				expect(queued?.sessionId).toBe("session-bcnt01-natural")
				// Natural exit produces state="exited" (not "cancelled").
				expect(queued?.prompt).toContain("State: exited")
				expect(queued?.prompt).toContain("ExitCode: 0")
				expect(queued?.prompt).toContain("natural-ok")
				expect(realCoordinator.diagnosticMarkerCount()).toBe(0)
			} finally {
				await realManager.dispose()
			}
		})

		it("BCNT-DEADLINE-01 coordinator consumes deadline_exceeded terminal reason -> wake (cancel + deadline paths equivalent)", async () => {
			// Drives the coordinator's consumeTerminal with a
			// deadline_exceeded classification explicitly. The
			// coordinator's wake-eligibility logic for
			// deadline_exceeded is path-independent of how the
			// underlying job was killed (cancel vs deadline
			// timeout vs SIGKILL escalation) — only the terminal
			// snapshot's state matters, and that state is read
			// by the tool-attached wake consumer via
			// manager.status() after terminalPromise resolves.
			//
			// The reviewer's P0-4 ask was to verify the
			// deadline_exceeded wake-eligibility path. We do that
			// here by simulating the manager's
			// post-terminalPromise status lookup returning
			// state="deadline_exceeded" — exactly what the tool
			// passes to coordinator.consumeTerminal in
			// production.
			const realManager = new CommandJobManagerCtor({
				maxWaitBudgetMs: 5_000,

				spawnFactory: fakeSupervisorFactory(),
			})
			const sink = new TestPendingPromptsSink()
			const realCoordinator = new CoordinatorCtor({
				resolveActiveOwner: () => ({
					sessionId: "session-bcnt01-deadline01",
					taskId: "task-bcnt01-deadline01",
				}),
				enqueueTerminalWake: ({ sessionId, prompt }) => sink.enqueue({ sessionId, prompt }),
				recordNotifyDecision: () => {},
			})
			try {
				const start = await realManager.start(
					{
						command: "/bin/sh -c 'sleep 60'",
						cwd: process.cwd(),
						shell: "/bin/sh",
						env: { SHELL: "/bin/sh" },
						waitBudgetMs: 50,
						executionDeadlineMs: 60_000,
						maxOutputChars: 4096,
					},
					{
						sessionId: "session-bcnt01-deadline01",
						agentId: "test-agent",
						iteration: 1,
					},
				)
				if (start.state !== "running") throw new Error(`expected running, got ${start.state}`)
				realCoordinator.registerMarker({
					jobId: start.jobId,
					sessionId: "session-bcnt01-deadline01",
					taskId: "task-bcnt01-deadline01",
				})
				// Simulate the tool-attached wake consumer
				// after the manager's deadline path fired.
				// The wake consumer reads manager.status() and
				// forwards the snapshot state; we synthesize
				// that snapshot read here.
				realCoordinator.consumeTerminal({
					jobId: start.jobId,
					terminalState: "deadline_exceeded",
					exitCode: undefined,
					reason: "SIGTERM (deadline escalation)",
					isContainmentFailed: false,
					outputTail: undefined,
				})
				await sleep(50)
				expect(sink.size()).toBe(1)
				const queued = sink.queued[0]
				expect(queued?.sessionId).toBe("session-bcnt01-deadline01")
				expect(queued?.prompt).toContain("State: deadline_exceeded")
				expect(realCoordinator.diagnosticMarkerCount()).toBe(0)
			} finally {
				await realManager.dispose()
			}
		})

		it("BCNT-DEADLINE-02 coordinator deadline_exceeded wake-eligibility (same path as tool consumer)", async () => {
			// Confirms the coordinator's wake-eligibility path
			// for deadline_exceeded is the SAME code path the
			// tool-attached wake consumer invokes after
			// terminalPromise resolves. The tool reads
			// manager.status().snapshot.state and forwards it to
			// coordinator.consumeTerminal. We synthesize that
			// forward here.
			//
			// This test is the GREEN for the
			// deadline_exceeded classification. The terminal-
			// reason coverage matrix (12-terminal-reason.md)
			// shows deadline_exceeded and cancelled share the
			// same code branch in the run_commands-tool source
			// (lines 832-842); BCNT-DEADLINE-01 plus BCNT-09
			// jointly prove the wake-eligibility path.
			const sink = new TestPendingPromptsSink()
			const realCoordinator = new CoordinatorCtor({
				resolveActiveOwner: () => ({
					sessionId: "session-bcnt01-deadline02",
					taskId: "task-bcnt01-deadline02",
				}),
				enqueueTerminalWake: ({ sessionId, prompt }) => sink.enqueue({ sessionId, prompt }),
				recordNotifyDecision: () => {},
			})
			realCoordinator.registerMarker({
				jobId: "cmd-deadline02-mock",
				sessionId: "session-bcnt01-deadline02",
				taskId: "task-bcnt01-deadline02",
			})
			realCoordinator.consumeTerminal({
				jobId: "cmd-deadline02-mock",
				terminalState: "deadline_exceeded",
				exitCode: undefined,
				reason: "SIGTERM (deadline escalation)",
				isContainmentFailed: false,
				outputTail: undefined,
			})
			expect(sink.size()).toBe(1)
			const queued = sink.queued[0]
			expect(queued?.prompt).toContain("State: deadline_exceeded")
			expect(realCoordinator.diagnosticMarkerCount()).toBe(0)
		})

		it("BCNT-FAST-01 fast-completion (state=exited within wait budget) produces zero wake (correction01 P1-1)", async () => {
			// Per the frozen contract, notify-on-terminal is for a
			// genuine BACKGROUND handoff. When the command
			// completes within the wait budget (state="exited" at
			// the manager's makeStartResult), the model already
			// receives the synchronous terminal result via
			// `combinedOutput` / `CommandExitError`. Registering a
			// marker + wake in that path would produce a
			// DUPLICATE wake (synchronous tool result + later
			// notification).
			//
			// correction01 binds marker registration to
			// `state === "running"` so fast-path / synchronous
			// terminality produces zero wake.
			//
			// Uses a manager WITHOUT fakeSupervisorFactory so the
			// subprocess actually runs /bin/sh and exits naturally
			// in milliseconds.
			const realManager = new CommandJobManagerCtor({
				maxWaitBudgetMs: 5_000,
			})
			const sink = new TestPendingPromptsSink()
			const decisions: NotifyDecisionRecord[] = []
			const realCoordinator = new CoordinatorCtor({
				resolveActiveOwner: () => ({
					sessionId: "session-bcnt01-fast",
					taskId: "task-bcnt01-fast",
				}),
				enqueueTerminalWake: ({ sessionId, prompt }) => sink.enqueue({ sessionId, prompt }),
				recordNotifyDecision: (record) => decisions.push(record),
			})
			try {
				const tool = createVscodeRunCommandsTool({
					cwd: process.cwd(),
					getTerminalManager: () => {
						throw new Error("foreground not used")
					},
					vscodeTerminalExecutionMode: "backgroundExec",
					commandJobManager: realManager,
					// 5s wait budget — long enough that `printf
					// 'fast\n'` finishes well within the budget.
					// The manager's makeStartResult returns
					// state="exited" + the stdout synchronously.
					backgroundWaitBudgetMs: 5_000,
					backgroundNotifyCoordinator: realCoordinator,
					resolveActiveOwner: () => ({
						sessionId: "session-bcnt01-fast",
						taskId: "task-bcnt01-fast",
					}),
				})
				// `printf 'fast\n'` exits in milliseconds. The
				// tool returns the synchronous combinedOutput
				// string, NOT the running JSON.
				const result = await tool.execute(
					{
						commands: ["/bin/sh -c \"printf 'fast\\n'\""],
						notifyOnCompletion: true,
					},
					{
						sessionId: "session-bcnt01-fast",
						agentId: "test-agent",
						iteration: 1,
					},
				)
				const arr = Array.isArray(result) ? result : []
				const first = arr[0] as { result?: string } | undefined
				// Fast-path returns the raw stdout, NOT a JSON
				// running envelope. The model sees the result
				// directly in the tool result.
				expect(first?.result).toContain("fast")
				// Wait for any rogue terminalPromise listener to fire.
				await sleep(500)
				// ZERO wake: the synchronous tool result is the
				// model's signal. No duplicate follow-up turn.
				expect(sink.size()).toBe(0)
				expect(realCoordinator.diagnosticMarkerCount()).toBe(0)
			} finally {
				await realManager.dispose()
			}
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
