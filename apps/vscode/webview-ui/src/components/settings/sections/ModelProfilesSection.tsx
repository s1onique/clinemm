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

import { type ReactNode, useState } from "react"
import type { ModelProfileSummary } from "@/services/model-profile-types"

/**
 * ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / CORRECTION04
 * (B3 UI bounded P0 absorb HALT_B3_USER_VISIBILITY_NOT_PROVEN):
 * the typed envelope returned by
 * `bootstrapModelProfileFromCurrentConfiguration`. The section
 * renders a status-aware severity banner when this prop is set;
 * the previous behavior was a console.error-only swallow that
 * made bootstrap failures invisible.
 *
 * ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / B4 (bounded
 * reviewer's WEBVIEW_BOOTSTRAP_STATUS_AUTHORITY_DUPLICATED absorb):
 * the union below is the SINGLE AUTHORITATIVE source of bootstrap
 * status strings for the webview. Backend code (apps/vscode/src/sdk/
 * profile-store/bootstrap.ts) produces the SAME union; future drift
 * is caught by `parseBootstrapStatus` at the section entry point,
 * which returns `UNKNOWN` for any unrecognised raw string. The
 * previous design duplicated the union on the webview side AND
 * used an unchecked `as` cast at the container boundary, which
 * silently accepted backend drift and left the banner without a
 * severity tier.
 */
export type BootstrapModelProfileStatus =
	| "CREATED"
	| "CREATED_BINDING_FAILED"
	| "NO_CURRENT_CONFIGURATION"
	| "CURRENT_CONFIGURATION_UNSUPPORTED"
	| "MISSING_CREDENTIAL"
	| "MISSING_MODEL"
	| "INSTANCE_WRITE_FAILED"
	| "PROFILE_WRITE_FAILED"
	| "UNKNOWN"

export interface BootstrapModelProfileResultLike {
	status: string
	profileId?: string
	instanceId?: string
	message?: string
}

const KNOWN_STATUSES = new Set<BootstrapModelProfileStatus>([
	"CREATED",
	"CREATED_BINDING_FAILED",
	"NO_CURRENT_CONFIGURATION",
	"CURRENT_CONFIGURATION_UNSUPPORTED",
	"MISSING_CREDENTIAL",
	"MISSING_MODEL",
	"INSTANCE_WRITE_FAILED",
	"PROFILE_WRITE_FAILED",
])

/**
 * Runtime decoder — single status-authority entry point.
 *
 * Returns the typed status string when `raw` matches a known
 * value; returns "UNKNOWN" otherwise. The decoder is the load-
 * bearing regression guard against future backend/proto status
 * drift: a new backend status the webview has not been taught
 * about falls through to "UNKNOWN", which renders as a defensive
 * error banner instead of silently disappearing.
 */
export function parseBootstrapStatus(raw: unknown): BootstrapModelProfileStatus {
	if (typeof raw === "string" && KNOWN_STATUSES.has(raw as BootstrapModelProfileStatus)) {
		return raw as BootstrapModelProfileStatus
	}
	return "UNKNOWN"
}

export type BootstrapBannerSeverity = "success" | "warning" | "error" | null

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
	/**
	 * ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / B4:
	 * Optional summary of the user's current active provider/model.
	 * Rendered inside the first-run onboarding pane to make the
	 * "save this as a reusable profile" intent concrete. When
	 * omitted, the pane renders without the summary card. The host
	 * computes this from `useExtensionState().apiConfiguration`.
	 */
	currentConfiguration?: CurrentConfigurationSummary | null
	/**
	 * ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / CORRECTION04:
	 * The first-run bootstrap RPC. Distinct from `onSaveCurrentAsProfile`
	 * which writes a profile from the CURRENT configuration under the
	 * current active-task binding; bootstrap materializes the very
	 * first profile (with a stable opaque instanceId) when no profile
	 * exists yet. See `apps/vscode/src/sdk/profile-store/bootstrap.ts`.
	 */
	onBootstrapFromCurrent?: () => void | Promise<void>
	/**
	 * ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / CORRECTION04:
	 * Status-aware banner payload. When set, the section renders a
	 * visible severity-keyed banner with the response.message; when
	 * null/undefined, no banner is rendered. The container owns the
	 * state and passes the latest typed envelope down on each
	 * bootstrap attempt.
	 */
	bootstrapResult?: BootstrapModelProfileResultLike | null
	/**
	 * ACT-CLINEMM-DOGFOOD-VSIX-TYPECHECK-UNBLOCK02:
	 * Optional callback forwarded from `ModelProfilesSectionContainer`
	 * (originally from `SettingsView`) that renders the standard
	 * `<SectionHeader>` matching the neighboring sections.
	 */
	renderSectionHeader?: (tabId: string) => ReactNode
}

