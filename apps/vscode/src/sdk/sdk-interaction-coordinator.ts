import type { CommandExecutionPlan, CommandHostAuthorization } from "@cline/core"
import { isReformulatable, REFORMULATION_REASON_CODE } from "@cline/core/internal/reformulation-classifier"
import type { ConsecutiveMistakeLimitContext, ConsecutiveMistakeLimitDecision } from "@cline/shared"
import type { ClineAskQuestion, ClineMessage, TurnPhase } from "@shared/ExtensionMessage"
import type { TurnStateWriterId } from "@shared/turn-state-writer-provenance"
import type { ClineAskResponse } from "@shared/WebviewMessage"
import { Logger } from "@/shared/services/Logger"
import { resolveEffectiveDiagnosticKnobs } from "./dogfood-diagnostic-profile"
import { isDogfoodRuntime } from "./dogfood-runtime-profile"
import { evaluateEditAutoApprovalForRequest } from "./editor-path-authority"
import { MessageIdMinter } from "./message-id-minter"
import { buildToolApprovalAskMessage } from "./message-translator"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import { isCommandTool } from "./sdk-tool-policies"
import { buildToolApprovalDenialReason } from "./tool-approval-denial"
import {
	emitV2Capture,
	newV2CorrelationId,
	resolveCapturePathForProfileEffective,
	v2CommandDigest,
	withV2CaptureContext,
} from "./v2-capture"

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
	 *
	 * ACT-CLINEMM-COMMAND-SAFETY-REFORMULATION01:
	 * The optional `hostAuthorization` field carries the ACTUAL evaluated
	 * `CommandHostAuthorization` (mode + workspace roots + realpath evidence).
	 * Hosts SHOULD supply it; the coordinator uses it for the reformulation
	 * eligibility check (item 3 of the predicate: `mode === "safe-only"`
	 * MUST come from the evaluated authorization, not an assumed UI
	 * / config setting). Tests and older mocks that omit it fall back
	 * to "no reformulation" — this is the safe-by-default path.
	 *
	 * ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01:
	 * The optional `mandatorySeatbeltExecution` field carries the
	 * executor-side Seatbelt obligation. When `true`, the runtime
	 * MUST stamp this into `AgentToolContext.mandatorySeatbeltExecution`
	 * before invoking the tool executor. The executor
	 * (`CommandJobManager.start`) refuses host-shell fallback when
	 * `true`. The field is omitted from the coordinator's auto-approve
	 * return path; the coordinator threads it into the runtime
	 * separately when the result is consumed.
	 */
	evaluateCommandToolApproval?: (request: ToolApprovalRequest) =>
		| Promise<
				| {
						approved: boolean
						decision?: { kind: "allow" | "ask" | "deny"; reason: string; source: string }
						executionPlan?: CommandExecutionPlan
						hostAuthorization?: CommandHostAuthorization
						mandatorySeatbeltExecution?: boolean
				  }
				| undefined
		  >
		| {
				approved: boolean
				decision?: { kind: "allow" | "ask" | "deny"; reason: string; source: string }
				executionPlan?: CommandExecutionPlan
				hostAuthorization?: CommandHostAuthorization
				mandatorySeatbeltExecution?: boolean
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
	/**
	 * ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 PHASE 2:
	 * Returns the LIVE AutoApproveBar settings snapshot. The coordinator
	 * consults this for the `editFiles` + `editFilesExternally` toggle
	 * pair when evaluating the CURRENT INCLUDED SURFACE (`editor` +
	 * `apply_patch`). Synchronously-cached for the same reason as
	 * `getCwd` — the policy lattice must evaluate without an extra
	 * async hop, but the toggle snapshot must reflect the user's most
	 * recent settings change.
	 *
	 * CORRECTION01 (factory review `HALT_MULTI_TARGET_FAIL_CLOSED_BYPASS`):
	 * This option is MANDATORY for editor/apply_patch. When it is
	 * omitted (or returns undefined) the coordinator returns ASK
	 * ("auto-approval settings unavailable; cannot classify target").
	 * The legacy boolean short-circuit is NEVER consulted as a fallback
	 * for these tool names — that was the load-bearing defect this ACT
	 * exists to eliminate.
	 *
	 * (Same constraint applies to `getCwd`: omitting it for editor/
	 * apply_patch produces ASK with reason "workspace root unavailable;
	 * cannot classify target".)
	 */
	getAutoApprovalSettings?: () => { editFiles: boolean; editFilesExternally: boolean } | undefined
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

/**
 * ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01:
 *
 * Emit the `approval.noncommand.decision.v1` probe at the actual
 * decision boundary for non-command tools. This is the
 * load-bearing CASE B/C discriminator (per
 * `ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01`): every
 * ALLOW or ASK return path for a non-command tool MUST emit a
 * decision record BEFORE returning, paired with the optional
 * `approval.noncommand.ui-published.v1` record that fires later
 * from the manual-ASK branch.
 *
 * Useful compositions:
 *
 *   decision=ALLOW + no publication    -> normal auto-approval
 *   decision=ASK   + publication       -> normal manual approval
 *   decision=ALLOW + publication       -> CASE B (live UI / publication defect)
 *   tool request + no decision record  -> CASE C (seam moved)
 *
 * Identity-gated: fires ONLY when the effective diagnostic profile's
 * `p` knob is ON. The probe is purely observational (never throws).
 */
function emitNonCommandDecisionProbe(input: {
	request: ToolApprovalRequest
	approved: boolean
	decisionKind?: "allow" | "ask" | "deny"
	decisionReason?: string
	decisionSource?: string
}): void {
	const profile = resolveEffectiveDiagnosticKnobs(
		process.env,
		isDogfoodRuntime(process.env),
		resolveCapturePathForProfileEffective(process.env),
	)
	if (!profile.p) {
		return
	}
	emitV2Capture({
		codePoint: "approval.noncommand.decision.v1",
		scope: "request",
		data: {
			conversationId: input.request.conversationId,
			toolName: input.request.toolName,
			isCommand: false,
			approved: input.approved,
			decisionKind: input.decisionKind,
			decisionReason: input.decisionReason,
			decisionSource: input.decisionSource,
		},
	})
}

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

	// ACT-CLINEMM-COMMAND-SAFETY-REFORMULATION01
	//
	// One-shot reformulation slot, keyed by (agentId, conversationId).
	// Armed when a command-tool evaluation was reformulatable and the
	// coordinator returned `{ approved: false, reason: <prose> }` WITHOUT
	// opening the approval UI. Consumed BEFORE the next command-tool
	// evaluation in the same (agentId, conversationId) so that command
	// receives ordinary policy (likely ASK, possibly ALLOW).
	//
	// This is a BOUNDED_CONVERSATION_CONTINUATION, not a semantic-intent
	// chain. The slot never bleeds across conversations and is cleared
	// by `clearPending` on session teardown.
	private pendingReformulationSlot?: {
		agentId: string
		conversationId: string
		reasonCode: string
	}

	// ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 PHASE 2:
	// Single-slot evidence carrier for the editor / apply_patch target-aware
	// ASK path. Set by `handleEditorOrApplyPatchApproval` when the verdict
	// is ASK; read by the manual-ask publication path below to thread the
	// decision into the `pendingToolApprovalMessage` record. Cleared at
	// every approval resolution to prevent bleed-across.
	private lastEditorOrApplyPatchDecision: { kind: "allow" | "ask" | "deny"; reason: string; source: string } | null = null

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
		/**
		 * ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01:
		 * Executor-side Seatbelt obligation. When `true`, the runtime
		 * stamps this into `AgentToolContext.mandatorySeatbeltExecution`
		 * before invoking the tool executor.
		 */
		mandatorySeatbeltExecution?: boolean
	}> {
		// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-LIVE-CAPTURE01
		// CORRECTION01 — request-scoped capture context. AsyncLocalStorage
		// propagates correlationId + commandDigest to every code point
		// that fires inside the async callback chain, so C2_3/C4/C5/C6/C7
		// automatically inherit the request identity set by C0.
		const correlationId = newV2CorrelationId()
		const commandDigest = v2CommandDigest(request.input)
		const isCommand = isCommandTool(request.toolName)
		// C0 — heartbeat at the EARLIEST observable entry point before any
		// branching. If an approval card appears but this heartbeat is
		// missing, the instrumented callback was never reached (C0).
		emitV2Capture({
			codePoint: "approval.entry.v2",
			correlationId,
			commandDigest,
			data: {
				toolName: request.toolName,
				isCommand,
			},
		})
		try {
			// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-LIVE-CAPTURE01
			// CORRECTION01 — wrap the request body in the AsyncLocalStorage
			// context so downstream emitters inherit the correlation pair.
			return await withV2CaptureContext({ correlationId, commandDigest }, () => this.runRequestToolApproval(request))
		} finally {
			// T — terminal record, exactly once per request. Emitted at every
			// return path so the trace is always paired.
			emitV2Capture({
				codePoint: "approval.terminal.v2",
				correlationId,
				commandDigest,
			})
		}
	}

	private async runRequestToolApproval(request: ToolApprovalRequest): Promise<{
		approved: boolean
		reason?: string
		decision?: { kind: "allow" | "ask" | "deny"; reason: string; source: string }
		executionPlan?: CommandExecutionPlan
		/**
		 * ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01:
		 * Executor-side Seatbelt obligation (see handleRequestToolApproval).
		 */
		mandatorySeatbeltExecution?: boolean
	}> {
		// CORRECTION04 TOCTOU fix: evaluate authority AND constraints in ONE call.
		// Call the atomic evaluator ONLY for command tools. Non-command tools
		// use the standard ToolPolicy.autoApprove semantics unchanged.
		const isCommand = isCommandTool(request.toolName)

		// ACT-CLINEMM-COMMAND-SAFETY-REFORMULATION01:
		// Consume the one-shot reformulation slot BEFORE evaluating, when this
		// proposal belongs to the same (agentId, conversationId) as the slot's
		// arming turn. The next proposal receives ordinary policy regardless of
		// whether it itself is reformulatable — the slot is one-shot per
		// causally-connected rejection continuation.
		//
		// `reformulationBlockedForThisCall` short-circuits the reformulation
		// branch below so a consumed slot cannot immediately re-arm on the
		// very next proposal. The block is scoped to this single call; the
		// proposal AFTER that is free to reformulate again if it qualifies.
		let reformulationBlockedForThisCall = false
		if (
			isCommand &&
			this.pendingReformulationSlot &&
			this.pendingReformulationSlot.agentId === request.agentId &&
			this.pendingReformulationSlot.conversationId === request.conversationId
		) {
			this.pendingReformulationSlot = undefined
			reformulationBlockedForThisCall = true
			Logger.log(`[SdkController] Reformulation slot consumed for tool=${request.toolName}`)
		}

		const commandEval = isCommand ? await this.options.evaluateCommandToolApproval?.(request) : undefined

		if (commandEval !== undefined) {
			// Command tool: use canonical lattice result.
			// CORRECTION04 DENY preservation: if the canonical evaluator
			// returned DENY, do NOT open an overridable approval UI.
			if (commandEval.decision?.kind === "deny") {
				Logger.log(`[SdkController] Hard DENY for tool=${request.toolName}; no approval UI`)
				return { approved: false, reason: commandEval.decision.reason }
			}
			// ACT-CLINEMM-COMMAND-SAFETY-REFORMULATION01:
			// Reformulation short-circuit. The reformulation classifier
			// (from `@cline/core/runtime/command-policy`) returns a
			// non-null prose reason only when:
			//   1. canonical decision.kind === "ask"
			//   2. canonical decision.source === "host_mode_safe_only_fallthrough"
			//   3. hostAuthorization.mode === "safe-only" (from the actual
			//      evaluated authorization, NOT an assumed UI / config state)
			//   4. containsUnquotedShellPattern(rawInput) === true
			//
			// On a match we short-circuit with `{ approved: false, reason }`
			// (identical in shape to the DENY short-circuit above) WITHOUT
			// opening the approval UI, AND we arm a one-shot slot keyed by
			// (agentId, conversationId) that the NEXT command-tool proposal
			// in the same conversation will consume BEFORE evaluating.
			//
			// `reformulationBlockedForThisCall` (set when this call has just
			// consumed a slot) gates the branch so the next proposal receives
			// ordinary policy even if its own content would also qualify.
			//
			// Slot consumption is handled at the top of this method.
			if (!reformulationBlockedForThisCall && commandEval.decision?.kind === "ask" && commandEval.hostAuthorization) {
				// Narrow `decision` to the discriminant shape the
				// reformulation classifier expects. `kind === "ask"`
				// does not auto-narrow `source` from `string` to the
				// discriminated union, so we construct a fresh
				// CommandDecision that the classifier can consume
				// type-safely. We carry the runtime evidence by
				// re-asserting `source` (it IS one of the union
				// members; the production wiring guarantees this).
				const decisionForClassifier = {
					kind: "ask" as const,
					reason: commandEval.decision.reason,
					source: commandEval.decision.source as Parameters<typeof isReformulatable>[0]["source"],
				}
				const reason = isReformulatable(decisionForClassifier, request.input, commandEval.hostAuthorization)
				if (reason !== null) {
					Logger.log(`[SdkController] Reformulation short-circuit for tool=${request.toolName}`)
					emitV2Capture({
						codePoint: "commandSafety.reformulation.v1",
						data: {
							reasonCode: REFORMULATION_REASON_CODE,
							attempt: 1,
							maxAttempts: 1,
						},
					})
					this.pendingReformulationSlot = {
						agentId: request.agentId,
						conversationId: request.conversationId,
						reasonCode: REFORMULATION_REASON_CODE,
					}
					return { approved: false, reason }
				}
			}
			if (commandEval.approved) {
				Logger.log(`[SdkController] Auto-approving tool execution: tool=${request.toolName}`)
				// ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01:
				// Decision-boundary probe for the non-command ALLOW path that
				// flows through the atomic command evaluator. The probe fires
				// BEFORE the return so the discriminator captures the ALLOW
				// decision (without it, this ALLOW was invisible to the
				// editor-tool ACT's CASE B/C analysis).
				if (!isCommand) {
					emitNonCommandDecisionProbe({
						request,
						approved: true,
						decisionKind: "allow",
						decisionReason: commandEval.decision?.reason,
						decisionSource: commandEval.decision?.source,
					})
				}
				return {
					approved: true,
					decision: commandEval.decision,
					executionPlan: commandEval.executionPlan,
					mandatorySeatbeltExecution: commandEval.mandatorySeatbeltExecution,
				}
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
				// Non-command tool: route through the target-aware composition
				// for the CURRENT INCLUDED SURFACE (`editor` + `apply_patch`).
				// Every other tool (read/browser/MCP/legacy edit names) keeps
				// the legacy boolean short-circuit behavior unchanged.
				if (request.toolName === "editor" || request.toolName === "apply_patch") {
					// CORRECTION01 (factory review `HALT_MULTI_TARGET_FAIL_CLOSED_BYPASS`):
					// For the CURRENT INCLUDED SURFACE (`editor` + `apply_patch`),
					// the target-aware composition is MANDATORY. The legacy
					// boolean short-circuit is NEVER consulted as a fallback for
					// these tool names — that was the load-bearing defect this
					// ACT exists to eliminate. If `getCwd` or
					// `getAutoApprovalSettings` is missing, we ASK (fail closed)
					// with an explicit "missing target-aware authority" reason.
					const editorResult = await this.handleEditorOrApplyPatchApproval(request)
					if (editorResult.approved) {
						// ALLOW: short-circuit the rest of the legacy path.
						return editorResult
					}
					// ASK: fall through to the manual approval-UI publication
					// path below. We stash the decision evidence in a member
					// variable so the publish path can carry it through to
					// the `pendingToolApprovalMessage` record.
					this.lastEditorOrApplyPatchDecision = editorResult.decision ?? null
				} else if (request.policy.autoApprove === true || this.options.shouldAutoApproveTool?.(request) === true) {
					Logger.log(`[SdkController] Auto-approving tool execution: tool=${request.toolName}`)
					// ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01:
					// Decision-boundary probe for the legacy non-command ALLOW
					// path. Mirrors the atomic-evaluator ALLOW probe above; both
					// fire BEFORE the return so the editor-tool ACT can correlate
					// "ALLOW returned" with the same conversationId + toolName it
					// sees in the (optional) `ui-published.v1` record downstream.
					emitNonCommandDecisionProbe({
						request,
						approved: true,
						decisionKind: "allow",
						decisionReason: "policy-or-shouldAutoApprove",
						decisionSource: request.policy.autoApprove === true ? "sdk-policy" : "host-callback",
					})
					return { approved: true }
				}
			}
		}

		// ACT-CLINEMM-APPROVAL-SPECIMEN-CAPTURE-TOOL02-CORRECTION01
		// Card-publication seam probes — default-off, never throw.
		// `branch` fires unconditionally on entry to the manual-ask code path;
		// `published` fires only after the ask message was actually emitted to
		// the webview. An auto-approved/bypass request returns from one of the
		// earlier `return { approved: true, ... }` exits and never reaches
		// either probe, which is the contract the matching test pins.
		emitV2Capture({
			codePoint: "approval.ui.branch.v2",
			scope: "request",
			data: {
				toolName: request.toolName,
				toolCallId: request.toolCallId,
			},
		})

		// ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01:
		// P probe — `approval.noncommand.result.v1`. Gates on the
		// effective diagnostic profile (not on the bare
		// `process.env`): public installs NEVER fire this code
		// point even if `CLINEMM_DIAG_APPROVAL_PUBLICATION_V2=1`
		// is exported (the identity resolver is the sole gate).
		// The gate returns false in public (fail-closed) and true
		// in dogfood by default unless explicitly overridden down.
		// This code point fires ONLY at the ASK fall-through
		// (after `branch`); the matching `decision.v1` probe at
		// every return boundary (ALLOW + ASK) is the load-bearing
		// CASE B/C discriminator (see ACT-CLINEMM-EDITOR-TOOL-
		// APPROVAL-FRICTION-RECON01).
		if (!isCommand) {
			const pProfileAsk = resolveEffectiveDiagnosticKnobs(
				process.env,
				isDogfoodRuntime(process.env),
				resolveCapturePathForProfileEffective(process.env),
			)
			if (pProfileAsk.p) {
				// Decision-boundary probe for the ASK fall-through. Fires
				// BEFORE the result.v1 emit so a single correlationId
				// surfaces both the decision (kind=ask) and the result
				// (`approvalResult: "ask"`); the editor-tool ACT correlates
				// them via the AsyncLocalStorage context. `commandEval` is
				// `undefined` here for non-command tools (the atomic
				// command evaluator only runs for `isCommand === true`),
				// so the reason/source fields default to `undefined`; the
				// downstream `result.v1` and `ui-published.v1` records
				// still carry the conversationId + toolName + correlationId
				// for cross-record joining.
				emitNonCommandDecisionProbe({
					request,
					approved: false,
					decisionKind: "ask",
					decisionReason: commandEval?.decision?.reason,
					decisionSource: commandEval?.decision?.source,
				})
				emitV2Capture({
					codePoint: "approval.noncommand.result.v1",
					scope: "request",
					data: {
						conversationId: request.conversationId,
						toolName: request.toolName,
						isCommand: false,
						approvalResult: "ask",
					},
				})
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
		emitV2Capture({
			codePoint: "approval.ui.published.v2",
			scope: "request",
			data: {
				toolName: request.toolName,
				toolCallId: request.toolCallId,
				messageTs: toolAskMessage.ts,
			},
		})
		// ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01:
		// P probe (noncommand pair). Fires alongside the existing
		// `approval.ui.published.v2` only when (a) the tool is
		// non-command AND (b) the effective diagnostic profile's
		// `p` knob is ON. The two code points together let
		// `...EDITOR-TOOL-APPROVAL-FRICTION-RECON01` distinguish:
		//   CASE A: `result`+`ui-published` both fire (full
		//           approval UI round-trip — the
		//           ALREADY-RESOLVED auto-approve path).
		//   CASE B: `result` fires, `ui-published` does NOT
		//           (ask resolved without the card being
		//           published — e.g. a synchronous policy
		//           override).
		//   CASE C: `result`+`ui-published` both fire and
		//           the user REJECTS the card (the
		//           ALREADY-OPENED path).
		// The probe is gated by `isCommand === false` to keep the
		// existing command-tool capture site (`branch` /
		// `published`) authoritative for command-tool friction.
		if (!isCommand) {
			const pProfilePublished = resolveEffectiveDiagnosticKnobs(
				process.env,
				isDogfoodRuntime(process.env),
				resolveCapturePathForProfileEffective(process.env),
			)
			if (pProfilePublished.p) {
				emitV2Capture({
					codePoint: "approval.noncommand.ui-published.v1",
					scope: "request",
					data: {
						conversationId: request.conversationId,
						toolName: request.toolName,
						isCommand: false,
						publicationOccurred: true,
						messageTs: toolAskMessage.ts,
					},
				})
			}
		}
		this.options.setTurnPhase?.("awaiting_approval", toolAskMessage.ts, "interaction-handle-tool-approval")
		await this.options.postStateToWebview()

		return new Promise<{ approved: boolean; reason?: string; executionPlan?: CommandExecutionPlan }>((resolve) => {
			this.pendingToolApprovalResolve = resolve
			this.pendingToolApprovalMessage = {
				toolCallId: request.toolCallId,
				messageTs: toolAskMessage.ts,
				toolName: request.toolName,
				// ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 PHASE 2:
				// Thread the editor/apply_patch decision evidence into the
				// pending record when present; otherwise fall back to the
				// command-tool decision carried by commandEval.
				decision: this.lastEditorOrApplyPatchDecision ?? commandEval?.decision,
				executionPlan: commandEval?.executionPlan, // CORRECTION04: plan captured atomically at entry
			}
			// Clear the carrier after consumption to prevent bleed-across.
			this.lastEditorOrApplyPatchDecision = null
		})
	}

	/**
	 * ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 PHASE 2:
	 * Target-aware auto-approval for the CURRENT INCLUDED SURFACE
	 * (`editor` + `apply_patch`).
	 *
	 * Layer contract:
	 *   1. classifier (async fs I/O; realpath + containment)
	 *   2. pure policy lattice (no I/O)
	 *   3. coordinator returns ALLOW or ASK from this method.
	 *
	 * The legacy boolean short-circuit
	 * (`request.policy.autoApprove || shouldAutoApproveTool`) is REPLACED
	 * for these two tool names. Every other tool keeps its existing
	 * behavior (legacy edit-tool names retain conservation; non-edit
	 * tools unchanged).
	 *
	 * If the verdict is ALLOW, this method returns the same shape as
	 * the legacy ALLOW path (with an optional `decision` evidence record).
	 * If the verdict is ASK, this method returns `{ approved: false }`
	 * so the caller falls through to the existing ASK publication path
	 * (which emits the `tool` ask card).
	 */
	private async handleEditorOrApplyPatchApproval(request: ToolApprovalRequest): Promise<{
		approved: boolean
		reason?: string
		decision?: { kind: "allow" | "ask" | "deny"; reason: string; source: string }
	}> {
		// Resolve the live workspace root via the host option. If absent,
		// fail closed: a target-aware ALLOW requires a canonical root.
		const workspaceRoot = this.options.getCwd?.()
		if (!workspaceRoot) {
			return {
				approved: false,
				reason: "editor: workspace root unavailable; cannot classify target",
			}
		}

		// Read the live AutoApproveBar settings. The host wires
		// `getAutoApprovalSettings` to the canonical StateManager snapshot.
		// If the option is absent we fail closed as well (no toggle snapshot).
		const settings = this.options.getAutoApprovalSettings?.()
		if (!settings) {
			return {
				approved: false,
				reason: "editor: auto-approval settings unavailable; cannot classify target",
			}
		}

		const evaluation = await evaluateEditAutoApprovalForRequest(request.toolName, request.input, workspaceRoot, settings)

		if (evaluation.decision.kind === "allow") {
			Logger.log(
				`[SdkController] Auto-approving editor/apply_patch: tool=${request.toolName} classification=${evaluation.classification}`,
			)
			emitNonCommandDecisionProbe({
				request,
				approved: true,
				decisionKind: "allow",
				decisionReason: "edit-effective-destination-policy",
				decisionSource: evaluation.classification,
			})
			return {
				approved: true,
				decision: {
					kind: "allow",
					reason: "edit-effective-destination-policy",
					source: evaluation.classification,
				},
			}
		}

		// ASK: fall through to the existing approval-UI publication.
		Logger.log(`[SdkController] ASK editor/apply_patch: tool=${request.toolName} reason=${evaluation.decision.reason}`)
		return {
			approved: false,
			reason: evaluation.decision.reason,
		}
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
		// ACT-CLINEMM-COMMAND-SAFETY-REFORMULATION01:
		// Drop the pending reformulation slot on session teardown so a
		// later re-instantiation (or a new conversation in the same
		// controller) starts without a stale armed slot.
		this.pendingReformulationSlot = undefined
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
