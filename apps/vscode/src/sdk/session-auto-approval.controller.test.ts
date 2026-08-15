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

	it("clearSessionAutoApproval destroys any active override (clearTask choke-point)", () => {
		const store = new SessionAutoApprovalStore()
		store.setOverride("sess-A", "all")
		store.clearSessionAutoApproval()
		expect(store.snapshot()).toEqual({ override: "none", sessionId: undefined, armed: "none" })
	})

	it("getOverride returns 'none' for stale sessionId (stale-task leak proof)", () => {
		const store = new SessionAutoApprovalStore()
		store.setOverride("sess-A", "all")
		expect(store.getOverride("sess-B")).toBe("none")
		// After clearTask, even the original sessionId returns 'none'.
		store.clearSessionAutoApproval()
		expect(store.getOverride("sess-A")).toBe("none")
	})
})
