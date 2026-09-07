/**
 * ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01
 *
 * `bootstrapModelProfileFromCurrentConfiguration` - the typed primitive
 * that closes the first-run bootstrap path. Materializes a fresh
 * ProviderConfigurationInstance + instance-scoped physical credential +
 * ModelProfile from the existing legacy/current `ApiConfiguration`,
 * WITHOUT providerId-equality matching against any pre-existing
 * instance (which is the MPWC01 C3 identity-collapse bug).
 *
 * CONTRACT FREEZES (per the 2026-09-07 in-place amendment; do not
 * silently mutate any of these - they are the load-bearing invariants
 * the reviewer panel pinned):
 *
 *   1. CURRENT_PHYSICAL_CREDENTIAL_SOURCE
 *      The physical API key written to the new instance-scoped secret
 *      namespace MUST be resolved from the existing
 *      current/legacy `ApiConfiguration` authority - NOT from the new
 *      instance-secret namespace (which does not yet exist at the
 *      point the credential is needed). Specifically: the
 *      canonical helper is `resolveApiKey(providerId, config)` at
 *      `apps/vscode/src/sdk/cline-session-factory.ts:529`, and we
 *      call it BEFORE we generate the opaque instanceId. Forbidden:
 *      `getInstanceSecret(NEW_NAME)`, `credentialRef` recursion,
 *      providerId-based lookup, any other inference path.
 *
 *   2. BOOTSTRAP_COMMIT_MODEL
 *      The bootstrap is NOT transactional. There is no rollback path
 *      on partial failure. The durable commit boundary is the
 *      `ProfilesStore.upsert(profile)` call. Steps that follow the
 *      profile write (active-task binding via
 *      `writeActiveProfileIdToHistoryItem`, ExtensionState
 *      publication via `postStateToWebview`) are post-commit
 *      composition: they may fail independently without invalidating
 *      the persisted profile, and their failure surfaces as
 *      `CREATED_BINDING_FAILED` (a truthful success-with-warning).
 *      Tolerable garbage: a partially-completed secret+instance
 *      write before the profile write fails is acceptable; we do
 *      NOT attempt in-line cleanup.
 *
 *   3. BOOTSTRAP_RPC
 *      This primitive is exposed through the dedicated
 *      `bootstrapModelProfileFromCurrentConfiguration` RPC (see
 *      `apps/vscode/proto/cline/state.proto`). It does NOT mutate
 *      the existing `saveCurrentAsModelProfile` semantics - that
 *      RPC remains fail-closed and requires an authoritative
 *      providerInstanceId. Two operations, two RPCs.
 *
 * CAUSAL CHAIN (mandatory order - do not reorder):
 *
 *     current-config-authority
 *       |
 *     resolveCurrentProviderAndCredential(providerId, config)
 *       |
 *     resolveCurrentConnection(providerId, config) // modelId, baseUrl, ...
 *       |
 *     generate opaque instanceId (= inst-<random>)
 *       |
 *     derive InstanceSecretName = nameFor(instanceId)
 *       |
 *     stateManager.setInstanceSecret(name, value)
 *       |
 *     instancesStore.upsert({ instanceId, providerId, ..., credentialRef: { kind: "secret", name }, connection })
 *       |
 *     profilesStore.upsert({ profileId, name, providerInstanceId: instanceId, modelId })
 *       | (durable commit boundary - profile is now persisted)
 *     [POST-COMMIT] writeActiveProfileIdToHistoryItem(currentTaskHistoryItem, profileId)
 *                  (may fail -> CREATED_BINDING_FAILED; absent current task is NOT a warning)
 *       | [POST-COMMIT]
 *     postStateToWebview() // may fail silently (best-effort)
 *
 * RESULT ALGEBRA (discriminated by `status`):
 *
 *   CREATED                              - durable commit succeeded
 *   CREATED_BINDING_FAILED               - durable commit succeeded; post-commit task binding failed
 *   NO_CURRENT_CONFIGURATION             - active mode's provider is unset
 *   CURRENT_CONFIGURATION_UNSUPPORTED    - provider is not in the bootstrap-coverage table
 *   MISSING_CREDENTIAL                   - current config exists but the resolved credential seam returned undefined
 *   INSTANCE_WRITE_FAILED                - InstancesStore.upsert threw (rare)
 *   PROFILE_WRITE_FAILED                 - ProfilesStore.upsert threw (rare)
 *
 * CONSERVATION (this primitive must not silently do):
 *   - Read `getInstanceSecret(NEW_NAME)` (the namespace doesn't exist yet)
 *   - Use `credentialRef` recursion (lives on the instance WE are creating)
 *   - Use `providerId`-based lookup to pick an existing instance (MPWC01 C3 identity collapse)
 *   - Pretend the bootstrap is atomic (it isn't; see freeze #2)
 *   - Roll back partially-completed state on durable-commit failure (we accept tolerable garbage)
 */


