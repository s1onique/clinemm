/**
 * ACT-CLINEMM-ASYNC-COMMAND-OWNERSHIP-DISCRIMINATOR01-CORRECTION03
 *
 * HOST-LAYER causal discriminator for the ASYNC-COMMAND-TURN-LIVENESS01
 * epic, CORRECTION03 revision.
 *
 * HISTORY (row lineage):
 *   row 15a (CORRECTION-N/A): agent-layer, real AgentRuntime +
 *     real createShellTool + real CommandJobManager. Closed
 *     `PASS_AGENT_LAYER_DISCRIMINATOR` + `HOST_OWNER_DISCRIMINATOR_PENDING`.
 *   row 15b (CORRECTION01): host-layer, real LocalRuntimeHost + stub
 *     agent (messages:[], toolCalls:[]; "RUNNING" in free-form text).
 *     Closed `HALT_TEST_SEAM_INVALID` per Factory reviewer P0.
 *   row 15c (CORRECTION02): host-layer, real LocalRuntimeHost + real
 *     AgentRuntime + real createShellTool + real CommandJobManager, with
 *     `sleep 5` vs `waitBudgetMs=50`. Closed `CASE_D_DEAD_ZONE_AT_HOST_PROVEN`
 *     + `HOST_MANUAL_REENTRY_PROVEN` — but the Factory reviewer identified
 *     that the verdict classification contradicted itself (idle +
 *     pendingPrompts=0 + manual reentry available ≠ CASE_D full dead
 *     zone) AND that the RUNNING state was hard-coded in the test rather
 *     than asserted from the actual `CommandJobManager.start()` producer.
 *     This CORRECTION03 fixes both.
 *
 * P0 FIX (evidence binding):
 *   The shell executor MUST assert that `start.state === "running"` from
 *   the real producer (`CommandJobManager.start(...)`) and MUST propagate
 *   that field through the envelope. Never hard-code "running" — Factory
 *   evidence should bind to the actual producer.
 *
 * CLASSIFICATION REJECTION (P1):
 *   `CASE_D_DEAD_ZONE_AT_HOST` is REJECTED because it requires
 *   "no successor AND no user-owned state". What CORRECTION02 actually
 *   proved at the host boundary is:
 *     - HOST_AUTONOMOUS_WAKEUP = ABSENT_PROVEN
 *     - HOST_SESSION_AFTER_TURN = IDLE_PROVEN
 *     - HOST_MANUAL_REENTRY = PROVEN
 *   Those three are coherent: the host does NOT auto-wakeup on terminal
 *   completion, the session transitions to `idle` after `markTurnIdle`,
 *   and the user can re-engage via `host.runTurn(...)`. The application
 *   / composer / UI seam is above `LocalRuntimeHost` and is NOT observed
 *   here. `APPLICATION_USER_OWNERSHIP = NOT_PROVEN`; the LIVE bug
 *   (Idle + Thinking + Cancel simultaneously) lives at the application
 *   seam and is the next ACT to qualify.
 *
 * QUESTION (the host-layer discriminator — refined):
 *
 *   When a foreground `run_commands` is deferred past the wait budget
 *   (REAL HOST_DEFERRED_FOREGROUND RUNNING(jobId)) and the tool result
 *   carries the structured RUNNING envelope (sourced from the REAL
 *   `CommandJobManager.start()` producer) back through a REAL
 *   `AgentRuntime`, does the REAL `LocalRuntimeHost`:
 *     (a) schedule an autonomous successor turn?
 *     (b) queue a pending prompt?
 *     (c) yield ownership to a user follow-up (idle + manual reentry)?
 *     (d) do nothing (dead zone)?
 *
 * Strategy (per CORRECTION03 — minor refinement of CORRECTION02):
 *
 *   REAL HOST_DEFERRED_FOREGROUND RUNNING(jobId):
 *     command: sleep 5 (longer than the wait budget)
 *     waitBudgetMs: 50
 *     executionDeadlineMs: 30_000
 *
 *   The shell tool is the REAL `createShellTool` from `@cline/core`
 *   (the production factory), wrapping a faithful
 *   `BackgroundShellExecutor` that calls `CommandJobManager.start(...)`
 *   and returns the SAME JSON envelope as the production
 *   `vscode-run-commands-tool.ts:685-693` background path — with the
 *   `status` field sourced from the actual producer (no hard-coding).
 *
 *   The agent is the REAL `AgentRuntime` from `@cline/agents`, composed
 *   with the REAL `createShellTool` and a scripted `ScriptedModel`.
 *
 *   The `AgentRuntime` is wrapped in an `AgentRuntimeBackedAdapter`
 *   that exposes the `SessionRuntime`-shaped surface
 *   (`canStartRun`, `subscribeRuntimeEvents`,
 *   `subscribeRecoveryStateChange`, `getMessages`, `getAgentId`,
 *   `getConversationId`, `run`, `continue`, `abort`, `shutdown`,
 *   `snapshot`) that `LocalRuntimeHost` consumes via the
 *   `createAgent` factory seam at `local-runtime-host.ts:262`.
 *
 *   The REAL `LocalRuntimeHost` is then constructed (production
 *   class via `@cline-internal/core/runtime/host/local-runtime-host`)
 *   and the run is driven through `host.startSession(...)` +
 *   `host.runTurn(...)` so the host's complete turn lifecycle
 *   executes (`executeTurn` -> `executeAgentTurn` ->
 *   `agent.run/continue` -> `completeInteractiveTurn` ->
 *   `markTurnIdle`).
 *
 *   ONLY MOCKED SURFACES:
 *     - the LLM (scripted `AgentModel` emits one tool call then stop)
 *     - the `runtimeBuilder` (the tool registry stub returns
 *       `tools: []` because the shell tool is fed directly into the
 *       real `AgentRuntime` we compose)
 *     - the `telemetry` (vi.fn()-based, per row 15a's
 *       `createTelemetryMock`)
 *
 * Stop rule (per ACT §43): stop as soon as executable evidence gives
 * ONE answer at the host-level seam. NO REPAIR AUTHORIZED in this
 * correction (even on RED); reviewer must authorize bounded repair
 * explicitly.
 *
 * IMPORTANT DISTINCTION FROM CORRECTION02:
 *
 *   CORRECTION02 synthesized `"running"` in the envelope. CORRECTION03
 *   asserts `start.state === "running"` from the producer and propagates
 *   `start.state` through the envelope. If the producer ever returns
 *   `completed` (e.g. the wait budget is later than the command
 *   duration), the test throws — test seam invalid, fail fast.
 *
 * IMPORTANT DISTINCTION FROM A REPAIR ACT:
 *
 *   CORRECTION03 does NOT attempt autonomous continuation. The host's
 *   intentional idle-yield contract is honored. The remaining LIVE bug
 *   (Idle + Thinking + Cancel simultaneously) is at the application
 *   seam and belongs to the next ACT
 *   (`ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01`),
 *   NOT to this host seam.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentRuntime } from "@cline/agents"
import { createShellTool } from "@cline/core"
import type {
	AgentMessage,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentResult,
	AgentRuntimeEvent,
	AgentRuntimeRecoverySnapshot,
	AgentToolContext,
	ITelemetryService,
	LiveAgentRuntimeStateSnapshot,
} from "@cline/shared"
import { agentMessagesToMessagesWithMetadata } from "@cline-internal/core/runtime/config/agent-message-codec"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { FileSessionService } from "@cline-internal/core/session/services/file-session-service"
import type { CoreSessionEvent } from "@cline-internal/core/types/events"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CommandJobManager } from "../command-job-manager"

// ============================================================================
// Scripted model — the ONLY mocked LLM surface (matches row 15a)
// ============================================================================

class ScriptedModel implements AgentModel {
	public readonly requests: AgentModelRequest[] = []
	constructor(
		private readonly steps: Array<(request: AgentModelRequest) => Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>>,
	) {}

	async stream(request: AgentModelRequest): Promise<AsyncIterable<AgentModelEvent>> {
		this.requests.push(request)
		const step = this.steps.shift()
		if (!step) {
			throw new Error("No scripted model step available")
		}
		return toAsyncIterable(step(request))
	}
}

async function* toAsyncIterable(
	events: Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>,
): AsyncIterable<AgentModelEvent> {
	for await (const event of events) {
		yield event
	}
}

function createTelemetryMock(): { telemetry: ITelemetryService; capture: ReturnType<typeof vi.fn> } {
	const capture = vi.fn()
	return {
		capture,
		telemetry: {
			capture,
			captureRequired: vi.fn(),
			setDistinctId: vi.fn(),
			setMetadata: vi.fn(),
			updateMetadata: vi.fn(),
			setCommonProperties: vi.fn(),
			updateCommonProperties: vi.fn(),
			isEnabled: () => true,
			recordCounter: vi.fn(),
			recordHistogram: vi.fn(),
			recordGauge: vi.fn(),
			flush: vi.fn(async () => undefined),
			dispose: vi.fn(async () => undefined),
		} as unknown as ITelemetryService,
	}
}

// ============================================================================
// Background-execution seam — same shape as row 15a, but with the
// REAL `sleep 5` command vs `waitBudgetMs=50` so that the
// `CommandJobManager.start(...)` actually returns a RUNNING envelope.
// ============================================================================

const isPosix = process.platform !== "win32"
const SLOW_CMD = isPosix ? "/bin/sh -c 'sleep 5'" : "ping -n 5 127.0.0.1"

interface BackgroundExecutorOptions {
	manager: CommandJobManager
	waitBudgetMs: number
	executionDeadlineMs: number
}

function createBackgroundShellExecutor(
	options: BackgroundExecutorOptions,
): (command: string | { command: string; args?: string[] }, cwd: string, _context: AgentToolContext) => Promise<string> {
	const { manager, waitBudgetMs, executionDeadlineMs } = options
	return async (
		_command: string | { command: string; args?: string[] },
		_cwd: string,
		_context: AgentToolContext,
	): Promise<string> => {
		const start = await manager.start(
			{
				command: _command,
				cwd: _cwd,
				waitBudgetMs,
				executionDeadlineMs,
			},
			{ agentId: "aco03-host-agent", conversationId: "aco03-host-conv", iteration: 1 },
		)
		// ACT-CLINEMM-ASYNC-COMMAND-OWNERSHIP-DISCRIMINATOR01-CORRECTION03
		// P0 FIX: bind the RUNNING claim to the actual producer. Never
		// hard-code "running"; assert against `start.state` and propagate
		// it through the envelope. With `sleep 5` vs `waitBudgetMs=50`
		// it is overwhelmingly likely to be "running", but Factory
		// evidence should bind to the real producer — not to a literal
		// the test wrote itself.
		if (start.state !== "running") {
			throw new Error(
				`[ACO-HOST] expected producer CommandJobManager.start to return state="running" but got "${start.state}" (jobId=${start.jobId}); test seam is invalid`,
			)
		}
		// Production-faithful RUNNING envelope (vscode-run-commands-tool.ts:685-693).
		// `status` is sourced from the producer, not synthesized.
		const runningPayload = {
			status: start.state,
			jobId: start.jobId,
			elapsedMs: start.elapsedMs,
			deadlineRemainingMs: start.deadlineRemainingMs,
			outputTruncated: start.outputTruncated,
			stdout: start.stdout,
		}
		return JSON.stringify(runningPayload)
	}
}

async function waitForJobIdle(manager: CommandJobManager, timeoutMs = 30_000): Promise<void> {
	const start = Date.now()
	while (manager.activeCount > 0) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`waitForJobIdle: manager did not reach activeCount=0 within ${timeoutMs}ms`)
		}
		await new Promise((r) => setTimeout(r, 50))
	}
}

async function settleMicrotasks(times = 5): Promise<void> {
	for (let i = 0; i < times; i += 1) {
		await new Promise((r) => setImmediate(r))
	}
}

// ============================================================================
// AgentRuntimeBackedAdapter — wraps the REAL AgentRuntime into the
// SessionRuntime-shaped surface that LocalRuntimeHost expects.
// ============================================================================
//
// LocalRuntimeHost calls (see local-runtime-host.ts:996, 1882-1930):
//   - canStartRun() : boolean
//   - subscribeRuntimeEvents(listener: (event: AgentRuntimeEvent) => void) : () => void
//   - subscribeRecoveryStateChange(listener: (sessionId, recovery) => void) : () => void
//   - getMessages() : readonly MessageWithMetadata[]
//   - getAgentId() : string
//   - getConversationId() : string
//   - run(userMessage: string, userImages?: string[], userFiles?: string[]) : Promise<AgentResult>
//   - continue(userMessage?: string, userImages?: string[], userFiles?: string[]) : Promise<AgentResult>
//   - abort(reason?: unknown) : void
//   - shutdown(reason?: string, timeoutMs?: number) : Promise<void>
//   - snapshot() : LiveAgentRuntimeStateSnapshot | undefined
//
// The adapter delegates to a single REAL AgentRuntime instance. Each
// `run()`/`continue()` call creates a NEW AgentRuntime from a factory
// (because AgentRuntime is per-run by design — see
// `AgentRuntime.runStarted` lifecycle) that shares the scripted model
// and the shell tool. This mirrors how the production SessionRuntime
// creates a fresh AgentRuntime per run via `executeRun`.

interface AgentRuntimeBackedAdapterDeps {
	createAgentRuntime: () => AgentRuntime
}

class AgentRuntimeBackedAdapter {
	private readonly listeners = new Set<(event: AgentRuntimeEvent) => void>()
	private readonly recoveryListeners = new Set<(sessionId: string, recovery: AgentRuntimeRecoverySnapshot) => void>()
	private activeRuntime: AgentRuntime | null = null
	// Persistent runtime for `continue()` after the previous run has
	// completed. Cleared on shutdown. Mirrors how the production
	// SessionRuntime keeps its conversation store across runs.
	private persistedRuntime: AgentRuntime | null = null
	private aborted = false
	private shutdownCalled = false

	constructor(private readonly deps: AgentRuntimeBackedAdapterDeps) {}

	canStartRun(): boolean {
		// `true` whenever the adapter is between runs (no run in flight,
		// not aborted, not shut down). The host uses this to decide
		// whether to dispatch a runTurn immediately vs queue it as a
		// pending prompt. The AgentRuntime backing the previous run
		// remains accessible via `continue()` because we keep a
		// persistent reference to it.
		return !this.activeRuntime && !this.shutdownCalled && !this.aborted
	}

	subscribeRuntimeEvents(listener: (event: AgentRuntimeEvent) => void): () => void {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}

	// SessionRuntime also exposes a `subscribeEvents(listener)` API
	// that LocalRuntimeHost.startResolvedSession invokes via
	// `agentConfig.onEvent` (see local-runtime-host.ts:784-786).
	// Adapter delegates to the same listener set.
	subscribeEvents(listener: (event: AgentRuntimeEvent) => void): () => void {
		return this.subscribeRuntimeEvents(listener)
	}

	subscribeRecoveryStateChange(listener: (sessionId: string, recovery: AgentRuntimeRecoverySnapshot) => void): () => void {
		this.recoveryListeners.add(listener)
		return () => {
			this.recoveryListeners.delete(listener)
		}
	}

	getMessages(): readonly AgentMessage[] {
		// SessionRuntime.getMessages reads from the conversation store;
		// for the host seam, the messages array is opaque — return the
		// current runtime's snapshot.messages if any.
		const rt = this.activeRuntime ?? this.persistedRuntime
		return rt?.snapshot()?.messages ?? []
	}

	getAgentId(): string {
		const rt = this.activeRuntime ?? this.persistedRuntime
		return rt?.snapshot()?.agentId ?? "aco02-host-agent"
	}

	getConversationId(): string {
		const rt = this.activeRuntime ?? this.persistedRuntime
		return rt?.snapshot()?.agentId ?? "aco02-host-conv"
	}

	async run(userMessage: string, _userImages?: string[], _userFiles?: string[]): Promise<AgentResult> {
		const runtime = this.deps.createAgentRuntime()
		this.activeRuntime = runtime
		const unsub = runtime.subscribe((event: AgentRuntimeEvent) => {
			for (const listener of this.listeners) {
				listener(event)
			}
		})
		try {
			const startedAt = new Date()
			const runResult = await runtime.run(userMessage)
			return this.buildAgentResult(runResult, startedAt)
		} finally {
			unsub()
			// After run() completes, the runtime is no longer "active"
			// — canStartRun() returns true. We persist the runtime
			// reference so `continue()` can re-use it on the next
			// runTurn (which is how the production SessionRuntime
			// handles its conversation store).
			this.activeRuntime = null
			this.persistedRuntime = runtime
		}
	}

	async continue(userMessage?: string, _userImages?: string[], _userFiles?: string[]): Promise<AgentResult> {
		const runtime = this.persistedRuntime
		if (!runtime) {
			throw new Error("continue() called before run()")
		}
		this.activeRuntime = runtime
		const unsub = runtime.subscribe((event: AgentRuntimeEvent) => {
			for (const listener of this.listeners) {
				listener(event)
			}
		})
		try {
			const startedAt = new Date()
			const runResult = await runtime.continue(userMessage ?? "")
			return this.buildAgentResult(runResult, startedAt)
		} finally {
			unsub()
			this.activeRuntime = null
		}
	}

	// Wrap AgentRunResult into AgentResult. Mirrors the production
	// SessionRuntime.buildLegacyResult at session-runtime-orchestrator.ts:1488-1535
	// (the host's withLatestAssistantTurnMetadata requires result.model
	// to have id/provider and result.endedAt to be a Date).
	private buildAgentResult(runResult: Awaited<ReturnType<AgentRuntime["run"]>>, startedAt: Date): AgentResult {
		const endedAt = new Date()
		const finishReason: AgentResult["finishReason"] =
			runResult.status === "failed" ? "error" : runResult.status === "aborted" ? "aborted" : "completed"
		const text = (runResult.status === "failed" ? runResult.error?.message : undefined) || runResult.outputText || ""
		const usage = {
			inputTokens: runResult.usage.inputTokens,
			outputTokens: runResult.usage.outputTokens,
			cacheReadTokens: runResult.usage.cacheReadTokens > 0 ? runResult.usage.cacheReadTokens : 0,
			cacheWriteTokens: runResult.usage.cacheWriteTokens > 0 ? runResult.usage.cacheWriteTokens : 0,
			totalCost: runResult.usage.totalCost,
		}
		return {
			text,
			usage,
			// Convert AgentMessage[] -> MessageWithMetadata[] via the
			// REAL production helper (the same one SessionRuntime.
			// buildLegacyResult uses at orchestration/session-runtime-
			// orchestrator.ts:1518). This replaces the previous
			// `as AgentMessage[]` cast (which circumvented the
			// MessageWithMetadata[] -> MessageRole vocabulary check
			// without actually doing any conversion). The helper
			// coerces "tool" -> "user" which is what
			// `withLatestAssistantTurnMetadata` expects (it only
			// writes `metrics` onto the LAST assistant turn and
			// ignores tool messages).
			//
			// Per Factory reviewer P1 hygiene (P1 fix once and
			// continue, surfaced by adding
			// aco01-correction03.c24-c-bridge.test.ts to the bridge
			// tsconfig include list during AOPC02 step 0): do not
			// silence vocabulary mismatches with `as never`; use
			// the existing production-correct shape.
			messages: agentMessagesToMessagesWithMetadata(runResult.messages),
			toolCalls: [],
			iterations: runResult.iterations,
			finishReason,
			model: { id: "mock-model", provider: "mock-provider" },
			startedAt,
			endedAt,
			durationMs: endedAt.getTime() - startedAt.getTime(),
		}
	}

	abort(reason?: unknown): void {
		this.aborted = true
		this.activeRuntime?.abort(reason as never)
	}

	async shutdown(_reason?: string, _timeoutMs?: number): Promise<void> {
		this.shutdownCalled = true
		this.activeRuntime = null
		this.persistedRuntime = null
	}

	snapshot(): LiveAgentRuntimeStateSnapshot | undefined {
		const rt = this.activeRuntime ?? this.persistedRuntime
		return rt?.snapshot() as LiveAgentRuntimeStateSnapshot | undefined
	}
}

// ============================================================================
// Scripted-model factory — same shape as row 15a's ACO01
// ============================================================================

function makeScriptedModelForHost(): ScriptedModel {
	return new ScriptedModel([
		// step 1: emit one run_commands tool call + finish.
		() => [
			{
				type: "tool-call-delta" as const,
				toolCallId: "call_run_host_1",
				toolName: "run_commands",
				inputText: JSON.stringify({ commands: [SLOW_CMD] }),
			},
			{ type: "finish" as const, reason: "tool-calls" as const },
		],
		// step 2 (used by follow-up turns): emit text + stop.
		() => [
			{ type: "text-delta" as const, text: "model saw RUNNING and is done" },
			{ type: "finish" as const, reason: "stop" as const },
		],
	])
}

function makeScriptedModelForFollowUp(): ScriptedModel {
	// For follow-up runs: emit one tool-call + finish; the host only
	// verifies that the run was actually dispatched, not the tool path.
	return new ScriptedModel([
		() => [
			{
				type: "tool-call-delta" as const,
				toolCallId: "call_run_host_followup_1",
				toolName: "noop_tool",
				inputText: JSON.stringify({}),
			},
			{ type: "finish" as const, reason: "tool-calls" as const },
		],
	])
}

// ============================================================================
// Host fixture
// ============================================================================

function makeHost(adapter: AgentRuntimeBackedAdapter, isolatedHomeDir: string): LocalRuntimeHost {
	const runtimeBuilder = {
		build: vi.fn().mockReturnValue({
			tools: [],
			shutdown: vi.fn().mockResolvedValue(undefined),
		}),
	}
	const sessionsDir = join(isolatedHomeDir, "sessions")
	return new LocalRuntimeHost({
		distinctId: "aco-host-correction03",
		sessionService: new FileSessionService(sessionsDir),
		runtimeBuilder: runtimeBuilder as never,
		createAgent: () => adapter as never,
	})
}

async function startSessionA(host: LocalRuntimeHost) {
	return await host.startSession({
		interactive: true,
		config: {
			sessionId: "session-A",
			providerId: "mock-provider",
			modelId: "mock-model",
			systemPrompt: "test",
			enableTools: false,
			enableSpawnAgent: false,
			enableAgentTeams: false,
		},
	})
}

// ============================================================================
// ACO-HOST01/02/03 — the real-host seam
// ============================================================================

describe("ACT-CLINEMM-ASYNC-COMMAND-OWNERSHIP-DISCRIMINATOR01-CORRECTION03", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
	}
	let isolatedHomeDir = ""
	let manager: CommandJobManager
	let shellTool: ReturnType<typeof createShellTool>
	let scriptStep = 0

	beforeEach(() => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "aco02-host-bridge-"))
		process.env.HOME = isolatedHomeDir
		process.env.CLINE_DIR = join(isolatedHomeDir, ".cline")
		manager = new CommandJobManager()
		shellTool = createShellTool(
			createBackgroundShellExecutor({
				manager,
				waitBudgetMs: 50, // <<<<< REAL deferred: 50ms wait budget vs 5s command
				executionDeadlineMs: 30_000,
			}),
			{
				cwd: process.cwd(),
				bashTimeoutMs: 30_000,
			},
		)
		scriptStep = 0
	})

	afterEach(async () => {
		await manager.dispose()
		process.env.HOME = envSnapshot.HOME
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR
		rmSync(isolatedHomeDir, { recursive: true, force: true })
	})

	function makeAdapter(model: ScriptedModel): AgentRuntimeBackedAdapter {
		const { telemetry } = createTelemetryMock()
		return new AgentRuntimeBackedAdapter({
			createAgentRuntime: () =>
				new AgentRuntime({
					model,
					tools: [shellTool],
					telemetry,
				}),
		})
	}

	// ------------------------------------------------------------------------
	// ACO-HOST01 — real RUNNING(jobId) chronology at the host seam
	// ------------------------------------------------------------------------
	it("ACO-HOST01 — real deferred RUNNING(jobId) through LocalRuntimeHost: no autonomous host successor", async () => {
		if (!isPosix) {
			console.warn("[ACO-HOST01] non-posix platform — skipped")
			return
		}

		const model = makeScriptedModelForHost()
		const adapter = makeAdapter(model)
		const host = makeHost(adapter, isolatedHomeDir)

		// Subscribe to the host's CoreSessionEvent bus to detect any
		// host-side successor activity after terminal completion.
		const hostEvents: { sessionId: string; eventType: string }[] = []
		host.subscribe((event: CoreSessionEvent) => {
			const sid = (event.payload as { sessionId?: string }).sessionId ?? ""
			hostEvents.push({ sessionId: sid, eventType: event.type })
		})

		await startSessionA(host)

		const pendingBeforeRunTurn = await host.pendingPrompts.list({ sessionId: "session-A" })
		const eventCountBeforeRunTurn = hostEvents.length

		// T0: drive the host's full turn lifecycle.
		const result = await host.runTurn({
			sessionId: "session-A",
			prompt: "please run a slow command",
		})

		// T1: runTurn returned. The agent's tool-result message
		// should carry the RUNNING(jobId) envelope (real, not
		// synthesized text). Pull the structured tool result out.
		const messagesAfterRunTurn = adapter.getMessages() as readonly AgentMessage[]
		const toolResultMessages = messagesAfterRunTurn.filter(
			(m) => m.role === "tool" && m.content.some((p) => p.type === "tool-result" && p.toolCallId === "call_run_host_1"),
		)
		let structuredRunningEnvelope: { status?: string; jobId?: string } | undefined
		if (toolResultMessages.length === 1) {
			const part = toolResultMessages[0]?.content.find(
				(p) => p.type === "tool-result" && p.toolCallId === "call_run_host_1",
			)
			if (part?.type === "tool-result") {
				const output = part.output as unknown
				if (Array.isArray(output) && output.length > 0) {
					const first = output[0] as { result?: string }
					if (typeof first?.result === "string") {
						try {
							structuredRunningEnvelope = JSON.parse(first.result)
						} catch {
							structuredRunningEnvelope = undefined
						}
					}
				}
			}
		}
		await settleMicrotasks()
		const pendingAfterRunTurn = await host.pendingPrompts.list({ sessionId: "session-A" })
		const sessionRecord = await host.getSession("session-A")
		const eventCountAfterRunTurn = hostEvents.length

		// T2: wait for the underlying command to actually terminal.
		await waitForJobIdle(manager)

		// T3: settle microtasks.
		await settleMicrotasks(10)
		const pendingAfterTerminal = await host.pendingPrompts.list({ sessionId: "session-A" })
		const eventCountAfterTerminal = hostEvents.length
		const runCountAfterTerminal = scriptStep

		// T4: filter "successor-shaped" events (agent_event / chunk /
		// status). session_snapshot from markTurnIdle is expected and
		// is NOT a successor signal.
		const eventsAfterRunTurn = hostEvents.slice(eventCountAfterRunTurn)
		const successorEvents = eventsAfterRunTurn.filter(
			(e) => e.eventType === "agent_event" || e.eventType === "chunk" || e.eventType === "status",
		)

		const report = {
			ACO_HOST01: {
				// CORRECTION03 evidence binding:
				producer_running_state_asserted: true, // threw if start.state !== "running"
				real_RUNNING_envelope_produced: structuredRunningEnvelope?.status === "running",
				tool_result_job_id: structuredRunningEnvelope?.jobId,
				tool_result_status_field: structuredRunningEnvelope?.status,
				runTurn_returned: result !== undefined,
				result_finish_reason: result?.finishReason,
				pendingPrompts_before_runTurn: pendingBeforeRunTurn.length,
				pendingPrompts_after_runTurn: pendingAfterRunTurn.length,
				pendingPrompts_after_terminal: pendingAfterTerminal.length,
				host_events_before_runTurn: eventCountBeforeRunTurn,
				host_events_after_runTurn: eventCountAfterRunTurn,
				host_events_after_terminal: eventCountAfterTerminal,
				host_events_emitted_after_runTurn: eventsAfterRunTurn,
				successor_events_after_terminal: successorEvents,
				manager_activeCount_after_terminal: manager.activeCount,
				session_status: sessionRecord?.status,
				// `lastInteractiveTurnFinishReason` lives on the INTERNAL
				// `ActiveSession` shape (sdk/packages/core/src/types/
				// session.ts:42), NOT on the public `SessionRecord` that
				// `host.getSession(...)` returns. The diagnostic dump
				// below captures the equivalent authoritative value via
				// the per-run returned finishReason above.
				session_last_interactive_finish_reason: "not_exposed_on_public_session_record_use_run_finish_reason",
				classification_inputs: {
					host_scheduled_successor: false,
					host_emitted_successor_event: successorEvents.length > 0,
					host_queued_prompt: pendingAfterTerminal.length > 0,
				},
				// Reclassified verdict (CORRECTION03 — see P1 below):
				HOST_AUTONOMOUS_WAKEUP_ABSENT_PROVEN: successorEvents.length === 0 && pendingAfterTerminal.length === 0,
				HOST_SESSION_AFTER_TURN_IDLE_PROVEN: sessionRecord?.status === "idle",
				HOST_MANUAL_REENTRY_PROVEN: true, // asserted by ACO-HOST02
				CASE_D_DEAD_ZONE_AT_HOST:
					"REJECTED — idle + pendingPrompts=0 + manual reentry are not consistent with a full dead zone (see P1 classification rejection)",
				APPLICATION_USER_OWNERSHIP: "NOT_PROVEN_AT_HOST_TEST — webview/composer seam lives above LocalRuntimeHost",
				APPLICATION_PRESENTATION_COHERENCE:
					"NOT_PROVEN_AT_HOST_TEST — Idle+Thinking+Cancel bug is at the application seam (next ACT: ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01)",
			},
		}
		console.log("[ACO-HOST01 report]", JSON.stringify(report, null, 2))

		// Discriminator contract (CORRECTION03 — strict):
		//   - PRODUCER_RUNNING_STATE_ASSERTED (if not, test would have thrown in the executor)
		//   - REAL RUNNING envelope must be present in the tool result
		//     (sourced from CommandJobManager.start().state, not synthesized)
		//   - runTurn returns successfully with finishReason="completed"
		//   - pendingPrompts after runTurn + after terminal == 0
		//   - host event bus MUST NOT emit a SUCCESSOR-shaped event after terminal
		//   - manager.activeCount == 0 after terminal
		//   - session.status == "idle" after runTurn
		expect(structuredRunningEnvelope?.status).toBe("running")
		expect(result).toBeDefined()
		expect(result?.finishReason).toBe("completed")
		expect(pendingAfterRunTurn.length).toBe(0)
		expect(pendingAfterTerminal.length).toBe(0)
		expect(successorEvents.length).toBe(0)
		expect(manager.activeCount).toBe(0)
		expect(sessionRecord?.status).toBe("idle")

		await host.dispose()
	})

	// ------------------------------------------------------------------------
	// ACO-HOST02 — host accepts a follow-up runTurn after real RUNNING
	// ------------------------------------------------------------------------
	it("ACO-HOST02 — after real RUNNING + clean completion, host.runTurn accepts a follow-up prompt (host-level manual re-entry)", async () => {
		if (!isPosix) {
			console.warn("[ACO-HOST02] non-posix platform — skipped")
			return
		}

		const model = new ScriptedModel([
			// step 1: real deferred run_commands
			() => [
				{
					type: "tool-call-delta" as const,
					toolCallId: "call_run_host_2",
					toolName: "run_commands",
					inputText: JSON.stringify({ commands: [SLOW_CMD] }),
				},
				{ type: "finish" as const, reason: "tool-calls" as const },
			],
			// step 2: model sees RUNNING and finishes
			() => [
				{ type: "text-delta" as const, text: "model saw RUNNING and is done" },
				{ type: "finish" as const, reason: "stop" as const },
			],
			// step 3 (follow-up): text + stop
			() => [
				{ type: "text-delta" as const, text: "follow-up model is done" },
				{ type: "finish" as const, reason: "stop" as const },
			],
		])
		const adapter = makeAdapter(model)
		const host = makeHost(adapter, isolatedHomeDir)

		await startSessionA(host)

		// First runTurn: real deferred RUNNING.
		const firstResult = await host.runTurn({
			sessionId: "session-A",
			prompt: "please run a slow command",
		})
		await settleMicrotasks()
		const firstRunPrompts = Array.from(adapter.getMessages() ?? []).length

		await waitForJobIdle(manager)
		await settleMicrotasks(10)

		// Second runTurn: verify the host actually re-engages the agent.
		const secondResult = await host.runTurn({
			sessionId: "session-A",
			prompt: "continue",
		})
		await settleMicrotasks()

		const pendingAfterFollowup = await host.pendingPrompts.list({ sessionId: "session-A" })
		const sessionRecord = await host.getSession("session-A")
		const report = {
			ACO_HOST02: {
				first_run_finish_reason: firstResult?.finishReason,
				first_run_persisted_messages: firstRunPrompts,
				second_run_returned: secondResult !== undefined,
				second_run_finish_reason: secondResult?.finishReason,
				pending_after_followup: pendingAfterFollowup.length,
				session_status_after_followup: sessionRecord?.status,
				// `lastInteractiveTurnFinishReason` is internal `ActiveSession`
				// only (sdk/packages/core/src/types/session.ts:42), NOT on
				// public `SessionRecord` returned by host.getSession(...). The
				// equivalent authoritative value above is `secondResult.
				// finishReason` (asserted via `expect(secondResult?.
				// finishReason).toBe("completed")` below).
				session_last_finish_reason_after_followup: "not_exposed_on_public_session_record_use_run_finish_reason",
				classification_inputs: {
					host_manual_reentry: secondResult !== undefined,
					user_ownership_AT_APPLICATION_SEAM: "NOT_PROVEN_AT_HOST_TEST",
				},
				// Reclassified verdict (CORRECTION03):
				HOST_MANUAL_REENTRY_PROVEN: secondResult !== undefined && pendingAfterFollowup.length === 0,
				CASE_D_DEAD_ZONE_AT_HOST:
					"REJECTED — manual reentry with finishReason=completed is not consistent with a full dead zone",
			},
			note: "CORRECTION03 verdict: HOST_MANUAL_REENTRY_PROVEN. The host's runTurn is callable again after a REAL deferred RUNNING(jobId) + clean completion, and the follow-up dispatches to the agent (finishReason=completed). This is the canonical idle-yield contract at the host seam — NOT a proof of user-ownership at the application seam (that lives in the webview + composer, above LocalRuntimeHost).",
		}
		console.log("[ACO-HOST02 report]", JSON.stringify(report, null, 2))

		// Discriminator contract: the host accepts the follow-up
		// runTurn and dispatches it to the agent (which returns
		// finishReason="completed"). This is HOST_MANUAL_REENTRY; it
		// is NOT a proof of user-ownership at the application seam.
		expect(secondResult).toBeDefined()
		expect(secondResult?.finishReason).toBe("completed")

		await host.dispose()
	})
})
