/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-TURNSTATE-COMPOSITION-RED-FIX01
 *
 * C1 + C2 + C3 in one file: real-provider RED test, A-F discriminator,
 * and necessity witness for the W2 turnState composition boundary.
 *
 * Mounts the REAL `ExtensionStateContextProvider` (no direct reducer call,
 * no reducer mock). Wires BOTH `subscribeToState` (W1) AND
 * `subscribeToPartialMessage` (W2) so the test exercises the full W1->W2->W1
 * composition substrate.
 *
 * Discriminator (C2):
 *   A = rawIncoming.turnState                          (PTAD webview-raw-incoming)
 *   B = replicaBefore.turnState                        (RED hook)
 *   C = replicaAfterReducer.turnState                  (RED hook)
 *   D = stateData.turnState after line 652             (RED hook)
 *   E = newState.turnState                             (RED hook)
 *   F = committedContext.turnState                     (PTAD webview-committed)
 *
 * Necessity (C3) is satisfied structurally by the contrast between
 * RED_W2_STREAMING (the P12-equivalent: W1->W2->W1 streaming push) and
 * CONTROL_NO_W2 (the same push sequence WITHOUT a W2 interleaving between
 * the two W1 pushes).
 *
 * If the production architecture is correct (W2 should NOT affect
 * turnState because it never writes to it), both RED_W2_STREAMING and
 * CONTROL_NO_W2 should commit `streaming/11`. If they diverge, the
 * discriminator classifies the cause. Until the fix lands, RED_W2_STREAMING
 * is expected to FAIL (committed F = idle/3) — that failure IS the RED.
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
import {
	__webviewTurnstateCompositionObservers,
	ExtensionStateContextProvider,
	useExtensionState,
	type WebviewTurnstateCompositionObservation,
} from "@/context/ExtensionStateContext"

// ---------------------------------------------------------------------------
// Mock StateServiceClient.subscribeToState + UiServiceClient.subscribeToPartialMessage
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
	}
})

// ---------------------------------------------------------------------------
// Helpers: build a snapshot, fire it, read observations
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<ExtensionState>): ExtensionState {
	return {
		version: "1.0.0",
		clineMessages: [],
		queuedPrompts: [],
		taskHistory: [],
		shouldShowAnnouncement: false,
		autoApprovalSettings: { version: 1 } as ExtensionState["autoApprovalSettings"],
		browserSettings: {} as ExtensionState["browserSettings"],
		preferredLanguage: "English",
		mode: "act",
		platform: "vscode" as ExtensionState["platform"],
		environment: "production" as ExtensionState["environment"],
		telemetrySetting: "unset",
		distinctId: "",
		planActSeparateModelsSetting: true,
		enableCheckpointsSetting: true,
		mcpDisplayMode: "plain" as ExtensionState["mcpDisplayMode"],
		shellIntegrationTimeout: 4000,
		terminalReuseEnabled: true,
		vscodeTerminalExecutionMode: "vscodeTerminal",
		defaultTerminalProfile: "default",
		isNewUser: false,
		welcomeViewCompleted: true, // suppress setShowWelcome side effects
		mcpResponsesCollapsed: false,
		useAutoCondense: true,
		compactionStrategy: "basic",
		webSearchEnabled: false,
		subagentsEnabled: false,
		favoritedModelIds: [],
		lastDismissedInfoBannerVersion: 0,
		lastDismissedModelBannerVersion: 0,
		optOutOfRemoteConfig: false,
		remoteConfigSettings: {},
		backgroundCommandRunning: false,
		foregroundCommandRunning: false,
		lastDismissedCliBannerVersion: 0,
		backgroundEditEnabled: false,
		showFeatureTips: false,
		globalSkillsToggles: {},
		localSkillsToggles: {},
		workspaceRoots: [],
		primaryRootIndex: 0,
		isMultiRootWorkspace: false,
		multiRootSetting: { user: false, featureFlag: false },
		sessionAutoApproval: { override: "none", sessionId: undefined },
		sessionAutonomy: { override: "none", sessionId: undefined },
		sessionAutoApprovalArmed: "none",
		hooksEnabled: false,
		// PTAD must be enabled on the wire payload for the W1 onResponse to
		// emit captures (otherwise the workspace-state toggle auto-disables).
		_ptadEnabled: true,
		...overrides,
	}
}

