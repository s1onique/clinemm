/**
 * ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R3, R4, R5
 * ProviderConfigurationInstance Contracts.
 *
 * Recon phase freeze (commit 191dd639b, evidence 06 + 06a):
 *
 *   STORAGE_GEOMETRY             = dedicated instances.json under ~/.cline/data/
 *   CREDENTIAL_STORAGE_PRIMITIVE = "instance:" prefix in secrets.json (mode 0o600)
 *   SEMANTIC_CREDENTIAL_IDENTITY = opaque credentialRef.name
 *   PHYSICAL_SECRET_REF_ENCODING = { kind: "secret", name: "<key>" }
 *   RUNTIME_STRATEGY             = B (full session reconstruction on
 *                                  instanceId change; updateSessionModel
 *                                  fast path preserved for same instance)
 *   GLOBAL_ACTIVE_INSTANCE_ID    = FORBIDDEN
 *
 * Validation strategy:
 *   This module deliberately uses plain (type-narrowing) validators
 *   instead of `zod` because the persistence phase is run under
 *   vitest (which aliases `@cline/core` to a stub that strips zod).
 *   The manual validators achieve the same fail-closed invariant
 *   the recon phase froze: malformed records throw rather than
 *   silently coerce to a default. See `parseInstanceCredentialRef`,
 *   `parseProviderConnection`, `parseProviderConfigurationInstance`,
 *   and `parseInstancesFile` below.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

import {
	INSTANCE_SECRET_NAME_PATTERN,
	type InstanceSecretName,
	isInstanceSecretName,
} from "@/shared/storage/instance-secret"

/**
 * Thrown by the contract validators on malformed input. The
 * fail-closed invariant means the store / projector do NOT
 * catch parse errors and silently proceed; callers that want
 * to surface this to the user should try/catch and report
 * the underlying message.
 */
export class InstancesContractError extends Error {
	override readonly name = "InstancesContractError"
	readonly path?: string
	constructor(message: string, path?: string) {
		super(message)
		this.path = path
	}
}

// ---------------------------------------------------------------------------
// Credential reference (R4 input shape)
// ---------------------------------------------------------------------------

/**
 * Reserved set of credentialRef.kind values for the persistence
 * phase. The recon freeze (section 4c) restricts to "secret" only;
 * "raw" and "vault" are explicitly NOT implemented (and "raw" is
 * forever forbidden -- see PROFILE_CONTAINS_RAW_SECRET = NO in the
 * recon body). A future kind requires a schema_version bump on
 * InstancesFile and explicit migration code.
 */
export const kInstanceCredentialRefKinds = ["secret"] as const
export type InstanceCredentialRefKind = (typeof kInstanceCredentialRefKinds)[number]

/**
 * A credential reference. Currently the only legal shape is
 * `{ kind: "secret", name: InstanceSecretName }`.
 *
 * `name` is a brand-typed `InstanceSecretName` (must match
 * `INSTANCE_SECRET_NAME_PATTERN`). This is the type-system
 * side of the twelfth reviewer's
 * HALT_TYPED_INSTANCE_CREDENTIAL_NOT_RESOLVED: a malformed
 * instance record cannot alias the closed `SECRETS_KEYS` union,
 * because the brand can only be constructed via `parseInstanceSecretName`
 * / `nameFor(instanceId)` / `isInstanceSecretName(...)`.
 */
export interface InstanceCredentialRef {
	kind: InstanceCredentialRefKind
	name: InstanceSecretName
}

