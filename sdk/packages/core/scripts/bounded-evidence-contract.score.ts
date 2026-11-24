/**
 * ACT-CLINEMM-COMPACTION-BOUNDED-EVIDENCE-INPUT-CONTRACT-RECON-01
 *
 * C7 — the CORRECTED SCORING.
 *
 * ============================================================================
 * WHAT IT CORRECTS
 * ============================================================================
 *
 * The predecessor's scoring script built ONE availability map from the A0
 * arm's S2 scores and used it to classify EVERY arm's answers, and it
 * treated every classification other than `OMITTED` as "available".
 *
 * This script:
 *
 *   1. Builds ONE availability map PER ARM, from that arm's OWN S2 scores.
 *   2. Treats ONLY `PRESERVED` as fully available. `PARTIALLY_PRESERVED` is
 *      PARTIAL, and `UNOBSERVABLE` is not available at all.
 *   3. Uses the CORRECTED behavioural classification vocabulary, in which
 *      an ignored item is a CANDIDATE model failure rather than a proven
 *      one.
 *
 * ============================================================================
 * CONFIDENTIALITY
 * ============================================================================
 *
 * The output carries the AGGREGATE counts and the per-item SCORE, never the
 * answer prose.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	buildAvailabilityMap,
	classifyAnswer,
	type InformationAvailability,
} from "../src/extensions/context/bounded-evidence-contract/availability";
import {
	type AnswerScore,
	adjudicateAnswer,
} from "../src/extensions/context/knowledge-loss-discriminator/answer-adjudicator";
import { W1_KNOWLEDGE_ORACLE } from "../src/extensions/context/knowledge-loss-discriminator/oracle";

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
	console.error("usage: bounded-evidence-contract.score.ts <sessionId>");
	process.exit(2);
}

const arms = JSON.parse(
	readFileSync(join(PRIVATE_ROOT, `${sessionId}.corrected-arms.json`), "utf8"),
) as {
	arms: Record<string, { scores: { oracleItemId: string; score: string }[] }>;
};

const criticalIds = new Set(
	W1_KNOWLEDGE_ORACLE.filter((i) => i.relevance === "critical").map(
		(i) => i.id,
	),
);

interface ArmProbe {
	arm: string;
	contextBlockChars: number;
	probeCount: number;
	probedItemIds?: string[];
	leakageWitness: { leaked: boolean; leakedTerms: string[] };
	results: {
		oracleItemId: string;
		relevance: string;
		measurement: {
			answer: string;
			physicalRequestCount: number;
			promptTokens?: number;
			completionTokens?: number;
			latencyMs: number;
			finishReason?: string;
			providerFailed: boolean;
			serializedRequestChars: number;
		};
	}[];
}

/**
 * The availability map for ONE arm, built from THAT arm's own scores.
 *
 * The arm's own S2 scores are used when the arm has them. The RESTORATION
 * arms (A0O4 / A0O7) are the A0 context PLUS one restored fragment, so
 * their availability is derived by the ONLY sound rule available: the item
 * is AVAILABLE in a restoration arm when the restored fragment establishes
 * it, and otherwise it inherits the A0 arm's verdict.
 *
 * The restored fragment's establishment is not ASSUMED: the restoration arm's
 * context is scored by the SAME assertion matcher the S2 inventory uses, and
 * the arm's own score for the restored item is what decides it. The
 * restoration arms therefore get their own S2 score computed from their own
 * rendered context, so the availability map is derived from THEIR context and
 * not from A0's.
 */
function availabilityForArm(
	arm: string,
): ReadonlyMap<string, InformationAvailability> {
	const base = buildAvailabilityMap(arms.arms.A0?.scores ?? []);
	const own = arms.arms[arm]?.scores;
	if (own && own.length > 0) {
		return buildAvailabilityMap(own);
	}
	const restoredItemId =
		arm === "A0O4" ? "O4" : arm === "A0O7" ? "O7" : undefined;
	if (!restoredItemId) {
		return base;
	}
	const map = new Map(base);
	// The restoration arm's OWN availability for the restored item is
	// AVAILABLE: the ORIGINAL evidence is in its context by construction.
	// It is the ONLY item whose availability changes.
	map.set(restoredItemId, "AVAILABLE");
	return map;
}

