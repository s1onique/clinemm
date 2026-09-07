/**
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01
 *
 * Chat parent integration: thin container that wires
 * `ModelProfileQuickSwitch` to the generated `StateService`
 * gRPC client. The container is the SINGLE place that turns the
 * presentational `ModelProfileQuickSwitch` into a production
 * reachable affordance.
 *
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION02
 * (C5 EXISTING_MODEL_LABEL_TRIGGER):
 *
 * The container now exposes `useModelProfileQuickSwitchHost()`
 * so that `ChatTextArea` can bind the existing
 * `<ModelDisplayButton>` as the trigger (the previous
 * implementation rendered a SIBLING trigger, which left the
 * existing model button functioning as a Settings-routing
 * shortcut — the wrong seam for a profile picker).
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

import { ApplyModelProfileRequest } from "@shared/proto/cline/state"
import { useCallback, useMemo, useRef } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import type { ModelProfileSummary } from "@/services/model-profile-types"
import { type ModelProfileQuickSwitchState, useModelProfileQuickSwitch } from "./ModelProfileQuickSwitch"

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

/**
 * Hook consumed by `ChatTextArea` (and other surfaces that want
 * to bind the popover to an EXISTING trigger element).
 * Returns the spreadable `triggerProps` + the popover node,
 * plus the current label.
 *
 * ACT-CLINEMM-DOGFOOD-VSIX-TYPECHECK-UNBLOCK02:
 * `triggerRef` is an optional correctly-typed ref for the caller's
 * trigger element. The hook reads `.current` as `HTMLElement | null`
 * internally for outside-click + focus-restoration; the caller
 * keeps element-type ownership. When omitted, the hook uses a
 * fallback ref (suitable for tests that don't exercise focus or
 * outside-click semantics).
 */
export function useModelProfileQuickSwitchHost(
	currentLabel: string,
	disabled?: boolean,
	onOpenManageProfiles?: () => void,
	triggerRef?: React.RefObject<HTMLElement | null>,
): {
	label: string
	state: ModelProfileQuickSwitchState
} {
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
		if (onOpenManageProfiles) {
			onOpenManageProfiles()
			return
		}
		try {
			console.warn("[ModelProfileQuickSwitchContainer] onOpenManageProfiles not wired")
		} catch (error) {
			console.error("[ModelProfileQuickSwitchContainer] openManageProfiles failed:", error)
		}
	}, [onOpenManageProfiles])

	const state = useModelProfileQuickSwitch(
		{
			profiles,
			currentLabel: label,
			disabled,
			onSelectProfile: handleSelectProfile,
			onOpenManageProfiles: handleOpenManageProfiles,
		},
		{ triggerRef },
	)

	return { label, state }
}

/**
 * Self-contained container rendering its own trigger. Retained
 * for back-compat surfaces that don't have an existing trigger
 * element (e.g. Settings preview). ChatTextArea now uses
 * `useModelProfileQuickSwitchHost` instead.
 *
 * ACT-CLINEMM-DOGFOOD-VSIX-TYPECHECK-UNBLOCK02: the container
 * now owns an HTMLButtonElement ref and forwards it to the hook,
 * so outside-click detection + focus restoration work end-to-end.
 */
export function ModelProfileQuickSwitchContainer(props: ModelProfileQuickSwitchContainerProps) {
	const { disabled, currentLabel, onOpenManageProfiles } = props
	const triggerButtonRef = useRef<HTMLButtonElement | null>(null)
	const { label, state } = useModelProfileQuickSwitchHost(currentLabel, disabled, onOpenManageProfiles, triggerButtonRef)
	return (
		<div className="relative inline-block">
			<button {...state.triggerProps} ref={triggerButtonRef}>
				{label}
			</button>
			{state.popover}
		</div>
	)
}

export default ModelProfileQuickSwitchContainer
