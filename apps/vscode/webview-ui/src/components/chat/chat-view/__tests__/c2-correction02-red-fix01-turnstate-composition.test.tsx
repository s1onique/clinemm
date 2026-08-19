/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-TURNSTATE-COMPOSITION-RED-FIX01
 * (halted at C1+C2+C3 with HALT_RED_NOT_REPRODUCED)
 *
 * This test file is the closed-clean GREEN witness for the halt.
 *
 * The original ACT mounted the real `ExtensionStateContextProvider`,
 * wired both W1 (subscribeToState) and W2 (subscribeToPartialMessage),
 * and attempted to reproduce the live W2 boundary identified by
 * TRACE01 (P12: extension=streaming/11, raw=streaming/11, committed=idle/3).
 *
 * The real provider did NOT reproduce the boundary for the synthetic
 * P12-equivalent input. The reducer advanced correctly, the line-652
 * copy was correct, the returned newState was correct, and the
 * committed context was correct. The synthetic A->F chain was
 * healthy end-to-end.
 *
 * This file is preserved as a passing witness so that:
 *   1. The simple `replicaRef + batching` story is shown empirically
 *      closed (the production surface correctly commits `streaming/11`
 *      for a W1->W2->W1 batched sequence).
 *   2. The fixture and the A->F chain are documented for the next
 *      ACT (LIVE-SHAPE-REPRODUCTION01) to extend incrementally.
 *
 * Production-surface invariant: this test adds ZERO production code
 * (the prior test-only observation seam was reverted at the cleanup
 * commit). The discriminator reads only A (=PTAD webview-raw-incoming)
 * and F (=PTAD webview-committed), which are push-correlated via the
 * `_ptadPushId` field already stamped by the ExtensionStateContext.
 *
 * Verdict: HALT_RED_NOT_REPRODUCED / CLOSED_HALTED_CLEAN
 *   FINAL_PRODUCTION_DELTA = 0
 *   RED_FIX01_CANONICAL_TEST_GATE = PASS (560/560 expected green)
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
// Helpers
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
		// PTAD must be enabled on the wire payload for the W1 onResponse
		// to emit captures (the workspace-state toggle auto-disables
		// otherwise).
		_ptadEnabled: true,
		...overrides,
	}
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
		turnState: committed.legacyPhase ? { phase: committed.legacyPhase, seq: committed.legacySeq ?? 0 } : undefined,
	}
}

function CommittedConsumerProbe({ capture }: { capture: (ctx: { turnState: TurnState | undefined }) => void }) {
	const ctx = useExtensionState()
	capture({ turnState: (ctx as unknown as { turnState?: TurnState }).turnState })
	return null
}

// ---------------------------------------------------------------------------
// Witnesses (all assertions are GREEN)
// ---------------------------------------------------------------------------

