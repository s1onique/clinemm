/**
 * ACT-CLINEMM-COMPACTION-FACTUAL-PRESERVATION-REPAIR-01
 *
 * C6 — THE LIVE QUALIFICATION OF THE CANDIDATE LADDER.
 *
 * ============================================================================
 * WHAT IT MEASURES
 * ============================================================================
 *
 * The candidate ladder, over the FROZEN W1 workload, against the REAL
 * operator endpoint:
 *
 *   A  — the ordinary compaction (production omission policy).
 *   B  — evidence-enhanced summarization with a factual-preservation
 *        instruction. The cheapest candidate.
 *   C  — the hybrid extractive/abstractive preservation: the ordinary
 *        summary PLUS a deterministic carry-forward of approved,
 *        source-bound evidence.
 *
 * Every arm runs the SAME production replay over the SAME frozen prefix with
 * the SAME summarizer model, the SAME output budget and the SAME request
 * count. The ONLY difference is the evidence policy.
 *
 * ============================================================================
 * THE BUDGET IS MEASURED ON THE COMPLETE REQUEST
 * ============================================================================
 *
 * The predecessor ACT's budget projection happened BEFORE the evidence
 * fragments were appended, so a bounded FRAGMENT count was measured against
 * a request that was not bounded. This script measures the COMPLETE request:
 * the previous summary, the conversation text, the evidence, the files
 * section, the system prompt and the reserved output tokens.
 *
 * ============================================================================
 * CONFIDENTIALITY
 * ============================================================================
 *
 * Every raw history, rendered context, prompt and answer stays in the
 * GITIGNORED `tmp/` tree. The script prints AGGREGATE, non-reversible facts.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MessageWithMetadata } from "@cline/shared";
import { formatDisplayUserInput } from "@cline/shared";
import { buildAgenticSummaryInputBudget } from "../src/extensions/context/agentic-compaction";
import {
	buildContaminatedHistory,
	runNegativeControl,
	runPositiveControl,
} from "../src/extensions/context/bounded-evidence-contract/boundary-witness";
import { computeSourcePrefixHash } from "../src/extensions/context/bounded-evidence-contract/source-prefix";
import {
	buildSummaryMessage,
	buildSummaryRequest,
	createTokenEstimator,
	DEFAULT_PRESERVE_RECENT_TOKENS,
	ensureFilesSection,
	estimateTokens,
	extractFileOps,
	findCutIndex,
	findLatestSummaryIndex,
	getCompactionSummaryMetadata,
	resolveSummarizerConfig,
	serializeConversation,
} from "../src/extensions/context/compaction-shared";
import { applyVerifiedEvidenceToCompactedMessages } from "../src/extensions/context/evidence-continuity";
import { decomposeProviderContinuation } from "../src/extensions/context/knowledge-loss-discriminator/context-parts";
import {
	correctScoreForFactualVerdict,
	decideFactualVerdict,
} from "../src/extensions/context/knowledge-loss-discriminator/factual-preservation";
import { scoreContext } from "../src/extensions/context/knowledge-loss-discriminator/inventory";
import { W1_KNOWLEDGE_ORACLE } from "../src/extensions/context/knowledge-loss-discriminator/oracle";
import { summariseScores } from "../src/extensions/context/knowledge-loss-discriminator/scoring";
import {
	applySourceBoundEvidenceToCompactedMessages,
	setSourceBoundEvidenceCarryForwardForTesting,
	stripSourceBoundEvidenceSection,
} from "../src/extensions/context/source-bound-evidence";
import { generateSummary } from "../src/extensions/context/summary-generation";
import { applyTaskContractToCompactedMessages } from "../src/extensions/context/task-contract";
import {
	canonicalSourceMessages,
	createSessionCompactionState,
} from "../src/session/models/session-compaction";
import { countUserRunMessages } from "../src/session/user-run-messages";

const PRIVATE_ROOT = join(
	process.cwd(),
	"..",
	"..",
	"..",
	"tmp",
	"factual-preservation",
);

const sessionId = process.argv[2];
if (!sessionId) {
	console.error("usage: factual-preservation-qualification.ts <sessionId>");
	process.exit(2);
}

const sessionsRoot = join(homedir(), ".vscodium-roz", "cline-data", "sessions");
const sessionDir = join(sessionsRoot, sessionId);

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

const persisted = JSON.parse(
	readFileSync(join(sessionDir, `${sessionId}.messages.json`), "utf8"),
) as { messages: MessageWithMetadata[] };
const state = JSON.parse(
	readFileSync(join(sessionDir, `${sessionId}.compaction.json`), "utf8"),
) as {
	source_message_count: number;
	source_prefix_hash?: string;
	messages: MessageWithMetadata[];
};

const canonical = canonicalSourceMessages(persisted.messages);
const BOUNDARY = state.source_message_count;

/**
 * The normalizer the production hash uses for a `user` message.
 */