export function parseInstanceCredentialRef(
	raw: unknown,
	path = "credentialRef",
): InstanceCredentialRef {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new InstancesContractError(`${path}: expected object`, path)
	}
	const obj = raw as Record<string, unknown>
	if (obj.kind !== "secret") {
		throw new InstancesContractError(
			`${path}.kind: must be "secret" (got ${JSON.stringify(obj.kind)})`,
			`${path}.kind`,
		)
	}
	if (typeof obj.name !== "string" || obj.name.length === 0) {
		throw new InstancesContractError(
			`${path}.name: must be a non-empty string`,
			`${path}.name`,
		)
	}
	// Per the twelfth reviewer
	// (HALT_TYPED_INSTANCE_CREDENTIAL_NOT_RESOLVED), the
	// credentialRef.name MUST live under the reserved
	// "instance:" prefix in secrets.json. Generic keys like
	// "openAiApiKey" or "apiKey" must be rejected at the
	// persistence boundary so a malformed instance file can
	// never accidentally alias the closed SECRETS_KEYS union.
	const instanceSecretName = isInstanceSecretName(obj.name)
	if (!instanceSecretName) {
		throw new InstancesContractError(
			`${path}.name: must match the instance-secret namespace (${INSTANCE_SECRET_NAME_PATTERN.source}); got ${JSON.stringify(obj.name)}`,
			`${path}.name`,
		)
	}
	return { kind: "secret", name: instanceSecretName }
}

// ---------------------------------------------------------------------------
// Provider connection (the typed provider-instance body)
// ---------------------------------------------------------------------------

/**
 * Per-provider connection parameters as stored on a
 * ProviderConfigurationInstance. The field set is intentionally
 * provider-agnostic; the typed projector (R5) knows how to
 * project each subset onto the live CoreSessionConfig shape for
 * the specific providerId in question.
 *
 * All fields are optional. `null` is the EXPLICIT CLEARING form
 * (see `headers` / `baseUrl` / `region` / `apiLine` below) and
 * is honored by the typed projector -- this is the inverse of
 * the legacy `setIfDefined` semantics that the OPENAI_ONLY_PROBE
 * inherited from `ApiConfiguration`.
 *
 * The credential is NOT a per-connection field. Per the twelfth
 * reviewer (HALT_TYPED_INSTANCE_CREDENTIAL_NOT_RESOLVED), there
 * is exactly ONE credential authority on a `ProviderConfigurationInstance`
 * -- the top-level `credentialRef`. The physical secret value
 * is resolved at apply time by `StateManager.getInstanceSecret(credentialRef.name)`
 * and is NEVER embedded in the instance record nor in the
 * connection shape (PROFILE_CONTAINS_RAW_SECRET = NO).
 */
export interface ProviderConnection {
	/** Provider endpoint. `null` = clear (do not inherit). */
	baseUrl?: string | null
	/** The model selection for this instance. */
	modelId?: string
	/** AWS / GCP / OCA / SAP region. `null` = clear. */
	region?: string | null
	/** Provider-specific routing line. `null` = clear. */
	apiLine?: string | null
	/** HTTP headers for OpenAI-compatible and other header-bearing
	 * providers. `null` = clear. */
	headers?: Record<string, string> | null
	/** Free-form per-provider extras. The typed projector passes
	 * these through unchanged for the provider shapes that accept
	 * them (sap, oca, aws, gcp, etc.). */
	providerSpecificConfig?: Record<string, unknown>
}

/** Validate that `raw` is a plain string-to-string record (or null). */
function parseStringRecord(
	raw: unknown,
	path: string,
	allowNull: boolean,
): Record<string, string> | null | undefined {
	if (raw === undefined) return undefined
	if (raw === null) {
		if (!allowNull) {
			throw new InstancesContractError(`${path}: null is not allowed here`, path)
		}
		return null
	}
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new InstancesContractError(`${path}: expected object`, path)
	}
	const out: Record<string, string> = {}
	for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof v !== "string") {
			throw new InstancesContractError(
				`${path}.${k}: expected string`,
				`${path}.${k}`,
			)
		}
		out[k] = v
	}
	return out
}

