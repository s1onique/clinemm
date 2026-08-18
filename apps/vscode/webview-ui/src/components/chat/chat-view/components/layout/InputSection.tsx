import {
	isPostTerminalAuthorityDiagnosticEnabled,
	recordPostTerminalAuthoritySnapshot,
} from "@shared/post-terminal-authority-diagnostic"
import React, { useEffect } from "react"
import ChatTextArea from "@/components/chat/ChatTextArea"
import QuotedMessagePreview from "@/components/chat/QuotedMessagePreview"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { allowsQueuedSubmit } from "../../shared/turnStateSelectors"
import { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"

interface InputSectionProps {
	chatState: ChatState
	messageHandlers: MessageHandlers
	scrollBehavior: ScrollBehavior
	placeholderText: string
	shouldDisableFilesAndImages: boolean
	selectFilesAndImages: () => Promise<void>
}

/**
 * Input section including quoted message preview and chat text area
 */
export const InputSection: React.FC<InputSectionProps> = ({
	chatState,
	messageHandlers,
	scrollBehavior,
	placeholderText,
	shouldDisableFilesAndImages,
	selectFilesAndImages,
}) => {
	const {
		activeQuote,
		setActiveQuote,
		isTextAreaFocused,
		inputValue,
		setInputValue,
		sendingDisabled,
		selectedImages,
		setSelectedImages,
		selectedFiles,
		setSelectedFiles,
		textAreaRef,
		handleFocusChange,
		lastMessage,
	} = chatState

	const { isAtBottom, scrollToBottomAuto } = scrollBehavior
	const { turnState } = useExtensionState()
	// The composer is submittable while a turn is in flight. The source of truth is the
	// backend-owned `turnState` (streamed from `turnStateTracker` via `SdkController`),
	// which already covers "streaming" (model/tool running) and "awaiting_approval"
	// (tool/mcp/command approval pending). The previous `lastMessage.partial` /
	// `api_req_started` fallback was redundant prose-derived state and has been removed:
	// turnState is always present in the state payload (the SdkController sets
	// `turnStateTracker` at construction and includes `turnState: tracker.get()` in every
	// webview state push), so a `undefined` turnState is a missing-canonical-state
	// condition, not a license to parse messages. See `turnStateSelectors.ts` for the
	// pure projection and the regression suite (`turnStateSelectors.test.ts`) that pins it.
	const allowQueuedSubmit = allowsQueuedSubmit(turnState)
	// `sendingDisabled` is the lockout signal from the chat reducer; `allowQueuedSubmit`
	// overrides it ONLY when the runtime is mid-turn (queue the typed message instead of
	// dropping it). The boolean is identical to the pre-fix shape minus the legacy term:
	// the previous `legacyTaskRunning` was an `OR` short-circuit on `turnState === undefined`
	// and disappeared with that branch.
	const submitDisabled = sendingDisabled && !allowQueuedSubmit
	// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1-CORRECTION02:
	// Correlation-domain fix: the capture stamps `stateVersion` with the
	// wire-side ExtensionState.stateVersion (the SAME counter the push
	// boundary uses), NOT turnState.seq. The turnState.seq is preserved
	// as `legacySeq`. This keeps the push-boundary and component records
	// in one joinable domain.
	const { stateVersion: wireStateVersion } = useExtensionState()
	useEffect(() => {
		if (!isPostTerminalAuthorityDiagnosticEnabled("webview")) {
			return
		}
		recordPostTerminalAuthoritySnapshot({
			origin: "webview",
			stateVersion: wireStateVersion ?? 0,
			capturedAt: Date.now(),
			legacyPhase: turnState?.phase,
			legacySeq: turnState?.seq,
			legacyAnchorTs: turnState?.anchorTs,
			chatReducerSendingDisabled: sendingDisabled,
			allowQueuedSubmit,
			submitDisabled,
		})
	}, [
		turnState?.seq,
		turnState?.phase,
		turnState?.anchorTs,
		sendingDisabled,
		allowQueuedSubmit,
		submitDisabled,
		wireStateVersion,
	])
	// `lastMessage` is destructured for type parity with the chat state surface; the field
	// is no longer part of the runtime-task inference.
	void lastMessage

	return (
		<>
			{activeQuote && (
				<div style={{ marginBottom: "-12px", marginTop: "10px" }}>
					<QuotedMessagePreview
						isFocused={isTextAreaFocused}
						onDismiss={() => setActiveQuote(null)}
						text={activeQuote}
					/>
				</div>
			)}

			<ChatTextArea
				activeQuote={activeQuote}
				inputValue={inputValue}
				onFocusChange={handleFocusChange}
				onHeightChange={() => {
					if (isAtBottom) {
						scrollToBottomAuto()
					}
				}}
				onSelectFilesAndImages={selectFilesAndImages}
				onSend={() => messageHandlers.handleSendMessage(inputValue, selectedImages, selectedFiles)}
				placeholderText={placeholderText}
				ref={textAreaRef}
				selectedFiles={selectedFiles}
				selectedImages={selectedImages}
				sendingDisabled={submitDisabled}
				setInputValue={setInputValue}
				setSelectedFiles={setSelectedFiles}
				setSelectedImages={setSelectedImages}
				shouldDisableFilesAndImages={shouldDisableFilesAndImages}
			/>
		</>
	)
}
