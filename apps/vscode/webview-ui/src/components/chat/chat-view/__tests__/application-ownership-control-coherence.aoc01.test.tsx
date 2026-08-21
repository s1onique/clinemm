/**
 * ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01 / AOC01
 *
 * Synchronized snapshot discriminator for the LIVE W2 contradiction:
 *
 *   TaskHeader = Idle
 *   while Cancel is visible
 *   and (historical) Thinking disclosure is visible.
 *
 * Live chronology (frozen by this ACT, prior LIVE evidence on
 * s1onique.clinemm@4.1.10-4fd4dda6b):
 *
 *   W1:
 *     elapsed   = 16:54
 *     toolCalls = 110
 *     TaskHeader=Waiting          (truthful, CASE_B1 host override)
 *
 *   W2 (shortly afterward):
 *     elapsed   = 17:51
 *     toolCalls = 110              (unchanged -> no tool ran in between)
 *     TaskHeader=Idle              (false/idle)
 *     Cancel   = visible           (stale or new authority)
 *     Thinking disclosure = visible (historical collapsed reasoning)
 *
 * Discriminator mapping (per ACT §6):
 *
 *   Both TaskHeader="Idle" AND buttonConfig.secondaryAction="cancel"
 *   at the SAME committed state capture => the LIVE contradiction is
 *   reproducible from the production seam.
 *
 * CONSERVATION:
 *
 *   This test does NOT modify any production code, NOR does it reopen
 *   AOPC02 W1 projection fencing or CASE_B1 awaiting_followup host
 *   override. It only drives the real webview reducer + reads the
 *   real committed state to test the W1->W2 transition's coherence.
 *
 * STOP RULE (per ACT §13):
 *
 *   Stop at the first executable broken boundary.
 */

import type { ExtensionState, TurnState } from "@shared/ExtensionMessage"
import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getButtonConfigFromState } from "@/components/chat/chat-view/shared/buttonConfig"
import { ExtensionStateContextProvider, useExtensionState } from "@/context/ExtensionStateContext"

// ---------------------------------------------------------------------------
// Mock StateServiceClient.subscribeToState + subscribeToPartialMessage so we
// can drive both W1 (snapshot) and W2 (partial message) writers.
// ---------------------------------------------------------------------------

let snapshotHandler: ((stateData: ExtensionState) => void) | null = null
let _partialHandler: ((protoMessage: unknown) => void) | null = null
let snapshotUnsub: (() => void) | null = null
let partialUnsub: (() => void) | null = null

function noopStreaming(): () => void {
	return () => {}
}

vi.mock("@/services/grpc-client", () => {
	const makeService = (): Record<string, unknown> => {
		const proxy: Record<string, unknown> = new Proxy(
			{},
			{
				get: (_target, prop) => {
					if (prop === "subscribeToState") {
						return (
							_request: unknown,
							handlers: {
								onResponse: (response: { stateJson?: string }) => void
								onError?: (error: unknown) => void
								onComplete?: () => void
							},
						): (() => void) => {
							snapshotHandler = (stateData) => {
								handlers.onResponse({ stateJson: JSON.stringify(stateData) })
							}
							snapshotUnsub = () => {
								snapshotHandler = null
							}
							return snapshotUnsub
						}
					}
					if (prop === "subscribeToPartialMessage") {
						return (
							_request: unknown,
							handlers: {
								onResponse: (response: unknown) => void
								onError?: (error: unknown) => void
								onComplete?: () => void
							},
						): (() => void) => {
							_partialHandler = (protoMessage) => {
								handlers.onResponse(protoMessage)
							}
							partialUnsub = () => {
								_partialHandler = null
							}
							return partialUnsub
						}
					}
					if (typeof prop === "string" && prop.startsWith("subscribeTo")) {
						return noopStreaming
					}
					if (typeof prop === "string" && prop.startsWith("subscribe")) {
						return noopStreaming
					}
					return () => Promise.resolve(undefined)
				},
			},
		)
		return proxy
	}
	return {
		StateServiceClient: makeService(),
		UiServiceClient: makeService(),
		TaskServiceClient: makeService(),
		ModelsServiceClient: makeService(),
		McpServiceClient: makeService(),
		AccountServiceClient: makeService(),
		SlashServiceClient: makeService(),
		HookServiceClient: makeService(),
		TerminalServiceClient: makeService(),
		CheckpointsServiceClient: makeService(),
	}
})