export function parseProviderConnection(
	raw: unknown,
	path = "connection",
): ProviderConnection {
	if (raw === undefined) return {}
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new InstancesContractError(`${path}: expected object`, path)
	}
	const obj = raw as Record<string, unknown>
	const conn: ProviderConnection = {}

	if ("baseUrl" in obj) {
		const v = obj.baseUrl
		if (v === null) {
			conn.baseUrl = null
		} else if (typeof v === "string" && v.length > 0) {
			conn.baseUrl = v
		} else {
			throw new InstancesContractError(
				`${path}.baseUrl: must be non-empty string or null`,
				`${path}.baseUrl`,
			)
		}
	}
	if ("apiKeyRef" in obj) {
		// Per the twelfth reviewer
		// (HALT_TYPED_INSTANCE_CREDENTIAL_NOT_RESOLVED),
		// `apiKeyRef` is NOT a valid per-connection field.
		// The single credential authority is the top-level
		// `ProviderConfigurationInstance.credentialRef`. Reject
		// the duplicate field at the persistence boundary.
		throw new InstancesContractError(
			`${path}.apiKeyRef: not a valid field; the credential reference lives at the top-level ProviderConfigurationInstance.credentialRef`,
			`${path}.apiKeyRef`,
		)
	}
	if ("modelId" in obj) {
		const v = obj.modelId
		if (typeof v !== "string" || v.length === 0) {
			throw new InstancesContractError(
				`${path}.modelId: must be non-empty string`,
				`${path}.modelId`,
			)
		}
		conn.modelId = v
	}
	if ("region" in obj) {
		const v = obj.region
		if (v === null) {
			conn.region = null
		} else if (typeof v === "string" && v.length > 0) {
			conn.region = v
		} else {
			throw new InstancesContractError(
				`${path}.region: must be non-empty string or null`,
				`${path}.region`,
			)
		}
	}
	if ("apiLine" in obj) {
		const v = obj.apiLine
		if (v === null) {
			conn.apiLine = null
		} else if (typeof v === "string" && v.length > 0) {
			conn.apiLine = v
		} else {
			throw new InstancesContractError(
				`${path}.apiLine: must be non-empty string or null`,
				`${path}.apiLine`,
			)
		}
	}
	if ("headers" in obj) {
		conn.headers = parseStringRecord(
			obj.headers,
			`${path}.headers`,
			true,
		) as Record<string, string> | null | undefined
	}
	if ("providerSpecificConfig" in obj) {
		const v = obj.providerSpecificConfig
		if (v === null || v === undefined) {
			conn.providerSpecificConfig = undefined
		} else if (typeof v === "object" && !Array.isArray(v)) {
			conn.providerSpecificConfig = v as Record<string, unknown>
		} else {
			throw new InstancesContractError(
				`${path}.providerSpecificConfig: must be an object`,
				`${path}.providerSpecificConfig`,
			)
		}
	}
	return conn
}

// ---------------------------------------------------------------------------
// Instance record (top-level shape)
// ---------------------------------------------------------------------------

/**
 * The actual ProviderConfigurationInstance record.
 *
 * Identity rules:
 *   - `instanceId` is the stable, opaque, durable identity. The
 *     display label is separate and rename-safe.
 *   - `providerId` is a typed string (no `ApiProvider` enum
 *     coupling) so this representation survives the existing
 *     provider rename / rebrand churn.
 *   - `credentialRef` is REQUIRED: there is no implicit-credential
 *     shape. A missing credentialRef is a parse-time error.
 *   - `connection` carries the provider-instance-specific
 *     connection parameters; the typed projector (R5) knows
 *     how to project them onto the live config.
 */
export interface ProviderConfigurationInstance {
	instanceId: string
	providerId: string
	displayLabel: string
	credentialRef: InstanceCredentialRef
	connection: ProviderConnection
	createdAt: number
	updatedAt: number
}

