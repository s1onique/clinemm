/**
 * ACT-CLINEMM-PCK-GENERATION-ELIGIBILITY-REPAIR-01
 *
 * C1/C3 — the PRODUCTION-SEAM RED and the CONSERVATION MATRIX for the
 * Pre-Compaction Knowledge Checkpoint (PCK) GENERATION ORDERING.
 *
 * ============================================================================
 * WHAT THIS WITNESS PROVES
 * ============================================================================
 *
 * The checkpoint is an ADDITIONAL provider model call. It must be paid for
 * ONLY by a compaction decision that was actually ELIGIBLE and that actually
 * ran the AGENTIC strategy for the FIRST time in its session.
 *
 * The production composition under test is the REAL one:
 *
 *   createCompactionStateAwarePrepareTurn      (the state-aware outer wrapper)
 *     -> createContextCompactionPrepareTurn    (the inner seam that OWNS the
 *                                                eligibility decision)
 *        -> the REAL eligibility arithmetic
 *        -> the REAL strategy selection
 *        -> runAgenticCompaction / runBasicCompaction
 *
 * The PCK provider transport is a DETERMINISTIC SUBSTITUTE with a spy that
 * COUNTS invocations. It is NOT a mock compaction function returning
 * `undefined`: the compaction function under test is the REAL production
 * seam, and the eligibility decision it makes is the REAL production
 * arithmetic.
 *
 * ============================================================================
 * THE DEFECT THIS WITNESS WITNESSES
 * ============================================================================
 *
 * Against the UNCHANGED production implementation, the outer wrapper invoked
 * `generatePreCompactionKnowledgeCheckpoint()` BEFORE awaiting
 * `input.compact(context)`. The eligibility decision lives INSIDE the inner
 * seam, so an ORDINARY, INELIGIBLE turn reached the checkpoint generation
 * and paid a full provider model call for a compaction that never happened.
 *
 * The primary assertion is therefore:
 *
 *   PCK generation call count == 0
 *
 * on a turn whose REAL eligibility decision DECLINES compaction.
 *
 * ============================================================================
 * THE POSITIVE CONTROL
 * ============================================================================
 *
 * A count-only assertion cannot distinguish "the seam never fired" from "the
 * spy is unreachable". The positive control therefore drives a GENUINELY
 * ELIGIBLE agentic compaction and asserts that the generation spy IS reached,
 * and that it is reached AFTER the ordinary summarizer dependency — i.e. the
 * ordering is verified through the dependencies themselves, not through
 * timestamps.
 */

import type * as LlmsProviders from "@cline/llms";
import type { BasicLogger, MessageWithMetadata } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageBuilder } from "../../../session/services/message-builder";
import { createSessionCompactionState } from "../../../session/models/session-compaction";
import type { SessionCompactionState } from "../../../session/models/session-compaction";
import {
	createCompactionStateAwarePrepareTurn,
	createContextCompactionPrepareTurn,
} from "../compaction";

const createHandlerMock = vi.fn();

vi.mock("@cline/llms", () => ({
	createHandlerAsync: (config: unknown) => createHandlerMock(config),
}));

/**
 * The ordinary summarizer's response. It is deliberately PLAIN so a
 * checkpoint section embedded in it is unambiguous.
 */
const HISTORICAL_SUMMARY = [
	"## Goal",
	"Inspect the deployment configuration and report the working knowledge.",
	"",
	"## State",
	"- **Done:** Ran a read-only inspection of the deployment directory.",
].join("\n");

/**
 * The accepted, closed checkpoint proposal the deterministic provider
 * returns when a checkpoint request is made.
 */
const ACCEPTED_CHECKPOINT_RESPONSE = JSON.stringify({
	records: [
		{
			kind: "observation",
			assurance: "tool_observed",
			status: "active",
			atom: "OPERATION_INVOKED",
			argument: "build",
			evidenceRefs: ["tool_call_r4"],
		},
	],
});

