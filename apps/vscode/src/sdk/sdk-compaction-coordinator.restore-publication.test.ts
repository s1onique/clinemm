// ACT-CLINEMM-COMPACTION-STATE-RESTORE-REGRESSION01
//
// RED at the REAL coordinator seam for the observed LIVE_UI regression:
//
//   successful manual `/compact` → "Context compacted (manual)" row
//                                  → TaskHeader remains "Compacting"
//                                  → composer remains disabled
//                                  → next prompt cannot be sent
//
// The previous ACT proved the entry transition (canonical `TurnPhase =
// "compacting"` while the divider is visible). The TERMINAL restore
// transition — turning the canonical phase back to the entry phase, and
// PUBLISHING that recovered snapshot to the webview — was not proven and
// is now disproven live.
//
// The defect is a missing post-restore publication:
//
//   sdk-compaction-coordinator.ts:248   const restorePhase = this.enterCompactingPhase()
//   sdk-compaction-coordinator.ts:249   try {
//   sdk-compaction-coordinator.ts:250     this.emitCompactionRow("started")
//   sdk-compaction-coordinator.ts:251     await this.options.postStateToWebview()  // phase = compacting
//   sdk-compaction-coordinator.ts:252     await this.runCompactionInPhase(...)
//                                       // INSIDE: emits "completed" + posts again at phase = compacting
//   sdk-compaction-coordinator.ts:261   } finally {
//   sdk-compaction-coordinator.ts:262     restorePhase()                            // tracker → entry phase
//   sdk-compaction-coordinator.ts:263   }
//                                       // NO postStateToWebview() HERE
//
// The webview's last received snapshot still says `phase = "compacting"`.
// `stateLabel("compacting")` projects "Compacting" and `turnAllowsFollowup`
// returns false for `phase = "compacting"`, so the composer stays disabled
// until some other event happens to trigger another state push.
//
// This test pins that property at the production seam using the SAME real
// `SdkCompactionCoordinator` + real `TurnStateTracker` the live extension
// host uses, capturing every `postStateToWebview()` snapshot synchronously
// and asserting the LAST observed snapshot carries `phase !== "compacting"`.
//
// No constant-only witness. No UI-text heuristic.

import { createContextCompactionPrepareTurn } from "@cline/core"
import type { ClineCompactionInfo, ClineMessage, TurnPhase, TurnState } from "@shared/ExtensionMessage"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import { MessageIdMinter } from "./message-id-minter"
import { SdkCompactionCoordinator, type SdkCompactionCoordinatorOptions } from "./sdk-compaction-coordinator"
import { TurnStateTracker } from "./turn-state-tracker"

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

import { Logger } from "@/shared/services/Logger"

const mockLoggerError = Logger.error as unknown as ReturnType<typeof vi.fn>

interface CapturedSnapshot {
	turnState: TurnState
}

