/**
 * ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01
 *
 * Settings UI surface for the temporary external path authority
 * exception to R0 workspace path authority.
 *
 * Contract:
 *   - User enables a list of { path, expiresAt } entries.
 *   - `expiresAt` is an absolute ISO-8601 timestamp (NOT a relative
 *     duration). The UI persists `now + chosenDuration` so five
 *     Codium instances reading the same persisted list converge on
 *     the same absolute expiry.
 *   - 24h hard ceiling. The UI clamps `expiresAt = now + min(d, 24h)`.
 *   - Default duration: 4h (shorter than the ceiling).
 *   - One-click preset: "Allow /private/tmp for 24h".
 */

import { memo, useCallback, useMemo, useState, type ReactNode } from "react"
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import type { TemporaryExternalPathAuthority } from "@cline/core"
import { useExtensionState } from "@/context/ExtensionStateContext"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"

interface TemporaryExternalPathsSectionProps {
	renderSectionHeader: (tabId: string) => ReactNode
}

const HOUR_MS = 60 * 60 * 1000
const MAX_DURATION_HOURS = 24
const DEFAULT_DURATION_HOURS = 4

function durationHoursToExpiresAt(hours: number): string {
	return new Date(Date.now() + hours * HOUR_MS).toISOString()
}

/**
 * Render the relative time until `expiresAt`. Returns `{ text, expired }`
 * so the caller can branch on the expired state.
 *
 * CORRECTION01: also returns `expired: true` for unparseable timestamps
 * so the UI can show "Expired" rather than "expires in NaN".
 */
function formatRemainingHours(expiresAt: string): { text: string; expired: boolean } {
	const expiryMs = Date.parse(expiresAt)
	if (Number.isNaN(expiryMs)) return { text: "expired", expired: true }
	const remainingMs = expiryMs - Date.now()
	if (remainingMs <= 0) return { text: "expired", expired: true }
	const totalMinutes = Math.floor(remainingMs / 60_000)
	const hours = Math.floor(totalMinutes / 60)
	const minutes = totalMinutes % 60
	if (hours === 0) return { text: `${minutes}m`, expired: false }
	return { text: `${hours}h ${minutes}m`, expired: false }
}

