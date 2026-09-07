/**
 * ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / Phase C
 *
 * applyModelProfile: the product-level operation that turns a
 * profile id into "current task is now on this connection".
 *
 * Composition (per recon §8):
 *
 *   profileId
 *     ↓ resolve profile (ProfilesStore)
 *   ModelProfile
 *     ↓ resolve instance (InstancesStore)
 *   ProviderConfigurationInstance
 *     ↓ resolve credential (StateManager.getInstanceSecret)
 *   resolvedApiKey
 *     ↓ verify session idle (no isRunning)
 *   apply/reconstruct runtime (Strategy B or fast path)
 *     ↓ confirm success
 *   persist session activeProfileId (HistoryItem)
 *     ↓ publish extension/webview state
 *
 * Mandatory ordering:
 *   1. resolve profile
 *   2. resolve instance
 *   3. resolve credential
 *   4. verify session idle
 *   5. apply/reconstruct runtime
 *   6. confirm success
 *   7. persist session activeProfileId
 *   8. publish extension/webview state
 *
 * Failure contract:
 *   apply fails  →  activeProfileId remains previous value
 *                   active runtime remains previous value
 *                   explicit error surfaced
 *
 * The application coordinator NEVER:
 *   - writes the activeProfileId BEFORE the runtime apply succeeds
 *     (would create HALT_PROFILE_RUNTIME_BINDING_SPLIT_BRAIN)
 *   - mutates the global default (would violate §4.2)
 *   - skips the idle check (would violate §10)
 *   - rewrites the profile definition (only the runtime + binding move)
 */

import type { HistoryItem } from "@shared/HistoryItem"
import { Logger } from "@/shared/services/Logger"
import type { ProviderConfigurationInstance } from "../instance-store/contracts"
import type { SdkProviderChangeCoordinator } from "../sdk-provider-change-coordinator"
import type { SdkSessionConfigBuilder } from "../sdk-session-config-builder"
import type { SdkSessionLifecycle } from "../sdk-session-lifecycle"
import type { SdkSessionRebuildScheduler } from "../sdk-session-rebuild-scheduler"
import type { ModelProfile } from "./contracts"
import type { ProfilesStore } from "./profiles-store"
import { isKnownProfileId, writeActiveProfileIdToHistoryItem } from "./session-binding"

export type ApplyModelProfileResult =
	| { applied: true; profileId: string; sessionId: string; usedFastPath: boolean }
	| { applied: false; reason: ApplyModelProfileFailureReason; message?: string }

export type ApplyModelProfileFailureReason =
	| "unknown_profile"
	| "unknown_instance"
	| "missing_credential"
	| "no_active_session"
	| "session_running"
	| "reconstruction_failed"

export interface ApplyModelProfileOptions {
	profilesStore: ProfilesStore
	/**
	 * Read the current ProviderConfigurationInstance for a given
	 * providerInstanceId. Provided by the SdkController (which owns
	 * the InstancesStore); kept as an injected reader so this module
	 * does not import InstancesStore directly (avoids a circular
	 * dependency with the Foundation layer).
	 */
	readInstance: (instanceId: string) => ProviderConfigurationInstance | undefined
	/**
	 * Read the resolved physical secret for an
	 * `instance.credentialRef.name`. The caller wraps
	 * StateManager.getInstanceSecret.
	 */
	getInstanceSecret: (name: ProviderConfigurationInstance["credentialRef"]["name"]) => string | undefined
	/**
	 * Session lifecycle (idle check + reconstruction seam).
	 */
	sessions: SdkSessionLifecycle
	/**
	 * Session config builder (typed projector lives inside it).
	 */
	sessionConfigBuilder: SdkSessionConfigBuilder
	/**
	 * Provider change coordinator (owns Strategy B reconstruction).
	 * We use it as the orchestration entry point because it already
	 * carries the idle check, the rebuild scheduler, and the
	 * post-state hook.
	 *
	 * The product path calls `applyTypedProviderConfigurationInstance`
	 * (NOT `applyProviderConfigurationInstance`) — the typed seam is
	 * the Foundation's full-V1-connection entry point and is the
	 * sole authority for resolving `credentialRef.name` →
	 * physical-secret. The legacy `applyProviderConfigurationInstance`
	 * is kept as a fallback only.
	 */
	providerChange: Pick<SdkProviderChangeCoordinator, "applyTypedProviderConfigurationInstance"> & {
		applyProviderConfigurationInstance?: SdkProviderChangeCoordinator["applyProviderConfigurationInstance"]
	}
	/**
	 * Rebuild scheduler (used to enqueue a fast-lane update).
	 */
	rebuilds: Pick<SdkSessionRebuildScheduler, "request">
	/**
	 * Workspace root (cwd).
	 */
	getWorkspaceRoot: () => Promise<string>
	/**
	 * Optional mode resolver. Default "act" preserves the legacy
	 * single-mode semantics; callers can pass `mode` to use
	 * plan/act-specific binding.
	 */
	getMode?: () => "plan" | "act"
	/**
	 * Optional current task history item writer. The coordinator
	 * calls this AFTER runtime success to persist activeProfileId.
	 */
	writeTaskHistoryItem?: (item: HistoryItem) => Promise<void>
	/**
	 * Read the current task's history item (needed for the
	 * write-back). Caller is responsible for supplying the in-memory
	 * item (or fetching it from the taskHistory adapter).
	 */
	getCurrentTaskHistoryItem?: () => HistoryItem | undefined
	/**
	 * Read the providerInstanceId currently driving the active
	 * session. The caller derives this from the task's bound
	 * profile (via ProfilesStore.read(activeProfileId) →
	 * providerInstanceId) so we can decide between same-instance
	 * fast path and full Strategy B reconstruction.
	 */
	getCurrentTaskProviderInstanceId?: () => string | undefined
	/**
	 * Post state to webview (called after persistence).
	 */
	postStateToWebview?: () => Promise<void>
}

