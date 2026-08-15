/**
 * ACT-CLINEMM-SESSION-AUTONOMY01 + ACT-CLINEMM-SESSION-AUTONOMY01-CORRECTION01
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
 *
 * CORRECTION01: also covers pre-arm - when no task exists, the toggle is
 * enabled (not disabled), reads "Approve all for next task", and an armed
 * intent renders the checkbox as on.
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

function renderWithContext(opts: {
	override: SessionAutoApprovalOverride
	sessionId?: string
	currentTaskSessionId?: string
	armed?: SessionAutoApprovalOverride
}) {
	const value = {
		sessionAutoApproval: { override: opts.override, sessionId: opts.sessionId },
		sessionAutonomy: { override: opts.override, sessionId: opts.sessionId },
		sessionAutoApprovalArmed: opts.armed ?? "none",
		currentTaskItem: opts.currentTaskSessionId ? { id: opts.currentTaskSessionId } : undefined,
	} as unknown as Parameters<typeof ExtensionStateContext.Provider>[0]["value"]
	return render(
		<ExtensionStateContext.Provider value={value}>
			<SessionAutoApprovalToggle currentTaskSessionId={opts.currentTaskSessionId} />
		</ExtensionStateContext.Provider>,
	)
}

function getCheckbox(): HTMLInputElement | null {
	return screen.getByTestId("session-autonomy-toggle").querySelector("input[type=checkbox]") as HTMLInputElement | null
}

describe("ACT-CLINEMM-SESSION-AUTONOMY01-CORRECTION01: SessionAutoApprovalToggle", () => {
	it("renders the toggle for an active task with override=none", () => {
		renderWithContext({ override: "none", currentTaskSessionId: "task-A" })
		expect(screen.getByTestId("session-autonomy-toggle")).toBeInTheDocument()
		expect(screen.getByText(/Approve all for this task/i)).toBeInTheDocument()
		expect(getCheckbox()?.checked).toBe(false)
	})

	it("CORRECTION01: renders the pre-arm toggle when no task exists", () => {
		renderWithContext({ override: "none" })
		expect(screen.getByText(/Approve all for next task/i)).toBeInTheDocument()
		expect(getCheckbox()?.checked).toBe(false)
	})

	it("CORRECTION01: armed intent renders the checkbox as checked", () => {
		renderWithContext({ override: "none", armed: "all" })
		expect(getCheckbox()?.checked).toBe(true)
	})

	it("first activation requires explicit confirmation (no immediate RPC)", async () => {
		const user = userEvent.setup()
		const spy = vi.mocked(StateServiceClient.setSessionAutoApprovalOverride)
		renderWithContext({ override: "none", currentTaskSessionId: "task-A" })
		await user.click(screen.getByTestId("session-autonomy-toggle"))
		expect(spy).not.toHaveBeenCalled()
		expect(screen.getByText(/Approve ordinary actions automatically for this task/i)).toBeInTheDocument()
	})

	it("CORRECTION01: confirming arm intent shows 'Arm for next task' button label", async () => {
		const user = userEvent.setup()
		const spy = vi.mocked(StateServiceClient.setSessionAutoApprovalOverride)
		renderWithContext({ override: "none" })
		await user.click(screen.getByTestId("session-autonomy-toggle"))
		expect(screen.getByRole("button", { name: /arm for next task/i })).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: /arm for next task/i }))
		expect(spy).toHaveBeenCalledWith({ override: "all" })
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

	it("CORRECTION01: deactivating armed intent fires RPC with 'none'", async () => {
		const user = userEvent.setup()
		const spy = vi.mocked(StateServiceClient.setSessionAutoApprovalOverride)
		renderWithContext({ override: "none", armed: "all" })
		await user.click(screen.getByTestId("session-autonomy-toggle"))
		expect(spy).toHaveBeenCalledWith({ override: "none" })
	})

	it("stale override (different sessionId) does NOT render the toggle as active", () => {
		renderWithContext({
			override: "all",
			sessionId: "old-task",
			currentTaskSessionId: "new-task",
		})
		expect(getCheckbox()?.checked).toBe(false)
	})

	it("CORRECTION01: confirm copy mentions the truthful hard-DENY contract", async () => {
		const user = userEvent.setup()
		renderWithContext({ override: "none", currentTaskSessionId: "task-A" })
		await user.click(screen.getByTestId("session-autonomy-toggle"))
		expect(screen.getByText(/ClineMM command policy remains enforced/i)).toBeInTheDocument()
	})
})
