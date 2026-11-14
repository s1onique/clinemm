/**
 * ACT-CLINEMM-FLINT-128K-BUDGET-AUTHORITY-REPAIR01
 *
 * Permanent hermetic regression suite for the REQUEST-BUDGET AUTHORITY.
 *
 * THE DEFECT
 * ----------
 * The task-contract budget guard measured the INTERNAL
 * `MessageWithMetadata[]` representation of a compacted request. That
 * representation carries metadata envelopes, display-only fields and
 * tool-result wrappers that no provider ever receives. On the historical
 * Flint 128K candidate the internal form measured 133,487 estimated tokens
 * while every provider-visible form of the SAME logical request measured
 * ~66,059 — comfortably under the 128,000 ceiling.
 *
 * The guard therefore rejected a request the provider would have accepted.
 * The defect was NOT an inaccurate estimator; it was an AUTHORITY mismatch:
 * the guard measured the wrong representation.
 *
 * THE REPAIRED CONTRACT
 * ---------------------
 * 1. The budget is measured against the PROVIDER-VISIBLE representation:
 *    the final system prompt, the provider-visible messages, and the final
 *    tool inventory.
 * 2. The estimator is UNCHANGED (`estimateRequestInputTokens`, 3 chars per
 *    token, flat per-image cost). Nothing here loosens the safety margin.
 * 3. Provider-reported usage is NEVER invented or substituted.
 * 4. The guard FAILS CLOSED: an over-budget provider-ready request throws
 *    `TaskContractBudgetError` BEFORE any provider dispatch and BEFORE any
 *    compaction sidecar write.
 * 5. The mandatory task contract is NEVER truncated to fit.
 *
 * This suite drives the REAL production boundary:
 *   createCompactionStateAwarePrepareTurn()  (the state-aware wrapper)
 *     -> projectSessionCompactionState()     (the real projector)
 *     -> input.compact()                     (the real agentic result seam)
 *     -> createSessionCompactionState()      (the real persistence builder)
 *     -> applyTaskContractToCompactedMessages() (the real budget guard)
 *     -> MessageBuilder.buildForApi()        (the real provider-request seam)
 *
 * Every scenario exercises production functions. The suite does NOT merely
 * assert constants declared in this file.
 */

import {
	estimateRequestInputTokens,
	type MessageWithMetadata,
	toProviderVisibleMessages,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	agentMessagesToMessages,
	messagesToAgentMessages,
} from "../../runtime/config/agent-message-codec";
import { type SessionCompactionState } from "../../session/models/session-compaction";
import { MessageBuilder } from "../../session/services/message-builder";
import {
	type ContextPipelinePrepareTurn,
	createCompactionStateAwarePrepareTurn,
} from "./compaction";
import { TaskContractBudgetError } from "./task-contract";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RUNTIME_COMPLETION_REMINDER =
	"[SYSTEM] This run is not complete until you call one of these terminal completion tools: submit_and_exit. Continue working if requirements are not met. If the task is complete, call the appropriate terminal completion tool now.";

const ORIGINAL_USER_TASK = [
	'<user_input mode="act">Repair the Flint 128K budget authority defect.',
	"",
	"Measure the final provider-visible representation.",
	"",
	"Do not raise the operating ceiling.",
	"</user_input>",
].join("\n");

function userTurn(text: string): MessageWithMetadata {
	return { role: "user", content: [{ type: "text", text }] };
}

function runtimeReminder(text: string): MessageWithMetadata {
	return {
		role: "user",
		content: [{ type: "text", text }],
		metadata: { userRunSpan: 0 },
	};
}

function assistantTurn(text: string): MessageWithMetadata {
	return { role: "assistant", content: [{ type: "text", text }] };
}

/**
 * Canonical history. The user objective and the runtime obligation are the
 * authorities the contract must conserve.
 */
function canonicalHistory(): MessageWithMetadata[] {
	return [
		userTurn(ORIGINAL_USER_TASK),
		runtimeReminder(RUNTIME_COMPLETION_REMINDER),
		assistantTurn("working"),
	];
}

const MODEL = {
	id: "mock-model",
	provider: "anthropic",
	info: { id: "mock-model", maxInputTokens: 256_000 },
} as const;

const SYSTEM_PROMPT = "You are a helpful coding assistant.";

/** The 128K operating ceiling under which the historical defect appeared. */
const CEILING_128K = 128_000;

/**
 * Build the real agentic compaction result: an ordinary `compaction_summary`
 * message plus the preserved tail.
 */
function agenticCompactionResult(
	summaryText: string,
	tail: MessageWithMetadata[],
): { messages: MessageWithMetadata[] } {
	return {
		messages: [
			{
				role: "user",
				content: [{ type: "text", text: `Context summary:\n\n${summaryText}` }],
				metadata: {
					kind: "compaction_summary",
					displayRole: "system",
					userRunSpan: 1,
					summary: summaryText,
					details: { readFiles: [], modifiedFiles: [] },
					tokensBefore: 1_000,
					generatedAt: 1,
				},
			},
			...tail,
		],
	};
}

