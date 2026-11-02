import type { ClineMessage } from "@shared/ExtensionMessage"
import {
	isPostTerminalAuthorityDiagnosticEnabled,
	recordPostTerminalAuthoritySnapshot,
} from "@shared/post-terminal-authority-diagnostic"
import type { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useExtensionState } from "../../../../../context/ExtensionStateContext"
import { type ButtonActionType, getButtonConfigFromState } from "../../shared/buttonConfig"
import type { ButtonActionInvocation, ChatState, DraftSnapshot, MessageHandlers } from "../../types/chatTypes"

function createActionInvocation(action: ButtonActionType, getDraftSnapshot: () => DraftSnapshot): ButtonActionInvocation {
	switch (action) {
		case "approve":
		case "reject":
		case "proceed":
			return { type: action, draft: getDraftSnapshot() }
		default:
			return { type: action }
	}
}

interface ActionButtonsProps {
	task?: ClineMessage
	messages: ClineMessage[]
	chatState: ChatState
	messageHandlers: MessageHandlers
	mode: Mode
}

/**
 * Action buttons area including approve/reject buttons
 */
export const ActionButtons: React.FC<ActionButtonsProps> = ({ task, messages, chatState, mode, messageHandlers }) => {
	// ACT-CLINEMM-FORK-UPSTREAM-MERGE01: upstream reads `getDraftSnapshot` /
	// `setSendingDisabled` off `chatState`; the fork also reads
	// `inputValue` / `selectedImages` / `selectedFiles` from it. Both sides'
	// bindings are kept, but declared ONCE — the naive merge emitted two
	// destructurings of the same object, which redeclares `setSendingDisabled`,
	// `turnState` and `foregroundCommandRunning`.
	const { inputValue, selectedImages, selectedFiles, getDraftSnapshot, setSendingDisabled } = chatState
	const {
		turnState,
		foregroundCommandRunning,
		backgroundCommandRunning,
		stateVersion: wireStateVersion,
		_ptadPushId: wirePtadPushId,
		// ACT-CLINEMM-P0-BLOCKED-RECOVERY-PUBLICATION-AND-UI-AUTHORITY01 — BRPU01:
		// The host's current recovery-control projection. When set with
		// `reason: "observation_unavailable"`, the button selector suppresses
		// the ordinary `api_req_failed` Retry affordance.
		blockedRecovery,
	} = useExtensionState()

	// Tracks the ask the user last acted on. Clicking a footer button latches this so the
	// buttons disable immediately (and survive the trailing bookkeeping re-renders before the
	// backend advances the turn). It is a ref, not state, so it can be compared against the
	// current ask during render without scheduling an extra update.
	const processedAskRef = useRef<string | undefined>(undefined)
	// Forces a re-render when the latch flips; the counter value itself is unused.
	const [, bumpRender] = useState(0)

	// Memoize the last message to avoid unnecessary recalculation
	const lastMessage = useMemo(() => messages.at(-1), [messages])

	// Button configuration is driven by the authoritative backend TurnState when present (SDK
	// path); otherwise it falls back to the legacy tail-walking heuristic. This makes the footer
	// buttons immune to trailing bookkeeping messages and never disagree with the thinking
	// indicator (RC1).
	const buttonConfig = useMemo(() => {
		return getButtonConfigFromState(messages, turnState, mode, foregroundCommandRunning, blockedRecovery)
	}, [messages, turnState, mode, foregroundCommandRunning, blockedRecovery])

	// Identity of the ask that currently owns the footer buttons. The button config objects are
	// shared singletons (e.g. BUTTON_CONFIGS.tool_approve), so two consecutive identical asks
	// (approve → approve) return the same reference. The anchored turn timestamp (or the last
	// message) changes on every new ask, making it the reliable signal that a fresh decision is
	// due even when the config object is identical. Folding the config's button text in also
	// covers a same-anchor transition between different button sets.
	const askIdentity = `${turnState?.seq ?? ""}:${turnState?.anchorTs ?? lastMessage?.ts ?? ""}:${buttonConfig.primaryText ?? ""}:${buttonConfig.secondaryText ?? ""}`

	// The buttons are "processing" only while the user's click is being handled for the current
	// ask. Because the latch is keyed on the ask identity, a new ask (even one reusing the same
	// shared config object) is never seen as already-processed, so its buttons are interactive
	// again.
	const isProcessing = processedAskRef.current === askIdentity

	// Mirror the config's sending-disabled flag into chat state whenever the active button set
	// changes.
	useEffect(() => {
		setSendingDisabled(buttonConfig.sendingDisabled)
		// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1-CORRECTION01:
		// Capture the buttonConfig-driven sendingDisabled at the exact production
		// expression site (this is ActionButtons.tsx:64). The capture runs AFTER
		// the `setSendingDisabled` call so the next React render will reflect the
		// new value. The diagnostic record distinguishes between the
		// `buttonConfig.sendingDisabled` source (Case A) and the local
		// `chatReducerSendingDisabled` (Case I) so the live C2 verdict can
		// disambiguate which authority holds the lockout.
		if (isPostTerminalAuthorityDiagnosticEnabled("webview")) {
			// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1-CORRECTION02:
			// Correlation-domain fix: stateVersion now stamps the wire-side
			// ExtensionState.stateVersion (same counter as the push boundary),
			// NOT turnState.seq. The turnState.seq is preserved as `legacySeq`.
			recordPostTerminalAuthoritySnapshot({
				origin: "webview",
				// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C2-CORRECTION01-REPLICA-TRUTH:
				// `captureKind: "action-buttons"` disambiguates this decision from
				// input-section / followup-route / webview-replica captures.
				captureKind: "action-buttons",
				stateVersion: wireStateVersion ?? 0,
				_ptadPushId: wirePtadPushId,
				capturedAt: Date.now(),
				legacyPhase: turnState?.phase,
				legacySeq: turnState?.seq,
				legacyAnchorTs: turnState?.anchorTs,
				buttonConfig: {
					sendingDisabled: buttonConfig.sendingDisabled,
					enableButtons: buttonConfig.enableButtons,
					primaryText: buttonConfig.primaryText,
					secondaryText: buttonConfig.secondaryText,
					primaryAction: buttonConfig.primaryAction,
					secondaryAction: buttonConfig.secondaryAction,
				},
				// ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-LIVE-CAPTURE01:
				// Stamp the EXACT foregroundCommandRunning value passed to
				// getButtonConfigFromState (line 53), the backstop
				// backgroundCommandRunning, and the message-tail identity at
				// the SAME committed object as the button config. Pure additions;
				// production semantics unchanged when the diagnostic is default-off.
				foregroundCommandRunning,
				backgroundCommandRunning,
				messageTail:
					messages.length > 0
						? {
								ts: messages[messages.length - 1].ts,
								type: messages[messages.length - 1].type,
								ask: messages[messages.length - 1].type === "ask" ? messages[messages.length - 1].ask : undefined,
								say: messages[messages.length - 1].type === "say" ? messages[messages.length - 1].say : undefined,
								partial: messages[messages.length - 1].partial,
								seq: messages[messages.length - 1].seq,
								epoch: messages[messages.length - 1].epoch,
							}
						: undefined,
			})
		}
	}, [
		buttonConfig,
		setSendingDisabled,
		buttonConfig.sendingDisabled,
		buttonConfig.enableButtons,
		buttonConfig.primaryText,
		buttonConfig.secondaryText,
		buttonConfig.primaryAction,
		buttonConfig.secondaryAction,
		turnState?.seq,
		turnState?.phase,
		turnState?.anchorTs,
		wireStateVersion,
		wirePtadPushId,
	])

	const handleActionClick = useCallback(
		(invocation: ButtonActionInvocation) => {
			if (processedAskRef.current === askIdentity) {
				return
			}
			// Latch this ask as processed and force a render so the buttons disable immediately.
			processedAskRef.current = askIdentity
			bumpRender((n) => n + 1)

			const releaseLatch = () => {
				if (processedAskRef.current === askIdentity) {
					processedAskRef.current = undefined
					bumpRender((n) => n + 1)
				}
			}
			void messageHandlers
				.executeButtonAction(invocation)
				.then((started) => {
					if (!started) {
						releaseLatch()
					}
				})
				.catch(releaseLatch)
		},
		[messageHandlers, askIdentity],
	)

	// Keyboard event handler
	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault()
				event.stopPropagation()
				handleActionClick({ type: "cancel" })
			}
		},
		[handleActionClick],
	)

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [handleKeyDown])

	if (!task) {
		return null
	}

	const { primaryText, secondaryText, primaryAction, secondaryAction, enableButtons } = buttonConfig
	const hasButtons = primaryText || secondaryText
	const isStreaming = task.partial === true
	const canInteract = enableButtons && !isProcessing && !messageHandlers.recoveryActionInFlight

	if (!hasButtons) {
		return null
	}

	const opacity = canInteract || isStreaming ? 1 : 0.5

	return (
		<div className="flex px-3.5" style={{ opacity }}>
			{primaryText && primaryAction && (
				<VSCodeButton
					appearance="primary"
					className={secondaryText ? "flex-1 mr-[6px]" : "flex-2"}
					disabled={!canInteract}
					onClick={() => handleActionClick(createActionInvocation(primaryAction, getDraftSnapshot))}>
					{primaryText}
				</VSCodeButton>
			)}
			{secondaryText && secondaryAction && (
				<VSCodeButton
					appearance="secondary"
					className={primaryText ? "flex-1" : "flex-2"}
					disabled={!canInteract}
					onClick={() => handleActionClick(createActionInvocation(secondaryAction, getDraftSnapshot))}>
					{secondaryText}
				</VSCodeButton>
			)}
		</div>
	)
}