const normalize = (message: MessageWithMetadata): MessageWithMetadata => {
	if (message.role !== "user") {
		return message;
	}
	if (typeof message.content === "string") {
		return {
			...message,
			content: formatDisplayUserInput(message.content),
		};
	}
	return {
		...message,
		content: message.content.map((part) =>
			part.type === "text"
				? { ...part, text: formatDisplayUserInput(part.text) }
				: part,
		),
	};
};

const originalPrefixHash = computeSourcePrefixHash(
	canonical,
	BOUNDARY,
	normalize,
);
if (
	state.source_prefix_hash !== undefined &&
	state.source_prefix_hash !== originalPrefixHash
) {
	throw new Error(
		`the frozen prefix identity does not match the recorded one: recorded ${state.source_prefix_hash}, computed ${originalPrefixHash}`,
	);
}
const prefix = canonical.slice(0, BOUNDARY);

/**
 * The PRODUCTION summarizer system prompt.
 *
 * It is COPIED VERBATIM from `agentic-compaction.ts`, so the arms differ ONLY
 * by the evidence policy.
 */
const PRODUCTION_SUMMARIZER_SYSTEM_PROMPT =
	"Summarize the provided coding session into a concise continuation note with detailed next steps.";

/**
 * The CANDIDATE B's factual-preservation instruction.
 *
 * It is the CHEAPEST candidate: no extra inference request, no extra
 * mechanism — only a different instruction in the SAME request.
 *
 * The ACT's own finding is that a prompt cannot GUARANTEE a value's
 * preservation, so candidate B is expected to reduce the omission rate
 * without eliminating the distortion mode. That is exactly what the
 * measurement has to show.
 */
const FACTUAL_PRESERVATION_INSTRUCTION = [
	PRODUCTION_SUMMARIZER_SYSTEM_PROMPT,
	"",
	"When the conversation contains observed command output, preserve every",
	"subject-value relationship EXACTLY as observed: the subject, the exact",
	"value, the unit, the scope, negative facts and unresolved qualifications.",
	"Do not merge a value from one subject with another subject. Do not",
	"substitute a nearby value. If a value is not observed, say so.",
].join("\n");

/**
 * The ARM POLICY.
 *
 *   A — ordinary compaction. The summarizer sees only the production
 *       conversation text, and the continuation carries only the production
 *       sections.
 *   B — evidence-enhanced summarization with the factual-preservation
 *       instruction. The evidence is in the SUMMARIZER's input.
 *   C — the hybrid. The summarizer sees the production conversation text
 *       only, and the approved evidence is carried DETERMINISTICALLY into
 *       the continuation.
 */
type ArmId = "A" | "B" | "C";

interface ArmResult {
	readonly label: string;
	readonly mechanism: string;
	readonly compactedMessages: MessageWithMetadata[];
	readonly summaryText: string;
	readonly physicalRequestCount: number;
	readonly latencyMs: number;
	/** The COMPLETE request characters, INCLUDING the evidence. */
	readonly completeRequestChars: number;
	/** The COMPLETE request tokens, INCLUDING the evidence. */
	readonly completeRequestTokens: number;
	/** The characters the evidence added to the request. */
	readonly evidenceChars: number;
	/** The fragments the evidence policy admitted. */
	readonly admittedFragmentCount: number;
	/** The fragments refused for confidentiality reasons. */
	readonly omittedConfidentiality: number;
	/** The fragments refused because the budget was spent. */
	readonly omittedBudget: number;
}

