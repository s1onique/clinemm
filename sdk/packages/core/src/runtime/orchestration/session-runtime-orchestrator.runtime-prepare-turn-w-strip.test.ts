/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (thirty-seventh-pass, attempt 2) — REAL host-side wrapper RED.
 *
 * The producer-seam RED (compaction.real-producer-seam-red.test.ts)
 * passed at HEAD against the real `createContextCompactionPrepareTurn`
 * factory. Per the user's instruction: if the producer RED does not
 * reproduce, inspect how the live host config differs from the test
 * factory.
 *
 * Difference found: `SessionRuntime.createRuntimePrepareTurn`
 * (sdk/packages/core/src/runtime/orchestration/session-runtime-
 * orchestrator.ts:1130-1181) is the host-side wrapper between
 * the user's prepareTurn factory and the `AgentRuntime`. The
 * wrapper destructures the producer's return value, forwarding
 * ONLY `messages` and `systemPrompt`:
 *
 *   return {
 *       ...(result.messages ? { messages: ... } : {}),
 *       ...(result.systemPrompt !== undefined
 *           ? { systemPrompt: result.systemPrompt } : {}),
 *   };
 *
 * It STRIPS `currentWorkingContextEstimate`. The declared return
 * type is `{ messages?, systemPrompt? } | undefined` — structurally
 * a subtype of `AgentRuntimePrepareTurnResult` but missing W.
 *
 * Causal chain in the live bundle:
 *   1. createCompactionStateAwarePrepareTurn sets W
 *   2. THIS WRAPPER silently discards W
 *   3. AgentRuntime reads undefined
 *   4. notifyRuntimeWTraceObserver records undefined
 *   5. working-context-state-changed is never emitted
 *   6. ContextWindow hides the gauge
 *
 * The test pins the bug.
 */

import { estimateRequestInputTokens } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { SessionRuntime } from "./session-runtime-orchestrator";

const SYSTEM_PROMPT = "You are a concise coding assistant.";

// Minimal fixture — the wrapper's behavior doesn't depend on the
// specific message/tool shapes; it depends only on whether the
// producer-supplied `currentWorkingContextEstimate` survives
// the return literal.
//
// `content` is an ARRAY of content blocks (the codec at
// agent-message-codec.ts:125 calls `.map` on it).
const ORDINARY_TURN_MESSAGES = [
	{
		role: "user",
		content: [{ type: "text", text: "List the files in /tmp" }],
	},
	{
		role: "assistant",
		content: [{ type: "text", text: "I will list the files for you." }],
	},
] as unknown[];

// The wrapper's actual return type after the fix:
//   { messages?, systemPrompt?, currentWorkingContextEstimate? } | undefined
type WrappedReturn = {
	messages?: unknown[];
	systemPrompt?: string;
	currentWorkingContextEstimate?: number;
};

describe("SessionRuntime.createRuntimePrepareTurn", () => {
	it("RED: wrapper forwards currentWorkingContextEstimate from producer (metadata-only return)", async () => {
		// The producer returns the metadata-only shape — the same
		// shape createCompactionStateAwarePrepareTurn publishes on
		// an ordinary no-compaction turn.
		const producerW = estimateRequestInputTokens({
			systemPrompt: SYSTEM_PROMPT,
			messages: ORDINARY_TURN_MESSAGES as never,
			tools: [] as never,
		});

		const prepareTurn = vi.fn(async (_ctx: unknown) => ({
			currentWorkingContextEstimate: producerW,
		}));

		const sessionWithPrepare = new SessionRuntime({
			providerId: "anthropic",
			modelId: "claude-test",
			apiKey: "test-key",
			systemPrompt: SYSTEM_PROMPT,
			tools: [],
			prepareTurn,
		} as unknown as ConstructorParameters<typeof SessionRuntime>[0]);

		const wrapped = (
			sessionWithPrepare as unknown as {
				createRuntimePrepareTurn: (
					modelInfo: undefined,
					tools: unknown[],
				) => (ctx: unknown) => Promise<WrappedReturn | undefined>;
			}
		).createRuntimePrepareTurn(undefined, []);

		const result = await wrapped({
			agentId: "agent-red-bug",
			conversationId: "conv-red-bug",
			parentAgentId: null,
			iteration: 1,
			messages: ORDINARY_TURN_MESSAGES,
			systemPrompt: SYSTEM_PROMPT,
			tools: [],
			model: { id: "claude-test", provider: "anthropic", info: undefined },
		});

		// ====== A1 RED: producer's W must survive the wrapper ======
		expect(result).toBeDefined();
		expect(result?.currentWorkingContextEstimate).toEqual(expect.any(Number));
		expect(result?.currentWorkingContextEstimate).toBe(producerW);
	});

	it("RED: wrapper forwards currentWorkingContextEstimate alongside messages + systemPrompt (full-result path)", async () => {
		const prepareTurn = vi.fn(async (_ctx: unknown) => ({
			messages: ORDINARY_TURN_MESSAGES,
			systemPrompt: SYSTEM_PROMPT,
			currentWorkingContextEstimate: 4242,
		}));

		const sessionWithPrepare = new SessionRuntime({
			providerId: "anthropic",
			modelId: "claude-test",
			apiKey: "test-key",
			systemPrompt: SYSTEM_PROMPT,
			tools: [],
			prepareTurn,
		} as unknown as ConstructorParameters<typeof SessionRuntime>[0]);

		const wrapped = (
			sessionWithPrepare as unknown as {
				createRuntimePrepareTurn: (
					modelInfo: undefined,
					tools: unknown[],
				) => (ctx: unknown) => Promise<WrappedReturn | undefined>;
			}
		).createRuntimePrepareTurn(undefined, []);

		const result = await wrapped({
			agentId: "agent-red-bug-2",
			messages: ORDINARY_TURN_MESSAGES,
			systemPrompt: SYSTEM_PROMPT,
			tools: [],
			model: { id: "claude-test", provider: "anthropic", info: undefined },
			iteration: 1,
		});

		// The runtime-side `prepareTurnForModelRequest` reads
		// `result.currentWorkingContextEstimate` at
		// agent-runtime.ts:2601 and surfaces it as `prepareTurnW`.
		expect(result?.currentWorkingContextEstimate).toBe(4242);
	});
});
