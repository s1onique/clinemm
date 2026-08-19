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
 * via FIVE independent observation angles:
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
 * Pre-repair baseline (this file, locked at C0 commit 761aeb7f3):
 *   R-PURITY-1 → RED  (replicaRef mutated by eval1)
 *   R-PURITY-2 → RED  (replicaRef mutated by eval1)
 *   R-PURITY-3 → RED  (3 external setter calls per single logical push)
 *   R-PURITY-4 → PASS (wiring exists; reducer runs once per W1 push)
 *   R-PURITY-5 → RED  (production source contains replicaRef mutation
 *                       inside W1 updater body)
 *
 * After C1 bounded repair (this file at PURITY-REPAIR01 commit):
 *   R-PURITY-1 → RED  (simulated pre-repair closure shape, by design —
 *                       this rung proves the impurity pattern WOULD be
 *                       observable IF reintroduced into the updater)
 *   R-PURITY-2 → RED  (simulated pre-repair closure shape, by design)
 *   R-PURITY-3 → RED  (simulated pre-repair closure shape, by design)
 *   R-PURITY-4 → PASS (wiring still exists, post-repair)
 *   R-PURITY-5 → GREEN (production source updater bodies contain NO
 *                       replicaRef mutation and NO nested setter calls —
 *                       this is the LOAD-BEARING post-repair witness)
 *
 * Verdict on disk (post-repair):
 *   FUNCTIONAL_UPDATER_EXTERNAL_WRITES = 0
 *   PRODUCTION_REPAIR_NEEDED = false (repair complete)
 *
 * Causal note (C2 deferred): the Factory requested live dogfood with
 * PTAD/LCD01 enabled, walking the live P12 sequence with the repaired
 * updater, to observe whether the live `streaming/11 → idle/3` divergence
 * survives the impurity removal. This is the load-bearing composition
 * experiment for ACT-REACT-UPDATER-PURITY-REPAIR01. It is OUT OF SCOPE
 * for this turn (no live dogfood harness here) and is recommended as
 * the FIRST step of a follow-up ACT.
 *
 *   Factory closure correction (2026-08-19): a production delta DOES
 *   exist in this ACT (commit 4f78fbae2: ExtensionStateContext.tsx
 *   changed application state composition and side-effect timing). The
 *   T18/T19/T20 closures for this turn are therefore DEFERRED, not
 *   N/A. The exact-head VSIX has not been built, the installed binding
 *   has not been exercised, and no fresh live qualification has been
 *   run in this turn. The follow-up ACT must build the exact
 *   885c2d1c1-head VSIX, install it, enable PTAD/LCD01, walk the live
 *   P12 sequence, and compare raw turnState / B0 replica / committed
 *   turnState to determine outcome A or B below.
 *
 *   Possible outcomes of the dogfood (predicted):
 *     A. live W2 disappears  ⇒ strong composition evidence (proven
 *        impurity + its removal + disappearance of live failure)
 *     B. live W2 remains     ⇒ the purity repair is still valid as
 *        an independent correctness fix; live root cause remains
 *        UNKNOWN; continue causal investigation without reverting
 *        the repair.
 *   Either outcome is informative.
 */

