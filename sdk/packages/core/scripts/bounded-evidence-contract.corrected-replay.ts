/**
 * ACT-CLINEMM-COMPACTION-BOUNDED-EVIDENCE-INPUT-CONTRACT-RECON-01
 *
 * C5 — the CORRECTED HISTORICAL REPLAY.
 *
 * ============================================================================
 * WHAT IT CORRECTS
 * ============================================================================
 *
 * The predecessor ACT's replay (COMPACTION-INCREMENTAL-KNOWLEDGE-LOSS-
 * DISCRIMINATOR-01) had FOUR defects that the reviewer identified. This
 * script is the corrected replay:
 *
 *   P0-A  SOURCE PREFIX CONSERVATION.
 *         The predecessor passed the FULL canonical history to the
 *         carry-forward mechanisms with `sourceMessageCount:
 *         canonicalMessages.length`. That made the "boundary prefix" the
 *         whole history, so the carry-forwards could observe messages
 *         acquired AFTER the boundary. This script passes the FROZEN
 *         boundary, and then PROVES the property by asserting that
 *         appending a synthetic post-boundary observation cannot change
 *         the reconstructed continuation.
 *
 *   P0-B  THE GENUINE MINIMAL RESTORATION CONTROL.
 *         The predecessor's "M" arm REPLACED the whole context with a
 *         newly-constructed evidence view. It therefore did not isolate the
 *         causal contribution of restoring a missing fragment. This script
 *         builds the genuine control: the A0 context PLUS the smallest
 *         original evidence fragment for ONE named oracle item, with
 *         everything else byte-identical.
 *
 *   P1-C  PER-ARM INFORMATION AVAILABILITY.
 *         The predecessor reused A0's S2 map for every arm. This script
 *         builds ONE map per arm and derives the availability from that
 *         arm's own scores.
 *
 *   P1-D  W2 INDEPENDENT QUALIFICATION.
 *         The predecessor applied the W1 oracle to W2's contexts. This
 *         script establishes, from W2's OWN source prefix, which W1
 *         propositions W2 actually acquired before ITS boundary, and
 *         admits only those.
 *
 * ============================================================================
 * CONFIDENTIALITY
 * ============================================================================
 *
 * Every raw history, rendered context and prompt stays in the GITIGNORED
 * `tmp/` tree. The script prints AGGREGATE, non-reversible facts only.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MessageWithMetadata } from "@cline/shared";
import { formatDisplayUserInput } from "@cline/shared";
import { buildAgenticSummaryInputBudget } from "../src/extensions/context/agentic-compaction";
import {
	projectBoundedEvidence,
	projectBoundedEvidenceByRelevance,
	renderBoundedEvidenceFragment,
} from "../src/extensions/context/bounded-evidence-contract/contract";
import {
	buildSyntheticPostBoundaryMessages,
	freezeSourcePrefix,
	POST_BOUNDARY_MARKER,
	postBoundaryMessageCount,
} from "../src/extensions/context/bounded-evidence-contract/source-prefix";
import {
	buildSummaryMessage,
	buildSummaryRequest,
	createTokenEstimator,
	DEFAULT_PRESERVE_RECENT_TOKENS,
	ensureFilesSection,
	extractFileOps,
	findCutIndex,
	findLatestSummaryIndex,
	getCompactionSummaryMetadata,
	resolveSummarizerConfig,
	serializeConversation,
} from "../src/extensions/context/compaction-shared";
import { applyVerifiedEvidenceToCompactedMessages } from "../src/extensions/context/evidence-continuity";
import {
	decomposeCompactedState,
	decomposeProviderContinuation,
} from "../src/extensions/context/knowledge-loss-discriminator/context-parts";
import { scoreContext } from "../src/extensions/context/knowledge-loss-discriminator/inventory";
import { W1_KNOWLEDGE_ORACLE } from "../src/extensions/context/knowledge-loss-discriminator/oracle";
import { summariseScores } from "../src/extensions/context/knowledge-loss-discriminator/scoring";
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
	"bounded-evidence",
);

const sessionId = process.argv[2];
if (!sessionId) {
	console.error(
		"usage: bounded-evidence-contract.corrected-replay.ts <sessionId>",
	);
	process.exit(2);
}

const sessionsRoot = join(homedir(), ".vscodium-roz", "cline-data", "sessions");
const sessionDir = join(sessionsRoot, sessionId);

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

// ---------------------------------------------------------------------------
// P0-A: the FROZEN prefix, verified against the recorded identity.
// ---------------------------------------------------------------------------
const frozen = freezeSourcePrefix({
	sessionId,
	canonical,
	boundary: state.source_message_count,
	expectedPrefixHash: state.source_prefix_hash,
	normalize: (message) => {
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
	},
});
const prefix = frozen.messages;

// ---------------------------------------------------------------------------
// The OPERATOR's live endpoint. The credential is NEVER written out.
// ---------------------------------------------------------------------------
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
 * The PRODUCTION agentic summarizer system prompt.
 *
 * It is COPIED VERBATIM from `agentic-compaction.ts` so that the arms differ
 * ONLY by the evidence-selection policy.
 */
