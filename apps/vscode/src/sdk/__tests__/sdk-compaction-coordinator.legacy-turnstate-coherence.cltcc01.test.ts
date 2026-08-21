// ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION01
//
// RED at the REAL `SdkCompactionCoordinator` seam for the LIVE
// contradiction captured by `ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-
// COHERENCE01-LIVE-CAPTURE01-RESULT01`. Replaces the prior
// CLTCC01 test file with the canonical-projection contract the
// Factory reviewer demanded in CORRECTION01.
//
// =============================================================================
// LIVE STATE_MISMATCH = PROVEN (this ACT proves the cause + correct value)
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
// =============================================================================
// FIRST BROKEN BOUNDARY: restorePhase() in sdk-compaction-coordinator.ts
// =============================================================================
//
// `SdkCompactionCoordinator.runCompaction`'s `enterCompactingPhase()`
// returns a closure that calls `setTurnPhase(entry.phase, entry.anchorTs)`.
// When the entry phase was `"streaming"` and the canonical authority has
// already settled, the restore writes `"streaming"` back into the legacy
// `TurnStateTracker` AFTER all canonical authorities have moved on.
//
// =============================================================================
// CORRECTION01 — what the Factory P0 / P1 demanded
// =============================================================================
//
// P0 (Factory): the previous repair
// `getRuntimeActivityState: () => "idle" | "active"` compressed an 8-state
// domain to one bit and tried to reconstruct the specific phase
// `"awaiting_followup"` from activity alone. `awaiting_followup` requires
// the host-interaction dimension (`TaskState.projectHostTurnState(model,
// hostInteraction.awaitingFollowup)`) and is NOT derivable from a binary
// activity bit. Idle runtime does not imply awaiting_followup.
//
// P1 (Factory): collapsing "runtime snapshot absent" to "idle" is unsafe.
// `unavailable != idle`. The repair must NOT fire when no canonical
// observation is available.
//
// CORRECTION01 SHAPE:
//
//   * Replace `getRuntimeActivityState` with the semantically sufficient
//     `getCanonicalRestorePhase?: () => TurnPhase | undefined`. The
//     coordinator asks the canonical authority for the resolved phase
//     rather than inferring one.
//   * When the canonical projection is available AND the entry phase was
//     a non-terminal owner (`streaming` / `awaiting_approval`), restore
//     to the canonical projection.
//   * When the canonical projection is absent (`undefined`), preserve the
//     entry phase (do NOT synthesize). This is the existing compatibility
//     behavior preserved byte-equivalent for CLI hosts and tests.
//   * When the entry phase is already terminal (idle / awaiting_followup /
//     completed / resumable / error), preserve it. The bounded repair is
//     aimed EXCLUSIVELY at the stale-nonterminal-owner / canonical-settled
//     split.
//
// Wiring: `SdkController.getCanonicalRestorePhase()` reads the EXISTING
// canonical `taskStateShadowWiring?.getLastObservedShadowPhase()` projection
// (already used by `getLocalShadowPhase()`), which returns the LAST
// `TaskState.projectTurnState(model)` projection mapped to legacy
// `TurnPhase` via `toLegacyPhase`, or `undefined` when no observation has
// been recorded yet. Hub/Remote hosts without a shadow wiring naturally
// collapse to `undefined` and see byte-equivalent prior behavior.
//
// =============================================================================
// STOP RULE
// =============================================================================
//
// Stop at the first causal boundary -- the canonical coordinator seam.
// Do NOT chase downstream consumer fixes. The capture already proves
// the consumers faithfully render their conflicting inputs.
//
// =============================================================================
// CROSS-CONSUMER COHERENCE
// =============================================================================
//
// For the stale-nonterminal / canonical-settled case, the cross-consumer
// invariant holds:
//
//   legacy turnState.phase === canonical host-aware projected phase
//
// so TaskHeader (canonical shadow) and ActionButtons (legacy phase)
// no longer disagree semantically. CLTCC09 pins this directly at the
// REAL coordinator seam by capturing both `turnState.phase` and the
// canonical projection value during the same `postStateToWebview()` call.

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
	/** The canonical projection value the bounded restore policy would
	 *  write, captured at the same `postStateToWebview()` call so
	 *  CLTCC09 can assert cross-consumer coherence. */
	canonicalProjection: TurnPhase | undefined
}