/**
 * The ORDER in which the production dependencies were invoked.
 *
 * "summarizer" is the ordinary agentic compaction's provider call.
 * "checkpoint" is the PCK's provider call.
 *
 * ACT-CLINEMM-PCK-QWEN-INFERENCE-POLICY-01 (bounded predecessor
 * test-strength improvement 4): the comment that described this order
 * CONTRADICTED the assertion that reads it. The comment claimed the
 * positive control asserted that `checkpoint` appears AFTER `summarizer`,
 * while the assertion checks the OPPOSITE — `checkpoint` appears BEFORE
 * `summarizer`.
 *
 * The production order is the latter, and it is load-bearing: the
 * checkpoint is derived from the working agent's FULL context, so it must
 * be generated BEFORE the summarizer rewrites that context into a lossy
 * summary. A checkpoint generated after the summarizer would be derived
 * from the very lossy representation the checkpoint exists to preserve.
 *
 * The comment now states the order the assertion actually checks.
 */
const invocationOrder: string[] = [];

/**
 * The response text the deterministic provider returns for a CHECKPOINT
 * request. A scenario can override it to drive the publication gate's
 * rejection path.
 */
let checkpointResponseText = ACCEPTED_CHECKPOINT_RESPONSE;

async function* streamChunks(
	chunks: readonly Record<string, unknown>[],
): AsyncGenerator<Record<string, unknown>> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

beforeEach(() => {
	invocationOrder.length = 0;
	checkpointResponseText = ACCEPTED_CHECKPOINT_RESPONSE;
	createHandlerMock.mockReset();
	createHandlerMock.mockImplementation((config: unknown) => {
		const providerConfig = config as { systemPrompt?: string };
		const isCheckpoint =
			typeof providerConfig.systemPrompt === "string" &&
			providerConfig.systemPrompt.includes("WORKING-KNOWLEDGE CHECKPOINT");
		return {
			createMessage: vi.fn((_systemPrompt: string, messages: unknown[]) => {
				const first = messages[0] as { content?: string } | undefined;
				if (isCheckpoint) {
					invocationOrder.push("checkpoint");
					return streamChunks([
						{
							type: "text",
							id: "pck-1",
							text: checkpointResponseText,
						},
						{ type: "done", id: "pck-1", success: true },
					]);
				}
				invocationOrder.push("summarizer");
				return streamChunks([
					{ type: "text", id: "summary-1", text: HISTORICAL_SUMMARY },
					{ type: "done", id: "summary-1", success: true },
				]);
			}),
		};
	});
});

afterEach(() => {
	delete process.env.CLINEMM_PCK_CLOSED_ENABLED;
});

/**
 * A canonical history with ONE verified tool outcome, so the closed
 * publication gate has real evidence to admit a record from.
 *
 * ACT-CLINEMM-PCK-QWEN-INFERENCE-POLICY-01 (bounded predecessor
 * test-strength improvement 4): the fixture uses the EXISTING
 * PRODUCTION-SHAPED POSITIVE COMMAND, `make build`.
 *
 * `make build` is the only allowlisted command classification that
 * establishes the `build` argument (see
 * `evidence.ts` — `build: Object.freeze(["make build"])`), so it is the
 * fixture that produces a DETERMINISTICALLY ESTABLISHED operation and the
 * stronger `tool_observed` assurance. The predecessor's `kc.sh build` is
 * NOT on the allowlist, so with it the published record was DOWNGRADED to
 * `model_reported` and the fixture did not exercise the production
 * positive path at all.
 */
function canonicalHistory(options: {
	readonly paddingPairs?: number;
	readonly command?: string;
}): MessageWithMetadata[] {
	const command = options.command ?? "make build";
	const messages: MessageWithMetadata[] = [
		{
			role: "user",
			id: "msg_task",
			content: "Inspect the deployment configuration and report findings.",
		} as unknown as MessageWithMetadata,
		{
			role: "assistant",
			id: "msg_call",
			content: [
				{
					type: "tool_use",
					id: "tool_call_r4",
					name: "run_commands",
					input: { command },
				},
			],
		} as unknown as MessageWithMetadata,
		{
			role: "user",
			id: "msg_result",
			content: [
				{
					type: "tool_result",
					tool_use_id: "tool_call_r4",
					content: [
						{
							query: command,
							result: "build completed successfully",
							success: true,
						},
					],
				},
			],
		} as unknown as MessageWithMetadata,
	];
	for (let index = 0; index < (options.paddingPairs ?? 0); index += 1) {
		messages.push({
			role: "user",
			id: `msg_pad_${index}`,
			content: `padding ${index} ${"x".repeat(400)}`,
		} as unknown as MessageWithMetadata);
		messages.push({
			role: "assistant",
			id: `msg_pad_a_${index}`,
			content: `padding reply ${index} ${"y".repeat(400)}`,
		} as unknown as MessageWithMetadata);
	}
	return messages;
}

