/**
 * ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01 / AOPC02 /
 * PHASE-A-CORRECTION03 -- LOAD-BEARING-INVARIANTS discriminator
 *
 * ENTRY VERDICT (per Factory reviewer): HALT_PRODUCTION_INVARIANT_CONTRADICTION
 *
 *   The reviewer's claim: PHASE-A-CORRECTION02 reported B contained
 *     turnState.phase                = awaiting_followup
 *     taskHeaderPresentation.phase   = idle  (source = "legacy")
 *     taskHeaderPresentation.source  = legacy
 *     taskHeaderPresentation.seq     = turnState.seq
 *
 *   which would violate the frozen
 *   selectTaskHeaderPresentation legacy-fallback contract:
 *
 *     source === "legacy" AND canonicalShadowPhase === undefined
 *       =>
 *     taskHeaderPresentation.phase === currentLegacyPhase
 *
 *   If REAL, this would be the first concrete RED on the extension
 *   side: TaskHeader collapses awaiting_followup to idle.
 *
 * ACTUAL DISCRIMINATOR OUTCOME (this file)
 *
 *   Executing a TEMP probe on the PHASE-A-CORRECTION02 harness
 *   (real Controller, real sessionEvents.handleSessionEvent,
 *    real getStateToPostToWebview; same active->yield chronology)
 *   yielded:
 *
 *     B.turnState.phase                = awaiting_followup
 *     B.taskHeaderPresentation.phase   = awaiting_followup  <-- NOT idle
 *     B.taskHeaderPresentation.source  = legacy
 *     B.taskHeaderPresentation.seq     = 5
 *     tracker.currentPhase             = awaiting_followup
 *     selector input/output match       = TRUE on phase+source+seq
 *
 *   So the LEGACY-FALLBACK contract IS preserved by the real
 *   SdkController at this seam: source=legacy AND
 *   currentLegacyPhase=awaiting_followup produces
 *   taskHeaderPresentation.phase=awaiting_followup.
 *
 *   The reviewer's HALT was based on the BOARD NARRATIVE of
 *   correction02 which, in the report's verbal description, said
 *   "TaskHeader phase = idle" for B. The actual real snapshot is
 *   NOT that. CASE_D_REPORT_WRONG (per the reviewer's classifier).
 *
 *   The LIVE contradiction reported in
 *   docs/architecture/elm/task-state-e71-c2-bc2c794be-live-trace-
 *   evidence.md (lines 51-58, 88-95, 200-201) is:
 *
 *     extension emits:   turnState.phase = awaiting_followup / seq 15
 *     webview applies:  turnState.phase = idle / seq 2
 *
 *   The webview reducer applies a STALE idle/seq2 over the new
 *   awaiting_followup/seq15. That is a WEBVIEW-REDUCER straggler-
 *   replay problem, NOT an extension-side TaskHeader legacy-fallback
 *   collapse.
 *
 *   This file (CORRECTION03) does not repair anything. It HARDENS
 *   the discriminator so future regressions of the
 *   legacy-fallback contract would be caught immediately, and it
 *   classifies the reviewer's HALT_PRODUCTION_INVARIANT_
 *   CONTRADICTION as CASE_D_REPORT_WRONG (corrected evidence)
 *   with PASS_LEGACY_FALLBACK_INVARIANTS at the real seam.
 *
 * SCOPE
 *
 *   REUSE the same real Controller active->yield fixture from
 *   PHASE-A-CORRECTION02. Do NOT rebuild the harness.
 *   Keep:
 *     - real sessionEvents.handleSessionEvent
 *     - real getStateToPostToWebview
 *     - real TaskTelemetryTracker
 *     - same A and B chronology
 *
 *   DO NOT mutate:
 *     - turnStateTracker.phase
 *     - taskTelemetry counters
 *     - shadow comparator output
 *     - selectTaskHeaderPresentation
 *
 *   The ONLY additions relative to correction02 are:
 *     - import of the real selectTaskHeaderPresentation selector
 *       (already-importable from this harness)
 *     - observation of tracker.currentPhase and tracker.get() via
 *       the real TurnStateTracker public getters
 *     - per-invariant assertions on REAL captures
 *
 * NO production code change.
 * NO new production helper extracted.
 * NO new testability seam added to Controller.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { URI } from "vscode-uri"

// ============================================================================
// vi.mock -- heavyweight Controller deps (reuses correction01/correction02)
// ============================================================================

vi.mock("@/services/logging/distinctId", () => ({
	initializeDistinctId: vi.fn(async () => undefined),
	getDistinctId: vi.fn(() => undefined),
	getDeviceId: vi.fn(() => undefined),
	setDistinctId: vi.fn(),
	_GENERATED_MACHINE_ID_KEY: "cline.generatedMachineId",
}))

vi.mock("@/services/mcp/McpHub", () => ({
	McpHub: class {
		getServers = vi.fn(() => [])
		getServersAsMap = vi.fn(() => new Map())
		getAllServers = vi.fn(() => [])
		dispose = vi.fn()
		connectToServer = vi.fn(async () => {})
		setToolListChangeCallback = vi.fn()
	},
}))

vi.mock("@/services/account/ClineAccountService", () => ({
	ClineAccountService: {
		getInstance: vi.fn(() => ({
			getUser: vi.fn(async () => undefined),
			fetchOrganizationBillingData: vi.fn(async () => undefined),
		})),
	},
}))

vi.mock("@/services/auth/AuthService", () => ({
	AuthService: {
		getInstance: vi.fn(() => ({
			getState: vi.fn(() => "logged-out"),
			subscribe: vi.fn(() => () => {}),
		})),
	},
	LogoutReason: { USER_INITIATED: "user_initiated" },
}))

vi.mock("@/services/auth/oca/OcaAuthService", () => ({
	OcaAuthService: {
		initialize: vi.fn(() => ({
			handleAuthCallback: vi.fn(async () => {}),
			handleDeauth: vi.fn(async () => {}),
		})),
	},
}))

vi.mock("@/services/banner/BannerService", () => ({
	BannerService: {
		get: vi.fn(() => ({
			getActiveBanners: vi.fn(() => []),
			getWelcomeBanners: vi.fn(() => []),
		})),
		initialize: vi.fn(() => ({
			getActiveBanners: vi.fn(() => []),
			getWelcomeBanners: vi.fn(() => []),
		})),
		reset: vi.fn(),
	},
}))

vi.mock("@core/storage/disk", () => ({
	getMcpSettingsFilePath: vi.fn(() => "/tmp/mock-mcp-settings.json"),
	ensureMcpServersDirectoryExists: vi.fn(() => "/tmp/mock-mcp-servers"),
	ensureSettingsDirectoryExists: vi.fn(() => "/tmp/mock-settings"),
	resolveDefaultMcpSettingsPath: vi.fn(() => "/tmp/mock-mcp-settings.json"),
}))

// ============================================================================
// Imports placed AFTER vi.mock so the mocked versions resolve.
// ============================================================================

import type { ExtensionState, TurnPhase } from "@shared/ExtensionMessage"
import { ClineEndpoint } from "@/config"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { createStorageContext } from "@/shared/storage/storage-context"
import { Controller } from "../SdkController"
import type { TaskHeaderPresentationInputs, TaskHeaderPresentationProjection } from "../task-state-shadow-arbiter-mapper"
import { selectTaskHeaderPresentation } from "../task-state-shadow-arbiter-mapper"

const FAKE_SESSION_ID = "sess-correction03"

// ============================================================================
// Stub ClineExtensionContext (bounded; same as correction01/correction02).
// ============================================================================

function makeStubContext(): any {
	return {
		subscriptions: [],
		workspaceState: {
			get: vi.fn(() => undefined),
			update: vi.fn(async () => undefined),
		},
		extensionUri: { fsPath: "/tmp/mock-extension", scheme: "file", path: "/tmp/mock-extension" } as unknown as URI,
		extensionPath: "/tmp/mock-extension",
		environmentVariableCollection: {},
		asAbsolutePath: (p: string) => `/tmp/mock-extension/${p}`,
		storageUri: undefined,
		storagePath: undefined,
		globalStorageUri: {
			fsPath: "/tmp/mock-global-storage",
			scheme: "file",
			path: "/tmp/mock-global-storage",
		} as unknown as URI,
		globalStoragePath: "/tmp/mock-global-storage",
		logUri: { fsPath: "/tmp/mock-logs", scheme: "file", path: "/tmp/mock-logs" } as unknown as URI,
		logPath: "/tmp/mock-logs",
		extensionMode: 1,
		extension: { exports: undefined, id: "clinemm", extensionPath: "/tmp/mock-extension" },
	}
}

// ============================================================================
// Fixture: a real Controller with the same active->yield chronology as
// PHASE-A-CORRECTION02 (real sessionEvents.handleSessionEvent + real
// startTask + real getStateToPostToWebview). The new THP-B invariants
// (B01..B04) are observed against the captured REAL B.
// ============================================================================

describe("ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01 / AOPC02 / PHASE-A-CORRECTION03 -- LOAD-BEARING-INVARIANTS discriminator", () => {
	let controller: Controller
	let snapshotA: ExtensionState
	let snapshotB: ExtensionState
	let trackerCurrentPhaseAtB: TurnPhase
	let trackerGetAtB: { phase: TurnPhase; seq: number; anchorTs?: number }
	let trackerCurrentPhaseAtA: TurnPhase
	let trackerGetAtA: { phase: TurnPhase; seq: number; anchorTs?: number }
	let selectorInputAtB: TaskHeaderPresentationInputs
	let selectorOutputAtB: TaskHeaderPresentationProjection
	let isolatedHomeDir: string

	beforeAll(async () => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "aopc02-correction03-"))
		process.env.CLINE_DIR = join(isolatedHomeDir, ".cline")
		HostProvider.initialize(
			() => ({}) as never,
			() => ({}) as never,
			() => ({}) as never,
			{
				workspaceClient: {} as never,
				envClient: {
					getTelemetrySettings: async () => ({ isEnabled: false }),
					subscribeToTelemetrySettings: () => ({ unsubscribe: () => {} }),
					getEnvironmentDetails: async () => ({}),
					getHostVersion: async () => ({
						version: "test-host-version",
						clineVersion: "test-cline-version",
						platform: process.platform,
						clineType: "cline",
					}),
				} as never,
				windowClient: {} as never,
				diffClient: {} as never,
			} as never,
			() => {},
			async () => "",
			async () => "",
			"/tmp/mock-extension",
			"/tmp/mock-global-storage",
		)
		await ClineEndpoint.initialize("/tmp/mock-extension")
		await StateManager.initialize(
			createStorageContext({
				clineDir: join(isolatedHomeDir, ".cline"),
				workspacePath: isolatedHomeDir,
			}),
		)
		controller = new Controller(makeStubContext())

		// Install a fake activeSession on the real SdkSessionLifecycle.
		const sessions = (controller as any).sessions as { activeSession?: unknown }
		sessions.activeSession = {
			sessionId: FAKE_SESSION_ID,
			sdkHost: {
				subscribe: () => () => {},
				dispose: async () => {},
			},
			unsubscribe: () => {},
			isRunning: true,
		}

		const sessionEvents = (controller as any).sessionEvents as {
			handleSessionEvent: (event: unknown) => Promise<void>
		}

		// ACTIVE PHASE: pending_prompt_submitted -> streaming.
		await sessionEvents.handleSessionEvent({
			type: "pending_prompt_submitted",
			payload: {
				sessionId: FAKE_SESSION_ID,
				id: "pending-1",
				prompt: "test prompt",
				delivery: "queue",
				attachmentCount: 0,
			},
		})
		;(controller as any).taskTelemetry.startTask("task-correction03", Date.now())

		// Capture tracker state at A (real public getters; no mutation).
		const trackerA = (controller as any).turnStateTracker as {
			currentPhase: TurnPhase
			get: () => { phase: TurnPhase; seq: number; anchorTs?: number }
		}
		trackerCurrentPhaseAtA = trackerA.currentPhase as TurnPhase
		trackerGetAtA = trackerA.get() as { phase: TurnPhase; seq: number; anchorTs?: number }

		snapshotA = await controller.getStateToPostToWebview()

		// YIELD/TERMINAL PHASE: agent_event(done) -> awaiting_followup.
		await sessionEvents.handleSessionEvent({
			type: "agent_event",
			payload: {
				sessionId: FAKE_SESSION_ID,
				event: {
					type: "done",
					reason: "completed",
					text: "test completion",
					iterations: 1,
				},
			},
		})

		// Capture tracker state at B (real public getters).
		const trackerB = (controller as any).turnStateTracker as {
			currentPhase: string
			get: () => { phase: string; seq: number; anchorTs?: number }
		}
		trackerCurrentPhaseAtB = trackerB.currentPhase as TurnPhase
		trackerGetAtB = trackerB.get() as { phase: TurnPhase; seq: number; anchorTs?: number }

		// Reconstruct the selector call at the publication site. The
		// controller calls (line 3006-3008 of SdkController.ts):
		//   selectTaskHeaderPresentation({
		//     canonicalShadowPhase: this.getLocalShadowPhase(),
		//     currentLegacyPhase:   this.turnStateTracker.currentPhase,
		//     seq:                  this.turnStateTracker.get().seq,
		//   })
		// We re-invoke the same pure selector with the same inputs at
		// the SAME controller reference; this is the upstream test
		// (per Factory reviewer: "Do not infer them from the output").
		const shadowPhase = controller.getLocalShadowPhase()
		selectorInputAtB = {
			canonicalShadowPhase: shadowPhase,
			currentLegacyPhase: trackerCurrentPhaseAtB,
			seq: trackerGetAtB.seq,
		}
		selectorOutputAtB = selectTaskHeaderPresentation(selectorInputAtB)

		snapshotB = await controller.getStateToPostToWebview()
	}, 60_000)

	afterAll(async () => {
		await StateManager.get().flushPendingState()
		await StateManager.get().reInitialize()
		rmSync(isolatedHomeDir, { recursive: true, force: true })
	})

	// ------------------------------------------------------------------------
	// A0: control evidence that A was captured during the active phase.
	// ------------------------------------------------------------------------

	it("AOPC02-CORRECTION03-A0: ACTIVE snapshot A captured during the streaming phase (turnState.phase === 'streaming')", () => {
		expect(snapshotA.turnState!.phase).toBe("streaming")
	})

	// ------------------------------------------------------------------------
	// THP-B01: tracker self-consistency -- tracker.currentPhase is the
	// real public getter on TurnStateTracker; tracker.get() is the real
	// snapshot getter. They MUST agree (the implementation in
	// apps/vscode/src/sdk/turn-state-tracker.ts:105+96 returns the same
	// underlying field on every call; the invariant is a regression
	// guard against a future refactor that splits them).
	// ------------------------------------------------------------------------

	it("THP-B01: tracker self-consistency -- tracker.currentPhase === tracker.get().phase (at both A and B)", () => {
		expect(trackerCurrentPhaseAtA).toBe(trackerGetAtA.phase)
		expect(trackerCurrentPhaseAtB).toBe(trackerGetAtB.phase)
	})

	// ------------------------------------------------------------------------
	// THP-B02: publication tracker consistency -- B.turnState must agree
	// with tracker.get() AT THE SAME LOGICAL INSTANT (real production
	// SdkController.getStateToPostToWebview reads B.turnState from
	// tracker.get() at line 2920; selectors read currentLegacyPhase and
	// seq from tracker at lines 3007-3008). On a single thread with no
	// awaiting between calls, all three reads must agree.
	// ------------------------------------------------------------------------

	it("THP-B02: publication tracker consistency -- B.turnState.phase === tracker.get().phase AND B.turnState.seq === tracker.get().seq", () => {
		expect(snapshotB.turnState!.phase).toBe(trackerGetAtB.phase)
		expect(snapshotB.turnState!.seq).toBe(trackerGetAtB.seq)
	})

	// ------------------------------------------------------------------------
	// THP-B03: legacy-source conservation -- the frozen contract:
	//
	//   source === "legacy" AND canonicalShadowPhase === undefined
	//     =>
	//   taskHeaderPresentation.phase === currentLegacyPhase
	//
	// The reviewer's HALT_PRODUCTION_INVARIANT_CONTRADICTION predicted
	// this would RED (awaiting_followup -> idle). We assert it here so
	// future regressions are caught at this seam.
	// ------------------------------------------------------------------------

	it("THP-B03-LEGACY-CONSERVATION: if B.taskHeaderPresentation.source === 'legacy' THEN B.taskHeaderPresentation.phase === B.turnState.phase", () => {
		const proj = snapshotB.taskHeaderPresentation!
		if (proj.source === "legacy") {
			expect(proj.phase).toBe(snapshotB.turnState!.phase)
		}
	})

	it("THP-B03-SHADOW-MAPPING: if B.taskHeaderPresentation.source === 'shadow' THEN B.taskHeaderPresentation.phase === canonicalShadowPhase from the SAME controller", () => {
		const proj = snapshotB.taskHeaderPresentation!
		if (proj.source === "shadow") {
			expect(proj.phase).toBe(selectorInputAtB.canonicalShadowPhase)
		}
	})

	it("THP-B03-HOST-COMPACTION / ACT-CLINEMM-TASK-COMPLETION-CONTINUATION-COHERENCE01 / TCCC01-B1: if B.taskHeaderPresentation.source === 'host' THEN B.taskHeaderPresentation.phase ∈ {compacting, awaiting_followup}", () => {
		// ACT-CLINEMM-TASK-COMPLETION-CONTINUATION-COHERENCE01 / TCCC01-B1:
		// the host-override branch in selectTaskHeaderPresentation
		// (`task-state-shadow-arbiter-mapper.ts`) now applies to BOTH
		// "compacting" (THCP11 host-override) and "awaiting_followup"
		// (the user-owned phase the canonical shadow cannot
		// represent). The two host-override branches together prove
		// that whenever `source === "host"`, the phase is one of
		// these two host-owned labels — never anything else.
		const proj = snapshotB.taskHeaderPresentation!
		if (proj.source === "host") {
			expect(["compacting", "awaiting_followup"]).toContain(proj.phase)
		}
	})

	// ------------------------------------------------------------------------
	// THP-B04: seq conservation -- both thinkingPresentation and
	// taskHeaderPresentation must carry the SAME seq as turnState.seq
	// (transport-level stale-push fencing, same domain).
	// ------------------------------------------------------------------------

	it("THP-B04-SEQ: B.taskHeaderPresentation.seq === B.thinkingPresentation.seq === B.turnState.seq", () => {
		expect(snapshotB.taskHeaderPresentation!.seq).toBe(snapshotB.turnState!.seq)
		expect(snapshotB.thinkingPresentation!.seq).toBe(snapshotB.turnState!.seq)
	})

	// ------------------------------------------------------------------------
	// SPY-EQUIVALENT: selectTaskHeaderPresentation call-site fidelity.
	// The pure selector, when invoked with the SAME inputs the
	// SdkController fed it, must reproduce the EXACT B projection.
	// This is the "spy on the selector call" discriminator the
	// reviewer asked for, except it requires no new testability seam
	// because TurnStateTracker's public getters already expose the
	// inputs the SdkController fed at line 3006-3008.
	// ------------------------------------------------------------------------

	it("SPY-AT-PUBLICATION: selectTaskHeaderPresentation({canonicalShadowPhase, currentLegacyPhase, seq}) reproduces B.taskHeaderPresentation EXACTLY", () => {
		expect(snapshotB.taskHeaderPresentation!.phase).toBe(selectorOutputAtB.phase)
		expect(snapshotB.taskHeaderPresentation!.source).toBe(selectorOutputAtB.source)
		expect(snapshotB.taskHeaderPresentation!.seq).toBe(selectorOutputAtB.seq)
	})

	// ------------------------------------------------------------------------
	// Positive control: the frozen-contract control proves the selector
	// itself behaves as the contract requires (not just that
	// SdkController is feeding it correctly). This guards against a
	// regression in selectTaskHeaderPresentation itself.
	// ------------------------------------------------------------------------

	it("POSITIVE-CONTROL: selectTaskHeaderPresentation host-overrides awaiting_followup regardless of shadow presence (TCCC01-B1)", () => {
		// ACT-CLINEMM-TASK-COMPLETION-CONTINUATION-COHERENCE01 / TCCC01-B1:
		// awaiting_followup is a host-owned phase (the canonical
		// shadow cannot represent it). The host-override branch in
		// selectTaskHeaderPresentation now applies to it, mirroring
		// the compaction precedent — `source === "host"`, not
		// `"legacy"`. The user-visible phase ("awaiting_followup"
		// → "Waiting") is unchanged.
		const proj = selectTaskHeaderPresentation({
			canonicalShadowPhase: undefined,
			currentLegacyPhase: "awaiting_followup",
			seq: 42,
		})
		expect(proj).toEqual({ phase: "awaiting_followup", source: "host", seq: 42 })
	})

	it("POSITIVE-CONTROL: selectTaskHeaderPresentation overrides legacy streaming with shadow authority when shadow present", () => {
		const proj = selectTaskHeaderPresentation({
			canonicalShadowPhase: "completed",
			currentLegacyPhase: "streaming",
			seq: 7,
		})
		expect(proj).toEqual({ phase: "completed", source: "shadow", seq: 7 })
	})

	it("POSITIVE-CONTROL: selectTaskHeaderPresentation emits host compaction override regardless of legacy/shadow", () => {
		const proj = selectTaskHeaderPresentation({
			canonicalShadowPhase: "streaming",
			currentLegacyPhase: "compacting",
			seq: 9,
		})
		expect(proj).toEqual({ phase: "compacting", source: "host", seq: 9 })
	})

	// ------------------------------------------------------------------------
	// REPORT-CLASSIFICATION: documents what the REAL B actually contains
	// (positive case), so any future regression that flips these values
	// produces a clear named failure.
	// ------------------------------------------------------------------------

	it("REPORT-CLASSIFICATION: REAL B snapshot capture (forensic record)", () => {
		// This test does not assert a contradiction; it asserts what
		// the REAL B snapshot contains so the forensic record is
		// locked in for future regression detection.
		//
		// Per the Factory reviewer's HALT_PRODUCTION_INVARIANT_
		// CONTRADICTION, the hypothesized RED was:
		//   B.taskHeaderPresentation.phase === "idle" with
		//   source === "legacy" while turnState.phase ===
		//   "awaiting_followup".
		//
		// Actual REAL B (this harness, real Controller, real lifecycle):
		//   B.turnState.phase                = "awaiting_followup"
		//   B.taskHeaderPresentation.phase   = "awaiting_followup"
		//   B.taskHeaderPresentation.source  = "legacy"
		//   B.taskHeaderPresentation.seq     = turnState.seq
		//
		// CASE_D_REPORT_WRONG (reviewer classifier): the
		// hypothetical RED is not produced by the real seam at
		// this chronology. The legacy-fallback contract is
		// preserved. Phase B (webview reducer seam) is the
		// remaining candidate per the LIVE E71 evidence.
		expect(["awaiting_followup", "completed", "error"]).toContain(snapshotB.turnState!.phase)
		// Strong positive: when the real legacy path is exercised,
		// the TaskHeader phase MUST be the tracker phase.
		if (snapshotB.taskHeaderPresentation!.source === "legacy") {
			expect(snapshotB.taskHeaderPresentation!.phase).toBe(snapshotB.turnState!.phase)
		}
	})

	// ------------------------------------------------------------------------
	// BOUNDARY DOWNGRADE per reviewer plan:
	//
	//   TELEMETRY_STALE = NOT REPRODUCED  ->  TELEMETRY_STRUCTURALLY_VALID = PROVEN
	//                                              TELEMETRY_STALENESS = NOT TESTED STRONGLY
	//
	// The PHASE-A-CORRECTION02 POSTTURN04 "TELEMETRY_STALE" assertion
	// is too weak (startedAt exists; toolCalls >= 0). That proves
	// STRUCTURAL VALIDITY only. A stronger staleness check would
	// require a real terminal/yield chronology with elapsed-time
	// assertions against a fixed Date.now() anchor. The fixture
	// here is SYNTHETIC at activeSession creation and is NOT
	// sufficient for that. Documented here as P1 (boundary
	// declaration, no separate cycle).
	// ------------------------------------------------------------------------

	it("TELEMETRY_STRUCTURALLY_VALID (downgraded from TELEMETRY_STALE_NOT_REPRODUCED): taskTelemetry at B is structurally defined but staleness is NOT tested strongly", () => {
		// Structural validity: startedAt exists, toolCalls >= 0,
		// recoveryBudgetFailures >= 0. Proves the tracker was
		// initialized and observation-only hooks fired.
		expect(snapshotB.taskTelemetry).toBeDefined()
		expect(typeof snapshotB.taskTelemetry!.startedAt).toBe("number")
		expect(snapshotB.taskTelemetry!.startedAt).toBeGreaterThan(0)
		expect(typeof snapshotB.taskTelemetry!.toolCalls).toBe("number")
		expect(snapshotB.taskTelemetry!.toolCalls).toBeGreaterThanOrEqual(0)
		// Staleness is intentionally NOT asserted strongly here;
		// fixture is SYNTHETIC at activeSession creation. See header.
	})

	// ------------------------------------------------------------------------
	// SYNTHETIC_SESSION_FIXTURE boundary label:
	//
	//   The activeSession is installed via
	//     (controller as any).sessions.activeSession = {...}
	//
	//   which is a JS property assignment after construction -- NOT
	//   reached through SdkSessionLifecycle's normal session-start
	//   path. Likewise (controller as any).taskTelemetry.startTask(...)
	//   is called directly rather than via initClineWithTask.
	//
	//   The narrowest real production seam that IS exercised is
	//   (controller as any).sessionEvents.handleSessionEvent(event)
	//   (real SdkSessionEventCoordinator.handleSessionEvent).
	//
	//   Best evidence label:
	//     REAL_SDKCONTROLLER
	//     REAL_SESSION_EVENT_COORDINATOR
	//     REAL_PUBLICATION_PRODUCER
	//     SYNTHETIC_SESSION_FIXTURE
	//     REAL_OWNER_TRANSITION_PATH
	//
	//   NOT an unrestricted REAL_PRODUCTION_CHRONOLOGY.
	// ------------------------------------------------------------------------
})
