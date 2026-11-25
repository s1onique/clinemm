/**
 * ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 (AMENDMENT-02).
 *
 * THE SUMMARIZATION USAGE CONSERVATION WITNESSES.
 *
 * ============================================================================
 * THE INVARIANT
 * ============================================================================
 *
 *   PROVIDER_REPORTED_SUMMARIZATION_USAGE_IS_CONSERVED
 *
 * The summarizer is a REAL provider request. It is dispatched, it is paid
 * for, and the provider reports its usage. That usage is a fact of the
 * INFERENCE, not of its acceptance:
 *
 *   - A REJECTED summary is not free inference.
 *   - A SUCCESSFUL summary installation is not the authority for recording
 *     provider usage.
 *   - A CANCELLED summary was still paid for.
 *   - A summary refused at the PERSISTENCE boundary was still paid for.
 *   - A summary whose transport FAILED after the provider reported its usage
 *     was still paid for.
 *
 * So the usage is accounted exactly once, irrespective of whether the
 * candidate became installed state.
 *
 * ============================================================================
 * THE ACCOUNTING OWNER — AND WHY THIS SUITE IS NOW COMPOSED
 * ============================================================================
 *
 * There is NO second accounting ledger. The usage travels the EXISTING
 * mechanism, and this suite drives that mechanism END TO END:
 *
 *   the provider's usage chunk
 *     -> generateSummary()              (reads the chunk off the stream)
 *       -> runAgenticCompaction()       (hands the usage to the sink)
 *         -> the compaction seam's usage channel
 *           -> the agent runtime's updateUsage()  (the SAME accumulation the
 *                                                   main model's usage uses)
 *             -> the `usage-updated` runtime event
 *               -> RuntimeEventAdapter.translateUsage()
 *                 -> the `AgentEvent { type: "usage" }`
 *                   -> AgentEventBridge -> handleAgentEvent()
 *                     -> ctx.usageBySession  (THE OBSERVABLE RESULT)
 *
 * ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 (AMENDMENT-02 §2):
 * the PRINCIPAL witness is COMPOSED over the REAL production pieces — the
 * real `SessionRuntime`, the real `AgentRuntime`, the real compaction
 * preparation, the real runtime-event adapter and the real accounting
 * consumer. Only the EXTERNAL PROVIDER BOUNDARY is substituted.
 *
 * The earlier form of this suite hand-built an `AgentEvent` and fed it
 * straight to `handleAgentEvent()`. That BYPASSED the session runtime's
 * forwarding, the runtime's `updateUsage()` and the runtime-event
 * translation, so it could not observe whether the production accounting
 * CONNECTION actually carried the usage — only whether the consumer
 * accumulates a delta it is handed. The composed witness below closes that
 * gap, and it establishes NECESSITY by disabling only the new
 * auxiliary-usage forwarding connection and observing the principal witness
 * fail.
 *
 * ============================================================================
 * WHAT THIS SUITE DOES NOT CLAIM
 * ============================================================================
 *
 * It does NOT claim that the remote inference stopped when the client
 * cancelled. A client-side cancellation is not evidence about the provider.
 * The remote termination remains UNVERIFIED.
 *
 * It does NOT estimate missing provider usage. An absent provider metric
 * stays ABSENT and is never turned into a zero-cost inference. An
 * EXPLICITLY REPORTED ZERO is a DIFFERENT fact and is conserved as one.
 */

import type * as LlmsProviders from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type AgentEventContext,
	handleAgentEvent,
} from "../../services/agent-events";
import { createInitialAccumulatedUsage } from "../../services/usage";
import type { CoreSessionConfig } from "../../types/config";
import type { ActiveSession } from "../../types/session";
import {
	createCompactionStateAwarePrepareTurn,
	createContextCompactionPrepareTurn,
} from "./compaction";

const createHandlerMock = vi.fn();

/**
 * The REAL `@cline/llms` module is retained; only `createHandlerAsync` is
 * intercepted, so the configuration the transport factory was handed is
 * observable while the transport itself stays the production one.
 */
vi.mock("@cline/llms", async (importOriginal) => ({
	...(await importOriginal<typeof import("@cline/llms")>()),
	createHandlerAsync: (config: unknown) => createHandlerMock(config),
}));

const SYSTEM_PROMPT = "You are a helpful coding assistant.";

/** A NORMALLY COMPLETED, non-empty summary. */
const COMPLETE_LOOKING_SUMMARY =
	"Goal: finish the deploy pipeline review. Done: inspected deploy.env. " +
	"Next: report the findings to the user.";

// ---------------------------------------------------------------------------
// The usage values. They DIFFER between requests so that a doubled or a
// merged accounting is observable rather than merely plausible.
// ---------------------------------------------------------------------------

/** The usage the provider reports for the FIRST summarization request. */
const FIRST_USAGE = {
	inputTokens: 1234,
	outputTokens: 56,
	cacheReadTokens: 78,
	cacheWriteTokens: 9,
	totalCost: 0.0021,
	thoughtsTokenCount: 4,
} as const;

/** The usage the provider reports for the SECOND summarization request. */
const SECOND_USAGE = {
	inputTokens: 4321,
	outputTokens: 210,
	cacheReadTokens: 11,
	cacheWriteTokens: 22,
	totalCost: 0.0099,
	thoughtsTokenCount: 7,
} as const;

/**
 * ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 (AMENDMENT-02 §4) —
 * THE EXPLICITLY REPORTED ZERO.
 *
 * The provider DID report a usage event for this request, and the metrics
 * it reported were ZERO. That is a DIFFERENT fact from "the provider
 * reported no usage": the inference happened, and the provider accounted it
 * as costing nothing.
 *
 * The earlier fixture called this `UNREPORTED_USAGE`, which claimed the
 * opposite of what it modelled. It is renamed so the distinction is
 * legible: an EXPLICIT ZERO is conserved as an explicit zero, and the
 * ABSENT case is modelled separately (no usage chunk at all).
 */
const EXPLICIT_ZERO_USAGE = {
	inputTokens: 0,
	outputTokens: 0,
} as const;

/**
 * ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 (AMENDMENT-02 §4) —
 * THE MAIN AGENT'S OWN USAGE.
 *
 * The main model's usage, reported by the runtime the same way the
 * summarization's usage is reported.
 */
const MAIN_AGENT_USAGE = {
	inputTokens: 5_000,
	outputTokens: 500,
	totalCost: 0.5,
} as const;

// ---------------------------------------------------------------------------
// A deterministic gate. The test controls exactly when it opens; there is no
// timer and no polling anywhere in this suite.
// ---------------------------------------------------------------------------

function createGate(): {
	readonly wait: Promise<void>;
	readonly open: () => void;
} {
	let open!: () => void;
	const wait = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { wait, open };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function userTurn(text: string): MessageWithMetadata {
	return { role: "user", content: [{ type: "text", text }] };
}

function canonicalHistory(): MessageWithMetadata[] {
	return [
		userTurn("Inspect the deploy pipeline and report what you found."),
		{
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "call_partial",
					name: "run_commands",
					input: { commands: ["cat deploy.env"] },
				},
			],
		},
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "call_partial",
					name: "run_commands",
					content: [{ query: "cat deploy.env", result: "rc=0", success: true }],
				} as never,
			],
		},
		userTurn("Continue."),
	];
}

/**
 * The canonical history as the RUNTIME's own agent messages.
 *
 * The compaction summarizes the conversation that precedes the current
 * turn, so the composed chain seeds the runtime with a transcript long
 * enough for the production cut-index arithmetic to select a candidate.
 */
function agentMessagesFromCanonicalHistory(): MessageWithMetadata[] {
	return [
		userTurn("Inspect the deploy pipeline and report what you found."),
		{
			role: "assistant",
			content: [
				{
					type: "text",
					text: "I inspected deploy.env and found three environment keys.",
				},
			],
		},
		userTurn("Continue with the rollback check."),
	];
}

// ---------------------------------------------------------------------------
// THE PRODUCTION ACCOUNTING CONSUMER.
//
// `handleAgentEvent` is the component that owns provider-usage accounting in
// production. Its observable result is `ctx.usageBySession`.
//
// The witness wires the compaction's reported usage into this REAL consumer
// and observes what the consumer produces. Nothing here re-implements the
// accumulation.
// ---------------------------------------------------------------------------

interface UsageConsumerHarness {
	/** The consumer's OBSERVABLE result: the session's accumulated usage. */
	readonly accumulated: () => {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens: number;
		cacheWriteTokens: number;
		totalCost: number;
	};
	/** How many usage events the consumer observed. */
	readonly observedEvents: () => number;
	/** The consumer's context, so a witness can account through it. */
	context: AgentEventContext;
	/** The consumer's observation counter. */
	count: number;
}