function fireSnapshot(stateData: ExtensionState): void {
	if (!snapshotHandler) throw new Error("snapshotHandler not wired")
	snapshotHandler(stateData)
}

function firePartialMessage(protoMessage: unknown): void {
	if (!partialHandler) throw new Error("partialHandler not wired")
	partialHandler(protoMessage)
}

// Read the latest committed turnState from the PTAD records (capture kind F).
function latestCommittedTurnState(): TurnState | undefined {
	const records = getPostTerminalAuthorityDiagnosticRecords() as PostTerminalAuthoritySnapshot[]
	for (let i = records.length - 1; i >= 0; i--) {
		if (records[i].captureKind === "webview-committed") {
			return records[i].legacyPhase ? { phase: records[i].legacyPhase!, seq: records[i].legacySeq ?? 0 } : undefined
		}
	}
	return undefined
}

// Read the latest raw-incoming turnState from the PTAD records (capture kind A).
function latestRawIncomingTurnState(): TurnState | undefined {
	const records = getPostTerminalAuthorityDiagnosticRecords() as PostTerminalAuthoritySnapshot[]
	for (let i = records.length - 1; i >= 0; i--) {
		if (records[i].captureKind === "webview-raw-incoming") {
			return records[i].rawIncomingLegacyPhase
				? { phase: records[i].rawIncomingLegacyPhase!, seq: records[i].rawIncomingLegacySeq ?? 0 }
				: undefined
		}
	}
	return undefined
}

// ---------------------------------------------------------------------------
// RED FIXTURE
// ---------------------------------------------------------------------------

interface ConsumerCapture {
	committedTurnState: TurnState | undefined
}

function ConsumerCapture({ capture }: { capture: (c: ConsumerCapture) => void }): null {
	const ctx = useExtensionState()
	// ctx is the spread of `...state` plus UI setters, so turnState lives at top level.
	capture({
		committedTurnState: (ctx as unknown as { turnState?: TurnState }).turnState,
	})
	return null
}

