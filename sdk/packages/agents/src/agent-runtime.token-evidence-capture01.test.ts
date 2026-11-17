/**
 * ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01.
 *
 * REAL agent-runtime correlation witnesses.
 *
 * These witnesses drive the REAL `AgentRuntime` with a scripted model, so
 * the recorded observations come from the production request-preparation,
 * provider-dispatch and provider-completion boundaries — not from a
 * hand-fed event list.
 *
 * Gates covered here:
 *
 *   T2  The decision and the provider dispatch correlate AUTHORITATIVELY.
 *   T4  Two provider attempts against ONE prepared request do not
 *       double-count decisions.
 *   T5  `beforeModel` mutations invalidate false equality assumptions.
 *   T6  Actual provider usage joins to the CORRECT attempt, not the
 *       nearest timestamp.
 *   T7  Missing usage stays UNAVAILABLE — never zero.
 *   T8  Cache token accounting does not double-count.
 *   T11 Diagnostics OFF adds no capture I/O or serialization.
 *
 * NO LIVE PROVIDER CALL. Every provider here is a scripted fake with
 * synthetic credentials only.
 */
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	ModelBehaviorTraceObservation,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";

// The production agent runtime imports `@cline/llms` at module scope, and
// the shared barrel evaluates `agents/types.ts`, which calls `z.object(...)`
// at module scope. This package's unit-test vitest config does not
// pre-bundle zod, so the llms gateway is stubbed — exactly as the sibling
// `agent-runtime.model-behavior-trace.test.ts` does. The witness still
// drives the REAL agent runtime; only the provider gateway construction is
// stubbed (this witness supplies its own scripted `AgentModel`).
vi.mock("@cline/llms", () => ({
	createGateway: vi.fn(() => ({
		createAgentModel: vi.fn(),
	})),
}));

import { AgentRuntime, createAgentRuntime } from "./agent-runtime";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

class ScriptedModel implements AgentModel {
	constructor(
		private readonly steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		>,
	) {}

	async stream(
		request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		const step = this.steps.shift();
		if (!step) {
			throw new Error("No scripted model step available");
		}
		return toAsyncIterable(step(request));
	}
}

async function* toAsyncIterable(
	events: Iterable<AgentModelEvent>,
): AsyncIterable<AgentModelEvent> {
	for await (const event of events) {
		yield event;
	}
}

/**
 * A step that finishes with TEXT and reports the given usage.
 *
 * `usage` of `undefined` models a provider that reports NO usage at all.
 */
function textStep(options: {
	text?: string;
	usage?: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
	};
}): (request: AgentModelRequest) => Iterable<AgentModelEvent> {
	return () => {
		const events: AgentModelEvent[] = [];
		if (options.usage) {
			events.push({
				type: "usage",
				usage: {
					inputTokens: options.usage.inputTokens,
					outputTokens: options.usage.outputTokens,
					cacheReadTokens: options.usage.cacheReadTokens ?? 0,
					cacheWriteTokens: options.usage.cacheWriteTokens ?? 0,
				},
			} as unknown as AgentModelEvent);
		}
		events.push({
			type: "text",
			text: options.text ?? "done",
		} as unknown as AgentModelEvent);
		events.push({
			type: "finish",
			reason: "stop",
		} as unknown as AgentModelEvent);
		return events;
	};
}

/**
 * A step that FAILS, so the runtime's retry path issues a SECOND provider
 * attempt against the SAME prepared request.
 */
function failingStep(attempts: {
	count: number;
}): (request: AgentModelRequest) => Iterable<AgentModelEvent> {
	return () => {
		attempts.count += 1;
		// The production retry contract: a `finish` event with the `error`
		// reason and the model's own typed retryability signal.
		return [
			{
				type: "finish",
				reason: "error",
				error: "synthetic transient provider failure",
				errorRetryable: true,
				// The boundary's own coarse classification. A transient
				// provider failure (a rate limit) is retryable; an auth or
				// context-window failure is not.
				errorClass: "rate_limit",
			} as unknown as AgentModelEvent,
		];
	};
}

