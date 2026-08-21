// ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01
//
// RED at the REAL `SdkCompactionCoordinator` seam for the LIVE
// contradiction captured by `ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-
// COHERENCE01-LIVE-CAPTURE01-RESULT01`.
//
// =============================================================================
// LIVE STATE_MISMATCH = PROVEN (this ACT proves the cause)
// =============================================================================
//
// At `stateVersion = _ptadPushId = 3208`, `taskId = 1787332060504_vgxt4`,
// `epoch = 9`, on the SAME webview generation the LIVE capture shows:
//
//   legacyPhase               = "streaming"   <-- stale authority
//   legacySeq                 = 2985
//   taskHeaderPresentation.phase = "idle"      <-- canonical shadow agrees
//   thinkingPresentation.modelStreaming = false
//   runtimeStatus             = "idle"
//   shadowStatus              = "idle"
//   foregroundCommandRunning  = false
//   backgroundCommandRunning  = false
//   composerEnabled           = true
//   ActionButtons.secondary   = Cancel        <-- reads legacy phase
//
// TaskHeader consumes the canonical shadow -> "Idle".
// ActionButtons consumes the legacy `turnState.phase` -> Cancel.
//
// The capture proves the LIVE contradiction lives INSIDE the state
// payload. It does NOT prove causality. This ACT proves causality.
//
// =============================================================================
// FIRST BROKEN BOUNDARY: restorePhase() in sdk-compaction-coordinator.ts
// =============================================================================
//
// The `SdkCompactionCoordinator.runCompaction` boundary owns a
// try/finally where the entry phase + anchor are captured BEFORE
// compaction begins and RESTORED in `finally`:
//
//   sdk-compaction-coordinator.ts:271   const restorePhase = this.enterCompactingPhase()
//   sdk-compaction-coordinator.ts:283     try {
//   sdk-compaction-coordinator.ts:284       this.emitCompactionRow({status: "started", mode: "manual"}, ...)
//   sdk-compaction-coordinator.ts:285       await this.options.postStateToWebview()
//   sdk-compaction-coordinator.ts:286       try {
//   sdk-compaction-coordinator.ts:287         await this.runCompactionInPhase({...})
//   sdk-compaction-coordinator.ts:296       } catch (error) { ... throw error }
//   sdk-compaction-coordinator.ts:300     } finally {
//   sdk-compaction-coordinator.ts:301       restorePhase()
//   sdk-compaction-coordinator.ts:314       await this.options.postStateToWebview()
//   sdk-compaction-coordinator.ts:330     }
//
// where `enterCompactingPhase()` returns
// `() => setTurnPhase(entry.phase, entry.anchorTs)`.
//
// If the entry phase was `"streaming"` (the previous turn was still
// claiming the model stream -- and the canonical `AgentRuntime`
// snapshot at compaction time has already settled to `idle`), the
// restore writes `"streaming"` back into the legacy `TurnStateTracker`
// AFTER all the canonical authorities have moved on. That single write
// is the durable cause of the LIVE split.
//
// Candidate trigger: a manual `/compact` between two prompts at a moment
// when the previous turn's session-event terminal transition either
// never fired or was preempted.
//
// =============================================================================
// BOUNDED REPAIR (this ACT)
// =============================================================================
//
// At `restorePhase()` time, IF the entry phase was a NON-TERMINAL
// owner (`"streaming"` or `"awaiting_approval"`) AND the canonical
// runtime activity signal reports `idle`, restore to the canonical
// user-owned terminal phase `"awaiting_followup"` (the same phase the
// session-event coordinator would have written had the turn
// completed normally).
//
// The runtime activity signal is read through a NEW optional
// `getRuntimeActivityState?: () => "idle" | "active"` callback on
// `SdkCompactionCoordinatorOptions`. If the callback is absent, the
// coordinator's behavior is byte-equivalent to the previous
// implementation (preserving backward compatibility for tests of
// unrelated behavior and for CLI hosts that do not yet wire the
// signal). This is the smallest possible repair that closes the
// captured LIVE contradiction without touching TaskHeader, the
// canonical shadow mapper, ActionButtons, the composer, the
// turn-state selectors, or any other consumer.
//
// =============================================================================
// STOP RULE
// =============================================================================
//
// Stop at the first causal boundary -- the canonical coordinator seam.
// Do NOT chase downstream consumer fixes. The capture already proves
// the consumers faithfully render their conflicting inputs.

import { createContextCompactionPrepareTurn } from "@cline/core"
import type { ClineMessage, TurnPhase, TurnState } from "@shared/ExtensionMessage"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import { MessageIdMinter } from "../message-id-minter"
import { SdkCompactionCoordinator, type SdkCompactionCoordinatorOptions } from "../sdk-compaction-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

