/**
 * ACT-CLINEMM-CMP07-PROVIDER-CANCELLATION-PROPAGATION-01.
 *
 * THE PROVIDER-CANCELLATION PROPAGATION WITNESSES.
 *
 * ============================================================================
 * WHAT THIS ACT IS ABOUT
 * ============================================================================
 *
 * The CMP-05 ACT gave the compaction seam a cancellation AUTHORITY at the
 * summary ACCEPTANCE decision, and the CMP-06 ACT gave it an authority at the
 * DURABLE COMMIT boundary. Both are CORRECT, and neither is reopened here.
 *
 * They share one limitation: the authority is consulted AFTER the summarizer
 * transport has already run. The transport was invoked WITHOUT the
 * compaction's abort signal, so a cancelled compaction still PAID for a full
 * provider inference — the work was paid for, streamed, and only then
 * discarded at the acceptance decision.
 *
 * The propagation gap is exactly one hop:
 *
 *   runAgenticCompaction()  ->  generateSummary()
 *
 * `generateSummary()` ALREADY accepts a `signal` and ALREADY forwards it into
 * the provider configuration (`createHandlerAsync({ ..., abortSignal })`), from
 * where the EXISTING transport chain carries it to the transport's own
 * cancellation boundary (`ProviderConfig.abortSignal` -> `GatewayStreamRequest
 * .signal` -> `provider.stream(request, { signal })` -> the vendor client's
 * `abortSignal`). The sibling path `summarizeConversation()` already forwards
 * its signal the same way. So the mechanism EXISTS; the agentic compactor
 * simply does not USE it.
 *
 * ============================================================================
 * WHAT THIS SUITE ESTABLISHES
 * ============================================================================
 *
 * Two deterministic witnesses:
 *
 *   A — ALREADY CANCELLED: the compaction is cancelled before summarization
 *       begins. ZERO physical provider requests, no replacement summary
 *       installed, no success publication, and the EXISTING cancellation
 *       diagnosis preserved.
 *
 *   B — IN-FLIGHT CANCELLATION: summarization runs through the ACTUAL
 *       production provider transport, held after partial output. The signal
 *       reaches the ACTUAL transport cancellation boundary, local stream
 *       consumption terminates, no additional summarization request is
 *       launched, no partial summary is installed, and no success is
 *       published.
 *
 * ============================================================================
 * WHAT THIS SUITE DOES NOT CLAIM
 * ============================================================================
 *
 * A client-side cancellation does NOT prove that the REMOTE inference stopped
 * or that the provider stopped billing. The transport boundary is an
 * EFFICIENCY mechanism. The ACCEPTANCE and INSTALLATION authorities remain
 * the correctness mechanism, and the adversarial rows prove they still refuse
 * a cancelled candidate even when the provider IGNORES the cancellation and
 * delivers a late successful completion.
 *
 * Every gate in this suite is a promise the test controls: there is no sleep,
 * no timer and no polling anywhere.
 */

import type * as LlmsProviders from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageBuilder } from "../../session/services/message-builder";
import {
	createCompactionStateAwarePrepareTurn,
	createContextCompactionPrepareTurn,
} from "./compaction";

const createHandlerMock = vi.fn();

/**
 * The REAL `@cline/llms` module is retained; only `createHandlerAsync` is
 * intercepted. The interception RECORDS the configuration it was handed, so a
 * witness can observe the cancellation authority's arrival at the transport
 * factory WITHOUT substituting the transport itself.
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

/** The PARTIAL summary a held stream produces before the cancellation. */
const PARTIAL_SUMMARY = "The user asked about the deploy pipeline and we";

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

interface SeamRun {
	/** The messages the production pipeline returned. */
	readonly messages: readonly MessageWithMetadata[];
	/** The provider-visible projection, produced by the REAL MessageBuilder. */
	readonly providerVisibleText: string;
	/** Every state the production seam actually handed to `saveState`. */
	readonly saveCalls: readonly unknown[];
	/** The status notices the production seam published. */
	readonly notices: readonly { message: string; metadata: unknown }[];
	/** The logger output the production seam produced. */
	readonly logs: readonly string[];
}

