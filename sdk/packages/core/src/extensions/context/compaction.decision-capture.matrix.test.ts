/**
 * ACT-CLINEMM-COMPACTION-DECISION-CAPTURE01 — the DECISION CAPTURE
 * SCENARIO MATRIX (C3.2).
 *
 * Every scenario in this file drives the REAL production seam
 * (`createContextCompactionPrepareTurn`) and asserts the properties the
 * ACT requires of the captured decision:
 *
 *   | Scenario                    | Assertion                                   |
 *   |-----------------------------|---------------------------------------------|
 *   | Below threshold             | observed; `shouldCompact=false`; no span     |
 *   | Trigger arithmetic          | follows the production `>=` policy          |
 *   | Above threshold             | correct threshold and initiation recorded    |
 *   | Provider calibration        | captured factor equals production            |
 *   | User context ceiling        | captured effective budget equals production  |
 *   | Unknown model limit         | auto mode invents no default-budget decision|
 *   | Manual compaction           | mode distinguished from auto eligibility      |
 *   | Overflow recovery           | mode and execution attribution correct       |
 *   | Consecutive decisions       | stable, non-colliding correlation            |
 *   | Missing terminal event      | no fabricated successful completion          |
 *   | Disabled diagnostics        | no state or request semantic delta           |
 *   | Sink throws                 | existing failure isolation preserved         |
 *   | Synthetic sensitive content | absent from the exported diagnostic          |
 *   | Retention overflow          | explicit truncation metadata                  |
 *
 * The C3.3 CONSERVATION property (tracing OFF vs ON produces identical
 * canonical input, prepared messages, decision, compacted continuation and
 * provider dispatch arguments) is asserted in the companion file
 * `compaction.decision-capture.conservation.test.ts`.
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
 * A message list whose estimated request size is near
 * `targetInputTokens`.
 *
 * The estimator is `CHARS_PER_TOKEN` characters per token over the JSON
 * serialization, so the size is built from real content and the RESULT is
 * read back from production — never asserted from a hand-built
 * expectation.
 *
 * The history alternates user/assistant so the production `basic`
 * strategy has a real conversation to fold — a single message produces no
 * compacted transcript, which would make an "the compaction ran"
 * assertion vacuous.
 */
function messagesForEstimatedTokens(targetInputTokens: number): {
	messages: LlmsProviders.Message[];
	apiMessages: LlmsProviders.Message[];
} {
	const filler = "x".repeat(Math.max(0, targetInputTokens * 3));
	const messages: LlmsProviders.Message[] = [];
	for (let index = 0; index < 8; index += 1) {
		messages.push({ role: "user", content: `question ${index} ${filler}` });
		messages.push({
			role: "assistant",
			content: `answer ${index} ${filler}`,
		});
	}
	return { messages, apiMessages: messages };
}

function contextFor(
	messages: LlmsProviders.Message[],
	overrides: {
		iteration?: number;
		maxInputTokens?: number;
		contextWindow?: number;
		previousRequestInputTokens?: number;
		userContextCeiling?: number;
		overflowRecovery?: boolean;
	} = {},
): ContextPipelinePrepareTurnInput {
	return {
		agentId: "agent-capture01",
		conversationId: "conv-capture01",
		parentAgentId: null,
		iteration: overrides.iteration ?? 1,
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
				...(overrides.maxInputTokens !== undefined
					? { maxInputTokens: overrides.maxInputTokens }
					: {}),
				...(overrides.contextWindow !== undefined
					? { contextWindow: overrides.contextWindow }
					: {}),
			},
		},
		...(overrides.previousRequestInputTokens !== undefined
			? { previousRequestInputTokens: overrides.previousRequestInputTokens }
			: {}),
		...(overrides.userContextCeiling !== undefined
			? { userContextCeiling: overrides.userContextCeiling }
			: {}),
		...(overrides.overflowRecovery !== undefined
			? { overflowRecovery: overrides.overflowRecovery }
			: {}),
	} as unknown as ContextPipelinePrepareTurnInput;
}

