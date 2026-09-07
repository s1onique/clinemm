export type HistoryItem = {
	id: string
	ulid?: string // ULID for better tracking and metrics
	ts: number
	task: string
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	totalCost: number

	size?: number
	cwdOnTaskInitialization?: string
	conversationHistoryDeletedRange?: [number, number]
	isFavorited?: boolean

	modelId?: string
	/**
	 * Provider id the task ran on (from the SDK session record). Absent for
	 * tasks recorded before this field existed and for legacy imports —
	 * cost-display consumers treat an absent provider as "show", since
	 * there is nothing to key suppression on.
	 */
	apiProvider?: string
	isLegacy?: boolean
	/**
	 * ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01:
	 *
	 * The profileId bound to this task at the moment of last binding
	 * write. Persisted in HistoryItem.metadata (canonical seam per
	 * recon §4.1) so resume restores the same profile. The field is
	 * OPTIONAL: tasks bound before Model Profiles V1 (and legacy
	 * imports) carry no value and fall back to defaultProfileId, then
	 * to legacy current-configuration behavior.
	 *
	 * The mapping is implemented in
	 *   apps/vscode/src/sdk/profile-store/session-binding.ts
	 * which is the single writer/reader of this field.
	 */
	activeProfileId?: string
}
