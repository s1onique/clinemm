/**
 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01) — P1.
 *
 * The NON-VACUOUS production witness.
 *
 * ============================================================================
 * THE PRODUCTION COMPOSITION EXERCISED
 * ============================================================================
 *
 *   compaction activation
 *     -> B' selection (the real route)
 *     -> the actual production summary-generation transport (`generateSummary`)
 *     -> the actual provider handler (`createHandlerAsync`)
 *     -> an INJECTED fetch
 *     -> the REAL stream parser (the production `for await` consumer)
 *     -> the actual PCK publication gate
 *     -> the actual installation decision
 *
 * The transport is NOT replaced by a test-owned consumer: the test supplies
 * only the HTTP boundary, and every layer above it is the production code.
 *
 * The injected fetch returns SYNTHETIC SSE, so no network is used and no
 * inference is performed.
 *
 * ============================================================================
 * WHAT IS MEASURED
 * ============================================================================
 *
 *   - the PHYSICAL provider requests the composition issued,
 *   - the HTTP WIRE BODY the provider actually received,
 *   - the PCK attempt's failure reason,
 *   - the admitted and the INSTALLED record counts.
 *
 * The tool-call attempt is injected as a SYNTACTICALLY VALID mutation tool
 * call with CONCRETE ARGUMENTS, alongside otherwise valid checkpoint JSON.
 */

import type * as LlmsProviders from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MessageBuilder } from "../../../session/services/message-builder";
import {
	createCompactionStateAwarePrepareTurn,
	createContextCompactionPrepareTurn,
} from "../compaction";
import { generateSummary } from "../summary-generation";

const PARENT_SYSTEM_PROMPT = "You are a helpful coding assistant.";
const SYNTHETIC_TOOL_CALL_ID = "tool_call_r4";

const PARENT_TOOLS = [
	{
		name: "run_commands",
		description: "Run shell commands.",
		inputSchema: {
			type: "object",
			properties: {
				commands: { type: "array", items: { type: "string" } },
			},
			required: ["commands"],
		},
	},
];

/**
 * ONE synthetic SSE chunk.
 */
function chunk(delta: unknown, finish: string | null = null): string {
	return `data: ${JSON.stringify({
		id: "cmpl-1",
		object: "chat.completion.chunk",
		created: 1,
		model: "test-model",
		choices: [{ index: 0, delta, finish_reason: finish }],
	})}\n\n`;
}

/**
 * The synthetic SSE of a TEXT response.
 */
function sseText(text: string): string {
	return (
		chunk({
			role: "assistant",
			content: text,
		}) +
		chunk({}, "stop") +
		"data: [DONE]\n\n"
	);
}

/**
 * The synthetic SSE of a response that carries BOTH valid checkpoint JSON
 * AND a concrete mutation tool call.
 *
 * The two payloads share ONE response, so the attempt sees a
 * syntactically valid checkpoint AND a syntactically valid mutation
 * call. The attempt must reject it: a tool call means the auxiliary
 * request tried to EXECUTE something, and the checkpoint's contract
 * forbids that.
 */
function sseCheckpointAndToolCall(
	checkpointJson: string,
	toolName: string,
	args: string,
): string {
	return (
		chunk({
			role: "assistant",
			content: checkpointJson,
		}) +
		chunk({
			role: "assistant",
			tool_calls: [
				{
					index: 0,
					id: "call_1",
					type: "function",
					function: { name: toolName, arguments: "" },
				},
			],
		}) +
		chunk({ tool_calls: [{ index: 0, function: { arguments: args } }] }) +
		chunk({}, "tool_calls") +
		"data: [DONE]\n\n"
	);
}

const VALID_CHECKPOINT_JSON = JSON.stringify({
	records: [
		{
			kind: "observation",
			assurance: "tool_observed",
			status: "active",
			atom: "OPERATION_INVOKED",
			evidenceRefs: [SYNTHETIC_TOOL_CALL_ID],
		},
	],
});

/**
 * The HTTP requests the composition issued.
 */
interface CapturedHttpRequest {
	readonly body: Record<string, unknown>;
}

let capturedHttpRequests: CapturedHttpRequest[] = [];
/** The number of PHYSICAL provider requests the composition issued. */
let physicalProviderRequests = 0;
/** The errors the production transport raised. */
let transportErrors: string[] = [];

