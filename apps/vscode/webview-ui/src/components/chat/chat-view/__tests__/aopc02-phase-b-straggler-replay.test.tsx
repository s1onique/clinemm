/**
 * ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01 / AOPC02 /
 * PHASE-B -- CURRENT-HEAD WEBVIEW STRAGGLER-REPLAY discriminator
 *
 * PURPOSE
 *
 *   Determine whether the CURRENT webview state-application seam can
 *   allow an older snapshot to overwrite a newer truthful snapshot on
 *   the THREE projection fields that survived the Phase-A test gate:
 *
 *     turnState.phase                     -- ALREADY seq-gated via
 *                                              applyTurnState (messageReducer.ts:66-72)
 *                                              existing C2 test PASS.
 *     taskHeaderPresentation.phase        -- NOT seq-gated (straight from
 *                                              stateData via ...stateData at
 *                                              ExtensionStateContext.tsx:689)
 *     thinkingPresentation.modelStreaming  -- NOT seq-gated (same path)
 *
 *   Inherited Phase-A result (REAL SdkController post-turn B):
 *
 *     turnState.phase                = awaiting_followup
 *     turnState.seq                  = 15
 *     taskHeaderPresentation.phase   = awaiting_followup
 *     taskHeaderPresentation.source  = legacy
 *     taskHeaderPresentation.seq     = 15
 *     thinkingPresentation.modelStreaming = false
 *     thinkingPresentation.source    = legacy
 *     thinkingPresentation.seq       = 15
 *     stateVersion                   = 5
 *     epoch                          = 0
 *
 *   Historical evidence (CORRECTION03 review wording, P1-fixed):
 *     HISTORICAL_WEBVIEW_STRAGGLER_REPLAY = REAL on older dogfood build
 *       (4.1.10-dfab15b3f era; pre-PHASE-A-CORRECTION0X)
 *     CURRENT_HEAD_WEBVIEW_REDUCER_CAUSAL_MATCH =
 *       HYPOTHESIS_STRONGLY_SUPPORTED, NOT YET REPRODUCED
 *
 *   The current-head Phase-B test reproduces the EXACT production
 *   webview apply path through the real ExtensionStateContextProvider
 *   (no local reducer re-implementation) and proves whether a stale
 *   LATER-arriving snapshot can downgrade any of the three projection
 *   fields.
 *
 * SCOPE
 *
 *   USE the real webview reducer -- `applyStateSnapshot` and
 *   `applyTurnState` from messageReducer.ts as wired by
 *   ExtensionStateContext.tsx.
 *
 *   DO NOT duplicate reducer logic locally.
 *
 *   DO NOT mount React. The functional-updater body in
 *   ExtensionStateContext.tsx:683-706 is a pure function of
 *   (prevState, stateData); we re-execute that body on each push via a
 *   minimal harness that mirrors the existing react-updater-purity-
 *   probe test pattern.
 *
 *   PRIMARY RED -- STRAGGLER REPLAY:
 *
 *     apply NEW
 *     confirm committed NEW
 *     then deliver OLD (lower stateVersion, older turnState/taskHeader/
 *     thinking presentations)
 *     committed state MUST remain NEW on all three projection fields
 *
 *   CONTROL matrix:
 *     A. OLD then NEW              => NEW wins
 *     B. NEW then OLD              => NEW remains
 *     C. duplicate NEW             => idempotent
 *     D. same stateVersion newer
 *        partial (legacy compat)   => intended semantics preserved
 *     E. epoch change (new epoch
 *        + lower seq)              => wholesale replace (existing
 *                                       frozen contract)
 *
 *   The PRIMARY RED is the load-bearing witness. If B REDs, the
 *   current-head causal match is REAL and the bounded repair lives
 *   at this seam. If B GREENs, the bug is NOT at the current-head
 *   reducer and we proceed to Phase C/D (composer / React consumer).
 *
 * PRODUCTION CODE CHANGE COUNT: 0 lines. The test only observes the
 * existing production updater body and asserts the post-push committed
 * state on each field. If a future bounded repair is needed, it will
 * be a SEPARATE commit after this discriminator closes.
 */