function createUsageConsumerHarness(): UsageConsumerHarness {
	// The harness IS the counter holder: `observedEvents()` reads the very
	// counter `accountThroughProductionConsumer` increments, so the count a
	// witness observes is the count of events the consumer actually saw.
	const harness: UsageConsumerHarness = {
		count: 0,
		accumulated: () =>
			usageBySession.get("sess-cmp08") ?? createInitialAccumulatedUsage(),
		observedEvents: () => harness.count,
		context: undefined as unknown as AgentEventContext,
	};
	const config = {
		providerId: "cline",
		modelId: "mock-model",
		mode: "act",
	} as unknown as CoreSessionConfig;
	const liveSession = {
		sessionId: "sess-cmp08",
		config,
		runtime: {},
		agent: { getMessages: () => [] },
		turnUsageBaseline: createInitialAccumulatedUsage(),
	} as unknown as ActiveSession;
	const usageBySession = new Map<
		string,
		ReturnType<typeof createInitialAccumulatedUsage>
	>();
	const ctx: AgentEventContext = {
		sessionId: "sess-cmp08",
		config,
		liveSession,
		usageBySession,
		aggregateUsageBySession: new Map(),
		persistMessages: vi.fn(),
		emit: vi.fn(),
	};
	harness.context = ctx;
	return harness;
}

/**
 * The PRODUCTION CONSUMER's entry point for a reported usage delta.
 *
 * The delta shape is the one the runtime's `updateUsage()` produces and the
 * `runtime-event-adapter` translates: a per-request DELTA, never a running
 * total.
 */
function accountThroughProductionConsumer(
	harness: UsageConsumerHarness,
	usage: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
		totalCost?: number;
		reasoningTokenCount?: number;
	},
): void {
	harness.count += 1;
	const ctx = harness.context;
	handleAgentEvent(ctx, {
		type: "usage",
		inputTokens: usage.inputTokens,
		outputTokens: usage.outputTokens,
		...(usage.cacheReadTokens !== undefined
			? { cacheReadTokens: usage.cacheReadTokens }
			: {}),
		...(usage.cacheWriteTokens !== undefined
			? { cacheWriteTokens: usage.cacheWriteTokens }
			: {}),
		...(usage.totalCost !== undefined ? { cost: usage.totalCost } : {}),
		...(usage.reasoningTokenCount !== undefined
			? { reasoningTokenCount: usage.reasoningTokenCount }
			: {}),
		totalInputTokens: usage.inputTokens,
		totalOutputTokens: usage.outputTokens,
	} as never);
}

interface ReportedUsage {
	inferenceId: string;
	kind: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	totalCost?: number;
	reasoningTokenCount?: number;
}

interface SeamRun {
	readonly saveCalls: readonly unknown[];
	readonly notices: readonly { message: string; metadata: unknown }[];
	readonly logs: readonly string[];
	/**
	 * The usage the compaction REPORTED through the production usage
	 * channel, verbatim.
	 */
	readonly reportedUsage: readonly ReportedUsage[];
	/** How many physical provider requests were dispatched. */
	readonly physicalRequests: () => number;
	/**
	 * ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01
	 * (AMENDMENT-02 §1): the error the seam ended with, if any.
	 */
	readonly error: () => unknown;
}

interface SeamOptions {
	readonly abortSignal?: AbortSignal;
	readonly canonical?: readonly MessageWithMetadata[];
	readonly providerId?: string;
	readonly providerConfig?: Record<string, unknown>;
	readonly notices?: Array<{ message: string; metadata: unknown }>;
	readonly saveCalls?: unknown[];
	/**
	 * The INSTALLATION OUTCOME the host reports.
	 *
	 * `undefined` (the default) is the HISTORICAL contract: the host reports
	 * nothing, and the installation is treated as committed.
	 */
	readonly installationOutcome?:
		| { installed: true }
		| {
				installed: false;
				reason: "cancelled" | "persistence_failed" | "stale_state";
		  };
}

/**
 * Drive the REAL composed production seam.
 *
 * The seam is the REAL compaction seam (`createContextCompactionPrepareTurn`)
 * behind the REAL state-aware wrapper
 * (`createCompactionStateAwarePrepareTurn`), so the acceptance decision, the
 * installation authority and the publication gate under test are all the
 * production ones.
 */
async function runProductionSeam(options: SeamOptions = {}): Promise<SeamRun> {
	const providerId = options.providerId ?? "anthropic";
	const modelId = "mock-model";
	const innerModel = {
		id: modelId,
		provider: providerId,
		info: { id: modelId, maxInputTokens: 16_000 },
	} as unknown as Parameters<
		NonNullable<
			Parameters<typeof createCompactionStateAwarePrepareTurn>[0]["compact"]
		>
	>[0]["model"];
	const outerModel = {
		id: modelId,
		provider: providerId,
		info: { id: modelId, maxInputTokens: 128_000 },
	} as unknown as Parameters<
		NonNullable<
			Parameters<typeof createCompactionStateAwarePrepareTurn>[0]["compact"]
		>
	>[0]["model"];

	const logs: string[] = [];
	const logger = {
		debug: (message: string, metadata?: unknown) =>
			logs.push(`debug: ${message} ${JSON.stringify(metadata ?? null)}`),
		log: (message: string, metadata?: unknown) =>
			logs.push(`log: ${message} ${JSON.stringify(metadata ?? null)}`),
	};
	const notices: { message: string; metadata: unknown }[] =
		options.notices ?? [];
	const reportedUsage: ReportedUsage[] = [];
	const physicalRequests = 0;

	const inner = createContextCompactionPrepareTurn(
		{
			providerId,
			modelId,
			providerConfig: {
				providerId,
				modelId,
				...(options.providerConfig ?? {}),
			} as LlmsProviders.ProviderConfig,
			compaction: {
				enabled: true,
				strategy: "agentic",
				preserveRecentTokens: 1,
			},
			logger: logger as never,
		},
		{ mode: "manual" },
	);

	const saveCalls: unknown[] = options.saveCalls ?? [];
	const prepareTurn = createCompactionStateAwarePrepareTurn({
		compact: (context) =>
			inner?.({
				...context,
				model: innerModel,
				// ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01: the
				// usage channel the compaction reports through. It is the
				// production channel, wired to the production consumer.
				reportAuxiliaryUsage: (usage) => {
					reportedUsage.push(usage as never);
				},
			}) ?? Promise.resolve(undefined),
		getState: () => undefined,
		prepareApiMessages: async (messages) => messages,
		logger: logger as never,
		saveState: (state) => {
			saveCalls.push(state);
			return options.installationOutcome;
		},
	});

	const canonical = [...(options.canonical ?? canonicalHistory())];
	let error: unknown;
	try {
		await prepareTurn({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 1,
			abortSignal: options.abortSignal ?? new AbortController().signal,
			systemPrompt: SYSTEM_PROMPT,
			tools: [],
			messages: canonical,
			apiMessages: canonical,
			model: outerModel,
			emitStatusNotice: (message: string, metadata: unknown) => {
				notices.push({ message, metadata });
			},
		});
	} catch (caught) {
		error = caught;
	}

	return {
		saveCalls,
		notices,
		logs,
		reportedUsage,
		physicalRequests: () => physicalRequests,
		error: () => error,
	};
}

/**
 * Install a deterministic provider substitute that emits the given chunks.
 *
 * The chunks are the REAL transport's chunk shapes, so the summarizer reads
 * the usage chunk exactly as it reads it in production.
 */
function useProviderChunks(
	chunks: readonly Record<string, unknown>[],
	onRequest?: () => void,
	requestId = "gw_cmp08_request",
): void {
	createHandlerMock.mockImplementation(async () => ({
		// The transport contract: `createMessage` is a FUNCTION that
		// RETURNS the async stream. It is not the stream itself.
		//
		// The REAL compatibility adapter stamps its own per-request identity
		// (`gw_<nanoid>`) on the stream it RETURNS, and the summarizer reads
		// it from there. The substitute reproduces that contract exactly.
		createMessage: vi.fn(() => {
			onRequest?.();
			const stream = (async function* () {
				for (const chunk of chunks) {
					yield chunk;
				}
			})();
			(stream as unknown as { id?: string }).id = requestId;
			return stream;
		}),
	}));
}

/** A usage chunk in the transport's own shape. */
function usageChunk(
	usage: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
		totalCost?: number;
		thoughtsTokenCount?: number;
	},
	id = "summary-1",
): Record<string, unknown> {
	return { type: "usage", id, ...usage };
}

beforeEach(() => {
	createHandlerMock.mockReset();
});

