/**
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01
 *
 * RPC handler: deleteModelProfile.
 *
 * Deletes a ModelProfile by id. Active and default profiles cannot
 * be deleted — the handler returns `deleted = false` with a reason
 * in that case.
 */

import { Logger } from "@/shared/services/Logger"
import { DeleteModelProfileRequest, DeleteModelProfileResponse } from "@/shared/proto/cline/state"
import type { Controller } from ".."
import {
	deleteModelProfile as deleteInOwner,
	getGlobalDefaultProfileId,
	readActiveProfileIdFromHistoryItem,
} from "@/sdk/profile-store/owner"

export async function deleteModelProfile(
	controller: Controller,
	request: DeleteModelProfileRequest,
): Promise<DeleteModelProfileResponse> {
	const owner = controller.modelProfilesOwner
	if (!owner) {
		return DeleteModelProfileResponse.create({
			deleted: false,
			reason: "production owner not wired",
		})
	}

	const profileId = (request.profileId ?? "").trim()
	if (!profileId) {
		return DeleteModelProfileResponse.create({
			deleted: false,
			reason: "profileId must be a non-empty string",
		})
	}

	const defaultProfileId = getGlobalDefaultProfileId(controller.stateManager)
	const historyItem = owner.getCurrentTaskHistoryItem()
	const activeId = readActiveProfileIdFromHistoryItem(historyItem)

	const result = deleteInOwner(owner.profilesStore, defaultProfileId, historyItem, profileId)
	if (!result.deleted) {
		Logger.log(`[deleteModelProfile] Refused to delete ${profileId}: ${result.reason}`)
		return DeleteModelProfileResponse.create({
			deleted: false,
			reason: result.reason ?? "refused",
		})
	}

	// If the deleted profile WAS the active profile (shouldn't be
	// possible given canDeleteProfile gating, but defensively),
	// clear the activeProfileId binding.
	if (activeId === profileId && historyItem && owner.writeTaskHistoryItem) {
		const cleared = { ...historyItem }
		delete (cleared as { activeProfileId?: string }).activeProfileId
		await owner.writeTaskHistoryItem(cleared)
	}

	if (owner.postStateToWebview) {
		await owner.postStateToWebview()
	}

	return DeleteModelProfileResponse.create({
		deleted: true,
		reason: "",
	})
}
