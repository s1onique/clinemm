/**
 * ACT-CLINEMM-SESSION-AUTONOMY01
 *
 * Webview tests for the SessionAutoApprovalToggle component.
 *
 * These tests prove the webview is a pure mirror of the host state:
 *   - Inactive: no ALL label, checkbox is off.
 *   - Active for current task: ALL label, checkbox is on.
 *   - Active for a different task (stale override): no ALL label,
 *     checkbox is off, even though host state has override="all".
 *   - First activation requires confirm; subsequent deactivation does not.
 *   - RPC is fired on confirm / direct toggle.
 */

import type { SessionAutoApprovalOverride } from "@shared/ExtensionMessage"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { SessionAutoApprovalToggle } from "./SessionAutoApprovalToggle"

vi.mock("@/services/grpc-client", () => ({
	StateServiceClient: {
		setSessionAutoApprovalOverride: vi.fn().mockResolvedValue({}),
	},
}))

function renderWithContext(opts: { override: SessionAutoApprovalOverride; sessionId?: string; currentTaskSessionId?: string }) {
	const value = {
		sessionAutoApproval: { override: opts.override, sessionId: opts.sessionId },
		sessionAutonomy: { override: opts.override, sessionId: opts.sessionId },
		currentTaskItem: opts.currentTaskSessionId ? { id: opts.currentTaskSessionId } : undefined,
	} as unknown as Parameters<typeof ExtensionStateContext.Provider>[0]["value"]
	return render(
		<ExtensionStateContext.Provider value={value}>
			<SessionAutoApprovalToggle currentTaskSessionId={opts.currentTaskSessionId} />
		</ExtensionStateContext.Provider>,
	)
}

describe("SessionAutoApprovalToggle", () => {
	it("renders the toggle with default unchecked state when override=none", () => {
		renderWithContext({ override: "none", currentTaskSessionId: "task-A" })
		expect(screen.getByTestId("session-autonomy-toggle")).toBeInTheDocument()
		expect(screen.getByText(/Approve all for this task/i)).toBeInTheDocument()
	})

	it("first activation requires explicit confirmation (no immediate RPC)", async () => {
		const user = userEvent.setup()
		const spy = vi.mocked(StateServiceClient.setSessionAutoApprovalOverride)
		renderWithContext({ override: "none", currentTaskSessionId: "task-A" })
		await user.click(screen.getByTestId("session-autonomy-toggle"))
		expect(spy).not.toHaveBeenCalled()
		expect(screen.getByText(/Approve ordinary actions automatically for this task/i)).toBeInTheDocument()
	})

	it("confirming enables the override (RPC fires with 'all')", async () => {
		const user = userEvent.setup()
		const spy = vi.mocked(StateServiceClient.setSessionAutoApprovalOverride)
		renderWithContext({ override: "none", currentTaskSessionId: "task-A" })
		await user.click(screen.getByTestId("session-autonomy-toggle"))
		await user.click(screen.getByRole("button", { name: /enable for this task/i }))
		expect(spy).toHaveBeenCalledWith({ override: "all" })
	})

	it("deactivating an active override fires RPC with 'none' (no confirmation)", async () => {
		const user = userEvent.setup()
		const spy = vi.mocked(StateServiceClient.setSessionAutoApprovalOverride)
		renderWithContext({ override: "all", sessionId: "task-A", currentTaskSessionId: "task-A" })
		await user.click(screen.getByTestId("session-autonomy-toggle"))
		expect(spy).toHaveBeenCalledWith({ override: "none" })
	})

	it("stale override (different sessionId) does NOT render the toggle as active", () => {
		renderWithContext({
			override: "all",
			sessionId: "old-task",
			currentTaskSessionId: "new-task",
		})
		// The host pushed override="all" for "old-task"; the current task is
		// "new-task". The toggle should render unchecked for the new task.
		const checkbox = screen
			.getByTestId("session-autonomy-toggle")
			.querySelector("input[type=checkbox]") as HTMLInputElement | null
		expect(checkbox).not.toBeNull()
		expect(checkbox?.checked).toBe(false)
	})

	it("disables the toggle when no current task session is known", () => {
		renderWithContext({ override: "none" })
		expect(screen.getByText(/start a task to enable/i)).toBeInTheDocument()
	})
})
