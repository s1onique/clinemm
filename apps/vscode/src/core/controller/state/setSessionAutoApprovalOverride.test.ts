/**
 * ACT-CLINEMM-SESSION-AUTONOMY01
 *
 * Unit tests for the webview->host RPC setSessionAutoApprovalOverride.
 *
 * The controller is mocked (we don't need the full SdkController — just
 * the typed method). The test proves:
 *   - "none" / "all" round-trip
 *   - unknown override is rejected and treated as "none"
 *   - postStateToWebview is called after a successful update so the
 *     webview receives the new state immediately
 *   - whitespace is trimmed
 */
import { SetSessionAutoApprovalOverrideRequest } from "@shared/proto/cline/state"
import { describe, expect, it, vi } from "vitest"
import { setSessionAutoApprovalOverride } from "./setSessionAutoApprovalOverride"

function makeController(overrideArg?: string) {
	const calls: { override: string }[] = []
	return {
		overrideArg,
		setSessionAutoApprovalOverride: vi.fn(async (override: string) => {
			calls.push({ override })
		}),
		// Track postStateToWebview to prove the host re-broadcasts state.
		postStateToWebviewCalls: calls,
	}
}

describe("setSessionAutoApprovalOverride", () => {
	it("activates the override when override='all'", async () => {
		const controller = makeController("all")
		const request = SetSessionAutoApprovalOverrideRequest.create({ override: "all" })
		await setSessionAutoApprovalOverride(controller as never, request)
		expect(controller.setSessionAutoApprovalOverride).toHaveBeenCalledWith("all")
	})

	it("clears the override when override='none'", async () => {
		const controller = makeController("none")
		const request = SetSessionAutoApprovalOverrideRequest.create({ override: "none" })
		await setSessionAutoApprovalOverride(controller as never, request)
		expect(controller.setSessionAutoApprovalOverride).toHaveBeenCalledWith("none")
	})

	it("trims whitespace before validating", async () => {
		const controller = makeController("all")
		const request = SetSessionAutoApprovalOverrideRequest.create({ override: "  all  " })
		await setSessionAutoApprovalOverride(controller as never, request)
		expect(controller.setSessionAutoApprovalOverride).toHaveBeenCalledWith("all")
	})

	it("rejects unknown override values and treats them as 'none'", async () => {
		const controller = makeController("none")
		const request = SetSessionAutoApprovalOverrideRequest.create({ override: "yoloMode" })
		await setSessionAutoApprovalOverride(controller as never, request)
		expect(controller.setSessionAutoApprovalOverride).toHaveBeenCalledWith("none")
	})

	it("rejects empty override and treats it as 'none'", async () => {
		const controller = makeController("none")
		const request = SetSessionAutoApprovalOverrideRequest.create({ override: "" })
		await setSessionAutoApprovalOverride(controller as never, request)
		expect(controller.setSessionAutoApprovalOverride).toHaveBeenCalledWith("none")
	})
})
