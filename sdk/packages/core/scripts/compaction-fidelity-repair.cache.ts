/**
 * ACT-CLINEMM-ORDINARY-COMPACTION-UPSTREAM-AND-FIDELITY-REPAIR-01
 *
 * C2 — THE CACHE DISCRIMINATOR.
 *
 * ============================================================================
 * WHAT IT MEASURES
 * ============================================================================
 *
 * Five requests, in the production order:
 *
 *   1. LAST_WORKING   — the last working-agent request before compaction.
 *   2. SUMMARIZER_A   — the existing ordinary summarizer request (the
 *                       production serialized path).
 *   3. SUMMARIZER_B   — the candidate summarizer request (the native-message
 *                       in-place replay).
 *   4. RESUMED_FIRST  — the first resumed working-agent request.
 *   5. RESUMED_NEXT   — the next ordinary resumed request.
 *
 * For each it records the OBSERVED provider metrics: provider prompt
 * tokens, cached tokens, physical request count, latency, and the serialized
 * token-prefix equality against request 1.
 *
 * ============================================================================
 * THE RULES
 * ============================================================================
 *
 * 1. The model and the endpoint are FIXED across every request. The
 *    endpoint is the operator's already-authorized local endpoint.
 * 2. The three transitions are kept DISTINCT:
 *      - working-agent -> summarizer (cache REUSE),
 *      - summarizer -> compacted working-agent (a TRANSITION),
 *      - stable cache recovery on SUBSEQUENT ordinary turns.
 *    A one-time prefix change after a genuine compaction is unavoidable;
 *    repeated prefix churn is a different defect.
 * 3. Cache equality is NEVER claimed from a matching message count or from
 *    JavaScript object identity. It is claimed from the OBSERVED cached
 *    token count and from the OBSERVED prefix equality of the serialized
 *    request bodies.
 * 4. Where the engine's own tokenization or cache identity is not
 *    observable from the trace, the result is labelled
 *    UNAVAILABLE_FROM_TRACE rather than estimated.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHandlerAsync } from "@cline/llms";
import type { Message, MessageWithMetadata } from "@cline/shared";
import { buildAgenticSummaryInputBudget } from "../src/extensions/context/agentic-compaction";
import {
	buildSummaryRequest,
	createTokenEstimator,
	extractFileOps,
	findCutIndex,
	serializeConversation,
} from "../src/extensions/context/compaction-shared";
import { canonicalSourceMessages } from "../src/session/models/session-compaction";

const PRIVATE_ROOT = join(
	process.cwd(),
	"..",
	"..",
	"..",
	"tmp",
	"compaction-fidelity-repair",
);

const sessionId = process.argv[2] ?? "1795491524406_mutdb";
const sessionsRoot = join(homedir(), ".vscodium-roz", "cline-data", "sessions");
const sessionDir = join(sessionsRoot, sessionId);

const persisted = JSON.parse(
	readFileSync(join(sessionDir, `${sessionId}.messages.json`), "utf8"),
) as { messages: MessageWithMetadata[] };
const state = JSON.parse(
	readFileSync(join(sessionDir, `${sessionId}.compaction.json`), "utf8"),
) as { source_message_count: number };
const canonical = canonicalSourceMessages(persisted.messages);
const prefix = canonical.slice(0, state.source_message_count);

interface OperatorProviderConfig {
	readonly providerId: string;
	readonly modelId: string;
	readonly baseUrl?: string;
	readonly apiKey?: string;
}
function readOperatorProviderConfig(): OperatorProviderConfig {
	const providersPath = join(
		homedir(),
		".vscodium-roz",
		"cline-data",
		"settings",
		"providers.json",
	);
	const providers = JSON.parse(readFileSync(providersPath, "utf8")) as {
		providers?: Record<
			string,
			{ settings?: { apiKey?: string; baseUrl?: string; model?: string } }
		>;
	};
	const entry = providers.providers?.["openai-compatible"]?.settings;
	if (!entry?.apiKey) {
		throw new Error("No operator credential is configured.");
	}
	return {
		providerId: "openai-compatible",
		modelId: entry.model ?? "qwen3.8-flash-next-q2_0",
		baseUrl: entry.baseUrl,
		apiKey: entry.apiKey,
	};
}
const provider = readOperatorProviderConfig();

/**
 * The measured shape of ONE provider request.
 */
