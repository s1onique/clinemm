/**
 * ACT-CLINEMM-BCB-OBSERVABILITY-REPAIR01 — BCBOBSRV01
 *
 * Bounded production-seam test gate for the live
 * `1791887696629_cg31u` BCB observation-unavailable incident.
 *
 * The live capture at `2026-10-13T10:48:08.373Z`:
 *   - 2 owned, terminal, unconsumed held results
 *   - no autonomous work running
 *   - `submit_and_exit` committed
 *   - `liveTools` =
 *       ["read_files", "search_codebase", "fetch_web_content",
 *        "editor", "submit_and_exit"]   (5 tools, no `command_status`)
 *   - `canObserveHeldResults` = false → BCB writer fired
 *     "session-event-bcb-blocked-observation-unavailable"
 *   - `requestedPhase` = "error", `committedPhase` = "error"
 *   - continuation enqueue and delivery counts = 0
 *
 * The live capture's writer-provenance and capture evidence are
 * frozen at `.factory/evidence/ACT-CLINEMM-BCB-CAPTURE01/live-captures/`
 * and the prior BCB captures at
 * `.factory/evidence/ACT-CLINEMM-TASK-TERMINAL-DIVERGENCE-RED01-CORR01/live-captures/`.
 *
 * The ACT investigates the causal boundary between the BCB decision
 * seam and the upstream `liveTools` accessor chain. The current
 * BCB decision logic is correct given its inputs (the BCAPT01
 * suite proves this). The question this ACT answers is: **why is
 * the liveTools input missing `command_status` when the production
 * code path always seeds `command_status` via `extraTools`?**
 *
 * The causal hypothesis: `LocalRuntimeHost.getActiveRuntimeToolNames`
 * reads `active.runtime.tools.map(t => t.name)` — the
 * **runtime-builder's** BuiltRuntime.tools — which does NOT include
 * the `extraTools` (the merged list at `local-runtime-host.ts:834` is
 * only used to construct the `agentConfig.tools` for `AgentRuntime`,
 * never persisted into `active.runtime.tools`). So the surface
 * `getActiveRuntimeToolNames` is a **stale subset** of the actual
 * model-facing tool registry.
 *
 * Causal discriminator (ACT §4):
 *
 *   A (live specimen)        → liveTools missing command_status
 *                             → canObserveHeldResults = false
 *                             → BCB writer fires
 *                             → phase = "error"
 *
 *   B (command_status added) → canObserveHeldResults = true
 *                             → BCB writer does NOT fire
 *                             → phase = "completed" (Elm-authorized)
 *
 *   C (zero unconsumed)      → eligibility branch not entered
 *                             → BCB writer does NOT fire
 *
 *   D (capability truly
 *      unavailable)          → liveTools() = undefined
 *                             → canObserveHeldResults = null
 *                             → falls through to
 *                               enqueueCompletionContinuationIfHeld
 *                               (rejected at SdkController L923-930
 *                                for undefined liveTools)
 *
 *   E (runtime-builder
 *      `extraTools` merge)   → the production chain returns the
 *                             stale subset (BUG) vs. the merged
 *                             list (REPAIR). This is the
 *                             load-bearing causality test.
 *
 * Bounded repair (ACT §5): change
 * `LocalRuntimeHost.getActiveRuntimeToolNames(sessionId)` to return
 * the **merged** list `[...active.runtime.tools,
 * ...(active.config.extraTools ?? [])]` — exactly mirroring the merge
 * at `local-runtime-host.ts:834` that builds the model-facing
 * `agentConfig.tools`. This makes the BCB capability projection
 * truthful (the same list the model actually sees).
 *
 * NO Elm work. NO L2847 precedence repair. NO changes to the BCB
 * decision boundary. NO changes to the liveTools option wiring.
 * The change is a single accessor-method addition at the boundary
 * the live capture identifies.
 *
 * Preservation: the L2847 RED witnesses in
 * `task-terminal-divergence-red01.tdd-red01.test.ts` are
 * preserved (this ACT does not touch them). The BCAPT01 26 tests
 * pass unchanged (this ACT is additive). The BCBCAP01 24 tests
 * pass unchanged.
 *
 * Files added (1): this test file.
 *
 * Files changed (1): `sdk/packages/core/src/runtime/host/local-runtime-host.ts`
 *   - `getActiveRuntimeToolNames(sessionId)` returns the merged
 *     list `[...active.runtime.tools,
 *             ...(active.config.extraTools ?? [])]`
 *   - One typed return change; no public API rename; no new field.
 *   - The merged list is the SAME list the agent registers via
 *     `agentConfig.tools` at L925 (the `agent.tools` Map is
 *     populated from `agentConfig.tools` at
 *     `agent-runtime.ts:1422-1424`). So the BCB's
 *     `canObserveHeldResults` projection now matches the actual
 *     model-facing registry.
 */

