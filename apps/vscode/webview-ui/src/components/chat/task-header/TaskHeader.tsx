import type {
	ClineMessage,
	TaskHeaderPresentationProjection,
	TaskHeaderTelemetryStrip,
	TurnState,
} from "@shared/ExtensionMessage"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import React, { useCallback, useLayoutEffect, useMemo, useState } from "react"
import Thumbnails from "@/components/common/Thumbnails"
import { getModeSpecificFields } from "@/components/settings/utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useNormalizedApiConfiguration } from "@/hooks/useNormalizedApiConfiguration"
import { useProviderUsageCostDisplay } from "@/hooks/useProviderUsageCostDisplay"
import { cn } from "@/lib/utils"
import { getEnvironmentColor } from "@/utils/environmentColors"
import CopyTaskButton from "./buttons/CopyTaskButton"
import DeleteTaskButton from "./buttons/DeleteTaskButton"
import NewTaskButton from "./buttons/NewTaskButton"
import OpenDiskConversationHistoryButton from "./buttons/OpenDiskConversationHistoryButton"
import ContextWindow from "./ContextWindow"
import { highlightText } from "./Highlights"
import TaskHeaderTelemetry from "./TaskHeaderTelemetry"
import TaskWorkingDirectoryBadge from "./TaskWorkingDirectoryBadge"

const IS_DEV = process.env.IS_DEV === "true"
interface TaskHeaderProps {
	task: ClineMessage
	tokensIn: number
	tokensOut: number
	doesModelSupportPromptCache: boolean
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
	// ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01 (CORRECTION01): provider-normalized
	// context-input token count of the last request (uncached + cacheReads +
	// cacheWrites) — drives the ContextWindow occupancy bar. Distinct from
	// `lastApiReqTotalTokens` (input + output + cache), which is suitable only
	// for cost / activity telemetry.
	lastApiReqContextInputTokens?: number
	lastApiReqTotalTokens?: number
	// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
	// (twenty-first-pass) — Boundary 5: the
	// runtime-published current working-context estimate
	// (W) from `ExtensionState.currentWorkingContext
	// Estimate`. Distinct from `lastApiReqContextInputTokens`.
	// When W is a number, the ContextWindow bar numerator
	// uses W. When W is `null` (runtime-cleared), the bar
	// is unavailable. When W is `undefined` (legacy path),
	// the bar falls back to P. See
	// `apps/vscode/webview-ui/src/components/chat/task-header/
	// ContextWindow.tsx` for the full precedence rules.
	currentWorkingContextEstimate?: number | null
	onClose: () => void
	onSendMessage?: (command: string, files: string[], images: string[]) => void
	// ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A: host-owned task telemetry
	// (elapsed / tool / recovery) projected from the canonical
	// `taskTelemetry` state field. Optional for backward compatibility
	// with classic/legacy state — when absent the strip renders "—".
	taskTelemetry?: TaskHeaderTelemetryStrip
	// ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01:
	// host-owned TaskHeader state projection (three-source precedence:
	// host compaction override / canonical shadow / legacy fallback).
	// The TaskHeader state label consumes this projection in
	// preference to `turnState.phase`. Optional for backward
	// compatibility — when absent the strip falls back to the legacy
	// `turnState.phase` derivation.
	taskHeaderPresentation?: TaskHeaderPresentationProjection
	turnState?: TurnState
	/**
	 * ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01:
	 * + ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-DIAGNOSABILITY01:
	 * Effective diagnostic-knob state from the host (V / I / A / P / D).
	 * When at least one knob is ON, the indicator renders the active
	 * letters in canonical order (e.g. `"VIAPD"` for the dogfood
	 * initial render after D landed); when absent or all OFF (the
	 * public default), the indicator is hidden.
	 */
	diagnosticKnobs?: {
		readonly v: boolean
		readonly i: boolean
		readonly a: boolean
		readonly p: boolean
		readonly d: boolean
	}
}

const BUTTON_CLASS = "max-h-3 border-0 font-bold bg-transparent hover:opacity-100 text-foreground"