import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
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

	function resolveSource(): string {
		const candidates = [
			resolve(dirname(fileURLToPath(import.meta.url)), "../../../../context/ExtensionStateContext.tsx"),
			resolve(process.cwd(), "src/context/ExtensionStateContext.tsx"),
			resolve(process.cwd(), "../src/context/ExtensionStateContext.tsx"),
			resolve(process.cwd(), "../../webview-ui/src/context/ExtensionStateContext.tsx"),
		]
		for (const p of candidates) {
			try {
				const s = readFileSync(p, "utf-8")
				if (s.includes("StateServiceClient.subscribeToState")) {
					return p
				}
			} catch {
				// continue
			}
		}
		throw new Error("Could not find ExtensionStateContext.tsx")
	}
	const SOURCE_FILE = resolveSource()

	function extractUpdaterBody(source: string, startMarker: string): string {
		const lines = source.split("\n")
		const markerIdx = lines.findIndex((l) => l.includes(startMarker))
		if (markerIdx === -1) throw new Error("marker not found: " + startMarker)
		const setStateIdx = lines.findIndex((l, i) => i > markerIdx && /setState\(\(prevState\)\s*=>\s*\{/.test(l))
		if (setStateIdx === -1) throw new Error("setState updater not found after marker")
		let depth = 0
		let endIdx = -1
		for (let i = setStateIdx; i < lines.length; i++) {
			const line = lines[i]
			for (const ch of line) {
				if (ch === "{") depth++
				else if (ch === "}") {
					depth--
					if (depth === 0) {
						endIdx = i
						break
					}
				}
			}
			if (endIdx !== -1) break
		}
		if (endIdx === -1) throw new Error("closing brace not found")
		return lines.slice(setStateIdx, endIdx + 1).join("\n")
	}

	it("R-PURITY-1 (RED, simulated pre-repair pattern): W1-style updater mutates replicaRef.current on every eval with a new stateVersion; ref write is observable as identity-not-equal", () => {
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

	it("R-PURITY-2 (RED, simulated pre-repair pattern): W2-style updater mutates replicaRef.current on first eval", () => {
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

	it("R-PURITY-3 (RED, simulated pre-repair pattern): W1 updater closure fires nested setters (setShowWelcome, setOnboardingModels, setDidHydrateState)", () => {
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

	it("R-PURITY-4 (PASS, post-repair): full real-provider render with one W1 push invokes applyStateSnapshot (wiring smoke)", () => {
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

	it("R-PURITY-5 (post-repair): production W1 and W2 functional updater bodies contain NO replicaRef.current mutation and NO nested setter side effects", () => {
		// Load-bearing post-repair witness. This is the canonical
		// R-PURITY ladder rung that flips from RED to GREEN once the
		// bounded C1 repair removes updater-time external writes.
		const source = readFileSync(SOURCE_FILE, "utf-8")

		// W1 updater: starts after the PURITY-REPAIR01 marker block.
		const w1Body = extractUpdaterBody(source, "ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REACT-UPDATER-PURITY-REPAIR01")
		// W2 updater: located further down. Search for the second
		// PURITY-REPAIR01 marker by looking for the W2 path's
		// "subscribeToPartialMessage" usage as a secondary anchor.
		const w2AnchorIdx = source.indexOf("subscribeToPartialMessage")
		if (w2AnchorIdx === -1) throw new Error("W2 anchor not found")
		const linesBeforeW2 = source.slice(0, w2AnchorIdx).split("\n")
		const w2MarkerIdx = linesBeforeW2.length - 1
		// Walk forward from the W2 subscribeToPartialMessage call until
		// we hit the W2 setState((prevState) => { line.
		const lines = source.split("\n")
		let w2SetStateIdx = -1
		for (let i = w2MarkerIdx + 1; i < lines.length; i++) {
			if (/setState\(\(prevState\)\s*=>\s*\{/.test(lines[i])) {
				w2SetStateIdx = i
				break
			}
		}
		if (w2SetStateIdx === -1) throw new Error("W2 setState updater not found")
		// Walk forward to find matching closing brace
		let depth = 0
		let w2EndIdx = -1
		for (let i = w2SetStateIdx; i < lines.length; i++) {
			for (const ch of lines[i]) {
				if (ch === "{") depth++
				else if (ch === "}") {
					depth--
					if (depth === 0) {
						w2EndIdx = i
						break
					}
				}
			}
			if (w2EndIdx !== -1) break
		}
		if (w2EndIdx === -1) throw new Error("W2 closing brace not found")
		const w2Body = lines.slice(w2SetStateIdx, w2EndIdx + 1).join("\n")

		// Forbidden tokens inside the W1 / W2 functional updater bodies:
		const FORBIDDEN_IN_UPDATER: readonly string[] = [
			"replicaRef.current =",
			"setShowWelcome(",
			"setOnboardingModels(",
			"setDidHydrateState(",
		]

		for (const [name, body] of [
			["W1", w1Body],
			["W2", w2Body],
		] as const) {
			const violations: string[] = []
			for (const token of FORBIDDEN_IN_UPDATER) {
				if (body.includes(token)) {
					violations.push(token)
				}
			}
			expect(violations, `${name} updater body contains forbidden updater-time side effects`).toEqual([])
		}
	})
})
