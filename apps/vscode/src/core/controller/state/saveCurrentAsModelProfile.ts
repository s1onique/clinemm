/**
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01
 *
 * RPC handler: saveCurrentAsModelProfile.
 *
 * Creates a new ModelProfile from the current task's effective
 * configuration. The "current" provider instance + model id are
 * derived from the active SDK session's startConfig.
 *
 * V1 simplifies: the profile captures the currently-active
 * providerInstanceId + modelId. The caller supplies a name.
 */

import { Logger } from "@/shared/services/Logger"
import { ModelProfile, SaveCurrentAsModelProfileRequest } from "@/shared/proto/cline/state"
import type { Controller } from ".."
import { saveCurrentAsProfile } from "@/sdk/profile-store/owner"

export async function saveCurrentAsModelProfile(
	controller: Controller,
	request: SaveCurrentAsModelProfileRequest,
): Promise<ModelProfile> {
	const owner = controller.modelProfilesOwner
	if (!owner) {
		throw new Error("saveCurrentAsModelProfile: production owner not wired")
	}

	const trimmedName = (request.name ?? "").trim()
	if (!trimmedName) {
		throw new Error("saveCurrentAsModelProfile: name must be a non-empty string")
	}

	// Derive the current provider instance + model id from the active
	// session. We use the active session's startConfig (the
	// CoreSessionConfig that the typed projector materialized) as
	// the source of truth.
	const activeSession = owner.sessions.getActiveSession()
	if (!activeSession) {
		throw new Error("saveCurrentAsModelProfile: no active session; cannot capture current configuration")
	}

	const providerId = activeSession.startConfig?.providerId
	const modelId = activeSession.startConfig?.modelId
	if (!providerId || !modelId) {
		throw new Error("saveCurrentAsModelProfile: active session has no providerId/modelId in startConfig")
	}

	// Resolve the providerInstanceId from the active session binding.
	// The session binding flow ties an activeProfileId → providerInstanceId.
	// For "save current", we walk the active profile (if any) or fall
	// back to the active SDK session's instance binding.
	const currentHistoryItem = owner.getCurrentTaskHistoryItem()
	const activeProfileId = currentHistoryItem?.activeProfileId
	const activeProfile = activeProfileId ? owner.profilesStore.read(activeProfileId) : undefined
	let providerInstanceId = activeProfile?.providerInstanceId

	if (!providerInstanceId) {
		// No profile binding — try to find an instance whose
		// providerId matches the active session's providerId.
		const allInstances = owner.instancesStore.list()
		const match = Object.values(allInstances).find(
			(i: { providerId: string; instanceId: string }) => i.providerId === providerId,
		)
		if (!match) {
			throw new Error(`saveCurrentAsModelProfile: no ProviderConfigurationInstance found for providerId='${providerId}'`)
		}
		providerInstanceId = match.instanceId
	}

	const saved = saveCurrentAsProfile(owner.profilesStore, trimmedName, providerInstanceId, modelId)
	Logger.log(
		`[saveCurrentAsModelProfile] Created profile ${saved.profileId} (provider=${providerInstanceId}, model=${modelId})`,
	)

	// Publish the updated state so the webview refreshes.
	if (owner.postStateToWebview) {
		await owner.postStateToWebview()
	}

	return ModelProfile.create({
		profileId: saved.profileId,
		name: saved.name,
		providerInstanceId: saved.providerInstanceId,
		modelId: saved.modelId,
	})
}