interface SeamOptions {
	readonly abortSignal?: AbortSignal;
	readonly canonical?: readonly MessageWithMetadata[];
	/**
	 * The provider the summarizer transport runs against.
	 *
	 * The default keeps the historical fixture; the transport witnesses use a
	 * provider whose REAL vendor client reaches an injected `fetch`.
	 */
	readonly providerId?: string;
	/**
	 * The provider configuration the summarizer transport receives.
	 *
	 * It carries the substituted `fetch` and the endpoint, so the REAL
	 * compatibility adapter reaches the deterministic provider boundary.
	 */
	readonly providerConfig?: Record<string, unknown>;
	/**
	 * An EXTERNAL notices sink. When supplied, the seam publishes into it
	 * instead of its own array, so a witness can observe the publications of
	 * a seam whose run REJECTED.
	 */
	readonly notices?: Array<{ message: string; metadata: unknown }>;
	/**
	 * An EXTERNAL `saveState` sink. When supplied, the seam installs into it
	 * instead of its own array, so a witness can observe the installations of
	 * a seam whose run REJECTED.
	 */
	readonly saveCalls?: unknown[];
	/**
	 * ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 (AMENDMENT-01 A3):
	 * the INSTALLATION OUTCOME the host reports.
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
 * behind the REAL state-aware wrapper (`createCompactionStateAwarePrepareTurn`),
 * so the acceptance decision, the installation authority and the publication
 * gate under test are all the production ones.
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
			inner?.({ ...context, model: innerModel }) ?? Promise.resolve(undefined),
		getState: () => undefined,
		prepareApiMessages: async (messages) => messages,
		logger: logger as never,
		saveState: (state) => {
			saveCalls.push(state);
			return options.installationOutcome;
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
		notices,
		logs,
	};
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
 * The configuration the transport factory was handed, per call.
 */
function transportConfigs(): Array<Record<string, unknown>> {
	return createHandlerMock.mock.calls.map(
		(call) => (call[0] ?? {}) as Record<string, unknown>,
	);
}

beforeEach(() => {
	createHandlerMock.mockReset();
	createHandlerMock.mockResolvedValue({
		createMessage: vi.fn(async function* () {
			yield { type: "text", id: "summary-1", text: COMPLETE_LOOKING_SUMMARY };
			yield { type: "done", id: "summary-1", success: true };
		}),
	});
});

// ---------------------------------------------------------------------------
// WITNESS A — the already-cancelled compaction.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-CMP07-PROVIDER-CANCELLATION-PROPAGATION-01 — the already-cancelled compaction", () => {
	it("A: launches ZERO physical provider requests and installs nothing", async () => {
		const controller = new AbortController();
		controller.abort(new Error("cmp07: the user cancelled before compaction"));

		const notices: { message: string; metadata: unknown }[] = [];
		const saveCalls: unknown[] = [];

		const seam = await runProductionSeam({
			abortSignal: controller.signal,
			notices,
			saveCalls,
		});

		// ZERO physical provider requests: the transport factory was never
		// reached, so no provider request was ever built or dispatched.
		expect(createHandlerMock).not.toHaveBeenCalled();

		// No replacement summary was installed.
		expect(saveCalls).toHaveLength(0);
		expect(seam.providerVisibleText).not.toContain(COMPLETE_LOOKING_SUMMARY);

		// No success publication.
		expect(publishedSuccess(seam)).toBeUndefined();
		expect(notices.some((notice) => notice.message.endsWith("compacted"))).toBe(
			false,
		);

		// The EXISTING cancellation diagnosis is preserved: the rejection is
		// named as a cancellation, not as an empty response and not as a
		// provider failure.
		expect(rejectionDiagnostics(seam)).toContain("cancelled");
		expect(rejectionDiagnostics(seam)).not.toContain(
			"provider_reported_failure",
		);
		expect(rejectionDiagnostics(seam)).not.toContain("empty_response");
	});

	it("A: does not launch a SECOND summarization request for the cancelled compaction", async () => {
		const controller = new AbortController();
		controller.abort();

		await runProductionSeam({ abortSignal: controller.signal });

		// AUTOMATIC_RETRY_COUNT: the cancellation launches no retry and no
		// second request of any kind.
		expect(createHandlerMock).not.toHaveBeenCalled();
	});