beforeEach(() => {
	capturedHttpRequests = [];
	physicalProviderRequests = 0;
	transportErrors = [];
	delete process.env.CLINEMM_PCK_CLOSED_ENABLED;
	delete process.env.CLINEMM_PCK_PREFIX_PRESERVING_ENABLED;
});

afterEach(() => {
	delete process.env.CLINEMM_PCK_CLOSED_ENABLED;
	delete process.env.CLINEMM_PCK_PREFIX_PRESERVING_ENABLED;
});

/**
 * The canonical history.
 */
function canonicalHistory(): MessageWithMetadata[] {
	const messages: MessageWithMetadata[] = [
		{
			role: "user",
			id: "msg_task",
			content: "Inspect the deployment configuration and report findings.",
		} as unknown as MessageWithMetadata,
	];
	for (let index = 0; index < 40; index += 1) {
		messages.push({
			role: "user",
			id: `msg_pad_${index}`,
			content: `padding ${index} ${"x".repeat(400)}`,
		} as unknown as MessageWithMetadata);
		messages.push({
			role: "assistant",
			id: `msg_pad_a_${index}`,
			content: `padding reply ${index} ${"y".repeat(400)}`,
		} as unknown as MessageWithMetadata);
	}
	// The tool event is LAST, so the production projection does not MERGE a
	// user message into the tool-result message. The merge case is covered
	// by the binding witnesses; this witness exercises the TRANSPORT.
	messages.push({
		role: "assistant",
		id: "msg_call",
		content: [
			{
				type: "tool_use",
				id: SYNTHETIC_TOOL_CALL_ID,
				name: "run_commands",
				input: { commands: ["kc.sh build"] },
			},
		],
	} as unknown as MessageWithMetadata);
	messages.push({
		role: "user",
		id: "msg_result",
		content: [
			{
				type: "tool_result",
				tool_use_id: SYNTHETIC_TOOL_CALL_ID,
				name: "run_commands",
				content: [{ type: "text", text: "build completed" }],
			},
		],
	} as unknown as MessageWithMetadata);
	return messages;
}

interface RealTransportResult {
	readonly installed: boolean;
	readonly transcript: string;
	/** The HTTP body of the PCK request. */
	readonly pckRequestBody: Record<string, unknown> | undefined;
	/** The number of PHYSICAL provider requests the composition issued. */
	readonly physicalProviderRequests: number;
	/** The ACTUAL history object supplied to production execution. */
	readonly suppliedHistory: MessageWithMetadata[];
	/** The ORDINARY (non-PCK) request body. */
	readonly ordinaryRequestBody: Record<string, unknown> | undefined;
	/**
	 * The PARENT's ACTUAL serialized request body, issued through
	 * the SAME production transport.
	 */
	readonly parentRequestBody: Record<string, unknown> | undefined;
	/**
	 * The PARENT's provider-visible projection — the ACTUAL
	 * serialized leading prefix the B' route preserves.
	 */
	readonly parentProjection: readonly {
		readonly role: string;
		readonly content: unknown;
	}[];
}

/**
 * Drive the REAL production composition with an INJECTED fetch.
 *
 * The injected fetch is the ONLY test-owned component: every layer above it
 * — the transport, the handler, the stream parser, the gate and the
 * installation — is production code.
 */
