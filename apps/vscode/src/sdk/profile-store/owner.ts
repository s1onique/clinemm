/**
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01
 *
 * Production owner for ModelProfile state. This is the SINGLE
 * composition authority that:
 *
 *   - owns the lifetime of `ProfilesStore` (durable definition store)
 *   - reads from `InstancesStore` (Foundation) for instance data
 *   - resolves physical secrets via `StateManager.getInstanceSecret`
 *   - delegates to `applyModelProfile` (composition coordinator) for
 *     the typed Foundation seam
 *   - reads/writes the global `defaultModelProfileId` via StateManager
 *   - publishes derived `ModelProfileSummary[]` for the webview
 *     ExtensionState projection
 *
 * The Foundation seam (`applyTypedProviderConfigurationInstance` ->
 * `SdkSessionConfigBuilder.build`) is unchanged. This owner is the
 * wiring glue that bridges the RPC handlers to the existing
 * composition coordinator.
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { HistoryItem } from "@shared/HistoryItem"
import { Logger } from "@/shared/services/Logger"
import type { InstanceSecretName } from "@/shared/storage/instance-secret"
import type { ProviderConfigurationInstance } from "../instance-store/contracts"
import { InstancesStore } from "../instance-store/instances-store"
import type { SdkProviderChangeCoordinator } from "../sdk-provider-change-coordinator"
import type { SdkSessionConfigBuilder } from "../sdk-session-config-builder"
import type { SdkSessionLifecycle } from "../sdk-session-lifecycle"
import type { SdkSessionRebuildScheduler } from "../sdk-session-rebuild-scheduler"
import {
	applyModelProfile as applyModelProfileCoordinator,
	type ApplyModelProfileFailureReason,
} from "./profile-application"
import type { ModelProfile } from "./contracts"
import { ProfilesStore } from "./profiles-store"
import {
	DEFAULT_MODEL_PROFILE_ID_KEY,
	readDefaultModelProfileId,
	resolveActiveProfileIdForNewTask,
	resolveActiveProfileIdForResume,
	writeActiveProfileIdToHistoryItem,
	writeDefaultModelProfileId,
} from "./session-binding"
import type { ModelProfileSummary } from "./webview-summary"
import { projectAllModelProfilesToSummaries } from "./webview-summary"

/**
 * Wired-up dependencies the profile owner needs from the host
 * (SdkController / Foundation). Dependency-injected so this module
 * does not import SdkController directly (avoids a circular
 * dependency with the SDK layer).
 */
export interface ModelProfilesOwnerDeps {
	profilesStore: ProfilesStore
	instancesStore: InstancesStore
	/**
	 * Only `applyTypedProviderConfigurationInstance` is required.
	 * `applyProviderConfigurationInstance` is kept as an optional
	 * fallback in the underlying coordinator (and tests) but the
	 * product path always uses the typed seam.
	 */
	providerChange: Pick<SdkProviderChangeCoordinator, "applyTypedProviderConfigurationInstance">
	sessions: SdkSessionLifecycle
	sessionConfigBuilder: SdkSessionConfigBuilder
	sessionRebuilds: SdkSessionRebuildScheduler
	getInstanceSecret: (name: InstanceSecretName) => string | undefined
	getWorkspaceRoot: () => Promise<string>
	getMode?: () => "plan" | "act"
	getCurrentTaskProviderInstanceId?: () => string | undefined
	getCurrentTaskHistoryItem: () => HistoryItem | undefined
	writeTaskHistoryItem: (item: HistoryItem) => Promise<void>
	postStateToWebview: () => Promise<void>
	/**
	 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION01
	 * (C4 FACTORY_RESUME_EFFECTIVE_CONNECTION):
	 *
	 * Resolve the global default `ModelProfile.id`. Wired to
	 * `StateManager.getGlobalStateKey("defaultModelProfileId")`.
	 */
	getDefaultProfileId?: () => string | undefined
	/**
	 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION02
	 * (C6 BOUND_PROFILE_MISSING_INSTANCE_FAIL_CLOSED):
	 *
	 * Resolve the typed `ProviderConfigurationInstance` for a new
	 * task or resume session. Wired by SdkController to the
	 * precedence-algebraic helper + profile → instance translation
	 * so `SdkTaskStartCoordinator.initTask` and
	 * `reinitExistingTaskFromId` thread the typed instance through
	 * the builder. Returns the discriminated
	 * `ResolveActiveInstanceResult` — the factory MUST distinguish
	 * NONE_BOUND (legacy fallback OK) from BOUND_BUT_BROKEN (fail
	 * closed with explicit error).
	 */
	resolveActiveInstanceTyped?: (input: {
		historyItem?: HistoryItem
		isResume: boolean
		defaultProfileId: string | undefined
	}) => ResolveActiveInstanceResult
}

