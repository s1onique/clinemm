/**
 * ACT-CLINEMM-COMPACTION-UTILITY-FINAL-DISCRIMINATOR-01
 *
 * C3 — THE BEHAVIOURAL PROBE.
 *
 * ============================================================================
 * WHAT IT DOES
 * ============================================================================
 *
 * It asks the three decisive questions against ONE assembled arm per
 * request, and captures the answer together with the measured inference
 * economics.
 *
 * The campaign is BOUNDED: one request per arm, and at most one repeat per
 * arm. The maximum campaign is six physical inference requests. No
 * summarization request is made at any point.
 *
 * ============================================================================
 * THE TWO HARD RULES
 * ============================================================================
 *
 *   1. THE ORACLE IS NEVER IN THE PROMPT. The prompt carries the CONTEXT
 *      and the QUESTION. `assertNoOracleLeakage()` is the machine witness.
 *
 *   2. EVERY ARM IS THE SAME MODEL, THE SAME ENDPOINT, THE SAME REASONING
 *      POLICY and THE SAME GENERATION BUDGET. Only the CONTEXT differs.
 *
 * ============================================================================
 * WHAT IT DOES NOT DO
 * ============================================================================
 *
 *   - It does NOT run a summarization request.
 *   - It does NOT modify the arms.
 *   - It does NOT write a raw prompt, a raw context or a raw model response
 *      outside the GITIGNORED private tree.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHandlerAsync } from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import { W1_KNOWLEDGE_ORACLE } from "../src/extensions/context/knowledge-loss-discriminator/oracle";
import {
	assertNoOracleLeakage,
	PROBE_INSTRUCTION,
	renderContextBlock,
} from "../src/extensions/context/knowledge-loss-discriminator/probe-harness";

const SESSION_ID = process.argv[2] ?? "1795491524406_mutdb";
const ARM_ID = process.argv[3] ?? "A";
const REPEAT = Number(process.argv[4] ?? 1);

const PRIVATE_ROOT = join(
	process.cwd(),
	"..",
	"..",
	"..",
	"tmp",
	"utility-final-discriminator",
);

if (!["A", "B", "C"].includes(ARM_ID)) {
	console.error("usage: probe.ts <sessionId> <A|B|C> [repeat]");
	process.exit(2);
}

/**
 * The operator's provider configuration. The credential is read from the
 * operator's own settings and is NEVER written to the report.
 */
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
 * The ARM's CONTEXT: the assembled, internally consistent, production-
 * projected continuation.
 */
const messages = JSON.parse(
	readFileSync(
		join(PRIVATE_ROOT, `${SESSION_ID}.arm-${ARM_ID}.messages.json`),
		"utf8",
	),
) as MessageWithMetadata[];
const contextBlock = renderContextBlock(messages);

/**
 * The THREE decisive questions, rendered as ONE structured question.
 *
 * The questions are the ORACLE's own probes. They contain no answers. The
 * answer is requested in a fixed, parseable shape so that the evaluation
 * does not depend on free-form prose.
 */
const DECISIVE_IDS = ["O1", "O4", "O7"] as const;
const questions = DECISIVE_IDS.map(
	(id) => W1_KNOWLEDGE_ORACLE.find((item) => item.id === id)?.probe ?? "",
).filter((probe) => probe.length > 0);

const question = [
	"Answer these three questions about the investigation that was under way.",
	"Each question is independent. Use ONLY what the CONTEXT establishes.",
	"If the CONTEXT does not establish an answer, say so explicitly for that question and name what is missing.",
	"Answer in exactly this shape, with one line per question and nothing else:",
	"",
	"Q1: <answer to question 1>",
	"Q2: <answer to question 2>",
	"Q3: <answer to question 3>",
	"",
	"THE THREE QUESTIONS",
	...questions.map((probe, index) => `Q${index + 1}: ${probe}`),
].join("\n");

/**
 * The ORACLE LEAKAGE witness, over the ACTUAL prompt.
 */
const prompt = `${PROBE_INSTRUCTION}\n\n=== CONTEXT ===\n${contextBlock}\n\n=== QUESTION ===\n${question}`;
const leak = assertNoOracleLeakage({
	prompt,
	oraclePropositions: W1_KNOWLEDGE_ORACLE.map((i) => i.proposition),
	oracleCriteria: W1_KNOWLEDGE_ORACLE.flatMap((i) => i.correctAnswerCriteria),
});
if (leak.leaked) {
	throw new Error(
		`the oracle leaked into the prompt: ${JSON.stringify(leak.leakedTerms)}. The probe would be invalid.`,
	);
}

