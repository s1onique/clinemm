/**
 * ACT-CLINEMM-COMPACTION-INCREMENTAL-KNOWLEDGE-LOSS-DISCRIMINATOR-01
 *
 * C4 — the EXPERIMENTAL ARMS.
 *
 * ============================================================================
 * THE ARMS
 * ============================================================================
 *
 *   H  — the HISTORICAL ordinary compaction. The REAL persisted compacted
 *        state of the REAL session. No summary is regenerated.
 *
 *   F  — the FULL-SOURCE behavioural control. The original source prefix is
 *        supplied WITHOUT any compaction. This is a positive control: it
 *        establishes whether the model can recover the oracle knowledge when
 *        the source information is still available.
 *
 *   A0 — the EXISTING ordinary compaction, PCK OFF. A production-faithful
 *        REPLAY of the real compaction composition: the real
 *        `createContextCompactionPrepareTurn()` composition, the real
 *        `runAgenticCompaction()` summarizer path, the real task-contract
 *        and verified-outcome carry-forwards, the real persistence, and the
 *        real provider-visible assembly.
 *
 *   A1 — the REVISED ordinary summarization instruction. The SAME source
 *        prefix, the SAME retained-tail policy, the SAME summarizer model and
 *        the SAME output budget, with ONE experiment-local instruction
 *        change. The instruction is GENERIC: it names no workload-specific
 *        answer.
 *
 * ============================================================================
 * THE PCK IS NOT EXECUTED
 * ============================================================================
 *
 * The predecessor ACT already established the PCK's closed-vocabulary
 * limitation and its inference overhead. No PCK arm is executed here, and no
 * PCK input, vocabulary, budget or deadline change is made.
 *
 * ============================================================================
 * CONFIDENTIALITY
 * ============================================================================
 *
 * Every raw model output, every rendered prompt and every context block is
 * written to the GITIGNORED `tmp/` tree only. The committed evidence carries
 * aggregates, runtime-owned constants and oracle item ids.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MessageWithMetadata } from "@cline/shared";
import { buildAgenticSummaryInputBudget } from "../src/extensions/context/agentic-compaction";
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
import {
	type KnowledgeContext,
	scoreContext,
} from "../src/extensions/context/knowledge-loss-discriminator/inventory";
import { W1_KNOWLEDGE_ORACLE } from "../src/extensions/context/knowledge-loss-discriminator/oracle";
import {
	assertNoOracleLeakage,
	renderContextBlock,
} from "../src/extensions/context/knowledge-loss-discriminator/probe-harness";
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
	"knowledge-loss",
);

const sessionId = process.argv[2];
if (!sessionId) {
	console.error(
		"usage: knowledge-loss-discriminator.arms.ts <sessionId> [sessionsRoot]",
	);
	process.exit(2);
}

const sessionsRoot =
	process.argv[3] ?? join(homedir(), ".vscodium-roz", "cline-data", "sessions");
const sessionDir = join(sessionsRoot, sessionId);

const persisted = JSON.parse(
	readFileSync(join(sessionDir, `${sessionId}.messages.json`), "utf8"),
) as { messages: MessageWithMetadata[]; origin?: { version?: string } };
const state = JSON.parse(
	readFileSync(join(sessionDir, `${sessionId}.compaction.json`), "utf8"),
) as {
	source_message_count: number;
	source_prefix_hash?: string;
	messages: MessageWithMetadata[];
};

const canonical = canonicalSourceMessages(persisted.messages);
const boundary = state.source_message_count;
const prefix = canonical.slice(0, boundary);

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

// ---------------------------------------------------------------------------
// The REVISED ordinary summarization instruction (Arm A1).
//
// It is GENERIC. It names a CLASS of knowledge, never a workload-specific
// answer. It is applied to the EXISTING summarizer request as an additional
// INSTRUCTION BLOCK, so the summarizer's request shape, model, inference
// policy and output budget are unchanged and the request count is unchanged.
// ---------------------------------------------------------------------------
export const REVISED_SUMMARY_INSTRUCTION = [
	"",
	"## Working knowledge to preserve",
	"When summarising, preserve the KNOWLEDGE the session established, not only the narrative:",
	"- Established discoveries: what was actually observed, and where.",
	"- Rejected hypotheses and WHY they were rejected.",
	"- Contradictions between sources, and which source supersedes which.",
	"- Required qualifications: the conditions under which a statement holds, and the",
	"  distinction between a default, an override and an effective observed value.",
	"- Differences between counting or measurement definitions, with the count that",
	"  belongs to each definition. Never collapse them into one number.",
	"- Decisions already made, so they are not re-investigated.",
	"- Remaining obligations and the evidence that is still missing.",
	"State each of these concretely, with the observed values. If a distinction was",
	"established, keep it. Do not merge a conditional finding into an unconditional one.",
].join("\n");

/**
 * The PRODUCTION agentic summarizer system prompt.
 *
 * It is COPIED VERBATIM from `agentic-compaction.ts` so that the A0 and A1
 * arms differ ONLY by the appended instruction block. It is asserted against
 * the production constant by the ACT's witness.
 */