/**
 * Apply a profile to the active task. Pure composition wrapper
 * around the existing `applyModelProfile` coordinator; this is the
 * single entry point the production RPC handlers call.
 */
export async function applyModelProfileViaOwner(
	deps: ModelProfilesOwnerDeps,
	profileId: string,
): Promise<{
	applied: boolean
	reason?: ApplyModelProfileFailureReason
	message?: string
	newSessionId?: string
	usedFastPath?: boolean
}> {
	const result = await applyModelProfileCoordinator(profileId, {
		profilesStore: deps.profilesStore,
		readInstance: (instanceId) => deps.instancesStore.read(instanceId),
		getInstanceSecret: deps.getInstanceSecret,
		sessions: deps.sessions,
		sessionConfigBuilder: deps.sessionConfigBuilder,
		providerChange: deps.providerChange,
		rebuilds: deps.sessionRebuilds,
		getWorkspaceRoot: deps.getWorkspaceRoot,
		getMode: deps.getMode,
		getCurrentTaskHistoryItem: deps.getCurrentTaskHistoryItem,
		writeTaskHistoryItem: deps.writeTaskHistoryItem,
		postStateToWebview: deps.postStateToWebview,
	})
	if (result.applied) {
		return {
			applied: true,
			newSessionId: result.sessionId,
			usedFastPath: result.usedFastPath,
		}
	}
	return {
		applied: false,
		reason: result.reason,
		message: result.message,
	}
}

/**
 * Resolve the active profile id for a task resumption.
 *
 * Precedence (per recon §4.1):
 *   1. HistoryItem.activeProfileId (per-task binding)
 *   2. global default (defaultModelProfileId)
 *   3. undefined (fall through to legacy resolution)
 */
export function resolveActiveProfileForResume(
	profilesStore: ProfilesStore,
	defaultProfileId: string | undefined,
	historyItem: HistoryItem | undefined,
): ModelProfile | undefined {
	const resolvedId = resolveActiveProfileIdForResume(
		historyItem ? { activeProfileId: readActiveProfileIdFromHistoryItem(historyItem) } : {},
		defaultProfileId,
		profilesStore.list() as Record<string, { profileId: string }>,
	)
	if (!resolvedId) return undefined
	return profilesStore.read(resolvedId)
}

/**
 * Resolve the active profile id for a new task. Same precedence as
 * resume, but with no per-task binding (so default → undefined).
 */
export function resolveActiveProfileForNewTask(
	profilesStore: ProfilesStore,
	defaultProfileId: string | undefined,
): ModelProfile | undefined {
	const resolvedId = resolveActiveProfileIdForNewTask(
		defaultProfileId,
		profilesStore.list() as Record<string, { profileId: string }>,
	)
	if (!resolvedId) return undefined
	return profilesStore.read(resolvedId)
}

/**
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION02
 * (C6 BOUND_PROFILE_MISSING_INSTANCE_FAIL_CLOSED):
 *
 * Discriminated result of resolving the typed
 * `ProviderConfigurationInstance` for a new task or resume
 * session. Three cases MUST be distinguished — collapsing them
 * into a single `undefined` return caused the
 * `HALT_BOUND_PROFILE_MISSING_INSTANCE_FAILS_OPEN` P0 (the
 * factory silently fell back to the legacy ApiConfiguration
 * when a bound profile's instance was deleted/corrupt, which
 * splits task-metadata authority from runtime authority):
 *
 *   - RESOLVED      → typed instance exists, apply it
 *   - NONE_BOUND    → no authoritative profile (legacy fallback OK)
 *   - BOUND_BUT_BROKEN → profile is bound but its providerInstanceId
 *                        is missing OR the instance can't be read;
 *                        legacy fallback is NOT correct — the caller
 *                        MUST fail closed with an explicit error.
 */
