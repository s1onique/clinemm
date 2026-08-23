import type { CommandExecutionPlan } from "@cline/core"
import type { ConsecutiveMistakeLimitContext, ConsecutiveMistakeLimitDecision } from "@cline/shared"
import type { ClineAskQuestion, ClineMessage, TurnPhase } from "@shared/ExtensionMessage"
import type { TurnStateWriterId } from "@shared/turn-state-writer-provenance"
import type { ClineAskResponse } from "@shared/WebviewMessage"
import { Logger } from "@/shared/services/Logger"
import { MessageIdMinter } from "./message-id-minter"
import { buildToolApprovalAskMessage } from "./message-translator"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import { isCommandTool } from "./sdk-tool-policies"
import { buildToolApprovalDenialReason } from "./tool-approval-denial"

/**
 * =============================================================================
 * ACT-CLINEMM-MODEL-QUALITY-WARNING-NONBLOCKING01 — Advisory boundary
 * =============================================================================
 *
 * Historical contract: `mistake_limit_reached` was treated as a hard error
 * with two UI buttons — "Proceed Anyways" / "Start New Task" — where
 * "Start New Task" called `clearTask()` and destroyed the session, while
 * `clearPending(reason)` returned `{ action: "stop" }` which aborted the
 * runtime through the orchestrator. Either path ended the user's task.
 *
 * New contract: `mistake_limit_reached` is an *advisory*, not an error.
 *   - `mistake_limit_reached` no longer appears in the error phase set.
 *   - The user can "Continue" or "Dismiss" — neither forces a new task
 *     and neither aborts the runtime.
 *   - `clearPending` for the mistake-limit prompt resolves with
 *     `action: "continue"` so a session teardown triggered elsewhere
 *     (cancel, mode change) does not hang awaiting a never-arriving
 *     mistake decision; the session-level cancel is the legitimate stop.
 *   - The default continue decision is tagged `kind: "advisory"` for
 *     telemetry.
 *   - Wording is neutral about model identity: the message describes a
 *     protocol-progress symptom, not a brand verdict.
 *
 * Genuine terminal failures still terminate (see SdkController.cancelTask,
 * explicit api_req_failed retry exhaustion, etc.) — the advisory boundary
 * only removes the model-quality → abort coupling.
 */

export interface ToolApprovalRequest {
	agentId: string
	conversationId: string
	iteration: number
	toolCallId: string
	toolName: string
	input: unknown
	policy: { enabled?: boolean; autoApprove?: boolean }
}