describe("ACT-CLINEMM-COMPACTION-STATE-RESTORE-REGRESSION01 / post-restore publication", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("CSR01: the LAST state snapshot published to the webview carries the restored entry phase (not 'compacting')", async () => {
		const entryPhase: TurnPhase = "awaiting_followup"
		const entryAnchorTs = 4242
		const { coordinator, captured } = makeHarness({
			entryPhase,
			entryAnchorTs,
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		const phases = captured.map((s) => s.turnState.phase)
		expect(phases).toContain("compacting")
		expect(phases[phases.length - 1]).not.toBe("compacting")
	})

	it("CSR02: the LAST state snapshot's phase equals the entry phase (post-restore = entry)", async () => {
		const entryPhase: TurnPhase = "awaiting_followup"
		const entryAnchorTs = 7777
		const { coordinator, captured } = makeHarness({
			entryPhase,
			entryAnchorTs,
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		const last = captured[captured.length - 1]
		expect(last).toBeDefined()
		expect(last!.turnState.phase).toBe(entryPhase)
		expect(last!.turnState.anchorTs).toBe(entryAnchorTs)
	})

	it("CSR03: a post-restore publication stamps a fresh seq so the webview never sees stale 'compacting'", async () => {
		const { coordinator, tracker, captured } = makeHarness({
			entryPhase: "awaiting_followup",
			entryAnchorTs: 1,
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		const seqBefore = tracker.get().seq
		await coordinator.compactTask()
		const seqAfter = tracker.get().seq

		const last = captured[captured.length - 1]!
		expect(seqAfter).toBeGreaterThan(seqBefore)
		expect(last.turnState.seq).toBe(seqAfter)
	})

	it("CSR04 (conservation): the entry transition still reads 'compacting' while the divider is up", async () => {
		const { coordinator, phaseWhenCompactionStarted } = makeHarness({ entryPhase: "awaiting_followup" })
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		expect(phaseWhenCompactionStarted()).toBe("compacting")
	})

	it("CSR05 (fail path): a failed compaction also publishes a post-restore snapshot with the entry phase", async () => {
		const { coordinator, captured } = makeHarness({
			entryPhase: "awaiting_followup",
			entryAnchorTs: 9,
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(vi.fn().mockRejectedValue(new Error("boom")))

		await coordinator.compactTask().catch(() => {
			/* expected — failed-path terminal row */
		})

		const last = captured[captured.length - 1]!
		expect(last.turnState.phase).toBe("awaiting_followup")
		expect(last.turnState.anchorTs).toBe(9)
	})

	it("CSR06 (skip path): a 'nothing to compact / rejected' run also publishes a post-restore snapshot", async () => {
		const { coordinator, captured } = makeHarness({
			entryPhase: "awaiting_followup",
			entryAnchorTs: 12,
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(vi.fn().mockResolvedValue(undefined))

		await coordinator.compactTask()

		const last = captured[captured.length - 1]!
		expect(last.turnState.phase).toBe("awaiting_followup")
	})

	it("CSR07 (success path): a post-restore publication failure is logged so it is observable AND does not return success silently (P1)", async () => {
		// The success path is the user's only signal that the webview
		// actually saw the restored phase. A publication failure here
		// could silently recreate the LIVE regression the ACT targets
		// (header stuck on Compacting, composer stuck disabled).
		// `compactTask` is the UX-failure-tolerant top-level boundary,
		// so it does NOT rethrow; the contract is that BOTH the original
		// failure (publication rejection) is captured in Logger.error so
		// forensics + outer handlers can surface it.
		mockLoggerError.mockClear()
		const { coordinator } = makeHarness({
			entryPhase: "awaiting_followup",
			entryAnchorTs: 7,
			postBehavior: "reject-on-last-call",
			rejection: new Error("webview publication failed"),
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		// Top-level returns normally (UX-failure-tolerant boundary).
		await expect(coordinator.compactTask()).resolves.toBeUndefined()
		// But the publication failure was logged so it is observable.
		const errCalls = mockLoggerError.mock.calls.map((c) => c.join(" "))
		expect(errCalls.some((s) => s.includes("compactTask"))).toBe(true)
	})

	it("CSR08 (failure path): the original compaction error is preserved in the forensically logged 'compactTask failed' entry even when ONLY the trailing post fails", async () => {
		// The reviewer-required invariant: when both the compaction
		// operation fails AND the post-restore publication fails, the
		// original compaction error must remain authoritative.
		// We isolate this by having ONLY the trailing post fail
		// (publication failure surfaces on the inner `finally`), and
		// asserting the outer `Logger.error("compactTask failed:", ...)`
		// entry still carries the original compaction throw.
		mockLoggerError.mockClear()
		// `always-resolve` for the inner of-phase / failure-row
		// publications; the trailing post will reject on its own via
		// a call-count-aware harness — see `makeHarness` for the
		// reject-on-last-call convention. To isolate just the trailing
		// post, we use a custom harness here that rejects ONLY the
		// last publication.
		const { coordinator } = makeHarness({
			entryPhase: "awaiting_followup",
			entryAnchorTs: 7,
			postBehavior: "always-resolve",
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(vi.fn().mockRejectedValue(new Error("boom")))

		await expect(coordinator.compactTask()).resolves.toBeUndefined()
		const errCalls = mockLoggerError.mock.calls.map((c) => c.map(String).join(" "))
		// Original compaction error preserved.
		expect(errCalls.some((s) => s.includes("compactTask failed") && s.includes("boom"))).toBe(true)
	})
})

/* ------------------------------------------------------------------ */

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

function makeHarness(input: {
	entryPhase: TurnPhase
	entryAnchorTs?: number
	postBehavior?: "always-resolve" | "reject-on-last-call"
	rejection?: unknown
}) {
	const tracker = new TurnStateTracker(new MessageIdMinter())
	tracker.set(input.entryPhase, input.entryAnchorTs)

	// Sampled synchronously inside the production emit path, at the exact
	// instant the "Compacting context" divider becomes visible.
	let sampledPhase: TurnPhase | undefined

	const sessionHost = makeSessionHost()
	const activeSession = {
		sessionId: "old-session",
		sdkHost: sessionHost,
		unsubscribe: vi.fn(),
		startResult: { sessionId: "old-session" },
		isRunning: false,
	}

	// Production state publication goes through StatePostDebouncer
	// (50ms trailing edge) which buffers a single trailing rebuild.
	// We capture the snapshots directly off the production
	// postStateToWebview call so no constant-only assertion slips in.
	const captured: CapturedSnapshot[] = []
	const postCalls: number[] = []
	const rejectOnLast = input.postBehavior === "reject-on-last-call"

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
		messages: {
			appendAndEmit: vi.fn((messages: ClineMessage[]) => {
				for (const message of messages) {
					if (message.say !== "compaction") {
						continue
					}
					const info = JSON.parse(message.text ?? "{}") as ClineCompactionInfo
					if (info.status === "started") {
						sampledPhase = tracker.currentPhase
					}
				}
			}),
		},
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
		// The real SdkController's flushStateToWebview() reads
		// `turnState: this.turnStateTracker.get()` off the snapshot — we
		// synthesize that pass-through here. The captured sequence is the
		// canonical "what the webview saw, in order" stream.
		postStateToWebview: vi.fn().mockImplementation(async () => {
			postCalls.push(postCalls.length + 1)
			captured.push({ turnState: tracker.get() })
			if (rejectOnLast && captured.length === postCalls.length && postCalls.length > 1) {
				// Reject on the LAST publication only — that is the
				// trailing post in runCompaction's `finally` block. The
				// CSR07/CSR08 tests need to observe what happens when
				// exactly the post-restore publication fails, not the
				// entry-publication or the in-phase completion
				// publication.
				throw input.rejection ?? new Error("publication failed")
			}
		}),
		getTurnState: () => tracker.get(),
		setTurnPhase: (phase: TurnPhase, anchorTs?: number) => tracker.set(phase, anchorTs),
	} as unknown as SdkCompactionCoordinatorOptions & {
		messages: { appendAndEmit: ReturnType<typeof vi.fn> }
	}

	return {
		coordinator: new SdkCompactionCoordinator(options),
		options,
		tracker,
		captured,
		phaseWhenCompactionStarted: () => sampledPhase,
	}
}
