/**
 * ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R4
 *
 * Instance-secret namespace (the "instance:" prefix).
 *
 * Recon freeze (commit 191dd639b, evidence 06a):
 *
 *   CREDENTIAL_STORAGE_PRIMITIVE  = C (minimal instance-scoped secret
 *                                   namespace)
 *   Reserved "instance:" prefix in secrets.json
 *   New typed accessor pair (getInstanceSecret / setInstanceSecret)
 *   Manual schema InstanceSecretNameSchema (regex / ^instance:.+$/)
 *
 * The secret value lives in secrets.json (mode 0o600, debounced
 * atomic-rename) under a key matching `InstanceSecretNameSchema`.
 * The store is intentionally distinct from `SECRETS_KEYS` so
 * two same-providerId instances (e.g. two "anthropic" instances
 * with different keys) can coexist.
 *
 * See .factory/evidence/ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-
 * FOUNDATION01/06a-credential-storage-capability.md sections 4-5
 * for the discriminator that produced this primitive.
 */

import { ClineFileStorage } from "./ClineFileStorage"

/**
 * The regex that defines an instance-scoped secret name. Must
 * start with the reserved "instance:" prefix and have at least
 * one trailing character (the rest of the name is user-defined).
 *
 * Why a prefix and not a separate file? Two reasons:
 *   1. The 0o600 file-mode + atomic-rename discipline is the
 *      existing guarantee. Splitting secrets across files would
 *      split the security discipline.
 *   2. The closed `SECRETS_KEYS` union stays untouched, so the
 *      existing TypeScript guarantees on `setSecret` /
 *      `getSecretKey` are preserved (legacy code paths never
 *      accidentally write or read instance credentials).
 */
export const INSTANCE_SECRET_NAME_PATTERN = /^instance:.+$/

/**
 * An opaque, brand-typed wrapper around a string that matches
 * `INSTANCE_SECRET_NAME_PATTERN`. Use `parseInstanceSecretName`
 * to construct; the type system then guarantees no accidental
 * aliasing with the closed `SECRETS_KEYS` union.
 */
declare const InstanceSecretNameBrand: unique symbol
export type InstanceSecretName = string & { readonly [InstanceSecretNameBrand]: void }

/**
 * Parse-and-brand an instance-scoped secret name. Throws
 * `InstanceSecretError` on malformed input (fail closed).
 */
export function parseInstanceSecretName(raw: string): InstanceSecretName {
	if (typeof raw !== "string") {
		throw new InstanceSecretError(`instance secret name must be a string (got ${typeof raw})`)
	}
	if (!INSTANCE_SECRET_NAME_PATTERN.test(raw)) {
		throw new InstanceSecretError(
			`instance secret name must match ${INSTANCE_SECRET_NAME_PATTERN} (got ${JSON.stringify(raw)})`,
		)
	}
	return raw as InstanceSecretName
}

/**
 * Construct an instance-scoped secret name from an instanceId.
 * This is the canonical helper for the APPLY path's
 * `credentialRef.name` field:
 *   - DEFINE/UPDATE: `setInstanceSecret(nameFor(instanceId), value)`
 *   - APPLY:         `getInstanceSecret(instance.credentialRef.name)`
 *
 * The function is the only sanctioned writer of secret names,
 * so a future change to the naming scheme is one-line.
 */
export function nameFor(instanceId: string): InstanceSecretName {
	if (!instanceId || typeof instanceId !== "string") {
		throw new InstanceSecretError(`instanceId must be a non-empty string`)
	}
	return parseInstanceSecretName(`instance:${instanceId}`)
}

export class InstanceSecretError extends Error {
	override readonly name = "InstanceSecretError"
	constructor(message: string) {
		super(message)
	}
}
