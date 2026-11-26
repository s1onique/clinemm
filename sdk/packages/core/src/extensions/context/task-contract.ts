/**
 * ACT-CLINEMM-COMPACTION-TASK-CONTRACT-CONSERVATION-REPAIR01
 *
 * Active task-contract extraction and pure carry-forward transformation.
 *
 * PROBLEM
 * -------
 * An Agentic compaction replaces the compacted prefix with a generated
 * summary. The generated summary is a LOSSY PROJECTION: the runtime
 * terminal-completion obligation in particular is frequently omitted, and a
 * later compaction then propagates the omission through `previousSummary`.
 * The continuing model therefore loses the active task contract even though
 * the canonical session history still carries it.
 *
 * AUTHORITY
 * ---------
 * The canonical session history (`context.messages` owned by the state-aware
 * compaction wrapper) remains the ONLY authority. This module never becomes a
 * second task-state owner and never invents a new durable representation.
 *
 * Two authorities are recognised, and ONLY these two:
 *
 *   1. USER authority — messages the EXISTING production classifier
 *      (`isTurnStartMessage`) recognises as user turn starts. Their text is
 *      carried verbatim; no semantic summarisation is performed.
 *
 *   2. RUNTIME authority — messages the EXISTING production classifier
 *      (`getUserRunSpan() === 0`) recognises as runtime-synthetic AND whose
 *      text is byte-identical to the runtime completion-reminder template
 *      (shared with its producer in `@cline/shared`). A malformed reminder, an
 *      unrelated runtime notice, assistant text, tool output and repository
 *      content are NEVER promoted.
 *
 * The textual section labels distinguish provenance. They do NOT create
 * separate provider-level security roles: the result is ordinary summary
 * text delivered in the existing `compaction_summary` provider `user`
 * message.
 */

import {
	estimateProviderRequestInputTokens,
	isCompletionToolReminderMessage,
	type MessageWithMetadata,
	omitUnauthorizedReasoningBlocks,
	TaskContractBudgetError,
	toProviderVisibleMessages,
} from "@cline/shared";
import { messagesToAgentMessages } from "../../runtime/config/agent-message-codec";
import { getUserRunSpan } from "../../session/user-run-messages";
import {
	getCompactionSummaryMetadata,
	isCompactionSummaryMessage,
	isTurnStartMessage,
} from "./compaction-shared";

/**
 * ACT-CLINEMM-FLINT-128K-BUDGET-AUTHORITY-REPAIR01
 *
 * The budget error is DEFINED in `@cline/shared` so that the compaction
 * pipeline (`@cline/core`) and the final model-request dispatch
 * (`@cline/agents`) share ONE implementation of the budget decision. It is
 * re-exported here so the existing core import path keeps working.
 */
export { TaskContractBudgetError } from "@cline/shared";

/**
 * The section headings. They are a stable, greppable marker so a carried
 * contract can be located and replaced deterministically on a later
 * compaction instead of accumulating copies.
 */
export const TASK_CONTRACT_SECTION_HEADING =
	"## Active task contract (authoritative)";
const USER_OBJECTIVE_HEADING = "### User-authored objective (user authority)";
const USER_LATER_HEADING = "### Later user instructions (user authority)";
const RUNTIME_HEADING = "### Runtime completion obligation (runtime authority)";

/**
 * The terminal completion tool names the runtime may require. The runtime
 * resolves them from the registered tools that declare
 * `lifecycle.completesRun === true`; the canonical transcript therefore only
 * ever carries a reminder for one of these names.
 */
const TERMINAL_COMPLETION_TOOL_NAMES = ["submit_and_exit"] as const;

/** The terminal completion tool names recognised in persisted reminders. */
export function getRecognizedTerminalCompletionToolNames(): string[] {
	return [...TERMINAL_COMPLETION_TOOL_NAMES];
}

/** A single authoritative instruction recovered from canonical history. */
export interface TaskContractItem {
	/** Which authority produced the item. */
	authority: "user" | "runtime";
	/** The verbatim source text. */
	text: string;
	/** The canonical history index the text came from. */
	sourceIndex: number;
}

