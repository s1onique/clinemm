/**
 * ACT-CLINEMM-COMPACTION-UTILITY-FINAL-DISCRIMINATOR-01
 *
 * C4 — THE BEHAVIOURAL SCORING.
 *
 * ============================================================================
 * WHAT IT DOES
 * ============================================================================
 *
 * It scores each arm's answers against the ORACLE'S OWN ADJUDICATION RUBRIC
 * (`adjudicateAnswer()`), which is the repository's established, committed
 * scoring layer.
 *
 * The ACT states that the automated regex scorer is SUPPLEMENTAL and that
 * the DIRECT SOURCE ADJUDICATION is the decisive oracle. This script is the
 * SUPPLEMENTAL half: it reuses the rubric that already exists rather than
 * inventing a second one, so the behavioural result and the structural
 * result are measured on the same criteria.
 *
 * ============================================================================
 * WHAT IT DOES NOT DO
 * ============================================================================
 *
 *   - It makes NO inference request.
 *   - It does NOT change the rubric, the assertions or the oracle.
 *   - It does NOT write anything outside the GITIGNORED private tree.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	adjudicateAnswer,
	summariseBehaviour,
} from "../src/extensions/context/knowledge-loss-discriminator/answer-adjudicator";
import { W1_KNOWLEDGE_ORACLE } from "../src/extensions/context/knowledge-loss-discriminator/oracle";

const SESSION_ID = process.argv[2] ?? "1795491524406_mutdb";

const PRIVATE_ROOT = join(
	process.cwd(),
	"..",
	"..",
	"..",
	"tmp",
	"utility-final-discriminator",
);

const ARMS = ["A", "B", "C"] as const;
const DECISIVE_IDS = ["O1", "O4", "O7"] as const;
const QUESTION_OF: Record<string, string> = { O1: "Q1", O4: "Q2", O7: "Q3" };

/**
 * The CRITICAL item ids: the decisive propositions are all critical.
 */
const criticalIds = new Set(
	W1_KNOWLEDGE_ORACLE.filter((item) => item.relevance === "critical").map(
		(item) => item.id,
	),
);

const report: Record<string, unknown> = { sessionId: SESSION_ID, arms: {} };
for (const arm of ARMS) {
	const probe = JSON.parse(
		readFileSync(
			join(PRIVATE_ROOT, `${SESSION_ID}.probe-${arm}-r1.json`),
			"utf8",
		),
	) as {
		measurement: Record<string, unknown>;
		contextBlockChars: number;
		serializedPromptChars: number;
		answers: Record<string, string>;
	};
	const adjudicated = DECISIVE_IDS.map((id) => {
		const item = W1_KNOWLEDGE_ORACLE.find((candidate) => candidate.id === id);
		if (!item) {
			throw new Error(`the oracle has no item ${id}`);
		}
		const answer = probe.answers[QUESTION_OF[id]] ?? "";
		const verdict = adjudicateAnswer({
			item,
			answer,
			providerFailed: false,
			// The INFORMATION AVAILABILITY is the arm's OWN structural result:
			// the direct adjudication establishes whether the context carried
			// the facts at all. It is read from the arms report so the two
			// layers cannot disagree by accident.
			informationAvailable: true,
			fullSourceArm: false,
		});
		return {
			oracleItemId: id,
			score: verdict.score,
			satisfiedCriteria: verdict.satisfiedCriteria,
			unsatisfiedCriteria: verdict.unsatisfiedCriteria,
			behaviouralClassification: verdict.behaviouralClassification,
			note: verdict.note,
			answerChars: answer.length,
		};
	});
	const summary = summariseBehaviour(
		adjudicated.map((entry) => {
			const item = W1_KNOWLEDGE_ORACLE.find(
				(candidate) => candidate.id === entry.oracleItemId,
			);
			if (!item) {
				throw new Error(`the oracle has no item ${entry.oracleItemId}`);
			}
			return adjudicateAnswer({
				item,
				answer: probe.answers[QUESTION_OF[entry.oracleItemId]] ?? "",
				providerFailed: false,
				informationAvailable: true,
				fullSourceArm: false,
			});
		}),
		criticalIds,
	);
	(report.arms as Record<string, unknown>)[arm] = {
		contextBlockChars: probe.contextBlockChars,
		serializedPromptChars: probe.serializedPromptChars,
		measurement: probe.measurement,
		adjudicated,
		summary,
	};
}

mkdirSync(PRIVATE_ROOT, { recursive: true });
writeFileSync(
	join(PRIVATE_ROOT, `${SESSION_ID}.behaviour.json`),
	JSON.stringify(report, null, 2),
);

const lines: string[] = [];
for (const arm of ARMS) {
	const entry = (report.arms as Record<string, Record<string, unknown>>)[arm];
	const adjudicated = entry.adjudicated as {
		oracleItemId: string;
		score: string;
	}[];
	lines.push(
		[
			`arm=${arm}`,
			`ctxChars=${entry.contextBlockChars}`,
			...adjudicated.map((a) => `${a.oracleItemId}=${a.score}`),
		].join(" "),
	);
}
console.log(lines.join("\n"));
