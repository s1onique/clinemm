import { Empty } from "@shared/proto/cline/common"
import type { SetSessionAutoApprovalOverrideRequest } from "@shared/proto/cline/state"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

/**
 * ACT-CLINEMM-SESSION-AUTONOMY01
 *
 * Webview -> host RPC: activate or deactivate the session-scoped
 * auto-approval override.
 *
 * The override is ephemeral (never persisted) and is bound to the
 * active SDK session id by the controller. Hard DENY / execution_plan_invalid
 * still DENY at the canonical command policy lattice.
 *
 * Unknown `override` values are rejected and logged; this prevents a
 * webview regression from silently mutating host behavior.
 */
export async function setSessionAutoApprovalOverride(
	controller: Controller,
	request: SetSessionAutoApprovalOverrideRequest,
): Promise<Empty> {
	const raw = request.override?.trim()
	if (raw !== "none" && raw !== "all") {
		Logger.warn(`[setSessionAutoApprovalOverride] refusing invalid override=${JSON.stringify(raw)}; treating as "none"`)
		await controller.setSessionAutoApprovalOverride("none")
		return Empty.create()
	}
	await controller.setSessionAutoApprovalOverride(raw)
	return Empty.create()
}
