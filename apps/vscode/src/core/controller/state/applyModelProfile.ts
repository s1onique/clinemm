/**
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01
 *
 * RPC handler: applyModelProfile.
 *
 * Receives a `profileId` from the webview, delegates to the
 * production owner (which composes with the Foundation's typed
 * `applyTypedProviderConfigurationInstance` seam), and returns a
 * structured `ApplyModelProfileResponse`.
 *
 * This handler is the SINGLE webview-facing entry point for profile
 * application. The webview MUST go through here — direct calls to
 * `applyModelProfile` (the coordinator) are an internal seam.
 */

import { Logger } from "@/shared/services/Logger"
import { ApplyModelProfileRequest, ApplyModelProfileResponse } from "@/shared/proto/cline/state"
import type { Controller } from ".."
import { applyModelProfileViaOwner } from "@/sdk/profile-store/owner"
import { isKnownProfile } from "@/sdk/profile-store/owner"

/**
 * Apply a ModelProfile to the active task.
 *
 * The webview calls this when:
 *   - the user clicks a profile in the footer quick-switch popover
 *   - the user clicks "Use" in the Settings Model Profiles section
 *
 * The handler:
 *   1. Validates the profileId is a non-empty string.
 *   2. Validates the profile exists in the ProfilesStore (via owner).
 *   3. Delegates to `applyModelProfileViaOwner`, which composes:
 *        - profile resolution
 *        - instance resolution
 *        - credential resolution
 *        - session idle check
 *        - typed Foundation apply (`applyTypedProviderConfigurationInstance`)
 *        - activeProfileId persistence (only on success)
 *        - ExtensionState publish (only on success)
 *   4. Maps the structured result to the proto response.
 *
 * Failure modes (all return `applied = false` with a reason):
 *   - empty profileId                  -> reason = "unknown_profile"
 *   - unknown profile                  -> reason = "unknown_profile"
 *   - unknown instance                 -> reason = "unknown_instance"
 *   - missing credential               -> reason = "missing_credential"
 *   - no active session                -> reason = "no_active_session"
 *   - session is running               -> reason = "session_running"
 *   - typed apply refusal              -> reason = "reconstruction_failed"
 *
 * The failure contract (per recon §10):
 *   - activeProfileId remains the previous value
 *   - the runtime stays on the previous connection
 *   - the webview receives an explicit reason + message
 */
export async function applyModelProfile(
	controller: Controller,
	request: ApplyModelProfileRequest,
): Promise<ApplyModelProfileResponse> {
	if (!request.profileId || typeof request.profileId !== "string") {
		return ApplyModelProfileResponse.create({
			applied: false,
			reason: "unknown_profile",
			message: "applyModelProfile: profileId must be a non-empty string",
		})
	}

	const owner = controller.modelProfilesOwner
	if (!owner) {
		Logger.error("[applyModelProfile] Controller has no modelProfilesOwner — production wiring missing")
		return ApplyModelProfileResponse.create({
			applied: false,
			reason: "reconstruction_failed",
			message: "applyModelProfile: production owner not wired",
		})
	}

	if (!isKnownProfile(owner.profilesStore, request.profileId)) {
		return ApplyModelProfileResponse.create({
			applied: false,
			reason: "unknown_profile",
			message: `Profile '${request.profileId}' does not exist`,
		})
	}

	try {
		const result = await applyModelProfileViaOwner(owner, request.profileId)
		return ApplyModelProfileResponse.create({
			applied: result.applied,
			reason: result.reason ?? "",
			message: result.message ?? "",
			newSessionId: result.newSessionId ?? "",
			usedFastPath: result.usedFastPath ?? false,
		})
	} catch (error) {
		Logger.error("[applyModelProfile] Unexpected error:", error)
		return ApplyModelProfileResponse.create({
			applied: false,
			reason: "reconstruction_failed",
			message: error instanceof Error ? error.message : String(error),
		})
	}
}