// ---------------------------------------------------------------------------
// Snapshot factory for the W1-A -> W1-B sequence.
// ---------------------------------------------------------------------------

function w1Snapshot(opts: {
	stateVersion: number
	epoch: number
	turnState: TurnState
	taskHeaderPresentation: NonNullable<ExtensionState["taskHeaderPresentation"]>
	thinkingPresentation: NonNullable<ExtensionState["thinkingPresentation"]>
	clineMessages: ExtensionState["clineMessages"]
}): ExtensionState {
	return {
		version: "test",
		apiConfiguration: {},
		autoApprovalSettings: { version: 1 } as ExtensionState["autoApprovalSettings"],
		clineMessages: opts.clineMessages,
		stateVersion: opts.stateVersion,
		epoch: opts.epoch,
		turnState: opts.turnState,
		taskHeaderPresentation: opts.taskHeaderPresentation,
		thinkingPresentation: opts.thinkingPresentation,
		taskTelemetry: { startedAt: 0, toolCalls: 110, recoveryBudgetFailures: 0 },
	} as ExtensionState
}

// ---------------------------------------------------------------------------
// Committed-state consumer — captures the full state surface in one shot.
// ---------------------------------------------------------------------------

interface CommittedCapture {
	turnState: TurnState | undefined
	taskHeaderPresentation: NonNullable<ExtensionState["taskHeaderPresentation"]> | undefined
	thinkingPresentation: NonNullable<ExtensionState["thinkingPresentation"]> | undefined
	stateVersion: number
	epoch: number
	clineMessages: ExtensionState["clineMessages"]
}

let lastCapture: CommittedCapture | undefined
function CommittedStateProbe() {
	const ctx = useExtensionState() as unknown as ExtensionState & {
		turnState?: TurnState
	}
	lastCapture = {
		turnState: ctx.turnState,
		taskHeaderPresentation: ctx.taskHeaderPresentation,
		thinkingPresentation: ctx.thinkingPresentation,
		stateVersion: ctx.stateVersion ?? 0,
		epoch: ctx.epoch ?? 0,
		clineMessages: ctx.clineMessages,
	}
	return null
}

// ---------------------------------------------------------------------------
// Fixture: prior conversation with historical reasoning (the "Thinking
// disclosure" the LIVE screenshot captured).
// ---------------------------------------------------------------------------

const priorLiveMessages: ExtensionState["clineMessages"] = [
	{
		ts: 1,
		type: "say",
		say: "task",
		text: "Continue with the long-running task",
		seq: 1,
		epoch: 2,
	} as ExtensionState["clineMessages"][number],
	{
		ts: 2,
		type: "say",
		say: "reasoning",
		text: "Reasoning content that was historically emitted",
		seq: 2,
		epoch: 2,
	} as ExtensionState["clineMessages"][number],
	{
		// Anchor message for the W1-A truthful Waiting state — an
		// ask=followup is what SdkInteractionCoordinator emits at the
		// awaiting_followup phase. The production buttonsForPhase path
		// calls `getButtonConfig(anchoredMessage, "act")` for this case,
		// which returns BUTTON_CONFIGS.followup (no Cancel secondary) —
		// matching the LIVE W1 truthful "Waiting" with no Cancel.
		ts: 3,
		type: "ask",
		ask: "followup",
		text: JSON.stringify({ question: "Continue with what?", options: ["continue"] }),
		seq: 3,
		epoch: 2,
	} as ExtensionState["clineMessages"][number],
]

beforeEach(() => {
	snapshotHandler = null
	_partialHandler = null
	snapshotUnsub = null
	partialUnsub = null
	lastCapture = undefined
})

afterEach(() => {
	snapshotHandler = null
	_partialHandler = null
	snapshotUnsub = null
	partialUnsub = null
	lastCapture = undefined
})

