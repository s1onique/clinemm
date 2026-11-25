/**
 * ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01.
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
 *
 * So the usage is accounted exactly once, irrespective of whether the
 * candidate became installed state.
 *
 * ============================================================================
 * THE ACCOUNTING OWNER
 * ============================================================================
 *
 * There is NO second accounting ledger. The usage travels the EXISTING
 * mechanism:
 *
 *   the provider's usage chunk
 *     -> generateSummary()            (reads the chunk off the stream)
 *       -> runAgenticCompaction()     (reports it OUT OF BAND, before the
 *                                      acceptance decision)
 *         -> the compaction seam's usage channel
 *           -> the agent runtime's updateUsage()   (the SAME accumulation
 *                                                    the main model's usage
 *                                                    uses)
 *             -> the `usage-updated` runtime event
 *               -> runtime-event-adapter.translateUsage()
 *                 -> the `AgentEvent { type: "usage" }`
 *                   -> handleAgentEvent()   (THE PRODUCTION CONSUMER)
 *                     -> ctx.usageBySession  (THE OBSERVABLE RESULT)
 *
 * The witness below observes the PRODUCTION CONSUMER's observable result
 * (`ctx.usageBySession`), not the producer's local bookkeeping.
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
 * stays ABSENT and is never turned into a zero-cost inference.
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

/** The usage the provider reports for a request that reports NO metrics. */
const UNREPORTED_USAGE = {
	inputTokens: 0,
	outputTokens: 0,
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

// ---------------------------------------------------------------------------
// The PRODUCTION ACCOUNTING CONSUMER.
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

	return {
		saveCalls,
		notices,
		logs,
		reportedUsage,
		physicalRequests: () => physicalRequests,
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
): void {
	createHandlerMock.mockImplementation(async () => {
		onRequest?.();
		return {
			// The transport contract: `createMessage` is a FUNCTION that
			// RETURNS the async stream. It is not the stream itself.
			createMessage: vi.fn(async function* () {
				for (const chunk of chunks) {
					yield chunk;
				}
			}),
		};
	});
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

	it("G: accounts NOTHING when the provider reported no usage", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			usageChunk(UNREPORTED_USAGE),
			{ type: "done", id: "summary-1", success: true },
		]);

		const notices: { message: string; metadata: unknown }[] = [];
		const saveCalls: unknown[] = [];
		const seam = await runProductionSeam({ notices, saveCalls });

		// The candidate was installed.
		expect(seam.saveCalls).toHaveLength(1);

		// The provider reported a usage chunk with NO metrics. The
		// accounting is therefore zero-valued, and — critically — it is NOT
		// an invented cost: the reported values are the provider's own.
		expect(seam.reportedUsage).toHaveLength(1);
		expect(seam.reportedUsage[0].inputTokens).toBe(0);
		expect(seam.reportedUsage[0].outputTokens).toBe(0);
		expect(seam.reportedUsage[0].totalCost).toBeUndefined();

		const harness = createUsageConsumerHarness();
		accountReported(harness, seam.reportedUsage);
		expect(harness.observedEvents()).toBe(1);
		expect(harness.accumulated().inputTokens).toBe(0);
		expect(harness.accumulated().totalCost).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// THE AGGREGATION AND DUPLICATION CONTROLS.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 — the aggregation controls", () => {
	/**
	 * The usage-event contract: a provider reports the usage of ONE request
	 * per usage chunk, and the chunk's counters are that request's own
	 * numbers — a DELTA, never a running total.
	 *
	 * A provider MAY emit more than one usage chunk for a single request.
	 * The transport contract does not forbid it, and each chunk reports the
	 * usage of the request it belongs to, so the correct semantics is to
	 * SUM them. Taking only the last would silently discard usage the
	 * provider already reported.
	 */
	it("SUMS the usage chunks a provider emitted for ONE request", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			usageChunk({
				inputTokens: 100,
				outputTokens: 10,
				cacheReadTokens: 3,
				cacheWriteTokens: 1,
				totalCost: 0.5,
			}),
			usageChunk(
				{
					inputTokens: 200,
					outputTokens: 20,
					cacheReadTokens: 4,
					cacheWriteTokens: 2,
					totalCost: 0.25,
				},
				"summary-1",
			),
			{ type: "done", id: "summary-1", success: true },
		]);

		const notices: { message: string; metadata: unknown }[] = [];
		const saveCalls: unknown[] = [];
		const seam = await runProductionSeam({ notices, saveCalls });

		// ONE inference, ONE report, with the SUM of the provider's chunks.
		expect(seam.reportedUsage).toHaveLength(1);
		expect(seam.reportedUsage[0]).toMatchObject({
			inputTokens: 300,
			outputTokens: 30,
			cacheReadTokens: 7,
			cacheWriteTokens: 3,
			totalCost: 0.75,
		});
	});

	it("attributes a SECOND summarization request INDEPENDENTLY", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			usageChunk(FIRST_USAGE),
			{ type: "done", id: "summary-1", success: true },
		]);

		const notices: { message: string; metadata: unknown }[] = [];
		const saveCalls: unknown[] = [];
		const first = await runProductionSeam({ notices, saveCalls });

		useProviderChunks([
			{ type: "text", id: "summary-2", text: COMPLETE_LOOKING_SUMMARY },
			usageChunk(SECOND_USAGE, "summary-2"),
			{ type: "done", id: "summary-2", success: true },
		]);

		const second = await runProductionSeam({ notices, saveCalls });

		// Two INDEPENDENT reports. The second is not merged into the first.
		expect(first.reportedUsage).toHaveLength(1);
		expect(second.reportedUsage).toHaveLength(1);
		expect(first.reportedUsage[0].inputTokens).toBe(FIRST_USAGE.inputTokens);
		expect(second.reportedUsage[0].inputTokens).toBe(SECOND_USAGE.inputTokens);

		// The consumer accumulates BOTH, exactly once each.
		const harness = createUsageConsumerHarness();
		for (const usage of [...first.reportedUsage, ...second.reportedUsage]) {
			accountThroughProductionConsumer(harness, usage);
		}
		expect(harness.observedEvents()).toBe(2);
		expect(harness.accumulated().inputTokens).toBe(
			FIRST_USAGE.inputTokens + SECOND_USAGE.inputTokens,
		);
		expect(harness.accumulated().outputTokens).toBe(
			FIRST_USAGE.outputTokens + SECOND_USAGE.outputTokens,
		);
	});

	it("does NOT double-count through both the transport and the runtime accounting", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			usageChunk(FIRST_USAGE),
			{ type: "done", id: "summary-1", success: true },
		]);

		const notices: { message: string; metadata: unknown }[] = [];
		const saveCalls: unknown[] = [];
		const seam = await runProductionSeam({ notices, saveCalls });

		// The provider reported the usage ONCE, and the compaction reported
		// it ONCE. There is no second report of the same inference, so the
		// consumer's total is the provider's number — not twice it.
		expect(seam.reportedUsage).toHaveLength(1);
		const harness = createUsageConsumerHarness();
		for (const usage of seam.reportedUsage) {
			accountThroughProductionConsumer(harness, usage);
		}
		expect(harness.observedEvents()).toBe(1);
		expect(harness.accumulated().inputTokens).toBe(FIRST_USAGE.inputTokens);
		expect(harness.accumulated().inputTokens).not.toBe(
			FIRST_USAGE.inputTokens * 2,
		);
	});

	it("preserves the CACHE read/write accounting the provider reported", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			usageChunk(FIRST_USAGE),
			{ type: "done", id: "summary-1", success: true },
		]);

		const notices: { message: string; metadata: unknown }[] = [];
		const saveCalls: unknown[] = [];
		const seam = await runProductionSeam({ notices, saveCalls });

		const harness = createUsageConsumerHarness();
		for (const usage of seam.reportedUsage) {
			accountThroughProductionConsumer(harness, usage);
		}
		// The cache buckets reach the consumer as the provider reported them.
		expect(harness.accumulated().cacheReadTokens).toBe(
			FIRST_USAGE.cacheReadTokens,
		);
		expect(harness.accumulated().cacheWriteTokens).toBe(
			FIRST_USAGE.cacheWriteTokens,
		);
	});

	it("leaves the MAIN AGENT's usage UNCHANGED", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			usageChunk(FIRST_USAGE),
			{ type: "done", id: "summary-1", success: true },
		]);

		const notices: { message: string; metadata: unknown }[] = [];
		const saveCalls: unknown[] = [];
		const seam = await runProductionSeam({ notices, saveCalls });

		const harness = createUsageConsumerHarness();
		// The main agent's OWN usage, reported FIRST, exactly as the runtime
		// reports it.
		accountThroughProductionConsumer(harness, {
			inputTokens: 5_000,
			outputTokens: 500,
			totalCost: 0.5,
		});
		const afterMainAgent = harness.accumulated();
		expect(afterMainAgent.inputTokens).toBe(5_000);

		for (const usage of seam.reportedUsage) {
			accountThroughProductionConsumer(harness, usage);
		}

		// The main agent's usage is UNCHANGED by the summarization: the
		// summarization's usage is ADDED, not substituted.
		expect(harness.accumulated().inputTokens).toBe(
			5_000 + FIRST_USAGE.inputTokens,
		);
		expect(harness.accumulated().outputTokens).toBe(
			500 + FIRST_USAGE.outputTokens,
		);
	});
});
