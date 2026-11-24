/**
 * ACT-CLINEMM-COMPACTION-FACTUAL-PRESERVATION-REPAIR-01
 *
 * C7 — the RE-SCORE over the SAVED arms.
 *
 * The scorer changed after the live qualification ran (the opposite-
 * assertion scoping), so the saved continuations are re-scored with the
 * CURRENT scorer. No inference is repeated: the arms are the ones the live
 * run produced.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MessageWithMetadata } from "@cline/shared";
import { decomposeProviderContinuation } from "../src/extensions/context/knowledge-loss-discriminator/context-parts";
import {
	correctScoreForFactualVerdict,
	decideFactualVerdict,
} from "../src/extensions/context/knowledge-loss-discriminator/factual-preservation";
import { scoreContext } from "../src/extensions/context/knowledge-loss-discriminator/inventory";
import { W1_KNOWLEDGE_ORACLE } from "../src/extensions/context/knowledge-loss-discriminator/oracle";
import { summariseScores } from "../src/extensions/context/knowledge-loss-discriminator/scoring";

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
	console.error("usage: factual-preservation-rescore.ts <sessionId>");
	process.exit(2);
}

const criticalIds = new Set(
	W1_KNOWLEDGE_ORACLE.filter((item) => item.relevance === "critical").map(
		(item) => item.id,
	),
);

const arms: Record<string, unknown> = {};
for (const arm of ["A", "B", "C", "C_MINUS_EVIDENCE"]) {
	const path = join(PRIVATE_ROOT, `${sessionId}.${arm}-context.txt`);
	let messages: MessageWithMetadata[];
	try {
		messages = JSON.parse(readFileSync(path, "utf8")) as MessageWithMetadata[];
	} catch {
		continue;
	}
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
	arms[arm] = {
		summary: summariseScores(corrected, criticalIds),
		factualVerdicts,
		newMaterialDistortions,
		scores: corrected,
		decisive: Object.fromEntries(
			["O1", "O4", "O7"].map((id) => [
				id,
				corrected.find((entry) => entry.oracleItemId === id)?.score,
			]),
		),
	};
}
const report = { sessionId, arms } as const;
writeFileSync(
	join(PRIVATE_ROOT, `${sessionId}.rescore.json`),
	JSON.stringify(report, null, 2),
	"utf8",
);
console.log(JSON.stringify(report, null, 2));
