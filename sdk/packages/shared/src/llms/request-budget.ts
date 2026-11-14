/**
 * Request-budget authority — ACT-CLINEMM-FLINT-128K-BUDGET-AUTHORITY-REPAIR01
 *
 * THE SINGLE BUDGET AUTHORITY for provider request input sizing.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The task-contract budget guard used to measure the INTERNAL
 * `MessageWithMetadata[]` representation of a compacted request. That
 * representation carries metadata envelopes, display-only fields and
 * tool-result wrappers that the provider NEVER sees. On the historical Flint
 * 128K candidate the internal form measured 133,487 estimated tokens while
 * every provider-visible form of the SAME logical request measured well under
 * the 128,000 ceiling (see
 * `docs/acts/ACT-CLINEMM-FLINT-128K-BUDGET-RECOVERY-RECON01/`).
 *
 * The guard therefore rejected a request the provider would have accepted.
 * The defect was NOT an inaccurate estimator: it was an AUTHORITY mismatch —
 * the guard measured the wrong representation.
 *
 * THE REPAIRED CONTRACT
 * ---------------------
 * 1. The budget is measured against the PROVIDER-VISIBLE representation of
 *    the request: the final system prompt, the provider-visible messages, and
 *    the final tool inventory.
 * 2. The estimator is UNCHANGED. `estimateRequestInputTokens` remains the
 *    single estimator, with the same conservative `CHARS_PER_TOKEN = 3` and
 *    the same flat per-image cost. Nothing here loosens the safety margin
 *    for unusual tokenizers, images, or unknown tokenization.
 * 3. Provider-reported usage is NEVER invented, substituted, or used to
 *    relax a limit. This module estimates; it does not reconcile against a
 *    provider bill.
 * 4. The guard FAILS CLOSED. When the effective ceiling is supplied and the
 *    provider-visible request exceeds it, `TaskContractBudgetError` is thrown
 *    BEFORE any provider dispatch and before any compaction sidecar write.
 * 5. The mandatory task contract is NEVER truncated to fit. An
 *    over-budget contracted request stops the turn; it is never continued
 *    without the contract.
 *
 * This module lives in `@cline/shared` because BOTH `@cline/core` (which owns
 * the compaction pipeline and the task-contract guard) and `@cline/agents`
 * (which owns the final model-request dispatch) depend on `@cline/shared`
 * but NOT on each other. Keeping the authority here guarantees there is
 * exactly ONE implementation of the budget decision.
 */

import type { AgentMessage, AgentMessagePart } from "../agent";
import type { ContentBlock, Message, ToolResultContent } from "./messages";
import { estimateRequestInputTokens } from "./tokens";

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
 * The provider-visible request shape used for budget measurement.
 *
 * `messages` MUST already be in provider-visible form (see
 * {@link toProviderVisibleMessages}). The system prompt and the tool
 * inventory are the FINAL values that will accompany the request.
 */
export interface ProviderRequestBudgetInput {
	/** The final system prompt that will accompany the request. */
	systemPrompt?: string;
	/** The provider-visible messages of the request. */
	messages: readonly unknown[];
	/** The final tool inventory of the request. */
	tools?: readonly unknown[];
	/**
	 * The effective request-input ceiling. `undefined` disables the guard —
	 * the estimate is still computed and returned, but no rejection occurs.
	 */
	maxRequestTokens?: number;
}

/**
 * Preserve the runtime tool-output serialization used by canonical session
 * persistence AND by the provider-visible projection.
 *
 * This intentionally lives in `@cline/shared` so the provider codec
 * (`@cline/core`) and the request-budget authority (`@cline/shared`) can
 * NEVER diverge: both call this one function.
 */
export function toPersistedToolResultContent(
	output: unknown,
): ToolResultContent["content"] {
	if (typeof output === "string") {
		return output;
	}
	if (Array.isArray(output)) {
		// Structured local and provider tool outputs are persisted as arrays even
		// when their entries are not media/text blocks (for example Cline
		// ToolOperationResult objects and Anthropic web_search_result objects).
		return output as ToolResultContent["content"];
	}
	// Keep this identical to the canonical AgentMessage codec. Undefined and
	// circular values intentionally retain that codec's existing behavior.
	return JSON.stringify(output) as ToolResultContent["content"];
}

/**
 * Project an agent-message list onto the representation the provider
 * actually receives.
 *
 * THIS IS THE CANONICAL PROJECTION. `@cline/core`'s
 * `agentMessagesToMessages()` (runtime/config/agent-message-codec.ts)
 * DELEGATES to this function, so the request-budget authority and the
 * provider codec are guaranteed to measure/emit the SAME representation.
 * A divergent copy of this logic would reintroduce exactly the class of
 * authority-mismatch defect this repair exists to fix.
 *
 * The agent-message envelope fields (`id`, `createdAt`, `metadata`,
 * `modelInfo`, `metrics`) are dropped because no provider sees them, and
 * the `tool` role is folded into the `user` role because that is how tool
 * results are delivered.
 *
 * The function is PURE. It performs no truncation, no deduplication and no
 * state mutation, so it is safe to call for accounting purposes without
 * perturbing the request that will actually be dispatched.
 */
