/**
 * ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / Phase E
 *
 * Footer quick-switch popover. Triggered by clicking the current
 * model/profile label in ChatTextArea.
 *
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION02
 * (C5 EXISTING_MODEL_LABEL_TRIGGER):
 *
 * Two consumption modes:
 *
 *   1. <ModelProfileQuickSwitch> — self-contained trigger+popover.
 *      Used by Settings/preview surfaces and by the existing
 *      Phase E unit tests. Retained for back-compat.
 *
 *   2. useModelProfileQuickSwitch() — returns { triggerProps,
 *      popover, isOpen } so the parent can bind the existing
 *      current-model LABEL as the trigger without replacing the
 *      label or adding a sibling trigger.
 *
 * Recon §12 froze the UX:
 *
 *   - click current model/profile label -> anchored compact popover
 *   - list configured profiles
 *   - current profile: checkmark + highlighted selection
 *   - footer action: "Manage Profiles..." -> Settings at profiles
 *   - keyboard Up/Down/Enter/Escape
 *   - aria roles correct
 *   - busy: trigger/picker clearly disabled
 *
 * The component is intentionally dumb: it receives a
 * `ModelProfileSummary[]` list and an `onSelectProfile` callback,
 * and emits profileId strings. It does NOT call the gRPC client
 * directly; the parent (ChatTextArea) wires the callback to the
 * RPC and the applyModelProfile coordinator.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import type { ModelProfileSummary } from "@/services/model-profile-types"

export interface ModelProfileQuickSwitchProps {
	profiles: ModelProfileSummary[]
	currentLabel: string
	disabled?: boolean
	onSelectProfile: (profileId: string) => void
	onOpenManageProfiles: () => void
}

export interface ModelProfileTriggerProps {
	/** Spread onto the trigger element (onClick, aria-*, data-testid). */
	"data-testid": string
	"aria-haspopup": "listbox"
	"aria-expanded": boolean
	"aria-label": string
	title: string
	disabled: boolean
	onClick: () => void
}

export interface ModelProfileQuickSwitchState {
	/** Spread onto the trigger element (onClick, aria-*, data-testid). */
	triggerProps: ModelProfileTriggerProps
	/** Render the popover somewhere in the same DOM subtree as the trigger. */
	popover: React.ReactNode
	/** True while the popover is visible (used by tests + debugging). */
	isOpen: boolean
}

/**
 * Hook for binding an external trigger (e.g. the existing current-model
 * label) to the popover state. The trigger element receives the
 * spread `triggerProps`; the parent renders `popover` somewhere in
 * the same DOM subtree (typically a sibling) so the outside-click
 * detector finds it.
 *
 * ACT-CLINEMM-DOGFOOD-VSIX-TYPECHECK-UNBLOCK02:
 * `triggerProps` is intentionally element-agnostic — it carries ONLY
 * behavioral attributes (aria-*, onClick, data-testid). Element-ref
 * ownership is delegated to the caller: pass a correctly-typed
 * `triggerRef` for the concrete trigger element (e.g.
 * `RefObject<HTMLButtonElement | null>` for a `<button>`,
 * `RefObject<HTMLAnchorElement | null>` for an `<a>`). When the
 * caller omits the ref, the hook uses a local fallback ref (tests
 * that don't need outside-click / focus-restoration can omit it).
 */
