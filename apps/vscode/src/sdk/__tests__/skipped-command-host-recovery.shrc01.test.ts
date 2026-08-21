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
 *   Substituted ONLY where unavoidable (the rest is real):
 *     - model adapter             → synthetic_real StepModel (scripted events)
 *     - run_commands-shaped tool  → synthetic_real AgentTool.execute()
 *                                   (counter-backed; AgentRuntime's real
 *                                   approval + control-plane machinery still
 *                                   runs)
 *     - user approval decision    → synthetic_real callback injected into
 *                                   AgentRuntime.requestToolApproval
 *                                   ({ approved: false, reason } for
 *                                   SHRC01 USER_REJECT,
 *                                    { approved: true } for SHRC01_CTL)
 *     - filesystem/substrate      → isolated tmp HOME/CLINE_DIR
 *
 * Truthful classification:
 *     REAL:
 *       LocalRuntimeHost, SessionRuntime orchestrator, AgentRuntime,
 *       AgentRuntime approval + control-plane + tool-orchestration
 *       machinery, onToolRuntimeOutcome hook, finishRun, hook-fanout,
 *       FileSessionService, LocalRuntimeHost markTurnIdle /
 *       completeInteractiveTurn / runTurn / executeTurn / executeAgentTurn
 *     SYNTHETIC_REAL:
 *       StepModel (scripted events stand in for the provider adapter)
 *       run_commands-shaped AgentTool.execute() (counters stand in for
 *       the production tool implementation)
 *       user decision callback (stands in for the VS Code approval UI)
 *     NOT_EXERCISED:
 *       VS Code approval UI / application seam
 *       Compaction pipeline / prepareTurn hook (replaceMessages etc.)
 *
 * Production seam under test (composition):
 *   LocalRuntimeHost.runTurn(input) — line 994
 *     → executeTurn(session, input) — line 1708
 *       → markTurnRunning(session) — line 1749 → updateStatus("running")
 *       → executeAgentTurn(session, prompt) — line 1882
 *         → session.agent.continue(...) — real SessionRuntime.continue()
 *           → real AgentRuntime.continue()  (SCTR01 rejection loop)
 *             → real requestToolApproval → synthetic_real user decision
 *               → reject  → control_plane / user_rejected
 *             → real onToolRuntimeOutcome hook fires with control_plane outcome
 *             → model observes rejection, emits terminal stop
 *             → finishRun returns AgentResult
 *       → returns AgentResult with finishReason
 *     → completeInteractiveTurn(session, finishReason) — line 1775
 *       → markTurnIdle(session) — line 2164 → updateStatus("idle")
 *     → pendingPromptsController.drain(sessionId) — line 1041
 *
 * Discrimination matrix (per ACT §5–§7):
 *   SHRC01       — USER_REJECT: real AgentRuntime's real approval
 *                  machinery rejects the synthetic_real run_commands via
 *                  the synthetic_real user decision callback. Host must
 *                  settle to status="idle" with no residual execution
 *                  flags. (`executorCalls === 0`.)
 *   SHRC01-CTL   — APPROVED SUCCESS: real AgentRuntime's real approval
 *                  machinery approves and the synthetic_real
 *                  run_commands execute() runs once. Host must settle to
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
 *   adapter (substituting the synthetic_real scripted `StepModel` for
 *   the provider-resolved adapter) and the `requestToolApproval`
 *   decision (substituting the synthetic_real user decision callback
 *   for the VS Code approval UI). Everything else stays real: the
 *   AgentRuntime approval + control-plane + tool-orchestration machinery,
 *   onToolRuntimeOutcome hook, finishRun, and the synthetic_real
 *   run_commands-shaped AgentTool's execute() body — which never runs
 *   in SHRC01 because rejection short-circuits before it.
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
// synthetic_real scripted AgentModel — stands in for the provider adapter
// with a deterministic scripted event stream. Same pattern as the SCTR01
// step model so the two ACTs share their model-adapter shape. AgentRuntime
// itself stays real; only this adapter is synthetic_real.
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
// composition. The test seams are:
//   - the synthetic_real `StepModel` (scripted events stand in for the
//     provider adapter — AgentRuntime itself stays real)
//   - the synthetic_real `requestToolApproval` callback (simulated user
//     decision injected into AgentRuntime; AgentRuntime's approval +
//     control-plane machinery stays real)
//   - the synthetic_real `run_commands`-shaped AgentTool.execute()
//     (counter-backed; AgentRuntime's tool-orchestration machinery stays
//     real)
//   - the `extraTools` start-config (injects the synthetic_real
//     run_commands-shaped tool into the host's merged toolset)
// ---------------------------------------------------------------------------