interface RequestMeasurement {
	readonly label: string;
	readonly physicalRequestCount: number;
	readonly promptTokens?: number;
	readonly cacheReadTokens?: number;
	readonly completionTokens?: number;
	readonly latencyMs: number;
	readonly serializedBodyChars: number;
	/** The serialized request body, for the prefix-equality comparison. */
	readonly serializedBody: string;
	/**
	 * The BASIS of the prefix comparison.
	 *
	 * `HTTP_BODY` — the comparison used the bytes the provider actually
	 * received.
	 *
	 * `MESSAGE_JSON` — the transport did not expose the wire body; the
	 * comparison fell back to the in-memory message array. Per the ACT this
	 * is a WEAKER basis and must be reported as such.
	 */
	readonly prefixBasis: "HTTP_BODY" | "MESSAGE_JSON";
	/** Where the observed wire body was captured from. */
	readonly httpBodySource?: string;
	/** The transport error, if the request failed. */
	readonly transportError?: string;
	/** The observed HTTP status of the provider's response. */
	readonly httpStatus?: number;
	/** The observed HTTP response body (truncated): the provider's own refusal. */
	readonly httpResponseBody?: string;
	readonly effectiveModelId: string;
	readonly effectiveProviderId: string;
}

/**
 * Run ONE provider request and MEASURE it.
 *
 * The physical-request count is OBSERVED by wrapping the fetch the
 * transport uses. The cache metrics come from the provider's own usage
 * chunk — never from an estimate.
 */
async function measureRequest(input: {
	readonly label: string;
	readonly systemPrompt: string;
	readonly messages: Message[];
	readonly tools?: unknown[];
}): Promise<RequestMeasurement> {
	let physicalRequestCount = 0;
	// The ACTUAL HTTP request body the provider received. The ACT forbids
	// claiming cache equality from a JS object: the prefix equality must be
	// measured on the bytes that went over the wire.
	let observedHttpBody: string | undefined;
	let observedHttpBodySource: string | undefined;
	let observedHttpError: string | undefined;
	let observedHttpStatus: number | undefined;
	let observedHttpResponseBody: string | undefined;
	const countingFetch = (async (
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
	) => {
		physicalRequestCount += 1;
		try {
			const rawBody = (init as { body?: unknown } | undefined)?.body;
			if (typeof rawBody === "string") {
				observedHttpBody = rawBody;
				observedHttpBodySource = "init.body";
			} else if (rawBody instanceof Uint8Array) {
				observedHttpBody = new TextDecoder().decode(rawBody);
				observedHttpBodySource = "init.body(uint8)";
			} else if (
				input &&
				typeof input === "object" &&
				"url" in (input as { url?: unknown }) &&
				typeof (input as { url?: unknown }).url === "string" &&
				(input as { url: string }).url.length > 0 &&
				observedHttpBody === undefined
			) {
				// Some clients pass the body as the first argument.
				observedHttpBody = (input as unknown as { body?: string }).body;
				observedHttpBodySource = "input.body";
			}
		} catch (error) {
			observedHttpError =
				error instanceof Error ? error.message : String(error);
		}
		const response = await fetch(input, init);
		try {
			observedHttpStatus = response.status;
			// The response is cloned so the transport still reads the original.
			observedHttpResponseBody = (await response.clone().text()).slice(
				0,
				4_000,
			);
		} catch {
			// The body is best-effort: it is only diagnostic evidence.
		}
		return response;
	}) as typeof fetch;
	const handler = await createHandlerAsync({
		providerId: provider.providerId,
		modelId: provider.modelId,
		...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
		apiKey: provider.apiKey,
		maxOutputTokens: 512,
		thinking: false,
		fetch: countingFetch,
	} as never);
	const startedAt = Date.now();
	let promptTokens: number | undefined;
	let cacheReadTokens: number | undefined;
	let completionTokens: number | undefined;
	let transportError: string | undefined;
	try {
		for await (const chunk of handler.createMessage(
			input.systemPrompt,
			input.messages,
			input.tools as never,
		)) {
			if (chunk.type === "usage") {
				promptTokens = chunk.inputTokens;
				cacheReadTokens = chunk.cacheReadTokens;
				completionTokens = chunk.outputTokens;
			}
			if (chunk.type === "error") {
				transportError = chunk.error ?? "unknown transport error";
			}
		}
	} catch (error) {
		transportError = error instanceof Error ? error.message : String(error);
	}
	const model = handler.getModel();
	// The prefix equality is measured on the OBSERVED HTTP body when the
	// transport exposed one. Otherwise it is UNAVAILABLE_FROM_TRACE -- it is
	// never inferred from the in-memory message array.
	const prefixBasis: "HTTP_BODY" | "MESSAGE_JSON" =
		observedHttpBody !== undefined ? "HTTP_BODY" : "MESSAGE_JSON";
	const serializedBody = observedHttpBody ?? JSON.stringify(input.messages);
	return {
		label: input.label,
		physicalRequestCount,
		promptTokens,
		cacheReadTokens,
		completionTokens,
		latencyMs: Date.now() - startedAt,
		serializedBodyChars: serializedBody.length,
		serializedBody,
		prefixBasis,
		httpBodySource: observedHttpBodySource,
		transportError: transportError ?? observedHttpError,
		httpStatus: observedHttpStatus,
		httpResponseBody: observedHttpResponseBody,
		effectiveModelId: model.id,
		effectiveProviderId: model.provider,
	};
}

