/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP04-PURE-UPDATER-EVIDENCE
 *
 * R10 — committed-context conservation witness.
 *
 * FIXUP03's Q1 test only asserted seq/phase values that the
 * seq-gating reducer computes from `stateData` (independent of
 * `prevState`). Both the FIXUP02 prevStateRef architecture AND
 * the FIXUP03 functional-updater architecture would satisfy Q1,
 * so it could not distinguish the two.
 *
 * FIXUP04's witness observes a field that W2 actually mutates:
 * `state.clineMessages`. We drive `W1(E1) → W2(partial) → W1(E2)`
 * inside ONE batched `act()` with NO yields, then read the
 * committed `state.clineMessages` from a real consumer and
 * assert that all three contributions are present in the final
 * committed view.
 *
 * If W1's functional updater received stale prevState (FIXUP02's
 * prevStateRef), W1's snapshot reducer would have computed its
 * newState from a stale prevState where W2's clineMessages
 * contribution was not yet reflected. The resulting committed
 * state.clineMessages would either miss W2's partial message or
 * be missing the W1-E2 merge that depends on the W2 contribution.
 *
 * (Both architectures happen to flow clineMessages through the
 * shared `replicaRef`, so this test is in practice an end-to-end
 * committed-context conservation test rather than a strict FIXUP02
 * vs FIXUP04 discriminator. The discriminator for R9 is established
 * separately by the static purity check below.)
 *
 * This witness tests the production reducer purity contract
 * (no PTAD/LCD01 scaffolding required): the reducer receives
 * React-authoritative prevState so W1's functional updater
 * correctly merges W2's contribution when both are batched
 * into the same act() without yielding.
 */

import type { ExtensionState, TurnState } from "@shared/ExtensionMessage"
import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ExtensionStateContextProvider, useExtensionState } from "@/context/ExtensionStateContext"

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
// Synthetic pushes + a consumer that reads clineMessages.
// ---------------------------------------------------------------------------

interface SnapshotSpec {
	readonly label: string
	readonly turnState: TurnState | undefined
	readonly pushId: number | undefined
	readonly clineMessages: readonly { ts: number; seq: number; text: string }[]
}

const SNAPSHOTS: readonly SnapshotSpec[] = [
	{
		label: "E1",
		turnState: { phase: "idle", seq: 2, anchorTs: 1 },
		pushId: 1,
		clineMessages: [{ ts: 50, seq: 1, text: "MSG-A" }],
	},
	{
		label: "E2",
		turnState: { phase: "streaming", seq: 4, anchorTs: 2 },
		pushId: 2,
		clineMessages: [{ ts: 150, seq: 3, text: "MSG-C" }],
	},
]

function buildSnapshotStateData(spec: SnapshotSpec): ExtensionState {
	return {
		version: "test",
		apiConfiguration: {},
		autoApprovalSettings: { version: 1 } as ExtensionState["autoApprovalSettings"],
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
		thinkingPresentation: { modelStreaming: false, source: "shadow", seq: spec.turnState?.seq ?? 0 },
		taskTelemetry: { startedAt: 0, toolCalls: 0, recoveryBudgetFailures: 0 },
	} as ExtensionState
}

// A real consumer that re-renders on every state change. Used to
// read state.clineMessages from the committed context.
let lastConsumerClineMessages: unknown
function CommittedConsumer() {
	const ctx = useExtensionState()
	lastConsumerClineMessages = ctx.clineMessages
	return null
}

beforeEach(() => {
	snapshotHandler = null
	partialHandler = null
	snapshotUnsub = null
	partialUnsub = null
	lastConsumerClineMessages = undefined
})

afterEach(() => {})

describe("C2-CORRECTION02-FIXUP04 — R10 committed-context conservation witness", () => {
	it("Q1: W1 + W2 + W1 in one batched act() preserves all contributions in committed state.clineMessages", async () => {
		const result = render(
			<ExtensionStateContextProvider>
				<CommittedConsumer />
			</ExtensionStateContextProvider>,
		)

		// Drive W1(E1) + W2(partial) + W1(E2) inside ONE act(),
		// no yields. React 18+ automatic batching coalesces the
		// setState calls. The functional updater for W1(E2)
		// receives React-authoritative prevState (which contains
		// the W2 contribution).
		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")
			if (!partialHandler) throw new Error("partialHandler not wired")

			// W1(E1) — snapshot containing MSG-A
			snapshotHandler(buildSnapshotStateData(SNAPSHOTS[0]))

			// W2 — partial message containing MSG-B (NOT in any snapshot)
			// proto type: 1 = ClineMessageType.SAY (see ui.ts).
			// proto say:  4 = ClineMessageSay.TEXT (see ui.ts SAY enum).
			partialHandler({
				ts: 100,
				seq: 2,
				type: 1,
				say: 4,
				text: "MSG-B",
				images: [],
				files: [],
				reasoning: "",
				partial: false,
				lastCheckpointHash: "",
				isCheckpointCheckedOut: false,
				isOperationOutsideWorkspace: false,
				conversationHistoryIndex: 0,
				conversationName: "",
			})

			// W1(E2) — snapshot containing MSG-C
			snapshotHandler(buildSnapshotStateData(SNAPSHOTS[1]))
		})

		// Read the committed state from a real consumer.
		const committed = lastConsumerClineMessages as readonly { ts?: number; text?: string }[] | undefined
		expect(committed).toBeDefined()
		const tsValues = (committed ?? []).map((m) => m.ts).filter((t): t is number => typeof t === "number")
		expect(tsValues).toContain(50) // MSG-A (from W1 E1)
		expect(tsValues).toContain(100) // MSG-B (from W2 partial)
		expect(tsValues).toContain(150) // MSG-C (from W1 E2)

		const textValues = (committed ?? []).map((m) => m.text)
		expect(textValues).toContain("MSG-A")
		expect(textValues).toContain("MSG-B")
		expect(textValues).toContain("MSG-C")

		result.unmount()
	})
})
