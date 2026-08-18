import type { ClineMessage, TurnPhase } from "@shared/ExtensionMessage"
import {
	isPostTerminalAuthorityDiagnosticEnabled,
	recordPostTerminalAuthoritySnapshot,
} from "@shared/post-terminal-authority-diagnostic"
import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import { AskResponseRequest, NewTaskRequest } from "@shared/proto/cline/task"
import { IntentEvent } from "@shared/proto/cline/ui"
import { useCallback, useRef } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { SlashServiceClient, TaskServiceClient, UiServiceClient } from "@/services/grpc-client"
import type { ButtonActionType } from "../shared/buttonConfig"
import { turnAllowsFollowup } from "../shared/turnStateSelectors"
import type { ChatState, MessageHandlers } from "../types/chatTypes"

// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1-CORRECTION01:
// Local helper for the follow-up routing capture. Defined at module scope so
// the closure-captured `chatState` and `turnState` references stay stable
// across re-renders. The capture is OPT-IN.
function captureFollowupRoute(args: {
	route: string
	canSubmit: boolean
	hasPendingResponse: boolean
	hasPendingUserMessage: boolean
	turnStateSeq: number | undefined
	turnStatePhase: TurnPhase | undefined
	turnStateAnchorTs: number | undefined
	wireStateVersion: number | undefined
	wirePtadPushId: number | undefined
}) {
	if (!isPostTerminalAuthorityDiagnosticEnabled("webview")) {
		return
	}
	recordPostTerminalAuthoritySnapshot({
		origin: "webview",
		// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C2-CORRECTION01-REPLICA-TRUTH:
		// `captureKind: "followup-route"` disambiguates this decision from
		// input-section / action-buttons / webview-replica captures. Every
		// follow-up attempt (allowed AND blocked) emits exactly one record
		// so the per-attempt coverage gate can be enforced.
		captureKind: "followup-route",
		// Correlation-domain fix: stamp the wire-side
		// ExtensionState.stateVersion (same counter as the push boundary),
		// NOT turnState.seq. The turnState.seq is preserved as `legacySeq`.
		stateVersion: args.wireStateVersion ?? 0,
		_ptadPushId: args.wirePtadPushId,
		capturedAt: Date.now(),
		legacyPhase: args.turnStatePhase,
		legacySeq: args.turnStateSeq,
		legacyAnchorTs: args.turnStateAnchorTs,
		followupCanSubmit: args.canSubmit,
		followupRoute: args.route,
		pendingResponsePresent: args.hasPendingResponse,
		pendingUserMessagePresent: args.hasPendingUserMessage,
	})
}

/**
 * Custom hook for managing message handlers
 * Handles sending messages, button clicks, and task management
 */
