/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-LIVE-CONTEXT-DIMENSIONS01-C1-FIXUP01
 *
 * P1 closure: real React StrictMode witness for the per-boundary
 * request-site capture layer.
 *
 * The C1 commit shipped a "request-cardinality" test that called
 * the recorder directly. That test proves the RECORDER is correct;
 * it does NOT prove the production code path is correct under
 * StrictMode, which deliberately re-runs certain pure functions
 * (including functional updaters) to surface impurity.
 *
 * This test
 *   1. Renders <React.StrictMode><ExtensionStateContextProvider/></StrictMode>
 *   2. Mocks the real StateServiceClient.subscribeToState and
 *      UiServiceClient.subscribeToPartialMessage
 *   3. Drives ONE W1 callback through the real onResponse handler
 *      (NOT the recorder) and asserts the LCD01 buffer has
 *      exactly 1 webview-w1-request, 1 webview-w1-request-q, and 1
 *      webview-w1-request-replica.
 *   4. Drives ONE W2 callback and asserts the same trio on the W2 side.
 *
 * If the LCD01 emissions ever sneak INTO a queued functional updater
 * (which React may invoke twice under StrictMode), this test would
 * catch a record-count of 2 per request. Under the current
 * outside-the-updater placement, it must be exactly 1.
 */

import type { ExtensionState, TurnState } from "@shared/ExtensionMessage"
import {
	clearLiveContextDimensions01Capture,
	enableLiveContextDimensions01Capture,
	getLiveContextDimensions01CaptureRecords,
	isLiveContextDimensions01CaptureEnabled,
	recordLiveContextDimensions01Capture,
	__resetLiveContextDimensions01CaptureForTesting,
} from "@shared/live-context-dimensions01-capture"
import { render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as React from "react"
import { ExtensionStateContextProvider } from "@/context/ExtensionStateContext"

// ---------------------------------------------------------------------------
// Mock StateServiceClient.subscribeToState + subscribeToPartialMessage so we
// can drive both W1 (snapshot) and W2 (partial message) writers.
// ---------------------------------------------------------------------------

let snapshotHandler: ((stateData: ExtensionState) => void) | null = null
let partialHandler: ((protoMessage: unknown) => void) | null = null

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
							return () => {
								snapshotHandler = null
							}
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
							return () => {
								partialHandler = null
							}
						}
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
// Helpers
// ---------------------------------------------------------------------------

function buildSnapshotStateData(spec: {
	pushId: number
	turnState: TurnState | undefined
	clineMessages: readonly { ts: number; seq: number; text: string }[]
}): ExtensionState {
	return {
		version: "",
		apiConfiguration: {} as ExtensionState["apiConfiguration"],
		autoApprovalSettings: { version: 1 } as ExtensionState["autoApprovalSettings"],
		browserSettings: {} as ExtensionState["browserSettings"],
		clineMessages: spec.clineMessages.map((m) => ({
			ts: m.ts,
			seq: m.seq,
			type: "say",
			say: "text",
			text: m.text,
		})),
		stateVersion: 0,
		epoch: 0,
		turnState: spec.turnState,
		_ptadEnabled: true,
		_ptadPushId: spec.pushId,
		thinkingPresentation: {
			modelStreaming: false,
			source: "shadow",
			seq: spec.turnState?.seq ?? 0,
		},
		taskTelemetry: { startedAt: 0, toolCalls: 0, recoveryBudgetFailures: 0 },
	} as ExtensionState
}

const PARTIAL_PROTO = {
	ts: 100,
	seq: 2,
	type: 1,
	say: 4,
	text: "PARTIAL-MSG",
	images: [],
	files: [],
	reasoning: "",
	partial: false,
	lastCheckpointHash: "",
	isCheckpointCheckedOut: false,
	isOperationOutsideWorkspace: false,
	conversationHistoryIndex: 0,
	conversationName: "",
}

beforeEach(() => {
	__resetLiveContextDimensions01CaptureForTesting()
	recordLiveContextDimensions01Capture // type-check smoke
	snapshotHandler = null
	partialHandler = null
})

afterEach(() => {
	__resetLiveContextDimensions01CaptureForTesting()
})

