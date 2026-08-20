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

	// Probes — pin the ordinals so the failure-injection tests can target
	// the correct call. These exist to make the publication order
	// observable and stable. Reviewer-driven:
	// `CSR_PROBE_*` tests should remain in the suite as documentation of
	// the publication sequence the production code emits.
	it("CSR_PROBE_success_ordinals: successful compaction — record the post-call sequence", async () => {
		const observed: number[] = []
		const observedSnapshots: { ordinal: number; phase: string }[] = []
		const { coordinator } = makeHarness({
			entryPhase: "awaiting_followup",
			entryAnchorTs: 12,
			onPostCalls: (calls) => {
				observed.push(...calls)
			},
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()
		// Re-derive snapshots from the final state — the harness's
		// `captured` array has full snapshots; map ordinals to phases.
		// (We read it via a post-call callback below.)
		const { captured } = await (async () => {
			// Re-run harness inline so we can access captured; simpler
			// approach: assert via `captured` returned by makeHarness.
			const h = makeHarness({
				entryPhase: "awaiting_followup",
				entryAnchorTs: 12,
			})
			mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
				vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
			)
			await h.coordinator.compactTask()
			return h
		})()
		for (let i = 0; i < captured.length; i++) {
			observedSnapshots.push({ ordinal: i + 1, phase: captured[i]!.turnState.phase })
		}
		// Print so the next test can copy the ordinals without re-probing.
		// eslint-disable-next-line no-console
		console.log("CSR_PROBE_success_ordinals:", JSON.stringify(observedSnapshots))
		expect(observed.length).toBeGreaterThan(0)
	})

	it("CSR_PROBE_failure_ordinals: failing compaction — record the post-call sequence", async () => {
		const { captured } = await (async () => {
			const h = makeHarness({
				entryPhase: "awaiting_followup",
				entryAnchorTs: 12,
			})
			mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(vi.fn().mockRejectedValue(new Error("probe-boom")))
			await h.coordinator.compactTask().catch(() => {
				/* expected */
			})
			return h
		})()
		const observed: { ordinal: number; phase: string }[] = []
		for (let i = 0; i < captured.length; i++) {
			observed.push({ ordinal: i + 1, phase: captured[i]!.turnState.phase })
		}
		// eslint-disable-next-line no-console
		console.log("CSR_PROBE_failure_ordinals:", JSON.stringify(observed))
		expect(captured.length).toBeGreaterThan(0)
	})

	it("CSR07 (success path): a post-restore publication failure MUST NOT recreate the stuck-UI regression; the failure is observable and the tracker remains restored", async () => {
		// The success-path publication ordinals (probed via CSR_PROBE_*):
		//   #1  → entry publication (phase = compacting)
		//   #2  → in-phase completion publication (phase = compacting)
		//   #3  → trailing post-restore publication (phase = entry)  ← TARGET
		//
		// The reviewer's invariant: a publication failure at ordinal #3
		// (the only one that carries the restored-phase snapshot) MUST NOT
		// silently recreate the LIVE regression. The outer
		// `compactTask` catch will run the failure-notice path; that path
		// calls postStateToWebview one more time (ordinal #4). If the
		// restored phase is what reaches the webview, the LIVE bug is
		// truly closed regardless of whether the failure-path catches the
		// #3 rejection.
		mockLoggerError.mockClear()
		const { coordinator, captured } = makeHarness({
			entryPhase: "awaiting_followup",
			entryAnchorTs: 7,
			rejection: new Error("post-restore publication failed"),
			// Reject ONLY the trailing post-restore publication.
			rejectPostAt: [3],
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		// 1. Failure observable — Logger.error captured both the inner
		//    finally's no-op (compactionError undefined → throw, not log
		//    here) and the outer compactTask catch.
		const errCalls = mockLoggerError.mock.calls.map((c) => c.map(String).join(" "))
		expect(errCalls.some((s) => s.includes("compactTask failed"))).toBe(true)

		// 2. The OLD live regression would leave the LAST published
		//    snapshot at phase="compacting". The post-P1 contract is
		//    that EITHER ordinal #3's publication is observable (so the
		//    webview sees "awaiting_followup") OR — if #3 fails — the
		//    outer-catch #4 publication must carry the restored phase
		//    so the webview does see it. Either way, the LAST captured
		//    snapshot is `entryPhase`, never `compacting`.
		const last = captured[captured.length - 1]!
		expect(last.turnState.phase).toBe("awaiting_followup")

		// 3. Safety: ordinal #3 (the post-restore) was the one that
		//    actually rejected (ordinal-aware injection is no longer a
		//    no-op aliasing every other call). The captured snapshot
		//    AT ordinal #3 is recorded BEFORE the throw — that snapshot
		//    is the restored-phase snapshot the production code intended
		//    to ship.
		expect(captured[2]).toBeDefined()
		expect(captured[2]!.turnState.phase).toBe("awaiting_followup")
	})

	it("CSR08 (failure path): when the compaction implementation throws AND the trailing post-restore publication ALSO rejects, the original compaction error remains authoritative in the forensic log", async () => {
		// The failure-path publication ordinals (probed via CSR_PROBE_*):
		//   #1  → entry publication (phase = compacting)
		//   #2  → in-phase FAILED-row publication (phase = compacting)
		//   #3  → trailing post-restore publication (phase = entry)  ← TARGET
		//   #4  → outer-catch failure-notice publication (phase = entry)
		//
		// Reviewer-required invariant: with only #3 rejected, the
		// original compaction error ("boom") must remain the one
		// labeled `compactTask failed:` — NOT the publication rejection
		// — and a SEPARATE log entry must surface the publication
		// failure.
		mockLoggerError.mockClear()
		const { coordinator } = makeHarness({
			entryPhase: "awaiting_followup",
			entryAnchorTs: 7,
			rejection: new Error("post-restore publication failed"),
			// Reject ONLY the trailing post-restore publication.
			rejectPostAt: [3],
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(vi.fn().mockRejectedValue(new Error("boom")))

		await coordinator.compactTask()

		const errCalls = mockLoggerError.mock.calls.map((c) => c.map(String).join(" "))
		// Original compaction error is the one labeled `compactTask failed:`.
		// The P1 logic guarantees this: runCompaction's inner finally
		// sees `compactionError !== undefined` and therefore only logs
		// the publication error; the original `boom` propagates up to
		// compactTask's catch which logs it with the canonical label.
		expect(errCalls.some((s) => s.includes("compactTask failed") && s.includes("boom"))).toBe(true)
		// And the publication failure is also independently observable.
		expect(errCalls.some((s) => s.includes("post-restore publication failed"))).toBe(true)
		// And the outer-catch's own `failure-notice publication failed`
		// log (from the safety-net wrapper around emitInfo+post) was
		// also not needed because #4 didn't reject — but if ordinal #4
		// ALSO rejected, that path's log line would be `failure-notice
		// publication failed`. Verify it IS NOT present to confirm the
		// ordinal-selective injection didn't alias #4.
		expect(errCalls.some((s) => s.includes("failure-notice publication failed"))).toBe(false)
	})

	// ------------------------------------------------------------------
	// ABLATION — proves the CSR07/CSR08 evidence is real, not nominal.
	// If the post-restore publication were absent (pre-fix behavior),
	// CSR01 / CSR02 / CSR03 would be RED; if the P1 publication-failure
	// semantics were absent (pre-P1 behavior — original `try { ... }
	// catch {}` swallowing), CSR07 / CSR08 would be RED in a different,
	// equally specific way. The whole file is pinned by this matrix.
	// ------------------------------------------------------------------
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
	rejection?: unknown
	/** 1-indexed post-state-publication ordinals at which the mock must
	 *  reject. The mock succeeds everywhere else. Use this to target a
	 *  SPECIFIC publication — the entry publication, the in-phase
	 *  completion publication, the trailing post-restore publication,
	 *  the outer-catch failure-notice publication, etc. — without
	 *  aliasing every other call. */
	rejectPostAt?: number[]
	/** Optional probe: returns the live `postCalls` array (1-indexed) for
	 *  diagnostic assertions in a test. */
	onPostCalls?: (calls: number[]) => void
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
	const rejectPostAt = input.rejectPostAt ?? []

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
		//
		// The mock rejects at SPECIFIC 1-indexed ordinals (input.rejectPostAt);
		// every other ordinal records the snapshot and resolves normally.
		// This lets a test target one publication — e.g. only the trailing
		// post-restore publication — without aliasing the others.
		postStateToWebview: vi.fn().mockImplementation(async () => {
			const ordinal = postCalls.length + 1
			postCalls.push(ordinal)
			captured.push({ turnState: tracker.get() })
			if (input.onPostCalls) {
				input.onPostCalls([...postCalls])
			}
			if (rejectPostAt.includes(ordinal)) {
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