/**
 * The PHYSICAL request count is OBSERVED by wrapping the `fetch` the
 * transport uses. It is the transport the production runtime uses.
 */
let physicalRequestCount = 0;
const countingFetch = (async (...args: Parameters<typeof fetch>) => {
	physicalRequestCount += 1;
	return fetch(...args);
}) as typeof fetch;

const handler = await createHandlerAsync({
	providerId: provider.providerId,
	modelId: provider.modelId,
	...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
	apiKey: provider.apiKey,
	// The SAME generation budget for every arm. The probe needs room for a
	// specific, qualified answer; the budget is the PROBE's own budget, and
	// it is IDENTICAL across the arms.
	//
	// The budget is 2048 because the first arm A run at 1536 reported
	// `finishReason=max_tokens`: a truncated answer would be a MEASUREMENT
	// ARTIFACT, and it would penalise whichever arm happened to write the
	// longest answer. The budget must not be the binding constraint in any
	// arm, or the comparison is not over the CONTEXT.
	maxOutputTokens: 2048,
	thinking: false,
	fetch: countingFetch,
} as never);

const startedAt = Date.now();
let answer = "";
let providerFailed = false;
let promptTokens: number | undefined;
let cacheReadTokens: number | undefined;
let completionTokens: number | undefined;
let finishReason: string | undefined;
for await (const chunk of handler.createMessage(
	"You are a careful technical analyst.",
	[{ role: "user", content: prompt }],
)) {
	if (chunk.type === "text") {
		answer += chunk.text;
		continue;
	}
	if (chunk.type === "usage") {
		promptTokens = chunk.inputTokens;
		cacheReadTokens = chunk.cacheReadTokens;
		completionTokens = chunk.outputTokens;
		continue;
	}
	if (chunk.type === "done") {
		providerFailed = !chunk.success;
		finishReason = chunk.incompleteReason ?? (chunk.success ? "stop" : "error");
	}
}
const latencyMs = Date.now() - startedAt;

/**
 * The per-question SPLIT of the structured answer.
 *
 * The split is mechanical: the answer is requested as `Q1:`/`Q2:`/`Q3:`
 * lines, so the answer is cut at those markers. The content is NOT judged
 * here — the direct source adjudication is the decisive oracle — but the
 * split is what makes the per-question scoring mechanical.
 */
function splitAnswer(text: string): Record<string, string> {
	const parts: Record<string, string> = {};
	const pattern = /^Q([123])\s*[:.]/gm;
	const markers: { id: string; at: number }[] = [];
	let match = pattern.exec(text);
	while (match) {
		markers.push({ id: `Q${match[1]}`, at: match.index });
		match = pattern.exec(text);
	}
	for (const [index, marker] of markers.entries()) {
		const end =
			index + 1 < markers.length ? markers[index + 1].at : text.length;
		parts[marker.id] = text.slice(marker.at, end).trim();
	}
	return parts;
}
const answers = splitAnswer(answer);

const report = {
	sessionId: SESSION_ID,
	arm: ARM_ID,
	repeat: REPEAT,
	providerModel: provider.modelId,
	providerBaseUrl: provider.baseUrl,
	contextBlockChars: contextBlock.length,
	serializedPromptChars: prompt.length,
	questionCount: questions.length,
	leakageWitness: { leaked: leak.leaked, leakedTerms: leak.leakedTerms },
	measurement: {
		physicalRequestCount,
		promptTokens,
		cacheReadTokens,
		completionTokens,
		latencyMs,
		finishReason,
		providerFailed,
	},
	answers,
	answerChars: answer.length,
};

mkdirSync(PRIVATE_ROOT, { recursive: true });
writeFileSync(
	join(PRIVATE_ROOT, `${SESSION_ID}.probe-${ARM_ID}-r${REPEAT}.json`),
	JSON.stringify({ ...report, rawAnswer: answer }, null, 2),
);

console.log(
	JSON.stringify(
		{
			arm: ARM_ID,
			repeat: REPEAT,
			providerModel: provider.modelId,
			contextBlockChars: contextBlock.length,
			serializedPromptChars: prompt.length,
			leakageWitness: report.leakageWitness,
			measurement: report.measurement,
			answerChars: answer.length,
			answers,
		},
		null,
		2,
	),
);
