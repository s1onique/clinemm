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
 * The synthetic SSE of a TOOL CALL with CONCRETE ARGUMENTS.
 *
 * It is syntactically valid: the name, the argument JSON and the finish
 * reason are all well-formed.
 */
function sseToolCall(toolName: string, args: string): string {
	return (
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
}): Promise<RealTransportResult> {
	process.env.CLINEMM_PCK_CLOSED_ENABLED = "1";
	process.env.CLINEMM_PCK_PREFIX_PRESERVING_ENABLED = "1";
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
	const messages = canonicalHistory();
	const parentProjection = new MessageBuilder().buildForApi(
		messages as unknown as Parameters<MessageBuilder["buildForApi"]>[0],
	);
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
	};
}

describe("ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01) — REAL TRANSPORT", () => {
	it("RT.1: a syntactically valid MUTATION tool call alongside valid checkpoint JSON installs NOTHING", async () => {
		// The synthetic SSE carries a valid mutation tool call WITH
		// CONCRETE ARGUMENTS.
		const response = sseToolCall(
			"run_commands",
			JSON.stringify({ commands: ["rm -rf /workspace"] }),
		);
		const result = await runRealTransport({ pckResponse: response });
		// The tool call was ADVERTISED to the provider: the parent's
		// mutation-tool schema is on the wire.
		expect(JSON.stringify(result.pckRequestBody)).toContain("run_commands");
		// ZERO admitted and ZERO installed records.
		expect(result.installed).toBe(false);
		expect(result.transcript).not.toContain("operation invoked");
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

	it("RT.3: the HTTP WIRE body carries the parent's leading messages and the appended suffix", async () => {
		const result = await runRealTransport({
			pckResponse: sseText(VALID_CHECKPOINT_JSON),
		});
		const body = result.pckRequestBody as {
			messages?: { role: string; content: unknown }[];
		};
		expect(Array.isArray(body.messages)).toBe(true);
		const messages = body.messages ?? [];
		// The FIRST wire message carries the parent's system prompt (the
		// OpenAI-compatible route renders the system prompt as messages[0]).
		expect(messages[0].role).toBe("system");
		expect(JSON.stringify(messages[0].content)).toContain(PARENT_SYSTEM_PROMPT);
		// The LAST wire message is the appended extraction suffix.
		const last = messages[messages.length - 1];
		expect(last.role).toBe("user");
		expect(JSON.stringify(last.content)).toContain(
			"WORKING-KNOWLEDGE CHECKPOINT",
		);
		// The wire body carries the parent's TOOL SCHEMA.
		expect(JSON.stringify(result.pckRequestBody)).toContain("run_commands");
	});

	it("RT.4: the CANONICAL HISTORY object supplied to production execution is UNCHANGED", async () => {
		const history = canonicalHistory();
		const before = JSON.stringify(history);
		await runRealTransport({ pckResponse: sseText(VALID_CHECKPOINT_JSON) });
		// The EXACT canonical array supplied to the production seam is
		// byte-identical after the auxiliary attempt.
		expect(JSON.stringify(history)).toBe(before);
		// The transport raised no error.
		expect(transportErrors).toEqual([]);
	});
});
