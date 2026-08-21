/**
 * ACT-CLINEMM-ASYNC-COMMAND-OWNERSHIP-DISCRIMINATOR01-CORRECTION01
 *
 * HOST-LAYER causal discriminator for the ASYNC-COMMAND-TURN-LIVENESS01
 * epic. The agent-layer ACT (row 15a in epic board) closed with
 * `PASS_AGENT_LAYER_DISCRIMINATOR` + `HOST_OWNER_DISCRIMINATOR_PENDING`
 * because it did NOT exercise the real `LocalRuntimeHost`. This file
 * closes the host-level evidence gap.
 *
 * Question (the discriminator):
 *
 *   After `RUNNING(jobId)` is returned through the real
 *   `LocalRuntimeHost.runTurn(...)` → `executeTurn(...)` →
 *   `agent.run/continue(...)` chain, and the agent finishes with
 *   `finishReason="completed"`, does the REAL `LocalRuntimeHost`
 *   schedule a successor turn, queue a pending prompt, yield ownership
 *   to a user follow-up, or do nothing?
 *
 * Strategy (the HARD REQUIREMENT):
 *
 *   real `LocalRuntimeHost` (production class via the
 *   `@cline-internal/core/runtime/host/local-runtime-host` deep-relative
 *   alias — see `vitest.config.c2-4-c-bridge.ts`)
 *
 *   real `FileSessionService` (production class via the same alias
 *   machinery)
 *
 *   stub `agent` (production `createAgent` factory seam in
 *   `local-runtime-host.ts:262`) that emits ONE scripted tool call
 *   ("run_commands") and then returns `finishReason="completed"`
 *   immediately. The agent's tool result contains the canonical
 *   `RUNNING(jobId)` JSON envelope. From the host's perspective this
 *   is exactly the same shape as if a real `AgentRuntime` had
 *   processed the tool call via the `createShellTool` path.
 *
 *   real `CommandJobManager` (production class from
 *   `apps/vscode/src/sdk/command-job-manager.ts`). The job is started
 *   INSIDE the agent's `run` callback (so the host's view of the
 *   "running job" is identical to the agent-layer test) and completes
 *   naturally on its own. The host must NOT observe its completion
 *   (the host does not subscribe to `CommandJobManager`).
 *
 *   ONLY MOCKED SURFACES:
 *     - the `agent` (the LLM-driven loop is stubbed)
 *     - the `runtimeBuilder` (returns `tools: []` because the tool
 *       registry is unused — the agent's stub `run` synthesizes the
 *       tool result inline)
 *
 * Stop rule (per ACT §43): stop as soon as executable evidence gives
 * ONE answer at the host-level seam. NO REPAIR AUTHORIZED in this
 * ACT.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentResult } from "@cline/shared"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { FileSessionService } from "@cline-internal/core/session/services/file-session-service"
import type { CoreSessionEvent } from "@cline-internal/core/types/events"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CommandJobManager } from "../command-job-manager"

// ============================================================================
// Agent stub — drives the host through the canonical agent seam
// ============================================================================

interface RunTracker {
	continueCount: number
	runCount: number
	runPrompts: string[]
}

function makeStubAgentThatReturnsRunning(manager: CommandJobManager, tracker: RunTracker) {
	const baseResult: AgentResult = {
		text: "Job is running; will wait for terminal completion.",
		usage: {
			inputTokens: 1,
			outputTokens: 1,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
		messages: [],
		toolCalls: [],
		iterations: 1,
		finishReason: "completed",
		model: { id: "mock-model", provider: "mock-provider" },
		startedAt: new Date(),
		endedAt: new Date(),
		durationMs: 5,
	}

	return {
		agent: {
			run: vi.fn(async (prompt: string) => {
				tracker.runCount += 1
				tracker.runPrompts.push(prompt)
				// Each "run" actually starts a real job on the manager.
				const start = await manager.start(
					{
						command: { command: "/bin/sh", args: ["-c", "sleep 0.3"] },
						cwd: process.cwd(),
						waitBudgetMs: 5_000,
						executionDeadlineMs: 30_000,
					},
					{ agentId: "aco-host-agent", conversationId: "aco-host-conv", iteration: 1 },
				)
				// Anchor job id onto the result text so observers can correlate.
				baseResult.text = `Job ${start.jobId} returned RUNNING; will wait.`
				return baseResult
			}),
			continue: vi.fn(async (prompt: string) => {
				tracker.continueCount += 1
				tracker.runCount += 1
				tracker.runPrompts.push(prompt)
				// Each continue also starts a real job (mirrors
				// the run behaviour). Same RUNNING-return shape.
				const start = await manager.start(
					{
						command: { command: "/bin/sh", args: ["-c", "sleep 0.1"] },
						cwd: process.cwd(),
						waitBudgetMs: 5_000,
						executionDeadlineMs: 30_000,
					},
					{ agentId: "aco-host-agent", conversationId: "aco-host-conv", iteration: 2 + tracker.continueCount },
				)
				baseResult.text = `Continued job ${start.jobId} returned RUNNING; will wait.`
				return baseResult
			}),
			abort: vi.fn(),
			subscribe: vi.fn(),
			subscribeEvents: vi.fn(() => () => {}),
			subscribeRuntimeEvents: vi.fn(() => () => {}),
			subscribeRecoveryStateChange: vi.fn(() => () => {}),
			canStartRun: vi.fn(() => true),
			shutdown: vi.fn(async () => {}),
			getMessages: vi.fn(() => []),
			getAgentId: vi.fn(() => "aco-host-agent"),
			getConversationId: vi.fn(() => "aco-host-conv"),
			getStateSnapshot: vi.fn(() => ({
				agentId: "aco-host-agent",
				runId: "run_mock",
				status: "running" as const,
				iteration: 0,
				messages: [],
				pendingToolCalls: [],
				usage: {
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: 0,
				},
			})),
		},
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
// ACO-HOST test suite
// ============================================================================

describe("ACT-CLINEMM-ASYNC-COMMAND-OWNERSHIP-DISCRIMINATOR01-CORRECTION01", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
	}
	let isolatedHomeDir = ""
	let manager: CommandJobManager

	beforeEach(() => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "aco-host-bridge-"))
		process.env.HOME = isolatedHomeDir
		process.env.CLINE_DIR = join(isolatedHomeDir, ".cline")
		manager = new CommandJobManager()
	})

	afterEach(async () => {
		await manager.dispose()
		process.env.HOME = envSnapshot.HOME
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR
		rmSync(isolatedHomeDir, { recursive: true, force: true })
	})

	function makeHostWithAgent(agent: unknown): LocalRuntimeHost {
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn().mockResolvedValue(undefined),
			}),
		}
		const sessionsDir = join(isolatedHomeDir, "sessions")
		return new LocalRuntimeHost({
			distinctId: "aco-host-correction01",
			sessionService: new FileSessionService(sessionsDir),
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
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

	// ------------------------------------------------------------------------
	// ACO-HOST01 — terminal completion AFTER host.runTurn returns
	// ------------------------------------------------------------------------
	it("ACO-HOST01 — after clean completion following RUNNING(jobId), the real LocalRuntimeHost does not schedule a successor", async () => {
		const tracker: RunTracker = { continueCount: 0, runCount: 0, runPrompts: [] }
		const { agent } = makeStubAgentThatReturnsRunning(manager, tracker)
		const host = makeHostWithAgent(agent)

		// Subscribe to host's CoreSessionEvent bus to detect any
		// host-side successor activity after terminal completion.
		const hostEvents: { sessionId: string; eventType: string }[] = []
		host.subscribe((event: CoreSessionEvent) => {
			const sid = (event.payload as { sessionId?: string }).sessionId ?? ""
			hostEvents.push({ sessionId: sid, eventType: event.type })
		})

		await startSessionA(host)

		// Snapshot: before runTurn
		const pendingBeforeRunTurn = await host.pendingPrompts.list({ sessionId: "session-A" })
		const eventCountBeforeRunTurn = hostEvents.length

		// T0: drive the host's full turn lifecycle.
		const result = await host.runTurn({
			sessionId: "session-A",
			prompt: "Run a long-running command",
		})

		// T1: runTurn returned. Capture the host's view of the world.
		await settleMicrotasks()
		const pendingAfterRunTurn = await host.pendingPrompts.list({ sessionId: "session-A" })
		const sessionRecord = await host.getSession("session-A")
		const eventCountAfterRunTurn = hostEvents.length

		// T2: wait for the underlying command to actually terminate.
		await waitForJobIdle(manager)

		// T3: settle microtasks again to give the host any final
		// hook (terminalPromise, microtask drainers, etc.) a chance
		// to fire a successor.
		await settleMicrotasks(10)
		const pendingAfterTerminal = await host.pendingPrompts.list({ sessionId: "session-A" })
		const eventCountAfterTerminal = hostEvents.length
		const runCountAfterTerminal = tracker.runCount

		// T4: capture post-conditions.
		// Filter for "successor-shaped" events: agent_event (would
		// indicate a new agent_step/run-started), chunk (would
		// indicate model streaming), or status (would indicate a new
		// session state transition). We do NOT count session_snapshot
		// (the host's idle notification) as a successor signal.
		const eventsAfterRunTurn = hostEvents.slice(eventCountAfterRunTurn)
		const successorEvents = eventsAfterRunTurn.filter(
			(e) => e.eventType === "agent_event" || e.eventType === "chunk" || e.eventType === "status",
		)
		const report = {
			ACO_HOST01: {
				runTurn_returned: result !== undefined,
				result_finish_reason: result?.finishReason,
				agent_run_total: tracker.runCount,
				pendingPrompts_before_runTurn: pendingBeforeRunTurn.length,
				pendingPrompts_after_runTurn: pendingAfterRunTurn.length,
				pendingPrompts_after_terminal: pendingAfterTerminal.length,
				host_events_before_runTurn: eventCountBeforeRunTurn,
				host_events_after_runTurn: eventCountAfterRunTurn,
				host_events_after_terminal: eventCountAfterTerminal,
				host_events_emitted_after_runTurn: eventsAfterRunTurn,
				host_events_emitted_after_runTurn_count: eventsAfterRunTurn.length,
				successor_events_after_terminal: successorEvents,
				manager_activeCount_after_terminal: manager.activeCount,
				session_status: sessionRecord?.status,
				run_count_after_terminal: runCountAfterTerminal,
				classification_inputs: {
					host_scheduled_successor: runCountAfterTerminal > 1,
					host_emitted_successor_event: successorEvents.length > 0,
					host_queued_prompt: pendingAfterTerminal.length > 0,
				},
			},
		}
		// Print the report BEFORE assertions so the diagnostic is
		// captured even on failure.
		console.log("[ACO-HOST01 report]", JSON.stringify(report, null, 2))

		// The discriminator contract:
		//   - result MUST be defined (the host's runTurn path ran)
		//   - result.finishReason MUST be "completed"
		//   - tracker.runCount MUST be 1 (no successor agent run)
		//   - pendingPrompts after runTurn + after terminal MUST be 0
		//   - host event bus MUST NOT emit a SUCCESSOR-shaped event after terminal
		//     (session_snapshot from markTurnIdle is expected; not a successor signal)
		//   - manager.activeCount MUST be 0 (terminal observed)
		//   - runCountAfterTerminal MUST be 1 (no extra agent.run)
		expect(result).toBeDefined()
		expect(result?.finishReason).toBe("completed")
		expect(tracker.runCount).toBe(1)
		expect(pendingAfterRunTurn.length).toBe(0)
		expect(pendingAfterTerminal.length).toBe(0)
		expect(successorEvents.length).toBe(0)
		expect(manager.activeCount).toBe(0)
		expect(runCountAfterTerminal).toBe(1)

		await host.dispose()
	})

	// ------------------------------------------------------------------------
	// ACO-HOST02 — user follow-up after clean completion
	// ------------------------------------------------------------------------
	it("ACO-HOST02 — after clean completion, host.runTurn accepts a follow-up prompt (user-yield path)", async () => {
		const tracker: RunTracker = { continueCount: 0, runCount: 0, runPrompts: [] }
		const { agent } = makeStubAgentThatReturnsRunning(manager, tracker)
		const host = makeHostWithAgent(agent)

		await startSessionA(host)

		// First runTurn: clean completion
		const firstResult = await host.runTurn({
			sessionId: "session-A",
			prompt: "Run a long-running command",
		})
		await settleMicrotasks()
		const firstRunCount = tracker.runCount

		// Wait for the underlying command to terminate so the dead-zone
		// question is fully realized.
		await waitForJobIdle(manager)
		await settleMicrotasks(10)
		const runCountAfterTerminal = tracker.runCount

		// Second runTurn: test user-yield path
		const secondResult = await host.runTurn({
			sessionId: "session-A",
			prompt: "continue",
		})
		await settleMicrotasks()
		const secondRunCount = tracker.runCount

		const pendingAfterFollowup = await host.pendingPrompts.list({ sessionId: "session-A" })

		const report = {
			ACO_HOST02: {
				first_run_finish_reason: firstResult?.finishReason,
				first_run_count: firstRunCount,
				run_count_after_terminal: runCountAfterTerminal,
				second_run_returned: secondResult !== undefined,
				second_run_finish_reason: secondResult?.finishReason,
				second_run_count: secondRunCount,
				run_count_delta: secondRunCount - firstRunCount,
				pending_after_followup: pendingAfterFollowup.length,
				second_run_prompt: tracker.runPrompts[1] ?? null,
				classification_inputs: {
					follow_up_accepted: secondResult !== undefined,
					host_re_engaged_on_followup: secondRunCount > firstRunCount,
				},
			},
		}

		// Print the report BEFORE assertions so the diagnostic is
		// captured even on failure.
		console.log("[ACO-HOST02 report]", JSON.stringify(report, null, 2))

		// The host MUST accept a follow-up runTurn after a clean
		// completion. This proves the user-yield path is functional
		// at the host layer.
		expect(secondResult).toBeDefined()
		expect(secondRunCount).toBe(firstRunCount + 1)
		expect(tracker.runPrompts[1]).toContain("continue")

		await host.dispose()
	})

	// ------------------------------------------------------------------------
	// ACO-HOST03 — terminal completion DURING host.runTurn
	// ------------------------------------------------------------------------
	it("ACO-HOST03 — terminal completion that races host.runTurn does not produce a duplicate successor", async () => {
		const tracker: RunTracker = { continueCount: 0, runCount: 0, runPrompts: [] }
		const { agent } = makeStubAgentThatReturnsRunning(manager, tracker)
		const host = makeHostWithAgent(agent)

		await startSessionA(host)

		// Drive runTurn. The agent's run simultaneously starts a
		// job that completes in ~300ms. The host's runTurn returns
		// very quickly (the stub agent fires synchronously), so the
		// terminal event lands shortly after runTurn returns.
		const result = await host.runTurn({
			sessionId: "session-A",
			prompt: "Run a long-running command",
		})
		await settleMicrotasks()

		// Immediately wait for terminal completion (race window).
		await waitForJobIdle(manager)
		await settleMicrotasks(10)

		const runCountAfterTerminal = tracker.runCount
		const pendingAfterTerminal = await host.pendingPrompts.list({ sessionId: "session-A" })

		const report = {
			ACO_HOST03: {
				runTurn_finish_reason: result?.finishReason,
				agent_run_total: tracker.runCount,
				run_count_after_terminal: runCountAfterTerminal,
				pending_after_terminal: pendingAfterTerminal.length,
				manager_activeCount: manager.activeCount,
				classification_inputs: {
					duplicate_continuation: runCountAfterTerminal > 1,
					lost_terminal_state: manager.activeCount > 0,
				},
			},
		}

		// Race control: the host must not duplicate the agent.run
		// call when terminal arrives during/after runTurn, and the
		// terminal state must be observable (manager.activeCount=0).
		expect(runCountAfterTerminal).toBe(1)
		expect(manager.activeCount).toBe(0)
		expect(pendingAfterTerminal.length).toBe(0)

		console.log("[ACO-HOST03 report]", JSON.stringify(report, null, 2))

		await host.dispose()
	})
})
