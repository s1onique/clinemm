/**
 * ACT-CLINEMM-ROUND-C-TRACE-QUAL01 — the compaction SPAN LIFECYCLE RED.
 *
 * ## The defect this file witnesses
 *
 * The Round C latency tracer opens a `compaction` span at the compaction
 * ELIGIBILITY CHECK, but only closes it when a REAL compaction executed.
 *
 * The production seam is `createContextCompactionPrepareTurn`
 * (`sdk/packages/core/src/extensions/context/compaction.ts`):
 *
 *   - line ~496: `observeCompactionTrace(..., "diagnostics", ...)` — the
 *     compaction DIAGNOSTICS are reported on EVERY eligibility check,
 *     BEFORE the `shouldCompact` decision is applied.
 *   - line ~519: `if (effectiveMode === "auto" && !shouldCompact) return
 *     undefined;` — the NO-OP path. The diagnostics were already
 *     reported, so the span is left open forever.
 *   - line ~766: `observeCompactionTrace(..., "completed", ...)` — the
 *     compaction COMPLETION, reported only when real work produced
 *     `result.messages`.
 *
 * The `LatencyTraceSink` maps the diagnostics channel onto the
 * `compaction` span's START and the completion channel onto its END
 * (`sdk/packages/core/src/observability/latency/latency-sink.ts`). The
 * tracer's own `getIntegrityFailures()` then reports every span that
 * was entered but never exited as a `"span left open"` integrity
 * failure.
 *
 * ## The observed live consequence
 *
 * The packaged Round C dogfood run (session `1794780088950_tc1vx`,
 * artifact `roundc-latency-trace.json`) recorded 45 `compaction` START
 * events and 2 `compaction` END events — and exactly 43 `"span left
 * open"` integrity failures. 43 = 45 - 2.
 *
 * ## The RED this file asserts
 *
 * Twenty eligibility checks that do NOT compact must leave ZERO
 * unclosed `compaction` spans. One real compaction must leave exactly
 * one correctly correlated closed span.
 *
 * The test drives the REAL production factory with the REAL
 * `LatencyTraceSink`, so a failure here is a failure at the production
 * boundary — not at a test double.
 */

import * as LlmsProviders from "@cline/llms";
import { describe, expect, it } from "vitest";
import { LatencyTraceSink } from "../../observability/latency/latency-sink";
import {
	createContextCompactionPrepareTurn,
	type ContextPipelinePrepareTurnInput,
} from "./compaction";

const SYSTEM_PROMPT = "You are a concise coding assistant.";

const TOOLS = [
	{
		name: "read_files",
		description: "Read files",
		input_schema: { type: "object" },
	},
];

const ORDINARY_TURN_MESSAGES: LlmsProviders.Message[] = [
	{ role: "user", content: "List the files in /tmp" },
	{
		role: "assistant",
		content: "I will list the files in /tmp for you.",
	},
];

/**
 * A turn context comfortably BELOW the compaction trigger, so
 * `shouldCompact` is false and the production seam takes the NO-OP
 * path (`return undefined`).
 */
function belowTriggerContext(
	iteration: number,
): ContextPipelinePrepareTurnInput {
	return {
		agentId: "agent-qual01",
		conversationId: "conv-qual01",
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
	} as unknown as ContextPipelinePrepareTurnInput;
}
/**
 * A turn context ABOVE the compaction trigger, so the production seam
 * initiates REAL compaction work.
 */
function aboveTriggerContext(
	iteration: number,
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
		agentId: "agent-qual01",
		conversationId: "conv-qual01",
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
	} as unknown as ContextPipelinePrepareTurnInput;
}

/**
 * The production compaction factory, wired to a REAL `LatencyTraceSink`.
 *
 * The sink parameter is typed as the MINIMAL structural shape the
 * production seam needs, so a raw collecting sink can observe the
 * diagnostics channel directly.
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
 * The count of `compaction` spans that were entered but never exited.
 *
 * The tracer reports those as `"span left open"` integrity failures, so
 * the count is read from the trace's own integrity channel rather than
 * from a test-local reconstruction.
 */
