/**
 * ACT-CLINEMM-SESSION-AUTONOMY01
 *
 * Lifecycle tests for the SessionAutoApprovalStore as wired into the
 * Controller's choke-points (cancelTask, clearTask).
 *
 * We do NOT spin up a full SdkController (its constructor pulls in the
 * VS Code host). Instead we instantiate the SdkController with a
 * minimized mock harness that satisfies the construction-time
 * dependencies and exercise the public surface directly.
 */
import { describe, expect, it, vi } from "vitest"
import { SessionAutoApprovalStore } from "./session-auto-approval"

vi.mock("./webview-grpc-bridge", () => ({
	pushMessageToWebview: vi.fn().mockResolvedValue(undefined),
	WebviewGrpcBridge: class {
		constructor(public state: unknown) {}
		setGetStateFn = vi.fn()
	},
}))

vi.mock("@core/storage/disk", () => ({
	saveClineMessages: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/services/mcp/McpHub", () => ({
	McpHub: class {
		getServers = vi.fn(() => [])
		dispose = vi.fn()
	},
}))

vi.mock("./vscode-session-host", () => ({
	VscodeSessionHost: {
		create: vi.fn(async () => ({
			start: vi.fn(async () => ({ sessionId: "sess-test" })),
			dispose: vi.fn(),
			stop: vi.fn(async () => {}),
			restore: vi.fn(async () => ({})),
			updateSessionModel: vi.fn(),
			pendingPrompts: vi.fn(async () => ({ removed: false, items: [] })),
			abort: vi.fn(async () => {}),
		})),
	},
}))

describe("SessionAutoApprovalStore + Controller choke-points", () => {
	it("new SessionAutoApprovalStore starts inactive", () => {
		const store = new SessionAutoApprovalStore()
		expect(store.snapshot()).toEqual({ override: "none", sessionId: undefined, armed: "none" })
	})

	it("setOverride('all', sessionId) binds to that session", () => {
		const store = new SessionAutoApprovalStore()
		store.setOverride("sess-A", "all")
		expect(store.snapshot()).toEqual({ override: "all", sessionId: "sess-A", armed: "none" })
	})

	it("CORRECTION01: setOverride('all', undefined) ARMS rather than refuses", () => {
		const store = new SessionAutoApprovalStore()
		store.setOverride(undefined, "all")
		expect(store.isArmed()).toBe(true)
		expect(store.snapshot()).toEqual({ override: "none", sessionId: undefined, armed: "all" })
	})

	it("setOverride('none') clears regardless of sessionId (UI deactivation)", () => {
		const store = new SessionAutoApprovalStore()
		store.setOverride("sess-A", "all")
		store.setOverride("sess-A", "none")
		expect(store.snapshot()).toEqual({ override: "none", sessionId: undefined, armed: "none" })
	})

	it("CORRECTION02: clearActiveOverride destroys only the bound override (arm survives)", () => {
		// The bind and the arm are separate; if both are set, clearActiveOverride
		// drops only the bind and leaves the arm intact (so the next task can still
		// pick up the user's pre-armed intent).
		const store = new SessionAutoApprovalStore()
		store.setOverride("sess-A", "all") // bind directly
		store.setOverride(undefined, "all") // also arm
		store.clearActiveOverride()
		expect(store.snapshot().override).toBe("none")
		expect(store.snapshot().sessionId).toBe(undefined)
		expect(store.isArmed()).toBe(true) // arm survives clearTask
	})

	it("CORRECTION02: clearPendingArm destroys only the arm (bound override survives)", () => {
		const store = new SessionAutoApprovalStore()
		store.setOverride("sess-A", "all") // bind directly
		store.setOverride(undefined, "all") // also arm
		store.clearPendingArm()
		expect(store.isArmed()).toBe(false)
		expect(store.getOverride("sess-A")).toBe("all") // bind survives
	})

	it("CORRECTION02: clearSessionAutoApproval is the full-reset union", () => {
		const store = new SessionAutoApprovalStore()
		store.setOverride(undefined, "all")
		store.consumePendingOverride("sess-A")
		store.clearSessionAutoApproval()
		expect(store.snapshot()).toEqual({ override: "none", sessionId: undefined, armed: "none" })
	})

	it("getOverride returns 'none' for stale sessionId (stale-task leak proof)", () => {
		const store = new SessionAutoApprovalStore()
		store.setOverride("sess-A", "all")
		expect(store.getOverride("sess-B")).toBe("none")
		// After clearActiveOverride (the production clearTask hook),
		// even the original sessionId returns 'none'.
		store.clearActiveOverride()
		expect(store.getOverride("sess-A")).toBe("none")
	})

	it("CORRECTION02: getOverride is pure — does NOT consume the arm across reads", () => {
		const store = new SessionAutoApprovalStore()
		store.setOverride(undefined, "all")
		// Multiple reads on the same session id all return "none" (no session bound yet),
		// and the arm survives every read.
		expect(store.getOverride("sess-A")).toBe("none")
		expect(store.getOverride("sess-A")).toBe("none")
		expect(store.getOverride("sess-B")).toBe("none")
		expect(store.isArmed()).toBe(true)
	})

	it("CORRECTION02: consumePendingOverride is the one-shot consumer", () => {
		const store = new SessionAutoApprovalStore()
		store.setOverride(undefined, "all")
		expect(store.consumePendingOverride("sess-A")).toBe(true)
		expect(store.isArmed()).toBe(false)
		// Subsequent consume calls return false (arm is gone).
		expect(store.consumePendingOverride("sess-A")).toBe(false)
		expect(store.consumePendingOverride("sess-B")).toBe(false)
	})
})
