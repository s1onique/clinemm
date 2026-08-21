/**
 * ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01
 *
 * Application-seam causal discriminator for the LIVE contradiction:
 *
 *   TaskHeader = Idle
 *   Thinking   = visible
 *   Cancel     = visible
 *
 * This is RECON-ONLY and the FIRST probe of a larger async application-seam
 * ACT sequence. It does not attempt repair. Its only deliverable is a
 * MODELED PUBLICATION COMPOSITION PROFILE captured at the moment the
 * host has yielded to idle after a REAL background-RUNNING turn (the
 * same chronology row 15c CORRECTION03 proves at the host layer).
 *
 * Strategy (application chain, per ACT §3):
 *
 *   Real LocalRuntimeHost (production class via
 *     @cline-internal/core/runtime/host/local-runtime-host)
 *   Real FileSessionService (production class)
 *   Real AgentRuntime (production class via @cline/agents)
 *   Real createShellTool (production class via @cline/core)
 *   Real BackgroundShellExecutor -> Real CommandJobManager.start(...)
 *     (producer-bound RUNNING envelope per row 15c CORRECTION03 P0)
 *   ScriptedModel (the only mocked LLM)
 *
 *   ONE MODELED PUBLICATION COMPOSITION:
 *
 *     runtime snapshot     <- adapter.snapshot() (equivalent to
 *                              host.runtimeSnapshot(sessionId) queried
 *                              by SdkController at SdkController.ts:2967)
 *     canonical mapper     <- mapAgentRuntimeStateSnapshotToArbiterSnapshot
 *     thinkingPublication  <- selectThinkingPresentation({canonicalShadow,
 *                                currentLegacyPhase, seq})
 *                                (same call shape as SdkController.ts:2967)
 *     taskHeaderPublication<- selectTaskHeaderPresentation(
 *                                {canonicalShadowPhase, currentLegacyPhase,
 *                                 seq})
 *                                (same call shape as SdkController.ts:3009)
 *     host session         <- host.getSession("session-A").status
 *
 *   IMPORTANT QUALIFICATION (per Factory reviewer P1 overclaim rejection):
 *
 *     `seq = 1` below is a SYNTHETIC_LOCAL_SELECTOR_INPUT_TOKEN. It is
 *     the same value conceptually that the production MessageIdMinter
 *     would mint (per the W1-epoch-domain-mismatch-red-fix01 contract
 *     that the SAME counter feeds turnState.seq, stateVersion,
 *     _ptadPushId, thinkingPresentation.seq, and taskHeaderPresentation.seq),
 *     but this probe does NOT prove that runtimeSnapshot, the selectors,
 *     stateVersion, _ptadPushId, and webview-state all arose from ONE
 *     ACTUAL production publication transaction. That synchronization
 *     is established by AOPC02 (the NEXT ACT), which exercises the REAL
 *     SdkController.getStateToPostToWebview() producer and pairs the
 *     returned snapshot with the webview-side commit at the SAME
 *     stateVersion.
 *
 *   SYNCHRONIZED_SELECTOR_INPUT_TOKEN = SYNTHETIC_LOCAL
 *
 *   Lower-boundary PROVEN by this probe (per Factory reviewer):
 *
 *     Real LocalRuntimeHost
 *       + Real AgentRuntime.snapshot()
 *       + Real mapAgentRuntimeStateSnapshotToArbiterSnapshot
 *       + Real selectThinkingPresentation
 *       + Real selectTaskHeaderPresentation
 *
 *       = coherent in the modeled composition below.
 *
 *   Lower-boundary UNPROVEN by this probe:
 *
 *     - Real SdkController assembly of thinkingPresentation,
 *       taskHeaderPresentation, turnState, stateVersion, epoch,
 *       _ptadPushId, host override, task/session identity, Cancel
 *       predicates all from a single getStateToPostToWebview() call.
 *
 *     - SdkController has already been a source of stale publication
 *       bugs in this fork (per the C2 fixup history); we cannot claim
 *       a defect is ABOVE SdkController without proving SdkController
 *       itself is internally consistent.
 *
 *     - Real transport / webview reducer / React commit (W2 / W3).
 *
 *   NEXT_UNPROVEN_BOUNDARY = real SdkController state assembly
 *     -> transport
 *     -> webview committed state
 *
 * Promise (bounded):
 *   At one SYNTHETIC_LOCAL_SELECTOR_INPUT_TOKEN, the host + canonical
 *   mapper/selectors composition is internally coherent: agent terminal,
 *   modelStreaming=false, phase=idle, session.status=idle,
 *   pendingToolCalls=[]. This does NOT prove the LIVE webview commits
 *   these values (the W1..W3 boundary lies above this probe AND above
 *   the unproven SdkController assembly; the LIVE Idle+Thinking+Cancel
 *   defect can still be in SdkController, not just in W1..W3).
 *
 * Stop rule (per ACT §15):
 *   "At the same application publication identity, why can
 *    Idle + Thinking + Cancel coexist?"
 *   This probe answers the lower-half question: "is the host +
 *   canonical mapper/selectors chain itself coherent in the modeled
 *   composition?" It explicitly does NOT yet localize the defect.
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
	AgentRuntimeRecoverySnapshot,
	ITelemetryService,
	LiveAgentRuntimeStateSnapshot,
} from "@cline/shared"
import { agentMessagesToMessagesWithMetadata } from "@cline-internal/core/runtime/config/agent-message-codec"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { FileSessionService } from "@cline-internal/core/session/services/file-session-service"
import type { CoreSessionEvent } from "@cline-internal/core/types/events"
import type { TurnPhase } from "@shared/ExtensionMessage"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CommandJobManager } from "../command-job-manager"
import {
	mapAgentRuntimeStateSnapshotToArbiterSnapshot,
	selectTaskHeaderPresentation,
	selectThinkingPresentation,
} from "../task-state-shadow-arbiter-mapper"
import type { ArbiterSnapshot } from "../task-state-shadow-recorder"

// ============================================================================
// Background executor -- producer-bound RUNNING envelope (mirrors row 15c).
// ============================================================================

interface BackgroundExecutorOptions {
	manager: CommandJobManager
	waitBudgetMs: number
	executionDeadlineMs: number
}

function createBackgroundShellExecutor(
	options: BackgroundExecutorOptions,
): (command: string | { command: string; args?: string[] }, cwd: string) => Promise<string> {
	const { manager, waitBudgetMs, executionDeadlineMs } = options
	return async (command: string | { command: string; args?: string[] }, cwd: string): Promise<string> => {
		const start = await manager.start(
			{ command, cwd, waitBudgetMs, executionDeadlineMs },
			{ agentId: "aopc01-host-agent", conversationId: "aopc01-host-conv", iteration: 1 },
		)
		if (start.state !== "running") {
			throw new Error(
				`[AOPC01] expected producer CommandJobManager.start to return state="running" but got "${start.state}" (jobId=${start.jobId}); test seam is invalid`,
			)
		}
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

// ============================================================================
// Scripted LLM (the only mocked surface).
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
// AgentRuntimeBackedAdapter -- wraps the REAL AgentRuntime into the
// SessionRuntime-shaped surface that LocalRuntimeHost expects. Mirrors
// row 15c CORRECTION03 (simplified -- keep only what this probe uses).
// ============================================================================

interface AgentRuntimeBackedAdapterDeps {
	createAgentRuntime: () => AgentRuntime
}

class AgentRuntimeBackedAdapter {
	private readonly listeners = new Set<(event: unknown) => void>()
	private activeRuntime: AgentRuntime | null = null
	private persistedRuntime: AgentRuntime | null = null

	constructor(private readonly deps: AgentRuntimeBackedAdapterDeps) {}

	canStartRun(): boolean {
		return !this.activeRuntime
	}

	subscribeRuntimeEvents(listener: (event: unknown) => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	subscribeEvents(listener: (event: unknown) => void): () => void {
		return this.subscribeRuntimeEvents(listener)
	}

	subscribeRecoveryStateChange(_listener: (sessionId: string, recovery: AgentRuntimeRecoverySnapshot) => void): () => void {
		return () => {}
	}

	getMessages(): readonly AgentMessage[] {
		const rt = this.activeRuntime ?? this.persistedRuntime
		return (rt?.snapshot()?.messages ?? []) as readonly AgentMessage[]
	}

	getAgentId(): string {
		return this.activeRuntime?.snapshot()?.agentId ?? "aopc01-host-agent"
	}

	getConversationId(): string {
		return this.activeRuntime?.snapshot()?.agentId ?? "aopc01-host-conv"
	}

	async run(userMessage: string): Promise<AgentResult> {
		const runtime = this.deps.createAgentRuntime()
		this.activeRuntime = runtime
		const sub = runtime.subscribe((event: unknown) => {
			for (const l of this.listeners) {
				l(event)
			}
		})
		try {
			const startedAt = new Date()
			const runResult = await runtime.run(userMessage)
			return this.buildAgentResult(runResult, startedAt)
		} finally {
			sub()
			this.activeRuntime = null
			this.persistedRuntime = runtime
		}
	}

	async continue(userMessage?: string): Promise<AgentResult> {
		const runtime = this.persistedRuntime
		if (!runtime) {
			throw new Error("continue() called before run()")
		}
		this.activeRuntime = runtime
		const sub = runtime.subscribe((event: unknown) => {
			for (const l of this.listeners) {
				l(event)
			}
		})
		try {
			const startedAt = new Date()
			const runResult = await runtime.continue(userMessage ?? "")
			return this.buildAgentResult(runResult, startedAt)
		} finally {
			sub()
			this.activeRuntime = null
		}
	}

	// Mirrors row 15c CORRECTION03 buildAgentResult: wrap AgentRunResult
	// into the AgentResult-shape the production SessionRuntime builds,
	// because LocalRuntimeHost's withLatestAssistantTurnMetadata calls
	// `result.model.id` and `result.usage.inputTokens` directly. Missing
	// those fields is a test seam invalidity (mirrors row 15c §P0).
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
			// Convert `AgentMessage[]` -> `MessageWithMetadata[]` via
			// the REAL production helper. The two role vocabularies
			// differ (`AgentMessageRole = "user" | "assistant" |
			// "tool"`; `MessageRole = "user" | "assistant"`); the
			// production helper coerces `"tool"` to `"user"` (which
			// is fine -- `withLatestAssistantTurnMetadata` only
			// writes `metrics` onto the LAST assistant turn and
			// ignores tool messages; the production `SessionRuntime.
			// buildLegacyResult` (orchestration/session-runtime-orchestrator.ts:1488)
			// uses the same helper).
			//
			// This is the type-honest alternative to `as unknown as
			// never`. Per Factory reviewer P1 hygiene: do not weaken
			// types with `as never` to silence vocabulary mismatches;
			// use the existing correct shape (or a typed adapter).
			// Row 15c CORRECTION03 carries the same production helper
			// (see aco01-correction03.c24-c-bridge.test.ts:425); both
			// row 15c and this AOPC01 should use this helper
			// (see the row 15d P1 finding below -- the bridge tsconfig
			// include drift on row 15c surfaces 3 typecheck errors
			// that this AOPC01-typed-helper avoids).
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

	abort(_reason?: unknown): void {
		this.activeRuntime?.abort()
	}

	async shutdown(_reason?: string, _timeoutMs?: number): Promise<void> {
		this.activeRuntime = null
		this.persistedRuntime = null
	}

	snapshot(): LiveAgentRuntimeStateSnapshot | undefined {
		return (this.activeRuntime ?? this.persistedRuntime)?.snapshot() as LiveAgentRuntimeStateSnapshot | undefined
	}
}

// ============================================================================
// Utilities.
// ============================================================================

const isPosix = process.platform !== "win32"
const SLOW_CMD = isPosix ? "/bin/sh -c 'sleep 0.3'" : "ping -n 1 127.0.0.1"

async function settleMicrotasks(times = 5): Promise<void> {
	for (let i = 0; i < times; i += 1) {
		await new Promise((r) => setImmediate(r))
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

function makeScriptedModel(): ScriptedModel {
	return new ScriptedModel([
		// step 1: emit one run_commands tool call + finish.
		() => [
			{
				type: "tool-call-delta" as const,
				toolCallId: "call_run_aopc01_1",
				toolName: "run_commands",
				inputText: JSON.stringify({ commands: [SLOW_CMD] }),
			},
			{ type: "finish" as const, reason: "tool-calls" as const },
		],
		// step 2: emit text + stop (agent finishes after seeing RUNNING).
		() => [
			{ type: "text-delta" as const, text: "model saw RUNNING and is done" },
			{ type: "finish" as const, reason: "stop" as const },
		],
	])
}

function makeHost(adapter: AgentRuntimeBackedAdapter, isolatedHomeDir: string): LocalRuntimeHost {
	const runtimeBuilder = {
		build: vi.fn().mockReturnValue({
			tools: [],
			shutdown: vi.fn().mockResolvedValue(undefined),
		}),
	}
	const sessionsDir = join(isolatedHomeDir, "sessions")
	return new LocalRuntimeHost({
		distinctId: "aopc01-host",
		sessionService: new FileSessionService(sessionsDir),
		runtimeBuilder: runtimeBuilder as never,
		createAgent: () => adapter as never,
	})
}

/**
 * Derive the canonical shadow phase from the runtime snapshot at the
 * synchronous capture instant. Mirrors SdkController.getLocalShadowPhase()
 * without coupling to its selector (this is observation-only on the
 * one captured snapshot -- not a re-implementation of getLocalShadowPhase).
 */
