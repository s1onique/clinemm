/**
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01
 *
 * RPC handler: listModelProfiles.
 *
 * Returns the full ModelProfile snapshot plus the active + default
 * binding identifiers. The webview normally consumes these via the
 * ExtensionState push (`modelProfiles`, `defaultModelProfileId`,
 * `activeModelProfileId`) — this RPC exists for explicit refresh
 * (e.g. after a profile CRUD operation that the webview wants to
 * re-read independently of the next state push).
 */

import { ListModelProfilesRequest, ListModelProfilesResponse, ModelProfile } from "@/shared/proto/cline/state"
import type { Controller } from ".."
import { projectModelProfilesForWebview, readActiveProfileIdFromHistoryItem } from "@/sdk/profile-store/owner"
import { getGlobalDefaultProfileId } from "@/sdk/profile-store/owner"

/**
 * Snapshot read of all defined ModelProfiles + the active/default
 * binding identifiers.
 */
export async function listModelProfiles(
	controller: Controller,
	_request: ListModelProfilesRequest,
): Promise<ListModelProfilesResponse> {
	const owner = controller.modelProfilesOwner
	if (!owner) {
		// No production owner wired — return empty list (defensive).
		// The webview falls back to its local defaults in this case.
		return ListModelProfilesResponse.create({
			profiles: [],
			activeProfileId: "",
			defaultProfileId: "",
		})
	}

	const defaultProfileId = getGlobalDefaultProfileId(controller.stateManager)
	const historyItem = owner.getCurrentTaskHistoryItem()
	const summaries = projectModelProfilesForWebview(owner.profilesStore, owner.instancesStore, defaultProfileId, historyItem)

	const profiles: ModelProfile[] = summaries.map((s) =>
		ModelProfile.create({
			profileId: s.profileId,
			name: s.name,
			providerInstanceId: "",
			modelId: s.modelId,
		}),
	)

	return ListModelProfilesResponse.create({
		profiles,
		activeProfileId: readActiveProfileIdFromHistoryItem(historyItem) ?? "",
		defaultProfileId: defaultProfileId ?? "",
	})
}
