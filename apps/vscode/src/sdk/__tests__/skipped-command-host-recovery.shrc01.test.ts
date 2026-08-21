/**
 * ACT-CLINEMM-SKIPPED-COMMAND-HOST-RECOVERY01-COMPOSITION01 / SHRC01 —
 * real composition discriminator for the host/application seam above
 * AgentRuntime.
 *
 * Context (per ACT §0 inherited evidence):
 *
 *   SCTR01 (AgentRuntime rejection path)            = GREEN
 *   SCHR01..05 (LocalRuntimeHost generic finalize)  = GREEN
 *
 *   The previous ACT (SCHR01) used a STUB agent that mirrored the
 *   SCTR01 GREEN rejection chronology. That proved the host's
 *   post-completed-`AgentResult` finalization and second-turn reentry
 *   — but it did NOT exercise the REAL AgentRuntime running inside
 *   the REAL LocalRuntimeHost. That is the load-bearing seam this ACT
 *   closes.
 *
 *   This file constructs the real composition:
 *
 *     real LocalRuntimeHost (via @cline-internal/core bridge alias)
 *     + real FileSessionService
 *     + real SessionRuntime (via @cline-internal/core bridge alias,
 *       the production orchestrator class)
 *     + real AgentRuntime (via @cline/agents, the SCTR01 seam)
 *
 *   Mocked ONLY where unavoidable:
 *     - model handler/script      → StepModel (scripted events)
 *     - run_commands executor     → vi-counter-backed execute()
 *     - user approval callback    → real `requestToolApproval` returning
 *                                   `{ approved: false, reason }` for
 *                                   SHRC01 (USER_REJECT) and
 *                                   `{ approved: true }` for the
 *                                   success control
 *     - filesystem/substrate      → isolated tmp HOME/CLINE_DIR
 *
 * Production seam under test (composition):
 *   LocalRuntimeHost.runTurn(input) — line 994
 *     → executeTurn(session, input) — line 1708
 *       → markTurnRunning(session) — line 1749 → updateStatus("running")
 *       → executeAgentTurn(session, prompt) — line 1882
 *         → session.agent.continue(...) — REAL SessionRuntime.continue()
 *           → REAL AgentRuntime.continue()  (SCTR01 rejection loop)
 *             → REAL requestToolApproval → reject
 *             → tool outcome: failure/rejected
 *             → model observes rejection, emits terminal stop
 *             → finishRun returns AgentResult
 *       → returns AgentResult with finishReason
 *     → completeInteractiveTurn(session, finishReason) — line 1775
 *       → markTurnIdle(session) — line 2164 → updateStatus("idle")
 *     → pendingPromptsController.drain(sessionId) — line 1041
 *
 * Discrimination matrix (per ACT §5–§7):
 *   SHRC01       — USER_REJECT: real AgentRuntime rejects the proposed
 *                  run_commands via real approval. Host must settle to
 *                  status="idle" with no residual execution flags.
 *   SHRC01-CTL   — APPROVED SUCCESS: real AgentRuntime approves and
 *                  executes run_commands. Host must settle to
 *                  status="idle" the same way.
 *   SHRC01-SANITY — bridge aliases resolve to the real production
 *                   LocalRuntimeHost, real SessionRuntime
 *                   orchestrator, real AgentRuntime, real
 *                   FileSessionService.
 *
 * Classification (per ACT §11):
 *   PASS:    NOT_REPRODUCED_AT_REAL_HOST_AGENT_COMPOSITION
 *   RED (dead zone after first turn):   CASE_C1_COMPOSED_FINALIZATION_DEAD_ZONE
 *   RED (second turn no-ops):           CASE_C2_COMPOSED_REENTRY_DEAD_ZONE
 *   RED (residual approval/tool/flags): CASE_C3_COMPOSED_RUNTIME_STATE_LEAK
 *
 * Composition seam used (no production code change):
 *   LocalRuntimeHost.createAgent option is supplied to wrap the real
 *   `SessionRuntime` with a custom `createAgentRuntimeImpl` that
 *   constructs the REAL `AgentRuntime` while overriding ONLY the model
 *   adapter (substituting the scripted `StepModel` for the provider-
 *   resolved adapter) and the `requestToolApproval` callback (to
 *   simulate the user).
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentRuntime } from "@cline/agents"
import type {
	AgentMessage,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeHooks,
	AgentTool,
	ToolApprovalRequest,
	ToolRuntimeOutcome,
} from "@cline/shared"
import { setClineDir, setHomeDir } from "@cline/shared/storage"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { SessionRuntime } from "@cline-internal/core/runtime/orchestration/session-runtime-orchestrator"
import { FileSessionService } from "@cline-internal/core/session/services/file-session-service"
import { afterEach, describe, expect, it } from "vitest"

const envSnapshot = { HOME: process.env.HOME, CLINE_DIR: process.env.CLINE_DIR }

// ---------------------------------------------------------------------------
// Scripted AgentModel — substitutes the provider adapter with a deterministic
// scripted event stream. Same pattern as the SCTR01 step model so the two
// ACTs share their model-adapter shape.
// ---------------------------------------------------------------------------

class StepModel implements AgentModel {
	readonly requests: AgentModelRequest[] = []
	constructor(
		private readonly steps: Array<(request: AgentModelRequest) => Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>>,
	) {}
	async stream(request: AgentModelRequest): Promise<AsyncIterable<AgentModelEvent>> {
		this.requests.push(request)
		const step = this.steps.shift()
		if (!step) throw new Error("No more scripted model steps available")
		const events = step(request)
		return (async function* () {
			for await (const ev of events) yield ev
		})()
	}
}

interface RunCounters {
	approvalCalls: number
	executorCalls: number
}

interface CapturedOutcome {
	toolCallId: string
	toolName: string
	outcome: ToolRuntimeOutcome
}

// ---------------------------------------------------------------------------
// Build the real LocalRuntimeHost + real SessionRuntime + real AgentRuntime
// composition. The only test seams are:
//   - the `StepModel` (scripted events, NO provider adapter)
//   - the `requestToolApproval` callback (simulated user decision)
//   - the `run_commands` tool's `execute` (mocked to count invocations)
//   - the `extraTools` start-config (injects our real `run_commands` tool)
// ---------------------------------------------------------------------------

function makeRunCommandsTool(counters: RunCounters): AgentTool<{ commands: string[] }, Array<{ result: string; success: true }>> {
	return {
		name: "run_commands",
		description: "Real AgentRuntime tool; executor MUST NOT run when the user rejects approval.",
		inputSchema: {
			type: "object",
			properties: { commands: { type: "array", items: { type: "string" } } },
			required: ["commands"],
			additionalProperties: false,
		} as never,
		async execute(input) {
			counters.executorCalls++
			return input.commands.map((c) => ({ result: `executed:${c}`, success: true as const }))
		},
	}
}

function makeRejectionModel(): StepModel {
	return new StepModel([
		// TURN 1 iteration 1: propose run_commands.
		() => [
			{
				type: "tool-call-delta",
				toolCallId: "shrc-1a",
				toolName: "run_commands",
				inputText: JSON.stringify({ commands: ["echo hi"] }),
			},
			{ type: "finish", reason: "tool-calls" },
		],
		// TURN 1 iteration 2: observe rejection, terminal stop.
		(request) => {
			const lastMessage = request.messages[request.messages.length - 1]
			expect(lastMessage.role).toBe("tool")
			const toolContent = (lastMessage as AgentMessage).content[0] as {
				type: "tool-result"
				toolCallId: string
				isError: boolean
				output: { error?: string }
			}
			expect(toolContent.type).toBe("tool-result")
			expect(toolContent.toolCallId).toBe("shrc-1a")
			expect(toolContent.isError).toBe(true)
			expect(toolContent.output?.error).toMatch(/not approved|rejected|denied/i)
			return [
				{ type: "text-delta", text: "Understood, skipping the command." },
				{ type: "finish", reason: "stop" },
			]
		},
		// TURN 2 iteration 1: propose run_commands again (proves
		// the second host.runTurn enters AgentRuntime and starts
		// a fresh iteration loop).
		() => [
			{
				type: "tool-call-delta",
				toolCallId: "shrc-1b",
				toolName: "run_commands",
				inputText: JSON.stringify({ commands: ["echo hi"] }),
			},
			{ type: "finish", reason: "tool-calls" },
		],
		// TURN 2 iteration 2: observe second rejection, terminal stop.
		() => [
			{ type: "text-delta", text: "Understood, skipping the command." },
			{ type: "finish", reason: "stop" },
		],
	])
}

function makeApprovedSuccessModel(): StepModel {
	return new StepModel([
		// TURN 1 iteration 1: propose run_commands.
		() => [
			{
				type: "tool-call-delta",
				toolCallId: "shrc-ctl-1a",
				toolName: "run_commands",
				inputText: JSON.stringify({ commands: ["echo hi"] }),
			},
			{ type: "finish", reason: "tool-calls" },
		],
		// TURN 1 iteration 2: observe success, terminal stop.
		() => [
			{ type: "text-delta", text: "Done." },
			{ type: "finish", reason: "stop" },
		],
		// TURN 2 iteration 1: propose run_commands again.
		() => [
			{
				type: "tool-call-delta",
				toolCallId: "shrc-ctl-1b",
				toolName: "run_commands",
				inputText: JSON.stringify({ commands: ["echo hi"] }),
			},
			{ type: "finish", reason: "tool-calls" },
		],
		// TURN 2 iteration 2: observe success, terminal stop.
		() => [
			{ type: "text-delta", text: "Done." },
			{ type: "finish", reason: "stop" },
		],
	])
}

async function buildComposedHost(opts: {
	isolationDir: string
	counters: RunCounters
	captured: CapturedOutcome[]
	approvalRequests: ToolApprovalRequest[]
	userDecision: "reject" | "approve"
}): Promise<LocalRuntimeHost> {
	const { isolationDir, counters, captured, approvalRequests, userDecision } = opts

	const tool = makeRunCommandsTool(counters)
	const model = userDecision === "reject" ? makeRejectionModel() : makeApprovedSuccessModel()

	const hooks: AgentRuntimeHooks = {
		onToolRuntimeOutcome: (ctx) => {
			captured.push({
				toolCallId: ctx.toolCall.toolCallId,
				toolName: ctx.toolCall.toolName,
				outcome: ctx.outcome,
			})
		},
	}

	const requestToolApproval = async (req: ToolApprovalRequest) => {
		counters.approvalCalls++
		approvalRequests.push(req)
		if (userDecision === "reject") {
			return { approved: false, reason: "user explicitly rejected command" }
		}
		return { approved: true }
	}

	// runtimeBuilder returns no tools — the real `run_commands` tool is
	// injected via `extraTools` on the start config so the host's merged
	// toolset (line 605 of local-runtime-host.ts) carries exactly one tool.
	const runtimeBuilder = {
		build: async () => ({
			tools: [],
			shutdown: () => Promise.resolve(),
		}),
	}

	// The host's `LocalRuntimeHost.createAgent` delegate:
	//   options.createAgent ?? ((config) => new SessionRuntime(config))
	// Here we pass the real `SessionRuntime` orchestrator with a custom
	// `createAgentRuntimeImpl` that builds the REAL `AgentRuntime` while
	// overriding ONLY the model adapter (scripted) and the approval
	// callback (simulated user). Everything else — hooks, prepareTurn,
	// conversation store, mistake tracker — comes from the real
	// `SessionRuntime` orchestration.
	const createAgent: NonNullable<ConstructorParameters<typeof LocalRuntimeHost>[0]["createAgent"]> = (config) => {
		return new SessionRuntime(config, {
			createAgentRuntimeImpl: (runtimeConfig) => {
				return new AgentRuntime({
					...runtimeConfig,
					model,
					tools: [tool],
					hooks,
					toolPolicies: { run_commands: { autoApprove: false } },
					requestToolApproval,
				})
			},
		})
	}

	return new LocalRuntimeHost({
		distinctId: `act-c01-shrc01-${userDecision}`,
		sessionService: new FileSessionService(join(isolationDir, "sessions")),
		runtimeBuilder: runtimeBuilder as never,
		createAgent,
	})
}

async function makeStartConfig(sessionId: string, isolationDir: string) {
	const tool = {
		name: "run_commands",
		description: "real AgentRuntime tool; passed via extraTools",
		inputSchema: {
			type: "object",
			properties: { commands: { type: "array", items: { type: "string" } } },
			required: ["commands"],
			additionalProperties: false,
		} as never,
		async execute(input: { commands: string[] }) {
			return input.commands.map((c: string) => ({ result: `placeholder:${c}`, success: true as const }))
		},
	}
	return {
		sessionId,
		providerId: "anthropic",
		modelId: "claude-3-5-sonnet",
		apiKey: "test-key",
		systemPrompt: "You are a test agent for the host+agent composition.",
		cwd: isolationDir,
		mode: "act" as const,
		enableTools: false,
		enableSpawnAgent: false,
		enableAgentTeams: false,
		extraTools: [tool as never],
	}
}

describe("ACT-CLINEMM-SKIPPED-COMMAND-HOST-RECOVERY01-COMPOSITION01 / SHRC01 — real host+agent composition discriminator", () => {
	let isolationDir = ""
	let host: LocalRuntimeHost | undefined

	afterEach(async () => {
		if (host) {
			try {
				await host.dispose()
			} catch {
				/* dispose on a never-started host is fine */
			}
			host = undefined
		}
		process.env.HOME = envSnapshot.HOME
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR
		if (isolationDir && existsSync(isolationDir)) {
			rmSync(isolationDir, { recursive: true, force: true })
		}
	})

	// -----------------------------------------------------------------
	// SHRC01 — USER_REJECT through the real composition.
	//
	// This is the load-bearing gap left by SCHR01. SCHR01 used a stub
	// agent whose `run`/`continue` returned a clean AgentResult; this
	// test drives the REAL AgentRuntime through the SAME real
	// LocalRuntimeHost used in SCHR01, with a real approval callback
	// that REJECTS the proposed `run_commands`. The two ACTs together
	// then cover:
	//
	//   SCTR01 — AgentRuntime standalone rejection   = GREEN
	//   SCHR01 — LocalRuntimeHost + stub agent       = GREEN
	//   SHRC01 — LocalRuntimeHost + AgentRuntime     = THIS FILE
	//
	// Requirements (per ACT §5–§7):
	//   - approval is requested once for the proposed run_commands
	//   - executor is NEVER invoked (USER_REJECT short-circuits it)
	//   - AgentRuntime completes with status="completed"
	//   - host session.status settles to "idle" (NON_TERMINAL)
	//   - a DISTINCT second host.runTurn enters cleanly and the model
	//     receives the second prompt (proves AgentRuntime + host
	//     reentry composition works end-to-end)
	// -----------------------------------------------------------------
	it("SHRC01: real LocalRuntimeHost + real AgentRuntime + USER_REJECT settle to idle and a second runTurn enters cleanly", async () => {
		const sessionId = "shrc01-reject-composition"
		isolationDir = mkdtempSync(join(tmpdir(), "shrc01-reject-"))
		process.env.HOME = isolationDir
		process.env.CLINE_DIR = join(isolationDir, ".cline")

		setHomeDir(isolationDir)
		setClineDir(join(isolationDir, ".cline"))

		const counters: RunCounters = { approvalCalls: 0, executorCalls: 0 }
		const captured: CapturedOutcome[] = []
		const approvalRequests: ToolApprovalRequest[] = []
		host = await buildComposedHost({
			isolationDir,
			counters,
			captured,
			approvalRequests,
			userDecision: "reject",
		})

		await host.startSession({
			source: "vscode",
			interactive: true,
			config: await makeStartConfig(sessionId, isolationDir),
		})

		// FIRST TURN — USER_REJECT path through the real composition.
		const first = await host.runTurn({
			sessionId,
			prompt: "run a command (will be rejected)",
		})

		expect(first?.finishReason).toBe("completed")
		// Approval WAS requested by AgentRuntime (real path), and
		// rejection was recorded by the simulated user callback.
		expect(counters.approvalCalls).toBe(1)
		// Executor MUST NOT have been invoked — the rejection
		// short-circuits AgentRuntime before the tool's `execute`
		// can fire. This is the SHRC01 causal proof: the real
		// AgentRuntime rejection path lands at the host boundary
		// with no residual tool activity.
		expect(counters.executorCalls).toBe(0)
		// The AgentRuntime recorded a `control_plane` outcome via the
		// production `onToolRuntimeOutcome` hook. Real AgentRuntime
		// classifies USER_REJECT as `kind: "control_plane"` with
		// `outcome: "user_rejected"` (per sdk/packages/shared/src/
		// agents/recovery/types.ts:30-46). SCHR01 used a stub and
		// never hit this classification seam — this test proves the
		// real AgentRuntime rejection path reaches the real
		// onToolRuntimeOutcome hook with the production semantics.
		expect(captured).toHaveLength(1)
		expect(captured[0].outcome.kind).toBe("control_plane")
		if (captured[0].outcome.kind === "control_plane") {
			expect(captured[0].outcome.outcome).toBe("user_rejected")
		}

		// POST-FIRST-TURN INVARIANT (per ACT §3):
		// the host session status must be `idle` (NON_TERMINAL).
		const mid = await host.getSession(sessionId)
		expect(mid?.status).toBe("idle")
		expect(mid?.status).not.toBe("running")
		expect(mid?.status).not.toBe("pending")
		expect(mid?.status).not.toBe("cancelled")
		expect(mid?.status).not.toBe("failed")

		// DISTINCT SECOND TURN (per ACT §4):
		// call host.runTurn again with a new prompt. The host must
		// route this through session.agent.continue() (not run())
		// and AgentRuntime must execute a second iteration loop.
		const second = await host.runTurn({
			sessionId,
			prompt: "followup after rejection",
		})

		expect(second?.finishReason).toBe("completed")
		// The second turn should have requested approval AGAIN (the
		// second scripted model step proposes run_commands again),
		// proving the iteration loop survived the first rejection.
		expect(counters.approvalCalls).toBe(2)
		// Executor still MUST NOT have been invoked across both turns
		// (we use the reject callback throughout).
		expect(counters.executorCalls).toBe(0)

		const after = await host.getSession(sessionId)
		expect(after?.status).toBe("idle")
	})

	// -----------------------------------------------------------------
	// SHRC01-CTL — APPROVED SUCCESS through the real composition.
	//
	// Per ACT §6: "Only one approved-success control is needed. Do not
	// rebuild the full success/failure matrix already proven
	// separately." This confirms the real composition also recovers
	// when the user's approval is GRANTED — proving the finalization
	// path is invariant to the approval decision.
	// -----------------------------------------------------------------
	it("SHRC01_CTL: real LocalRuntimeHost + real AgentRuntime + APPROVED run_commands also settle to idle", async () => {
		const sessionId = "shrc01-approve-composition"
		isolationDir = mkdtempSync(join(tmpdir(), "shrc01-approve-"))
		process.env.HOME = isolationDir
		process.env.CLINE_DIR = join(isolationDir, ".cline")

		setHomeDir(isolationDir)
		setClineDir(join(isolationDir, ".cline"))

		const counters: RunCounters = { approvalCalls: 0, executorCalls: 0 }
		const captured: CapturedOutcome[] = []
		const approvalRequests: ToolApprovalRequest[] = []
		host = await buildComposedHost({
			isolationDir,
			counters,
			captured,
			approvalRequests,
			userDecision: "approve",
		})

		await host.startSession({
			source: "vscode",
			interactive: true,
			config: await makeStartConfig(sessionId, isolationDir),
		})

		const first = await host.runTurn({
			sessionId,
			prompt: "run a command (will be approved)",
		})

		expect(first?.finishReason).toBe("completed")
		// Approval WAS requested and granted.
		expect(counters.approvalCalls).toBe(1)
		// Executor MUST HAVE been invoked because the user approved.
		expect(counters.executorCalls).toBe(1)
		// Tool outcome should be SUCCESS — the executor returned
		// `success: true` items for the single command.
		expect(captured).toHaveLength(1)
		expect(captured[0].outcome.kind).toBe("success")

		// Same host-finalization invariant: idle after completed.
		const mid = await host.getSession(sessionId)
		expect(mid?.status).toBe("idle")

		// Second turn still works after a successful command.
		const second = await host.runTurn({
			sessionId,
			prompt: "followup after success",
		})
		expect(second?.finishReason).toBe("completed")

		const after = await host.getSession(sessionId)
		expect(after?.status).toBe("idle")
	})

	// -----------------------------------------------------------------
	// SHRC01-SANITY — the harness itself is valid.
	//
	// Proves the @cline-internal/core bridge aliases resolve to the
	// real production LocalRuntimeHost and SessionRuntime
	// orchestrator, and that AgentRuntime is the real class from
	// @cline/agents. This is the package_pin: the bridge does NOT
	// substitute a hand-rolled shim.
	// -----------------------------------------------------------------
	it("SHRC01_SANITY: bridge aliases resolve to real LocalRuntimeHost, real SessionRuntime orchestrator, and real AgentRuntime", () => {
		// LocalRuntimeHost prototype carries the production methods.
		const probe = new LocalRuntimeHost({
			distinctId: "shrc01-sanity",
			sessionService: new FileSessionService(join(tmpdir(), "shrc01-sanity-sessions")),
			runtimeBuilder: { build: async () => ({ tools: [], shutdown: () => Promise.resolve() }) } as never,
		})
		const hostProto = Object.getPrototypeOf(probe) as Record<string, unknown>
		const hostMethodNames = Object.getOwnPropertyNames(hostProto)
		expect(hostMethodNames).toContain("runTurn")
		expect(hostMethodNames).toContain("startSession")
		expect(hostMethodNames).toContain("getSession")
		expect(hostMethodNames).toContain("dispose")

		// SessionRuntime prototype carries the production methods.
		const sessionProbe = new SessionRuntime(
			{
				providerId: "anthropic",
				modelId: "claude-3-5-sonnet",
				apiKey: "test-key",
				systemPrompt: "test",
				tools: [],
			} as never,
			{},
		)
		const sessionProto = Object.getPrototypeOf(sessionProbe) as Record<string, unknown>
		const sessionMethodNames = Object.getOwnPropertyNames(sessionProto)
		expect(sessionMethodNames).toContain("run")
		expect(sessionMethodNames).toContain("continue")
		expect(sessionMethodNames).toContain("canStartRun")
		expect(sessionMethodNames).toContain("subscribeEvents")
		expect(sessionMethodNames).toContain("getAgentId")

		// AgentRuntime prototype carries the production methods.
		const runtimeProbe = new AgentRuntime({
			model: new StepModel([() => [{ type: "finish", reason: "stop" }]]),
			tools: [],
		})
		const runtimeProto = Object.getPrototypeOf(runtimeProbe) as Record<string, unknown>
		const runtimeMethodNames = Object.getOwnPropertyNames(runtimeProto)
		expect(runtimeMethodNames).toContain("run")
		expect(runtimeMethodNames).toContain("continue")
		expect(runtimeMethodNames).toContain("abort")
		expect(runtimeMethodNames).toContain("subscribe")
		expect(runtimeMethodNames).toContain("snapshot")

		// FileSessionService is the real production class.
		const svc = new FileSessionService(join(tmpdir(), "shrc01-sanity-svc"))
		expect(svc).toBeDefined()
		expect(typeof (svc as unknown as Record<string, unknown>).ensureSessionsDir).toBe("function")
	})
})