describe("RED-FIX01 halt witnesses: W2 boundary not reproduced by simple real-provider fixture", () => {
	beforeEach(() => {
		enablePostTerminalAuthorityDiagnosticBoth()
		clearPostTerminalAuthorityDiagnosticBoth()
		snapshotHandler = null
		partialHandler = null
		snapshotUnsub = null
		partialUnsub = null
	})

	afterEach(() => {
		clearPostTerminalAuthorityDiagnosticBoth()
		disablePostTerminalAuthorityDiagnosticBoth()
		snapshotHandler = null
		partialHandler = null
		snapshotUnsub = null
		partialUnsub = null
	})

	// -----------------------------------------------------------------------
	// W1: Simple W1->W2->W1 batched sequence (the P12-equivalent). The real
	// provider commits streaming/11 — the intended RED does NOT reproduce.
	// This is the canonical close-clean witness.
	// -----------------------------------------------------------------------
	it("RED_W2_STREAMING_absent: simple W1->W2->W1 batched sequence commits streaming/11 (NOT idle/3)", async () => {
		render(
			<ExtensionStateContextProvider>
				<CommittedConsumerProbe capture={() => {}} />
			</ExtensionStateContextProvider>,
		)

		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
		})

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

		const A = latestRawIncoming()
		const F = latestCommitted()

		// Canonical close-clean assertions (GREEN):
		// The raw incoming IS streaming/11 (the wire reaches the provider).
		// The committed context IS streaming/11 (the W1 functional updater
		// plus the reducer plus the line-652 seq-gated copy all correctly
		// produced and committed the new turnState).
		expect(A?.turnState).toEqual({ phase: "streaming", seq: 11 })
		expect(F?.turnState).toEqual({ phase: "streaming", seq: 11 })

		// A == F: the simple real-provider fixture commits raw truth.
		// This is the close-clean witness for the synthetic P12-equivalent.
		// (No _ptadPushId assertion here: the synthetic fixture does not
		// stamp _ptadPushId, so PTAD is in fail-closed mode and the two
		// captures may carry undefined IDs. The A==F equality is the
		// canonical witness, not the push-id correlation.)
		expect(A?.turnState).toEqual(F?.turnState)
	})

	// -----------------------------------------------------------------------
	// W2: Terminal form. W1->W2->W1 with awaiting_followup/29.
	// -----------------------------------------------------------------------
	it("RED_W2_TERMINAL_absent: simple W1->W2->W1 batched sequence commits awaiting_followup/29 (NOT idle/3)", async () => {
		render(
			<ExtensionStateContextProvider>
				<CommittedConsumerProbe capture={() => {}} />
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

		const A = latestRawIncoming()
		const F = latestCommitted()

		expect(A?.turnState).toEqual({ phase: "awaiting_followup", seq: 29 })
		expect(F?.turnState).toEqual({ phase: "awaiting_followup", seq: 29 })
		// A == F: the simple real-provider fixture commits raw truth.
		// (No _ptadPushId assertion; see the RED_W2_STREAMING_absent note.)
		expect(A?.turnState).toEqual(F?.turnState)
	})

	// -----------------------------------------------------------------------
	// W3: Necessity (control). W1->W1 without W2. Raw == committed.
	// -----------------------------------------------------------------------
	it("CONTROL_NO_W2: W1->W1 without W2 commits streaming/11 (control)", async () => {
		render(
			<ExtensionStateContextProvider>
				<CommittedConsumerProbe capture={() => {}} />
			</ExtensionStateContextProvider>,
		)

		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
		})

		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")

			snapshotHandler(makeSnapshot({ turnState: { phase: "idle", seq: 3 } }))
			snapshotHandler(makeSnapshot({ turnState: { phase: "streaming", seq: 11 } }))
		})

		const A = latestRawIncoming()
		const F = latestCommitted()

		expect(A?.turnState).toEqual({ phase: "streaming", seq: 11 })
		expect(F?.turnState).toEqual({ phase: "streaming", seq: 11 })
		expect(A?.turnState).toEqual(F?.turnState)
	})

	// -----------------------------------------------------------------------
	// W4: Plain commit-axis consumer witness. After a W1->W2->W1 sequence,
	// a real `useExtensionState()` consumer reads `streaming/11` from the
	// committed context. This proves the close-clean not just via PTAD but
	// via the consumer that the live UI actually subscribes to.
	// -----------------------------------------------------------------------
	it("CONSUMER_WITNESS: a real useExtensionState() consumer reads streaming/11 after W1->W2->W1", async () => {
		let observedTurnState: TurnState | undefined

		render(
			<ExtensionStateContextProvider>
				<CommittedConsumerProbe
					capture={(ctx) => {
						observedTurnState = ctx.turnState
					}}
				/>
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
				ts: 300,
				seq: 1,
				type: 1,
				say: 4,
				text: "consumer-witness",
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
					turnState: { phase: "streaming", seq: 11 },
					clineMessages: [
						{
							ts: 300,
							seq: 1,
							type: "say",
							say: "consumer-witness",
						} as ExtensionState["clineMessages"][number],
					],
				}),
			)
		})

		// Force a re-render so the consumer's capture fires with the latest state.
		await act(async () => {
			await Promise.resolve()
		})

		expect(observedTurnState).toEqual({ phase: "streaming", seq: 11 })
	})
})
