/**
 * ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION01 — the
 * PRODUCTION session-restoration seam.
 *
 * The predecessor's R9 used a generic JSON round trip, which is NOT session
 * restoration. This suite exercises the PRODUCTION seams:
 *
 *   agentMessageToMessageWithMetadata  (the PERSISTENCE codec)
 *   messagesToAgentMessages            (the RESTORATION codec)
 *   AgentRuntime.restore(messages)     (the production restore)
 *
 * and then the REAL runtime continues the conversation, so the restored
 * provider-owned reasoning signature is observed on the ACTUAL outbound
 * HTTP request.
 *
 * The acceptance authority is the exact serialized outbound HTTP request.
 */

import { createAgentRuntime } from "@cline/agents";
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentTool,
	AgentToolContext,
	ContentBlock,
	ITelemetryService,
	MessageWithMetadata,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	agentMessageToMessageWithMetadata,
	messagesToAgentMessages,
} from "./agent-message-codec";

const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const MODEL_ID = "claude-sonnet-4-6";
const SIGNATURE_A = "synthetic-opaque-signature-aa11bb22";
const REASONING_A = "SYNTHETIC-REASONING-A";
const TOOL_NAME = "read_synthetic_file";
const TOOL_RESULT = "SYNTHETIC-TOOL-RESULT-OK";
const TOOL_CALL_ID = "toolu_synthetic_0001";

const MESSAGE_START =
	'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-sonnet-4-6","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":10}}}\n\n';

const MESSAGE_STOP = 'event: message_stop\ndata: {"type":"message_stop"}\n\n';

function thinkingBlock(
	index: number,
	text: string,
	signature: string,
): string[] {
	return [
		`event: content_block_start\ndata: {"type":"content_block_start","index":${index},"content_block":{"type":"thinking","thinking":""}}\n\n`,
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":${index},"delta":{"type":"thinking_delta","thinking":"${text}"}}\n\n`,
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":${index},"delta":{"type":"signature_delta","signature":"${signature}"}}\n\n`,
		`event: content_block_stop\ndata: {"type":"content_block_stop","index":${index}}\n\n`,
	];
}

function toolUseBlock(index: number, id: string): string[] {
	return [
		`event: content_block_start\ndata: {"type":"content_block_start","index":${index},"content_block":{"type":"tool_use","id":"${id}","name":"${TOOL_NAME}","input":{}}}\n\n`,
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":${index},"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n`,
		`event: content_block_stop\ndata: {"type":"content_block_stop","index":${index}}\n\n`,
	];
}

function textBlock(index: number, text: string): string[] {
	return [
		`event: content_block_start\ndata: {"type":"content_block_start","index":${index},"content_block":{"type":"text","text":""}}\n\n`,
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":${index},"delta":{"type":"text_delta","text":"${text}"}}\n\n`,
		`event: content_block_stop\ndata: {"type":"content_block_stop","index":${index}}\n\n`,
	];
}

/**
 * The REAL gateway, with ONLY the external network boundary replaced.
 *
 * The gateway is imported from `@cline/llms` — the production package — and
 * is constructed with an injected `fetch`, so the whole provider transport
 * (the resolved `@ai-sdk/anthropic` adapter, the ClineMM translator and the
 * Anthropic serializer) is the production one.
 */
async function makeRealModel(
	fetchImpl: typeof fetch,
	baseUrl: string = ANTHROPIC_BASE_URL,
): Promise<AgentModel> {
	const { createGateway } = await import("@cline/llms");
	const gateway = createGateway({
		providerConfigs: [
			{
				providerId: "anthropic",
				apiKey: "test-key",
				baseUrl,
				fetch: fetchImpl,
			},
		],
	});
	return gateway.createAgentModel({
		providerId: "anthropic",
		modelId: MODEL_ID,
	});
}

type CapturedCall = {
	/** The EFFECTIVE URL the transport actually requested. */
	url: string;
	body: Record<string, unknown>;
};

function makeFetch(responses: (() => Response)[]) {
	const calls: CapturedCall[] = [];
	let index = 0;
	const fetchImpl = (async (input: unknown, init?: RequestInit) => {
		const raw = init?.body;
		const body =
			typeof raw === "string"
				? (JSON.parse(raw) as Record<string, unknown>)
				: ({} as Record<string, unknown>);
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: String(input);
		calls.push({ url, body });
		const factory = responses[Math.min(index, responses.length - 1)];
		index += 1;
		return factory();
	}) as unknown as typeof fetch;
	return { fetchImpl, calls };
}