export function parseProviderConfigurationInstance(
	raw: unknown,
	path = "instance",
): ProviderConfigurationInstance {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new InstancesContractError(`${path}: expected object`, path)
	}
	const obj = raw as Record<string, unknown>
	if (typeof obj.instanceId !== "string" || obj.instanceId.length === 0) {
		throw new InstancesContractError(
			`${path}.instanceId: must be non-empty string`,
			`${path}.instanceId`,
		)
	}
	if (typeof obj.providerId !== "string" || obj.providerId.length === 0) {
		throw new InstancesContractError(
			`${path}.providerId: must be non-empty string`,
			`${path}.providerId`,
		)
	}
	if (typeof obj.displayLabel !== "string" || obj.displayLabel.length === 0) {
		throw new InstancesContractError(
			`${path}.displayLabel: must be non-empty string`,
			`${path}.displayLabel`,
		)
	}
	const credentialRef = parseInstanceCredentialRef(obj.credentialRef, `${path}.credentialRef`)
	const connection = parseProviderConnection(obj.connection, `${path}.connection`)
	const createdAt = typeof obj.createdAt === "number" && obj.createdAt >= 0 ? obj.createdAt : NaN
	const updatedAt = typeof obj.updatedAt === "number" && obj.updatedAt >= 0 ? obj.updatedAt : NaN
	if (!Number.isFinite(createdAt)) {
		throw new InstancesContractError(
			`${path}.createdAt: must be non-negative number`,
			`${path}.createdAt`,
		)
	}
	if (!Number.isFinite(updatedAt)) {
		throw new InstancesContractError(
			`${path}.updatedAt: must be non-negative number`,
			`${path}.updatedAt`,
		)
	}
	return {
		instanceId: obj.instanceId,
		providerId: obj.providerId,
		displayLabel: obj.displayLabel,
		credentialRef,
		connection,
		createdAt,
		updatedAt,
	}
}

// ---------------------------------------------------------------------------
// File-on-disk shape
// ---------------------------------------------------------------------------

/**
 * The shape of `instances.json`. Recon section 12 froze:
 *
 *   instances.json
 *     version
 *     instances: Record<instanceId, ProviderConfigurationInstance>
 *
 *   NO: activeInstanceId, profile pointer, global default.
 */
export interface InstancesFile {
	version: 1
	instances: Record<string, ProviderConfigurationInstance>
}

export function parseInstancesFile(raw: unknown, path = "instancesFile"): InstancesFile {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new InstancesContractError(`${path}: expected object`, path)
	}
	const obj = raw as Record<string, unknown>
	if (obj.version !== 1) {
		throw new InstancesContractError(
			`${path}.version: must be 1 (got ${JSON.stringify(obj.version)})`,
			`${path}.version`,
		)
	}
	if (!obj.instances || typeof obj.instances !== "object" || Array.isArray(obj.instances)) {
		throw new InstancesContractError(
			`${path}.instances: expected object`,
			`${path}.instances`,
		)
	}
	const instances: Record<string, ProviderConfigurationInstance> = {}
	for (const [k, v] of Object.entries(obj.instances as Record<string, unknown>)) {
		const parsed = parseProviderConfigurationInstance(v, `${path}.instances.${k}`)
		// Per the twelfth reviewer
		// (HALT_TYPED_INSTANCE_CREDENTIAL_NOT_RESOLVED, follow-on):
		// the durable identity is the JSON map KEY. The body's
		// `instanceId` field is metadata, NOT authority. If the
		// body drifts from the key we fail-closed at the
		// persistence boundary so a tampered file cannot create a
		// shadow instance under a different key.
		if (k !== parsed.instanceId) {
			throw new InstancesContractError(
				`${path}.instances.${k}.instanceId: map key must equal parsed instanceId (got key=${JSON.stringify(k)}, body.instanceId=${JSON.stringify(parsed.instanceId)})`,
				`${path}.instances.${k}.instanceId`,
			)
		}
		instances[k] = parsed
	}
	return { version: 1, instances }
}

/**
 * Initial empty InstancesFile. Used by the store on first
 * construction when no file exists on disk.
 */
export function emptyInstancesFile(): InstancesFile {
	return { version: 1, instances: {} }
}
