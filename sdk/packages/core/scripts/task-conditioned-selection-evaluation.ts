/**
 * ACT-CLINEMM-COMPACTION-TASK-CONDITIONED-EVIDENCE-SELECTION-01
 *
 * C5 — THE DETERMINISTIC SELECTION EVALUATION OVER THE FROZEN W1 WORKLOAD.
 *
 * ============================================================================
 * WHAT IT MEASURES
 * ============================================================================
 *
 * Every deterministic selector arm, over the SAME frozen W1 prefix, against
 * the SAME frozen ordinary summary artifact, with the SAME retained tail,
 * the SAME task contract and the SAME verified-outcome carry-forward.
 *
 * NO NEW SUMMARIZATION REQUEST IS MADE. The summary artifact is FROZEN and
 * REUSED, so the arms differ ONLY in the SELECTION. That is what makes the
 * comparison a measurement of the selection rather than of the summarizer.
 *
 * ============================================================================
 * THE FROZEN ARTEFACTS
 * ============================================================================
 *
 *   - the W1 source prefix, re-derived from the canonical history at the
 *     EXACT historical boundary, and verified against the recorded
 *     `source_prefix_hash`;
 *   - the ordinary summary artifact, read from the gitignored private tree
 *     and verified by its digest.
 *
 * The summary's digest is VERIFIED against the recorded one, so a changed
 * summary cannot silently alter the comparison.
 *
 * ============================================================================
 * CONFIDENTIALITY
 * ============================================================================
 *
 * Every raw history, rendered context, prompt and answer stays in the
 * GITIGNORED `tmp/` tree. The script prints AGGREGATE, non-reversible facts.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MessageWithMetadata } from "@cline/shared";
import { formatDisplayUserInput } from "@cline/shared";
import { computeSourcePrefixHash } from "../src/extensions/context/bounded-evidence-contract/source-prefix";
import { applyVerifiedEvidenceToCompactedMessages } from "../src/extensions/context/evidence-continuity";
import { decomposeProviderContinuation } from "../src/extensions/context/knowledge-loss-discriminator/context-parts";
import {
	correctScoreForFactualVerdict,
	decideFactualVerdict,
} from "../src/extensions/context/knowledge-loss-discriminator/factual-preservation";
import { scoreContext } from "../src/extensions/context/knowledge-loss-discriminator/inventory";
import { W1_KNOWLEDGE_ORACLE } from "../src/extensions/context/knowledge-loss-discriminator/oracle";
import { summariseScores } from "../src/extensions/context/knowledge-loss-discriminator/scoring";
import { setSourceBoundEvidenceCarryForwardForTesting } from "../src/extensions/context/source-bound-evidence";
import {
	buildRelevanceSignals,
	collectEvidenceCandidates,
	type EvidenceSelectorArm,
	estimateTokens,
	renderSelectionSection,
	SCREENING_BUDGETS,
	selectEvidence,
} from "../src/extensions/context/task-conditioned-evidence-selection";
import { applyTaskContractToCompactedMessages } from "../src/extensions/context/task-contract";
import { canonicalSourceMessages } from "../src/session/models/session-compaction";

const SESSION_ID = process.argv[2] ?? "1795491524406_mutdb";
const BOUNDARY = Number(process.argv[3] ?? 244);

const PRIVATE_ROOT = join(
	process.cwd(),
	"..",
	"..",
	"..",
	"tmp",
	"task-conditioned-selection",
);
const sessionsRoot = join(homedir(), ".vscodium-roz", "cline-data", "sessions");
const sessionDir = join(sessionsRoot, SESSION_ID);

const ARM_IDS: readonly EvidenceSelectorArm[] = [
	"SHAPE",
	"TASK_CONDITIONED",
	"SUBJECT_DIVERSITY",
	"MINIMAL_WINDOW",
];

function sha256(text: string): string {
	return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

/**
 * The persisted session state.
 */
const persisted = readJson<{ messages: MessageWithMetadata[] }>(
	join(sessionDir, `${SESSION_ID}.messages.json`),
);
const state = readJson<{
	source_message_count: number;
	source_prefix_hash?: string;
	messages: MessageWithMetadata[];
}>(join(sessionDir, `${SESSION_ID}.compaction.json`));

const canonical = canonicalSourceMessages(persisted.messages);

/**
 * The PRODUCTION normalizer for the source-prefix hash.
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

/**
 * VERIFY the frozen prefix identity.
 */