/** The active task contract, recovered from canonical history. */
export interface ActiveTaskContract {
	/** The original user objective (first user turn start). */
	objective: TaskContractItem | undefined;
	/** Later user turn starts, in chronological order. */
	laterUserInstructions: TaskContractItem[];
	/** The applicable runtime terminal-completion obligation, if any. */
	runtimeCompletionObligation: TaskContractItem | undefined;
}

/**
 * Extract the visible text of a message the way the user actually saw it.
 * Only `text` blocks count: tool results, attachments and images are not
 * instructions.
 */
function visibleText(message: MessageWithMetadata): string {
	if (typeof message.content === "string") {
		return message.content;
	}
	if (!Array.isArray(message.content)) {
		return "";
	}
	const parts: string[] = [];
	for (const block of message.content) {
		if (block.type === "text" && typeof block.text === "string") {
			parts.push(block.text);
		}
	}
	return parts.join("\n");
}

/**
 * Extract the ACTIVE task contract from the canonical session history.
 *
 * The history MUST be the canonical history, not a compacted projection: the
 * original task and the runtime reminder may already be absent from a
 * projected history, and a previous summary is never an authority source.
 */
export function extractActiveTaskContract(
	canonicalMessages: readonly MessageWithMetadata[],
): ActiveTaskContract {
	let objective: TaskContractItem | undefined;
	const laterUserInstructions: TaskContractItem[] = [];
	let runtimeCompletionObligation: TaskContractItem | undefined;

	for (let index = 0; index < canonicalMessages.length; index += 1) {
		const message = canonicalMessages[index];
		if (isTurnStartMessage(message)) {
			const text = visibleText(message);
			if (!text.trim()) {
				continue;
			}
			if (!objective) {
				objective = { authority: "user", text, sourceIndex: index };
				continue;
			}
			laterUserInstructions.push({
				authority: "user",
				text,
				sourceIndex: index,
			});
			continue;
		}
		// Runtime authority: the message must be classified runtime-synthetic
		// by the existing production classifier AND carry the exact runtime
		// completion-reminder text.
		if (getUserRunSpan(message) !== 0) {
			continue;
		}
		const text = visibleText(message);
		if (
			!isCompletionToolReminderMessage(text, TERMINAL_COMPLETION_TOOL_NAMES)
		) {
			continue;
		}
		// The most recent runtime carrier wins; two identical reminders
		// therefore produce exactly ONE active obligation.
		runtimeCompletionObligation = {
			authority: "runtime",
			text,
			sourceIndex: index,
		};
	}

	return {
		objective,
		laterUserInstructions,
		runtimeCompletionObligation,
	};
}

/**
 * The contract section is delimited by an explicit BEGIN/END pair.
 *
 * Anti-spoofing: any occurrence of a delimiter inside carried SOURCE TEXT is
 * escaped (the leading backslash is inserted) before the text is embedded, so
 * model- or user-supplied text can never open or close the generated section
 * and thereby forge a new authority. The escape is reversible and applied to
 * the embedded text only — the canonical source text is never modified.
 */
const CONTRACT_BEGIN_MARKER = "<!-- cline-task-contract:begin -->";
const CONTRACT_END_MARKER = "<!-- cline-task-contract:end -->";

/** Escape delimiter occurrences inside carried source text. */
function escapeDelimiters(text: string): string {
	return text
		.split(CONTRACT_BEGIN_MARKER)
		.join(`\\${CONTRACT_BEGIN_MARKER}`)
		.split(CONTRACT_END_MARKER)
		.join(`\\${CONTRACT_END_MARKER}`);
}

/**
 * Render the deterministic carry-forward section for the active contract.
 *
 * Returns `undefined` when there is nothing authoritative to carry, so the
 * caller can leave the summary untouched (no synthetic section is invented).
 *
 * The output is a pure function of the canonical contract: the same canonical
 * active contract always yields byte-identical text.
 */
export function renderTaskContractSection(
	contract: ActiveTaskContract,
): string | undefined {
	const lines: string[] = [];
	if (contract.objective) {
		lines.push(USER_OBJECTIVE_HEADING);
		lines.push(escapeDelimiters(contract.objective.text.trim()));
	}
	if (contract.laterUserInstructions.length > 0) {
		lines.push(USER_LATER_HEADING);
		for (const instruction of contract.laterUserInstructions) {
			lines.push(escapeDelimiters(instruction.text.trim()));
		}
	}
	if (contract.runtimeCompletionObligation) {
		lines.push(RUNTIME_HEADING);
		lines.push(
			escapeDelimiters(contract.runtimeCompletionObligation.text.trim()),
		);
	}
	if (lines.length === 0) {
		return undefined;
	}
	return [
		TASK_CONTRACT_SECTION_HEADING,
		CONTRACT_BEGIN_MARKER,
		...lines,
		CONTRACT_END_MARKER,
	].join("\n");
}

