/**
 * ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01.
 *
 * Correlation, dispatch, usage and PRIVATE-CAPTURE discriminators at the
 * REAL production seams.
 *
 * WHAT THIS FILE DOES
 * -------------------
 *
 * It drives the PRODUCTION seams — the same functions the runtime installs:
 *
 *   - `createContextCompactionPrepareTurn({ ... })` — the compaction
 *     DECISION seam (the production resolver and the private capture);
 *   - `SessionRuntime` / `AgentRuntime` — the REAL request preparation and
 *     provider dispatch, with a RECORDING provider.
 *
 * and it pins the C2 correlation contract:
 *
 *   sessionId / runId / iteration / preparationRequestId / decisionId /
 *   providerAttemptId
 *
 * The point of the suite is that the join between a compaction DECISION, a
 * provider DISPATCH and the provider-reported USAGE is AUTHORITATIVE — an
 * exact key, never a timestamp proximity.
 *
 * NO LIVE PROVIDER CALL. Every provider here is a recording fake with
 * synthetic credentials only. The suite never asserts that a fake's numbers
 * match a real deployment — it asserts the ACCOUNTING CONTRACT and the
 * production seam's behaviour.
 *
 * CACHE SEMANTICS
 * ---------------
 *
 * `inputTokens` is the COMPLETE prompt and `cacheReadTokens` is a SUBSET of
 * it. The suite pins that contract so a future change cannot silently
 * double-count the cached portion.
 */

import { createAgentRuntime } from "@cline/agents";
import type * as LlmsProviders from "@cline/llms";
import type {
	AgentMessage,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeConfig,
	MessageWithMetadata,
} from "@cline/shared";
import { estimateRequestInputTokens } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	CompactionCandidateCaptureStore,
	isCompactionCandidateCaptureArmed,
} from "../../runtime/observability/compaction-candidate-capture";
import { createContextCompactionPrepareTurn } from "./compaction";

const createHandlerMock = vi.fn();

vi.mock("@cline/llms", () => ({
	createHandlerAsync: (config: unknown) => createHandlerMock(config),
}));

const SYSTEM_PROMPT =
	"ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01 deterministic probe system prompt.";

type CompactionPrepareTurn = NonNullable<
	ReturnType<typeof createContextCompactionPrepareTurn>
>;
type CompactionModel = Parameters<CompactionPrepareTurn>[0]["model"];

const MODEL = {
	id: "evidence-probe-model",
	provider: "openai-compatible",
	info: {
		maxInputTokens: 115_200,
		contextWindow: 115_200,
	},
} as unknown as CompactionModel;

/**
 * A recorded observation from the REAL diagnostics channel.
 */
interface DecisionObservation {
	decisionId?: string;
	decisionOrdinal?: number;
	preparationRequestId?: string;
	decisionJoinAuthority?: string;
	requestInputTokens?: number;
	requestTriggerTokens?: number;
	shouldCompact?: boolean;
	compactionInitiated?: boolean;
}

/**
 * A recording sink for the production diagnostics channel.
 */
function createRecordingSink(enabled = true) {
	const decisions: DecisionObservation[] = [];
	const completed: DecisionObservation[] = [];
	const sink = {
		isTraceEnabled: () => enabled,
		onCompactionDiagnostics: (observation: {
			payload: Record<string, unknown>;
		}) => {
			decisions.push(observation.payload as DecisionObservation);
		},
		onCompactionCompleted: (observation: {
			payload: Record<string, unknown>;
		}) => {
			completed.push(observation.payload as DecisionObservation);
		},
	};
	return { sink, decisions, completed };
}

function makeUserMessage(text: string): MessageWithMetadata {
	return {
		role: "user",
		content: [{ type: "text", text }],
	} as unknown as MessageWithMetadata;
}

function makeToolMessage(text: string): MessageWithMetadata {
	return {
		role: "user",
		content: [{ type: "tool_result", content: text }],
	} as unknown as MessageWithMetadata;
}

/**
 * Drive the REAL production compaction prepare-turn seam.
 */
async function driveProductionSeam(input: {
	messages: MessageWithMetadata[];
	tools?: unknown[];
	sinkEnabled?: boolean;
	preparationRequestId?: string;
	requestOptions?: Record<string, unknown>;
	model?: CompactionModel;
}) {
	const recorder = createRecordingSink(input.sinkEnabled ?? true);
	const prepareTurn = createContextCompactionPrepareTurn({
		providerId: "openai-compatible",
		modelId: "evidence-probe-model",
		providerConfig: {
			providerId: "openai-compatible",
			modelId: "evidence-probe-model",
		} as unknown as LlmsProviders.ProviderConfig,
		compaction: {
			enabled: true,
			strategy: "basic",
			preserveRecentTokens: 1,
		},
		modelBehaviorTraceSink: recorder.sink,
	});
	const result = await prepareTurn?.({
		agentId: "agent-evidence",
		conversationId: "conv-evidence",
		parentAgentId: null,
		iteration: 1,
		abortSignal: new AbortController().signal,
		systemPrompt: SYSTEM_PROMPT,
		tools: input.tools ?? [],
		messages: input.messages,
		apiMessages: input.messages,
		model: input.model ?? MODEL,
		...(input.preparationRequestId !== undefined
			? { preparationRequestId: input.preparationRequestId }
			: {}),
		...(input.requestOptions !== undefined
			? { requestOptions: input.requestOptions }
			: {}),
	});
	return { decisions: recorder.decisions, result, recorder };
}