import type { ApiConfiguration, ApiProvider } from "@shared/api"
import type { HistoryItem } from "@shared/HistoryItem"
import { Logger } from "@/shared/services/Logger"
import { nameFor, parseInstanceSecretName, type InstanceSecretName } from "@/shared/storage/instance-secret"
import { resolveApiKey, resolveBaseUrl, resolveModelId } from "../cline-session-factory"
import type { ProviderConfigurationInstance, ProviderConnection } from "../instance-store/contracts"
import { type InstancesStore } from "../instance-store/instances-store"
import type { ModelProfile } from "./contracts"
import { type ProfilesStore } from "./profiles-store"
import { writeActiveProfileIdToHistoryItem } from "./session-binding"

// ---------------------------------------------------------------------------
// Status algebra
// ---------------------------------------------------------------------------

/**
 * The discriminated status of the bootstrap. Mirrors
 * `BootstrapModelProfileResponse.status` in
 * `apps/vscode/proto/cline/state.proto`. The webview pattern-matches
 * on this string to render either:
 *   - CREATED              -> success toast, switch to management view
 *   - CREATED_BINDING_FAILED -> success-with-warning banner (the
 *                              profile IS persisted; only the
 *                              active-task binding failed)
 *   - <other>              -> error banner with human-readable `message`
 */
export type BootstrapModelProfileStatus =
	| "CREATED"
	| "CREATED_BINDING_FAILED"
	| "NO_CURRENT_CONFIGURATION"
	| "CURRENT_CONFIGURATION_UNSUPPORTED"
	| "MISSING_CREDENTIAL"
	| "INSTANCE_WRITE_FAILED"
	| "PROFILE_WRITE_FAILED"

/**
 * The discriminated bootstrap result. Per the reviewer's P1 bounded
 * correction (2026-09-07): the result algebra is internally consistent -
 * `status` is the discriminator, never "CREATED" appearing in a failure
 * reason union.
 *
 * Profile + instance ids are populated on `CREATED` and
 * `CREATED_BINDING_FAILED` (the durable commit succeeded in both).
 * `message` is populated on failure paths and on
 * `CREATED_BINDING_FAILED` for the human-readable diagnostic.
 */
export type BootstrapModelProfileResult =
	| { status: "CREATED"; profileId: string; instanceId: string }
	| { status: "CREATED_BINDING_FAILED"; profileId: string; instanceId: string; message: string }
	| {
			status:
				| "NO_CURRENT_CONFIGURATION"
				| "CURRENT_CONFIGURATION_UNSUPPORTED"
				| "MISSING_CREDENTIAL"
				| "INSTANCE_WRITE_FAILED"
				| "PROFILE_WRITE_FAILED"
			message: string
	  }

/**
 * Providers whose bootstrap path is wired through the typed
 * `resolveApiKey` / `resolveBaseUrl` / `resolveModelId` seams. The
 * bootstrap primitive returns `CURRENT_CONFIGURATION_UNSUPPORTED`
 * for any provider not in this set - there is no fallback path that
 * uses providerId-equality matching (that's the MPWC01 C3 bug we're
 * fixing).
 *
 * The set is the union of keys accepted by `PROVIDER_API_KEY_MAP`
 * (resolveApiKey) and `baseUrlMap` (resolveBaseUrl) in
 * `cline-session-factory.ts`. This list is intentionally kept tight;
 * adding a provider here without first wiring its
 * `resolveApiKey` / `resolveBaseUrl` / `resolveModelId` entries would
 * surface as `MISSING_CREDENTIAL` or `CURRENT_CONFIGURATION_UNSUPPORTED`
 * at runtime.
 */