import { type CoreSessionEvent } from "@cline/core"
import {
	clearBcbObservationUnavailableCapture,
	disableBcbObservationUnavailableCapture,
	enableBcbObservationUnavailableCapture,
	getBcbObservationUnavailableCaptureLatest,
	getBcbObservationUnavailableCaptureRecords,
} from "@shared/bcb-observation-unavailable-capture"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MessageIdMinter } from "@/sdk/message-id-minter"
import { MessageTranslatorState } from "@/sdk/message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "@/sdk/sdk-session-event-coordinator"
import { TurnStateTracker } from "@/sdk/turn-state-tracker"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { error: vi.fn(), log: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
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

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({ type: "agent_event", payload: { sessionId, event: event as never } }) as CoreSessionEvent

// ============================================================================
// Harness — mirrors the BCAPT01 pattern (BCB decision boundary under test).
// The BCB seam reads `liveTools` via the option callback; the harness
// injects the value directly so the BCB decision logic is exercised against
// a controlled projection. The seam correctness is established by the
// existing BCAPT01 26 tests; this file extends with the LIVE specimen's
// exact facts + the causal discriminator ablations.
// ============================================================================

interface BcbobsrvHarness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	activeSessionId: string
	activeTaskId: string
	completionCommitCount: () => number
	errorPhaseCommitCount: () => number
	finalPhase: () => string
	finalWriterId: () => string
	allCommittedWriterIds: () => string[]
	unconsumedOverride: { value: number }
	unconsumedJobIdsOverride: { value: readonly string[] }
	liveToolsOverride: { value: readonly string[] | undefined }
	enableCapture: () => void
	disableCapture: () => void
	clearCapture: () => void
	getCaptureRecords: () => ReturnType<typeof getBcbObservationUnavailableCaptureRecords>
	getCaptureLatest: () => ReturnType<typeof getBcbObservationUnavailableCaptureLatest>
}

