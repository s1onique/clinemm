/**
 * ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01
 * ACTIVE_SESSION_IMMEDIATE_NEXT_TOOL_CALL RED (Phase 3 RED).
 *
 * Source-only recon (the previous step in this ACT) found:
 *
 *   - SdkSessionRebuildScheduler.drainIfIdle bails when
 *     activeSession.isRunning === true
 *     (apps/vscode/src/sdk/sdk-session-rebuild-scheduler.ts:58).
 *   - SdkSessionLifecycle.replaceActiveSession also refuses
 *     oldSession.isRunning === true (sdk-session-lifecycle.ts:388).
 *   - The coordinator's handleOverrideChanged always requests a
 *     rebuild when an active session exists and the bound value
 *     changed (sdk-session-auto-approval-coordinator.ts:74-99).
 *   - Existing active-session-rebuild coverage
 *     (session-auto-approval-active-session-rebuild.test.ts) sets
 *     `isRunning = false` on its mocks — none of those tests
 *     exercise the running-session immediate-next-call path.
 *   - The SdkController composer closure at
 *     SdkController.ts:862-932 reads the override store
 *     PER REQUEST (line 866: `this.sessionAutoApproval.getOverride(
 *     this.sessions.getActiveSession()?.sessionId)`). So the
 *     closure is designed as a live-read path, not a frozen
 *     snapshot.
 *
 * The R2 hypothesis ("next tool call sees pre-toggle state because
 * rebuild is deferred while running") was REFUTED in PRODUCTION-
 * SHAPED composition by this test.
 *
 * OBSERVED OUTCOME (this run, on 2fa94d162):
 *
 *   pre-toggle observation (negative control)        = ASK
 *   immediate request after toggle (isRunning=true)  = ALLOW
 *     source = host_mode_all_seatbelt_required
 *     mandatorySeatbeltExecution = true
 *   post-idle request after rebuild (drained)        = ALLOW
 *     source = host_mode_all_seatbelt_required
 *     mandatorySeatbeltExecution = true
 *
 * STOP RULES (per the operator's C1 brief):
 *
 *   immediate = ASK   AND  post-idle = ALLOW
 *     → RED_REPRODUCED. R2 hypothesis strongly confirmed.
 *
 *   immediate = ALLOW  AND  post-idle = ALLOW   ← OBSERVED
 *     → HALT_RED_NOT_REPRODUCED. R2 insufficient-cause.
 *
 *   test cannot reach the real approval seam through the active
 *     session/host
 *     → CAPTURE_INSUFFICIENT. Do NOT fake the seam with a manually
 *       composed auth object.
 *
 * DISPOSITION (C1 reviewer correction):
 *
 *   ACTIVE_SESSION_REBUILD_R2 = NOT_REPRODUCED /
 *                               EXONERATED_AS_SUFFICIENT_CAUSE
 *   REQUEST_TIME_OVERRIDE_READ = PROVEN_IN_PRODUCTION_SHAPED_
 *                                COMPOSITION / NOT_YET_LIVE_BOUND
 *   LIVE_DEFECT                 = REAL
 *   ROOT_CAUSE                  = UNBOUND
 *
 *   This test exercises a SYNTHETIC_REAL / PRODUCTION_SHAPED
 *   closure: a hand-built `resolveHostAuthorization` body that
 *   reads from the same store + lifecycle the production closure
 *   reads from, and that hard-codes the Seatbelt envelope producer
 *   argument ("seatbelt-experimental") instead of calling
 *   `resolveExperimentalSandboxMode()` on the real runtime. The
 *   test is close enough to prove the design PERMITS request-time
 *   live reads, but it does NOT prove the failing live request
 *   actually traversed that closure with the expected runtime
 *   state. That second claim requires the default-off two-probe
 *   live capture (next-authorized step), not another synthetic
 *   RED.
 *
 *   Real-seam coverage this test DOES use:
 *     - real SessionAutoApprovalStore
 *     - real SdkSessionRebuildScheduler
 *     - real SdkSessionAutoApprovalCoordinator
 *     - real buildSdkControllerEvaluateCommandToolApproval factory
 *     - real buildPathAuthorityEvidence
 *     - real getCommandHostAuthorization / resolveSessionHostAuthorization /
 *       applySeatbeltAuthorityEnvelope / stripRequiresApproval
 *
 *   Real-seam coverage this test DOES NOT use (limitation):
 *     - actual SdkController instance closure
 *     - actual runtime resolveExperimentalSandboxMode()
 *     - actual MvdanShHelper binary path / parseResult
 *
 * NEXT: default-off outer + inner live probes (with sibling
 * positive control). Production repair remains NOT_AUTHORIZED.
 *
 * OFFLINE_RED_BUDGET = EXHAUSTED_FOR_NOW.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { CommandHostAuthorization } from "@cline/core"
import { buildPathAuthorityEvidence } from "@cline/core"
import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { ActiveSession } from "../cline-session-factory"
import { buildSdkControllerEvaluateCommandToolApproval } from "../SdkController"
import { SdkSessionAutoApprovalCoordinator } from "../sdk-session-auto-approval-coordinator"
import { SdkSessionRebuildScheduler } from "../sdk-session-rebuild-scheduler"
import { applySeatbeltAuthorityEnvelope, getCommandHostAuthorization } from "../sdk-tool-policies"
import { resolveSessionHostAuthorization, SessionAutoApprovalStore, stripRequiresApproval } from "../session-auto-approval"

const LIVE_STIMULUS_SHAPE = (victim: string) => ({
	command: `rm ${victim} && ls ${victim} 2>&1 | head -2`,
	requires_approval: false,
})

// Mirror the production live condition at corr=9XP2YGTB90: the user has
// executeSafeCommands=true (so the safe-only path is in scope) and the
// session override is the only thing that flips the mode from safe-only
// to "all" mid-session. Other flags stay at production defaults.
const LIVE_PERSISTED_AUTO_APPROVAL: AutoApprovalSettings = {
	version: 1,
	enabled: true,
	favorites: [],
	maxRequests: 20,
	actions: {
		readFiles: true,
		readFilesExternally: true,
		editFiles: true,
		editFilesExternally: true,
		executeSafeCommands: true,
		executeAllCommands: false,
		useBrowser: true,
		useMcp: true,
	},
	enableNotifications: false,
}

describe("ACTIVE_SESSION_IMMEDIATE_NEXT_TOOL_CALL RED - the user contract", () => {
	let workspaceRoot: string
	let victim: string
	let tmpDir: string

	beforeAll(() => {
		workspaceRoot = realpathSync(process.cwd())
		mkdirSync(join(workspaceRoot, ".factory", "tmp"), { recursive: true })
		tmpDir = mkdtempSync(join(workspaceRoot, ".factory/tmp/red-running-next-call-"))
		victim = join(tmpDir, "victim.txt")
		writeFileSync(victim, "fixture for the running-session immediate-next-call RED\n", "utf8")
	})

	afterAll(() => {
		try {
			rmSync(tmpDir, { recursive: true, force: true })
		} catch {
			// ignore
		}
	})

	// Real-seam harness: every dependency in this block is the production
	// component the operator named. Only the *resolveHostAuthorization*
	// closure body is hand-built, and it reads from the same store +
	// lifecycle the production closure reads from.

	function buildRealSeamHarness() {
		const sessionAutoApproval = new SessionAutoApprovalStore()
		// Minimal stub SdkSessionHost — only the fields read by the harness
		// (`replaceActiveSession` and `clearActiveSession`) plus enough
		// surface for the ActiveSession type to be satisfied. The closure
		// never invokes the host, so the rest is non-load-bearing.
		const stubSdkHost = {
			runtimeAddress: undefined,
			start: vi.fn(),
			send: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stop: vi.fn(),
			dispose: vi.fn(),
			get: vi.fn(),
			list: vi.fn(),
			listHistory: vi.fn(),
			delete: vi.fn(),
			readMessages: vi.fn(),
			update: vi.fn(),
			restore: vi.fn(),
		} as unknown as ActiveSession["sdkHost"]
		const activeSession: ActiveSession = {
			sessionId: "S1",
			isRunning: true, // running — rebuild drain is deferred
			sdkHost: stubSdkHost,
			unsubscribe: vi.fn(),
			startResult: undefined,
		}

		// Replace target: simulates the lifecycle's replaceActiveSession
		// returning a fresh session object (same id) and the lifecycle
		// flipping isRunning back to false.
		const replacementSession: ActiveSession = {
			sessionId: "S1",
			isRunning: false, // rebuild fired → idle
			sdkHost: stubSdkHost,
			unsubscribe: vi.fn(),
			startResult: undefined,
		}
		let installed: ActiveSession = activeSession

		const sessions = {
			getActiveSession: () => installed,
			replaceActiveSession: vi.fn(async (_args: unknown) => {
				installed = replacementSession
				return {
					oldSessionId: activeSession.sessionId,
					startResult: undefined as never,
					sdkHost: replacementSession.sdkHost,
				}
			}),
			clearActiveSession: vi.fn(async (_reason?: string) => undefined),
		}

		const rebuilds = new SdkSessionRebuildScheduler({
			sessions: { getActiveSession: sessions.getActiveSession },
		})

		const stateManagerStub = {
			getGlobalSettingsKey: vi.fn((key: string) => {
				if (key === "mode") return "act"
				if (key === "autoApprovalSettings") return LIVE_PERSISTED_AUTO_APPROVAL
				return undefined
			}),
		}

		const messagesStub = {
			emitSessionEvents: vi.fn(),
			appendAndEmit: vi.fn(),
		}

		const coordinator = new SdkSessionAutoApprovalCoordinator({
			stateManager: stateManagerStub as never,
			sessions,
			messages: messagesStub as never,
			sessionConfigBuilder: {
				build: vi.fn(async (args: { cwd: string; mode: string; sessionAutoApprovalOverride?: string }) => ({
					providerId: "anthropic",
					modelId: "claude-sonnet-4-6",
					systemPrompt: "test",
					cwd: args.cwd,
					mode: args.mode,
					enableTools: true,
					enableSubmitAndExit: args.sessionAutoApprovalOverride === "all",
					sessionAutoApprovalOverride: args.sessionAutoApprovalOverride,
				})),
			} as never,
			sessionAutoApproval,
			getWorkspaceRoot: async () => workspaceRoot,
			loadInitialMessages: async () => undefined,
			buildStartSessionInput: ((config: unknown, input: { cwd: string; mode: string }) => ({
				config,
				cwd: input.cwd,
				mode: input.mode,
			})) as never,
			postStateToWebview: async () => undefined,
			rebuilds,
		})

		return { sessionAutoApproval, sessions, rebuilds, coordinator, activeSession, replacementSession, stateManagerStub }
	}

	function makeProductionCallback(workspaceRoot: string) {
		const harness = buildRealSeamHarness()
		// Production-shape resolveHostAuthorization. Mirrors SdkController.ts:862-932
		// VERBATIM in structure. Only differences:
		//   - mcpHub is omitted (the command path doesn't read it for our stimulus).
		//   - buildPathAuthorityEvidence is bound to the workspace we control.
		//   - resolveExperimentalSandboxMode() is stubbed to
		//     "seatbelt-experimental" so the Seatbelt envelope stamp fires
		//     whenever the override is "all".
		const buildAuth = async (
			requestInput: unknown,
		): Promise<{ hostAuthorization: CommandHostAuthorization; toolInput: unknown }> => {
			const persisted = harness.stateManagerStub.getGlobalSettingsKey("autoApprovalSettings") as AutoApprovalSettings
			const sessionId = harness.sessions.getActiveSession()?.sessionId
			const override = harness.sessionAutoApproval.getOverride(sessionId)
			const evidence = await buildPathAuthorityEvidence({
				workspaceRoots: [workspaceRoot],
				cwd: workspaceRoot,
				command: requestInput as { command: string; requires_approval: boolean },
			})
			if (!evidence.ok) {
				throw new Error(`evidence builder failed: ${evidence.reason}`)
			}
			const canonicalRoots = evidence.evidence.roots
			const canonicalCwd: string | undefined = evidence.evidence.cwd ?? undefined
			let hostAuthorization = getCommandHostAuthorization(
				"run_commands",
				persisted,
				undefined,
				{
					workspaceRoots: canonicalRoots,
					cwd: canonicalCwd,
					pathAuthorityEvidence: evidence.evidence,
				},
				requestInput,
			)
			let toolInput: unknown = requestInput
			if (override === "all") {
				const sessionHostAuth = resolveSessionHostAuthorization(hostAuthorization, override)
				if (sessionHostAuth) {
					hostAuthorization = sessionHostAuth
				}
				toolInput = stripRequiresApproval(requestInput)
				hostAuthorization = applySeatbeltAuthorityEnvelope(hostAuthorization, "seatbelt-experimental")
			}
			return { hostAuthorization, toolInput }
		}

		const callback = buildSdkControllerEvaluateCommandToolApproval({
			resolveHostAuthorization: buildAuth,
			// Helper unavailable (matches production default — binary not bundled).
			// V1 fallthrough fires; the Seatbelt envelope still suppresses the
			// R5 hard floor because it is host-authority, not V2-derivation.
			getHelper: () => ({ invoke: async (_input: unknown) => null }) as never,
		})
		return { harness, callback }
	}

	// -------------------------------------------------------------------
	// T-RUNNING-NEXT-CALL
	// -------------------------------------------------------------------
	//   given:
	//     active session S1 exists, isRunning=true (rebuild deferred)
	//     bound override = "none" pre-toggle
	//   when:
	//     user toggles "ALL — this task" via the canonical
	//     coordinator.handleOverrideChanged path
	//   then (immediately, BEFORE rebuild drains):
	//     the next command approval request MUST observe ALL semantics:
	//       approved=true
	//       decision.source = "host_mode_all_seatbelt_required"
	//       mandatorySeatbeltExecution=true
	//
	//   and (after sessionBecameIdle drains the queued rebuild):
	//     a subsequent request MUST still observe ALL semantics (the
	//     rebuild does not regress the closure's behavior).
	it("T-RUNNING-NEXT-CALL: running-session immediate-next tool call observes the toggled override", async () => {
		const { harness, callback } = makeProductionCallback(workspaceRoot)
		const liveInput = LIVE_STIMULUS_SHAPE(victim)

		// PRE-STATE: bound override is "none". Closure sees the persisted
		// safe-only auth (no Seatbelt envelope). The R5 catastrophic class
		// MAY trip if V2 (helper) is present, otherwise the V1 safe-only
		// fallthrough fires — both are ASK. We only assert ASK + no
		// Seatbelt envelope here, not the exact source.
		const preToggle = await callback({
			toolName: "run_commands",
			input: liveInput,
		})
		expect(preToggle?.approved).toBe(false)
		expect(preToggle?.decision?.kind).toBe("ask")
		expect(preToggle?.mandatorySeatbeltExecution).toBe(false)

		// TOGGLE: user picks "ALL — this task". The canonical sequence is:
		//   setOverride(sessionId, "all")   → store mutated
		//   handleOverrideChanged(prev)     → coordinator requests rebuild
		//                                     (which the SCHEDULER queues —
		//                                     drainIfIdle bails on
		//                                     isRunning=true).
		const sessionId = harness.sessions.getActiveSession()?.sessionId as string
		const prev = harness.sessionAutoApproval.getOverride(sessionId)
		harness.sessionAutoApproval.setOverride(sessionId, "all")
		const triggered = harness.coordinator.handleOverrideChanged(prev)
		expect(triggered).toBe(true)

		// IMMEDIATE NEXT TOOL CALL: rebuild has NOT drained (session is
		// still running). The closure's resolveHostAuthorization must
		// read the new override from the store and stamp the Seatbelt
		// envelope.
		const immediate = await callback({
			toolName: "run_commands",
			input: liveInput,
		})
		const immediateSource = immediate?.decision?.source

		// DRAIN: flip isRunning to false, fire sessionBecameIdle, let the
		// queued rebuild install the replacement.
		;(harness.activeSession as { isRunning: boolean }).isRunning = false
		harness.rebuilds.sessionBecameIdle()
		await harness.rebuilds.waitUntilSettled()

		// POST-IDLE TOOL CALL: rebuild has now drained; the closure
		// should STILL observe ALL semantics.
		const postIdle = await callback({
			toolName: "run_commands",
			input: liveInput,
		})

		// STOP RULE 1: immediate request must observe ALL semantics.
		// If the closure is a per-request live read (R3), the result is
		// ALLOW. If it is a frozen snapshot (R2), the result is ASK.
		expect(immediate?.approved).toBe(true)
		expect(immediateSource).toBe("host_mode_all_seatbelt_required")
		expect(immediate?.mandatorySeatbeltExecution).toBe(true)

		// STOP RULE 2: post-idle must remain ALLOW. A regression here
		// would mean the rebuild itself broke the closure.
		expect(postIdle?.approved).toBe(true)
		expect(postIdle?.decision?.source).toBe("host_mode_all_seatbelt_required")
		expect(postIdle?.mandatorySeatbeltExecution).toBe(true)
	})

	// -------------------------------------------------------------------
	// T-RUNNING-PRE-TOGGLE
	// -------------------------------------------------------------------
	// Negative control: without toggling, the running-session closure
	// stays ASK (any safe-only / R5 / manual source — all produce ASK
	// because the override is "none"). Pins the harness end-to-end — if
	// this fails, the seam is broken BEFORE the toggle.
	it("T-RUNNING-PRE-TOGGLE: running-session pre-toggle observation stays ASK (negative control)", async () => {
		const { callback } = makeProductionCallback(workspaceRoot)
		const liveInput = LIVE_STIMULUS_SHAPE(victim)

		const result = await callback({
			toolName: "run_commands",
			input: liveInput,
		})
		expect(result?.approved).toBe(false)
		expect(result?.decision?.kind).toBe("ask")
		expect(result?.mandatorySeatbeltExecution).toBe(false)
	})
})
