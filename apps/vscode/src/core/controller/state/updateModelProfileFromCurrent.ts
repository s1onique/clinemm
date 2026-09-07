/**
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01
 *
 * RPC handler: updateModelProfileFromCurrent.
 *
 * Updates a ModelProfile's providerInstanceId + modelId from the
 * current task's effective configuration. Name is preserved.
 */

import { Logger } from "@/shared/services/Logger"
import { ModelProfile, UpdateModelProfileFromCurrentRequest } from "@/shared/proto/cline/state"
import type { Controller } from ".."
import { updateModelProfileFromConfig as updateInOwner } from "@/sdk/profile-store/owner"

export async function updateModelProfileFromCurrent(
	controller: Controller,
	request: UpdateModelProfileFromCurrentRequest,
): Promise<ModelProfile> {
	const owner = controller.modelProfilesOwner
	if (!owner) {
		throw new Error("updateModelProfileFromCurrent: production owner not wired")
	}

	const profileId = (request.profileId ?? "").trim()
	if (!profileId) {
		throw new Error("updateModelProfileFromCurrent: profileId must be a non-empty string")
	}

	const activeSession = owner.sessions.getActiveSession()
	if (!activeSession) {
		throw new Error("updateModelProfileFromCurrent: no active session")
	}

	const providerId = activeSession.startConfig?.providerId
	const modelId = activeSession.startConfig?.modelId
	if (!providerId || !modelId) {
		throw new Error("updateModelProfileFromCurrent: active session has no providerId/modelId")
	}

	// Resolve the providerInstanceId (mirrors saveCurrentAsModelProfile).
	const currentHistoryItem = owner.getCurrentTaskHistoryItem()
	const activeProfileId = currentHistoryItem?.activeProfileId
	const activeProfile = activeProfileId ? owner.profilesStore.read(activeProfileId) : undefined
	let providerInstanceId = activeProfile?.providerInstanceId

	if (!providerInstanceId) {
		const allInstances = owner.instancesStore.list()
		const match = Object.values(allInstances).find(
			(i: { providerId: string; instanceId: string }) => i.providerId === providerId,
		)
		if (!match) {
			throw new Error(`updateModelProfileFromCurrent: no ProviderConfigurationInstance for providerId='${providerId}'`)
		}
		providerInstanceId = match.instanceId
	}

	const updated = updateInOwner(owner.profilesStore, profileId, providerInstanceId, modelId)
	Logger.log(`[updateModelProfileFromCurrent] ${profileId} -> provider=${providerInstanceId}, model=${modelId}`)

	if (owner.postStateToWebview) {
		await owner.postStateToWebview()
	}

	return ModelProfile.create({
		profileId: updated.profileId,
		name: updated.name,
		providerInstanceId: updated.providerInstanceId,
		modelId: updated.modelId,
	})
}