async function replayArm(arm: ArmId): Promise<ArmResult> {
	let physicalRequestCount = 0;
	const countingFetch = (async (...args: Parameters<typeof fetch>) => {
		physicalRequestCount += 1;
		return fetch(...args);
	}) as typeof fetch;

	const estimateMessageTokens = createTokenEstimator();
	const messages = [...prefix];
	const preserveRecentTokens = Math.min(
		DEFAULT_PRESERVE_RECENT_TOKENS,
		Math.floor(131072 * 0.5),
	);
	const cutIndex = findCutIndex(
		messages,
		preserveRecentTokens,
		estimateMessageTokens,
	);
	if (cutIndex <= 0 || cutIndex >= messages.length) {
		throw new Error(`the production cut index is degenerate: ${cutIndex}`);
	}
	const messagesToSummarize = messages.slice(0, cutIndex);
	const latestSummaryIndex = findLatestSummaryIndex(messagesToSummarize);
	const previousSummary =
		latestSummaryIndex >= 0
			? getCompactionSummaryMetadata(messagesToSummarize[latestSummaryIndex])
					?.summary
			: undefined;
	const newMessagesToFold =
		latestSummaryIndex >= 0
			? messagesToSummarize.slice(latestSummaryIndex + 1)
			: messagesToSummarize;

	const summaryInputBudget = buildAgenticSummaryInputBudget({
		messages: newMessagesToFold,
		targetTokens: 131072 - 4096,
		estimateMessageTokens,
	});
	if (summaryInputBudget.status === "failed") {
		throw new Error("the production summary input budget failed");
	}
	const fileOps = extractFileOps(summaryInputBudget.messages);
	const conversationText = serializeConversation(summaryInputBudget.messages);
	const summaryRequest = buildSummaryRequest({
		previousSummary,
		conversationText,
		fileOps,
	});
	const systemPrompt =
		arm === "B"
			? FACTUAL_PRESERVATION_INSTRUCTION
			: PRODUCTION_SUMMARIZER_SYSTEM_PROMPT;

	const summarizerProviderConfig = resolveSummarizerConfig({
		activeProviderConfig: {
			providerId: provider.providerId,
			modelId: provider.modelId,
			baseUrl: provider.baseUrl,
			apiKey: provider.apiKey,
		},
	});
	const startedAt = Date.now();
	const summaryResult = await generateSummary({
		providerConfig: {
			...summarizerProviderConfig,
			fetch: countingFetch,
		} as never,
		systemPrompt,
		request: summaryRequest,
	});
	const rawSummary = summaryResult.text.trim();
	if (!rawSummary) {
		throw new Error("the summarizer returned no summary text");
	}
	const summary = ensureFilesSection(rawSummary, fileOps);
	const tokensBefore = messages.reduce(
		(total, message) => total + estimateMessageTokens(message),
		0,
	);
	const compacted = [
		buildSummaryMessage({
			summary,
			fileOps,
			tokensBefore,
			userRunSpan: countUserRunMessages(messagesToSummarize),
		}),
		...messages.slice(cutIndex),
	];

	// The PRODUCTION carry-forwards, in the production order.
	const contracted = await applyTaskContractToCompactedMessages(
		compacted,
		canonical,
		{ sourceMessageCount: BOUNDARY } as never,
	);
	const evidenced = applyVerifiedEvidenceToCompactedMessages(
		contracted.messages,
		canonical,
		{ sourceMessageCount: BOUNDARY },
	);

	// CANDIDATE C: the deterministic source-bound evidence carry-forward.
	let carried = evidenced;
	let admittedFragmentCount = 0;
	let omittedConfidentiality = 0;
	let omittedBudget = 0;
	let evidenceChars = 0;
	if (arm === "C") {
		const sourceBound = applySourceBoundEvidenceToCompactedMessages(
			evidenced.messages,
			canonical,
			{ sourceMessageCount: BOUNDARY },
		);
		carried = { ...evidenced, messages: sourceBound.messages };
		admittedFragmentCount = sourceBound.carriedFragmentCount;
		omittedConfidentiality = sourceBound.omittedConfidentiality;
		omittedBudget = sourceBound.omittedBudget;
		evidenceChars = sourceBound.addedChars;
	}

	const compactedState = createSessionCompactionState({
		sourceMessages: canonical,
		compactedMessages: carried.messages,
		conversationId: sessionId,
	});
	const { projectSessionCompactionState } = await import(
		"../src/session/models/session-compaction"
	);
	const projected = projectSessionCompactionState(compactedState, canonical);
	if (!projected) {
		throw new Error("the production projector refused the persisted state");
	}
	return {
		label:
			arm === "A"
				? "A_ORDINARY_PRODUCTION_OMISSION"
				: arm === "B"
					? "B_EVIDENCE_ENHANCED_SUMMARIZATION"
					: "C_HYBRID_SOURCE_BOUND_CARRY_FORWARD",
		mechanism:
			arm === "A"
				? "ORDINARY_COMPACTION"
				: arm === "B"
					? "EVIDENCE_ENHANCED_SUMMARIZATION"
					: "DETERMINISTIC_EVIDENCE_CARRY_FORWARD",
		compactedMessages: projected,
		summaryText: summary,
		physicalRequestCount,
		latencyMs: Date.now() - startedAt,
		completeRequestChars:
			summaryRequest.length + systemPrompt.length + evidenceChars,
		completeRequestTokens:
			estimateTokens(summaryRequest.length) +
			estimateTokens(systemPrompt.length) +
			estimateTokens(evidenceChars),
		evidenceChars,
		admittedFragmentCount,
		omittedConfidentiality,
		omittedBudget,
	};
}