export function useMessageHandlers(messages: ClineMessage[], chatState: ChatState): MessageHandlers {
	const {
		backgroundCommandRunning,
		turnState,
		stateVersion: wireStateVersion,
		_ptadPushId: wirePtadPushId,
	} = useExtensionState()
	const {
		setInputValue,
		activeQuote,
		setActiveQuote,
		setSelectedImages,
		setSelectedFiles,
		sendingDisabled,
		setSendingDisabled,
		enableButtons,
		setEnableButtons,
		pendingUserMessage,
		setPendingUserMessage,
		pendingResponse,
		setPendingResponse,
		clineAsk,
		lastMessage,
	} = chatState
	const cancelInFlightRef = useRef(false)
	const pendingResponseIdRef = useRef(0)

	// Handle sending a message
	const handleSendMessage = useCallback(
		async (text: string, images: string[], files: string[]) => {
			let messageToSend = text.trim()
			const hasContent = messageToSend || images.length > 0 || files.length > 0

			// Prepend the active quote if it exists
			if (activeQuote && hasContent) {
				const prefix = "[context] \n> "
				const formattedQuote = activeQuote
				const suffix = "\n[/context] \n\n"
				messageToSend = `${prefix} ${formattedQuote} ${suffix} ${messageToSend}`
			}

			// Intercept the built-in compaction commands when an active task exists.
			// `/compact` (and its aliases `/smol` and `/newtask`) must run a real
			// SDK manual compaction via the condense RPC — sending the literal
			// text to the model would make it improvise a fake summary instead of
			// compacting the context window (CLINE-2503). `/newtask` aliases
			// compaction because condensing achieves its goal (continue working
			// with a fresh, summarized context) without the legacy new_task tool.
			// With no active task there is nothing to compact, so fall through to
			// normal new-task handling.
			if (
				messages.length > 0 &&
				(messageToSend === "/compact" || messageToSend === "/smol" || messageToSend === "/newtask")
			) {
				// Clear the input before awaiting the RPC — condense resolves only
				// after compaction finishes, and the typed command lingering in the
				// field the whole time reads as if the send didn't register.
				setInputValue("")
				setActiveQuote(null)
				await SlashServiceClient.condense(StringRequest.create({ value: "compact" })).catch((err) =>
					console.error("Failed to compact task:", err),
				)
				if ("disableAutoScrollRef" in chatState) {
					;(chatState as any).disableAutoScrollRef.current = false
				}
				return
			}

			if (hasContent) {
				console.log("[ChatView] handleSendMessage - Sending message:", messageToSend)
				let messageSent = false
				const trackPromptSubmitted = (hasActiveTask: boolean) => {
					UiServiceClient.trackIntent(
						IntentEvent.create({
							action: "prompt_submitted",
							source: "chat_submit",
							hasText: messageToSend.length > 0,
							hasImages: images.length > 0,
							hasFiles: files.length > 0,
							hasActiveTask,
							textLength: messageToSend.length,
						}),
					).catch((error) => console.error("Failed to track prompt submit:", error))
				}
				const clearSentMessageState = () => {
					setInputValue("")
					setActiveQuote(null)
					setSendingDisabled(true)
					setSelectedImages([])
					setSelectedFiles([])
					setEnableButtons(false)
				}
				const restorePendingMessageState = () => {
					setInputValue(text)
					setActiveQuote(activeQuote)
					setSendingDisabled(sendingDisabled)
					setSelectedImages(images)
					setSelectedFiles(files)
					setEnableButtons(enableButtons)
				}
				const beginPendingResponse = (pendingMessage?: ClineMessage) => {
					const id = ++pendingResponseIdRef.current
					// A follow-up submitted during an active stream is queued/steering feedback.
					// The authoritative streaming UI is already current, so forcing a loader could
					// duplicate it alongside content that is still visibly streaming.
					if (turnState?.phase !== "streaming") {
						setPendingResponse({
							id,
							turnStateSeq: turnState?.seq,
							messageCount: messages.length,
						})
					}
					const optimisticMessage = pendingMessage
						? {
								afterTs: Math.max(0, ...messages.map((message) => message.ts)),
								message: pendingMessage,
							}
						: undefined
					if (optimisticMessage) {
						setPendingUserMessage(optimisticMessage)
					}
					return { id, optimisticMessage }
				}
				const rollbackPendingResponse = (
					id: number,
					optimisticMessage: ReturnType<typeof beginPendingResponse>["optimisticMessage"],
				) => {
					setPendingResponse((current) => (current?.id === id ? undefined : current))
					if (optimisticMessage) {
						setPendingUserMessage((current) => (current === optimisticMessage ? undefined : current))
					}
				}
				const sendAskResponseWithPendingState = async (
					request: ReturnType<typeof AskResponseRequest.create>,
					options: { showPendingMessage?: boolean } = {},
				) => {
					trackPromptSubmitted(true)
					clearSentMessageState()
					const { id, optimisticMessage } = beginPendingResponse(
						options.showPendingMessage
							? {
									ts: Date.now(),
									type: "say",
									say: "user_feedback",
									text: request.text ?? "",
									images: request.images,
									files: request.files,
									partial: false,
								}
							: undefined,
					)
					try {
						await TaskServiceClient.askResponse(request)
					} catch (error) {
						rollbackPendingResponse(id, optimisticMessage)
						restorePendingMessageState()
						throw error
					}
				}

				if (messages.length === 0) {
					const request = NewTaskRequest.create({
						text: messageToSend,
						images,
						files,
					})
					clearSentMessageState()
					trackPromptSubmitted(false)
					const { id, optimisticMessage } = beginPendingResponse({
						ts: Date.now(),
						type: "say",
						say: "task",
						text: messageToSend,
						images,
						files,
						partial: false,
					})
					try {
						await TaskServiceClient.newTask(request)
					} catch (error) {
						rollbackPendingResponse(id, optimisticMessage)
						restorePendingMessageState()
						throw error
					}
					messageSent = true
				} else if (turnState?.phase === "awaiting_approval") {
					await sendAskResponseWithPendingState(
						AskResponseRequest.create({
							responseType: "noButtonClicked",
							text: messageToSend,
							images,
							files,
						}),
					)
					messageSent = true
				} else if (clineAsk) {
					// For resume_task and resume_completed_task, use yesButtonClicked to match Resume button behavior
					// This ensures Enter key and Resume button work identically
					if (clineAsk === "resume_task" || clineAsk === "resume_completed_task") {
						// Resuming a task opened from history rebuilds the SDK session before the
						// extension echoes say:user_feedback, so without an optimistic bubble the
						// user's message would not appear until the (slow) resume finishes — the
						// chat would show only the Thinking loader in the meantime.
						await sendAskResponseWithPendingState(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
								text: messageToSend,
								images,
								files,
							}),
							{ showPendingMessage: turnState?.phase !== "streaming" },
						)
						messageSent = true
					} else {
						// All other ask types use messageResponse
						switch (clineAsk) {
							case "followup":
							case "plan_mode_respond":
							case "tool":
							case "browser_action_launch":
							case "command":
							case "command_output":
							case "use_mcp_server":
							case "use_subagents":
							case "completion_result":
							case "mistake_limit_reached":
							case "api_req_failed":
							case "new_task":
							case "condense":
							case "report_bug": {
								// Most askResponse sends need a temporary webview-only user bubble because the
								// extension will not echo the user's message until later. Active follow-up
								// questions are the exception: they are backed by the SDK's pending ask_question
								// resolver. When the user types a freeform answer instead of clicking one of the
								// option buttons, that resolver consumes the response before normal follow-up
								// routing and immediately appends the real say:user_feedback row. If we also add
								// an optimistic pending row here, the chat shows the same answer twice.
								const showPendingMessage = clineAsk !== "followup" && turnState?.phase !== "streaming"

								await sendAskResponseWithPendingState(
									AskResponseRequest.create({
										responseType: "messageResponse",
										text: messageToSend,
										images,
										files,
									}),
									{ showPendingMessage },
								)
								messageSent = true
								break
							}
						}
					}
				} else if (messages.length > 0) {
					// No clineAsk set, but there is an existing conversation. Route this to the
					// active session as a follow-up when the authoritative turnState says the
					// conversation is continuable — phases "completed" / "awaiting_followup" (the
					// agent finished or is waiting for the user) or "streaming" (interrupt with
					// feedback). The SDK does not emit a trailing ask:"completion_result", so
					// clineAsk is undefined even when the user can keep talking; turnState is
					// the source of truth.
					//
					// The previous `lastMessage.partial` / `api_req_started` fallback was
					// prose-derived state that has been removed: turnState is always present
					// in the state payload (the SdkController includes `turnState: tracker.get()`
					// in every webview state push), so a `undefined` turnState is a
					// missing-canonical-state condition, not a license to parse messages. The
					// phase rule is centralised in `shared/turnStateSelectors.ts`.
					// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1-CORRECTION02:
					// Capture the follow-up routing decision at the BOUNDARY (before
					// branching) so C2 records show what happened when the follow-up
					// failed too. This is critical for distinguishing Case G (terminal
					// event vs follow-up transition gap) from Case I (chat reducer
					// stuck).
					if (turnAllowsFollowup(turnState)) {
						// Continue the conversation / interrupt with feedback.
						captureFollowupRoute({
							route: "clineAsk.turnAllowsFollowup.allowed",
							canSubmit: true,
							hasPendingResponse: pendingResponse !== undefined,
							hasPendingUserMessage: pendingUserMessage !== undefined,
							turnStateSeq: turnState?.seq,
							turnStatePhase: turnState?.phase,
							turnStateAnchorTs: turnState?.anchorTs,
							wireStateVersion,
							wirePtadPushId,
						})
						await sendAskResponseWithPendingState(
							AskResponseRequest.create({
								responseType: "messageResponse",
								text: messageToSend,
								images,
								files,
							}),
							{
								showPendingMessage: turnState?.phase === "completed" || turnState?.phase === "awaiting_followup",
							},
						)
						messageSent = true
					} else {
						// Capture the BLOCKED path. The route name carries the phase
						// that rejected the follow-up so C2 can attribute the failure.
						const blockingPhase = turnState?.phase ?? "unknown"
						captureFollowupRoute({
							route: `clineAsk.turnAllowsFollowup.blocked:${blockingPhase}`,
							canSubmit: false,
							hasPendingResponse: pendingResponse !== undefined,
							hasPendingUserMessage: pendingUserMessage !== undefined,
							turnStateSeq: turnState?.seq,
							turnStatePhase: turnState?.phase,
							turnStateAnchorTs: turnState?.anchorTs,
							wireStateVersion,
							wirePtadPushId,
						})
					}
				}

				// New tasks clear optimistically before the RPC; the repeated success cleanup is idempotent.
				if (messageSent) {
					clearSentMessageState()

					// Reset auto-scroll
					if ("disableAutoScrollRef" in chatState) {
						;(chatState as any).disableAutoScrollRef.current = false
					}
				}
			}
		},
		[
			messages,
			clineAsk,
			turnState,
			activeQuote,
			setInputValue,
			setActiveQuote,
			sendingDisabled,
			setSendingDisabled,
			setSelectedImages,
			setSelectedFiles,
			enableButtons,
			setEnableButtons,
			setPendingUserMessage,
			setPendingResponse,
			chatState,
		],
	)

	// Start a new task
	const startNewTask = useCallback(async () => {
		UiServiceClient.trackIntent(
			IntentEvent.create({
				action: "new_task_clicked",
				source: "chat_new_task",
				hasActiveTask: messages.length > 0,
			}),
		).catch((error) => console.error("Failed to track new task click:", error))
		setActiveQuote(null)
		// Drop any unconfirmed optimistic message: if it lingered past an explicit
		// New Task, withPendingUserMessage would re-inject the old task (and its
		// attachments) into the freshly cleared transcript, leaving the chat stuck
		// on the previous task (#12924).
		setPendingUserMessage(undefined)
		setPendingResponse(undefined)
		await TaskServiceClient.clearTask(EmptyRequest.create({}))
	}, [messages.length, setActiveQuote, setPendingUserMessage, setPendingResponse])

	// Clear input state helper
	const clearInputState = useCallback(() => {
		setInputValue("")
		setActiveQuote(null)
		setSelectedImages([])
		setSelectedFiles([])
	}, [setInputValue, setActiveQuote, setSelectedImages, setSelectedFiles])

	// Execute button action based on type
	const executeButtonAction = useCallback(
		async (actionType: ButtonActionType, text?: string, images?: string[], files?: string[]) => {
			const trimmedInput = text?.trim()
			const hasContent = trimmedInput || (images && images.length > 0) || (files && files.length > 0)

			switch (actionType) {
				case "retry":
					// For API retry (api_req_failed), always send simple approval without content
					await TaskServiceClient.askResponse(
						AskResponseRequest.create({
							responseType: "yesButtonClicked",
						}),
					)
					clearInputState()
					break
				case "approve":
					if (hasContent) {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
								text: trimmedInput,
								images: images,
								files: files,
							}),
						)
					} else {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
							}),
						)
					}
					clearInputState()
					break

				case "reject":
					if (hasContent) {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "noButtonClicked",
								text: trimmedInput,
								images: images,
								files: files,
							}),
						)
					} else {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "noButtonClicked",
							}),
						)
					}
					clearInputState()
					break

				case "proceed":
					if (hasContent) {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
								text: trimmedInput,
								images: images,
								files: files,
							}),
						)
					} else {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
							}),
						)
					}
					clearInputState()
					break

				case "proceed_while_running":
					// Detach the running foreground terminal command: the agent
					// receives the partial output plus a log file path for the
					// rest, and the command keeps running in the terminal.
					await TaskServiceClient.proceedWhileRunningCommand(EmptyRequest.create({})).catch((err) =>
						console.error("Failed to proceed while running:", err),
					)
					break

				// ACT-CLINEMM-MODEL-QUALITY-WARNING-NONBLOCKING01: Dismiss is
				// the advisory-secondary action. It sends `noButtonClicked` for
				// the mistake_limit_reached ask; the SdkInteractionCoordinator
				// translates that into `action: "continue"` (advisory) — the
				// session is NOT cleared and the task remains resumable.
				case "dismiss":
					if (clineAsk === "mistake_limit_reached") {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "noButtonClicked",
							}),
						)
					}
					clearInputState()
					break

				case "new_task":
					if (clineAsk === "new_task") {
						await TaskServiceClient.newTask(
							NewTaskRequest.create({
								text: lastMessage?.text,
								images: [],
								files: [],
							}),
						)
					} else {
						await startNewTask()
					}
					break

				case "cancel": {
					if (cancelInFlightRef.current) {
						return
					}
					cancelInFlightRef.current = true
					setSendingDisabled(true)
					setEnableButtons(false)
					try {
						if (backgroundCommandRunning) {
							await TaskServiceClient.cancelBackgroundCommand(EmptyRequest.create({})).catch((err) =>
								console.error("Failed to cancel background command:", err),
							)
						}
						await TaskServiceClient.cancelTask(EmptyRequest.create({}))
					} finally {
						cancelInFlightRef.current = false
						// Clear any pending state that might interfere with resume
						setSendingDisabled(false)
						setEnableButtons(true)
					}
					break
				}

				case "utility":
					switch (clineAsk) {
						case "condense":
							await SlashServiceClient.condense(StringRequest.create({ value: lastMessage?.text })).catch((err) =>
								console.error(err),
							)
							break
						case "report_bug":
							await SlashServiceClient.reportBug(StringRequest.create({ value: lastMessage?.text })).catch((err) =>
								console.error(err),
							)
							break
					}
					break
			}

			if ("disableAutoScrollRef" in chatState) {
				;(chatState as any).disableAutoScrollRef.current = false
			}
		},
		[
			clineAsk,
			lastMessage,
			messages,
			clearInputState,
			handleSendMessage,
			startNewTask,
			chatState,
			backgroundCommandRunning,
			setSendingDisabled,
			setEnableButtons,
		],
	)

	// Handle task close button click
	const handleTaskCloseButtonClick = useCallback(() => {
		startNewTask()
	}, [startNewTask])

	return {
		handleSendMessage,
		executeButtonAction,
		handleTaskCloseButtonClick,
		startNewTask,
	}
}