const TemporaryExternalPathsSection = ({ renderSectionHeader }: TemporaryExternalPathsSectionProps) => {
	const { clinemmTemporaryExternalPathAuthorities = [] } = useExtensionState()
	const entries = useMemo(() => clinemmTemporaryExternalPathAuthorities ?? [], [
		clinemmTemporaryExternalPathAuthorities,
	])
	const [newPath, setNewPath] = useState("")
	const [newDurationHours, setNewDurationHours] = useState<number>(DEFAULT_DURATION_HOURS)

	const persist = useCallback((next: TemporaryExternalPathAuthority[]) => {
		// Wire format: serialized JSON array of { path, expiresAt } entries.
		updateSetting("clinemmTemporaryExternalPathAuthorities", JSON.stringify(next))
	}, [])

	const handleAdd = useCallback(() => {
		const path = newPath.trim()
		if (path.length === 0) return
		const entry: TemporaryExternalPathAuthority = {
			path,
			expiresAt: durationHoursToExpiresAt(newDurationHours),
		}
		persist([...entries, entry])
		setNewPath("")
	}, [entries, newDurationHours, newPath, persist])

	const handleRemove = useCallback(
		(targetExpiresAt: string) => {
			persist(entries.filter((e) => e.expiresAt !== targetExpiresAt))
		},
		[entries, persist],
	)

	// One-click preset for the canonical macOS user-temp directory.
	// `/tmp` is a symlink to `/private/tmp` on macOS; the user typed
	// the canonical form into the UI.
	const handleAllowPrivateTmpFor24h = useCallback(() => {
		const next: TemporaryExternalPathAuthority[] = [
			...entries,
			{
				path: "/private/tmp",
				expiresAt: durationHoursToExpiresAt(MAX_DURATION_HOURS),
			},
		]
		persist(next)
	}, [entries, persist])

	return (
		<div>
			{renderSectionHeader("sandbox")}
			<Section>
				<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider mb-3">
					Temporary External Paths
				</div>
				<div className="relative p-3 pt-0 my-3 rounded-md border border-editor-widget-border/50">
					<p className="text-sm text-muted-foreground pt-3 pb-2">
						Temporarily trust specific external filesystem roots for R0 read-only
						command auto-approval. Each entry expires automatically. Maximum
						lifetime: 24h. This widens the workspace path authority set; it does
						not bypass hard deny, Seatbelt, sensitive-file protections, or
						realpath verification.
					</p>

					<p className="text-xs text-muted-foreground italic pb-2">
						CORRECTION01: each entry shows the path you typed. The host
						canonicalizes it (via <code>fs.realpathSync</code>) before granting
						authority at evaluation time, so symlinks at the configured path
						resolve to their target and only match when the target is itself
						inside the configured root. Expired entries are visually marked
						and do not grant authority.
					</p>

					{entries.length === 0 ? (
						<p className="text-sm text-muted-foreground italic pb-2">
							No temporary paths configured.
						</p>
					) : (
						<ul className="flex flex-col gap-2 pb-2">
							{entries.map((entry) => {
								const remaining = formatRemainingHours(entry.expiresAt)
								return (
									<li
										key={`${entry.path}-${entry.expiresAt}`}
										className={`flex items-center justify-between gap-2 px-3 py-2 rounded border ${
											remaining.expired
												? "border-description/40 bg-background/30 opacity-70"
												: "border-editor-widget-border/40 bg-background/50"
										}`}
										data-testid={`temp-external-entry-${entry.path}`}
									>
										<div className="flex flex-col gap-0.5 min-w-0">
											<code
												className="text-sm truncate"
												title={entry.path}
											>
												{entry.path}
											</code>
											<span
												className={`text-xs ${
													remaining.expired ? "text-error" : "text-description"
												}`}
												data-testid={`temp-external-status-${entry.path}`}
											>
												{remaining.expired
													? "Expired (no authority)"
													: `expires in ${remaining.text}`}
											</span>
										</div>
										<VSCodeButton
											appearance="secondary"
											aria-label={`Remove temporary external path ${entry.path}`}
											data-testid={`remove-temp-external-${entry.path}`}
											onClick={() => handleRemove(entry.expiresAt)}
										>
											Remove
										</VSCodeButton>
									</li>
								)
							})}
						</ul>
					)}

					<div className="flex flex-col gap-2 pb-2">
						<label className="text-xs font-medium text-foreground/80">
							Add a path
						</label>
						<VSCodeTextField
							aria-label="Path to trust temporarily"
							data-testid="temp-external-path-input"
							onInput={(e) => setNewPath((e.target as HTMLInputElement).value)}
							placeholder="/private/tmp"
							value={newPath}
						/>
						<fieldset className="flex flex-col gap-1">
							<legend className="text-xs font-medium text-foreground/80">
								Duration
							</legend>
							<div className="flex items-center gap-3 text-sm">
								{[1, 4, 8, MAX_DURATION_HOURS].map((h) => (
									<label key={h} className="flex items-center gap-1">
										<input
											checked={newDurationHours === h}
											data-testid={`temp-external-duration-${h}h`}
											name="temp-external-duration"
											onChange={() => setNewDurationHours(h)}
											type="radio"
										/>
										{h === MAX_DURATION_HOURS ? `${h}h (max)` : `${h}h`}
									</label>
								))}
							</div>
						</fieldset>
						<VSCodeButton
							appearance="primary"
							data-testid="temp-external-add"
							disabled={newPath.trim().length === 0}
							onClick={handleAdd}
						>
							Add path
						</VSCodeButton>
					</div>

					<div className="flex flex-col gap-1 pt-2 border-t border-editor-widget-border/30">
						<label className="text-xs font-medium text-foreground/80">
							Quick presets
						</label>
						<VSCodeButton
							appearance="secondary"
							data-testid="temp-external-preset-private-tmp"
							onClick={handleAllowPrivateTmpFor24h}
						>
							Allow /private/tmp for 24h
						</VSCodeButton>
					</div>
				</div>
			</Section>
		</div>
	)
}

export default memo(TemporaryExternalPathsSection)
