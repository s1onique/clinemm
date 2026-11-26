/**
 * ACT-CLINEMM-CACHE-PRESERVING-AUXILIARY-INFERENCE-RECON-01
 *
 * C3 — the ACTUAL prefix-equivalence discriminator for the PCK auxiliary
 * seam, over the REAL production request and serialization seams.
 *
 * The ORDINARY parent request and each CANDIDATE auxiliary request are built
 * through the PRODUCTION seams and serialized by the REAL provider transport
 * (`createHandlerAsync` with a stubbed fetch), so the compared bodies are the
 * bodies that would have gone on the wire. No hand-built JSON fixture.
 * NO inference, NO network dispatch.
 *
 * The tokenizer is NOT available offline, so token-level quantities are
 * reported as UNKNOWN rather than estimated.
 */

import {
	buildCheckpointInputView,
	buildCheckpointRequest,
	CHECKPOINT_SYSTEM_PROMPT,
} from "../../../../sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/model-request";
import { MessageBuilder } from "../../../../sdk/packages/core/src/session/services/message-builder";
import type { ProviderConfig } from "../../../../sdk/packages/llms/dist/index.js";
import { createHandlerAsync } from "../../../../sdk/packages/llms/dist/index.js";

const PROVIDER_ID = "openai-compatible";
const MODEL_ID = "qwen3.8-flash-next-q2_0";

const PARENT_SYSTEM_PROMPT = [
	"You are Cline, an AI coding agent.",
	"Your primary goal is to assist users with various coding tasks.",
].join("\n");

const PERSISTENT_PROTOCOL = [
	"## Auxiliary extraction protocol",
	"Ordinary execution mode: act on the user task directly.",
	"Dormant auxiliary mode: only when an activation block is present.",
].join("\n");

const ACTIVATION_SUFFIX = [
	"<<< cline-aux-activation >>>",
	"operation: pre-compaction-knowledge-checkpoint",
	"sourceInterval: id:msg-1..id:msg-4",
	"objective: produce the structured working-knowledge checkpoint",
	"<<< end cline-aux-activation >>>",
].join("\n");

const TOOLS = [
	{
		name: "read_file",
		description: "Read a file from the workspace.",
		inputSchema: {
			type: "object",
			properties: { path: { type: "string" } },
			required: ["path"],
		},
	},
];

const CANONICAL = [
	{
		role: "user",
		content: "Please fix the failing restore test in model.nim.",
		id: "msg-1",
	},
	{
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "private reasoning that must not leak" },
			{ type: "text", text: "I will inspect the module." },
			{
				type: "tool_use",
				id: "call-1",
				name: "read_file",
				input: { path: "model.nim" },
			},
		],
		id: "msg-2",
	},
	{
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: "call-1",
				content: [{ type: "text", text: "proc rpCommitted*(): bool = true" }],
			},
		],
		id: "msg-3",
	},
	{
		role: "assistant",
		content: [
			{ type: "text", text: "The recovery behaviour is already implemented." },
		],
		id: "msg-4",
	},
] as unknown as Parameters<MessageBuilder["buildForApi"]>[0];

function parentMessages(): unknown[] {
	return new MessageBuilder().buildForApi(CANONICAL);
}

function pckControlledRequest(): string {
	const view = buildCheckpointInputView(CANONICAL as never);
	return buildCheckpointRequest(view, [
		"id:msg-1",
		"id:msg-2",
		"id:msg-3",
		"id:msg-4",
	]);
}

function commonPrefixLength(a: string, b: string): number {
	const max = Math.min(a.length, b.length);
	let i = 0;
	while (i < max && a[i] === b[i]) {
		i++;
	}
	return i;
}

/** The number of leading messages that are byte-identical. */
function identicalLeadingMessageCount(a: unknown, b: unknown): number {
	const left = Array.isArray(a) ? a : [];
	const right = Array.isArray(b) ? b : [];
	const max = Math.min(left.length, right.length);
	let i = 0;
	while (i < max && JSON.stringify(left[i]) === JSON.stringify(right[i])) {
		i++;
	}
	return i;
}

