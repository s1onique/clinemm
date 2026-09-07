/**
 * ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / Phase A
 *
 * ModelProfile contracts. The V1 product surface is intentionally
 * minimal:
 *
 *   profileId         stable opaque identity
 *   name              user-facing, mutable, NOT identity
 *   providerInstanceId reference to a ProviderConfigurationInstance
 *                       (durable via the Foundation's instances.json)
 *   modelId           model selected when this profile is applied
 *
 * Strict invariants:
 *   - PROFILE_CONTAINS_RAW_SECRET = NO  (no apiKey, no headers, no
 *     credential material of any kind)
 *   - map key == body.profileId (durable identity is the JSON map key)
 *   - malformed profiles.json -> explicit fail-closed error
 *   - profiles.json missing on disk -> valid empty state (zero-delta)
 *
 * The profile refers to a ProviderConfigurationInstance via
 * `providerInstanceId`. The instance owns the credential. A profile
 * never duplicates the connection / credential.
 */

import { InstancesContractError } from "../instance-store/contracts"

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ProfilesContractError extends Error {
	override readonly name = "ProfilesContractError"
	readonly path?: string
	constructor(message: string, path?: string) {
		super(message)
		this.path = path
	}
}

// ---------------------------------------------------------------------------
// The ModelProfile record
// ---------------------------------------------------------------------------

/**
 * A user-named Model Profile.
 *
 * Identity rules:
 *   - `profileId` is the stable, opaque, durable identity. The
 *     display name is separate and rename-safe.
 *   - `providerInstanceId` references a ProviderConfigurationInstance.
 *     The profile never duplicates the connection / credential; the
 *     instance remains the credential owner.
 *   - `modelId` is the model selected when this profile is applied.
 *     It is part of the profile (not just the instance) because the
 *     user typically picks "Claude Haiku on this account" rather than
 *     "Claude Sonnet on this account" — the model choice is a user
 *     preference, not a connection property.
 *
 * The contract deliberately has no `createdAt` / `updatedAt` fields.
 * The recon §3 froze: "No timestamps unless an existing persistence
 * convention genuinely requires them."
 */
export interface ModelProfile {
	profileId: string
	name: string
	providerInstanceId: string
	modelId: string
}

export function parseModelProfile(raw: unknown, path = "profile"): ModelProfile {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new ProfilesContractError(`${path}: expected object`, path)
	}
	const obj = raw as Record<string, unknown>
	if (typeof obj.profileId !== "string" || obj.profileId.length === 0) {
		throw new ProfilesContractError(`${path}.profileId: must be non-empty string`, `${path}.profileId`)
	}
	if (typeof obj.name !== "string" || obj.name.length === 0) {
		throw new ProfilesContractError(`${path}.name: must be non-empty string`, `${path}.name`)
	}
	if (typeof obj.providerInstanceId !== "string" || obj.providerInstanceId.length === 0) {
		throw new ProfilesContractError(
			`${path}.providerInstanceId: must be non-empty string`,
			`${path}.providerInstanceId`,
		)
	}
	if (typeof obj.modelId !== "string" || obj.modelId.length === 0) {
		throw new ProfilesContractError(`${path}.modelId: must be non-empty string`, `${path}.modelId`)
	}
	// Defense-in-depth: a profile must NEVER carry raw secret material.
	// Reject any attempt to add fields like apiKey, headers,
	// credentialRef, etc. by listing only the allowed fields.
	const ALLOWED_KEYS = new Set(["profileId", "name", "providerInstanceId", "modelId"])
	for (const k of Object.keys(obj)) {
		if (!ALLOWED_KEYS.has(k)) {
			throw new ProfilesContractError(
				`${path}: field '${k}' is not allowed (profiles must never carry raw secrets or connection material; refer to a ProviderConfigurationInstance via providerInstanceId)`,
				`${path}.${k}`,
			)
		}
	}
	return {
		profileId: obj.profileId,
		name: obj.name,
		providerInstanceId: obj.providerInstanceId,
		modelId: obj.modelId,
	}
}

// ---------------------------------------------------------------------------
// The on-disk file shape
// ---------------------------------------------------------------------------

/**
 * The shape of `profiles.json`. Recon §3 froze:
 *
 *   profiles.json
 *     version
 *     profiles: Record<profileId, ModelProfile>
 *
 * This store owns **definitions only**. It does NOT own:
 *   - activeProfileId (per-session, lives in HistoryItem.metadata)
 *   - defaultProfileId (global, lives in global state)
 */
export interface ProfilesFile {
	version: 1
	profiles: Record<string, ModelProfile>
}

export function parseProfilesFile(raw: unknown, path = "profilesFile"): ProfilesFile {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new ProfilesContractError(`${path}: expected object`, path)
	}
	const obj = raw as Record<string, unknown>
	if (obj.version !== 1) {
		throw new ProfilesContractError(
			`${path}.version: must be 1 (got ${JSON.stringify(obj.version)})`,
			`${path}.version`,
		)
	}
	if (!obj.profiles || typeof obj.profiles !== "object" || Array.isArray(obj.profiles)) {
		throw new ProfilesContractError(`${path}.profiles: expected object`, `${path}.profiles`)
	}
	const profiles: Record<string, ModelProfile> = {}
	for (const [k, v] of Object.entries(obj.profiles as Record<string, unknown>)) {
		const parsed = parseModelProfile(v, `${path}.profiles.${k}`)
		// Mirror the Foundation's instances.json invariant: the durable
		// identity is the JSON map KEY. The body's `profileId` field is
		// metadata, NOT authority. If the body drifts from the key we
		// fail-closed at the persistence boundary so a tampered file
		// cannot create a shadow profile under a different key.
		if (k !== parsed.profileId) {
			throw new ProfilesContractError(
				`${path}.profiles.${k}.profileId: map key must equal parsed profileId (got key=${JSON.stringify(k)}, body.profileId=${JSON.stringify(parsed.profileId)})`,
				`${path}.profiles.${k}.profileId`,
			)
		}
		profiles[k] = parsed
	}
	return { version: 1, profiles }
}

/** Initial empty ProfilesFile. Used by the store on first construction. */
export function emptyProfilesFile(): ProfilesFile {
	return { version: 1, profiles: {} }
}

/**
 * Re-export of InstancesContractError so callers can import both error
 * classes from one path.
 */
export { InstancesContractError }
