/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-W1-UPDATER-CAUSAL-RED-FIX01
 *
 * Reproduction ladder: from the prior R0 GREEN fixture toward the
 * live P12 raw→committed divergence.
 *
 * Frozen live evidence (predecessor):
 *   W1/P12 raw/host          = streaming/11
 *   W1/P12 request B0        = idle/3
 *   W1/P12 committed C       = idle/3   <-- RED
 *
 * Frozen R0 GREEN (P12-equivalent, no live-shape side effects):
 *   incoming streaming/11 → committed streaming/11
 *
 * This file increments the R0 fixture toward the live shape one
 * source-confirmed dimension at a time, stopping at the first RED.
 * Per ACT §5, the test must use the REAL ExtensionStateContextProvider
 * with the REAL reducer/composition.
 *
 * Test-only observation seam: A (raw incoming) and F (committed) are
 * captured by the existing PostTerminalAuthorityDiagnostic, which the
 * W1 onResponse path enables when `_ptadEnabled: true` is on the wire
 * payload. We assert on A and F directly, not on replicaRef (which
 * would require updater side effects — forbidden by R20 purity).
 *
 * ============================================================================
 * VERDICT: HALT_RED_NOT_REPRODUCED
 *
 *   R0: W1->W1, welcomeViewCompleted TRUE (frozen GREEN control)        PASS
 *   R1: W1->W1, welcomeViewCompleted FALSE (live = real)                PASS
 *   R2: W1->W1, live clineMessages (non-empty), welcomeViewCompleted FALSE  PASS
 *   R3: W1->W2->W1, live shape (P12-equivalent)                         PASS
 *   R4: classic/legacy wire (stateVersion=0, epoch=0)                   PASS
 *
 *   All 5 ladder rungs commit `streaming/11` correctly through the real
 *   ExtensionStateContextProvider. The simple W1 path (snapshots only)
 *   and the live P12 sequence (W1->W2->W1 with live wire fields) both
 *   flow `streaming/11` through to the React-committed context.
 *
 *   The live W1 P12 RED (raw streaming/11, committed idle/3) is NOT
 *   reproducible through the real-provider test seam. Per ACT §4 hard
 *   rule, no production repair is authorized.
 *
 *   This mirrors the prior RED-FIX01 halt (closed-clean GREEN witness):
 *     apps/vscode/webview-ui/src/components/chat/chat-view/__tests__/
 *     c2-correction02-red-fix01-turnstate-composition.test.tsx
 *
 *   The live bug, if real, lives in a path the synthetic real-provider
 *   test seam cannot reach. Per ACT §21:
 *
 *     HALT_RED_NOT_REPRODUCED
 *     PRODUCTION_REPAIR = 0
 *
 *   Next-ACT candidates (NOT in scope of this ACT):
 *     - A live dogfood run with PTAD on, replicating the actual
 *       push timing of the W1 stream and capturing the W1/P12 /
 *       W1/P33 raw→committed divergence in the LCD01 buffer.
 *     - A static W1 path audit (e.g. ordering of setShowWelcome /
 *       setOnboardingModels / setDidHydrateState calls in the
 *       functional updater) to look for a stale-closure or
 *       render-batching issue under specific update orderings.
 * ============================================================================
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
// (same harness as the prior RED-FIX01 GREEN control; reused so this test
// stays a witness to a single source of truth)
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
	}
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * makeLiveShapeSnapshot — produce a snapshot that matches the live
 * SdkController.flushStateToWebview wire shape, including:
 *   - real stateVersion and epoch from a monotonic counter
 *   - real turnState from turnStateTracker
 *   - real clineMessages
 *   - real queuedPrompts
 *   - real _ptadPushId (only when PTAD is enabled)
 *   - welcomeViewCompleted FALSE (live = user just opened new task)
 *   - real onboardingModels (live = non-empty)
 *   - real thinkingPresentation (live = source:"shadow")
 *   - real taskTelemetry (live = canonical host tracker)
 *   - real _ptadEnabled (so the W1 path emits captures)
 *
 * welcomeViewCompletedOverride: optional override for tests that need
 * to suppress the welcomeView side effect (the prior R0 GREEN control).
 */