const computedPrefixHash = computeSourcePrefixHash(
	canonical,
	BOUNDARY,
	normalize,
);
if (
	state.source_prefix_hash !== undefined &&
	state.source_prefix_hash !== computedPrefixHash
) {
	throw new Error(
		`the frozen prefix identity does not match the recorded one: recorded ${state.source_prefix_hash}, computed ${computedPrefixHash}`,
	);
}
const prefix = canonical.slice(0, BOUNDARY);

/**
 * The FROZEN ordinary summary artifact.
 *
 * It is read from the gitignored private tree and VERIFIED by its digest, so
 * that a changed summary cannot silently alter the comparison.
 */
const SUMMARY_PATH = join(PRIVATE_ROOT, `${SESSION_ID}.A-summary.txt`);
const SUMMARY_DIGEST_PATH = join(
	PRIVATE_ROOT,
	`${SESSION_ID}.A-summary.sha256`,
);
if (!existsSync(SUMMARY_PATH)) {
	throw new Error(
		`the frozen summary artifact is missing: ${SUMMARY_PATH}. The ordinary summary must be generated ONCE and then reused by every arm.`,
	);
}
const frozenSummary = readFileSync(SUMMARY_PATH, "utf8");
const frozenSummaryDigest = sha256(frozenSummary);
if (existsSync(SUMMARY_DIGEST_PATH)) {
	const recorded = readFileSync(SUMMARY_DIGEST_PATH, "utf8").trim();
	if (recorded !== frozenSummaryDigest) {
		throw new Error(
			`the frozen summary artifact's digest does not match the recorded one: recorded ${recorded}, computed ${frozenSummaryDigest}`,
		);
	}
} else {
	mkdirSync(PRIVATE_ROOT, { recursive: true });
	writeFileSync(SUMMARY_DIGEST_PATH, `${frozenSummaryDigest}\n`);
}

/**
 * The TASK CONTEXT.
 *
 * It is the session's OWN material: the initial user request plus the
 * carried task contract. It is NOT oracle-derived.
 */
const initialUserRequest = canonical
	.filter((message) => message.role === "user")
	.slice(0, 1)
	.flatMap((message) =>
		Array.isArray(message.content)
			? message.content
					.filter((part) => part.type === "text")
					.map((part) => (part as { text?: string }).text ?? "")
			: typeof message.content === "string"
				? [message.content]
				: [],
	);

/**
 * The summary message that the arms start from.
 *
 * It is the FROZEN ordinary summary, so every arm shares it byte for byte.
 */
function frozenSummaryMessage(): MessageWithMetadata {
	return {
		role: "user",
		content: [{ type: "text", text: `Context summary:\n\n${frozenSummary}` }],
		metadata: {
			kind: "compaction_summary",
			displayRole: "system",
			summary: frozenSummary,
			details: { readFiles: [], modifiedFiles: [] },
			tokensBefore: 0,
			generatedAt: 0,
		},
	} as unknown as MessageWithMetadata;
}

const criticalIds = new Set(
	W1_KNOWLEDGE_ORACLE.filter((item) => item.relevance === "critical").map(
		(item) => item.id,
	),
);

/**
 * The result of ONE arm.
 */
interface ArmResult {
	readonly arm: EvidenceSelectorArm;
	readonly budgetTokens: number;
	readonly selectedCount: number;
	readonly selectedCanonicalIndexes: readonly number[];
	readonly renderedChars: number;
	readonly estimatedTokens: number;
	readonly uncorrelatedCount: number;
	readonly examinedCount: number;
	readonly scores: ReturnType<typeof scoreContext>;
	readonly summary: ReturnType<typeof summariseScores>;
	readonly factualVerdicts: Record<string, string>;
	readonly newMaterialDistortions: readonly string[];
	/** The per-oracle-item detail the ACT asks for. */
	readonly perItem: readonly {
		readonly id: string;
		readonly relevance: string;
		readonly score: string;
		readonly suppliedBy: readonly string[];
		readonly missingQualifications: readonly string[];
		readonly factualVerdict: string;
		readonly sourceEvidenceExists: boolean;
		readonly sourceIdentityEstablished: boolean;
		readonly fragmentEligible: boolean;
		readonly fragmentAdmitted: boolean;
		readonly fragmentSelected: boolean;
		readonly materialQualificationsSelected: boolean;
		readonly fragmentRendered: boolean;
		readonly finalContinuationContains: boolean;
		readonly conflictingObservation: boolean;
	}[];
}