// ---------------------------------------------------------------------------
// THE CONSERVATION MATRIX.
//
// Every row drives the REAL production compaction path with a deterministic
// provider and distinguishes:
//
//   - the PHYSICAL INFERENCE IDENTITY (the inferenceId the usage carries),
//   - the PROVIDER-REPORTED USAGE (the provider's own numbers),
//   - the USAGE OBSERVED BY THE PRODUCTION CONSUMER (the consumer's
//     accumulated result),
//   - the SUMMARY ACCEPTANCE OUTCOME,
//   - the PERSISTENCE OUTCOME.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 — the conservation matrix", () => {
	/**
	 * Accounts the compaction's REPORTED usage through the PRODUCTION
	 * CONSUMER and returns the consumer's observable result.
	 */
	function accountReported(
		harness: UsageConsumerHarness,
		reported: readonly ReportedUsage[],
	): void {
		for (const usage of reported) {
			accountThroughProductionConsumer(harness, usage);
		}
	}

	// ── CASE A ─────────────────────────────────────────────────────────────

	it("A: accounts the usage of a SUCCESSFULLY INSTALLED summary exactly once", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			usageChunk(FIRST_USAGE),
			{ type: "done", id: "summary-1", success: true },
		]);

		const notices: { message: string; metadata: unknown }[] = [];
		const saveCalls: unknown[] = [];
		const seam = await runProductionSeam({ notices, saveCalls });

		// The acceptance outcome: the candidate was installed.
		expect(seam.saveCalls).toHaveLength(1);
		expect(
			seam.notices.some((notice) => notice.message.endsWith("compacted")),
		).toBe(true);

		// The usage was REPORTED, once, with the provider's own numbers.
		expect(seam.reportedUsage).toHaveLength(1);
		expect(seam.reportedUsage[0]).toMatchObject({
			kind: "summarization",
			inputTokens: FIRST_USAGE.inputTokens,
			outputTokens: FIRST_USAGE.outputTokens,
			cacheReadTokens: FIRST_USAGE.cacheReadTokens,
			cacheWriteTokens: FIRST_USAGE.cacheWriteTokens,
			totalCost: FIRST_USAGE.totalCost,
		});

		// The PRODUCTION CONSUMER's observable result.
		const harness = createUsageConsumerHarness();
		accountReported(harness, seam.reportedUsage);
		expect(harness.observedEvents()).toBe(1);
		expect(harness.accumulated()).toMatchObject({
			inputTokens: FIRST_USAGE.inputTokens,
			outputTokens: FIRST_USAGE.outputTokens,
			cacheReadTokens: FIRST_USAGE.cacheReadTokens,
			cacheWriteTokens: FIRST_USAGE.cacheWriteTokens,
			totalCost: FIRST_USAGE.totalCost,
		});
	});

	// ── CASE B ─────────────────────────────────────────────────────────────

	it("B: accounts the usage of a summary REJECTED for exceeding its token budget", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			usageChunk(FIRST_USAGE),
			{
				type: "done",
				id: "summary-1",
				success: false,
				incompleteReason: "max_output_tokens",
			},
		]);

		const notices: { message: string; metadata: unknown }[] = [];
		const saveCalls: unknown[] = [];
		const seam = await runProductionSeam({ notices, saveCalls });

		// The acceptance outcome: the candidate was REJECTED. Nothing was
		// installed and no success was published.
		expect(seam.saveCalls).toHaveLength(0);
		expect(
			seam.notices.some((notice) => notice.message.endsWith("compacted")),
		).toBe(false);

		// The usage was REPORTED anyway: a rejected summary is not free
		// inference.
		expect(seam.reportedUsage).toHaveLength(1);
		expect(seam.reportedUsage[0].inputTokens).toBe(FIRST_USAGE.inputTokens);

		// The PRODUCTION CONSUMER accounted it exactly once.
		const harness = createUsageConsumerHarness();
		accountReported(harness, seam.reportedUsage);
		expect(harness.observedEvents()).toBe(1);
		expect(harness.accumulated().inputTokens).toBe(FIRST_USAGE.inputTokens);
	});

	// ── CASE C ─────────────────────────────────────────────────────────────

	it("C: accounts the usage of a summary whose completion was NEVER ESTABLISHED", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			usageChunk(FIRST_USAGE),
			{
				type: "done",
				id: "summary-1",
				success: false,
				finishReason: "unknown",
			},
		]);

		const notices: { message: string; metadata: unknown }[] = [];
		const saveCalls: unknown[] = [];
		const seam = await runProductionSeam({ notices, saveCalls });

		// The acceptance outcome: an UNEStablished completion is not
		// installable.
		expect(seam.saveCalls).toHaveLength(0);

		// The usage was REPORTED and accounted.
		expect(seam.reportedUsage).toHaveLength(1);
		const harness = createUsageConsumerHarness();
		accountReported(harness, seam.reportedUsage);
		expect(harness.observedEvents()).toBe(1);
		expect(harness.accumulated().inputTokens).toBe(FIRST_USAGE.inputTokens);
	});

	// ── CASE D ─────────────────────────────────────────────────────────────

	it("D: accounts the usage of a summary CANCELLED after the provider reported it", async () => {
		const controller = new AbortController();
		const cancelled = createGate();

		// A provider that IGNORES the cancellation and reports a LATE
		// SUCCESSFUL completion, after the usage was reported.
		createHandlerMock.mockImplementation(async () => ({
			createMessage: vi.fn(async function* () {
				yield {
					type: "text",
					id: "summary-1",
					text: COMPLETE_LOOKING_SUMMARY,
				};
				yield usageChunk(FIRST_USAGE);
				// The turn is cancelled WHILE the generation is under way.
				controller.abort(new Error("cmp08: cancelled after the usage arrived"));
				cancelled.open();
				yield { type: "done", id: "summary-1", success: true };
			}),
		}));

		const notices: { message: string; metadata: unknown }[] = [];
		const saveCalls: unknown[] = [];
		const seam = await runProductionSeam({
			abortSignal: controller.signal,
			notices,
			saveCalls,
		});
		await cancelled.wait;

		// The acceptance outcome: the cancelled candidate is refused.
		expect(seam.saveCalls).toHaveLength(0);
		expect(
			seam.notices.some((notice) => notice.message.endsWith("compacted")),
		).toBe(false);

		// The usage was REPORTED and accounted: a cancelled summary was
		// still paid for.
		expect(seam.reportedUsage).toHaveLength(1);
		const harness = createUsageConsumerHarness();
		accountReported(harness, seam.reportedUsage);
		expect(harness.observedEvents()).toBe(1);
		expect(harness.accumulated().inputTokens).toBe(FIRST_USAGE.inputTokens);
	});

	// ── CASE E ─────────────────────────────────────────────────────────────

	it("E: accounts the usage of a summary whose INSTALLATION was refused at the PERSISTENCE boundary", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			usageChunk(FIRST_USAGE),
			{ type: "done", id: "summary-1", success: true },
		]);

		const notices: { message: string; metadata: unknown }[] = [];
		const saveCalls: unknown[] = [];
		// The durable replacement FAILED. The turn was NOT cancelled, so
		// the refusal must not be reported as a cancellation.
		const controller = new AbortController();
		const seam = await runProductionSeam({
			abortSignal: controller.signal,
			notices,
			saveCalls,
			installationOutcome: {
				installed: false,
				reason: "persistence_failed",
			},
		});

		// The PERSISTENCE outcome: the candidate was ACCEPTED by the
		// acceptance decision, but the installation was refused, so nothing
		// was installed and no success was published.
		expect(seam.saveCalls).toHaveLength(1);
		expect(
			seam.notices.some((notice) => notice.message.endsWith("compacted")),
		).toBe(false);

		// THE PERSISTENCE-FAILURE DIAGNOSIS IS POSITIVE: the refusal is
		// named as a persistence failure, and it is NOT named as a
		// cancellation. The turn was not cancelled, so a cancellation
		// diagnosis would be false.
		const refusals = seam.logs.filter((line) =>
			line.includes("could not be durably installed"),
		);
		expect(refusals.length).toBeGreaterThan(0);
		for (const line of refusals) {
			expect(line).toContain("persistence_failed");
			expect(line).not.toContain('"rejectionReason":"cancelled"');
		}

		// The usage was REPORTED and accounted regardless: the summary was
		// paid for even though it was never installed.
		expect(seam.reportedUsage).toHaveLength(1);
		const harness = createUsageConsumerHarness();
		accountReported(harness, seam.reportedUsage);
		expect(harness.observedEvents()).toBe(1);
		expect(harness.accumulated().inputTokens).toBe(FIRST_USAGE.inputTokens);
	});

	// ── CASE F ─────────────────────────────────────────────────────────────

	it("F: launches ZERO physical provider requests and accounts NOTHING for an already-cancelled compaction", async () => {
		const controller = new AbortController();
		controller.abort(new Error("cmp08: the user cancelled before compaction"));
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			usageChunk(FIRST_USAGE),
			{ type: "done", id: "summary-1", success: true },
		]);

		const notices: { message: string; metadata: unknown }[] = [];
		const saveCalls: unknown[] = [];
		const seam = await runProductionSeam({
			abortSignal: controller.signal,
			notices,
			saveCalls,
		});

		// ZERO physical provider requests: the transport factory was never
		// reached.
		expect(createHandlerMock).not.toHaveBeenCalled();

		// NOTHING is accounted: there was no inference, so there is no
		// usage. An absent provider metric stays unknown.
		expect(seam.reportedUsage).toHaveLength(0);
		const harness = createUsageConsumerHarness();
		accountReported(harness, seam.reportedUsage);
		expect(harness.observedEvents()).toBe(0);
		expect(harness.accumulated().inputTokens).toBe(0);
		expect(harness.accumulated().outputTokens).toBe(0);
	});

	// ── CASE G ─────────────────────────────────────────────────────────────

	it("G: accounts an EXPLICITLY REPORTED ZERO as an explicit zero, and an ABSENT usage as absent", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			usageChunk(EXPLICIT_ZERO_USAGE),
			{ type: "done", id: "summary-1", success: true },
		]);

		const notices: { message: string; metadata: unknown }[] = [];
		const saveCalls: unknown[] = [];
		const seam = await runProductionSeam({ notices, saveCalls });

		// The candidate was installed.
		expect(seam.saveCalls).toHaveLength(1);

		// The provider reported a usage event whose metrics were ZERO.
		// The accounting is therefore zero-valued, and — critically — it is
		// NOT an invented cost: the reported values are the provider's own.
		expect(seam.reportedUsage).toHaveLength(1);
		expect(seam.reportedUsage[0].inputTokens).toBe(0);
		expect(seam.reportedUsage[0].outputTokens).toBe(0);
		expect(seam.reportedUsage[0].totalCost).toBeUndefined();

		const harness = createUsageConsumerHarness();
		accountReported(harness, seam.reportedUsage);
		expect(harness.observedEvents()).toBe(1);
		expect(harness.accumulated().inputTokens).toBe(0);
		expect(harness.accumulated().totalCost).toBe(0);

		// The ABSENT case is a DIFFERENT fact: the provider reported NO
		// usage event at all. Nothing is reported, and nothing is invented.
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			{ type: "done", id: "summary-1", success: true },
		]);
		const absentSeam = await runProductionSeam({ notices, saveCalls });
		expect(absentSeam.reportedUsage).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 (AMENDMENT-02 §1) —
