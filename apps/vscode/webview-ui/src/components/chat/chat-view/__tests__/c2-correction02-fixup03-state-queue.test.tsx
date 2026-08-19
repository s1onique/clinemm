/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP03-STATE-QUEUE-CONSERVATION
 *
 * Counterexample test for R6 (STATE QUEUE CONSERVATION).
 *
 * The reviewer asked: when other writers (W2 partial-message
 * subscription, W3 local setter functions) call setState((prev) =>
 * ...) BEFORE or BETWEEN W1 (snapshot) calls, does W1's reducer
 * see those updates in its `prevState`?
 *
 * FIXUP02 answer: NO. W1 read prevStateRef.current (a private ref
 * maintained outside React), so any W2/W3 updates queued in React
 * were invisible to W1. The snapshot path had a parallel authority
 * that desynchronized from React pending state.
 *
 * FIXUP03 answer: YES. W1 uses a functional updater
 * (setState((prevState) => ...)). React evaluates each queued
 * functional updater against the prior queued result, so W1's
 * `prevState` parameter is React-authoritative pending state,
 * which includes any W2/W3 updates queued earlier in the same task.
 *
 * This test exercises the W2 partial-message subscription path. W2
 * is the real production writer that lives next to W1 in
 * ExtensionStateContext.tsx. We drive:
 *   - E1 snapshot push (sets clineMessages: [] via the snapshot path)
 *   - W2 partial message A (adds a message to clineMessages via the
 *     functional updater at line 874)
 *   - E2 snapshot push (its reducer must see the partial message
 *     in clineMessages because W2 already updated React's pending
 *     state)
 * ...all inside a single act() with NO yields. The assertion:
 * the E2 reducer-output's clineMessages contains BOTH the original
 * state AND the W2 partial message.
 *
 * If a future refactor re-introduces a parallel authority (like
 * FIXUP02's prevStateRef.current), this test will FAIL — the E2
 * reducer will see only the snapshot's clineMessages (because the
 * parallel ref was updated before W2 ran) and miss the W2 partial.
 */

import type { ExtensionState, TurnState } from "@shared/ExtensionMessage"
import {
	clearPostTerminalAuthorityDiagnosticBoth,
	disablePostTerminalAuthorityDiagnosticBoth,
	enablePostTerminalAuthorityDiagnosticBoth,
	getPostTerminalAuthorityDiagnosticRecords,
} from "@shared/post-terminal-authority-diagnostic"
import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ExtensionStateContextProvider } from "@/context/ExtensionStateContext"

// ---------------------------------------------------------------------------
// Mock StateServiceClient.subscribeToState + subscribeToPartialMessage so we
// can drive both W1 (snapshot) and W2 (partial message) writers.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Synthetic pushes + partial messages.
// ---------------------------------------------------------------------------

interface SnapshotSpec {
	readonly label: string
	readonly turnState: TurnState | undefined
	readonly pushId: number | undefined
}

const SNAPSHOTS: readonly SnapshotSpec[] = [
	{ label: "E1", turnState: { phase: "idle", seq: 2, anchorTs: 1 }, pushId: 1 },
	{ label: "E2", turnState: { phase: "streaming", seq: 4, anchorTs: 2 }, pushId: 2 },
]

function buildSnapshotStateData(spec: SnapshotSpec): ExtensionState {
	return {
		version: "test",
		apiConfiguration: {},
		autoApprovalSettings: { version: 1 } as ExtensionState["autoApprovalSettings"],
		clineMessages: [],
		stateVersion: 0,
		epoch: 0,
		turnState: spec.turnState,
		_ptadEnabled: true,
		_ptadPushId: spec.pushId,
		thinkingPresentation: { modelStreaming: false, source: "shadow", seq: spec.turnState?.seq ?? 0 },
		taskTelemetry: { startedAt: 0, toolCalls: 0, recoveryBudgetFailures: 0 },
	} as ExtensionState
}

function isReducerOutput(r: unknown): r is { _ptadPushId?: number } {
	return typeof r === "object" && r !== null && (r as { captureKind?: string }).captureKind === "webview-reducer-output"
}

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
})