/**
 * Score ONE assembled continuation.
 *
 * The factual-consistency correction is applied on top of the semantic
 * score: a material mistranscription is `DISTORTED` or `CONTRADICTED`, never
 * `PARTIALLY_PRESERVED`.
 */
function scoreContinuation(messages: readonly MessageWithMetadata[]): {
	readonly scores: ReturnType<typeof scoreContext>;
	readonly summary: ReturnType<typeof summariseScores>;
	readonly factualVerdicts: Record<string, string>;
	readonly newMaterialDistortions: string[];
} {
	const context = decomposeProviderContinuation(messages);
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
 * The BASELINE arm: the ordinary continuation, with NO carried section.
 *
 * It is the reference every selection arm is measured against.
 */
async function buildBaselineContinuation(): Promise<MessageWithMetadata[]> {
	const contracted = await applyTaskContractToCompactedMessages(
		[frozenSummaryMessage()],
		prefix,
		{ sourceMessageCount: BOUNDARY } as never,
	);
	return applyVerifiedEvidenceToCompactedMessages(contracted.messages, prefix, {
		sourceMessageCount: BOUNDARY,
	}).messages;
}
/**
 * The SELECTED evidence, per arm and budget.
 */
interface ArmSelection {
	readonly arm: EvidenceSelectorArm;
	readonly budgetTokens: number;
	readonly selectedIndexes: readonly number[];
	readonly renderedSection: string;
	readonly estimatedTokens: number;
	readonly uncorrelatedCount: number;
	readonly examinedCount: number;
	readonly admittedCount: number;
}

function runSelection(
	arm: EvidenceSelectorArm,
	budgetTokens: number,
	signals: ReturnType<typeof buildRelevanceSignals>,
	candidates: readonly ReturnType<
		typeof collectEvidenceCandidates
	>["candidates"],
): ArmSelection {
	const result = selectEvidence({
		candidates,
		arm,
		signals,
		budget: { maxFragments: 24, maxEstimatedTokens: budgetTokens },
	});
	return {
		arm,
		budgetTokens,
		selectedIndexes: result.selected.map(
			(candidate) => candidate.fragment.canonicalIndex,
		),
		renderedSection: renderSelectionSection(result.selected, arm),
		estimatedTokens: result.estimatedTokens,
		uncorrelatedCount: result.uncorrelatedCount,
		examinedCount: result.examinedCount,
		admittedCount: candidates.length,
	};
}

/**
 * Assemble the continuation for ONE selection.
 *
 * The ONLY difference from the baseline is the carried source-bound evidence
 * section: the same frozen summary, the same task contract, the same
 * verified-outcome carry-forward, the same retained tail.
 */
function assembleContinuation(
	selection: ArmSelection,
	baseline: readonly MessageWithMetadata[],
): MessageWithMetadata[] {
	if (!selection.renderedSection) {
		return [...baseline];
	}
	const summaryIndex = baseline.findIndex(
		(message) =>
			(message.metadata as { kind?: string } | undefined)?.kind ===
			"compaction_summary",
	);
	if (summaryIndex === -1) {
		return baseline;
	}
	const message = baseline[summaryIndex];
	const current =
		(message.metadata as { summary?: string } | undefined)?.summary ?? "";
	const next = `${current}\n\n${selection.renderedSection}`;
	const messages = [...baseline];
	messages[summaryIndex] = {
		...message,
		content: [{ type: "text", text: `Context summary:\n\n${next}` }],
		metadata: {
			...(message.metadata ?? {}),
			summary: next,
		},
	} as unknown as MessageWithMetadata;
	return messages;
}

/**
 * The PER-ITEM detail the ACT asks for.
 *
 * It separates the stages the ACT names:
 *
 *   - source evidence EXISTS;
 *   - source identity ESTABLISHED;
 *   - fragment ELIGIBLE;
 *   - fragment ADMITTED;
 *   - fragment SELECTED;
 *   - material qualifications SELECTED;
 *   - fragment RENDERED;
 *   - final continuation CONTAINS the proposition;
 *   - any CONFLICTING or misleading observation.
 */
function buildPerItemDetail(
	selection: ArmSelection,
	scored: ReturnType<typeof scoreContinuation>,
	candidates: readonly ReturnType<
		typeof collectEvidenceCandidates
	>["candidates"],
): ArmResult["perItem"] {
	const rendered = selection.renderedSection;
	return W1_KNOWLEDGE_ORACLE.map((item) => {
		const score = scored.scores.find((entry) => entry.oracleItemId === item.id);
		// The fragments that the ORACLE's own evidence references point at.
		// This is the EVALUATION layer only: the oracle's indexes are never
		// an input to the selection.
		const evidenceFragments = candidates.filter((candidate) =>
			item.evidenceReferences.includes(candidate.fragment.canonicalIndex),
		);
		const selectedFragments = evidenceFragments.filter((candidate) =>
			selection.selectedIndexes.includes(candidate.fragment.canonicalIndex),
		);
		const sourceEvidenceExists = evidenceFragments.length > 0;
		const sourceIdentityEstablished =
			sourceEvidenceExists &&
			evidenceFragments.every((candidate) => candidate.identity.correlated);
		const fragmentAdmitted = sourceEvidenceExists;
		const fragmentSelected = selectedFragments.length > 0;
		const materialQualificationsSelected =
			fragmentSelected &&
			selectedFragments.some((candidate) => candidate.hasQualification);
		const fragmentRendered =
			fragmentSelected &&
			selectedFragments.every((candidate) =>
				rendered.includes(candidate.fragment.excerpt.slice(0, 60)),
			);
		return {
			id: item.id,
			relevance: item.relevance,
			score: score?.score ?? "UNOBSERVABLE",
			suppliedBy: score?.suppliedBy ?? [],
			missingQualifications: score?.missingQualifications ?? [],
			factualVerdict: scored.factualVerdicts[item.id] ?? "CONSISTENT",
			sourceEvidenceExists,
			sourceIdentityEstablished,
			fragmentEligible: sourceEvidenceExists,
			fragmentAdmitted,
			fragmentSelected,
			materialQualificationsSelected,
			fragmentRendered,
			finalContinuationContains: score?.score !== "OMITTED",
			conflictingObservation: scored.newMaterialDistortions.some((entry) =>
				entry.startsWith(`${item.id}:`),
			),
		};
	});
}

/**
 * The MAIN.
 *
 * It is DETERMINISTIC and makes NO inference request. The summary artifact
 * is FROZEN and REUSED by every arm.
 */
async function main(): Promise<void> {
	mkdirSync(PRIVATE_ROOT, { recursive: true });
	const restore = setSourceBoundEvidenceCarryForwardForTesting(true);
	try {
		// The task contract's own items are part of the task context. They are
		// the session's own brief, not oracle material.
		const contracted = await applyTaskContractToCompactedMessages(
			[frozenSummaryMessage()],
			prefix,
			{ sourceMessageCount: BOUNDARY } as never,
		);
		const contractText = contracted.messages
			.map(
				(message) =>
					(message.metadata as { summary?: string } | undefined)?.summary ?? "",
			)
			.join("\n");
		// The CANDIDATE SET is computed ONCE and shared by every arm, so the
		// arms differ ONLY in the ranking.
		const { candidates } = collectEvidenceCandidates({
			canonicalMessages: prefix,
		});
		const signals = buildRelevanceSignals({
			taskTexts: [...initialUserRequest, contractText],
			candidates,
			canonicalMessages: prefix,
		});

		// The BASELINE: the ordinary continuation, with no carried section.
		const baselineMessages = await buildBaselineContinuation();
		const baselineScored = scoreContinuation(baselineMessages);

		const arms: ArmResult[] = [];
		for (const arm of ARM_IDS) {
			for (const budget of SCREENING_BUDGETS) {
				const selection = runSelection(
					arm,
					budget.maxEstimatedTokens,
					signals,
					candidates,
				);
				const messages = assembleContinuation(selection, baselineMessages);
				const scored = scoreContinuation(messages);
				arms.push({
					arm,
					budgetTokens: budget.maxEstimatedTokens,
					selectedCount: selection.selectedIndexes.length,
					selectedCanonicalIndexes: selection.selectedIndexes,
					renderedChars: selection.renderedSection.length,
					estimatedTokens: selection.estimatedTokens,
					uncorrelatedCount: selection.uncorrelatedCount,
					examinedCount: selection.examinedCount,
					scores: scored.scores,
					summary: scored.summary,
					factualVerdicts: scored.factualVerdicts,
					newMaterialDistortions: scored.newMaterialDistortions,
					perItem: buildPerItemDetail(selection, scored, candidates),
				});
				// The raw continuation stays in the private tree.
				writeFileSync(
					join(
						PRIVATE_ROOT,
						`${SESSION_ID}.${arm}.${budget.maxEstimatedTokens}.context.txt`,
					),
					JSON.stringify(messages),
				);
			}
		}

		// The ABLATION: the STRUCTURAL ablation of the best arm. It is the
		// SAME continuation with the carried section STRIPPED, so the
		// summarizer request is byte-identical and the ONLY difference is the
		// selection.
		const best = arms.reduce((left, right) =>
			right.summary.criticalOmitted < left.summary.criticalOmitted
				? right
				: left,
		);
		const bestSelection = runSelection(
			best.arm,
			best.budgetTokens,
			signals,
			candidates,
		);
		const ablatedMessages = assembleContinuation(
			{ ...bestSelection, renderedSection: "" },
			baselineMessages,
		);
		const ablatedScored = scoreContinuation(ablatedMessages);

		const report = {
			sessionId: SESSION_ID,
			frozenPrefix: {
				boundary: BOUNDARY,
				prefixHash: computedPrefixHash,
				fullCanonicalLength: canonical.length,
				postBoundaryMessageCount: canonical.length - BOUNDARY,
			},
			frozenSummary: {
				digest: frozenSummaryDigest,
				chars: frozenSummary.length,
				estimatedTokens: estimateTokens(frozenSummary),
			},
			taskContext: {
				initialRequestChars: initialUserRequest.join("\n").length,
				taskIdentifierCount: signals.taskIdentifiers.size,
				taskTokenCount: signals.taskTokens.size,
			},
			baseline: {
				scores: baselineScored.scores,
				summary: baselineScored.summary,
				factualVerdicts: baselineScored.factualVerdicts,
				newMaterialDistortions: baselineScored.newMaterialDistortions,
			},
			arms,
			structuralAblation: {
				arm: best.arm,
				budgetTokens: best.budgetTokens,
				scores: ablatedScored.scores,
				summary: ablatedScored.summary,
				newMaterialDistortions: ablatedScored.newMaterialDistortions,
			},
		};
		writeFileSync(
			join(PRIVATE_ROOT, `${SESSION_ID}.selection-evaluation.json`),
			JSON.stringify(report, null, 2),
		);

		// The AGGREGATE, non-reversible report.
		const lines: string[] = [];
		lines.push(`FROZEN_PREFIX=${computedPrefixHash}`);
		lines.push(`FROZEN_SUMMARY_DIGEST=${frozenSummaryDigest}`);
		lines.push("");
		lines.push(
			`BASELINE criticalOmitted=${baselineScored.summary.criticalOmitted} criticalPreserved=${baselineScored.summary.criticalPreserved} criticalPartial=${baselineScored.summary.criticalPartiallyPreserved} distortions=${baselineScored.newMaterialDistortions.length}`,
		);
		for (const arm of arms) {
			const o1 = arm.scores.find((entry) => entry.oracleItemId === "O1");
			const o4 = arm.scores.find((entry) => entry.oracleItemId === "O4");
			const o7 = arm.scores.find((entry) => entry.oracleItemId === "O7");
			lines.push(
				[
					`arm=${arm.arm}`,
					`budget=${arm.budgetTokens}`,
					`selected=${arm.selectedCount}`,
					`estTokens=${arm.estimatedTokens}`,
					`renderedChars=${arm.renderedChars}`,
					`critOmitted=${arm.summary.criticalOmitted}`,
					`critPreserved=${arm.summary.criticalPreserved}`,
					`critPartial=${arm.summary.criticalPartiallyPreserved}`,
					`O1=${o1?.score}`,
					`O4=${o4?.score}`,
					`O7=${o7?.score}`,
					`distortions=${arm.newMaterialDistortions.length}`,
					`uncorrelated=${arm.uncorrelatedCount}`,
				].join(" "),
			);
		}
		lines.push("");
		lines.push(
			`STRUCTURAL_ABLATION arm=${best.arm} budget=${best.budgetTokens} critOmitted=${ablatedScored.summary.criticalOmitted} critPreserved=${ablatedScored.summary.criticalPreserved}`,
		);
		lines.push(
			`ADDITIONAL_INFERENCE_REQUESTS=0 (the summary artifact is frozen and reused)`,
		);
		console.log(lines.join("\n"));
	} finally {
		restore();
	}
}

await main();