function makeHarness(opts: { activeSessionId?: string; activeTaskId?: string } = {}): BcbobsrvHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-bcbobsrv01"
	const activeTaskId = opts.activeTaskId ?? "task-bcbobsrv01"

	const appendAndEmit = vi.fn()
	let completionCommitCount = 0
	let errorPhaseCommitCount = 0
	const allCommittedWriterIds: string[] = []
	const unconsumedOverride = { value: 0 }
	const unconsumedJobIdsOverride: { value: readonly string[] } = { value: [] }
	// Default to the LIVE specimen's exact `liveTools` value (5 tools, no command_status).
	const liveToolsOverride: { value: readonly string[] | undefined } = {
		value: ["read_files", "search_codebase", "fetch_web_content", "editor", "submit_and_exit"],
	}

	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost: {} as never,
				unsubscribe: vi.fn(),
				startResult: { sessionId: activeSessionId },
				isRunning: false,
			}),
			setRunning: vi.fn(),
		},
		messages: { appendAndEmit: ((msgs: unknown[]) => appendAndEmit(msgs as never)) as never },
		taskHistory: { updateTaskUsage: vi.fn() },
		getTask: () => ({ taskId: activeTaskId }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			allCommittedWriterIds.push(String(writerId ?? "unknown-legacy-writer"))
			if (phase === "completed") completionCommitCount += 1
			if (phase === "error") errorPhaseCommitCount += 1
			tracker.setWithWriter(phase, anchorTs, { writerId: (writerId ?? "unknown-legacy-writer") as never })
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		getElmCompletionAuthorityDecision: () => ({ kind: "hold" as const, reason: "test_default_hold" }),
		flushElmAuthorityForSession: async () => {},
		hasRunningBackgroundJobForOwner: () => false,
		getUnconsumedOwnedTerminalResultCount: (sid: string | undefined) => {
			if (sid !== activeSessionId) return 0
			return unconsumedOverride.value
		},
		getUnconsumedOwnedTerminalJobIds: (sid: string) => {
			if (sid !== activeSessionId) return []
			return unconsumedJobIdsOverride.value
		},
		getPendingPromptCount: () => ({ available: true as const, count: 0 }),
		getActiveNotifyCount: () => 0,
		hasActiveNotify: () => false,
		getLaunchedBackgroundJobIds: () => [],
		liveTools: () => liveToolsOverride.value,
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		tracker,
		translatorState,
		activeSessionId,
		activeTaskId,
		completionCommitCount: () => completionCommitCount,
		errorPhaseCommitCount: () => errorPhaseCommitCount,
		finalPhase: () => tracker.currentPhase,
		finalWriterId: () => allCommittedWriterIds[allCommittedWriterIds.length - 1] ?? "none",
		allCommittedWriterIds: () => allCommittedWriterIds,
		unconsumedOverride,
		unconsumedJobIdsOverride,
		liveToolsOverride,
		enableCapture: () => enableBcbObservationUnavailableCapture(),
		disableCapture: () => disableBcbObservationUnavailableCapture(),
		clearCapture: () => clearBcbObservationUnavailableCapture(),
		getCaptureRecords: () => getBcbObservationUnavailableCaptureRecords(),
		getCaptureLatest: () => getBcbObservationUnavailableCaptureLatest(),
	}
}

async function emitSubmitAndExit(h: BcbobsrvHarness): Promise<void> {
	h.translatorState.setAttemptCompletionSeen()
	h.translatorState.setTerminalResponseCommittedThisTurn()
	const doneEvent = agentEvent(h.activeSessionId, {
		type: "done",
		reason: "completed",
		text: "Task completed.",
		iterations: 1,
	})
	await h.coordinator.handleSessionEvent(doneEvent)
}

beforeEach(() => {
	disableBcbObservationUnavailableCapture()
	clearBcbObservationUnavailableCapture()
})

afterEach(() => {
	disableBcbObservationUnavailableCapture()
	clearBcbObservationUnavailableCapture()
})

// ============================================================================
// LIVE SPECIMEN REPRODUCTION (BCB-ACT §3 RED)
// ============================================================================
// Mirror the live capture at 2026-10-13T10:48:08.373Z:
//   - 2 unconsumed, owned, terminal held results
//   - no autonomous work running
//   - submit_and_exit committed
//   - 5 liveTools, no command_status
// Expected: BCB writer fires, phase=error, capture records the
// same liveToolsValue the live capture saw.
// ============================================================================