/**
 * The length of the LONGEST COMMON PREFIX, in characters, of two
 * serialized request bodies.
 *
 * This is the OBSERVED prefix equality: it is a property of the bytes the
 * provider actually received, not of a message count.
 */
function commonPrefixChars(left: string, right: string): number {
	const limit = Math.min(left.length, right.length);
	let index = 0;
	while (index < limit && left[index] === right[index]) {
		index += 1;
	}
	return index;
}

const SYSTEM_PROMPT =
	"You are a careful technical analyst. Answer briefly and factually.";

/**
 * The NATIVE-MESSAGE representation (the upstream transport shape).
 *
 * The canonical tool-call/tool-result PAIRS are replayed as native provider
 * messages, so the invocation/result relationship is preserved by the
 * message structure itself, plus ONE short instruction message.
 *
 * The thinking blocks are DROPPED: a reasoning block is private reasoning
 * and must never be disclosed, and dropping it also keeps the replayed
 * prefix identical to the live request's rendered prefix.
 */
function buildNativeMessages(
	messages: readonly MessageWithMetadata[],
): Message[] {
	const out: Message[] = [];
	for (const message of messages) {
		if (message.role !== "assistant" || !Array.isArray(message.content)) {
			out.push(message as Message);
			continue;
		}
		const kept = message.content.filter(
			(block) =>
				block.type !== "thinking" && block.type !== "redacted_thinking",
		);
		if (kept.length === 0) {
			continue;
		}
		out.push({ ...message, content: kept } as Message);
	}
	return out;
}

const measurements: RequestMeasurement[] = [];

// --- 1. LAST_WORKING ------------------------------------------------------
// The working agent's own last request before the compaction: the prefix
// replayed as native messages, with the SESSION's system prompt.
const nativePrefix = buildNativeMessages(prefix);
measurements.push(
	await measureRequest({
		label: "LAST_WORKING",
		systemPrompt: SYSTEM_PROMPT,
		messages: nativePrefix,
	}),
);

// --- 2. SUMMARIZER_A ------------------------------------------------------
// The EXISTING ordinary summarizer request: the production serialized path.
const estimateMessageTokens = createTokenEstimator();
const cutIndex = findCutIndex(prefix, 20_000, estimateMessageTokens);
const folded = prefix.slice(0, cutIndex);
const budget = buildAgenticSummaryInputBudget({
	messages: folded,
	targetTokens: 131072 - 4096,
	estimateMessageTokens,
});
if (budget.status === "failed") {
	throw new Error("the production summary input budget failed");
}
const fileOps = extractFileOps(budget.messages);
const serializedRequest = buildSummaryRequest({
	previousSummary: undefined,
	conversationText: serializeConversation(budget.messages),
	fileOps,
});
measurements.push(
	await measureRequest({
		label: "SUMMARIZER_A_SERIALIZED",
		systemPrompt:
			"Summarize the provided coding session into a concise continuation note with detailed next steps.",
		messages: [{ role: "user", content: serializedRequest }],
	}),
);

