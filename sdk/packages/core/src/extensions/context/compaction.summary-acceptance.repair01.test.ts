/**
 * ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01
 *
 * THE SUMMARY ACCEPTANCE MATRIX.
 *
 * ============================================================================
 * THE INVARIANT
 * ============================================================================
 *
 *   KNOWN_INCOMPLETE_SUMMARY_MUST_NOT_REPLACE_USABLE_CONTEXT
 *
 * A candidate is NOT installable when an authoritative terminal signal says
 * the generation was incomplete, exhausted its output budget, failed, was
 * cancelled, produced empty/whitespace-only content, or ended with a
 * transport failure.
 *
 * A provider-reported successful TRANSPORT is not sufficient when a separate
 * completion signal reports truncation. Conflicting success and incomplete
 * signals must not authorise installation.
 *
 * A normally completed, non-empty summary remains eligible for installation
 * under the existing compaction contract.
 *
 * ============================================================================
 * WHAT THIS SUITE DOES NOT CLAIM
 * ============================================================================
 *
 * It does NOT claim that a normal model termination proves semantic
 * completeness. It uses NO textual sentence-ending heuristic, NO keyword
 * scoring, NO mandatory additional inference and NO new semantic validation
 * framework.
 *
 * ============================================================================
 * THE SEAMS
 * ============================================================================
 *
 * Every scenario drives the REAL composed production seam:
 *
 *   createCompactionStateAwarePrepareTurn()   (the state-aware wrapper)
 *     -> createContextCompactionPrepareTurn()  (the real compaction seam)
 *       -> runAgenticCompaction()              (the owning boundary)
 *         -> generateSummary()                 (the real summarizer transport)
 *           -> the provider stream             (a deterministic substitute)
 *     -> createSessionCompactionState()        (the real sidecar builder)
 *     -> MessageBuilder.buildForApi()          (the real provider projection)
 *
 * The provider substitute stands in for the PROVIDER TRANSPORT only. Every
 * acceptance decision under test is taken by the REAL production code.
 */

import type * as LlmsProviders from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createSessionCompactionState,
	type SessionCompactionState,
} from "../../session/models/session-compaction";
import { MessageBuilder } from "../../session/services/message-builder";
import {
	AdjudicationEvidenceRegistry,
	buildAcquisitionEvidenceLedger,
} from "./adjudication-continuity";
import {
	createCompactionStateAwarePrepareTurn,
	createContextCompactionPrepareTurn,
} from "./compaction";

const createHandlerMock = vi.fn();

// ACT-CLINEMM-CMP04-TERMINAL-ACCEPTANCE-CONSERVATION-01: the REAL
// `@cline/llms` module is retained, and only `createHandlerAsync` is
// intercepted.
//
// The Gemini rows below drive the REAL compatibility adapter — the one the
// production summarizer transport reaches through `createHandlerAsync()` —
// so the terminal facts under test are the ones the production code
// actually receives. Only the EXTERNAL PROVIDER BOUNDARY (the HTTP
// `fetch`) is substituted; everything between the adapter and the
// acceptance decision is the real production code.
vi.mock("@cline/llms", async (importOriginal) => ({
	...(await importOriginal<typeof import("@cline/llms")>()),
	createHandlerAsync: (config: unknown) => createHandlerMock(config),
}));

const SYSTEM_PROMPT = "You are a helpful coding assistant.";

/** The provider-reported incompleteness reason. */
const INCOMPLETE_REASON = "max_output_tokens";

/**
 * A TRUNCATED summary: real text, cut off mid-sentence.
 */
const TRUNCATED_SUMMARY = "The user asked about the deploy pipeline and we";

/**
 * An APPARENTLY COMPLETE summary: a full, well-formed continuation note.
 *
 * It is used by the rows that prove the acceptance decision is driven by the
 * AUTHORITATIVE TERMINAL SIGNAL and not by the shape of the prose.
 */
const COMPLETE_LOOKING_SUMMARY =
	"Goal: finish the deploy pipeline review. Done: inspected deploy.env. " +
	"Next: report the findings to the user.";

/** The text of a previously installed, valid summary. */
const PRIOR_VALID_SUMMARY =
	"Prior valid summary: the deploy pipeline was inspected.";

async function* streamChunks(
	chunks: readonly Record<string, unknown>[],
): AsyncGenerator<Record<string, unknown>> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

/**
 * Install a deterministic provider substitute that emits the given chunks.
 */
function useProviderChunks(chunks: readonly Record<string, unknown>[]): void {
	createHandlerMock.mockReturnValue({
		createMessage: vi.fn(() => streamChunks(chunks)),
	});
}

/** The chunks for a NORMALLY COMPLETED, non-empty summary. */
function completedChunks(text: string): Record<string, unknown>[] {
	return [
		{ type: "text", id: "summary-1", text },
		{ type: "done", id: "summary-1", success: true },
	];
}

// ---------------------------------------------------------------------------
// ACT-CLINEMM-CMP04-TERMINAL-ACCEPTANCE-CONSERVATION-01
// The Gemini SSE fixtures.
//
// These are the SAME fixtures the transport probe established in
// `sdk/packages/llms/src/providers/compat.gemini-terminal-authority.test.ts`:
// a Gemini SSE body whose candidate carries the given finish reason.
//
// `finishReason: undefined` is the premature case: the stream ends after
// producing text, without the provider ever reporting a terminal reason.
// ---------------------------------------------------------------------------

/**
 * A Gemini SSE body whose candidate carries the given finish reason.
 */
function geminiSse(finishReason: string | undefined, content: string): string {
	const candidate: Record<string, unknown> = {
		content: { parts: [{ text: content }], role: "model" },
		index: 0,
	};
	if (finishReason !== undefined) {
		candidate.finishReason = finishReason;
	}
	return `data: ${JSON.stringify({ candidates: [candidate] })}\n\n`;
}

/**
 * Route the REAL compatibility adapter to a deterministic Gemini SSE body.
 *
 * `createHandlerAsync()` reaches the REAL compatibility adapter
 * (`createGatewayApiHandlerAsync`) for any provider without a registered
 * handler, and that adapter passes `config.fetch` straight to the gateway.
 * Substituting the `fetch` therefore substitutes EXACTLY ONE thing — the
 * external provider boundary — and leaves the adapter, the gateway, the
 * summarizer transport and the acceptance decision all real.
 */
function useGeminiSse(finishReason: string | undefined, content: string): void {
	createHandlerMock.mockImplementation(async (config: unknown) => {
		const providerConfig = config as LlmsProviders.ProviderConfig;
		const fetchStub = (async () =>
			new Response(geminiSse(finishReason, content), {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			})) as typeof fetch;
		const actual =
			await vi.importActual<typeof import("@cline/llms")>("@cline/llms");
		return actual.createHandlerAsync({
			...providerConfig,
			fetch: fetchStub,
		});
	});
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function userTurn(text: string): MessageWithMetadata {
	return { role: "user", content: [{ type: "text", text }] };
}

/**
 * The canonical history the compactor folds.
 */
function canonicalHistory(): MessageWithMetadata[] {
	return [
		userTurn("Inspect the deploy pipeline and report what you found."),
		{
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "call_truncated",
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
					tool_use_id: "call_truncated",
					name: "run_commands",
					content: [{ query: "cat deploy.env", result: "rc=0", success: true }],
				} as never,
			],
		},
		userTurn("Continue."),
	];
}