export class ApplyModelProfileError extends Error {
	override readonly name = "ApplyModelProfileError"
	readonly reason: ApplyModelProfileFailureReason
	constructor(reason: ApplyModelProfileFailureReason, message?: string) {
		super(message ?? `applyModelProfile failed: ${reason}`)
		this.reason = reason
	}
}

/**
 * The product-level operation.
 *
 * Per recon §8 ordering:
 *   1. Resolve profile
 *   2. Resolve instance
 *   3. Resolve credential
 *   4. Verify session idle
 *   5. Apply/reconstruct runtime (Strategy B or fast path)
 *   6. Confirm success
 *   7. Persist session activeProfileId
 *   8. Publish extension/webview state
 *
 * Failure contract: if any step 1-6 fails, the activeProfileId
 * remains the previous value, the runtime stays on the previous
 * connection, and an explicit failure reason is returned.
 */
export async function applyModelProfile(profileId: string, options: ApplyModelProfileOptions): Promise<ApplyModelProfileResult> {
	// -------------------------------------------------------------------------
	// 1. Resolve profile
	// -------------------------------------------------------------------------
	const profiles = options.profilesStore.list()
	if (!isKnownProfileId(profileId, profiles as Record<string, { profileId: string }>)) {
		return {
			applied: false,
			reason: "unknown_profile",
			message: `Profile '${profileId}' does not exist`,
		}
	}
	const profile: ModelProfile = options.profilesStore.read(profileId)!

	// -------------------------------------------------------------------------
	// 2. Resolve instance
	// -------------------------------------------------------------------------
	const instance = options.readInstance(profile.providerInstanceId)
	if (!instance) {
		return {
			applied: false,
			reason: "unknown_instance",
			message: `Profile '${profileId}' references missing instance '${profile.providerInstanceId}'`,
		}
	}

	// -------------------------------------------------------------------------
	// 3. Resolve credential
	// -------------------------------------------------------------------------
	const resolvedApiKey = options.getInstanceSecret(instance.credentialRef.name)
	if (resolvedApiKey === undefined || resolvedApiKey === "") {
		return {
			applied: false,
			reason: "missing_credential",
			message: `Instance '${instance.instanceId}' has no physical secret under '${instance.credentialRef.name}'`,
		}
	}

	// -------------------------------------------------------------------------
	// 4. Verify session idle (fast bail before reconstruction)
	// -------------------------------------------------------------------------
	const activeSession = options.sessions.getActiveSession()
	if (!activeSession) {
		return {
			applied: false,
			reason: "no_active_session",
			message: "applyModelProfile requires an active session; the next task will use the new profile via default",
		}
	}
	if (activeSession.isRunning) {
		return {
			applied: false,
			reason: "session_running",
			message: "Cannot switch profiles while a request is in flight; wait for the current request to finish",
		}
	}

	// -------------------------------------------------------------------------
	// 5. Apply/reconstruct runtime
	// -------------------------------------------------------------------------
	// Detect same-instance fast path using the session's startConfig
	// (which carries providerId/modelId from the CoreSessionConfig).
	// For full providerInstanceId comparison we depend on the caller
	// supplying it via getCurrentTaskProviderInstanceId().
	const currentProviderInstanceId = options.getCurrentTaskProviderInstanceId?.()
	const currentModelId = activeSession.startConfig?.modelId
	const sameInstance = currentProviderInstanceId !== undefined && currentProviderInstanceId === profile.providerInstanceId
	const sameModel = currentModelId !== undefined && currentModelId === profile.modelId

	if (sameInstance && sameModel) {
		// Same profile applied; no-op for the runtime, but we still
		// reaffirm the activeProfileId binding because the caller
		// has asked for this profile.
		await persistActiveBindingAndPublish(options, profile.profileId)
		return {
			applied: true,
			profileId: profile.profileId,
			sessionId: activeSession.sessionId,
			usedFastPath: true,
		}
	}

	if (sameInstance && !sameModel) {
		// Same instance, different model: use the Foundation's
		// model-only fast path. This is the conservation requirement
		// from §9: same providerInstanceId + model-only change goes
		// through updateActiveSessionModel, NOT full reconstruction.
		try {
			await options.sessions.updateActiveSessionModel(profile.modelId)
			await persistActiveBindingAndPublish(options, profile.profileId)
			Logger.log(`[applyModelProfile] Fast-path model update: ${profile.profileId} (modelId=${profile.modelId})`)
			return {
				applied: true,
				profileId: profile.profileId,
				sessionId: activeSession.sessionId,
				usedFastPath: true,
			}
		} catch (error) {
			Logger.error("[applyModelProfile] Fast-path model update failed:", error)
			return {
				applied: false,
				reason: "reconstruction_failed",
				message: error instanceof Error ? error.message : String(error),
			}
		}
	}

	// Different instance (or unknown): full Strategy B reconstruction
	// via the Foundation's typed-instance apply seam.
	//
	// PIIF01 composition (this pass):
	//   - The TYPED `ProviderConfigurationInstance` is the load-bearing
	//     carrier. It is passed directly to the Foundation's builder via
	//     `providerConfigurationInstanceTyped`, where the typed projector
	//     materializes the full V1 connection tuple (providerId, modelId,
	//     apiKey=resolved-physical-secret, baseUrl, headers, region,
	//     apiLine, providerSpecificConfig) onto `CoreSessionConfig`.
	//   - The Foundation's typed path is the SOLE authority that resolves
	//     `instance.credentialRef.name` to the physical secret. We do
	//     NOT fabricate a legacy `ApiConfiguration` with
	//     `apiKey: "REDACTED_BY_TYPED_PROJECTOR"` and route through
	//     `applyProviderConfigurationInstance` — that path throws the
	//     resolved physical secret away.
	//   - `resolvedApiKey` (from step 3) is forwarded so the Foundation
	//     seam can use it as a precondition guard; the actual credential
	//     write happens inside the typed projector.
	//
	// Failure contract: if the typed apply throws or returns a refusal,
	// the activeProfileId remains the previous value, the active session
	// stays on A, and an explicit reason is returned.
	try {
		const result = await options.providerChange.applyTypedProviderConfigurationInstance(instance, resolvedApiKey)
		if (!result.applied) {
			return {
				applied: false,
				reason:
					result.reason === "no_active_session"
						? "no_active_session"
						: result.reason === "session_running"
							? "session_running"
							: "reconstruction_failed",
				message: `Foundation typed apply refused: ${result.reason}`,
			}
		}
		// 7. Persist session activeProfileId (only AFTER runtime success)
		await persistActiveBindingAndPublish(options, profile.profileId)
		Logger.log(
			`[applyModelProfile] Strategy B typed reconstruction: ${profile.profileId} (instance=${profile.providerInstanceId}, session=${activeSession.sessionId} -> ${result.newSessionId})`,
		)
		return {
			applied: true,
			profileId: profile.profileId,
			sessionId: result.newSessionId,
			usedFastPath: false,
		}
	} catch (error) {
		Logger.error("[applyModelProfile] Typed reconstruction failed:", error)
		return {
			applied: false,
			reason: "reconstruction_failed",
			message: error instanceof Error ? error.message : String(error),
		}
	}
}

/**
 * Step 7 + 8: persist session activeProfileId, then publish state.
 *
 * Per the failure contract: this function MUST be called only after
 * step 6 (runtime apply) succeeds. Calling it before runtime success
 * would create HALT_PROFILE_RUNTIME_BINDING_SPLIT_BRAIN.
 */
async function persistActiveBindingAndPublish(options: ApplyModelProfileOptions, profileId: string): Promise<void> {
	if (options.writeTaskHistoryItem && options.getCurrentTaskHistoryItem) {
		const current = options.getCurrentTaskHistoryItem()
		if (current) {
			const updated = writeActiveProfileIdToHistoryItem(current, profileId)
			await options.writeTaskHistoryItem(updated)
		}
	}
	if (options.postStateToWebview) {
		await options.postStateToWebview()
	}
}