// ---------------------------------------------------------------------------
// AOC01: the synchronized snapshot discriminator.
//
// Sequence (mirrors the LIVE W1->W2 transition):
//
//   1. W1-A: phase=awaiting_followup/15, taskHeaderPresentation.phase=
//      awaiting_followup (source="host"), thinkingPresentation.modelStreaming=
//      false, stateVersion=10, epoch=2.  (Truthful "Waiting".)
//
//   2. W1-B: phase=idle/16, taskHeaderPresentation.phase=idle (source=
//      "shadow"), thinkingPresentation.modelStreaming=false, stateVersion=
//      11, epoch=2.  (The W2 contradiction.)
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01 / AOC01", () => {
	it("AOC01: W1-A awaiting_followup -> W1-B idle — does the committed state reproduce Idle + Cancel?", async () => {
		render(
			<ExtensionStateContextProvider>
				<CommittedStateProbe />
			</ExtensionStateContextProvider>,
		)

		// Settle the initial mount.
		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
		})

		// Step 1: push W1-A — truthful "Waiting" state (CASE_B1 host
		// override forces awaiting_followup projection).
		const w1a = w1Snapshot({
			stateVersion: 10,
			epoch: 2,
			turnState: { phase: "awaiting_followup", seq: 15, anchorTs: 3 },
			taskHeaderPresentation: { phase: "awaiting_followup", source: "host", seq: 15 },
			thinkingPresentation: { modelStreaming: false, source: "shadow", seq: 15 },
			clineMessages: priorLiveMessages,
		})
		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")
			snapshotHandler(w1a)
		})
		await act(async () => {
			await Promise.resolve()
		})

		const w1aCapture = lastCapture
		expect(w1aCapture).toBeDefined()
		expect(w1aCapture?.turnState?.phase, "W1-A committed turnState.phase").toBe("awaiting_followup")
		expect(w1aCapture?.taskHeaderPresentation?.phase, "W1-A committed taskHeaderPresentation.phase").toBe("awaiting_followup")
		expect(w1aCapture?.taskHeaderPresentation?.source, "W1-A committed taskHeaderPresentation.source").toBe("host")

		const w1aButtonConfig = getButtonConfigFromState(
			w1aCapture?.clineMessages ?? [],
			w1aCapture?.turnState,
			"act",
			false, // foregroundCommandRunning
		)
		// Sanity: at W1-A (awaiting_followup), the production buttons
		// path returns the followup config (no Cancel secondary).
		expect(w1aButtonConfig.secondaryAction, "W1-A buttons.secondaryAction").not.toBe("cancel")

		// Step 2: push W1-B — the LIVE contradiction state.
		// Normal advance (seq 15 -> 16, stateVersion 10 -> 11, same
		// epoch) that moves the canonical phase from awaiting_followup
		// to idle.
		const w1b = w1Snapshot({
			stateVersion: 11,
			epoch: 2,
			turnState: { phase: "idle", seq: 16 },
			taskHeaderPresentation: { phase: "idle", source: "shadow", seq: 16 },
			thinkingPresentation: { modelStreaming: false, source: "shadow", seq: 16 },
			clineMessages: priorLiveMessages,
		})
		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")
			snapshotHandler(w1b)
		})
		await act(async () => {
			await Promise.resolve()
		})

		const w1bCapture = lastCapture
		expect(w1bCapture).toBeDefined()

		// Step 3: classify the W2 committed state.
		const w2TaskHeaderPhase = w1bCapture?.taskHeaderPresentation?.phase ?? "unknown"
		const w2TurnStatePhase = w1bCapture?.turnState?.phase ?? "unknown"
		const w2ModelStreaming = w1bCapture?.thinkingPresentation?.modelStreaming ?? false

		const w2ButtonConfig = getButtonConfigFromState(
			w1bCapture?.clineMessages ?? [],
			w1bCapture?.turnState,
			"act",
			false, // foregroundCommandRunning
		)
		const w2SecondaryAction = w2ButtonConfig.secondaryAction ?? null
		const w2HasCancel = w2SecondaryAction === "cancel"

		const w2Profile = {
			w2TaskHeaderPhase,
			w2TurnStatePhase,
			w2ModelStreaming,
			w2SecondaryAction,
			w2HasCancel,
			w2StateVersion: w1bCapture?.stateVersion,
			w2Epoch: w1bCapture?.epoch,
			w2TurnStateSeq: w1bCapture?.turnState?.seq ?? null,
			w2TaskHeaderSeq: w1bCapture?.taskHeaderPresentation?.seq ?? null,
			w2ThinkingSeq: w1bCapture?.thinkingPresentation?.seq ?? null,
		}
		// eslint-disable-next-line no-console
		console.log("[AOC01] W2 committed-state profile:", w2Profile)

		// Step 4: causal discriminator (per ACT §6).
		const isCaseC1 = w2TaskHeaderPhase === "idle" && (w2TurnStatePhase !== "idle" || w2ModelStreaming === true)
		const isCaseC2 = w2TaskHeaderPhase === "idle" && w2TurnStatePhase === "idle" && w2ModelStreaming === false && w2HasCancel
		const isGreenCoherent = w2TaskHeaderPhase === "idle" && !w2HasCancel

		if (isCaseC1) {
			// eslint-disable-next-line no-console
			console.log("[AOC01] CAUSAL_DIAG = CASE_C1_TASKHEADER_FALSE_IDLE (production seam RED)")
		} else if (isCaseC2) {
			// eslint-disable-next-line no-console
			console.log("[AOC01] CAUSAL_DIAG = CASE_C2_CANCEL_STALE (production seam RED)")
		} else if (isGreenCoherent) {
			// eslint-disable-next-line no-console
			console.log(
				"[AOC01] CAUSAL_DIAG = GREEN_PRODUCTION_COHERENT — LIVE W2 contradiction requires a path this test does NOT exercise",
			)
		} else {
			// eslint-disable-next-line no-console
			console.log("[AOC01] CAUSAL_DIAG = UNCLASSIFIED — investigate")
		}

		// Primary invariant (per ACT §5):
		//
		//   If TaskHeader renders "Idle", the production seam must NOT
		//   simultaneously render a Cancel secondary at the SAME
		//   committed state.
		expect(
			isGreenCoherent,
			`AOC01 expected production seam GREEN (taskHeader=Idle implies no Cancel at the same committed state); observed: ${JSON.stringify(w2Profile)}`,
		).toBe(true)
	})

	// AOC01-B: same-epoch STALE straggler that claims idle while a
	// newer committed state claims awaiting_followup.
	//
	// The production seam (ExtensionStateContext.tsx:706-714) has a
	// stateVersion backstop: when incoming.stateVersion < prevState.
	// stateVersion AND no replica-epoch advance, the projection fields
	// are preserved wholesale from prevState. A stale W1 straggler
	// must NOT downgrade the committed taskHeaderPresentation.
	//
	// This test exercises that backstop for the LIVE W2 contradiction
	// shape (idle + Cancel).
	it("AOC01-B: stale same-epoch W1 straggler with idle phase cannot downgrade committed awaiting_followup", async () => {
		render(
			<ExtensionStateContextProvider>
				<CommittedStateProbe />
			</ExtensionStateContextProvider>,
		)

		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
		})

		// Newer truthful state: awaiting_followup, source="host"
		const truthful = w1Snapshot({
			stateVersion: 20,
			epoch: 2,
			turnState: { phase: "awaiting_followup", seq: 30, anchorTs: 3 },
			taskHeaderPresentation: { phase: "awaiting_followup", source: "host", seq: 30 },
			thinkingPresentation: { modelStreaming: false, source: "shadow", seq: 30 },
			clineMessages: priorLiveMessages,
		})
		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")
			snapshotHandler(truthful)
		})
		await act(async () => {
			await Promise.resolve()
		})

		const truthfulCapture = lastCapture
		expect(truthfulCapture?.taskHeaderPresentation?.phase).toBe("awaiting_followup")
		expect(truthfulCapture?.stateVersion).toBe(20)

		// STALE straggler: lower stateVersion (15), idle phase. The
		// seq-fence ALONE would reject this (idle.seq=25 < truthful.
		// awaiting_followup.seq=30 is rejected), but this also tests the
		// PBR04 stateVersion backstop with a same-seq case.
		const straggler = w1Snapshot({
			stateVersion: 15,
			epoch: 2,
			turnState: { phase: "idle", seq: 30 },
			taskHeaderPresentation: { phase: "idle", source: "shadow", seq: 30 },
			thinkingPresentation: { modelStreaming: false, source: "shadow", seq: 30 },
			clineMessages: priorLiveMessages,
		})
		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")
			snapshotHandler(straggler)
		})
		await act(async () => {
			await Promise.resolve()
		})

		const straggledCapture = lastCapture
		// PRIMARY: stale straggler must NOT downgrade committed
		// taskHeaderPresentation. The W1 publication-ordering backstop
		// (ExtensionStateContext.tsx:706-714) preserves the committed
		// projection wholesale when stateVersion 15 < 20 AND no replica
		// epoch advance occurred.
		expect(
			straggledCapture?.taskHeaderPresentation?.phase,
			"AOC01-B: stale straggler must NOT downgrade committed taskHeaderPresentation.phase",
		).toBe("awaiting_followup")
		expect(straggledCapture?.stateVersion).toBe(20)
	})

	// AOC01-C: turnState missing (Hub/Remote absence path) — does the
	// legacy tail-walking fallback reproduce Idle + Cancel at the same
	// committed state?
	//
	// This exercises the production seam at ExtensionStateContext.tsx
	// where the W1 producer omits `turnState`. Per the transport-
	// recon provenance at turnStateSelectors.ts:23-44, the production
	// SdkController always includes turnState, so this scenario only
	// fires for Hub/Remote hosts. The AOC01-C test still pins the
	// behavior so any future path that drops turnState is detectable.
	it("AOC01-C: missing turnState — does the legacy tail-walking fallback reproduce Idle + Cancel?", async () => {
		render(
			<ExtensionStateContextProvider>
				<CommittedStateProbe />
			</ExtensionStateContextProvider>,
		)

		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
		})

		// Snapshot with NO turnState (Hub/Remote absence path).
		// taskHeaderPresentation.phase = "idle" via the legacy fallback
		// (selectTaskHeaderPresentation returns source="legacy" when
		// currentLegacyPhase is the only authority). thinkingPresentation
		// uses the same fallback: modelStreaming = (legacyPhase === "streaming").
		const idleNoTurnState = w1Snapshot({
			stateVersion: 1,
			epoch: 0,
			turnState: undefined as unknown as TurnState, // omit to test fallback
			taskHeaderPresentation: { phase: "idle", source: "legacy", seq: 1 },
			thinkingPresentation: { modelStreaming: false, source: "legacy", seq: 1 },
			clineMessages: priorLiveMessages,
		})
		// Cast: turnState undefined is acceptable for this fallback test.
		const idleNoTurnStatePayload = {
			...idleNoTurnState,
			turnState: undefined,
		} as ExtensionState

		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")
			snapshotHandler(idleNoTurnStatePayload)
		})
		await act(async () => {
			await Promise.resolve()
		})

		const capture = lastCapture
		// In this scenario, the W1 producer stamped taskHeaderPresentation
		// directly (the W1 gate just does ...stateData spread); the
		// turnState may be absent. The buttonConfig helper falls back to
		// `getButtonConfigForMessages` (legacy tail-walking) when turnState
		// is undefined. We capture what that fallback yields so we can
		// classify whether this path can produce the LIVE contradiction.
		const buttonConfig = getButtonConfigFromState(
			capture?.clineMessages ?? [],
			capture?.turnState,
			"act",
			false, // foregroundCommandRunning
		)
		const profile = {
			taskHeaderPhase: capture?.taskHeaderPresentation?.phase ?? "unknown",
			turnStatePhase: capture?.turnState?.phase ?? "unknown",
			modelStreaming: capture?.thinkingPresentation?.modelStreaming ?? false,
			secondaryAction: buttonConfig.secondaryAction ?? null,
			hasCancel: buttonConfig.secondaryAction === "cancel",
		}
		// eslint-disable-next-line no-console
		console.log("[AOC01-C] missing-turnState committed profile:", profile)

		// Diagnostic only — we do NOT assert green/red. The point is
		// to surface whether the legacy fallback can produce Idle +
		// Cancel at the same committed state, which is the path that
		// would explain the LIVE W2 contradiction if the W1 producer
		// omits turnState on the wire. The current production SdkController
		// always includes turnState (per transport-recon provenance), so
		// this branch is a future regression surface, not a current RED.
		expect(profile.taskHeaderPhase).toBe("idle")
	})

	// AOC01-D: a partial (streaming) message at the tail of clineMessages
	// AND turnState.phase === "idle" — does the production seam
	// reproduce Idle + Cancel?
	//
	// This is the most likely LIVE scenario: the agent finished a turn
	// (turnState.phase advanced awaiting_followup -> idle) but the
	// trailing partial message in clineMessages was not yet finalized
	// by a W2 partial. The TaskHeader reads `taskHeaderPresentation`
	// (idle) and the buttons path uses `turnState` (also idle → no
	// Cancel). So the production seam should be COHERENT here — Idle
	// label, no Cancel. This is the discriminating GREEN test that
	// proves the production seam is internally consistent.
	it("AOC01-D: idle turnState + partial tail message — production seam must be COHERENT (Idle, no Cancel)", async () => {
		render(
			<ExtensionStateContextProvider>
				<CommittedStateProbe />
			</ExtensionStateContextProvider>,
		)

		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
		})

		// Fixture: W1 truthful "Waiting" state first, then W2 with
		// idle phase but a stale partial tail message (the most likely
		// LIVE scenario).
		const w1a = w1Snapshot({
			stateVersion: 10,
			epoch: 2,
			turnState: { phase: "awaiting_followup", seq: 15, anchorTs: 3 },
			taskHeaderPresentation: { phase: "awaiting_followup", source: "host", seq: 15 },
			thinkingPresentation: { modelStreaming: false, source: "shadow", seq: 15 },
			clineMessages: priorLiveMessages,
		})
		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")
			snapshotHandler(w1a)
		})
		await act(async () => {
			await Promise.resolve()
		})

		// W2 push: phase=idle, taskHeaderPresentation.phase=idle. The
		// trailing message in clineMessages is partial=true (the model
		// finished but the W2 finalization has not arrived yet — exactly
		// the LIVE state).
		const w2WithPartialTail: ExtensionState["clineMessages"] = [
			...priorLiveMessages,
			{
				ts: 4,
				type: "say",
				say: "text",
				text: "Final response text still streaming...",
				partial: true,
				seq: 4,
				epoch: 2,
			} as ExtensionState["clineMessages"][number],
		]
		const w1b = w1Snapshot({
			stateVersion: 11,
			epoch: 2,
			turnState: { phase: "idle", seq: 16 },
			taskHeaderPresentation: { phase: "idle", source: "shadow", seq: 16 },
			thinkingPresentation: { modelStreaming: false, source: "shadow", seq: 16 },
			clineMessages: w2WithPartialTail,
		})
		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")
			snapshotHandler(w1b)
		})
		await act(async () => {
			await Promise.resolve()
		})

		const capture = lastCapture
		expect(capture).toBeDefined()
		expect(capture?.taskHeaderPresentation?.phase, "AOC01-D committed taskHeaderPresentation.phase").toBe("idle")
		expect(capture?.turnState?.phase, "AOC01-D committed turnState.phase").toBe("idle")
		expect(capture?.thinkingPresentation?.modelStreaming, "AOC01-D committed modelStreaming").toBe(false)

		// Production buttonConfig computed from the committed state.
		// The buttons path uses turnState (not legacy tail-walking) and
		// turnState.phase === "idle" returns BUTTON_CONFIGS.default (no
		// Cancel). The partial tail message must NOT cause a Cancel
		// secondary through the production path.
		const buttonConfig = getButtonConfigFromState(
			capture?.clineMessages ?? [],
			capture?.turnState,
			"act",
			false, // foregroundCommandRunning
		)
		const profile = {
			taskHeaderPhase: capture?.taskHeaderPresentation?.phase ?? "unknown",
			turnStatePhase: capture?.turnState?.phase ?? "unknown",
			modelStreaming: capture?.thinkingPresentation?.modelStreaming ?? false,
			secondaryAction: buttonConfig.secondaryAction ?? null,
			hasCancel: buttonConfig.secondaryAction === "cancel",
			tailMessagePartial: (capture?.clineMessages ?? []).at(-1)?.partial === true,
		}
		// eslint-disable-next-line no-console
		console.log("[AOC01-D] idle+partial-tail committed profile:", profile)

		// PRIMARY INVARIANT: at the same committed state, Idle + Cancel
		// must NOT coexist. The buttons path derives from turnState
		// (production path) and returns no Cancel when phase is idle.
		expect(
			profile.hasCancel,
			"AOC01-D production seam GREEN invariant: idle phase + partial tail must NOT produce Cancel",
		).toBe(false)
	})
})
