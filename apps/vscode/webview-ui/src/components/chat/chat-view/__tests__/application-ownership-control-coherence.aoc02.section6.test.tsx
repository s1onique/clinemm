/**
 * ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01 / AOC02 §6
 * REAL PARTIAL-SUBSCRIPTION PATH discriminator.
 *
 * Per Factory reviewer strict stop order:
 *
 *   §2 Cancel authority      = CLOSED_GREEN (bda2a7626)
 *   §3 Real producer object  = CLOSED_GREEN (b3a950554)
 *   §6 Real partial path     = THIS FILE
 *
 * PURPOSE
 *   Exercise the actual `ExtensionStateContext` synchronization sequence:
 *
 *     subscribeToState           -> capture full snapshot
 *     subscribeToPartialMessage  -> capture partial proto message
 *
 *   using the REAL registered callbacks (no locally-replicated reducer
 *   logic). Determine whether a real partial-message update can leave
 *   button/control state from an older active generation while a
 *   later/full state has moved TaskHeader to Idle.
 *
 * EVIDENCE-HYGIENE REFINEMENT (per Factory reviewer §3 disposition)
 *
 *   §3 verdict language was re-frozen to:
 *
 *     CASE_P2_PRODUCER_OMITS_TURNSTATE =
 *       NOT REPRODUCED across
 *       initial / active / awaiting_followup / clearTask->idle
 *
 *   This §6 file applies the same wording discipline: every GREEN
 *   verdict is reported as "NOT REPRODUCED across the exercised
 *   chronology", not as a global impossibility claim.
 *
 * INVALIDS FOR THIS SECTION
 *   - Embedding `partial: true` inside a full-state snapshot is
 *     INVALID for §6. The partial path is invoked through the REAL
 *     `subscribeToPartialMessage` callback.
 *   - Re-implementing the partial reducer locally is INVALID. The
 *     real `convertProtoToClineMessage` + real `reducerApplyMessage`
 *     run through the real ExtensionStateContext provider.
 *   - Sampling committed state via a side-channel / helper outside the
 *     mounted provider is INVALID. Every check derives from the SAME
 *     committed provider state.
 *
 * CONSERVATION
 *   - AOC01 4/4 GREEN (within webview 616/616 PASS).
 *   - AOC02 §2 9/9 GREEN (buttonConfig.aoc02.test.ts).
 *   - AOC02 §3 12/12 GREEN (bridge stream; producer-side coherent).
 *   - AOPC02 stale full-state fencing untouched.
 *   - TCCC01 CASE_B1 awaiting_followup host override preserved
 *     (§5 captures phase agreement through the real producer).
 *   - THCP/LAC/RSP/LTZ/task-control/RBE01 untouched.
 *   - NO production code changed.
 *
 * STOP RULE
 *   If the post-full-idle committed state reproduces Cancel at the
 *   SAME committed object as TaskHeader=Idle, classify
 *   `CASE_W2_PARTIAL_STATE_MIX` and STOP. No §7 epoch/reset.
 *   If the adversarial delayed-partial chronology resurrects
 *   Cancel / active Thinking / active buttonConfig, classify
 *   `CASE_W2_PARTIAL_STATE_MIX` and STOP.
 */

import type { ExtensionState, TurnState } from "@shared/ExtensionMessage"
import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getButtonConfigFromState } from "@/components/chat/chat-view/shared/buttonConfig"
import { ExtensionStateContextProvider, useExtensionState } from "@/context/ExtensionStateContext"

// ---------------------------------------------------------------------------
// Mock ONLY the gRPC transport boundary. Capture both production callbacks
// as the real `ExtensionStateContextProvider` registers them. We do NOT
// mock `convertProtoToClineMessage`, `applyMessage`, or the provider's
// reducer -- those run for real inside the mounted React tree.
// ---------------------------------------------------------------------------

let snapshotHandler: ((stateData: ExtensionState) => void) | null = null
let partialHandler: ((protoMessage: unknown) => void) | null = null
let snapshotUnsub: (() => void) | null = null
let partialUnsub: (() => void) | null = null

// §2 counters: prove both callbacks were actually invoked by production.
let snapshotHandlerCalls = 0
let partialHandlerCalls = 0

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
								snapshotHandlerCalls++
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
							partialHandler = (protoMessage) => {
								partialHandlerCalls++
								handlers.onResponse(protoMessage)
							}
							partialUnsub = () => {
								partialHandler = null
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
		McpServiceClient: makeService(),
		ModelsServiceClient: makeService(),
		HookServiceClient: makeService(),
		TerminalServiceClient: makeService(),
		CheckpointsServiceClient: makeService(),
	}
})