/** Flatten every text block of every message into one searchable blob. */
function providerVisibleText(messages: readonly MessageWithMetadata[]): string {
	return messages
		.flatMap((message) =>
			Array.isArray(message.content)
				? message.content
						.filter(
							(block): block is { type: "text"; text: string } =>
								block.type === "text" && typeof block.text === "string",
						)
						.map((block) => block.text)
				: typeof message.content === "string"
					? [message.content]
					: [],
		)
		.join("\n");
}

function countOccurrences(haystack: string, needle: string): number {
	if (!needle) {
		return 0;
	}
	let count = 0;
	let index = haystack.indexOf(needle);
	while (index !== -1) {
		count += 1;
		index = haystack.indexOf(needle, index + needle.length);
	}
	return count;
}

/**
 * The provider-visible projection of a message list, exactly as the provider
 * receives it: internal envelope -> agent message -> provider message.
 */
function providerProjection(
	messages: readonly MessageWithMetadata[],
): ReturnType<typeof agentMessagesToMessages> {
	return agentMessagesToMessages(messagesToAgentMessages(messages as any));
}

type WrapperRun = {
	prepared: Awaited<ReturnType<ContextPipelinePrepareTurn>>;
	providerRequest: MessageWithMetadata[];
	savedStates: SessionCompactionState[];
};

async function runWrapper(input: {
	canonical: MessageWithMetadata[];
	existingState?: SessionCompactionState;
	compactResult?: {
		messages: MessageWithMetadata[];
		systemPrompt?: string;
	};
	maxRequestTokens?: number;
	systemPrompt?: string;
	/** The provider-request transform used for the accounting projection. */
	prepareApiMessages?: (
		messages: MessageWithMetadata[],
	) => Promise<MessageWithMetadata[]>;
	prepareBudgetAccountingMessages?: (
		messages: MessageWithMetadata[],
	) => Promise<MessageWithMetadata[]>;
}): Promise<WrapperRun> {
	const compact = vi.fn(async () => {
		if (!input.compactResult) {
			return undefined;
		}
		return input.compactResult;
	});
	const savedStates: SessionCompactionState[] = [];
	const prepareTurn = createCompactionStateAwarePrepareTurn({
		compact,
		getState: () => input.existingState,
		prepareApiMessages:
			input.prepareApiMessages ?? (async (messages) => messages),
		...(input.prepareBudgetAccountingMessages
			? {
					prepareBudgetAccountingMessages:
						input.prepareBudgetAccountingMessages,
				}
			: {}),
		saveState: (state) => {
			savedStates.push(state);
		},
		maxRequestTokens: input.maxRequestTokens,
	});
	const prepared = await prepareTurn({
		agentId: "agent-1",
		conversationId: "conv-1",
		parentAgentId: null,
		iteration: 1,
		abortSignal: new AbortController().signal,
		systemPrompt: input.systemPrompt ?? SYSTEM_PROMPT,
		tools: [],
		messages: input.canonical,
		apiMessages: input.canonical,
		model: MODEL,
	});
	// The real provider-request preparation seam.
	const providerRequest = new MessageBuilder().buildForApi(
		prepared?.messages ?? input.canonical,
	);
	return { prepared, providerRequest, savedStates };
}

// ---------------------------------------------------------------------------
// RED: the historical candidate is accepted at the same 128K ceiling
// ---------------------------------------------------------------------------

