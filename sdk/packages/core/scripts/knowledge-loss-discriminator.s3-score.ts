/**
 * ACT-CLINEMM-COMPACTION-INCREMENTAL-KNOWLEDGE-LOSS-DISCRIMINATOR-01
 *
 * C5 — the S3 AGGREGATION.
 *
 * ============================================================================
 * WHAT IT DOES
 * ============================================================================
 *
 * It adjudicates every arm's probe answers against the explicit rubric and
 * produces the behavioural summary, together with the measured inference
 * economics per arm.
 *
 * ============================================================================
 * CONFIDENTIALITY
 * ============================================================================
 *
 * The output carries the AGGREGATE counts and the per-item SCORE, never the
 * answer prose. The raw answers stay in the gitignored tree.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MessageWithMetadata } from "@cline/shared";
import {
	type AdjudicatedAnswer,
	adjudicateAnswer,
	summariseBehaviour,
} from "../src/extensions/context/knowledge-loss-discriminator/answer-adjudicator";
import { W1_KNOWLEDGE_ORACLE } from "../src/extensions/context/knowledge-loss-discriminator/oracle";

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
	console.error("usage: knowledge-loss-discriminator.s3-score.ts <sessionId>");
	process.exit(2);
}

const sessionsRoot = join(homedir(), ".vscodium-roz", "cline-data", "sessions");
const sessionDir = join(sessionsRoot, sessionId);
const _state = JSON.parse(
	readFileSync(join(sessionDir, `${sessionId}.compaction.json`), "utf8"),
) as { messages: MessageWithMetadata[] };

const criticalIds = new Set(
	W1_KNOWLEDGE_ORACLE.filter((i) => i.relevance === "critical").map(
		(i) => i.id,
	),
);

// The S2 verdict per oracle item, so that the behavioural classification can
// distinguish a COMPACTION loss from a MODEL failure.
const arms = JSON.parse(
	readFileSync(join(PRIVATE_ROOT, `${sessionId}.arms.json`), "utf8"),
) as {
	arms: Record<string, { scores: { oracleItemId: string; score: string }[] }>;
};
const s2Scores = new Map(
	(arms.arms.A0?.scores ?? []).map((s) => [s.oracleItemId, s.score]),
);

interface ArmProbe {
	arm: string;
	contextBlockChars: number;
	probeCount: number;
	leakageWitness: { leaked: boolean; leakedTerms: string[] };
	results: {
		oracleItemId: string;
		relevance: string;
		measurement: {
			answer: string;
			physicalRequestCount: number;
			promptTokens?: number;
			cacheReadTokens?: number;
			completionTokens?: number;
			latencyMs: number;
			finishReason?: string;
			providerFailed: boolean;
			serializedRequestChars: number;
		};
	}[];
}

const report: Record<string, unknown> = {};
for (const armId of ["H", "F", "M", "A0", "A1"]) {
	const probePath = join(PRIVATE_ROOT, `${sessionId}.probe-${armId}.json`);
	if (!existsSync(probePath)) {
		continue;
	}
	const probe = JSON.parse(readFileSync(probePath, "utf8")) as ArmProbe;
	const answers: AdjudicatedAnswer[] = [];
	const economics: {
		totalLatencyMs: number;
		totalPhysicalRequests: number;
		totalPromptTokens: number;
		totalCacheReadTokens: number;
		totalCompletionTokens: number;
		meanSerializedRequestChars: number;
		providerFailures: number;
	} = {
		totalLatencyMs: 0,
		totalPhysicalRequests: 0,
		totalPromptTokens: 0,
		totalCacheReadTokens: 0,
		totalCompletionTokens: 0,
		meanSerializedRequestChars: 0,
		providerFailures: 0,
	};
	for (const result of probe.results) {
		const item = W1_KNOWLEDGE_ORACLE.find((i) => i.id === result.oracleItemId);
		if (!item) {
			continue;
		}
		const informationAvailable =
			armId === "F" || armId === "M"
				? true
				: (s2Scores.get(result.oracleItemId) ?? "UNOBSERVABLE") !== "OMITTED";
		answers.push(
			adjudicateAnswer({
				item,
				answer: result.measurement.answer,
				providerFailed: result.measurement.providerFailed,
				informationAvailable,
				fullSourceArm: armId === "F" || armId === "M",
			}),
		);
		economics.totalLatencyMs += result.measurement.latencyMs;
		economics.totalPhysicalRequests += result.measurement.physicalRequestCount;
		economics.totalPromptTokens += result.measurement.promptTokens ?? 0;
		economics.totalCacheReadTokens += result.measurement.cacheReadTokens ?? 0;
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
	report[armId] = {
		arm: armId,
		contextBlockChars: probe.contextBlockChars,
		probeCount: probe.probeCount,
		leakageWitness: probe.leakageWitness,
		behaviour: summariseBehaviour(answers, criticalIds),
		economics,
		answers: answers.map((a) => ({
			oracleItemId: a.oracleItemId,
			score: a.score,
			classification: a.behaviouralClassification,
			unsatisfiedCriteria: a.unsatisfiedCriteria,
		})),
	};
}

const outPath = join(PRIVATE_ROOT, `${sessionId}.s3.json`);
writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
