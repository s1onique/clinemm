/**
 * ACT-CLINEMM-COMPACTION-UTILITY-FINAL-DISCRIMINATOR-01
 *
 * C2 — THE THREE EXPERIMENTAL ARMS.
 *
 * ============================================================================
 * WHAT IT DOES
 * ============================================================================
 *
 * It assembles THREE internally consistent resumed-agent continuations over
 * the FROZEN W1 workload, and FREEZES them:
 *
 *   A — ORDINARY CONTINUATION.
 *       The production projection of the persisted compaction sidecar: the
 *       frozen ordinary summary, the carried task contract, the carried
 *       verified outcomes, and the REAL retained tail. No experimental
 *       evidence.
 *
 *   B — EXISTING DETERMINISTIC EVIDENCE.
 *       The SAME continuation plus the FROZEN S2 SUBJECT_DIVERSITY@2048
 *       selected evidence section, rendered by the production renderer.
 *       Nothing is re-ranked and no qualification is added.
 *
 *   C — MINIMAL TARGETED RESTORATION.
 *       The SAME continuation plus the ALREADY-ESTABLISHED minimal original
 *       evidence needed to answer O1/O4/O7. This is an ORACLE-GUIDED
 *       POSITIVE CAPACITY CONTROL, not a deployable selection policy.
 *
 * ============================================================================
 * WHY THE PRODUCTION PROJECTOR IS USED
 * ============================================================================
 *
 * The predecessor's evaluation built a CONSTRUCTED summary context and never
 * appended the retained tail, so it was not a complete resumed-agent
 * context. This script uses `projectSessionCompactionState()` — the
 * PRODUCTION projector — over the frozen boundary, which yields the
 * sidecar's compacted messages PLUS the canonical tail beyond the boundary.
 *
 * ============================================================================
 * WHAT IT DOES NOT DO
 * ============================================================================
 *
 *   - It makes NO inference request. The probe is a separate script.
 *   - It does NOT re-rank candidates. Arm B's selection is FROZEN: it is
 *     recomputed with the SAME code, the SAME signals and the SAME budget,
 *     and the resulting index set is asserted to equal the recorded one.
 *   - It does NOT change the production selector, the production admission
 *     contract or the production publication path.
 *   - It does NOT write a raw history, a raw prompt or a raw model response
 *     outside the GITIGNORED private tree.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
	type EvidenceCandidate,
	estimateTokens,
	renderSelectionSection,
	SCREENING_BUDGETS,
	selectEvidence,
} from "../src/extensions/context/task-conditioned-evidence-selection";
import { applyTaskContractToCompactedMessages } from "../src/extensions/context/task-contract";
import {
	canonicalSourceMessages,
	projectSessionCompactionState,
} from "../src/session/models/session-compaction";

const SESSION_ID = process.argv[2] ?? "1795491524406_mutdb";
const BOUNDARY = Number(process.argv[3] ?? 244);
/** The FROZEN winning candidate: S2 SUBJECT_DIVERSITY at 2048 estimated tokens. */
const FROZEN_ARM = "SUBJECT_DIVERSITY";
const FROZEN_BUDGET = 2048;
/**
 * The FROZEN selected canonical indexes of arm B, as recorded by the
 * predecessor ACT. The arm is asserted to reproduce them EXACTLY; a change
 * is a FAILURE of the freeze, not a re-ranking.
 */
const FROZEN_B_INDEXES: readonly number[] = [143, 127, 227, 187, 141];

const PRIVATE_ROOT = join(
	process.cwd(),
	"..",
	"..",
	"..",
	"tmp",
	"utility-final-discriminator",
);

const sessionsRoot = join(homedir(), ".vscodium-roz", "cline-data", "sessions");
const sessionDir = join(sessionsRoot, SESSION_ID);

