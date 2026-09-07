/**
 * ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / Phase F
 *
 * Settings > Model Profiles section. Compact management surface:
 * rows are profiles; actions are Use / Set as default / Rename /
 * Update from current / Delete.
 *
 * The section is intentionally presentational: the parent wires
 * the callbacks to the gRPC handlers and the applyModelProfile
 * coordinator. The component does NOT call any backend directly.
 */

import type { ModelProfileSummary } from "@/services/model-profile-types"
import { useState } from "react"

export interface ModelProfilesSectionProps {
	profiles: ModelProfileSummary[]
	canCreateFromCurrent: boolean
	canApplyLive: boolean
	onSaveCurrentAsProfile: (name: string) => void | Promise<void>
	onUse: (profileId: string) => void | Promise<void>
	onSetAsDefault: (profileId: string) => void | Promise<void>
	onClearDefault: () => void | Promise<void>
	onRename: (profileId: string, newName: string) => void | Promise<void>
	onUpdateFromCurrent: (profileId: string) => void | Promise<void>
	onDelete: (profileId: string) => void | Promise<void>
}

export function ModelProfilesSection(props: ModelProfilesSectionProps) {
	const {
		profiles,
		canCreateFromCurrent,
		canApplyLive,
		onSaveCurrentAsProfile,
		onUse,
		onSetAsDefault,
		onClearDefault,
		onRename,
		onUpdateFromCurrent,
		onDelete,
	} = props

	const [newProfileName, setNewProfileName] = useState("")
	const [renamingId, setRenamingId] = useState<string | null>(null)
	const [renameDraft, setRenameDraft] = useState("")

	function handleSave() {
		const trimmed = newProfileName.trim()
		if (!trimmed) return
		void onSaveCurrentAsProfile(trimmed)
		setNewProfileName("")
	}

	function beginRename(profileId: string, currentName: string) {
		setRenamingId(profileId)
		setRenameDraft(currentName)
	}

	function commitRename() {
		if (renamingId && renameDraft.trim()) {
			void onRename(renamingId, renameDraft.trim())
		}
		setRenamingId(null)
		setRenameDraft("")
	}

	const defaultProfile = profiles.find((p) => p.isDefault)

	return (
		<div className="flex flex-col gap-4" data-testid="model-profiles-section">
			<div className="flex items-center gap-2">
				<input
					type="text"
					data-testid="model-profiles-new-name"
					placeholder="Profile name"
					value={newProfileName}
					onChange={(e) => setNewProfileName(e.target.value)}
					className="flex-1 rounded border px-2 py-1 text-sm"
					disabled={!canCreateFromCurrent}
				/>
				<button
					type="button"
					data-testid="model-profiles-save-current"
					disabled={!canCreateFromCurrent || newProfileName.trim().length === 0}
					onClick={handleSave}
					className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50">
					Save current configuration as profile
				</button>
			</div>

			{!canCreateFromCurrent && (
				<div className="rounded border border-warning/40 bg-warning/10 p-2 text-xs">
					This provider configuration is not supported by Model Profiles V1.
				</div>
			)}

			{defaultProfile && (
				<div className="text-xs text-muted-foreground">
					Default profile: <strong>{defaultProfile.name}</strong>{" "}
					<button
						type="button"
						className="ml-2 underline"
						onClick={() => void onClearDefault()}
						data-testid="model-profiles-clear-default">
						Clear default
					</button>
				</div>
			)}

			<ul className="flex flex-col gap-2" data-testid="model-profiles-list">
				{profiles.length === 0 && (
					<li className="rounded border border-dashed p-3 text-center text-xs text-muted-foreground">
						No profiles yet. Save your current configuration to get started.
					</li>
				)}
				{profiles.map((p) => (
					<li
						key={p.profileId}
						data-testid={`model-profiles-row-${p.profileId}`}
						className="flex items-center gap-3 rounded border px-3 py-2">
						<div className="flex-1">
							{renamingId === p.profileId ? (
								<input
									data-testid={`model-profiles-rename-input-${p.profileId}`}
									value={renameDraft}
									onChange={(e) => setRenameDraft(e.target.value)}
									onBlur={commitRename}
									onKeyDown={(e) => {
										if (e.key === "Enter") commitRename()
										if (e.key === "Escape") {
											setRenamingId(null)
											setRenameDraft("")
										}
									}}
									className="w-full rounded border px-2 py-1 text-sm"
									autoFocus
								/>
							) : (
								<div className="flex flex-col">
									<span className="text-sm font-medium">
										{p.name}
										{p.isDefault && (
											<span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-xs">Default</span>
										)}
									</span>
									<span className="text-xs text-muted-foreground">
										{p.modelId} · {p.providerId}
									</span>
								</div>
							)}
						</div>
						<div className="flex items-center gap-1">
							<button
								type="button"
								data-testid={`model-profiles-use-${p.profileId}`}
								disabled={!canApplyLive || p.isActive}
								title={
									!canApplyLive
										? "Available when the current request finishes"
										: p.isActive
											? "Already in use"
											: "Use this profile for the current task"
								}
								onClick={() => void onUse(p.profileId)}
								className="rounded border px-2 py-1 text-xs disabled:opacity-50">
								Use
							</button>
							{!p.isDefault && (
								<button
									type="button"
									data-testid={`model-profiles-set-default-${p.profileId}`}
									onClick={() => void onSetAsDefault(p.profileId)}
									className="rounded border px-2 py-1 text-xs">
									Set as default
								</button>
							)}
							<button
								type="button"
								data-testid={`model-profiles-rename-${p.profileId}`}
								onClick={() => beginRename(p.profileId, p.name)}
								className="rounded border px-2 py-1 text-xs">
								Rename
							</button>
							<button
								type="button"
								data-testid={`model-profiles-update-${p.profileId}`}
								disabled={!canCreateFromCurrent}
								onClick={() => void onUpdateFromCurrent(p.profileId)}
								className="rounded border px-2 py-1 text-xs disabled:opacity-50">
								Update from current
							</button>
							<button
								type="button"
								data-testid={`model-profiles-delete-${p.profileId}`}
								disabled={p.isActive || p.isDefault}
								title={p.isActive ? "Cannot delete the active profile" : p.isDefault ? "Cannot delete the default profile" : "Delete profile"}
								onClick={() => void onDelete(p.profileId)}
								className="rounded border px-2 py-1 text-xs text-error disabled:opacity-50">
								Delete
							</button>
						</div>
					</li>
				))}
			</ul>
		</div>
	)
}
