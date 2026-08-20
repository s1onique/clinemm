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

/** Bookkeeping recorded by `makeHarness`'s `postStateToWebview` mock.
 *
 * The mock separates ATTEMPTED vs DELIVERED:
 *   - `attempted[ordinal]` records the snapshot the production code
 *     tried to publish (taken before the mock decides whether to
 *     throw). It represents what `runCompaction`'s `try { await
 *     this.options.postStateToWebview() }` SEMANTICALLY observed.
 *   - `delivered[ordinal]` records the snapshot the production code
 *     successfully published. It is ONLY appended after the mock
 *     resolves normally; a `rejectPostAt` ordinal is absent from
 *     `delivered`.
 *
 * The webview's "last received snapshot" is `delivered.at(-1)` — NOT
 * `attempted.at(-1)`. Tests that conflate the two can pass even when
 * the real webview is stuck on `compacting`. The P1-correctness
 * boundary in CSR07+08 pins this distinction.
 */
interface PublicationCaptures {
	attempted: CapturedSnapshot[]
	delivered: CapturedSnapshot[]
	/** 1-indexed ordinals of every ATTEMPTED call. */
	attemptedOrdinals: number[]
	/** 1-indexed ordinals of every DELIVERED (successfully resolved) call. */
	deliveredOrdinals: number[]
	/** 1-indexed ordinals of every THROWN call (subset of attempted). */
	rejectedOrdinals: number[]
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