/**
 * The CRITICAL oracle items.
 */
const criticalIds = new Set(
	W1_KNOWLEDGE_ORACLE.filter((item) => item.relevance === "critical").map(
		(item) => item.id,
	),
);

/**
 * Score ONE arm's continuation, WITH the factual-consistency correction.
 *
 * The predecessor's positive matcher cannot see a contradiction, so the
 * factual verdict is applied on top of it. A material mistranscription is
 * `DISTORTED` or `CONTRADICTED`, never `PARTIALLY_PRESERVED`.
 */
function scoreArm(arm: ArmResult): {
	readonly scores: ReturnType<typeof scoreContext>;
	readonly summary: ReturnType<typeof summariseScores>;
	readonly factualVerdicts: Record<string, string>;
	readonly newMaterialDistortions: string[];
} {
	const context = decomposeProviderContinuation(arm.compactedMessages);
	const raw = scoreContext(W1_KNOWLEDGE_ORACLE, context);
	const factualVerdicts: Record<string, string> = {};
	const newMaterialDistortions: string[] = [];
	const corrected = raw.map((entry) => {
		const item = W1_KNOWLEDGE_ORACLE.find(
			(candidate) => candidate.id === entry.oracleItemId,
		);
		if (!item) {
			return entry;
		}
		const verdict = decideFactualVerdict(item, context.generatedSummary);
		factualVerdicts[entry.oracleItemId] = verdict;
		const score = correctScoreForFactualVerdict(entry.score, verdict);
		if (
			(score === "DISTORTED" || score === "CONTRADICTED") &&
			entry.score !== "DISTORTED" &&
			entry.score !== "CONTRADICTED"
		) {
			newMaterialDistortions.push(
				`${entry.oracleItemId}:${entry.score}->${score}`,
			);
		}
		return { ...entry, score };
	});
	return {
		scores: corrected,
		summary: summariseScores(corrected, criticalIds),
		factualVerdicts,
		newMaterialDistortions,
	};
}

/**
 * The C2.1 REPAIRED boundary witness, over the REAL workload.
 */
