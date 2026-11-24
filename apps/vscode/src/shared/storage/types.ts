export const OPENAI_REASONING_EFFORT_OPTIONS = ["none", "low", "medium", "high", "xhigh"] as const

export type OpenaiReasoningEffort = (typeof OPENAI_REASONING_EFFORT_OPTIONS)[number]

export function isOpenaiReasoningEffort(value: unknown): value is OpenaiReasoningEffort {
	return typeof value === "string" && OPENAI_REASONING_EFFORT_OPTIONS.includes(value as OpenaiReasoningEffort)
}

export function normalizeOpenaiReasoningEffort(effort?: string): OpenaiReasoningEffort {
	const value = (effort || "medium").toLowerCase()
	return isOpenaiReasoningEffort(value) ? value : "medium"
}

/**
 * ACT-CLINEMM-REASONING-DEFAULT-NONE-SEMANTICS-REPAIR-01.
 *
 * The reasoning-effort SELECTION value the user picks in the settings UI.
 *
 * It carries ONE more member than {@link OpenaiReasoningEffort}: `"default"`.
 * The distinction is user-visible and load-bearing:
 *
 *   - `"default"`  — no explicit effort override. The model/provider applies
 *                    its own reasoning policy.
 *   - `"none"`     — the user EXPLICITLY disabled reasoning.
 *   - `"low"` …    — the user EXPLICITLY selected that effort.
 *
 * `"default"` is a UI-level sentinel ONLY. It is NOT a persisted reasoning
 * effort and it is NOT a provider reasoning effort: it must never be written
 * to the wire as `reasoning_effort`. Selecting it REMOVES the explicit
 * override, so the persisted configuration returns to the absent state.
 */
export const REASONING_EFFORT_SELECTOR_DEFAULT = "default"

export type ReasoningEffortSelection = OpenaiReasoningEffort | typeof REASONING_EFFORT_SELECTOR_DEFAULT

/**
 * The user-visible label for a reasoning-effort selection.
 *
 * `"default"` reads as `Default` and `"none"` as `None`, so the two are
 * never conflated in the settings UI.
 */
export function formatReasoningEffortSelection(selection: ReasoningEffortSelection): string {
	return selection === REASONING_EFFORT_SELECTOR_DEFAULT ? "Default" : selection.charAt(0).toUpperCase() + selection.slice(1)
}

/**
 * The PROVIDER-CONFIG reasoning patch a selection maps to.
 *
 * ACT-CLINEMM-REASONING-DEFAULT-NONE-SEMANTICS-REPAIR-01: the patch carries
 * the SELECTION itself, so the persistence layer can tell the three
 * user-visible states apart:
 *
 *   - `"default"` — REMOVE the explicit override.
 *   - `"none"`    — persist the explicit disable.
 *   - an effort   — persist the explicit effort.
 */
export function toReasoningConfigPatch(selection: ReasoningEffortSelection): {
	enabled?: boolean
	effort?: ReasoningEffortSelection
} {
	if (selection === REASONING_EFFORT_SELECTOR_DEFAULT) {
		return { effort: REASONING_EFFORT_SELECTOR_DEFAULT }
	}
	if (selection === "none") {
		return { enabled: false, effort: "none" }
	}
	return { enabled: true, effort: selection }
}

export type Mode = "plan" | "act"

export interface BlobStoreSettings {
	bucket: string
	adapterType: "s3" | "r2" | "azure" | string
	accessKeyId: string
	secretAccessKey: string
	region?: string
	endpoint?: string
	accountId?: string

	/** Interval between sync attempts in milliseconds (default: 30000 = 30s) */
	intervalMs?: number
	/** Maximum number of retries before giving up on an item (default: 5) */
	maxRetries?: number
	/** Batch size - how many items to process per interval (default: 10) */
	batchSize?: number
	/** Maximum queue size before eviction (default: 1000) */
	maxQueueSize?: number
	/** Maximum age for failed items in milliseconds (default: 7 days) */
	maxFailedAgeMs?: number
	/** Whether to backfill existing unsynced items on startup (default: false) */
	backfillEnabled?: boolean
}
