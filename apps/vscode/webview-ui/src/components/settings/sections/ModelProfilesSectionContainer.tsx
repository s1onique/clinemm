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
 *   - onSaveCurrentAsProfile:   StateServiceClient.saveCurrentAsModelProfile
 *   - onUse:                    StateServiceClient.applyModelProfile
 *   - onSetAsDefault:           StateServiceClient.setDefaultModelProfile
 *   - onClearDefault:           StateServiceClient.clearDefaultModelProfile
 *   - onRename:                 StateServiceClient.renameModelProfile
 *   - onUpdateFromCurrent:      StateServiceClient.updateModelProfileFromCurrent
 *   - onDelete:                 StateServiceClient.deleteModelProfile
 */

import { EmptyRequest } from "@shared/proto/cline/common"
import {
	ApplyModelProfileRequest,
	DeleteModelProfileRequest,
	RenameModelProfileRequest,
	SaveCurrentAsModelProfileRequest,
	SetDefaultModelProfileRequest,
	UpdateModelProfileFromCurrentRequest,
} from "@shared/proto/cline/state"
import { type ReactNode, useCallback, useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import type { ModelProfileSummary } from "@/services/model-profile-types"
import { ModelProfilesSection } from "./ModelProfilesSection"

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
	const { modelProfiles, activeModelProfileId, defaultModelProfileId } = useExtensionState()

	const profiles = useMemo<ModelProfileSummary[]>(() => modelProfiles ?? [], [modelProfiles])

	const handleSaveCurrentAsProfile = useCallback(async (name: string) => {
		try {
			await StateServiceClient.saveCurrentAsModelProfile(SaveCurrentAsModelProfileRequest.create({ name }))
		} catch (error) {
			console.error("[ModelProfilesSectionContainer] saveCurrentAsModelProfile failed:", error)
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
			canApplyLive={canApplyLive}
			canCreateFromCurrent={canCreateFromCurrent}
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