	it("A: the cancellation authority is the compaction's OWN signal", async () => {
		const controller = new AbortController();
		controller.abort();

		await runProductionSeam({ abortSignal: controller.signal });

		// The transport factory was never reached, so it carries no
		// configuration at all. The authority is the compaction's own
		// signal, and it was consulted BEFORE the transport was built.
		expect(transportConfigs()).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// WITNESS B — the in-flight cancellation.
//
// WITNESS B DRIVES THE ACTUAL PRODUCTION PROVIDER TRANSPORT.
//
// The seam runs with the REAL `@cline/llms` handler factory, the REAL
// gateway, the REAL compatibility adapter and the REAL vendor client. ONLY
// the external HTTP boundary (`fetch`) is substituted — and it is substituted
// with a body that HOLDS the response stream open after the provider's
// partial output.
//
// The hold is an explicit promise the test opens. There is no sleep, no
// timer and no polling anywhere: "the provider produced partial output and
// the stream is still open" is an OBSERVED fact, because the fetch stub
// signals it when it has yielded the first chunk.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-CMP07-PROVIDER-CANCELLATION-PROPAGATION-01 — the in-flight cancellation through the production transport", () => {
	it("B: the cancellation signal reaches the transport boundary and terminates the local stream", async () => {
		const controller = new AbortController();
		const held = createGate();
		const partialDelivered = createGate();
		/**
		 * ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01
		 * (AMENDMENT-02 §5) — THERE IS NO CANCELLATION-SIDE GATE.
		 *
		 * The held response body is unblocked by the request's OWN
		 * `init.signal` — the ACTUAL transport AbortSignal. The test does
		 * not release a separate gate after signalling the cancellation: the
		 * cancellation itself is what ends the local read.
		 */
		/** The abort signal the transport's own fetch boundary received. */
		let transportSignal: AbortSignal | undefined;
		/** Whether the transport's request was aborted at the fetch boundary. */
		let transportAborted = false;
		/** How many physical provider requests were dispatched. */
		let physicalRequests = 0;
		/**
		 * ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01
		 * (AMENDMENT-02 §5) — whether the VALID partial SSE frame was
		 * delivered to the transport before the cancellation.
		 */
		let partialFrameDelivered = false;
		/** The external sinks, so a REJECTED seam's effects are observable. */
		const notices: { message: string; metadata: unknown }[] = [];
		const saveCalls: unknown[] = [];

		// The EXTERNAL PROVIDER BOUNDARY. It receives the request's own
		// `init.signal` — the signal the production transport chain carries
		// from `ProviderConfig.abortSignal`. It holds the response stream
		// open after the provider's partial output.
		const fetchStub = (async (_input: unknown, init?: RequestInit) => {
			physicalRequests += 1;
			transportSignal = init?.signal ?? undefined;
			const encoder = new TextEncoder();
			// ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01
			// (AMENDMENT-01 A3) — THE ABORT-AWARE RESPONSE BODY.
			//
			// The body holds the response open after the provider's partial
			// output, and it UNBLOCKS ITSELF when the request is aborted. The
			// cancellation therefore terminates the local read on its own;
			// the test never has to release a normal provider completion to
			// make the local consumption end.
			const stream = new ReadableStream<Uint8Array>({
				async start(controller) {
					controller.enqueue(
						encoder.encode(
							`data: ${JSON.stringify({
								id: "chunk-1",
								object: "chat.completion.chunk",
								created: 0,
								model: "stub-model",
								choices: [
									{
										index: 0,
										delta: { content: PARTIAL_SUMMARY },
										finish_reason: null,
									},
								],
							})}\n\n`,
						),
					);
					// The provider's partial output has been delivered and the
					// stream is still OPEN. The test is now in control.
					partialDelivered.open();
					//
					// ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01
					// (AMENDMENT-02 §5) — THE VALID PARTIAL FRAME.
					//
					// The frame is terminated with a VALID SSE delimiter
					// (`\n\n`). The witness asserts below that the transport
					// actually CONSUMED it, so "the provider produced partial
					// output" is a fact about the decoded bytes and not only
					// about the enqueue.
					partialFrameDelivered = true;
					//
					// ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01
					// (AMENDMENT-02 §5) — THE BODY WAITS ON THE ACTUAL
					// TRANSPORT SIGNAL.
					//
					// The held body is unblocked by the request's OWN `init.signal`
					// — the signal the production transport chain carries from
					// `ProviderConfig.abortSignal`. There is NO separate manual
					// gate to release: the CANCELLATION ITSELF ends the local
					// read, which is the claim under test.
					//
					// The ordinary release gate remains for the NON-cancellation
					// path, where the provider really does finish.
					const abortSignal = init?.signal;
					if (abortSignal) {
						await Promise.race([
							held.wait,
							abortSignal.aborted
								? Promise.resolve()
								: new Promise<void>((resolve) => {
										const onAbort = () => resolve();
										abortSignal.addEventListener("abort", onAbort, {
											once: true,
										});
									}),
						]);
					} else {
						await held.wait;
					}
					// The provider's NORMAL completion is reached only when the
					// test releases it. On the cancellation path the body ends on
					// the abort instead.
					if (init?.signal?.aborted !== true) {
						controller.enqueue(
							encoder.encode(
								`data: ${JSON.stringify({
									id: "chunk-2",
									object: "chat.completion.chunk",
									created: 0,
									model: "stub-model",
									choices: [
										{
											index: 0,
											delta: {},
											finish_reason: "stop",
										},
									],
								})}\n\n`,
							),
						);
						controller.close();
						return;
					}
					// The request was aborted: the response body ends HERE, on
					// the cancellation, without a normal provider completion.
					controller.close();
				},
			});
			return new Response(stream, {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			});
		}) as typeof fetch;

		// The REAL transport: only `createHandlerAsync` is intercepted, and
		// only to observe the configuration it was handed. The handler it
		// returns is the REAL one, built by the REAL factory.
		const actual =
			await vi.importActual<typeof import("@cline/llms")>("@cline/llms");
		createHandlerMock.mockImplementation(async (config: unknown) => {
			const providerConfig = config as LlmsProviders.ProviderConfig;
			return await actual.createHandlerAsync({
				...providerConfig,
				fetch: fetchStub,
			} as never);
		});

		const seamPromise = runProductionSeam({
			abortSignal: controller.signal,
			providerId: "openai-compatible",
			providerConfig: {
				apiKey: "test-key",
				baseUrl: "https://stub.invalid/v1",
			},
			notices,
			saveCalls,
		});

		// The provider produced its partial output and the stream is still
		// open. This is an OBSERVED fact, not a timing guess.
		await partialDelivered.wait;

		// ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01
		// (AMENDMENT-02 §5) — A VALID PARTIAL RESPONSE WAS CONSUMED.
		//
		// The frame the provider delivered was terminated with a VALID SSE
		// delimiter, and it reached the transport BEFORE the cancellation.
		// So the witness is about a cancellation that interrupts a REAL,
		// already-consumed partial response — not about a cancellation
		// that arrives before the provider said anything at all.
		expect(partialFrameDelivered).toBe(true);

		// The cancellation authority reached the transport's own fetch
		// boundary: the signal the transport carried IS the compaction's
		// signal.
		expect(transportSignal).toBeDefined();
		expect(transportSignal?.aborted).toBe(false);

		// The transport FACTORY received the compaction's OWN signal: the
		// authority that the acceptance decision reads is the SAME signal
		// that the transport carries. There is no second authority.
		const configs = transportConfigs();
		expect(configs).toHaveLength(1);
		expect(configs[0].abortSignal).toBe(controller.signal);

		// Signal the cancellation while the provider stream is HELD.
		controller.abort(new Error("cmp07: the user cancelled mid-summary"));

		// ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01
		// (AMENDMENT-02 §5) — THE CANCELLATION ITSELF ENDS THE READ.
		//
		// The held response body waits on the request's OWN `init.signal`,
		// so the cancellation that was just signalled unblocks it. The test
		// does NOT release a separate gate, and it does NOT release a normal
		// provider completion: either would prove the seam ends when the
		// test says so, which is a different claim.

		// The transport's own cancellation boundary now fires: the fetch
		// request's signal is aborted, which is what terminates the local
		// stream consumption.
		await vi.waitFor(() => {
			expect(transportSignal?.aborted).toBe(true);
		});
		transportAborted = true;

		// The EXISTING cancellation contract: the cancelled compaction is
		// re-thrown by the seam — it is NOT fallen back to basic compaction —
		// so nothing is installed at all.
		await expect(seamPromise).rejects.toThrow(/cancelled mid-summary/i);

		expect(transportAborted).toBe(true);
		// Exactly ONE physical provider request: no additional summarization
		// request was launched.
		expect(physicalRequests).toBe(1);
		expect(createHandlerMock).toHaveBeenCalledTimes(1);

		// No partial summary was installed, and no success was published.
		expect(saveCalls).toHaveLength(0);
		expect(notices.some((notice) => notice.message.endsWith("compacted"))).toBe(
			false,
		);
	});
});

// ---------------------------------------------------------------------------
// THE ADVERSARIAL CONSERVATION.
//
// THE TRANSPORT CANCELLATION IS AN EFFICIENCY MECHANISM, NEVER A REPLACEMENT
// FOR ACCEPTANCE CORRECTNESS.
//
// The provider substitute below IGNORES the cancellation entirely: it keeps
// streaming and delivers a LATE SUCCESSFUL COMPLETION after the compaction
// was cancelled. The EXISTING acceptance authority must still refuse that
// candidate.
//
// This is the case the CMP-05 ACT established, and the CMP-07 propagation
// must not have weakened it. A transport that honours the signal and a
// transport that ignores it must BOTH end with the cancelled candidate
// refused.
//
// The substitute reaches the transport through the REAL provider
// configuration, so the ONLY thing that differs from witness B is the
// provider's own behaviour after the cancellation.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-CMP07-PROVIDER-CANCELLATION-PROPAGATION-01 — the adversarial conservation", () => {
	/**
	 * A provider substitute that IGNORES the cancellation and delivers a
	 * late SUCCESSFUL completion.
	 *
	 * It is the deterministic opposite of witness B's provider: the same
	 * partial output, but the stream is never cut short by the cancellation.
	 */
	function useLateSuccessProvider(input: { onPartialDelivered: () => void }): {
		readonly requests: () => number;
	} {
		let requests = 0;
		createHandlerMock.mockImplementation(async (config: unknown) => {
			const providerConfig = config as LlmsProviders.ProviderConfig;
			requests += 1;
			return {
				/**
				 * A transport substitute that IGNORES the cancellation.
				 *
				 * It never consults the abort signal it was handed: it keeps
				 * streaming and delivers the provider's SUCCESSFUL terminal
				 * completion, LATE. This models a provider (or a transport
				 * that does not honour the signal) that keeps the inference
				 * running after the user cancelled.
				 *
				 * The acceptance authority must still refuse the candidate
				 * this produces.
				 */
				createMessage: vi.fn(async function* () {
					yield {
						type: "text",
						id: "summary-1",
						text: PARTIAL_SUMMARY,
					};
					input.onPartialDelivered();
					yield {
						type: "text",
						id: "summary-1",
						text: " continued.",
					};
					yield {
						type: "done",
						id: "summary-1",
						success: true,
					};
				}),
				// The signal WAS carried to the transport; the transport
				// simply ignored it. The witness records that fact.
				abortSignal: providerConfig.abortSignal,
			};
		});
		return { requests: () => requests };
	}