function sha256(text: string): string {
	return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

/**
 * The persisted session state and the persisted compaction sidecar.
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
 * ============================================================================
 * THE FROZEN ARTEFACT IDENTITIES
 * ============================================================================
 *
 * Every identity is VERIFIED, not assumed. A mismatch throws and the ACT
 * stops before any arm is assembled.
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
if (state.source_message_count !== BOUNDARY) {
	throw new Error(
		`the persisted boundary does not match the frozen one: recorded ${state.source_message_count}, expected ${BOUNDARY}`,
	);
}
const prefix = canonical.slice(0, BOUNDARY);

/**
 * The FROZEN ordinary summary artifact.
 */
const FROZEN_SUMMARY_PATH = join(
	process.cwd(),
	"..",
	"..",
	"..",
	"tmp",
	"task-conditioned-selection",
	`${SESSION_ID}.A-summary.txt`,
);
const frozenSummary = readFileSync(FROZEN_SUMMARY_PATH, "utf8");
const frozenSummaryDigest = sha256(frozenSummary);
const FROZEN_SUMMARY_DIGEST =
	"sha256:9ac862f0a4c1d4c56bca01978e61d5122603e3c3ba9dc2f795a81942bde1e93d";
if (frozenSummaryDigest !== FROZEN_SUMMARY_DIGEST) {
	throw new Error(
		`the frozen summary artifact's digest does not match the frozen one: computed ${frozenSummaryDigest}, expected ${FROZEN_SUMMARY_DIGEST}`,
	);
}

/**
 * The TASK CONTEXT: the session's OWN material. It is NOT oracle-derived.
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
 * ============================================================================
 * THE PRODUCTION PROJECTION
 * ============================================================================
 *
 * `projectSessionCompactionState()` is the PRODUCTION projector. It yields
 * the sidecar's compacted messages PLUS the canonical tail beyond the
 * boundary. The tail is what the predecessor's evaluation never appended.
 */
const projected = projectSessionCompactionState(
	{
		version: 1,
		updated_at: new Date(0).toISOString(),
		source_message_count: state.source_message_count,
		...(state.source_prefix_hash
			? { source_prefix_hash: state.source_prefix_hash }
			: {}),
		messages: state.messages,
	},
	canonical,
);
if (!projected) {
	throw new Error(
		"the production projector REFUSED the frozen state, so no arm can be assembled over it",
	);
}
const compactedCount = state.messages.length;
if (projected.length !== compactedCount + (canonical.length - BOUNDARY)) {
	throw new Error(
		`the projection is not internally consistent: ${projected.length} messages for ${compactedCount} compacted and ${canonical.length - BOUNDARY} tail messages`,
	);
}

/**
 * The summary message the projector produced. It is the REAL production
 * summary: the frozen ordinary summary plus the carried task contract and
 * the carried verified outcomes. It is NOT regenerated.
 */
const projectedSummary = projected[0];

/**
 * The TASK CONTEXT text: the contract the production composition carries.
 */
async function contractText(): Promise<string> {
	const contracted = await applyTaskContractToCompactedMessages(
		[projectedSummary],
		prefix,
		{ sourceMessageCount: BOUNDARY } as never,
	);
	return contracted.messages
		.map(
			(message) =>
				(message.metadata as { summary?: string } | undefined)?.summary ?? "",
		)
		.join("\n");
}

/**
 * ============================================================================
 * THE ARMS
 * ============================================================================
 */
interface Arm {
	readonly id: "A" | "B" | "C";
	readonly label: string;
	readonly messages: readonly MessageWithMetadata[];
	readonly renderedSectionChars: number;
	readonly selectedIndexes: readonly number[];
	readonly addedContextTokensEstimated: number;
}

/**
 * The PRODUCTION carry-forward chain, applied over the projected state.
 *
 * The order is the PRODUCTION order: the task contract, then the verified
 * outcomes. The source-bound evidence is applied by the caller, because its
 * selection differs per arm.
 */
async function carryForwards(
	messages: readonly MessageWithMetadata[],
): Promise<MessageWithMetadata[]> {
	const contracted = await applyTaskContractToCompactedMessages(
		[messages[0]],
		prefix,
		{ sourceMessageCount: BOUNDARY } as never,
	);
	const evidenced = applyVerifiedEvidenceToCompactedMessages(
		contracted.messages,
		prefix,
		{ sourceMessageCount: BOUNDARY },
	);
	return [...evidenced.messages, ...messages.slice(1)];
}

/**
 * Rebuild the summary message with an appended section.
 */
function withSection(
	messages: readonly MessageWithMetadata[],
	section: string,
): MessageWithMetadata[] {
	if (!section) {
		return [...messages];
	}
	const summaryIndex = messages.findIndex(
		(message) =>
			(message.metadata as { kind?: string } | undefined)?.kind ===
			"compaction_summary",
	);
	if (summaryIndex === -1) {
		throw new Error("the projected continuation carries no summary message");
	}
	const message = messages[summaryIndex];
	const current =
		(message.metadata as { summary?: string } | undefined)?.summary ?? "";
	const next = `${current}\n\n${section}`;
	const out = [...messages];
	out[summaryIndex] = {
		...message,
		content: [{ type: "text", text: `Context summary:\n\n${next}` }],
		metadata: { ...(message.metadata ?? {}), summary: next },
	} as unknown as MessageWithMetadata;
	return out;
}

/**
 * The SCORING of ONE assembled continuation.
 *
 * It is the SAME scorer the predecessor used. The automated scorer is
 * SUPPLEMENTAL: the decisive oracle is the direct source adjudication.
 */
function scoreContinuation(messages: readonly MessageWithMetadata[]): {
	readonly scores: ReturnType<typeof scoreContext>;
	readonly summary: ReturnType<typeof summariseScores>;
	readonly factualVerdicts: Record<string, string>;
	readonly newMaterialDistortions: readonly string[];
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
		summary: summariseScores(
			corrected,
			new Set(
				W1_KNOWLEDGE_ORACLE.filter((i) => i.relevance === "critical").map(
					(i) => i.id,
				),
			),
		),
		factualVerdicts,
		newMaterialDistortions,
	};
}

