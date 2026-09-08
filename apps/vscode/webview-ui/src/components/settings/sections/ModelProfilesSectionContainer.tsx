/**
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01
 *
 * Settings parent integration: thin container that wires
 * `ModelProfilesSection` to the generated `StateService` gRPC
 * client. The container is the SINGLE place that turns the
 * presentational `ModelProfilesSection` into a production
 * reachable affordance.
 *
 * Wiring:
 *   - profile list:    `useExtensionState().modelProfiles ?? []`
 *   - default profile: `useExtensionState().defaultModelProfileId`
 *   - active profile:  `useExtensionState().activeModelProfileId`
 *   - canCreateFromCurrent: a session is active + no error
 *   - canApplyLive:     no session is currently running
 *   - onSaveCurrentAsProfile:
 *       ACT-CLINEMM-MODEL-PROFILES-SECOND-PROFILE-CREATION-CORRECTION01:
 *       StateServiceClient.bootstrapModelProfileFromCurrentConfiguration
 *       (canonical creation seam -- "Save current configuration as
 *       profile" must materialize a NEW independent
 *       ProviderConfigurationInstance + physical credential + profile,
 *       NOT a fail-closed saveCurrentAs that requires an already-bound
 *       providerInstanceId). The bootstrap RPC returns a typed envelope
 *       which feeds the existing status-aware severity banner; the
 *       previous console.error-only swallow was the
 *       HALT_MODEL_PROFILE_SECOND_INSTANCE_CREATION_ABSENT P0.
 *   - onUse:                    StateServiceClient.applyModelProfile
 *   - onSetAsDefault:           StateServiceClient.setDefaultModelProfile
 *   - onClearDefault:           StateServiceClient.clearDefaultModelProfile
 *   - onRename:                 StateServiceClient.renameModelProfile
 *   - onUpdateFromCurrent:      StateServiceClient.updateModelProfileFromCurrent
 *   - onDelete:                 StateServiceClient.deleteModelProfile
 *   - onBootstrapFromCurrent:
 *       ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / CORRECTION04:
 *       StateServiceClient.bootstrapModelProfileFromCurrentConfiguration
 *       (the FIRST-RUN CTA "Create first profile" routes through the
 *       SAME canonical creation seam; the bootstrap RPC is not
 *       first-run-only -- it is the single authority for "create a
 *       profile from the current API configuration", regardless of
 *       whether the user has 0, 1, or 17 profiles already).
 */