function makeRunCommandsTool(counters: RunCounters): AgentTool<{ commands: string[] }, Array<{ result: string; success: true }>> {
	return {
		name: "run_commands",
		description: "synthetic_real run_commands-shaped AgentTool; executor MUST NOT run when the user rejects approval.",
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

	// runtimeBuilder returns no tools — the synthetic_real
	// run_commands-shaped tool is injected via `extraTools` on the start
	// config so the host's merged toolset (line 605 of local-runtime-host.ts)
	// carries exactly one tool.
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
	// overriding ONLY the model adapter (synthetic_real StepModel) and the
	// approval decision (synthetic_real user callback). Everything else —
	// hooks, prepareTurn, conversation store, mistake tracker, message
	// builder, contribution registry — comes from the real
	// `SessionRuntime` orchestration. AgentRuntime's approval + control-
	// plane + tool-orchestration machinery also stays real.
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
		description: "synthetic_real run_commands-shaped AgentTool; passed via extraTools",
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
		apiKey: "test-api-key-placeholder",
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
	// LocalRuntimeHost used in SCHR01, with a synthetic_real approval
	// decision that REJECTS the proposed `run_commands`. The two ACTs
	// together then cover:
	//
	//   SCTR01 — AgentRuntime standalone rejection   = GREEN
	//   SCHR01 — LocalRuntimeHost + stub agent       = GREEN
	//   SHRC01 — LocalRuntimeHost + AgentRuntime     = THIS FILE
	//
	// Requirements (per ACT §5–§7):
	//   - real AgentRuntime's approval machinery requests approval once
	//     for the proposed run_commands; synthetic_real user decision
	//     rejects
	//   - synthetic_real run_commands-shaped tool.execute() is NEVER
	//     invoked (USER_REJECT short-circuits AgentRuntime before it)
	//   - real AgentRuntime completes with status="completed"
	//   - host session.status settles to "idle" (NON_TERMINAL)
	//   - a DISTINCT second host.runTurn enters cleanly and the real
	//     AgentRuntime iteration loop re-fires the same causal path
	//     (proves AgentRuntime + host reentry composition works
	//     end-to-end)
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
		// Real AgentRuntime's approval machinery requested approval
		// once; the synthetic_real user decision callback rejected.
		expect(counters.approvalCalls).toBe(1)
		// The synthetic_real run_commands-shaped tool.execute() MUST
		// NOT have been invoked — the real AgentRuntime rejection
		// short-circuits before the tool's execute() can fire. This
		// is the SHRC01 causal proof: the real AgentRuntime rejection
		// path lands at the host boundary with no residual tool
		// activity, no matter what the synthetic_real tool
		// implementation would have done if invoked.
		expect(counters.executorCalls).toBe(0)
		// The real AgentRuntime recorded a `control_plane` outcome
		// via the real `onToolRuntimeOutcome` hook. Real AgentRuntime
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
		// The real AgentRuntime iteration loop re-fires the same
		// causal path: the second turn requests approval AGAIN
		// (the synthetic_real StepModel's TURN-2 step proposes
		// run_commands again), proving the iteration loop survived
		// the first rejection and that the composition's second-turn
		// reentry is genuine.
		expect(counters.approvalCalls).toBe(2)
		// The synthetic_real run_commands-shaped tool.execute()
		// still MUST NOT have been invoked across both turns
		// (the synthetic_real user decision rejects throughout).
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
	// when the synthetic_real user decision is GRANTED — proving the
	// finalization path is invariant to the approval decision. The
	// approved-control exercises the synthetic_real run_commands-shaped
	// AgentTool.execute() body, but it is NOT a real terminal
	// execution (no actual commands run, no real terminal touched).
	// -----------------------------------------------------------------
	it("SHRC01_CTL: real LocalRuntimeHost + real AgentRuntime + synthetic_real APPROVED run_commands also settle to idle", async () => {
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
		// Real AgentRuntime's approval machinery requested approval
		// once; the synthetic_real user decision callback granted it.
		expect(counters.approvalCalls).toBe(1)
		// The synthetic_real run_commands-shaped tool.execute() MUST
		// HAVE been invoked because the real AgentRuntime's approval
		// machinery approved it. (This proves the composition path
		// reaches the synthetic_real tool body — it is NOT a real
		// terminal execution, only a synthetic_real AgentTool that
		// returns success: true to keep the host finalization path
		// honest.)
		expect(counters.executorCalls).toBe(1)
		// Tool outcome should be SUCCESS — the synthetic_real
		// run_commands-shaped tool returned success: true for the
		// single command.
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
				apiKey: "test-api-key-placeholder",
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