// THE EXCEPTIONAL TERMINATION.
//
// THE USAGE-LOSS BOUNDARY.
//
// The usage is observed INSIDE the provider stream. A transport that FAILS
// after the provider already reported its usage ends the generation by
// THROWING — so a report made only after `generateSummary()` RETURNS never
// happens at all, and the usage of a PAID inference is lost on the floor.
//
// The witnesses below drive the production summarizer with:
//
//   - a usage event carrying exact nonzero metrics, and
//   - a subsequent transport exception,
//
// in BOTH shapes:
//
//   - a NON-CANCELLATION transport failure, and
//   - a CANCELLATION raised by the transport's own boundary.
//
// And they require:
//
//   - the previously observed usage reaches accounting EXACTLY ONCE,
//   - the ORIGINAL terminal exception remains AUTHORITATIVE,
//   - NO rejected summary is installed,
//   - NO successful compaction is published.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 (AMENDMENT-02 §1) — the exceptional termination", () => {
	/**
	 * The REAL summarizer, driven with the REAL transport contract and a
	 * deterministic provider substitute.
	 */
	async function runSummarizer(options: {
		chunks: readonly Record<string, unknown>[];
		after?: () => void;
		throwAfter?: Error;
		signal?: AbortSignal;
		/**
		 * ACT-CLINEMM-CMP08-TERMINAL-BOUNDED-CORRECTION-01 (A1): the failure
		 * the ACCOUNTING SINK raises, if any.
		 *
		 * It models the accounting channel failing on its own — a distinct
		 * failure from the transport's.
		 */
		sinkFailure?: Error;
	}): Promise<{
		reported: {
			requestId: string | undefined;
			kind: string;
			inputTokens: number;
			outputTokens: number;
			cacheReadTokens?: number;
			cacheWriteTokens?: number;
			totalCost?: number;
			reasoningTokenCount?: number;
		}[];
		error: unknown;
		/**
		 * ACT-CLINEMM-CMP08-TERMINAL-BOUNDED-CORRECTION-01 (A1): the
		 * DIAGNOSTICS the summarizer reported.
		 */
		diagnostics: { message: string; metadata: unknown }[];
		/**
		 * ACT-CLINEMM-CMP08-TERMINAL-BOUNDED-CORRECTION-01 (A1): how many
		 * times the accounting sink was INVOKED.
		 *
		 * The attempt is not skipped when it fails: it is made exactly
		 * once, and its failure is diagnosed.
		 */
		sinkInvocations: () => number;
	}> {
		createHandlerMock.mockImplementation(async () => ({
			createMessage: vi.fn(() => {
				const stream = (async function* () {
					for (const chunk of options.chunks) {
						yield chunk;
					}
					options.after?.();
					if (options.throwAfter) {
						throw options.throwAfter;
					}
				})();
				// The transport's own per-request identity, on the STREAM — the
				// same place the real compatibility adapter puts it.
				(stream as unknown as { id?: string }).id = "gw_cmp08_physical_request";
				return stream;
			}),
		}));
		const { generateSummary } = await import("./summary-generation");
		const reported: {
			requestId: string | undefined;
			kind: string;
			inputTokens: number;
			outputTokens: number;
			cacheReadTokens?: number;
			cacheWriteTokens?: number;
			totalCost?: number;
			reasoningTokenCount?: number;
		}[] = [];
		const diagnostics: { message: string; metadata: unknown }[] = [];
		let sinkInvocations = 0;
		let error: unknown;
		try {
			await generateSummary({
				providerConfig: {
					providerId: "anthropic",
					modelId: "mock-model",
				} as never,
				systemPrompt: SYSTEM_PROMPT,
				request: "summarize this",
				...(options.signal ? { signal: options.signal } : {}),
				reportUsage: (usage) => {
					sinkInvocations += 1;
					if (options.sinkFailure) {
						throw options.sinkFailure;
					}
					reported.push(usage);
				},
				logger: {
					debug: () => {},
					log: () => {},
					error: (message: string, metadata: unknown) => {
						diagnostics.push({ message, metadata });
					},
				},
			});
		} catch (caught) {
			error = caught;
		}
		return {
			reported,
			error,
			diagnostics,
			sinkInvocations: () => sinkInvocations,
		};
	}

	it("conserves the usage a provider reported before a NON-CANCELLATION transport failure, and keeps the exception authoritative", async () => {
		const transportFailure = new Error(
			"cmp08: the transport failed mid-summary",
		);
		const { reported, error } = await runSummarizer({
			chunks: [
				{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
				usageChunk(FIRST_USAGE),
			],
			throwAfter: transportFailure,
		});

		// The ORIGINAL terminal exception remains AUTHORITATIVE: it is the
		// error the generation ended with, and it is not replaced or
		// swallowed by the accounting.
		expect(error).toBe(transportFailure);
		expect((error as Error).message).toMatch(/transport failed mid-summary/i);

		// The previously observed usage reaches accounting EXACTLY ONCE,
		// with the provider's own numbers.
		expect(reported).toHaveLength(1);
		expect(reported[0]).toMatchObject({
			kind: "summarization",
			inputTokens: FIRST_USAGE.inputTokens,
			outputTokens: FIRST_USAGE.outputTokens,
			cacheReadTokens: FIRST_USAGE.cacheReadTokens,
			cacheWriteTokens: FIRST_USAGE.cacheWriteTokens,
			totalCost: FIRST_USAGE.totalCost,
			reasoningTokenCount: FIRST_USAGE.thoughtsTokenCount,
		});

		// The PHYSICAL request identity is the transport's own.
		expect(reported[0].requestId).toBe("gw_cmp08_physical_request");
	});

	it("conserves the usage a provider reported before a CANCELLATION raised by the transport, and keeps the cancellation authoritative", async () => {
		const controller = new AbortController();
		const cancellation = new Error("cmp08: the transport was cancelled");
		const { reported, error } = await runSummarizer({
			chunks: [
				{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
				usageChunk(FIRST_USAGE),
			],
			after: () => controller.abort(cancellation),
			throwAfter: cancellation,
			signal: controller.signal,
		});

		// The CANCELLATION remains authoritative.
		expect(error).toBe(cancellation);

		// The usage is conserved EXACTLY ONCE.
		expect(reported).toHaveLength(1);
		expect(reported[0].inputTokens).toBe(FIRST_USAGE.inputTokens);
	});

	it("installs NO rejected AGENTIC summary when the transport fails after reporting its usage, and still conserves the usage", async () => {
		// The transport fails AFTER the provider reported its usage.
		createHandlerMock.mockImplementation(async () => ({
			createMessage: vi.fn(() => {
				const stream = (async function* () {
					yield {
						type: "text",
						id: "summary-1",
						text: COMPLETE_LOOKING_SUMMARY,
					};
					yield usageChunk(FIRST_USAGE);
					throw new Error("cmp08: the transport failed mid-summary");
				})();
				(stream as unknown as { id?: string }).id = "gw_cmp08_failed_request";
				return stream;
			}),
		}));

		const notices: { message: string; metadata: unknown }[] = [];
		const saveCalls: unknown[] = [];
		const seam = await runProductionSeam({ notices, saveCalls });

		// The transport failure was NOT swallowed silently: the seam
		// reported it and fell back to the basic strategy. That fallback is
		// the PRE-EXISTING production behaviour for a non-cancellation
		// transport failure, and this ACT does not change it.
		expect(
			seam.logs.some((line) =>
				line.includes("falling back to basic compaction"),
			),
		).toBe(true);

		// NO rejected AGENTIC summary is installed: the agentic candidate
		// never reached the installation boundary.
		const installed = seam.saveCalls[0] as { summary?: string } | undefined;
		expect(installed?.summary).not.toBe(COMPLETE_LOOKING_SUMMARY);

		// And the usage is still conserved: the inference was paid for.
		// This is the whole point of the repair.
		expect(seam.reportedUsage).toHaveLength(1);
		expect(seam.reportedUsage[0].inputTokens).toBe(FIRST_USAGE.inputTokens);
		expect(seam.reportedUsage[0].inferenceId).toBe("gw_cmp08_failed_request");
	});

	// -----------------------------------------------------------------------
	// ACT-CLINEMM-CMP08-TERMINAL-BOUNDED-CORRECTION-01 (A1) — THE EXCEPTION
	// AUTHORITY.
	//
	// The ACCOUNTING FINALIZATION runs in a `finally`, so it runs WHILE the
	// generation's own terminal exception is already in flight. Before this
	// correction the sink was invoked WITHOUT an exception boundary, so a
	// sink that failed replaced the in-flight exception: the generation ended
	// with the ACCOUNTING failure and the TRANSPORT failure — the
	// authoritative outcome of a paid inference — was LOST.
	//
	// The transport's exception must remain authoritative, and the accounting
	// failure must be REPORTED through the existing diagnostic channel
	// rather than escalated.
	// -----------------------------------------------------------------------

	it("keeps the TRANSPORT failure authoritative when the ACCOUNTING sink also fails", async () => {
		const transportFailure = new Error(
			"cmp08: the transport failed mid-summary",
		);
		const accountingFailure = new Error(
			"cmp08: the accounting sink failed to record the usage",
		);
		const { reported, error, diagnostics, sinkInvocations } =
			await runSummarizer({
				chunks: [
					{
						type: "text",
						id: "summary-1",
						text: COMPLETE_LOOKING_SUMMARY,
					},
					usageChunk(FIRST_USAGE),
				],
				throwAfter: transportFailure,
				sinkFailure: accountingFailure,
			});

		// The TRANSPORT failure is the generation's outcome. The accounting
		// failure does NOT replace it.
		expect(error).toBe(transportFailure);
		expect(error).not.toBe(accountingFailure);

		// And the accounting failure is not SILENTLY swallowed: it is
		// reported through the existing diagnostic channel.
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toMatch(/usage/i);
		expect(
			(diagnostics[0].metadata as { error?: unknown } | undefined)?.error,
		).toBe(accountingFailure);

		// The accounting attempt was made EXACTLY ONCE — it is not skipped
		// because it failed, and it is not retried either.
		expect(sinkInvocations()).toBe(1);
		expect(reported).toHaveLength(0);
	});

	it("keeps the CANCELLATION authoritative when the ACCOUNTING sink also fails", async () => {
		const controller = new AbortController();
		const cancellation = new Error("cmp08: the transport was cancelled");
		const accountingFailure = new Error(
			"cmp08: the accounting sink failed to record the usage",
		);
		const { error, diagnostics, sinkInvocations } = await runSummarizer({
			chunks: [
				{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
				usageChunk(FIRST_USAGE),
			],
			after: () => controller.abort(cancellation),
			throwAfter: cancellation,
			signal: controller.signal,
			sinkFailure: accountingFailure,
		});

		// The CANCELLATION remains the authoritative outcome.
		expect(error).toBe(cancellation);
		expect(error).not.toBe(accountingFailure);

		// And the accounting failure is reported, not escalated.
		expect(diagnostics).toHaveLength(1);
		expect(
			(diagnostics[0].metadata as { error?: unknown } | undefined)?.error,
		).toBe(accountingFailure);

		// The accounting attempt was made EXACTLY ONCE.
		expect(sinkInvocations()).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 (AMENDMENT-02 §3) —
// THE NORMALIZED USAGE-EVENT SEMANTICS.
//
// THE CONTRACT, READ FROM THE PRODUCTION CHAIN
//
// The RESOLVED provider adapter (`@cline/llms`'s `ai-sdk` provider) emits
// EXACTLY ONE `usage` event per physical request, and that event is the
// request's own CUMULATIVE SNAPSHOT: the AI SDK's `stream.usage` ("complete
// usage data") or the finish part's `totalUsage` ("Usage snapshot at end of
// stream"). It is NOT an incremental delta, and it is NOT a running total
// across requests.
//
// The runtime then ADDS each reported usage into its cumulative state
// (`AgentRuntime.updateUsage()`), and the runtime-event adapter
// DIFFERENCES that cumulative back into a per-request DELTA for the
// production consumer.
//
// So the collector must NOT sum a provider's chunks: summation is correct
// only for deltas, and it would DOUBLE the request's usage if a provider
// ever emitted more than one chunk. The FIRST report is the request's
// authoritative usage.
//
// These witnesses observe the REAL normalized adapter's contract, not the
// raw provider protocol.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 (AMENDMENT-02 §3) — the normalized usage-event semantics", () => {
	it("takes the FIRST reported usage as the request's authoritative usage and does NOT double it", async () => {
		// The two chunks carry the two requests' DIFFERENT usage values, so
		// a doubled or a merged accounting is observable rather than merely
		// plausible.
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			usageChunk(FIRST_USAGE),
			usageChunk(SECOND_USAGE, "summary-1"),
			{ type: "done", id: "summary-1", success: true },
		]);

		const notices: { message: string; metadata: unknown }[] = [];
		const saveCalls: unknown[] = [];
		const seam = await runProductionSeam({ notices, saveCalls });

		// ONE inference, ONE report, carrying the request's AUTHORITATIVE
		// usage — the provider's first (and, for the resolved adapter,
		// only) report. The second chunk does not DOUBLE it, and it does
		// not MERGE with it either.
		expect(seam.reportedUsage).toHaveLength(1);
		expect(seam.reportedUsage[0]).toMatchObject({
			inputTokens: FIRST_USAGE.inputTokens,
			outputTokens: FIRST_USAGE.outputTokens,
			cacheReadTokens: FIRST_USAGE.cacheReadTokens,
			cacheWriteTokens: FIRST_USAGE.cacheWriteTokens,
			totalCost: FIRST_USAGE.totalCost,
		});
	});

	it("preserves the input, output, cache-read, cache-write, reasoning and cost fields the provider actually reported", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			usageChunk(FIRST_USAGE),
			{ type: "done", id: "summary-1", success: true },
		]);

		const notices: { message: string; metadata: unknown }[] = [];
		const saveCalls: unknown[] = [];
		const seam = await runProductionSeam({ notices, saveCalls });

		expect(seam.reportedUsage).toHaveLength(1);
		const reported = seam.reportedUsage[0];
		expect(reported.inputTokens).toBe(FIRST_USAGE.inputTokens);
		expect(reported.outputTokens).toBe(FIRST_USAGE.outputTokens);
		expect(reported.cacheReadTokens).toBe(FIRST_USAGE.cacheReadTokens);
		expect(reported.cacheWriteTokens).toBe(FIRST_USAGE.cacheWriteTokens);
		expect(reported.totalCost).toBe(FIRST_USAGE.totalCost);
		expect(reported.reasoningTokenCount).toBe(FIRST_USAGE.thoughtsTokenCount);
	});

	// -----------------------------------------------------------------------
	// ACT-CLINEMM-CMP08-TERMINAL-BOUNDED-CORRECTION-01 (A2) — THE OPTIONAL
	// COUNTERS.
	//
	// The normalized contract makes the input and output counters
	// MANDATORY and the rest OPTIONAL. An optional counter is optional
	// because the provider did not report it — NOT because it reported it as
	// zero.
	//
	// The previous collector collapsed the two cases: an absent counter
	// became zero and the zero was then dropped for being non-positive, so
	// an EXPLICITLY REPORTED ZERO cost, cache count or reasoning count
	// became ABSENT.
	//
	// The control below distinguishes the two: an explicitly reported zero
	// is conserved AS a zero, and an unreported metric stays absent.
	// -----------------------------------------------------------------------

	it("conserves an EXPLICITLY REPORTED ZERO optional metric, and keeps an UNREPORTED one absent", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			usageChunk({
				inputTokens: 100,
				outputTokens: 10,
				// The provider EXPLICITLY reported these as zero.
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0,
				thoughtsTokenCount: 0,
			}),
			{ type: "done", id: "summary-1", success: true },
		]);

		const notices: { message: string; metadata: unknown }[] = [];
		const saveCalls: unknown[] = [];
		const seam = await runProductionSeam({ notices, saveCalls });

		expect(seam.reportedUsage).toHaveLength(1);
		const reported = seam.reportedUsage[0];

		// The MANDATORY counters are the provider's own.
		expect(reported.inputTokens).toBe(100);
		expect(reported.outputTokens).toBe(10);

		// The EXPLICITLY REPORTED ZERO optional counters are PRESENT, with
		// the value the provider reported. They are not dropped and not
		// turned into an absent metric.
		expect(reported.cacheReadTokens).toBe(0);
		expect(reported.cacheWriteTokens).toBe(0);
		expect(reported.totalCost).toBe(0);
		expect(reported.reasoningTokenCount).toBe(0);

		// The ABSENT case is a DIFFERENT fact: the provider reported no such
		// metric at all, so it stays absent — never an invented zero.
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			usageChunk({ inputTokens: 100, outputTokens: 10 }),
			{ type: "done", id: "summary-1", success: true },
		]);
		const absentSeam = await runProductionSeam({ notices, saveCalls });
		expect(absentSeam.reportedUsage).toHaveLength(1);
		const absent = absentSeam.reportedUsage[0];
		expect(absent.cacheReadTokens).toBeUndefined();
		expect(absent.cacheWriteTokens).toBeUndefined();
		expect(absent.totalCost).toBeUndefined();
		expect(absent.reasoningTokenCount).toBeUndefined();
	});

	it("does NOT invent a metric the provider did not report", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			usageChunk({ inputTokens: 100, outputTokens: 10 }),
			{ type: "done", id: "summary-1", success: true },
		]);

		const notices: { message: string; metadata: unknown }[] = [];
		const saveCalls: unknown[] = [];
		const seam = await runProductionSeam({ notices, saveCalls });

		expect(seam.reportedUsage).toHaveLength(1);
		const reported = seam.reportedUsage[0];
		expect(reported.inputTokens).toBe(100);
		expect(reported.outputTokens).toBe(10);
		// The provider reported no cache, no cost and no reasoning: those
		// metrics stay ABSENT rather than becoming an invented zero.
		expect(reported.cacheReadTokens).toBeUndefined();
		expect(reported.cacheWriteTokens).toBeUndefined();
		expect(reported.totalCost).toBeUndefined();
		expect(reported.reasoningTokenCount).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 (AMENDMENT-02 §4) —