/**
 * Remove any previously carried contract section from a summary text.
 *
 * This makes the carry-forward IDEMPOTENT: a later compaction replaces the
 * carried section with the section derived from the CURRENT canonical
 * authority instead of appending a second copy.
 */
export function stripTaskContractSection(summaryText: string): string {
	const begin = summaryText.indexOf(CONTRACT_BEGIN_MARKER);
	if (begin === -1) {
		return summaryText;
	}
	const end = summaryText.indexOf(CONTRACT_END_MARKER, begin);
	if (end === -1) {
		// A malformed (truncated) section is removed to its end so a partial
		// contract can never be presented as a complete one.
		return summaryText.slice(0, begin).trimEnd();
	}
	const before = summaryText.slice(0, begin).trimEnd();
	const after = summaryText.slice(end + CONTRACT_END_MARKER.length).trimStart();
	if (!before) {
		return after;
	}
	if (!after) {
		return before;
	}
	return `${before}\n\n${after}`;
}

/**
 * Apply the carry-forward to a summary text: strip any previously carried
 * section and append the section derived from the canonical contract.
 *
 * Returns the original text unchanged when there is no active contract, so a
 * summary without authoritative obligations is never rewritten.
 */
export function applyTaskContractToSummary(
	summaryText: string,
	contract: ActiveTaskContract,
): string {
	const section = renderTaskContractSection(contract);
	const stripped = stripTaskContractSection(summaryText).trimEnd();
	if (!section) {
		return stripped;
	}
	if (!stripped) {
		return section;
	}
	return `${stripped}\n\n${section}`;
}

/**
 * The outcome of applying the carry-forward.
 */
export interface TaskContractApplicationResult {
	/** The message list to use (contracted when applied, original otherwise). */
	messages: MessageWithMetadata[];
	/** Whether the contract was actually applied. */
	applied: boolean;
	/** The estimated request-input tokens of the returned messages. */
	estimatedRequestTokens: number;
}

/**
 * Apply the active task contract to a compacted message list, subject to an
 * explicit request-input budget.
 *
 * The contract is attached to the EXISTING `compaction_summary` message — the
 * message `buildSummaryMessage()` already produced. No second summary
 * message is created, no provider tool call is added, and every other
 * projected message is preserved unchanged.
 *
 * The provider-visible text AND `metadata.summary` are updated together, so
 * the representation a later compaction reads as `previousSummary` agrees
 * with what the model sees. (A repair that changed only one of the two would
 * be incorrect.)
 *
 * BUDGET
 * ------
 * `maxRequestTokens` is the effective request input limit (the same limit the
 * compaction budget machinery uses). When the contracted request would exceed
 * it, this function throws `TaskContractBudgetError` before any state can be
 * persisted or any provider request can be dispatched. Mandatory instructions
 * are never silently truncated and the continuation is never returned without
 * the complete authoritative contract.
 *
 * ACT-CLINEMM-FLINT-128K-BUDGET-AUTHORITY-REPAIR01 — BUDGET AUTHORITY
 * ---------------------------------------------------------------------
 * The budget is measured against the PROVIDER-VISIBLE representation of the
 * request, not the internal `MessageWithMetadata[]` envelope form.
 *
 * The internal form carries metadata envelopes, display-only fields and
 * tool-result wrappers that no provider ever receives. Measuring it rejected
 * the historical Flint 128K candidate (internal 133,487 estimated tokens)
 * even though every provider-visible form of the SAME logical request fitted
 * comfortably under the 128,000 ceiling.
 *
 * `options.providerMessages` is the provider-prepared projection of the
 * candidate messages, produced by the runtime's provider-request transform
 * (`MessageBuilder.buildForApi` + the agent-message codec). It is OPTIONAL:
 * when it is absent the guard falls back to measuring the internal
 * representation, which is the conservative choice (it can only reject more,
 * never less). When it IS present, it is the authority.
 *
 * Returns the input list unchanged when there is no `compaction_summary`
 * message to attach to or no active contract to carry.
 */