/** The index of the first differing message, or -1 when the lists match. */
function firstDivergentMessageIndex(a: unknown, b: unknown): number {
	const left = Array.isArray(a) ? a : [];
	const right = Array.isArray(b) ? b : [];
	const identical = identicalLeadingMessageCount(a, b);
	if (identical === left.length && identical === right.length) {
		return -1;
	}
	return identical;
}

async function captureWireBody(input: {
	readonly systemPrompt: string;
	readonly messages: unknown[];
	readonly tools?: unknown[];
}): Promise<Record<string, unknown>> {
	let captured: Record<string, unknown> | undefined;
	const fetchStub = (async (_url: unknown, init: unknown) => {
		const requestInit = init as { body?: string } | undefined;
		captured = JSON.parse(requestInit?.body ?? "{}") as Record<string, unknown>;
		const chunks = [
			'data: {"id":"1","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
			'data: {"id":"1","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{"content":"{}"},"finish_reason":null}]}',
			'data: {"id":"1","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
			"data: [DONE]",
			"",
		].join("\n\n");
		return new Response(chunks, {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
	}) as typeof fetch;
	const handler = await createHandlerAsync({
		providerId: PROVIDER_ID,
		modelId: MODEL_ID,
		apiKey: "test-key",
		baseUrl: "http://endpoint.invalid/v1",
		maxOutputTokens: 4096,
		thinking: false,
		fetch: fetchStub,
	} as unknown as ProviderConfig);
	for await (const _chunk of handler.createMessage(
		input.systemPrompt,
		input.messages as never,
		input.tools as never,
	)) {
		// drain the production stream
	}
	if (!captured) {
		throw new Error("the stubbed fetch was never called");
	}
	return captured;
}

const parent = await captureWireBody({
	systemPrompt: PARENT_SYSTEM_PROMPT,
	messages: parentMessages(),
	tools: TOOLS,
});

const candidateA = await captureWireBody({
	systemPrompt: CHECKPOINT_SYSTEM_PROMPT,
	messages: [{ role: "user", content: pckControlledRequest() }],
});

const suffixText = [CHECKPOINT_SYSTEM_PROMPT, "", pckControlledRequest()].join(
	"\n",
);
const candidateB = await captureWireBody({
	systemPrompt: PARENT_SYSTEM_PROMPT,
	messages: [...parentMessages(), { role: "user", content: suffixText }],
	tools: TOOLS,
});

const candidateCSystem = `${PARENT_SYSTEM_PROMPT}\n\n${PERSISTENT_PROTOCOL}`;
const candidateCParent = await captureWireBody({
	systemPrompt: candidateCSystem,
	messages: parentMessages(),
	tools: TOOLS,
});
const candidateC = await captureWireBody({
	systemPrompt: candidateCSystem,
	messages: [...parentMessages(), { role: "user", content: ACTIVATION_SUFFIX }],
	tools: TOOLS,
});

const parentText = JSON.stringify(parent);

/**
 * C4 — the PARENT-RETURN transition.
 *
 * After the auxiliary branch, the ordinary parent request is dispatched
 * again. The parent's own serialized body must be byte-identical to the
 * body it had BEFORE the auxiliary branch: the auxiliary request is
 * branch-local and mutates nothing.
 */
const parentAfter = await captureWireBody({
	systemPrompt: PARENT_SYSTEM_PROMPT,
	messages: parentMessages(),
	tools: TOOLS,
});
const candidateBParentOnly = {
	...candidateB,
	messages: (candidateB.messages as unknown[]).slice(
		0,
		(candidateB.messages as unknown[]).length - 1,
	),
};
const report = {
	actId: "ACT-CLINEMM-CACHE-PRESERVING-AUXILIARY-INFERENCE-RECON-01",
	c3: "C3 actual prefix equivalence over the production request seams",
	evidenceClass: "SYNTHETIC_REAL_PRODUCTION_SEAM",
	route: { providerId: PROVIDER_ID, modelId: MODEL_ID },
	serializer:
		"REAL — createHandlerAsync -> AI SDK -> openai-compatible wire body",
	renderer: "NOT_EXERCISED — no chat-template renderer is reachable offline",
	tokenizer:
		"UNKNOWN — no tokenizer is available offline; token counts are NOT estimated",
	parentSerializedChars: parentText.length,
	parentReturn: {
		note: "the parent request is re-dispatched after the auxiliary branch",
		parentBeforeEqualsParentAfter:
			JSON.stringify(parent) === JSON.stringify(parentAfter),
		candidateBWithoutSuffixEqualsParent:
			JSON.stringify(candidateBParentOnly) === JSON.stringify(parent),
	},
	wireShape: {
		note: "on the openai-compatible route the system prompt is rendered as messages[0] with role 'system', so ANY system-prompt modification diverges at the FIRST message and invalidates the whole conversation prefix",
		parentTopLevelKeys: Object.keys(parent),
		parentMessageCount: (parent.messages as unknown[]).length,
		parentFirstMessageRole: (parent.messages as unknown[])[0]?.role,
		parentCarriesToolChoice: parent.tool_choice !== undefined,
	},
	candidates: [
		{
			id: "A",
			name: "existing architecture (independent auxiliary request)",
			systemEqualToParent:
				JSON.stringify(candidateA.system) === JSON.stringify(parent.system),
			toolsEqualToParent:
				JSON.stringify(candidateA.tools) === JSON.stringify(parent.tools),
			auxiliaryCarriesTools: candidateA.tools !== undefined,
			identicalLeadingMessageCount: identicalLeadingMessageCount(
				parent.messages,
				candidateA.messages,
			),
			firstDivergentMessageIndex: firstDivergentMessageIndex(
				parent.messages,
				candidateA.messages,
			),
			serializedCommonPrefixChars: commonPrefixLength(
				parentText,
				JSON.stringify(candidateA),
			),
			eligiblePrefixReuseRatio: 0,
		},
		{
			id: "B",
			name: "full auxiliary contract as a suffix",
			systemEqualToParent:
				JSON.stringify(candidateB.system) === JSON.stringify(parent.system),
			toolsEqualToParent:
				JSON.stringify(candidateB.tools) === JSON.stringify(parent.tools),
			identicalLeadingMessageCount: identicalLeadingMessageCount(
				parent.messages,
				candidateB.messages,
			),
			firstDivergentMessageIndex: firstDivergentMessageIndex(
				parent.messages,
				candidateB.messages,
			),
			serializedCommonPrefixChars: commonPrefixLength(
				parentText,
				JSON.stringify(candidateB),
			),
			eligiblePrefixReuseRatio:
				commonPrefixLength(parentText, JSON.stringify(candidateB)) /
				parentText.length,
		},
		{
			id: "C",
			name: "persistent protocol plus activation suffix",
			systemEqualToParent:
				JSON.stringify(candidateC.system) === JSON.stringify(parent.system),
			toolsEqualToParent:
				JSON.stringify(candidateC.tools) === JSON.stringify(parent.tools),
			identicalLeadingMessageCount: identicalLeadingMessageCount(
				candidateCParent.messages,
				candidateC.messages,
			),
			firstDivergentMessageIndex: firstDivergentMessageIndex(
				candidateCParent.messages,
				candidateC.messages,
			),
			serializedCommonPrefixChars: commonPrefixLength(
				JSON.stringify(candidateCParent),
				JSON.stringify(candidateC),
			),
			eligiblePrefixReuseRatio:
				commonPrefixLength(
					JSON.stringify(candidateCParent),
					JSON.stringify(candidateC),
				) / JSON.stringify(candidateCParent).length,
			note: "the C parent is measured against the C parent, because a C session's ordinary request ALREADY carries the protocol",
		},
	],
	tokenLevel: {
		PARENT_RENDERED_TOKENS: "UNKNOWN",
		AUXILIARY_RENDERED_TOKENS: "UNKNOWN",
		LONGEST_COMMON_PREFIX_TOKENS: "UNKNOWN",
		FIRST_DIVERGENT_TOKEN: "UNKNOWN",
		NEW_SUFFIX_TOKENS: "UNKNOWN",
	},
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