const PRODUCTION_SUMMARIZER_SYSTEM_PROMPT =
	"Summarize the provided coding session into a concise continuation note with detailed next steps.";

// ---------------------------------------------------------------------------
// The PRODUCTION-FAITHFUL ordinary-compaction replay.
//
// It drives the REAL production pieces:
//
//   - `findCutIndex()` — the production retained-tail cut,
//   - `buildAgenticSummaryInputBudget()` — the production summarizer-input
//     budget projection,
//   - `extractFileOps()` / `serializeConversation()` — the production
//     summarizer-input rendering (including the `[result omitted]` body
//     policy),
//   - `buildSummaryRequest()` — the production summarizer request,
//   - `generateSummary()` — the production summarizer transport,
//   - `buildSummaryMessage()` — the production summary message.
//
// The ONLY difference between A0 and A1 is the summarizer's SYSTEM PROMPT.
// The request count, the model, the inference policy, the output budget and
// the retained-tail policy are identical.
//
// The result is then carried through the PRODUCTION task-contract and
// verified-outcome carry-forwards, and through the PRODUCTION persistence
// and provider-visible assembly, by `createCompactionStateAwarePrepareTurn`.
// ---------------------------------------------------------------------------
async function replayOrdinaryCompaction(input: {
	readonly prefix: readonly MessageWithMetadata[];
	readonly provider: OperatorProviderConfig;
	readonly revisedInstruction?: string;
}): Promise<{
	readonly compactedMessages: MessageWithMetadata[];
	readonly summaryText: string;
	readonly physicalRequestCount: number;
	readonly latencyMs: number;
	readonly promptChars: number;
	readonly summaryRequestChars: number;
}> {
	let physicalRequestCount = 0;
	const countingFetch = (async (...args: Parameters<typeof fetch>) => {
		physicalRequestCount += 1;
		return fetch(...args);
	}) as typeof fetch;

	const estimateMessageTokens = createTokenEstimator();
	const messages = [...input.prefix];

	// The PRODUCTION retained-tail cut.
	const preserveRecentTokens = Math.min(
		DEFAULT_PRESERVE_RECENT_TOKENS,
		// The production target is the manual-mode half of the request
		// budget. The exact value does not matter for the comparison because
		// BOTH arms use it; it is recorded in the evidence.
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

	// The PRODUCTION summarizer-input budget projection.
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

	// The PRODUCTION summarizer transport.
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
		systemPrompt: `${PRODUCTION_SUMMARIZER_SYSTEM_PROMPT}${input.revisedInstruction ?? ""}`,
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
		summaryRequestChars: summaryRequest.length,
	};
}

/**
 * Apply the PRODUCTION carry-forwards, persistence and provider-visible
 * assembly to a freshly produced compaction result.
 *
 * It drives the REAL `createCompactionStateAwarePrepareTurn()` seam with the
 * REAL `createContextCompactionPrepareTurn()` composition underneath it, so
 * the task-contract carry-forward, the verified-outcome carry-forward, the
 * persistence boundary and the provider-visible assembly are the production
 * ones rather than re-implementations.
 */
async function carryForwardAndAssemble(
	compactedMessages: readonly MessageWithMetadata[],
	canonicalMessages: readonly MessageWithMetadata[],
): Promise<MessageWithMetadata[]> {
	// The PRODUCTION carry-forwards, in the PRODUCTION order: task contract,
	// then verified outcomes.
	const contracted = await applyTaskContractToCompactedMessages(
		compactedMessages,
		canonicalMessages,
		{
			sourceMessageCount: canonicalMessages.length,
		} as never,
	);
	const evidenced = applyVerifiedEvidenceToCompactedMessages(
		contracted.messages,
		canonicalMessages,
		{ sourceMessageCount: canonicalMessages.length },
	);
	// The PRODUCTION persistence boundary.
	const state = createSessionCompactionState({
		sourceMessages: canonicalMessages,
		compactedMessages: evidenced.messages,
		conversationId: sessionId,
	});
	// The PRODUCTION provider-visible assembly: the state-aware seam's
	// re-compaction branch projects the persisted state over the canonical
	// history and restores the provider-visible sections.
	const { projectSessionCompactionState } = await import(
		"../src/session/models/session-compaction"
	);
	const projected = projectSessionCompactionState(state, canonicalMessages);
	if (!projected) {
		throw new Error("the production projector refused the persisted state");
	}
	return projected;
}