export type ResolveActiveInstanceResult =
	| { kind: "RESOLVED"; instance: ProviderConfigurationInstance }
	| { kind: "NONE_BOUND" }
	| {
			kind: "BOUND_BUT_BROKEN"
			reason:
				| "profile_missing_providerInstanceId"
				| "instance_not_found"
			profileId: string
			profileName: string
			referencedInstanceId: string | undefined
	  }

/**
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION02
 * (C6 BOUND_PROFILE_MISSING_INSTANCE_FAIL_CLOSED):
 *
 * Discriminated variant of the legacy `resolveActiveInstanceTyped`.
 * Returns one of three cases — see `ResolveActiveInstanceResult`.
 * The factory (SdkTaskStartCoordinator) MUST distinguish NONE_BOUND
 * (legacy fallback OK) from BOUND_BUT_BROKEN (fail closed).
 *
 * Precedence:
 *   - Resume: task binding > default > NONE_BOUND
 *   - New task: default > NONE_BOUND
 */
export function resolveActiveInstanceTypedDiscriminated(
	profilesStore: ProfilesStore,
	instancesStore: InstancesStore,
	defaultProfileId: string | undefined,
	historyItem: HistoryItem | undefined,
	isResume: boolean,
): ResolveActiveInstanceResult {
	const profile = isResume
		? resolveActiveProfileForResume(profilesStore, defaultProfileId, historyItem)
		: resolveActiveProfileForNewTask(profilesStore, defaultProfileId)
	if (!profile) {
		return { kind: "NONE_BOUND" }
	}
	if (!profile.providerInstanceId) {
		// The precedence-algebraic helper layer returned a profile,
		// but the profile itself has no instance binding. This is
		// a corruption case (or a profile that was migrated before
		// the typed seam landed). NOT a NONE_BOUND scenario.
		return {
			kind: "BOUND_BUT_BROKEN",
			reason: "profile_missing_providerInstanceId",
			profileId: profile.profileId,
			profileName: profile.name,
			referencedInstanceId: undefined,
		}
	}
	const instance = instancesStore.read(profile.providerInstanceId)
	if (!instance) {
		// The profile references an instance that no longer exists
		// in the instances store (deleted, corrupted, or migrated).
		// This is the canonical "broken binding" case.
		return {
			kind: "BOUND_BUT_BROKEN",
			reason: "instance_not_found",
			profileId: profile.profileId,
			profileName: profile.name,
			referencedInstanceId: profile.providerInstanceId,
		}
	}
	return { kind: "RESOLVED", instance }
}

/**
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION01
 * (C4 FACTORY_RESUME_EFFECTIVE_CONNECTION):
 *
 * Resolve the typed `ProviderConfigurationInstance` for a new task
 * or resume session. This is the canonical entry point the
 * `SdkTaskStartCoordinator` calls via its `resolveProviderInstanceTyped`
 * option — the precedence-algebraic helper layer combined with
 * the profile → typed-instance translation. Returns `undefined`
 * when no authoritative profile is bound (legacy behavior — the
 * factory falls back to the StateManager's ApiConfiguration).
 *
 * PREFERS the discriminated variant `resolveActiveInstanceTypedDiscriminated`
 * which distinguishes NONE_BOUND from BOUND_BUT_BROKEN. This
 * legacy wrapper is kept for callers that have not yet migrated;
 * it loses the BOUND_BUT_BROKEN signal by collapsing it to
 * `undefined`. New callers (e.g. SdkTaskStartCoordinator) MUST
 * use the discriminated variant.
 *
 * Precedence:
 *   - Resume: task binding > default > undefined
 *   - New task: default > undefined
 */
export function resolveActiveInstanceTyped(
	profilesStore: ProfilesStore,
	instancesStore: InstancesStore,
	defaultProfileId: string | undefined,
	historyItem: HistoryItem | undefined,
	isResume: boolean,
): ProviderConfigurationInstance | undefined {
	const result = resolveActiveInstanceTypedDiscriminated(
		profilesStore,
		instancesStore,
		defaultProfileId,
		historyItem,
		isResume,
	)
	return result.kind === "RESOLVED" ? result.instance : undefined
}

/**
 * Helper: read `activeProfileId` from a HistoryItem.
 */
export function readActiveProfileIdFromHistoryItem(item: HistoryItem | undefined): string | undefined {
	if (!item) return undefined
	return typeof item.activeProfileId === "string" && item.activeProfileId.length > 0
		? item.activeProfileId
		: undefined
}