export interface SdkInteractionCoordinatorOptions {
	messages: SdkMessageCoordinator
	getSessionId: () => string
	postStateToWebview: () => Promise<void>
	/**
	 * CORRECTION04 (TOCTOU fix): evaluate command-tool authority AND
	 * execution constraints in a SINGLE atomic call. The host reads
	 * settings ONCE and produces one immutable evaluation result that
	 * carries both `approved` (authority) and `executionPlan` (constraints).
	 *
	 * This eliminates the TOCTOU between `shouldAutoApproveTool` (which
	 * reads settings to decide authority) and `buildCommandExecutionPlan`
	 * (which reads settings again to build the plan). Settings can change
	 * between the two async evaluations across the approval UI.
	 *
	 * When this option is provided, `shouldAutoApproveTool` is IGNORED
	 * for command tools — the coordinator uses only the atomic evaluator.
	 */
	/**
	 * Evaluates command-tool authority and execution constraints atomically.
	 *
	 * CORRECTION04: this callback is invoked ONLY for command tools.
	 * Non-command tools use the standard ToolPolicy.autoApprove path.
	 *
	 * Return value:
	 *   - ALLOW  => { approved: true, decision.kind: "allow", executionPlan }
	 *   - ASK    => { approved: false, decision.kind: "ask", executionPlan }
	 *   - DENY   => { approved: false, decision.kind: "deny" }
	 */
	evaluateCommandToolApproval?: (request: ToolApprovalRequest) =>
		| Promise<
				| {
						approved: boolean
						decision?: { kind: "allow" | "ask" | "deny"; reason: string; source: string }
						executionPlan?: CommandExecutionPlan
				  }
				| undefined
		  >
		| {
				approved: boolean
				decision?: { kind: "allow" | "ask" | "deny"; reason: string; source: string }
				executionPlan?: CommandExecutionPlan
		  }
		| undefined
	/** @deprecated Use `evaluateCommandToolApproval`. Ignored when that is set for command tools. */
	shouldAutoApproveTool?: (request: ToolApprovalRequest) => boolean
	recordApprovedToolMessage?: (toolCallId: string, messageTs: number) => void
	recordDeniedToolApproval?: (toolCallId: string, toolName: string, reason: string) => void
	/**
	 * The process-wide id/seq/epoch authority, shared with the message translator. Optional so
	 * existing tests that don't need cross-generator id uniqueness keep working; when omitted a
	 * private minter is used. Production wires the shared minter from MessageTranslatorState.
	 */
	getMinter?: () => MessageIdMinter
	/**
	 * Set the authoritative UI turn phase. Called when an approval/ask is pending
	 * (awaiting_approval / awaiting_followup) and when the user responds (back to streaming).
	 * Optional for tests.
	 *
	 * ACT-CLINEMM-LEGACY-TURNSTATE-WRITER-PROVENANCE01: the optional
	 * `writerId` argument tags the mutation for the diagnostic ring.
	 * Callers that omit it preserve the legacy alias behavior
	 * (`unknown-legacy-writer`).
	 */
	setTurnPhase?: (phase: TurnPhase, anchorTs?: number, writerId?: TurnStateWriterId) => void
	/**
	 * Invoked for manually-approved tools after the auto-approve short-circuit, BEFORE the
	 * ask message is emitted. Used to open the edit diff preview so the user decides while
	 * looking at the actual change. Must not throw; failures fall back to a plain ask.
	 */
	onToolApprovalAsk?: (request: ToolApprovalRequest) => Promise<void>
	/**
	 * Returns the workspace cwd that tool paths should be relativized against
	 * for display in the chat view. Unlike SdkDiffEditCoordinator.getCwd (which is
	 * async and returns a fresh lookup), the interaction coordinator uses a
	 * synchronously-cached snapshot (`SdkController.lastKnownWorkspaceRoot`) that
	 * may be `undefined` until the first workspace event arrives.
	 *
	 * Added here as part of ACT-CLINEMM-VSCODIUM-DOGFOOD-PACKAGE01 because upstream
	 * PR #12900 ("fix(vscode): show cwd-relative tool paths in the chat view")
	 * passed `getCwd` at the call site on 2026-08-04 without updating this interface,
	 * leaving the option list drift and breaking `bun run package` typecheck.
	 */
	getCwd?: () => string | undefined
}

/**
 * Build the warning text shown when the consecutive-mistake advisory fires.
 *
 * ACT-CLINEMM-MODEL-QUALITY-WARNING-NONBLOCKING01: wording must be neutral
 * about model identity and must describe a protocol-progress symptom.
 * `latest` is the most recent mistake details (already trimmed upstream).
 */
export function buildMistakeLimitAdvisoryText(input: {
	consecutiveMistakes: number
	maxConsecutiveMistakes: number
	reason: ConsecutiveMistakeLimitContext["reason"]
	latest?: string
}): string {
	const counter = `${input.consecutiveMistakes}/${input.maxConsecutiveMistakes}`
	const latest = input.latest?.trim()
	const header = `The agent encountered repeated protocol errors (${counter}).`
	const cause = `Latest: ${latest || `${input.reason} at iteration`}`
	const hint = "You can continue and provide feedback, or dismiss and let the agent continue without changes."
	return `${header}\n\n${cause}\n\n${hint}`
}

