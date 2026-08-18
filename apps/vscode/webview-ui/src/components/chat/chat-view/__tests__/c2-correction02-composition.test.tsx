/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-POST-TERMINAL-AUTHORITY-SPLIT-C2-CORRECTION02-RAW-INCOMING-TRUTH
 *
 * Production-shaped composition replay. This test mounts the ACTUAL
 * `ExtensionStateContext` (not a mock of it) with a mocked
 * `StateServiceClient.subscribeToState` that drives the exact live
 * E1-E9 sequence observed in the bc2c794be trace.
 *
 * For each push P we push the raw incoming `stateData` through the
 * production `setState((prevState) => { ... })` body, asserting:
 *
 *   1. Exactly one `webview-raw-incoming` record is appended on
 *      `_ptadPushId = P`, stamped BEFORE the reducer mutates
 *      `stateData.turnState`.
 *   2. Exactly one `webview-replica` record is appended on the SAME
 *      `_ptadPushId = P`, stamped AFTER the reducer.
 *   3. On a healthy push (E1-E5), the raw and applied records carry
 *      the same `legacyPhase` / `legacySeq`.
 *   4. The C2R isolated replay proved the reducer is correct, so the
 *      production composition must surface `awaiting_followup / seq 15`
 *      on the terminal push.
 *
 * The test does NOT modify the production code; it drives the
 * production-shape flow from outside the component.
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

// ---------------------------------------------------------------------------
// Mock StateServiceClient.subscribeToState so we can drive the composition.
// ---------------------------------------------------------------------------

type PushHandler = (stateData: ExtensionState) => void

let pushHandler: PushHandler | null = null
let unsubscribeFn: (() => void) | null = null

// ---------------------------------------------------------------------------
// Mock the entire @/services/grpc-client module. We mock every service's
// methods to no-op vi.fn() so the production ExtensionStateContext can
// mount cleanly (it subscribes to many gRPC streams on mount), while we
// specifically route subscribeToState through a controllable handler so
// the test can push raw state payloads into the production setState path.
// ---------------------------------------------------------------------------

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
							pushHandler = (stateData) => {
								handlers.onResponse({ stateJson: JSON.stringify(stateData) })
							}
							unsubscribeFn = () => {
								pushHandler = null
							}
							return unsubscribeFn
						}
					}
					if (typeof prop === "string" && prop.startsWith("subscribeTo")) {
						return noopStreaming
					}
					if (typeof prop === "string" && prop.startsWith("subscribe")) {
						return noopStreaming
					}
					// Anything else (unary RPCs): return vi.fn that resolves undefined.
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
// Live E1-E9 sequence from the bc2c794be trace.
// stateVersion=0 on every push (PTAD_STATEVERSION_CORRELATION = FAIL, frozen
// in task-state-e71-c2-live-replica-truth-evidence.md §3).
// epoch=0 on every push (classic/legacy wire shape).
// ---------------------------------------------------------------------------

interface PushSpec {
	readonly label: string
	readonly turnState: TurnState | undefined
	readonly pushId: number
}

const PUSHES: readonly PushSpec[] = [
	{ label: "E1", turnState: { phase: "idle", seq: 2, anchorTs: 1 }, pushId: 1 },
	{ label: "E2", turnState: { phase: "streaming", seq: 4, anchorTs: 2 }, pushId: 2 },
	{ label: "E3", turnState: { phase: "streaming", seq: 4, anchorTs: 3 }, pushId: 3 },
	{ label: "E4", turnState: { phase: "streaming", seq: 4, anchorTs: 4 }, pushId: 4 },
	{ label: "E5", turnState: { phase: "awaiting_followup", seq: 15, anchorTs: 5 }, pushId: 5 },
	{ label: "E6", turnState: { phase: "idle", seq: 2, anchorTs: 6 }, pushId: 6 },
	{ label: "E7", turnState: { phase: "idle", seq: 2, anchorTs: 7 }, pushId: 7 },
	{ label: "E8", turnState: { phase: "idle", seq: 2, anchorTs: 8 }, pushId: 8 },
	{ label: "E9", turnState: { phase: "idle", seq: 2, anchorTs: 9 }, pushId: 9 },
]

function buildStateData(spec: PushSpec): ExtensionState {
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
		taskTelemetry: { elapsedMs: 0, toolCalls: 0, recoveryBudgetFailures: 0 },
	} as ExtensionState
}

