import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getLifecycleClearSnapshot, resetLifecycleClearSnapshot } from "../lifecycle-clear-recorder"
import { SdkSessionLifecycle } from "../sdk-session-lifecycle"

/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01 — FUNNEL INTEGRATION.
 *
 * Drives the REAL `SdkSessionLifecycle.endActiveSession(reason)` funnel
 * (the single public path into the storage writer `clearActiveSessionReference`)
 * and asserts that the snapshot records the reason verbatim.
 *
 * Unlike `clcrec01` (which exercises the recorder in isolation), this file
 * proves the production wiring: the `recordLifecycleClear(reason)` call is
 * the FIRST statement in `endActiveSession` (before the
 * `clearActiveSessionReference()` mutation), so the snapshot reflects
 * every funnel invocation regardless of whether the active session was
 * defined at the moment of the call.
 *
 * Two production-shaped cases:
 *
 *   F-2a dogfood + active session defined + endActiveSession("clearTask")
 *         -> snapshot.total === 1, snapshot.lastClearReason === "clearTask"
 *   F-2b dogfood + no active session + endActiveSession("dispose")
 *         -> snapshot.total === 1, snapshot.lastClearReason === "dispose"
 *         (early-return branch still picks up the funnel reason)
 *
 * Hard prohibitions: do NOT mock `endActiveSession` here. The whole point
 * is to drive the REAL funnel. Only the VscodeSessionHost factory is
 * mocked, mirroring `sdk-session-lifecycle.test.ts`.
 */

const mockCreateSessionHost = vi.hoisted(() => vi.fn())

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalSettingsKey: () => undefined,
		}),
	},
}))

vi.mock("../vscode-session-host", () => ({
	VscodeSessionHost: {
		create: mockCreateSessionHost,
	},
}))

const ORIGINAL_ENV = { ...process.env }

function setProfile(profile: "public" | "dogfood"): void {
	if (profile === "dogfood") {
		process.env.CLINEMM_RUNTIME_PROFILE = "dogfood"
	} else {
		delete process.env.CLINEMM_RUNTIME_PROFILE
	}
	resetLifecycleClearSnapshot()
}

function makeSdkHost(opts: { sessionId: string; unsubscribe?: () => void }): {
	[k: string]: unknown
} {
	const unsubscribe = opts.unsubscribe ?? (() => {})
	return {
		start: vi.fn().mockResolvedValue({ sessionId: opts.sessionId }),
		stop: vi.fn().mockResolvedValue(undefined),
		subscribe: vi.fn().mockReturnValue(unsubscribe),
		dispose: vi.fn().mockResolvedValue(undefined),
		restore: vi.fn(),
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
	} as any
}

function makeLifecycle(): SdkSessionLifecycle {
	// SdkSessionLifecycle.endActiveSession -> trackSessionStop ->
	// mcpHub.disconnectSession(sessionId). The lifecycle test only
	// exercises the recorder, not the MCP teardown, so a stubbed
	// `mcpHub` is sufficient.
	const stubMcpHub = {
		disconnectSession: vi.fn().mockResolvedValue(undefined),
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
	} as any
	return new SdkSessionLifecycle({
		mcpHub: stubMcpHub,
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
	} as any)
}

describe("lifecycle-clear-recorder funnel (CLCREC02)", () => {
	afterEach(() => {
		process.env = { ...ORIGINAL_ENV }
		resetLifecycleClearSnapshot()
		mockCreateSessionHost.mockReset()
	})

	describe("F-2 — dogfood, REAL SdkSessionLifecycle.endActiveSession", () => {
		beforeEach(() => setProfile("dogfood"))

		it("F-2a: endActiveSession('clearTask') with a defined active session records 'clearTask'", async () => {
			const sdkHost = makeSdkHost({ sessionId: "session-A" })
			mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
			const lifecycle = makeLifecycle()

			// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
			await lifecycle.startNewSession({} as any)
			expect(lifecycle.getActiveSession()?.sessionId).toBe("session-A")

			await lifecycle.endActiveSession("clearTask")

			const snap = getLifecycleClearSnapshot()
			expect(snap.enabled).toBe(true)
			// The funnel is hit TWICE: once by `startNewSession` ("startNewSession")
			// internally calling `endActiveSession` would be a no-op on a fresh
			// lifecycle; the explicit `clearTask` call is the only one.
			expect(snap.total).toBe(1)
			expect(snap.lastClearReason).toBe("clearTask")
			expect(lifecycle.getActiveSession()).toBeUndefined()
		})

		it("F-2b: endActiveSession('dispose') with no active session still records 'dispose'", async () => {
			const lifecycle = makeLifecycle()
			// No startNewSession; activeSession is undefined.
			expect(lifecycle.getActiveSession()).toBeUndefined()

			const result = await lifecycle.endActiveSession("dispose")

			expect(result).toBeUndefined()
			const snap = getLifecycleClearSnapshot()
			expect(snap.enabled).toBe(true)
			expect(snap.total).toBe(1)
			expect(snap.lastClearReason).toBe("dispose")
		})

		it("F-2c: clearActiveSession('clearTask') (public wrapper) also records 'clearTask'", async () => {
			const sdkHost = makeSdkHost({ sessionId: "session-B" })
			mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
			const lifecycle = makeLifecycle()

			// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
			await lifecycle.startNewSession({} as any)
			await lifecycle.clearActiveSession("clearTask")

			const snap = getLifecycleClearSnapshot()
			expect(snap.enabled).toBe(true)
			expect(snap.lastClearReason).toBe("clearTask")
		})
	})

	describe("F-3 — public profile, REAL funnel, recording is suppressed", () => {
		beforeEach(() => setProfile("public"))

		it("F-3a: endActiveSession('dispose') with active session does NOT advance counter", async () => {
			const sdkHost = makeSdkHost({ sessionId: "session-C" })
			mockCreateSessionHost.mockResolvedValueOnce(sdkHost)
			const lifecycle = makeLifecycle()

			// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
			await lifecycle.startNewSession({} as any)
			await lifecycle.endActiveSession("dispose")

			const snap = getLifecycleClearSnapshot()
			expect(snap.enabled).toBe(false)
			expect(snap.total).toBe(0)
			expect(snap.lastClearReason).toBeUndefined()
		})
	})
})