function telemetryMock(): ITelemetryService {
	return {
		capture: () => undefined,
		captureRequired: () => undefined,
		setDistinctId: () => undefined,
		setMetadata: () => undefined,
		updateMetadata: () => undefined,
		setCommonProperties: () => undefined,
		updateCommonProperties: () => undefined,
		isEnabled: () => false,
		recordCounter: () => undefined,
		recordHistogram: () => undefined,
		recordGauge: () => undefined,
		flush: async () => undefined,
		dispose: async () => undefined,
	} as unknown as ITelemetryService;
}

function makeTool(
	executions: string[],
): AgentTool<Record<string, unknown>, { output: string }> {
	return {
		name: TOOL_NAME,
		description: "A synthetic tool used only by this test.",
		inputSchema: { type: "object", properties: {} },
		execute: async (
			_input: Record<string, unknown>,
			_ctx: AgentToolContext,
		) => {
			executions.push(TOOL_NAME);
			return { output: TOOL_RESULT };
		},
	};
}

function anthropicTurn(): Response {
	return new Response(
		[
			MESSAGE_START,
			...thinkingBlock(0, REASONING_A, SIGNATURE_A),
			...toolUseBlock(1, TOOL_CALL_ID),
			'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":10}}\n\n',
			MESSAGE_STOP,
		].join(""),
		{ headers: { "content-type": "text/event-stream" } },
	);
}

function plainTurn(): Response {
	return new Response(
		[
			MESSAGE_START,
			...textBlock(0, "DONE"),
			'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
			MESSAGE_STOP,
		].join(""),
		{ headers: { "content-type": "text/event-stream" } },
	);
}
function assistantBlocks(
	body: Record<string, unknown>,
): Array<Record<string, unknown>> {
	const messages = body.messages as Array<Record<string, unknown>>;
	const assistant = messages.find((message) => message.role === "assistant");
	return (assistant?.content ?? []) as Array<Record<string, unknown>>;
}

describe("production session restoration of provider reasoning", () => {
	it("RT7: the provider-owned signature survives the production codec and the production restore()", async () => {
		const executions: string[] = [];
		const { fetchImpl, calls } = makeFetch([
			() =>
				new Response(
					[
						MESSAGE_START,
						...thinkingBlock(0, REASONING_A, SIGNATURE_A),
						...toolUseBlock(1, TOOL_CALL_ID),
						'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":10}}\n\n',
						MESSAGE_STOP,
					].join(""),
					{ headers: { "content-type": "text/event-stream" } },
				),
			() =>
				new Response(
					[
						MESSAGE_START,
						...textBlock(0, "DONE"),
						'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
						MESSAGE_STOP,
					].join(""),
					{ headers: { "content-type": "text/event-stream" } },
				),
		]);

		const model = await makeRealModel(fetchImpl);
		const runtime = createAgentRuntime({
			model,
			tools: [makeTool(executions)],
			requestToolApproval: () => ({ approved: true }),
			telemetry: telemetryMock(),
		});

		const first = await runtime.run("SYNTHETIC-PROMPT");
		expect(executions).toEqual([TOOL_NAME]);
		expect(calls).toHaveLength(2);

		// ---- THE PRODUCTION PERSISTENCE CODEC ----
		const persisted = first.messages.map(agentMessageToMessageWithMetadata);

		// ---- THE PRODUCTION RESTORATION CODEC ----
		const restored = messagesToAgentMessages(persisted);
		const restoredReasoning = restored
			.flatMap((message) => message.content)
			.find((part) => part.type === "reasoning");
		expect(restoredReasoning?.type).toBe("reasoning");
		expect(
			(restoredReasoning?.metadata as Record<string, unknown> | undefined)
				?.signature,
		).toBe(SIGNATURE_A);

		// O4 (ORIGIN_CODEC_ROUNDTRIP): the ORIGIN AUTHORITY survives the
		// production persistence codec AND the production restoration codec.
		const restoredOrigin = (
			restoredReasoning?.metadata as Record<string, unknown> | undefined
		)?.originAuthority;
		expect(typeof restoredOrigin).toBe("string");
		expect(restoredOrigin as string).toContain("anthropic");
		expect(restoredOrigin as string).toContain("api.anthropic.com");
		// The persisted form carries it too.
		const persistedThinking = persisted
			.flatMap((message) =>
				Array.isArray(message.content) ? message.content : [],
			)
			.find(
				(block): block is Extract<ContentBlock, { type: "thinking" }> =>
					block.type === "thinking",
			);
		expect(persistedThinking?.originAuthority).toBe(restoredOrigin);

		// ---- THE PRODUCTION restore() SEAM, then a real continuation ----
		runtime.restore(restored);
		await runtime.run("SYNTHETIC-SECOND-PROMPT");

		expect(calls.length).toBeGreaterThanOrEqual(3);
		const assistant = assistantBlocks(calls[calls.length - 1].body);
		expect(assistant.filter((block) => block.type === "thinking")).toEqual([
			{
				type: "thinking",
				thinking: REASONING_A,
				signature: SIGNATURE_A,
			},
		]);
	});
});