/**
 * The decision this coordinator emits to the SDK MistakeTracker for
 * `mistake_limit_reached`. We never emit `action: "stop"` here — that
 * decision belongs to session-level cancel flows, not the per-turn
 * protocol-progress advisory. The discriminator lets the orchestrator
 * and telemetry distinguish "user pushed past the limit with guidance"
 * from "user dismissed the advisory".
 */
type MistakeLimitDecision = ConsecutiveMistakeLimitDecision & { kind: "advisory" | "user-resolved" }

export class SdkInteractionCoordinator {
	private pendingAskResolve: ((answer: string) => void) | undefined
	private pendingToolApprovalResolve:
		| ((result: {
				approved: boolean
				reason?: string
				decision?: { kind: "allow" | "ask" | "deny"; reason: string; source: string }
		  }) => void)
		| undefined
	private pendingMistakeLimitResolve: ((decision: MistakeLimitDecision) => void) | undefined
	private pendingToolApprovalMessage:
		| {
				toolCallId: string
				messageTs: number
				toolName: string
				decision?: { kind: "allow" | "ask" | "deny"; reason: string; source: string }
				executionPlan?: CommandExecutionPlan // CORRECTION04: atomic plan captured at entry
		  }
		| undefined

	constructor(private readonly options: SdkInteractionCoordinatorOptions) {}

	async handleConsecutiveMistakeLimitReached(context: ConsecutiveMistakeLimitContext): Promise<MistakeLimitDecision> {
		const detail = context.details?.trim()
		const latest = detail ? `${context.reason}: ${detail}` : `${context.reason} at iteration ${context.iteration}`
		const askMessage: ClineMessage = {
			ts: this.nextMessageTs(),
			type: "ask",
			ask: "mistake_limit_reached",
			// Neutral wording — see ACT-CLINEMM-MODEL-QUALITY-WARNING-NONBLOCKING01.
			text: buildMistakeLimitAdvisoryText({
				consecutiveMistakes: context.consecutiveMistakes,
				maxConsecutiveMistakes: context.maxConsecutiveMistakes,
				reason: context.reason,
				latest,
			}),
			partial: false,
		}

		this.options.messages.appendAndEmit([askMessage], {
			type: "status",
			payload: { sessionId: this.options.getSessionId(), status: "running" },
		})
		// Advisory is a follow-up for the user to weigh in, not a hard error.
		// `awaiting_followup` puts the input enabled and keeps the session
		// resumable (cf. buttonConfig.buttonsForPhase "awaiting_followup").
		this.options.setTurnPhase?.("awaiting_followup", askMessage.ts, "interaction-handle-mistake-limit")
		await this.options.postStateToWebview()

		return new Promise<MistakeLimitDecision>((resolve) => {
			this.pendingMistakeLimitResolve = resolve
		})
	}

