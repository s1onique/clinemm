/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP04-PURE-UPDATER-EVIDENCE
 *
 * Production-shaped composition replay, FIXUP04 vocabulary.
 *
 * After FIXUP04 removed the intermediate `webview-reducer-output`
 * capture kind, the diagnostic captures only two webview-side
 * boundaries:
 *   - webview-raw-incoming : wire-side arrival (per push)
 *   - webview-committed    : React-committed state (per commit)
 *
 * This test drives the canonical E1-E9 sequence through the
 * production ExtensionStateContext (with awaits between pushes
 * so each push gets its own React commit), and asserts:
 *   1. raw captures = 9 (one per push)
 *   2. committed captures ≥ 1 and ≤ 9 (one per React commit;
 *      the last one carries _ptadPushId = 9)
 *   3. raw capture for each pushId carries the wire-side raw
 *      turnState (rawIncomingLegacyPhase / rawIncomingLegacySeq)
 *   4. committed capture for the last pushId carries the
 *      seq-gated value (appliedLegacySeq from React-committed state)
 */

import type { ExtensionState, TurnState } from "@shared/ExtensionMessage"
import type { PostTerminalAuthoritySnapshot } from "@shared/post-terminal-authority-diagnostic"
import {
	clearPostTerminalAuthorityDiagnosticBoth,
	disablePostTerminalAuthorityDiagnosticBoth,
	enablePostTerminalAuthorityDiagnosticBoth,
	getPostTerminalAuthorityDiagnosticRecords,
} from "@shared/post-terminal-authority-diagnostic"
import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ExtensionStateContextProvider } from "@/context/ExtensionStateContext"

let pushHandler: ((stateData: ExtensionState) => void) | null = null
let unsubscribeFn: (() => void) | null = null

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

interface PushSpec {
	readonly label: string
	readonly pushId: number
	readonly turnState: TurnState
}

const PUSHES: readonly PushSpec[] = [
	{ label: "E1", pushId: 1, turnState: { phase: "streaming", seq: 3, anchorTs: 1 } },
	{ label: "E2", pushId: 2, turnState: { phase: "streaming", seq: 5, anchorTs: 1 } },
	{ label: "E3", pushId: 3, turnState: { phase: "streaming", seq: 7, anchorTs: 1 } },
	{ label: "E4", pushId: 4, turnState: { phase: "streaming", seq: 11, anchorTs: 1 } },
	{ label: "E5", pushId: 5, turnState: { phase: "awaiting_followup", seq: 15, anchorTs: 1 } },
	{ label: "E6", pushId: 6, turnState: { phase: "idle", seq: 2, anchorTs: 1 } },
	{ label: "E7", pushId: 7, turnState: { phase: "idle", seq: 2, anchorTs: 1 } },
	{ label: "E8", pushId: 8, turnState: { phase: "idle", seq: 2, anchorTs: 1 } },
	{ label: "E9", pushId: 9, turnState: { phase: "idle", seq: 2, anchorTs: 1 } },
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
		thinkingPresentation: { modelStreaming: false, source: "shadow", seq: spec.turnState.seq },
		taskTelemetry: { startedAt: 0, toolCalls: 0, recoveryBudgetFailures: 0 },
	} as ExtensionState
}

beforeEach(() => {
	enablePostTerminalAuthorityDiagnosticBoth()
	clearPostTerminalAuthorityDiagnosticBoth()
	pushHandler = null
	unsubscribeFn = null
})

afterEach(() => {
	disablePostTerminalAuthorityDiagnosticBoth()
	clearPostTerminalAuthorityDiagnosticBoth()
})

describe("C2-CORRECTION02-FIXUP04 production composition replay", () => {
	it("PR1: E1-E9 sequence produces one raw capture on each _ptadPushId (FIXUP04 vocab)", async () => {
		const result = render(
			<ExtensionStateContextProvider>
				<></>
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
		expect(raws.length).toBe(PUSHES.length)

		// Pair by push ID.
		const rawIds = new Set(raws.map((r) => r._ptadPushId))
		expect(rawIds).toEqual(new Set(PUSHES.map((p) => p.pushId)))

		result.unmount()
	})

	it("PR2: terminal push E5 raw capture carries awaiting_followup / seq 15", async () => {
		const result = render(
			<ExtensionStateContextProvider>
				<></>
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

		for (const spec of specs) {
			const raw = raws.find((r) => r._ptadPushId === spec.pushId)
			expect(raw, `raw capture missing for ${spec.label}`).toBeDefined()
			// The raw capture must record the exact seq/phase sent on the wire.
			expect(raw?.rawIncomingLegacySeq).toBe(spec.turnState.seq)
			expect(raw?.rawIncomingLegacyPhase).toBe(spec.turnState.phase)
		}

		result.unmount()
	})

	it("PR3: committed capture carries the seq-gated awaiting_followup/seq 15 across E5 (after seq-gating reducer)", async () => {
		const result = render(
			<ExtensionStateContextProvider>
				<></>
			</ExtensionStateContextProvider>,
		)

		// Drive the FULL E1-E9 sequence so E6 (idle/seq 2) is included
		// after E5 (awaiting_followup/seq 15). The seq-gate keeps the
		// replica's turnState at awaiting_followup/15 even after E6.
		for (const spec of PUSHES) {
			const stateData = buildStateData(spec)
			await act(async () => {
				if (!pushHandler) throw new Error("pushHandler not wired")
				pushHandler(stateData)
				await Promise.resolve()
			})
		}

		const records = getPostTerminalAuthorityDiagnosticRecords("webview") as readonly PostTerminalAuthoritySnapshot[]
		const committed = records.filter((r) => r.captureKind === "webview-committed")

		// The LAST committed capture (post-E9 commit) carries the
		// seq-gated value: appliedLegacySeq = 15, appliedLegacyPhase =
		// awaiting_followup. The seq-gate prevented the E6..E9 idle/seq 2
		// from reverting E5's awaiting_followup/seq 15.
		const lastCommitted = committed[committed.length - 1]
		expect(lastCommitted._ptadPushId).toBe(9)
		expect(lastCommitted.appliedLegacyPhase).toBe("awaiting_followup")
		expect(lastCommitted.appliedLegacySeq).toBe(15)

		// The committed captures do NOT include `webview-reducer-output`;
		// FIXUP04 removed that capture kind entirely.
		const reducerOutputs = records.filter((r) => r.captureKind === "webview-reducer-output")
		expect(reducerOutputs.length).toBe(0)

		result.unmount()
	})

	it("PR4: E6 straggler raw captures carry the wire-side idle/seq 2", async () => {
		const result = render(
			<ExtensionStateContextProvider>
				<></>
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

		// E6..E9 raw = idle/seq 2 (wire-side).
		for (let i = 5; i < PUSHES.length; i++) {
			const raw = raws.find((r) => r._ptadPushId === PUSHES[i].pushId)
			expect(raw?.rawIncomingLegacyPhase).toBe("idle")
			expect(raw?.rawIncomingLegacySeq).toBe(2)
		}

		result.unmount()
	})
})