/**
 * Map a typed BootstrapModelProfileStatus to a severity tier the
 * section's banner uses to render an actionable, status-aware
 * surface (instead of the previous console.error-only swallow).
 *
 * CREATED                 -> success
 * CREATED_BINDING_FAILED  -> warning (success-with-warning)
 * NO_CURRENT_CONFIGURATION,
 * CURRENT_CONFIGURATION_UNSUPPORTED,
 * MISSING_CREDENTIAL,
 * MISSING_MODEL           -> error
 * INSTANCE_WRITE_FAILED,
 * PROFILE_WRITE_FAILED    -> error
 */
export function bootstrapStatusToSeverity(status: BootstrapModelProfileStatus): BootstrapBannerSeverity {
	switch (status) {
		case "CREATED":
			return "success"
		case "CREATED_BINDING_FAILED":
			return "warning"
		case "NO_CURRENT_CONFIGURATION":
		case "CURRENT_CONFIGURATION_UNSUPPORTED":
		case "MISSING_CREDENTIAL":
		case "MISSING_MODEL":
		case "INSTANCE_WRITE_FAILED":
		case "PROFILE_WRITE_FAILED":
		case "UNKNOWN":
			return "error"
	}
}

/**
 * Summary of the CURRENT active provider/model so the first-run
 * onboarding pane can show the user what they are about to persist
 * as a profile. Computed on the webview side; the values are
 * already mirrored into ExtensionState by the host projection.
 *
 * ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / B4: this is
 * an OPT-IN summary — the section renders the onboarding pane
 * whether or not a current configuration exists, but the
 * "Current configuration" panel only renders when both fields are
 * present. When the current configuration is not supported by
 * Model Profiles V1 (canCreateFromCurrent=false), the pane shows
 * an inline notice.
 */
export interface CurrentConfigurationSummary {
	providerId: string
	modelId: string
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
		onBootstrapFromCurrent,
		bootstrapResult,
		renderSectionHeader,
		currentConfiguration,
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
	// ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / B4: the
	// typed status is recovered via parseBootstrapStatus so any
	// unrecognised raw status (drift) becomes "UNKNOWN" rather than
	// a silent fall-through. The container no longer needs an `as`
	// cast — bootstrapResult.status is now `string`.
	const decodedBootstrapStatus = bootstrapResult ? parseBootstrapStatus(bootstrapResult.status) : null
	const bootstrapSeverity = decodedBootstrapStatus ? bootstrapStatusToSeverity(decodedBootstrapStatus) : null
	const hasProfiles = profiles.length > 0