/**
 * Persist the active profile id back into the task's HistoryItem.
 * Pure passthrough to the canonical `writeActiveProfileIdToHistoryItem`
 * from session-binding.
 */
export function writeActiveProfileId(item: HistoryItem, profileId: string): HistoryItem {
	return writeActiveProfileIdToHistoryItem(item, profileId)
}

/**
 * Set / clear the global default profile id. Wraps the StateManager
 * bridge to keep the storage key canonical.
 */
export function setGlobalDefaultProfileId(
	stateManager: { setGlobalState(key: typeof DEFAULT_MODEL_PROFILE_ID_KEY, value: string | undefined): void },
	profileId: string | undefined,
): void {
	writeDefaultModelProfileId(stateManager, profileId)
}

/**
 * Read the global default profile id.
 */
export function getGlobalDefaultProfileId(stateManager: {
	getGlobalStateKey(key: typeof DEFAULT_MODEL_PROFILE_ID_KEY): string | undefined
}): string | undefined {
	return readDefaultModelProfileId(stateManager)
}

/**
 * Compute the webview-facing projection: a list of
 * `ModelProfileSummary` with `isActive` / `isDefault` flags baked in.
 * The webview is intentionally forbidden from computing these
 * flags; this function is the sole authority.
 */
export function projectModelProfilesForWebview(
	profilesStore: ProfilesStore,
	instancesStore: InstancesStore,
	defaultProfileId: string | undefined,
	historyItem: HistoryItem | undefined,
): ModelProfileSummary[] {
	return projectAllModelProfilesToSummaries(
		profilesStore.list(),
		(instanceId) => {
			const inst: ProviderConfigurationInstance | undefined = instancesStore.read(instanceId)
			return inst
		},
		readActiveProfileIdFromHistoryItem(historyItem),
		defaultProfileId,
	)
}

/**
 * Compute the (modelProfiles, defaultModelProfileId,
 * activeModelProfileId) projection to be merged into ExtensionState.
 */
export function projectExtensionStateModelProfiles(args: {
	profilesStore: ProfilesStore
	instancesStore: InstancesStore
	defaultProfileId: string | undefined
	historyItem: HistoryItem | undefined
}): {
	modelProfiles: ModelProfileSummary[]
	defaultModelProfileId: string | null
	activeModelProfileId: string | null
} {
	return {
		modelProfiles: projectModelProfilesForWebview(
			args.profilesStore,
			args.instancesStore,
			args.defaultProfileId,
			args.historyItem,
		),
		defaultModelProfileId: args.defaultProfileId ?? null,
		activeModelProfileId: readActiveProfileIdFromHistoryItem(args.historyItem) ?? null,
	}
}

/**
 * Helper: validate that a profile id is known to the store.
 */
export function isKnownProfile(profilesStore: ProfilesStore, profileId: string): boolean {
	if (!profileId || typeof profileId !== "string") return false
	return profilesStore.read(profileId) !== undefined
}

/**
 * Helper: assert a profile exists and is not currently active OR the
 * global default. Used by the delete RPC handler.
 */
export function canDeleteProfile(
	profilesStore: ProfilesStore,
	defaultProfileId: string | undefined,
	historyItem: HistoryItem | undefined,
	profileId: string,
): { canDelete: true } | { canDelete: false; reason: "unknown" | "active" | "default" } {
	if (!isKnownProfile(profilesStore, profileId)) {
		return { canDelete: false, reason: "unknown" }
	}
	const activeId = readActiveProfileIdFromHistoryItem(historyItem)
	if (activeId === profileId) {
		return { canDelete: false, reason: "active" }
	}
	if (defaultProfileId === profileId) {
		return { canDelete: false, reason: "default" }
	}
	return { canDelete: true }
}

/**
 * Helper: rename a profile (mutates the store, returns the renamed
 * record). Wraps `ProfilesStore.rename` so RPC handlers don't need
 * to know the store's internal API.
 */
export function renameModelProfile(profilesStore: ProfilesStore, profileId: string, newName: string): ModelProfile {
	const trimmed = newName.trim()
	if (!trimmed) {
		throw new Error("renameModelProfile: newName must be a non-empty string")
	}
	profilesStore.rename(profileId, trimmed)
	const renamed = profilesStore.read(profileId)
	if (!renamed) {
		throw new Error(`renameModelProfile: profile '${profileId}' disappeared after rename`)
	}
	return renamed
}

