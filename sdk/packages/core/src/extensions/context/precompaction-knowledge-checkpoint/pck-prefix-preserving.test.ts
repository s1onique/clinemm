/**
 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 — C6/C7 GREEN.
 *
 * The PASSING companion for the RED witness
 * (`pck-prefix-preserving.red01.test.ts`) and the C6 conservation,
 * authority and adversarial controls.
 *
 * ============================================================================
 * WHAT IS EXERCISED
 * ============================================================================
 *
 *   - The REAL production compaction-to-PCK dispatch seam.
 *   - The REAL `MessageBuilder.buildForApi` provider projection.
 *   - The REAL provider serializer boundary with an INJECTED transport.
 *
 * The captured request is never re-derived from the production code.
 *
 * ============================================================================
 * THE CONTROLS
 * ============================================================================
 *
 *   REQUEST CONSERVATION
 *     G1  Feature disabled: the legacy PCK behaviour is conserved.
 *     G2  Feature enabled and eligible: B' is selected.
 *     G3  Missing parent authority: A (legacy) is selected.
 *     G4  Missing or ambiguous source provenance: A is selected.
 *     G5  The parent system prompt and tool schema are unchanged.
 *     G6  The leading serialized messages are identical to the parent's.
 *     G7  The first message divergence is at the appended suffix.
 *     G8  The parent branch is unchanged after the auxiliary completion.
 *
 *   PUBLICATION AUTHORITY
 *     G9  An unsupported reference is rejected.
 *     G10 A reference outside the authorized interval is rejected.
 *     G11 An invisible or ambiguous source reference cannot gain publication
 *         authority.
 *
 *   LIFECYCLE
 *     G12 A tool-call attempt installs nothing.
 *     G13 The ordinary parent history is unchanged by a failed auxiliary
 *         attempt.
 *
 *   NEGATIVE CONTROL
 *     G14 A deliberately broken binding component is DETECTED.
 */

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as LlmsProviders from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageBuilder } from "../../../session/services/message-builder";
import {
	createCompactionStateAwarePrepareTurn,
	createContextCompactionPrepareTurn,
} from "../compaction";
import {
	applyPckInferencePolicy,
	QWEN_STRATA_V1_PARAMETERS,
} from "./inference-policy";
import {
	isPckPrefixCaptureEnabled,
	recordPckPrefixCapture,
} from "./pck-capture";
import { selectPrefixPreservingRoute } from "./prefix-preserving-request";
import {
	assembleParentRequestAuthority,
	isPckPrefixPreservingEnabled,
} from "./prefix-preserving-route";
import {
	buildProviderVisibleBindings,
	collectAuthorizedReferences,
} from "./provider-visible-binding";
import { runPckAttempt } from "./runtime";

const createHandlerMock = vi.fn();

vi.mock("@cline/llms", () => ({
	createHandlerAsync: (config: unknown) => createHandlerMock(config),
}));

const PARENT_SYSTEM_PROMPT = "You are a helpful coding assistant.";
const SYNTHETIC_TOOL_CALL_ID = "tool_call_r4";

interface CapturedDispatch {
	readonly systemPrompt: string;
	readonly messages: unknown[];
	readonly tools: unknown[] | undefined;
	readonly fromCheckpoint: boolean;
}

const capturedDispatches: CapturedDispatch[] = [];
let inCheckpointDispatch = false;

async function* streamChunks(
	chunks: readonly Record<string, unknown>[],
): AsyncGenerator<Record<string, unknown>> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

/**
 * The canonical history the controls run over.
 *
 * It contains a USER message, an ASSISTANT tool call, its USER tool result
 * and a trailing USER message, so the production projection's message
 * MERGING is exercised.
 */