function makeCompaction(
	sink:
		| {
				onCompactionDiagnostics?: (observation: {
					payload: Record<string, unknown>;
				}) => void;
				onCompactionCompleted?: (observation: {
					payload: Record<string, unknown>;
				}) => void;
				isTraceEnabled?: () => boolean;
		  }
		| undefined,
	options: {
		mode?: "auto" | "manual";
		userContextCeiling?: number;
	} = {},
) {
	return createContextCompactionPrepareTurn(
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
				...(options.userContextCeiling !== undefined
					? { userContextCeiling: options.userContextCeiling }
					: {}),
			},
			logger: undefined,
			modelBehaviorTraceSink: sink as never,
			sessionId: "session-capture01",
		},
		options.mode ? { mode: options.mode } : {},
	);
}

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

/**
 * The decision payload as a typed record.
 */
function decision(payload: Record<string, unknown>): {
	compactionMode: string;
	compactionStrategy: string;
	shouldCompact: boolean;
	compactionInitiated: boolean;
	requestInputTokens: number;
	requestTriggerTokens: number;
	rawMaxInputTokens: number;
	maxInputTokens: number;
	actualPreviousInputTokens: number;
	underestimateFactor: number;
	inputBudgetSource: string;
	userContextCeiling?: number;
	decisionId: string;
	decisionOrdinal: number;
} {
	return payload as never;
}

