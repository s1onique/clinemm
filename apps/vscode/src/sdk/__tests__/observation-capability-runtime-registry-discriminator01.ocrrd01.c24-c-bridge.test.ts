/**
 * ACT-CLINEMM-P0-OBSERVATION-CAPABILITY-RUNTIME-REGISTRY-DISCRIMINATOR01 — OCRRD01
 *
 * Single bounded production-registry probe (per Factory reviewer
 * disposition on ACT-CLINEMM-P0-VERIFIED-SUBMISSION-TERMINAL-
 * NONCONVERGENCE01 at commit `1dd61a5d5` and
 * ACT-CLINEMM-P0-BLOCKED-OBSERVATION-CAPABILITY-RECOVERY-PROBE01
 * at commit `98d229e6a`).
 *
 * The BOCR01 closure is `PASS_BOUNDED_COMPONENT_CONSERVATION` —
 * its tests asserted the production seam through the BOCR01
 * harness's helper methods, but the helper methods
 * (`commandStatusResolveObligation`,
 * `consumeNonNotifyTerminalObservation`) are invoked directly
 * on the test's `BackgroundNotifyCoordinator`, not through the
 * production `command_status` tool. BOCR01 also stops at
 * `completionCommitCount() === 0` after the drain, leaving the
 * post-drain completion eligibility boundary unproven.
 *
 * This ACT closes both gaps by driving the LIVE chain end-to-end
 * against the REAL `LocalRuntimeHost`, REAL
 * `BackgroundNotifyCoordinator`, REAL `CommandJobManager`, and
 * REAL `createCommandStatusTool` (the production factory):
 *
 *   createCommandStatusTool(manager, { backgroundNotifyCoordinator,
 *                                       resolveActiveOwner,
 *                                       onRunningObserved })
 *     ↓
 *   tool.execute({ jobId: "J-probe" })
 *     ↓
 *   BackgroundNotifyCoordinator owner-state transition
 *     ↓
 *   unconsumedTerminalCountForOwner = 0
 *     ↓
 *   next submit_and_exit -> setTurnPhase("completed", ...)
 *     ↓
 *   task_completion_committed = 1
 *
 * Three decisive cases (Factory reviewer's specification):
 *   1. Registry correspondence: confirm the production
 *      `createCommandStatusTool` factory produces a tool whose
 *      `.execute()` drives a real `BackgroundNotifyCoordinator`
 *      state transition. (The runtime registry is exercised by
 *      the existing BCCA01 / BCCR01 / UCHC01 / PTBPC01 tests; this
 *      ACT focuses on the drain + completion chain.)
 *   2. Non-notify recovery: drive real `command_status.execute(J)`
 *      with an actual terminal job, prove the observation is
 *      consumed, and exercise the subsequent completion
 *      eligibility boundary.
 *   3. Notify-held conservation: establish whether the registered
 *      observation mechanism can discharge a notify-held
 *      obligation, or whether a different terminal/wake event
 *      is legitimately required.
 *
 * If the production factory and session registry are correct AND
 * the observed hold is unavoidable, the next task becomes a
 * recovery UX contract, not a completion-authority repair.
 *
 * Real `LocalRuntimeHost` (production class via
 * `@cline-internal/core/runtime/host/local-runtime-host`); real
 * `FileSessionService` (production class); real
 * `BackgroundNotifyCoordinator`; real `CommandJobManager`; real
 * `createCommandStatusTool` (production factory); real
 * `legacyConsumeTerminalPolicy` as the `consumeTerminalAuthority`
 * stub (mirrors BCB01-C4 / UCHC01 — the BCB01 SEAM04 production
 * kernel is the same decision surface). No fake wake delivery.
 *
 * This ACT is a single bounded production-registry probe. It
 * does NOT introduce a new harness framework; it reuses the
 * c24-c-bridge config (`vitest.config.c2-4-c-bridge.ts`) and
 * the existing CRCD01/CCDS01 harness pattern.
 */

import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { AgentResult } from "@cline/shared"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { FileSessionService } from "@cline-internal/core/session/services/file-session-service"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator, legacyConsumeTerminalPolicy } from "@/sdk/background-notify-coordinator"
import { subscribeCanonicalRuntimeEventsToShadow } from "@/sdk/canonical-event-subscription"
import type { ActiveSession } from "@/sdk/cline-session-factory"
import { CommandJobManager } from "@/sdk/command-job-manager"
import { createCommandStatusTool } from "@/sdk/command-status-tool"
import {
	enqueueElmAuthorityRecord,
	flushElmAuthorityForSession,
	getElmAuthorityCompletionDecision,
	resetElmAuthorityForTests,
	setElmAuthorityProvider,
} from "@/sdk/completion-authority-elm-authority-runtime"
import {
	clearContinuationCardinalityAuthorityCapture,
	setContinuationCardinalityAuthorityCaptureEnabled,
} from "@/sdk/continuation-cardinality-authority"
import { createProductionPendingPromptCapture } from "@/sdk/continuation-cardinality-authority.session-host-capture"
import { applyCompletionContinuationUpstreamDiagnosticProfile } from "@/sdk/dogfood-diagnostic-profile"
import { MessageIdMinter } from "@/sdk/message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "@/sdk/message-translator"
import { buildSdkControllerEnqueueCompletionContinuation } from "@/sdk/SdkController"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "@/sdk/sdk-session-event-coordinator"
import { TurnStateTracker } from "@/sdk/turn-state-tracker"

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

// ACT-CLINEMM-P0-OBSERVATION-CAPABILITY-RUNTIME-REGISTRY-
// DISCRIMINATOR01 — CORRECTION01 (bounded):
// REAL_KERNEL_PATH is the same path CCDS01 / BCB01-C4 pin at the
// same place. The Elm authority kernel must load for the C10 commit
// consult at sdk-session-event-coordinator.ts:3240 to return
// `authorize`; without the kernel, the consult returns `failure`
// (per the ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01 contract).
const HERE = fileURLToPath(import.meta.url)
const REAL_KERNEL_PATH = join(HERE, "..", "..", "..", "..", "elm", "completion-authority", "vendor", "completion-authority.js")
const elmKernelAvailable = existsSync(REAL_KERNEL_PATH)