interface SeamRun {
	/** The messages the production pipeline returned. */
	readonly messages: readonly MessageWithMetadata[];
	/** The provider-visible projection, produced by the REAL MessageBuilder. */
	readonly providerVisibleText: string;
	/** Every state the production seam actually handed to `saveState`. */
	readonly saveCalls: readonly SessionCompactionState[];
	/** The state currently installed in the fixture. */
	readonly installedState: SessionCompactionState | undefined;
	/** The logger output the production seam produced. */
	readonly logs: readonly string[];
	/** The status notices the production seam published. */
	readonly notices: readonly { message: string; metadata: unknown }[];
}

interface SeamOptions {
	/** The prior compaction state, when one exists. */
	readonly existingState?: SessionCompactionState;
	/** The canonical history. Defaults to the standard fixture. */
	readonly canonical?: readonly MessageWithMetadata[];
	/** The abort signal, for the cancellation rows. */
	readonly abortSignal?: AbortSignal;
	/**
	 * ACT-CLINEMM-CMP04-TERMINAL-ACCEPTANCE-CONSERVATION-01: the provider
	 * the summarizer transport runs against.
	 *
	 * The Gemini rows use the real provider id so the production code takes
	 * the real Gemini path; the default keeps the historical fixture.
	 */
	readonly providerId?: string;
	/**
	 * ACT-CLINEMM-CMP04-TERMINAL-ACCEPTANCE-CONSERVATION-01: the provider
	 * config the summarizer transport receives.
	 *
	 * It carries the substituted `fetch`, so the REAL compatibility adapter
	 * reaches the deterministic Gemini SSE body.
	 */
	readonly providerConfig?: Record<string, unknown>;
	/**
	 * ACT-CLINEMM-CMP05-CANCELLATION-COMMIT-AUTHORITY-01: the controllable
	 * PRODUCTION BOUNDARY that sits AFTER the summary was accepted and
	 * BEFORE the compaction is installed.
	 *
	 * The adjudication carry-forward is `await`ed by the state-aware
	 * wrapper on BOTH installation paths, and the host's
	 * `getAcquisitions` callback is awaited inside it. That makes it the
	 * production boundary at which a cancellation can be signalled in the
	 * window between the acceptance and the installation.
	 *
	 * It is a REAL production seam, not a test hook: the callback is
	 * awaited by the production code, and the callback only observes and
	 * signals — it never decides anything.
	 */
	readonly onPostAcceptance?: () => void;
}

/**
 * Drive the REAL composed production seam.
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
	const notices: { message: string; metadata: unknown }[] = [];

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

	let installed: SessionCompactionState | undefined = options.existingState;
	const saveCalls: SessionCompactionState[] = [];
	const prepareTurn = createCompactionStateAwarePrepareTurn({
		compact: (context) =>
			inner?.({ ...context, model: innerModel }) ?? Promise.resolve(undefined),
		getState: () => installed,
		prepareApiMessages: async (messages) => messages,
		// ACT-CLINEMM-CMP05-CANCELLATION-COMMIT-AUTHORITY-01: the state-aware
		// wrapper's own logger, so the INSTALLATION refusal diagnostic is
		// observable through the same channel as every other diagnostic.
		logger: logger as never,
		saveState: (state) => {
			saveCalls.push(state);
			installed = state;
		},
		// ACT-CLINEMM-CMP05-CANCELLATION-COMMIT-AUTHORITY-01: the
		// controllable PRODUCTION BOUNDARY between the acceptance and the
		// installation. The host callback is awaited by the production
		// adjudication carry-forward on both installation paths.
		adjudication: {
			registry: new AdjudicationEvidenceRegistry({
				sessionId: "conv-1",
				secret: "cmp05-cancellation-commit-authority",
			}),
			getAcquisitions: async (canonicalMessages) => {
				options.onPostAcceptance?.();
				return buildAcquisitionEvidenceLedger(canonicalMessages);
			},
		},
	});

	const canonical = [...(options.canonical ?? canonicalHistory())];
	const result = await prepareTurn({
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

	const productionMessages = result?.messages ?? [];
	const providerVisible = new MessageBuilder().buildForApi(
		productionMessages as unknown as Parameters<
			MessageBuilder["buildForApi"]
		>[0],
	);
	return {
		messages: productionMessages,
		providerVisibleText: JSON.stringify(providerVisible),
		saveCalls,
		installedState: installed,
		logs,
		notices,
	};
}

/**
 * A prior, VALID compaction state over the first two canonical messages.
 */
function priorCompactionState(
	canonical: readonly MessageWithMetadata[],
): SessionCompactionState {
	return createSessionCompactionState({
		sourceMessages: canonical.slice(0, 2),
		compactedMessages: [
			{
				role: "user",
				content: [{ type: "text", text: PRIOR_VALID_SUMMARY }],
			} as unknown as MessageWithMetadata,
		],
		conversationId: "conv-1",
		systemPrompt: SYSTEM_PROMPT,
		updatedAt: new Date(0).toISOString(),
	});
}

/**
 * Whether the seam published a SUCCESSFUL compaction result.
 */
function publishedSuccess(
	seam: SeamRun,
): { message: string; metadata: unknown } | undefined {
	return seam.notices.find((notice) => notice.message.endsWith("compacted"));
}

/**
 * The rejection diagnostics the seam produced.
 */
function rejectionDiagnostics(seam: SeamRun): string {
	return seam.logs.filter((line) => line.startsWith("log: ")).join("\n");
}

/**
 * The compaction-status notices the seam published.
 */
function compactionNotices(
	seam: SeamRun,
): readonly { message: string; metadata: unknown }[] {
	return seam.notices.filter((notice) => notice.message.includes("compaction"));
}

beforeEach(() => {
	createHandlerMock.mockReset();
	useProviderChunks(completedChunks(COMPLETE_LOOKING_SUMMARY));
});