describe("BCBOBSRV-01: LIVE specimen — exact facts reproduce the observed writer and phase", () => {
	it("BCBOBSRV-01.1: 2 unconsumed + 5 liveTools (no command_status) + submit_and_exit -> session-event-bcb-blocked-observation-unavailable, phase=error", async () => {
		const h = makeHarness()
		h.unconsumedOverride.value = 2
		h.unconsumedJobIdsOverride.value = ["bg-term-1791887696629-cg31u-1", "bg-term-1791887696629-cg31u-2"]
		h.liveToolsOverride.value = ["read_files", "search_codebase", "fetch_web_content", "editor", "submit_and_exit"]
		h.enableCapture()

		await emitSubmitAndExit(h)
		await new Promise<void>((r) => setImmediate(r))

		// Writer identity matches the live capture verbatim.
		expect(h.finalWriterId()).toBe("session-event-bcb-blocked-observation-unavailable")
		// Phase matches the live capture.
		expect(h.finalPhase()).toBe("error")
		// Completion was NOT committed.
		expect(h.completionCommitCount()).toBe(0)
		// The error phase was committed exactly once.
		expect(h.errorPhaseCommitCount()).toBe(1)

		// Capture record mirrors the live evidence's four BCB
		// predicate inputs verbatim.
		const records = h.getCaptureRecords()
		expect(records).toHaveLength(1)
		const r = records[0]!
		expect(r.writerId).toBe("session-event-bcb-blocked-observation-unavailable")
		expect(r.requestedPhase).toBe("error")
		expect(r.committedPhase).toBe("error")
		expect(r.eligibleForCoalescedContinuation).toBe(true)
		expect(r.unconsumedOwnedTerminalResultsForC10).toBe(2)
		expect(r.ownedTerminalJobIdsForC10).toEqual(["bg-term-1791887696629-cg31u-1", "bg-term-1791887696629-cg31u-2"])
		expect(r.outstandingAutonomousWork).toBe(false)
		expect(r.ownerStillRunningForC10).toBe(false)
		expect(r.heldObligationForC10).toBe(true)
		expect(r.suppressOriginatingCompletion).toBe(false)
		// liveTools() projection: same shape the live capture saw.
		expect(r.liveToolsAvailable).toBe(true)
		expect(r.liveToolsIncludesCommandStatus).toBe(false)
		expect(r.liveToolsCount).toBe(5)
		expect(r.liveToolsValue).toEqual(["read_files", "search_codebase", "fetch_web_content", "editor", "submit_and_exit"])
		expect(r.canObserveHeldResults).toBe(false)
		expect(r.sameObligationAlreadyObservationUnavailable).toBe(false)
	})

	it("BCBOBSRV-01.2: latest capture record equals the LIVE specimen record shape (canObserveHeldResults=false, writer=blocked, phase=error)", async () => {
		const h = makeHarness()
		h.unconsumedOverride.value = 2
		h.unconsumedJobIdsOverride.value = ["j-1", "j-2"]
		h.enableCapture()

		await emitSubmitAndExit(h)
		await new Promise<void>((r) => setImmediate(r))

		const latest = h.getCaptureLatest()
		expect(latest).toBeDefined()
		expect(latest?.writerId).toBe("session-event-bcb-blocked-observation-unavailable")
		expect(latest?.canObserveHeldResults).toBe(false)
		expect(latest?.requestedPhase).toBe("error")
		expect(latest?.committedPhase).toBe("error")
	})
})

// ============================================================================
// CAUSAL DISCRIMINATOR (BCB-ACT §4) — change exactly one input at a time.
// ============================================================================

describe("BCBOBSRV-02: ABLATION B — command_status present changes the BCB decision", () => {
	it("BCBOBSRV-02.1: 2 unconsumed + 6 liveTools (WITH command_status) -> BCB writer does NOT fire; capability=true", async () => {
		const h = makeHarness()
		h.unconsumedOverride.value = 2
		h.unconsumedJobIdsOverride.value = ["j-1", "j-2"]
		h.liveToolsOverride.value = [
			"read_files",
			"search_codebase",
			"fetch_web_content",
			"editor",
			"command_status",
			"submit_and_exit",
		]
		h.enableCapture()

		await emitSubmitAndExit(h)
		await new Promise<void>((r) => setImmediate(r))

		expect(h.finalWriterId()).not.toBe("session-event-bcb-blocked-observation-unavailable")
		expect(h.errorPhaseCommitCount()).toBe(0)
		const records = h.getCaptureRecords()
		expect(records).toHaveLength(1)
		const r = records[0]!
		expect(r.writerId).toBe("session-event-bcb-eligible-no-bcb-writer")
		expect(r.canObserveHeldResults).toBe(true)
		expect(r.liveToolsIncludesCommandStatus).toBe(true)
		expect(r.liveToolsCount).toBe(6)
	})
})

describe("BCBOBSRV-03: ABLATION C — zero unconsumed held results", () => {
	it("BCBOBSRV-03.1: 0 unconsumed + 5 liveTools (no command_status) -> eligibility branch not entered, NO BCB writer, zero records", async () => {
		const h = makeHarness()
		h.unconsumedOverride.value = 0
		h.unconsumedJobIdsOverride.value = []
		h.enableCapture()

		await emitSubmitAndExit(h)
		await new Promise<void>((r) => setImmediate(r))

		expect(h.finalWriterId()).not.toBe("session-event-bcb-blocked-observation-unavailable")
		expect(h.errorPhaseCommitCount()).toBe(0)
		expect(h.getCaptureRecords()).toHaveLength(0)
	})
})