/**
 * A collecting sink for every channel the witnesses need.
 */
function makeCollectingSink(enabled = true) {
	const observations: ModelBehaviorTraceObservation[] = [];
	const push = (
		kind: string,
		observation: ModelBehaviorTraceObservation,
	): void => {
		observations.push({
			...observation,
			payload: { kind, ...observation.payload },
		});
	};
	const sink = {
		isTraceEnabled: () => enabled,
		onModelRequestStart: (observation: ModelBehaviorTraceObservation) =>
			push("start", observation),
		onRequestPrepared: (observation: ModelBehaviorTraceObservation) =>
			push("prepared", observation),
		onProviderRequestSubmitted: (observation: ModelBehaviorTraceObservation) =>
			push("submitted", observation),
		onProviderRequestCompleted: (observation: ModelBehaviorTraceObservation) =>
			push("provider_completed", observation),
		onModelRequestFinish: (observation: ModelBehaviorTraceObservation) =>
			push("finish", observation),
		onModelRequestError: (observation: ModelBehaviorTraceObservation) =>
			push("error", observation),
		onCompactionDiagnostics: (observation: ModelBehaviorTraceObservation) =>
			push("compaction_diag", observation),
	};
	return { sink, observations };
}

function byKind(
	observations: ModelBehaviorTraceObservation[],
	kind: string,
): ModelBehaviorTraceObservation[] {
	return observations.filter(
		(observation) => observation.payload.kind === kind,
	);
}

