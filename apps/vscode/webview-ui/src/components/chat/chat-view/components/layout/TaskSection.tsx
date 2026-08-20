import type { ClineMessage, TaskHeaderTelemetryStrip, TurnState } from "@shared/ExtensionMessage"
import React from "react"
import TaskHeader from "@/components/chat/task-header/TaskHeader"
import { MessageHandlers } from "../../types/chatTypes"

interface TaskSectionProps {
	task: ClineMessage
	apiMetrics: {
		totalTokensIn: number
		totalTokensOut: number
		totalCacheWrites?: number
		totalCacheReads?: number
		totalCost: number
	}
	// ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01 (CORRECTION01): provider-normalized
	// context-input token count of the last request (uncached + cacheReads +
	// cacheWrites) — drives the TaskHeader's context-window occupancy bar.
	// Distinct from `lastApiReqTotalTokens` (input + output + cache), which is
	// suitable only for cost / activity telemetry.
	lastApiReqContextInputTokens?: number
	lastApiReqTotalTokens?: number
	selectedModelInfo: {
		supportsPromptCache: boolean
		supportsImages: boolean
	}
	messageHandlers: MessageHandlers
	// ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A: pass through the canonical
	// host-owned telemetry + TurnState so the TaskHeader can render
	// the truthful elapsed/tool/recovery strip without reaching into
	// chat history.
	taskTelemetry?: TaskHeaderTelemetryStrip
	turnState?: TurnState
}

/**
 * Task section shown when there's an active task
 * Includes the task header and manages task-specific UI
 */
export const TaskSection: React.FC<TaskSectionProps> = ({
	task,
	apiMetrics,
	lastApiReqContextInputTokens,
	lastApiReqTotalTokens,
	selectedModelInfo,
	messageHandlers,
	taskTelemetry,
	turnState,
}) => {
	return (
		<TaskHeader
			cacheReads={apiMetrics.totalCacheReads}
			cacheWrites={apiMetrics.totalCacheWrites}
			doesModelSupportPromptCache={selectedModelInfo.supportsPromptCache}
			lastApiReqContextInputTokens={lastApiReqContextInputTokens}
			lastApiReqTotalTokens={lastApiReqTotalTokens}
			onClose={messageHandlers.handleTaskCloseButtonClick}
			onSendMessage={messageHandlers.handleSendMessage}
			task={task}
			taskTelemetry={taskTelemetry}
			tokensIn={apiMetrics.totalTokensIn}
			tokensOut={apiMetrics.totalTokensOut}
			totalCost={apiMetrics.totalCost}
			turnState={turnState}
		/>
	)
}