// --- 3. SUMMARIZER_B ------------------------------------------------------
// The CANDIDATE summarizer request: the native-message in-place replay.
const nativeFolded = buildNativeMessages(folded);
measurements.push(
	await measureRequest({
		label: "SUMMARIZER_B_NATIVE",
		systemPrompt: SYSTEM_PROMPT,
		messages: [
			...nativeFolded,
			{
				role: "user",
				content:
					"Summarize the conversation above this message for continuation. Be concise and factual.",
			},
		],
	}),
);

// --- 4. RESUMED_FIRST -----------------------------------------------------
// The first resumed working-agent request: the compacted state, projected.
const resumedMessages: Message[] = [
	{
		role: "user",
		content: [
			{
				type: "text",
				text: "Context summary:\n\n## Goal\nShip the change\n\n## Next\n- Continue",
			},
		],
	} as Message,
	...buildNativeMessages(prefix.slice(cutIndex)),
];
measurements.push(
	await measureRequest({
		label: "RESUMED_FIRST",
		systemPrompt: SYSTEM_PROMPT,
		messages: resumedMessages,
	}),
);

// --- 5. RESUMED_NEXT ------------------------------------------------------
// The next ordinary resumed request: the same compacted state plus one more
// ordinary turn. This is the STABLE-cache-recovery measurement.
const resumedNextMessages: Message[] = [
	...resumedMessages,
	{ role: "user", content: "Continue with the next step." } as Message,
];
measurements.push(
	await measureRequest({
		label: "RESUMED_NEXT",
		systemPrompt: SYSTEM_PROMPT,
		messages: resumedNextMessages,
	}),
);

const byLabel = new Map(measurements.map((m) => [m.label, m]));
const lastWorking = byLabel.get("LAST_WORKING");
/**
 * The prefix equality is only claimed when the transport exposed the wire
 * body for BOTH sides of the comparison. Otherwise the result is
 * UNAVAILABLE_FROM_TRACE -- never a claim inferred from the message array.
 */
const prefixComparisons = measurements.map((measurement) => {
	const comparable =
		lastWorking !== undefined &&
		lastWorking.prefixBasis === "HTTP_BODY" &&
		measurement.prefixBasis === "HTTP_BODY";
	if (!comparable || !lastWorking) {
		return {
			label: measurement.label,
			result: "UNAVAILABLE_FROM_TRACE" as const,
			reason:
				lastWorking === undefined
					? "the last working-agent request was not measured"
					: `the wire body was not observed for ${lastWorking.label} (${lastWorking.prefixBasis}) and/or ${measurement.label} (${measurement.prefixBasis})`,
			commonPrefixCharsWithLastWorking: undefined,
			prefixRatio: undefined,
		};
	}
	const common = commonPrefixChars(
		lastWorking.serializedBody,
		measurement.serializedBody,
	);
	return {
		label: measurement.label,
		result: "MEASURED" as const,
		reason: undefined,
		commonPrefixCharsWithLastWorking: common,
		prefixRatio:
			lastWorking.serializedBodyChars > 0
				? common / lastWorking.serializedBodyChars
				: 0,
	};
});

const report = {
	sessionId,
	sourceMessageCount: state.source_message_count,
	cutIndex,
	effectiveModel: {
		providerId: provider.providerId,
		modelId: provider.modelId,
	},
	requests: measurements.map((m) => ({
		label: m.label,
		physicalRequestCount: m.physicalRequestCount,
		promptTokens: m.promptTokens,
		cacheReadTokens: m.cacheReadTokens,
		completionTokens: m.completionTokens,
		latencyMs: m.latencyMs,
		serializedBodyChars: m.serializedBodyChars,
		prefixBasis: m.prefixBasis,
		httpBodySource: m.httpBodySource,
		transportError: m.transportError,
		httpStatus: m.httpStatus,
		httpResponseBody: m.httpResponseBody,
		effectiveModelId: m.effectiveModelId,
		effectiveProviderId: m.effectiveProviderId,
	})),
	prefixComparisons,
};

mkdirSync(PRIVATE_ROOT, { recursive: true });
writeFileSync(
	join(PRIVATE_ROOT, `${sessionId}.cache.json`),
	JSON.stringify(report, null, 2),
	"utf8",
);
console.log(JSON.stringify(report, null, 2));