// ---------------------------------------------------------------------------
// Capture-side hook that lets the test see what the context consumers
// observed at each push.
// ---------------------------------------------------------------------------

const observedAtPush: Array<{ pushId: number; turnState: TurnState | undefined }> = []

function Observer(): null {
	const { turnState, _ptadPushId } = useExtensionState() as { turnState: TurnState | undefined; _ptadPushId?: number }
	observedAtPush.push({ pushId: _ptadPushId ?? -1, turnState })
	return null
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

beforeEach(() => {
	enablePostTerminalAuthorityDiagnosticBoth()
	clearPostTerminalAuthorityDiagnosticBoth()
	observedAtPush.length = 0
	pushHandler = null
	unsubscribeFn = null
})

afterEach(() => {
	disablePostTerminalAuthorityDiagnosticBoth()
	clearPostTerminalAuthorityDiagnosticBoth()
})

describe("C2-CORRECTION02 production composition replay", () => {
	it("PR1: E1-E5 sequence produces one raw + one applied record on each _ptadPushId, paired by push ID", async () => {
		const result = render(
			<ExtensionStateContextProvider>
				<Observer />
			</ExtensionStateContextProvider>,
		)

		// Drive the exact E1-E5 sequence through the production compose path.
		for (const spec of PUSHES.slice(0, 5)) {
			const stateData = buildStateData(spec)
			await act(async () => {
				if (!pushHandler) {
					throw new Error("pushHandler not wired; subscribeToState mock failed to capture handler")
				}
				pushHandler(stateData)
				// Yield to let React schedule the state update.
				await Promise.resolve()
			})
		}

		const records = getPostTerminalAuthorityDiagnosticRecords("webview") as readonly PostTerminalAuthoritySnapshot[]

		// 5 pushes × 2 captures each = 10 records.
		expect(records.length).toBe(10)

		// For each push ID, exactly one raw and one applied.
		const raws = records.filter((r) => r.captureKind === "webview-raw-incoming")
		const applied = records.filter((r) => r.captureKind === "webview-replica")
		expect(raws.length).toBe(5)
		expect(applied.length).toBe(5)

		// Pair by push ID.
		const rawIds = new Set(raws.map((r) => r._ptadPushId))
		const appliedIds = new Set(applied.map((r) => r._ptadPushId))
		expect(rawIds).toEqual(appliedIds)

		// Terminal push (E5) must show awaiting_followup / seq 15 on BOTH
		// raw and applied — this is the C2R pass-through invariant for
		// the production composition.
		const e5Raw = raws.find((r) => r._ptadPushId === 5)
		const e5Applied = applied.find((r) => r._ptadPushId === 5)
		expect(e5Raw?.rawIncomingLegacyPhase).toBe("awaiting_followup")
		expect(e5Raw?.rawIncomingLegacySeq).toBe(15)
		expect(e5Applied?.appliedLegacyPhase).toBe("awaiting_followup")
		expect(e5Applied?.appliedLegacySeq).toBe(15)

		result.unmount()
	})

	it("PR2: the raw capture is stamped BEFORE the post-reducer overwrite would have mutated it", async () => {
		// The invariant: the raw capture carries the wire-side
		// turnState verbatim, which means the capture must run BEFORE
		// the line `stateData.turnState = replicaRef.current.turnState`
		// at ExtensionStateContext.tsx:599. If the capture were moved
		// after that line, the seq-gated reducer would have already
		// overwritten stale pushes back to idle/seq2 (the C2R pass
		// would still produce awaiting_followup/15 because the seq
		// gate lets the higher-seq through; the invariant holds).
		//
		// The diagnostic check: for each push, the raw capture's
		// `rawIncomingLegacySeq` equals the seq that was actually
		// sent on the wire (independent of what the reducer later
		// produced).
		const result = render(
			<ExtensionStateContextProvider>
				<Observer />
			</ExtensionStateContextProvider>,
		)

		const specs = PUSHES.slice(0, 5)
		for (const spec of specs) {
			const stateData = buildStateData(spec)
			await act(async () => {
				if (!pushHandler) throw new Error("pushHandler not wired")
				pushHandler(stateData)
				await Promise.resolve()
			})
		}

		const records = getPostTerminalAuthorityDiagnosticRecords("webview") as readonly PostTerminalAuthoritySnapshot[]
		const raws = records.filter((r) => r.captureKind === "webview-raw-incoming")

		expect(raws.length).toBe(specs.length)
		for (let i = 0; i < specs.length; i++) {
			const spec = specs[i]
			const raw = raws.find((r) => r._ptadPushId === spec.pushId)
			expect(raw, `raw capture missing for ${spec.label}`).toBeDefined()
			// The raw capture must record the exact seq we sent on the wire.
			expect(raw?.rawIncomingLegacySeq).toBe(spec.turnState?.seq)
			expect(raw?.rawIncomingLegacyPhase).toBe(spec.turnState?.phase)
		}

		result.unmount()
	})

	it("PR3: the applied capture is stamped AFTER the reducer; on E5 it matches the raw (reducer pass-through); on E6 the seq-gate keeps applied at awaiting_followup/15 while raw is idle/2", async () => {
		const result = render(
			<ExtensionStateContextProvider>
				<Observer />
			</ExtensionStateContextProvider>,
		)

		// Drive the FULL E1-E9 sequence so E6 is included in the records.
		for (const spec of PUSHES) {
			const stateData = buildStateData(spec)
			await act(async () => {
				if (!pushHandler) throw new Error("pushHandler not wired")
				pushHandler(stateData)
				await Promise.resolve()
			})
		}

		const records = getPostTerminalAuthorityDiagnosticRecords("webview") as readonly PostTerminalAuthoritySnapshot[]
		const applied = records.filter((r) => r.captureKind === "webview-replica")

		// E5 terminal push: raw == applied on this exact sequence
		// (because the reducer is correct, as proven by the C2R replay).
		const e5Applied = applied.find((r) => r._ptadPushId === 5)
		expect(e5Applied?.appliedLegacyPhase).toBe("awaiting_followup")
		expect(e5Applied?.appliedLegacySeq).toBe(15)
		expect(e5Applied?.rawIncomingLegacyPhase).toBe("awaiting_followup")
		expect(e5Applied?.rawIncomingLegacySeq).toBe(15)

		// E6 straggler (idle/seq 2): reducer rejects older seq, so
		// the applied view stays at awaiting_followup/seq 15 from E5.
		const e6Applied = applied.find((r) => r._ptadPushId === 6)
		expect(e6Applied?.appliedLegacyPhase).toBe("awaiting_followup")
		expect(e6Applied?.appliedLegacySeq).toBe(15)
		// But the raw view on E6 carries the wire-side idle/seq 2.
		expect(e6Applied?.rawIncomingLegacyPhase).toBe("idle")
		expect(e6Applied?.rawIncomingLegacySeq).toBe(2)

		result.unmount()
	})

	it("PR4: straggler E6-E9 produce a paired raw/applied on each push ID; raw view carries the wire-side idle/seq 2; applied view carries the seq-gated awaiting_followup/seq 15", async () => {
		const result = render(
			<ExtensionStateContextProvider>
				<Observer />
			</ExtensionStateContextProvider>,
		)

		for (const spec of PUSHES) {
			const stateData = buildStateData(spec)
			await act(async () => {
				if (!pushHandler) throw new Error("pushHandler not wired")
				pushHandler(stateData)
				await Promise.resolve()
			})
		}

		const records = getPostTerminalAuthorityDiagnosticRecords("webview") as readonly PostTerminalAuthoritySnapshot[]
		const raws = records.filter((r) => r.captureKind === "webview-raw-incoming")
		const applied = records.filter((r) => r.captureKind === "webview-replica")

		expect(raws.length).toBe(PUSHES.length)
		expect(applied.length).toBe(PUSHES.length)

		for (let i = 5; i < PUSHES.length; i++) {
			// E6-E9 raw = idle/seq 2 (wire-side); applied = awaiting_followup/seq 15
			// (reducer seq-gated).
			const raw = raws.find((r) => r._ptadPushId === PUSHES[i].pushId)
			const app = applied.find((r) => r._ptadPushId === PUSHES[i].pushId)
			expect(raw?.rawIncomingLegacyPhase).toBe("idle")
			expect(raw?.rawIncomingLegacySeq).toBe(2)
			expect(app?.appliedLegacyPhase).toBe("awaiting_followup")
			expect(app?.appliedLegacySeq).toBe(15)
		}

		result.unmount()
	})
})