	async handleRequestToolApproval(request: ToolApprovalRequest): Promise<{
		approved: boolean
		reason?: string
		decision?: { kind: "allow" | "ask" | "deny"; reason: string; source: string }
		executionPlan?: CommandExecutionPlan
	}> {
		// CORRECTION04 TOCTOU fix: evaluate authority AND constraints in ONE call.
		// Call the atomic evaluator ONLY for command tools. Non-command tools
		// use the standard ToolPolicy.autoApprove semantics unchanged.
		const isCommand = isCommandTool(request.toolName)
		const commandEval = isCommand ? await this.options.evaluateCommandToolApproval?.(request) : undefined

		if (commandEval !== undefined) {
			// Command tool: use canonical lattice result.
			// CORRECTION04 DENY preservation: if the canonical evaluator
			// returned DENY, do NOT open an overridable approval UI.
			if (commandEval.decision?.kind === "deny") {
				Logger.log(`[SdkController] Hard DENY for tool=${request.toolName}; no approval UI`)
				return { approved: false, reason: commandEval.decision.reason }
			}
			if (commandEval.approved) {
				Logger.log(`[SdkController] Auto-approving tool execution: tool=${request.toolName}`)
				return { approved: true, decision: commandEval.decision, executionPlan: commandEval.executionPlan }
			}
			// ASK: fall through to open approval UI.
		} else {
			// No atomic evaluator (or non-command tool): use legacy behavior.
			if (isCommand) {
				// Command tool with no atomic evaluator: honor SDK policy
				// `autoApprove` short-circuit and host shouldAutoApproveTool
				// (which the host wires to the canonical command policy
				// lattice when no atomic evaluator is provided).
				if (request.policy.autoApprove === true || this.options.shouldAutoApproveTool?.(request) === true) {
					Logger.log(`[SdkController] Auto-approving tool execution: tool=${request.toolName}`)
					return { approved: true }
				}
			} else {
				// ACT-CLINEMM-UPSTREAM-SETTINGS-AUTHORITY-PARITY01:
				// Non-command tools (read/edit/browser/mcp) consult the host's
				// shouldAutoApproveTool callback, which evaluates the live user
				// auto-approval settings via isToolAutoApproved. The SDK policy
				// `autoApprove` field is also honored as a short-circuit (matches
				// upstream v4.1.10 wiring).
				if (request.policy.autoApprove === true || this.options.shouldAutoApproveTool?.(request) === true) {
					Logger.log(`[SdkController] Auto-approving tool execution: tool=${request.toolName}`)
					return { approved: true }
				}
			}
		}

		// Open the edit diff preview before the Approve/Reject buttons render. This is the only
		// pre-execution point where the adapter has the full tool input (the SDK emits the
		// tool's content events only after approval resolves).
		try {
			await this.options.onToolApprovalAsk?.(request)
		} catch (error) {
			Logger.warn(`[SdkController] onToolApprovalAsk failed; showing plain approval ask: ${error}`)
		}

		const toolAskMessage: ClineMessage = buildToolApprovalAskMessage(request.toolName, request.input, this.nextMessageTs())

		this.options.messages.appendAndEmit([toolAskMessage], {
			type: "status",
			payload: { sessionId: this.options.getSessionId(), status: "running" },
		})
		this.options.setTurnPhase?.("awaiting_approval", toolAskMessage.ts, "interaction-handle-tool-approval")
		await this.options.postStateToWebview()

		return new Promise<{ approved: boolean; reason?: string; executionPlan?: CommandExecutionPlan }>((resolve) => {
			this.pendingToolApprovalResolve = resolve
			this.pendingToolApprovalMessage = {
				toolCallId: request.toolCallId,
				messageTs: toolAskMessage.ts,
				toolName: request.toolName,
				decision: commandEval?.decision, // CORRECTION04 DENY: carries canonical decision through approval UI
				executionPlan: commandEval?.executionPlan, // CORRECTION04: plan captured atomically at entry
			}
		})
	}

	async handleAskQuestion(question: string, options: string[], _context: unknown): Promise<string> {
		const askData: ClineAskQuestion = {
			question,
			options: options?.length ? options : undefined,
		}
		const askMessage: ClineMessage = {
			ts: this.nextMessageTs(),
			type: "ask",
			ask: "followup",
			text: JSON.stringify(askData),
			partial: false,
		}

		this.options.messages.appendAndEmit([askMessage], {
			type: "status",
			payload: { sessionId: this.options.getSessionId(), status: "running" },
		})
		this.options.setTurnPhase?.("awaiting_followup", askMessage.ts, "interaction-handle-ask-question")
		await this.options.postStateToWebview()

		return new Promise<string>((resolve) => {
			this.pendingAskResolve = resolve
		})
	}