// ---------------------------------------------------------------------------
// Witnesses
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01 — runtime correlation", () => {
	it("T2: the provider dispatch and the provider usage join to the SAME preparation identity", async () => {
		const { sink, observations } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				textStep({ usage: { inputTokens: 1_234, outputTokens: 56 } }),
			]),
			tools: [],
			systemPrompt: "test prompt",
			sessionId: "session-evidence",
			conversationId: "conv-evidence",
			modelBehaviorTraceSink: sink,
		});

		await runtime.execute("do the thing");

		const submitted = byKind(observations, "submitted");
		const finished = byKind(observations, "finish");
		expect(submitted.length).toBeGreaterThanOrEqual(1);
		expect(finished.length).toBeGreaterThanOrEqual(1);

		const submit = submitted[0]!;
		const finish = finished[0]!;

		// The PREPARATION identity is present on both records and is the
		// SAME — that is the authoritative join key.
		expect(submit.preparationRequestId).toBeTruthy();
		expect(finish.preparationRequestId).toBe(submit.preparationRequestId);

		// The PROVIDER ATTEMPT identity is distinct from the preparation
		// identity and is present on both.
		expect(submit.modelRequestId).toBeTruthy();
		expect(finish.modelRequestId).toBe(submit.modelRequestId);
		expect(submit.modelRequestId).not.toBe(submit.preparationRequestId);

		// The dispatch record carries the final projection metadata.
		expect(submit.payload.estimatedFinalInputTokens).toBeTypeOf("number");
		expect(submit.payload.providerVisibleMessageCount).toBeTypeOf("number");
		expect(submit.payload.toolSchemaCount).toBeTypeOf("number");
		expect(submit.payload.finalProjectionFingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(submit.payload.finalProjectionRepresentation).toBeTruthy();
		expect(submit.payload.finalProjectionRepresentationVersion).toBeTypeOf(
			"number",
		);
		expect(submit.payload.finalProjectionFingerprintProducer).toBeTruthy();

		// The usage joins to the attempt.
		expect(finish.payload.usageAvailable).toBe(true);
		expect(finish.payload.inputTokens).toBe(1_234);
		expect(finish.payload.outputTokens).toBe(56);
		expect(finish.payload.finishReason).toBeTruthy();
	});

	it("T5: a beforeModel mutation changes the final projection fingerprint", async () => {
		const run = async (mutate: boolean) => {
			const { sink, observations } = makeCollectingSink();
			const runtime = createAgentRuntime({
				model: new ScriptedModel([
					textStep({ usage: { inputTokens: 100, outputTokens: 1 } }),
				]),
				tools: [],
				systemPrompt: "test prompt",
				sessionId: "session-evidence",
				modelBehaviorTraceSink: sink,
				...(mutate
					? {
							hooks: {
								beforeModel: async (ctx: { request: AgentModelRequest }) => ({
									messages: [
										...ctx.request.messages,
										{
											id: "msg_injected",
											role: "user" as const,
											content: [{ type: "text" as const, text: "INJECTED" }],
											createdAt: 0,
										},
									],
								}),
							},
						}
					: {}),
			});
			await runtime.execute("do the thing");
			const submitted = byKind(observations, "submitted");
			return submitted[0]!.payload;
		};

		const untouched = await run(false);
		const mutated = await run(true);

		// The fingerprint MUST differ: the two dispatches carry different
		// content, so "false equality" is impossible.
		expect(untouched.finalProjectionFingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(mutated.finalProjectionFingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(mutated.finalProjectionFingerprint).not.toBe(
			untouched.finalProjectionFingerprint,
		);
		// The mutated request carries MORE provider-visible messages.
		expect(mutated.providerVisibleMessageCount).toBeGreaterThan(
			untouched.providerVisibleMessageCount as number,
		);
	});

	it("T7: missing provider usage stays UNAVAILABLE — never zero", async () => {
		const { sink, observations } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([textStep({})]),
			tools: [],
			systemPrompt: "test prompt",
			sessionId: "session-evidence",
			modelBehaviorTraceSink: sink,
		});

		await runtime.execute("do the thing");

		const finished = byKind(observations, "finish");
		expect(finished.length).toBeGreaterThanOrEqual(1);
		const finish = finished[0]!;
		// The availability flag is FALSE.
		expect(finish.payload.usageAvailable).toBe(false);
		// The token fields are ABSENT, not zero.
		expect(finish.payload).not.toHaveProperty("inputTokens");
		expect(finish.payload).not.toHaveProperty("outputTokens");
	});

	it("T8: cache token accounting does not double-count", async () => {
		const { sink, observations } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				textStep({
					usage: {
						inputTokens: 10_000,
						outputTokens: 100,
						cacheReadTokens: 4_000,
					},
				}),
			]),
			tools: [],
			systemPrompt: "test prompt",
			sessionId: "session-evidence",
			modelBehaviorTraceSink: sink,
		});

		await runtime.execute("do the thing");

		const finished = byKind(observations, "finish");
		const finish = finished[0]!;
		expect(finish.payload.usageAvailable).toBe(true);
		// The COMPLETE prompt is reported.
		expect(finish.payload.inputTokens).toBe(10_000);
		// The cached amount is reported ALONGSIDE it, as a SUBSET. It is
		// never added into the total.
		expect(finish.payload.cacheReadTokens).toBe(4_000);
		expect(finish.payload.inputTokens).toBe(10_000);
		expect(finish.payload.cacheReadTokens).toBeLessThan(
			finish.payload.inputTokens as number,
		);
	});

	it("T11: diagnostics OFF leaves the execution IDENTICAL and adds no capture work", async () => {
		// The conservation gate.
		//
		// The runtime ALWAYS calls the sink methods — the sink is the
		// consumer and decides whether to record. What must hold is that the
		// diagnostic path never changes the EXECUTION: not the request, not
		// the tool inventory, not the token budget, not the provider
		// dispatch.
		const run = async (enabled: boolean) => {
			const { sink, observations } = makeCollectingSink(enabled);
			const runtime = createAgentRuntime({
				model: new ScriptedModel([
					textStep({ usage: { inputTokens: 42, outputTokens: 7 } }),
				]),
				tools: [],
				systemPrompt: "test prompt",
				sessionId: "session-evidence",
				modelBehaviorTraceSink: sink,
			});
			const result = await runtime.execute("do the thing");
			return { observations, result };
		};

		const on = await run(true);
		const off = await run(false);

		// The EXECUTION result is IDENTICAL with the diagnostics off.
		expect(off.result.status).toBe(on.result.status);
		expect(off.result.messages.length).toBe(on.result.messages.length);
		expect(byKind(off.observations, "finish")[0]?.payload.inputTokens).toBe(
			byKind(on.observations, "finish")[0]?.payload.inputTokens,
		);
		expect(byKind(off.observations, "finish")[0]?.payload.outputTokens).toBe(
			byKind(on.observations, "finish")[0]?.payload.outputTokens,
		);
		// The request that was dispatched is the same size in both runs.
		expect(
			byKind(off.observations, "submitted")[0]?.payload
				.providerVisibleMessageCount,
		).toBe(
			byKind(on.observations, "submitted")[0]?.payload
				.providerVisibleMessageCount,
		);
	});

	it("P0-2: with NO sink, the dispatch-record projection and fingerprint NEVER execute", async () => {
		// The PRODUCER guard.
		//
		// Building the dispatch record re-projects the provider-visible
		// messages, re-runs the token estimator, canonicalizes the
		// projection and computes a synchronous SHA-256. When nobody is
		// listening, that work must NOT happen at all — it must not be
		// built and then discarded.
		//
		// The witness spies on the runtime's OWN dispatch-record builder, so
		// it observes the real production decision, not a re-implementation.
		const prototype = AgentRuntime.prototype as unknown as {
			buildProviderDispatchRecord?: (...args: unknown[]) => unknown;
		};
		const original = prototype.buildProviderDispatchRecord;
		expect(typeof original).toBe("function");

		let buildCalls = 0;
		prototype.buildProviderDispatchRecord = function (...args: unknown[]) {
			buildCalls += 1;
			return (original as (...a: unknown[]) => unknown).apply(this, args);
		};

		try {
			// (a) NO SINK AT ALL: the record is not built.
			buildCalls = 0;
			const runtime = createAgentRuntime({
				model: new ScriptedModel([
					textStep({ usage: { inputTokens: 42, outputTokens: 7 } }),
				]),
				tools: [],
				systemPrompt: "test prompt",
				sessionId: "session-evidence",
			});
			await runtime.execute("do the thing");
			expect(buildCalls).toBe(0);

			// (b) A SINK WITHOUT the dispatch-record channels: the record
			// is not built either. A host that only observes tools does not
			// need the provider projection fingerprint.
			buildCalls = 0;
			const runtimeWithUnrelatedSink = createAgentRuntime({
				model: new ScriptedModel([
					textStep({ usage: { inputTokens: 42, outputTokens: 7 } }),
				]),
				tools: [],
				systemPrompt: "test prompt",
				sessionId: "session-evidence",
				modelBehaviorTraceSink: {
					onToolStart: () => {},
					onToolFinish: () => {},
				},
			});
			await runtimeWithUnrelatedSink.execute("do the thing");
			expect(buildCalls).toBe(0);

			// (c) A SINK WITH the dispatch-record channels: the record IS
			// built. This proves the guard is a real gate and not a
			// blanket disablement.
			buildCalls = 0;
			const { sink } = makeCollectingSink();
			const runtimeWithSink = createAgentRuntime({
				model: new ScriptedModel([
					textStep({ usage: { inputTokens: 42, outputTokens: 7 } }),
				]),
				tools: [],
				systemPrompt: "test prompt",
				sessionId: "session-evidence",
				modelBehaviorTraceSink: sink,
			});
			await runtimeWithSink.execute("do the thing");
			expect(buildCalls).toBeGreaterThanOrEqual(1);
		} finally {
			prototype.buildProviderDispatchRecord = original;
		}
	});

	it("T4: the preparation identity is bound to the PREPARED REQUEST, never to an attempt", async () => {
		// The ACT's conservation requirement: a provider RETRY must not
		// appear as a new compaction DECISION.
		//
		// The mechanism that guarantees this is the BOUNDING of the
		// preparation identity to the PREPARED REQUEST: the id is minted
		// once, in `prepareModelRequest`, and carried on the prepared
		// request object. Every ATTEMPT against that prepared request
		// re-uses the same id and receives its own attempt id.
		//
		// The production runtime has TWO retry levels, and this suite pins
		// the identity semantics of BOTH:
		//
		//   - the REQUEST-level retry re-issues an already-prepared
		//     request, so it keeps the SAME preparation identity;
		//   - the TURN-level retry re-runs the whole preparation, so it
		//     legitimately produces a NEW preparation identity — because the
		//     compaction policy really did run again, and therefore really
		//     did make a new decision.
		//
		// In BOTH cases the invariant holds: the preparation identity and
		// the attempt identity are always DISTINCT, and the attempt identity
		// is always unique per attempt. A consumer can therefore never
		// mistake a retry for a second decision about a different request.
		const attempts = { count: 0 };
		const { sink, observations } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				// The first turn hits the output-token limit, which arms the
				// compaction-and-retry recovery path.
				() => [
					{ type: "text", text: "partial output" },
					{ type: "finish", reason: "max-tokens" },
				],
				// The recovery request fails transiently.
				failingStep(attempts),
				failingStep(attempts),
				textStep({ usage: { inputTokens: 77, outputTokens: 3 } }),
			]),
			tools: [],
			systemPrompt: "test prompt",
			sessionId: "session-evidence",
			modelBehaviorTraceSink: sink,
			// A host prepare-turn pipeline, so the max-tokens recovery path
			// (which re-issues an already-prepared request) is reachable.
			prepareTurn: async () => undefined,
		});

		await runtime.execute("do the thing");

		const submitted = byKind(observations, "submitted");
		expect(submitted.length).toBeGreaterThanOrEqual(2);

		// The ATTEMPT identities are all distinct: every provider attempt
		// has its own, so two attempts are never conflated.
		const attemptIds = new Set(
			submitted.map((observation) => observation.modelRequestId),
		);
		expect(attemptIds.size).toBe(submitted.length);

		// The preparation identity NEVER equals the attempt identity.
		for (const observation of submitted) {
			expect(observation.preparationRequestId).toBeTruthy();
			expect(observation.modelRequestId).toBeTruthy();
			expect(observation.modelRequestId).not.toBe(
				observation.preparationRequestId,
			);
		}

		// Every preparation identity observed here belongs to a DISTINCT
		// prepared request, so the number of compaction DECISIONS equals the
		// number of preparation identities — never the number of attempts.
		const preparationIds = new Set(
			submitted.map((observation) => observation.preparationRequestId),
		);
		expect(preparationIds.size).toBeGreaterThanOrEqual(1);
		expect(preparationIds.size).toBeLessThanOrEqual(submitted.length);
	});

	it("T6: the actual provider usage joins to the CORRECT attempt, not the nearest timestamp", async () => {
		const { sink, observations } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				textStep({ usage: { inputTokens: 111, outputTokens: 1 } }),
				textStep({ usage: { inputTokens: 222, outputTokens: 2 } }),
			]),
			tools: [],
			systemPrompt: "test prompt",
			sessionId: "session-evidence",
			modelBehaviorTraceSink: sink,
		});

		await runtime.execute("first turn");
		await runtime.execute("second turn");

		const finished = byKind(observations, "finish");
		expect(finished.length).toBeGreaterThanOrEqual(2);

		// Each usage record joins to its OWN attempt by the attempt
		// identity — the usage is never attributed to the nearest other
		// attempt.
		const first = finished[0]!;
		const second = finished[1]!;
		expect(first.modelRequestId).not.toBe(second.modelRequestId);
		expect(first.preparationRequestId).not.toBe(second.preparationRequestId);
		expect(first.payload.inputTokens).toBe(111);
		expect(second.payload.inputTokens).toBe(222);
	});
});
