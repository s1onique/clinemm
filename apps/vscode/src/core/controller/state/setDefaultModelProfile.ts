/**
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01
 *
 * RPC handler: setDefaultModelProfile.
 *
 * Sets the global default profile id. New tasks created with no
 * HistoryItem.activeProfileId inherit from this default.
 *
 * The default lives in StateManager.globalState under the canonical
 * `defaultModelProfileId` key.
 */

import { Empty } from "@/shared/proto/cline/common"
import { SetDefaultModelProfileRequest } from "@/shared/proto/cline/state"
import type { Controller } from ".."
import { isKnownProfile, setGlobalDefaultProfileId } from "@/sdk/profile-store/owner"

export async function setDefaultModelProfile(controller: Controller, request: SetDefaultModelProfileRequest): Promise<Empty> {
	const owner = controller.modelProfilesOwner
	if (!owner) {
		throw new Error("setDefaultModelProfile: production owner not wired")
	}

	const profileId = (request.profileId ?? "").trim()
	if (!profileId) {
		throw new Error("setDefaultModelProfile: profileId must be a non-empty string")
	}

	if (!isKnownProfile(owner.profilesStore, profileId)) {
		throw new Error(`setDefaultModelProfile: profile '${profileId}' does not exist`)
	}

	setGlobalDefaultProfileId(controller.stateManager, profileId)

	if (owner.postStateToWebview) {
		await owner.postStateToWebview()
	}

	return Empty.create()
}