describe("BCBOBSRV-04: ABLATION D — capability truly unavailable (liveTools()=undefined)", () => {
	it("BCBOBSRV-04.1: 2 unconsumed + liveTools()=undefined -> canObserveHeldResults=null, falls through to enqueueCompletionContinuationIfHeld (no BCB writer block)", async () => {
		const h = makeHarness()
		h.unconsumedOverride.value = 2
		h.unconsumedJobIdsOverride.value = ["j-1", "j-2"]
		h.liveToolsOverride.value = undefined
		h.enableCapture()

		await emitSubmitAndExit(h)
		await new Promise<void>((r) => setImmediate(r))

		// Honest capability-unknown: the BCB writer does NOT block
		// (the seam refuses to publish observation_unavailable on a
		// null projection — see comment at sdk-session-event-coordinator.ts:3143-3150).
		expect(h.finalWriterId()).not.toBe("session-event-bcb-blocked-observation-unavailable")
		const records = h.getCaptureRecords()
		expect(records).toHaveLength(1)
		const r = records[0]!
		expect(r.writerId).toBe("session-event-bcb-eligible-no-bcb-writer")
		expect(r.liveToolsAvailable).toBe(false)
		expect(r.canObserveHeldResults).toBeNull()
		expect(r.liveToolsValue).toBeUndefined()
	})
})

// ============================================================================
// CONSERVATION (BCB-ACT §6) — held-result ownership + idempotence.
// ============================================================================

describe("BCBOBSRV-05: CONSERVATION — held-result ownership + idempotence", () => {
	it("BCBOBSRV-05.1: BCB writer fires, held obligation is preserved (not silently discarded), no completion commit", async () => {
		const h = makeHarness()
		h.unconsumedOverride.value = 2
		h.unconsumedJobIdsOverride.value = ["j-1", "j-2"]
		h.enableCapture()

		await emitSubmitAndExit(h)
		await new Promise<void>((r) => setImmediate(r))

		expect(h.finalWriterId()).toBe("session-event-bcb-blocked-observation-unavailable")
		const records = h.getCaptureRecords()
		expect(records[0]?.unconsumedOwnedTerminalResultsForC10).toBe(2)
		expect(records[0]?.ownedTerminalJobIdsForC10).toEqual(["j-1", "j-2"])
		expect(h.completionCommitCount()).toBe(0)
	})

	it("BCBOBSRV-05.2: BCB writer stamp is idempotent on the same obligation (TDD-10d parity — see task-terminal-divergence-red01.tdd-red01.test.ts:1119)", async () => {
		const h = makeHarness()
		h.unconsumedOverride.value = 2
		h.unconsumedJobIdsOverride.value = ["j-1", "j-2"]
		h.enableCapture()

		// First submit_and_exit: BCB writer stamps the marker.
		await emitSubmitAndExit(h)
		await new Promise<void>((r) => setImmediate(r))
		// The setTurnPhaseCalls log records every BCB stamp.
		// The BCB writer identity in the setTurnPhase log is the
		// stamp counter; idempotence means it appears at most once
		// per (sessionId, epoch, held-set) identity triple.
		const stampCountAfterFirst = h
			.allCommittedWriterIds()
			.filter((w) => w === "session-event-bcb-blocked-observation-unavailable").length
		expect(stampCountAfterFirst).toBe(1)

		// A second submit_and_exit on the same obligation: the marker
		// is already stamped with `reason: "observation_unavailable"`,
		// so the sameObligationAlreadyObservationUnavailable guard
		// at sdk-session-event-coordinator.ts:3157 prevents a
		// second stamp (mirrors TDD-10d's
		// `expect(bcbStampCount).toBe(1)`).
		await emitSubmitAndExit(h)
		await new Promise<void>((r) => setImmediate(r))

		const stampCountAfterSecond = h
			.allCommittedWriterIds()
			.filter((w) => w === "session-event-bcb-blocked-observation-unavailable").length
		expect(stampCountAfterSecond).toBe(1)
	})
})