// ---------------------------------------------------------------------------
// The acceptance matrix
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01 — the summary acceptance matrix", () => {
	it("R1: a summary the provider reported as INCOMPLETE is NOT installed", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: TRUNCATED_SUMMARY },
			{
				type: "done",
				id: "summary-1",
				success: true,
				incompleteReason: INCOMPLETE_REASON,
			},
		]);

		const seam = await runProductionSeam();

		expect(seam.providerVisibleText).not.toContain(TRUNCATED_SUMMARY);
		expect(seam.saveCalls).toHaveLength(0);
		expect(seam.installedState).toBeUndefined();
		expect(publishedSuccess(seam)).toBeUndefined();
		// The specific reason is reported through the existing diagnostics.
		expect(rejectionDiagnostics(seam)).toContain(INCOMPLETE_REASON);
		expect(rejectionDiagnostics(seam)).toContain("known_incomplete");
	});

	it("R2: the OpenAI-compatible length signal reaches the acceptance decision", async () => {
		// The REAL adapter mapping is proven separately by
		// `sdk/packages/llms/src/providers/providers.finish-reason-length.test.ts`,
		// which drives the real gateway and the real adapter with a
		// deterministic SSE substitute and observes
		// `finish_reason: "length"` -> `reason: "max-tokens"`.
		//
		// The adapter's NORMALIZED value is what the summarizer transport
		// delivers, so this row exercises the acceptance decision with the
		// adapter's own `incompleteReason` spelling.
		useProviderChunks([
			{ type: "text", id: "summary-1", text: TRUNCATED_SUMMARY },
			{
				type: "done",
				id: "summary-1",
				success: true,
				incompleteReason: "max_tokens",
			},
		]);

		const seam = await runProductionSeam();

		expect(seam.providerVisibleText).not.toContain(TRUNCATED_SUMMARY);
		expect(seam.saveCalls).toHaveLength(0);
		expect(publishedSuccess(seam)).toBeUndefined();
		expect(rejectionDiagnostics(seam)).toContain("max_tokens");
	});

	it("R3: a FAILED generation with non-empty partial text is NOT installed", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: TRUNCATED_SUMMARY },
			{ type: "done", id: "summary-1", success: false },
		]);

		const seam = await runProductionSeam();

		expect(seam.providerVisibleText).not.toContain(TRUNCATED_SUMMARY);
		expect(seam.saveCalls).toHaveLength(0);
		expect(publishedSuccess(seam)).toBeUndefined();
		expect(rejectionDiagnostics(seam)).toContain("known_failed");
	});

	it("R4: an APPARENTLY COMPLETE summary with an authoritative incomplete signal is NOT installed", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			{
				type: "done",
				id: "summary-1",
				success: true,
				incompleteReason: INCOMPLETE_REASON,
			},
		]);

		const seam = await runProductionSeam();

		// The prose looks complete; the TERMINAL SIGNAL is what rejects it.
		expect(seam.providerVisibleText).not.toContain(COMPLETE_LOOKING_SUMMARY);
		expect(seam.saveCalls).toHaveLength(0);
		expect(publishedSuccess(seam)).toBeUndefined();
	});

	it("R5: a FAILED generation does NOT replace an existing valid compaction state", async () => {
		const canonical = canonicalHistory();
		const prior = priorCompactionState(canonical);

		useProviderChunks([
			{ type: "text", id: "summary-1", text: TRUNCATED_SUMMARY },
			{
				type: "done",
				id: "summary-1",
				success: true,
				incompleteReason: INCOMPLETE_REASON,
			},
		]);

		const seam = await runProductionSeam({ existingState: prior, canonical });

		// The previously installed summary is STILL the one that is used.
		expect(seam.providerVisibleText).toContain(PRIOR_VALID_SUMMARY);
		// The rejected candidate is nowhere.
		expect(seam.providerVisibleText).not.toContain(TRUNCATED_SUMMARY);
		// No replacement state was persisted.
		expect(seam.saveCalls).toHaveLength(0);
		expect(seam.installedState).toBe(prior);
		// The compacted source boundary did NOT advance.
		expect(seam.installedState?.source_message_count).toBe(
			prior.source_message_count,
		);
		expect(publishedSuccess(seam)).toBeUndefined();
	});

	it("R6: a SUCCESSFUL generation after a rejected attempt installs normally", async () => {
		const canonical = canonicalHistory();
		const prior = priorCompactionState(canonical);

		// First attempt: rejected.
		useProviderChunks([
			{ type: "text", id: "summary-1", text: TRUNCATED_SUMMARY },
			{
				type: "done",
				id: "summary-1",
				success: true,
				incompleteReason: INCOMPLETE_REASON,
			},
		]);
		const rejected = await runProductionSeam({
			existingState: prior,
			canonical,
		});
		expect(rejected.providerVisibleText).not.toContain(TRUNCATED_SUMMARY);
		expect(rejected.saveCalls).toHaveLength(0);

		// Second attempt: a NORMALLY COMPLETED summary.
		useProviderChunks(completedChunks(COMPLETE_LOOKING_SUMMARY));
		const accepted = await runProductionSeam({ canonical });

		expect(accepted.providerVisibleText).toContain(COMPLETE_LOOKING_SUMMARY);
		expect(accepted.saveCalls).toHaveLength(1);
		expect(publishedSuccess(accepted)).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// AMENDMENT-01 A3 — the extended acceptance matrix
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01 — the extended acceptance matrix", () => {
	it("A3: CONTENT FILTERING with partial text is rejected", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: TRUNCATED_SUMMARY },
			{
				type: "done",
				id: "summary-1",
				success: true,
				incompleteReason: "content_filter",
			},
		]);

		const seam = await runProductionSeam();

		expect(seam.providerVisibleText).not.toContain(TRUNCATED_SUMMARY);
		expect(seam.saveCalls).toHaveLength(0);
		expect(rejectionDiagnostics(seam)).toContain("content_filter");
		expect(rejectionDiagnostics(seam)).toContain("known_incomplete");
	});

	it("A3: a CONTRADICTORY success and incomplete signal rejects the candidate", async () => {
		// The transport reported success, but the completion signal says the
		// response was cut short. The negative terminal signal wins.
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			{
				type: "done",
				id: "summary-1",
				success: true,
				incompleteReason: INCOMPLETE_REASON,
			},
		]);

		const seam = await runProductionSeam();

		expect(seam.providerVisibleText).not.toContain(COMPLETE_LOOKING_SUMMARY);
		expect(seam.saveCalls).toHaveLength(0);
	});

	it("A3: a CONTRADICTORY success and failure signal rejects the candidate", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			{ type: "done", id: "summary-1", success: false },
		]);

		const seam = await runProductionSeam();

		expect(seam.providerVisibleText).not.toContain(COMPLETE_LOOKING_SUMMARY);
		expect(seam.saveCalls).toHaveLength(0);
		expect(rejectionDiagnostics(seam)).toContain("known_failed");
	});

	it("A3: an unexpected TOOL-CALL termination is rejected", async () => {
		useProviderChunks([
			{
				type: "tool_calls",
				id: "summary-1",
				tool_call: { function: { name: "run_commands" } },
			},
			{ type: "done", id: "summary-1", success: true },
		]);

		const seam = await runProductionSeam();

		expect(seam.saveCalls).toHaveLength(0);
		expect(rejectionDiagnostics(seam)).toContain("unexpected_tool_call");
	});

	it("A3: a WHITESPACE-ONLY output is rejected and behaves like the empty case", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: "   \n\t  " },
			{ type: "done", id: "summary-1", success: true },
		]);

		const seam = await runProductionSeam();

		expect(seam.saveCalls).toHaveLength(0);
		expect(publishedSuccess(seam)).toBeUndefined();
		// The pre-existing empty-summary diagnostic is preserved.
		expect(rejectionDiagnostics(seam)).toContain(
			"summarizer returned no summary text",
		);
	});

	it("A3: a LEGACY completion with genuinely unavailable finish-reason metadata still installs", async () => {
		// The transport contract allows a handler to finish without emitting
		// the optional done chunk. That is the LEGACY shape: the completion
		// status is genuinely UNAVAILABLE, and it must NOT be confused with
		// an unexpected stream termination.
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
		]);

		const seam = await runProductionSeam();

		expect(seam.providerVisibleText).toContain(COMPLETE_LOOKING_SUMMARY);
		expect(seam.saveCalls).toHaveLength(1);
		expect(publishedSuccess(seam)).toBeDefined();
	});

	it("A3: a TRANSPORT FAILURE falls back through the EXISTING bounded recovery path", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: TRUNCATED_SUMMARY },
			{
				type: "done",
				id: "summary-1",
				success: false,
				error: "Provider transport failed",
			},
		]);

		// The transport error is thrown by the summarizer transport. The
		// EXISTING contract for an agentic compaction failure is the bounded
		// fallback to BASIC compaction — that behaviour is unchanged by this
		// repair and must stay unchanged.
		const seam = await runProductionSeam();

		// The fallback ran, so the compaction produced a transcript...
		expect(publishedSuccess(seam)).toBeDefined();
		// ...but the REJECTED candidate text was never published through the
		// agentic summarizer's summary message.
		expect(seam.providerVisibleText).not.toContain(
			"## Active task contract (authoritative)",
		);
	});

	it("A3: a CANCELLED generation is NOT installed, and the cancellation decides the outcome", async () => {
		const controller = new AbortController();
		useProviderChunks([
			{ type: "text", id: "summary-1", text: TRUNCATED_SUMMARY },
			{ type: "done", id: "summary-1", success: true },
		]);
		controller.abort();

		// ACT-CLINEMM-CMP07-PROVIDER-CANCELLATION-PROPAGATION-01 — THE
		// TRANSPORT SEMANTICS ARE NOW PROPAGATED.
		//
		// Before this ACT, `runAgenticCompaction()` called `generateSummary()`
		// WITHOUT the compaction's abort signal, so a cancelled compaction
		// still PAID for a full provider inference: the summarizer ran and
		// reported its completion, and only then did the acceptance decision
		// discard the candidate.
		//
		// The signal is now threaded to the summarizer transport, so an
		// ALREADY-CANCELLED compaction never reaches it: ZERO physical
		// provider requests are dispatched, and the cancelled candidate is
		// never produced at all.
		//
		// The cancellation AUTHORITY of the DECISION is unchanged: the
		// decision still decides the outcome, and the diagnosis is still the
		// existing one — `cancelled`, never a provider failure and never an
		// empty response.
		const seam = await runProductionSeam({
			abortSignal: controller.signal,
		});

		// The summarizer transport was NOT reached: no provider request was
		// dispatched for a compaction the user had already cancelled.
		expect(createHandlerMock.mock.results.length).toBe(0);
		// ...and the candidate is NOT installed.
		expect(seam.saveCalls).toHaveLength(0);
		expect(seam.installedState).toBeUndefined();
		expect(seam.providerVisibleText).not.toContain(TRUNCATED_SUMMARY);
		expect(publishedSuccess(seam)).toBeUndefined();
		// The cancellation is DISTINGUISHED from an ordinary provider
		// failure by the existing acceptance contract.s own reason: the
		// rejection reason is `cancelled`, not the ordinary provider
		// failure reason.
		expect(rejectionDiagnostics(seam)).toContain("cancelled");
		expect(rejectionDiagnostics(seam)).not.toContain(
			"provider_reported_failure",
		);
	});

	it("A3: a cancellation INSIDE the summarizer transport prevents any installation", async () => {
		const controller = new AbortController();
		createHandlerMock.mockReturnValue({
			createMessage: vi.fn(async function* () {
				yield {
					type: "text",
					id: "summary-1",
					text: TRUNCATED_SUMMARY,
				};
				controller.abort();
				const error = new Error("The operation was aborted.");
				error.name = "AbortError";
				throw error;
			}),
		});

		// The transport error propagates. A CANCELLATION is explicitly NOT
		// fallen back to basic compaction by the existing contract: the seam
		// re-throws it, so nothing is installed at all.
		await expect(
			runProductionSeam({ abortSignal: controller.signal }),
		).rejects.toThrow(/abort/i);
	});
});