// ---------------------------------------------------------------------------
// Snapshot factory for the W1 sequence.
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
// Committed-state probe -- captures the full state surface in one shot.
// This is the SAME committed object React saw (per §7).
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
// priorLiveMessages: a stable conversation with the historical reasoning
// disclosure the LIVE screenshot captured. Used as the W1 tail.
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
		text: "Historical reasoning disclosure (LIVE collapsed-reasoning UI)",
		seq: 2,
		epoch: 2,
	} as ExtensionState["clineMessages"][number],
	{
		ts: 3,
		type: "say",
		say: "text",
		text: "Prior response chunk",
		seq: 3,
		epoch: 2,
	} as ExtensionState["clineMessages"][number],
]

// ---------------------------------------------------------------------------
// Profile helper: derives TaskHeader / Thinking / buttonConfig from the
// SAME committed capture (per §7).
// ---------------------------------------------------------------------------

interface CommittedProfile {
	taskHeaderPhase: string
	turnStatePhase: string
	modelStreaming: boolean
	secondaryAction: string | null | undefined
	hasCancel: boolean
	tailMessagePartial: boolean
	tailMessageSay: string | undefined
	buttonConfigEnableButtons: boolean | undefined
}

function profileFromCapture(c: CommittedCapture | undefined): CommittedProfile | undefined {
	if (!c) return undefined
	const buttonConfig = getButtonConfigFromState(
		c.clineMessages ?? [],
		c.turnState,
		"act",
		false, // foregroundCommandRunning -- not on the exercised local seam
	)
	const tail = (c.clineMessages ?? []).at(-1)
	return {
		taskHeaderPhase: c.taskHeaderPresentation?.phase ?? "unknown",
		turnStatePhase: c.turnState?.phase ?? "unknown",
		modelStreaming: c.thinkingPresentation?.modelStreaming ?? false,
		secondaryAction: buttonConfig.secondaryAction,
		hasCancel: buttonConfig.secondaryAction === "cancel",
		tailMessagePartial: tail?.partial === true,
		tailMessageSay: tail?.type === "say" ? tail.say : undefined,
		buttonConfigEnableButtons: buttonConfig.enableButtons,
	}
}