/**
 * The spy that counts PCK GENERATION invocations.
 *
 * It is NON-VACUOUS: it returns an ACCEPTED checkpoint, so a reachable spy
 * produces a published checkpoint. A spy that always failed would make the
 * count assertion meaningless.
 */
function createGenerationSpy(options?: {
	readonly responseText?: string;
	readonly hang?: boolean;
}): {
	readonly generate: (
		input: {
			readonly systemPrompt: string;
			readonly request: string;
			readonly signal: AbortSignal;
		},
	) => Promise<{
		readonly text: string;
		readonly reasoningChars: number;
		readonly usedTools: boolean;
		readonly failed: boolean;
	}>;
	readonly count: () => number;
} {
	let calls = 0;
	return {
		generate: async ({ systemPrompt, request, signal }) => {
			calls += 1;
			if (options?.responseText !== undefined) {
				checkpointResponseText = options.responseText;
			}
			if (options?.hang) {
				// The provider NEVER answers. The attempt runs into the
				// checkpoint's own deadline, which aborts the signal.
				await new Promise<void>((_resolve, reject) => {
					signal.addEventListener(
						"abort",
						() => reject(new Error("aborted")),
						{ once: true },
					);
				});
			}
			const handler = await createHandlerMock({ systemPrompt }).createMessage(
				systemPrompt,
				[{ role: "user", content: request }],
			);
			let text = "";
			let usedTools = false;
			for await (const chunk of handler) {
				if (chunk.type === "text") {
					text += chunk.text;
				} else if (chunk.type === "tool_calls") {
					usedTools = true;
				}
			}
			signal.throwIfAborted();
			return { text, reasoningChars: 0, usedTools, failed: false };
		},
		count: () => calls,
	};
}

/**
 * The PRODUCTION composition under test.
 *
 * `mode` is the inner seam's mode. `maxInputTokens` is the OUTER model's
 * limit, which is the limit the OUTER wrapper's own budget accounting uses;
 * `innerMaxInputTokens` is the limit the INNER seam's eligibility
 * arithmetic uses.
 *
 * ACT-CLINEMM-PCK-QWEN-INFERENCE-POLICY-01 (bounded predecessor
 * test-strength improvement 1): the composition is created ONCE and can
 * then be driven for MANY successive turns.
 *
 * The reason is that the composition OWNS per-session state that a fresh
 * composition would reset: the inner seam's per-session monotonic
 * DECISION-ORDINAL counter. Driving ten successive turns through ten
 * FRESH compositions measured ten independent first decisions, which is
 * NOT the same thing as ten successive decisions inside ONE runtime. The
 * counter is what makes two decisions inside the same iteration
 * distinguishable, so the production behaviour under test — "one decision
 * identity per decision, and the checkpoint is paid for only by a
 * decision that was actually eligible" — is only observable when the
 * composition persists.
 */