	resolvePendingToolApproval(
		prompt: string | undefined,
		responseType: ClineAskResponse | undefined,
		images?: string[],
		files?: string[],
	): boolean {
		if (!this.pendingToolApprovalResolve) {
			return false
		}

		const resolve = this.pendingToolApprovalResolve
		const pendingMessage = this.pendingToolApprovalMessage

		if (responseType === "messageResponse") {
			Logger.log("[SdkController] Leaving pending tool approval open and routing user message as queued follow-up")
			this.options.setTurnPhase?.(
				"awaiting_approval",
				pendingMessage?.messageTs,
				"interaction-resolve-tool-approval-message-response",
			)
			// The approval remains pending. The chat message still needs normal follow-up routing.
			return false
		}

		this.pendingToolApprovalResolve = undefined
		this.pendingToolApprovalMessage = undefined

		const approved = responseType === "yesButtonClicked"
		Logger.log(`[SdkController] Resolving pending tool approval: approved=${approved} (responseType=${responseType})`)
		if (approved && pendingMessage) {
			this.options.recordApprovedToolMessage?.(pendingMessage.toolCallId, pendingMessage.messageTs)
		}

		// Approved or rejected by approval controls, the agent resumes its turn and returns to streaming.
		// On rejection the agent receives the denial and continues; the SDK drives the next phase.
		this.options.setTurnPhase?.("streaming", undefined, "interaction-resolve-tool-approval-yes-no")
		// The reason must state the operation did NOT happen (for edits: the file is
		// unchanged) — raw feedback alone reads like iteration on an applied change.
		const denialReason = buildToolApprovalDenialReason(pendingMessage?.toolName, prompt)
		if (!approved && (prompt?.trim() || images?.length || files?.length)) {
			const userMessage: ClineMessage = {
				ts: this.nextMessageTs(),
				type: "say",
				say: "user_feedback",
				text: prompt ?? "",
				images,
				files,
				partial: false,
			}
			this.options.messages.appendAndEmit([userMessage], {
				type: "status",
				payload: { sessionId: this.options.getSessionId(), status: "running" },
			})
		}
		if (!approved && pendingMessage) {
			this.options.recordDeniedToolApproval?.(pendingMessage.toolCallId, pendingMessage.toolName, denialReason)
		}
		// CORRECTION04: re-emit the atomic plan from entry on user YES.
		resolve({
			approved,
			...(approved ? { executionPlan: pendingMessage?.executionPlan } : { reason: denialReason }),
		})
		return true
	}

	resolvePendingAskQuestion(prompt: string | undefined): boolean {
		if (!this.pendingAskResolve) {
			return false
		}

		const resolve = this.pendingAskResolve
		this.pendingAskResolve = undefined
		const responseText = prompt ?? ""
		Logger.log(`[SdkController] Resolving pending ask_question with: "${responseText.substring(0, 80)}"`)

		if (responseText) {
			const userMessage: ClineMessage = {
				ts: this.nextMessageTs(),
				type: "say",
				say: "user_feedback",
				text: responseText,
				partial: false,
			}
			this.options.messages.appendAndEmit([userMessage], {
				type: "status",
				payload: { sessionId: this.options.getSessionId(), status: "running" },
			})
		}

		// User answered the follow-up — the agent resumes its turn.
		this.options.setTurnPhase?.("streaming", undefined, "interaction-resolve-ask-question")
		resolve(responseText)
		return true
	}