	// Probes — pin the publication sequence (attempted/delivered ordinals
	// AND their phases) as documented ground truth. Reviewer-driven:
	// these tests assert the canonical production sequence with exact
	// ordinals and exact phases, so downstream CSR07/CSR08 can target
	// the right publication AND distinguish attempted from delivered.
	it("CSR_PROBE_success: success path emits 3 attempted publications, all delivered, in canonical phase order", async () => {
		const { coordinator, publications } = makeHarness({
			entryPhase: "awaiting_followup",
			entryAnchorTs: 12,
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		expect(publications.attemptedOrdinals).toEqual([1, 2, 3])
		expect(publications.deliveredOrdinals).toEqual([1, 2, 3])
		expect(publications.rejectedOrdinals).toEqual([])
		expect(publications.attempted.map((s) => s.turnState.phase)).toEqual(["compacting", "compacting", "awaiting_followup"])
		expect(publications.delivered.map((s) => s.turnState.phase)).toEqual(["compacting", "compacting", "awaiting_followup"])
		// The last successfully delivered snapshot is the restored
		// phase — what the webview finally saw.
		expect(publications.delivered.at(-1)!.turnState.phase).toBe("awaiting_followup")
	})

	it("CSR_PROBE_failure: failure path emits 4 attempted publications, all delivered (in this scenario), canonical phase order", async () => {
		const { coordinator, publications } = makeHarness({
			entryPhase: "awaiting_followup",
			entryAnchorTs: 12,
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(vi.fn().mockRejectedValue(new Error("probe-boom")))

		await coordinator.compactTask().catch(() => {
			/* outer compactTask swallows the throw */
		})

		expect(publications.attemptedOrdinals).toEqual([1, 2, 3, 4])
		expect(publications.deliveredOrdinals).toEqual([1, 2, 3, 4])
		expect(publications.rejectedOrdinals).toEqual([])
		expect(publications.attempted.map((s) => s.turnState.phase)).toEqual([
			"compacting",
			"compacting",
			"awaiting_followup",
			"awaiting_followup",
		])
		expect(publications.delivered.map((s) => s.turnState.phase)).toEqual([
			"compacting",
			"compacting",
			"awaiting_followup",
			"awaiting_followup",
		])
	})

	it("CSR07 (success path): a post-restore publication failure MUST NOT recreate the stuck-UI regression; the webview actually receives the restored phase via the outer-catch's successor publication", async () => {
		// The success-path publication ordinals (probed via CSR_PROBE_*):
		//   #1  → entry publication           (phase = compacting)
		//   #2  → in-phase completion         (phase = compacting)
		//   #3  → trailing post-restore       (phase = entry)   ← TARGET
		//   #4  → outer-catch successor       (phase = entry)   ← REQUIRED to deliver
		//                                                       if #3 fails
		//
		// Reviewer's invariant: a publication failure at ordinal #3 (the
		// only one that carries the restored-phase snapshot) MUST NOT
		// silently recreate the LIVE regression. The contract:
		//   - attempted ordinals = 4 (one extra from the outer-catch path)
		//   - ordinal #3 attempted with phase = entry, then REJECTED
		//   - successful deliveries = #1 compacting, #2 compacting,
		//                               #4 awaiting_followup
		//   - LAST DELIVERED phase = awaiting_followup
		//
		// If the post-P1 production logic were absent (no trailing #4),
		// the webview's last received snapshot would be `compacting`
		// and this test would RED.
		mockLoggerError.mockClear()
		const { coordinator, publications } = makeHarness({
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

		// The reviewer's required structure:
		expect(publications.attemptedOrdinals).toEqual([1, 2, 3, 4])
		expect(publications.rejectedOrdinals).toEqual([3])
		expect(publications.deliveredOrdinals).toEqual([1, 2, 4])
		expect(publications.delivered.map((s) => s.turnState.phase)).toEqual(["compacting", "compacting", "awaiting_followup"])
		// THE bug-fix invariant: the LAST successfully delivered snapshot
		// must carry the entry phase. If this is `compacting`, the old
		// LIVE regression is back.
		expect(publications.delivered.at(-1)!.turnState.phase).toBe("awaiting_followup")

		// Failure observable — the outer `compactTask failed:` log
		// entry proves the #3 publication rejection reached the top
		// boundary (and did NOT silently succeed).
		const errCalls = mockLoggerError.mock.calls.map((c) => c.map(String).join(" "))
		expect(errCalls.some((s) => s.includes("compactTask failed"))).toBe(true)
	})

	it("CSR08 (failure path): when the compaction implementation throws AND the trailing post-restore publication ALSO rejects, the original compaction error remains authoritative in the forensic log AND the outer-catch successor still delivers the restored phase", async () => {
		// The failure-path publication ordinals (probed via CSR_PROBE_*):
		//   #1  → entry publication           (phase = compacting)
		//   #2  → in-phase FAILED-row         (phase = compacting)
		//   #3  → trailing post-restore       (phase = entry)   ← TARGET (rejects)
		//   #4  → outer-catch failure-notice  (phase = entry)   ← REQUIRED to deliver
		//
		// Reviewer-required invariants:
		//   A. attempted ordinals = [1, 2, 3, 4]
		//   B. ordinal #3 attempted with phase = entry, then REJECTED
		//   C. successful deliveries = [#1 compacting, #2 compacting,
		//                                #4 awaiting_followup]
		//      (the LAST DELIVERED phase is `entry`, NOT `compacting`)
		//   D. the original compaction error "boom" is the one labeled
		//      `compactTask failed:` (not the publication rejection)
		//   E. the publication failure is also independently observable
		//      as a separate log entry
		//   F. ordinal #4 did NOT also reject (no
		//      `failure-notice publication failed` log) — proves
		//      the ordinal-selective injection did not alias #4.
		mockLoggerError.mockClear()
		const { coordinator, publications } = makeHarness({
			entryPhase: "awaiting_followup",
			entryAnchorTs: 7,
			rejection: new Error("post-restore publication failed"),
			// Reject ONLY the trailing post-restore publication.
			rejectPostAt: [3],
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(vi.fn().mockRejectedValue(new Error("boom")))

		await coordinator.compactTask()

		// A. attempted ordinals.
		expect(publications.attemptedOrdinals).toEqual([1, 2, 3, 4])
		// B. #3 attempted with phase=entry, rejected.
		expect(publications.attempted[2]!.turnState.phase).toBe("awaiting_followup")
		expect(publications.rejectedOrdinals).toEqual([3])
		// C. delivered: #1, #2, #4. #4 carries the restored phase so the
		//    webview does not see a stuck "compacting".
		expect(publications.deliveredOrdinals).toEqual([1, 2, 4])
		expect(publications.delivered.map((s) => s.turnState.phase)).toEqual(["compacting", "compacting", "awaiting_followup"])

		const errCalls = mockLoggerError.mock.calls.map((c) => c.map(String).join(" "))
		// D. the original compaction error is labeled canonical.
		expect(errCalls.some((s) => s.includes("compactTask failed") && s.includes("boom"))).toBe(true)
		// E. the publication failure is also independently observable.
		expect(errCalls.some((s) => s.includes("post-restore publication failed"))).toBe(true)
		// F. log-level confirmation that the outer-catch safety-net
		// path (#4) did not log "failure-notice publication failed" —
		// i.e. that #4 successfully delivered the restored phase rather
		// than ALSO rejecting.
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
	const publications: PublicationCaptures = {
		attempted: [],
		delivered: [],
		attemptedOrdinals: [],
		deliveredOrdinals: [],
		rejectedOrdinals: [],
	}
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
			const snapshot: CapturedSnapshot = { turnState: tracker.get() }
			// ATTEMPTED: every invocation records — taken BEFORE the
			// mock decides whether to throw. The production code
			// semantically observed this snapshot, but the webview
			// may not have.
			publications.attempted.push(snapshot)
			publications.attemptedOrdinals.push(ordinal)
			captured.push(snapshot)
			if (input.onPostCalls) {
				input.onPostCalls([...postCalls])
			}
			if (rejectPostAt.includes(ordinal)) {
				publications.rejectedOrdinals.push(ordinal)
				throw input.rejection ?? new Error("publication failed")
			}
			// DELIVERED: the publication resolved normally — the
			// webview would have received this snapshot.
			publications.delivered.push(snapshot)
			publications.deliveredOrdinals.push(ordinal)
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
		publications,
		phaseWhenCompactionStarted: () => sampledPhase,
	}
}