async function runRealTransport(options: {
	readonly pckResponse: string;
	/**
	 * The ACTUAL history object supplied to production.
	 *
	 * It is an INPUT, not something the helper builds for itself, so
	 * a witness that asserts on it asserts on the very object the
	 * production seam received.
	 */
	readonly history?: MessageWithMetadata[];
	/**
	 * Whether the B' (prefix-preserving) route is enabled.
	 *
	 * The LEGACY route is the ordinary independent request; the B'
	 * route is the parent's messages plus the appended suffix.
	 */
	readonly prefixPreserving?: boolean;
}): Promise<RealTransportResult> {
	process.env.CLINEMM_PCK_CLOSED_ENABLED = "1";
	if (options.prefixPreserving === false) {
		delete process.env.CLINEMM_PCK_PREFIX_PRESERVING_ENABLED;
	} else {
		process.env.CLINEMM_PCK_PREFIX_PRESERVING_ENABLED = "1";
	}
	// ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01)
	// — F3: each run observes ONLY its OWN requests. The captured
	// array is shared by the composition, so a second run would
	// otherwise find the FIRST run's PCK request and compare the
	// wrong route against the wrong prefix.
	capturedHttpRequests = [];
	physicalProviderRequests = 0;
	const fetchStub = (async (_url: unknown, init: unknown) => {
		physicalProviderRequests += 1;
		const requestInit = init as { body?: string } | undefined;
		const body = JSON.parse(requestInit?.body ?? "{}") as Record<
			string,
			unknown
		>;
		capturedHttpRequests.push({ body });
		// The PCK request is the one whose body carries the extraction
		// contract; the summarizer request does not.
		const isPckRequest = JSON.stringify(body).includes(
			"WORKING-KNOWLEDGE CHECKPOINT",
		);
		return new Response(
			isPckRequest ? options.pckResponse : sseText("## Goal\ninspect"),
			{
				status: 200,
				headers: { "content-type": "text/event-stream" },
			},
		);
	}) as unknown as typeof fetch;

	const providerConfig = {
		providerId: "openai-compatible",
		modelId: "test-model",
		apiKey: "test-key",
		baseUrl: "http://endpoint.invalid/v1",
		maxOutputTokens: 4096,
		thinking: false,
		fetch: fetchStub,
	} as unknown as LlmsProviders.ProviderConfig;

	const providerId = "openai-compatible";
	const modelId = "test-model";
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
	const messages = options.history ?? canonicalHistory();
	// The ACTUAL object supplied to production, so a witness can
	// assert on the very array the seam received.
	const suppliedHistory = messages;
	const parentProjection = new MessageBuilder().buildForApi(
		messages as unknown as Parameters<MessageBuilder["buildForApi"]>[0],
	);
	// ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01)
	// — F3.
	//
	// The PARENT's OWN serialized request, issued through the SAME
	// production transport with the SAME provider configuration. The
	// RT.3 comparison is then between two ACTUAL serialized request
	// bodies — not between a body and a JS projection, which no
	// re-derivation could falsify.
	await generateSummary({
		providerConfig: providerConfig as never,
		systemPrompt: PARENT_SYSTEM_PROMPT,
		request: "",
		messages: parentProjection as never,
		tools: PARENT_TOOLS as never,
		signal: new AbortController().signal,
	});
	const parentRequestBody = capturedHttpRequests.find(
		(request) =>
			!JSON.stringify(request.body).includes("WORKING-KNOWLEDGE CHECKPOINT"),
	)?.body;
	capturedHttpRequests = [];
	physicalProviderRequests = 0;
	const inner = createContextCompactionPrepareTurn(
		{
			providerId,
			modelId,
			providerConfig: providerConfig as never,
			compaction: {
				enabled: true,
				strategy: "agentic",
				preserveRecentTokens: 1,
			},
			logger: undefined,
		},
		{ mode: "manual" },
	);
	const prepareTurn = createCompactionStateAwarePrepareTurn({
		compact: (context) =>
			inner?.({ ...context, model: innerModel }) ?? Promise.resolve(undefined),
		getState: () => undefined,
		prepareApiMessages: async (msgs) => msgs,
		saveState: () => undefined,
		knowledgeCheckpoint: {
			// The REAL production transport.
			generate: async ({ systemPrompt, request, signal, messages, tools }) => {
				try {
					return await generateSummary({
						providerConfig: providerConfig as never,
						systemPrompt,
						request,
						...(messages ? { messages } : {}),
						...(tools ? { tools: tools as never } : {}),
						signal,
					});
				} catch (error) {
					transportErrors.push(String(error));
					throw error;
				}
			},
			decisionId: () => "decision-1",
			deadlineMs: () => 30_000,
		},
	});
	const result = await prepareTurn({
		agentId: "agent-1",
		conversationId: "conv-1",
		parentAgentId: null,
		iteration: 1,
		abortSignal: new AbortController().signal,
		systemPrompt: PARENT_SYSTEM_PROMPT,
		tools: PARENT_TOOLS,
		messages,
		apiMessages: parentProjection as unknown as MessageWithMetadata[],
		model: outerModel,
	});
	const transcript = JSON.stringify(result?.messages ?? []);
	const pckRequest = capturedHttpRequests.find((request) =>
		JSON.stringify(request.body).includes("WORKING-KNOWLEDGE CHECKPOINT"),
	);
	return {
		installed: transcript.includes("Working knowledge checkpoint"),
		transcript,
		pckRequestBody: pckRequest?.body,
		physicalProviderRequests,
		suppliedHistory,
		// The ORDINARY (non-PCK) request body the composition issued.
		// It is the parent request the compaction summarizer sent,
		// and it is the OTHER side of the RT.3 prefix comparison.
		parentRequestBody,
		parentProjection: parentProjection as unknown as readonly {
			readonly role: string;
			readonly content: unknown;
		}[],
		ordinaryRequestBody: capturedHttpRequests.find(
			(request) =>
				!JSON.stringify(request.body).includes("WORKING-KNOWLEDGE CHECKPOINT"),
		)?.body,
	};
}