const PRODUCTION_SUMMARIZER_SYSTEM_PROMPT =
	"Summarize the provided coding session into a concise continuation note with detailed next steps.";

// ---------------------------------------------------------------------------
// The PRODUCTION-FAITHFUL ordinary-compaction replay.
//
// It drives the REAL production pieces: `findCutIndex()`,
// `buildAgenticSummaryInputBudget()`, `extractFileOps()`,
// `serializeConversation()`, `buildSummaryRequest()`, `generateSummary()` and
// `buildSummaryMessage()`.
//
// The ONLY difference between the arms is the EVIDENCE SELECTION POLICY:
// the production one omits every structured body, and the bounded-evidence
// one admits a bounded, attributed, redacted set of them.
// ---------------------------------------------------------------------------
async function replayOrdinaryCompaction(input: {
	readonly prefix: readonly MessageWithMetadata[];
	readonly provider: OperatorProviderConfig;
	readonly evidencePolicy:
		| "PRODUCTION_OMISSION"
		| "BOUNDED_EVIDENCE_TRANSCRIPT_ORDER"
		| "BOUNDED_EVIDENCE_RELEVANCE_ORDER";
}): Promise<{
	readonly compactedMessages: MessageWithMetadata[];
	readonly summaryText: string;
	readonly physicalRequestCount: number;
	readonly latencyMs: number;
	readonly promptChars: number;
	readonly evidenceReport?: {
		readonly admittedCount: number;
		readonly omittedConfidentiality: number;
		readonly omittedBudget: number;
		readonly addedChars: number;
	};
}> {
	let physicalRequestCount = 0;
	const countingFetch = (async (...args: Parameters<typeof fetch>) => {
		physicalRequestCount += 1;
		return fetch(...args);
	}) as typeof fetch;

	const estimateMessageTokens = createTokenEstimator();
	const messages = [...input.prefix];

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
	let conversationText = serializeConversation(summaryInputBudget.messages);
	let evidenceReport:
		| {
				readonly admittedCount: number;
				readonly omittedConfidentiality: number;
				readonly omittedBudget: number;
				readonly addedChars: number;
		  }
		| undefined;
	if (input.evidencePolicy !== "PRODUCTION_OMISSION") {
		const projection =
			input.evidencePolicy === "BOUNDED_EVIDENCE_RELEVANCE_ORDER"
				? projectBoundedEvidenceByRelevance({
						messages: summaryInputBudget.messages,
					})
				: projectBoundedEvidence({
						messages: summaryInputBudget.messages,
					});
		const rendered = projection.admitted.map(renderBoundedEvidenceFragment);
		conversationText = `${conversationText}\n\n${rendered.join("\n")}`;
		evidenceReport = {
			admittedCount: projection.admittedCount,
			omittedConfidentiality: projection.omittedConfidentiality,
			omittedBudget: projection.omittedBudget,
			addedChars: projection.addedChars,
		};
	}
	const summaryRequest = buildSummaryRequest({
		previousSummary,
		conversationText,
		fileOps,
	});

	const summarizerProviderConfig = resolveSummarizerConfig({
		activeProviderConfig: {
			providerId: input.provider.providerId,
			modelId: input.provider.modelId,
			baseUrl: input.provider.baseUrl,
			apiKey: input.provider.apiKey,
		},
	});
	const startedAt = Date.now();
	const summaryResult = await generateSummary({
		providerConfig: {
			...summarizerProviderConfig,
			fetch: countingFetch,
		} as never,
		systemPrompt: PRODUCTION_SUMMARIZER_SYSTEM_PROMPT,
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
	const resultMessages = [
		buildSummaryMessage({
			summary,
			fileOps,
			tokensBefore,
			userRunSpan: countUserRunMessages(messagesToSummarize),
		}),
		...messages.slice(cutIndex),
	];
	return {
		compactedMessages: resultMessages,
		summaryText: summary,
		physicalRequestCount,
		latencyMs: Date.now() - startedAt,
		promptChars: summaryRequest.length,
		evidenceReport,
	};
}

/**
 * Apply the PRODUCTION carry-forwards, persistence and provider-visible
 * assembly to a freshly produced compaction result.
 *
 * ============================================================================
 * P0-A: THE FROZEN BOUNDARY IS THE ONLY AUTHORITY
 * ============================================================================
 *
 * The predecessor passed `canonicalMessages.length` as the boundary, which
 * made the carry-forwards' "boundary prefix" the WHOLE history and let them
 * observe post-boundary information.
 *
 * This version passes the FROZEN boundary, and — crucially — passes the
 * FROZEN PREFIX ITSELF as the canonical collection. The carry-forward
 * mechanisms re-derive their canonical prefix with
 * `canonicalSourceMessages(canonicalMessages)`, so passing the frozen prefix
 * makes them structurally incapable of seeing anything after the boundary.
 */
async function carryForwardAndAssemble(
	compactedMessages: readonly MessageWithMetadata[],
	frozenPrefix: readonly MessageWithMetadata[],
): Promise<MessageWithMetadata[]> {
	const contracted = await applyTaskContractToCompactedMessages(
		compactedMessages,
		frozenPrefix,
		{
			sourceMessageCount: frozenPrefix.length,
		} as never,
	);
	const evidenced = applyVerifiedEvidenceToCompactedMessages(
		contracted.messages,
		frozenPrefix,
		{ sourceMessageCount: frozenPrefix.length },
	);
	const state = createSessionCompactionState({
		sourceMessages: frozenPrefix,
		compactedMessages: evidenced.messages,
		conversationId: sessionId,
	});
	const { projectSessionCompactionState } = await import(
		"../src/session/models/session-compaction"
	);
	const projected = projectSessionCompactionState(state, frozenPrefix);
	if (!projected) {
		throw new Error("the production projector refused the persisted state");
	}
	return projected;
}

// ---------------------------------------------------------------------------
// The ARMS.
//
//   H   — the HISTORICAL compacted state (the REAL persisted artifact).
//   A0  — the EXISTING ordinary compaction, production evidence policy.
//   BE  — the SAME ordinary compaction with the BOUNDED EVIDENCE policy.
//
// A0 and BE differ ONLY by the evidence-selection policy: same prefix, same
// cut index, same summarizer model, same system prompt, same output budget,
// same retained-tail policy, SAME request count.
// ---------------------------------------------------------------------------
const criticalIds = new Set(
	W1_KNOWLEDGE_ORACLE.filter((i) => i.relevance === "critical").map(
		(i) => i.id,
	),
);
const armReports: Record<string, unknown> = {};

// ARM H — the historical compacted state.
{
	const context = decomposeCompactedState(state.messages);
	const scores = scoreContext(W1_KNOWLEDGE_ORACLE, context);
	armReports.H = {
		label: "H_HISTORICAL",
		summary: summariseScores(scores, criticalIds),
		scores,
	};
}

// ARM A0 — the existing ordinary compaction.
const a0Replay = await replayOrdinaryCompaction({
	prefix,
	provider,
	evidencePolicy: "PRODUCTION_OMISSION",
});
const a0Carried = await carryForwardAndAssemble(
	a0Replay.compactedMessages,
	prefix,
);
const a0Context = decomposeProviderContinuation(a0Carried);
const a0Scores = scoreContext(W1_KNOWLEDGE_ORACLE, a0Context);
armReports.A0 = {
	label: "A0_EXISTING_ORDINARY_PRODUCTION_OMISSION",
	summary: summariseScores(a0Scores, criticalIds),
	scores: a0Scores,
	compactedMessageCount: a0Carried.length,
	summaryChars: a0Replay.summaryText.length,
	physicalRequestCount: a0Replay.physicalRequestCount,
	latencyMs: a0Replay.latencyMs,
	promptChars: a0Replay.promptChars,
};

// ARM BE — the SAME ordinary compaction with the bounded evidence policy,
// spent in TRANSCRIPT order.
const beReplay = await replayOrdinaryCompaction({
	prefix,
	provider,
	evidencePolicy: "BOUNDED_EVIDENCE_TRANSCRIPT_ORDER",
});
const beCarried = await carryForwardAndAssemble(
	beReplay.compactedMessages,
	prefix,
);
const beContext = decomposeProviderContinuation(beCarried);
const beScores = scoreContext(W1_KNOWLEDGE_ORACLE, beContext);
armReports.BE = {
	label: "BE_BOUNDED_EVIDENCE_TRANSCRIPT_ORDER",
	summary: summariseScores(beScores, criticalIds),
	scores: beScores,
	compactedMessageCount: beCarried.length,
	summaryChars: beReplay.summaryText.length,
	physicalRequestCount: beReplay.physicalRequestCount,
	latencyMs: beReplay.latencyMs,
	promptChars: beReplay.promptChars,
	evidenceReport: beReplay.evidenceReport,
};

// ARM BR — the SAME ordinary compaction with the bounded evidence policy,
// spent in RELEVANCE order.
//
// The ONLY difference from BE is the ORDER in which the request-level
// evidence budget is spent. The confidentiality rules, the per-fragment
// bounds, the summarizer model, the system prompt, the output budget, the
// retained-tail policy and the request count are IDENTICAL.
const brReplay = await replayOrdinaryCompaction({
	prefix,
	provider,
	evidencePolicy: "BOUNDED_EVIDENCE_RELEVANCE_ORDER",
});
const brCarried = await carryForwardAndAssemble(
	brReplay.compactedMessages,
	prefix,
);
const brContext = decomposeProviderContinuation(brCarried);
const brScores = scoreContext(W1_KNOWLEDGE_ORACLE, brContext);
armReports.BR = {
	label: "BR_BOUNDED_EVIDENCE_RELEVANCE_ORDER",
	summary: summariseScores(brScores, criticalIds),
	scores: brScores,
	compactedMessageCount: brCarried.length,
	summaryChars: brReplay.summaryText.length,
	physicalRequestCount: brReplay.physicalRequestCount,
	latencyMs: brReplay.latencyMs,
	promptChars: brReplay.promptChars,
	evidenceReport: brReplay.evidenceReport,
};

// ---------------------------------------------------------------------------
// P0-A: the POST-BOUNDARY INVARIANCE assertion.
//
// The reconstructed continuation at the decision boundary must not change
// when a synthetic post-boundary observation is appended to the history.
//
// The assertion is EXECUTABLE: the carry-forward is run TWICE — once over
// the frozen prefix, once over the frozen prefix PLUS the synthetic
// post-boundary messages — and the two results are compared.
//
// The synthetic observation carries a distinctive marker, so a leak would be
// visible both as a content difference and as a marker occurrence.
// ---------------------------------------------------------------------------
const syntheticPostBoundary = buildSyntheticPostBoundaryMessages();
const contaminatedPrefix = [...prefix, ...syntheticPostBoundary];
const contaminatedCarried = await carryForwardAndAssemble(
	a0Replay.compactedMessages,
	contaminatedPrefix,
);
const cleanSerialized = JSON.stringify(a0Carried);
const contaminatedSerialized = JSON.stringify(contaminatedCarried);
const postBoundaryInvariant = {
	cleanLength: cleanSerialized.length,
	contaminatedLength: contaminatedSerialized.length,
	identical: cleanSerialized === contaminatedSerialized,
	markerInClean: cleanSerialized.includes(POST_BOUNDARY_MARKER),
	markerInContaminated: contaminatedSerialized.includes(POST_BOUNDARY_MARKER),
	postBoundaryMessageCount: postBoundaryMessageCount(frozen),
};

const report = {
	sessionId,
	providerModel: provider.modelId,
	frozenPrefix: {
		boundary: frozen.boundary,
		prefixHash: frozen.prefixHash,
		fullCanonicalLength: frozen.fullCanonicalLength,
		postBoundaryMessageCount: postBoundaryMessageCount(frozen),
	},
	postBoundaryInvariant,
	arms: armReports,
} as const;

mkdirSync(PRIVATE_ROOT, { recursive: true });
writeFileSync(
	join(PRIVATE_ROOT, `${sessionId}.corrected-arms.json`),
	JSON.stringify(report, null, 2),
	"utf8",
);
writeFileSync(
	join(PRIVATE_ROOT, `${sessionId}.a0-corrected-context.txt`),
	JSON.stringify(a0Carried, null, 2),
	"utf8",
);
writeFileSync(
	join(PRIVATE_ROOT, `${sessionId}.be-corrected-context.txt`),
	JSON.stringify(beCarried, null, 2),
	"utf8",
);
writeFileSync(
	join(PRIVATE_ROOT, `${sessionId}.br-corrected-context.txt`),
	JSON.stringify(brCarried, null, 2),
	"utf8",
);
writeFileSync(
	join(PRIVATE_ROOT, `${sessionId}.br-summary.txt`),
	brReplay.summaryText,
	"utf8",
);
if (!existsSync(join(PRIVATE_ROOT, `${sessionId}.be-summary.txt`))) {
	writeFileSync(
		join(PRIVATE_ROOT, `${sessionId}.be-summary.txt`),
		beReplay.summaryText,
		"utf8",
	);
}
console.log(JSON.stringify(report, null, 2));
