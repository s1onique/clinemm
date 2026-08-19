/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP03-STATE-QUEUE-CONSERVATION
 *
 * Production-shaped composition replay wrapped in <React.StrictMode>.
 *
 * R1 from the E7.1 architecture review: before C2-CORRECTION02-FIXUP01,
 * `recordPostTerminalAuthoritySnapshot(...)` was called inside the
 * `setState((prevState) => { ... })` updater. React requires updater
 * functions to be pure; under Strict Mode the updater is invoked twice
 * and one result is discarded. That made the
 * `webview-raw-incoming(P) = exactly 1` and
 * `webview-reducer-output(P) = exactly 1` cardinality contract un-provable
 * under Strict Mode.
 *
 * After FIXUP01 + FIXUP02 + FIXUP03:
 *   - the RAW capture lives at the inbound `onResponse` boundary
 *     (BEFORE `setState` is called), so it is OUTSIDE the updater.
 *   - the REDUCER-OUTPUT capture lives in `pendingAppliedByPushRef.current`,
 *     which is populated INSIDE the functional updater (FIXUP03 hoisted
 *     back to React-authoritative prevState; R6). The stash is
 *     idempotent under Strict Mode retries because the same pushId
 *     is written with the same value twice.
 *   - the post-commit drain effect empties the queue and emits one
 *     `webview-reducer-output` capture per pushId.
 *
 * This test mounts the actual `ExtensionStateContext` inside
 * `<React.StrictMode>` so React double-invokes:
 *   - the effect initialization (Strict Mode mounts twice on dev);
 *   - the `setState` updater (Strict Mode invokes the updater twice
 *     and discards one result);
 * and proves: for each `pushId` in the E1-E9 sequence, the
 * `webview-raw-incoming` and `webview-reducer-output` capture rings hold
 * exactly ONE record each.
 *
 * Capture kind renamed from `webview-replica` (FIXUP01/FIXUP02) to
 * `webview-reducer-output` (FIXUP03) per the R7 vocabulary freeze.
 */

import type { ExtensionState, TurnState } from "@shared/ExtensionMessage"
import {
	clearPostTerminalAuthorityDiagnosticBoth,
	disablePostTerminalAuthorityDiagnosticBoth,
	enablePostTerminalAuthorityDiagnosticBoth,
	getPostTerminalAuthorityDiagnosticRecords,
} from "@shared/post-terminal-authority-diagnostic"
import { act, render } from "@testing-library/react"
import { StrictMode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ExtensionStateContextProvider } from "@/context/ExtensionStateContext"

// ---------------------------------------------------------------------------
// Mock StateServiceClient.subscribeToState exactly like the
// c2-correction02-composition test does, but no Observer is needed.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// E1-E9 sequence (subset from bc2c794be). Six pushes are sufficient to
// prove the cardinality contract under Strict Mode.
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

describe("C2-CORRECTION02-FIXUP01 — React StrictMode cardinality", () => {
	it("SM1: each pushId appears exactly once in the raw ring AND once in the applied ring (Strict Mode mount + double-invoke updater)", async () => {
		const result = render(
			<StrictMode>
				<ExtensionStateContextProvider />
			</StrictMode>,
		)

		// Drive the E1-E6 sequence through the live onResponse handler.
		for (const spec of PUSHES) {
			const stateData = buildStateData(spec)
			await act(async () => {
				if (!pushHandler) {
					throw new Error("pushHandler not wired")
				}
				pushHandler(stateData)
				await Promise.resolve()
				await Promise.resolve()
			})
		}

		const records = getPostTerminalAuthorityDiagnosticRecords("webview") as readonly unknown[]
		const raws = records.filter(
			(r): r is { _ptadPushId?: number } =>
				typeof r === "object" && r !== null && (r as { captureKind?: string }).captureKind === "webview-raw-incoming",
		)
		const applied = records.filter(
			(r): r is { _ptadPushId?: number } =>
				typeof r === "object" && r !== null && (r as { captureKind?: string }).captureKind === "webview-reducer-output",
		)

		// Exactly N raw records for N pushes (Strict Mode mounts the
		// effect twice on development mount, but the inbound `onResponse`
		// path is NOT React-controlled; the RAW emit happens once per
		// gRPC delivery).
		expect(raws.length).toBe(PUSHES.length)

		// Exactly N applied records for N pushes. This is the proof that
		// the React-Strict-Mode-resilient architecture holds.
		expect(applied.length).toBe(PUSHES.length)

		// Each pushId produces exactly one raw record:
		for (const spec of PUSHES) {
			const matchingRaws = raws.filter((r) => r._ptadPushId === spec.pushId)
			expect(matchingRaws.length).toBe(1)
			const matchingApplied = applied.filter((r) => r._ptadPushId === spec.pushId)
			expect(matchingApplied.length).toBe(1)
		}

		result.unmount()
	})

	it("SM2: the inbound handler never double-emits raw under Strict Mode (RBAC regression check)", async () => {
		// Drive a SINGLE push and verify exactly one raw record was emitted
		// regardless of how many times React Strict Mode invokes the
		// updater. The inbound path is NOT React-controlled.
		const result = render(
			<StrictMode>
				<ExtensionStateContextProvider />
			</StrictMode>,
		)

		const stateData = buildStateData(PUSHES[0])
		await act(async () => {
			if (!pushHandler) throw new Error("pushHandler not wired")
			pushHandler(stateData)
			await Promise.resolve()
			await Promise.resolve()
		})

		const records = getPostTerminalAuthorityDiagnosticRecords("webview") as readonly unknown[]
		const raws = records.filter(
			(r): r is { _ptadPushId?: number } =>
				typeof r === "object" && r !== null && (r as { captureKind?: string }).captureKind === "webview-raw-incoming",
		)
		// Strict Mode may mount the provider twice on dev, so each
		// provider-mount would attach its OWN `onResponse` handler and
		// would receive the SAME push through its OWN subscribe call.
		// But this test mounts StrictMode around a SINGLE
		// ExtensionStateContextProvider, so onResponse fires once.
		expect(raws.length).toBe(1)
		expect(raws[0]._ptadPushId).toBe(PUSHES[0].pushId)

		result.unmount()
	})
})