export function useModelProfileQuickSwitch(
	props: ModelProfileQuickSwitchProps,
	options?: { triggerRef?: React.RefObject<HTMLElement | null> },
): ModelProfileQuickSwitchState {
	const { profiles, currentLabel, disabled, onSelectProfile, onOpenManageProfiles } = props
	const [open, setOpen] = useState(false)
	const [focusIndex, setFocusIndex] = useState(0)
	const popoverRef = useRef<HTMLDivElement | null>(null)
	const fallbackTriggerRef = useRef<HTMLElement | null>(null)
	const triggerRef = options?.triggerRef ?? fallbackTriggerRef

	useEffect(() => {
		if (!open) return
		function onDocClick(e: MouseEvent) {
			const target = e.target as Node
			if (
				popoverRef.current &&
				!popoverRef.current.contains(target) &&
				triggerRef.current &&
				!triggerRef.current.contains(target)
			) {
				setOpen(false)
			}
		}
		document.addEventListener("mousedown", onDocClick)
		return () => document.removeEventListener("mousedown", onDocClick)
	}, [open])

	useEffect(() => {
		if (open) {
			const activeIdx = profiles.findIndex((p) => p.isActive)
			setFocusIndex(activeIdx >= 0 ? activeIdx : 0)
		}
	}, [open, profiles])

	const handleTriggerClick = useCallback(() => {
		if (disabled) return
		setOpen((v) => !v)
	}, [disabled])

	const handleSelect = useCallback(
		(profileId: string) => {
			onSelectProfile(profileId)
			setOpen(false)
			;(triggerRef.current as unknown as HTMLElement | null)?.focus?.()
		},
		[onSelectProfile],
	)

	const handleManage = useCallback(() => {
		setOpen(false)
		onOpenManageProfiles()
	}, [onOpenManageProfiles])

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLDivElement>) => {
			if (e.key === "Escape") {
				e.preventDefault()
				setOpen(false)
				;(triggerRef.current as unknown as HTMLElement | null)?.focus?.()
				return
			}
			if (e.key === "ArrowDown") {
				e.preventDefault()
				setFocusIndex((i) => Math.min(i + 1, profiles.length - 1))
				return
			}
			if (e.key === "ArrowUp") {
				e.preventDefault()
				setFocusIndex((i) => Math.max(i - 1, 0))
				return
			}
			if (e.key === "Enter") {
				e.preventDefault()
				const target = profiles[focusIndex]
				if (target) handleSelect(target.profileId)
			}
		},
		[profiles, focusIndex, handleSelect],
	)

	const triggerProps: ModelProfileQuickSwitchState["triggerProps"] = {
		"data-testid": "model-profile-trigger",
		"aria-haspopup": "listbox",
		"aria-expanded": open,
		"aria-label": "Switch model profile",
		title: disabled ? "Available when the current request finishes" : "Switch model profile",
		disabled: !!disabled,
		onClick: handleTriggerClick,
	}

	const popoverNode =
		open && profiles ? (
			<div
				aria-label="Model profiles"
				className="absolute z-50 mt-1 min-w-[280px] rounded border bg-background shadow-lg"
				data-testid="model-profile-popover"
				onKeyDown={handleKeyDown}
				ref={popoverRef}
				role="listbox"
				tabIndex={-1}>
				{profiles.length === 0 && (
					<div className="p-3 text-sm text-muted-foreground" data-testid="model-profile-empty">
						No profiles configured yet.
					</div>
				)}
				{profiles.map((p, idx) => (
					<div
						aria-selected={p.isActive}
						className={
							"flex cursor-pointer items-start gap-2 px-3 py-2 text-sm " + (focusIndex === idx ? "bg-accent" : "")
						}
						data-focused={focusIndex === idx ? "true" : undefined}
						data-testid={`model-profile-option-${p.profileId}`}
						key={p.profileId}
						onClick={() => handleSelect(p.profileId)}
						onMouseEnter={() => setFocusIndex(idx)}
						role="option">
						<span aria-hidden className="mt-0.5 w-4 text-center">
							{p.isActive ? "✓" : ""}
						</span>
						<div className="flex flex-col">
							<span className="font-medium">{p.name}</span>
							<span className="text-xs text-muted-foreground">
								{p.modelId} · {p.providerId}
								{p.isDefault ? " · Default" : ""}
							</span>
						</div>
					</div>
				))}
				<div className="border-t">
					<button
						className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
						data-testid="model-profile-manage"
						onClick={handleManage}
						type="button">
						Manage Profiles…
					</button>
				</div>
			</div>
		) : null

	const currentProfile = profiles.find((p) => p.isActive)

	void currentLabel
	return {
		triggerProps,
		popover: (
			<>
				{popoverNode}
				<span data-testid="model-profile-current" hidden>
					{currentProfile?.profileId ?? ""}
				</span>
			</>
		),
		isOpen: open,
	}
}

export function ModelProfileQuickSwitch(props: ModelProfileQuickSwitchProps) {
	const { currentLabel } = props
	// ACT-CLINEMM-DOGFOOD-VSIX-TYPECHECK-UNBLOCK02: the standalone
	// trigger owns an HTMLButtonElement ref and forwards it to the
	// hook so outside-click + focus-restoration work end-to-end.
	const triggerButtonRef = useRef<HTMLButtonElement | null>(null)
	const { triggerProps, popover, isOpen } = useModelProfileQuickSwitch(props, { triggerRef: triggerButtonRef })
	void isOpen
	return (
		<div className="relative inline-block">
			<button {...triggerProps} ref={triggerButtonRef}>
				{currentLabel}
			</button>
			{popover}
		</div>
	)
}