function deriveCanonicalShadowPhase(snap: LiveAgentRuntimeStateSnapshot | undefined): TurnPhase | undefined {
	if (!snap) {
		return undefined
	}
	if (snap.status === "running") {
		return "streaming"
	}
	if (snap.status === "completed" || snap.status === "aborted") {
		return "idle"
	}
	// `snap.status` type is "failed" | "idle" (per the canonical
	// AgentRuntimeStateSnapshot vocabulary). "failed" maps to the
	// legacy "error" turn phase; "idle" maps to "idle".
	if (snap.status === "failed") {
		return "error"
	}
	return "idle"
}

// ============================================================================
// Probe.
// ============================================================================

describe("ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01 / AOPC01", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
	}
	let isolatedHomeDir = ""
	let manager: CommandJobManager
	let shellTool: ReturnType<typeof createShellTool>

	beforeEach(() => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "aopc01-host-bridge-"))
		process.env.HOME = isolatedHomeDir
		process.env.CLINE_DIR = join(isolatedHomeDir, ".cline")
		manager = new CommandJobManager()
		shellTool = createShellTool(
			createBackgroundShellExecutor({
				manager,
				waitBudgetMs: 50,
				executionDeadlineMs: 30_000,
			}),
			{ cwd: process.cwd(), bashTimeoutMs: 30_000 },
		)
	})

	afterEach(async () => {
		await manager.dispose()
		process.env.HOME = envSnapshot.HOME
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR
		rmSync(isolatedHomeDir, { recursive: true, force: true })
	})

	it("AOPC01 -- synchronized publication identity at host idle-yield", async () => {
		if (!isPosix) {
			console.warn("[AOPC01] non-posix platform -- skipped")
			return
		}

		const model = makeScriptedModel()
		const { telemetry } = createTelemetryMock()
		const adapter = new AgentRuntimeBackedAdapter({
			createAgentRuntime: () => new AgentRuntime({ model, tools: [shellTool], telemetry }),
		})
		const host = makeHost(adapter, isolatedHomeDir)

		const hostEvents: { sessionId: string; eventType: string }[] = []
		host.subscribe((event: CoreSessionEvent) => {
			const sid = (event.payload as { sessionId?: string }).sessionId ?? ""
			hostEvents.push({ sessionId: sid, eventType: event.type })
		})

		await host.startSession({
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

		await host.runTurn({ sessionId: "session-A", prompt: "please run a slow command" })
		await waitForJobIdle(manager)
		await settleMicrotasks(10)

		// =================================================================
		// Synchronized publication identity.
		// =================================================================

		const runtimeSnapshot = adapter.snapshot()
		expect(runtimeSnapshot, "adapter.snapshot() must be defined at idle-yield").toBeDefined()
		const arbiter: ArbiterSnapshot = mapAgentRuntimeStateSnapshotToArbiterSnapshot(
			runtimeSnapshot as unknown as Parameters<typeof mapAgentRuntimeStateSnapshotToArbiterSnapshot>[0],
		)

		const sessionRecord = await host.getSession("session-A")
		const sessionStatus = sessionRecord?.status ?? "unknown"

		const currentLegacyPhase: TurnPhase = sessionStatus === "running" ? "streaming" : "idle"

		// SYNCHETIC_LOCAL_SELECTOR_INPUT_TOKEN -- see file header.
		// AOPC02 (NEXT ACT) will replace this with the REAL `seq` from
		// SdkController.turnStateTracker.get().seq (which equals the wire
		// `stateVersion` per W1-epoch-domain-mismatch-red-fix01).
		const seq = 1

		const canonicalShadowPhase = deriveCanonicalShadowPhase(runtimeSnapshot)

		const thinkingPresentation = selectThinkingPresentation({
			canonicalShadow: arbiter,
			currentLegacyPhase,
			seq,
		})
		const taskHeaderPresentation = selectTaskHeaderPresentation({
			canonicalShadowPhase,
			currentLegacyPhase,
			seq,
		})

		// =================================================================
		// Invariants -- synchronized publication identity is coherent.
		// =================================================================

		expect(sessionStatus, "host session.status").toBe("idle")
		expect(arbiter.execution.modelStreaming, "arbiter.execution.modelStreaming").toBe(false)
		expect(arbiter.execution.tooling, "arbiter.execution.tooling").toBe(false)
		expect(arbiter.execution.awaitingApproval, "arbiter.execution.awaitingApproval").toBe(false)
		expect(arbiter.pendingToolCalls.length, "arbiter.pendingToolCalls.length").toBe(0)
		expect(thinkingPresentation.modelStreaming, "thinkingPresentation.modelStreaming").toBe(false)
		expect(thinkingPresentation.seq, "thinkingPresentation.seq").toBe(seq)
		expect(taskHeaderPresentation.seq, "taskHeaderPresentation.seq").toBe(seq)

		expect(
			["idle", "completed", "awaiting_followup", "error"].includes(taskHeaderPresentation.phase),
			`taskHeaderPresentation.phase=${taskHeaderPresentation.phase} (source=${taskHeaderPresentation.source}) must be a non-streaming terminal after host idle-yield`,
		).toBe(true)

		const projectionProfile = {
			seqTokenKind: "SYNTHETIC_LOCAL_SELECTOR_INPUT_TOKEN",
			seq,
			hostSessionStatus: sessionStatus,
			arbiterStatus: arbiter.status,
			arbiterModelStreaming: arbiter.execution.modelStreaming,
			arbiterTooling: arbiter.execution.tooling,
			arbiterAwaitingApproval: arbiter.execution.awaitingApproval,
			arbiterPendingToolCallsLength: arbiter.pendingToolCalls.length,
			arbiterRecoveryState: arbiter.recoveryState,
			currentLegacyPhase,
			canonicalShadowPhase,
			thinkingPresentationSource: thinkingPresentation.source,
			thinkingPresentationModelStreaming: thinkingPresentation.modelStreaming,
			thinkingPresentationSeq: thinkingPresentation.seq,
			taskHeaderPresentationPhase: taskHeaderPresentation.phase,
			taskHeaderPresentationSource: taskHeaderPresentation.source,
			taskHeaderPresentationSeq: taskHeaderPresentation.seq,
			runtimeStatus: runtimeSnapshot?.status,
			runtimeExecutionModelStreaming: (
				runtimeSnapshot as unknown as {
					execution?: { modelStreaming?: boolean }
				}
			)?.execution?.modelStreaming,
			hostEventCount: hostEvents.length,
			hostEventTypes: [...new Set(hostEvents.map((e) => e.eventType))],
		}
		// eslint-disable-next-line no-console
		console.log("[AOPC01] modeled publication composition profile:", projectionProfile)
	})
})
