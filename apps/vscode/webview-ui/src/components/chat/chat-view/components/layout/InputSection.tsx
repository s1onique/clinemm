import { isCloudTargetReady } from "@shared/cloud/cloud-sessions"
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
		pendingResponse,
	} = chatState

	const { isAtBottom, scrollToBottomAuto } = scrollBehavior
	// ACT-CLINEMM-FORK-UPSTREAM-MERGE01: the fork reads `turnState` here to
	// derive `submitDisabled` from the runtime turn state; upstream reads the
	// cloud-session fields in a SECOND `useExtensionState()` call further down.
	// Two calls are legal, but the second one also redeclared `turnState` and
	// `submitDisabled`. The single destructuring below is the union of both
	// sides; the fork's `submitDisabled` derivation is kept (upstream's
	// cloud-aware variant is applied as an ADDITIONAL gate below).
	const { turnState, cloudSessionsEnabled, cloudTaskTarget, currentCloudTask, clineMessages = [] } = useExtensionState()
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
	// ACT-CLINEMM-FORK-UPSTREAM-MERGE01: renamed to distinguish the fork's
	// turn-state gate from upstream's cloud-aware gate (see `submitDisabledFinal`).
	const submitDisabledFromTurnState = sendingDisabled && !allowQueuedSubmit
	// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1-CORRECTION02:
	// Correlation-domain fix: the capture stamps `stateVersion` with the
	// wire-side ExtensionState.stateVersion (the SAME counter the push
	// boundary uses), NOT turnState.seq. The turnState.seq is preserved
	// as `legacySeq`. This keeps the push-boundary and component records
	// in one joinable domain.
	// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C2-CORRECTION01-REPLICA-TRUTH:
	// The capture now stamps `captureKind: "input-section"` (disambiguating
	// the input-section decisions from action-buttons / followup-route /
	// webview-replica captures) and propagates the wire-side `_ptadPushId`
	// verbatim so same-push correlation across the realm boundary holds
	// even when stateVersion is 0.
	const { stateVersion: wireStateVersion, _ptadPushId: wirePtadPushId } = useExtensionState()
	useEffect(() => {
		if (!isPostTerminalAuthorityDiagnosticEnabled("webview")) {
			return
		}
		recordPostTerminalAuthoritySnapshot({
			origin: "webview",
			captureKind: "input-section",
			stateVersion: wireStateVersion ?? 0,
			_ptadPushId: wirePtadPushId,
			capturedAt: Date.now(),
			legacyPhase: turnState?.phase,
			legacySeq: turnState?.seq,
			legacyAnchorTs: turnState?.anchorTs,
			chatReducerSendingDisabled: sendingDisabled,
			allowQueuedSubmit,
			submitDisabled: submitDisabledFromTurnState,
			// ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-LIVE-CAPTURE01:
			// Stamp the composer enabled predicate and message-tail identity at the
			// SAME committed object as sendingDisabled/allowQueuedSubmit/submitDisabled.
			// Pure additions; production semantics unchanged when default-off.
			composerEnabled: !submitDisabledFromTurnState,
			messageTail: lastMessage
				? {
						ts: lastMessage.ts,
						type: lastMessage.type,
						ask: lastMessage.type === "ask" ? lastMessage.ask : undefined,
						say: lastMessage.type === "say" ? lastMessage.say : undefined,
						partial: lastMessage.partial,
						seq: lastMessage.seq,
						epoch: lastMessage.epoch,
					}
				: undefined,
		})
	}, [
		turnState?.seq,
		turnState?.phase,
		turnState?.anchorTs,
		sendingDisabled,
		allowQueuedSubmit,
		submitDisabledFromTurnState,
		wireStateVersion,
		wirePtadPushId,
	])
	// `lastMessage` is destructured for type parity with the chat state surface; the field
	// is no longer part of the runtime-task inference.
	void lastMessage
	const legacyTaskRunning =
		turnState === undefined &&
		(lastMessage?.partial === true || (lastMessage?.type === "say" && lastMessage.say === "api_req_started"))
	const allowSubmitWhileDisabled =
		turnState?.phase === "streaming" ||
		turnState?.phase === "awaiting_approval" ||
		(messageHandlers.errorRecoveryAvailable && pendingResponse === undefined && !messageHandlers.recoveryActionInFlight) ||
		legacyTaskRunning
	const cloudSelectedForNewTask = clineMessages.length === 0 && !!cloudSessionsEnabled && cloudTaskTarget?.target === "cloud"
	// The task-target panel above the composer shows what is still missing.
	const cloudTargetIncomplete = cloudSelectedForNewTask && !isCloudTargetReady(cloudTaskTarget)
	// Local file paths cannot be read from a cloud sandbox. Refuse the send
	// rather than silently dropping the attachments from the request.
	const cloudFilesUnsupported = cloudSelectedForNewTask && selectedFiles.length > 0
	// A provisioning sandbox has no session to queue a follow-up on yet; the draft stays in the composer.
	const submitDisabledByCloud =
		(sendingDisabled && !allowSubmitWhileDisabled) ||
		cloudTargetIncomplete ||
		cloudFilesUnsupported ||
		currentCloudTask?.status === "provisioning"

	// ACT-CLINEMM-FORK-UPSTREAM-MERGE01: the fork's turn-state gate
	// (`allowsQueuedSubmit(turnState)`) and upstream's cloud-aware gate are
	// BOTH gates on the send button. Compose them instead of redeclaring the
	// binding (the naive merge emitted two `submitDisabled` declarations).
	const submitDisabled = submitDisabledByCloud || submitDisabledFromTurnState

	return (
		<>
			{cloudFilesUnsupported && (
				<p className="mx-[15px] mt-[10px] mb-0 text-[11px] leading-snug text-description" role="status">
					Attached files can't be sent to a cloud sandbox. Remove them, or mention them in the prompt and let the agent
					read them from the repository.
				</p>
			)}
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
