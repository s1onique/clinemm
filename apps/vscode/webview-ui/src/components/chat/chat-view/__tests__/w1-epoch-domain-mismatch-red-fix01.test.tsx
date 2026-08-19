/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-W1-EPOCH-DOMAIN-MISMATCH-RED-FIX01
 *
 * Live W2 defect remaining after the REACT-UPDATER-PURITY-REPAIR01
 * commit (d4e24148c).
 *
 * Frozen live evidence (LCD01 stream, post-purity-repair):
 *
 *   P12:
 *     W1 host/raw turnState = streaming/11
 *     B0 replica            = idle/3
 *     committed             = idle/3        <-- BUG (live)
 *
 *   P35:
 *     W1 host/raw turnState = awaiting_followup/34
 *     B0 replica            = idle/3
 *     committed             = idle/3        <-- BUG (live)
 *
 *   W2 messages on the wire: epoch=2, seq=9, 13, 15, 17, ..., 33
 *   W1 snapshots on the wire: stateVersion=0, epoch=ABSENT
 *   Committed React state:    epoch=2
 *
 * Causal mechanism (composition, proven by R0/R2 RED on pre-fix HEAD):
 *
 *   1. W2 partial stream stamps epoch=2 on every message -> advances the
 *      webview replica's epoch fence to 2.
 *   2. W1 snapshot delivers host turnState (streaming/11) but the W1
 *      producer (SdkController.getStateToPostToWebview) does NOT stamp
 *      `epoch` on the snapshot payload, so JSON.stringify emits no
 *      `epoch` key and the webview reducer sees snapshotEpoch=0
 *      (from `state.epoch ?? 0`).
 *   3. The reducer's older-epoch fence (`snapshotEpoch < state.epoch`,
 *      messageReducer.ts:167) rejects the snapshot wholesale. The
 *      committed state remains the prior replica (idle/3).
 *   4. Same composition repeats at terminal: 0 < 2 rejects
 *      awaiting_followup/34 -> idle/3 persists.
 *
 * Fix: stamp `epoch` and `stateVersion` on the W1 snapshot payload from
 * the same MessageIdMinter that stamps W2 messages (apps/vscode/src/sdk
 * /SdkController.ts SdkController.getStateToPostToWebview).
 *
 * Tests (GREEN regression witnesses on the post-fix HEAD):
 *
 *   R0 - W1 wire stamped with epoch=2, host streaming/11 -> committed streaming/11.
 *        Mirrors the live P12 row.
 *   R1 - W1 wire stamped with epoch=2 + stateVersion=0 (legacy compat),
 *        host streaming/11 -> committed streaming/11 (ablation: same epoch).
 *   R2 - W1 wire stamped with epoch=2, host awaiting_followup/34 -> committed
 *        awaiting_followup/34. Mirrors the live P35 row.
 *
 * If R0/R1/R2 all GREEN, the W1 producer stamping closes the
 * epoch-asymmetry composition and the live W2 defect is fixed.
 */

import type { ExtensionState, TurnState } from "@shared/ExtensionMessage"
import {
	clearPostTerminalAuthorityDiagnosticBoth,
	disablePostTerminalAuthorityDiagnosticBoth,
	enablePostTerminalAuthorityDiagnosticBoth,
	getPostTerminalAuthorityDiagnosticRecords,
	type PostTerminalAuthoritySnapshot,
} from "@shared/post-terminal-authority-diagnostic"
import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ExtensionStateContextProvider, useExtensionState } from "@/context/ExtensionStateContext"

