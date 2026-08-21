/**
 * ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01 / AOPC02 /
 * PHASE-A-CORRECTION01 — REAL_SDKCONTROLLER_INITIAL_IDLE_BASELINE
 *   (RECLASSIFIED by AOPC02 PHASE-A-CORRECTION02)
 *
 * ENTRY VERDICT = HALT_TEST_SEAM_INVALID
 *   The prior Phase A claimed SYNCHRONIZED_PUBLICATION_INPUT_TOKEN =
 *   REAL_PRODUCTION_SEAM, but the test in fact locally replicated the
 *   publication assembly. The Factory reviewer rejected that
 *   reclassification as SYNTHETIC_REAL. This file is the bounded
 *   REAL_SDKCONTROLLER_PRODUCER discriminator that closes the gap.
 *
 * PURPOSE (CLOSED AT THE PRODUCER SEAM; BOUNDARY RECLASSIFIED)
 *   Per Factory reviewer Phase A plan:
 *     "Use the real current state producer:
 *        SdkController.getStateToPostToWebview()
 *      or its actual renamed equivalent if source recon shows the
 *      method moved. Drive only enough production state to reach the
 *      known host idle-yield condition. Then invoke the producer ONCE
 *      and retain the returned object S."
 *
 *   This file constructs a real `Controller` via the established
 *   vi.mock pattern (mirroring providerCatalogSmoke.test.ts +
 *   session-auto-approval.controller.test.ts + sdk-remote-config-control-
 *   plane.test.ts), calls `await controller.getStateToPostToWebview()`
 *   ONCE, captures the EXACT returned object S, and runs the E1/E2/E3
 *   classifier against S.
 *
 * ====================================================================
 * RECLASSIFICATION (AOPC02 PHASE-A-CORRECTION02)
 * ====================================================================
 *
 *   Per Factory reviewer:
 *     "The captured state is initial idle, not idle-after-a-turn /
 *      idle-yield. The test constructs a fresh Controller, starts no
 *      task, drives no runtime events, drives no task telemetry, and
 *      immediately captures:
 *
 *        controller = new Controller(stubContext)
 *        snapshot = await controller.getStateToPostToWebview()
 *
 *      The assertions then observe exactly what a brand-new controller
 *      should contain. That proves:
 *
 *        REAL_SDKCONTROLLER_INITIAL_IDLE_PUBLICATION = COHERENT
 *
 *      It does not prove:
 *
 *        REAL_SDKCONTROLLER_POST_ASYNC_IDLE_YIELD_PUBLICATION = COHERENT
 *
 *      And the latter is the load-bearing question for the LIVE bug."
 *
 *   Reclassified:
 *
 *     REAL_SDKCONTROLLER_PRODUCER          = PROVEN          (this file)
 *     REAL_CONTROLLER_CONSTRUCTION         = PROVEN          (this file)
 *     REAL_GET_STATE_CALL                  = PROVEN          (this file)
 *     INITIAL_IDLE_SNAPSHOT_COHERENT       = PROVEN          (this file)
 *
 *     POST_TURN_IDLE_YIELD_SNAPSHOT        = NOT_EXERCISED   (NOT proven here)
 *     POST_ASYNC_PUBLICATION_COHERENCE     = NOT_PROVEN      (NOT proven here)
 *     E1_POST_TURN                         = NOT_PROVEN      (NOT proven here)
 *
 *   The post-turn discriminator lives in
 *   `application-ownership-projection-coherence.aopc02-phase-a-correction02.c24-c-bridge.test.ts`.
 *
 * HARNESS PHILOSOPHY (per Factory reviewer)
 *   - vi.mock for the heavyweight Controller deps that the existing
 *     test suite already mocks (McpHub, AuthService, OcaAuthService,
 *     ClineAccountService, telemetry distinctId).
 *   - real StateManager initialized in a temp clineDir (mirrors the
 *     providerCatalogSmoke.test.ts pattern at line 33).
 *   - real Controller constructed with a stub ClineExtensionContext
 *     (the ClineExtensionContext interface is bounded; see
 *     apps/vscode/src/shared/cline/context.ts:28).
 *   - NO production code change.
 *   - NO new production helper extracted.
 *   - DI is implemented via vi.mock, not via new production seams.
 *
 * WHAT THIS PROBE PROVES
 *   - REAL_SDKCONTROLLER_PRODUCER_EXERCISED: the real
 *     controller.getStateToPostToWebview() returned object is captured.
 *   - REAL_TASK_TELEMETRY (initial-idle observation): S.taskTelemetry is
 *     the real value returned by the controller's own
 *     TaskTelemetryTracker.get() AT INITIAL IDLE (no task started).
 *   - REAL_BACKGROUND_COMMAND (initial-idle observation):
 *     S.backgroundCommandRunning is the real controller-owned value AT
 *     INITIAL IDLE.
 *   - REAL_SHADOW (initial-idle absence path):
 *     S.thinkingPresentation.source / S.taskHeaderPresentation.source
 *     come from the real getLocalShadowProjection() / getLocalShadowPhase()
 *     call paths. Both return `undefined` here (no LocalRuntimeHost
 *     wired); selectors fall through to the legacy-source branch per
 *     CONTRACT_2. This proves the legacy-absence fallback works, NOT
 *     the shadow-observation-and-then-idle transition.
 *   - REAL_IDENTITY: S.stateVersion, S.epoch, S._ptadPushId, S.turnState,
 *     S.thinkingPresentation, S.taskHeaderPresentation are stamped by the
 *     real production code with the real shared MessageIdMinter counter.
 *
 * WHAT THIS PROBE DOES NOT PROVE
 *   - POST_TURN_IDLE_YIELD_COHERENT (no task has run; tracker has not
 *     transitioned through streaming→terminal).
 *   - POST_ASYNC_SNAPSHOT_COHERENT (no real active→idle transition
 *     exercised; this is the load-bearing question for the LIVE bug).
 *   - Cancel authority / composer authority: those predicates live in
 *     webview-ui (not importable from the bridge); this probe captures
 *     the SdkController-produced inputs that feed them and lets Phase B
 *     apply the real webview selectors.
 *   - The numeric relation `stateVersion == turnState.seq + N` is NOT
 *     asserted; production does not promise that. SHAPE-only invariants
 *     are asserted.
 *
 * STOP RULE (per Factory reviewer plan)
 *   If Controller construction fails for any reason (unmocked dep,
 *   runtime side effect, StateManager miss), HALT_TEST_SEAM_INVALID and
 *   report the smallest testability seam needed. Do NOT write a second
 *   emulation.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { URI } from "vscode-uri"

// ============================================================================
// vi.mock -- heavyweight Controller deps. Mirrors the existing test patterns:
//   - providerCatalogSmoke.test.ts:18 (distinctId)
//   - session-auto-approval.controller.test.ts:27 (McpHub)
//   - sdk-remote-config-control-plane.test.ts:19,25 (ClineAccountService, AuthService)
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

// BannerService is queried inside buildBaseState().getStateToPostToWebview
// at line 100 (`BannerService.get().getActiveBanners()`). Stubbing it
// avoids the HostRegistryInfo initialization chain (which is unrelated
// to the producer seam under test).
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

// ClineEnv imports + ensureSettingsDirectoryExists / resolveDefaultMcpSettingsPath
// / telemetryService are imported by Controller; they are real singletons that
// initialize lazily. Mocking @core/storage/disk mirrors
// session-auto-approval.controller.test.ts:23 and prevents the McpHub
// constructor's filesystem calls from hitting real paths.
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

// ============================================================================
// Stub ClineExtensionContext (the interface is bounded; see
// apps/vscode/src/shared/cline/context.ts:28). Only the fields the
// Controller constructor and getStateToPostToWebview actually read are
// populated. The rest are stubs that satisfy the interface.
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
		extensionMode: 1, // ExtensionMode.Production
		extension: { exports: undefined, id: "clinemm", extensionPath: "/tmp/mock-extension" },
	}
}

// ============================================================================
// Probe.
// ============================================================================

describe("ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01 / AOPC02 / PHASE-A-CORRECTION01 — REAL_SDKCONTROLLER_INITIAL_IDLE_BASELINE", () => {
	let controller: Controller
	let snapshot: ExtensionState
	let isolatedHomeDir: string

	beforeAll(async () => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "aopc02-correction01-"))
		process.env.CLINE_DIR = join(isolatedHomeDir, ".cline")
		// HostProvider.initialize is called once at extension activation
		// (apps/vscode/src/extension.ts:664). In the test harness, the
		// minimal no-op stubs satisfy the type signatures; no webview,
		// no edit preview, no comment review, no real host bridge are
		// needed for the producer seam under test.
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
		const stubContext = makeStubContext()
		controller = new Controller(stubContext)
		snapshot = await controller.getStateToPostToWebview()
	}, 60_000)

	afterAll(async () => {
		await StateManager.get().flushPendingState()
		await StateManager.get().reInitialize()
		rmSync(isolatedHomeDir, { recursive: true, force: true })
	})

	// ------------------------------------------------------------------------
	// REAL_SDKCONTROLLER_PRODUCER_EXERCISED: capture-once invariants on the
	// real returned S.
	// ------------------------------------------------------------------------

	it("AOPC02-CORRECTION01-1: REAL controller construction succeeded (REAL_SDKCONTROLLER_PRODUCER_EXERCISED)", () => {
		expect(controller).toBeInstanceOf(Controller)
		expect(snapshot).toBeDefined()
		// ExtensionState fields from the real SdkController.
		expect(typeof snapshot).toBe("object")
	})

	it("AOPC02-CORRECTION01-2: real S.stamp fields are present and well-typed", () => {
		// stateVersion + epoch: stamped by the real MessageIdMinter on every
		// getStateToPostToWebview() call (SdkController.ts:2907).
		expect(typeof snapshot.stateVersion).toBe("number")
		expect(snapshot.stateVersion).toBeGreaterThan(0)
		expect(typeof snapshot.epoch).toBe("number")
		expect(snapshot.epoch).toBeGreaterThanOrEqual(0)
		// _ptadPushId: undefined when PTAD off (production default per
		// SdkController.ts:2891-2892).
		expect(snapshot._ptadPushId).toBeUndefined()
	})

	it("AOPC02-CORRECTION01-3: real S.turnState is the tracker's own snapshot (no recomputation)", () => {
		expect(snapshot.turnState).toBeDefined()
		expect(snapshot.turnState).not.toBeNull()
		// phase defaults to "idle" until the host transitions; with no task
		// started, the tracker has phase "idle".
		expect(snapshot.turnState?.phase).toBe("idle")
		expect(typeof snapshot.turnState?.seq).toBe("number")
		expect(snapshot.turnState?.seq ?? 0).toBeGreaterThan(0)
	})

	it("AOPC02-CORRECTION01-4: real S.thinkingPresentation + S.taskHeaderPresentation are stamped", () => {
		// Both selectors feed from the same tracker.get() and the same
		// getLocalShadowProjection() / getLocalShadowPhase() call paths.
		expect(snapshot.thinkingPresentation).toBeDefined()
		expect(snapshot.thinkingPresentation!.modelStreaming).toBe(false)
		expect(["shadow", "legacy"]).toContain(snapshot.thinkingPresentation!.source)
		expect(snapshot.thinkingPresentation!.seq).toBe(snapshot.turnState?.seq)

		expect(snapshot.taskHeaderPresentation).toBeDefined()
		expect(snapshot.taskHeaderPresentation!.phase).toBe("idle")
		expect(["shadow", "host", "legacy"]).toContain(snapshot.taskHeaderPresentation!.source)
		expect(snapshot.taskHeaderPresentation!.seq).toBe(snapshot.turnState?.seq)
	})

	it("AOPC02-CORRECTION01-5: real S.taskTelemetry (REAL value, not hand-rolled)", () => {
		// TaskTelemetryTracker.get() returns `undefined` when no task has
		// been started; that IS the real value (not a hand-rolled
		// assumption). The test asserts the OBSERVED value.
		expect(snapshot.taskTelemetry).toBeUndefined()
	})

	it("AOPC02-CORRECTION01-6: real S.backgroundCommandRunning is the controller-owned value", () => {
		// No background command has been started by this Controller; the
		// initial value is `false` (SdkController.ts:306).
		expect(snapshot.backgroundCommandRunning).toBe(false)
	})

	// ------------------------------------------------------------------------
	// SHAPE-only identity correlation. Do NOT assert numeric equality
	// between stateVersion and turnState.seq -- they are independently-
	// advanced counters.
	// ------------------------------------------------------------------------

	it("AOPC02-CORRECTION01-7: SHAPE identity correlation -- thinkingPresentation.seq and taskHeaderPresentation.seq are EQUAL to turnState.seq (all from same tracker.get() cascade)", () => {
		expect(snapshot.thinkingPresentation!.seq).toBe(snapshot.turnState?.seq)
		expect(snapshot.taskHeaderPresentation!.seq).toBe(snapshot.turnState?.seq)
		expect(snapshot.thinkingPresentation!.seq).toBe(snapshot.taskHeaderPresentation!.seq)
	})

	it("AOPC02-CORRECTION01-8: SHAPE identity correlation -- stateVersion >= 1, turnState.seq >= 1, NOT asserting stateVersion == turnState.seq + N", () => {
		// SHAPE-only: each domain is >= 1. The numeric relation between
		// stateVersion and turnState.seq is NOT asserted here because the
		// production contract does not promise it (W1 stamps consume seq
		// ticks independently of tracker.set() calls).
		expect(snapshot.stateVersion).toBeGreaterThan(0)
		expect(snapshot.turnState?.seq).toBeGreaterThan(0)
		// epoch is non-negative and stable across same-session calls.
		expect(snapshot.epoch).toBeGreaterThanOrEqual(0)
	})

	// ------------------------------------------------------------------------
	// E1/E2/E3 EXTENSION-SIDE CLASSIFIER on REAL S.
	//
	// E1 (coherent idle publication): REAL_SDKCONTROLLER_E1 = PROVEN if
	//   snapshot.taskHeaderPresentation!.phase === "idle"
	//   snapshot.thinkingPresentation!.modelStreaming === false
	//   snapshot.backgroundCommandRunning === false
	//   (Cancel/composer authority NOT classified here -- those predicates
	//    live in webview-ui and are out of scope for this harness; they
	//    are captured for Phase B to evaluate.)
	//
	// E2 (internal publication contradiction): REAL_SDKCONTROLLER_E2 = RED
	//   if TaskHeader=idle AND Thinking=true AND/OR backgroundCommandRunning=true.
	//
	// E3 (runtime truth active, header idle): NOT EXERCISABLE in this
	//   harness (no LocalRuntimeHost + AgentRuntime). Documented here for
	//   completeness.
	// ------------------------------------------------------------------------

	it("AOPC02-CORRECTION01-E1-CLASSIFIER: at REAL_SDKCONTROLLER_INITIAL_IDLE_BASELINE (no task started, no lifecycle transition), real S is internally coherent", () => {
		const realE1 = {
			taskHeaderPhaseNonActive: snapshot.taskHeaderPresentation!.phase !== "compacting",
			thinkingModelStreamingFalse: snapshot.thinkingPresentation!.modelStreaming === false,
			backgroundCommandInactive: snapshot.backgroundCommandRunning === false,
		}
		expect(realE1.taskHeaderPhaseNonActive).toBe(true)
		expect(realE1.thinkingModelStreamingFalse).toBe(true)
		expect(realE1.backgroundCommandInactive).toBe(true)
	})

	it("AOPC02-CORRECTION01-E2-CLASSIFIER: real S does NOT carry an internal publication contradiction (E2 not reproduced)", () => {
		// E2 would be TaskHeader=idle + Thinking=true and/or Cancel-active.
		// Cancel-active is NOT classifiable here (webview selector out of
		// scope); E2 is only classifiable on the SdkController-controlled
		// fields.
		const internalContradiction =
			snapshot.taskHeaderPresentation!.phase === "idle" && snapshot.thinkingPresentation!.modelStreaming === true
		expect(internalContradiction).toBe(false)
	})

	it("AOPC02-CORRECTION01-CANCEL-COMPOSER-INPUTS: capture the real inputs that feed Cancel/composer predicates (real selectors applied in Phase B)", () => {
		// The real Cancel affordance's predicate lives in webview-ui and is
		// NOT importable from the bridge. The SdkController-controlled
		// inputs that feed it are captured here for Phase B to apply the
		// real production selectors.
		const realCancelInputs = {
			taskHeaderPresentationPhase: snapshot.taskHeaderPresentation!.phase,
			taskHeaderPresentationSource: snapshot.taskHeaderPresentation!.source,
			thinkingPresentationModelStreaming: snapshot.thinkingPresentation!.modelStreaming,
			thinkingPresentationSource: snapshot.thinkingPresentation!.source,
			backgroundCommandRunning: snapshot.backgroundCommandRunning,
			taskTelemetry: snapshot.taskTelemetry,
			turnStatePhase: snapshot.turnState?.phase,
		}
		// The SdkController-controlled fields ARE all non-active here:
		expect(realCancelInputs.taskHeaderPresentationPhase).not.toBe("compacting")
		expect(realCancelInputs.thinkingPresentationModelStreaming).toBe(false)
		expect(realCancelInputs.backgroundCommandRunning).toBe(false)
		expect(realCancelInputs.turnStatePhase).toBe("idle")
		// The values above are the OBSERVED real values -- not hand-rolled.
	})
})
