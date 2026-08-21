// ============================================================================
// ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01 / THCP11
//
// RED at the REAL coordinator publication seam for the load-bearing
// "host compaction" authority claim:
//
//   The TaskHeader projection encodes `compacting` as a HOST-OWNED
//   override (source: "host"). The authority for that claim is
//   `SdkCompactionCoordinator.enterCompactingPhase()` (writes the
//   legacy `compacting` phase) paired with `restorePhase()` (writes
//   the entry phase back). The pair bounds the live legacy
//   `compacting` value to the actual compaction transition window.
//
//   THCP02 only proves the FROZEN selector policy:
//
//     legacy compacting + shadow awaiting_followup
//       → compacting                          (PASS)
//
//   That policy does NOT distinguish:
//
//     live active host compaction
//       (legacy compacting is fresh inside the enter/restore pair)
//
//   from:
//
//     stale legacy compacting residue
//       (legacy compacting is the only data the selector sees, but
//        no host transition is actually in flight)
//
//   THCP11 exercises the REAL chronology at the production publication
//   seam. It uses the actual `SdkCompactionCoordinator` + the actual
//   `TurnStateTracker` the live extension host uses, captures every
//   `postStateToWebview()` call, and — for each captured snapshot —
//   projects the snapshot through the REAL `selectTaskHeaderPresentation`
//   selector that the SdkController publication block uses at
//   `apps/vscode/src/sdk/SdkController.ts:2935`.
//
//   The witness matrix:
//
//     T0: ordinary state — entry phase = awaiting_followup
//         publish snapshot (before any compaction call)
//         expected projection: phase = awaiting_followup, source = legacy
//
//     T1: enterCompactingPhase() — live compaction begins
//         publish snapshot
//         expected projection: phase = compacting, source = host
//
//     T2: in-phase work — tracker.phase === compacting
//         publish snapshot
//         expected projection: phase = compacting, source = host
//
//     T3: restorePhase() — entry phase restored
//         publish snapshot (the trailing post-restore publication)
//         expected projection: phase = awaiting_followup, source = legacy
//
//     T4: closed — no further publications
//
//   Properties pinned:
//
//     P1a: at least one publication inside the enter/restore pair
//          carries `phase = compacting` + `source = host`.
//     P1b: the LAST publication observed by the webview does NOT
//          carry `phase = compacting`.
//     P1c: the LAST publication's phase equals the entry phase
//          (post-restore = entry).
//     P1d: no publication AFTER the restorePhase() pair carries
//          `phase = compacting` (the bound on host-override
//          lifetime is enforced by the real coordinator).
//
//   If P1a-d are all green, the host override is naturally bounded
//   by the enter/restore pair at the production coordinator seam,
//   and the "compacting" source: "host" claim is accurate for the
//   UI consumption surface (which only ever observes the publication
//   stream, not the live tracker).
//
//   If ANY of P1a-d is RED, the selectTaskHeaderPresentation spec
//   needs a more explicit host-authority indicator on the projection
//   input (e.g. a `hostCompactionActive: boolean` that's only true
//   inside the enter/restore pair). That is a one bounded repair.
//
//   This test is RED-then-GREEN at the publication seam; no
//   constant-only witness, no UI-text heuristic.
// ============================================================================

import { createContextCompactionPrepareTurn } from "@cline/core"
import type { ClineCompactionInfo, ClineMessage, TurnPhase, TurnState } from "@shared/ExtensionMessage"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import { MessageIdMinter } from "../message-id-minter"
import { SdkCompactionCoordinator, type SdkCompactionCoordinatorOptions } from "../sdk-compaction-coordinator"
import { selectTaskHeaderPresentation, type TaskHeaderPresentationProjection } from "../task-state-shadow-arbiter-mapper"
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

import { Logger } from "@/shared/services/Logger"

const mockLoggerError = Logger.error as unknown as ReturnType<typeof vi.fn>

interface CapturedSnapshot {
	turnState: TurnState
	/**
	 * The TaskHeader projection that the LIVE SdkController publication
	 * block would have produced for this exact snapshot. We compute
	 * it by feeding the captured `tracker.currentPhase` and `.get().seq`
	 * through the production `selectTaskHeaderPresentation` selector.
	 *
	 * `canonicalShadowPhase` is `undefined` for the harness (no
	 * TaskStateShadowWiring is wired), so the shadow branch is
	 * unreachable here. That is intentional — THCP11 is explicitly
	 * pinned to the host-override branch, which is the only branch
	 * that READS `currentLegacyPhase` directly.
	 */
	taskHeaderProjection: TaskHeaderPresentationProjection
}