/**
 * ============================================================================
 * THE MAIN
 * ============================================================================
 */
async function main(): Promise<void> {
	mkdirSync(PRIVATE_ROOT, { recursive: true });
	const restore = setSourceBoundEvidenceCarryForwardForTesting(true);
	try {
		const base = await carryForwards(projected);

		// ---------------------------------------------------------------------
		// THE CANDIDATE SET AND THE SIGNALS
		// ---------------------------------------------------------------------
		const { candidates } = collectEvidenceCandidates({
			canonicalMessages: prefix,
		});
		const signals = buildRelevanceSignals({
			taskTexts: [...initialUserRequest, await contractText()],
			candidates,
			canonicalMessages: prefix,
		});

		// ---------------------------------------------------------------------
		// ARM B — THE FROZEN S2@2048 SELECTION
		// ---------------------------------------------------------------------
		const budget = SCREENING_BUDGETS.find(
			(entry) => entry.maxEstimatedTokens === FROZEN_BUDGET,
		);
		if (!budget) {
			throw new Error(
				`the frozen budget ${FROZEN_BUDGET} is not one of the screening budgets`,
			);
		}
		const frozenSelection = selectEvidence({
			candidates,
			arm: FROZEN_ARM,
			signals,
			budget: { maxFragments: 24, maxEstimatedTokens: FROZEN_BUDGET },
		});
		const selectedIndexes = frozenSelection.selected.map(
			(candidate) => candidate.fragment.canonicalIndex,
		);
		if (
			selectedIndexes.length !== FROZEN_B_INDEXES.length ||
			!FROZEN_B_INDEXES.every((index) => selectedIndexes.includes(index))
		) {
			throw new Error(
				`the frozen selection did NOT reproduce the recorded one: ${JSON.stringify(selectedIndexes)} vs ${JSON.stringify(FROZEN_B_INDEXES)}`,
			);
		}
		const sectionB = renderSelectionSection(
			frozenSelection.selected,
			FROZEN_ARM,
		);

		// ---------------------------------------------------------------------
		// ARM C — THE MINIMAL TARGETED RESTORATION
		// ---------------------------------------------------------------------
		//
		// It restores the ALREADY-ESTABLISHED minimal original evidence that
		// the source shows is needed to answer O1, O4 and O7. It is an
		// ORACLE-GUIDED POSITIVE CAPACITY CONTROL: the fragments are the
		// ORIGINAL tool-result bodies, admitted by the PRODUCTION admission
		// contract and rendered by the PRODUCTION renderer. It is NOT a
		// deployable selection policy.
		const cIndexes = new Set<number>([
			7, // O4 — the `*Test.java` conventional-suffix count (47)
			65, // O4 — the broader pattern count (73)
			67, // O4 — the counting-definition separation (73 / 47 / skipTests)
			145, // O1 — the failed render (exit=1, the template type error)
			147, // O1 — the successful render with the explicit environment override
			187, // O7 — the notification-service default timeout constants
			189, // O7 — the production default service selection
		]);
		const cCandidates: EvidenceCandidate[] = candidates.filter((candidate) =>
			cIndexes.has(candidate.fragment.canonicalIndex),
		);
		const cSection = renderSelectionSection(cCandidates, "TASK_CONDITIONED");

		// ---------------------------------------------------------------------
		// THE ARMS
		// ---------------------------------------------------------------------
		const arms: Arm[] = [
			{
				id: "A",
				label: "A_ORDINARY_CONTINUATION",
				messages: base,
				renderedSectionChars: 0,
				selectedIndexes: [],
				addedContextTokensEstimated: 0,
			},
			{
				id: "B",
				label: "B_EXISTING_DETERMINISTIC_EVIDENCE_S2_2048",
				messages: withSection(base, sectionB),
				renderedSectionChars: sectionB.length,
				selectedIndexes,
				addedContextTokensEstimated: estimateTokens(sectionB),
			},
			{
				id: "C",
				label: "C_MINIMAL_TARGETED_RESTORATION",
				messages: withSection(base, cSection),
				renderedSectionChars: cSection.length,
				selectedIndexes: [...cIndexes].sort((a, b) => a - b),
				addedContextTokensEstimated: estimateTokens(cSection),
			},
		];

		// ---------------------------------------------------------------------
		// THE BASELINE IDENTITY GATE
		// ---------------------------------------------------------------------
		//
		// Arms B and C must differ from arm A ONLY by the carried section. The
		// gate asserts that the tail is byte-identical across the arms.
		const baselineTail = JSON.stringify(base.slice(1));
		for (const arm of arms) {
			if (JSON.stringify(arm.messages.slice(1)) !== baselineTail) {
				throw new Error(
					`arm ${arm.id} does not share the baseline tail, so the arms are not comparable`,
				);
			}
		}

		// ---------------------------------------------------------------------
		// THE SCORING
		// ---------------------------------------------------------------------
		const scored = arms.map((arm) => ({
			id: arm.id,
			label: arm.label,
			...scoreContinuation(arm.messages),
		}));

		// ---------------------------------------------------------------------
		// THE REPORT
		// ---------------------------------------------------------------------
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
			projection: {
				projectedMessageCount: projected.length,
				compactedMessageCount: compactedCount,
				retainedTailMessageCount: projected.length - compactedCount,
				tailIndexesInCanonical: Array.from(
					{ length: canonical.length - BOUNDARY },
					(_, offset) => BOUNDARY + offset,
				),
			},
			arms: arms.map((arm, index) => ({
				id: arm.id,
				label: arm.label,
				messageCount: arm.messages.length,
				renderedSectionChars: arm.renderedSectionChars,
				addedContextTokensEstimated: arm.addedContextTokensEstimated,
				selectedIndexes: arm.selectedIndexes,
				summary: scored[index].summary,
				factualVerdicts: scored[index].factualVerdicts,
				newMaterialDistortions: scored[index].newMaterialDistortions,
				scores: scored[index].scores,
			})),
		};

		writeFileSync(
			join(PRIVATE_ROOT, `${SESSION_ID}.arms.json`),
			JSON.stringify(report, null, 2),
		);
		for (const arm of arms) {
			writeFileSync(
				join(PRIVATE_ROOT, `${SESSION_ID}.arm-${arm.id}.messages.json`),
				JSON.stringify(arm.messages),
			);
		}

		const lines: string[] = [];
		lines.push(`FROZEN_PREFIX=${computedPrefixHash}`);
		lines.push(`FROZEN_SUMMARY_DIGEST=${frozenSummaryDigest}`);
		lines.push(
			`PROJECTION projectMessages=${projected.length} compacted=${compactedCount} tail=${projected.length - compactedCount}`,
		);
		for (const arm of arms) {
			const index = arms.indexOf(arm);
			const s = scored[index];
			const o1 = s.scores.find((e) => e.oracleItemId === "O1");
			const o4 = s.scores.find((e) => e.oracleItemId === "O4");
			const o7 = s.scores.find((e) => e.oracleItemId === "O7");
			lines.push(
				[
					`arm=${arm.id}`,
					`sectionChars=${arm.renderedSectionChars}`,
					`addedEstTokens=${arm.addedContextTokensEstimated}`,
					`critOmitted=${s.summary.criticalOmitted}`,
					`critPreserved=${s.summary.criticalPreserved}`,
					`critPartial=${s.summary.criticalPartiallyPreserved}`,
					`O1=${o1?.score}`,
					`O4=${o4?.score}`,
					`O7=${o7?.score}`,
					`distortions=${s.newMaterialDistortions.length}`,
				].join(" "),
			);
		}
		lines.push("ADDITIONAL_INFERENCE_REQUESTS=0");
		console.log(lines.join("\n"));
	} finally {
		restore();
	}
}

await main();
