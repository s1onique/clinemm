/**
 * ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / Phase E
 *
 * Footer quick-switch popover. Triggered by clicking the current
 * model/profile label in ChatTextArea.
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

import type { ModelProfileSummary } from "@/services/model-profile-types"
import { useEffect, useRef, useState } from "react"

export interface ModelProfileQuickSwitchProps {
	profiles: ModelProfileSummary[]
	currentLabel: string
	disabled?: boolean
	onSelectProfile: (profileId: string) => void
	onOpenManageProfiles: () => void
}

export function ModelProfileQuickSwitch(props: ModelProfileQuickSwitchProps) {
	const { profiles, currentLabel, disabled, onSelectProfile, onOpenManageProfiles } = props
	const [open, setOpen] = useState(false)
	const [focusIndex, setFocusIndex] = useState(0)
	const popoverRef = useRef<HTMLDivElement | null>(null)
	const triggerRef = useRef<HTMLButtonElement | null>(null)

	// Close on outside click
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

	// Reset focus when opened
	useEffect(() => {
		if (open) {
			const activeIdx = profiles.findIndex((p) => p.isActive)
			setFocusIndex(activeIdx >= 0 ? activeIdx : 0)
		}
	}, [open, profiles])

	function handleTriggerClick() {
		if (disabled) return
		setOpen((v) => !v)
	}

	function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
		if (e.key === "Escape") {
			e.preventDefault()
			setOpen(false)
			triggerRef.current?.focus()
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
			if (target) {
				onSelectProfile(target.profileId)
				setOpen(false)
				triggerRef.current?.focus()
			}
		}
	}

	const currentProfile = profiles.find((p) => p.isActive)

	return (
		<div className="relative inline-block">
			<button
				ref={triggerRef}
				type="button"
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-label="Switch model profile"
				title={disabled ? "Available when the current request finishes" : "Switch model profile"}
				disabled={disabled}
				onClick={handleTriggerClick}
				data-testid="model-profile-trigger">
				{currentLabel}
			</button>
			{open && (
				<div
					ref={popoverRef}
					role="listbox"
					aria-label="Model profiles"
					tabIndex={-1}
					onKeyDown={handleKeyDown}
					data-testid="model-profile-popover"
					className="absolute z-50 mt-1 min-w-[280px] rounded border bg-background shadow-lg">
					{profiles.length === 0 && (
						<div className="p-3 text-sm text-muted-foreground" data-testid="model-profile-empty">
							No profiles configured yet.
						</div>
					)}
					{profiles.map((p, idx) => (
						<div
							key={p.profileId}
							role="option"
							aria-selected={p.isActive}
							data-testid={`model-profile-option-${p.profileId}`}
							data-focused={focusIndex === idx ? "true" : undefined}
							onMouseEnter={() => setFocusIndex(idx)}
							onClick={() => {
								onSelectProfile(p.profileId)
								setOpen(false)
								triggerRef.current?.focus()
							}}
							className={
								"flex cursor-pointer items-start gap-2 px-3 py-2 text-sm " +
								(focusIndex === idx ? "bg-accent" : "")
							}>
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
							type="button"
							data-testid="model-profile-manage"
							className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
							onClick={() => {
								setOpen(false)
								onOpenManageProfiles()
							}}>
							Manage Profiles…
						</button>
					</div>
				</div>
			)}
			{/* Used only to ensure no-tree-shake on currentProfile for the
			    future extension to a "show details" affordance. */}
			<span hidden data-testid="model-profile-current">{currentProfile?.profileId ?? ""}</span>
		</div>
	)
}
