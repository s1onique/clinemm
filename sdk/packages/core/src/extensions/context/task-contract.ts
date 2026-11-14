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
	estimateRequestInputTokens,
	isCompletionToolReminderMessage,
	type MessageWithMetadata,
} from "@cline/shared";
import { getUserRunSpan } from "../../session/user-run-messages";
import {
	getCompactionSummaryMetadata,
	isCompactionSummaryMessage,
	isTurnStartMessage,
} from "./compaction-shared";

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
 * Raised when the complete authoritative task contract cannot fit inside the
 * effective request-input budget.
 *
 * This is deliberately a hard boundary rather than a "skip the contract"
 * result. An un-contracted continuation can fit comfortably inside the
 * provider context window while silently dropping the original objective,
 * constraints, and completion obligation. The only safe alternatives are:
 * deliver the complete contract, or stop before provider dispatch.
 */
export class TaskContractBudgetError extends Error {
	readonly estimatedRequestTokens: number;
	readonly maxRequestTokens: number;

	constructor(input: {
		estimatedRequestTokens: number;
		maxRequestTokens: number;
	}) {
		super(
			`Active task contract exceeds the effective request budget (${input.estimatedRequestTokens} > ${input.maxRequestTokens} estimated tokens)`,
		);
		this.name = "TaskContractBudgetError";
		this.estimatedRequestTokens = input.estimatedRequestTokens;
		this.maxRequestTokens = input.maxRequestTokens;
	}
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
	} = {},
): TaskContractApplicationResult {
	const contract = extractActiveTaskContract(canonicalMessages);
	const estimate = (messages: readonly MessageWithMetadata[]): number =>
		estimateRequestInputTokens({
			systemPrompt: options.systemPrompt ?? "",
			messages,
			tools: options.tools ?? [],
		});
	const baselineTokens = estimate(compactedMessages);
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
	const nextTokens = estimate(nextMessages);
	if (
		typeof options.maxRequestTokens === "number" &&
		nextTokens > options.maxRequestTokens
	) {
		// Fail closed. Returning the un-contracted projection here would let a
		// valid-looking request continue after silently losing the original
		// objective, constraints, and completion obligation. The caller must
		// stop before sidecar persistence or provider dispatch instead.
		throw new TaskContractBudgetError({
			estimatedRequestTokens: nextTokens,
			maxRequestTokens: options.maxRequestTokens,
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