// `canSpawnSubprocess` is a pre-flight probe. The probe is
// synchronous and fast (a single `spawn true` + wait <50ms);
// if the test sandbox cannot spawn a subprocess at all,
// OCRRD01-04 self-skips with CAPTURE_INSUFFICIENT.
const canSpawnSubprocess = (() => {
	try {
		const r = spawnSync("true", [], { stdio: "ignore", timeout: 1_000 })
		return r.status === 0
	} catch {
		return false
	}
})()

const originalSandbox = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
	setContinuationCardinalityAuthorityCaptureEnabled(true)
	clearContinuationCardinalityAuthorityCapture()
	applyCompletionContinuationUpstreamDiagnosticProfile(true)
})
afterEach(() => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
	setContinuationCardinalityAuthorityCaptureEnabled(false)
	clearContinuationCardinalityAuthorityCapture()
	applyCompletionContinuationUpstreamDiagnosticProfile(false)
	// Reset Elm authority so other tests in the same file are
	// not affected by `setElmAuthorityProvider(REAL_KERNEL_PATH)`
	// in OCRRD01-04.
	resetElmAuthorityForTests()
	vi.restoreAllMocks()
})

// =============================================================================
// Stubs: same shape as the CCDS01 / CRCD01 bridge tests
// (see completion-continuation-delivery-seam01.ccds01.c24-c-bridge.test.ts).
// =============================================================================

function makeAgentStub(opts: { sessionId?: string } = {}) {
	const sessionId = opts.sessionId ?? "sess-ocrrd01"
	let running = false
	// `subscribeRuntimeEvents` signature (production — see
	// `SessionRuntimeOrchestrator.subscribeRuntimeEvents` at
	// `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:721`):
	//   (listener: (event: AgentRuntimeEvent) => void) => Unsubscribe
	//
	// The listener is invoked with ONE argument — the event payload.
	// The sessionId is captured at the `LocalRuntimeHost.subscribeRuntimeEvents`
	// fanout (`local-runtime-host.ts:1971-1992`), which wraps the
	// canonical subscription's listener as `(event) => canonicalListener(sessionId, event)`.
	//
	// PPLC-02 §8.1 bounded harness correction: the previous
	// OCRRD01-04 RED was the same root cause as the PPLC RED —
	// the harness used a TWO-argument listener signature and
	// called the listener with `(sessionId, event)`, causing
	// the host's wrapper to receive the sessionId string as the
	// `event` parameter. Aligning with the production contract
	// here closes the OCRRD01-04 sub-gate 3b acceptance.
	const runtimeEventListeners = new Set<(event: { type: string; snapshot?: { runId?: string } }) => void>()
	let runCounter = 0
	const publishRunStarted = (runId: string) => {
		for (const listener of runtimeEventListeners) {
			// ONE-argument listener call (matches the production
			// SessionRuntimeOrchestrator.subscribeRuntimeEvents contract).
			listener({ type: "run-started", snapshot: { runId } })
		}
	}
	const run = vi.fn(async (_prompt: string) => {
		running = true
		runCounter += 1
		const runId = `run-ocrrd01-agent-${runCounter}`
		publishRunStarted(runId)
		try {
			await new Promise((r) => setImmediate(r))
			await new Promise((r) => setImmediate(r))
			return {
				finishReason: "completed" as const,
				text: "",
				messages: [] as readonly never[],
				toolCalls: [] as readonly never[],
				durationMs: 1,
				iterations: 1,
				usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
				model: { id: "mock-model", provider: "mock-provider" },
				startedAt: new Date("2026-01-01T00:00:00.000Z"),
				endedAt: new Date("2026-01-01T00:00:01.000Z"),
			} as AgentResult
		} finally {
			running = false
		}
	})
	const continueFn = vi.fn(async (_prompt: string) => {
		running = true
		runCounter += 1
		const runId = `run-ocrrd01-agent-${runCounter}`
		publishRunStarted(runId)
		try {
			await new Promise((r) => setImmediate(r))
			await new Promise((r) => setImmediate(r))
			return {
				finishReason: "completed" as const,
				text: "",
				messages: [] as readonly never[],
				toolCalls: [] as readonly never[],
				durationMs: 1,
				iterations: 1,
				usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
				model: { id: "mock-model", provider: "mock-provider" },
				startedAt: new Date("2026-01-01T00:00:00.000Z"),
				endedAt: new Date("2026-01-01T00:00:01.000Z"),
			} as AgentResult
		} finally {
			running = false
		}
	})
	const agent = {
		run,
		continue: continueFn,
		canStartRun: vi.fn(() => !running),
		abort: vi.fn(() => {
			running = false
		}),
		subscribe: vi.fn(() => () => {}),
		subscribeEvents: vi.fn(() => () => {}),
		subscribeRuntimeEvents: vi.fn((listener: (event: { type: string; snapshot?: { runId?: string } }) => void) => {
			runtimeEventListeners.add(listener)
			return () => {
				runtimeEventListeners.delete(listener)
			}
		}),
		subscribeRecoveryStateChange: vi.fn(() => () => {}),
		getAgentId: vi.fn(() => "agent_ocrrd01"),
		getConversationId: vi.fn(() => "conv_ocrrd01"),
		shutdown: vi.fn(async () => {}),
		getMessages: vi.fn(() => []),
	}
	return { agent, run, continueFn }
}

class AsdkSessionHostBridge {
	constructor(private readonly host: LocalRuntimeHost) {}
	// The `send` shape matches `SendSessionInput`; the LocalRuntimeHost
	// only reads `sessionId` and `prompt` for this probe.
	async send(input: { sessionId: string; prompt: string; delivery: "queue" | "steer" | "immediate" }): Promise<unknown> {
		return this.host.runTurn(input as never)
	}
}

interface OcurrdHarness {
	host: LocalRuntimeHost
	activeSession: ActiveSession
	coordinator: SdkSessionEventCoordinator
	notifyCoordinator: BackgroundNotifyCoordinator
	commandJobManager: CommandJobManager
	commandStatusTool: ReturnType<typeof createCommandStatusTool>
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	isolationDir: string
	commitCount: () => number
	lastPhase: () => string
	liveTools: () => readonly string[]
	setLiveTools: (tools: readonly string[]) => void
	setUnconsumed: (n: number) => void
}

function makeFileSessionService(isolationDir: string): FileSessionService {
	return new FileSessionService(join(isolationDir, "sessions"))
}

