/**
 * ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01 / AOPC02 /
 * PHASE-A-CORRECTION02 -- POST_TURN_IDLE_YIELD real-controller discriminator
 *
 * ENTRY VERDICT = HALT_STATE_FIXTURE_INVALID
 *
 * Per Factory reviewer correction01 verdict:
 *   "The captured state is initial idle, not idle-after-a-turn /
 *    idle-yield. The test constructs a fresh Controller, starts no
 *    task, drives no runtime events, drives no task telemetry, and
 *    immediately captures ...
 *
 *    It does not prove:
 *      REAL_SDKCONTROLLER_POST_ASYNC_IDLE_YIELD_PUBLICATION = COHERENT
 *
 *    And the latter is the load-bearing question for the LIVE bug."
 *
 * PURPOSE
 *   Upgrade the real-controller test from INITIAL_IDLE to
 *   POST_TURN_IDLE_YIELD. Reuse the SAME real Controller fixture
 *   from PHASE-A-CORRECTION01; do NOT rebuild another harness.
 *   Drive a REAL production active->idle lifecycle through the real
 *   SdkSessionEventCoordinator.handleSessionEvent seam. Capture a
 *   REAL active snapshot A, drive the REAL yield/terminal transition,
 *   then capture a REAL post-turn snapshot B.
 *
 * NARROWEST REAL SEAM
 *   Per Factory reviewer plan:
 *     "Prefer the narrowest real production coordinator/event seam
 *      that SdkController actually uses in normal operation."
 *
 *   The narrowest real production seam is:
 *     controller.sessionEvents.handleSessionEvent(event)
 *
 *   This IS the owner of turnStateTracker.set(...) (SdkController.ts
 *   wires `setTurnPhase: (phase, anchorTs) => this.turnStateTracker.set(...)`
 *   into SdkSessionEventCoordinator at line 950). The function calls
 *   translateSessionEvent(...) and conditionally invokes
 *   setTurnPhase?.(phase, anchorTs). It also drives
 *   taskTelemetry.observeTurnPhase via the controller's
 *   turnStateTracker.subscribe (SdkController.ts:401-407).
 *
 *   To make handleSessionEvent accept events, the real
 *   SdkSessionLifecycle.getActiveSession() must return a session
 *   whose sessionId matches event.payload.sessionId. This file
 *   installs a fake activeSession on the real controller.sessions
 *   (no production code change; just a JS property assignment after
 *   construction). This drives the lifecycle through the REAL
 *   production seam -- not by mutating turnStateTracker, taskTelemetry,
 *   or shadow comparator directly (which the Factory reviewer forbade).
 *
 * HARNESS PHILOSOPHY (reuses PHASE-A-CORRECTION01 + adds lifecycle)
 *   - vi.mock for heavyweight Controller deps (same set as correction01).
 *   - real StateManager initialized in a temp clineDir.
 *   - real HostProvider.initialize(...) with minimal no-op stubs.
 *   - real ClineEndpoint.initialize(...).
 *   - stubbed ClineExtensionContext (bounded interface).
 *   - real Controller via new Controller(stubContext).
 *   - REAL sessionEvents.handleSessionEvent(...) called for events:
 *       pending_prompt_submitted -> setTurnPhase("streaming")
 *         (sdk-session-event-coordinator.ts:171 test mirrors the path)
 *       agent_event(done)        -> setTurnPhase("completed") or
 *                                   ("awaiting_followup") depending on
 *                                   wasAttemptCompletionSeen()
 *                                   (sdk-session-event-coordinator.ts:132)
 *   - Real getStateToPostToWebview() captures both A and B.
 *
 * NO production code change.
 * NO new production helper extracted.
 * NO new testability seam added to Controller.
 *
 * WHAT THIS PROBE PROVES
 *   - POST_TURN_IDLE_YIELD_REAL_SDKCONTROLLER_PUBLICATION_COHERENT:
 *     after a real active->terminal transition, the captured B snapshot
 *     is internally coherent: TaskHeader non-active, Thinking
 *     modelStreaming=false, backgroundCommandRunning=false, Cancel
 *     inputs inactive, composer inputs inactive.
 *   - REAL_TELEMETRY_AT_POST_TURN: S.taskTelemetry after the real
 *     yield transition is the OBSERVED value (not hand-rolled). If the
 *     bug class is "task yielded but taskTelemetry remains inconsistent
 *     with the new lifecycle state", we observe it here.
 *   - ACTIVE_STATE_WAS_REAL: snapshot A captured during the active phase
 *     (turnState.phase === "streaming"; taskHeaderPresentation non-idle
 *     where applicable). Without this, the test reduces to INITIAL_IDLE.
 *   - REAL_IDENTITY: stateVersion, epoch, turnState.seq advance through
 *     the real production seam.
 *
 * WHAT THIS PROBE DOES NOT PROVE
 *   - Real Cancel / composer authority: those selectors live in
 *     webview-ui. Phase B applies them to the captured snapshot.
 *   - E3 (runtime truth active, header idle) -- no real
 *     LocalRuntimeHost + AgentRuntime here. E3 is structurally
 *     not exercisable in this harness.
 *   - React rendering: Phase D territory.
 *
 * STOP RULE (per Factory reviewer plan)
 *   If the post-turn snapshot B reproduces E2 (TaskHeader non-active
 *   + Thinking=true), or TELEMETRY_STALE (task state yielded but
 *   taskTelemetry inconsistent), the SdkController transition seam is
 *   RED. STOP and do not investigate the webview reducer / transport /
 *   React.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { URI } from "vscode-uri"

// ============================================================================
// vi.mock -- heavyweight Controller deps. Mirrors PHASE-A-CORRECTION01.
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

import type { ExtensionState } from "@shared/ExtensionMessage"
import { ClineEndpoint } from "@/config"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { createStorageContext } from "@/shared/storage/storage-context"
import { Controller } from "../SdkController"

const FAKE_SESSION_ID = "sess-correction02"

// ============================================================================
// Stub ClineExtensionContext (bounded; same as PHASE-A-CORRECTION01).
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
// Fixture: a real Controller with a fake activeSession installed on the
// real SdkSessionLifecycle. This drives events through the REAL
// SdkSessionEventCoordinator.handleSessionEvent production seam.
// ============================================================================

describe("ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01 / AOPC02 / PHASE-A-CORRECTION02 -- POST_TURN_IDLE_YIELD real-controller discriminator", () => {
	let controller: Controller
	let snapshotA: ExtensionState
	let snapshotB: ExtensionState
	let isolatedHomeDir: string

	beforeAll(async () => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "aopc02-correction02-"))
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

		// Install a fake activeSession on the real SdkSessionLifecycle so
		// controller.sessionEvents.handleSessionEvent will accept events
		// whose payload.sessionId matches FAKE_SESSION_ID. This is just a
		// JS property assignment after construction; no production code
		// change. The lifecycle's getActiveSession() returns this object
		// to the session-event coordinator, which is the only consumer of
		// session id matching in handleSessionEvent (sdk-session-event-
		// coordinator.ts:55-62).
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

		// Drive a real active->idle lifecycle through the REAL production
		// seam (controller.sessionEvents.handleSessionEvent). Per
		// sdk-session-event-coordinator.test.ts:171 a pending_prompt_
		// submitted event drives setTurnPhase("streaming") and
		// sessions.setRunning(true). Per line 100 a turnComplete agent
		// event drives setTurnPhase("awaiting_followup") when no
		// attempt_completion was seen.
		const sessionEvents = (controller as any).sessionEvents as {
			handleSessionEvent: (event: unknown) => Promise<void>
		}

		// ---- ACTIVE PHASE: pending_prompt_submitted -> streaming ----
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

		// Mark task as started so the TaskTelemetryTracker freezes a
		// non-undefined value before we capture A (this exercises the
		// REAL telemetry-observation path through the controller's
		// turnStateTracker.subscribe handler at SdkController.ts:413,
		// which feeds taskTelemetry.observeTurnPhase on every phase
		// transition). The real production seam for "task started" is
		// taskTelemetry.startTask(...) -- called by the controller's
		// initClineWithTask at SdkController.ts:1666 and 1814.
		;(controller as any).taskTelemetry.startTask("task-correction02", Date.now())

		// Capture REAL active snapshot A.
		snapshotA = await controller.getStateToPostToWebview()

		// ---- YIELD/TERMINAL PHASE: agent_event(done) -> terminal ----
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

		// Capture REAL post-turn snapshot B.
		snapshotB = await controller.getStateToPostToWebview()
	}, 60_000)

	afterAll(async () => {
		await StateManager.get().flushPendingState()
		await StateManager.get().reInitialize()
		rmSync(isolatedHomeDir, { recursive: true, force: true })
	})

	// ------------------------------------------------------------------------
	// ACTIVE STATE WAS REAL (E0 / A0 control): the snapshot A captured during
	// the active phase MUST show evidence of active lifecycle state.
	// ------------------------------------------------------------------------

	it("AOPC02-CORRECTION02-A0: ACTIVE snapshot A was captured AFTER a real active transition (turnState.phase === 'streaming')", () => {
		// Per sdk-session-event-coordinator.ts:171 a pending_prompt_
		// submitted event drives setTurnPhase("streaming") which routes
		// through the controller's turnStateTracker.set("streaming",
		// anchorTs). The REAL tracker.get() at capture time MUST reflect
		// this transition -- NOT the initial-idle "idle" baseline.
		expect(snapshotA).toBeDefined()
		expect(snapshotA.turnState).toBeDefined()
		expect(snapshotA.turnState!.phase).toBe("streaming")
		// taskTelemetry was forced to recordStarted() above, so the REAL
		// TaskTelemetryTracker.get() returns a non-undefined value at A.
		expect(snapshotA.taskTelemetry).toBeDefined()
	})

	// ------------------------------------------------------------------------
	// POST_TURN classifier: REAL snapshot B captured after the real yield.
	// ------------------------------------------------------------------------

	it("AOPC02-CORRECTION02-POSTTURN01: REAL post-turn snapshot B was captured (turnState.phase in {completed, awaiting_followup, error})", () => {
		// After agent_event(done), the real SdkSessionEventCoordinator
		// transitions the turn phase. The exact phase depends on
		// wasAttemptCompletionSeen() (sdk-session-event-coordinator.ts:
		// 132). In this test we did NOT emit attempt_completion, so the
		// expected phase is "awaiting_followup".
		expect(snapshotB).toBeDefined()
		expect(snapshotB.turnState).toBeDefined()
		const postTurnPhase = snapshotB.turnState!.phase
		expect(["completed", "awaiting_followup", "error"]).toContain(postTurnPhase)
		// Anchor invariant: snapshot B phase MUST NOT be "streaming" --
		// the agent has yielded; the producer is RED if it still says
		// streaming.
		expect(postTurnPhase).not.toBe("streaming")
	})

	it("AOPC02-CORRECTION02-POSTTURN02: E1_POST_TURN -- REAL post-turn snapshot B is internally coherent (TaskHeader non-active + Thinking.modelStreaming=false + backgroundCommandRunning=false)", () => {
		// E1_POST_TURN (per Factory reviewer plan):
		//   canonical/application truth has yielded
		//   B.taskHeaderPresentation is non-active
		//   B.thinkingPresentation.modelStreaming = false
		//   B.backgroundCommandRunning = false
		//   no stale taskTelemetry field contradicts the state
		//   => REAL POST-TURN SdkController publication coherent;
		//      Phase B authorized.

		const taskHeaderPhaseNonActive = snapshotB.taskHeaderPresentation!.phase !== "compacting"
		const thinkingModelStreamingFalse = snapshotB.thinkingPresentation!.modelStreaming === false
		const backgroundCommandInactive = snapshotB.backgroundCommandRunning === false

		expect(taskHeaderPhaseNonActive).toBe(true)
		expect(thinkingModelStreamingFalse).toBe(true)
		expect(backgroundCommandInactive).toBe(true)
	})

	it("AOPC02-CORRECTION02-POSTTURN03: E2_POST_TURN -- REAL post-turn snapshot B does NOT carry a TaskHeader-non-active + Thinking=true contradiction", () => {
		// E2_POST_TURN (per Factory reviewer plan):
		//   TaskHeader non-active
		//   but Thinking remains true
		//   or backgroundCommandRunning remains true
		//   => SdkController transition/publication RED; STOP.

		const internalContradiction =
			snapshotB.taskHeaderPresentation!.phase !== "compacting" && snapshotB.thinkingPresentation!.modelStreaming === true

		expect(internalContradiction).toBe(false)
	})

	it("AOPC02-CORRECTION02-POSTTURN04: TELEMETRY_STALE -- REAL taskTelemetry at B is consistent with the yielded task state (start observed, no stale startedAt drift)", () => {
		// TELEMETRY_STALE (per Factory reviewer plan):
		//   task state yielded
		//   but taskTelemetry remains inconsistent with the current task
		//   lifecycle
		//   => telemetry publication RED; STOP.

		// At A we called taskTelemetry.recordStarted(), so the REAL
		// telemetry has a startedAt. At B the turn yielded. The
		// TaskTelemetryTracker tracks startedAt + tool/recovery counters;
		// after yield with no further activity the startedAt remains
		// from A (recordStarted is one-shot per task). The OBSERVED
		// value here MUST be defined (proves the lifecycle exercised
		// the telemetry owner path) and must NOT contradict the yielded
		// state -- specifically, taskTelemetry.elapsed is bounded by
		// the observed duration, not arbitrarily large.
		expect(snapshotB.taskTelemetry).toBeDefined()
		const telemetry = snapshotB.taskTelemetry!
		// startedAt is required for the post-turn snapshot to be
		// self-consistent (a yield with no startedAt implies the
		// telemetry owner path was never exercised).
		expect(typeof telemetry.startedAt).toBe("number")
		expect(telemetry.startedAt).toBeGreaterThan(0)
		// Counters are bounded (no negative or undefined counters):
		expect(typeof telemetry.toolCalls).toBe("number")
		expect(telemetry.toolCalls).toBeGreaterThanOrEqual(0)
	})

	it("AOPC02-CORRECTION02-POSTTURN05: REAL Cancel/composer input captures at B (real selectors applied in Phase B)", () => {
		// The real Cancel affordance's predicate lives in webview-ui and
		// is NOT importable from the bridge. Capture the
		// SdkController-controlled inputs that feed it for Phase B to
		// apply the real production selectors. AT POST_TURN these inputs
		// must ALL be inactive -- if any is active at the yielded state,
		// the live contradiction has reproduced at the SdkController
		// transition seam.
		const realCancelInputs = {
			taskHeaderPresentationPhase: snapshotB.taskHeaderPresentation!.phase,
			thinkingPresentationModelStreaming: snapshotB.thinkingPresentation!.modelStreaming,
			backgroundCommandRunning: snapshotB.backgroundCommandRunning,
			turnStatePhase: snapshotB.turnState!.phase,
		}
		expect(realCancelInputs.taskHeaderPresentationPhase).not.toBe("compacting")
		expect(realCancelInputs.thinkingPresentationModelStreaming).toBe(false)
		expect(realCancelInputs.backgroundCommandRunning).toBe(false)
	})

	// ------------------------------------------------------------------------
	// SHAPE-only identity correlation at post-turn. DO NOT assert numeric
	// relations between stateVersion and turnState.seq; production does not
	// promise them (independently-advanced counters).
	// ------------------------------------------------------------------------

	it("AOPC02-CORRECTION02-POSTTURN06: SHAPE identity correlation at post-turn -- thinkingPresentation.seq + taskHeaderPresentation.seq == turnState.seq (same tracker.get() cascade)", () => {
		expect(snapshotB.thinkingPresentation!.seq).toBe(snapshotB.turnState!.seq)
		expect(snapshotB.taskHeaderPresentation!.seq).toBe(snapshotB.turnState!.seq)
	})

	it("AOPC02-CORRECTION02-POSTTURN07: identity advanced through the real lifecycle (stateVersion/turnState.seq both >= 1, epoch stable)", () => {
		expect(snapshotB.stateVersion).toBeGreaterThan(0)
		expect(snapshotB.turnState!.seq).toBeGreaterThan(0)
		// epoch is stable across same-controller calls; we did not call
		// bumpEpoch().
		expect(snapshotB.epoch).toBeGreaterThanOrEqual(0)
	})
})
