/**
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01
 *
 * RPC handler: clearDefaultModelProfile.
 *
 * Clears the global default profile id. New tasks fall back to
 * legacy resolution (current ApiConfiguration).
 */

import { Empty, EmptyRequest } from "@/shared/proto/cline/common"
import type { Controller } from ".."
import { setGlobalDefaultProfileId } from "@/sdk/profile-store/owner"

export async function clearDefaultModelProfile(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	const owner = controller.modelProfilesOwner
	if (!owner) {
		throw new Error("clearDefaultModelProfile: production owner not wired")
	}

	setGlobalDefaultProfileId(controller.stateManager, undefined)

	if (owner.postStateToWebview) {
		await owner.postStateToWebview()
	}

	return Empty.create()
}