	/**
	 * Resolve a pending `mistake_limit_reached` advisory.
	 *
	 * ACT-CLINEMM-MODEL-QUALITY-WARNING-NONBLOCKING01: this method MUST NOT
	 * return `{ action: "stop" }`. Mistake recovery is a protocol-progress
	 * concern, not a terminal verdict. The session stays resumable through
	 * every response shape:
	 *
	 *   - `noButtonClicked` (Dismiss): continue with empty guidance. The
	 *     advisory is acknowledged; the loop carries on with the model the
	 *     user chose.
	 *   - `yesButtonClicked` (Continue with no prompt): continue with
	 *     empty guidance.
	 *   - `messageResponse`: continue, forwarding the user's freeform
	 *     guidance as `mistake_limit_reached: <text>` so the next iteration
	 *     can act on it. This is the only shape that pushes guidance into
	 *     the conversation.
	 *
	 * Returns `false` when no advisory is pending (caller no-op).
	 */
	resolvePendingMistakeLimit(prompt: string | undefined, _responseType: ClineAskResponse | undefined): boolean {
		if (!this.pendingMistakeLimitResolve) {
			return false
		}

		const resolve = this.pendingMistakeLimitResolve
		this.pendingMistakeLimitResolve = undefined
		this.options.setTurnPhase?.("streaming", undefined, "interaction-resolve-mistake-limit")

		const trimmedPrompt = prompt?.trim()
		if (trimmedPrompt) {
			const userMessage: ClineMessage = {
				ts: this.nextMessageTs(),
				type: "say",
				say: "user_feedback",
				text: trimmedPrompt,
				partial: false,
			}
			this.options.messages.appendAndEmit([userMessage], {
				type: "status",
				payload: { sessionId: this.options.getSessionId(), status: "running" },
			})
		}

		const guidance = trimmedPrompt ? `mistake_limit_reached: ${trimmedPrompt}` : undefined
		// No guidance → pure dismissal (advisory); user-provided text → user-resolved.
		resolve({
			action: "continue",
			guidance,
			kind: guidance ? "user-resolved" : "advisory",
		} as MistakeLimitDecision)
		return true
	}

	/**
	 * Cancel any pending prompts.
	 *
	 * ACT-CLINEMM-MODEL-QUALITY-WARNING-NONBLOCKING01: the mistake_limit
	 * prompt is advisory, so `clearPending` resolves it with `continue`,
	 * not `stop`. The session-level teardown that triggered `clearPending`
	 * (cancelTask, clearTask, mode change) is the legitimate stop signal —
	 * it propagates through `endActiveSession` and tears down the runtime
	 * directly. Resolving the pending advisory here just unblocks the
	 * MistakeTracker's await so it doesn't hang on a never-arriving
	 * decision.
	 */
	clearPending(reason: string): void {
		// Resolve any pending ask-question with an empty answer. Mirrors
		// resolvePendingAskQuestion(undefined) so callers that switched away
		// (e.g. showTaskWithId) do not leak the old task's pending question
		// into the new task's first user message.
		if (this.pendingAskResolve) {
			const askResolve = this.pendingAskResolve
			this.pendingAskResolve = undefined
			askResolve("")
		}
		if (this.pendingMistakeLimitResolve) {
			this.pendingMistakeLimitResolve({
				action: "continue",
				guidance: undefined,
				kind: "advisory",
			} as MistakeLimitDecision)
			this.pendingMistakeLimitResolve = undefined
		}
		const pendingMessage = this.pendingToolApprovalMessage
		this.pendingToolApprovalMessage = undefined
		if (this.pendingToolApprovalResolve) {
			// Record before resolving: the denial unblocks the core, which emits the
			// tool's lifecycle events before the caller's abort lands. Unless the
			// denial is already recorded, the translator renders those events as a
			// second tool row next to the still-visible approval ask.
			if (pendingMessage) {
				this.options.recordDeniedToolApproval?.(pendingMessage.toolCallId, pendingMessage.toolName, reason)
			}
			this.pendingToolApprovalResolve({ approved: false, reason })
			this.pendingToolApprovalResolve = undefined
		}
	}

	/**
	 * Mint a unique message id from the SHARED minter so interaction messages (tool-approval
	 * asks, ask_question, user_feedback) never collide with translator-minted ids. Falls back to
	 * a private minter when none is wired (tests).
	 */
	private nextMessageTs(): number {
		return this.getMinter().nextId()
	}

	private fallbackMinter: MessageIdMinter | undefined
	private getMinter(): MessageIdMinter {
		if (this.options.getMinter) {
			return this.options.getMinter()
		}
		if (!this.fallbackMinter) {
			// Lazy import-free fallback: construct on first use.
			this.fallbackMinter = new MessageIdMinter()
		}
		return this.fallbackMinter
	}
}