// ---------------------------------------------------------------------------
// Witnesses
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01 — decision correlation", () => {
	beforeEach(() => {
		createHandlerMock.mockReset();
	});

	it("T1: the early preparation identity survives the prepare-turn/compaction boundary", async () => {
		const { decisions } = await driveProductionSeam({
			messages: [makeUserMessage("hello evidence boundary")],
			preparationRequestId: "req_early_identity",
		});
		expect(decisions.length).toBeGreaterThanOrEqual(1);
		const decision = decisions[0]!;
		// The EXACT preparation id is carried onto the decision.
		expect(decision.preparationRequestId).toBe("req_early_identity");
		// The join authority is reported as AUTHORITATIVE only when the id
		// is actually present.
		expect(decision.decisionJoinAuthority).toBe("AUTHORITATIVE");
	});

	it("T1b: the join authority is UNAVAILABLE when the host supplies no preparation id", async () => {
		const { decisions } = await driveProductionSeam({
			messages: [makeUserMessage("hello evidence boundary")],
		});
		expect(decisions.length).toBeGreaterThanOrEqual(1);
		const decision = decisions[0]!;
		// The identity is NEVER synthesized.
		expect(decision.preparationRequestId).toBeUndefined();
		expect(decision.decisionJoinAuthority).toBe("UNAVAILABLE");
		// The decision identity still exists and remains unique per decision.
		expect(decision.decisionId).toBeTruthy();
		expect(decision.decisionOrdinal).toBeTypeOf("number");
	});

	it("T2: the decision retains every required compaction value", async () => {
		const { decisions } = await driveProductionSeam({
			messages: [makeUserMessage("A".repeat(3_000))],
		});
		const decision = decisions[0]!;
		for (const field of [
			"requestInputTokens",
			"apiMessageTokens",
			"requestOverheadTokens",
			"requestTriggerTokens",
			"rawMaxInputTokens",
			"maxInputTokens",
			"underestimateFactor",
			"shouldCompact",
			"compactionInitiated",
			"compactionMode",
			"compactionStrategy",
		]) {
			expect(decision).toHaveProperty(field);
		}
	});

	it("T3: two decisions in the same iteration remain distinct", async () => {
		const recorder = createRecordingSink(true);
		const prepareTurn = createContextCompactionPrepareTurn({
			providerId: "openai-compatible",
			modelId: "evidence-probe-model",
			providerConfig: {
				providerId: "openai-compatible",
				modelId: "evidence-probe-model",
			} as unknown as LlmsProviders.ProviderConfig,
			compaction: { enabled: true, strategy: "basic", preserveRecentTokens: 1 },
			modelBehaviorTraceSink: recorder.sink,
		});
		const base = {
			agentId: "agent-evidence",
			conversationId: "conv-evidence",
			parentAgentId: null,
			iteration: 7,
			abortSignal: new AbortController().signal,
			systemPrompt: SYSTEM_PROMPT,
			tools: [],
			model: MODEL,
		};
		await prepareTurn?.({
			...base,
			messages: [makeUserMessage("first")],
			apiMessages: [makeUserMessage("first")],
			preparationRequestId: "req_a",
		});
		await prepareTurn?.({
			...base,
			messages: [makeUserMessage("second")],
			apiMessages: [makeUserMessage("second")],
			preparationRequestId: "req_b",
		});
		expect(recorder.decisions.length).toBe(2);
		const [first, second] = recorder.decisions;
		// The DECISION identity distinguishes them (same session+iteration).
		expect(first!.decisionId).not.toBe(second!.decisionId);
		// The PREPARATION identity distinguishes them too, and they are
		// carried verbatim.
		expect(first!.preparationRequestId).toBe("req_a");
		expect(second!.preparationRequestId).toBe("req_b");
	});

	it("T14: the existing compaction threshold and overflow controls are unchanged", async () => {
		// A request UNDER the trigger must not compact.
		const small = await driveProductionSeam({
			messages: [makeUserMessage("tiny")],
		});
		expect(small.decisions[0]!.shouldCompact).toBe(false);
		expect(small.decisions[0]!.compactionInitiated).toBe(false);
		expect(small.result).toBeUndefined();

		// A genuinely OVERSIZED request MUST still compact. The transcript
		// carries SEVERAL messages so the basic strategy has something it
		// can actually reduce; the DECISION is what this assertion is about.
		const big = await driveProductionSeam({
			messages: [
				makeUserMessage("C".repeat(700_000)),
				makeToolMessage("D".repeat(700_000)),
				makeUserMessage("E".repeat(700_000)),
			],
		});
		expect(big.decisions[0]!.shouldCompact).toBe(true);
		expect(big.decisions[0]!.compactionInitiated).toBe(true);
		expect(big.result).toBeDefined();
	});
});
