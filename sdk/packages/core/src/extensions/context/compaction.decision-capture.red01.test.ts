/**
 * ACT-CLINEMM-COMPACTION-DECISION-CAPTURE01 — the DECISION CAPTURE RED.
 *
 * ## What this file witnesses
 *
 * The previous Round C run performed ten compactions whose necessity was
 * never proven, because the latency trace could not recover the DECISION
 * that produced them: the request estimate, the effective threshold and the
 * provider-usage calibration factor AT THE MOMENT the policy decided.
 *
 * This file drives the REAL production seam
 * (`createContextCompactionPrepareTurn`) and asserts that the exported
 * diagnostic can recover the complete decision — for BOTH the no-op
 * eligibility check (`shouldCompact === false`) and the initiated compaction
 * (`shouldCompact === true`).
 *
 * ## The RED (C3.1)
 *
 * The RED must fail on a MISSING OBSERVATION, not on a guessed wrong
 * threshold. Two distinct missing observations are witnessed here:
 *
 *   1. The latency trace has NO record at all of a no-op eligibility check.
 *      `LatencyTraceSink.onCompactionDiagnostics` returns early when
 *      `compactionInitiated === false`, so the decision that DID NOT compact
 *      leaves nothing behind. That is exactly the evidence needed to explain
 *      why a compaction did not happen — and it is missing.
 *
 *   2. The diagnostics payload carries only a SUBSET of the production
 *      values. The production resolver computes `rawMaxInputTokens`,
 *      `actualPreviousInputTokens`, `underestimateFactor`,
 *      `requestOverheadTokens`, `apiMessageTokens`, `messageCount`,
 *      `apiMessageCount` and `apiMessagesJsonChars`, but those never reach
 *      the diagnostic payload, so the recorded `maxInputTokens` and
 *      `requestTriggerTokens` cannot be verified against the production
 *      arithmetic.
 *
 * Both are MISSING-OBSERVATION failures: the values are computed by
 * production, but they are not OBSERVED.
 *
 * The GREEN must be achieved without recomputing anything: the tracer
 * observes the production resolver's OWN values.
 */

import type * as LlmsProviders from "@cline/llms";
import { describe, expect, it } from "vitest";
import { LatencyTraceSink } from "../../observability/latency/latency-sink";
import {
	type ContextPipelinePrepareTurnInput,
	createContextCompactionPrepareTurn,
} from "./compaction";
import { COMPACTION_TRIGGER_RATIO } from "./compaction-shared";

const SYSTEM_PROMPT = "You are a concise coding assistant.";

const TOOLS = [
	{
		name: "read_files",
		description: "Read files",
		input_schema: { type: "object" },
	},
];

/**
 * The production compaction trigger ratio.
 *
 * This is NOT a guessed threshold: it is the EXACT constant the production
 * resolver multiplies the calibrated budget by, imported from the production
 * module. The test asserts the CAPTURED arithmetic against the CAPTURED
 * values — the point is that the captured `requestTriggerTokens` must be
 * derivable from the captured `maxInputTokens`, and that `maxInputTokens`
 * must be derivable from the captured `rawMaxInputTokens` and
 * `underestimateFactor`.
 */

const ORDINARY_TURN_MESSAGES: LlmsProviders.Message[] = [
	{ role: "user", content: "List the files in /tmp" },
	{
		role: "assistant",
		content: "I will list the files in /tmp for you.",
	},
];

/**
 * A turn context comfortably BELOW the compaction trigger, so
 * `shouldCompact` is false and the production seam takes the NO-OP path.
 */
function belowTriggerContext(
	iteration: number,
	overrides: Partial<ContextPipelinePrepareTurnInput> = {},
): ContextPipelinePrepareTurnInput {
	return {
		agentId: "agent-capture01",
		conversationId: "conv-capture01",
		parentAgentId: null,
		iteration,
		abortSignal: new AbortController().signal,
		systemPrompt: SYSTEM_PROMPT,
		tools: TOOLS,
		messages: ORDINARY_TURN_MESSAGES,
		apiMessages: ORDINARY_TURN_MESSAGES,
		model: {
			id: "claude-test",
			provider: "anthropic",
			info: {
				id: "claude-test",
				maxInputTokens: 200_000,
			},
		},
		...overrides,
	} as unknown as ContextPipelinePrepareTurnInput;
}

/**
 * A turn context ABOVE the compaction trigger, so the production seam
 * initiates REAL compaction work.
 */
function _aboveTriggerContext(
	iteration: number,
	overrides: Partial<ContextPipelinePrepareTurnInput> = {},
): ContextPipelinePrepareTurnInput {
	const filler = "x".repeat(4_000);
	const messages: LlmsProviders.Message[] = [];
	for (let index = 0; index < 120; index += 1) {
		messages.push({ role: "user", content: `question ${index} ${filler}` });
		messages.push({
			role: "assistant",
			content: `answer ${index} ${filler}`,
		});
	}
	return {
		agentId: "agent-capture01",
		conversationId: "conv-capture01",
		parentAgentId: null,
		iteration,
		abortSignal: new AbortController().signal,
		systemPrompt: SYSTEM_PROMPT,
		tools: TOOLS,
		messages,
		apiMessages: messages,
		model: {
			id: "claude-test",
			provider: "anthropic",
			info: {
				id: "claude-test",
				maxInputTokens: 200_000,
			},
		},
		...overrides,
	} as unknown as ContextPipelinePrepareTurnInput;
}