import { EmptyRequest } from "@shared/proto/cline/common"
import {
	ApplyModelProfileRequest,
	BootstrapModelProfileRequest,
	DeleteModelProfileRequest,
	RenameModelProfileRequest,
	SetDefaultModelProfileRequest,
	UpdateModelProfileFromCurrentRequest,
} from "@shared/proto/cline/state"
import { type ReactNode, useCallback, useMemo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import type { ModelProfileSummary } from "@/services/model-profile-types"
import {
	type BootstrapModelProfileResultLike,
	type CurrentConfigurationSummary,
	ModelProfilesSection,
} from "./ModelProfilesSection"

export interface ModelProfilesSectionContainerProps {
	canApplyLive?: boolean
	canCreateFromCurrent?: boolean
	/**
	 * ACT-CLINEMM-DOGFOOD-VSIX-TYPECHECK-UNBLOCK02:
	 * SettingsView passes its standard `renderSectionHeader(tabId)`
	 * callback down so this section renders the canonical
	 * `<SectionHeader>` the same way the neighboring sections
	 * (`SandboxCapabilitiesSection`, `TemporaryExternalPathsSection`)
	 * do. Without it, the container's prop list was missing the
	 * field that the parent already supplies.
	 */
	renderSectionHeader?: (tabId: string) => ReactNode
}

export function ModelProfilesSectionContainer(props: ModelProfilesSectionContainerProps) {
	const { canApplyLive = true, canCreateFromCurrent = true, renderSectionHeader } = props
	const { modelProfiles, activeModelProfileId, defaultModelProfileId, apiConfiguration } = useExtensionState()

	const profiles = useMemo<ModelProfileSummary[]>(() => modelProfiles ?? [], [modelProfiles])

	// ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / B4: surface the
	// current active provider/model in the first-run onboarding pane so the
	// user sees exactly what they are about to persist as a profile. We
	// read the same fields the host's bootstrap primitive will read.
	const currentConfiguration = useMemo<CurrentConfigurationSummary | null>(() => {
		const providerId =
			(apiConfiguration as { planModeApiProvider?: string; actModeApiProvider?: string } | undefined)?.actModeApiProvider ??
			""
		const modelId =
			(apiConfiguration as { planModeApiModelId?: string; actModeApiModelId?: string } | undefined)?.actModeApiModelId ?? ""
		if (!providerId || !modelId) return null
		return { providerId, modelId }
	}, [apiConfiguration])

	// ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / CORRECTION04:
	// typed envelope state for the bootstrap RPC. The section renders a
	// status-aware severity banner when this is non-null; the previous
	// console.error-only swallow left bootstrap failures invisible.
	//
	// ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / B4: the typed
	// envelope is now passed verbatim (no `as` cast). The section's
	// parseBootstrapStatus decoder is the single authority that maps
	// raw response.status -> a known status string; unknown values
	// fall through to "UNKNOWN" which renders as a defensive error
	// banner instead of silently disappearing.
	const [bootstrapResult, setBootstrapResult] = useState<BootstrapModelProfileResultLike | null>(null)

	const handleBootstrapFromCurrent = useCallback(async () => {
		try {
			const response = await StateServiceClient.bootstrapModelProfileFromCurrentConfiguration(
				BootstrapModelProfileRequest.create({ name: "Default" }),
			)
			setBootstrapResult({
				status: response.status,
				profileId: response.profileId || undefined,
				instanceId: response.instanceId || undefined,
				message: response.message || undefined,
			})
		} catch (error) {
			console.error("[ModelProfilesSectionContainer] bootstrapModelProfileFromCurrentConfiguration failed:", error)
			setBootstrapResult({
				status: "PROFILE_WRITE_FAILED",
				message: error instanceof Error ? error.message : String(error),
			})
		}
	}, [])

	// ACT-CLINEMM-MODEL-PROFILES-SECOND-PROFILE-CREATION-CORRECTION01:
	// "Save current configuration as profile" routes through the SAME
	// canonical creation seam as the first-run CTA. The previous
	// implementation called `saveCurrentAsModelProfile`, which is the
	// narrow fail-closed primitive that REQUIRES an already-bound
	// providerInstanceId. After the first profile exists, the current
	// task is normally NOT bound to any profile (the binding is task-
	// scoped and ephemeral), so the old path threw "cannot derive an
	// authoritative providerInstanceId" into console.error with NO
	// visible banner -- the
	// HALT_MODEL_PROFILE_SECOND_INSTANCE_CREATION_ABSENT defect.
	//
	// The bootstrap RPC is the correct semantic for "create a profile
	// from the current API configuration": it reads the CURRENT
	// ApiConfiguration (not any pre-existing instance), generates a
	// FRESH opaque instanceId, durably persists the instance-scoped
	// secret, persists the instance + profile, and returns a typed
	// envelope that the section's status-aware banner renders
	// (success/warning/error -- the
	// HALT_MODEL_PROFILE_POST_CREATE_STATE_NOT_PUBLISHED CORRECTION06
	// plumbing already covers the success path, and the B3-UI
	// plumbing already covers the error path).
	const handleSaveCurrentAsProfile = useCallback(async (name: string) => {
		try {
			const response = await StateServiceClient.bootstrapModelProfileFromCurrentConfiguration(
				BootstrapModelProfileRequest.create({ name }),
			)
			setBootstrapResult({
				status: response.status,
				profileId: response.profileId || undefined,
				instanceId: response.instanceId || undefined,
				message: response.message || undefined,
			})
		} catch (error) {
			console.error("[ModelProfilesSectionContainer] bootstrapModelProfileFromCurrentConfiguration failed:", error)
			setBootstrapResult({
				status: "PROFILE_WRITE_FAILED",
				message: error instanceof Error ? error.message : String(error),
			})
		}
	}, [])

	const handleUse = useCallback(async (profileId: string) => {
		try {
			await StateServiceClient.applyModelProfile(ApplyModelProfileRequest.create({ profileId }))
		} catch (error) {
			console.error("[ModelProfilesSectionContainer] applyModelProfile failed:", error)
		}
	}, [])

	const handleSetAsDefault = useCallback(async (profileId: string) => {
		try {
			await StateServiceClient.setDefaultModelProfile(SetDefaultModelProfileRequest.create({ profileId }))
		} catch (error) {
			console.error("[ModelProfilesSectionContainer] setDefaultModelProfile failed:", error)
		}
	}, [])

	const handleClearDefault = useCallback(async () => {
		try {
			await StateServiceClient.clearDefaultModelProfile(EmptyRequest.create({}))
		} catch (error) {
			console.error("[ModelProfilesSectionContainer] clearDefaultModelProfile failed:", error)
		}
	}, [])

	const handleRename = useCallback(async (profileId: string, newName: string) => {
		try {
			await StateServiceClient.renameModelProfile(RenameModelProfileRequest.create({ profileId, newName }))
		} catch (error) {
			console.error("[ModelProfilesSectionContainer] renameModelProfile failed:", error)
		}
	}, [])

	const handleUpdateFromCurrent = useCallback(async (profileId: string) => {
		try {
			await StateServiceClient.updateModelProfileFromCurrent(UpdateModelProfileFromCurrentRequest.create({ profileId }))
		} catch (error) {
			console.error("[ModelProfilesSectionContainer] updateModelProfileFromCurrent failed:", error)
		}
	}, [])

	const handleDelete = useCallback(async (profileId: string) => {
		try {
			const result = await StateServiceClient.deleteModelProfile(DeleteModelProfileRequest.create({ profileId }))
			if (!result.deleted) {
				console.warn(`[ModelProfilesSectionContainer] delete refused: ${result.reason}`)
			}
		} catch (error) {
			console.error("[ModelProfilesSectionContainer] deleteModelProfile failed:", error)
		}
	}, [])

	// Reference the binding fields so they participate in the
	// reactive projection; the section itself does not consume
	// them directly, but the host recomputes isActive / isDefault
	// every push, so the section's row UI stays in sync.
	void activeModelProfileId
	void defaultModelProfileId

	return (
		<ModelProfilesSection
			bootstrapResult={bootstrapResult}
			canApplyLive={canApplyLive}
			canCreateFromCurrent={canCreateFromCurrent}
			currentConfiguration={currentConfiguration}
			onBootstrapFromCurrent={handleBootstrapFromCurrent}
			onClearDefault={handleClearDefault}
			onDelete={handleDelete}
			onRename={handleRename}
			onSaveCurrentAsProfile={handleSaveCurrentAsProfile}
			onSetAsDefault={handleSetAsDefault}
			onUpdateFromCurrent={handleUpdateFromCurrent}
			onUse={handleUse}
			profiles={profiles}
			renderSectionHeader={renderSectionHeader}
		/>
	)
}

export default ModelProfilesSectionContainer
