import {
	formatReasoningEffortSelection,
	isOpenaiReasoningEffort,
	Mode,
	OPENAI_REASONING_EFFORT_OPTIONS,
	OpenaiReasoningEffort,
	REASONING_EFFORT_SELECTOR_DEFAULT,
	ReasoningEffortSelection,
} from "@shared/storage/types"
import { memo } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { getModeSpecificFields } from "./utils/providerUtils"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

interface ReasoningEffortSelectorProps {
	currentMode: Mode
	label?: string
	description?: string
	allowedEfforts?: readonly OpenaiReasoningEffort[]
	/**
	 * The selection shown when NO effort is persisted.
	 *
	 * ACT-CLINEMM-REASONING-DEFAULT-NONE-SEMANTICS-REPAIR-01: the default
	 * is a SELECTION, not an effort. `"default"` means "no explicit
	 * override", which is a different user-visible state from an explicit
	 * `"none"` (an explicit disable). A caller that wants the absent state
	 * to read as `Default` passes `"default"`.
	 */
	defaultEffort?: ReasoningEffortSelection
	/** Optional callback invoked after the effort value changes. Use to persist to provider-specific stores. */
	onEffortChange?: (effort: ReasoningEffortSelection) => void
}

const ReasoningEffortSelector = ({
	currentMode,
	label = "Reasoning Effort",
	description = "Higher effort improves depth, but uses more tokens.",
	allowedEfforts = OPENAI_REASONING_EFFORT_OPTIONS,
	defaultEffort = REASONING_EFFORT_SELECTOR_DEFAULT,
	onEffortChange,
}: ReasoningEffortSelectorProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleModeFieldChange } = useApiConfigurationHandlers()
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	// ACT-CLINEMM-REASONING-DEFAULT-NONE-SEMANTICS-REPAIR-01: an ABSENT
	// persisted effort is the `Default` selection — "no explicit override" —
	// and NOT an explicit `None`. Conflating the two destroyed the evidence
	// the production boundary needs to tell a user selection from a derived
	// disable.
	const selectedEffort =
		isOpenaiReasoningEffort(modeFields.reasoningEffort) && allowedEfforts.includes(modeFields.reasoningEffort)
			? modeFields.reasoningEffort
			: defaultEffort

	return (
		<div style={{ marginTop: 10, marginBottom: 5 }}>
			<Label className="text-xs font-medium">{label}</Label>
			<Select
				onValueChange={(value) => {
					handleModeFieldChange({ plan: "planModeReasoningEffort", act: "actModeReasoningEffort" }, value, currentMode)
					if (onEffortChange && (value === REASONING_EFFORT_SELECTOR_DEFAULT || isOpenaiReasoningEffort(value))) {
						onEffortChange(value as ReasoningEffortSelection)
					}
				}}
				value={selectedEffort}>
				<SelectTrigger className="w-full mt-1">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{/*
					 * ACT-CLINEMM-REASONING-DEFAULT-NONE-SEMANTICS-REPAIR-01:
					 * `Default` is offered FIRST and is a DISTINCT selection
					 * from `None`. It is the "no explicit override" state.
					 */}
					<SelectItem key={REASONING_EFFORT_SELECTOR_DEFAULT} value={REASONING_EFFORT_SELECTOR_DEFAULT}>
						{formatReasoningEffortSelection(REASONING_EFFORT_SELECTOR_DEFAULT)}
					</SelectItem>
					{allowedEfforts.map((effort) => (
						<SelectItem key={effort} value={effort}>
							{formatReasoningEffortSelection(effort)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					marginBottom: 0,
					color: "var(--vscode-descriptionForeground)",
				}}>
				{description}
			</p>
		</div>
	)
}

export default memo(ReasoningEffortSelector)