// ---------------------------------------------------------------------------
// AMENDMENT-01 A4 — the failure-path accounting and progress conservation
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01 — the failure-path accounting", () => {
	it("A4: a rejected candidate publishes a SKIPPED compaction, not a successful one", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: TRUNCATED_SUMMARY },
			{
				type: "done",
				id: "summary-1",
				success: true,
				incompleteReason: INCOMPLETE_REASON,
			},
		]);

		const seam = await runProductionSeam();

		// NO successful compaction receipt was published.
		expect(publishedSuccess(seam)).toBeUndefined();
		const notices = compactionNotices(seam);
		// The compaction that ran is reported as SKIPPED, with the skipped
		// phase — never as a completed compaction.
		expect(
			notices.some((notice) => notice.message.endsWith("compaction-skipped")),
		).toBe(true);
		expect(notices.some((notice) => notice.message.endsWith("compacted"))).toBe(
			false,
		);
		// The skipped notice carries the SKIPPED phase, so the successful-
		// compaction accounting is not incremented.
		const skipped = notices.find((notice) =>
			notice.message.endsWith("compaction-skipped"),
		);
		expect(skipped?.metadata).toMatchObject({ phase: "skipped" });
	});

	it("A4: a rejected candidate does not replace the working-context token accounting", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: TRUNCATED_SUMMARY },
			{
				type: "done",
				id: "summary-1",
				success: true,
				incompleteReason: INCOMPLETE_REASON,
			},
		]);

		const seam = await runProductionSeam();

		// The skipped notice reports NO `tokensAfter`/`tokensSaved`, because
		// those are derived from the INSTALLED transcript. The rejected
		// candidate's text is therefore never turned into an accounting
		// figure.
		const skipped = compactionNotices(seam).find((notice) =>
			notice.message.endsWith("compaction-skipped"),
		);
		const metadata = (skipped?.metadata ?? {}) as Record<string, unknown>;
		expect(metadata.tokensAfter).toBeUndefined();
		expect(metadata.tokensSaved).toBeUndefined();
		expect(metadata.messagesAfter).toBeUndefined();
	});

	it("A4: a rejected candidate does not consume or clear a valid existing compaction state", async () => {
		const canonical = canonicalHistory();
		const prior = priorCompactionState(canonical);

		useProviderChunks([
			{ type: "text", id: "summary-1", text: TRUNCATED_SUMMARY },
			{
				type: "done",
				id: "summary-1",
				success: true,
				incompleteReason: INCOMPLETE_REASON,
			},
		]);

		const seam = await runProductionSeam({ existingState: prior, canonical });

		// The state is neither replaced nor consumed.
		expect(seam.installedState).toBe(prior);
		expect(seam.saveCalls).toHaveLength(0);
		// The retained canonical tail is unchanged: the prior state's own
		// messages and boundary are byte-identical.
		expect(seam.installedState?.messages).toEqual(prior.messages);
		expect(seam.installedState?.source_message_count).toBe(
			prior.source_message_count,
		);
		expect(seam.installedState?.source_prefix_hash).toBe(
			prior.source_prefix_hash,
		);
	});

	it("A4: the rejected decision does not trigger an unbounded repeat of itself", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: TRUNCATED_SUMMARY },
			{
				type: "done",
				id: "summary-1",
				success: true,
				incompleteReason: INCOMPLETE_REASON,
			},
		]);

		// ONE prepare-turn. The summarizer is asked exactly ONCE. The
		// rejection returns "no compaction" rather than retrying, so an
		// unchanged failing decision is never repeated.
		const seam = await runProductionSeam();

		const handlerCalls = createHandlerMock.mock.results.length;
		expect(handlerCalls).toBe(1);
		expect(seam.saveCalls).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// ACT-CLINEMM-CMP04-TERMINAL-ACCEPTANCE-CONSERVATION-01
//
// THE GEMINI TERMINAL AUTHORITY THROUGH THE PRODUCTION ACCEPTANCE PATH.
//
// WHY THIS BLOCK EXISTS
// ---------------------
//
// The Gemini transport repair (the predecessor ACT) established that a
// Gemini stream which ends WITHOUT the provider reporting a terminal
// reason produces gateway `finish.reason === "unknown"`, and that the
// compatibility adapter must not report such a stream as a SUCCESSFUL
// completion.
//
// That repair was proven at the COMPATIBILITY BOUNDARY. What it did NOT
// establish is the consequence that matters for the compaction contract: a
// summary produced by such a stream must not be INSTALLED as the
// replacement for the compacted history.
//
// This block drives the ACTUAL production composition:
//
//   createCompactionStateAwarePrepareTurn()   (the state-aware wrapper)
//     -> createContextCompactionPrepareTurn()  (the real compaction seam)
//       -> runAgenticCompaction()              (the owning boundary)
//         -> generateSummary()                 (the real summarizer transport)
//           -> createHandlerAsync()             (the REAL handler factory)
//             -> createGatewayApiHandlerAsync() (the REAL compatibility adapter)
//               -> the gateway                  (the REAL gateway)
//                 -> the Gemini SSE body        (a deterministic substitute)
//
// ONLY THE EXTERNAL PROVIDER BOUNDARY IS SUBSTITUTED: the HTTP `fetch`.
// The adapter, the gateway, the summarizer transport, the acceptance
// contract, the compaction decision and the state installation are ALL the
// real production code.
//
// The claim this block makes is deliberately NARROWER than the transport
// repair's: it claims that an UNEStablished Gemini completion is not
// installed, and that the previously installed valid state survives the
// rejection.
// ---------------------------------------------------------------------------