describe("ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-LIVE-CONTEXT-DIMENSIONS01-C1-FIXUP01 / StrictMode witness", () => {
	it("R-strictmode-1: under React.StrictMode, ONE W1 callback yields exactly 1 W1 / 1 W1-q / 1 W1-replica (NOT 2)", async () => {
		// Enable the LCD01 capture directly. The wire-bit flip is
		// covered by the schema test suite; here we want to focus
		// on the per-request-site emission count under StrictMode.
		enableLiveContextDimensions01Capture()

		const result = render(
			<React.StrictMode>
				<ExtensionStateContextProvider />
			</React.StrictMode>,
		)

		expect(isLiveContextDimensions01CaptureEnabled()).toBe(true)

		// Clear any auto-emitted records from the initial mount's
		// PTAD round-trip. We want to count the records produced by
		// OUR explicit W1 callback, not the mount itself.
		clearLiveContextDimensions01Capture()

		expect(snapshotHandler).not.toBeNull()
		snapshotHandler!(
			buildSnapshotStateData({
				pushId: 7,
				turnState: { phase: "streaming", seq: 7, anchorTs: 1 },
				clineMessages: [{ ts: 50, seq: 1, text: "A" }],
			}),
		)

		const records = getLiveContextDimensions01CaptureRecords()
		const w1 = records.filter((r) => r.kind === "webview-w1-request")
		const w1q = records.filter((r) => r.kind === "webview-w1-request-q")
		const w1r = records.filter((r) => r.kind === "webview-w1-request-replica")
		expect(w1.length).toBe(1)
		expect(w1q.length).toBe(1)
		expect(w1r.length).toBe(1)

		result.unmount()
	})

	it("R-strictmode-2: under React.StrictMode, ONE W2 callback yields exactly 1 W2 / 1 W2-q / 1 W2-replica (NOT 2)", async () => {
		enableLiveContextDimensions01Capture()

		const result = render(
			<React.StrictMode>
				<ExtensionStateContextProvider />
			</React.StrictMode>,
		)

		expect(isLiveContextDimensions01CaptureEnabled()).toBe(true)
		clearLiveContextDimensions01Capture()

		expect(partialHandler).not.toBeNull()
		partialHandler!(PARTIAL_PROTO)

		const records = getLiveContextDimensions01CaptureRecords()
		const w2 = records.filter((r) => r.kind === "webview-w2-request")
		const w2q = records.filter((r) => r.kind === "webview-w2-request-q")
		const w2r = records.filter((r) => r.kind === "webview-w2-request-replica")
		expect(w2.length).toBe(1)
		expect(w2q.length).toBe(1)
		expect(w2r.length).toBe(1)

		result.unmount()
	})

	it("R-strictmode-3: under React.StrictMode, ONE dump trigger dispatches EXACTLY ONE clinemm.appendLiveContextDimensions01 message (NOT 2)", async () => {
		// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-LIVE-CONTEXT-DIMENSIONS01-C1-FIXUP02:
		// This is the load-bearing witness for the listener cleanup.
		// React Strict Mode deliberately re-runs Effects with an extra
		// setup->cleanup->setup cycle in development; without explicit
		// removeEventListener, multiple dump handlers would be alive and
		// ONE dump request would trigger N webview->extension flushes
		// (and N JSONL overwrites). The C1-FIXUP02 fix added the
		// cleanup; this test catches regressions.
		enableLiveContextDimensions01Capture()

		// Stub the VSCode API with a postMessage spy BEFORE mount
		// so we can count outgoing flush messages.
		const sentMessages: unknown[] = []
		const w = window as unknown as {
			__clineVsCodeApi?: { postMessage: (m: unknown) => void }
		}
		const originalApi = w.__clineVsCodeApi
		w.__clineVsCodeApi = {
			postMessage: (m: unknown) => {
				sentMessages.push(m)
			},
		}

		try {
			const result = render(
				<React.StrictMode>
					<ExtensionStateContextProvider />
				</React.StrictMode>,
			)

			// Capture some records so the dump has content.
			enableLiveContextDimensions01Capture()
			clearLiveContextDimensions01Capture()
			recordLiveContextDimensions01Capture({
				kind: "webview-w1-request",
				correlation: {
					associationQuality: "INTRINSIC",
					associatedPushId: 1,
					intervalInferred: undefined,
				},
				hostTurnState: { phase: "idle", seq: 1, anchorTs: 1 },
			})

			// Dispatch ONE dump trigger via the postMessage bridge.
			// This is what the extension sends via webview.postMessage().
			// jsdom does not deliver window.postMessage to window
			// listeners, so dispatch a MessageEvent directly.
			window.dispatchEvent(new MessageEvent("message", { data: { type: "clinemm.dumpLiveContextDimensions01" } }))

			// Wait microtasks for the listener to handle the event.
			await Promise.resolve()

			const appendCalls = sentMessages.filter((m) => {
				return (
					typeof m === "object" &&
					m !== null &&
					(m as { type?: unknown }).type === "clinemm.appendLiveContextDimensions01"
				)
			})
			expect(appendCalls.length).toBe(1)

			// The first (and only) message must carry the records.
			const first = appendCalls[0] as {
				type: string
				clinemm_liveContextDimensions01Records?: readonly unknown[]
			}
			expect(first.type).toBe("clinemm.appendLiveContextDimensions01")
			expect(Array.isArray(first.clinemm_liveContextDimensions01Records)).toBe(true)
			expect(first.clinemm_liveContextDimensions01Records?.length).toBe(1)

			result.unmount()
		} finally {
			// Restore the original API surface.
			if (originalApi) {
				w.__clineVsCodeApi = originalApi
			} else {
				delete w.__clineVsCodeApi
			}
		}
	})
})