/**
 * Helper: update a profile's providerInstanceId + modelId from a
 * current task configuration. The caller provides the live config
 * (current provider instance id + model id).
 */
export function updateModelProfileFromConfig(
	profilesStore: ProfilesStore,
	profileId: string,
	providerInstanceId: string,
	modelId: string,
): ModelProfile {
	const existing = profilesStore.read(profileId)
	if (!existing) {
		throw new Error(`updateModelProfileFromConfig: profile '${profileId}' does not exist`)
	}
	profilesStore.upsert({
		...existing,
		providerInstanceId,
		modelId,
	})
	const updated = profilesStore.read(profileId)
	if (!updated) {
		throw new Error(`updateModelProfileFromConfig: profile '${profileId}' disappeared after update`)
	}
	return updated
}

/**
 * Helper: delete a profile, gated by `canDeleteProfile`.
 * Returns a structured result so the RPC layer can map reasons.
 */
export function deleteModelProfile(
	profilesStore: ProfilesStore,
	defaultProfileId: string | undefined,
	historyItem: HistoryItem | undefined,
	profileId: string,
): { deleted: boolean; reason?: string } {
	const gate = canDeleteProfile(profilesStore, defaultProfileId, historyItem, profileId)
	if (!gate.canDelete) {
		return { deleted: false, reason: gate.reason }
	}
	profilesStore.delete(profileId)
	Logger.log(`[model-profiles-owner] Deleted profile ${profileId}`)
	return { deleted: true }
}

/**
 * Helper: save a new profile from the current task config.
 */
export function saveCurrentAsProfile(
	profilesStore: ProfilesStore,
	name: string,
	providerInstanceId: string,
	modelId: string,
): ModelProfile {
	const trimmed = name.trim()
	if (!trimmed) {
		throw new Error("saveCurrentAsProfile: name must be a non-empty string")
	}
	if (!providerInstanceId || !modelId) {
		throw new Error("saveCurrentAsProfile: providerInstanceId and modelId are required")
	}
	const profile: ModelProfile = {
		profileId: generateProfileId(trimmed),
		name: trimmed,
		providerInstanceId,
		modelId,
	}
	profilesStore.upsert(profile)
	return profile
}

/**
 * Stable opaque id generator. Uses a content-derived slug + a small
 * random suffix so two profiles with the same name do not collide.
 */
function generateProfileId(name: string): string {
	const slug =
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 32) || "profile"
	const suffix = Math.random().toString(36).slice(2, 8)
	return `${slug}-${suffix}`
}

/**
 * Convenience: factory that wires a `ProfilesStore` against the
 * canonical data directory used by the production owner.
 *
 * The canonical profiles.json lives at `<dataDir>/profiles.json`,
 * the same directory that `instances.json` lives in (under
 * `~/.cline/data`).
 */
export function createDefaultProfilesStore(dataDir: string): ProfilesStore {
	fs.mkdirSync(dataDir, { recursive: true })
	return new ProfilesStore({ filePath: path.join(dataDir, "profiles.json") })
}

// ---------------------------------------------------------------------------
// Production owner factory (used by SdkController)
// ---------------------------------------------------------------------------

/**
 * Inputs for the production owner factory. Mirrors the dependencies
 * the SdkController already has; the factory wraps them in a single
 * `ModelProfilesOwnerDeps` object that gRPC handlers consume.
 */
export interface ProductionOwnerDeps {
	stateManager: {
		getInstanceSecret(name: InstanceSecretName): string | undefined
		getGlobalStateKey(key: typeof DEFAULT_MODEL_PROFILE_ID_KEY): string | undefined
		setGlobalState(key: typeof DEFAULT_MODEL_PROFILE_ID_KEY, value: string | undefined): void
	}
	sessions: SdkSessionLifecycle
	providerChange: SdkProviderChangeCoordinator
	sessionConfigBuilder: SdkSessionConfigBuilder
	sessionRebuilds: SdkSessionRebuildScheduler
	taskHistory: {
		listHistory(options?: { limit?: number; hydrate?: boolean }): Promise<Array<{ sessionId?: string }>>
	}
	task: () => { taskId?: string } | undefined
	getWorkspaceRoot: () => Promise<string>
	getMode?: () => "plan" | "act"
	getCurrentTaskProviderInstanceId?: () => string | undefined
	postStateToWebview: () => Promise<void>
	profilesStore?: ProfilesStore
	instancesStore?: InstancesStore
}

