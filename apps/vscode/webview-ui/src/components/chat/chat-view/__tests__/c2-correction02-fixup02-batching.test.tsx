/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP03-STATE-QUEUE-CONSERVATION
 *
 * R4 + R5 proof tests, refreshed to the FIXUP03 capture vocabulary.
 * Drives the production ExtensionStateContext through burst deliveries
 * (multiple onResponse calls inside the same React task, with NO yield
 * between them) and verifies:
 *
 *   1. R4 (BATCHED CARDINALITY): each wire push produces exactly one
 *      `webview-raw-incoming` AND exactly one `webview-reducer-output`
 *      record, paired by `_ptadPushId`, even when React batches the
 *      corresponding setState calls into a single commit. The reducer
 *      runs INSIDE the functional updater (R6 — React-authoritative
 *      prevState) and stashes into `pendingAppliedByPushRef.current`,
 *      which the post-commit drain effect empties in arrival order.
 *
 *   2. R5 (FAIL-CLOSED MISSING PUSHID): when `_ptadPushId` is absent,
 *      the raw capture still emits (with `_ptadPushId = undefined`),
 *      but no reducer-output capture is emitted (no correlation key)
 *      and the pending map is NOT corrupted by overwriting a sentinel
 *      slot. After FIXUP03 the pending map is `pendingAppliedByPushRef`
 *      (NOT `pendingRawSnapshotsRef`, which R8 removed).
 *
 * The tests intentionally drive pushes WITHOUT `await Promise.resolve()`
 * between them — this is the exact regime that React 18+ automatic
 * batching triggers in production. Tests like
 * `c2-correction02-fixup01-strictmode.test.tsx` that yield between
 * pushes do NOT exercise this regime, so the batched-cardinality
 * proof lives here.
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
// Mock StateServiceClient.subscribeToState exactly like the prior composition
// tests, but the test driver NEVER yields between pushes.
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
// E1-E6 sequence (subset from bc2c794be).
// ---------------------------------------------------------------------------

