/**
 * ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / Phase B
 *
 * Per-task/session active profile binding.
 *
 * Two distinct binding authorities are load-bearing:
 *
 *   4.1 Per-task active profile
 *     - taskId-scoped (not global)
 *     - lives in HistoryItem.metadata.activeProfileId
 *     - resume restores the same profile for the same task
 *     - quick-switch current task A → B does NOT change task C
 *
 *   4.2 Global default profile
 *     - global (not task-scoped)
 *     - lives in StateManager via getGlobalStateKey("defaultModelProfileId")
 *     - only changed by explicit Set/Clear default
 *     - quick-switch does NOT modify it
 *
 * This module is the SINGLE writer/reader of these fields.
 */

import type { HistoryItem } from "@shared/HistoryItem"
import type { GlobalState } from "@shared/storage/state-keys"

// ---------------------------------------------------------------------------
// Default profile (global) — key, default, and typed accessor pair
// ---------------------------------------------------------------------------

/**
 * The canonical global state key for the default ModelProfile id.
 *
 * Recon §4.2 froze: "defaultProfileId = string | undefined". Only
 * the explicit "Set as default" / "Clear default" actions mutate
 * this value. Quick-switch is NOT a mutator.
 */
export const DEFAULT_MODEL_PROFILE_ID_KEY = "defaultModelProfileId" as const

export function readDefaultModelProfileId(globalState: {
	getGlobalStateKey(key: typeof DEFAULT_MODEL_PROFILE_ID_KEY): string | undefined
}): string | undefined {
	const v = globalState.getGlobalStateKey(DEFAULT_MODEL_PROFILE_ID_KEY)
	return typeof v === "string" && v.length > 0 ? v : undefined
}

export function writeDefaultModelProfileId(
	globalState: {
		setGlobalState(key: typeof DEFAULT_MODEL_PROFILE_ID_KEY, value: string | undefined): void
	},
	profileId: string | undefined,
): void {
	if (profileId !== undefined && (typeof profileId !== "string" || profileId.length === 0)) {
		throw new Error("defaultModelProfileId must be a non-empty string or undefined")
	}
	globalState.setGlobalState(DEFAULT_MODEL_PROFILE_ID_KEY, profileId)
}

// ---------------------------------------------------------------------------
// Per-task active profile — written into HistoryItem
// ---------------------------------------------------------------------------

/**
 * Persist the activeProfileId on a HistoryItem.
 *
 * Returns a SHALLOW CLONE so callers cannot accidentally mutate the
 * original by reference. Pass the returned item back to the
 * taskHistory adapter for durable write.
 */
export function writeActiveProfileIdToHistoryItem(
	item: HistoryItem,
	profileId: string | undefined,
): HistoryItem {
	if (profileId !== undefined && (typeof profileId !== "string" || profileId.length === 0)) {
		throw new Error("activeProfileId must be a non-empty string or undefined")
	}
	const next: HistoryItem = { ...item }
	if (profileId === undefined) {
		delete next.activeProfileId
	} else {
		next.activeProfileId = profileId
	}
	return next
}

/**
 * Extract the activeProfileId from a HistoryItem (read-only).
 * Returns undefined when the task was created before Model Profiles V1
 * or when the field was explicitly cleared.
 */
export function readActiveProfileIdFromHistoryItem(
	item: Pick<HistoryItem, "activeProfileId">,
): string | undefined {
	const v = item.activeProfileId
	return typeof v === "string" && v.length > 0 ? v : undefined
}

/**
 * Resolve which profile id should drive a RESUMED task.
 *
 * Precedence (per recon §4.2):
 *   1. valid task activeProfileId (resume restores A's profile)
 *   2. valid defaultProfileId
 *   3. undefined → caller falls back to legacy current-configuration
 *
 * `profiles` is the dictionary of all known profile definitions; used
 * to validate that the activeProfileId still exists (a deleted
 * profile must NOT crash resume, per §9 and §7).
 */
export function resolveActiveProfileIdForResume(
	historyItem: Pick<HistoryItem, "activeProfileId">,
	defaultProfileId: string | undefined,
	profiles: Record<string, { profileId: string }>,
): string | undefined {
	const taskBinding = readActiveProfileIdFromHistoryItem(historyItem)
	if (taskBinding && taskBinding in profiles) {
		return taskBinding
	}
	if (defaultProfileId && defaultProfileId in profiles) {
		return defaultProfileId
	}
	return undefined
}

/**
 * Resolve the active profileId for a NEW task (no resume).
 *
 * Precedence (per recon §4.2):
 *   1. valid defaultProfileId → use default
 *   2. otherwise undefined → legacy behavior
 */
export function resolveActiveProfileIdForNewTask(
	defaultProfileId: string | undefined,
	profiles: Record<string, { profileId: string }>,
): string | undefined {
	if (defaultProfileId && defaultProfileId in profiles) {
		return defaultProfileId
	}
	return undefined
}

/**
 * Validate that a profile id refers to a known profile in the
 * supplied dictionary. Used by the application coordinator before
 * mutating either the active binding or the runtime.
 */
export function isKnownProfileId(
	profileId: string | undefined,
	profiles: Record<string, { profileId: string }>,
): boolean {
	if (typeof profileId !== "string" || profileId.length === 0) return false
	return Object.prototype.hasOwnProperty.call(profiles, profileId)
}

/**
 * The metadata key used inside SessionHistoryRecord.metadata. The
 * SDK session record stores arbitrary string-keyed metadata; this is
 * the canonical key for round-tripping activeProfileId without
 * serializing through the legacy ApiConfiguration slot.
 */
export const ACTIVE_PROFILE_ID_SDK_METADATA_KEY = "activeProfileId"