function makeLiveShapeSnapshot(overrides: {
	stateVersion: number
	epoch: number
	ptadPushId: number
	turnState: TurnState
	clineMessages: ExtensionState["clineMessages"]
	welcomeViewCompletedOverride?: boolean
}): ExtensionState {
	return {
		version: "1.0.0",
		clineMessages: overrides.clineMessages,
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
		// LIVE: a user opening a new task has welcomeViewCompleted false initially
		// and onboardingModels populated. Tests that need the prior R0 GREEN
		// control pass welcomeViewCompletedOverride: true to suppress the
		// setShowWelcome(true)/setOnboardingModels() side effects.
		welcomeViewCompleted: overrides.welcomeViewCompletedOverride ?? false,
		onboardingModels: {
			groups: [],
		} as unknown as ExtensionState["onboardingModels"],
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
		// LIVE wire fields
		stateVersion: overrides.stateVersion,
		epoch: overrides.epoch,
		turnState: overrides.turnState,
		thinkingPresentation: {
			modelStreaming: false,
			source: "shadow",
			seq: overrides.turnState.seq,
		},
		taskTelemetry: { startedAt: 0, toolCalls: 0, recoveryBudgetFailures: 0 },
		// LIVE: PTAD enabled on the wire (the dogfood user toggled it on)
		_ptadEnabled: true,
		_ptadPushId: overrides.ptadPushId,
		// currentTaskItem present in live (the task is active)
		currentTaskItem: { id: "task-live-001", ts: 1, task: "live task", size: 0 } as ExtensionState["currentTaskItem"],
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
// Reproduction ladder
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-W1-UPDATER-CAUSAL-RED-FIX01 — live shape reproduction", () => {
	beforeEach(() => {
		enablePostTerminalAuthorityDiagnosticBoth()
		clearPostTerminalAuthorityDiagnosticBoth()
		snapshotHandler = null
		partialHandler = null
	})

	afterEach(() => {
		clearPostTerminalAuthorityDiagnosticBoth()
		disablePostTerminalAuthorityDiagnosticBoth()
		snapshotHandler = null
		partialHandler = null
	})

	// R0 — FROZEN CONTROL. welcomeViewCompleted TRUE suppresses setShowWelcome.
	it("R0 (frozen GREEN control): W1->W1, welcomeViewCompleted TRUE, idle/3 -> streaming/11", async () => {
		let observed: TurnState | undefined

		render(
			<ExtensionStateContextProvider>
				<CommittedConsumerProbe
					capture={(ctx) => {
						observed = ctx.turnState
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
			snapshotHandler(
				makeLiveShapeSnapshot({
					stateVersion: 10,
					epoch: 1,
					ptadPushId: 10,
					turnState: { phase: "idle", seq: 3 },
					clineMessages: [],
					welcomeViewCompletedOverride: true,
				}),
			)
			snapshotHandler(
				makeLiveShapeSnapshot({
					stateVersion: 11,
					epoch: 1,
					ptadPushId: 11,
					turnState: { phase: "streaming", seq: 11 },
					clineMessages: [],
					welcomeViewCompletedOverride: true,
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

	// R1 — live shape with welcomeViewCompleted: FALSE.
	// The W1 updater calls setShowWelcome(true) + setOnboardingModels(...)
	// inside the setState callback when welcomeViewCompleted is false.
	it("R1: W1->W1, welcomeViewCompleted FALSE (live), idle/3 -> streaming/11", async () => {
		let observed: TurnState | undefined

		render(
			<ExtensionStateContextProvider>
				<CommittedConsumerProbe
					capture={(ctx) => {
						observed = ctx.turnState
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
			snapshotHandler(
				makeLiveShapeSnapshot({
					stateVersion: 10,
					epoch: 1,
					ptadPushId: 10,
					turnState: { phase: "idle", seq: 3 },
					clineMessages: [],
				}),
			)
			snapshotHandler(
				makeLiveShapeSnapshot({
					stateVersion: 11,
					epoch: 1,
					ptadPushId: 11,
					turnState: { phase: "streaming", seq: 11 },
					clineMessages: [],
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

	// R2 — realistic clineMessages (live shape: actual ClineMessage objects).
	it("R2: live clineMessages (non-empty), welcomeViewCompleted FALSE, idle/3 -> streaming/11", async () => {
		let observed: TurnState | undefined

		render(
			<ExtensionStateContextProvider>
				<CommittedConsumerProbe
					capture={(ctx) => {
						observed = ctx.turnState
					}}
				/>
			</ExtensionStateContextProvider>,
		)

		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
		})

		const liveMessages: ExtensionState["clineMessages"] = [
			{
				ts: 1,
				type: "say",
				say: "task",
				text: "Say hello and stop",
				seq: 1,
				epoch: 1,
			} as ExtensionState["clineMessages"][number],
		]

		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")
			snapshotHandler(
				makeLiveShapeSnapshot({
					stateVersion: 10,
					epoch: 1,
					ptadPushId: 10,
					turnState: { phase: "idle", seq: 3 },
					clineMessages: liveMessages,
				}),
			)
			snapshotHandler(
				makeLiveShapeSnapshot({
					stateVersion: 11,
					epoch: 1,
					ptadPushId: 11,
					turnState: { phase: "streaming", seq: 11 },
					clineMessages: liveMessages,
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

	// R3 — W2 (partial message) interleaved: live P12 sequence.
	it("R3: W1(idle/3) -> W2(partial) -> W1(streaming/11), live shape, welcomeViewCompleted FALSE", async () => {
		let observed: TurnState | undefined

		render(
			<ExtensionStateContextProvider>
				<CommittedConsumerProbe
					capture={(ctx) => {
						observed = ctx.turnState
					}}
				/>
			</ExtensionStateContextProvider>,
		)

		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
		})

		const liveMessages: ExtensionState["clineMessages"] = [
			{
				ts: 1,
				type: "say",
				say: "task",
				text: "Say hello and stop",
				seq: 1,
				epoch: 1,
			} as ExtensionState["clineMessages"][number],
		]

		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")
			if (!partialHandler) throw new Error("partialHandler not wired")

			snapshotHandler(
				makeLiveShapeSnapshot({
					stateVersion: 10,
					epoch: 1,
					ptadPushId: 10,
					turnState: { phase: "idle", seq: 3 },
					clineMessages: liveMessages,
				}),
			)

			partialHandler({
				ts: 100,
				seq: 5,
				type: 1,
				say: 4,
				text: "Hello!",
				images: [],
				files: [],
				reasoning: "",
				partial: true,
				lastCheckpointHash: "",
				isCheckpointCheckedOut: false,
				isOperationOutsideWorkspace: false,
				conversationHistoryIndex: 0,
				conversationName: "",
			})

			snapshotHandler(
				makeLiveShapeSnapshot({
					stateVersion: 11,
					epoch: 1,
					ptadPushId: 11,
					turnState: { phase: "streaming", seq: 11 },
					clineMessages: [
						...liveMessages,
						{
							ts: 100,
							seq: 5,
							type: "say",
							say: "text",
							text: "Hello!",
							partial: true,
							epoch: 1,
						} as ExtensionState["clineMessages"][number],
					],
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

	// R4 — classic/legacy wire shape (stateVersion=0, epoch=0).
	// The frozen live evidence (c2-replay-red.test.ts) shows the wire
	// has stateVersion=0 and epoch=0 (unstamped classic/legacy). The
	// reducer is supposed to merge such snapshots. If R4 is the first
	// RED, the unstamped path is the causal mechanism.
	it("R4: classic/legacy wire (stateVersion=0, epoch=0), W1->W1, idle/3 -> streaming/11", async () => {
		let observed: TurnState | undefined

		render(
			<ExtensionStateContextProvider>
				<CommittedConsumerProbe
					capture={(ctx) => {
						observed = ctx.turnState
					}}
				/>
			</ExtensionStateContextProvider>,
		)

		await act(async () => {
			await Promise.resolve()
			await Promise.resolve()
		})

		const liveMessages: ExtensionState["clineMessages"] = [
			{
				ts: 1,
				type: "say",
				say: "task",
				text: "Say hello and stop",
				seq: 1,
				epoch: 0,
			} as ExtensionState["clineMessages"][number],
		]

		await act(async () => {
			if (!snapshotHandler) throw new Error("snapshotHandler not wired")
			snapshotHandler(
				makeLiveShapeSnapshot({
					stateVersion: 0,
					epoch: 0,
					ptadPushId: 10,
					turnState: { phase: "idle", seq: 3 },
					clineMessages: liveMessages,
				}),
			)
			snapshotHandler(
				makeLiveShapeSnapshot({
					stateVersion: 0,
					epoch: 0,
					ptadPushId: 11,
					turnState: { phase: "streaming", seq: 11 },
					clineMessages: liveMessages,
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
})