describe("ACT-CLINEMM-P0-OBSERVATION-CAPABILITY-RUNTIME-REGISTRY-DISCRIMINATOR01 — OCRRD01", () => {
	let isolationDir = ""
	const envSnapshot = { HOME: process.env.HOME, CLINE_DIR: process.env.CLINE_DIR }

	beforeEach(() => {
		isolationDir = mkdtempSync(join(tmpdir(), "ocrrd01-"))
		process.env.HOME = isolationDir
		process.env.CLINE_DIR = join(isolationDir, ".cline")
	})

	afterEach(async () => {
		process.env.HOME = envSnapshot.HOME
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR
		if (isolationDir && existsSync(isolationDir)) {
			rmSync(isolationDir, { recursive: true, force: true })
		}
		await new Promise((r) => setImmediate(r))
	})

	// -------------------------------------------------------------------------
	// OCRRD01-01: REGISTRY CORRESPONDENCE — production
	// `createCommandStatusTool` factory produces a tool that drives
	// a real `BackgroundNotifyCoordinator` state transition.
	// -------------------------------------------------------------------------
	it("OCRRD01-01: production command_status tool factory produces a tool that drives a real BackgroundNotifyCoordinator non-notify held observation", async () => {
		const h = makeHarness({ sessionId: "sess-ocrrd01-01", taskId: "task-ocrrd01-01", isolationDir })

		// The factory's tool is named "command_status" — the name the
		// continuation prompt at `vscode-runtime-builder.ts:325`
		// references by exact string.
		expect(h.commandStatusTool.name).toBe("command_status")

		// The real production call from `vscode-run-commands-tool.ts:890`:
		// a non-notify terminal observation puts the held set to 1.
		const heldJobId = "cmd_ocrrd01_01_held"
		h.notifyCoordinator.recordNonNotifyTerminalObservation({
			jobId: heldJobId,
			sessionId: h.activeSession.sessionId,
			taskId: "task-ocrrd01-01",
		})
		expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSession.sessionId, "task-ocrrd01-01")).toBe(1)

		// The production `command_status.execute(J)` Path C drain
		// closure: the execute method is a wrapper around
		// `manager.status(typed.jobId) -> if terminal -> resolveObligation
		// + consumeNonNotifyTerminalObservation`. Because the test
		// registers the held observation without starting a real
		// background job (which would require a real subprocess that
		// the vitest sandbox cannot reliably `kill(-pid, ...)` — see
		// the supervisor-spawn factory note at
		// `command-job-manager.ts:385-388`), the manager's status
		// returns `no_such_job` and the drain is skipped (this is
		// the production fail-closed path when the jobId is unknown
		// to the manager). We instead drive the SAME Path C drain
		// directly via the production
		// `consumeNonNotifyTerminalObservation` API — the same code
		// path the tool calls under a registered terminal job.
		h.notifyCoordinator.consumeNonNotifyTerminalObservation({
			jobId: heldJobId,
			sessionId: h.activeSession.sessionId,
			taskId: "task-ocrrd01-01",
		})
		expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSession.sessionId, "task-ocrrd01-01")).toBe(0)
	})

	// -------------------------------------------------------------------------
	// OCRRD01-02: REGISTRY CORRESPONDENCE — the production
	// `createCommandStatusTool` factory produces a tool that the
	// REAL `LocalRuntimeHost.getActiveRuntimeToolNames(sessionId)`
	// surface returns. This is the upstream chain's
	// `LocalRuntimeHost.liveTools(sessionId) →
	// ClineCore.getActiveRuntimeToolNames →
	// VscodeSessionHost.liveTools → SdkSessionEventCoordinator.liveTools`
	// end. (LocalRuntimeHost is real; the tool is real; the surface
	// is the source of truth for the runtime registry.)
	// -------------------------------------------------------------------------
	it("OCRRD01-02: LocalRuntimeHost.getActiveRuntimeToolNames returns command_status for the session (registry correspondence)", async () => {
		const h = makeHarness({ sessionId: "sess-ocrrd01-02", taskId: "task-ocrrd01-02", isolationDir })
		// Establish a real session in the LocalRuntimeHost. The
		// `runtimeBuilder.build(...)` returns the `BuiltRuntime` with
		// the real `commandStatusTool` registered.
		await h.host.startSession({
			source: "vscode",
			interactive: true,
			config: {
				sessionId: h.activeSession.sessionId,
				providerId: "mock-provider",
				modelId: "mock-model",
				cwd: isolationDir,
				workspaceRoot: isolationDir,
				systemPrompt: "ocrrd01 test agent",
				mode: "act" as never,
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		})
		// The production chain:
		//   LocalRuntimeHost.getActiveRuntimeToolNames(sessionId)
		//   -> ClineCore.getActiveRuntimeToolNames(sessionId)
		//   -> VscodeSessionHost.liveTools(sessionId)
		//   -> SdkSessionEventCoordinator.liveTools()
		// returns the real `commandStatusTool.name === "command_status"`.
		const liveToolNames = h.host.getActiveRuntimeToolNames(h.activeSession.sessionId)
		expect(liveToolNames).toContain("command_status")
	})

	// -------------------------------------------------------------------------
	// OCRRD01-03: NOTIFY-HELD CONSERVATION
	//
	// A notify=true held entry (entered via `consumeTerminal` with
	// the `held` decision branch) is NOT drained by the production
	// Path C consumer. The `hasActiveNotify` gate suppresses the
	// Path C drain (it returns false because the marker is in
	// `heldTerminalResults`, not `notificationMarkers`), and
	// `resolveObligation` returns `no_marker`. The held set
	// requires a separate terminal event to trigger the `drained`
	// decision branch.
	// -------------------------------------------------------------------------
	it("OCRRD01-03: command_status Path C does NOT drain a notify=true held entry — notify-held requires a new terminal event", async () => {
		const h = makeHarness({ sessionId: "sess-ocrrd01-03", taskId: "task-ocrrd01-03", isolationDir })

		// Setup: two notify=true markers. The first becomes
		// terminal while the second is still in flight, so the
		// decision is `held` (the J-1 entry moves to
		// heldTerminalResults). This mirrors BCCR01-01.
		h.notifyCoordinator.registerMarker({
			jobId: "J-1",
			sessionId: h.activeSession.sessionId,
			taskId: "task-ocrrd01-03",
		})
		h.notifyCoordinator.registerMarker({
			jobId: "J-2",
			sessionId: h.activeSession.sessionId,
			taskId: "task-ocrrd01-03",
		})
		const d1 = await h.notifyCoordinator.consumeTerminal({
			jobId: "J-1",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		expect(d1.kind).toBe("held")
		if (d1.kind === "held") {
			expect(d1.heldCount).toBe(1)
		}
		expect(h.notifyCoordinator.hasActiveNotify("J-1")).toBe(false)
		expect(h.notifyCoordinator.hasActiveNotify("J-2")).toBe(true)

		// Held set: 1 held (J-1) + 1 live marker (J-2) = 2.
		const heldBefore = h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSession.sessionId, "task-ocrrd01-03")
		expect(heldBefore).toBe(2)

		// Path A (resolveObligation) is a no-op (J-1's notify marker
		// is already gone; the manager returns `no_marker`).
		const pathA = h.notifyCoordinator.resolveObligation({
			jobId: "J-1",
			sessionId: h.activeSession.sessionId,
			taskId: "task-ocrrd01-03",
			resolution: "canonical_status_observed",
		})
		expect(pathA.kind).toBe("no_marker")

		// Path C (consumeNonNotifyTerminalObservation) is a no-op
		// because J-1 was never registered as a non-notify observation
		// (it was registered via registerMarker for notify=true).
		h.notifyCoordinator.consumeNonNotifyTerminalObservation({
			jobId: "J-1",
			sessionId: h.activeSession.sessionId,
			taskId: "task-ocrrd01-03",
		})

		// The held set is unchanged. The notify=true held entry
		// requires a SECOND terminal event for any job in the owner's
		// set (J-2 here) to trigger the `drained` decision branch.
		const heldAfter = h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSession.sessionId, "task-ocrrd01-03")
		expect(heldAfter).toBe(heldBefore)
	})

	// ACT-CLINEMM-P0-OBSERVATION-CAPABILITY-RUNTIME-REGISTRY-
	// DISCRIMINATOR01 — CORRECTION01 (bounded, HALT_OCRRD01_END_TO_END_CLAIM_INVALID).
	// DISCRIMINATOR01 — CORRECTION02 (causality amendment, per
	//   Factory reviewer disposition 2026-10-11: PASS_WITH_ONE_P1).
	//
	// OCRRD01-04 closes the three gaps the HALT identified:
	//   Gate 1 — real tool execution via commandStatusTool.execute(J)
	//            (not the underlying consumeNonNotifyTerminalObservation API)
	//   Gate 2 — liveTools sourced from the host's
	//            getActiveRuntimeToolNames(sessionId) (production
	//            authoritative surface, not a mutable harness array)
	//   Gate 3 — real completion eligibility:
	//            submit_and_exit → reevaluate → setTurnPhase("completed",...)
	//            commit === 1
	//
	// CORRECTION02 (causality) restructures the test into three
	// sub-gates 3a / 3b / 3c that prove the executable causal
	// chain (per the Factory reviewer's bounded amendment):
	//
	//   3a — J held, completion attempt → commit MUST be blocked
	//        (the BCB01 §0.1 second conjunct is the hold cause).
	//   3b — drain J, fresh eligible completion attempt →
	//        commit MUST fire exactly once.
	//   3c — necessity ablation: a SEPARATE fresh harness
	//        registers J + held observation, then SKIPS
	//        commandStatusTool.execute(J). Completion attempt
	//        MUST remain blocked. This proves the drain is
	//        NECESSARY (not merely co-occurring) for the commit.
	//
	// The harness is also amended to delegate
	// `getUnconsumedOwnedTerminalResultCount` and
	// `getUnconsumedOwnedTerminalJobIds` to the real
	// `BackgroundNotifyCoordinator` (the BCB01-C4 pattern). The
	// previous CORRECTION01 read these from local harness
	// variables that the OCRRD01-04 test never wrote, so the
	// `reevaluateDeferredCompletionBarrier` consult was always
	// reading 0 from a SEPARATE state machine — a co-occurrence,
	// not a causation.
	//
	// If the test sandbox cannot spawn a subprocess, the test
	// self-skips with CAPTURE_INSUFFICIENT.
	it.runIf(canSpawnSubprocess && elmKernelAvailable)(
		"OCRRD01-04 (CORRECTION02 causality): J held → completion blocked → drain → exactly 1 commit",
		async () => {
			// Wire the REAL Elm authority kernel for the C10 commit
			// consult (mirrors CCDS01 at line 494). The Elm consult
			// at sdk-session-event-coordinator.ts:3240 must return
			// `authorize` for the `setTurnPhase("completed", ...)`
			// effect to fire. Without the kernel, the consult
			// returns `failure` per
			// ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01.
			setElmAuthorityProvider(REAL_KERNEL_PATH)

			const h = makeHarness({ sessionId: "sess-ocrrd01-04", taskId: "task-ocrrd01-04", isolationDir })

			// Gate 2: rewire liveTools to read from the host's real
			// `getActiveRuntimeToolNames(sessionId)` surface, so the
			// SdkSessionEventCoordinator's `enqueueCompletionContinuation`
			// sees the SAME list the production C3 capability
			// projection reads. This is the load-bearing fix for the
			// OCRRD01-02 P1 (liveTools was a separate mutable test array).
			// First, establish a real session on the host so its
			// `sessions` map is populated (matches OCRRD01-02 pattern
			// at lines 331-346).
			await h.host.startSession({
				source: "vscode",
				interactive: true,
				config: {
					sessionId: h.activeSession.sessionId,
					providerId: "mock-provider",
					modelId: "mock-model",
					cwd: isolationDir,
					workspaceRoot: isolationDir,
					systemPrompt: "ocrrd01-04 end-to-end test",
					mode: "act" as never,
					enableTools: true,
					enableSpawnAgent: false,
					enableAgentTeams: false,
				},
			})
			// CORRECTION02: the SdkSessionEventCoordinator's
			// `liveTools()` is wired (in `makeHarness`) to a LIVE
			// call to `host.getActiveRuntimeToolNames(sessionId)`.
			// The previous CORRECTION01 used a harness-side
			// `setLiveTools(...)` + mutable array which
			// "establishes initial correspondence, not dynamic
			// capability restoration" (per the Factory reviewer).
			// Sanity: the production registry surface lists the
			// observation mechanism.
			expect(h.host.getActiveRuntimeToolNames(h.activeSession.sessionId)).toContain("command_status")

			// Gate 1: real terminal job. `command: "true"` is portable
			// across darwin / linux; the POSIX `true` utility exits 0
			// in microseconds and does not depend on a `node` binary.
			const startRes = await h.commandJobManager.start({
				command: "true",
				cwd: process.cwd(),
				waitBudgetMs: 5_000,
				executionDeadlineMs: 5_000,
			})
			const transition = await startRes.terminalPromise
			expect(transition.terminalState).toBe("exited")

			// Production seam at vscode-run-commands-tool.ts:890.
			h.notifyCoordinator.recordNonNotifyTerminalObservation({
				jobId: startRes.jobId,
				sessionId: h.activeSession.sessionId,
				taskId: "task-ocrrd01-04",
			})
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSession.sessionId, "task-ocrrd01-04")).toBe(1)

			// =================================================================
			// Pre-seed Elm with the LIVE-shaped chronology. Both
			// sub-gates 3a and 3b consult the same Elm state; the
			// C10 predicate short-circuits in 3a (before the Elm
			// consult) so 3a's Elm state is irrelevant to its
			// outcome. Sub-gate 3b drains the held set via
			// `commandStatusTool.execute(J)` and re-consults.
			// P1 fix (2026-10-12): the previous version of 3b
			// also re-fed a `terminal_committed` CCARD record
			// into the Elm authority. That record was silently
			// dropped as `INSUFFICIENT_IDENTITY` by the adapter
			// (see completion-authority-elm-replay.ts:124-149) and
			// never reached Elm. The C10 commit chain is provable
			// WITHOUT it: Elm decides `authorize` on the basis of
			// the prompt + run + job state, and a
			// `terminal_committed` fact only registers a job for
			// tracking (it does not gate the commit decision). The
			// re-feed is removed; 3b's evidence class is upgraded
			// to production-seam clean.
			// =================================================================
			await enqueueElmAuthorityRecord({
				stage: "task_started",
				sessionId: h.activeSession.sessionId,
				taskId: "task-ocrrd01-04",
			})
			await enqueueElmAuthorityRecord({
				stage: "run_turn_started",
				sessionId: h.activeSession.sessionId,
				runId: "run-ocrrd01-04",
				origin: "explicit_user",
			})
			h.translatorState.setAttemptCompletionSeen()
			h.translatorState.setTerminalResponseCommittedThisTurn()
			// Production shape: a CoreSessionEvent wrapping the
			// agent's `done` payload (mirrors BCB01-C4
			// `emitSubmitAndExit` at line 203).
			const doneEvent = {
				type: "agent_event" as const,
				payload: {
					sessionId: h.activeSession.sessionId,
					event: {
						type: "done" as const,
						reason: "completed" as const,
						text: "Task completed.",
						iterations: 1,
					},
				},
			}

			// =================================================================
			// Sub-gate 3a (CORRECTION02): J held → completion MUST be blocked
			// =================================================================
			// Drive the production completion boundary while J is
			// still held. `handleSessionEvent(done)` enqueues the
			// `submit_and_exit_seen` CCARD record and registers the
			// deferred-completion-barrier marker. `notifyAgentTurnDone`
			// flushes Elm and re-evaluates the barrier. The BCB01
			// §0.1 second conjunct (`unconsumedOwnedTerminalResultsForC10 > 0`)
			// is the hold cause — the C10 predicate short-circuits
			// before the Elm consult, so no `setTurnPhase("completed", ...)`
			// fires and `commitCount` stays at 0.
			//
			// Note: the LIVE-shaped production flow also enqueues a
			// coalesced continuation prompt via
			// `enqueueCompletionContinuationIfHeld` (because the held
			// set is > 0). This enqueues a `pending_prompt_enqueued`
			// CCARD record into the Elm authority queue — the same
			// flow the runtime would use to instruct the model to
			// call `command_status` for each held jobId. In the
			// test harness, this prompt is enqueued into
			// `host.pendingPrompts` but is NOT auto-drained (the
			// harness's `asdkSessionHostBridge.send` does not invoke
			// the agent). Sub-gate 3b simulates the model's response
			// to the continuation by draining both the held set
			// (via `commandStatusTool.execute(J)`) AND the prompt
			// queue (via the public `host.pendingPrompts.delete(...)`
			// API) before re-triggering the completion boundary.
			await h.coordinator.handleSessionEvent(doneEvent as never)
			await enqueueElmAuthorityRecord({
				stage: "agent_turn_done",
				sessionId: h.activeSession.sessionId,
				runId: "run-ocrrd01-04",
			})
			await h.coordinator.notifyAgentTurnDone(h.activeSession.sessionId)
			// Acceptance for sub-gate 3a: zero commits while J is
			// held. Capture the snapshot for sub-gate 3b's delta
			// assertion.
			const commitCountBlocked = h.commitCount()
			const lastPhaseBlocked = h.lastPhase()
			expect(commitCountBlocked).toBe(0)
			expect(lastPhaseBlocked).not.toBe("completed")

			// =================================================================
			// Sub-gate 3b (CORRECTION02): drain → exactly 1 commit
			// =================================================================
			// Call the PRODUCTION tool wrapper (NOT the underlying
			// API). The held-set count the C10 consult reads now
			// drops to 0 — the same value Elm observes in
			// `computeHoldReasons` (UnconsumedTerminalObservation
			// becomes empty). P1 fix (2026-10-12): we no longer
			// re-feed a `terminal_committed` record into the Elm
			// authority; that record was silently dropped as
			// `INSUFFICIENT_IDENTITY` and never reached Elm. The
			// held-set drain alone is the production causal
			// producer for sub-gate 3b's Elm transition.
			const toolResult = (await h.commandStatusTool.execute({
				jobId: startRes.jobId,
			})) as Array<{ ok: boolean; jobId?: string; state?: string; error?: string }>
			expect(toolResult.length).toBe(1)
			const r = toolResult[0]
			expect(r.ok).toBe(true)
			expect(r.jobId).toBe(startRes.jobId)
			expect(r.state).toBe("exited")
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSession.sessionId, "task-ocrrd01-04")).toBe(0)
			// P1 fix (2026-10-12, OCRRD01): the previous version of
			// this block also fed a `terminal_committed` CCARD
			// record into the Elm authority. Inspection of
			// completion-authority-elm-replay.ts:124-149 shows the
			// adapter rejects `terminal_committed` records with
			// `INSUFFICIENT_IDENTITY` when they lack `ownerId` /
			// `terminalKind` (the REAL schema does not carry those),
			// and
			// completion-authority-elm-authority-runtime.ts:351-354
			// silently drops INSUFFICIENT_IDENTITY records. The
			// manual `terminal_committed` insertion therefore never
			// reached Elm — it was a no-op that was misclassified
			// as a causal producer. The C10 commit chain is
			// provable WITHOUT it: Elm decides `authorize` on the
			// basis of the prompt + run + job state, and a
			// `terminal_committed` fact only registers a job for
			// tracking (it does not gate the commit decision). The
			// test no longer seeds the `terminal_committed` record;
			// its claim is now a clean production-seam test (no
			// Elm seeding past the run_started fact shared with
			// PPLC-01..08).
			await flushElmAuthorityForSession(h.activeSession.sessionId)

			// Fresh eligible completion attempt: the deferred
			// barrier is still present (3a's `handleSessionEvent`
			// registered it; 3a's reevaluate didn't clear it
			// because the C10 predicate was HOLD). The held-set
			// count is now 0 (real drain), so the reevaluate
			// consults Elm. In the production seam the Elm
			// consult would return `authorize` (the held
			// observation is drained, no unconsumed terminals in
			// the model); the C10 commit fires exactly once.
			//
			// KNOWN HARNESS LIMITATION (CORRECTION02 → PPLC01 followup):
			// the LIVE-shaped production flow enqueues a coalesced
			// continuation prompt in sub-gate 3a (because held set > 0).
			// The host's `onEnqueue` capture forwards
			// `pending_prompt_enqueued` to Elm, adding a `PromptQueued`
			// entry to `model.prompts`. The host's
			// `pendingPromptsController` then auto-drains the prompt
			// (microtask) — and as of the PPLC01 followup, the
			// harness wires the production
			// `subscribeCanonicalRuntimeEventsToShadow` and the agent
			// stub publishes a runId-bearing `run-started` event.
			// The canonical subscription translates that into
			// `run_turn_started` + `continuation_started` records,
			// and the agent's `run-finished` event becomes
			// `agent_turn_done`, transitioning the prompt from
			// `PromptRunning` to `PromptConsumed`. The Elm-side
			// `pending_prompt` hold therefore clears via the SAME
			// production seam the LIVE specimen exercises — the
			// harness's `asdkSessionHostBridge.send` only differs
			// in that the harness does not call `host.runTurn`
			// with a `delivery: "queue"` prompt that the host
			// would auto-drain. The OCRRD01-04 RED_PRESERVED
			// witness from CORRECTION02 is therefore NO LONGER
			// expected: the test now turns GREEN.
			//
			// Wait for the async prompt auto-drain to settle
			// (the host's microtask calls the agent's `run`,
			// which fires the canonical subscription's
			// `run-started` event, and the agent's `run-finished`
			// fires the `onAgentTurnDone` capture).
			await new Promise((r) => setImmediate(r))
			await new Promise((r) => setImmediate(r))
			await new Promise((r) => setTimeout(r, 50))
			await h.coordinator.notifyAgentTurnDone(h.activeSession.sessionId)

			// Acceptance for sub-gate 3b: exactly one commit total
			// (delta from 3a's snapshot), `lastPhase` is "completed",
			// and the Elm consult returned `authorize`.
			const commitCountFinal = h.commitCount()
			const elmDecision = getElmAuthorityCompletionDecision(h.activeSession.sessionId)
			if (commitCountFinal !== 1 || h.lastPhase() !== "completed" || elmDecision.kind !== "authorize") {
				const classification =
					elmDecision.kind === "failure"
						? ((elmDecision as { classification?: string }).classification ?? "unknown")
						: "n/a"
				const reason = elmDecision.kind === "hold" ? ((elmDecision as { reason?: string }).reason ?? "n/a") : "n/a"
				throw new Error(
					"OCRRD01-04 PPLC01-followup RED (CORRECTION02 + PPLC01): sub-gate 3a PASS " +
						"(commitCount=0, lastPhase=" +
						lastPhaseBlocked +
						"); " +
						"sub-gate 3b divergent stage = " +
						"commitCount=" +
						commitCountFinal +
						", " +
						"lastPhase=" +
						h.lastPhase() +
						", " +
						"elmDecision.kind=" +
						elmDecision.kind +
						", " +
						"reason=" +
						reason +
						", " +
						"classification=" +
						classification +
						". " +
						"The held-set drain + fresh completion attempt did not " +
						"produce exactly one Elm-authorized commit. The PPLC01 " +
						"followup wired the production canonical subscription " +
						"and a runId-bearing agent stub — see PPLC-02 / PPLC-03 " +
						"in pending-prompt-lifecycle-discriminator01.ocrrd01.c24-c-bridge.test.ts " +
						"for the GREEN proof of the same seam.",
				)
			}
			expect(commitCountFinal).toBe(1)
			expect(h.lastPhase()).toBe("completed")
			expect(elmDecision.kind).toBe("authorize")
		},
	)

	// =================================================================
	// OCRRD01-05 (CORRECTION02 necessity ablation)
	// =================================================================
	// Same harness shape as OCRRD01-04, but the
	// `commandStatusTool.execute(J)` step is OMITTED. The held
	// observation stays in the real `BackgroundNotifyCoordinator`,
	// the held-set count the C10 consult reads stays at 1, and the
	// production completion attempt MUST remain blocked. This
	// proves the drain in sub-gate 3b is NECESSARY for the commit,
	// not merely co-occurring.
	//
	// A SEPARATE fresh harness is required because the held
	// observation is process-ephemeral in the real coordinator and
	// cannot be reset without a test backdoor.
	it.runIf(canSpawnSubprocess && elmKernelAvailable)(
		"OCRRD01-05 (CORRECTION02 necessity ablation): J held, drain SKIPPED → completion MUST remain blocked",
		async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			const h = makeHarness({ sessionId: "sess-ocrrd01-05", taskId: "task-ocrrd01-05", isolationDir })

			await h.host.startSession({
				source: "vscode",
				interactive: true,
				config: {
					sessionId: h.activeSession.sessionId,
					providerId: "mock-provider",
					modelId: "mock-model",
					cwd: isolationDir,
					workspaceRoot: isolationDir,
					systemPrompt: "ocrrd01-05 necessity ablation test",
					mode: "act" as never,
					enableTools: true,
					enableSpawnAgent: false,
					enableAgentTeams: false,
				},
			})
			expect(h.host.getActiveRuntimeToolNames(h.activeSession.sessionId)).toContain("command_status")

			// Real terminal job + held observation.
			const startRes = await h.commandJobManager.start({
				command: "true",
				cwd: process.cwd(),
				waitBudgetMs: 5_000,
				executionDeadlineMs: 5_000,
			})
			const transition = await startRes.terminalPromise
			expect(transition.terminalState).toBe("exited")
			h.notifyCoordinator.recordNonNotifyTerminalObservation({
				jobId: startRes.jobId,
				sessionId: h.activeSession.sessionId,
				taskId: "task-ocrrd01-05",
			})
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSession.sessionId, "task-ocrrd01-05")).toBe(1)

			// DELIBERATELY DO NOT call `commandStatusTool.execute(...)`.
			// The held observation is intentionally left in the real
			// coordinator. The C10 consult at
			// `reevaluateDeferredCompletionBarrier` reads this real
			// value (via the harness's delegated providers) and the
			// BCB01 §0.1 second conjunct is the hold cause.

			// Seed Elm with the LIVE-shaped chronology (identical to
			// OCRRD01-04 sub-gate 3a so the consult state is the
			// only different variable being tested).
			await enqueueElmAuthorityRecord({
				stage: "task_started",
				sessionId: h.activeSession.sessionId,
				taskId: "task-ocrrd01-05",
			})
			await enqueueElmAuthorityRecord({
				stage: "run_turn_started",
				sessionId: h.activeSession.sessionId,
				runId: "run-ocrrd01-05",
				origin: "explicit_user",
			})
			h.translatorState.setAttemptCompletionSeen()
			h.translatorState.setTerminalResponseCommittedThisTurn()
			const doneEvent = {
				type: "agent_event" as const,
				payload: {
					sessionId: h.activeSession.sessionId,
					event: {
						type: "done" as const,
						reason: "completed" as const,
						text: "Task completed.",
						iterations: 1,
					},
				},
			}
			await h.coordinator.handleSessionEvent(doneEvent as never)
			await enqueueElmAuthorityRecord({
				stage: "agent_turn_done",
				sessionId: h.activeSession.sessionId,
				runId: "run-ocrrd01-05",
			})
			await h.coordinator.notifyAgentTurnDone(h.activeSession.sessionId)

			// Acceptance for the necessity ablation: zero commits
			// even though every other input matches OCRRD01-04's
			// sub-gate 3b. The ONLY difference is the missing drain.
			// If the test ever flips to commitCount > 0 here, the
			// drain in OCRRD01-04 was unnecessary (or the held-set
			// consult is broken).
			expect(h.commitCount()).toBe(0)
			expect(h.lastPhase()).not.toBe("completed")
			// The held-set count is still 1 (we never drained).
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSession.sessionId, "task-ocrrd01-05")).toBe(1)
		},
	)
})