/** The Gemini provider id, so the production code takes the real path. */
const GEMINI_PROVIDER_ID = "gemini";

/**
 * The substituted EXTERNAL PROVIDER BOUNDARY.
 *
 * The body is supplied per call by the fixture that installed it.
 */
let geminiSseBody = "";

function geminiFetchStub(): typeof fetch {
	return (async () =>
		new Response(geminiSseBody, {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		})) as typeof fetch;
}

/**
 * Run the production seam against the Gemini provider with the substituted
 * `fetch`.
 */
async function runGeminiSeam(options: SeamOptions = {}): Promise<SeamRun> {
	return runProductionSeam({
		...options,
		providerId: GEMINI_PROVIDER_ID,
		providerConfig: {
			apiKey: "test-key",
			baseUrl: "https://stub.invalid/v1",
			fetch: geminiFetchStub(),
		},
	});
}

describe("ACT-CLINEMM-CMP04-TERMINAL-ACCEPTANCE-CONSERVATION-01 — the Gemini terminal authority through the production acceptance path", () => {
	it("CMP04: a Gemini summary from an UNEStablished completion is NOT installed", async () => {
		// The premature stream: the provider produces text and never
		// reports a terminal reason.
		geminiSseBody = geminiSse(undefined, COMPLETE_LOOKING_SUMMARY);
		useGeminiSse(undefined, COMPLETE_LOOKING_SUMMARY);

		const seam = await runGeminiSeam();

		// The candidate is NOT installed.
		expect(seam.providerVisibleText).not.toContain(COMPLETE_LOOKING_SUMMARY);
		expect(seam.saveCalls).toHaveLength(0);
		expect(seam.installedState).toBeUndefined();
		expect(publishedSuccess(seam)).toBeUndefined();

		// The rejection is DIAGNOSED as what it is: an unestablished
		// completion, NOT a normal completion and NOT an invented
		// provider failure.
		expect(rejectionDiagnostics(seam)).toContain("unestablished_completion");
		expect(rejectionDiagnostics(seam)).toContain("unknown");
		// ...and it is NOT reported as a successful completion.
		expect(rejectionDiagnostics(seam)).not.toContain("known_complete");
	});

	it("CMP04: a Gemini summary from a NORMAL STOP completion IS installed", async () => {
		geminiSseBody = geminiSse("STOP", COMPLETE_LOOKING_SUMMARY);
		useGeminiSse("STOP", COMPLETE_LOOKING_SUMMARY);

		const seam = await runGeminiSeam();

		// The normally completed summary IS installed.
		expect(seam.providerVisibleText).toContain(COMPLETE_LOOKING_SUMMARY);
		expect(seam.saveCalls).toHaveLength(1);
		expect(publishedSuccess(seam)).toBeDefined();
		// ...and it is not rejected for any reason.
		expect(rejectionDiagnostics(seam)).not.toContain(
			"unestablished_completion",
		);
		expect(rejectionDiagnostics(seam)).not.toContain("known_failed");
	});

	it("CMP04: the MAX-TOKEN rejection is conserved for a Gemini stream", async () => {
		geminiSseBody = geminiSse("MAX_TOKENS", TRUNCATED_SUMMARY);
		useGeminiSse("MAX_TOKENS", TRUNCATED_SUMMARY);

		const seam = await runGeminiSeam();

		// The established max-token rejection still rejects.
		expect(seam.providerVisibleText).not.toContain(TRUNCATED_SUMMARY);
		expect(seam.saveCalls).toHaveLength(0);
		expect(publishedSuccess(seam)).toBeUndefined();
		expect(rejectionDiagnostics(seam)).toContain("max_tokens");
		expect(rejectionDiagnostics(seam)).toContain("known_incomplete");
	});

	it("CMP04: the CONTENT-FILTER rejection is conserved for a Gemini stream", async () => {
		geminiSseBody = geminiSse("SAFETY", TRUNCATED_SUMMARY);
		useGeminiSse("SAFETY", TRUNCATED_SUMMARY);

		const seam = await runGeminiSeam();

		// The established content-filter rejection still rejects.
		expect(seam.providerVisibleText).not.toContain(TRUNCATED_SUMMARY);
		expect(seam.saveCalls).toHaveLength(0);
		expect(publishedSuccess(seam)).toBeUndefined();
		expect(rejectionDiagnostics(seam)).toContain("content_filter");
		expect(rejectionDiagnostics(seam)).toContain("known_incomplete");
	});

	it("CMP04: a rejected unestablished Gemini candidate leaves the installed valid state unchanged", async () => {
		const canonical = canonicalHistory();
		const prior = priorCompactionState(canonical);

		geminiSseBody = geminiSse(undefined, COMPLETE_LOOKING_SUMMARY);
		useGeminiSse(undefined, COMPLETE_LOOKING_SUMMARY);

		const seam = await runGeminiSeam({ existingState: prior, canonical });

		// The previously installed summary is STILL the one that is used.
		expect(seam.providerVisibleText).toContain(PRIOR_VALID_SUMMARY);
		// The rejected candidate is nowhere.
		expect(seam.providerVisibleText).not.toContain(COMPLETE_LOOKING_SUMMARY);
		// No replacement state was persisted, and the installed state is
		// the very object that was there before.
		expect(seam.saveCalls).toHaveLength(0);
		expect(seam.installedState).toBe(prior);
		expect(seam.installedState?.source_message_count).toBe(
			prior.source_message_count,
		);
		expect(seam.installedState?.source_prefix_hash).toBe(
			prior.source_prefix_hash,
		);
		expect(publishedSuccess(seam)).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// ACT-CLINEMM-CMP05-TERMINAL-NEGATIVE-SIGNAL-PRECEDENCE-01
//
// THE CONFLICTING TERMINAL SIGNALS AT THE ACCEPTANCE DECISION.
//
// The terminal fields of a done chunk can CONFLICT: the transport's success
// flag can disagree with the reported terminal reason, and the reported
// reason can disagree with an explicit incompleteness.
//
// A NEGATIVE signal must win over a POSITIVE one. Otherwise a failed or
// unestablished turn is normalized into a successful completion, and the
// acceptance decision — which exists precisely to refuse such a candidate —
// authorizes the installation of a summary the provider never established.
//
// These rows drive the REAL production seam, with only the provider chunk
// substitute standing in for the transport.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-CMP05-TERMINAL-NEGATIVE-SIGNAL-PRECEDENCE-01 — the conflicting terminal signals at the acceptance decision", () => {
	it("CMP05: a SUCCESSFUL flag with an UNKNOWN terminal reason does NOT permit installation", async () => {
		// The transport reported `success: true`, but the terminal reason is
		// `unknown`: the provider never ESTABLISHED a successful
		// completion. The success flag is not sufficient — the same rule
		// the contract already applies to a truncation signal.
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			{
				type: "done",
				id: "summary-1",
				success: true,
				finishReason: "unknown",
			},
		]);

		const seam = await runProductionSeam();

		// The candidate is NOT installed.
		expect(seam.providerVisibleText).not.toContain(COMPLETE_LOOKING_SUMMARY);
		expect(seam.saveCalls).toHaveLength(0);
		expect(seam.installedState).toBeUndefined();
		expect(publishedSuccess(seam)).toBeUndefined();
		// It is diagnosed as an unestablished completion, NOT as a normal
		// completion and NOT as an invented provider failure.
		expect(rejectionDiagnostics(seam)).toContain("unestablished_completion");
		expect(rejectionDiagnostics(seam)).not.toContain("known_complete");
	});

	it("CMP05: a FAILED stream with a STOP terminal reason does NOT permit installation", async () => {
		// The transport reported `success: false`, but the terminal reason is
		// `stop`. The negative signal wins: the stream did not complete
		// successfully.
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			{
				type: "done",
				id: "summary-1",
				success: false,
				finishReason: "stop",
			},
		]);

		const seam = await runProductionSeam();

		expect(seam.providerVisibleText).not.toContain(COMPLETE_LOOKING_SUMMARY);
		expect(seam.saveCalls).toHaveLength(0);
		expect(publishedSuccess(seam)).toBeUndefined();
	});

	it("CMP05: a STOP terminal reason with an explicit INCOMPLETENESS keeps the incompleteness authoritative", async () => {
		// The provider reported the response was cut short. That
		// incompleteness is authoritative and is NOT collapsed into a normal
		// completion by the reported reason.
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			{
				type: "done",
				id: "summary-1",
				success: true,
				finishReason: "stop",
				incompleteReason: INCOMPLETE_REASON,
			},
		]);

		const seam = await runProductionSeam();

		expect(seam.providerVisibleText).not.toContain(COMPLETE_LOOKING_SUMMARY);
		expect(seam.saveCalls).toHaveLength(0);
		expect(publishedSuccess(seam)).toBeUndefined();
		expect(rejectionDiagnostics(seam)).toContain("known_incomplete");
		expect(rejectionDiagnostics(seam)).toContain(INCOMPLETE_REASON);
	});

	it("CMP05: a NORMAL STOP completion with no negative signal still installs", async () => {
		// The positive control: the correction must not reject an ordinary,
		// unconflicted completion.
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			{
				type: "done",
				id: "summary-1",
				success: true,
				finishReason: "stop",
			},
		]);

		const seam = await runProductionSeam();

		expect(seam.providerVisibleText).toContain(COMPLETE_LOOKING_SUMMARY);
		expect(seam.saveCalls).toHaveLength(1);
		expect(publishedSuccess(seam)).toBeDefined();
	});

	it("CMP05: a LEGACY completion with no terminal reason at all still installs", async () => {
		// The legacy shape is genuinely UNAVAILABLE status, not a reported
		// unestablished completion. It keeps its previous behaviour.
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			{ type: "done", id: "summary-1", success: true },
		]);

		const seam = await runProductionSeam();

		expect(seam.providerVisibleText).toContain(COMPLETE_LOOKING_SUMMARY);
		expect(seam.saveCalls).toHaveLength(1);
		expect(publishedSuccess(seam)).toBeDefined();
	});

	it("CMP05: the MAX-TOKEN and CONTENT-FILTER mappings remain authoritative", async () => {
		useProviderChunks([
			{ type: "text", id: "summary-1", text: TRUNCATED_SUMMARY },
			{
				type: "done",
				id: "summary-1",
				success: true,
				finishReason: "stop",
				incompleteReason: "max_tokens",
			},
		]);
		const maxTokens = await runProductionSeam();
		expect(maxTokens.saveCalls).toHaveLength(0);
		expect(rejectionDiagnostics(maxTokens)).toContain("max_tokens");
		expect(rejectionDiagnostics(maxTokens)).toContain("known_incomplete");

		useProviderChunks([
			{ type: "text", id: "summary-1", text: TRUNCATED_SUMMARY },
			{
				type: "done",
				id: "summary-1",
				success: true,
				finishReason: "stop",
				incompleteReason: "content_filter",
			},
		]);
		const contentFilter = await runProductionSeam();
		expect(contentFilter.saveCalls).toHaveLength(0);
		expect(rejectionDiagnostics(contentFilter)).toContain("content_filter");
		expect(rejectionDiagnostics(contentFilter)).toContain("known_incomplete");
	});

	it("CMP05: a CANCELLED generation keeps its existing cancellation precedence", async () => {
		// Cancellation wins over everything, including a reported reason.
		useProviderChunks([
			{ type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY },
			{
				type: "done",
				id: "summary-1",
				success: true,
				finishReason: "stop",
			},
		]);
		const controller = new AbortController();
		controller.abort();

		const seam = await runProductionSeam({ abortSignal: controller.signal });

		// The pre-existing cancellation PRECEDENCE is conserved and made
		// effective: the cancellation wins over the successful terminal
		// signal, so the candidate is not installed and the cancellation is
		// reported as a cancellation rather than as an ordinary failure.
		expect(seam.saveCalls).toHaveLength(0);
		expect(seam.installedState).toBeUndefined();
		expect(seam.providerVisibleText).not.toContain(COMPLETE_LOOKING_SUMMARY);
		expect(publishedSuccess(seam)).toBeUndefined();
		expect(rejectionDiagnostics(seam)).toContain("cancelled");
	});
});

