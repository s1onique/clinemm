/**
 * ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / Phase D
 *
 * Safe projection from ModelProfile to ModelProfileSummary.
 *
 * Recon §11 froze:
 *
 *   "Forbidden in webview payload:
 *    - apiKey
 *    - credential value
 *    - credentialRef.name if avoidable
 *    - headers containing secrets
 *    - provider secret material"
 *
 * The webview summary intentionally excludes every profile field
 * that could carry secret material (which is none of the V1 fields
 * — profiles never carry secrets by contract, but the projection
 * is still the single chokepoint for the invariant).
 *
 * It also computes the `isActive` / `isDefault` booleans from the
 * canonical inputs (task binding + global default) so the webview
 * never has to recompute them.
 */

import type { ProviderConfigurationInstance } from "../instance-store/contracts"
import type { ModelProfile } from "./contracts"

/**
 * The webview-facing summary shape. Mirrors recon §11.
 *
 * `providerInstanceId` MAY be exposed because it is opaque identity
 * (not a credential). However, the V1 UI never needs it directly —
 * the runtime switches profiles, not instances — so this field is
 * omitted to keep the wire payload minimal.
 */
export interface ModelProfileSummary {
	profileId: string
	name: string
	providerId: string
	modelId: string
	isActive: boolean
	isDefault: boolean
}

/**
 * Project a single ModelProfile (plus its referenced instance and
 * the current binding context) into the webview-safe summary.
 *
 * Throws on a malformed profile (caller has already validated by
 * the time we get here; this is a defensive guard).
 */
export function projectModelProfileToSummary(
	profile: ModelProfile,
	instance: ProviderConfigurationInstance | undefined,
	currentActiveProfileId: string | undefined,
	currentDefaultProfileId: string | undefined,
): ModelProfileSummary {
	if (!profile || typeof profile !== "object") {
		throw new Error("projectModelProfileToSummary: invalid profile")
	}
	const isActive = profile.profileId === currentActiveProfileId
	const isDefault = profile.profileId === currentDefaultProfileId
	const providerId = instance?.providerId ?? "unknown"
	return {
		profileId: profile.profileId,
		name: profile.name,
		providerId,
		modelId: profile.modelId,
		isActive,
		isDefault,
	}
}

/**
 * Project all profiles into webview summaries.
 *
 * Performs a SECRET-SENTINEL SCAN over the resulting array to
 * catch any future regression where a field accidentally starts
 * carrying secret material. The scan uses fixture sentinels that
 * cannot appear in legitimate profile data.
 */
export function projectAllModelProfilesToSummaries(
	profiles: Record<string, ModelProfile>,
	readInstance: (instanceId: string) => ProviderConfigurationInstance | undefined,
	currentActiveProfileId: string | undefined,
	currentDefaultProfileId: string | undefined,
	secretSentinels: readonly string[] = DEFAULT_SECRET_SENTINELS,
): ModelProfileSummary[] {
	const out: ModelProfileSummary[] = []
	for (const profile of Object.values(profiles)) {
		const instance = readInstance(profile.providerInstanceId)
		out.push(projectModelProfileToSummary(profile, instance, currentActiveProfileId, currentDefaultProfileId))
	}
	// Secret-sentinel scan: ensure no secret material leaks into the
	// webview payload. The scan runs at the array level so it covers
	// every field of every summary.
	const serialized = JSON.stringify(out)
	for (const sentinel of secretSentinels) {
		if (serialized.includes(sentinel)) {
			throw new Error(
				`ModelProfileSummary projection leaked a secret sentinel: ${JSON.stringify(sentinel)}`,
			)
		}
	}
	return out
}

/**
 * The default set of secret sentinels used by the projection
 * scan. Real users' profile data never contains these strings, so
 * a match indicates a contract violation. The set is conservative:
 * any future addition of fields MUST be reviewed against this list.
 */
export const DEFAULT_SECRET_SENTINELS: readonly string[] = [
	"sk-",
	"Bearer ",
	"sk-ant-",
	"sk-proj-",
	"x-api-key",
	"api_key",
	"apiKey",
	"credentialRef",
	"headers",
	"x-auth-token",
	"x-goog-api-key",
	"instance:",
]