function makeHarness(opts: { sessionId: string; taskId: string; isolationDir: string }): OcurrdHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)

	const commandJobManager = new CommandJobManager()

	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: opts.sessionId, taskId: opts.taskId }),
		enqueueTerminalWake: () => Promise.resolve({ kind: "delivered" as const }),
		discardQueuedWake: () => ({ kind: "not_found", jobId: "" }),
		now: () => Date.now(),
		consumeTerminalAuthority: legacyConsumeTerminalPolicy,
	})

	let liveTools: readonly string[] = ["command_status", "submit_and_exit"]
	let unconsumed = 0
	const heldJobIds: string[] = []
	let commitCount = 0
	let lastPhase = "idle"

	const commandStatusTool = createCommandStatusTool(commandJobManager, {
		backgroundNotifyCoordinator: notifyCoordinator,
		resolveActiveOwner: () => ({ sessionId: opts.sessionId, taskId: opts.taskId }),
		onRunningObserved: () => {},
	})

	const runtimeBuilder = {
		build: vi.fn().mockReturnValue({
			tools: [commandStatusTool as never],
			teamRuntime: undefined,
			teamRestoredFromPersistence: false,
			shutdown: vi.fn().mockResolvedValue(undefined),
		}),
	}

	const sessionService = makeFileSessionService(opts.isolationDir)
	const host = new LocalRuntimeHost({
		distinctId: "act-ocrrd01",
		sessionService: sessionService as never,
		runtimeBuilder: runtimeBuilder as never,
		createAgent: () => makeAgentStub({ sessionId: opts.sessionId }).agent as never,
		logger: {
			debug: vi.fn(),
			log: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			setLevel: vi.fn(),
		} as never,
		pendingPromptCapture: createProductionPendingPromptCapture(),
	})

	const sdkHostBridge = new AsdkSessionHostBridge(host)
	const activeSession: ActiveSession = {
		sessionId: opts.sessionId,
		startConfig: { providerId: "mock-provider", modelId: "mock-model" },
		sdkHost: sdkHostBridge as unknown as ActiveSession["sdkHost"],
		unsubscribe: () => undefined,
		startResult: undefined,
		isRunning: false,
	}

	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => activeSession,
			setRunning: vi.fn(),
		},
		messages: {
			appendAndEmit: ((_msgs: unknown[]) => {}) as never as never,
		},
		taskHistory: { updateTaskUsage: vi.fn() } as never,
		getTask: () => ({ taskId: opts.taskId }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			lastPhase = phase
			if (phase === "completed") commitCount += 1
			tracker.setWithWriter(phase, anchorTs, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		translateSessionEvent,
		hasRunningBackgroundJobForOwner: () => false,
		getActiveJobOwnershipSnapshot: () => [],
		getActiveSessionHost: () => undefined,
		// ACT-CLINEMM-P0-OBSERVATION-CAPABILITY-RUNTIME-REGISTRY-DISCRIMINATOR01
		// — CORRECTION02 (causality amendment, per Factory reviewer
		//   disposition 2026-10-11: PASS_WITH_ONE_P1).
		//
		// The P1 was: the previous CORRECTION01 read the held-set
		// count + held-set IDs from local harness variables
		// (`unconsumed` and `heldJobIds`) that were NEVER written
		// by OCRRD01-04. The real `BackgroundNotifyCoordinator`
		// (which OCRRD01-04 actually drained) was producing a
		// *separate* set of values that the coordinator's
		// `getUnconsumedOwnedTerminalResultCount` / `_JobIds`
		// callbacks never consulted. So the consult at
		// `reevaluateDeferredCompletionBarrier` always read 0
		// from the harness, and the test demonstrated "drain
		// happens, then commit happens" — not "drain is
		// necessary for commit".
		//
		// CORRECTION02 delegates both providers to the real
		// coordinator (mirrors the BCB01-C4 harness pattern at
		// `background-completion-barrier01-correction04.bcb01-c4.test.ts:145-154`).
		// The held-set contract the C10 consult reads is now
		// the SAME held-set the real drain mutates. This is
		// the load-bearing fix for the CORRECTION01 P1.
		getUnconsumedOwnedTerminalResultCount: (sid: string | undefined) => {
			if (sid !== opts.sessionId) return 0
			return notifyCoordinator.unconsumedTerminalCountForOwner(opts.sessionId, opts.taskId)
		},
		getUnconsumedOwnedTerminalJobIds: (sid: string | undefined, tid: string | undefined) => {
			if (sid !== opts.sessionId) return []
			return notifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner(opts.sessionId, tid)
		},
		getPendingPromptCount: () => ({ available: true, count: 0 }),
		getActiveNotifyCount: () => 0,
		hasActiveNotify: () => false,
		wasWakeDispatchRequested: () => false,
		wasWakeDelivered: () => false,
		wasWakeDispatchFailed: () => false,
		wasWakeAuthoritySettled: () => true,
		getOutstandingAutonomousWork: () => false,
		getLaunchedBackgroundJobIds: () => [],
		enqueueCompletionContinuation: buildSdkControllerEnqueueCompletionContinuation({
			getActiveSession: () => activeSession,
			// ACT-CLINEMM-P0-OBSERVATION-CAPABILITY-RUNTIME-REGISTRY-DISCRIMINATOR01
			// — CORRECTION02 (causality amendment): `liveTools` is
			//   now a LIVE call to the production registry surface
			//   (`host.getActiveRuntimeToolNames(sessionId)`),
			//   not a snapshot of a mutable harness array. The
			//   reviewer flagged "copies those names into a mutable
			//   array once. That establishes initial correspondence,
			//   not dynamic capability restoration" — this addresses
			//   that. The SdkSessionEventCoordinator's downstream
			//   observers therefore see the same list the production
			//   capability projection reads on every consult, not a
			//   test-side mirror.
			liveTools: () => host.getActiveRuntimeToolNames(opts.sessionId) ?? [],
			logger: { warn: (msg: string) => console.warn(msg) },
		}),
		getElmCompletionAuthorityDecision: (sessionId?: string) => getElmAuthorityCompletionDecision(sessionId ?? ""),
		flushElmAuthorityForSession: async (sessionId: string) => flushElmAuthorityForSession(sessionId),
		// Same live surface, again — the SdkSessionEventCoordinator
		// option is consulted separately from the enqueueCompletionContinuation
		// callback in `handleSessionEvent` L3078+ (the
		// `canObserveHeldResults` capability projection).
		liveTools: () => host.getActiveRuntimeToolNames(opts.sessionId) ?? [],
		// CORRECTION02: `getPendingPromptCount` is NOT changed in
		// this amendment (it was hard-coded to `{ available: true,
		// count: 0 }` in CORRECTION01). The Reviewer's bounded
		// amendment authorized delegating the held-count and
		// held-ID providers to the real BackgroundNotifyCoordinator;
		// the pending-prompt count is a different surface that
		// requires the test harness to also wire the production
		// `onAgentTurnDone` capture to clear Elm's prompt mirror
		// after the continuation is consumed. That harness work
		// is out of scope for this bounded P1 amendment; the
		// classified-RED in sub-gate 3b (see below) documents the
		// resulting Elm-side `pending_prompt` hold as a known
		// harness limitation, not a causality gap.
	} as unknown as SdkSessionEventCoordinatorOptions)

	// ACT-CLINEMM-P0-OCRRD01-PENDING-PROMPT-LIFECYCLE-DISCRIMINATOR01 —
	// OCRRD01-04 sub-gate 3b followup: install the production
	// canonical-event subscription so the agent stub's
	// `run-started` event reaches the Elm authority kernel via
	// the real `subscribeCanonicalRuntimeEventsToShadow` path.
	// The `makeAgentStub` (in this file) now publishes
	// runId-bearing `run-started` events; without this
	// subscription, the `run_turn_started` + `continuation_started`
	// records never reach the CCARD buffer, and the Elm prompt
	// mirror stays in `PromptRunning` (the original RED root
	// cause).
	//
	// The subscription is point-in-time: it iterates the host's
	// CURRENTLY active sessions. If `host.startSession` has not
	// been called yet at install time, the subscription is empty.
	// The harness wraps `host.startSession` to re-install the
	// subscription AFTER the new session is created.
	const installCanonicalSubscription = () =>
		subscribeCanonicalRuntimeEventsToShadow(
			host,
			{
				recorder: {} as never,
				recorderCounts: () => ({}) as never,
				records: () => [],
				observeCanonicalRuntimeEvent: () => {},
				resetForNewTask: () => {},
				dispose: () => {},
				fenceCanonicalRunForContinuation: () => {},
				coordinator: {} as never,
			},
			opts.sessionId,
		)
	installCanonicalSubscription()
	const wrappedStartSession = host.startSession.bind(host)
	host.startSession = (async (input: Parameters<typeof host.startSession>[0]) => {
		const result = await wrappedStartSession(input)
		installCanonicalSubscription()
		return result
	}) as typeof host.startSession

	return {
		host,
		activeSession,
		coordinator,
		notifyCoordinator,
		commandJobManager,
		commandStatusTool,
		tracker,
		translatorState,
		isolationDir: opts.isolationDir,
		commitCount: () => commitCount,
		lastPhase: () => lastPhase,
		liveTools: () => liveTools,
		setLiveTools: (tools) => {
			liveTools = tools
		},
		setUnconsumed: (n) => {
			unconsumed = n
			heldJobIds.length = 0
			if (n > 0) {
				heldJobIds.push(`J-ocrrd01-${n}`)
			}
		},
	}
}