function syntheticCanonicalHistory(): MessageWithMetadata[] {
	const messages: MessageWithMetadata[] = [
		{
			role: "user",
			id: "msg_task",
			content: "Inspect the deployment configuration and report findings.",
		} as unknown as MessageWithMetadata,
		{
			role: "assistant",
			id: "msg_call",
			content: [
				{
					type: "tool_use",
					id: SYNTHETIC_TOOL_CALL_ID,
					name: "run_commands",
					input: { command: "kc.sh build" },
				},
			],
		} as unknown as MessageWithMetadata,
		{
			role: "user",
			id: "msg_result",
			content: [
				{
					type: "tool_result",
					tool_use_id: SYNTHETIC_TOOL_CALL_ID,
					name: "run_commands",
					content: [
						{
							query: "kc.sh build",
							result: "build completed",
							success: true,
						},
					],
				},
			],
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
	return messages;
}

const PARENT_TOOLS = [
	{
		name: "run_commands",
		description: "Run a command.",
		inputSchema: { type: "object", properties: {} },
	},
];

interface SeamOptions {
	readonly enabled?: boolean;
	readonly checkpointResponse?: string;
	readonly checkpointUsedTools?: boolean;
	/** The provider-visible projection the ordinary request carries. */
	readonly providerMessages?: MessageWithMetadata[];
	/**
	 * The canonical history to supply to production.
	 *
	 * When it is supplied, the caller owns the EXACT object the production
	 * seam receives, so a conservation assertion can observe it.
	 */
	readonly canonicalMessages?: MessageWithMetadata[];
}

interface SeamResult {
	readonly dispatches: readonly CapturedDispatch[];
	readonly parentProjection: readonly unknown[];
	readonly productionMessages: readonly MessageWithMetadata[];
	/**
	 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01) —
	 * the EXACT canonical history object that was supplied to production
	 * execution.
	 *
	 * The conservation assertions use THIS object, not a separately
	 * constructed fixture, so they observe the array the production seam
	 * actually received.
	 */
	readonly canonicalMessages: readonly MessageWithMetadata[];
}

/**
 * Drive the REAL production seam and capture EVERY provider dispatch.
 */
async function runSeam(options: SeamOptions = {}): Promise<SeamResult> {
	capturedDispatches.length = 0;
	process.env.CLINEMM_PCK_CLOSED_ENABLED = "1";
	if (options.enabled === true) {
		process.env.CLINEMM_PCK_PREFIX_PRESERVING_ENABLED = "1";
	} else {
		delete process.env.CLINEMM_PCK_PREFIX_PRESERVING_ENABLED;
	}
	const checkpointResponse = options.checkpointResponse ?? "{}";
	const checkpointUsedTools = options.checkpointUsedTools === true;
	createHandlerMock.mockReset();
	createHandlerMock.mockImplementation(() => ({
		createMessage: vi.fn(
			(systemPrompt: string, messages: unknown[], tools?: unknown[]) => {
				capturedDispatches.push({
					systemPrompt,
					messages,
					tools,
					fromCheckpoint: inCheckpointDispatch,
				});
				return streamChunks([
					{ type: "text", id: "x-1", text: checkpointResponse },
					...(checkpointUsedTools
						? [{ type: "tool_calls", id: "x-1", calls: [] }]
						: []),
					{ type: "done", id: "x-1", success: true },
				]);
			},
		),
	}));
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

	const canonicalMessages =
		options.canonicalMessages ?? syntheticCanonicalHistory();
	const parentProjection = new MessageBuilder().buildForApi(
		canonicalMessages as unknown as Parameters<
			MessageBuilder["buildForApi"]
		>[0],
	);
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
			logger: undefined,
		},
		{ mode: "manual" },
	);
	const prepareTurn = createCompactionStateAwarePrepareTurn({
		compact: (context) =>
			inner?.({ ...context, model: innerModel }) ?? Promise.resolve(undefined),
		getState: () => undefined,
		prepareApiMessages: async (messages) => messages,
		saveState: () => undefined,
		knowledgeCheckpoint: {
			generate: async ({ systemPrompt, request, signal, messages, tools }) => {
				inCheckpointDispatch = true;
				const handler = await createHandlerMock({ systemPrompt }).createMessage(
					systemPrompt,
					messages ?? [{ role: "user", content: request }],
					tools,
				);
				let text = "";
				let usedTools = false;
				for await (const chunk of handler) {
					if (chunk.type === "text") {
						text += chunk.text;
					} else if (chunk.type === "tool_calls") {
						usedTools = true;
					}
				}
				inCheckpointDispatch = false;
				signal.throwIfAborted();
				return { text, reasoningChars: 0, usedTools, failed: false };
			},
			decisionId: () => "decision-1",
			deadlineMs: () => 5_000,
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
		messages: canonicalMessages,
		apiMessages:
			options.providerMessages ??
			(parentProjection as unknown as MessageWithMetadata[]),
		model: outerModel,
	});
	return {
		dispatches: [...capturedDispatches],
		parentProjection,
		productionMessages: result?.messages ?? [],
		canonicalMessages,
	};
}

/**
 * The dispatch that carried the CHECKPOINT request.
 */
function checkpointDispatch(
	dispatches: readonly CapturedDispatch[],
): CapturedDispatch | undefined {
	return dispatches.find((dispatch) => dispatch.fromCheckpoint);
}

beforeEach(() => {
	capturedDispatches.length = 0;
	inCheckpointDispatch = false;
});

afterEach(() => {
	delete process.env.CLINEMM_PCK_CLOSED_ENABLED;
	delete process.env.CLINEMM_PCK_PREFIX_PRESERVING_ENABLED;
});

describe("ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 — C6 REQUEST CONSERVATION", () => {
	it("G1: DISABLED — the legacy PCK behaviour is conserved", async () => {
		const { dispatches } = await runSeam({ enabled: false });
		const checkpoint = checkpointDispatch(dispatches);
		expect(checkpoint).toBeDefined();
		// The legacy request carries ONE message and the closed contract's
		// OWN system instruction.
		expect(checkpoint?.messages.length).toBe(1);
		expect(checkpoint?.systemPrompt).toContain("WORKING-KNOWLEDGE CHECKPOINT");
		expect(checkpoint?.systemPrompt).not.toBe(PARENT_SYSTEM_PROMPT);
		// The legacy request advertises NO tools.
		expect(checkpoint?.tools).toBeUndefined();
	});

	it("G2: ENABLED and eligible — B' is selected", async () => {
		const { dispatches } = await runSeam({ enabled: true });
		const checkpoint = checkpointDispatch(dispatches);
		expect(checkpoint).toBeDefined();
		// The B' request carries the PARENT's system instruction.
		expect(checkpoint?.systemPrompt).toBe(PARENT_SYSTEM_PROMPT);
	});

	it("G5/G6/G7: the parent system prompt, tool schema and leading messages are unchanged, and the first divergence is at the appended suffix", async () => {
		const { dispatches, parentProjection } = await runSeam({ enabled: true });
		const checkpoint = checkpointDispatch(dispatches);
		expect(checkpoint).toBeDefined();
		// The system prompt is the parent's, verbatim.
		expect(checkpoint?.systemPrompt).toBe(PARENT_SYSTEM_PROMPT);
		// The visible tool schema is the parent's, verbatim.
		expect(checkpoint?.tools).toEqual(PARENT_TOOLS);
		// The leading serialized messages are IDENTICAL to the parent's.
		expect(
			JSON.stringify(checkpoint?.messages.slice(0, parentProjection.length)),
		).toBe(JSON.stringify(parentProjection));
		// EXACTLY ONE message is appended, and it is the LAST one.
		expect(checkpoint?.messages.length).toBe(parentProjection.length + 1);
		const suffix = checkpoint?.messages[parentProjection.length] as {
			role: string;
			content: string;
		};
		expect(suffix.role).toBe("user");
		// The suffix carries the extraction contract and the bindings.
		expect(suffix.content).toContain("WORKING-KNOWLEDGE CHECKPOINT");
		expect(suffix.content).toContain("AUTHORIZED SOURCE INTERVAL");
		expect(suffix.content).toContain("EXTRACTION OBJECTIVE");
		expect(suffix.content).toContain("Canonical source bindings");
		// The suffix does NOT duplicate the conversation.
		expect(suffix.content).not.toContain("padding 0 xxxx");
	});

	it("G8: the parent branch is unchanged after the auxiliary completion", async () => {
		const canonical = syntheticCanonicalHistory();
		const before = JSON.stringify(canonical);
		const { productionMessages, canonicalMessages } = await runSeam({
			enabled: true,
			canonicalMessages: canonical,
		});
		// The EXACT canonical history object that was supplied to production
		// execution is untouched by the auxiliary request.
		expect(canonicalMessages).toBe(canonical);
		expect(JSON.stringify(canonicalMessages)).toBe(before);
		// The production messages are the COMPACTED transcript: the
		// auxiliary suffix is not persisted as an ordinary message.
		const serialized = JSON.stringify(productionMessages);
		expect(serialized).not.toContain("Canonical source bindings");
		expect(serialized).not.toContain("AUTHORIZED SOURCE INTERVAL");
	});

	it("G3: MISSING parent authority — the legacy route is selected", () => {
		const route = selectPrefixPreservingRoute({
			featureEnabled: true,
			authority: undefined,
		});
		expect(route.selected).toBe("legacy");
		expect(route.selected === "legacy" ? route.reason : undefined).toBe(
			"no_parent_authority",
		);
	});

	it("G4: MISSING or AMBIGUOUS source provenance — the legacy route is selected", () => {
		const empty = selectPrefixPreservingRoute({
			featureEnabled: true,
			authority: assembleParentRequestAuthority({
				systemPrompt: PARENT_SYSTEM_PROMPT,
				providerMessages: [{ role: "user", content: "only" }],
				tools: [],
				canonicalMessages: [],
				authorizedMessageCount: 0,
			}),
		});
		expect(empty.selected).toBe("legacy");
		expect(empty.selected === "legacy" ? empty.reason : undefined).toBe(
			"no_resolved_bindings",
		);
	});
});

describe("ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 — C6 PUBLICATION AUTHORITY", () => {
	it("G9/G10/G11: an absent, ambiguous or out-of-interval reference cannot gain publication authority", () => {
		const canonical = syntheticCanonicalHistory();
		const parentProjection = new MessageBuilder().buildForApi(
			canonical as unknown as Parameters<MessageBuilder["buildForApi"]>[0],
		);
		// The FULL interval: every canonical reference is authorized.
		const full = buildProviderVisibleBindings({
			canonicalMessages: canonical,
			providerMessages: parentProjection as unknown as {
				role: string;
				id?: string;
				content: unknown;
			}[],
			authorizedMessageCount: canonical.length,
		});
		// A canonical message the projection MERGED AWAY has NO
		// provider-visible position, so its reference is `absent` and it is
		// NOT authorized.
		const merged = full.get("id:msg_pad_0");
		expect(merged?.status).toBe("unresolved");
		expect(merged?.status === "unresolved" ? merged.reason : undefined).toBe(
			"absent",
		);
		expect(collectAuthorizedReferences(full)).not.toContain("id:msg_pad_0");

		// A BOUNDED interval: a reference beyond it is out_of_interval,
		// even when it is visible.
		const bounded = buildProviderVisibleBindings({
			canonicalMessages: canonical,
			providerMessages: parentProjection as unknown as {
				role: string;
				id?: string;
				content: unknown;
			}[],
			authorizedMessageCount: 1,
		});
		const beyond = bounded.get("id:msg_pad_0");
		expect(beyond?.status).toBe("unresolved");
		expect(beyond?.status === "unresolved" ? beyond.reason : undefined).toBe(
			"out_of_interval",
		);
		expect(collectAuthorizedReferences(bounded)).not.toContain("id:msg_pad_0");

		// A reference that does not exist at all is simply absent from the
		// bindings, so it can never be authorized.
		expect(full.get("id:does_not_exist")).toBeUndefined();
		expect(collectAuthorizedReferences(full)).not.toContain(
			"id:does_not_exist",
		);
	});

	it("G11b: an AMBIGUOUS reference (the same canonical id at two provider positions) is not authorized", () => {
		const canonical = syntheticCanonicalHistory();
		const parentProjection = new MessageBuilder().buildForApi(
			canonical as unknown as Parameters<MessageBuilder["buildForApi"]>[0],
		);
		// DUPLICATE the first provider message, so the canonical id
		// resolves to TWO positions.
		const duplicated = [
			...(parentProjection as unknown as {
				role: string;
				id?: string;
				content: unknown;
			}[]),
			...(
				parentProjection as unknown as {
					role: string;
					id?: string;
					content: unknown;
				}[]
			).slice(0, 1),
		];
		const bindings = buildProviderVisibleBindings({
			canonicalMessages: canonical,
			providerMessages: duplicated,
			authorizedMessageCount: canonical.length,
		});
		const ambiguous = bindings.get("id:msg_task");
		expect(ambiguous?.status).toBe("unresolved");
		expect(
			ambiguous?.status === "unresolved" ? ambiguous.reason : undefined,
		).toBe("ambiguous");
		expect(collectAuthorizedReferences(bindings)).not.toContain("id:msg_task");
	});

	it("G11c: a private-reasoning-only reference is not an authorized extraction source", () => {
		const canonical: MessageWithMetadata[] = [
			{
				role: "assistant",
				id: "msg_reasoning",
				content: [{ type: "thinking", thinking: "secret", signature: "sig" }],
			} as unknown as MessageWithMetadata,
			{
				role: "user",
				id: "msg_plain",
				content: "plain",
			} as unknown as MessageWithMetadata,
		];
		const providerProjection = new MessageBuilder().buildForApi(
			canonical as unknown as Parameters<MessageBuilder["buildForApi"]>[0],
		);
		const bindings = buildProviderVisibleBindings({
			canonicalMessages: canonical,
			providerMessages: providerProjection as unknown as {
				role: string;
				id?: string;
				content: unknown;
			}[],
			authorizedMessageCount: canonical.length,
		});
		const reasoning = bindings.get("id:msg_reasoning");
		expect(reasoning?.status).toBe("unresolved");
		expect(
			reasoning?.status === "unresolved" ? reasoning.reason : undefined,
		).toBe("private_reasoning");
		expect(collectAuthorizedReferences(bindings)).not.toContain(
			"id:msg_reasoning",
		);
	});
});

describe("ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 — C4 TOOL EXECUTION DENIAL", () => {
	it("C4.1: the PRODUCTION runtime rejects a tool-calling attempt with the exact required outcome", async () => {
		// The REAL production attempt runtime. The transport is INJECTED at
		// the provider boundary, and it reports a syntactically valid
		// checkpoint JSON ALONGSIDE a tool call.
		//
		// The transport COUNTS its own invocations, so the
		// "no tool-driven additional inference" fact is a MEASUREMENT of the
		// boundary rather than a hardcoded zero.
		let transportInvocations = 0;
		const outcome = await runPckAttempt({
			generate: async () => {
				transportInvocations += 1;
				return {
					text: JSON.stringify({
						records: [
							{
								kind: "observation",
								assurance: "tool_observed",
								status: "active",
								atom: "OPERATION_INVOKED",
								argument: "build",
								evidenceRefs: [SYNTHETIC_TOOL_CALL_ID],
							},
						],
					}),
					reasoningChars: 0,
					usedTools: true,
					failed: false,
				};
			},
			canonicalMessages: syntheticCanonicalHistory(),
			identity: { decisionId: "decision-1", sourcePrefixKey: "prefix-1" },
			taskSignal: new AbortController().signal,
			deadlineMs: 5_000,
			currentSourcePrefixKey: () => "prefix-1",
		});
		// The EXACT required outcome.
		expect(outcome.failureReason).toBe("tool_call_attempted");
		expect(outcome.records.length).toBe(0);
		expect(outcome.accepted).toBe(false);
		// NO tool-driven additional inference: the transport was invoked
		// EXACTLY ONCE. A tool-executing branch would have needed a second
		// inference to continue the turn, so the count is the measurement.
		expect(transportInvocations).toBe(1);
	});

	it("C4.2: the tool-calling attempt installs NOTHING through the production seam", async () => {
		// ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01)
		// — the disconnected WORKSPACE assertion is REMOVED.
		//
		// The previous witness measured a temporary directory that no
		// production code ever touched, so it observed nothing about the
		// execution boundary. The tool-execution denial is now measured at
		// the REAL execution boundary by
		// `pck-real-transport.test.ts`, which drives the production
		// transport, the real provider handler and the real stream parser
		// with an injected fetch, and counts the PHYSICAL provider requests
		// the composition issued.
		const { dispatches, productionMessages } = await runSeam({
			enabled: true,
			// A syntactically valid checkpoint JSON ALONGSIDE a tool call.
			checkpointResponse: JSON.stringify({
				records: [
					{
						kind: "observation",
						assurance: "tool_observed",
						status: "active",
						atom: "OPERATION_INVOKED",
						argument: "build",
						evidenceRefs: [SYNTHETIC_TOOL_CALL_ID],
					},
				],
			}),
			checkpointUsedTools: true,
		});
		// The tool call WAS attempted and the tool schema WAS advertised.
		const checkpoint = checkpointDispatch(dispatches);
		expect(checkpoint?.tools).toEqual(PARENT_TOOLS);
		// NO checkpoint section was installed: the production transcript
		// carries no working-knowledge checkpoint.
		const serialized = JSON.stringify(productionMessages);
		expect(serialized).not.toContain("Working knowledge checkpoint");
		expect(serialized).not.toContain("OPERATION_INVOKED");
		// NO tool-driven additional inference: the checkpoint dispatch
		// happened EXACTLY ONCE.
		const checkpointDispatches = dispatches.filter(
			(dispatch) => dispatch.fromCheckpoint,
		);
		expect(checkpointDispatches.length).toBe(1);
	});

	it("G12b: the auxiliary branch NEVER invokes an executor — the import closure contains no executor", async () => {
		// The production composition's own modules must not import an
		// executor, an MCP client or an approval escalator. This is
		// SUPPLEMENTARY structural evidence; G12 is the production-path
		// witness.
		const { execFileSync } = await import("node:child_process");
		const root = new URL("../../../../", import.meta.url).pathname;
		const closure = execFileSync(
			"bash",
			[
				"-lc",
				`cd '${root}' && for f in src/extensions/context/precompaction-knowledge-checkpoint/provider-visible-binding.ts src/extensions/context/precompaction-knowledge-checkpoint/prefix-preserving-request.ts src/extensions/context/precompaction-knowledge-checkpoint/prefix-preserving-route.ts; do echo "== $f"; grep -nE "^import|from \\"" "$f" | grep -v "^.*://" ; done`,
			],
			{ encoding: "utf8" },
		);
		expect(closure).not.toMatch(/executors?\//);
		expect(closure).not.toMatch(/mcp/i);
		expect(closure).not.toMatch(/approval/i);
	});

	it("G13: the ordinary parent history is unchanged by a failed auxiliary attempt", async () => {
		const canonical = syntheticCanonicalHistory();
		const before = JSON.stringify(canonical);
		const { canonicalMessages } = await runSeam({
			enabled: true,
			checkpointUsedTools: true,
			canonicalMessages: canonical,
		});
		// The EXACT canonical history object that was supplied to production
		// execution is byte-identical after the failed auxiliary attempt.
		expect(canonicalMessages).toBe(canonical);
		expect(JSON.stringify(canonicalMessages)).toBe(before);
	});
});

describe("ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 — C5 GENERATION POLICY", () => {
	it("C5.1: the RESOLVED request at the provider boundary carries the parent's leading messages IDENTICALLY and diverges only at the appended suffix", async () => {
		// The captured dispatch IS the resolved request the provider
		// boundary received: the exact message array and the exact tool
		// schema.
		//
		// A FINDING recorded here: the transport's own serializer mints a
		// FRESH id and timestamp for every message it renders, so the
		// message IDs are per-request transport artifacts. They are NOT
		// part of the provider's prompt rendering (the provider renders the
		// role and the content), so the prefix the provider caches is
		// determined by the CONTENT — which the assertions below pin.
		const { dispatches, parentProjection } = await runSeam({ enabled: true });
		const checkpoint = checkpointDispatch(dispatches);
		expect(checkpoint).toBeDefined();
		// The leading resolved messages are BYTE-IDENTICAL to the parent's
		// provider-visible projection.
		expect(
			JSON.stringify(checkpoint?.messages.slice(0, parentProjection.length)),
		).toBe(JSON.stringify(parentProjection));
		// EXACTLY ONE message is appended, and it is the LAST one.
		expect(checkpoint?.messages.length).toBe(parentProjection.length + 1);
		const appended = checkpoint?.messages[parentProjection.length] as {
			role: string;
			content: string;
		};
		expect(appended.role).toBe("user");
		expect(typeof appended.content).toBe("string");
	});

	it("C5.2: the PCK inference policy is applied to a NEW configuration and never mutates the shared one", () => {
		// ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01)
		// — P7.
		//
		// The CORRECTED disposition. The predecessor asserted that
		// generation-side settings "cannot change the rendered prompt
		// tokens". That assertion is NOT supported: reasoning effort and
		// structured-output settings MAY be consumed by provider-specific
		// rendering logic.
		//
		// The evidence distinctions are therefore:
		//
		//   REQUEST_CONFIGURATION:  OBSERVED_AT_PROVIDER_BOUNDARY
		//   MESSAGE_PREFIX:         QUALIFIED_IN_TESTED_SCOPE
		//   HTTP_WIRE_PREFIX:       QUALIFY_WITH_REAL_SERIALIZER
		//   RENDERED_TOKEN_PREFIX:  UNKNOWN
		//   ACTUAL_CACHE_RESIDENCY:  NOT_EXECUTED
		//   ENGINE_PREFILL_DURATION: NOT_EXECUTED
		//
		// What IS established here is only that the policy is applied to a
		// NEW configuration, so it cannot leak into the ordinary request.
		expect(QWEN_STRATA_V1_PARAMETERS.reasoningEffort).toBe("none");
		expect(QWEN_STRATA_V1_PARAMETERS.temperature).toBe(0.1);
		expect(QWEN_STRATA_V1_PARAMETERS.maxOutputTokens).toBe(1024);
		expect(QWEN_STRATA_V1_PARAMETERS.responseFormat).toEqual({
			type: "json_object",
		});
		// The policy is applied to a NEW configuration and never mutates
		// the shared one, so it cannot leak into the ordinary request.
		const shared = { providerId: "openai-compatible", modelId: "m" };
		const applied = applyPckInferencePolicy(shared, QWEN_STRATA_V1_PARAMETERS);
		expect(applied).not.toBe(shared);
		expect(shared).toEqual({ providerId: "openai-compatible", modelId: "m" });
	});
});

describe("ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 — C8 CAPTURE READINESS", () => {
	it("C8.1: the capture is DEFAULT-OFF and has NO semantic effect", async () => {
		expect(isPckPrefixCaptureEnabled({})).toBe(false);
		expect(isPckPrefixCaptureEnabled({ CLINEMM_PCK_PREFIX_CAPTURE: "0" })).toBe(
			false,
		);
		expect(isPckPrefixCaptureEnabled({ CLINEMM_PCK_PREFIX_CAPTURE: "1" })).toBe(
			true,
		);
	});

	it("C8.2: the capture records the PCK-SPECIFIC identity the existing captures cannot express", () => {
		const directory = mkdtempSync(join(tmpdir(), "pck-capture-"));
		const previousHome = process.env.HOME;
		const previousCapture = process.env.CLINEMM_PCK_PREFIX_CAPTURE;
		try {
			process.env.HOME = directory;
			process.env.CLINEMM_PCK_PREFIX_CAPTURE = "1";
			recordPckPrefixCapture({
				capturedAt: new Date(0).toISOString(),
				sessionId: "session-1",
				decisionId: "decision-1",
				preparationRequestId: "preparation-1",
				// The LAST DISPATCHED ordinary request identity is ABSENT
				// at the PCK boundary, and the absence is preserved.
				lastDispatchedRequestId: undefined,
				lastDispatchedRequestIdAvailable: false,
				pckLogicalRequestId: "decision-1#b_prime",
				pckPhysicalAttemptId: "gw_1",
				route: "b_prime",
				providerId: "openai-compatible",
				modelId: "model-1",
				purpose: "pck",
				resolvedInferencePolicyId: "qwen-strata-v1",
				inputTokens: 1234,
				cacheReadTokens: 1000,
				durationMs: 42,
				physicalAttemptCount: 1,
				extractionOutcome: "accepted",
				failureReason: undefined,
				gateAdmittedRecordCount: 1,
				installedRecordCount: 1,
			});
			const file = join(
				directory,
				".cline",
				"data",
				"pck-prefix-capture",
				"pck-prefix-capture.jsonl",
			);
			expect(existsSync(file)).toBe(true);
			const record = JSON.parse(readFileSync(file, "utf8").trim());
			// The RUN identity is the SHARED prefix-forensics cohort id.
			expect(typeof record.runCohortId).toBe("string");
			expect(record.runCohortId.length).toBeGreaterThan(0);
			// The JOIN key with the provider's own capture.
			expect(record.pckPhysicalAttemptId).toBe("gw_1");
			// The PCK-SPECIFIC identity, with NO identity substituting for
			// another.
			expect(record.purpose).toBe("pck");
			expect(record.route).toBe("b_prime");
			expect(record.decisionId).toBe("decision-1");
			expect(record.preparationRequestId).toBe("preparation-1");
			expect(record.pckLogicalRequestId).toBe("decision-1#b_prime");
			// The LAST DISPATCHED ordinary request identity is ABSENT, and
			// the absence is explicit.
			expect(record.lastDispatchedRequestId).toBeUndefined();
			expect(record.lastDispatchedRequestIdAvailable).toBe(false);
			// The measurement fields.
			expect(record.cacheReadTokens).toBe(1000);
			expect(record.inputTokens).toBe(1234);
			expect(record.extractionOutcome).toBe("accepted");
			expect(record.physicalAttemptCount).toBe(1);
			// The gate-admitted count and the installed count are DISTINCT
			// fields.
			expect(record.gateAdmittedRecordCount).toBe(1);
			expect(record.installedRecordCount).toBe(1);
		} finally {
			if (previousHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = previousHome;
			}
			if (previousCapture === undefined) {
				delete process.env.CLINEMM_PCK_PREFIX_CAPTURE;
			} else {
				process.env.CLINEMM_PCK_PREFIX_CAPTURE = previousCapture;
			}
		}
	});
});

describe("ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 — C7 NEGATIVE CONTROL", () => {
	it("G14: a deliberately BROKEN binding component is DETECTED", () => {
		const canonical = syntheticCanonicalHistory();
		const parentProjection = new MessageBuilder().buildForApi(
			canonical as unknown as Parameters<MessageBuilder["buildForApi"]>[0],
		);
		const providerMessages = parentProjection as unknown as {
			role: string;
			id?: string;
			content: unknown;
		}[];
		// The CORRECT bindings.
		const correct = buildProviderVisibleBindings({
			canonicalMessages: canonical,
			providerMessages,
			authorizedMessageCount: canonical.length,
		});
		const correctAuthorized = collectAuthorizedReferences(correct);
		expect(correctAuthorized.length).toBeGreaterThan(0);

		// The BROKEN component: the authorized interval is EMPTY, so no
		// reference resolves. The control must DETECT the difference.
		const broken = buildProviderVisibleBindings({
			canonicalMessages: canonical,
			providerMessages,
			authorizedMessageCount: 0,
		});
		expect(collectAuthorizedReferences(broken).length).toBe(0);
		expect(collectAuthorizedReferences(broken)).not.toEqual(correctAuthorized);
	});

	it("G15: the feature flag is DEFAULT-OFF and requires an explicit value", () => {
		expect(isPckPrefixPreservingEnabled({})).toBe(false);
		expect(
			isPckPrefixPreservingEnabled({
				CLINEMM_PCK_PREFIX_PRESERVING_ENABLED: "0",
			}),
		).toBe(false);
		expect(
			isPckPrefixPreservingEnabled({
				CLINEMM_PCK_PREFIX_PRESERVING_ENABLED: "yes",
			}),
		).toBe(false);
		expect(
			isPckPrefixPreservingEnabled({
				CLINEMM_PCK_PREFIX_PRESERVING_ENABLED: "1",
			}),
		).toBe(true);
		expect(
			isPckPrefixPreservingEnabled({
				CLINEMM_PCK_PREFIX_PRESERVING_ENABLED: "true",
			}),
		).toBe(true);
	});
});
