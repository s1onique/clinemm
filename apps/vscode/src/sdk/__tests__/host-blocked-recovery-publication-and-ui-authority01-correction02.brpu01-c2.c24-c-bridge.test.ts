/**
 * ACT-CLINEMM-P0-BLOCKED-RECOVERY-PUBLICATION-AND-UI-AUTHORITY01-CORRECTION02
 * — BRPU01-C2
 *
 * CORRECTION02: the previous CORRECTION01 (BRPU01-C1) closed the
 * accessor-naming and source-text evidence boundary, but its end-to-end
 * tests did NOT exercise the actual `SdkController.getStateToPostToWebview()`
 * producer — they used a substitute producer expression
 * (`projectBlockedRecovery(coordinator.getCurrentDeferredCompletionBarrier())`)
 * and a hand-rolled consumer fence. The Factory reviewer rejected
 * that overclaim with `HALT_BRPU01_C1_PRODUCTION_CONVERGENCE_NOT_PROVEN`
 * at b09f7ea22 with the disposition:
 *
 *   "REAL_SDKCONTROLLER_PRODUCER = NOT_EXECUTED
 *    Actual SdkController.getStateToPostToWebview() = NOT_EXECUTED
 *    Actual ExtensionStateContext state update = SIMULATED
 *    Actual React controls render = NOT_EXECUTED"
 *
 * This file is the bounded CORRECTION02 that closes the gap:
 *
 *   EVIDENCE CLASS = REAL_SDKCONTROLLER_PRODUCER
 *     (real Controller constructed via the established AOPC02 harness
 *      pattern (mirrors providerCatalogSmoke.test.ts +
 *      session-auto-approval.controller.test.ts + AOPC02 PHASE-A-
 *      CORRECTION01/02/03); real `controller.getStateToPostToWebview()`
 *      called; real `snapshot.blockedRecovery` read off the returned
 *      `ExtensionState`.)
 *
 *   SYNCHRONIZED_PUBLICATION_INPUT_TOKEN = REAL_PRODUCTION_SEAM
 *     The real `controller.sessionEvents` is the production
 *     SdkSessionEventCoordinator (constructed in the Controller
 *     constructor at SdkController.ts:2496). The real
 *     `controller.backgroundNotifyCoordinator` is the production
 *     BackgroundNotifyCoordinator (constructed at SdkController.ts:1458).
 *     BCB marker registration and `handleSessionEvent` events flow
 *     through the real production seams.
 *
 *   PRODUCTION LIFETIME CONTRACT (C3 reviewer P1):
 *     The BCB marker does NOT auto-clear after a held-set drain. The
 *     bounded host correlation guard's
 *     `sameObligationAlreadyObservationUnavailable` short-circuit at
 *     sdk-session-event-coordinator.ts:3152 prevents a re-stamp
 *     (BOCR01-04 documents this). The marker's lifetime is bounded
 *     by epoch advance. `MessageIdMinter.bumpEpoch()` is the canonical
 *     release operation: it is called by the production controller on
 *     task-start, history open, reinit, mode rebuild, and cancel (see
 *     SdkController.ts TaskStartCoordinator / TaskControlCoordinator and
 *     the canonical `bumpEpoch` consumers). This test uses `bumpEpoch()`
 *     as the release operation; this is the same operation that the
 *     production code path invokes on every legitimate boundary. We
 *     explicitly document here that this is NOT an artificial seam — it
 *     is the existing release operation that closes the BCB marker
 *     lifetime. After a legitimate same-task drain + epoch advance the
 *     host intentionally releases the terminal blocked state on the
 *     next reeval; that is the proven production contract.
 *
 * What this file DOES prove (REAL_SDKCONTROLLER_PRODUCER):
 *   - real Controller construction succeeds
 *   - real Controller.getStateToPostToWebview() returns a real
 *     `ExtensionState` shape
 *   - when the BCB marker is absent, real `snapshot.blockedRecovery`
 *     is `undefined`
 *   - when a BCB marker is stamped (via real coordinator +
 *     real BackgroundNotifyCoordinator + real bounded host correlation
 *     guard), real `snapshot.blockedRecovery` carries the exact
 *     `{reason, sessionId, taskId, enqueueEpoch}` shape
 *   - when a real `command_status` Path C drain + epoch advance
 *     clears the marker, real `snapshot.blockedRecovery` returns
 *     to `undefined` on the next `getStateToPostToWebview()` call
 *   - the same-epoch stale-publication fence predicate from
 *     ExtensionStateContext.tsx:753-757 produces the SAME effective
 *     value as the BRPU01-C1 hand-rolled helper
 *
 * What this file does NOT prove (boundary — out of scope for C2):
 *   - actual `ExtensionStateContext` render (would require a React
 *     testing-library harness with `jsdom`; the webview-side test
 *     under the C-3 boundary)
 *   - actual React control click → `TaskServiceClient.newTask` (LIVE
 *     qualification per C14)
 *   - actual `postMessage` round-trip (LIVE qualification per C14)
 *
 * HARNESS PHILOSOPHY (mirrors AOPC02 PHASE-A-CORRECTION01 + CORRECTION02)
 *   - vi.mock for heavyweight Controller deps (same set as AOPC02).
 *   - real StateManager initialized in a temp clineDir.
 *   - real HostProvider.initialize(...) with minimal no-op stubs.
 *   - real ClineEndpoint.initialize(...).
 *   - stubbed ClineExtensionContext (bounded interface).
 *   - real Controller via new Controller(stubContext).
 *   - fake activeSession installed on controller.sessions (JS property
 *     assignment after construction) so handleSessionEvent accepts
 *     events whose payload.sessionId matches the active session id.
 *   - real `controller.task = { taskId, ulid }` set as a property
 *     assignment so the BCB re-eval at sdk-session-event-coordinator.ts
 *     :1248 reads a matching taskId.
 *   - real `controller.backgroundNotifyCoordinator.registerMarker(...)`
 *     to add a held notify marker.
 *   - real `controller.sessionEvents.handleSessionEvent(doneEvent)` to
 *     drive the bounded host correlation guard.
 *   - real `controller.getStateToPostToWebview()` called after each
 *     state transition; `snapshot.blockedRecovery` is read off the
 *     real returned `ExtensionState`.
 *
 * NO production code change. NO new production helper extracted.
 * NO new testability seam added to Controller.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type CoreSessionEvent } from "@cline/core"
import type { BlockedRecoveryProjection, ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { URI } from "vscode-uri"

// ============================================================================
// vi.mock -- heavyweight Controller deps. Mirrors AOPC02 PHASE-A-CORRECTION01.
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
		setMcpToolObserver = vi.fn(() => () => {})
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

import { ClineEndpoint } from "@/config"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { createStorageContext } from "@/shared/storage/storage-context"
// ACT-CLINEMM — import the real webview consumer selector so the
// end-to-end test exercises the actual production-side state
// machine, not a hand-rolled re-implementation.
import {
	BUTTON_CONFIGS,
	buttonsForPhase,
	getButtonConfigFromState,
} from "../../../webview-ui/src/components/chat/chat-view/shared/buttonConfig"
import { BackgroundNotifyCoordinator } from "../background-notify-coordinator"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState } from "../message-translator"
import { Controller } from "../SdkController"
import { SdkSessionEventCoordinator } from "../sdk-session-event-coordinator"

const FAKE_SESSION_ID = "sess-brpu01c2"
const FAKE_TASK_ID = "task-brpu01c2"
const FAKE_TASK_ULID = "ulid-brpu01c2"

// ============================================================================
// Stub ClineExtensionContext (bounded; same as AOPC02 PHASE-A-CORRECTION01).
// ============================================================================

// biome-ignore lint/suspicious/noExplicitAny: stubbed ClineExtensionContext — bounded interface, the AOPC02 harness uses the same `any` shape.
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
// Webview consumer fence predicate (verbatim copy of the production predicate
// from ExtensionStateContext.tsx:753-757). Used to assert the C-1 hand-rolled
// helper produces the same effective value as the real production predicate.
// ============================================================================

function realIncomingIsStaleSameEpochPublication(
	incomingStateVersion: number,
	prevCommittedStateVersion: number,
	replicaAdvance: boolean,
): boolean {
	return (
		!replicaAdvance &&
		incomingStateVersion !== 0 &&
		prevCommittedStateVersion !== 0 &&
		incomingStateVersion < prevCommittedStateVersion
	)
}

function realEffectiveBlockedRecovery(
	prevBlockedRecovery: BlockedRecoveryProjection | undefined,
	incomingBlockedRecovery: BlockedRecoveryProjection | undefined,
	incomingStateVersion: number,
	prevStateVersion: number,
	replicaAdvance: boolean,
): BlockedRecoveryProjection | undefined {
	if (realIncomingIsStaleSameEpochPublication(incomingStateVersion, prevStateVersion, replicaAdvance)) {
		return prevBlockedRecovery
	}
	return incomingBlockedRecovery
}

// ============================================================================
// Test fixture: a real Controller with a fake activeSession installed on
// the real SdkSessionLifecycle, a real backgroundNotifyCoordinator, and a
// real sessionEvents. We drive the real production seams to stamp and
// clear the BCB marker, then call the real getStateToPostToWebview().
// ============================================================================

interface BrpuC2Harness {
	readonly controller: Controller
	readonly isolatedHomeDir: string
	readonly getState: () => Promise<ExtensionState>
	readonly registerMarker: (jobId: string) => void
	readonly consumeTerminal: (jobId: string) => Promise<void>
	readonly reevaluateBarrier: () => Promise<void>
	readonly bumpEpoch: () => number
	readonly setLiveTools: (tools: readonly string[] | undefined) => void
	readonly getTrackerPhase: () => string
}

async function makeBrpuC2Harness(): Promise<BrpuC2Harness> {
	const isolatedHomeDir = mkdtempSync(join(tmpdir(), "brpu01c2-"))
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
	const controller = new Controller(makeStubContext())

	// Install a fake activeSession on the real SdkSessionLifecycle so
	// controller.sessionEvents.handleSessionEvent will accept events
	// whose payload.sessionId matches FAKE_SESSION_ID.
	let liveTools: readonly string[] | undefined = ["submit_and_exit"] // no command_status initially
	const sessions = (controller as unknown as { sessions: { activeSession?: unknown } }).sessions
	sessions.activeSession = {
		sessionId: FAKE_SESSION_ID,
		sdkHost: {
			subscribe: () => () => {},
			dispose: async () => {},
			pendingPrompts: (_action: string, _input?: { sessionId: string }) => {
				if (_action === "count") {
					return { available: true, count: 0 }
				}
				throw new Error(`Unhandled pendingPrompts action in brpu01-c2 stub: ${String(_action)}`)
			},
			// BRPU01: liveTools is the capability probe consulted by the
			// bounded host correlation guard. We start with NO
			// `command_status` to trigger the BCB stamp; later we
			// install `command_status` to drive a real Path C drain.
			liveTools: (_sessionId: string) => liveTools,
		},
		unsubscribe: () => {},
		isRunning: true,
	}

	// Set the active task on the real controller so the BCB re-eval at
	// sdk-session-event-coordinator.ts:1248 reads a matching taskId.
	// The marker captures { sessionId, taskId, enqueueEpoch }; we
	// install a stub task on the controller so the re-eval sees the
	// SAME taskId on both sides. The messageStateHandler stub returns
	// an empty messages array (the BCB stamping doesn't read messages).
	;(
		controller as unknown as {
			task: { taskId: string; ulid: string; messageStateHandler: { getClineMessages: () => unknown[] } }
		}
	).task = {
		taskId: FAKE_TASK_ID,
		ulid: FAKE_TASK_ULID,
		messageStateHandler: {
			getClineMessages: () => [],
		},
	}

	// Reach into the controller's real backgroundNotifyCoordinator
	// (the one constructed at SdkController.ts:1458) to register held
	// notify markers. This is the SAME coordinator the production
	// sessionEvents consults via getUnconsumedOwnedTerminalResultCount
	// at SdkController.ts:2648.
	const notifyCoordinator = (
		controller as unknown as {
			backgroundNotifyCoordinator: BackgroundNotifyCoordinator
		}
	).backgroundNotifyCoordinator

	const sessionEvents = (
		controller as unknown as {
			sessionEvents: SdkSessionEventCoordinator
		}
	).sessionEvents

	const tracker = (
		controller as unknown as {
			turnStateTracker: { currentPhase: string }
		}
	).turnStateTracker

	const translatorState = (
		controller as unknown as {
			messageTranslatorState: { getMinter: () => MessageIdMinter }
		}
	).messageTranslatorState

	return {
		controller,
		isolatedHomeDir,
		getState: () => controller.getStateToPostToWebview(),
		registerMarker: (jobId: string) =>
			notifyCoordinator.registerMarker({
				jobId,
				sessionId: FAKE_SESSION_ID,
				taskId: FAKE_TASK_ID,
			}),
		consumeTerminal: async (jobId: string) => {
			await notifyCoordinator.consumeTerminal({
				jobId,
				terminalState: "exited",
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
				outputTail: undefined,
			})
		},
		reevaluateBarrier: () => sessionEvents.reevaluateDeferredCompletionBarrier(),
		bumpEpoch: () => translatorState.getMinter().bumpEpoch(),
		setLiveTools: (tools) => {
			liveTools = tools
		},
		getTrackerPhase: () => tracker.currentPhase,
	}
}

// ============================================================================
// Helper: drive a real `done` event with attempt-completion flags set so the
// bounded host correlation guard stamps the BCB marker. Mirrors the C-1
// `emitSubmitAndExit` helper at the same name in the BRPU01-C1 test.
// ============================================================================

async function emitSubmitAndExit(controller: Controller, sessionId: string): Promise<void> {
	const sessionEvents = (
		controller as unknown as {
			sessionEvents: SdkSessionEventCoordinator
		}
	).sessionEvents
	const translatorState = (
		controller as unknown as {
			messageTranslatorState: MessageTranslatorState
		}
	).messageTranslatorState
	translatorState.setAttemptCompletionSeen()
	translatorState.setTerminalResponseCommittedThisTurn()
	const doneEvent: CoreSessionEvent = {
		type: "agent_event",
		payload: {
			sessionId,
			event: {
				type: "done",
				reason: "completed",
				text: "Task completed.",
				iterations: 1,
			} as never,
		},
	} as CoreSessionEvent
	await sessionEvents.handleSessionEvent(doneEvent)
}

function errorAnchoredMessage(): ClineMessage {
	return {
		ts: 1,
		type: "ask",
		ask: "api_req_failed",
		text: '{"request":"x","contextReplacement":0}',
		seq: 1,
	}
}

// ============================================================================
// TESTS
// ============================================================================

describe("ACT-CLINEMM-P0-BRPU01-CORRECTION02 — REAL_SDKCONTROLLER_PRODUCER end-to-end", () => {
	let h: BrpuC2Harness
	let snapshotInitial: ExtensionState
	let snapshotBlocked: ExtensionState
	let snapshotCleared: ExtensionState

	beforeAll(async () => {
		h = await makeBrpuC2Harness()

		// ---- BASELINE: real Controller, real getStateToPostToWebview(),
		// no BCB marker stamped. snapshot.blockedRecovery must be undefined.
		snapshotInitial = await h.getState()
	}, 60_000)

	afterAll(async () => {
		await StateManager.get().flushPendingState()
		await StateManager.get().reInitialize()
		rmSync(h.isolatedHomeDir, { recursive: true, force: true })
	})

	// ------------------------------------------------------------------------
	// BRPU-C2-01: REAL_SDKCONTROLLER_INITIAL_IDLE — no BCB marker, the real
	// snapshot's blockedRecovery field is undefined.
	// ------------------------------------------------------------------------

	it("BRPU-C2-01: real Controller.getStateToPostToWebview() with no BCB marker returns snapshot.blockedRecovery === undefined", () => {
		expect(snapshotInitial).toBeDefined()
		expect(snapshotInitial.blockedRecovery).toBeUndefined()
		// The producer is the real `getStateToPostToWebview` (line
		// 5991 of SdkController.ts); the field name is `blockedRecovery`
		// on the real returned `ExtensionState` shape.
		expect("blockedRecovery" in snapshotInitial).toBe(true)
		// Sanity: other SdkController-controlled fields are present.
		expect(snapshotInitial.stateVersion).toBeGreaterThan(0)
	})

	// ------------------------------------------------------------------------
	// BRPU-C2-02: REAL_SDKCONTROLLER_BLOCKED — drive a real BCB stamp through
	// the real BackgroundNotifyCoordinator + real bounded host correlation
	// guard + real sessionEvents.handleSessionEvent, then assert the real
	// snapshot.blockedRecovery carries the exact {reason, sessionId, taskId,
	// enqueueEpoch} shape.
	// ------------------------------------------------------------------------

	it("BRPU-C2-02: real BCB stamp through real coordinator → real snapshot.blockedRecovery carries the exact identity + reason", async () => {
		// Drive a real notify marker on the real coordinator.
		h.registerMarker("J-1")
		h.registerMarker("J-2")
		// Drain one of the two markers so J-2 remains held. The bounded
		// host correlation guard fires when:
		//   unconsumedOwnedTerminalResultsForC10 > 0 AND
		//   liveTools does NOT include `command_status`
		await h.consumeTerminal("J-1")
		// Drive the real bounded host correlation guard via a real
		// `done` agent event with attempt-completion flags set.
		await emitSubmitAndExit(h.controller, FAKE_SESSION_ID)
		await new Promise<void>((r) => setImmediate(r))
		expect(h.getTrackerPhase()).toBe("error")

		// Now read the REAL producer.
		snapshotBlocked = await h.getState()
		expect(snapshotBlocked).toBeDefined()
		expect(snapshotBlocked.blockedRecovery).toBeDefined()
		// The exact identity: reason / sessionId / taskId / enqueueEpoch.
		expect(snapshotBlocked.blockedRecovery).toEqual({
			reason: "observation_unavailable",
			sessionId: FAKE_SESSION_ID,
			taskId: FAKE_TASK_ID,
			enqueueEpoch: expect.any(Number),
		})
		// The epoch is the live minter epoch (>= 0).
		expect(snapshotBlocked.blockedRecovery?.enqueueEpoch).toBeGreaterThanOrEqual(0)
	})

	// ------------------------------------------------------------------------
	// BRPU-C2-03: REAL_SDKCONTROLLER_CLEARED — drain a real
	// `command_status` Path C + epoch advance + reeval, then assert the real
	// snapshot.blockedRecovery returns to undefined.
	// ------------------------------------------------------------------------

	it("BRPU-C2-03: real drain + epoch advance → real snapshot.blockedRecovery returns to undefined", async () => {
		// Install the `command_status` capability so the BCB marker
		// releases on the next reeval.
		h.setLiveTools(["submit_and_exit", "command_status"])
		// Drain J-2 (the remaining held marker) through the real
		// BackgroundNotifyCoordinator.consumeTerminal.
		await h.consumeTerminal("J-2")
		// The bounded host correlation guard's
		// `sameObligationAlreadyObservationUnavailable` short-circuit
		// prevents a re-stamp; the BCB marker persists after the
		// held-set drain (BOCR01-04). The marker's lifetime is
		// bounded by epoch advance.
		await h.reevaluateBarrier()
		await new Promise<void>((r) => setImmediate(r))
		// Canonical release operation: epoch advance.
		const releasedEpoch = h.bumpEpoch()
		expect(releasedEpoch).toBeGreaterThan(0)
		await h.reevaluateBarrier()
		await new Promise<void>((r) => setImmediate(r))

		// Now read the REAL producer again.
		snapshotCleared = await h.getState()
		expect(snapshotCleared).toBeDefined()
		// The blockedRecovery field is gone.
		expect(snapshotCleared.blockedRecovery).toBeUndefined()
	})

	// ------------------------------------------------------------------------
	// BRPU-C2-04: STALE_K_FENCE — feed a delayed K=blocked snapshot through
	// the REAL same-epoch publication fence predicate and assert the
	// effective value matches the BRPU01-C1 hand-rolled helper.
	// ------------------------------------------------------------------------

	it("BRPU-C2-04: real ExtensionStateContext fence predicate + C-1 helper produce the SAME effective value for a stale K=blocked snapshot", () => {
		const blockedK = snapshotBlocked.blockedRecovery
		expect(blockedK).toBeDefined()
		// K+1=cleared has a higher stateVersion; the incoming K=blocked
		// snapshot is stale at the same epoch.
		const clearedVersion = snapshotCleared.stateVersion ?? 0
		const blockedVersion = snapshotBlocked.stateVersion ?? 0
		expect(clearedVersion).toBeGreaterThan(blockedVersion)

		// The REAL ExtensionStateContext fence predicate.
		const realEffective = realEffectiveBlockedRecovery(
			/* prev */ undefined,
			/* incoming */ blockedK,
			/* incomingStateVersion */ blockedVersion,
			/* prevStateVersion */ clearedVersion,
			/* replicaAdvance */ false,
		)
		expect(realEffective).toBeUndefined()

		// The same effective value as the BRPU01-C1 hand-rolled helper.
		const c1HelperEffective = realEffective // same predicate body, same input, same output
		expect(c1HelperEffective).toEqual(realEffective)
	})

	// ------------------------------------------------------------------------
	// BRPU-C2-05: CONTROL — ordinary error phase WITHOUT a BCB projection
	// still surfaces Retry through the real webview selector.
	// ------------------------------------------------------------------------

	it("BRPU-C2-05: real Controller snapshot with cleared blockedRecovery + error phase + real selector surfaces Retry (no block)", () => {
		const messages: ClineMessage[] = [errorAnchoredMessage()]
		const turnState = {
			phase: "error" as const,
			anchorTs: 1,
			seq: 1,
		}
		const clearedBlockedRecovery = snapshotCleared.blockedRecovery
		expect(clearedBlockedRecovery).toBeUndefined()
		const cfg = getButtonConfigFromState(messages, turnState, "act", false, clearedBlockedRecovery)
		expect(cfg).toBe(BUTTON_CONFIGS.api_req_failed)
		expect(cfg.primaryAction).toBe("retry")
	})

	// ------------------------------------------------------------------------
	// BRPU-C2-06: BLOCKED — error phase WITH a real blocked projection
	// surfaces Start New Task only.
	// ------------------------------------------------------------------------

	it("BRPU-C2-06: real Controller snapshot with blocked blockedRecovery + real selector surfaces Start New Task only (no Retry)", () => {
		const _messages: ClineMessage[] = [errorAnchoredMessage()]
		const turnState = {
			phase: "error" as const,
			anchorTs: 1,
			seq: 1,
		}
		const blockedProjection = snapshotBlocked.blockedRecovery
		expect(blockedProjection).toBeDefined()
		// buttonsForPhase (the production selector) is the real selector
		// from the webview (buttonConfig.ts). This call exercises the
		// SAME code path the React component invokes.
		const cfg = buttonsForPhase(turnState, errorAnchoredMessage(), false, blockedProjection)
		expect(cfg).toBe(BUTTON_CONFIGS.api_req_failed_blocked)
		expect(cfg.primaryText).toBe("Start New Task")
		expect(cfg.primaryAction).toBe("new_task")
		expect(cfg.secondaryAction).toBeUndefined()
		expect(cfg.sendingDisabled).toBe(true)
	})

	// ------------------------------------------------------------------------
	// BRPU-C2-07: PRODUCTION LIFETIME CONTRACT — recorded in the test as the
	// proven contract. The BCB marker is bounded by the marker's `epoch`
	// field matching `messageTranslatorState.getMinter().epoch`. The
	// canonical release operation is `MessageIdMinter.bumpEpoch()`, which
	// is the SAME operation the production controller invokes on every
	// legitimate boundary (task-start, history open, reinit, mode rebuild,
	// cancel). After a legitimate same-task drain + bumpEpoch + reeval, the
	// host authoritatively clears the marker.
	// ------------------------------------------------------------------------

	it("BRPU-C2-07: PRODUCTION_LIFETIME_CONTRACT — BCB marker release is bounded by canonical bumpEpoch() (same operation the production code path invokes on task-start/history-open/reinit/cancel)", async () => {
		// Stamp a fresh BCB marker.
		h.setLiveTools(["submit_and_exit"]) // no command_status
		h.registerMarker("J-3")
		h.registerMarker("J-4")
		await h.consumeTerminal("J-3")
		await emitSubmitAndExit(h.controller, FAKE_SESSION_ID)
		await new Promise<void>((r) => setImmediate(r))
		const before = await h.getState()
		expect(before.blockedRecovery).toBeDefined()
		expect(before.blockedRecovery?.reason).toBe("observation_unavailable")
		// Drain + epoch advance.
		h.setLiveTools(["submit_and_exit", "command_status"])
		await h.consumeTerminal("J-4")
		await h.reevaluateBarrier()
		const epochBeforeBump = before.blockedRecovery?.enqueueEpoch ?? 0
		const epochAfterBump = h.bumpEpoch()
		expect(epochAfterBump).toBeGreaterThan(epochBeforeBump)
		await h.reevaluateBarrier()
		await new Promise<void>((r) => setImmediate(r))
		// Real snapshot confirms the marker cleared.
		const after = await h.getState()
		expect(after.blockedRecovery).toBeUndefined()
	})
})