const TaskHeader: React.FC<TaskHeaderProps> = ({
	task,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
	totalCost,
	lastApiReqContextInputTokens,
	lastApiReqTotalTokens,
	// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
	// (twenty-first-pass): Boundary 5 — W propagates
	// from ChatView -> TaskSection -> TaskHeader ->
	// ContextWindow.
	currentWorkingContextEstimate,
	onClose,
	onSendMessage,
	taskTelemetry: taskTelemetryProp,
	taskHeaderPresentation: taskHeaderPresentationProp,
	turnState: turnStateProp,
	diagnosticKnobs: diagnosticKnobsProp,
}) => {
	const {
		apiConfiguration,
		currentTaskItem,
		mode,
		expandTaskHeader: isTaskExpanded,
		setExpandTaskHeader: setIsTaskExpanded,
		environment,
		workspaceRoots,
		platform,
		turnState: turnStateFromContext,
		taskTelemetry: taskTelemetryFromContext,
		taskHeaderPresentation: taskHeaderPresentationFromContext,
		diagnosticKnobs: diagnosticKnobsFromContext,
	} = useExtensionState()

	// ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A: prefer the prop if provided
	// (enables pure component testing), otherwise read the canonical
	// host-owned projection from the extension state.
	const turnState = turnStateProp ?? turnStateFromContext
	const taskTelemetry = taskTelemetryProp ?? taskTelemetryFromContext
	// ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01: same
	// preference pattern for the new TaskHeader presentation projection.
	const taskHeaderPresentation = taskHeaderPresentationProp ?? taskHeaderPresentationFromContext
	// ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01:
	// Effective diagnostic-knob state. Host-owned; projected via
	// `useExtensionState()` (which extends the wire `ExtensionState`
	// type). The TaskHeader telemetry strip renders the active
	// letters when at least one knob is ON; in public (all OFF) the
	// indicator is hidden.
	const diagnosticKnobs = diagnosticKnobsProp ?? diagnosticKnobsFromContext

	const [isHighlightedTextExpanded, setIsHighlightedTextExpanded] = useState(false)
	const [isTextOverflowing, setIsTextOverflowing] = useState(false)
	const highlightedTextRef = React.useRef<HTMLDivElement>(null)

	const highlightedText = useMemo(() => highlightText(task.text, false), [task.text])

	// Check if text overflows the container (i.e., needs clamping)
	useLayoutEffect(() => {
		const el = highlightedTextRef.current
		if (el && isTaskExpanded && !isHighlightedTextExpanded) {
			// Check if content height exceeds the max-height
			setIsTextOverflowing(el.scrollHeight > el.clientHeight)
		}
	}, [task.text, isTaskExpanded, isHighlightedTextExpanded])

	// Handle click outside to collapse
	React.useEffect(() => {
		if (!isHighlightedTextExpanded) {
			return
		}

		const handleClickOutside = (event: MouseEvent) => {
			if (highlightedTextRef.current && !highlightedTextRef.current.contains(event.target as Node)) {
				setIsHighlightedTextExpanded(false)
			}
		}

		document.addEventListener("mousedown", handleClickOutside)
		return () => document.removeEventListener("mousedown", handleClickOutside)
	}, [isHighlightedTextExpanded])

	// Simplified computed values
	const { selectedModelInfo } = useNormalizedApiConfiguration(mode)
	const modeFields = getModeSpecificFields(apiConfiguration, mode)

	// Local providers report no cost; the openai-compatible provider can
	// report cost only when the user has supplied both prices. For every
	// other provider, the SDK is the source of truth for whether to render
	// per-task cost: any `metadata.usageCostDisplay` other than "show" —
	// "hide", or "subscription" for flat-rate providers like ClinePass and
	// ChatGPT Plus/Pro where the computed figure would be an API-rate
	// estimate rather than a real charge — suppresses the cost here. This
	// mirrors the CLI's `shouldShowCliUsageCost` consumer and removes the
	// previous extension-side hard-coded "openai-codex" check.
	//
	// ACT-CLINEMM-COST-DISPLAY-TRUTH01: the gate now also filters out
	// `"subscription"` billing modes (e.g. ClinePass), whose
	// token-derived reference prices are NOT the user's actual per-task
	// spend. The webview must only render the price-tag when the SDK
	// confirms the provider is genuinely metered (i.e. `=== "show"`).
	const usageCostDisplay = useProviderUsageCostDisplay(modeFields.apiProvider)
	const isCostAvailable =
		(totalCost &&
			modeFields.apiProvider === "openai" &&
			modeFields.openAiModelInfo?.inputPrice &&
			modeFields.openAiModelInfo?.outputPrice) ||
		(modeFields.apiProvider !== "vscode-lm" &&
			modeFields.apiProvider !== "ollama" &&
			modeFields.apiProvider !== "lmstudio" &&
			usageCostDisplay === "show")

	// Event handlers
	const toggleTaskExpanded = useCallback(() => setIsTaskExpanded(!isTaskExpanded), [setIsTaskExpanded, isTaskExpanded])

	const environmentBorderColor = getEnvironmentColor(environment, "border")

	return (
		<div className="py-2 px-4 flex flex-col gap-2">
			{/* Task Header */}
			<div
				className={cn(
					"relative overflow-hidden cursor-pointer rounded-sm flex flex-col gap-1.5 z-10 pt-2 pb-2 px-2 hover:opacity-100 bg-(--vscode-toolbar-hoverBackground)/65",
					{
						"opacity-100 border-1": isTaskExpanded, // No hover effects when expanded, add border
						"hover:bg-toolbar-hover border-1": !isTaskExpanded, // Hover effects only when collapsed
					},
				)}
				style={{
					borderColor: environmentBorderColor,
				}}>
				{/* Task Title */}
				<div
					aria-label={isTaskExpanded ? "Collapse task header" : "Expand task header"}
					className="flex justify-between items-center cursor-pointer"
					onClick={toggleTaskExpanded}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault()
							e.stopPropagation()
							toggleTaskExpanded()
						}
					}}
					tabIndex={0}>
					<div className="flex justify-between items-center">
						{isTaskExpanded ? <ChevronDownIcon size="16" /> : <ChevronRightIcon size="16" />}
						{isTaskExpanded && (
							<div className="mt-1 flex justify-end cursor-pointer opacity-80 gap-2 mx-2">
								<CopyTaskButton className={BUTTON_CLASS} taskText={task.text} />
								<DeleteTaskButton
									className={BUTTON_CLASS}
									taskId={currentTaskItem?.id}
									taskSize={currentTaskItem?.size}
								/>
								{/* Only visible in development mode */}
								{IS_DEV && (
									<OpenDiskConversationHistoryButton className={BUTTON_CLASS} taskId={currentTaskItem?.id} />
								)}
							</div>
						)}
					</div>
					{/* ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A: compact telemetry strip
						(elapsed / state / tool count / recovery interventions).
						Always visible in both collapsed and expanded states so the
						user has a stable, faithful lifecycle surface. Renders "-"
						when the host has no canonical telemetry on the wire. */}
					<div className="flex items-center justify-between gap-2 mt-0.5">
						<TaskHeaderTelemetry
							diagnosticKnobs={diagnosticKnobs}
							taskHeaderPresentation={taskHeaderPresentation}
							telemetry={taskTelemetry}
							turnState={turnState}
						/>
					</div>
					<div className="flex items-center select-none grow min-w-0 gap-1 justify-between">
						{!isTaskExpanded && (
							<div className="whitespace-nowrap overflow-hidden text-ellipsis grow min-w-0">
								<span className="ph-no-capture text-base">{highlightedText}</span>
							</div>
						)}
					</div>
					<div className="inline-flex items-center justify-end select-none shrink-0">
						<TaskWorkingDirectoryBadge
							platform={platform}
							taskCwd={currentTaskItem?.cwdOnTaskInitialization}
							workspaceRoots={workspaceRoots}
						/>
						{isCostAvailable && (
							<div
								className="mx-1 px-1 py-0.25 rounded-full inline-flex shrink-0 text-badge-background bg-badge-foreground/80 items-center"
								id="price-tag">
								<span className="text-xs sm:text-sm">${totalCost?.toFixed(4)}</span>
							</div>
						)}
						<NewTaskButton className={BUTTON_CLASS} onClick={onClose} />
					</div>
				</div>

				{/* Expand/Collapse Task Details */}
				{isTaskExpanded && (
					<div className="flex flex-col break-words" key={`task-details-${currentTaskItem?.id}`}>
						<div
							className={cn(
								"ph-no-capture whitespace-pre-wrap break-words px-0.5 text-sm mt-1 relative",
								"max-h-[4.5rem] overflow-hidden",
								{
									"max-h-[25vh] overflow-y-auto scroll-smooth": isHighlightedTextExpanded,
									"cursor-pointer": isTextOverflowing,
								},
							)}
							onClick={() => isTextOverflowing && setIsHighlightedTextExpanded(true)}
							ref={highlightedTextRef}
							style={
								!isHighlightedTextExpanded && isTextOverflowing
									? {
											WebkitMaskImage: "linear-gradient(to bottom, black 60%, transparent 100%)",
											maskImage: "linear-gradient(to bottom, black 60%, transparent 100%)",
										}
									: undefined
							}>
							{highlightedText}
						</div>

						{((task.images && task.images.length > 0) || (task.files && task.files.length > 0)) && (
							<Thumbnails files={task.files ?? []} images={task.images ?? []} />
						)}

						<ContextWindow
							cacheReads={cacheReads}
							cacheWrites={cacheWrites}
							contextWindow={selectedModelInfo?.contextWindow}
							// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
							// (twenty-first-pass): Boundary 5 — pass W
							// (runtime-published currentWorkingContext
							// Estimate) to ContextWindow so the bar
							// numerator uses W (when defined) instead
							// of P (lastApiReqContextInputTokens).
							currentWorkingContextEstimate={currentWorkingContextEstimate}
							lastApiReqContextInputTokens={lastApiReqContextInputTokens}
							lastApiReqTotalTokens={lastApiReqTotalTokens}
							onSendMessage={onSendMessage}
							tokensIn={tokensIn}
							tokensOut={tokensOut}
							useAutoCondense={false} // Disable auto-condense configuration in UI for now
						/>
					</div>
				)}
			</div>
		</div>
	)
}

export default TaskHeader
