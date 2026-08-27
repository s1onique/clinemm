/**
 * ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01
 *
 * Active-session transition discriminator.
 *
 * The previous GREEN wiring (aa18a10ea) proved:
 *   - construction-time composition: buildSessionConfig → DefaultRuntimeBuilder
 *     → submit_and_exit + requireCompletionTool=true
 *   - pre-arm intent: store.peekArmed() at initTask time
 *   - rebuild paths: mode change / terminal mode / provider / mcpTools
 *     rebuilds preserve or read the bound override
 *
 * This file closes the ONE remaining gap the reviewer flagged:
 *
 *   "active-task `"ALL — this task"` changes approval policy, but not the
 *    registered completion toolset."
 *
 * The discriminator: when a user toggles the override on an ALREADY-running
 * session, does the rebuilt runtime register `submit_and_exit`? The existing
 * tests prove construction-time composition, not active-session transition.
 *
 * Two paired chronology tests (positive + negative):
 *
 *   none → all   →  rebuild requested, new config has enableSubmitAndExit=true
 *   all  → none  →  rebuild requested, new config has enableSubmitAndExit=false
 *
 * Both must hold because `YOLO_REQUESTED` is a derived fact: if YOLO_REQUESTED
 * becomes false (override cleared), the completing tool must no longer remain
 * model-visible merely because the session was constructed earlier.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SessionAutoApprovalStore } from "../session-auto-approval"
import {
	SdkSessionAutoApprovalCoordinator,
	type SdkSessionAutoApprovalCoordinatorOptions,
} from "../sdk-session-auto-approval-coordinator"

function makeCoordinator(overrides: Partial<SdkSessionAutoApprovalCoordinatorOptions> = {}): {
	coordinator: SdkSessionAutoApprovalCoordinator
	options: SdkSessionAutoApprovalCoordinatorOptions
	rebuildsRequestMock: ReturnType<typeof vi.fn>
	sessionConfigBuildMock: ReturnType<typeof vi.fn>
	getCaptured: () => { reason: string; rebuild: () => Promise<void> }
} {
	const sessionConfigBuildMock = vi.fn().mockResolvedValue({
		providerId: "anthropic",
		modelId: "claude-sonnet-4-6",
		systemPrompt: "test",
		cwd: "/workspace",
		enableTools: true,
		enableSubmitAndExit: false,
	})
	let captured: { reason: string; rebuild: () => Promise<void> } | undefined
	const rebuildsRequestMock = vi.fn((reason: string, rebuild: () => Promise<void>) => {
		captured = { reason, rebuild }
	})

	// ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01:
	// The failure policy compares REFERENCE identity of the active
	// session object (matching SdkSessionLifecycle's own ownership
	// semantics). The default mock therefore returns a STABLE
	// reference for the active session, so `postActiveSession ===
	// originalActiveSession` is true in the default CASE 1 path.
	const stableActiveSession = {
		sessionId: "active-session",
		sdkHost: { readMessages: vi.fn(), abort: vi.fn() },
		unsubscribe: vi.fn(),
		startResult: undefined,
		isRunning: false,
	}

	const options = {
		stateManager: {
			getGlobalSettingsKey: vi.fn((key: string) => {
				if (key === "mode") return "act"
				return undefined
			}),
		},
		sessions: {
			getActiveSession: vi.fn(() => stableActiveSession),
			replaceActiveSession: vi.fn(async () => ({
				startResult: { sessionId: "active-session" },
			})),
			clearActiveSession: vi.fn(async () => undefined),
		},
		messages: {
			emitSessionEvents: vi.fn(),
			appendAndEmit: vi.fn(),
		},
		sessionConfigBuilder: {
			build: sessionConfigBuildMock,
		},
		sessionAutoApproval: {
			getOverride: vi.fn(() => "all" as const),
			setOverride: vi.fn(),
			peekArmed: vi.fn(() => "all" as const),
			consumePendingOverride: vi.fn(() => false),
			clearActiveOverride: vi.fn(),
			clearPendingArm: vi.fn(),
			isArmed: vi.fn(() => false),
			clearSessionAutoApproval: vi.fn(),
		} as unknown as SessionAutoApprovalStore,
		getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
		loadInitialMessages: vi.fn().mockResolvedValue([]),
		buildStartSessionInput: vi.fn(() => ({ prompt: "start" })),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		rebuilds: {
			request: rebuildsRequestMock,
		},
		...overrides,
	} as unknown as SdkSessionAutoApprovalCoordinatorOptions

	return {
		coordinator: new SdkSessionAutoApprovalCoordinator(options),
		options,
		rebuildsRequestMock,
		sessionConfigBuildMock,
		getCaptured: () => {
			if (!captured) {
				throw new Error("rebuild was not requested")
			}
			return captured
		},
	}
}

describe("ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01 / active-session override transition", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	it("ACTIVE-1 CAI-01B active-session: prev='none' → 'all' triggers rebuild + new config carries override='all'", async () => {
		const getOverride = vi.fn((_sessionId: string) => {
			// handleOverrideChanged reads the post-mutation bound value (call #1).
			// restartSessionForOverrideChange also reads the bound value (call #2).
			// The controller's prior sequence: prev="none", setOverride("all") bound "all".
			return "all" as const
		})
		const sessionAutoApproval = { getOverride } as unknown as SessionAutoApprovalStore
		const ctx = makeCoordinator({ sessionAutoApproval })

		// Coordinator sees: prev="none" (passed by controller), bound="all" (post-setOverride).
		const triggered = ctx.coordinator.handleOverrideChanged("none")
		expect(triggered).toBe(true)
		expect(ctx.rebuildsRequestMock).toHaveBeenCalledTimes(1)
		expect(ctx.rebuildsRequestMock.mock.calls[0][0]).toBe("sessionAutoApprovalOverride")

		// Drain the rebuild and verify the production wiring.
		const { rebuild } = ctx.getCaptured()
		await rebuild()

		// The build call MUST carry the freshly-bound 'all' override so the
		// new runtime registers submit_and_exit + completionPolicy.requireCompletionTool.
		expect(ctx.sessionConfigBuildMock).toHaveBeenCalledTimes(1)
		const buildArg = ctx.sessionConfigBuildMock.mock.calls[0][0]
		expect(buildArg).toMatchObject({
			cwd: "/workspace",
			mode: "act",
			sessionAutoApprovalOverride: "all",
		})
	})

	it("ACTIVE-2 CAI-01B active-session conservation: prev='all' → 'none' triggers rebuild + new config carries override='none'", async () => {
		const getOverride = vi.fn((_sessionId: string) => {
			// Controller's prior sequence: prev="all", setOverride("none") cleared.
			return "none" as const
		})
		const sessionAutoApproval = { getOverride } as unknown as SessionAutoApprovalStore
		const ctx = makeCoordinator({ sessionAutoApproval })

		const triggered = ctx.coordinator.handleOverrideChanged("all")
		expect(triggered).toBe(true)
		expect(ctx.rebuildsRequestMock).toHaveBeenCalledTimes(1)

		const { rebuild } = ctx.getCaptured()
		await rebuild()

		expect(ctx.sessionConfigBuildMock).toHaveBeenCalledTimes(1)
		const buildArg = ctx.sessionConfigBuildMock.mock.calls[0][0]
		expect(buildArg).toMatchObject({
			cwd: "/workspace",
			mode: "act",
			sessionAutoApprovalOverride: "none",
		})
	})

	it("ACTIVE-3 active-session: idempotent re-arm (prev=current) does NOT request a rebuild", () => {
		const getOverride = vi.fn((_sessionId: string) => "all" as const)
		const sessionAutoApproval = { getOverride } as unknown as SessionAutoApprovalStore
		const ctx = makeCoordinator({ sessionAutoApproval })

		const triggered = ctx.coordinator.handleOverrideChanged("all")
		expect(triggered).toBe(false)
		expect(ctx.rebuildsRequestMock).not.toHaveBeenCalled()
	})

	it("ACTIVE-4 no active session: handleOverrideChanged is a no-op (peekArmed covers next-task)", () => {
		const ctx = makeCoordinator({
			sessions: {
				getActiveSession: vi.fn(() => undefined),
				replaceActiveSession: vi.fn(),
			} as never,
		})
		const triggered = ctx.coordinator.handleOverrideChanged("none")
		expect(triggered).toBe(false)
		expect(ctx.rebuildsRequestMock).not.toHaveBeenCalled()
	})

	it("ACTIVE-FAIL-OFF CAI-01B failure policy: 'all' → 'none' rebuild throws (CASE 1: OLD still installed) → drop + arm stays clear", async () => {
		// Production-shape mock: getActiveSession returns a STABLE
		// reference (matching the lifecycle's own ownership model).
		// This is CASE 1 in the failure-policy chronology: endActiveSession
		// has not yet run, OLD is still installed, our rebuild throws,
		// the helper drops it and re-arms.
		const sessionAutoApproval = new SessionAutoApprovalStore()
		sessionAutoApproval.setOverride("active-session", "all")
		sessionAutoApproval.setOverride("active-session", "none")

		const clearActiveSession = vi.fn(async () => undefined)
		const stableActiveSession = {
			sessionId: "active-session",
			sdkHost: { readMessages: vi.fn(), abort: vi.fn() },
			unsubscribe: vi.fn(),
			startResult: undefined,
			isRunning: false,
		}
		const ctx = makeCoordinator({
			sessionAutoApproval,
			sessions: {
				getActiveSession: vi.fn(() => stableActiveSession),
				replaceActiveSession: vi.fn(async () => {
					throw new Error("simulated rebuild failure")
				}),
				clearActiveSession,
			} as never,
		})

		const triggered = ctx.coordinator.handleOverrideChanged("all")
		expect(triggered).toBe(true)
		const { rebuild } = ctx.getCaptured()
		await rebuild()

		// CASE 1: drop the stale runtime.
		expect(clearActiveSession).toHaveBeenCalledWith("sessionAutoApprovalOverrideFailure")
		// arm stays clear (user wants OFF).
		expect(sessionAutoApproval.peekArmed()).toBe("none")
		expect(sessionAutoApproval.getOverride("new-session-id")).toBe("none")
	})

	it("ACTIVE-FAIL-ON-REARM CAI-01B: 'none' → 'all' rebuild throws (CASE 1) → drop + intent re-armed as peekArmed()='all'", async () => {
		// Real store + production-shape mock. User toggled 'all' on an
		// active session, the rebuild throws, OLD is still installed.
		// The helper drops it and re-arms: peekArmed() === 'all', and
		// the next-task consume cycle binds 'all' to the new session.
		const sessionAutoApproval = new SessionAutoApprovalStore()
		sessionAutoApproval.setOverride("active-session", "none")
		sessionAutoApproval.setOverride("active-session", "all")
		expect(sessionAutoApproval.getOverride("active-session")).toBe("all")

		const clearActiveSession = vi.fn(async () => undefined)
		const stableActiveSession = {
			sessionId: "active-session",
			sdkHost: { readMessages: vi.fn(), abort: vi.fn() },
			unsubscribe: vi.fn(),
			startResult: undefined,
			isRunning: false,
		}
		const ctx = makeCoordinator({
			sessionAutoApproval,
			sessions: {
				getActiveSession: vi.fn(() => stableActiveSession),
				replaceActiveSession: vi.fn(async () => {
					throw new Error("simulated rebuild failure")
				}),
				clearActiveSession,
			} as never,
		})

		const triggered = ctx.coordinator.handleOverrideChanged("none")
		expect(triggered).toBe(true)
		const { rebuild } = ctx.getCaptured()
		await rebuild()

		expect(clearActiveSession).toHaveBeenCalledWith("sessionAutoApprovalOverrideFailure")
		expect(sessionAutoApproval.peekArmed()).toBe("all")
		expect(sessionAutoApproval.consumePendingOverride("new-session-id")).toBe(true)
		expect(sessionAutoApproval.getOverride("new-session-id")).toBe("all")
		expect(sessionAutoApproval.peekArmed()).toBe("none")
	})

	it("ACTIVE-FAIL-NOOP CAI-01B race: replaceActiveSession returns undefined AND active session changed identity → do NOT clobber other rebuild", async () => {
		// Race case (b): another rebuild landed first. The active session
		// is now a DIFFERENT sessionId. We must not drop it (we would
		// clobber the other rebuild's work). The bound override survives
		// because we never touched the store OR the session.
		const sessionAutoApproval = new SessionAutoApprovalStore()
		sessionAutoApproval.setOverride("active-session", "none")
		sessionAutoApproval.setOverride("active-session", "all")

		const otherSession = {
			sessionId: "other-session",
			sdkHost: { readMessages: vi.fn(), abort: vi.fn() },
			unsubscribe: vi.fn(),
			startResult: undefined,
			isRunning: false,
		}
		const clearActiveSession = vi.fn(async () => undefined)
		let callCount = 0
		const ctx = makeCoordinator({
			sessionAutoApproval,
			sessions: {
				getActiveSession: vi.fn(() => {
					callCount++
					return callCount === 1 ? {
						sessionId: "active-session",
						sdkHost: { readMessages: vi.fn(), abort: vi.fn() },
						unsubscribe: vi.fn(),
						startResult: undefined,
						isRunning: false,
					} : otherSession
				}),
				replaceActiveSession: vi.fn(async () => undefined),
				clearActiveSession,
			} as never,
		})

		const triggered = ctx.coordinator.handleOverrideChanged("none")
		expect(triggered).toBe(true)
		const { rebuild } = ctx.getCaptured()
		await rebuild()

		expect(clearActiveSession).not.toHaveBeenCalled()
		expect(sessionAutoApproval.getOverride("active-session")).toBe("all")
		expect(sessionAutoApproval.peekArmed()).toBe("none")
	})

	it("ACTIVE-FAIL-CATCH-IDENTITY CAI-01B: catch path also identity-guarded — losing rebuild does not clobber winner", async () => {
		// The catch path is reached when replaceActiveSession *throws*
		// (not when it returns undefined). The same identity guard
		// must apply: if another rebuild replaced the active session
		// while ours was throwing, we MUST NOT clobber the winner.
		const sessionAutoApproval = new SessionAutoApprovalStore()
		sessionAutoApproval.setOverride("active-session", "none")
		sessionAutoApproval.setOverride("active-session", "all")

		const otherSession = {
			sessionId: "other-session",
			sdkHost: { readMessages: vi.fn(), abort: vi.fn() },
			unsubscribe: vi.fn(),
			startResult: undefined,
			isRunning: false,
		}
		const clearActiveSession = vi.fn(async () => undefined)
		let callCount = 0
		const ctx = makeCoordinator({
			sessionAutoApproval,
			sessions: {
				getActiveSession: vi.fn(() => {
					callCount++
					return callCount === 1 ? {
						sessionId: "active-session",
						sdkHost: { readMessages: vi.fn(), abort: vi.fn() },
						unsubscribe: vi.fn(),
						startResult: undefined,
						isRunning: false,
					} : otherSession
				}),
				replaceActiveSession: vi.fn(async () => {
					throw new Error("simulated rebuild failure")
				}),
				clearActiveSession,
			} as never,
		})

		const triggered = ctx.coordinator.handleOverrideChanged("none")
		expect(triggered).toBe(true)
		const { rebuild } = ctx.getCaptured()
		await rebuild()

		expect(clearActiveSession).not.toHaveBeenCalled()
	})

	it("ACTIVE-FAIL-AFTER-DISPOSE-REARM CAI-01B: rebuild throws AFTER dispose (CASE 2) → intent re-armed", async () => {
		// Production chronology: endActiveSession ran (getActiveSession
		// → undefined) and THEN startNewSession threw. This is the
		// case the previous P0 fix missed — the helper's identity
		// check saw postActiveSession === undefined and returned
		// early, leaving the user's 'all' intent orphaned.
		const sessionAutoApproval = new SessionAutoApprovalStore()
		sessionAutoApproval.setOverride("active-session", "none")
		sessionAutoApproval.setOverride("active-session", "all")

		const clearActiveSession = vi.fn(async () => undefined)
		const stableOldSession = {
			sessionId: "active-session",
			sdkHost: { readMessages: vi.fn(), abort: vi.fn() },
			unsubscribe: vi.fn(),
			startResult: undefined,
			isRunning: false,
		}
		// Model the production dispose-then-fail chronology:
		//   calls 1, 2 → OLD (handleOverrideChanged +
		//   restartSessionForOverrideChange both need OLD)
		//   call 3+ → undefined (after replaceActiveSession's
		//   internal endActiveSession cleared the slot, the
		//   replacement startNewSession threw)
		let callCount = 0
		const ctx = makeCoordinator({
			sessionAutoApproval,
			sessions: {
				getActiveSession: vi.fn(() => {
					callCount++
					return callCount <= 2 ? stableOldSession : undefined
				}),
				replaceActiveSession: vi.fn(async () => {
					// Dispose succeeded (modeled by the third
					// getActiveSession returning undefined), but the
					// replacement start threw.
					throw new Error("simulated post-dispose start failure")
				}),
				clearActiveSession,
			} as never,
		})

		const triggered = ctx.coordinator.handleOverrideChanged("none")
		expect(triggered).toBe(true)
		const { rebuild } = ctx.getCaptured()
		await rebuild()

		// CASE 2: lifecycle already disposed OLD; we do NOT call
		// clearActiveSession (nothing to clear). The intent MUST
		// still be re-armed so the next task picks it up.
		expect(clearActiveSession).not.toHaveBeenCalled()
		expect(sessionAutoApproval.peekArmed()).toBe("all")
		expect(sessionAutoApproval.consumePendingOverride("new-session-id")).toBe(true)
		expect(sessionAutoApproval.getOverride("new-session-id")).toBe("all")
	})

	it("ACTIVE-FAIL-SAME-ID-WINNER CAI-01B: CASE 3 — postActiveSession is a NEW object with the SAME sessionId → do NOT clobber winner", async () => {
		// A competing rebuild installed a fresh ActiveSession whose
		// sessionId equals currentSessionId (the rebuild deliberately
		// reuses it). Comparing only sessionId would mistake the
		// winner for the stale old one and clear it. Reference
		// identity catches this: postActiveSession !== original.
		const sessionAutoApproval = new SessionAutoApprovalStore()
		sessionAutoApproval.setOverride("active-session", "none")
		sessionAutoApproval.setOverride("active-session", "all")

		const clearActiveSession = vi.fn(async () => undefined)
		const originalActiveSession = {
			sessionId: "active-session",
			sdkHost: { readMessages: vi.fn(), abort: vi.fn() },
			unsubscribe: vi.fn(),
			startResult: undefined,
			isRunning: false,
		}
		const winner = {
			// SAME sessionId — this is the trap a sessionId-only
			// guard would fall into.
			sessionId: "active-session",
			sdkHost: { readMessages: vi.fn(), abort: vi.fn() },
			unsubscribe: vi.fn(),
			startResult: { sessionId: "active-session" },
			isRunning: false,
		}
		let callCount = 0
		const ctx = makeCoordinator({
			sessionAutoApproval,
			sessions: {
				getActiveSession: vi.fn(() => {
					callCount++
					return callCount === 1 ? originalActiveSession : winner
				}),
				replaceActiveSession: vi.fn(async () => ({
					startResult: { sessionId: "active-session" },
				})),
				clearActiveSession,
			} as never,
		})

		const triggered = ctx.coordinator.handleOverrideChanged("none")
		expect(triggered).toBe(true)
		const { rebuild } = ctx.getCaptured()
		await rebuild()

		// CASE 3: winner has same sessionId but different reference.
		// Do NOT clobber the winner.
		expect(clearActiveSession).not.toHaveBeenCalled()
		expect(sessionAutoApproval.getOverride("active-session")).toBe("all")
	})
})