export function toProviderVisibleMessages(
	messages: readonly AgentMessage[],
): Message[] {
	const out: Message[] = [];
	for (const message of messages) {
		const content = message.content
			.map(agentPartToContentBlock)
			.filter((block): block is ContentBlock => block !== undefined);
		const role = message.role === "tool" ? "user" : message.role;
		const previous = out[out.length - 1];
		if (
			role === "user" &&
			content.length > 0 &&
			content.every((block) => block.type === "tool_result") &&
			previous?.role === "user" &&
			Array.isArray(previous.content) &&
			previous.content.every((block) => block.type === "tool_result")
		) {
			previous.content.push(...content);
			continue;
		}
		out.push({ role, content });
	}
	return out;
}

function agentPartToContentBlock(
	part: AgentMessagePart,
): ContentBlock | undefined {
	switch (part.type) {
		case "text":
			return { type: "text", text: part.text };
		case "reasoning": {
			if (part.redacted === true) {
				const data =
					(part.metadata as { data?: string } | undefined)?.data ?? "";
				return { type: "redacted_thinking", data };
			}
			const signature = extractThoughtSignature(part.metadata);
			const details = extractReasoningDetails(part.metadata);
			return {
				type: "thinking",
				thinking: part.text,
				...(signature === undefined ? {} : { signature }),
				...(details === undefined ? {} : { details }),
			};
		}
		case "image":
			// CONSERVATION (CORRECTION01): a NON-STRING image payload is
			// OMITTED, not converted into an empty image block.
			//
			// `AgentImagePart.image` is `string | Uint8Array | ArrayBuffer |
			// URL`, but only the base64 STRING form is representable in the
			// provider-visible `ImageContent` shape. The pre-repair core codec
			// returned `undefined` for every non-string form, and the part was
			// then filtered out of the emitted content. Emitting
			// `{ type: "image", data: "" }` instead would inject an EMPTY image
			// block into a provider-bound request: the provider would receive a
			// broken image, AND the flat per-image token cost
			// (`ESTIMATED_TOKENS_PER_IMAGE`) would still be charged for it,
			// changing image-token accounting. The 128K budget repair must not
			// alter this pre-existing production behavior, so the omission
			// semantics are preserved exactly.
			return typeof part.image === "string"
				? {
						type: "image",
						data: part.image,
						mediaType: part.mediaType ?? "image/png",
					}
				: undefined;
		case "file":
			return { type: "file", path: part.path, content: part.content };
		case "media":
			return { type: "media", media: part.media };
		case "tool-call": {
			const signature = extractThoughtSignature(part.metadata);
			return {
				type: "tool_use",
				id: part.toolCallId,
				name: part.toolName,
				input: (part.input as Record<string, unknown>) ?? {},
				...(signature === undefined ? {} : { signature }),
			};
		}
		case "tool-result":
			return {
				type: "tool_result",
				tool_use_id: part.toolCallId,
				name: part.toolName,
				content: toPersistedToolResultContent(part.output),
				is_error: part.isError,
			};
	}
}

function extractThoughtSignature(metadata: unknown): string | undefined {
	if (!metadata || typeof metadata !== "object") {
		return undefined;
	}
	const record = metadata as {
		signature?: unknown;
		thoughtSignature?: unknown;
	};
	if (typeof record.thoughtSignature === "string") {
		return record.thoughtSignature;
	}
	return typeof record.signature === "string" ? record.signature : undefined;
}

function extractReasoningDetails(metadata: unknown): unknown[] | undefined {
	if (!metadata || typeof metadata !== "object") {
		return undefined;
	}
	const record = metadata as { details?: unknown };
	return Array.isArray(record.details) ? record.details : undefined;
}

/**
 * Estimate the provider-visible request input size.
 *
 * Uses the EXISTING conservative estimator unchanged: the serialized request
 * is measured at `CHARS_PER_TOKEN` (3) characters per token, and each image
 * contributes a flat `ESTIMATED_TOKENS_PER_IMAGE` cost in place of its
 * base64 payload.
 */
export function estimateProviderRequestInputTokens(input: {
	systemPrompt?: string;
	messages: readonly unknown[];
	tools?: readonly unknown[];
}): number {
	return estimateRequestInputTokens({
		systemPrompt: input.systemPrompt,
		messages: input.messages,
		tools: input.tools,
	});
}

/**
 * Enforce the request-input ceiling against a provider-visible request.
 *
 * Returns the measured estimate. Throws {@link TaskContractBudgetError} when
 * the ceiling is supplied and the estimate exceeds it. The caller MUST
 * invoke this BEFORE any provider dispatch and BEFORE any compaction
 * sidecar write, so an over-budget request never leaves the process.
 */
export function assertProviderRequestWithinBudget(
	input: ProviderRequestBudgetInput,
): number {
	const estimatedRequestTokens = estimateProviderRequestInputTokens(input);
	if (
		typeof input.maxRequestTokens === "number" &&
		estimatedRequestTokens > input.maxRequestTokens
	) {
		throw new TaskContractBudgetError({
			estimatedRequestTokens,
			maxRequestTokens: input.maxRequestTokens,
		});
	}
	return estimatedRequestTokens;
}