interface HarnessInput {
	entryPhase: TurnPhase
	entryAnchorTs?: number
	/** The canonical projection the bounded restore policy reads. Mirrors
	 *  the production wiring:
	 *  `taskStateShadowWiring?.getLastObservedShadowPhase()`. */
	canonicalProjection: TurnPhase | undefined
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
			captured.push({
				turnState: tracker.get(),
				canonicalProjection: input.canonicalProjection,
			})
		}),
		getTurnState: () => tracker.get(),
		setTurnPhase: (phase: TurnPhase, anchorTs?: number) => tracker.set(phase, anchorTs),
		// CORRECTION01: the bounded repair asks the canonical authority
		// for the resolved phase, NOT a binary activity bit.
		getCanonicalRestorePhase: () => input.canonicalProjection,
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

describe("ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION01 / canonical-projection restore", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("CLTCC01 (CORRECTED): stale legacy 'streaming' + canonical 'idle' -> restore to canonical 'idle' (NOT 'awaiting_followup')", async () => {
		// CORRECTION01: the canonical projection owns the awaiting_followup
		// vs idle distinction. When the canonical projection says idle,
		// the restore writes idle -- not awaiting_followup. The previous
		// incarnation of this ACT hardcoded awaiting_followup, which
		// conflated the canonical host-interaction dimension with the
		// runtime activity dimension.
		const entryAnchorTs = 2985
		const { coordinator, captured, tracker } = makeHarness({
			entryPhase: "streaming",
			entryAnchorTs,
			canonicalProjection: "idle",
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
		expect(last!.turnState.phase).toBe("idle")
		expect(last!.turnState.phase).not.toBe("streaming")
		expect(last!.turnState.phase).not.toBe("awaiting_followup")
		expect(tracker.currentPhase).toBe("idle")
		expect(last!.turnState.anchorTs).toBe(entryAnchorTs)
	})

	it("CLTCC02 (CORRECTED): stale legacy 'streaming' + canonical 'awaiting_followup' -> restore to canonical 'awaiting_followup'", async () => {
		// The canonical projection carries the host-interaction dimension
		// (awaitingFollowup) that distinguishes awaiting_followup from
		// idle. When the canonical projection reports awaiting_followup,
		// the restore writes awaiting_followup. This is the second
		// canonical destination the bounded repair must support.
		const entryAnchorTs = 2985
		const { coordinator, captured } = makeHarness({
			entryPhase: "streaming",
			entryAnchorTs,
			canonicalProjection: "awaiting_followup",
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		const last = captured[captured.length - 1]!
		expect(last.turnState.phase).toBe("awaiting_followup")
		expect(last.turnState.phase).not.toBe("streaming")
	})

	it("CLTCC03 (CORRECTED): stale legacy 'streaming' + canonical 'completed' -> restore to canonical 'completed'", async () => {
		// When the canonical lifecycle is completed, the restore writes
		// completed. The bounded repair is not constrained to the
		// awaiting_followup destination; it routes whatever the
		// canonical projection reports.
		const { coordinator, captured } = makeHarness({
			entryPhase: "streaming",
			entryAnchorTs: 4242,
			canonicalProjection: "completed",
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		const last = captured[captured.length - 1]!
		expect(last.turnState.phase).toBe("completed")
	})

	it("CLTCC04 (CORRECTED): stale legacy 'streaming' + canonical 'resumable' -> restore to canonical 'resumable'", async () => {
		// Cancelled turns project to 'resumable' through the canonical
		// mapper. When the canonical projection says resumable, the
		// restore writes resumable -- Resume remains the next action.
		const { coordinator, captured } = makeHarness({
			entryPhase: "streaming",
			entryAnchorTs: 4242,
			canonicalProjection: "resumable",
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		const last = captured[captured.length - 1]!
		expect(last.turnState.phase).toBe("resumable")
	})

	it("CLTCC05 (P1 -- unknown must stay unknown): stale legacy 'streaming' + canonical projection 'undefined' -> preserve entry 'streaming'", async () => {
		// Factory P1: `unavailable != idle`. When the canonical
		// projection is unavailable, the bounded repair must NOT fire
		// -- the restore preserves the entry phase (the prior
		// compatibility behavior). CLI hosts, Hub/Remote hosts without
		// a shadow wiring, and fresh installs before the first runtime
		// event all collapse to this branch.
		const { coordinator, captured } = makeHarness({
			entryPhase: "streaming",
			entryAnchorTs: 4242,
			canonicalProjection: undefined,
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		const last = captured[captured.length - 1]!
		expect(last.turnState.phase).toBe("streaming")
		expect(last.turnState.phase).not.toBe("idle")
		expect(last.turnState.phase).not.toBe("awaiting_followup")
	})

	it("CLTCC06 (GREEN conservation): entry phase already 'awaiting_followup' (terminal owner) -> preserves phase === 'awaiting_followup'", async () => {
		// Conservation: the canonical 'awaiting_followup' ->
		// 'awaiting_followup' round-trip already pinned by
		// ACT-CLINEMM-COMPACTION-STATE-RESTORE-REGRESSION01 (CSR02)
		// must remain intact. The entry phase is already a terminal
		// owner so the repair's non-terminal-owner branch never fires.
		const { coordinator, captured } = makeHarness({
			entryPhase: "awaiting_followup",
			entryAnchorTs: 7777,
			canonicalProjection: "idle",
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		const last = captured[captured.length - 1]!
		expect(last.turnState.phase).toBe("awaiting_followup")
		expect(last.turnState.anchorTs).toBe(7777)
	})

	it("CLTCC07 (GREEN conservation): entry phase 'completed' (terminal owner) -> preserves phase === 'completed'", async () => {
		// Another terminal owner; the repair must not disturb it even
		// when the canonical projection disagrees.
		const { coordinator, captured } = makeHarness({
			entryPhase: "completed",
			entryAnchorTs: 9000,
			canonicalProjection: "idle",
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		const last = captured[captured.length - 1]!
		expect(last.turnState.phase).toBe("completed")
		expect(last.turnState.anchorTs).toBe(9000)
	})

	it("CLTCC08 (GREEN conservation): stale legacy 'awaiting_approval' + canonical 'idle' -> restore to canonical 'idle'", async () => {
		// The second non-terminal owner phase. The bounded repair applies
		// symmetrically: a stale 'awaiting_approval' (e.g. from a
		// permission request that the runtime resolved behind the user's
		// back) is re-routed to whatever the canonical projection
		// reports.
		const { coordinator, captured } = makeHarness({
			entryPhase: "awaiting_approval",
			entryAnchorTs: 4242,
			canonicalProjection: "idle",
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		const last = captured[captured.length - 1]!
		expect(last.turnState.phase).toBe("idle")
	})

	it("CLTCC09 (CROSS-CONSUMER COHERENCE): stale legacy + canonical settle -> legacy phase === canonical projection at the post-restore snapshot", async () => {
		// The cross-consumer invariant the Factory demanded: for the
		// stale-nonterminal / canonical-settled case, the legacy
		// turnState.phase must equal the canonical host-aware
		// projected phase. This is stronger than "phase != streaming":
		// it asserts the legacy phase is COHERENT with the canonical
		// authority, not merely absent-of-streaming.
		const canonicalProjection: TurnPhase = "idle"
		const { coordinator, captured } = makeHarness({
			entryPhase: "streaming",
			entryAnchorTs: 2985,
			canonicalProjection,
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		const last = captured[captured.length - 1]!
		expect(last).toBeDefined()
		// The post-restore snapshot's legacy phase matches the canonical
		// projection -- TaskHeader (canonical shadow) and ActionButtons
		// (legacy phase) no longer disagree semantically.
		expect(last!.turnState.phase).toBe(last!.canonicalProjection)
		// And specifically: the canonical projection in this case is
		// 'idle', confirming the legacy phase is also 'idle'.
		expect(last!.canonicalProjection).toBe(canonicalProjection)
		expect(last!.turnState.phase).toBe("idle")
	})

	it("CLTCC10 (GREEN conservation): a successful compaction still publishes the post-restore snapshot (no regression of CSR01)", async () => {
		// ACT-CLINEMM-COMPACTION-STATE-RESTORE-REGRESSION01 / CSR01
		// pinned that the LAST published snapshot's phase is NOT
		// 'compacting'. The bounded repair must preserve that property
		// -- it changes WHICH non-compacting phase the snapshot carries,
		// not whether one is published.
		const { coordinator, captured } = makeHarness({
			entryPhase: "awaiting_followup",
			entryAnchorTs: 4242,
			canonicalProjection: "idle",
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		const phases = captured.map((s) => s.turnState.phase)
		expect(phases).toContain("compacting")
		expect(phases[phases.length - 1]).not.toBe("compacting")
	})

	it("CLTCC11 (GREEN conservation): a failed compaction also publishes a post-restore snapshot with the bounded-restored phase", async () => {
		// The failure path also exercises `restorePhase()`. If the
		// entry phase was a non-terminal owner and the canonical
		// projection reports a settled phase by the time the failure
		// is reported, the post-restore snapshot still carries the
		// canonical-restored phase so the webview's last received
		// snapshot is never stale.
		const { coordinator, captured } = makeHarness({
			entryPhase: "streaming",
			entryAnchorTs: 4242,
			canonicalProjection: "idle",
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(vi.fn().mockRejectedValue(new Error("boom")))

		await coordinator.compactTask().catch(() => {
			/* expected -- failed-path terminal row */
		})

		const last = captured[captured.length - 1]!
		expect(last.turnState.phase).toBe("idle")
		expect(last.turnState.anchorTs).toBe(4242)
	})

	it("CLTCC12 (GREEN conservation): absent getCanonicalRestorePhase + entry 'streaming' -> preserves phase === 'streaming' (backward compatibility)", async () => {
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
				captured.push({ turnState: tracker.get(), canonicalProjection: undefined })
			}),
			getTurnState: () => tracker.get(),
			setTurnPhase: (phase: TurnPhase, anchorTs?: number) => tracker.set(phase, anchorTs),
			// Note: getCanonicalRestorePhase intentionally absent.
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
})

// Reference contract -- the canonical-projection / entry-phase matrix.
// Tests above exercise the production-relevant rows.
//
//   entry.phase \ canonical | undefined | idle | awaiting_followup | completed | resumable | error
//   ----------------------|-----------|------|-------------------|-----------|-----------|-------
//   idle (terminal)        | preserve  | preserve | preserve    | preserve  | preserve  | preserve
//   completed (terminal)   | preserve  | preserve | preserve    | preserve  | preserve  | preserve
//   awaiting_followup (T)  | preserve  | preserve | preserve    | preserve  | preserve  | preserve
//   resumable (terminal)   | preserve  | preserve | preserve    | preserve  | preserve  | preserve
//   error (terminal)       | preserve  | preserve | preserve    | preserve  | preserve  | preserve
//   compacting (system)    | restorePhase is never invoked with compacting
//   streaming (non-T)      | preserve  | idle     | awaiting_fu | completed | resumable | error
//   awaiting_approval (NT) | preserve  | idle     | awaiting_fu | completed | resumable | error
//
// The bounded repair fires ONLY in the cells where the entry phase is
// a non-terminal owner AND the canonical projection is a defined
// TurnPhase. Every other cell preserves byte-equivalent behavior.
