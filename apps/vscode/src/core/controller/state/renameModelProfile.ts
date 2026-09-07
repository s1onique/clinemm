/**
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01
 *
 * RPC handler: renameModelProfile.
 *
 * Renames a ModelProfile. Only the user-facing `name` field
 * changes; profileId, providerInstanceId, modelId, and the
 * underlying credential are preserved.
 */

import { Logger } from "@/shared/services/Logger"
import { ModelProfile, RenameModelProfileRequest } from "@/shared/proto/cline/state"
import type { Controller } from ".."
import { renameModelProfile as renameInOwner } from "@/sdk/profile-store/owner"

export async function renameModelProfile(controller: Controller, request: RenameModelProfileRequest): Promise<ModelProfile> {
	const owner = controller.modelProfilesOwner
	if (!owner) {
		throw new Error("renameModelProfile: production owner not wired")
	}

	const profileId = (request.profileId ?? "").trim()
	const newName = (request.newName ?? "").trim()
	if (!profileId) {
		throw new Error("renameModelProfile: profileId must be a non-empty string")
	}
	if (!newName) {
		throw new Error("renameModelProfile: newName must be a non-empty string")
	}

	const renamed = renameInOwner(owner.profilesStore, profileId, newName)
	Logger.log(`[renameModelProfile] ${profileId} -> name="${renamed.name}"`)

	if (owner.postStateToWebview) {
		await owner.postStateToWebview()
	}

	return ModelProfile.create({
		profileId: renamed.profileId,
		name: renamed.name,
		providerInstanceId: renamed.providerInstanceId,
		modelId: renamed.modelId,
	})
}