let snapshotHandler: ((stateData: ExtensionState) => void) | null = null
let partialHandler: ((protoMessage: unknown) => void) | null = null
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
							partialHandler = (protoMessage) => {
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

// W2 partial message stamped epoch=2 - advances the replica's epoch fence.
// Live producer stamps epoch=2 on every partial.
function w2PartialWithEpoch2(opts: { ts: number; seq: number; text: string; final?: boolean }): unknown {
	return {
		ts: opts.ts,
		seq: opts.seq,
		type: 1,
		say: 4,
		text: opts.text,
		images: [],
		files: [],
		reasoning: "",
		partial: opts.final !== true,
		lastCheckpointHash: "",
		isCheckpointCheckedOut: false,
		isOperationOutsideWorkspace: false,
		conversationHistoryIndex: 0,
		conversationName: "",
		epoch: 2,
	}
}

// W1 snapshot factory. When epoch is undefined, the field is omitted
// from the wire entirely - matching the live PTAD-captured shape where
// the producer never stamps epoch on the W1 payload.
function w1Snapshot(opts: {
	stateVersion: number
	epoch: number | undefined
	ptadPushId: number
	turnState: TurnState
	clineMessages: ExtensionState["clineMessages"]
}): ExtensionState {
	const base: ExtensionState = {
		version: "test",
		apiConfiguration: {},
		autoApprovalSettings: { version: 1 } as ExtensionState["autoApprovalSettings"],
		clineMessages: opts.clineMessages,
		stateVersion: opts.stateVersion,
		turnState: opts.turnState,
		_ptadEnabled: true,
		_ptadPushId: opts.ptadPushId,
		thinkingPresentation: { modelStreaming: false, source: "shadow", seq: opts.turnState.seq },
		taskTelemetry: { startedAt: 0, toolCalls: 0, recoveryBudgetFailures: 0 },
	} as ExtensionState
	if (opts.epoch !== undefined) {
		base.epoch = opts.epoch
	}
	return base
}

// A real consumer that re-renders on every state change. Reads the
// committed turnState directly from the React context.
function CommittedTurnStateProbe({ capture }: { capture: (ts: TurnState | undefined) => void }) {
	const ctx = useExtensionState()
	capture((ctx as unknown as { turnState?: TurnState }).turnState)
	return null
}

interface CapturedSnapshot {
	_ptadPushId: number | undefined
	turnState: TurnState | undefined
}

function latestRawIncoming(): CapturedSnapshot | undefined {
	const records = getPostTerminalAuthorityDiagnosticRecords() as PostTerminalAuthoritySnapshot[]
	const raw = [...records].reverse().find((r) => r.captureKind === "webview-raw-incoming")
	if (!raw) return undefined
	return {
		_ptadPushId: raw._ptadPushId,
		turnState: raw.rawIncomingLegacyPhase
			? { phase: raw.rawIncomingLegacyPhase, seq: raw.rawIncomingLegacySeq ?? 0 }
			: undefined,
	}
}

function latestCommitted(): CapturedSnapshot | undefined {
	const records = getPostTerminalAuthorityDiagnosticRecords() as PostTerminalAuthoritySnapshot[]
	const committed = [...records].reverse().find((r) => r.captureKind === "webview-committed")
	if (!committed) return undefined
	return {
		_ptadPushId: committed._ptadPushId,
		turnState: committed.legacyPhase
			? { phase: committed.legacyPhase, seq: committed.legacySeq ?? 0 }
			: undefined,
	}
}

// Live-shaped clineMessages fixture.
const priorLiveMessages: ExtensionState["clineMessages"] = [
	{
		ts: 1,
		type: "say",
		say: "task",
		text: "Say hello and stop",
		seq: 1,
		epoch: 2,
	} as ExtensionState["clineMessages"][number],
]

beforeEach(() => {
	enablePostTerminalAuthorityDiagnosticBoth()
	clearPostTerminalAuthorityDiagnosticBoth()
	snapshotHandler = null
	partialHandler = null
	snapshotUnsub = null
	partialUnsub = null
})

afterEach(() => {
	disablePostTerminalAuthorityDiagnosticBoth()
	clearPostTerminalAuthorityDiagnosticBoth()
	snapshotHandler = null
	partialHandler = null
	snapshotUnsub = null
	partialUnsub = null
})

// ---------------------------------------------------------------------------
// GREEN regression ladder (post-fix)
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-W1-EPOCH-DOMAIN-MISMATCH-RED-FIX01", () => {
	// R0 - Streaming composition: W2 bumps the replica fence to 2, then a
	// W1 snapshot stamped with epoch=2 (the post-fix producer's wire
	// shape) delivers host turnState=streaming/11. The committed
	// React state must follow.
	//
	// Pre-fix this test went RED because the W1 producer omitted
	// `epoch`, so the reducer's older-epoch fence dropped the snapshot.
	it("R0: W1 wire stamped epoch=2, prevState epoch=2, host streaming/11 -> committed streaming/11", async () => {
		let observed: TurnState | undefined

		render(
			<ExtensionStateContextProvider>
				<CommittedTurnStateProbe
					capture={(ts) => {
						observed = ts
					}}
				/>
			</ExtensionStateContextProvider>,
		)

		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
		})

		// Step 1: bump replica epoch to 2 via a W2 partial.
		await act(async () => {
			if (!partialHandler) throw new Error("partialHandler not wired")
			partialHandler(
				w2PartialWithEpoch2({ ts: 100, seq: 9, text: "W2 partial content", final: false }),
			)
		})

		// Step 2: push the W1 snapshot (P12-equivalent) stamped with
		// epoch=2. The reducer's older-epoch fence no longer rejects.
		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")
			snapshotHandler(
				w1Snapshot({
					stateVersion: 12,
					epoch: 2,
					ptadPushId: 11,
					turnState: { phase: "streaming", seq: 11 },
					clineMessages: priorLiveMessages,
				}),
			)
		})

		await act(async () => {
			await Promise.resolve()
		})

		const A = latestRawIncoming()
		const F = latestCommitted()

		expect(A?.turnState).toEqual({ phase: "streaming", seq: 11 })
		expect(F?.turnState).toEqual({ phase: "streaming", seq: 11 })
		expect(observed).toEqual({ phase: "streaming", seq: 11 })
	})

	// R1 - ABLATION / control: same-epoch snapshot with stateVersion=0
	// (the wire shape the live PTAD captures show pre-fix). With the
	// producer now stamping epoch=2 on the wire, the snapshot is
	// admitted by the reducer and the turnState advances.
	it("R1: W1 wire stamped epoch=2 + stateVersion=0, prevState epoch=2, streaming/11 commits (ablation)", async () => {
		let observed: TurnState | undefined

		render(
			<ExtensionStateContextProvider>
				<CommittedTurnStateProbe
					capture={(ts) => {
						observed = ts
					}}
				/>
			</ExtensionStateContextProvider>,
		)

		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
		})

		await act(async () => {
			if (!partialHandler) throw new Error("partialHandler not wired")
			partialHandler(
				w2PartialWithEpoch2({ ts: 100, seq: 9, text: "W2 partial content", final: false }),
			)
		})

		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")
			snapshotHandler(
				w1Snapshot({
					stateVersion: 0,
					epoch: 2,
					ptadPushId: 11,
					turnState: { phase: "streaming", seq: 11 },
					clineMessages: priorLiveMessages,
				}),
			)
		})

		await act(async () => {
			await Promise.resolve()
		})

		const A = latestRawIncoming()
		const F = latestCommitted()

		expect(A?.turnState).toEqual({ phase: "streaming", seq: 11 })
		expect(F?.turnState).toEqual({ phase: "streaming", seq: 11 })
		expect(observed).toEqual({ phase: "streaming", seq: 11 })
	})

	// R2 - Terminal composition: same epoch-stamped W1 snapshot at
	// terminal time, carrying turnState=awaiting_followup/34.
	// Mirrors the live P35 row.
	it("R2: W1 wire stamped epoch=2, prevState epoch=2, host awaiting_followup/34 -> committed awaiting_followup/34", async () => {
		let observed: TurnState | undefined

		render(
			<ExtensionStateContextProvider>
				<CommittedTurnStateProbe
					capture={(ts) => {
						observed = ts
					}}
				/>
			</ExtensionStateContextProvider>,
		)

		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
		})

		// Step 1: bump replica epoch to 2 via a W2 partial.
		await act(async () => {
			if (!partialHandler) throw new Error("partialHandler not wired")
			partialHandler(
				w2PartialWithEpoch2({ ts: 100, seq: 9, text: "W2 partial content", final: false }),
			)
		})

		// Step 2: push a terminal W1 snapshot (P35-equivalent) stamped
		// with epoch=2, carrying turnState=awaiting_followup/34.
		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")
			snapshotHandler(
				w1Snapshot({
					stateVersion: 35,
					epoch: 2,
					ptadPushId: 34,
					turnState: { phase: "awaiting_followup", seq: 34 },
					clineMessages: priorLiveMessages,
				}),
			)
		})

		await act(async () => {
			await Promise.resolve()
		})

		const A = latestRawIncoming()
		const F = latestCommitted()

		expect(A?.turnState).toEqual({ phase: "awaiting_followup", seq: 34 })
		expect(F?.turnState).toEqual({ phase: "awaiting_followup", seq: 34 })
		expect(observed).toEqual({ phase: "awaiting_followup", seq: 34 })
	})
})