function createProductionComposition(input: {
	readonly mode: "auto" | "manual" | "overflow_recovery";
	readonly outerMaxInputTokens: number;
	readonly innerMaxInputTokens: number;
	readonly strategy: "agentic" | "basic";
	readonly compactionEnabled?: boolean;
	readonly checkpointEnabled?: boolean;
	readonly existingState?: unknown;
	readonly onSaveState?: (state: unknown) => void;
	readonly decisionId?: () => string;
	readonly onDecisionId?: (decisionId: string) => void;
	readonly logger?: BasicLogger;
	readonly generation: ReturnType<typeof createGenerationSpy>;
}): (context: {
	readonly messages: MessageWithMetadata[];
	readonly overflowRecovery?: boolean;
	readonly iteration?: number;
}) => Promise<{
	readonly result: unknown;
	readonly messages: MessageWithMetadata[];
}> {
	const providerId = "anthropic";
	const modelId = "mock-model";
	const innerModel = {
		id: modelId,
		provider: providerId,
		info: { id: modelId, maxInputTokens: input.innerMaxInputTokens },
	} as unknown as Parameters<
		NonNullable<
			Parameters<typeof createCompactionStateAwarePrepareTurn>[0]["compact"]
		>
	>[0]["model"];
	const outerModel = {
		id: modelId,
		provider: providerId,
		info: { id: modelId, maxInputTokens: input.outerMaxInputTokens },
	} as unknown as Parameters<
		NonNullable<
			Parameters<typeof createCompactionStateAwarePrepareTurn>[0]["compact"]
		>
	>[0]["model"];

	const inner = createContextCompactionPrepareTurn(
		{
			providerId,
			modelId,
			providerConfig: { providerId, modelId } as LlmsProviders.ProviderConfig,
			compaction: {
				enabled: input.compactionEnabled ?? true,
				strategy: input.strategy,
				preserveRecentTokens: 1,
			},
			logger: input.logger,
		},
		{ mode: input.mode },
	);

	const prepareTurn = createCompactionStateAwarePrepareTurn({
		compact: (context) =>
			inner?.({ ...context, model: innerModel }) ?? Promise.resolve(undefined),
		getState: () =>
			input.existingState as SessionCompactionState | undefined,
		prepareApiMessages: async (messages) => messages,
		saveState: (state) => {
			input.onSaveState?.(state);
		},
		...(input.checkpointEnabled === false
			? {}
			: {
					knowledgeCheckpoint: {
						generate: input.generation.generate,
						decisionId: () => {
							const id = input.decisionId?.() ?? "decision-identity-under-test";
							input.onDecisionId?.(id);
							return id;
						},
						deadlineMs: () => 5_000,
					},
				}),
	});

	return async (context) => {
		const result = await prepareTurn({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: context.iteration ?? 1,
			abortSignal: new AbortController().signal,
			systemPrompt: "You are a helpful coding assistant.",
			tools: [],
			messages: context.messages,
			apiMessages: context.messages,
			model: outerModel,
			overflowRecovery: context.overflowRecovery,
		});
		return {
			result,
			messages: (result as { messages?: MessageWithMetadata[] } | undefined)
				?.messages ?? [],
		};
	};
}

/**
 * Drive ONE turn through a production composition.
 */
async function runProductionComposition(input: {
	readonly messages: MessageWithMetadata[];
	readonly mode: "auto" | "manual" | "overflow_recovery";
	readonly overflowRecovery?: boolean;
	readonly outerMaxInputTokens: number;
	readonly innerMaxInputTokens: number;
	readonly strategy: "agentic" | "basic";
	readonly compactionEnabled?: boolean;
	readonly checkpointEnabled?: boolean;
	readonly existingState?: unknown;
	readonly onSaveState?: (state: unknown) => void;
	readonly decisionId?: () => string;
	readonly onDecisionId?: (decisionId: string) => void;
	readonly logger?: BasicLogger;
	readonly generation: ReturnType<typeof createGenerationSpy>;
}): Promise<{
	readonly result: unknown;
	readonly messages: MessageWithMetadata[];
}> {
	const composition = createProductionComposition(input);
	return await composition({
		messages: input.messages,
		overflowRecovery: input.overflowRecovery,
	});
}