export function applyTaskContractToCompactedMessages(
	compactedMessages: readonly MessageWithMetadata[],
	canonicalMessages: readonly MessageWithMetadata[],
	options: {
		/** Effective request input limit; `undefined` disables the guard. */
		maxRequestTokens?: number;
		/** The final request shape estimator input. */
		systemPrompt?: string;
		tools?: readonly unknown[];
		/**
		 * ACT-CLINEMM-FLINT-128K-BUDGET-AUTHORITY-REPAIR01 — the
		 * PROVIDER-VISIBLE projection of a candidate message list.
		 *
		 * The runtime's provider-request transform
		 * (`MessageBuilder.buildForApi` + the agent-message codec) produces
		 * the representation the provider actually receives. When supplied,
		 * the guard measures THAT representation instead of the internal
		 * envelope form, so the guard's authority matches the request that
		 * would be dispatched.
		 *
		 * It is a FUNCTION of the candidate messages because the guard must
		 * measure the CONTRACTED list: the contract is applied to the
		 * summary before the projection is taken.
		 *
		 * When it is absent the guard measures the internal representation,
		 * which is the conservative fallback (it can only reject more, never
		 * less). A projection failure must NOT silently downgrade the
		 * authority to the internal form when the provider form was
		 * requested — the caller decides, by omitting the projection.
		 */
		providerMessages?: (
			messages: readonly MessageWithMetadata[],
		) => Promise<readonly unknown[]> | readonly unknown[];
		/**
		 * ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01.
		 *
		 * Whether the target transport REQUIRES provider-origin authorization
		 * for a reasoning block.
		 *
		 * On such a transport an UNSIGNED reasoning block is omitted by the
		 * resolved serializer, so it is not provider-visible content and the
		 * guard must not measure it. `undefined`/absent keeps the pre-existing
		 * behaviour exactly: every reasoning block is measured.
		 */
		requiresSignedReasoning?: boolean;
	} = {},
): Promise<TaskContractApplicationResult> {
	/**
	 * ACT-CLINEMM-FLINT-128K-BUDGET-AUTHORITY-REPAIR01 — the budget
	 * authority is the PROVIDER-VISIBLE representation when the runtime
	 * supplies it, and the internal representation otherwise.
	 *
	 * `measure()` is ASYNC because the provider projection is produced by the
	 * runtime's provider-request transform. The guard is therefore async from
	 * this point on; every caller already awaits it inside an async
	 * prepare-turn closure.
	 */
	const measure = async (
		messages: readonly MessageWithMetadata[],
	): Promise<number> => {
		const providerMessages = options.providerMessages
			? await options.providerMessages(messages)
			: undefined;
		if (!providerMessages) {
			// No provider projection supplied: measure the internal
			// representation. This is the conservative fallback (it can only
			// reject more, never less).
			return estimateProviderRequestInputTokens({
				systemPrompt: options.systemPrompt ?? "",
				messages,
				tools: options.tools ?? [],
			});
		}
		// ACT-CLINEMM-FLINT-128K-BUDGET-AUTHORITY-REPAIR01: the provider
		// projection is the API-safe INTERNAL form produced by the runtime's
		// provider-request transform. The form the provider actually receives
		// is that list passed through the agent-message codec
		// (`messagesToAgentMessages` -> `toProviderVisibleMessages`), which
		// drops the metadata envelope the provider never sees.
		//
		// Measuring the API-safe internal form would still count the
		// metadata envelope — exactly the over-count this repair exists to
		// remove. The projection therefore goes all the way to the
		// provider-visible shape.
		const providerVisible = toProviderVisibleMessages(
			messagesToAgentMessages(providerMessages as MessageWithMetadata[]),
		);
		// ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01: the guard measures
		// the request the provider ACTUALLY receives. On a transport that
		// requires provider-origin authorization for a reasoning block (the
		// Anthropic family), an UNSIGNED reasoning block is omitted by the
		// resolved serializer, so measuring it would over-count content the
		// provider never sees.
		//
		// The exclusion is the SAME one the serializer performs, applied to
		// the SAME provider-visible projection, so the guard and the wire
		// cannot disagree.
		const authorizedProviderVisible = omitUnauthorizedReasoningBlocks(
			providerVisible,
			{ requiresSignedReasoning: options.requiresSignedReasoning === true },
		);
		return estimateProviderRequestInputTokens({
			systemPrompt: options.systemPrompt ?? "",
			messages: authorizedProviderVisible,
			tools: options.tools ?? [],
		});
	};
	return applyTaskContractWithMeasuredBudget({
		compactedMessages,
		canonicalMessages,
		measure,
		maxRequestTokens: options.maxRequestTokens,
	});
}