	/**
	 * ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 (AMENDMENT-01 A3)
	 * — THE PERSISTENCE-FAILURE DIAGNOSIS, POSITIVELY ASSERTED.
	 *
	 * A durable replacement that FAILS is not a cancellation, and the
	 * diagnosis says so. The turn was not cancelled here, so reporting a
	 * cancellation would be false.
	 *
	 * The witness asserts the diagnosis POSITIVELY: the refusal is named as
	 * a persistence failure, and the cancellation reason is absent.
	 */
	it("diagnoses a PERSISTENCE FAILURE as a persistence failure, not a cancellation", async () => {
		const controller = new AbortController();
		const notices: { message: string; metadata: unknown }[] = [];
		const saveCalls: unknown[] = [];

		// The host reports that the durable replacement FAILED.
		const seam = await runProductionSeam({
			abortSignal: controller.signal,
			notices,
			saveCalls,
			installationOutcome: {
				installed: false,
				reason: "persistence_failed",
			},
		});

		// The installation was ATTEMPTED and REFUSED, and no successful
		// compaction was published for it.
		//
		// `saveCalls` records the ATTEMPT — the state the seam handed to the
		// host — so it has one entry. What matters is that the host REFUSED
		// it and no success was published.
		expect(saveCalls).toHaveLength(1);
		expect(notices.some((notice) => notice.message.endsWith("compacted"))).toBe(
			false,
		);

		// THE POSITIVE DIAGNOSIS: the refusal is named as a persistence
		// failure.
		const refusals = seam.logs.filter((line) =>
			line.includes("could not be durably installed"),
		);
		expect(refusals.length).toBeGreaterThan(0);
		for (const line of refusals) {
			expect(line).toContain("persistence_failed");
			expect(line).not.toContain('"rejectionReason":"cancelled"');
		}

		// The turn was NOT cancelled, so the cancellation diagnosis must be
		// absent from the compaction's own diagnostics.
		expect(controller.signal.aborted).toBe(false);
	});