	return (
		<div className="flex flex-col gap-4" data-testid="model-profiles-section">
			{renderSectionHeader?.("model-profiles")}

			{bootstrapResult && bootstrapSeverity && (
				<div
					className={
						bootstrapSeverity === "success"
							? "rounded border border-success/40 bg-success/10 p-2 text-xs"
							: bootstrapSeverity === "warning"
								? "rounded border border-warning/40 bg-warning/10 p-2 text-xs"
								: "rounded border border-error/40 bg-error/10 p-2 text-xs"
					}
					data-severity={bootstrapSeverity}
					data-status={decodedBootstrapStatus}
					data-testid="model-profiles-bootstrap-banner"
					role={bootstrapSeverity === "error" ? "alert" : "status"}>
					<div className="flex flex-col gap-1">
						<span className="font-medium">
							{bootstrapSeverity === "success"
								? "Profile created."
								: bootstrapSeverity === "warning"
									? "Profile created, but binding to the current task did not complete."
									: decodedBootstrapStatus === "UNKNOWN"
										? "Profile bootstrap returned an unrecognized status. Please retry."
										: "Could not create a profile from the current configuration."}
						</span>
						{bootstrapResult.message && (
							<span data-testid="model-profiles-bootstrap-message">{bootstrapResult.message}</span>
						)}
						{(bootstrapResult.profileId || bootstrapResult.instanceId) && (
							<span className="font-mono text-xs text-muted-foreground">
								{bootstrapResult.profileId ? `profileId: ${bootstrapResult.profileId}` : ""}
								{bootstrapResult.profileId && bootstrapResult.instanceId ? " · " : ""}
								{bootstrapResult.instanceId ? `instanceId: ${bootstrapResult.instanceId}` : ""}
							</span>
						)}
					</div>
				</div>
			)}

			{/* ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / B4: dedicated
			    first-run onboarding pane. Distinct from the management view
			    so a zero-profile user does NOT see an inert management table.
			    Shows the current provider/model summary when available, then
			    the primary CTA "Create first profile" -> onBootstrapFromCurrent. */}
			{!hasProfiles && (
				<div
					className="flex flex-col gap-3 rounded border border-dashed p-4"
					data-state="empty"
					data-testid="model-profiles-onboarding">
					<div className="flex flex-col gap-1">
						<span className="text-sm font-medium">Save your current setup as a reusable profile</span>
						<span className="text-xs text-muted-foreground">
							A Model Profile captures your provider, model, endpoint, and credentials so you can switch between
							setups in one click.
						</span>
					</div>
					{currentConfiguration?.providerId && currentConfiguration?.modelId && (
						<div
							className="flex flex-col gap-0.5 rounded border bg-muted/30 p-2 text-xs"
							data-testid="model-profiles-onboarding-summary">
							<span className="text-muted-foreground">Current configuration</span>
							<span className="font-mono">
								{currentConfiguration.providerId} · {currentConfiguration.modelId}
							</span>
						</div>
					)}
					{!canCreateFromCurrent && (
						<div
							className="rounded border border-warning/40 bg-warning/10 p-2 text-xs"
							data-testid="model-profiles-onboarding-unsupported">
							This provider configuration is not supported by Model Profiles.
						</div>
					)}
					{onBootstrapFromCurrent && (
						<button
							className="self-start rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
							data-testid="model-profiles-bootstrap"
							disabled={!canCreateFromCurrent}
							onClick={() => void onBootstrapFromCurrent()}
							type="button">
							Create first profile
						</button>
					)}
				</div>
			)}

			{hasProfiles && (
				<div className="flex items-center gap-2">
					<input
						className="flex-1 rounded border px-2 py-1 text-sm"
						data-testid="model-profiles-new-name"
						disabled={!canCreateFromCurrent}
						onChange={(e) => setNewProfileName(e.target.value)}
						placeholder="Profile name"
						type="text"
						value={newProfileName}
					/>
					<button
						className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
						data-testid="model-profiles-save-current"
						disabled={!canCreateFromCurrent || newProfileName.trim().length === 0}
						onClick={handleSave}
						type="button">
						Save current configuration as profile
					</button>
				</div>
			)}

			{hasProfiles && !canCreateFromCurrent && (
				<div className="rounded border border-warning/40 bg-warning/10 p-2 text-xs">
					This provider configuration is not supported by Model Profiles V1.
				</div>
			)}

			{defaultProfile && (
				<div className="text-xs text-muted-foreground">
					Default profile: <strong>{defaultProfile.name}</strong>{" "}
					<button
						className="ml-2 underline"
						data-testid="model-profiles-clear-default"
						onClick={() => void onClearDefault()}
						type="button">
						Clear default
					</button>
				</div>
			)}

			<ul className="flex flex-col gap-2" data-testid="model-profiles-list">
				{profiles.map((p) => (
					<li
						className="flex items-center gap-3 rounded border px-3 py-2"
						data-testid={`model-profiles-row-${p.profileId}`}
						key={p.profileId}>
						<div className="flex-1">
							{renamingId === p.profileId ? (
								<input
									autoFocus
									className="w-full rounded border px-2 py-1 text-sm"
									data-testid={`model-profiles-rename-input-${p.profileId}`}
									onBlur={commitRename}
									onChange={(e) => setRenameDraft(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") commitRename()
										if (e.key === "Escape") {
											setRenamingId(null)
											setRenameDraft("")
										}
									}}
									value={renameDraft}
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
								className="rounded border px-2 py-1 text-xs disabled:opacity-50"
								data-testid={`model-profiles-use-${p.profileId}`}
								disabled={!canApplyLive || p.isActive}
								onClick={() => void onUse(p.profileId)}
								title={
									!canApplyLive
										? "Available when the current request finishes"
										: p.isActive
											? "Already in use"
											: "Use this profile for the current task"
								}
								type="button">
								Use
							</button>
							{!p.isDefault && (
								<button
									className="rounded border px-2 py-1 text-xs"
									data-testid={`model-profiles-set-default-${p.profileId}`}
									onClick={() => void onSetAsDefault(p.profileId)}
									type="button">
									Set as default
								</button>
							)}
							<button
								className="rounded border px-2 py-1 text-xs"
								data-testid={`model-profiles-rename-${p.profileId}`}
								onClick={() => beginRename(p.profileId, p.name)}
								type="button">
								Rename
							</button>
							<button
								className="rounded border px-2 py-1 text-xs disabled:opacity-50"
								data-testid={`model-profiles-update-${p.profileId}`}
								disabled={!canCreateFromCurrent}
								onClick={() => void onUpdateFromCurrent(p.profileId)}
								type="button">
								Update from current
							</button>
							<button
								className="rounded border px-2 py-1 text-xs text-error disabled:opacity-50"
								data-testid={`model-profiles-delete-${p.profileId}`}
								disabled={p.isActive || p.isDefault}
								onClick={() => void onDelete(p.profileId)}
								title={
									p.isActive
										? "Cannot delete the active profile"
										: p.isDefault
											? "Cannot delete the default profile"
											: "Delete profile"
								}
								type="button">
								Delete
							</button>
						</div>
					</li>
				))}
			</ul>
		</div>
	)
}