// THE REQUEST IDENTITY AND THE ABSENCE SEMANTICS.
//
// THE FOUR DISTINCT FACTS
//
//   1. NO INFERENCE DISPATCHED — the compaction never reached the
//      transport. There was no request, so there is no usage.
//   2. INFERENCE DISPATCHED WITH NO REPORTED USAGE — the provider was
//      called but reported no usage. The usage is UNKNOWN, not zero.
//   3. EXPLICITLY REPORTED ZERO — the provider reported a usage event
//      whose metrics were zero. That is a REPORTED fact and it is
//      conserved as one.
//   4. NONZERO USAGE FOLLOWED BY CANCELLATION OR EXCEPTION — the
//      provider reported real usage and the generation then ended
//      abnormally. The usage is conserved.
//
// THE PHYSICAL REQUEST IDENTITY
//
// `(conversationId, iteration, agentId)` is a LOGICAL tuple and it is NOT
// unique per physical provider request: two summarization invocations that
// share ONE logical iteration share all three components. The identity
// used is the transport's OWN per-request identity, so the two are
// distinguishable.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 (AMENDMENT-02 §4) — the request identity and the absence semantics", () => {
	it("distinguishes TWO summarization invocations that share ONE logical iteration", async () => {
		// TWO invocations of the SAME compaction seam, with the SAME
		// conversation, iteration and agent. The transport's own per-request
		// identity is what separates them.
		const reportedIds: string[] = [];
		createHandlerMock.mockImplementation(async () => ({
			createMessage: vi.fn(() => {
				const stream = (async function* () {
					yield {
						type: "text",
						id: "summary-1",
						text: COMPLETE_LOOKING_SUMMARY,
					};
					yield usageChunk(FIRST_USAGE);
					yield { type: "done", id: "summary-1", success: true };
				})();
				(stream as unknown as { id?: string }).id =
					`gw_${reportedIds.length + 1}`;
				return stream;
			}),
		}));

		const { generateSummary } = await import("./summary-generation");
		for (let index = 0; index < 2; index += 1) {
			await generateSummary({
				providerConfig: {
					providerId: "anthropic",
					modelId: "mock-model",
				} as never,
				systemPrompt: SYSTEM_PROMPT,
				request: "summarize this",
				reportUsage: (usage) => reportedIds.push(usage.requestId ?? ""),
			});
		}

		// The two PHYSICAL requests have DIFFERENT identities, even though
		// they share one logical iteration.
		expect(reportedIds).toHaveLength(2);
		expect(reportedIds[0]).not.toBe(reportedIds[1]);
		expect(reportedIds[0]).toBe("gw_1");
		expect(reportedIds[1]).toBe("gw_2");
	});

	it("distinguishes NO INFERENCE DISPATCHED from an EXPLICITLY REPORTED ZERO", async () => {
		// (1) NO INFERENCE DISPATCHED.
		const controller = new AbortController();
		controller.abort(new Error("cmp08: cancelled before compaction"));
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			usageChunk(EXPLICIT_ZERO_USAGE),
			{ type: "done", id: "summary-1", success: true },
		]);
		const noInference = await runProductionSeam({
			abortSignal: controller.signal,
		});
		expect(createHandlerMock).not.toHaveBeenCalled();
		expect(noInference.reportedUsage).toHaveLength(0);

		// (2) INFERENCE DISPATCHED WITH NO REPORTED USAGE.
		createHandlerMock.mockReset();
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			{ type: "done", id: "summary-1", success: true },
		]);
		const notReported = await runProductionSeam({});
		expect(createHandlerMock).toHaveBeenCalledTimes(1);
		expect(notReported.reportedUsage).toHaveLength(0);

		// (3) EXPLICITLY REPORTED ZERO — a REPORTED fact, conserved as one.
		createHandlerMock.mockReset();
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			usageChunk(EXPLICIT_ZERO_USAGE),
			{ type: "done", id: "summary-1", success: true },
		]);
		const explicitZero = await runProductionSeam({});
		expect(createHandlerMock).toHaveBeenCalledTimes(1);
		expect(explicitZero.reportedUsage).toHaveLength(1);
		expect(explicitZero.reportedUsage[0].inputTokens).toBe(0);
		expect(explicitZero.reportedUsage[0].outputTokens).toBe(0);
	});

	it("conserves NONZERO usage followed by a cancellation, as distinct from an absent usage", async () => {
		const controller = new AbortController();
		const cancelled = createGate();
		createHandlerMock.mockImplementation(async () => ({
			createMessage: vi.fn(async function* () {
				yield {
					type: "text",
					id: "summary-1",
					text: COMPLETE_LOOKING_SUMMARY,
				};
				yield usageChunk(FIRST_USAGE);
				controller.abort(new Error("cmp08: cancelled after the usage"));
				cancelled.open();
				yield { type: "done", id: "summary-1", success: true };
			}),
		}));

		const seam = await runProductionSeam({
			abortSignal: controller.signal,
		});
		await cancelled.wait;

		// (4) NONZERO USAGE FOLLOWED BY CANCELLATION.
		expect(seam.reportedUsage).toHaveLength(1);
		expect(seam.reportedUsage[0].inputTokens).toBe(FIRST_USAGE.inputTokens);
	});
});