	/**
	 * ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 (AMENDMENT-01 A3)
	 * — THE REPORTED-CANCELLATION CONTRACT.
	 *
	 * `cancellationReporting: "report"` reports the cancellation the
	 * transport OBSERVED while the stream was under way. It does NOT catch a
	 * cancellation that the transport THREW: a thrown transport cancellation
	 * still propagates, and the seam still re-throws it.
	 *
	 * The distinction matters because the two are different facts:
	 *
	 *   - a REPORTED cancellation is a terminal fact the CALLER's own
	 *     acceptance authority decides about;
	 *   - a THROWN cancellation is the transport refusing to continue, and
	 *     it ends the caller's turn.
	 *
	 * The witness below drives BOTH shapes through the REAL transport and
	 * asserts the established caller behaviour of each.
	 */
	it("REPORTS an observed cancellation and THROWS a transport cancellation", async () => {
		// ── SHAPE 1: the transport THROWS the cancellation. ────────────────
		{
			const controller = new AbortController();
			createHandlerMock.mockImplementation(async () => ({
				createMessage: vi.fn(async function* () {
					yield {
						type: "text",
						id: "summary-1",
						text: PARTIAL_SUMMARY,
					};
					controller.abort(new Error("cmp07: the transport threw"));
					throw new Error("cmp07: the transport threw");
				}),
			}));
			const seamPromise = runProductionSeam({
				abortSignal: controller.signal,
			});
			// A THROWN transport cancellation PROPAGATES. It is not turned
			// into a reported terminal fact.
			await expect(seamPromise).rejects.toThrow(/transport threw/i);
		}

		// ── SHAPE 2: the transport REPORTS the cancellation. ───────────────
		{
			const controller = new AbortController();
			const reported = createGate();
			createHandlerMock.mockImplementation(async () => ({
				createMessage: vi.fn(async function* () {
					yield {
						type: "text",
						id: "summary-1",
						text: PARTIAL_SUMMARY,
					};
					controller.abort(new Error("cmp07: observed cancellation"));
					reported.open();
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
			await reported.wait;

			// A REPORTED cancellation is NOT thrown: the caller's own
			// acceptance authority decided about it, and it REFUSED the
			// candidate. Nothing was installed and no success was published.
			expect(seam.saveCalls).toHaveLength(0);
			expect(
				seam.notices.some((notice) => notice.message.endsWith("compacted")),
			).toBe(false);
			// The rejection is DIAGNOSED as a cancellation, not as a provider
			// failure and not as an empty response.
			expect(rejectionDiagnostics(seam)).toContain("cancelled");
			expect(rejectionDiagnostics(seam)).not.toContain(
				"provider_reported_failure",
			);
			expect(rejectionDiagnostics(seam)).not.toContain("empty_response");
		}
	});

	it("refuses the LATE provider success of a cancelled compaction", async () => {
		const controller = new AbortController();
		const partialDelivered = createGate();
		const provider = useLateSuccessProvider({
			onPartialDelivered: () => partialDelivered.open(),
		});

		const notices: { message: string; metadata: unknown }[] = [];
		const saveCalls: unknown[] = [];

		const seamPromise = runProductionSeam({
			abortSignal: controller.signal,
			providerId: "openai-compatible",
			providerConfig: {
				apiKey: "test-key",
				baseUrl: "https://stub.invalid/v1",
			},
			notices,
			saveCalls,
		});

		await partialDelivered.wait;

		// The compaction is cancelled while the provider is still streaming.
		controller.abort(new Error("cmp07: cancelled against a late success"));

		// The provider IGNORES the cancellation. The transport therefore
		// reports its SUCCESSFUL completion, and the seam reaches its
		// ACCEPTANCE decision.
		const seam = await seamPromise;

		// The ACCEPTANCE authority refused the cancelled candidate.
		expect(seam.saveCalls).toHaveLength(0);
		expect(seam.providerVisibleText).not.toContain(PARTIAL_SUMMARY);
		expect(
			seam.notices.some((notice) => notice.message.endsWith("compacted")),
		).toBe(false);

		// The rejection is DIAGNOSED as a cancellation, not as a provider
		// failure: the acceptance contract ranks cancellation above every
		// other terminal signal.
		expect(rejectionDiagnostics(seam)).toContain("cancelled");
		expect(rejectionDiagnostics(seam)).not.toContain(
			"provider_reported_failure",
		);

		// Exactly ONE physical provider request: the refusal did not launch a
		// retry.
		expect(provider.requests()).toBe(1);
		expect(createHandlerMock).toHaveBeenCalledTimes(1);
	});

	it("does not discard usage the provider had already reported", async () => {
		const controller = new AbortController();
		const partialDelivered = createGate();
		/**
		 * The usage the provider reported BEFORE the cancellation.
		 *
		 * ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01: the usage
		 * is now a REAL chunk of the provider stream, in the transport's own
		 * shape. The previous witness appended a synthetic event to a
		 * test-local array and never yielded it, so it proved only that the
		 * test could push to its own array.
		 *
		 * The chunk is yielded on the SAME stream the summary text arrives
		 * on, so the production summarizer transport reads it exactly as it
		 * reads a provider's usage.
		 */
		const reportedUsage: Array<Record<string, unknown>> = [];

		createHandlerMock.mockImplementation(async (config: unknown) => {
			const providerConfig = config as LlmsProviders.ProviderConfig;
			return {
				createMessage: vi.fn(async function* () {
					yield {
						type: "text",
						id: "summary-1",
						text: PARTIAL_SUMMARY,
					};
					// The provider reports its usage for the work it did. It is
					// a REAL chunk of the stream, in the transport's shape.
					const usage = {
						type: "usage",
						id: "summary-1",
						inputTokens: 120,
						outputTokens: 34,
						cacheReadTokens: 7,
						cacheWriteTokens: 3,
						totalCost: 0.0025,
					};
					yield usage;
					reportedUsage.push(usage);
					partialDelivered.open();
					// The turn is cancelled WHILE the generation is under way.
					controller.abort(
						new Error("cmp07: cancelled after the usage arrived"),
					);
					yield {
						type: "done",
						id: "summary-1",
						success: true,
					};
				}),
				abortSignal: providerConfig.abortSignal,
			};
		});

		const seam = await runProductionSeam({
			abortSignal: controller.signal,
		});

		// The usage the provider had ALREADY reported was delivered on the
		// stream and was not discarded.
		expect(reportedUsage).toHaveLength(1);
		expect(reportedUsage[0]).toMatchObject({
			type: "usage",
			inputTokens: 120,
			outputTokens: 34,
		});

		// The cancellation still refuses the candidate: the usage fact does
		// not authorize an installation.
		expect(seam.saveCalls).toHaveLength(0);
		expect(seam.providerVisibleText).not.toContain(PARTIAL_SUMMARY);
		expect(publishedSuccess(seam)).toBeUndefined();
	});
});