export const BOOTSTRAP_COVERAGE: ReadonlySet<ApiProvider> = new Set<ApiProvider>([
	"anthropic",
	"openai",
	"ollama",
	"lmstudio",
	"gemini",
	"requesty",
	"litellm",
	"asksage",
	"oca",
	"aihubmix",
	"dify",
])

// ---------------------------------------------------------------------------
// Dependencies (dependency-injected - keeps this module free of
// circular imports on SdkController / StateManager)
// ---------------------------------------------------------------------------

export interface BootstrapModelProfileDeps {
	/**
	 * The current ApiConfiguration authority. Bootstrap reads
	 * `providerId`, `modelId`, `baseUrl`, and the per-provider
	 * API-key field from this object. NEVER read
	 * `getInstanceSecret` here - the namespace does not yet
	 * exist for a first-run user (reviewer freeze
	 * CURRENT_PHYSICAL_CREDENTIAL_SOURCE).
	 */
	getApiConfiguration: () => ApiConfiguration

	/**
	 * The active mode (plan | act). Used to select
	 * `planModeApiProvider` vs `actModeApiProvider` and the
	 * corresponding mode-specific model id field.
	 */
	getMode: () => "plan" | "act"

	/**
	 * The StateManager's setInstanceSecret seam. Wraps the
	 * durable `secrets.json` (mode 0o600) write.
	 */
	setInstanceSecret: (name: InstanceSecretName, value: string) => void

	/**
	 * The Foundation's InstancesStore. `upsert(instance)`
	 * validates the instance against the contract, persists to
	 * `instances.json`, and rejects on malformed input
	 * (fail-closed).
	 */
	instancesStore: InstancesStore

	/**
	 * The profile store. `upsert(profile)` is the durable
	 * commit boundary - once this returns, the profile is on
	 * disk.
	 */
	profilesStore: ProfilesStore

	/**
	 * Optional: the active task's HistoryItem. When present
	 * AND when `writeTaskHistoryItem` is provided, the
	 * bootstrap performs the post-commit active-task binding.
	 * When absent, the bootstrap completes with status=`CREATED`
	 * (no binding failure; there is nothing to bind - per
	 * reviewer's "closely related precision" correction:
	 * no current task is NOT a warning).
	 */
	getCurrentTaskHistoryItem?: () => HistoryItem | undefined
	writeTaskHistoryItem?: (item: HistoryItem) => Promise<void>

	/**
	 * Optional: post-commit ExtensionState publication. May
	 * fail silently (best-effort); bootstrap does not block
	 * on its success/failure.
	 */
	postStateToWebview?: () => Promise<void>

	/**
	 * Optional: a time source. Defaults to `Date.now`. Injected
	 * for tests so the produced `createdAt`/`updatedAt` are
	 * deterministic.
	 */
	now?: () => number

	/**
	 * Optional: a random id source for the opaque `instanceId`.
	 * Defaults to a 12-char base36 random string. Injected for
	 * tests so the produced `instanceId` is deterministic.
	 */
	generateId?: () => string
}

// ---------------------------------------------------------------------------
// Connection-tuple capture
// ---------------------------------------------------------------------------

/**
 * Resolve the V1 connection tuple (modelId, baseUrl, headers, region,
 * apiLine, providerSpecificConfig) for the given providerId from the
 * current ApiConfiguration.
 *
 * The captured tuple becomes the `connection` field on the new
 * ProviderConfigurationInstance.
 *
 * Returns undefined for fields that are not present in the current
 * configuration - `parseProviderConnection` distinguishes "absent"
 * (don't inherit) from "null" (explicit clear). We use `undefined`
 * to signal "field wasn't on the source config" (preserve-default
 * semantics) rather than emitting nulls that would aggressively
 * clear the typed projector's inheritance chain.
 */
function captureConnection(providerId: ApiProvider, mode: "plan" | "act", config: ApiConfiguration): ProviderConnection {
	const connection: ProviderConnection = {}
	const modelId = resolveModelId(providerId, mode, config)
	if (modelId) connection.modelId = modelId
	const baseUrl = resolveBaseUrl(providerId, config)
	if (baseUrl) connection.baseUrl = baseUrl
	// The remaining ProviderConnection fields (region, apiLine,
	// headers, providerSpecificConfig) are provider-specific and not
	// centralized in the SessionFactory's resolvers; for V1 we leave
	// them absent on the bootstrapped instance. A future ACT may
	// centralize the mapping per-provider, but doing so is out of
	// scope for the bootstrap fix - the user's credential + baseUrl
	// + model are the load-bearing fields that make the first
	// profile usable.
	return connection
}