// ---------------------------------------------------------------------------
// ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 (AMENDMENT-02 §2) —
// THE COMPOSED RUNTIME ACCOUNTING WITNESS.
//
// THE PRINCIPAL WITNESS IS COMPOSED OVER THE PRODUCTION CHAIN.
//
// The earlier form of this suite hand-built an `AgentEvent` and fed it
// straight to `handleAgentEvent()`. That BYPASSED:
//
//   - the session runtime's forwarding of the usage channel,
//   - the agent runtime's `updateUsage()` accumulation,
//   - the runtime-event adapter's translation,
//
// so it could only show that the consumer accumulates a delta it is HANDED.
// It could NOT show that the production accounting CONNECTION actually
// carries the summarization's usage.
//
// The witness below drives the REAL pieces:
//
//   the REAL `SessionRuntime` (with the REAL `AgentRuntime` inside it)
//     -> the REAL compaction preparation
//       -> the REAL `AgentRuntime.updateUsage()` accumulation
//         -> the REAL `usage-updated` runtime event
//           -> the REAL `RuntimeEventAdapter.translateUsage()`
//             -> the REAL `AgentEventBridge`
//               -> the REAL `handleAgentEvent()`
//                 -> `ctx.usageBySession`   (THE OBSERVABLE RESULT)
//
// ONLY THE EXTERNAL PROVIDER BOUNDARY IS SUBSTITUTED: the model is
// supplied as a PRE-BUILT `AgentModel` through the session runtime's
// sanctioned `createAgentRuntimeImpl` seam, and the summarizer's transport
// is the production one with a substituted provider.
//
// The NECESSITY discriminator disables ONLY the new auxiliary-usage
// forwarding connection and observes the principal witness FAIL.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 (AMENDMENT-02 §2) — the composed runtime accounting", () => {
	/**
	 * The COMPOSED production chain's observable result.
	 */
	interface ComposedRun {
		/** The PRODUCTION CONSUMER's accumulated usage. */
		readonly accumulated: () => {
			inputTokens: number;
			outputTokens: number;
			cacheReadTokens: number;
			cacheWriteTokens: number;
			totalCost: number;
		};
		/**
		 * How many `AgentEvent { type: "usage" }` frames the production
		 * consumer observed.
		 *
		 * It counts EVERY usage frame on the session runtime's event
		 * stream — the summarization's and the main agent's alike. The
		 * previous witness exposed it under the name
		 * `mainAgentUsageEvents`, which claimed it counted only the main
		 * agent's frames while it in fact counted every one of them.
		 */
		readonly observedUsageEvents: () => number;
		/** Whether the compaction seam was invoked at all. */
		readonly compactionInvoked: () => boolean;
		/** The usage the seam reported through the production channel. */
		readonly reportedUsage: () => readonly ReportedUsage[];
	}

	/**
	 * The MAIN AGENT's own model request.
	 *
	 * It is a REAL `AgentModel` event stream: the runtime's own contract.
	 *
	 * TWO FACTS THE WITNESS OBSERVES ABOUT IT
	 * ----------------------------------------
	 *
	 * 1. The usage frame it yields is a PARTIAL frame: the `AgentModel`
	 *    contract's `usage` event carries a `Partial<AgentUsage>`, and this
	 *    one reports only the input, output and cost counters. The runtime
	 *    ENQUEUES it — `updateUsage()` ADDS the reported counters into the
	 *    runtime's cumulative usage state — so the counters it does NOT
	 *    report simply do not contribute, and it is NOT a claim that they
	 *    were zero.
	 *
	 * 2. It arrives AFTER the summarization's usage, not before. The
	 *    compaction preparation runs in the turn's PREPARE phase, so the
	 *    summarization's inference is dispatched and accounted before the
	 *    main agent's model request is even made.
	 */
	function createMainAgentModel(): {
		stream: (request: unknown) => AsyncIterable<unknown>;
	} {
		return {
			stream: async function* () {
				yield { type: "text-delta", text: "the deploy pipeline looks fine" };
				yield {
					type: "usage",
					usage: {
						inputTokens: MAIN_AGENT_USAGE.inputTokens,
						outputTokens: MAIN_AGENT_USAGE.outputTokens,
						totalCost: MAIN_AGENT_USAGE.totalCost,
					},
				};
				yield { type: "finish", reason: "stop" };
			},
		} as never;
	}

	/**
	 * Drive the REAL `SessionRuntime` with the REAL `AgentRuntime`.
	 *
	 * The compaction preparation is the REAL one, and it is wired exactly
	 * as `LocalRuntimeHost` wires it: the real
	 * `createContextCompactionPrepareTurn` behind the real
	 * `createCompactionStateAwarePrepareTurn`, with the resulting
	 * `prepareTurn` handed to the session runtime.
	 *
	 * The session runtime's LEGACY event stream is the one the production
	 * `AgentEventBridge` consumes, so the witness feeds the REAL
	 * `AgentEventBridge` and observes the REAL `handleAgentEvent()`'s
	 * `ctx.usageBySession`.
	 */
	async function runComposedChain(options: {
		/** Whether the auxiliary-usage forwarding connection is enabled. */
		readonly forwardingEnabled?: boolean;
	}): Promise<ComposedRun> {
		const { AgentEventBridge } = await import(
			"../../runtime/host/local/agent-event-bridge"
		);
		const { SessionRuntime } = await import(
			"../../runtime/orchestration/session-runtime-orchestrator"
		);
		const { createAgentRuntime } = await import("@cline/agents");

		const reportedUsage: ReportedUsage[] = [];
		let compactionInvoked = false;

		const providerId = "anthropic";
		const modelId = "mock-model";
		const modelInfo = { id: modelId, maxInputTokens: 16_000 };

		// THE REAL COMPACTION PREPARATION, wired exactly as the host wires
		// it.
		const inner = createContextCompactionPrepareTurn(
			{
				providerId,
				modelId,
				providerConfig: { providerId, modelId } as LlmsProviders.ProviderConfig,
				compaction: {
					enabled: true,
					strategy: "agentic",
					preserveRecentTokens: 1,
				},
			},
			{ mode: "manual" },
		);
		const prepareTurn = createCompactionStateAwarePrepareTurn({
			//
			// The REAL forwarding is preserved: the channel the session
			// runtime forwarded into this context is what the compaction
			// reports through. The witness only OBSERVES it.
			//
			// The NECESSITY discriminator disables the ONE connection that
			// carries the usage — the channel that reaches the compaction
			// context — and leaves every other piece of the chain intact.
			compact: (context) => {
				compactionInvoked = true;
				const forwarded = (
					context as {
						reportAuxiliaryUsage?: (usage: ReportedUsage) => void;
					}
				).reportAuxiliaryUsage;
				return (
					inner?.({
						...context,
						model: {
							id: modelId,
							provider: providerId,
							info: modelInfo,
						},
						...(options.forwardingEnabled === false
							? { reportAuxiliaryUsage: undefined }
							: {
									reportAuxiliaryUsage: (usage: ReportedUsage) => {
										reportedUsage.push(usage);
										forwarded?.(usage);
									},
								}),
					}) ?? Promise.resolve(undefined)
				);
			},
			// The forwarded usage carries the SUMMARIZER TRANSPORT's own
			// per-request identity — the `gw_<nanoid>` the transport stamps
			// on the stream it returns. It is NOT the main agent's request
			// identity and NOT a logical identity derived from the
			// compaction's position.
			getState: () => undefined,
			prepareApiMessages: async (messages) => messages,
			saveState: () => undefined,
		});

		// THE PRODUCTION ACCOUNTING CONSUMER, wired through the REAL
		// `AgentEventBridge`.
		const usageBySession = new Map<
			string,
			ReturnType<typeof createInitialAccumulatedUsage>
		>();
		const aggregateUsageBySession = new Map<
			string,
			ReturnType<typeof createInitialAccumulatedUsage>
		>();
		const config = {
			providerId,
			modelId,
			mode: "act",
		} as unknown as CoreSessionConfig;
		const sessionId = "sess-cmp08-composed";
		let observedUsageEvents = 0;
		//
		// The LIVE SESSION. The production consumer accumulates the usage
		// into `ctx.usageBySession` only for a session that carries a
		// `turnUsageBaseline` — the same shape the real `LocalRuntimeHost`
		// registers. The bridge resolves it through `getSession`.
		const liveSession = {
			sessionId,
			config,
			runtime: {},
			agent: {
				getMessages: () => [],
				getAgentId: () => "agent-cmp08-composed",
				getConversationId: () => "conv-cmp08-composed",
			},
			turnUsageBaseline: createInitialAccumulatedUsage(),
		} as unknown as ActiveSession;
		const bridge = new AgentEventBridge({
			getSession: () => liveSession,
			usageBySession,
			aggregateUsageBySession,
			emit: vi.fn(),
			persistMessages: vi.fn(),
			enqueuePendingPrompt: vi.fn(),
			invokeBackendOptional: vi.fn(async () => {}),
		});

		// THE REAL SESSION RUNTIME, with the REAL `AgentRuntime` inside it.
		//
		// ONLY THE EXTERNAL PROVIDER BOUNDARY IS SUBSTITUTED: the model is
		// supplied as a PRE-BUILT `AgentModel` through the session
		// runtime's sanctioned `createAgentRuntimeImpl` seam. Everything
		// else — the runtime's accumulation, its event emission, the
		// adapter's translation, the bridge's dispatch and the consumer's
		// accounting — is the production code.
		const runtime = new SessionRuntime(
			{
				distinctId: "cmp08-composed",
				sessionId,
				providerId,
				modelId,
				systemPrompt: SYSTEM_PROMPT,
				tools: [],
				prepareTurn,
				knownModels: {
					[modelId]: {
						id: modelId,
						name: modelId,
						provider: providerId,
						info: modelInfo,
						capabilities: ["streaming"],
					} as never,
				},
				//
				// The PRIOR TRANSCRIPT. The compaction summarizes the
				// conversation that precedes the current turn, so the
				// composed chain needs a history long enough for the
				// production cut-index arithmetic to select a candidate.
				initialMessages: agentMessagesFromCanonicalHistory(),
			} as never,
			{
				createAgentRuntimeImpl: (config) =>
					createAgentRuntime({
						...config,
						// The PRE-BUILT model: the external provider
						// boundary, substituted.
						model: createMainAgentModel(),
					} as never),
			},
		);

		// The session runtime's LEGACY event stream is what the production
		// `AgentEventBridge` consumes.
		const unsubscribe = runtime.subscribeEvents((event) => {
			if (event.type === "usage") {
				observedUsageEvents += 1;
			}
			bridge.dispatchAgentEvent(sessionId, config, event);
		});

		try {
			//
			// `continue()` and NOT `run()`: `run()` resets the conversation
			// store, so the seeded prior transcript would be discarded and
			// the compaction would have nothing to summarize. `continue()`
			// preserves it, exactly as a resumed session does.
			await runtime.continue("Inspect the deploy pipeline and report.");
		} catch {
			// The run's own outcome is not what this witness observes.
		} finally {
			unsubscribe();
		}

		return {
			accumulated: () =>
				usageBySession.get(sessionId) ?? createInitialAccumulatedUsage(),
			observedUsageEvents: () => observedUsageEvents,
			compactionInvoked: () => compactionInvoked,
			reportedUsage: () => reportedUsage,
		};
	}

	it("delivers the summarization's provider-reported usage to the PRODUCTION accounting consumer through the REAL runtime chain", async () => {
		// The provider: the summarizer's chunks.
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			usageChunk(FIRST_USAGE),
			{ type: "done", id: "summary-1", success: true },
		]);

		const composed = await runComposedChain({});

		// The compaction WAS invoked: the composed chain reached the real
		// compaction preparation.
		expect(composed.compactionInvoked()).toBe(true);

		// The usage left the compaction through the production channel.
		expect(composed.reportedUsage()).toHaveLength(1);
		expect(composed.reportedUsage()[0].inputTokens).toBe(
			FIRST_USAGE.inputTokens,
		);
		// The usage carries the SUMMARIZER TRANSPORT's own per-request
		// identity — not the main agent's request identity, and not a
		// logical identity derived from the compaction's position.
		expect(composed.reportedUsage()[0].inferenceId).toBe("gw_cmp08_request");

		// The MAIN AGENT's own usage reached the production consumer
		// through the real runtime chain: the accumulated totals are the
		// SUM of the two requests' usage, and the main agent's contribution
		// is exactly its own reported numbers.
		expect(composed.observedUsageEvents()).toBe(2);

		// AND the SUMMARIZATION's usage reached the SAME accumulator,
		// through the same production consumer: the main agent's usage is
		// ADDED to, not substituted by, the summarization's.
		expect(composed.accumulated().inputTokens).toBe(
			MAIN_AGENT_USAGE.inputTokens + FIRST_USAGE.inputTokens,
		);
		expect(composed.accumulated().outputTokens).toBe(
			MAIN_AGENT_USAGE.outputTokens + FIRST_USAGE.outputTokens,
		);
		expect(composed.accumulated().cacheReadTokens).toBe(
			FIRST_USAGE.cacheReadTokens,
		);
		expect(composed.accumulated().cacheWriteTokens).toBe(
			FIRST_USAGE.cacheWriteTokens,
		);
		// The accumulated COST is the SUM of the two requests' costs, and
		// the assertion is EXACT — the consumer accumulates the very
		// numbers the two requests reported, so the total is determined.
		expect(composed.accumulated().totalCost).toBe(
			MAIN_AGENT_USAGE.totalCost + FIRST_USAGE.totalCost,
		);
	});

	it("FAILS the principal witness when ONLY the auxiliary-usage forwarding connection is disabled", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			usageChunk(FIRST_USAGE),
			{ type: "done", id: "summary-1", success: true },
		]);

		const composed = await runComposedChain({ forwardingEnabled: false });

		// The compaction WAS invoked, and the main agent's OWN usage still
		// reached the consumer — so the chain is alive. Exactly ONE usage
		// frame was observed: the main agent's own.
		expect(composed.compactionInvoked()).toBe(true);
		expect(composed.observedUsageEvents()).toBe(1);

		// But the SUMMARIZATION's usage did NOT: the connection that
		// carries it is exactly the thing the principal witness
		// exercises. With it disabled the principal witness FAILS.
		expect(composed.reportedUsage()).toHaveLength(0);
		expect(composed.accumulated().inputTokens).toBe(
			MAIN_AGENT_USAGE.inputTokens,
		);
	});
});

