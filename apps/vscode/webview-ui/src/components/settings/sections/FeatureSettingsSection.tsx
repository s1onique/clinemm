import { UpdateSettingsRequest } from "@shared/proto/cline/state"
import {
	BEFORE_MODEL_CHECKPOINT_MAX_TEXT_LENGTH,
	normalizeBeforeModelCheckpointInterval,
} from "@shared/storage/beforeModelCheckpoint"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { memo, type ReactNode, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import Section from "../Section"
import { featureSettingControlId, featureSettingElementId } from "../settingsTargets"
import { updateSetting } from "../utils/settingsHandlers"

// Reusable checkbox component for feature settings
interface FeatureCheckboxProps {
	id?: string
	checked: boolean | undefined
	onChange: (checked: boolean) => void
	label: string
	description: ReactNode
	disabled?: boolean
	isRemoteLocked?: boolean
	remoteTooltip?: string
	isVisible?: boolean
}

// Interface for feature toggle configuration
interface FeatureToggle {
	id: string
	label: string
	description: ReactNode
	settingKey: keyof UpdateSettingsRequest
	stateKey: string
}

const agentFeatures: FeatureToggle[] = [
	{
		id: "auto-compact",
		label: "Auto Compact",
		description: "Automatically compress conversation history.",
		stateKey: "useAutoCondense",
		settingKey: "useAutoCondense",
	},
]

const editorFeatures: FeatureToggle[] = [
	{
		id: "show-feature-tips",
		label: "Feature Tips",
		description: "Show rotating tips during the thinking phase to help you discover Cline features.",
		stateKey: "showFeatureTips",
		settingKey: "showFeatureTips",
	},
	{
		id: "background-edit",
		label: "Background Edit",
		description: "Allow edits without stealing editor focus",
		stateKey: "backgroundEditEnabled",
		settingKey: "backgroundEditEnabled",
	},
	{
		id: "checkpoints",
		label: "Checkpoints",
		description: "Save progress at key points for easy rollback",
		stateKey: "enableCheckpointsSetting",
		settingKey: "enableCheckpointsSetting",
	},
	{
		id: "worktrees",
		label: "Worktrees",
		description: "Enables git worktree management for running parallel Cline tasks.",
		stateKey: "worktreesEnabled",
		settingKey: "worktreesEnabled",
	},
]

const advancedFeatures: FeatureToggle[] = [
	{
		id: "hooks",
		label: "Hooks",
		description: "Enable lifecycle and tool hooks during task execution.",
		stateKey: "hooksEnabled",
		settingKey: "hooksEnabled",
	},
]

const FeatureRow = memo(
	({
		id,
		checked = false,
		onChange,
		label,
		description,
		disabled,
		isRemoteLocked,
		isVisible = true,
		remoteTooltip,
	}: FeatureCheckboxProps) => {
		if (!isVisible) {
			return null
		}
		const switchId = id ? featureSettingControlId(id) : label

		const checkbox = (
			<div className="flex items-center justify-between w-full">
				<label htmlFor={switchId}>{label}</label>
				<div>
					<Switch
						checked={checked}
						className="shrink-0"
						disabled={disabled || isRemoteLocked}
						id={switchId}
						onCheckedChange={onChange}
						size="lg"
					/>
					{isRemoteLocked && <i className="codicon codicon-lock text-description text-sm" />}
				</div>
			</div>
		)

		return (
			<div
				className="flex flex-col items-start justify-between gap-4 py-3 px-1 w-full rounded-xs border border-transparent"
				id={id ? featureSettingElementId(id) : undefined}>
				<div className="space-y-0.5 flex-1 w-full">
					{isRemoteLocked ? (
						<Tooltip>
							<TooltipTrigger asChild>{checkbox}</TooltipTrigger>
							<TooltipContent className="max-w-xs" side="top">
								{remoteTooltip}
							</TooltipContent>
						</Tooltip>
					) : (
						checkbox
					)}
				</div>
				<div className="text-xs text-description">{description}</div>
			</div>
		)
	},
)

interface FeatureSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const FeatureSettingsSection = ({ renderSectionHeader }: FeatureSettingsSectionProps) => {
	const {
		enableCheckpointsSetting,
		hooksEnabled,
		mcpDisplayMode,
		useAutoCondense,
		compactionStrategy,
		userContextCeiling,
		webSearchEnabled,
		subagentsEnabled,
		worktreesEnabled,
		backgroundEditEnabled,
		showFeatureTips,
		cloudSessionsAvailable,
		cloudSessionsEnabled,
		beforeModelCheckpointEnabled,
		beforeModelCheckpointText,
		beforeModelCheckpointInterval,
	} = useExtensionState()

	// ACT-CLINEMM-USER-CONTEXT-CEILING01: local input state for the ceiling
	// text field. Empty string = Auto (undefined); a positive integer is
	// persisted verbatim. The backend rejects invalid values; we just track
	// the user's text input.
	const [ceilingInput, setCeilingInput] = useState<string>(userContextCeiling !== undefined ? String(userContextCeiling) : "")
	const [ceilingError, setCeilingError] = useState<string | null>(null)
	// Sync local input when the persisted state changes (e.g. on first mount
	// or when the user reverts to Auto elsewhere).
	useEffect(() => {
		setCeilingInput(userContextCeiling !== undefined ? String(userContextCeiling) : "")
		setCeilingError(null)
	}, [userContextCeiling])

	const handleCeilingBlur = () => {
		const trimmed = ceilingInput.trim()
		if (trimmed === "") {
			// ACT-CLINEMM-USER-CONTEXT-CEILING01-CORRECTION01: Empty -> Auto.
			// The clear path uses the explicit `clearUserContextCeiling`
			// sibling field instead of `userContextCeiling = undefined`,
			// because proto3 cannot distinguish "explicitly cleared" from
			// "field absent" on a single-value field. The backend handler
			// deletes the persisted key when this boolean is true.
			updateSetting("clearUserContextCeiling", true)
			setCeilingError(null)
			return
		}
		const parsed = Number(trimmed)
		if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
			setCeilingError("Enter a positive integer token count, or leave blank for Auto.")
			// Revert to last persisted value on invalid input.
			setCeilingInput(userContextCeiling !== undefined ? String(userContextCeiling) : "")
			return
		}
		setCeilingError(null)
		updateSetting("userContextCeiling", parsed)
	}

	const handleCeilingChange = (event: Event) => {
		const target = event.target as HTMLInputElement
		setCeilingInput(target.value)
	}

	// ACT-CLINEMM-BEFOREMODEL-OPERATOR-CHECKPOINT-01: local input state for
	// the operator checkpoint. The values are only persisted when the
	// operator presses "Save" — an explicit apply action — so a half-typed
	// prompt is never written to disk.
	const [checkpointTextInput, setCheckpointTextInput] = useState<string>(beforeModelCheckpointText ?? "")
	const [checkpointIntervalInput, setCheckpointIntervalInput] = useState<string>(
		beforeModelCheckpointInterval !== undefined ? String(beforeModelCheckpointInterval) : "4",
	)
	const [checkpointError, setCheckpointError] = useState<string | null>(null)
	const [checkpointSaved, setCheckpointSaved] = useState(false)
	const [checkpointSaving, setCheckpointSaving] = useState(false)

	// Re-sync the inputs when the persisted state changes (first mount,
	// a reload, or an explicit revert elsewhere). The saved prompt text is
	// PRESERVED when the toggle is disabled — disabling never destroys it.
	useEffect(() => {
		setCheckpointTextInput(beforeModelCheckpointText ?? "")
		setCheckpointIntervalInput(beforeModelCheckpointInterval !== undefined ? String(beforeModelCheckpointInterval) : "4")
		setCheckpointError(null)
		setCheckpointSaved(false)
	}, [beforeModelCheckpointText, beforeModelCheckpointInterval])

	const handleCheckpointToggle = (checked: boolean) => {
		setCheckpointSaved(false)
		updateSetting("beforeModelCheckpointEnabled", checked)
	}

	const handleCheckpointTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
		setCheckpointTextInput(event.target.value)
		setCheckpointSaved(false)
	}

	const handleCheckpointIntervalChange = (event: Event) => {
		const target = event.target as HTMLInputElement
		setCheckpointIntervalInput(target.value)
		setCheckpointSaved(false)
	}

	const handleCheckpointSave = async () => {
		const text = checkpointTextInput
		if (text.length > BEFORE_MODEL_CHECKPOINT_MAX_TEXT_LENGTH) {
			setCheckpointError(
				`The checkpoint text must be at most ${BEFORE_MODEL_CHECKPOINT_MAX_TEXT_LENGTH} characters (currently ${text.length}).`,
			)
			setCheckpointSaved(false)
			return
		}
		const trimmedInterval = checkpointIntervalInput.trim()
		const parsedInterval = Number(trimmedInterval)
		const normalizedInterval = normalizeBeforeModelCheckpointInterval(parsedInterval)
		if (trimmedInterval === "" || normalizedInterval === undefined) {
			setCheckpointError("Enter a positive whole number of completed tool-using turns.")
			setCheckpointSaved(false)
			return
		}
		setCheckpointError(null)
		setCheckpointSaving(true)
		try {
			// ONE request carrying BOTH values.
			//
			// The host validates every supplied field before applying any of
			// them, so a single request is atomic: the text and the interval
			// are persisted together or not at all. Two separate requests
			// would not be atomic.
			//
			// The RPC is AWAITED and the "Saved" indicator is only shown
			// after the host acknowledges the write. The `updateSetting`
			// helper swallows asynchronous failures (it only logs them), so
			// it cannot be used to gate a success indicator.
			await StateServiceClient.updateSettings(
				UpdateSettingsRequest.create({
					beforeModelCheckpointText: text,
					beforeModelCheckpointInterval: normalizedInterval,
				}),
			)
			setCheckpointSaved(true)
		} catch (error) {
			// The write did NOT happen. Do not claim it did.
			console.error("Failed to save the before model checkpoint:", error)
			setCheckpointSaved(false)
			setCheckpointError(
				error instanceof Error && error.message
					? `Could not save the checkpoint: ${error.message}`
					: "Could not save the checkpoint.",
			)
		} finally {
			setCheckpointSaving(false)
		}
	}

	// State lookup for mapped features
	const featureState: Record<string, boolean | undefined> = {
		showFeatureTips,
		enableCheckpointsSetting,
		hooksEnabled,
		useAutoCondense,
		subagentsEnabled,
		worktreesEnabled: worktreesEnabled?.user,
		backgroundEditEnabled,
	}

	// Visibility lookup for features with feature flags
	const featureVisibility: Record<string, boolean | undefined> = {
		worktreesEnabled: worktreesEnabled?.featureFlag,
	}

	return (
		<div className="mb-2">
			{renderSectionHeader("features")}
			<Section>
				<div className="mb-5 flex flex-col gap-3">
					{/* Core features */}
					<div>
						<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider mb-3">Agent</div>
						<div
							className="relative p-3 pt-0 my-3 rounded-md border border-editor-widget-border/50"
							id="agent-features">
							{agentFeatures.map((feature) => (
								<FeatureRow
									checked={featureState[feature.stateKey]}
									description={feature.description}
									id={feature.id}
									isVisible={featureVisibility[feature.stateKey] ?? true}
									key={feature.id}
									label={feature.label}
									onChange={(checked) => updateSetting(feature.settingKey, checked)}
								/>
							))}
							<div className="space-y-2 py-3">
								<Label className="text-sm font-medium text-foreground">Auto Compact Strategy</Label>
								<p className="text-xs text-muted-foreground">Controls how auto compaction rewrites context.</p>
								<Select
									disabled={!useAutoCondense}
									onValueChange={(value) => updateSetting("compactionStrategy", value)}
									value={compactionStrategy ?? "agentic"}>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="basic">Basic</SelectItem>
										<SelectItem value="agentic">Agentic</SelectItem>
									</SelectContent>
								</Select>
							</div>
							{/* ACT-CLINEMM-USER-CONTEXT-CEILING01: user-controlled effective
							    context/input ceiling. Empty = Auto (canonical model/provider
							    effective input capacity). A positive integer token count
							    lowers the operating capacity that drives auto-compaction.
							    It can never expand the model/provider limit. */}
							<div className="space-y-2 py-3">
								<Label className="text-sm font-medium text-foreground" htmlFor="user-context-ceiling">
									Context ceiling
								</Label>
								<p className="text-xs text-muted-foreground">
									Auto uses the model/provider limit. Set a lower ceiling to compact earlier on very
									large-context models.
								</p>
								<VSCodeTextField
									className="w-full"
									id="user-context-ceiling"
									onBlur={handleCeilingBlur}
									onChange={(event) => handleCeilingChange(event as Event)}
									placeholder="Auto (leave blank)"
									value={ceilingInput}
								/>
								{ceilingError && (
									<div className="text-(--vscode-errorForeground) text-xs mt-1">{ceilingError}</div>
								)}
							</div>
							<FeatureRow
								checked={webSearchEnabled}
								description="Let the model search the web when the selected provider and model support it. Applies to new tasks."
								label="Web Search"
								onChange={(checked) => updateSetting("webSearchEnabled", checked)}
							/>
							<FeatureRow
								checked={cloudSessionsEnabled}
								description="Run Cline on your GitHub repositories in secure cloud sandboxes. Adds a Cloud option to the new task composer. Requires a Cline account with GitHub connected."
								id="cloud-sessions"
								isVisible={!!cloudSessionsAvailable}
								label="Cloud"
								onChange={(checked) => updateSetting("cloudSessionsEnabled", checked)}
							/>
						</div>
					</div>

					{/* Editor features */}
					<div>
						<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider mb-3">Editor</div>
						<div
							className="relative p-3 pt-0 my-3 rounded-md border border-editor-widget-border/50"
							id="optional-features">
							{editorFeatures.map((feature) => (
								<FeatureRow
									checked={featureState[feature.stateKey]}
									description={feature.description}
									id={feature.id}
									isVisible={featureVisibility[feature.stateKey] ?? true}
									key={feature.id}
									label={feature.label}
									onChange={(checked) => updateSetting(feature.settingKey, checked)}
								/>
							))}
						</div>
					</div>
				</div>

				{/* Advanced */}
				<div>
					<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider mb-3">Advanced</div>
					<div className="relative p-3 my-3 rounded-md border border-editor-widget-border/50" id="advanced-features">
						<div className="space-y-3">
							{advancedFeatures.map((feature) => (
								<FeatureRow
									checked={featureState[feature.stateKey]}
									description={feature.description}
									id={feature.id}
									isVisible={featureVisibility[feature.stateKey] ?? true}
									key={feature.id}
									label={feature.label}
									onChange={(checked) => updateSetting(feature.settingKey, checked)}
								/>
							))}

							{/* ACT-CLINEMM-BEFOREMODEL-OPERATOR-CHECKPOINT-01: the
							    operator checkpoint. It is SUBORDINATE to the Hooks
							    feature above: switching Hooks off makes this feature
							    ineffective without deleting the saved prompt text. */}
							<div
								className="space-y-3 rounded-xs border border-editor-widget-border/50 px-3 py-3"
								id="before-model-checkpoint-settings">
								<div className="flex items-center justify-between w-full">
									<Label
										className="text-sm font-medium text-foreground"
										htmlFor={featureSettingControlId("before-model-checkpoint")}>
										Before Model Hook
									</Label>
									<Switch
										checked={beforeModelCheckpointEnabled ?? false}
										className="shrink-0"
										id={featureSettingControlId("before-model-checkpoint")}
										onCheckedChange={handleCheckpointToggle}
										size="lg"
									/>
								</div>
								<p className="text-xs text-muted-foreground">
									Injects a fixed prompt into the model request after every N completed tool-using turns.
									Applies to new tasks only — an active task keeps the configuration it started with. Requires
									the Hooks feature above.
								</p>
								<div className="space-y-2">
									<Label
										className="text-sm font-medium text-foreground"
										htmlFor="before-model-checkpoint-interval">
										Every N completed tool-using turns
									</Label>
									<VSCodeTextField
										className="w-full"
										id="before-model-checkpoint-interval"
										onChange={(event) => handleCheckpointIntervalChange(event as Event)}
										placeholder="4"
										value={checkpointIntervalInput}
									/>
								</div>
								<div className="space-y-2">
									<Label className="text-sm font-medium text-foreground" htmlFor="before-model-checkpoint-text">
										Checkpoint prompt
									</Label>
									<textarea
										className="w-full min-h-24 rounded-xs border border-editor-widget-border bg-editor-background px-2 py-1 text-sm text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder"
										id="before-model-checkpoint-text"
										maxLength={BEFORE_MODEL_CHECKPOINT_MAX_TEXT_LENGTH}
										onChange={handleCheckpointTextChange}
										placeholder="Summarise the work so far before continuing."
										value={checkpointTextInput}
									/>
								</div>
								<div className="flex items-center gap-3">
									<Button
										disabled={checkpointSaving}
										id={featureSettingControlId("before-model-checkpoint-save")}
										onClick={handleCheckpointSave}
										size="sm"
										variant="secondary">
										{checkpointSaving ? "Saving…" : "Save"}
									</Button>
									{checkpointSaved && !checkpointError && (
										<span className="text-xs text-description">Saved.</span>
									)}
								</div>
								{checkpointError && (
									<div
										className="text-(--vscode-errorForeground) text-xs mt-1"
										id="before-model-checkpoint-error">
										{checkpointError}
									</div>
								)}
							</div>

							{/* MCP Display Mode */}
							<div className="space-y-2">
								<Label className="text-sm font-medium text-foreground">MCP Display Mode</Label>
								<p className="text-xs text-muted-foreground">Controls how MCP responses are displayed</p>
								<Select onValueChange={(v) => updateSetting("mcpDisplayMode", v)} value={mcpDisplayMode}>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="plain">Plain Text</SelectItem>
										<SelectItem value="rich">Rich Display</SelectItem>
										<SelectItem value="markdown">Markdown</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>
					</div>
				</div>
			</Section>
		</div>
	)
}
export default memo(FeatureSettingsSection)
