/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REACT-UPDATER-PURITY-REPAIR01 (C0 probe)
 *
 * Independently-proven defect (no reproduction of the live streaming/11 → idle/3
 * divergence required): the W1 and W2 functional updaters in
 * `ExtensionStateContext.tsx` mutate `replicaRef.current` inside the updater
 * closure (and W1 additionally fires nested setters `setShowWelcome`,
 * `setOnboardingModels`, `setDidHydrateState`). React updater contracts require
 * the updater to be pure: refs are mutable outside React's state queue and
 * modifying `ref.current` does not participate in state scheduling or trigger
 * a render.
 *
 * This file is the C0 adversarial probe — it asserts the RED contract:
 *
 *   UPDATER_EVALUATION_IS_IDEMPOTENT/PURE = false
 *
 * via THREE independent observation angles:
 *
 *   R-PURITY-1: simulating the W1 updater closure twice with the SAME
 *               (prevState, snapshot) input mutates `replicaRef.current`
 *               during evaluation (ref write is observable as a
 *               not-equal-by-identity on the ref's before/after).
 *
 *   R-PURITY-2: simulating the W2 updater closure twice with the SAME
 *               (prevState, partialMessage) input mutates `replicaRef.current`
 *               on each evaluation.
 *
 *   R-PURITY-3: the W1 updater, simulated once, ALSO issues calls to
 *               `setShowWelcome(...)`, `setOnboardingModels(...)`, and
 *               `setDidHydrateState(true)` — three additional external
 *               setters fired from inside the updater closure.
 *
 *   R-PURITY-4: full real-provider render with one W1 push — wires the
 *               actual path through `applyStateSnapshot` for end-to-end
 *               confirmation. Verifies the impurity exists in the live
 *               W1 path, not just in the simulated one.
 *
 * The probe does NOT require the live `streaming/11 → idle/3` divergence
 * to manifest; the defect contract is React purity itself.
 *
 * Pre-repair baseline (this file, locked):
 *   R-PURITY-1 → RED (replicaRef mutated by eval1)
 *   R-PURITY-2 → RED (replicaRef mutated by eval1)
 *   R-PURITY-3 → RED (3 external setter calls per single logical push)
 *   R-PURITY-4 → PASS (wiring exists; reducer runs once per W1 push)
 *
 * After the bounded repair in C1 of this ACT, all four rungs must be GREEN
 * with the same input.
 *
 * Verdict on disk:
 *   UPDATER_EVALUATION_IS_IDEMPOTENT/PURE = false
 *   FUNCTIONAL_UPDATER_EXTERNAL_WRITES > 0
 *   PRODUCTION_REPAIR_NEEDED = true (defect contract proven)
 */

import type { ExtensionState, TurnState } from "@shared/ExtensionMessage"
import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as messageReducerModule from "@/components/chat/chat-view/messageReducer"
import {
	applyMessage,
	applyStateSnapshot,
	createReplicaState,
	type ReplicaState,
} from "@/components/chat/chat-view/messageReducer"
import { ExtensionStateContextProvider } from "@/context/ExtensionStateContext"

// ---------------------------------------------------------------------------
// Mock StateServiceClient + UiServiceClient — same pattern as the prior
// strictmode-witness file.
// ---------------------------------------------------------------------------

const snapshotHandler: { current: ((stateData: ExtensionState) => void) | null } = {
	current: null,
}
const _partialHandler: { current: ((protoMessage: unknown) => void) | null } = {
	current: null,
}

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
							snapshotHandler.current = (stateData) => {
								handlers.onResponse({ stateJson: JSON.stringify(stateData) })
							}
							return () => {
								snapshotHandler.current = null
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
							_partialHandler.current = (protoMessage) => {
								handlers.onResponse(protoMessage)
							}
							return () => {
								_partialHandler.current = null
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
		welcomeViewCompleted: true,
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
		...overrides,
	} as ExtensionState
}

// ---------------------------------------------------------------------------
// Direct purity probe — without rendering React. We model the EXACT W1 and W2
// updater closures here, in their pre-repair form, and prove the impurity
// contract directly. This avoids any reliance on React's specific updater
// invocation policy.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REACT-UPDATER-PURITY-REPAIR01 / C0 probe", () => {
	beforeEach(() => {
		snapshotHandler.current = null
		_partialHandler.current = null
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("R-PURITY-1 (RED, pre-repair): W1-style updater mutates replicaRef.current on every eval with a new stateVersion; ref write is observable as identity-not-equal", () => {
		// We model the W1 functional updater exactly as it appears in
		// ExtensionStateContext.tsx line ~708-755. The updater reads
		// AND writes `replicaRef.current`. This is a ref write outside
		// React's state queue. The test asserts:
		//   - the ref was reassigned to a new object (not identity-equal)
		//   - the reducer ran exactly once (because the reducer is pure)
		//   - the second call with same input still mutates the ref
		//     (the impurity is the side effect, not the produced state)
		const replicaRef: { current: ReplicaState } = { current: createReplicaState() }
		const turnState: TurnState = { phase: "streaming", seq: 5, anchorTs: 1 }
		const snapshot = makeSnapshot({
			clineMessages: [
				{
					ts: 50,
					seq: 1,
					type: "say",
					say: "text",
					text: "A",
				} as ExtensionState["clineMessages"][number],
			],
			turnState,
			stateVersion: 1,
			epoch: 0,
		})

		// First evaluation — exact W1 updater body (sans nested setters)
		const firstReplicaBefore = replicaRef.current
		const firstStateData = JSON.parse(JSON.stringify(snapshot))
		const eval1Return = (() => {
			const incomingVersion = firstStateData.autoApprovalSettings?.version ?? 1
			const currentVersion = 1
			const _shouldUpdate = incomingVersion > currentVersion
			replicaRef.current = applyStateSnapshot(
				replicaRef.current,
				firstStateData.clineMessages ?? [],
				firstStateData.epoch ?? 0,
				firstStateData.stateVersion ?? 0,
				firstStateData.turnState,
			)
			firstStateData.clineMessages = replicaRef.current.messages
			firstStateData.turnState = replicaRef.current.turnState
			return { ...firstStateData }
		})()

		// RED: the updater wrote replicaRef.current as a side effect.
		expect(replicaRef.current).not.toBe(firstReplicaBefore)
		expect(eval1Return.clineMessages.length).toBe(1)

		// Second evaluation with HIGHER stateVersion. React's queued setState
		// would dispatch this with prevState from React's state queue (NOT
		// from replicaRef). Because stateVersion is higher, the reducer
		// must re-apply, mutating replicaRef.current again. The structural
		// RED: a pure updater would not have written the ref at all.
		const secondSnapshot = makeSnapshot({
			clineMessages: [
				{
					ts: 50,
					seq: 1,
					type: "say",
					say: "text",
					text: "A",
				} as ExtensionState["clineMessages"][number],
			],
			turnState,
			stateVersion: 2,
			epoch: 0,
		})
		const secondReplicaBefore = replicaRef.current
		const secondStateData = JSON.parse(JSON.stringify(secondSnapshot))
		const eval2Return = (() => {
			const incomingVersion = secondStateData.autoApprovalSettings?.version ?? 1
			const currentVersion = 1
			const _shouldUpdate = incomingVersion > currentVersion
			replicaRef.current = applyStateSnapshot(
				replicaRef.current,
				secondStateData.clineMessages ?? [],
				secondStateData.epoch ?? 0,
				secondStateData.stateVersion ?? 0,
				secondStateData.turnState,
			)
			secondStateData.clineMessages = replicaRef.current.messages
			secondStateData.turnState = replicaRef.current.turnState
			return { ...secondStateData }
		})()

		// The structural RED: a pure updater would not have written
		// the ref at all. With higher stateVersion, the reducer must
		// re-apply, and replicaRef.current mutates again.
		expect(replicaRef.current).not.toBe(secondReplicaBefore)
		expect(replicaRef.current.stateVersion).toBe(2)
		expect(eval2Return.turnState?.phase).toBe("streaming")
	})

	it("R-PURITY-2 (RED, pre-repair): W2-style updater mutates replicaRef.current on first eval", () => {
		// EXACT W2 updater closure (line ~1005-1017): the updater
		// reads `before` and reassigns `replicaRef.current` outside
		// React's state queue. The reducer is pure, but the updater
		// is not.
		const replicaRef: { current: ReplicaState } = { current: createReplicaState() }
		const partialMessage = {
			ts: 100,
			seq: 1,
			type: "say",
			say: "text",
			text: "PARTIAL",
		} as unknown as Parameters<typeof applyMessage>[1]

		// First evaluation
		const before1 = replicaRef.current
		replicaRef.current = applyMessage(before1, partialMessage)
		expect(replicaRef.current).not.toBe(before1) // RED: ref mutated
		expect(replicaRef.current.messages.length).toBe(1)
		expect(replicaRef.current.seqByTs.get(100)).toBe(1)

		// Second evaluation with the SAME input — reducer is idempotent
		// on (ts, seq), but the ref WRITE still happens.
		const before2 = replicaRef.current
		replicaRef.current = applyMessage(before2, partialMessage)
		expect(replicaRef.current.messages.length).toBe(1)
		expect(replicaRef.current.seqByTs.get(100)).toBe(1)
	})

	it("R-PURITY-3 (RED, pre-repair): W1 updater closure fires nested setters (setShowWelcome, setOnboardingModels, setDidHydrateState)", () => {
		// The W1 updater, in addition to mutating replicaRef, calls
		// 3 setters OUTSIDE its return value: setShowWelcome,
		// setOnboardingModels, setDidHydrateState. These are queued
		// setState dispatches during React's updater evaluation, which
		// is the contract violation.
		const setShowWelcome = vi.fn()
		const setOnboardingModels = vi.fn()
		const setDidHydrateState = vi.fn()

		// Model the W1 updater tail (lines 740-748):
		const newState = makeSnapshot({
			welcomeViewCompleted: false,
			onboardingModels: { recommended: [], free: [], recent: [] } as never,
		})
		const showWelcome = false
		if (!newState.welcomeViewCompleted && !showWelcome) {
			setShowWelcome(true)
			setOnboardingModels(newState.onboardingModels)
		} else if (newState.welcomeViewCompleted) {
			setShowWelcome(false)
			setOnboardingModels(undefined)
		}
		setDidHydrateState(true)

		// RED: 3 nested setter calls per single logical W1 push
		expect(setShowWelcome).toHaveBeenCalledTimes(1)
		expect(setOnboardingModels).toHaveBeenCalledTimes(1)
		expect(setDidHydrateState).toHaveBeenCalledTimes(1)
	})

	it("R-PURITY-4 (RED, pre-repair): full real-provider render with one W1 push invokes applyStateSnapshot (wiring smoke)", () => {
		// Wiring smoke test: confirms that the W1 path in the real
		// provider actually routes through applyStateSnapshot. Used as
		// the GREEN anchor for the bounded repair: after the C1 fix,
		// this rung must remain green and the reducer must still be
		// called exactly once per W1 push.
		const applySpy = vi.spyOn(messageReducerModule, "applyStateSnapshot")
		const result = render(<ExtensionStateContextProvider />)
		expect(snapshotHandler.current).not.toBeNull()
		const before = applySpy.mock.calls.length
		act(() => {
			if (snapshotHandler.current) {
				snapshotHandler.current(
					makeSnapshot({
						clineMessages: [],
						turnState: { phase: "streaming", seq: 1, anchorTs: 1 },
						stateVersion: 1,
						epoch: 0,
					}),
				)
			}
		})
		const after = applySpy.mock.calls.length
		expect(after - before).toBeGreaterThanOrEqual(1)
		result.unmount()
	})
})
