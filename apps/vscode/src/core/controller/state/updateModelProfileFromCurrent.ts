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
	//
	// ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION01
	// (C3 SAVE_CURRENT_IDENTITY_INVERSION): same fix as
	// `saveCurrentAsModelProfile` — fail closed when no authoritative
	// `providerInstanceId` is available. Never guess via providerId
	// matching.
	const currentHistoryItem = owner.getCurrentTaskHistoryItem()
	const activeProfileId = currentHistoryItem?.activeProfileId
	const activeProfile = activeProfileId ? owner.profilesStore.read(activeProfileId) : undefined
	const providerInstanceId = activeProfile?.providerInstanceId

	if (!providerInstanceId) {
		throw new Error(
			`updateModelProfileFromCurrent: cannot derive an authoritative providerInstanceId for the current task. ` +
				`The task has no bound ModelProfile (activeProfileId=${activeProfileId ?? "<none>"}). ` +
				`Bind a profile first so the active session carries a stable identity.`,
		)
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