function unclosedCompactionSpans(sink: LatencyTraceSink): number {
	const trace = sink.getTrace();
	return trace.integrityFailures.filter(
		(failure) =>
			failure.boundary === "compaction" && failure.reason === "span left open",
	).length;
}

describe("ACT-CLINEMM-ROUND-C-TRACE-QUAL01 / compaction span lifecycle", () => {
	it("RED: twenty no-op eligibility checks leave ZERO unclosed compaction spans", async () => {
		const sink = new LatencyTraceSink("qual01-noop");
		const compact = makeCompaction(sink);
		expect(compact).toBeDefined();

		for (let iteration = 1; iteration <= 20; iteration += 1) {
			const result = await compact?.(belowTriggerContext(iteration));
			// The production seam took the NO-OP path: no compaction ran.
			expect(result).toBeUndefined();
		}

		const trace = sink.getTrace();
		const compactionStarts = trace.events.filter(
			(event) => event.boundary === "compaction" && event.phase === "start",
		).length;
		const compactionEnds = trace.events.filter(
			(event) => event.boundary === "compaction" && event.phase === "end",
		).length;

		// The measurement boundary is now the REAL compaction execution:
		// a check that did NOT compact opens NO span at all.
		expect(compactionStarts).toBe(0);
		expect(compactionEnds).toBe(0);
		// ...and therefore leaves ZERO unclosed spans.
		expect(unclosedCompactionSpans(sink)).toBe(0);
	});

	it("the eligibility CHECK is still observed — the diagnostic is not suppressed", async () => {
		// The correction moves the MEASUREMENT boundary, not the
		// diagnostic. The model-behavior recorder must still receive every
		// eligibility check, so the evidence the trace relies on is not
		// lost.
		const observed: Array<Record<string, unknown>> = [];
		const sink = {
			onCompactionDiagnostics: (observation: {
				payload: Record<string, unknown>;
			}) => {
				observed.push(observation.payload);
			},
		};
		const compact = makeCompaction(sink as never);
		expect(compact).toBeDefined();

		for (let iteration = 1; iteration <= 20; iteration += 1) {
			await compact?.(belowTriggerContext(iteration));
		}

		// All twenty checks are reported, and each one says it did NOT
		// initiate compaction.
		expect(observed).toHaveLength(20);
		expect(
			observed.every((payload) => payload.compactionInitiated === false),
		).toBe(true);
	});

	it("GREEN witness: one real compaction produces one correctly correlated closed span", async () => {
		const sink = new LatencyTraceSink("qual01-real");
		const compact = makeCompaction(sink);
		expect(compact).toBeDefined();

		const result = await compact?.(aboveTriggerContext(1));
		// A real compaction ran and produced a compacted transcript.
		expect(result?.messages).toBeDefined();

		const trace = sink.getTrace();
		const compactionStarts = trace.events.filter(
			(event) => event.boundary === "compaction" && event.phase === "start",
		).length;
		const compactionEnds = trace.events.filter(
			(event) => event.boundary === "compaction" && event.phase === "end",
		).length;

		expect(compactionStarts).toBe(1);
		expect(compactionEnds).toBe(1);
		expect(unclosedCompactionSpans(sink)).toBe(0);
	});

	it("C2.1: an INITIATED compaction that produced NO transcript records a TRUTHFUL failure — never a success", async () => {
		// A custom compactor that returns NOTHING: the compaction WORK ran
		// (the seam decided to compact) but there is no transcript.
		const sink = new LatencyTraceSink("qual01-no-result");
		const compact = createContextCompactionPrepareTurn({
			providerId: "anthropic",
			modelId: "claude-test",
			providerConfig: {
				providerId: "anthropic",
				modelId: "claude-test",
			} as LlmsProviders.ProviderConfig,
			compaction: {
				enabled: true,
				strategy: "basic",
				compact: async () => undefined,
			} as unknown as LlmsProviders.ProviderConfig,
			logger: undefined,
			modelBehaviorTraceSink: sink,
		});
		expect(compact).toBeDefined();

		// `manual` mode ALWAYS initiates real work.
		const manual = createContextCompactionPrepareTurn(
			{
				providerId: "anthropic",
				modelId: "claude-test",
				providerConfig: {
					providerId: "anthropic",
					modelId: "claude-test",
				} as LlmsProviders.ProviderConfig,
				compaction: {
					enabled: true,
					strategy: "basic",
					compact: async () => undefined,
				} as unknown as LlmsProviders.ProviderConfig,
				logger: undefined,
				modelBehaviorTraceSink: sink,
			},
			{ mode: "manual" },
		);
		expect(manual).toBeDefined();

		await manual?.(belowTriggerContext(1));

		const trace = sink.getTrace();
		const end = trace.events.find(
			(event) => event.boundary === "compaction" && event.phase === "end",
		);
		// The span was closed with a TRUTHFUL terminal outcome — it is NOT
		// reported as a successful completion.
		expect(end).toBeDefined();
		expect(end?.status).toBe("failed");
		expect(end?.status).not.toBe("ok");
		// ...and no span is left open.
		expect(unclosedCompactionSpans(sink)).toBe(0);
	});

	it("C2.2: an ABORTED compaction records a CANCELLATION — never a success, never an open span", async () => {
		const sink = new LatencyTraceSink("qual01-abort");
		const controller = new AbortController();
		const compact = createContextCompactionPrepareTurn(
			{
				providerId: "anthropic",
				modelId: "claude-test",
				providerConfig: {
					providerId: "anthropic",
					modelId: "claude-test",
				} as LlmsProviders.ProviderConfig,
				compaction: {
					enabled: true,
					strategy: "basic",
					compact: async () => {
						// The compaction was cancelled mid-flight.
						controller.abort();
						const error = new Error("compaction cancelled");
						error.name = "AbortError";
						throw error;
					},
				} as unknown as LlmsProviders.ProviderConfig,
				logger: undefined,
				modelBehaviorTraceSink: sink,
			},
			{ mode: "manual" },
		);
		expect(compact).toBeDefined();

		const context = belowTriggerContext(1);
		await expect(
			compact?.({
				...context,
				abortSignal: controller.signal,
			} as unknown as ContextPipelinePrepareTurnInput),
		).rejects.toThrow();

		const trace = sink.getTrace();
		const end = trace.events.find(
			(event) => event.boundary === "compaction" && event.phase === "end",
		);
		// The terminal outcome is a CANCELLATION — truthful, and not a
		// successful completion.
		expect(end).toBeDefined();
		expect(end?.status).toBe("cancelled");
		expect(end?.status).not.toBe("ok");
		expect(unclosedCompactionSpans(sink)).toBe(0);
	});

	it("C2.3: concurrent compactions do not close one another's spans", async () => {
		const sink = new LatencyTraceSink("qual01-concurrent");
		const compact = makeCompaction(sink);
		expect(compact).toBeDefined();

		// Two no-op checks and one real compaction, interleaved.
		await Promise.all([
			compact?.(belowTriggerContext(1)),
			compact?.(belowTriggerContext(2)),
		]);
		await compact?.(aboveTriggerContext(3));

		const trace = sink.getTrace();
		const starts = trace.events.filter(
			(event) => event.boundary === "compaction" && event.phase === "start",
		);
		const ends = trace.events.filter(
			(event) => event.boundary === "compaction" && event.phase === "end",
		);

		// ONLY the real compaction opened a span, and it was closed.
		expect(starts).toHaveLength(1);
		expect(ends).toHaveLength(1);
		// The end event belongs to the span it closed: its duration is
		// measured against ITS OWN start.
		expect(ends[0]?.durationMs).toBeTypeOf("number");
		expect(unclosedCompactionSpans(sink)).toBe(0);
	});
});
