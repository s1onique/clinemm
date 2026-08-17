import type { ClineMessage, ClineSayTool, TurnState } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import type { LucideIcon } from "lucide-react"
import type React from "react"
import { useContext, useMemo } from "react"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"
import { cleanPathPrefix } from "../common/CodeAccordian"

/**
 * Read `turnState` from the global `ExtensionStateContext` without
 * throwing when the provider is missing. The throwing variant
 * (`useExtensionState`) is fine for production call sites that are
 * always mounted inside the webview; the unit tests for this component
 * thread `turnState` as a prop and intentionally do not mount the
 * provider, so a missing-provider-tolerant reader is required.
 */
function useOptionalTurnState(): TurnState | undefined {
	const ctx = useContext(ExtensionStateContext)
	return ctx?.turnState
}

import { getIconByToolName } from "./chat-view"
import { isApiReqAbsorbable, isLowStakesTool } from "./chat-view/utils/messageUtils"
import ErrorRow from "./ErrorRow"
import { ThinkingRow } from "./ThinkingRow"
import { TypewriterText } from "./TypewriterText"

interface RequestStartRowProps {
	message: ClineMessage
	apiRequestFailedMessage?: string
	apiReqStreamingFailedMessage?: string
	cost?: number
	reasoningContent?: string
	responseStarted?: boolean
	clineMessages: ClineMessage[]
	mode?: Mode
	classNames?: string
	isExpanded: boolean
	handleToggle: () => void
	/**
	 * Authoritative UI turn phase, consumed from
	 * `ExtensionStateContext` in production. Tests may inject it
	 * directly via this prop.
	 *
	 * When neither the prop nor the provider value is available,
	 * the component conservatively treats the turn as
	 * non-streaming (the shimmer is hidden). It never falls back
	 * to the message-tail-derived heuristic: the whole point of
	 * C04-CORRECTION04 is that "I have reasoning text in the
	 * buffer" is not evidence of an in-flight turn.
	 */
	turnState?: TurnState
}

// State type for api_req_started rendering
type ApiReqState = "pre" | "thinking" | "error" | "final"

// Helper to format search regex for display - show all terms separated by |
const formatSearchRegex = (regex: string, path: string, filePattern?: string): string => {
	const cleanedPath = cleanPathPrefix(path)
	const pathDisplay = cleanedPath ? `${cleanedPath}/` : "codebase"
	const terms = regex
		.split("|")
		.map((t) => t.trim().replace(/\\b/g, "").replace(/\\s\?/g, " "))
		.filter(Boolean)
		.join(" | ")
	return filePattern && filePattern !== "*" ? `"${terms}" in ${pathDisplay} (${filePattern})` : `"${terms}" in ${pathDisplay}`
}
// Format activity text based on tool type
const getActivityText = (tool: ClineSayTool): string | null => {
	const cleanedPath = cleanPathPrefix(tool.path || "")
	switch (tool.tool) {
		case "readFile":
			return tool.path ? `Reading ${cleanedPath}...` : null
		case "listFilesTopLevel":
		case "listFilesRecursive":
			return tool.path ? `Exploring ${cleanedPath}/...` : null
		case "searchFiles":
			return tool.regex ? `Searching ${formatSearchRegex(tool.regex, tool.path || "", tool.filePattern)}...` : null
		case "listCodeDefinitionNames":
			return tool.path ? `Analyzing ${cleanedPath}/...` : null
		default:
			return null
	}
}

// Collect tools in a given range, with optional stop condition
const collectToolsInRange = (
	messages: ClineMessage[],
	startIdx: number,
	endIdx: number,
	stopCondition?: (msg: ClineMessage) => boolean,
): { icon: LucideIcon; text: string }[] => {
	const activities: { icon: LucideIcon; text: string }[] = []

	for (let i = startIdx; i < endIdx; i++) {
		const msg = messages[i]

		if (stopCondition?.(msg)) {
			break
		}

		// Only collect tools that are currently executing (ask === "tool")
		// Skip completed tools (say === "tool") - they should be in the completed list
		if (msg.say === "tool" || msg.ask !== "tool") {
			continue
		}

		try {
			const tool = JSON.parse(msg.text || "{}") as ClineSayTool
			const activityText = getActivityText(tool)
			if (activityText) {
				const toolIcon = getIconByToolName(tool.tool)
				activities.push({ icon: toolIcon, text: activityText })
			}
		} catch {
			// ignore parse errors
		}
	}
	return activities
}