/**
 * The guard's decision body, split out so the asynchronous measurement can
 * be shared by the synchronous-looking public entry point above.
 */
async function applyTaskContractWithMeasuredBudget(input: {
	compactedMessages: readonly MessageWithMetadata[];
	canonicalMessages: readonly MessageWithMetadata[];
	measure: (messages: readonly MessageWithMetadata[]) => Promise<number>;
	maxRequestTokens?: number;
}): Promise<TaskContractApplicationResult> {
	const { compactedMessages, canonicalMessages, measure } = input;
	const contract = extractActiveTaskContract(canonicalMessages);
	const baselineTokens = await measure(compactedMessages);
	if (!contract.objective && !contract.runtimeCompletionObligation) {
		return {
			messages: [...compactedMessages],
			applied: false,
			estimatedRequestTokens: baselineTokens,
		};
	}
	const summaryIndex = compactedMessages.findIndex((message) =>
		isCompactionSummaryMessage(message),
	);
	if (summaryIndex === -1) {
		return {
			messages: [...compactedMessages],
			applied: false,
			estimatedRequestTokens: baselineTokens,
		};
	}
	const summaryMessage = compactedMessages[summaryIndex];
	const currentSummary =
		getCompactionSummaryMetadata(summaryMessage)?.summary ??
		readSummaryTextFromContent(summaryMessage);
	if (typeof currentSummary !== "string") {
		return {
			messages: [...compactedMessages],
			applied: false,
			estimatedRequestTokens: baselineTokens,
		};
	}
	const nextSummary = applyTaskContractToSummary(currentSummary, contract);
	if (nextSummary === currentSummary) {
		return {
			messages: [...compactedMessages],
			applied: false,
			estimatedRequestTokens: baselineTokens,
		};
	}
	const nextMessages = [...compactedMessages];
	nextMessages[summaryIndex] = rebuildSummaryMessage(
		summaryMessage,
		nextSummary,
	);
	const nextTokens = await measure(nextMessages);
	if (
		typeof input.maxRequestTokens === "number" &&
		nextTokens > input.maxRequestTokens
	) {
		// Fail closed. Returning the un-contracted projection here would let a
		// valid-looking request continue after silently losing the original
		// objective, constraints, and completion obligation. The caller must
		// stop before sidecar persistence or provider dispatch instead.
		throw new TaskContractBudgetError({
			estimatedRequestTokens: nextTokens,
			maxRequestTokens: input.maxRequestTokens,
		});
	}
	return {
		messages: nextMessages,
		applied: true,
		estimatedRequestTokens: nextTokens,
	};
}

/**
 * The provider-visible text of a summary message: `buildSummaryMessage()`
 * renders `Context summary:\n\n<summary>`.
 */
function readSummaryTextFromContent(
	message: MessageWithMetadata,
): string | undefined {
	if (typeof message.content === "string") {
		return message.content;
	}
	if (!Array.isArray(message.content)) {
		return undefined;
	}
	const text = message.content
		.filter(
			(block): block is { type: "text"; text: string } =>
				block.type === "text" && typeof block.text === "string",
		)
		.map((block) => block.text)
		.join("\n");
	if (!text) {
		return undefined;
	}
	const prefix = "Context summary:\n\n";
	return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

/**
 * Rebuild a summary message with a new summary text, keeping every other
 * metadata field (kind, displayRole, userRunSpan, details, tokensBefore,
 * generatedAt) and the message envelope unchanged.
 */
function rebuildSummaryMessage(
	message: MessageWithMetadata,
	summary: string,
): MessageWithMetadata {
	const metadata = message.metadata
		? { ...message.metadata, summary }
		: { summary };
	return {
		...message,
		content: [{ type: "text", text: `Context summary:\n\n${summary}` }],
		metadata,
	};
}