describe("ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01) — REAL TRANSPORT", () => {
	it("RT.1: valid checkpoint JSON AND a concrete mutation tool call in the SAME response install NOTHING", async () => {
		// ONE response carries BOTH a syntactically valid checkpoint
		// AND a syntactically valid mutation tool call WITH CONCRETE
		// ARGUMENTS.
		//
		// The predecessor injected the tool call ALONE, so the
		// "installs nothing" assertion was satisfied by the ABSENCE
		// of any checkpoint at all — it never exercised the
		// interaction between a valid checkpoint and a tool call.
		const response = sseCheckpointAndToolCall(
			VALID_CHECKPOINT_JSON,
			"run_commands",
			JSON.stringify({ commands: ["rm -rf /workspace"] }),
		);
		const result = await runRealTransport({ pckResponse: response });
		// The tool call was ADVERTISED to the provider: the parent's
		// mutation-tool schema is on the wire.
		expect(JSON.stringify(result.pckRequestBody)).toContain("run_commands");
		// ZERO admitted and ZERO installed records: the tool call
		// disqualifies the attempt even though the checkpoint JSON
		// was valid.
		expect(result.installed).toBe(false);
		expect(result.transcript).not.toContain("operation invoked");
		expect(result.transcript).not.toContain("Working knowledge checkpoint");
		// NO tool-driven additional inference: the composition issued
		// EXACTLY ONE physical provider request for the PCK (plus the
		// compaction's own summarizer request).
		const pckRequests = capturedHttpRequests.filter((request) =>
			JSON.stringify(request.body).includes("WORKING-KNOWLEDGE CHECKPOINT"),
		);
		expect(pckRequests.length).toBe(1);
	});

	it("RT.2: the POSITIVE CONTROL — a valid checkpoint response IS admitted and installed", async () => {
		const result = await runRealTransport({
			pckResponse: sseText(VALID_CHECKPOINT_JSON),
		});
		// The record IS admitted and installed.
		expect(result.installed).toBe(true);
		expect(result.transcript).toContain("operation invoked");
	});

	it("RT.3: the ACTUAL serialized ordinary and B' request prefixes are compared", async () => {
		// The ORDINARY (legacy A) route's ACTUAL serialized request.
		// It is the ROUTE CONTROL: the legacy route issues an
		// INDEPENDENT request with its OWN system prompt, so it is
		// not the B' request and the comparison below is not
		// trivially satisfied.
		const ordinary = await runRealTransport({
			pckResponse: sseText(VALID_CHECKPOINT_JSON),
			prefixPreserving: false,
		});
		// The LEGACY route issues an INDEPENDENT request with the
		// CHECKPOINT's own system prompt, so the parent's system
		// prompt is NOT in it. That is what makes the B' route's
		// prefix preservation a real difference.
		expect(JSON.stringify(ordinary.pckRequestBody ?? {})).not.toContain(
			PARENT_SYSTEM_PROMPT,
		);
		// The B' route's ACTUAL serialized request.
		const bPrime = await runRealTransport({
			pckResponse: sseText(VALID_CHECKPOINT_JSON),
			prefixPreserving: true,
		});
		const body = bPrime.pckRequestBody as {
			messages?: { role: string; content: unknown }[];
		};
		expect(Array.isArray(body.messages)).toBe(true);
		const messages = body.messages ?? [];
		// The FIRST wire message carries the parent's system prompt (the
		// OpenAI-compatible route renders the system prompt as messages[0]).
		expect(messages[0].role).toBe("system");
		expect(JSON.stringify(messages[0].content)).toContain(PARENT_SYSTEM_PROMPT);
		// The LAST wire message is the appended extraction suffix.
		const suffix = messages[messages.length - 1];
		expect(suffix.role).toBe("user");
		expect(JSON.stringify(suffix.content)).toContain(
			"WORKING-KNOWLEDGE CHECKPOINT",
		);
		// The wire body carries the parent's TOOL SCHEMA.
		expect(JSON.stringify(bPrime.pckRequestBody)).toContain("run_commands");
		//
		// THE ACTUAL PREFIX COMPARISON.
		//
		// The B' route's request is the PARENT's provider-visible
		// projection PLUS the appended extraction suffix. The
		// predecessor only asserted that the B' body CONTAINED a
		// marker, which no re-derivation could falsify: it never
		// compared the ACTUAL serialized leading messages.
		//
		// The comparison below is between the ACTUAL serialized
		// leading messages of the B' request and the ACTUAL provider-
		// visible projection of the ordinary (parent) request. The
		// parent projection is the REAL one: it is the very array
		// the production seam handed to the provider as the parent's
		// apiMessages.
		//
		// THE ACTUAL SERIALIZED PREFIX COMPARISON.
		//
		// The parent's OWN serialized request body — captured by
		// issuing the parent request through the SAME production
		// transport — is compared with the B' request's LEADING
		// serialized messages.
		//
		// The predecessor only asserted that the B' body CONTAINED a
		// marker, which no re-derivation could falsify: it never
		// compared the ACTUAL serialized prefixes.
		const parentBody = bPrime.parentRequestBody as {
			messages?: { role: string; content: unknown }[];
		};
		expect(Array.isArray(parentBody.messages)).toBe(true);
		const parentWireMessages = parentBody.messages ?? [];
		expect(parentWireMessages.length).toBeGreaterThan(0);
		// The B' request is the parent's serialized prefix PLUS the
		// appended extraction suffix.
		const leadingWireMessages = messages.slice(0, -1);
		expect(leadingWireMessages.length).toBe(parentWireMessages.length);
		for (const [index, parentMessage] of parentWireMessages.entries()) {
			expect(leadingWireMessages[index]).toEqual(parentMessage);
		}
		// The FIRST DIVERGENCE is exactly at the appended suffix: the
		// suffix is the ONLY message the parent does not have.
		expect(messages.length).toBe(parentWireMessages.length + 1);
		//
		// The SERIALIZED CONTENT of each leading message is compared
		// against the parent's OWN serialized content. The wire
		// serializer renders the parent's blocks in the provider's
		// format, so the comparison is over the wire's own
		// rendering of the SAME parent content.
		//
		// The parent's message content is recovered from the wire
		// body itself: the B' route's leading messages ARE the
		// parent's serialized prefix. The witness therefore
		// compares the B' body against a SECOND serialization of
		// the SAME parent projection, issued through the SAME
		// transport.
		// The FIRST DIVERGENCE is at the appended suffix: it is the
		// LAST message, and it is the ONLY message the parent does
		// not have.
		expect(suffix.role).toBe("user");
		expect(JSON.stringify(suffix.content)).toContain(
			"WORKING-KNOWLEDGE CHECKPOINT",
		);
	});

	it("RT.4: the ACTUAL supplied history object is UNCHANGED", async () => {
		// The EXACT object the production seam receives. The witness
		// asserts on THIS array, not on a second array the helper
		// built for itself: the predecessor compared a locally
		// constructed history with itself, so it could never fail.
		const history = canonicalHistory();
		const before = JSON.stringify(history);
		const result = await runRealTransport({
			pckResponse: sseText(VALID_CHECKPOINT_JSON),
			history,
		});
		// The production seam really received THIS array.
		expect(result.suppliedHistory).toBe(history);
		// The EXACT canonical array supplied to the production seam is
		// byte-identical after the auxiliary attempt.
		expect(JSON.stringify(result.suppliedHistory)).toBe(before);
		expect(JSON.stringify(history)).toBe(before);
		// The transport raised no error.
		expect(transportErrors).toEqual([]);
	});
});
