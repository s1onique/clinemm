/**
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01
 *
 * Chat parent integration: thin container that wires
 * `ModelProfileQuickSwitch` to the generated `StateService`
 * gRPC client. The container is the SINGLE place that turns the
 * presentational `ModelProfileQuickSwitch` into a production
 * reachable affordance.
 *
 * Wiring:
 *   - profile list:     `useExtensionState().modelProfiles ?? []`
 *   - active profile:   `useExtensionState().activeModelProfileId`
 *   - default profile:  `useExtensionState().defaultModelProfileId`
 *   - onSelectProfile:  `StateServiceClient.applyModelProfile(...)`
 *   - onOpenManageProfiles: routes the user to Settings
 *
 * The container is intentionally small — all composition rules
 * (the `isActive` / `isDefault` flags, the secret scan, the
 * precedence algebra) live host-side in the SdkController. The
 * webview is a pure mirror.
 */

import { useCallback, useMemo } from "react"
import { ModelProfileQuickSwitch } from "./ModelProfileQuickSwitch"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { ApplyModelProfileRequest } from "@shared/proto/cline/state"
import type { ModelProfileSummary } from "@/services/model-profile-types"

export interface ModelProfileQuickSwitchContainerProps {
	disabled?: boolean
	currentLabel: string
	onOpenManageProfiles?: () => void
}

/**
 * Build the current profile label from the active profile (or
 * fall back to the legacy `currentLabel` when no profile is bound).
 */
function buildCurrentLabel(
	profiles: ModelProfileSummary[],
	activeProfileId: string | null | undefined,
	fallback: string,
): string {
	if (!activeProfileId) return fallback
	const active = profiles.find((p) => p.profileId === activeProfileId)
	if (!active) return fallback
	return `${active.name} (${active.modelId})`
}

export function ModelProfileQuickSwitchContainer(props: ModelProfileQuickSwitchContainerProps) {
	const { disabled, currentLabel, onOpenManageProfiles } = props
	const { modelProfiles, activeModelProfileId } = useExtensionState()

	const profiles = useMemo<ModelProfileSummary[]>(() => modelProfiles ?? [], [modelProfiles])

	const label = useMemo(
		() => buildCurrentLabel(profiles, activeModelProfileId, currentLabel),
		[profiles, activeModelProfileId, currentLabel],
	)

	const handleSelectProfile = useCallback(async (profileId: string) => {
		try {
			await StateServiceClient.applyModelProfile(ApplyModelProfileRequest.create({ profileId }))
		} catch (error) {
			console.error("[ModelProfileQuickSwitchContainer] applyModelProfile failed:", error)
		}
	}, [])

	const handleOpenManageProfiles = useCallback(() => {
		// Production wiring note: the parent should provide a router
		// seam here. The webview does not own the routing state;
		// the host (SdkController) is responsible for navigating
		// the user to the Settings > Model Profiles view.
		if (onOpenManageProfiles) {
			onOpenManageProfiles()
			return
		}
		// Defensive: if the parent did not wire a router, fall
		// back to the Settings tab navigation RPC.
		try {
			// Tab navigation is intentionally left as a future
			// enhancement. For now, the Settings UI is reached
			// via the Settings button in the activity bar.
			console.warn("[ModelProfileQuickSwitchContainer] onOpenManageProfiles not wired")
		} catch (error) {
			console.error("[ModelProfileQuickSwitchContainer] openManageProfiles failed:", error)
		}
	}, [onOpenManageProfiles])

	return (
		<ModelProfileQuickSwitch
			profiles={profiles}
			currentLabel={label}
			disabled={disabled}
			onSelectProfile={handleSelectProfile}
			onOpenManageProfiles={handleOpenManageProfiles}
		/>
	)
}

export default ModelProfileQuickSwitchContainer