// Find current api_req and determine if it has cost
const findCurrentApiReq = (messages: ClineMessage[]): { index: number; hasCost: boolean } | null => {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.say === "api_req_started" && msg.text) {
			try {
				const info = JSON.parse(msg.text)
				return { index: i, hasCost: info.cost != null }
			} catch {
				return null
			}
		}
	}
	return null
}

// Find the most recent completed api_req before the given index
const findPrevCompletedApiReq = (messages: ClineMessage[], beforeIdx: number): number => {
	for (let i = beforeIdx - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.say === "api_req_started" && msg.text) {
			try {
				const info = JSON.parse(msg.text)
				if (info.cost != null) {
					return i
				}
			} catch {
				// ignore parse errors
			}
		}
	}
	return -1
}

/**
 * Displays the current state of an active tool operation,
 */
export const RequestStartRow: React.FC<RequestStartRowProps> = ({
	apiRequestFailedMessage,
	apiReqStreamingFailedMessage,
	cost,
	reasoningContent,
	responseStarted,
	clineMessages,
	mode,
	handleToggle,
	isExpanded,
	message,
	turnState: turnStateProp,
}) => {
	// ACT-CLINEMM-DOGFOOD-CORRECTION04-CORRECTION04:
	//
	// The legacy `RequestStartRow` shimmer rendered below (line ~234)
	// was driven entirely by message-tail inference
	// (`reasoningContent && !hasCost`). The installed build exposed
	// this divergence: the Task Header correctly read
	// `turnState.phase !== "streaming"` (via `TaskHeaderTelemetry` /
	// `taskHeaderStateLabel`) but the in-list "Thinking..." shimmer
	// kept rendering — the assistant's final report was already
	// visible AND the shimmer was still animating.
	//
	// Migration: the canonical authority is `turnState.phase`. When
	// the prop is provided (the production MessagesArea path), the
	// shimmer is suppressed for every non-streaming phase. We only
	// call `useExtensionState` as a fallback when the prop is
	// undefined (legacy test harnesses that don't yet thread the
	// prop) so existing unit tests don't need a context provider.
	// Always read the context — the rule of hooks — but tolerate a
	// missing provider (unit tests that thread the prop directly).
	const turnStateFromContext = useOptionalTurnState()
	const turnState = turnStateProp ?? turnStateFromContext
	const turnStateIsStreaming = turnState?.phase === "streaming"
	// Derive explicit state
	const hasError = !!(apiRequestFailedMessage || apiReqStreamingFailedMessage)
	const hasCost = cost != null
	const hasReasoning = !!reasoningContent
	const hasCompletionResult = clineMessages.some(
		(msg) =>
			msg.ask === "completion_result" ||
			msg.say === "completion_result" ||
			msg.say === "plan_completion_result" ||
			msg.ask === "plan_mode_respond",
	)

	const apiReqState: ApiReqState = hasError ? "error" : hasCost ? "final" : hasReasoning ? "thinking" : "pre"

	// While reasoning is streaming, keep the Brain ThinkingBlock exactly as-is.
	// Once response content starts (any text/tool/command), collapse into a compact
	// "🧠 Thinking" row that can be expanded to show the reasoning only.
	const showStreamingThinking = useMemo(
		() => hasReasoning && !hasError && !cost && !responseStarted,
		[hasReasoning, hasError, cost, responseStarted],
	)

	// Check if this api_req will be absorbed into a tool group (reasoning will disappear)
	const willBeAbsorbed = useMemo(() => {
		return isApiReqAbsorbable(message.ts, clineMessages)
	}, [message.ts, clineMessages])

	// Find all exploratory tool activities that are currently in flight.
	// Tools come AFTER the api_req_started message, so we look from currentApiReq forward.
	const currentActivities = useMemo(() => {
		const currentApiReq = findCurrentApiReq(clineMessages)
		if (!currentApiReq) {
			return []
		}

		if (!currentApiReq.hasCost) {
			// CASE A: Current api_req is INCOMPLETE
			// Look for ask === "tool" messages AFTER the current api_req_started
			return collectToolsInRange(clineMessages, currentApiReq.index + 1, clineMessages.length)
		}
		// CASE B: Current api_req is COMPLETE - no activities to show
		return []
	}, [clineMessages])

	// Check if there are any completed tools in the tool group
	const hasCompletedTools = useMemo(() => {
		// Look for any completed low-stakes tool messages that would be in a tool group
		return clineMessages.some((msg, idx) => {
			if (msg.say === "tool" && isLowStakesTool(msg)) {
				// Check if this tool is from a completed API request
				// (looking backwards for an api_req with cost)
				for (let i = idx - 1; i >= 0; i--) {
					const prevMsg = clineMessages[i]
					if (prevMsg.say === "api_req_started" && prevMsg.text) {
						try {
							const info = JSON.parse(prevMsg.text)
							return info.cost != null
						} catch {
							return false
						}
					}
				}
			}
			return false
		})
	}, [clineMessages])

	// Only show currentActivities if there are NO completed tools
	// (otherwise they'll be shown in the unified ToolGroupRenderer list)
	const shouldShowActivities = currentActivities.length > 0 && !hasCompletedTools

	// Initial loading ("Thinking..." before any content) is injected as a synthetic in-list
	// reasoning row in MessagesArea to avoid footer handoff flicker.

	return (
		<div>
			{apiReqState === "pre" && shouldShowActivities && (
				<div className="flex items-center text-description w-full text-sm">
					<div className="ml-1 flex-1 w-full h-full">
						<div className="flex flex-col gap-0.5 w-full min-h-1">
							{currentActivities.map((activity, _) => (
								<div className="flex items-center gap-2 h-auto w-full overflow-hidden" key={activity.text}>
									<activity.icon className="size-2 text-foreground shrink-0" />
									<TypewriterText speed={15} text={activity.text} />
								</div>
							))}
						</div>
					</div>
				</div>
			)}
			{reasoningContent &&
				(!hasCost ? (
					// Still streaming - show "Thinking..." text with shimmer.
					//
					// ACT-CLINEMM-DOGFOOD-CORRECTION04-CORRECTION04:
					// Gate the shimmer on the authoritative
					// `turnState.phase === "streaming"`. Without this
					// gate the in-list indicator kept rendering after
					// the model finished (the assistant's final report
					// was visible AND the shimmer still animated),
					// because the message-tail-only check
					// (`reasoningContent && !hasCost`) does not know
					// about terminal/resumable/error phases. The
					// canonical authority is `turnState.phase`, which
					// the same webview already uses for
					// `TaskHeaderTelemetry` and `useThinkingLoaderRow`.
					turnStateIsStreaming ? (
						<div className="ml-1 pl-0 mb-1 -mt-1.25 pt-1">
							<div className="inline-flex justify-baseline gap-0.5 text-left select-none px-0 w-full">
								<span className="animate-shimmer bg-linear-90 from-foreground to-description bg-[length:200%_100%] bg-clip-text text-transparent text-[13px] leading-none">
									Thinking...
								</span>
							</div>
						</div>
					) : null
				) : (
					// Complete - always show collapsible thinking section
					<ThinkingRow
						isExpanded={isExpanded}
						isVisible={true}
						onToggle={handleToggle}
						reasoningContent={reasoningContent}
						showTitle={true}
					/>
				))}

			{apiReqState === "error" && (
				<ErrorRow
					apiReqStreamingFailedMessage={apiReqStreamingFailedMessage}
					apiRequestFailedMessage={apiRequestFailedMessage}
					errorType="error"
					message={message}
				/>
			)}
		</div>
	)
}