describe("ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01 / AOC02 / §6 -- REAL_PARTIAL_SUBSCRIPTION_PATH", () => {
	let cleanup: (() => void) | null = null

	beforeEach(() => {
		// Fresh counters per test so the §2 evidence is per-test.
		snapshotHandlerCalls = 0
		partialHandlerCalls = 0
		snapshotHandler = null
		partialHandler = null
		lastCapture = undefined
	})

	afterEach(() => {
		if (cleanup) {
			cleanup()
			cleanup = null
		}
		snapshotHandler = null
		partialHandler = null
	})

	// =========================================================================
	// NORMAL CHRONOLOGY:
	//   §3 BASELINE W1 Waiting
	//   §4 REAL partial update (active generation)
	//   §5 FULL W1 Idle -> PRIMARY INVARIANT (Idle => no Cancel)
	// =========================================================================

	it("AOC02-§6-NORMAL-§3: baseline W1 Waiting commits Waiting + no live Thinking (CASE_B1 host override preserved)", async () => {
		const result = render(
			<ExtensionStateContextProvider>
				<CommittedStateProbe />
			</ExtensionStateContextProvider>,
		)
		cleanup = result.unmount

		// Wait for useEffect to wire both subscriptions.
		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
		})

		// §2 PROOF: both production callbacks must have been registered.
		expect(snapshotHandler, "subscribeToState callback wired").toBeInstanceOf(Function)
		expect(partialHandler, "subscribeToPartialMessage callback wired").toBeInstanceOf(Function)

		// §3: deliver coherent full snapshot (Waiting / CASE_B1).
		const w1Waiting = w1Snapshot({
			stateVersion: 10,
			epoch: 2,
			turnState: { phase: "awaiting_followup", seq: 15, anchorTs: 3 },
			taskHeaderPresentation: { phase: "awaiting_followup", source: "host", seq: 15 },
			thinkingPresentation: { modelStreaming: false, source: "shadow", seq: 15 },
			clineMessages: priorLiveMessages,
		})
		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")
			snapshotHandler(w1Waiting)
		})
		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
		})

		const p = profileFromCapture(lastCapture)
		expect(p, "committed profile").toBeDefined()
		expect(p?.turnStatePhase, "§3 turnState.phase == awaiting_followup (CASE_B1)").toBe("awaiting_followup")
		expect(p?.taskHeaderPhase, "§3 taskHeader.phase == awaiting_followup").toBe("awaiting_followup")
		expect(p?.modelStreaming, "§3 thinking.modelStreaming == false").toBe(false)
		// §2 PROOF: snapshotHandler was actually invoked.
		expect(snapshotHandlerCalls, "§2 snapshotHandlerCalls >= 1").toBeGreaterThanOrEqual(1)
	})

	it("AOC02-§6-NORMAL-§4: REAL partial update leaves turnState/taskHeader/thinking UNCHANGED (partial path is message-only)", async () => {
		const result = render(
			<ExtensionStateContextProvider>
				<CommittedStateProbe />
			</ExtensionStateContextProvider>,
		)
		cleanup = result.unmount

		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
		})

		// W1 Waiting.
		const w1Waiting = w1Snapshot({
			stateVersion: 10,
			epoch: 2,
			turnState: { phase: "awaiting_followup", seq: 15, anchorTs: 3 },
			taskHeaderPresentation: { phase: "awaiting_followup", source: "host", seq: 15 },
			thinkingPresentation: { modelStreaming: false, source: "shadow", seq: 15 },
			clineMessages: priorLiveMessages,
		})
		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")
			snapshotHandler(w1Waiting)
		})
		await act(async () => {
			await Promise.resolve()
		})

		const baselineStateVersion = lastCapture?.stateVersion ?? 0
		const baselineTurnState = lastCapture?.turnState

		// §4: invoke the REAL partial callback with a message shape
		// production can genuinely emit during/after the active turn.
		// ts > 0, partial: true, seq within epoch, same epoch as snapshot.
		if (!partialHandler) throw new Error("partialHandler not wired")
		await act(async () => {
			partialHandler({
				ts: 4,
				type: 1, // ClineMessageType.SAY
				say: 4, // ClineSay.TEXT (must match a real proto enum value)
				text: "Real partial stream chunk (genuine production shape)",
				partial: true,
				seq: 4,
				epoch: 2,
				images: [], // convertProtoToClineMessage reads .length
				files: [], // convertProtoToClineMessage reads .length
			})
		})
		// Wait for the React state update to flush.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 50))
		})

		// §2 PROOF: partialHandler was actually invoked.
		expect(partialHandlerCalls, "§2 partialHandlerCalls >= 1").toBeGreaterThanOrEqual(1)

		const p = profileFromCapture(lastCapture)
		expect(p, "committed profile").toBeDefined()
		// Partial path MUST NOT change turnState / taskHeader / thinking /
		// stateVersion / epoch. Only clineMessages may change.
		expect(p?.turnStatePhase, "§4 turnState.phase unchanged after partial").toBe("awaiting_followup")
		expect(p?.taskHeaderPhase, "§4 taskHeader.phase unchanged after partial").toBe("awaiting_followup")
		expect(p?.modelStreaming, "§4 thinking.modelStreaming unchanged after partial").toBe(false)
		expect(lastCapture?.stateVersion, "§4 stateVersion unchanged after partial").toBe(baselineStateVersion)
		expect(lastCapture?.turnState, "§4 turnState reference unchanged after partial").toBe(baselineTurnState)
		expect(p?.tailMessagePartial, "§4 tail message is the partial").toBe(true)
	})

	it("AOC02-§6-NORMAL-§5: PRIMARY INVARIANT -- after REAL full-idle W1, TaskHeader=Idle => buttonConfig has NO Cancel", async () => {
		const result = render(
			<ExtensionStateContextProvider>
				<CommittedStateProbe />
			</ExtensionStateContextProvider>,
		)
		cleanup = result.unmount

		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
		})

		// W1 Waiting (CASE_B1).
		const w1Waiting = w1Snapshot({
			stateVersion: 10,
			epoch: 2,
			turnState: { phase: "awaiting_followup", seq: 15, anchorTs: 3 },
			taskHeaderPresentation: { phase: "awaiting_followup", source: "host", seq: 15 },
			thinkingPresentation: { modelStreaming: false, source: "shadow", seq: 15 },
			clineMessages: priorLiveMessages,
		})
		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")
			snapshotHandler(w1Waiting)
		})
		await act(async () => {
			await Promise.resolve()
		})

		// Real partial stream during the active generation.
		if (!partialHandler) throw new Error("partialHandler not wired")
		await act(async () => {
			partialHandler({
				ts: 4,
				type: 1,
				say: 4, // ClineSay.TEXT
				text: "Active-generation partial chunk",
				partial: true,
				seq: 4,
				epoch: 2,
				images: [],
				files: [],
			})
		})
		await act(async () => {
			await Promise.resolve()
		})

		// W1 Idle (the canonical post-turn terminal snapshot).
		const w1Idle = w1Snapshot({
			stateVersion: 11,
			epoch: 2,
			turnState: { phase: "idle", seq: 16 },
			taskHeaderPresentation: { phase: "idle", source: "shadow", seq: 16 },
			thinkingPresentation: { modelStreaming: false, source: "shadow", seq: 16 },
			clineMessages: priorLiveMessages,
		})
		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")
			snapshotHandler(w1Idle)
		})
		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
		})

		const p = profileFromCapture(lastCapture)
		expect(p, "committed profile").toBeDefined()

		// PRIMARY INVARIANT (§5):
		//   TaskHeader = Idle
		//     =>
		//   real buttonConfig has NO Cancel.
		expect(p?.taskHeaderPhase, "§5 TaskHeader=Idle after full idle W1").toBe("idle")
		expect(p?.turnStatePhase, "§5 turnState=Idle after full idle W1").toBe("idle")
		expect(p?.modelStreaming, "§5 thinking.modelStreaming=false after full idle W1").toBe(false)
		expect(p?.hasCancel, "§5 PRIMARY INVARIANT: Idle + Cancel must NOT coexist at the same committed object").toBe(false)
		expect(p?.secondaryAction, "§5 secondaryAction is undefined (BUTTON_CONFIGS.default)").toBeUndefined()
	})

	// =========================================================================
	// ADVERSARIAL CHRONOLOGY (§6):
	//   W1 Waiting -> W1 Idle -> delayed older partial callback
	// Require: delayed partial cannot resurrect Cancel / active Thinking /
	//          active buttonConfig.
	// =========================================================================

	it("AOC02-§6-ADVERSARIAL: delayed older partial after full-idle W1 cannot resurrect Cancel or active Thinking", async () => {
		const result = render(
			<ExtensionStateContextProvider>
				<CommittedStateProbe />
			</ExtensionStateContextProvider>,
		)
		cleanup = result.unmount

		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
		})

		// W1 Waiting (CASE_B1) -- the prior generation was active.
		const w1Waiting = w1Snapshot({
			stateVersion: 10,
			epoch: 2,
			turnState: { phase: "awaiting_followup", seq: 15, anchorTs: 3 },
			taskHeaderPresentation: { phase: "awaiting_followup", source: "host", seq: 15 },
			thinkingPresentation: { modelStreaming: false, source: "shadow", seq: 15 },
			clineMessages: priorLiveMessages,
		})
		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")
			snapshotHandler(w1Waiting)
		})
		await act(async () => {
			await Promise.resolve()
		})

		// W1 Idle (post-turn canonical idle).
		const w1Idle = w1Snapshot({
			stateVersion: 11,
			epoch: 2,
			turnState: { phase: "idle", seq: 16 },
			taskHeaderPresentation: { phase: "idle", source: "shadow", seq: 16 },
			thinkingPresentation: { modelStreaming: false, source: "shadow", seq: 16 },
			clineMessages: priorLiveMessages,
		})
		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")
			snapshotHandler(w1Idle)
		})
		await act(async () => {
			await Promise.resolve()
		})

		const pBeforeLatePartial = profileFromCapture(lastCapture)
		expect(pBeforeLatePartial?.taskHeaderPhase, "§6 pre-adversarial TaskHeader=Idle").toBe("idle")
		expect(pBeforeLatePartial?.turnStatePhase, "§6 pre-adversarial turnState=Idle").toBe("idle")
		expect(pBeforeLatePartial?.hasCancel, "§6 pre-adversarial NO Cancel").toBe(false)

		// §6 ADVERSARIAL: deliver a delayed older partial callback AFTER the
		// idle snapshot. The partial has the same epoch (epoch=2) and a
		// seq (4) lower than the committed snapshot (stateVersion=11,
		// last seq=16), so the convergent-replica reducer sees it as a
		// stale message from the prior generation.
		if (!partialHandler) throw new Error("partialHandler not wired")
		await act(async () => {
			partialHandler({
				ts: 4,
				type: 1,
				say: 4, // ClineSay.TEXT
				text: "Delayed older partial chunk (stale generation)",
				partial: true,
				seq: 4,
				epoch: 2,
				images: [],
				files: [],
			})
		})
		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
		})

		const pAfterLatePartial = profileFromCapture(lastCapture)

		// §6 PRIMARY INVARIANT: delayed partial must NOT resurrect Cancel,
		// active thinking, or active buttonConfig without the canonical
		// state having advanced.
		expect(pAfterLatePartial?.taskHeaderPhase, "§6 post-adversarial TaskHeader still Idle").toBe("idle")
		expect(pAfterLatePartial?.turnStatePhase, "§6 post-adversarial turnState still Idle").toBe("idle")
		expect(pAfterLatePartial?.modelStreaming, "§6 post-adversarial thinking.modelStreaming still false").toBe(false)
		expect(
			pAfterLatePartial?.hasCancel,
			"§6 PRIMARY INVARIANT (adversarial): delayed older partial cannot resurrect Cancel after full-idle W1",
		).toBe(false)
		expect(
			pAfterLatePartial?.secondaryAction,
			"§6 secondaryAction stays undefined after adversarial late partial",
		).toBeUndefined()
	})
})