describe("restored origin enforcement (CORRECTION02 O4/O5)", () => {
	const ANTHROPIC_OFFICIAL_BASE_URL = "https://api.anthropic.com/v1";
	const ANTHROPIC_OTHER_BASE_URL = "https://eu.api.anthropic.com/v1";

	it("O4/O5: a restored payload is enforced against the destination route, and switching back replays it", async () => {
		const executions: string[] = [];
		const { fetchImpl, calls } = makeFetch([
			anthropicTurn,
			plainTurn,
			plainTurn,
			plainTurn,
		]);
		const runtime = createAgentRuntime({
			model: await makeRealModel(fetchImpl, ANTHROPIC_OFFICIAL_BASE_URL),
			tools: [makeTool(executions)],
			requestToolApproval: () => ({ approved: true }),
			telemetry: telemetryMock(),
		});

		const first = await runtime.run("SYNTHETIC-PROMPT");
		expect(executions).toEqual([TOOL_NAME]);

		// ---- PRODUCTION persistence + restoration ----
		const persisted = first.messages.map(agentMessageToMessageWithMetadata);
		const restored = messagesToAgentMessages(persisted);
		expect(
			(
				restored
					.flatMap((message) => message.content)
					.find((part) => part.type === "reasoning")?.metadata as
					| Record<string, unknown>
					| undefined
			)?.originAuthority,
		).toBeTruthy();

		// ---- The INCOMPATIBLE destination route ----
		const destExecutions: string[] = [];
		const { fetchImpl: destFetch, calls: destCalls } = makeFetch([
			plainTurn,
			plainTurn,
		]);
		const destination = createAgentRuntime({
			model: await makeRealModel(destFetch, ANTHROPIC_OTHER_BASE_URL),
			tools: [makeTool(destExecutions)],
			requestToolApproval: () => ({ approved: true }),
			telemetry: telemetryMock(),
		});
		destination.restore(restored);
		await destination.run("SYNTHETIC-SECOND-PROMPT");

		// The incompatible route was really exercised, and EVERY request on
		// it excludes the restored opaque payload.
		expect(destCalls.length).toBeGreaterThanOrEqual(1);
		expect(destCalls.map((call) => new URL(call.url).host)).toEqual(
			destCalls.map(() => "eu.api.anthropic.com"),
		);
		for (const call of destCalls) {
			expect(JSON.stringify(call.body)).not.toContain(SIGNATURE_A);
		}

		// ---- Switching BACK to the compatible route ----
		// The stored history was NOT mutated by the enforcement: the very
		// same restored transcript still replays correctly on its own route.
		const backExecutions: string[] = [];
		const { fetchImpl: backFetch, calls: backCalls } = makeFetch([
			plainTurn,
			plainTurn,
		]);
		const back = createAgentRuntime({
			model: await makeRealModel(backFetch, ANTHROPIC_OFFICIAL_BASE_URL),
			tools: [makeTool(backExecutions)],
			requestToolApproval: () => ({ approved: true }),
			telemetry: telemetryMock(),
		});
		back.restore(restored);
		await back.run("SYNTHETIC-THIRD-PROMPT");

		expect(backCalls.map((call) => new URL(call.url).host)).toEqual(
			backCalls.map(() => "api.anthropic.com"),
		);
		// The switch-back collection MUST be non-empty: a vacuous loop over
		// zero requests would prove nothing about the replay.
		expect(backCalls.length).toBeGreaterThanOrEqual(1);
		for (const call of backCalls) {
			const thinking = assistantBlocks(call.body).filter(
				(block) => block.type === "thinking",
			);
			expect(thinking).toEqual([
				{
					type: "thinking",
					thinking: REASONING_A,
					signature: SIGNATURE_A,
				},
			]);
		}
	});
});

/**
 * ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION02 (A1/A2).
 *
 * The ROUTE-AUTHORITY discriminators.
 *
 * These observe the PERSISTED production content block — the record that
 * actually reaches disk and is restored after a session restart — and NOT
 * merely the outbound provider body.
 *
 * The authority decides whether an opaque provider-owned payload may be
 * replayed to a destination. It therefore has two independent obligations:
 *
 *   A1 — an UNRESOLVED or MALFORMED route must NOT produce a valid
 *        authority, so two unresolved routes can never compare equal and
 *        grant replay authority across an unestablished boundary;
 *   A2 — a PERSISTED authority must be CREDENTIAL-FREE.
 */