async function runBoundaryWitness(): Promise<{
	readonly negative: Awaited<ReturnType<typeof runNegativeControl>>;
	readonly positive: Awaited<ReturnType<typeof runPositiveControl>>;
}> {
	const contaminated = buildContaminatedHistory({ canonical });
	const assemble = async ({
		canonical: history,
		boundary,
	}: {
		canonical: readonly MessageWithMetadata[];
		boundary: number;
	}): Promise<{ prefixDerived: string; full: string }> => {
		const contracted = await applyTaskContractToCompactedMessages(
			[
				{
					role: "user",
					content: [{ type: "text", text: "Context summary:\n\n## Goal\nt" }],
					metadata: {
						kind: "compaction_summary",
						displayRole: "system",
						summary: "## Goal\nt",
						details: { readFiles: [], modifiedFiles: [] },
						tokensBefore: 0,
						generatedAt: 0,
					},
				} as unknown as MessageWithMetadata,
			],
			history,
			{ sourceMessageCount: boundary } as never,
		);
		const evidenced = applyVerifiedEvidenceToCompactedMessages(
			contracted.messages,
			history,
			{ sourceMessageCount: boundary },
		);
		const state = createSessionCompactionState({
			sourceMessages: history,
			compactedMessages: evidenced.messages,
			conversationId: sessionId,
		});
		const { projectSessionCompactionState } = await import(
			"../src/session/models/session-compaction"
		);
		const projected = projectSessionCompactionState(
			{ ...state, source_message_count: boundary },
			history,
		);
		return {
			prefixDerived: JSON.stringify(evidenced.messages),
			full: JSON.stringify(projected ?? []),
		};
	};
	const negative = await runNegativeControl({
		originalCanonical: canonical,
		contaminatedCanonical: contaminated.canonical,
		boundary: BOUNDARY,
		originalPrefixHash,
		normalize,
		assemble,
	});
	const positive = await runPositiveControl({
		contaminatedCanonical: contaminated.canonical,
		boundary: BOUNDARY,
		syntheticMessageCount: contaminated.synthetic.length,
		normalize,
		assemble,
	});
	return { negative, positive };
}

/**
 * The MAIN.
 *
 * The arms run in the CHEAPEST-FIRST order the ACT specifies: A is the
 * baseline, B is the cheapest candidate, and C is the hybrid.
 */