// ---------------------------------------------------------------------------
// ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 (AMENDMENT-02 §5) —
// THE FOCUSED INSTALLATION CONTROLS.
//
// The installation outcome is a DISCRIMINATED UNION: an unsuccessful
// installation ALWAYS carries an established refusal reason, and the three
// refusals are three DIFFERENT facts.
//
//   - a CANCELLATION names the user's intent;
//   - a PERSISTENCE FAILURE names the fault;
//   - a STALE STATE names the benign skip: the newer state already won.
//
// The LEGACY shapes keep their historical meaning exactly:
//
//   - `undefined` / `void` — the host reports nothing: the installation is
//     treated as committed;
//   - `true` — installed;
//   - `false` — refused with an UNKNOWN reason, reported as a cancellation
//     because that is what it meant before;
//   - the reason-less object — a host that has not opted into the
//     structured form: also reported as a cancellation.
//
// These controls do not reopen the accepted persistence or cancellation
// architecture. They pin the distinctions the union makes possible.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 (AMENDMENT-02 §5) — the installation outcome controls", () => {
	it("reports the STALE STATE skip as its OWN reason, not as a cancellation", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			usageChunk(FIRST_USAGE),
			{ type: "done", id: "summary-1", success: true },
		]);

		const notices: { message: string; metadata: unknown }[] = [];
		const saveCalls: unknown[] = [];
		const seam = await runProductionSeam({
			notices,
			saveCalls,
			installationOutcome: { installed: false, reason: "stale_state" },
		});

		// The candidate was refused, so no success was published.
		expect(
			seam.notices.some((notice) => notice.message.endsWith("compacted")),
		).toBe(false);

		// The refusal is named as the STALE STATE it is.
		const refusals = seam.logs.filter((line) =>
			line.includes("a newer compaction state is already installed"),
		);
		expect(refusals.length).toBeGreaterThan(0);
		for (const line of refusals) {
			expect(line).toContain("stale_state");
			expect(line).not.toContain('"rejectionReason":"cancelled"');
			expect(line).not.toContain('"rejectionReason":"persistence_failed"');
		}
	});

	it("preserves the HISTORICAL legacy boolean behaviour", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			usageChunk(FIRST_USAGE),
			{ type: "done", id: "summary-1", success: true },
		]);

		// The LEGACY `false`: refused, with an UNKNOWN reason, reported as a
		// cancellation because that is what it meant before.
		const notices: { message: string; metadata: unknown }[] = [];
		const saveCalls: unknown[] = [];
		const seam = await runProductionSeam({
			notices,
			saveCalls,
			installationOutcome: false as never,
		});

		expect(
			seam.notices.some((notice) => notice.message.endsWith("compacted")),
		).toBe(false);
		const refusals = seam.logs.filter((line) =>
			line.includes(
				"the turn was cancelled before the compaction was durably installed",
			),
		);
		expect(refusals.length).toBeGreaterThan(0);
		for (const line of refusals) {
			expect(line).toContain("cancelled");
		}
	});

	it("preserves the HISTORICAL legacy VOID behaviour: the installation is treated as committed", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			usageChunk(FIRST_USAGE),
			{ type: "done", id: "summary-1", success: true },
		]);

		const notices: { message: string; metadata: unknown }[] = [];
		const saveCalls: unknown[] = [];
		// `undefined` is the HISTORICAL contract: the host reports nothing.
		const seam = await runProductionSeam({
			notices,
			saveCalls,
			installationOutcome: undefined,
		});

		// The installation was treated as committed and the success was
		// published.
		expect(seam.saveCalls).toHaveLength(1);
		expect(
			seam.notices.some((notice) => notice.message.endsWith("compacted")),
		).toBe(true);
	});
});