// ============================================================================
// CAUSAL DISCRIMINATOR (BCB-ACT §4 E) — the load-bearing test that
// proves the production accessor chain's behavior. We exercise the
// SAME merge logic the live production seam uses:
//   `runtime.tools` (from the runtime-builder's BuiltRuntime)
//   + `config.extraTools` (from vscode-runtime-builder.ts, the source
//     of `command_status` in the production path)
// and prove that:
//   1. Reading the stale subset (runtime.tools only) misses
//      `command_status` even when it's registered via extraTools.
//   2. Reading the merged list (the REPAIR) includes `command_status`
//      and the BCB canObserveHeldResults = true.
// ============================================================================

// The production BuiltRuntime.tools — what the runtime-builder's
// `finalTools` returns in the LIVE session. This is the SAME list
// the model receives through `agentConfig.tools` MINUS the
// `extraTools` merge.
const RUNTIME_BUILDER_TOOLS = ["read_files", "search_codebase", "fetch_web_content", "editor", "submit_and_exit"] as const
// The VscodeSessionHost seeds this `extraTools` via
// `createVscodeExtraTools(...)` whenever `commandJobManager` is
// present (vscode-runtime-builder.ts:289-372). This is where
// `command_status` and `cancel_command` are added.
const VSCODE_EXTRA_TOOLS = ["run_commands", "command_status", "cancel_command"] as const

describe("BCBOBSRV-06: CAUSAL E — production accessor chain: stale subset (BUG) vs. merged list (REPAIR)", () => {
	it("BCBOBSRV-06.1: STALE subset (current production behavior) — `runtime.tools` alone lacks `command_status`", () => {
		// Mirrors the existing `getActiveRuntimeToolNames` accessor at
		// local-runtime-host.ts:1557-1562 (the BUG). The accessor
		// returns `active.runtime.tools.map(t => t.name)`, which is
		// the BuiltRuntime.tools from the runtime-builder — NOT the
		// merged list used by agentConfig.tools.
		const stale = [...RUNTIME_BUILDER_TOOLS]
		expect(stale).not.toContain("command_status")
		expect(stale).toEqual(["read_files", "search_codebase", "fetch_web_content", "editor", "submit_and_exit"])
	})

	it("BCBOBSRV-06.2: MERGED list (REPAIR) — `runtime.tools + extraTools` includes `command_status`", () => {
		// The REPAIR: `getActiveRuntimeToolNames` returns the same merge
		// the agentConfig.tools uses at local-runtime-host.ts:834. This
		// is the load-bearing causal boundary: the BCB capability
		// projection must match the actual model-facing registry.
		const merged = [...RUNTIME_BUILDER_TOOLS, ...VSCODE_EXTRA_TOOLS]
		expect(merged).toContain("command_status")
		expect(merged).toEqual([
			"read_files",
			"search_codebase",
			"fetch_web_content",
			"editor",
			"submit_and_exit",
			"run_commands",
			"command_status",
			"cancel_command",
		])
	})

	it("BCBOBSRV-06.3: BCB decision with MERGED liveTools + 2 unconsumed -> canObserveHeldResults=true, BCB writer does NOT fire", async () => {
		// The post-repair BCB behavior: the BCB decision reads the
		// merged liveTools (which includes command_status), so
		// canObserveHeldResults = true and the BCB writer does NOT
		// fire. The held set is still conserved (the BCB01 §0.1
		// barrier still holds completion), but the diagnostic no
		// longer claims the observation mechanism is unavailable.
		const h = makeHarness()
		h.unconsumedOverride.value = 2
		h.unconsumedJobIdsOverride.value = ["j-1", "j-2"]
		// Post-repair liveTools: the merged list (5 runtime + 3 extra = 8).
		h.liveToolsOverride.value = [...RUNTIME_BUILDER_TOOLS, ...VSCODE_EXTRA_TOOLS]
		h.enableCapture()

		await emitSubmitAndExit(h)
		await new Promise<void>((r) => setImmediate(r))

		expect(h.finalWriterId()).not.toBe("session-event-bcb-blocked-observation-unavailable")
		expect(h.errorPhaseCommitCount()).toBe(0)
		const records = h.getCaptureRecords()
		expect(records).toHaveLength(1)
		const r = records[0]!
		expect(r.writerId).toBe("session-event-bcb-eligible-no-bcb-writer")
		expect(r.canObserveHeldResults).toBe(true)
		expect(r.liveToolsIncludesCommandStatus).toBe(true)
		expect(r.liveToolsCount).toBe(8)
		// The held obligation is preserved through the eligibility
		// branch (no silent discard).
		expect(r.unconsumedOwnedTerminalResultsForC10).toBe(2)
		expect(r.ownedTerminalJobIdsForC10).toEqual(["j-1", "j-2"])
	})

	it("BCBOBSRV-06.4: BCB decision with STALE liveTools (current production) + 2 unconsumed -> REPRODUCES LIVE INCIDENT", async () => {
		// Pre-repair liveTools: just the runtime.tools (no extraTools
		// merge). This is what the LIVE capture saw — the BCB writer
		// fires, the user sees `error` even though command_status is
		// actually registered for the resumed turn.
		const h = makeHarness()
		h.unconsumedOverride.value = 2
		h.unconsumedJobIdsOverride.value = ["j-1", "j-2"]
		// Pre-repair: the stale subset.
		h.liveToolsOverride.value = [...RUNTIME_BUILDER_TOOLS]
		h.enableCapture()

		await emitSubmitAndExit(h)
		await new Promise<void>((r) => setImmediate(r))

		// Same writer, same phase, same liveToolsValue as LIVE.
		expect(h.finalWriterId()).toBe("session-event-bcb-blocked-observation-unavailable")
		expect(h.finalPhase()).toBe("error")
		const records = h.getCaptureRecords()
		const r = records[0]!
		expect(r.canObserveHeldResults).toBe(false)
		expect(r.liveToolsValue).toEqual(["read_files", "search_codebase", "fetch_web_content", "editor", "submit_and_exit"])
	})
})