vi.mock("@cline/core", () => ({
	createContextCompactionPrepareTurn: vi.fn(),
	createSessionCompactionState: vi.fn((input: { compactedMessages: unknown[] }) => ({
		version: 1,
		messages: input.compactedMessages,
	})),
}))

const mockCreateContextCompactionPrepareTurn = createContextCompactionPrepareTurn as unknown as ReturnType<typeof vi.fn>

vi.mock("@/shared/services/Logger", () => ({
	Logger: { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() },
}))

interface CapturedSnapshot {
	turnState: TurnState
}

interface HarnessInput {
	entryPhase: TurnPhase
	entryAnchorTs?: number
	/** Runtime activity signal -- `idle` if absent, mirrors the LIVE
	 *  capture chronology where the canonical AgentRuntime snapshot is
	 *  settled by the time the user clicks Compact. */
	runtimeActivity?: "idle" | "active"
}

function makeSessionHost() {
	return {
		start: vi.fn().mockResolvedValue({ sessionId: "old-session" }),
		readMessages: vi.fn().mockResolvedValue([{ role: "user", content: "1" }]),
		updateSessionCompactionState: vi.fn().mockResolvedValue({ updated: true }),
		send: vi.fn(),
		abort: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn().mockResolvedValue(undefined),
	}
}

function makeHarness(input: HarnessInput) {
	const tracker = new TurnStateTracker(new MessageIdMinter())
	tracker.set(input.entryPhase, input.entryAnchorTs)

	const sessionHost = makeSessionHost()
	const activeSession = {
		sessionId: "old-session",
		sdkHost: sessionHost,
		unsubscribe: vi.fn(),
		startResult: { sessionId: "old-session" },
		isRunning: false,
	}

	const captured: CapturedSnapshot[] = []
	const postCalls: number[] = []

	const options = {
		stateManager: { getGlobalSettingsKey: vi.fn(() => "act") } as unknown as StateManager,
		sessions: {
			getActiveSession: vi.fn(() => activeSession),
			startNewSession: vi.fn(),
			setRunning: vi.fn(),
			endActiveSession: vi.fn().mockResolvedValue(undefined),
			waitForPendingStop: vi.fn().mockResolvedValue(undefined),
		},
		rebuilds: { runExclusive: vi.fn(async (operation: () => Promise<unknown>) => operation()) },
		messages: { appendAndEmit: vi.fn() },
		taskHistory: {
			findHistoryItem: vi.fn().mockResolvedValue(undefined),
			isLegacyTask: vi.fn().mockResolvedValue(false),
			getLegacyResumeInitialMessages: vi.fn(async (_taskId: string, fallback?: unknown[]) => fallback),
		},
		sessionConfigBuilder: {
			build: vi.fn().mockResolvedValue({
				providerConfig: { providerId: "anthropic", modelId: "claude" },
				providerId: "anthropic",
				modelId: "claude",
				knownModels: undefined,
				compaction: undefined,
				logger: undefined,
				telemetry: undefined,
			}),
		},
		getDisplayedTaskId: vi.fn(() => "old-session"),
		createTempSessionHost: vi.fn().mockResolvedValue(sessionHost),
		loadInitialMessages: vi.fn().mockResolvedValue([{ role: "user", content: "1" }]),
		getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
		postStateToWebview: vi.fn().mockImplementation(async () => {
			const ordinal = postCalls.length + 1
			postCalls.push(ordinal)
			captured.push({ turnState: tracker.get() })
		}),
		getTurnState: () => tracker.get(),
		setTurnPhase: (phase: TurnPhase, anchorTs?: number) => tracker.set(phase, anchorTs),
		// The bounded repair's only NEW optional signal. Production wires
		// this from the canonical AgentRuntime snapshot's activity state;
		// the harness defaults to "idle" so RED chronology matches the
		// LIVE capture.
		getRuntimeActivityState: () => input.runtimeActivity ?? "idle",
	} as unknown as SdkCompactionCoordinatorOptions & {
		messages: { appendAndEmit: ReturnType<typeof vi.fn> }
	}

	return {
		coordinator: new SdkCompactionCoordinator(options),
		options,
		tracker,
		captured,
	}
}
void ({} as { _silenceBiome: ClineMessage[] })