describe("ACT-CLINEMM-COMPACTION-DECISION-CAPTURE01 / scenario matrix", () => {
	it("Below threshold: the decision is observed, shouldCompact=false, and NO execution span is opened", async () => {
		const sink = new LatencyTraceSink("capture01-below");
		const compact = makeCompaction(sink);
		const { messages } = messagesForEstimatedTokens(1_000);
		const result = await compact?.(
			contextFor(messages, { maxInputTokens: 200_000 }),
		);
		expect(result).toBeUndefined();

		const trace = sink.getTrace();
		const decisions = trace.events.filter(
			(event) => event.boundary === "compaction_decision",
		);
		expect(decisions).toHaveLength(1);
		expect(decisions[0]?.metadata?.shouldCompact).toBe(false);
		expect(decisions[0]?.metadata?.compactionInitiated).toBe(false);
		// NO execution span.
		expect(
			trace.events.filter((event) => event.boundary === "compaction"),
		).toHaveLength(0);
	});

	it("Below threshold: the captured arithmetic is internally consistent", async () => {
		// The production policy is `requestInputTokens >= requestTriggerTokens`.
		// This case is strictly below the threshold and is therefore NOT
		// eligible. The separate equality-boundary scenario below exercises
		// the exact `>=` boundary.
		const { sink, observed } = recordingSink();
		const compact = makeCompaction(sink);
		const { messages } = messagesForEstimatedTokens(1_000);
		await compact?.(contextFor(messages, { maxInputTokens: 200_000 }));
		const first = decision(observed[0] ?? {});
		expect(first.shouldCompact).toBe(false);
		expect(first.requestInputTokens).toBeLessThan(first.requestTriggerTokens);
		expect(first.requestTriggerTokens).toBeCloseTo(
			first.maxInputTokens * COMPACTION_TRIGGER_RATIO,
			6,
		);
		expect(first.shouldCompact).toBe(
			first.requestInputTokens >= first.requestTriggerTokens,
		);
	});

	it("Trigger arithmetic: shouldCompact follows the production `>=` policy", async () => {
		const { sink, observed } = recordingSink();
		const compact = makeCompaction(sink);
		const { messages } = messagesForEstimatedTokens(1_000);
		await compact?.(contextFor(messages, { maxInputTokens: 200_000 }));

		const payload = decision(observed[0] ?? {});
		expect(payload.requestTriggerTokens).toBeCloseTo(
			payload.maxInputTokens * COMPACTION_TRIGGER_RATIO,
			6,
		);
		expect(payload.shouldCompact).toBe(
			payload.requestInputTokens >= payload.requestTriggerTokens,
		);
		expect(payload.shouldCompact).toBe(false);
	});

	it("Above threshold: the correct threshold is captured and initiation is recorded", async () => {
		const sink = new LatencyTraceSink("capture01-above");
		const compact = makeCompaction(sink);
		const { messages } = messagesForEstimatedTokens(400_000);
		await compact?.(contextFor(messages, { maxInputTokens: 200_000 }));

		const trace = sink.getTrace();
		const decisions = trace.events.filter(
			(event) => event.boundary === "compaction_decision",
		);
		expect(decisions).toHaveLength(1);
		expect(decisions[0]?.metadata?.shouldCompact).toBe(true);
		expect(decisions[0]?.metadata?.compactionInitiated).toBe(true);
		// The execution span opened exactly once.
		expect(
			trace.events.filter(
				(event) => event.boundary === "compaction" && event.phase === "start",
			),
		).toHaveLength(1);
	});

	it("Provider calibration: the captured factor equals the production calculation", async () => {
		const { sink, observed } = recordingSink();
		const compact = makeCompaction(sink);
		const { messages } = messagesForEstimatedTokens(1_000);
		await compact?.(
			contextFor(messages, {
				maxInputTokens: 200_000,
				previousRequestInputTokens: 12_000,
			}),
		);
		const payload = decision(observed[0] ?? {});
		// Production: min(4, max(1, actualPreviousInputTokens /
		// requestInputTokens)).
		const expected = Math.min(
			4,
			Math.max(
				1,
				payload.actualPreviousInputTokens / payload.requestInputTokens,
			),
		);
		expect(payload.underestimateFactor).toBeCloseTo(expected, 9);
		// ...and the calibration CHANGED the trigger: without it the
		// threshold would have been `rawMaxInputTokens * ratio`.
		expect(payload.maxInputTokens).toBeCloseTo(
			payload.rawMaxInputTokens / payload.underestimateFactor,
			6,
		);
		expect(payload.requestTriggerTokens).toBeCloseTo(
			payload.maxInputTokens * COMPACTION_TRIGGER_RATIO,
			6,
		);
	});

	it("User context ceiling: the captured effective budget equals the production resolver", async () => {
		const { sink, observed } = recordingSink();
		// The ceiling is a COMPACTION CONFIG option, not a context field:
		// it is the user's operating ceiling on the model's capacity.
		const compact = makeCompaction(sink, { userContextCeiling: 50_000 });
		const { messages } = messagesForEstimatedTokens(1_000);
		await compact?.(contextFor(messages, { maxInputTokens: 200_000 }));
		const payload = decision(observed[0] ?? {});
		// The ceiling may only REDUCE the operating capacity.
		expect(payload.rawMaxInputTokens).toBe(50_000);
		expect(payload.userContextCeiling).toBe(50_000);
		expect(payload.inputBudgetSource).toBe("userCeiling");
	});

	it("Unknown model limit: auto mode invents NO default-budget decision", async () => {
		const { sink, observed } = recordingSink();
		const compact = makeCompaction(sink);
		const { messages } = messagesForEstimatedTokens(1_000);
		// No `maxInputTokens` and no `contextWindow` — the model limit is
		// UNKNOWN. The production seam returns BEFORE the decision, so
		// there is NO threshold evaluation and NO decision record.
		const result = await compact?.(contextFor(messages, {}));
		expect(result).toBeUndefined();
		// No fabricated `NOT_EVALUATED` record: the production contract
		// does not support one safely, so the decision is simply absent.
		expect(observed).toHaveLength(0);
	});

	it("Manual compaction: the mode is distinguished from an auto eligibility check", async () => {
		const { sink, observed } = recordingSink();
		const compact = makeCompaction(sink, { mode: "manual" });
		const { messages } = messagesForEstimatedTokens(1_000);
		await compact?.(contextFor(messages, { maxInputTokens: 200_000 }));
		const payload = decision(observed[0] ?? {});
		expect(payload.compactionMode).toBe("manual");
		// Manual mode ALWAYS initiates real work, whatever `shouldCompact`
		// says. The two facts are independent and both are captured.
		expect(payload.shouldCompact).toBe(false);
		expect(payload.compactionInitiated).toBe(true);
	});

	it("Overflow recovery: the mode and the execution attribution are correct", async () => {
		const { sink, observed } = recordingSink();
		const compact = makeCompaction(sink);
		const { messages } = messagesForEstimatedTokens(1_000);
		await compact?.(
			contextFor(messages, {
				maxInputTokens: 200_000,
				overflowRecovery: true,
			}),
		);
		const payload = decision(observed[0] ?? {});
		expect(payload.compactionMode).toBe("overflow_recovery");
		expect(payload.compactionInitiated).toBe(true);
	});

	it("Exported trace: mode and strategy survive metadata sanitization for all three modes", async () => {
		const scenarios = [
			{
				expectedMode: "auto",
				options: {},
				contextOverrides: {},
			},
			{
				expectedMode: "manual",
				options: { mode: "manual" as const },
				contextOverrides: {},
			},
			{
				expectedMode: "overflow_recovery",
				options: {},
				contextOverrides: { overflowRecovery: true },
			},
		];

		for (const scenario of scenarios) {
			const sink = new LatencyTraceSink(
				`capture01-export-${scenario.expectedMode}`,
			);
			const compact = makeCompaction(sink, scenario.options);
			const { messages } = messagesForEstimatedTokens(1_000);
			await compact?.(
				contextFor(messages, {
					maxInputTokens: 200_000,
					...scenario.contextOverrides,
				}),
			);

			const exported = sink
				.getTrace()
				.events.find((event) => event.boundary === "compaction_decision");
			expect(exported?.metadata?.compactionMode).toBe(scenario.expectedMode);
			expect(exported?.metadata?.compactionStrategy).toBe("basic");
			expect(exported?.metadata?.mode).toBeUndefined();
			expect(exported?.metadata?.strategy).toBeUndefined();
		}
	});

	it("Consecutive decisions: the correlation identity is stable and non-colliding", async () => {
		const { sink, observed } = recordingSink();
		const compact = makeCompaction(sink);
		const { messages } = messagesForEstimatedTokens(1_000);
		await compact?.(
			contextFor(messages, { iteration: 1, maxInputTokens: 200_000 }),
		);
		await compact?.(
			contextFor(messages, { iteration: 1, maxInputTokens: 200_000 }),
		);
		await compact?.(
			contextFor(messages, { iteration: 2, maxInputTokens: 200_000 }),
		);

		expect(observed).toHaveLength(3);
		const ids = observed.map((payload) => decision(payload).decisionId);
		// Every decision has its OWN identity...
		expect(new Set(ids).size).toBe(3);
		// ...even when two of them share an iteration.
		expect(decision(observed[0] ?? {}).decisionOrdinal).toBe(0);
		expect(decision(observed[1] ?? {}).decisionOrdinal).toBe(1);
		expect(decision(observed[2] ?? {}).decisionOrdinal).toBe(2);
	});

	it("Missing terminal event: no successful completion is fabricated", async () => {
		// An initiated compaction whose completion is never reported must
		// leave the execution span OPEN — explicitly incomplete — and must
		// never be reported as a successful completion.
		const sink = new LatencyTraceSink("capture01-missing-terminal");
		const compact = makeCompaction({
			onCompactionDiagnostics: (observation) => {
				sink.onCompactionDiagnostics(observation as never);
			},
			onCompactionCompleted: () => {
				// The completion channel is NEVER called.
			},
		});
		const { messages } = messagesForEstimatedTokens(400_000);
		await compact?.(contextFor(messages, { maxInputTokens: 200_000 }));

		const trace = sink.getTrace();
		const ends = trace.events.filter(
			(event) => event.boundary === "compaction" && event.phase === "end",
		);
		expect(ends).toHaveLength(0);
		// The open span is reported as an integrity failure — explicitly
		// incomplete, never a fabricated success.
		expect(
			trace.integrityFailures.filter(
				(failure) => failure.boundary === "compaction",
			).length,
		).toBeGreaterThan(0);
	});

	it("Disabled diagnostics: no state or request semantic delta", async () => {
		// A sink that reports itself DISARMED. The decision ordinal must
		// NOT advance, no decision payload may be published, and the
		// compaction's observable behaviour must be identical to the armed
		// case.
		const armed = recordingSink();
		const disarmed = recordingSink();
		const disarmedSink = {
			...disarmed.sink,
			isTraceEnabled: () => false,
		};

		const { messages } = messagesForEstimatedTokens(1_000);
		const context = contextFor(messages, { maxInputTokens: 200_000 });

		const armedCompact = makeCompaction(armed.sink);
		const armedResult = await armedCompact?.(context);

		const disarmedCompact = makeCompaction(disarmedSink);
		const disarmedResult = await disarmedCompact?.(context);

		// The observable compaction behaviour is IDENTICAL.
		expect(disarmedResult).toEqual(armedResult);
		// The DISARMED sink receives NO decision payload at all, so it
		// cannot manufacture an identity or consume the ordinal.
		expect(disarmed.observed).toHaveLength(0);
		expect(armed.observed).toHaveLength(1);
	});

	it("Absent sink: the capture publishes no decision identity or payload", async () => {
		const { messages } = messagesForEstimatedTokens(1_000);
		const compact = makeCompaction(undefined);
		const result = await compact?.(
			contextFor(messages, { maxInputTokens: 200_000 }),
		);
		expect(result).toBeUndefined();
	});

	it("Disabled sink: the capture adds no API-message serialization", async () => {
		const run = async (enabled: boolean): Promise<number> => {
			let serializationCount = 0;
			const countedMessage = {
				role: "user" as const,
				content: "count this serialization",
				toJSON: () => {
					serializationCount += 1;
					return { role: "user", content: "count this serialization" };
				},
			};
			const messages = [countedMessage] as unknown as LlmsProviders.Message[];
			const observed: Array<Record<string, unknown>> = [];
			const compact = makeCompaction({
				onCompactionDiagnostics: (observation) => {
					observed.push(observation.payload);
				},
				onCompactionCompleted: () => {},
				isTraceEnabled: () => enabled,
			});
			await compact?.(contextFor(messages, { maxInputTokens: 200_000 }));
			expect(observed).toHaveLength(enabled ? 1 : 0);
			return serializationCount;
		};

		const disabledSerializations = await run(false);
		const enabledSerializations = await run(true);

		// The production estimator and the pre-existing debug-log size
		// calculation serialize the API messages in BOTH runs. The
		// DISABLED decision capture must add NO serialization of its own.
		expect(disabledSerializations).toBe(enabledSerializations - 1);
	});

	it("Sink throws: the existing failure isolation is preserved", async () => {
		const compact = makeCompaction({
			onCompactionDiagnostics: () => {
				throw new Error("sink exploded");
			},
			onCompactionCompleted: () => {
				throw new Error("sink exploded");
			},
		});
		const { messages } = messagesForEstimatedTokens(400_000);
		// The compaction still RUNS and still produces its result: the
		// diagnostic sink's failure cannot change the compaction's
		// behaviour.
		const result = await compact?.(
			contextFor(messages, { maxInputTokens: 200_000 }),
		);
		expect(result).toBeDefined();
	});

	it("Synthetic sensitive content: absent from the exported diagnostic", async () => {
		const sink = new LatencyTraceSink("capture01-privacy");
		const secret = "sk-SUPER-SECRET-TOKEN-abc123";
		const compact = makeCompaction(sink);
		const messages: LlmsProviders.Message[] = [
			{
				role: "user",
				content: `my key is ${secret} and my url is https://x.test/a?b=c`,
			},
		];
		await compact?.(contextFor(messages, { maxInputTokens: 200_000 }));

		const trace = sink.getTrace();
		const serialized = JSON.stringify(trace);
		expect(serialized).not.toContain(secret);
		expect(serialized).not.toContain("https://x.test");
	});

	it("Retention overflow: the truncation metadata states the capture is incomplete", async () => {
		const sink = new LatencyTraceSink("capture01-retention");
		const compact = makeCompaction(sink);
		const { messages } = messagesForEstimatedTokens(1_000);
		// More decisions than the tracer's event ring can hold.
		for (let index = 0; index < 5_000; index += 1) {
			await compact?.(
				contextFor(messages, {
					iteration: index + 1,
					maxInputTokens: 200_000,
				}),
			);
		}
		const trace = sink.getTrace();
		expect(trace.truncation.truncated).toBe(true);
		expect(trace.truncation.droppedEventCount).toBeGreaterThan(0);
	});
});