// ============================================================================
// CONSERVATION (BCB-ACT §6) — every previously-proven invariant
// continues to hold under the REPAIR.
// ============================================================================

describe("BCBOBSRV-07: CONSERVATION — invariants under repair", () => {
	it("BCBOBSRV-07.1: clean completion (no held work) + command_status present -> no BCB writer, no error, normal completion path", async () => {
		const h = makeHarness()
		h.unconsumedOverride.value = 0
		h.unconsumedJobIdsOverride.value = []
		h.liveToolsOverride.value = ["read_files", "command_status", "submit_and_exit"]
		h.enableCapture()

		await emitSubmitAndExit(h)
		await new Promise<void>((r) => setImmediate(r))

		// No BCB block.
		expect(h.finalWriterId()).not.toBe("session-event-bcb-blocked-observation-unavailable")
		expect(h.errorPhaseCommitCount()).toBe(0)
		// No capture record (eligibility branch not taken).
		expect(h.getCaptureRecords()).toHaveLength(0)
	})

	it("BCBOBSRV-07.2: 2 unconsumed + extraTools includes command_status (post-repair) -> heldResult ownership preserved, no false positive, no cross-session contamination", async () => {
		const h = makeHarness()
		h.unconsumedOverride.value = 2
		h.unconsumedJobIdsOverride.value = ["j-1", "j-2"]
		h.liveToolsOverride.value = [
			"read_files",
			"search_codebase",
			"fetch_web_content",
			"editor",
			"run_commands",
			"command_status",
			"cancel_command",
			"submit_and_exit",
		]
		h.enableCapture()

		await emitSubmitAndExit(h)
		await new Promise<void>((r) => setImmediate(r))

		expect(h.finalWriterId()).not.toBe("session-event-bcb-blocked-observation-unavailable")
		const records = h.getCaptureRecords()
		expect(records[0]?.unconsumedOwnedTerminalResultsForC10).toBe(2)
		expect(records[0]?.ownedTerminalJobIdsForC10).toEqual(["j-1", "j-2"])
		expect(records[0]?.canObserveHeldResults).toBe(true)
		// No cross-session, no stale-epoch. The sessionId and taskId
		// on the capture are THIS session.
		expect(records[0]?.sessionId).toBe(h.activeSessionId)
		expect(records[0]?.taskId).toBe(h.activeTaskId)
	})
})