describe("ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01 / RED: manual compact at streaming-entry + idle runtime leaves stale legacy phase", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("CLTCC01 (RED): entry phase 'streaming' + runtime idle -> LAST published snapshot carries phase === 'awaiting_followup', NOT 'streaming'", async () => {
		// Mirrors the LIVE capture chronology at stateVersion=3208:
		//   - legacy turnState.phase was 'streaming' (a non-terminal owner)
		//   - canonical AgentRuntime snapshot is idle (model finished)
		//   - the user clicks Compact between prompts
		// The bounded repair restores the canonical user-owned terminal
		// phase 'awaiting_followup' instead of the stale 'streaming'.
		const entryAnchorTs = 2985
		const { coordinator, captured, tracker } = makeHarness({
			entryPhase: "streaming",
			entryAnchorTs,
			runtimeActivity: "idle",
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		const last = captured[captured.length - 1]
		expect(last).toBeDefined()
		// RED: without the bounded repair, the LAST snapshot still
		// carries phase === 'streaming', which is exactly the
		// LIVE-stale split.
		expect(last!.turnState.phase).toBe("awaiting_followup")
		expect(last!.turnState.phase).not.toBe("streaming")
		// The tracker's live state agrees with the LAST published
		// snapshot -- both reflect the bounded restore to
		// 'awaiting_followup'.
		expect(tracker.currentPhase).toBe("awaiting_followup")
		// Anchor is preserved through the restore (the user's
		// follow-up surface still points at the right message).
		expect(last!.turnState.anchorTs).toBe(entryAnchorTs)
	})

	it("CLTCC02 (RED): entry phase 'awaiting_approval' + runtime idle -> LAST published snapshot carries phase === 'awaiting_followup', NOT 'awaiting_approval'", async () => {
		// The second non-terminal owner phase. Same bounded repair
		// applies: a stale `awaiting_approval` (e.g. from a
		// permission-request that the runtime resolved behind the
		// user's back) would otherwise produce Approve/Reject buttons
		// after the underlying decision is gone.
		const { coordinator, captured } = makeHarness({
			entryPhase: "awaiting_approval",
			entryAnchorTs: 4242,
			runtimeActivity: "idle",
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		const last = captured[captured.length - 1]!
		expect(last.turnState.phase).toBe("awaiting_followup")
		expect(last.turnState.phase).not.toBe("awaiting_approval")
	})

	it("CLTCC03 (GREEN control): entry phase 'streaming' + runtime ACTIVE -> LAST published snapshot preserves phase === 'streaming' (no override)", async () => {
		// The repair must NOT override the entry phase when the
		// runtime is still doing model/tool/approval work. A live
		// `streaming` must remain `streaming` so the Cancel button
		// stays visible.
		const { coordinator, captured } = makeHarness({
			entryPhase: "streaming",
			entryAnchorTs: 100,
			runtimeActivity: "active",
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		const last = captured[captured.length - 1]!
		expect(last.turnState.phase).toBe("streaming")
	})

	it("CLTCC04 (GREEN control): entry phase 'awaiting_followup' (terminal owner) + runtime idle -> preserves phase === 'awaiting_followup'", async () => {
		// Conservation: the canonical 'awaiting_followup' ->
		// 'awaiting_followup' round-trip already pinned by
		// ACT-CLINEMM-COMPACTION-STATE-RESTORE-REGRESSION01 (CSR02)
		// must remain intact. The entry phase is already a terminal
		// owner so the repair's non-terminal-owner branch never fires.
		const { coordinator, captured } = makeHarness({
			entryPhase: "awaiting_followup",
			entryAnchorTs: 7777,
			runtimeActivity: "idle",
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		const last = captured[captured.length - 1]!
		expect(last.turnState.phase).toBe("awaiting_followup")
		expect(last.turnState.anchorTs).toBe(7777)
	})

	it("CLTCC05 (GREEN control): entry phase 'completed' (terminal owner) + runtime idle -> preserves phase === 'completed'", async () => {
		// Another terminal owner; the repair must not disturb it.
		const { coordinator, captured } = makeHarness({
			entryPhase: "completed",
			entryAnchorTs: 9000,
			runtimeActivity: "idle",
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		const last = captured[captured.length - 1]!
		expect(last.turnState.phase).toBe("completed")
		expect(last.turnState.anchorTs).toBe(9000)
	})

	it("CLTCC06 (GREEN control): absent getRuntimeActivityState + entry 'streaming' -> preserves phase === 'streaming' (backward compatibility)", async () => {
		// A caller that has not yet wired the new optional signal
		// (CLI hosts, tests of unrelated behavior, the bundled
		// standalone) must see byte-equivalent behavior to the
		// previous implementation. This is the principle of least
		// surprise -- the bounded repair is opt-in.
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.set("streaming", 5)
		const sessionHost = makeSessionHost()
		const activeSession = {
			sessionId: "old-session",
			sdkHost: sessionHost,
			unsubscribe: vi.fn(),
			startResult: { sessionId: "old-session" },
			isRunning: false,
		}
		const captured: CapturedSnapshot[] = []
		const options = {
			stateManager: { getGlobalSettingsKey: vi.fn(() => "act") } as unknown as StateManager,
			sessions: {
				getActiveSession: vi.fn(() => activeSession),
				startNewSession: vi.fn(),
				setRunning: vi.fn(),
				endActiveSession: vi.fn().mockResolvedValue(undefined),
				waitForPendingStop: vi.fn().mockResolvedValue(undefined),
			},
			rebuilds: { runExclusive: vi.fn(async (op: () => Promise<unknown>) => op()) },
			messages: { appendAndEmit: vi.fn() },
			taskHistory: {
				findHistoryItem: vi.fn().mockResolvedValue(undefined),
				isLegacyTask: vi.fn().mockResolvedValue(false),
				getLegacyResumeInitialMessages: vi.fn(async (_t: string, fallback?: unknown[]) => fallback),
			},
			sessionConfigBuilder: {
				build: vi.fn().mockResolvedValue({
					providerConfig: { providerId: "anthropic", modelId: "claude" },
					providerId: "anthropic",
					modelId: "claude",
					knownModels: undefined,
					compaction: undefined,
					logger: undefined,
					telemetry: undefined,
				}),
			},
			getDisplayedTaskId: vi.fn(() => "old-session"),
			createTempSessionHost: vi.fn().mockResolvedValue(sessionHost),
			loadInitialMessages: vi.fn().mockResolvedValue([{ role: "user", content: "1" }]),
			getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
			postStateToWebview: vi.fn().mockImplementation(async () => {
				captured.push({ turnState: tracker.get() })
			}),
			getTurnState: () => tracker.get(),
			setTurnPhase: (phase: TurnPhase, anchorTs?: number) => tracker.set(phase, anchorTs),
			// Note: getRuntimeActivityState intentionally absent.
		} as unknown as SdkCompactionCoordinatorOptions & {
			messages: { appendAndEmit: ReturnType<typeof vi.fn> }
		}
		const coordinator = new SdkCompactionCoordinator(options)
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		const last = captured[captured.length - 1]!
		expect(last.turnState.phase).toBe("streaming")
		expect(last.turnState.anchorTs).toBe(5)
	})

	it("CLTCC07 (GREEN conservation): a successful compaction still publishes the post-restore snapshot (no regression of CSR01)", async () => {
		// ACT-CLINEMM-COMPACTION-STATE-RESTORE-REGRESSION01 / CSR01
		// pinned that the LAST published snapshot's phase is NOT
		// 'compacting'. The bounded repair must preserve that property
		// -- it changes WHICH non-compacting phase the snapshot carries,
		// not whether one is published.
		const { coordinator, captured } = makeHarness({
			entryPhase: "awaiting_followup",
			entryAnchorTs: 4242,
			runtimeActivity: "idle",
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		const phases = captured.map((s) => s.turnState.phase)
		expect(phases).toContain("compacting")
		expect(phases[phases.length - 1]).not.toBe("compacting")
	})

	it("CLTCC08 (GREEN conservation): a failed compaction also publishes a post-restore snapshot with the bounded-restored phase", async () => {
		// The failure path also exercises `restorePhase()`. If the
		// entry phase was a non-terminal owner and the runtime has
		// settled by the time the failure is reported, the post-restore
		// snapshot still carries the bounded-restored phase so the
		// webview's last received snapshot is never stale.
		const { coordinator, captured } = makeHarness({
			entryPhase: "streaming",
			entryAnchorTs: 4242,
			runtimeActivity: "idle",
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(vi.fn().mockRejectedValue(new Error("boom")))

		await coordinator.compactTask().catch(() => {
			/* expected -- failed-path terminal row */
		})

		const last = captured[captured.length - 1]!
		expect(last.turnState.phase).toBe("awaiting_followup")
		expect(last.turnState.anchorTs).toBe(4242)
	})
})

// Reference contract -- the synthetic non-terminal owner / runtime
// activity matrix. Tests above exercise the production-relevant rows.
// The full matrix is:
//
//   entry.phase \ activity | idle            | active          | absent
//   ----------------------|-----------------|-----------------|----------------
//   idle (terminal)        | preserve idle   | preserve idle   | preserve idle
//   completed (terminal)   | preserve comp.  | preserve comp.  | preserve comp.
//   awaiting_followup (T)  | preserve afu    | preserve afu    | preserve afu
//   resumable (terminal)   | preserve res.   | preserve res.   | preserve res.
//   error (terminal)       | preserve error  | preserve error  | preserve error
//   compacting (system)    | restorePhase is never invoked with compacting
//   streaming (non-T)      | restore to afu  | preserve stream | preserve stream
//   awaiting_approval (NT) | restore to afu  | preserve awaitA | preserve awaitA
//
// The bounded repair fires ONLY in the cells where the entry phase is
// a non-terminal owner AND the runtime activity is "idle". Every other
// cell preserves byte-equivalent behavior.