describe("ACT-CLINEMM-PCK-GENERATION-ELIGIBILITY-REPAIR-01 — generation ordering", () => {
	it("C1.1 RED: an INELIGIBLE ordinary turn generates NO checkpoint", async () => {
		// (1) PCK is enabled.
		process.env.CLINEMM_PCK_CLOSED_ENABLED = "1";
		// (2) No existing compaction state.
		const existingState = undefined;
		// (3) Ordinary automatic mode.
		const mode = "auto" as const;
		// (4) Input below the actual compaction threshold.
		//
		// The inner seam's REAL arithmetic is:
		//
		//   requestTriggerTokens = maxInputTokens * COMPACTION_TRIGGER_RATIO
		//   shouldCompact        = requestInputTokens >= requestTriggerTokens
		//
		// With a 128k limit and a history of a few hundred tokens, the
		// trigger is ~100k tokens and the request is far below it.
		const innerMaxInputTokens = 128_000;
		const outerMaxInputTokens = 128_000;
		const messages = canonicalHistory({ paddingPairs: 2 });

		const generation = createGenerationSpy();
		const outcome = await runProductionComposition({
			messages,
			mode,
			outerMaxInputTokens,
			innerMaxInputTokens,
			strategy: "agentic",
			checkpointEnabled: true,
			existingState,
			generation,
		});

		// (5) The REAL eligibility decision DECLINES compaction: the inner
		// seam produced NO compaction messages, so the outer wrapper took
		// its metadata-only no-compaction branch.
		expect(outcome.messages).toEqual([]);
		// (6) The generation call count must be ZERO.
		expect(generation.count()).toBe(0);
	});

	it("C1.2: TEN successive ineligible turns in ONE runtime generate NO checkpoint", async () => {
		process.env.CLINEMM_PCK_CLOSED_ENABLED = "1";
		const generation = createGenerationSpy();
		// ACT-CLINEMM-PCK-QWEN-INFERENCE-POLICY-01 (bounded predecessor
		// test-strength improvement 1): ONE PERSISTENT production
		// composition drives all ten turns.
		//
		// The composition owns the inner seam's per-session monotonic
		// DECISION-ORDINAL counter, so ten successive turns through it are
		// ten successive decisions inside ONE runtime — the situation the
		// production behaviour is actually about. Ten FRESH compositions
		// would each have restarted the counter at zero, so every turn
		// would have been a first decision and the ordinal would never
		// have advanced.
		const composition = createProductionComposition({
			mode: "auto",
			outerMaxInputTokens: 128_000,
			innerMaxInputTokens: 128_000,
			strategy: "agentic",
			checkpointEnabled: true,
			existingState: undefined,
			generation,
		});
		for (let turn = 0; turn < 10; turn += 1) {
			// The canonical history EVOLVES across turns.
			const messages = canonicalHistory({ paddingPairs: turn + 1 });
			const outcome = await composition({
				messages,
				iteration: turn + 1,
			});
			// Every turn really was INELIGIBLE: the REAL eligibility
			// decision declined compaction, so no compaction messages were
			// produced. Without this the row could pass vacuously.
			expect(outcome.messages).toEqual([]);
		}
		expect(generation.count()).toBe(0);
	});

	it("C1.3 POSITIVE CONTROL: an ELIGIBLE agentic compaction DOES generate", async () => {
		process.env.CLINEMM_PCK_CLOSED_ENABLED = "1";
		const generation = createGenerationSpy();
		// A TINY limit makes the REAL eligibility arithmetic say "compact":
		//
		//   requestTriggerTokens = 16_000 * 0.9 = 14_400 tokens
		//
		// and the padded history exceeds that.
		const messages = canonicalHistory({ paddingPairs: 120 });
		const outcome = await runProductionComposition({
			messages,
			mode: "auto",
			// The OUTER limit drives the task-contract budget guard and the
			// wrapper's own accounting, so it must be large enough for the
			// compaction result to pass. The INNER limit drives the
			// eligibility arithmetic, so it stays tight.
			outerMaxInputTokens: 128_000,
			innerMaxInputTokens: 16_000,
			strategy: "agentic",
			checkpointEnabled: true,
			existingState: undefined,
			generation,
		});

		// The compaction actually happened.
		expect(outcome.messages.length).toBeGreaterThan(0);
		// The generation spy IS reachable.
		expect(generation.count()).toBe(1);
		// And it ran BEFORE the ordinary summarizer dependency: the
		// checkpoint is derived from the working agent's FULL context, so
		// it must be generated before the summarizer rewrites that context
		// into a lossy summary.
		expect(invocationOrder.indexOf("checkpoint")).toBeLessThan(
			invocationOrder.indexOf("summarizer"),
		);
		// And it is reached ONLY through the ELIGIBLE compaction: both
		// dependencies ran inside the same compaction invocation.
		expect(invocationOrder).toEqual(["checkpoint", "summarizer"]);
	});
});

/**
 * The conservation matrix.
 *
 * Every scenario asserts the GENERATION INVOCATION COUNT — not merely the
 * absence of published checkpoint text — so a scenario that silently
 * generated a checkpoint and then failed to publish it still fails.
 */