async function main(): Promise<void> {
	const boundaryWitness = await runBoundaryWitness();
	const arms: Record<string, unknown> = {};
	const results: Record<string, ArmResult> = {};
	for (const arm of ["A", "B", "C"] as const) {
		// Candidate C is DEFAULT OFF in production. The qualification
		// EXERCISES the capability, so the switch is turned on for the C arm
		// only, and restored immediately afterwards. The A and B arms run
		// with the production default, so they are the honest baseline.
		const restore =
			arm === "C"
				? setSourceBoundEvidenceCarryForwardForTesting(true)
				: undefined;
		let result: ArmResult;
		try {
			result = await replayArm(arm);
		} finally {
			restore?.();
		}
		results[arm] = result;
		const scored = scoreArm(result);
		arms[arm] = {
			label: result.label,
			mechanism: result.mechanism,
			summary: scored.summary,
			factualVerdicts: scored.factualVerdicts,
			newMaterialDistortions: scored.newMaterialDistortions,
			scores: scored.scores,
			physicalRequestCount: result.physicalRequestCount,
			latencyMs: result.latencyMs,
			completeRequestChars: result.completeRequestChars,
			completeRequestTokens: result.completeRequestTokens,
			evidenceChars: result.evidenceChars,
			admittedFragmentCount: result.admittedFragmentCount,
			omittedConfidentiality: result.omittedConfidentiality,
			omittedBudget: result.omittedBudget,
			compactedMessageCount: result.compactedMessages.length,
			summaryChars: result.summaryText.length,
		};
	}

	// The ABLATION: candidate C WITHOUT the newly carried evidence must
	// return to candidate A's knowledge state.
	//
	// The ablation is NOT a separate inference run: it is candidate C's own
	// continuation with the SOURCE-BOUND EVIDENCE SECTION stripped. The
	// summarizer request is byte-identical, so the only difference between C
	// and the ablation is the presence of the carried section. That makes the
	// ablation a genuine CAUSAL control over the carry-forward rather than a
	// comparison of two different summarizer runs.
	const ablatedMessages = results.C.compactedMessages.map((message) => {
		const metadata = message.metadata as
			| { kind?: string; summary?: string }
			| undefined;
		if (metadata?.kind !== "compaction_summary") {
			return message;
		}
		const current =
			metadata.summary ??
			(typeof message.content === "string"
				? message.content
				: (message.content as { type: string; text?: string }[])
						.filter((block) => block.type === "text")
						.map((block) => block.text ?? "")
						.join("\n"));
		const stripped = stripSourceBoundEvidenceSection(current);
		return {
			...message,
			content: [{ type: "text", text: `Context summary:\n\n${stripped}` }],
			metadata: { ...metadata, summary: stripped },
		} as MessageWithMetadata;
	});
	const ablatedArm: ArmResult = {
		label: "C_MINUS_SOURCE_BOUND_EVIDENCE_ABLATION",
		mechanism: "ORDINARY_COMPACTION",
		compactedMessages: ablatedMessages,
		summaryText: results.C.summaryText,
		physicalRequestCount: results.C.physicalRequestCount,
		latencyMs: 0,
		completeRequestChars: results.C.completeRequestChars,
		completeRequestTokens: results.C.completeRequestTokens,
		evidenceChars: 0,
		admittedFragmentCount: 0,
		omittedConfidentiality: 0,
		omittedBudget: 0,
	};
	const ablatedScored = scoreArm(ablatedArm);
	arms.C_MINUS_EVIDENCE = {
		label: ablatedArm.label,
		mechanism: ablatedArm.mechanism,
		summary: ablatedScored.summary,
		factualVerdicts: ablatedScored.factualVerdicts,
		newMaterialDistortions: ablatedScored.newMaterialDistortions,
		scores: ablatedScored.scores,
		physicalRequestCount: ablatedArm.physicalRequestCount,
		latencyMs: 0,
		completeRequestChars: ablatedArm.completeRequestChars,
		completeRequestTokens: ablatedArm.completeRequestTokens,
		evidenceChars: 0,
		admittedFragmentCount: 0,
		omittedConfidentiality: 0,
		omittedBudget: 0,
		compactedMessageCount: ablatedArm.compactedMessages.length,
		summaryChars: ablatedArm.summaryText.length,
	};

	const a = results.A;
	const c = results.C;
	const ablation = {
		armACarriedFragments: a.admittedFragmentCount,
		armCCarriedFragments: c.admittedFragmentCount,
		armAEvidenceChars: a.evidenceChars,
		armCEvidenceChars: c.evidenceChars,
		armACompleteRequestTokens: a.completeRequestTokens,
		armCCompleteRequestTokens: c.completeRequestTokens,
		completeRequestTokenDelta:
			c.completeRequestTokens - a.completeRequestTokens,
		armAPhysicalRequests: a.physicalRequestCount,
		armCPhysicalRequests: c.physicalRequestCount,
		additionalPhysicalRequests: c.physicalRequestCount - a.physicalRequestCount,
	};

	const report = {
		sessionId,
		providerModel: provider.modelId,
		frozenPrefix: {
			boundary: BOUNDARY,
			prefixHash: originalPrefixHash,
			fullCanonicalLength: canonical.length,
			postBoundaryMessageCount: canonical.length - BOUNDARY,
		},
		boundaryWitness,
		arms,
		ablation,
	} as const;

	mkdirSync(PRIVATE_ROOT, { recursive: true });
	writeFileSync(
		join(PRIVATE_ROOT, `${sessionId}.qualification.json`),
		JSON.stringify(report, null, 2),
		"utf8",
	);
	for (const arm of ["A", "B", "C"] as const) {
		writeFileSync(
			join(PRIVATE_ROOT, `${sessionId}.${arm}-context.txt`),
			JSON.stringify(results[arm].compactedMessages, null, 2),
			"utf8",
		);
		writeFileSync(
			join(PRIVATE_ROOT, `${sessionId}.${arm}-summary.txt`),
			results[arm].summaryText,
			"utf8",
		);
	}
	console.log(
		JSON.stringify(
			{
				sessionId,
				providerModel: provider.modelId,
				frozenPrefix: report.frozenPrefix,
				boundaryWitness: {
					negative: {
						prefixIdentityPreserved:
							boundaryWitness.negative.prefixIdentityPreserved,
						markerInClean: boundaryWitness.negative.markerInClean,
						markerInContaminated: boundaryWitness.negative.markerInContaminated,
						prefixDerivedIdentical:
							boundaryWitness.negative.prefixDerivedIdentical,
						cleanPostBoundaryMessageCount:
							boundaryWitness.negative.cleanPostBoundaryMessageCount,
						contaminatedPostBoundaryMessageCount:
							boundaryWitness.negative.contaminatedPostBoundaryMessageCount,
					},
					positive: {
						markerVisibleAtAdvancedBoundary:
							boundaryWitness.positive.markerVisibleAtAdvancedBoundary,
						advancedBoundary: boundaryWitness.positive.advancedBoundary,
					},
				},
				arms,
				ablation,
			},
			null,
			2,
		),
	);
}

await main();