// ---------------------------------------------------------------------------
// The primitive
// ---------------------------------------------------------------------------

/**
 * Bootstrap a FIRST ModelProfile from the legacy/current
 * ApiConfiguration. See file-level header for the full causal chain,
 * contract freezes, and conservation rules.
 *
 * Returns a discriminated `BootstrapModelProfileResult` - never
 * throws (the user-visible failure modes are surfaced as status
 * strings, not exceptions).
 */
export async function bootstrapModelProfileFromCurrentConfiguration(
	deps: BootstrapModelProfileDeps,
	name: string,
): Promise<BootstrapModelProfileResult> {
	const trimmedName = (name ?? "").trim()
	if (!trimmedName) {
		// This is a programming error (the controller handler
		// already validated `name` before calling). Returning a
		// `PROFILE_WRITE_FAILED` would mislabel it; surface the
		// plain failure instead. (Per the freeze, the
		// primitive never throws.)
		Logger.error("[bootstrapModelProfile] name must be a non-empty string")
		return {
			status: "PROFILE_WRITE_FAILED",
			message: "bootstrapModelProfile: name must be a non-empty string",
		}
	}

	// -- Step 1: read the current configuration authority
	const config = deps.getApiConfiguration()
	const mode = deps.getMode()
	const rawProviderId: string | undefined =
		mode === "plan" ? config.planModeApiProvider : config.actModeApiProvider
	if (!rawProviderId || typeof rawProviderId !== "string") {
		return {
			status: "NO_CURRENT_CONFIGURATION",
			message: `No provider configured for ${mode} mode. Set one in Settings > API Configuration first.`,
		}
	}
	const providerId = rawProviderId as ApiProvider
	if (!BOOTSTRAP_COVERAGE.has(providerId)) {
		return {
			status: "CURRENT_CONFIGURATION_UNSUPPORTED",
			message: `Provider '${providerId}' is not covered by the bootstrap path. Use Settings > API Configuration to create the profile manually.`,
		}
	}

	// -- Step 2: resolve the physical credential from the
	// CURRENT/LEGACY authority (NOT from the new namespace)
	const physicalCredential = resolveApiKey(providerId, config)
	if (typeof physicalCredential !== "string" || physicalCredential.length === 0) {
		return {
			status: "MISSING_CREDENTIAL",
			message: `No API key is configured for '${providerId}'. Add one in Settings > API Configuration.`,
		}
	}

	// -- Step 3: capture the V1 connection tuple
	const connection = captureConnection(providerId, mode, config)
	const modelId = connection.modelId
	if (!modelId) {
		return {
			status: "MISSING_CREDENTIAL",
			message: `No model id is configured for '${providerId}' in ${mode} mode. Pick a model first.`,
		}
	}

	// -- Step 4: generate an opaque instanceId
	const now = deps.now ?? Date.now
	const generateId = deps.generateId ?? (() => Math.random().toString(36).slice(2, 14))
	const instanceId = `inst-${generateId()}`

	// -- Step 5: derive the canonical instance-secret name
	let secretName: InstanceSecretName
	try {
		secretName = nameFor(instanceId)
	} catch (err) {
		// The generated instanceId MUST always produce a valid
		// `instance:<id>` name (the pattern is `.+` after the
		// prefix), so a parse error here is a programming
		// invariant violation, not a user error. Surface as
		// INSTANCE_WRITE_FAILED for safety.
		Logger.error("[bootstrapModelProfile] nameFor threw for generated instanceId:", err)
		return {
			status: "INSTANCE_WRITE_FAILED",
			message: err instanceof Error ? err.message : String(err),
		}
	}
	// Brand check - defensive; nameFor already brand-typed this.
	parseInstanceSecretName(secretName)

	// -- Step 6: write the physical credential under the
	// instance-scoped namespace (definition step (a))
	deps.setInstanceSecret(secretName, physicalCredential)

	// -- Step 7: persist the ProviderConfigurationInstance
	// (definition step (b))
	const instance: ProviderConfigurationInstance = {
		instanceId,
		providerId,
		displayLabel: `${providerId} (${trimmedName})`,
		credentialRef: { kind: "secret", name: secretName },
		connection,
		createdAt: now(),
		updatedAt: now(),
	}
	try {
		deps.instancesStore.upsert(instance)
	} catch (err) {
		Logger.error("[bootstrapModelProfile] InstancesStore.upsert failed:", err)
		return {
			status: "INSTANCE_WRITE_FAILED",
			message: err instanceof Error ? err.message : String(err),
		}
	}

	// -- Step 8: persist the ModelProfile (durable commit
	// boundary - once this returns, the profile is on disk)
	const profile: ModelProfile = {
		profileId: `prof-${generateId()}`,
		name: trimmedName,
		providerInstanceId: instanceId,
		modelId,
	}
	try {
		deps.profilesStore.upsert(profile)
	} catch (err) {
		Logger.error("[bootstrapModelProfile] ProfilesStore.upsert failed:", err)
		return {
			status: "PROFILE_WRITE_FAILED",
			message: err instanceof Error ? err.message : String(err),
		}
	}

	// -- Step 9: POST-COMMIT COMPOSITION - task binding + state
	// publication. Per freeze BOOTSTRAP_COMMIT_MODEL, these may
	// fail independently without invalidating the durable profile.

	// 9a. Active-task binding - only meaningful when there IS a
	// current task. The reviewer's "closely related precision"
	// correction makes this explicit:
	//   - No current task -> not an error, not a warning. Just CREATED.
	//   - Current task + binding succeeds -> CREATED.
	//   - Current task + binding fails -> CREATED_BINDING_FAILED.
	const currentTask = deps.getCurrentTaskHistoryItem?.()
	if (currentTask && deps.writeTaskHistoryItem) {
		// writeActiveProfileIdToHistoryItem is synchronous and only
		// throws on type-guard failures (very rare). Capture that
		// path explicitly:
		let updated: HistoryItem
		try {
			updated = writeActiveProfileIdToHistoryItem(currentTask, profile.profileId)
		} catch (err) {
			Logger.warn("[bootstrapModelProfile] active-task binding threw:", err)
			return {
				status: "CREATED_BINDING_FAILED",
				profileId: profile.profileId,
				instanceId: instance.instanceId,
				message:
					err instanceof Error
						? `Profile created, but the active task could not be bound: ${err.message}`
						: `Profile created, but the active task could not be bound: ${String(err)}`,
			}
		}
		// Await the async binding write so the result envelope can
		// honestly distinguish CREATED (binding succeeded) from
		// CREATED_BINDING_FAILED (binding failed AFTER the durable
		// commit). Per the freeze, we surface failures as typed
		// results - we do NOT throw across this boundary.
		try {
			await deps.writeTaskHistoryItem(updated)
		} catch (err) {
			Logger.warn("[bootstrapModelProfile] active-task binding write failed:", err)
			return {
				status: "CREATED_BINDING_FAILED",
				profileId: profile.profileId,
				instanceId: instance.instanceId,
				message:
					err instanceof Error
						? `Profile created, but the active task could not be bound: ${err.message}`
						: `Profile created, but the active task could not be bound: ${String(err)}`,
			}
		}
	}

	// 9b. State publication - SILENT BEST-EFFORT. A failure here
	// MUST NOT downgrade a clean CREATED into CREATED_BINDING_FAILED;
	// the durable profile is on disk and the active-task binding
	// (if any) is persisted. Publication is the view-side signal,
	// not a load-bearing step.
	if (deps.postStateToWebview) {
		try {
			await deps.postStateToWebview()
		} catch (err) {
			Logger.warn("[bootstrapModelProfile] postStateToWebview failed (best-effort):", err)
		}
	}

	// If we get here with no current task (or no binding seam),
	// the durable commit is fully clean. Status = CREATED.
	Logger.log(
		`[bootstrapModelProfile] CREATED profile=${profile.profileId} instance=${instance.instanceId} provider=${providerId} model=${modelId}`,
	)
	return {
		status: "CREATED",
		profileId: profile.profileId,
		instanceId: instance.instanceId,
	}
}