describe("ACT-CLINEMM-PCK-GENERATION-ELIGIBILITY-REPAIR-01 — conservation matrix", () => {
	it("C3.1: Feature OFF — 0 generations", async () => {
		delete process.env.CLINEMM_PCK_CLOSED_ENABLED;
		const generation = createGenerationSpy();
		await runProductionComposition({
			messages: canonicalHistory({ paddingPairs: 120 }),
			mode: "auto",
			outerMaxInputTokens: 128_000,
			innerMaxInputTokens: 16_000,
			strategy: "agentic",
			checkpointEnabled: true,
			generation,
		});
		expect(generation.count()).toBe(0);
	});

	it("C3.2: Compaction DISABLED — 0 generations", async () => {
		process.env.CLINEMM_PCK_CLOSED_ENABLED = "1";
		const generation = createGenerationSpy();
		await runProductionComposition({
			messages: canonicalHistory({ paddingPairs: 120 }),
			mode: "auto",
			outerMaxInputTokens: 128_000,
			innerMaxInputTokens: 16_000,
			strategy: "agentic",
			compactionEnabled: false,
			checkpointEnabled: true,
			generation,
		});
		expect(generation.count()).toBe(0);
	});

	it("C3.3: ELIGIBLE BASIC compaction — 0 generations", async () => {
		process.env.CLINEMM_PCK_CLOSED_ENABLED = "1";
		const generation = createGenerationSpy();
		const outcome = await runProductionComposition({
			messages: canonicalHistory({ paddingPairs: 120 }),
			mode: "auto",
			outerMaxInputTokens: 128_000,
			innerMaxInputTokens: 16_000,
			strategy: "basic",
			checkpointEnabled: true,
			generation,
		});
		// The compaction DID happen — the generation is skipped by the
		// STRATEGY gate, not by an absent compaction.
		expect(outcome.messages.length).toBeGreaterThan(0);
		expect(generation.count()).toBe(0);
	});

	it("C3.4: OVERFLOW RECOVERY — 0 generations", async () => {
		process.env.CLINEMM_PCK_CLOSED_ENABLED = "1";
		const generation = createGenerationSpy();
		const outcome = await runProductionComposition({
			messages: canonicalHistory({ paddingPairs: 4 }),
			mode: "overflow_recovery",
			overflowRecovery: true,
			outerMaxInputTokens: 128_000,
			innerMaxInputTokens: 128_000,
			strategy: "agentic",
			checkpointEnabled: true,
			generation,
		});
		// The recovery compaction DID happen.
		expect(outcome.messages.length).toBeGreaterThan(0);
		// Recovery never waits for an additional model generation.
		expect(generation.count()).toBe(0);
	});

	it("C3.5: RE-COMPACTION — ordinary summarization runs, PCK generation stays 0", async () => {
		process.env.CLINEMM_PCK_CLOSED_ENABLED = "1";
		const generation = createGenerationSpy();
		const sourceMessages = canonicalHistory({ paddingPairs: 120 });
		// A PRIOR compaction state exists, so this turn is the SECOND
		// compaction of the session.
		//
		// ACT-CLINEMM-PCK-QWEN-INFERENCE-POLICY-01 (bounded predecessor
		// test-strength improvement 4): the predecessor's comment claimed
		// the re-compaction path "re-compacts an already summarised
		// transcript", but the fixture built the sidecar with the FULL
		// CANONICAL history as its compacted messages, so the projected
		// transcript was the canonical history itself, not a summary.
		// The comment now states what the fixture actually builds: the
		// re-compaction path is entered because a PRIOR sidecar exists,
		// and the checkpoint seam is not forwarded into that path.
		const existingState = createSessionCompactionState({
			sourceMessages,
			compactedMessages: sourceMessages,
			conversationId: "conv-1",
		});
		const outcome = await runProductionComposition({
			messages: sourceMessages,
			mode: "auto",
			outerMaxInputTokens: 128_000,
			// The TIGHT inner limit makes the REAL eligibility arithmetic
			// say "compact" for the RE-COMPACTION candidate as well.
			//
			// ACT-CLINEMM-PCK-QWEN-INFERENCE-POLICY-01 (bounded predecessor
			// test-strength improvement 2): the predecessor's row used a
			// LOOSE inner limit, so the re-compaction candidate was
			// INELIGIBLE, the ordinary summarizer NEVER RAN, and the row
			// asserted a generation count of zero against a seam that was
			// never reached at all. The row was VACUOUS: it would have
			// passed for a production that generated a checkpoint on every
			// re-compaction, because the re-compaction never reached the
			// generation point either way.
			//
			// The control is now NON-VACUOUS: the ordinary summarizer is
			// asserted to have ACTUALLY run, so the re-compaction really
			// happened and ONLY the checkpoint generation was skipped.
			innerMaxInputTokens: 16_000,
			strategy: "agentic",
			checkpointEnabled: true,
			existingState,
			generation,
		});
		// The ordinary summarizer ACTUALLY ran: the re-compaction really
		// happened.
		expect(invocationOrder).toContain("summarizer");
		// And the checkpoint generation was skipped — the re-compaction
		// path does not forward the checkpoint seam.
		expect(invocationOrder).not.toContain("checkpoint");
		// The compaction produced its transcript.
		expect(outcome.messages.length).toBeGreaterThan(0);
		// And the checkpoint generation is still zero.
		expect(generation.count()).toBe(0);
	});

	it("C3.6: an ORDINARY turn AFTER a compaction — 0 generations", async () => {
		process.env.CLINEMM_PCK_CLOSED_ENABLED = "1";
		const generation = createGenerationSpy();
		const sourceMessages = canonicalHistory({ paddingPairs: 4 });
		const existingState = createSessionCompactionState({
			sourceMessages,
			compactedMessages: sourceMessages,
			conversationId: "conv-1",
		});
		// The next turn is INELIGIBLE: the projected transcript is small.
		await runProductionComposition({
			messages: sourceMessages,
			mode: "auto",
			outerMaxInputTokens: 128_000,
			innerMaxInputTokens: 128_000,
			strategy: "agentic",
			checkpointEnabled: true,
			existingState,
			generation,
		});
		expect(generation.count()).toBe(0);
	});

	it("C3.7: a REJECTED PCK candidate — the ordinary compaction is preserved", async () => {
		process.env.CLINEMM_PCK_CLOSED_ENABLED = "1";
		// The provider returns a candidate the publication gate REJECTS:
		// its evidence reference does not exist in the canonical history.
		const generation = createGenerationSpy({
			responseText: JSON.stringify({
				records: [
					{
						kind: "observation",
						assurance: "tool_observed",
						status: "active",
						atom: "OPERATION_INVOKED",
						argument: "build",
						evidenceRefs: ["tool_call_that_does_not_exist"],
					},
				],
			}),
		});
		const outcome = await runProductionComposition({
			messages: canonicalHistory({ paddingPairs: 120 }),
			mode: "auto",
			outerMaxInputTokens: 128_000,
			innerMaxInputTokens: 16_000,
			strategy: "agentic",
			checkpointEnabled: true,
			generation,
		});
		// The generation HAPPENED — it was the candidate that was rejected.
		expect(generation.count()).toBe(1);
		// The ordinary compaction is preserved.
		expect(outcome.messages.length).toBeGreaterThan(0);
		// And NOTHING from the rejected candidate reached the projection.
		expect(JSON.stringify(outcome.messages)).not.toContain(
			"cline-knowledge-checkpoint:begin",
		);
	});

	it("C3.8: a TIMED-OUT PCK — the ordinary compaction is preserved", async () => {
		process.env.CLINEMM_PCK_CLOSED_ENABLED = "1";
		// The provider NEVER answers: the attempt runs into its deadline.
		const generation = createGenerationSpy({ hang: true });
		const outcome = await runProductionComposition({
			messages: canonicalHistory({ paddingPairs: 120 }),
			mode: "auto",
			outerMaxInputTokens: 128_000,
			innerMaxInputTokens: 16_000,
			strategy: "agentic",
			checkpointEnabled: true,
			generation,
		});
		// The generation was ATTEMPTED...
		expect(generation.count()).toBe(1);
		// ...the ordinary compaction is preserved...
		expect(outcome.messages.length).toBeGreaterThan(0);
		// ...and no checkpoint section was published.
		expect(JSON.stringify(outcome.messages)).not.toContain(
			"cline-knowledge-checkpoint:begin",
		);
	});

	it("C3.9: ACCEPTED records still reach BOTH publication destinations", async () => {
		process.env.CLINEMM_PCK_CLOSED_ENABLED = "1";
		const generation = createGenerationSpy();
		const messages = canonicalHistory({ paddingPairs: 120 });
		const persistedStates: unknown[] = [];
		const outcome = await runProductionComposition({
			messages,
			mode: "auto",
			outerMaxInputTokens: 128_000,
			innerMaxInputTokens: 16_000,
			strategy: "agentic",
			checkpointEnabled: true,
			generation,
			onSaveState: (state) => {
				persistedStates.push(state);
			},
		});
		expect(generation.count()).toBe(1);
		// Destination 1: the PERSISTED sidecar.
		expect(persistedStates.length).toBe(1);
		expect(JSON.stringify(persistedStates[0])).toContain(
			"cline-knowledge-checkpoint:begin",
		);
		// Destination 2: the PROVIDER-VISIBLE projection.
		const providerVisible = new MessageBuilder().buildForApi(
			outcome.messages as unknown as Parameters<
				MessageBuilder["buildForApi"]
			>[0],
		);
		expect(JSON.stringify(providerVisible)).toContain(
			"cline-knowledge-checkpoint:begin",
		);
	});

	it("C3.10: the DECISION IDENTITY is authoritative — never the session id", async () => {
		process.env.CLINEMM_PCK_CLOSED_ENABLED = "1";
		const generation = createGenerationSpy();
		// The seam that OWNS the decision logs the identity it bound the
		// attempt to. That log line is the PRODUCTION-OBSERVABLE identity.
		const loggedDecisionIds: string[] = [];
		const logger = {
			debug: (message: string, meta?: Record<string, unknown>): void => {
				if (
					message === "Pre-compaction knowledge checkpoint attempt" &&
					typeof meta?.decisionId === "string"
				) {
					loggedDecisionIds.push(meta.decisionId);
				}
			},
			log: (): void => {},
		} as unknown as BasicLogger;
		const sourceMessages = canonicalHistory({ paddingPairs: 120 });
		await runProductionComposition({
			messages: sourceMessages,
			mode: "auto",
			outerMaxInputTokens: 128_000,
			innerMaxInputTokens: 16_000,
			strategy: "agentic",
			checkpointEnabled: true,
			generation,
			// A host that supplies an EMPTY identity gets the seam's
			// authoritative one — the session id is never substituted.
			decisionId: () => "",
			logger,
		});
		expect(generation.count()).toBe(1);
		expect(loggedDecisionIds.length).toBe(1);
		// The identity is the per-session monotonic DECISION-ORDINAL
		// identity: `<session>#<iteration>#<ordinal>`. It is NOT the bare
		// session id.
		expect(loggedDecisionIds[0]).toContain("#");
		expect(loggedDecisionIds[0].split("#").length).toBe(3);
	});

	it("C3.11: successive decisions in ONE runtime carry DISTINCT authoritative identities", async () => {
		process.env.CLINEMM_PCK_CLOSED_ENABLED = "1";
		const generation = createGenerationSpy();
		const loggedDecisionIds: string[] = [];
		const logger = {
			debug: (message: string, meta?: Record<string, unknown>): void => {
				if (
					message === "Pre-compaction knowledge checkpoint attempt" &&
					typeof meta?.decisionId === "string"
				) {
					loggedDecisionIds.push(meta.decisionId);
				}
			},
			log: (): void => {},
		} as unknown as BasicLogger;
		// ACT-CLINEMM-PCK-QWEN-INFERENCE-POLICY-01 (bounded predecessor
		// test-strength improvement 3): the identities are DISTINCT.
		//
		// The predecessor asserted the SHAPE of ONE identity. That shape
		// holds for every identity, including a CONSTANT one, so it could
		// not distinguish "one authoritative identity per decision" from
		// "the same identity every time". A shared identity would make two
		// decisions inside the same runtime indistinguishable — exactly
		// the failure the decision-ordinal identity exists to prevent.
		//
		// The composition PERSISTS across the turns, so the inner seam's
		// per-session monotonic counter advances and each decision gets
		// its own identity.
		const composition = createProductionComposition({
			mode: "auto",
			outerMaxInputTokens: 128_000,
			innerMaxInputTokens: 16_000,
			strategy: "agentic",
			checkpointEnabled: true,
			existingState: undefined,
			generation,
			decisionId: () => "",
			logger,
		});
		for (let turn = 0; turn < 3; turn += 1) {
			await composition({
				messages: canonicalHistory({ paddingPairs: 120 }),
				iteration: turn + 1,
			});
		}
		// Every turn was ELIGIBLE, so every turn generated a checkpoint.
		expect(generation.count()).toBe(3);
		expect(loggedDecisionIds.length).toBe(3);
		// The identities are DISTINCT.
		expect(new Set(loggedDecisionIds).size).toBe(3);
		// And each one is the per-session monotonic DECISION-ORDINAL
		// identity.
		for (const identity of loggedDecisionIds) {
			expect(identity.split("#").length).toBe(3);
		}
	});
});
