import type { ApiConfiguration, ApiProvider, OcaModelInfo } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import { getModeSpecificFields } from "@/components/settings/utils/providerUtils"

const REASONING_EFFORT_LABELS = {
	none: "None",
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "XHigh",
} as const

export type ConfiguredReasoningEffort = keyof typeof REASONING_EFFORT_LABELS | "max"

export interface ComposerReasoningEffortOptions {
	/** The provider currently selected in the active mode. */
	provider?: ApiProvider
	/** Explicitly configured efforts supported by the active model. */
	supportedEfforts?: readonly string[]
}

/**
 * Resolve the user's configured reasoning effort for the active composer mode.
 *
 * The shared mode-specific field is authoritative for providers whose existing
 * reasoning selector persists there. OCA owns a separate mode-specific field,
 * so its value is used instead of the shared field to avoid leaking another
 * provider's setting into the current label.
 */
export function resolveConfiguredReasoningEffort(
	apiConfiguration: ApiConfiguration | undefined,
	mode: Mode,
	options: ComposerReasoningEffortOptions = {},
): ConfiguredReasoningEffort | undefined {
	if (options.provider === "oca") {
		const ocaEffort =
			mode === "plan" ? apiConfiguration?.planModeOcaReasoningEffort : apiConfiguration?.actModeOcaReasoningEffort
		return isSupportedConfiguredEffort(ocaEffort, options.supportedEfforts)
	}

	const modeFields = getModeSpecificFields(apiConfiguration, mode)
	return isSupportedConfiguredEffort(modeFields.reasoningEffort, options.supportedEfforts)
}

function isSupportedConfiguredEffort(
	value: unknown,
	supportedEfforts?: readonly string[],
): ConfiguredReasoningEffort | undefined {
	if (typeof value !== "string") {
		return undefined
	}

	const normalized = value.toLowerCase()
	if (normalized === "max") {
		return supportedEfforts?.some((effort) => effort.toLowerCase() === "max") ? "max" : undefined
	}

	if (!(normalized in REASONING_EFFORT_LABELS)) {
		return undefined
	}

	if (supportedEfforts && !supportedEfforts.some((effort) => effort.toLowerCase() === normalized)) {
		return undefined
	}

	return normalized as ConfiguredReasoningEffort
}

/** Append the configured effort to the existing composer model label. */
export function formatComposerModelLabel(modelLabel: string, effort: ConfiguredReasoningEffort | undefined): string {
	if (!effort) {
		return modelLabel
	}

	const displayName = effort === "max" ? "Max" : REASONING_EFFORT_LABELS[effort]
	return `${modelLabel}:${displayName}`
}

/** Read OCA's per-model supported effort list without introducing another store. */
export function getOcaSupportedReasoningEfforts(
	apiConfiguration: ApiConfiguration | undefined,
	mode: Mode,
): readonly string[] | undefined {
	const ocaModelInfo = mode === "plan" ? apiConfiguration?.planModeOcaModelInfo : apiConfiguration?.actModeOcaModelInfo
	return (ocaModelInfo as OcaModelInfo | undefined)?.reasoningEffortOptions
}