// ---------------------------------------------------------------------------
// The arms.
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
		contextBlockChars: renderContextBlock(state.messages).length,
	};
}

// ARM F — the full-source behavioural control.
{
	const context: KnowledgeContext = {
		generatedSummary: "",
		taskContract: "",
		verifiedOutcome: "",
		adjudication: "",
		sourceBoundEvidence: "",
		retainedTail: "",
		evidenceBodies: renderContextBlock(prefix),
	};
	const scores = scoreContext(W1_KNOWLEDGE_ORACLE, context);
	armReports.F = {
		label: "F_FULL_SOURCE",
		summary: summariseScores(scores, criticalIds),
		scores,
		contextBlockChars: renderContextBlock(prefix).length,
	};
}

// ARM A0 — the existing ordinary compaction, PCK OFF.
{
	const replay = await replayOrdinaryCompaction({
		prefix,
		provider,
	});
	// The PRODUCTION carry-forwards, persistence and provider-visible
	// assembly, applied through the production state-aware seam.
	const carried = await carryForwardAndAssemble(
		replay.compactedMessages,
		canonical,
	);
	const context = decomposeProviderContinuation(carried);
	const scores = scoreContext(W1_KNOWLEDGE_ORACLE, context);
	armReports.A0 = {
		label: "A0_EXISTING_ORDINARY_PCK_OFF",
		summary: summariseScores(scores, criticalIds),
		scores,
		compactedMessageCount: carried.length,
		summaryChars: replay.summaryText.length,
		physicalRequestCount: replay.physicalRequestCount,
		latencyMs: replay.latencyMs,
		contextBlockChars: renderContextBlock(carried).length,
	};
	mkdirSync(PRIVATE_ROOT, { recursive: true });
	writeFileSync(
		join(PRIVATE_ROOT, `${sessionId}.a0-summary.txt`),
		replay.summaryText,
		"utf8",
	);
	writeFileSync(
		join(PRIVATE_ROOT, `${sessionId}.a0-context.txt`),
		renderContextBlock(carried),
		"utf8",
	);
}

// ARM A1 — the revised ordinary summarization instruction.
{
	const replay = await replayOrdinaryCompaction({
		prefix,
		provider,
		revisedInstruction: REVISED_SUMMARY_INSTRUCTION,
	});
	const carried = await carryForwardAndAssemble(
		replay.compactedMessages,
		canonical,
	);
	const context = decomposeProviderContinuation(carried);
	const scores = scoreContext(W1_KNOWLEDGE_ORACLE, context);
	armReports.A1 = {
		label: "A1_REVISED_ORDINARY_SUMMARY",
		summary: summariseScores(scores, criticalIds),
		scores,
		compactedMessageCount: carried.length,
		summaryChars: replay.summaryText.length,
		physicalRequestCount: replay.physicalRequestCount,
		latencyMs: replay.latencyMs,
		contextBlockChars: renderContextBlock(carried).length,
	};
	mkdirSync(PRIVATE_ROOT, { recursive: true });
	writeFileSync(
		join(PRIVATE_ROOT, `${sessionId}.a1-summary.txt`),
		replay.summaryText,
		"utf8",
	);
	writeFileSync(
		join(PRIVATE_ROOT, `${sessionId}.a1-context.txt`),
		renderContextBlock(carried),
		"utf8",
	);
}

// ---------------------------------------------------------------------------
// The ORACLE LEAKAGE witness.
// ---------------------------------------------------------------------------
const probePrompts: string[] = [];
const leakage = assertNoOracleLeakage({
	prompt: probePrompts.join("\n"),
	oraclePropositions: W1_KNOWLEDGE_ORACLE.map((i) => i.proposition),
	oracleCriteria: W1_KNOWLEDGE_ORACLE.flatMap((i) => i.correctAnswerCriteria),
});

const report = {
	sessionId,
	providerModel: provider.modelId,
	providerBaseUrlHost: provider.baseUrl ? new URL(provider.baseUrl).host : null,
	arms: armReports,
	oracleLeakageWitness: {
		probePromptCount: probePrompts.length,
		leaked: leakage.leaked,
		leakedTerms: leakage.leakedTerms,
	},
} as const;

mkdirSync(PRIVATE_ROOT, { recursive: true });
writeFileSync(
	join(PRIVATE_ROOT, `${sessionId}.arms.json`),
	JSON.stringify(report, null, 2),
	"utf8",
);
console.log(JSON.stringify(report, null, 2));