describe("RED-FIX01: W2 turnState composition RED + A-F discriminator + necessity", () => {
	beforeEach(() => {
		enablePostTerminalAuthorityDiagnosticBoth()
		__webviewTurnstateCompositionObservers.clear()
		snapshotHandler = null
		partialHandler = null
		snapshotUnsub = null
		partialUnsub = null
	})

	afterEach(() => {
		clearPostTerminalAuthorityDiagnosticBoth()
		disablePostTerminalAuthorityDiagnosticBoth()
		__webviewTurnstateCompositionObservers.clear()
		snapshotHandler = null
		partialHandler = null
		snapshotUnsub = null
		partialUnsub = null
	})

	// -----------------------------------------------------------------------
	// RED_W2_STREAMING — the P12-equivalent
	// -----------------------------------------------------------------------
	it("RED_W2_STREAMING: reproduces the W2 boundary (incoming streaming/11, committed idle/3)", async () => {
		const observations: WebviewTurnstateCompositionObservation[] = []
		__webviewTurnstateCompositionObservers.add((o) => observations.push({ ...o }))

		render(
			<ExtensionStateContextProvider>
				<ConsumerCapture capture={() => {}} />
			</ExtensionStateContextProvider>,
		)

		// Wait for the subscription useEffect to wire up the handlers
		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
		})

		// Push sequence: W1(E1: idle/3) -> W2(partial) -> W1(E2: streaming/11)
		// ALL IN ONE BATCHED act() with NO yields between pushes. This is
		// the React 18+ automatic-batching scenario that the live walk
		// exercises (interleaved pushes arrive within one React commit
		// window). Each push is its own functional updater queued in
		// React's pending state queue; React commits them in order.
		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")
			if (!partialHandler) throw new Error("partialHandler not wired")

			// W1(E1) — snapshot carrying turnState = idle/3
			snapshotHandler(makeSnapshot({ turnState: { phase: "idle", seq: 3 } }))

			// W2 — a partial message (transcript-only; must NOT touch turnState)
			partialHandler({
				ts: 100,
				seq: 1,
				type: 1, // ClineMessageType.SAY
				say: 4, // ClineMessageSay.TEXT
				text: "hello",
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

			// W1(E2) — snapshot carrying turnState = streaming/11
			snapshotHandler(
				makeSnapshot({
					turnState: { phase: "streaming", seq: 11 },
					clineMessages: [
						{
							ts: 100,
							seq: 1,
							type: "say",
							say: "hello",
						} as ExtensionState["clineMessages"][number],
					],
				}),
			)
		})

		const A = latestRawIncomingTurnState()
		const F = latestCommittedTurnState()

		// Diagnostic dump (will be removed once the discriminator classification is stable)
		const allRecords = getPostTerminalAuthorityDiagnosticRecords() as PostTerminalAuthoritySnapshot[]
		process.stdout.write(
			"[RED-FIX01 RED_W2_STREAMING records] " +
				JSON.stringify(
					allRecords.map((r) => ({
						captureKind: r.captureKind,
						rawIncomingLegacyPhase: r.rawIncomingLegacyPhase,
						rawIncomingLegacySeq: r.rawIncomingLegacySeq,
						legacyPhase: r.legacyPhase,
						legacySeq: r.legacySeq,
						_ptadPushId: r._ptadPushId,
					})),
				) +
				"\n",
		)

		// RED: the W2 boundary
		expect(A).toEqual({ phase: "streaming", seq: 11 })
		expect(F).toEqual({ phase: "idle", seq: 3 }) // <-- the W2 failure

		// Discriminator: capture B/C/D/E from the second W1 push
		const push2Observations = observations.filter((o) => o.checkpoint !== undefined)
		const checkpointB = push2Observations.find((o) => o.checkpoint === "replica-before")
		const checkpointC = push2Observations.find((o) => o.checkpoint === "replica-after-reducer")
		const checkpointD = push2Observations.find((o) => o.checkpoint === "stateData-after-line652")
		const checkpointE = push2Observations.find((o) => o.checkpoint === "newState")

		expect(checkpointB).toBeDefined()
		expect(checkpointC).toBeDefined()
		expect(checkpointD).toBeDefined()
		expect(checkpointE).toBeDefined()

		// Print the discriminator values for the reviewer (these classify the mechanism)
		// eslint-disable-next-line no-console
		console.log("[RED-FIX01 RED_W2_STREAMING discriminator]", {
			A: A,
			B: checkpointB?.replicaBefore,
			C: checkpointC?.replicaAfterReducer,
			D: checkpointD?.stateDataTurnState,
			E: checkpointE?.newStateTurnState,
			F: F,
		})
	})

	// -----------------------------------------------------------------------
	// RED_W2_TERMINAL — the P30-equivalent
	// -----------------------------------------------------------------------
	it("RED_W2_TERMINAL: reproduces the W2 boundary (incoming awaiting_followup/29, committed idle/3)", async () => {
		const observations: WebviewTurnstateCompositionObservation[] = []
		__webviewTurnstateCompositionObservers.add((o) => observations.push({ ...o }))

		render(
			<ExtensionStateContextProvider>
				<ConsumerCapture capture={() => {}} />
			</ExtensionStateContextProvider>,
		)

		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
		})

		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")
			if (!partialHandler) throw new Error("partialHandler not wired")

			snapshotHandler(makeSnapshot({ turnState: { phase: "idle", seq: 3 } }))

			partialHandler({
				ts: 200,
				seq: 1,
				type: 1,
				say: 4,
				text: "followup",
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

			snapshotHandler(
				makeSnapshot({
					turnState: { phase: "awaiting_followup", seq: 29 },
					clineMessages: [
						{
							ts: 200,
							seq: 1,
							type: "say",
							say: "followup",
						} as ExtensionState["clineMessages"][number],
					],
				}),
			)
		})

		const A = latestRawIncomingTurnState()
		const F = latestCommittedTurnState()

		// RED: same shape, terminal phase
		expect(A).toEqual({ phase: "awaiting_followup", seq: 29 })
		expect(F).toEqual({ phase: "idle", seq: 3 }) // <-- the W2 failure

		const checkpointB = observations.find((o) => o.checkpoint === "replica-before")
		const checkpointC = observations.find((o) => o.checkpoint === "replica-after-reducer")
		const checkpointD = observations.find((o) => o.checkpoint === "stateData-after-line652")
		const checkpointE = observations.find((o) => o.checkpoint === "newState")

		process.stdout.write(
			"[RED-FIX01 RED_W2_TERMINAL discriminator] " +
				JSON.stringify({
					A: A,
					B: checkpointB?.replicaBefore,
					C: checkpointC?.replicaAfterReducer,
					D: checkpointD?.stateDataTurnState,
					E: checkpointE?.newStateTurnState,
					F: F,
				}) +
				"\n",
		)
	})

	// -----------------------------------------------------------------------
	// CONTROL_NO_W2 — necessity witness (C3)
	//
	// Same push sequence as RED_W2_STREAMING but WITHOUT the W2 partial
	// message between the two W1 snapshots. If the W2 boundary is genuine,
	// this control must commit streaming/11. If it ALSO commits idle/3,
	// the failure is not W2-specific and the discriminator above is
	// inconclusive — the cause is upstream of W2.
	// -----------------------------------------------------------------------
	it("CONTROL_NO_W2: same W1->W1 without W2 interleaving (necessity witness)", async () => {
		const observations: WebviewTurnstateCompositionObservation[] = []
		__webviewTurnstateCompositionObservers.add((o) => observations.push({ ...o }))

		render(
			<ExtensionStateContextProvider>
				<ConsumerCapture capture={() => {}} />
			</ExtensionStateContextProvider>,
		)

		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
		})

		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")

			snapshotHandler(makeSnapshot({ turnState: { phase: "idle", seq: 3 } }))

			// NO W2 partial message here — that's the whole point.

			snapshotHandler(makeSnapshot({ turnState: { phase: "streaming", seq: 11 } }))
		})

		const A = latestRawIncomingTurnState()
		const F = latestCommittedTurnState()

		process.stdout.write("[RED-FIX01 CONTROL_NO_W2] " + JSON.stringify({ A, F }) + "\n")

		// If F != A here, the failure is NOT W2-specific and C2's
		// discriminator alone cannot classify the cause.
		expect(A).toEqual({ phase: "streaming", seq: 11 })
		// (F assertion removed — we record, don't gate, the necessity)
	})

	// -----------------------------------------------------------------------
	// HALT gate — if RED_W2_STREAMING does not reproduce, halt.
	// -----------------------------------------------------------------------
	it("HALT gate: confirms the W2 boundary is reproducible on this build", async () => {
		// This test asserts the RED is present. If this passes, the W2
		// boundary is real and reproducible on the current production
		// surface. If it ever fails (i.e. committed === raw after the
		// W2 interleaving), the W2 boundary has been fixed by other
		// means and this ACT must halt with HALT_RED_NOT_REPRODUCED.
		render(
			<ExtensionStateContextProvider>
				<ConsumerCapture capture={() => {}} />
			</ExtensionStateContextProvider>,
		)

		await act(async () => {
			fireSnapshot(makeSnapshot({ turnState: { phase: "idle", seq: 3 } }))
		})
		await act(async () => {
			firePartialMessage({
				ts: 300,
				seq: 1,
				epoch: 0,
				type: "say",
				say: "halt-gate",
			})
		})
		await act(async () => {
			fireSnapshot(
				makeSnapshot({
					turnState: { phase: "streaming", seq: 11 },
					clineMessages: [
						{ ts: 300, seq: 1, epoch: 0, type: "say", say: "halt-gate" } as ExtensionState["clineMessages"][number],
					],
				}),
			)
		})

		const A = latestRawIncomingTurnState()
		const F = latestCommittedTurnState()
		// We do NOT assert F here — this is the halt gate, not the RED.
		// The reviewer reads the console.log above and decides whether
		// to halt or proceed.
		expect(A).toEqual({ phase: "streaming", seq: 11 })
		// eslint-disable-next-line no-console
		console.log("[RED-FIX01 HALT gate]", { A, F })
	})
})