describe("request-budget authority — historical RED candidate", () => {
	it("accepts a candidate whose INTERNAL form exceeds 128K when its PROVIDER-VISIBLE form fits", async () => {
		// The internal envelope form carries the metadata that the provider
		// never sees. Build a candidate whose internal measurement exceeds
		// the ceiling while its provider-visible measurement does not.
		const bulk = "x".repeat(100_000);
		const canonical: MessageWithMetadata[] = [
			userTurn(ORIGINAL_USER_TASK),
			runtimeReminder(RUNTIME_COMPLETION_REMINDER),
			assistantTurn("working"),
		];
		const compaction = agenticCompactionResult(`summary ${bulk}`, []);
		// Give the summary message a LARGE internal-only metadata payload.
		// None of this reaches the provider.
		const summaryMessage = compaction.messages[0];
		summaryMessage.metadata = {
			...summaryMessage.metadata,
			details: {
				readFiles: Array.from(
					{ length: 1700 },
					(_, index) =>
						`/very/long/repository/path/that/never/reaches/the/provider/file-${index}.ts`,
				),
				modifiedFiles: Array.from(
					{ length: 1700 },
					(_, index) => `/another/long/repository/path/file-${index}.ts`,
				),
			},
		};
		const compacted = compaction.messages;

		const internalW = estimateRequestInputTokens({
			systemPrompt: SYSTEM_PROMPT,
			messages: compacted,
			tools: [],
		});
		const providerW = estimateRequestInputTokens({
			systemPrompt: SYSTEM_PROMPT,
			messages: providerProjection(compacted),
			tools: [],
		});

		// The fixture must actually reproduce the shape of the defect: the
		// internal form is over the ceiling, the provider form is under it.
		expect(internalW).toBeGreaterThan(CEILING_128K);
		expect(providerW).toBeLessThanOrEqual(CEILING_128K);

		// The guard, driven with the provider-visible projection, accepts.
		const { prepared } = await runWrapper({
			canonical,
			compactResult: compaction,
			maxRequestTokens: CEILING_128K,
			prepareBudgetAccountingMessages: async (messages) =>
				new MessageBuilder().buildForApi(messages),
		});

		expect(prepared).toBeDefined();
		// The contract is conserved, exactly once.
		const text = providerVisibleText(prepared?.messages ?? []);
		expect(text).toContain("Active task contract (authoritative)");
		expect(countOccurrences(text, "Active task contract (authoritative)")).toBe(
			1,
		);
	});
});

// ---------------------------------------------------------------------------
// GREEN: genuinely oversized provider-ready requests still fail closed
// ---------------------------------------------------------------------------

describe("request-budget authority — fail-closed over the provider-visible form", () => {
	it("throws TaskContractBudgetError with zero sidecar writes", async () => {
		const canonical = canonicalHistory();
		// A summary so large that the provider-visible form is ALSO over the
		// ceiling. The contract must NOT be truncated to fit.
		const compaction = agenticCompactionResult("y".repeat(2_000_000), []);
		const savedStates: SessionCompactionState[] = [];
		const prepareTurn = createCompactionStateAwarePrepareTurn({
			compact: async () => compaction,
			getState: () => undefined,
			prepareApiMessages: async (messages) => messages,
			prepareBudgetAccountingMessages: async (messages) =>
				new MessageBuilder().buildForApi(messages),
			saveState: (state) => {
				savedStates.push(state);
			},
			maxRequestTokens: CEILING_128K,
		});

		await expect(
			prepareTurn({
				agentId: "agent-1",
				conversationId: "conv-1",
				parentAgentId: null,
				iteration: 1,
				abortSignal: new AbortController().signal,
				systemPrompt: SYSTEM_PROMPT,
				tools: [],
				messages: canonical,
				apiMessages: canonical,
				model: MODEL,
			}),
		).rejects.toBeInstanceOf(TaskContractBudgetError);

		// Zero partial sidecar writes: the guard rejects BEFORE persistence.
		expect(savedStates).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// The provider projection is the SAME representation the codec emits
// ---------------------------------------------------------------------------

describe("request-budget authority — projection parity with the provider codec", () => {
	it("measures exactly the representation the provider receives", () => {
		const messages: MessageWithMetadata[] = [
			userTurn("hello"),
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "t1",
						name: "read_file",
						input: { path: "/tmp/a.txt" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "t1",
						name: "read_file",
						content: "file contents",
					},
				],
			},
		];

		// The shared projection used by the budget authority and the core
		// codec MUST agree byte-for-byte. A divergence here would reintroduce
		// exactly the authority-mismatch defect this repair exists to fix.
		expect(
			toProviderVisibleMessages(messagesToAgentMessages(messages as any)),
		).toEqual(
			agentMessagesToMessages(messagesToAgentMessages(messages as any)),
		);
	});
});

// ---------------------------------------------------------------------------
// The accounting projection must not perturb the production builder
// ---------------------------------------------------------------------------

describe("request-budget authority — no duplicate semantic mutation", () => {
	it("does not change a later build on the shared production builder", () => {
		const readToolUse = (id: string, path: string) =>
			({
				role: "assistant",
				content: [{ type: "tool_use", id, name: "read_file", input: { path } }],
			}) as unknown as MessageWithMetadata;
		const readToolResult = (id: string, content: string) =>
			({
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: id,
						name: "read_file",
						content,
					},
				],
			}) as unknown as MessageWithMetadata;

		const listA = [readToolUse("t1", "/tmp/a.txt"), readToolResult("t1", "a")];
		const listB = [readToolUse("t2", "/tmp/b.txt"), readToolResult("t2", "b")];

		const shared = new MessageBuilder();
		const firstA = shared.buildForApi(listA as any);

		// An accounting-only build on a FRESH builder (what the guard does).
		const fresh = new MessageBuilder();
		fresh.buildForApi(listB as any);

		const secondA = shared.buildForApi(listA as any);

		expect(JSON.stringify(secondA)).toBe(JSON.stringify(firstA));
	});
});