/**
 * Production owner factory. Wires the gRPC handlers' dependencies
 * into a single `ModelProfilesOwnerDeps` object.
 */
export function createProductionModelProfilesOwner(deps: ProductionOwnerDeps): ModelProfilesOwnerDeps {
	const profilesStore = deps.profilesStore ?? createDefaultProfilesStore(getDefaultDataDir())
	const instancesStore = deps.instancesStore ?? new EmptyInstancesStore()

	let cachedItem: HistoryItem | undefined
	let cachedItemTaskId: string | undefined

	const getCurrentTaskHistoryItemSync = (): HistoryItem | undefined => {
		const task = deps.task()
		if (!task?.taskId) return undefined
		if (cachedItemTaskId === task.taskId) return cachedItem
		void (async () => {
			const all = await deps.taskHistory.listHistory({ hydrate: false })
			const rec = all.find((r) => r.sessionId === task.taskId) as { sessionId?: string } | undefined
			if (rec?.sessionId) {
				cachedItem = { id: rec.sessionId } as HistoryItem
			}
			cachedItemTaskId = task.taskId
		})()
		return cachedItem
	}

	return {
		profilesStore,
		instancesStore,
		providerChange: deps.providerChange,
		sessions: deps.sessions,
		sessionConfigBuilder: deps.sessionConfigBuilder,
		sessionRebuilds: deps.sessionRebuilds,
		getInstanceSecret: (name) => deps.stateManager.getInstanceSecret(name),
		getWorkspaceRoot: deps.getWorkspaceRoot,
		getMode: deps.getMode,
		getCurrentTaskProviderInstanceId: deps.getCurrentTaskProviderInstanceId,
		getCurrentTaskHistoryItem: getCurrentTaskHistoryItemSync,
		writeTaskHistoryItem: async (item: HistoryItem) => {
			cachedItem = item
			cachedItemTaskId = item.id
		},
		postStateToWebview: deps.postStateToWebview,
		// ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION01
		// (C4 FACTORY_RESUME_EFFECTIVE_CONNECTION): expose the
		// default-profile-id read through StateManager and the
		// helper-layer-backed typed-instance resolver so
		// `SdkTaskStartCoordinator.initTask` and
		// `reinitExistingTaskFromId` can thread the resolved
		// `ProviderConfigurationInstance` through the typed
		// projector.
		getDefaultProfileId: () => deps.stateManager.getGlobalStateKey(DEFAULT_MODEL_PROFILE_ID_KEY),
		resolveActiveInstanceTyped: ({ historyItem, isResume, defaultProfileId }) =>
			resolveActiveInstanceTypedDiscriminated(profilesStore, instancesStore, defaultProfileId, historyItem, isResume),
	}
}

/**
 * Empty InstancesStore stub. The typed apply path does NOT need a
 * populated InstancesStore because the caller supplies the typed
 * `ProviderConfigurationInstance` directly; only the projection
 * layer (webview summary) needs to look up the providerId for
 * each profile's `providerInstanceId`, which is best-effort.
 *
 * The stub is constructed against a temp file that is immediately
 * removed; this satisfies the `InstancesStore`'s file-path
 * requirement without persisting anything.
 */
class EmptyInstancesStore extends InstancesStore {
	constructor() {
		const tmpPath = path.join(os.tmpdir(), `empty-instances-${process.pid}-${Date.now()}.json`)
		super({ filePath: tmpPath })
		try {
			fs.unlinkSync(tmpPath)
		} catch {
			// best-effort cleanup; the file was just created in the
			// constructor, but if deletion fails it is in the temp
			// directory and will be cleaned by the OS eventually.
		}
	}
}

/**
 * Compute the canonical data directory the production owner uses
 * for `profiles.json`. Mirrors the location used by the Foundation
 * `InstancesStore`.
 *
 * Resolution order:
 *   1. `CLINE_DATA_DIR` env var (testing / dogfood)
 *   2. `~/.cline/data/` (default)
 */
function getDefaultDataDir(): string {
	const fromEnv = process.env["CLINE_DATA_DIR"]
	if (typeof fromEnv === "string" && fromEnv.length > 0) {
		return fromEnv
	}
	const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "/tmp"
	return path.join(home, ".cline", "data")
}