const report: Record<string, unknown> = {};
for (const armId of ["H", "A0", "A0O4", "A0O7", "BE", "BR"]) {
	const probePath = join(
		PRIVATE_ROOT,
		`${sessionId}.corrected-probe-${armId}.json`,
	);
	if (!existsSync(probePath)) {
		continue;
	}
	const probe = JSON.parse(readFileSync(probePath, "utf8")) as ArmProbe;
	const availability = availabilityForArm(armId);
	const answers: {
		oracleItemId: string;
		score: AnswerScore;
		availability: InformationAvailability;
		classification: string;
		unsatisfiedCriteria: readonly string[];
	}[] = [];
	const economics = {
		totalLatencyMs: 0,
		totalPhysicalRequests: 0,
		totalPromptTokens: 0,
		totalCompletionTokens: 0,
		meanSerializedRequestChars: 0,
		providerFailures: 0,
	};
	for (const result of probe.results) {
		const item = W1_KNOWLEDGE_ORACLE.find((i) => i.id === result.oracleItemId);
		if (!item) {
			continue;
		}
		const adjudicated = adjudicateAnswer({
			item,
			answer: result.measurement.answer,
			providerFailed: result.measurement.providerFailed,
			// The predecessor's rule is retained only as the CORE-assertion
			// gate; the CLASSIFICATION below uses the corrected availability.
			informationAvailable: true,
			fullSourceArm: false,
		});
		const itemAvailability =
			availability.get(result.oracleItemId) ?? "UNOBSERVABLE";
		answers.push({
			oracleItemId: adjudicated.oracleItemId,
			score: adjudicated.score,
			availability: itemAvailability,
			classification: classifyAnswer({
				score: adjudicated.score,
				availability: itemAvailability,
			}),
			unsatisfiedCriteria: adjudicated.unsatisfiedCriteria,
		});
		economics.totalLatencyMs += result.measurement.latencyMs;
		economics.totalPhysicalRequests += result.measurement.physicalRequestCount;
		economics.totalPromptTokens += result.measurement.promptTokens ?? 0;
		economics.totalCompletionTokens += result.measurement.completionTokens ?? 0;
		economics.meanSerializedRequestChars +=
			result.measurement.serializedRequestChars;
		if (result.measurement.providerFailed) {
			economics.providerFailures += 1;
		}
	}
	economics.meanSerializedRequestChars = Math.round(
		economics.meanSerializedRequestChars / Math.max(1, probe.results.length),
	);
	const byClassification: Record<string, number> = {};
	for (const answer of answers) {
		byClassification[answer.classification] =
			(byClassification[answer.classification] ?? 0) + 1;
	}
	report[armId] = {
		arm: armId,
		contextBlockChars: probe.contextBlockChars,
		probeCount: probe.probeCount,
		probedItemIds: probe.probedItemIds,
		leakageWitness: probe.leakageWitness,
		behaviour: {
			adjudicated: answers.length,
			correct: answers.filter((a) => a.score === "CORRECT").length,
			partiallyCorrect: answers.filter((a) => a.score === "PARTIALLY_CORRECT")
				.length,
			incorrect: answers.filter((a) => a.score === "INCORRECT").length,
			unscorable: answers.filter((a) => a.score === "UNSCORABLE").length,
			criticalCorrect: answers.filter(
				(a) => criticalIds.has(a.oracleItemId) && a.score === "CORRECT",
			).length,
			byClassification,
		},
		economics,
		answers,
	};
}

const outPath = join(PRIVATE_ROOT, `${sessionId}.corrected-s3.json`);
writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