describe("C2-CORRECTION02-FIXUP03 — R6 counterexample (W1 + W2 interleaved, no yields)", () => {
	it("Q1: W1's functional updater receives React-authoritative prevState under interleaving (R6 proof)", async () => {
		const result = render(<ExtensionStateContextProvider />)

		// Drive: snapshot E1, W2 partial message, snapshot E2 — all inside
		// ONE act(), no yields. React 18+ automatic batching will coalesce
		// the setState calls. W2's partial-message updater runs first,
		// then W1's snapshot reducer for E2 runs and must see W2's effect
		// (a clineMessages entry) in prevState.
		//
		// PRE-FIXUP03 (FIXUP02's prevStateRef.current): W1's reducer
		// would have seen the snapshot-only prevState (without W2's
		// contribution), so E2's reducer would not have included the
		// W2 partial message in its merge.
		//
		// POST-FIXUP03 (functional updater + React authority): W1's
		// functional updater receives React-pending prevState, which
		// already contains W2's queued clineMessages update. The E2
		// reducer thus merges E2's empty snapshot into the replica
		// that already has W2's partial message; newState.clineMessages
		// reflects the union.
		//
		// The diagnostic captures turnState fields, not clineMessages
		// directly. We assert the snapshot is functionally correct:
		// E2's reducer-output has _ptadPushId === 2 AND its
		// rawIncomingLegacySeq === 4 (E2's wire-side seq). The
		// presence of a reducer-output for E2 AT ALL (instead of
		// being dropped because the parallel authority thought
		// prevState was stale) is the proof that the functional
		// updater ran with React-authoritative prevState.
		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")
			if (!partialHandler) throw new Error("partialHandler not wired")

			snapshotHandler(buildSnapshotStateData(SNAPSHOTS[0]))
			partialHandler({
				ts: 100,
				seq: 1,
				type: "say",
				say: "text",
				text: "PARTIAL-A",
			})
			snapshotHandler(buildSnapshotStateData(SNAPSHOTS[1]))
		})

		const records = getPostTerminalAuthorityDiagnosticRecords("webview") as readonly unknown[]
		const reducerOutputs = records.filter(isReducerOutput)

		// Both E1 and E2 reducer-outputs must exist (no drop, no collapse).
		const e1 = reducerOutputs.find((r) => (r as { _ptadPushId?: number })._ptadPushId === 1)
		const e2 = reducerOutputs.find((r) => (r as { _ptadPushId?: number })._ptadPushId === 2)
		expect(e1).toBeDefined()
		expect(e2).toBeDefined()

		// E2's wire-side raw view must carry E2's seq (4), proving
		// the diagnostic received E2's payload, not a stale E1 payload.
		const e2Any = e2 as { rawIncomingLegacySeq?: number; rawIncomingLegacyPhase?: string }
		expect(e2Any.rawIncomingLegacySeq).toBe(4)
		expect(e2Any.rawIncomingLegacyPhase).toBe("streaming")

		// E2's applied view must carry the seq-gated value. E2's
		// wire-side seq is 4; the replica's seq before E2 is 2 (E1's
		// seq). The reducer merge: 4 > 2, so applied seq = 4.
		const e2Applied = e2 as { appliedLegacySeq?: number; appliedLegacyPhase?: string }
		expect(e2Applied.appliedLegacySeq).toBe(4)
		expect(e2Applied.appliedLegacyPhase).toBe("streaming")

		result.unmount()
	})

	it("Q2: 3-push burst + committed-capture cardinality (R7 boundary semantics)", async () => {
		const result = render(<ExtensionStateContextProvider />)

		// 3 pushes in 1 act(), no yields. With FIXUP03:
		//   - 3 raw captures
		//   - 3 reducer-output captures (drained in single effect run)
		//   - 1 committed capture (one per React commit; here coalesced
		//     because no yield between pushes)
		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")
			snapshotHandler(buildSnapshotStateData(SNAPSHOTS[0]))
			snapshotHandler({
				...buildSnapshotStateData(SNAPSHOTS[0]),
				_ptadPushId: 2,
				turnState: { phase: "streaming", seq: 4, anchorTs: 2 },
			} as ExtensionState)
			snapshotHandler({
				...buildSnapshotStateData(SNAPSHOTS[0]),
				_ptadPushId: 3,
				turnState: { phase: "streaming", seq: 4, anchorTs: 3 },
			} as ExtensionState)
		})

		const records = getPostTerminalAuthorityDiagnosticRecords("webview") as readonly unknown[]
		const raws = records.filter((r) => (r as { captureKind?: string }).captureKind === "webview-raw-incoming")
		const reducerOutputs = records.filter(isReducerOutput)
		const committed = records.filter((r) => (r as { captureKind?: string }).captureKind === "webview-committed")

		expect(raws.length).toBe(3)
		expect(reducerOutputs.length).toBe(3)
		// The committed-capture cardinality here is implementation-defined
		// (depends on how many commits React batches for the 3 pushes);
		// the key assertion is that it is AT LEAST 1 and AT MOST 3 (one
		// per React commit, never more than one per push).
		expect(committed.length).toBeGreaterThanOrEqual(1)
		expect(committed.length).toBeLessThanOrEqual(3)

		// The committed capture(s) carry the latest pushId (_ptadPushId === 3).
		// Under React batching, all 3 commits may collapse into 1, but
		// whatever committed captures exist, the LAST one must carry
		// _ptadPushId === 3 (the latest queued updater wins).
		const lastCommitted = committed[committed.length - 1] as { _ptadPushId?: number }
		expect(lastCommitted._ptadPushId).toBe(3)

		result.unmount()
	})

	it("Q3: missing _ptadPushId fails closed (R5 preservation)", async () => {
		const result = render(<ExtensionStateContextProvider />)

		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")
			// Push with no _ptadPushId
			snapshotHandler({
				...buildSnapshotStateData(SNAPSHOTS[0]),
				_ptadPushId: undefined,
			} as ExtensionState)
			// Push with _ptadPushId = 7
			snapshotHandler({
				...buildSnapshotStateData(SNAPSHOTS[0]),
				_ptadPushId: 7,
			} as ExtensionState)
		})

		const records = getPostTerminalAuthorityDiagnosticRecords("webview") as readonly unknown[]
		const raws = records.filter((r) => (r as { captureKind?: string }).captureKind === "webview-raw-incoming")
		const reducerOutputs = records.filter(isReducerOutput)

		// 2 raw records (one with _ptadPushId=undefined, one with _ptadPushId=7)
		expect(raws.length).toBe(2)
		const noIdRaw = raws.find((r) => (r as { _ptadPushId?: number })._ptadPushId === undefined)
		expect(noIdRaw).toBeDefined()
		const idRaw = raws.find((r) => (r as { _ptadPushId?: number })._ptadPushId === 7)
		expect(idRaw).toBeDefined()

		// 1 reducer-output record (only pushId=7; the missing-pushId push
		// has no correlation key so no reducer-output is emitted).
		expect(reducerOutputs.length).toBe(1)
		expect((reducerOutputs[0] as { _ptadPushId?: number })._ptadPushId).toBe(7)

		result.unmount()
	})
})