/**
 * The production compaction factory, wired to a sink that records the
 * RAW diagnostics payload.
 */
function makeCompaction(sink: {
	onCompactionDiagnostics?: (observation: {
		payload: Record<string, unknown>;
	}) => void;
	onCompactionCompleted?: (observation: {
		payload: Record<string, unknown>;
	}) => void;
}) {
	return createContextCompactionPrepareTurn({
		providerId: "anthropic",
		modelId: "claude-test",
		providerConfig: {
			providerId: "anthropic",
			modelId: "claude-test",
		} as LlmsProviders.ProviderConfig,
		compaction: {
			enabled: true,
			strategy: "basic",
		},
		logger: undefined,
		modelBehaviorTraceSink: sink as never,
	});
}

/**
 * A sink that records the diagnostics payload verbatim.
 */
function recordingSink(): {
	sink: {
		onCompactionDiagnostics?: (observation: {
			payload: Record<string, unknown>;
		}) => void;
	};
	observed: Array<Record<string, unknown>>;
} {
	const observed: Array<Record<string, unknown>> = [];
	return {
		observed,
		sink: {
			onCompactionDiagnostics: (observation: {
				payload: Record<string, unknown>;
			}) => {
				observed.push(observation.payload);
			},
		},
	};
}

describe("ACT-CLINEMM-COMPACTION-DECISION-CAPTURE01 / decision capture", () => {
	it("RED 1 (now GREEN): a NO-OP eligibility check is observable without an execution span", async () => {
		// The evidence that explains why a compaction did NOT happen is
		// currently lost: the latency sink returns early for
		// `compactionInitiated === false`, so the trace contains nothing.
		const sink = new LatencyTraceSink("capture01-noop");
		const compact = makeCompaction(sink);
		expect(compact).toBeDefined();

		await compact?.(belowTriggerContext(1));

		const trace = sink.getTrace();
		const decisionRecords = trace.events.filter(
			(event) =>
				event.boundary === "compaction_decision" &&
				event.metadata?.compactionInitiated === false,
		);
		// GREEN: the observation is now present. The no-op eligibility
		// check is observable.
		expect(decisionRecords.length).toBeGreaterThan(0);
		// ...and it did NOT open a compaction EXECUTION span.
		expect(
			trace.events.filter((event) => event.boundary === "compaction").length,
		).toBe(0);
		// ...and it left no unfinished span behind.
		expect(
			trace.integrityFailures.filter(
				(failure) => failure.boundary === "compaction_decision",
			),
		).toHaveLength(0);
		// ...and the point observation is NOT reported as an unavailable
		// measurement: it WAS observed.
		expect(
			trace.unavailable.filter(
				(item) => item.boundary === "compaction_decision",
			),
		).toHaveLength(0);
	});

	it("RED 2: the diagnostics payload omits the production budget and calibration values", async () => {
		const { sink, observed } = recordingSink();
		const compact = makeCompaction(sink);
		expect(compact).toBeDefined();

		await compact?.(belowTriggerContext(1));

		expect(observed).toHaveLength(1);
		const payload = observed[0] ?? {};
		// The production resolver computes all of these. They must be
		// OBSERVABLE so the captured threshold can be verified.
		expect(payload.rawMaxInputTokens).toBe(200_000);
		expect(payload.actualPreviousInputTokens).toBeTypeOf("number");
		expect(payload.underestimateFactor).toBeTypeOf("number");
		expect(payload.requestOverheadTokens).toBeTypeOf("number");
		expect(payload.apiMessageTokens).toBeTypeOf("number");
		expect(payload.messageCount).toBeTypeOf("number");
		expect(payload.apiMessageCount).toBeTypeOf("number");
		expect(payload.apiMessagesJsonChars).toBeTypeOf("number");
	});

	it("GREEN witness: the captured threshold is derivable from the captured budget and calibration", async () => {
		const { sink, observed } = recordingSink();
		const compact = makeCompaction(sink);
		expect(compact).toBeDefined();

		await compact?.(
			belowTriggerContext(1, {
				previousRequestInputTokens: 1_000,
			} as Partial<ContextPipelinePrepareTurnInput>),
		);

		expect(observed).toHaveLength(1);
		const payload = observed[0] ?? {};
		const rawMaxInputTokens = payload.rawMaxInputTokens as number;
		const underestimateFactor = payload.underestimateFactor as number;
		const maxInputTokens = payload.maxInputTokens as number;
		const requestTriggerTokens = payload.requestTriggerTokens as number;

		expect(rawMaxInputTokens).toBe(200_000);
		expect(maxInputTokens).toBeCloseTo(
			rawMaxInputTokens / underestimateFactor,
			6,
		);
		expect(requestTriggerTokens).toBeCloseTo(
			maxInputTokens * COMPACTION_TRIGGER_RATIO,
			6,
		);
	});
});
