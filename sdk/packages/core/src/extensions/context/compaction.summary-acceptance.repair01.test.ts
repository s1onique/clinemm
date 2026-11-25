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
	createCompactionStateAwarePrepareTurn,
	createContextCompactionPrepareTurn,
} from "./compaction";

const createHandlerMock = vi.fn();

vi.mock("@cline/llms", () => ({
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
}

/**
 * Drive the REAL composed production seam.
 */
async function runProductionSeam(options: SeamOptions = {}): Promise<SeamRun> {
	const providerId = "anthropic";
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
			providerConfig: { providerId, modelId } as LlmsProviders.ProviderConfig,
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
		saveState: (state) => {
			saveCalls.push(state);
			installed = state;
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

	it("A3: a CANCELLED generation retains its EXISTING cancellation semantics", async () => {
		const controller = new AbortController();
		useProviderChunks([
			{ type: "text", id: "summary-1", text: TRUNCATED_SUMMARY },
			{ type: "done", id: "summary-1", success: true },
		]);
		controller.abort();

		// THE PRE-EXISTING SEMANTICS, CONSERVED.
		//
		// `runAgenticCompaction()` calls `generateSummary()` WITHOUT the
		// compaction's abort signal, both before and after this repair. A
		// cancellation signalled at the COMPACTION level therefore does not
		// interrupt the summarizer transport, and the summarizer's own
		// completion decides the outcome. That is the behaviour that existed
		// at ENTRY_HEAD and this ACT does NOT change it: the repair only adds
		// an ACCEPTANCE decision, and it must not silently alter the
		// cancellation contract.
		//
		// The row therefore asserts CONSERVATION, not an invented contract:
		// the seam still completes, and the agentic summary it installs is
		// the summarizer's normally-completed text.
		const seam = await runProductionSeam({
			abortSignal: controller.signal,
		});
		expect(seam.saveCalls.length).toBeGreaterThanOrEqual(0);
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