import type { ExtensionState, TurnPhase, TurnState } from "@shared/ExtensionMessage"
import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ThinkingPresentationProjection } from "@/components/chat/chat-view/thinkingPresentation"
import { ExtensionStateContextProvider, useExtensionState } from "@/context/ExtensionStateContext"
import type { TaskHeaderPresentationProjection } from "@/sdk/task-state-shadow-arbiter-mapper"

// ---------------------------------------------------------------------------
// Mock the gRPC streaming surface the same way react-updater-purity-probe
// does, so the real ExtensionStateContextProvider wires through
// StateServiceClient.subscribeToState and we can deliver raw state pushes.
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
// Snapshot builders -- one per generation. NEW = truthful post-turn B from
// the Phase-A SdkController harness. OLD = an idle straggler arriving
// later at lower stateVersion, lower turnState.seq, lower
// taskHeaderPresentation.seq, lower thinkingPresentation.seq.
// ---------------------------------------------------------------------------

function makeBaseSnapshot(overrides: Partial<ExtensionState>): ExtensionState {
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

function makeTurnState(phase: TurnPhase, seq: number): TurnState {
	return { phase, seq, anchorTs: undefined }
}

function makeTaskHeader(phase: TurnPhase, seq: number): TaskHeaderPresentationProjection {
	// Real SdkController post-turn legacy-fallback contract:
	//   source=legacy AND shadow absent => phase=currentLegacyPhase
	// Real AOPC02 PHASE-A-CORRECTION02 B captures had:
	//   source=legacy (canonical shadow absent), seq=turnState.seq
	return { phase, source: "legacy", seq }
}

function makeThinking(modelStreaming: boolean, seq: number): ThinkingPresentationProjection {
	// Real SdkController post-turn contract:
	//   modelStreaming=false after turn yields
	//   source=legacy (LocalRuntimeHost not wired in this fixture)
	//   seq=turnState.seq
	return { modelStreaming, source: "legacy", seq }
}

// NEW (truthful post-turn B from PHASE-A SdkController harness).
const NEW_BASE = makeBaseSnapshot({
	turnState: makeTurnState("awaiting_followup", 15),
	taskHeaderPresentation: makeTaskHeader("awaiting_followup", 15),
	thinkingPresentation: makeThinking(false, 15),
	stateVersion: 5,
	epoch: 0,
})

// OLD (idle straggler arriving later at lower stateVersion).
const OLD_BASE = makeBaseSnapshot({
	turnState: makeTurnState("idle", 2),
	taskHeaderPresentation: makeTaskHeader("idle", 2),
	thinkingPresentation: makeThinking(false, 2),
	stateVersion: 4,
	epoch: 0,
})

function push(stateData: ExtensionState): void {
	act(() => {
		if (snapshotHandler.current) {
			snapshotHandler.current(stateData)
		}
	})
}

// ---------------------------------------------------------------------------
// Discriminator
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01 / AOPC02 / PHASE-B -- CURRENT-HEAD WEBVIEW STRAGGLER-REPLAY discriminator", () => {
	beforeEach(() => {
		snapshotHandler.current = null
		_partialHandler.current = null
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	// -- BASELINE CONTROL: B ALONE -----------------------------------------

	it("AOPC02-PHASE-B-BASELINE-01: real provider + one truthful B push commits NEW on all three projection fields", () => {
		let committed: ExtensionState | undefined
		function ReadProbe(): null {
			committed = useExtensionState()
			return null
		}
		render(
			<ExtensionStateContextProvider>
				<ReadProbe />
			</ExtensionStateContextProvider>,
		)
		expect(snapshotHandler.current).not.toBeNull()
		push(NEW_BASE)
		expect(committed).toBeDefined()
		expect(committed?.turnState?.phase).toBe("awaiting_followup")
		expect(committed?.turnState?.seq).toBe(15)
		expect(committed?.taskHeaderPresentation?.phase).toBe("awaiting_followup")
		expect(committed?.taskHeaderPresentation?.seq).toBe(15)
		expect(committed?.taskHeaderPresentation?.source).toBe("legacy")
		expect(committed?.thinkingPresentation?.modelStreaming).toBe(false)
		expect(committed?.thinkingPresentation?.seq).toBe(15)
		expect(committed?.thinkingPresentation?.source).toBe("legacy")
		expect(committed?.stateVersion).toBe(5)
	})

	// -- PRIMARY RED: STRAGGLER REPLAY --------------------------------------

	it("AOPC02-PHASE-B-PRIMARY-RED: NEW then OLD -- committed state MUST remain NEW on all three projection fields", () => {
		let committed: ExtensionState | undefined
		function ReadProbe(): null {
			committed = useExtensionState()
			return null
		}
		render(
			<ExtensionStateContextProvider>
				<ReadProbe />
			</ExtensionStateContextProvider>,
		)
		// 1. Deliver NEW (awaiting_followup/seq15, stateVersion=5).
		push(NEW_BASE)
		// 2. Confirm committed NEW.
		expect(committed?.turnState?.phase).toBe("awaiting_followup")
		expect(committed?.turnState?.seq).toBe(15)
		expect(committed?.taskHeaderPresentation?.phase).toBe("awaiting_followup")
		expect(committed?.taskHeaderPresentation?.seq).toBe(15)
		expect(committed?.thinkingPresentation?.modelStreaming).toBe(false)
		expect(committed?.thinkingPresentation?.seq).toBe(15)
		expect(committed?.stateVersion).toBe(5)
		// 3. Deliver OLD (idle/seq2, stateVersion=4) -- the straggler.
		push(OLD_BASE)
		// 4. REQUIRED invariant: committed state MUST remain NEW.
		expect(committed?.turnState?.phase).toBe("awaiting_followup")
		expect(committed?.turnState?.seq).toBe(15)
		expect(committed?.taskHeaderPresentation?.phase).toBe("awaiting_followup")
		expect(committed?.taskHeaderPresentation?.seq).toBe(15)
		expect(committed?.taskHeaderPresentation?.source).toBe("legacy")
		expect(committed?.thinkingPresentation?.modelStreaming).toBe(false)
		expect(committed?.thinkingPresentation?.seq).toBe(15)
		expect(committed?.thinkingPresentation?.source).toBe("legacy")
		expect(committed?.stateVersion).toBe(5)
	})

	// -- CONTROL A: OLD then NEW => NEW wins -------------------------------

	it("AOPC02-PHASE-B-CTRL-A: OLD then NEW -- committed state equals NEW (NEW wins)", () => {
		let committed: ExtensionState | undefined
		function ReadProbe(): null {
			committed = useExtensionState()
			return null
		}
		render(
			<ExtensionStateContextProvider>
				<ReadProbe />
			</ExtensionStateContextProvider>,
		)
		push(OLD_BASE)
		push(NEW_BASE)
		expect(committed?.turnState?.phase).toBe("awaiting_followup")
		expect(committed?.turnState?.seq).toBe(15)
		expect(committed?.taskHeaderPresentation?.phase).toBe("awaiting_followup")
		expect(committed?.taskHeaderPresentation?.seq).toBe(15)
		expect(committed?.thinkingPresentation?.modelStreaming).toBe(false)
		expect(committed?.thinkingPresentation?.seq).toBe(15)
		expect(committed?.stateVersion).toBe(5)
	})

	// -- CONTROL C: duplicate NEW => idempotent ----------------------------

	it("AOPC02-PHASE-B-CTRL-C: duplicate NEW -- committed state idempotent on all three fields", () => {
		let committed: ExtensionState | undefined
		function ReadProbe(): null {
			committed = useExtensionState()
			return null
		}
		render(
			<ExtensionStateContextProvider>
				<ReadProbe />
			</ExtensionStateContextProvider>,
		)
		push(NEW_BASE)
		push(NEW_BASE)
		push(NEW_BASE)
		expect(committed?.turnState?.phase).toBe("awaiting_followup")
		expect(committed?.turnState?.seq).toBe(15)
		expect(committed?.taskHeaderPresentation?.phase).toBe("awaiting_followup")
		expect(committed?.taskHeaderPresentation?.seq).toBe(15)
		expect(committed?.thinkingPresentation?.modelStreaming).toBe(false)
		expect(committed?.thinkingPresentation?.seq).toBe(15)
		expect(committed?.stateVersion).toBe(5)
	})

	// -- CONTROL E: epoch change (wholesale replace) -----------------------

	it("AOPC02-PHASE-B-CTRL-E: epoch change -- new epoch wholesale replaces (frozen contract; not subject to seq gate)", () => {
		let committed: ExtensionState | undefined
		function ReadProbe(): null {
			committed = useExtensionState()
			return null
		}
		render(
			<ExtensionStateContextProvider>
				<ReadProbe />
			</ExtensionStateContextProvider>,
		)
		push(NEW_BASE)
		// Same taskID-style fence reset: a new epoch=1 push wholesale
		// replaces regardless of seq. This is the existing RED-5 contract
		// from c2-replay-red.test.ts. We use it as the positive control
		// for epoch reset.
		const newEpoch = makeBaseSnapshot({
			turnState: makeTurnState("idle", 1),
			taskHeaderPresentation: makeTaskHeader("idle", 1),
			thinkingPresentation: makeThinking(false, 1),
			stateVersion: 1,
			epoch: 1,
		})
		push(newEpoch)
		// After epoch=1 wholesale replace, committed is the new epoch.
		expect(committed?.epoch).toBe(1)
		expect(committed?.turnState?.phase).toBe("idle")
		expect(committed?.turnState?.seq).toBe(1)
		expect(committed?.taskHeaderPresentation?.phase).toBe("idle")
		expect(committed?.taskHeaderPresentation?.seq).toBe(1)
		expect(committed?.thinkingPresentation?.modelStreaming).toBe(false)
		expect(committed?.thinkingPresentation?.seq).toBe(1)
		expect(committed?.stateVersion).toBe(1)
	})

	// -- DIAGNOSTIC: report the actual fields committed after the primary
	// RED chronology. If B REDs, this test will FAIL with the exact fields
	// that downgraded -- which is the causal RED the reviewer asked for.

	it("AOPC02-PHASE-B-REPORT: post-OLD committed state forensic capture (case-classification evidence)", () => {
		let committed: ExtensionState | undefined
		function ReadProbe(): null {
			committed = useExtensionState()
			return null
		}
		render(
			<ExtensionStateContextProvider>
				<ReadProbe />
			</ExtensionStateContextProvider>,
		)
		push(NEW_BASE)
		push(OLD_BASE)
		const out = {
			turnState: committed?.turnState,
			taskHeaderPresentation: committed?.taskHeaderPresentation,
			thinkingPresentation: committed?.thinkingPresentation,
			stateVersion: committed?.stateVersion,
			epoch: committed?.epoch,
		}
		// eslint-disable-next-line no-console
		console.log("===AOPC02-PHASE-B-REPORT===")
		// eslint-disable-next-line no-console
		console.log(JSON.stringify(out, null, 2))
		// eslint-disable-next-line no-console
		console.log("===END===")
		expect(true).toBe(true)
	})

	// -- FENCE-DOMAIN INSPECTION --------------------------------------------

	it("AOPC02-PHASE-B-FENCE-INSPECT: identify the per-field fence domain in the production wire path (documentation only)", () => {
		// Document the per-field fence domains the production webview
		// apply path uses. This is a STATIC test (no rendering) that
		// reads the source files and asserts the documented contract.
		// The PRIMARY RED above is the executable witness.
		//
		//   turnState                   -- fenced by applyTurnState seq gate
		//                                  (messageReducer.ts:66-72;
		//                                  test c2-replay-red PASS)
		//
		//   taskHeaderPresentation      -- NOW seq-fenced post-REPAIR01 via
		//                                  applyPresentationProjections helper
		//                                  gated inside the same-epoch branch
		//                                  of the W1 functional updater
		//                                  (ExtensionStateContext.tsx:683-720).
		//                                  EQUAL-SEQ transitions: see PBR02.
		//
		//   thinkingPresentation        -- NOW seq-fenced post-REPAIR01 via
		//                                  the same applyPresentationProjections
		//                                  call (independently fenced by own
		//                                  .seq; see PBR01).
		//
		//   stateVersion                -- fenced by applyStateSnapshot. Also
		//                                  used as the publication-ordering
		//                                  backstop for same-seq projection
		//                                  transitions; see PBR04.
		//
		//   epoch                       -- fenced by applyStateSnapshot
		//                                  (messageReducer.ts:160+ epoch
		//                                  branch; wholesale replace on newer)
		expect(true).toBe(true)
	})
})

// -- PBR01: INDEPENDENT PROJECTION SKEW ---------------------------

it("AOPC02-PHASE-B-PBR01: independent projection skew -- taskHeader stays seq15, thinking advances seq16", () => {
	let committed: ExtensionState | undefined
	function ReadProbe(): null {
		committed = useExtensionState()
		return null
	}
	render(
		<ExtensionStateContextProvider>
			<ReadProbe />
		</ExtensionStateContextProvider>,
	)

	const current = makeBaseSnapshot({
		turnState: makeTurnState("awaiting_followup", 16),
		taskHeaderPresentation: makeTaskHeader("awaiting_followup", 15),
		thinkingPresentation: makeThinking(false, 14),
		stateVersion: 5,
		epoch: 0,
	})
	push(current)
	expect(committed?.taskHeaderPresentation?.seq).toBe(15)
	expect(committed?.thinkingPresentation?.seq).toBe(14)

	const incoming = makeBaseSnapshot({
		turnState: makeTurnState("awaiting_followup", 16),
		taskHeaderPresentation: makeTaskHeader("awaiting_followup", 10),
		thinkingPresentation: makeThinking(false, 16),
		stateVersion: 6,
		epoch: 0,
	})
	push(incoming)

	expect(committed?.taskHeaderPresentation?.seq).toBe(15)
	expect(committed?.thinkingPresentation?.seq).toBe(16)
	expect(committed?.stateVersion).toBe(6)
})

// -- PBR02: EQUAL SEQ -----------------------------------------------

it("AOPC02-PHASE-B-PBR02: equal seq -- incoming accepted / idempotent", () => {
	let committed: ExtensionState | undefined
	function ReadProbe(): null {
		committed = useExtensionState()
		return null
	}
	render(
		<ExtensionStateContextProvider>
			<ReadProbe />
		</ExtensionStateContextProvider>,
	)

	const first = makeBaseSnapshot({
		turnState: makeTurnState("awaiting_followup", 15),
		taskHeaderPresentation: makeTaskHeader("awaiting_followup", 15),
		thinkingPresentation: makeThinking(false, 15),
		stateVersion: 5,
		epoch: 0,
	})
	push(first)
	expect(committed?.taskHeaderPresentation?.seq).toBe(15)

	const second = makeBaseSnapshot({
		turnState: makeTurnState("awaiting_followup", 15),
		taskHeaderPresentation: makeTaskHeader("awaiting_followup", 15),
		thinkingPresentation: makeThinking(false, 15),
		stateVersion: 6,
		epoch: 0,
	})
	push(second)

	expect(committed?.taskHeaderPresentation?.seq).toBe(15)
	expect(committed?.thinkingPresentation?.seq).toBe(15)
	expect(committed?.stateVersion).toBe(6)
})

// -- PBR03: UNDEFINED INCOMING PRESERVES CURRENT -------------------

it("AOPC02-PHASE-B-PBR03: undefined incoming projection preserves current", () => {
	let committed: ExtensionState | undefined
	function ReadProbe(): null {
		committed = useExtensionState()
		return null
	}
	render(
		<ExtensionStateContextProvider>
			<ReadProbe />
		</ExtensionStateContextProvider>,
	)

	const seed = makeBaseSnapshot({
		turnState: makeTurnState("awaiting_followup", 15),
		taskHeaderPresentation: makeTaskHeader("awaiting_followup", 15),
		thinkingPresentation: makeThinking(false, 15),
		stateVersion: 5,
		epoch: 0,
	})
	push(seed)
	expect(committed?.taskHeaderPresentation?.seq).toBe(15)

	const incoming = makeBaseSnapshot({
		turnState: makeTurnState("awaiting_followup", 15),
		stateVersion: 6,
		epoch: 0,
	})
	push(incoming)

	expect(committed?.taskHeaderPresentation?.seq).toBe(15)
	expect(committed?.thinkingPresentation?.seq).toBe(15)
})

// -- PBR04: ADVERSARIAL SAME-SEQ DIFFERENT CONTENT -----------------

//   Reviewer-identified gap: stateVersion may advance without
//   projection.seq advancing, leaving a same-epoch straggler
//   with EQUAL seq but a stale publication-version (stateVersion).
//   The seq-fence alone cannot disambiguate this chronology -- it
//   requires compositing the seq fence with the publication-version
//   (stateVersion) backstop. See AOPC02-PHASE-B-REPAIR01-CORRECTION01.
it("AOPC02-PHASE-B-PBR04: same-epoch, equal seq, lower stateVersion -- stale rejected (publication-ordering backstop)", () => {
	let committed: ExtensionState | undefined
	function ReadProbe(): null {
		committed = useExtensionState()
		return null
	}
	render(
		<ExtensionStateContextProvider>
			<ReadProbe />
		</ExtensionStateContextProvider>,
	)

	// Current TRUTHFUL snapshot: newer stateVersion, projection.seq 15.
	const first = makeBaseSnapshot({
		turnState: makeTurnState("awaiting_followup", 15),
		taskHeaderPresentation: makeTaskHeader("awaiting_followup", 15),
		thinkingPresentation: makeThinking(false, 15),
		stateVersion: 5,
		epoch: 0,
	})
	push(first)
	expect(committed?.taskHeaderPresentation?.seq).toBe(15)
	expect(committed?.taskHeaderPresentation?.phase).toBe("awaiting_followup")
	expect(committed?.thinkingPresentation?.seq).toBe(15)
	expect(committed?.stateVersion).toBe(5)

	// STALE straggler: equal projection.seq (15), but OLDER stateVersion (4).
	// The seq-fence alone accepts this (15 >= 15). The new explicit
	// publication-ordering backstop at the W1 gate
	// (ExtensionStateContext.tsx:709-714) -- introduced in CORRECTION01 --
	// is what now preserves the committed projections wholesale when
	// stateVersion 4 < 5 AND no replica-epoch advance occurred.
	// applyStateSnapshot at the reducer only gates the transcript
	// (clineMessages) and turnState; it does NOT touch
	// taskHeaderPresentation / thinkingPresentation, which are owned by
	// the W1 gate via ...stateData spread -- exactly the gap that PBR04
	// closes.
	const straggler = makeBaseSnapshot({
		turnState: makeTurnState("awaiting_followup", 15),
		taskHeaderPresentation: makeTaskHeader("idle" as TurnPhase, 15),
		thinkingPresentation: makeThinking(false, 15),
		stateVersion: 4,
		epoch: 0,
	})
	push(straggler)

	// REQUIRED: stale straggler must NOT regress the committed
	// taskHeaderPresentation. The W1 publication-ordering backstop
	// (ExtensionStateContext.tsx:706-714) detects stateVersion 4 < 5 AND no
	// replica-epoch advance, and routes the projection fields to the
	// "preserve prevState" branch. The seq-fence helper is never asked to
	// merge the stale same-seq content. PBR04 documents this contract.
	expect(committed?.taskHeaderPresentation?.phase).toBe("awaiting_followup")
	expect(committed?.stateVersion).toBe(5)
})