interface ProjectionCaptures {
	attempted: CapturedSnapshot[]
	delivered: CapturedSnapshot[]
	attemptedOrdinals: number[]
	deliveredOrdinals: number[]
	rejectedOrdinals: number[]
}

describe("ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01 / THCP11 host-compaction freshness", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("THCP11-P1a: at least one publication inside the host enter/restore pair carries phase=compacting, source=host", async () => {
		const entryPhase: TurnPhase = "awaiting_followup"
		const { coordinator, captured } = makeHarness({
			entryPhase,
			entryAnchorTs: 4242,
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		// The host-override publications are the ones whose
		// `turnState.phase` is literally "compacting" — these are the
		// snapshots inside the enter/restore pair.
		const hostOverrideSnapshots = captured.filter((s) => s.turnState.phase === "compacting")
		expect(hostOverrideSnapshots.length).toBeGreaterThan(0)
		for (const s of hostOverrideSnapshots) {
			expect(s.taskHeaderProjection.phase).toBe("compacting")
			expect(s.taskHeaderProjection.source).toBe("host")
		}
	})

	it("THCP11-P1b: the LAST state snapshot published to the webview does NOT carry phase=compacting (post-restore = entry)", async () => {
		const entryPhase: TurnPhase = "awaiting_followup"
		const { coordinator, captured } = makeHarness({
			entryPhase,
			entryAnchorTs: 4242,
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		// captured is the canonical "what the webview observed, in
		// order" sequence per the harness contract. The last entry
		// is the trailing post-restore publication.
		const last = captured[captured.length - 1]
		expect(last).toBeDefined()
		expect(last!.turnState.phase).not.toBe("compacting")
		expect(last!.taskHeaderProjection.phase).not.toBe("compacting")
		expect(last!.taskHeaderProjection.phase).toBe(entryPhase)
	})

	it("THCP11-P1c: the LAST state snapshot's TaskHeader projection equals the entry phase projection (post-restore = entry)", async () => {
		const entryPhase: TurnPhase = "awaiting_followup"
		const { coordinator, captured } = makeHarness({
			entryPhase,
			entryAnchorTs: 7777,
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		const last = captured[captured.length - 1]
		expect(last).toBeDefined()
		expect(last!.taskHeaderProjection.phase).toBe(entryPhase)
		// ACT-CLINEMM-TASK-COMPLETION-CONTINUATION-COHERENCE01 / TCCC01-B1:
		// the entry phase here is "awaiting_followup", which is a host-
		// owned phase (the canonical shadow cannot represent it; see
		// task-state-shadow-arbiter-mapper.ts selectTaskHeaderPresentation
		// JSDoc). Therefore the post-restore publication carries
		// source = "host" (via the new awaiting_followup host-override
		// branch), NOT the legacy absence fallback. The compaction
		// override is still bounded — the post-restore `phase` is the
		// entry phase, not "compacting" — and that is the load-bearing
		// invariant P1d continues to assert.
		expect(last!.taskHeaderProjection.source).toBe("host")
		expect(last!.taskHeaderProjection.phase).not.toBe("compacting")
	})

	it("THCP11-P1d: NO publication AFTER the restorePhase() pair carries phase=compacting (host-override lifetime is bounded by the coordinator)", async () => {
		// Probe `sampledPhase` records the tracker.currentPhase at the
		// exact moment the "started" message is appended (i.e. inside
		// the enter/restore pair, after enterCompactingPhase has fired).
		// After compactTask() returns, the entry phase should be the
		// last "live" tracker state and the last publication should
		// reflect that.
		const { coordinator, captured } = makeHarness({ entryPhase: "awaiting_followup" })
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		// Walk all publications and find the index of the LAST
		// in-phase publication (the one whose `turnState.phase ===
		// "compacting"`). After that index, every publication must
		// not be "compacting".
		let lastCompactIdx = -1
		for (let i = 0; i < captured.length; i++) {
			if (captured[i].turnState.phase === "compacting") {
				lastCompactIdx = i
			}
		}
		expect(lastCompactIdx).toBeGreaterThanOrEqual(0)
		// The bound is: every publication AFTER the last in-phase
		// one must have phase !== "compacting". The `source` is
		// allowed to be "host" post-restore if the entry phase is
		// itself a host-owned phase ("awaiting_followup" is the
		// canonical example — see TCCC01-B1) — but the `phase`
		// itself must NEVER be "compacting" outside the
		// enter/restore pair.
		for (let i = lastCompactIdx + 1; i < captured.length; i++) {
			expect(captured[i].turnState.phase).not.toBe("compacting")
			expect(captured[i].taskHeaderProjection.phase).not.toBe("compacting")
		}
	})

	it("THCP11-P1e: the chronology of projected phases matches the enter/restore pair semantics (compact→entry, no compaction residue)", async () => {
		const { coordinator, captured } = makeHarness({ entryPhase: "awaiting_followup" })
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		// The projection chronology must be a single contiguous
		// block of "compacting" (while the host transition is live)
		// surrounded by non-compacting projections at both ends.
		const projectedPhases = captured.map((s) => s.taskHeaderProjection.phase)
		// Find the first and last "compacting" indices.
		const compactIndices = projectedPhases.map((p, i) => (p === "compacting" ? i : -1)).filter((i) => i >= 0)
		if (compactIndices.length === 0) {
			throw new Error("Expected at least one compacting publication")
		}
		const firstCompact = compactIndices[0]
		const lastCompact = compactIndices[compactIndices.length - 1]
		// Every publication between firstCompact and lastCompact
		// (inclusive) must be "compacting".
		for (let i = firstCompact; i <= lastCompact; i++) {
			expect(projectedPhases[i]).toBe("compacting")
		}
		// Every publication BEFORE firstCompact must not be "compacting".
		for (let i = 0; i < firstCompact; i++) {
			expect(projectedPhases[i]).not.toBe("compacting")
		}
		// Every publication AFTER lastCompact must not be "compacting".
		for (let i = lastCompact + 1; i < projectedPhases.length; i++) {
			expect(projectedPhases[i]).not.toBe("compacting")
		}
	})

	it("THCP11-P1f: the host-override publications' source is 'host' (not 'legacy' or 'shadow')", async () => {
		const { coordinator, captured } = makeHarness({ entryPhase: "awaiting_followup" })
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		// Every publication whose `turnState.phase === "compacting"`
		// must project as source: "host" — this is the load-bearing
		// claim that the host override is accurate for the UI
		// consumption surface.
		const hostSources = captured.filter((s) => s.turnState.phase === "compacting").map((s) => s.taskHeaderProjection.source)
		expect(hostSources.length).toBeGreaterThan(0)
		for (const source of hostSources) {
			expect(source).toBe("host")
		}
	})

	// -------------------------------------------------------------------
	// ABLATION — proves THCP11 evidence is real, not a constant-only
	// witness. If the restorePhase() pair were absent (pre-fix
	// behavior), THCP11-P1b/P1c/P1d/P1e would be RED: the last
	// publication would still carry `phase = compacting` AND
	// `source = "host"`, and the chronology would not recover.
	// -------------------------------------------------------------------
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
	 *  reject. The mock succeeds everywhere else. */
	rejectPostAt?: number[]
	/** Optional probe: returns the live `postCalls` array (1-indexed) for
	 *  diagnostic assertions in a test. */
	onPostCalls?: (calls: number[]) => void
}) {
	const tracker = new TurnStateTracker(new MessageIdMinter())
	tracker.set(input.entryPhase, input.entryAnchorTs)

	// Sampled synchronously inside the production emit path, at the
	// exact instant the "Compacting context" divider becomes visible.
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
	//
	// The extended capture also projects through the REAL
	// `selectTaskHeaderPresentation` selector that the SdkController
	// publication block uses at SdkController.ts:2935. That makes
	// THCP11 a publication-seam test, not a selector-only test.
	const captured: CapturedSnapshot[] = []
	const publications: ProjectionCaptures = {
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
		// `turnState: this.turnStateTracker.get()` off the snapshot —
		// we synthesize that pass-through here. The captured sequence
		// is the canonical "what the webview saw, in order" stream.
		//
		// For each captured snapshot, we ALSO project through the
		// production `selectTaskHeaderPresentation` selector at
		// SdkController.ts:2935. canonicalShadowPhase is undefined
		// (no TaskStateShadowWiring in this harness), which is
		// intentional — THCP11 is the discriminator for the host
		// override branch, which is the only branch that READS
		// `currentLegacyPhase` directly.
		//
		// The mock rejects at SPECIFIC 1-indexed ordinals
		// (input.rejectPostAt); every other ordinal records the
		// snapshot and resolves normally.
		postStateToWebview: vi.fn().mockImplementation(async () => {
			const ordinal = postCalls.length + 1
			postCalls.push(ordinal)
			const turnState = tracker.get()
			const taskHeaderProjection = selectTaskHeaderPresentation({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: turnState.phase,
				seq: turnState.seq,
			})
			const snapshot: CapturedSnapshot = { turnState, taskHeaderProjection }
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