// ---------------------------------------------------------------------------
// ACT-CLINEMM-CMP05-CANCELLATION-AUTHORITY-01
//
// THE CANCELLATION AUTHORITY AT THE COMPACTION INSTALLATION COMMIT POINT.
//
// THE INVARIANT
// -------------
//
//   CANCELLATION_BEFORE_INSTALLATION_MUST_NOT_INSTALL_OR_PUBLISH
//
// A compaction that was cancelled BEFORE its installation commit point must
// not install a replacement summary, must not publish a successful
// compaction, and must not advance the compacted source boundary — even
// when the summarizer SUBSEQUENTLY reports a successful completion.
//
// THE INSTALLATION COMMIT POINT
// -----------------------------
//
// The linearization point of a compaction is the `saveState()` call in
// `createCompactionStateAwarePrepareTurn()` (`compaction.ts`). It is
// reached ONLY when the compaction strategy returned a transcript, so the
// AUTHORITY that decides whether a compaction commits lives at the
// ACCEPTANCE DECISION inside `runAgenticCompaction()` — the boundary that
// owns the summary installation and that runs BEFORE the state is built,
// BEFORE the state is persisted, BEFORE a successful compaction is
// published and BEFORE the source boundary advances.
//
// The decision is taken there, so a candidate rejected there cannot reach
// the commit point. This suite establishes that the DECISION refuses a
// cancelled candidate.
//
// A compaction that ALREADY COMMITTED before the cancellation is NOT rolled
// back: the commit is the linearization point, and a cancellation that
// arrives afterwards is a cancellation of the TURN, not of the committed
// compaction. This ACT requires no rollback, and none is asserted.
//
// THE AUTHORITY
// -------------
//
// The compaction's OWN abort signal is the SINGLE cancellation authority.
// It reaches the decision through `options.context.abortSignal` and is
// read AT the decision, AFTER the summarizer returned. Reading it there is
// what makes the authority unconditional: a cancellation signalled at ANY
// moment before the decision is observed by the SAME read.
//
// The existing acceptance contract already ranks `cancelled` ABOVE every
// other terminal signal (`classifySummaryTerminalStatus()`), so the
// cancellation wins over a late provider success without any new
// precedence rule and without a second cancellation authority.
//
// THE WITNESSES
// -------------
//
// Each witness drives the REAL composed production seam with only the
// provider transport substituted, and each cancellation is produced
// DETERMINISTICALLY by the substitute itself — there is no sleep and no
// timing-dependent race anywhere in this block.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-CMP05-CANCELLATION-AUTHORITY-01 — the cancellation authority at the installation commit point", () => {
	it("CMP05-CA: a cancellation BEFORE summarization starts installs nothing", async () => {
		const controller = new AbortController();
		// The cancellation is signalled BEFORE the turn begins. The
		// summarizer transport still runs — the transport contract is
		// unchanged — and reports a successful completion.
		useProviderChunks(completedChunks(COMPLETE_LOOKING_SUMMARY));
		controller.abort();

		const seam = await runProductionSeam({ abortSignal: controller.signal });

		// The candidate is absent from the provider-visible history.
		expect(seam.providerVisibleText).not.toContain(COMPLETE_LOOKING_SUMMARY);
		// No replacement state was persisted, and nothing is installed.
		expect(seam.saveCalls).toHaveLength(0);
		expect(seam.installedState).toBeUndefined();
		// No successful compaction publication.
		expect(publishedSuccess(seam)).toBeUndefined();
		// The cancellation is DISTINGUISHED from an ordinary provider
		// failure by the existing acceptance contract.s own reason: the
		// rejection reason is `cancelled`, not the ordinary provider
		// failure reason.
		expect(rejectionDiagnostics(seam)).toContain("cancelled");
		expect(rejectionDiagnostics(seam)).not.toContain(
			"provider_reported_failure",
		);
	});

	it("CMP05-CA: a cancellation DURING summarization, after partial text, installs nothing", async () => {
		const controller = new AbortController();
		// The cancellation is signalled AFTER the transport has delivered
		// PARTIAL text and BEFORE it reports its terminal chunk.
		createHandlerMock.mockReturnValue({
			createMessage: vi.fn(async function* () {
				yield {
					type: "text",
					id: "summary-1",
					text: TRUNCATED_SUMMARY,
				};
				controller.abort();
				yield {
					type: "done",
					id: "summary-1",
					success: true,
				};
			}),
		});

		const seam = await runProductionSeam({ abortSignal: controller.signal });

		// The rejected candidate is nowhere in the provider-visible history.
		expect(seam.providerVisibleText).not.toContain(TRUNCATED_SUMMARY);
		// No replacement state was persisted.
		expect(seam.saveCalls).toHaveLength(0);
		expect(seam.installedState).toBeUndefined();
		// No successful compaction publication.
		expect(publishedSuccess(seam)).toBeUndefined();
		// The cancellation is distinguished from an ordinary provider
		// failure.
		expect(rejectionDiagnostics(seam)).toContain("cancelled");
	});

	it("CMP05-CA: a cancellation AFTER a successful terminal response, before the commit point, installs nothing", async () => {
		const controller = new AbortController();
		// The summarizer reports a SUCCESSFUL terminal response and the
		// cancellation is signalled immediately afterwards — before the
		// decision and therefore before the installation commit point.
		createHandlerMock.mockReturnValue({
			createMessage: vi.fn(async function* () {
				yield {
					type: "text",
					id: "summary-1",
					text: COMPLETE_LOOKING_SUMMARY,
				};
				yield {
					type: "done",
					id: "summary-1",
					success: true,
				};
				controller.abort();
			}),
		});

		const seam = await runProductionSeam({ abortSignal: controller.signal });

		// The candidate that the provider SUCCESSFULLY reported is absent
		// from the provider-visible history.
		expect(seam.providerVisibleText).not.toContain(COMPLETE_LOOKING_SUMMARY);
		// No replacement state was persisted.
		expect(seam.saveCalls).toHaveLength(0);
		expect(seam.installedState).toBeUndefined();
		// No successful compaction publication.
		expect(publishedSuccess(seam)).toBeUndefined();
		// The late provider success did NOT override the cancellation.
		expect(rejectionDiagnostics(seam)).toContain("cancelled");
	});

	it("CMP05-CA: a LATE provider success after cancellation cannot replace the previously installed valid state", async () => {
		const canonical = canonicalHistory();
		const prior = priorCompactionState(canonical);
		const controller = new AbortController();

		// The provider substitute delivers a SUCCESSFUL terminal chunk AFTER
		// the cancellation was signalled. This is the late provider success:
		// the summarizer reports success for work the user had already
		// cancelled.
		createHandlerMock.mockReturnValue({
			createMessage: vi.fn(async function* () {
				yield {
					type: "text",
					id: "summary-1",
					text: COMPLETE_LOOKING_SUMMARY,
				};
				controller.abort();
				yield {
					type: "done",
					id: "summary-1",
					success: true,
				};
			}),
		});

		const seam = await runProductionSeam({
			abortSignal: controller.signal,
			existingState: prior,
			canonical,
		});

		// The rejected candidate is absent from the provider-visible
		// history.
		expect(seam.providerVisibleText).not.toContain(COMPLETE_LOOKING_SUMMARY);
		// The previously installed valid summary is STILL the one that is
		// used: the late provider success did not replace it.
		expect(seam.providerVisibleText).toContain(PRIOR_VALID_SUMMARY);
		// No replacement state was persisted, and the installed state is
		// the very object that was there before.
		expect(seam.saveCalls).toHaveLength(0);
		expect(seam.installedState).toBe(prior);
		// The compacted source boundary did NOT advance.
		expect(seam.installedState?.source_message_count).toBe(
			prior.source_message_count,
		);
		expect(seam.installedState?.source_prefix_hash).toBe(
			prior.source_prefix_hash,
		);
		expect(seam.installedState?.messages).toEqual(prior.messages);
		// No successful compaction publication.
		expect(publishedSuccess(seam)).toBeUndefined();
		// The cancellation is distinguished from an ordinary provider
		// failure.
		expect(rejectionDiagnostics(seam)).toContain("cancelled");
	});

	it("CMP05-CA: a NORMALLY COMPLETED compaction remains installable", async () => {
		// The CONSERVATION control. The repair must not have made every
		// compaction un-installable: an uncancelled, normally completed
		// summary is still installed exactly as before.
		useProviderChunks(completedChunks(COMPLETE_LOOKING_SUMMARY));

		const seam = await runProductionSeam();

		expect(seam.providerVisibleText).toContain(COMPLETE_LOOKING_SUMMARY);
		expect(seam.saveCalls).toHaveLength(1);
		expect(seam.installedState).toBeDefined();
		expect(publishedSuccess(seam)).toBeDefined();
		// It is not rejected for any reason.
		expect(rejectionDiagnostics(seam)).not.toContain("cancelled");
		expect(rejectionDiagnostics(seam)).not.toContain("known_failed");
	});

	it("CMP05-CA: a NORMALLY COMPLETED compaction after a CANCELLED attempt still installs", async () => {
		// The CONSERVATION control, in sequence: a cancelled attempt must
		// not poison the session. A later, uncancelled compaction still
		// installs and still publishes a successful compaction.
		const canonical = canonicalHistory();
		const prior = priorCompactionState(canonical);

		const controller = new AbortController();
		useProviderChunks(completedChunks(COMPLETE_LOOKING_SUMMARY));
		controller.abort();
		const cancelled = await runProductionSeam({
			abortSignal: controller.signal,
			existingState: prior,
			canonical,
		});
		expect(cancelled.saveCalls).toHaveLength(0);
		expect(cancelled.installedState).toBe(prior);

		// The next, uncancelled attempt installs normally.
		useProviderChunks(completedChunks(COMPLETE_LOOKING_SUMMARY));
		const accepted = await runProductionSeam({ canonical });

		expect(accepted.providerVisibleText).toContain(COMPLETE_LOOKING_SUMMARY);
		expect(accepted.saveCalls).toHaveLength(1);
		expect(publishedSuccess(accepted)).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// ACT-CLINEMM-CMP05-CANCELLATION-COMMIT-AUTHORITY-01
//
// THE CANCELLATION AUTHORITY AT THE ACTUAL INSTALLATION COMMIT POINT.
//
// THE INVARIANT
// -------------
//
//   CANCELLATION_BEFORE_INSTALLATION_MUST_NOT_INSTALL_OR_PUBLISH
//
// A compaction that was cancelled AFTER its summary was accepted but
// BEFORE its installation must not install a replacement summary, must not
// publish a successful compaction, and must not advance the compacted
// source boundary.
//
// THE ACTUAL INSTALLATION LINEARIZATION POINT
// -------------------------------------------
//
// The INSTALLATION is performed by the `saveState()` call in
// `createCompactionStateAwarePrepareTurn()`. That call is NOT the durable
// linearization point on its own: the host's `saveState` implementation
// validates the state, enqueues the write behind the session's write queue,
// and only then performs the atomic file write that replaces the persisted
// sidecar. Several ASYNCHRONOUS boundaries sit between the acceptance
// decision and that durable write.
//
// The authority is therefore exercised IMMEDIATELY BEFORE `saveState`:
// that is the last point at which the seam can still refuse the
// installation. Once `saveState` is invoked the write is in flight, and
// cancelling afterwards would be a rollback of an already committed
// compaction — which this contract does NOT do.
//
// THE SUCCESS PUBLICATION ORDER
// -----------------------------
//
// The compaction's SUCCESS PUBLICATION is emitted by the INNER seam (the one
// that runs the strategy), and the INSTALLATION is performed by the OUTER
// seam. The publication therefore naturally PRECEDES the installation.
//
// With an installation authority in place, something can refuse the
// installation between the two, so the publication is DEFERRED past the
// installation and released only once the installation committed. A
// successful compaction is never announced for work that was not installed.
//
// THE WITNESSES
// -------------
//
// Each witness produces a VALID, SUCCESSFULLY ACCEPTED summary and then
// signals the cancellation at the REAL production boundary that lies
// between the acceptance and the installation: the adjudication
// carry-forward's host callback, which the production code awaits on BOTH
// installation paths.
//
// The cancellation is signalled by the boundary itself, so it is
// DETERMINISTIC: there is no sleep and no timing-dependent race.
//
// The cancellation is NOT signalled inside the provider stream: that
// boundary is already qualified by
// ACT-CLINEMM-CMP05-CANCELLATION-AUTHORITY-01.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-CMP05-CANCELLATION-COMMIT-AUTHORITY-01 — the cancellation authority at the installation commit point", () => {
	it("CMP05-CCA: a cancellation AFTER acceptance and BEFORE the FIRST installation installs nothing", async () => {
		const controller = new AbortController();
		// A VALID, SUCCESSFULLY ACCEPTED summary.
		useProviderChunks(completedChunks(COMPLETE_LOOKING_SUMMARY));

		const seam = await runProductionSeam({
			abortSignal: controller.signal,
			// The production boundary between the acceptance and the
			// installation.
			onPostAcceptance: () => controller.abort(),
		});

		// The summary WAS accepted: the summarizer ran and reported a
		// successful completion.
		expect(createHandlerMock.mock.results.length).toBe(1);

		// No replacement state was persisted.
		expect(seam.saveCalls).toHaveLength(0);
		expect(seam.installedState).toBeUndefined();
		// No rejected candidate is exposed in the provider-visible history.
		expect(seam.providerVisibleText).not.toContain(COMPLETE_LOOKING_SUMMARY);
		// No successful compaction publication.
		expect(publishedSuccess(seam)).toBeUndefined();
		expect(
			compactionNotices(seam).some((notice) =>
				notice.message.endsWith("compaction-skipped"),
			),
		).toBe(true);
		// The cancellation is DIAGNOSED as a cancellation.
		expect(rejectionDiagnostics(seam)).toContain("cancelled");
	});

	it("CMP05-CCA: a cancellation AFTER acceptance and BEFORE a RE-compaction installation conserves the prior valid state", async () => {
		const canonical = canonicalHistory();
		const prior = priorCompactionState(canonical);
		const controller = new AbortController();
		// A VALID, SUCCESSFULLY ACCEPTED summary.
		useProviderChunks(completedChunks(COMPLETE_LOOKING_SUMMARY));

		const seam = await runProductionSeam({
			abortSignal: controller.signal,
			existingState: prior,
			canonical,
			// The production boundary between the acceptance and the
			// installation.
			onPostAcceptance: () => controller.abort(),
		});

		// The summary WAS accepted.
		expect(createHandlerMock.mock.results.length).toBe(1);

		// No replacement state was persisted, and the installed state is
		// the very object that was there before.
		expect(seam.saveCalls).toHaveLength(0);
		expect(seam.installedState).toBe(prior);
		// No rejected candidate is exposed in the provider-visible history.
		expect(seam.providerVisibleText).not.toContain(COMPLETE_LOOKING_SUMMARY);
		// The previously installed valid summary is STILL the one that is
		// used.
		expect(seam.providerVisibleText).toContain(PRIOR_VALID_SUMMARY);
		// The compacted source boundary did NOT advance.
		expect(seam.installedState?.source_message_count).toBe(
			prior.source_message_count,
		);
		expect(seam.installedState?.source_prefix_hash).toBe(
			prior.source_prefix_hash,
		);
		expect(seam.installedState?.messages).toEqual(prior.messages);
		// No successful compaction publication.
		expect(publishedSuccess(seam)).toBeUndefined();
		expect(
			compactionNotices(seam).some((notice) =>
				notice.message.endsWith("compaction-skipped"),
			),
		).toBe(true);
		// The cancellation is DIAGNOSED as a cancellation.
		expect(rejectionDiagnostics(seam)).toContain("cancelled");
	});

	it("CMP05-CCA: the SUCCESS PUBLICATION cannot precede the installation it describes", async () => {
		// The ordering witness. The success notice is published by the
		// inner seam, which runs BEFORE the installation, so it is
		// DEFERRED: it is released only after the installation committed,
		// and dropped when the installation was refused.
		const controller = new AbortController();
		useProviderChunks(completedChunks(COMPLETE_LOOKING_SUMMARY));

		const seam = await runProductionSeam({
			abortSignal: controller.signal,
			onPostAcceptance: () => controller.abort(),
		});

		// The success notice was NOT published for the refused
		// installation...
		expect(publishedSuccess(seam)).toBeUndefined();
		// ...and the compaction was reported as skipped instead.
		expect(
			compactionNotices(seam).some((notice) =>
				notice.message.endsWith("compaction-skipped"),
			),
		).toBe(true);
	});

	it("CMP05-CCA: a NORMALLY COMPLETED compaction still installs and still publishes its success", async () => {
		// The CONSERVATION control. The repair must not have made every
		// compaction un-installable: an uncancelled, normally completed
		// compaction is still installed and still announces its success.
		useProviderChunks(completedChunks(COMPLETE_LOOKING_SUMMARY));

		const seam = await runProductionSeam();

		expect(seam.saveCalls).toHaveLength(1);
		expect(seam.installedState).toBeDefined();
		expect(seam.providerVisibleText).toContain(COMPLETE_LOOKING_SUMMARY);
		// The success publication still happens — and it still happens
		// AFTER the installation, which is the point of the deferral.
		expect(publishedSuccess(seam)).toBeDefined();
		expect(rejectionDiagnostics(seam)).not.toContain("cancelled");
	});

	it("CMP05-CCA: a NORMALLY COMPLETED re-compaction still installs and still publishes its success", async () => {
		// The CONSERVATION control on the re-compaction path.
		const canonical = canonicalHistory();
		const prior = priorCompactionState(canonical);
		useProviderChunks(completedChunks(COMPLETE_LOOKING_SUMMARY));

		const seam = await runProductionSeam({ existingState: prior, canonical });

		expect(seam.saveCalls).toHaveLength(1);
		expect(seam.installedState).not.toBe(prior);
		expect(seam.providerVisibleText).toContain(COMPLETE_LOOKING_SUMMARY);
		expect(publishedSuccess(seam)).toBeDefined();
		expect(rejectionDiagnostics(seam)).not.toContain("cancelled");
	});
});