describe("route authority discriminators (CORRECTION02 A1/A2)", () => {
	/**
	 * A synthetic, obviously-fake credential. It is NOT a real secret; it
	 * exists so the discriminator can prove that a credential-bearing URL
	 * never reaches the persisted record.
	 */
	const SYNTHETIC_CREDENTIAL = "SYNTHETIC-CREDENTIAL-a1b2c3";

	/** The authority of the PERSISTED production content block. */
	function persistedAuthority(
		messages: readonly MessageWithMetadata[],
	): string | undefined {
		const thinking = messages
			.flatMap((message) =>
				Array.isArray(message.content) ? message.content : [],
			)
			.find(
				(block): block is Extract<ContentBlock, { type: "thinking" }> =>
					block.type === "thinking",
			);
		return thinking?.originAuthority;
	}

	/**
	 * Run the REAL runtime against a configured base URL and return the
	 * PERSISTED production content block's authority.
	 *
	 * `baseUrl: undefined` is the UNRESOLVED-ROUTE case: the provider
	 * (`dify`) has no default base URL, so the registry cannot resolve one.
	 */
	async function persistedForBaseUrl(
		baseUrl: string | undefined,
		providerId = "anthropic",
	): Promise<string | undefined> {
		const { createGateway } = await import("@cline/llms");
		const { fetchImpl } = makeFetch([anthropicTurn, plainTurn]);
		const gateway = createGateway({
			providerConfigs: [
				{
					providerId,
					apiKey: "test-key",
					...(baseUrl === undefined ? {} : { baseUrl }),
					fetch: fetchImpl,
				},
			],
		});
		const runtime = createAgentRuntime({
			model: gateway.createAgentModel({
				providerId,
				modelId: MODEL_ID,
			}),
			tools: [makeTool([])],
			requestToolApproval: () => ({ approved: true }),
			telemetry: telemetryMock(),
		});
		const result = await runtime.run("SYNTHETIC-PROMPT");
		return persistedAuthority(
			result.messages.map(agentMessageToMessageWithMetadata),
		);
	}

	it("A1: an EMPTY or WHITESPACE-ONLY base URL produces NO authority", async () => {
		expect(await persistedForBaseUrl("")).toBeUndefined();
		expect(await persistedForBaseUrl("   ")).toBeUndefined();
	});

	it("A1: an INVALID base URL produces NO authority", async () => {
		expect(await persistedForBaseUrl("not a url")).toBeUndefined();
		expect(await persistedForBaseUrl("://missing-scheme")).toBeUndefined();
	});

	it("A1: a MISSING or INVALID provider identity produces NO authority", async () => {
		// The provider id is the FIRST part of the authority. With no
		// provider id there is no route identity at all.
		expect(
			await persistedForBaseUrl("https://api.anthropic.com/v1", "   "),
		).toBeUndefined();
	});

	it("A1: a VALID route produces a NONEMPTY authority, and equal routes MATCH", async () => {
		const first = await persistedForBaseUrl(ANTHROPIC_BASE_URL);
		const second = await persistedForBaseUrl(ANTHROPIC_BASE_URL);
		expect(typeof first).toBe("string");
		expect(first).not.toBe("");
		expect(first).toBe(second);
	});

	it("A2: a base URL with USER INFORMATION persists NO credential", async () => {
		const authority = await persistedForBaseUrl(
			`https://user:${SYNTHETIC_CREDENTIAL}@api.anthropic.com/v1`,
		);
		// The route is credential-bearing, so NO authority is established
		// at all — nothing credential-bearing is persisted.
		expect(authority).toBeUndefined();
	});

	it("A2: a base URL with a CREDENTIAL-BEARING QUERY persists NO credential", async () => {
		const authority = await persistedForBaseUrl(
			`https://api.anthropic.com/v1?api_key=${SYNTHETIC_CREDENTIAL}`,
		);
		expect(authority).toBeUndefined();
	});

	it("A2: a base URL with a FRAGMENT persists NO credential", async () => {
		const authority = await persistedForBaseUrl(
			`https://api.anthropic.com/v1#${SYNTHETIC_CREDENTIAL}`,
		);
		expect(authority).toBeUndefined();
	});

	it("A2: a base URL with a CREDENTIAL-BEARING PATH COMPONENT persists NO credential", async () => {
		// ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION03.
		//
		// A base URL that is NOT one of the repository's PUBLISHED BUILTIN
		// ROUTES is an UNESTABLISHED route. Its path is operator-supplied
		// and may carry a secret, and there is no published fact that says
		// the path is route identity rather than a credential.
		//
		// The disposition is therefore: NO AUTHORITY AT ALL. Nothing about
		// the route is persisted, so the credential cannot reach the
		// persisted record.
		//
		// The acceptance authority is the COMPLETE SERIALIZED PERSISTED
		// RECORD — the whole production content block, not merely the
		// absence of the `originAuthority` field. A credential that leaked
		// through any other field of the record would still be caught.
		const { createGateway } = await import("@cline/llms");
		const { fetchImpl } = makeFetch([anthropicTurn, plainTurn]);
		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "anthropic",
					apiKey: "test-key",
					baseUrl: `https://api.anthropic.com/v1/${SYNTHETIC_CREDENTIAL}`,
					fetch: fetchImpl,
				},
			],
		});
		const runtime = createAgentRuntime({
			model: gateway.createAgentModel({
				providerId: "anthropic",
				modelId: MODEL_ID,
			}),
			tools: [makeTool([])],
			requestToolApproval: () => ({ approved: true }),
			telemetry: telemetryMock(),
		});
		const result = await runtime.run("SYNTHETIC-PROMPT");
		const persisted = result.messages.map(agentMessageToMessageWithMetadata);

		// The credential appears NOWHERE in the complete serialized record.
		const serialized = JSON.stringify(persisted);
		expect(serialized).not.toContain(SYNTHETIC_CREDENTIAL);
		// And no authority was established for the unestablished route.
		expect(persistedAuthority(persisted)).toBeUndefined();
	});

	it("A2: an UNESTABLISHED custom route persists NO authority at all", async () => {
		// A custom route that is not a published builtin route is withheld
		// authority, so nothing of it — not the host, not the path, not a
		// credential in either — reaches the persisted record.
		const authority = await persistedForBaseUrl(
			"https://api.anthropic.com/tenant-b/v1",
		);
		expect(authority).toBeUndefined();
	});

	it("A2: a PUBLISHED BUILTIN route keeps its COMPLETE route identity", async () => {
		// The published builtin route IS established by the repository, so
		// its COMPLETE route identity is preserved: the provider id, the
		// URL origin and the FULL path. The path is what keeps a
		// same-host / different-path pair two DISTINCT routes.
		const authority = await persistedForBaseUrl(ANTHROPIC_BASE_URL);
		expect(typeof authority).toBe("string");
		expect(authority).toContain("anthropic");
		expect(authority).toContain("api.anthropic.com");
		expect(authority).toContain("/v1");
		// The USER INFORMATION / QUERY / FRAGMENT forms never appear.
		expect(authority).not.toContain("@");
		expect(authority).not.toContain("?");
		expect(authority).not.toContain("#");
	});

	it("A2: the PERSISTED authority of an ordinary route carries NO credential", async () => {
		const authority = await persistedForBaseUrl(ANTHROPIC_BASE_URL);
		expect(typeof authority).toBe("string");
		expect(authority).not.toContain(SYNTHETIC_CREDENTIAL);
		expect(authority).not.toContain("test-key");
		expect(authority).not.toContain("@");
		expect(authority).not.toContain("?");
		expect(authority).not.toContain("#");
	});

	it("A2: the PERSISTED record of a credential-bearing route carries NO credential", async () => {
		// The acceptance authority is the PERSISTED production content
		// block, not merely the outbound provider body.
		const { createGateway } = await import("@cline/llms");
		const { fetchImpl } = makeFetch([anthropicTurn, plainTurn]);
		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "anthropic",
					apiKey: "test-key",
					baseUrl: `https://user:${SYNTHETIC_CREDENTIAL}@api.anthropic.com/v1`,
					fetch: fetchImpl,
				},
			],
		});
		const runtime = createAgentRuntime({
			model: gateway.createAgentModel({
				providerId: "anthropic",
				modelId: MODEL_ID,
			}),
			tools: [makeTool([])],
			requestToolApproval: () => ({ approved: true }),
			telemetry: telemetryMock(),
		});
		const result = await runtime.run("SYNTHETIC-PROMPT");
		const persisted = result.messages.map(agentMessageToMessageWithMetadata);
		const serialized = JSON.stringify(persisted);
		expect(serialized).not.toContain(SYNTHETIC_CREDENTIAL);
		expect(persistedAuthority(persisted)).toBeUndefined();
	});
});