interface PushSpec {
	readonly label: string
	readonly turnState: TurnState | undefined
	readonly pushId: number | undefined
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

function isRaw(r: unknown): r is { _ptadPushId?: number } {
	return typeof r === "object" && r !== null && (r as { captureKind?: string }).captureKind === "webview-raw-incoming"
}
function isApplied(r: unknown): r is { _ptadPushId?: number } {
	return typeof r === "object" && r !== null && (r as { captureKind?: string }).captureKind === "webview-reducer-output"
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

describe("C2-CORRECTION02-FIXUP02 — R4 burst/batching cardinality", () => {
	it("B1: three pushes inside one act (no yields) produce exactly 3 raw AND 3 applied, paired by _ptadPushId", async () => {
		const result = render(<ExtensionStateContextProvider />)

		// THREE pushes, NO await Promise.resolve() between them. React 18+
		// automatic batching will coalesce the three setState calls into a
		// single commit. The PRE-FIXUP02 architecture would collapse all
		// three applied captures into the last pushId only.
		await act(async () => {
			if (!pushHandler) throw new Error("pushHandler not wired")
			pushHandler(buildStateData(PUSHES[0]))
			pushHandler(buildStateData(PUSHES[1]))
			pushHandler(buildStateData(PUSHES[2]))
		})

		const records = getPostTerminalAuthorityDiagnosticRecords("webview") as readonly unknown[]
		const raws = records.filter(isRaw)
		const applied = records.filter(isApplied)

		// 3 raw records, each on its own pushId.
		expect(raws.length).toBe(3)
		const pushIds = raws.map((r) => r._ptadPushId).sort()
		expect(pushIds).toEqual([1, 2, 3])

		// 3 applied records — the proof of R4. PRE-FIXUP02 this would be 1
		// (only the last pushId in the batch) or 0 (if the effect didn't run).
		expect(applied.length).toBe(3)
		const appliedPushIds = applied.map((r) => r._ptadPushId).sort()
		expect(appliedPushIds).toEqual([1, 2, 3])

		// Each raw/applied pair is on the SAME pushId.
		for (const spec of PUSHES.slice(0, 3)) {
			const matchingRaw = raws.find((r) => r._ptadPushId === spec.pushId)
			const matchingApplied = applied.find((r) => r._ptadPushId === spec.pushId)
			expect(matchingRaw).toBeDefined()
			expect(matchingApplied).toBeDefined()
		}

		result.unmount()
	})

	it("B2: six pushes inside one act (no yields) produce exactly 6 raw AND 6 applied", async () => {
		const result = render(<ExtensionStateContextProvider />)

		await act(async () => {
			if (!pushHandler) throw new Error("pushHandler not wired")
			for (const spec of PUSHES) {
				pushHandler(buildStateData(spec))
			}
		})

		const records = getPostTerminalAuthorityDiagnosticRecords("webview") as readonly unknown[]
		const raws = records.filter(isRaw)
		const applied = records.filter(isApplied)

		expect(raws.length).toBe(PUSHES.length)
		expect(applied.length).toBe(PUSHES.length)

		const pushIds = raws.map((r) => r._ptadPushId).sort()
		expect(pushIds).toEqual(PUSHES.map((s) => s.pushId).sort())
		const appliedPushIds = applied.map((r) => r._ptadPushId).sort()
		expect(appliedPushIds).toEqual(PUSHES.map((s) => s.pushId).sort())

		result.unmount()
	})
})

describe("C2-CORRECTION02-FIXUP02 — R5 fail-closed on missing _ptadPushId", () => {
	it("B3: a missing-pushId push emits a raw capture but NO applied capture; the next valid push emits both", async () => {
		const result = render(<ExtensionStateContextProvider />)

		// E1 has no pushId (R5 case); E2 has pushId=2 (healthy case).
		await act(async () => {
			if (!pushHandler) throw new Error("pushHandler not wired")
			pushHandler(buildStateData({ label: "E1", turnState: { phase: "idle", seq: 2, anchorTs: 1 }, pushId: undefined }))
			pushHandler(buildStateData(PUSHES[1]))
		})

		const records = getPostTerminalAuthorityDiagnosticRecords("webview") as readonly unknown[]
		const raws = records.filter(isRaw)
		const applied = records.filter(isApplied)

		// 2 raw records (E1 with _ptadPushId=undefined, E2 with _ptadPushId=2).
		expect(raws.length).toBe(2)
		const noIdRaw = raws.find((r) => r._ptadPushId === undefined)
		expect(noIdRaw).toBeDefined()
		const idRaw = raws.find((r) => r._ptadPushId === 2)
		expect(idRaw).toBeDefined()

		// 1 applied record (only E2; E1 has no correlation key).
		expect(applied.length).toBe(1)
		expect(applied[0]._ptadPushId).toBe(2)

		result.unmount()
	})

	it("B4: two consecutive missing-pushId pushes do NOT overwrite each other's pending entries (R5 fix)", async () => {
		// PRE-FIXUP02: the two pushes would write to the SAME "no-push-id"
		// slot in pendingRawSnapshotsRef. POST-FIXUP02: no pending entry is
		// written at all, so there is nothing to overwrite.
		//
		// We assert the observable consequence: two raw records, zero
		// applied records, no React-level error.
		const result = render(<ExtensionStateContextProvider />)

		await act(async () => {
			if (!pushHandler) throw new Error("pushHandler not wired")
			pushHandler(buildStateData({ label: "E1", turnState: { phase: "idle", seq: 2, anchorTs: 1 }, pushId: undefined }))
			pushHandler(buildStateData({ label: "E2", turnState: { phase: "idle", seq: 2, anchorTs: 2 }, pushId: undefined }))
		})

		const records = getPostTerminalAuthorityDiagnosticRecords("webview") as readonly unknown[]
		const raws = records.filter(isRaw)
		const applied = records.filter(isApplied)

		expect(raws.length).toBe(2)
		expect(applied.length).toBe(0)

		result.unmount()
	})
})
