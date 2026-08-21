/**
 * ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01 / AOC02 §3
 * REAL_SDKCONTROLLER_PRODUCER_OBJECT discriminator
 * (initial-idle → awaiting_followup → post-clearTask-idle).
 *
 * Per Factory reviewer's strict stop order (§2 GREEN, closed):
 *
 *   1. §2 CANCEL AUTHORITY             [GREEN, CLOSED -- separate test]
 *   2. §3 REAL PRODUCER OBJECT         [THIS FILE]
 *   3. §4 same-object coherence invariants
 *   4. §5 waiting (awaiting_followup) object
 *   5. §6 waiting -> idle object (real canonical owner transition)
 *   6. §7 legacy-fallback discriminator (turnState=undefined reachable?)
 *
 * The §3 file is a smaller, focused sibling of AOPC02 PHASE-A-CORRECTION02:
 * the harness is the same real Controller + real session-event seam, but
 * this file is dedicated to the *chronology* (initial-idle -> active ->
 * waiting -> idle) that the W2 LIVE screenshot implies, and to the same-
 * object seq/source invariants that AOC01 4/4 was unable to assert.
 *
 * WHAT THIS PROBE PROVES
 *
 *   P1. Real `SdkController.getStateToPostToWebview()` returns a
 *       self-coherent object at every captured phase (A0, A, A_wait,
 *       B_idle). All four same-object invariants hold:
 *
 *         stateVersion > 0
 *         epoch         >= 0
 *         turnState.phase agrees with taskHeaderPresentation.phase
 *           (or with documented override -- awaiting_followup + host)
 *         turnState.seq == taskHeaderPresentation.seq
 *         turnState.seq == thinkingPresentation.seq (legacy path only;
 *           shadow path is allowed to carry a different seq)
 *
 *   P2. The real local producer ALWAYS emits `turnState` on the normal
 *       published path. The classic `turnState === undefined` legacy
 *       fallback in `buttonsForPhase` is unreachable from this seam.
 *       => ActionButtons cannot fall back to legacy message-tail
 *          inference on the normal local path.
 *       => `CASE_P2_PRODUCER_OMITS_TURNSTATE` is CLOSED on this path.
 *
 *   P3. CASE_B1 (awaiting_followup host override) is preserved through
 *       the real producer. snapshot at the waiting phase carries
 *       taskHeaderPresentation.phase == awaiting_followup with the
 *       documented source. conservation: TCCC01 CASE_B1.
 *
 * WHAT THIS PROBE DOES NOT PROVE
 *
 *   - POST_TURN_PARTIAL_RACE: the partial-subscription-vs-full-
 *     subscription reordering race (§6 partial path, next ACT).
 *   - React rendering: the LIVE screenshot is a webview render. This
 *     file observes the producer seam; §6 (partial) closes the
 *     render-time seam.
 *   - Cancel button rendering: §2 already proved the production
 *     predicate cannot produce Idle+Cancel.
 *
 * STOP RULE (per AOC02 §7)
 *   If the post-clearTask snapshot B is internally incoherent (P1), or
 *   if the producer is ever observed with `turnState === undefined`
 *   on the normal local path (P2 RED), STOP.
 *
 * CONSERVATION
 *   - NO production code changed.
 *   - AOC01 4/4 GREEN (webview seam).
 *   - AOC02 §2 9/9 GREEN (production predicate).
 *   - AOPC02 stale full-state fencing NOT reopened.
 *   - TCCC01 CASE_B1 awaiting_followup host override preserved (§5).
 *   - Canonical coverage ratchet, THCP/LAC/RSP/LTZ/task-control,
 *     RBE01 untouched.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { URI } from "vscode-uri"

// ============================================================================
// vi.mock -- heavyweight Controller deps. Same proven set used by
// AOPC02 PHASE-A-CORRECTION01/02 (no new mock additions).
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

// Imports placed AFTER vi.mock so the mocked versions resolve.

import type { ExtensionState } from "@shared/ExtensionMessage"
import { ClineEndpoint } from "@/config"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { createStorageContext } from "@/shared/storage/storage-context"
import { Controller } from "../SdkController"

const FAKE_SESSION_ID = "sess-aoc02"

function makeStubContext(): any {
	return {
		subscriptions: [],
		workspaceState: {
			get: vi.fn(() => undefined),
			update: vi.fn(async () => undefined),
		},
		extensionUri: {
			fsPath: "/tmp/mock-extension",
			scheme: "file",
			path: "/tmp/mock-extension",
		} as unknown as URI,
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
		logUri: {
			fsPath: "/tmp/mock-logs",
			scheme: "file",
			path: "/tmp/mock-logs",
		} as unknown as URI,
		logPath: "/tmp/mock-logs",
		extensionMode: 1,
		extension: {
			exports: undefined,
			id: "clinemm",
			extensionPath: "/tmp/mock-extension",
		},
	}
}

// ============================================================================
// same-object invariant helper (used in every §3 capture test).
// ============================================================================

function assertSameObjectCoherence(s: ExtensionState, label: string): void {
	expect(s, `${label}: snapshot is defined`).toBeDefined()
	expect(typeof s.stateVersion, `${label}: stateVersion is a number`).toBe("number")
	expect(s.stateVersion, `${label}: stateVersion > 0`).toBeGreaterThan(0)
	expect(typeof s.epoch, `${label}: epoch is a number`).toBe("number")
	expect(s.epoch, `${label}: epoch >= 0`).toBeGreaterThanOrEqual(0)
	// turnState presence + phase + seq (P2: presence contract)
	expect(s.turnState, `${label}: turnState is defined`).toBeDefined()
	expect(
		["idle", "streaming", "awaiting_followup", "completed", "resumable", "error", "compacting"],
		`${label}: turnState.phase is a known TurnPhase`,
	).toContain(s.turnState?.phase)
	expect(typeof s.turnState?.seq, `${label}: turnState.seq is a number`).toBe("number")
	expect(s.turnState?.seq ?? 0, `${label}: turnState.seq > 0`).toBeGreaterThan(0)
	// taskHeaderPresentation
	expect(s.taskHeaderPresentation, `${label}: taskHeaderPresentation is defined`).toBeDefined()
	expect(typeof s.taskHeaderPresentation?.phase, `${label}: taskHeaderPresentation.phase is a string`).toBe("string")
	expect(["shadow", "host", "legacy"]).toContain(s.taskHeaderPresentation?.source)
	expect(typeof s.taskHeaderPresentation?.seq, `${label}: taskHeaderPresentation.seq is a number`).toBe("number")
	// §4 same-object seq-equality: turnState.seq == taskHeaderPresentation.seq
	expect(s.taskHeaderPresentation?.seq, `${label}: taskHeaderPresentation.seq == turnState.seq`).toBe(s.turnState?.seq)
	// thinkingPresentation
	expect(s.thinkingPresentation, `${label}: thinkingPresentation is defined`).toBeDefined()
	expect(typeof s.thinkingPresentation?.modelStreaming, `${label}: thinkingPresentation.modelStreaming is boolean`).toBe(
		"boolean",
	)
	expect(["shadow", "legacy"]).toContain(s.thinkingPresentation?.source)
	// §4 phase/stream agreement: taskHeader.phase === turnState.phase
	// (the documented source=host override only applies when no LocalRuntime
	// is wired; on the SDK path the headers come from the same source as
	// turnState, so they should agree).
	expect(s.taskHeaderPresentation?.phase, `${label}: taskHeaderPresentation.phase == turnState.phase`).toBe(s.turnState?.phase)
}

describe("ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01 / AOC02 / §3 — REAL_SDKCONTROLLER_PRODUCER_OBJECT", () => {
	let controller: Controller
	// Captures (real local objects returned by getStateToPostToWebview()):
	let sInitial: ExtensionState
	let sActive: ExtensionState
	let sWaiting: ExtensionState
	let sPostClear: ExtensionState
	let isolatedHomeDir: string

	beforeAll(async () => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "aoc02-"))
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

		// Capture 1 (A0): INITIAL_IDLE_BASELINE.
		sInitial = await controller.getStateToPostToWebview()

		// Install a fake activeSession so handleSessionEvent accepts events.
		const sessions = (controller as any).sessions as { activeSession?: unknown }
		sessions.activeSession = {
			sessionId: FAKE_SESSION_ID,
			sdkHost: {
				subscribe: () => () => {},
				stop: async () => {},
				dispose: async () => {},
			},
			unsubscribe: () => {},
			isRunning: true,
		}
		const sessionEvents = (controller as any).sessionEvents as {
			handleSessionEvent: (event: unknown) => Promise<void>
		}

		// Active phase: pending_prompt_submitted -> streaming.
		await sessionEvents.handleSessionEvent({
			type: "pending_prompt_submitted",
			payload: {
				sessionId: FAKE_SESSION_ID,
				id: "pending-aoc02",
				prompt: "AOC02 probe",
			},
		})
		// Force task telemetry recording (mirrors PHASE-A-CORRECTION02).
		;(controller as any).taskTelemetry.startTask("aoc02-probe", Date.now())
		// Capture 2: ACTIVE (streaming).
		sActive = await controller.getStateToPostToWebview()

		// Waiting phase: agent_event(done) without attempt_completion ->
		// setTurnPhase("awaiting_followup") per sdk-session-event-coordinator.
		await sessionEvents.handleSessionEvent({
			type: "agent_event",
			payload: {
				sessionId: FAKE_SESSION_ID,
				event: {
					type: "done",
					reason: "completed",
					text: "aoc02 probe completion",
					iterations: 1,
				},
			},
		})
		// Capture 3: WAITING (awaiting_followup). CASE_B1 conservation.
		sWaiting = await controller.getStateToPostToWebview()

		// POST_TURN_IDLE_YIELD: real canonical owner transition is
		// controller.clearTask() (SdkController.ts:1952-1977), which
		// calls turnStateTracker.set("idle") + postStateToWebview().
		await controller.clearTask()
		// Capture 4: POST_CLEARTASK_IDLE.
		sPostClear = await controller.getStateToPostToWebview()
	}, 60_000)

	afterAll(async () => {
		await StateManager.get().flushPendingState()
		await StateManager.get().reInitialize()
		rmSync(isolatedHomeDir, { recursive: true, force: true })
	})

	// =========================================================================
	// §3 PROBE 1: REAL producer exercised + initial-idle baseline shape.
	// =========================================================================

	it("AOC02-§3-1: real Controller construction succeeded (REAL_SDKCONTROLLER_PRODUCER_EXERCISED)", () => {
		expect(controller).toBeInstanceOf(Controller)
		expect(sInitial).toBeDefined()
		expect(typeof sInitial).toBe("object")
	})

	it("AOC02-§3-2: §2 PRESENCE CONTRACT -- sInitial carries real turnState (P2 GREEN, no undefined turnState on the normal local path)", () => {
		// §2 check: turnState MUST be present on the normal local producer
		// path (NOT undefined). If undefined, ActionButtons would fall
		// back to legacy message-tail inference -- the LEGACY path (b) of
		// the §2 conclusion above.
		expect(sInitial.turnState).toBeDefined()
		expect(sInitial.turnState).not.toBeNull()
		// Phase at initial-idle is "idle" per SdkController.ts:turnStateTracker.ts:18
		expect(sInitial.turnState?.phase).toBe("idle")
		// seq > 0 (real minter stamps)
		expect(sInitial.turnState?.seq ?? 0).toBeGreaterThan(0)
	})

	it("AOC02-§3-3: same-object invariant holds on sInitial (turnState.seq == taskHeaderPresentation.seq, .phase agreement)", () => {
		assertSameObjectCoherence(sInitial, "§3-sInitial")
	})

	// =========================================================================
	// §5 WAITING OBJECT (CASE_B1 conservation through the real producer)
	// =========================================================================

	it("AOC02-§5-A: ACTIVE capture sActive is REAL (turnState.phase === 'streaming' after pending_prompt_submitted)", () => {
		// Per sdk-session-event-coordinator.ts:171, a
		// pending_prompt_submitted event drives setTurnPhase("streaming").
		// The capture must show the real transition -- not the initial
		// "idle" baseline.
		expect(sActive.turnState?.phase).toBe("streaming")
	})

	it("AOC02-§5-B: same-object invariant holds on sActive (streaming)", () => {
		assertSameObjectCoherence(sActive, "§3-sActive")
	})

	it("AOC02-§5-C: WAITING capture sWaiting is REAL (turnState.phase === 'awaiting_followup' after agent_event(done) without attempt_completion)", () => {
		// §5: drive the real canonical active->waiting transition.
		// Without attempt_completion the phase is "awaiting_followup"
		// (sdk-session-event-coordinator.ts:165). CASE_B1 is conserved
		// because the SAME real producer path returns this state --
		// not a hand-rolled simulation.
		expect(sWaiting.turnState?.phase).toBe("awaiting_followup")
	})

	it("AOC02-§5-D: same-object invariant holds on sWaiting (CASE_B1 await_followup)", () => {
		assertSameObjectCoherence(sWaiting, "§3-sWaiting")
	})

	// =========================================================================
	// §6 WAITING -> IDLE OBJECT (real canonical owner transition)
	// =========================================================================

	it("AOC02-§6-A: POST_CLEARTASK capture sPostClear is REAL (turnState.phase === 'idle' after controller.clearTask())", () => {
		// §6: drive the real canonical waiting->idle transition via
		// controller.clearTask() (SdkController.ts:1955), the universal
		// choke-point that sets turnState to "idle".
		expect(sPostClear.turnState?.phase).toBe("idle")
	})

	it("AOC02-§6-B: same-object invariant holds on sPostClear (idle)", () => {
		assertSameObjectCoherence(sPostClear, "§3-sPostClear")
	})

	it("AOC02-§6-C: sPostClear is NOT the live contradiction: TaskHeader=idle AND Thinking.modelStreaming=false AND backgroundCommandRunning=false", () => {
		// §6 + §2 interaction: in the production predicate (verified §2
		// GREEN), an idle phase + no foreground command returns the
		// default config (no Cancel). Verify the producer side agrees:
		// taskHeaderPresentation.phase is "idle" AND thinkingPresentation.
		// modelStreaming is false AND backgroundCommandRunning is false.
		expect(sPostClear.taskHeaderPresentation?.phase).toBe("idle")
		expect(sPostClear.thinkingPresentation?.modelStreaming).toBe(false)
		expect(sPostClear.backgroundCommandRunning).toBe(false)
	})

	// =========================================================================
	// §7 LEGACY FALLBACK DISCRIMINATOR
	// =========================================================================

	it("AOC02-§7-A: across ALL four captures (initial/active/waiting/post-clear), turnState is NEVER undefined on the normal local producer path", () => {
		// §7: prove the legacy `turnState === undefined` fallback is NOT
		// reachable on the normal local path. ActionButtons only falls
		// back to getButtonConfigForMessages tail-walking when turnState
		// is undefined; if the producer always supplies turnState, the
		// legacy path is unreachable from this seam.
		for (const [label, s] of [
			["sInitial", sInitial],
			["sActive", sActive],
			["sWaiting", sWaiting],
			["sPostClear", sPostClear],
		] as const) {
			expect(s.turnState, `${label}: turnState is defined on the normal local path`).toBeDefined()
			expect(s.turnState?.phase, `${label}: turnState.phase is a known TurnPhase`).not.toBeUndefined()
		}
	})

	it("AOC02-§7-B: seq is non-decreasing across the chronology (initial -> active -> waiting -> post-clear)", () => {
		// Conservative check: turnState.seq does NOT regress across the
		// chronology. (The TurnStateTracker advances seq on every set(),
		// so any fresh transition strictly increases seq; a no-op .set()
		// of the same phase still bumps seq because nextSeq() is called
		// unconditionally inside set().)
		const seqs = [sInitial.turnState?.seq, sActive.turnState?.seq, sWaiting.turnState?.seq, sPostClear.turnState?.seq]
		for (let i = 1; i < seqs.length; i++) {
			expect(seqs[i] ?? 0, `seq[${i}] >= seq[${i - 1}]`).toBeGreaterThanOrEqual(seqs[i - 1] ?? 0)
		}
	})
})
