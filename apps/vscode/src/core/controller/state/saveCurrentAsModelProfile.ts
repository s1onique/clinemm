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
	//
	// ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION01
	// (C3 SAVE_CURRENT_IDENTITY_INVERSION):
	//
	// The previous implementation fell back to
	//   Object.values(instances).find(i => i.providerId === providerId)
	// when no profile was bound. That was INVALID under the
	// Foundation contract: two same-provider instances A and B exist,
	// and `find` would always pick the first same-provider instance,
	// capturing a running session on B as A (the providerId-collapse
	// bug). The repair fails closed: when no authoritative
	// `providerInstanceId` is available from the bound profile, we
	// surface an explicit unsupported-result error. The user can
	// either (a) bind a profile first, or (b) navigate to Settings
	// to apply a profile (which uses the typed seam correctly).
	const currentHistoryItem = owner.getCurrentTaskHistoryItem()
	const activeProfileId = currentHistoryItem?.activeProfileId
	const activeProfile = activeProfileId ? owner.profilesStore.read(activeProfileId) : undefined
	const providerInstanceId = activeProfile?.providerInstanceId

	if (!providerInstanceId) {
		throw new Error(
			`saveCurrentAsModelProfile: cannot derive an authoritative providerInstanceId for the current task. ` +
				`The task has no bound ModelProfile (activeProfileId=${activeProfileId ?? "<none>"}). ` +
				`Bind a profile first (or use Settings → API Configuration to apply one) so the active session carries a stable identity.`,
		)
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
