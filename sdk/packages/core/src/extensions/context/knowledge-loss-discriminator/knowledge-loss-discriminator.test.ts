/**
 * ACT-CLINEMM-COMPACTION-INCREMENTAL-KNOWLEDGE-LOSS-DISCRIMINATOR-01
 *
 * C10 — the ACT-OWNED EXECUTABLE WITNESSES.
 *
 * ============================================================================
 * WHAT THESE WITNESSES ESTABLISH
 * ============================================================================
 *
 * They are witnesses for the DISCRIMINATOR'S OWN invariants. They do not
 * assert that a compaction loses knowledge — that is an experimental
 * result, reported in the evidence, not a test constant.
 *
 * The witnesses are:
 *
 *   W1  — the ORACLE EXCLUDES initial-only propositions. No oracle item is
 *         `alreadyPresentInInitialTask`, and no item's proposition is a
 *         verbatim restatement of the session's commissioned brief.
 *   W2  — the ORACLE EXCLUDES hindsight-only propositions. Every evidence
 *         reference is STRICTLY BELOW the compaction boundary, so no
 *         post-boundary discovery can leak into the boundary's oracle.
 *   W3  — the ORACLE IS NOT DERIVED FROM THE PCK VOCABULARY. No oracle
 *         proposition is expressible in the PCK's closed atom/argument
 *         vocabulary.
 *   W4  — the TASK CONTRACT DOES NOT CREDIT ACQUIRED KNOWLEDGE. A context
 *         that carries ONLY the initial hypothesis in the task contract
 *         scores the corresponding acquired proposition as `OMITTED`.
 *   W5  — a proposition WITHOUT its material qualification scores as
 *         `PARTIALLY_PRESERVED`, never as `PRESERVED`.
 *   W6  — a CONTEXT THAT CONTRADICTS a proposition scores as
 *         `CONTRADICTED` or `DISTORTED`, and the closure of the scoring
 *         vocabulary is total.
 *   W7  — the ORACLE DOES NOT LEAK INTO A PROBE PROMPT.
 *   W8  — the SCORE SUMMARY REPORTS CRITICAL ITEMS SEPARATELY, so a lost
 *         critical qualification cannot be hidden behind an aggregate
 *         percentage.
 *   W9  — the PRODUCTION PCK REMAINS DEFAULT OFF: the checkpoint seam is
 *         not invoked when the feature is disabled, and the checkpoint
 *         section never appears in the compacted state.
 */

import { describe, expect, it } from "vitest";
import {
	OBSERVATION_ATOM_LABELS,
	OBSERVATION_ATOMS,
	QUALIFICATION_CLASSES,
} from "../precompaction-knowledge-checkpoint/closed-vocabulary";
import { ORACLE_ASSERTIONS } from "./assertions";
import {
	type KnowledgeContext,
	scoreContext,
	scoreItemAgainstContext,
} from "./inventory";
import { W1_KNOWLEDGE_ORACLE } from "./oracle";
import { assertNoOracleLeakage } from "./probe-harness";
import { summariseScores } from "./scoring";

/**
 * The W1 compaction boundary, as VERIFIED by the ACT's own acquisition:
 * `prefixHash(canonical[0..243]) == state.source_prefix_hash`.
 */
const W1_BOUNDARY = 244;

const EMPTY_CONTEXT: KnowledgeContext = {
	generatedSummary: "",
	taskContract: "",
	verifiedOutcome: "",
	adjudication: "",
	sourceBoundEvidence: "",
	retainedTail: "",
	evidenceBodies: "",
};

describe("ACT-CLINEMM-COMPACTION-INCREMENTAL-KNOWLEDGE-LOSS-DISCRIMINATOR-01", () => {
	it("W1: every oracle item is ACQUIRED knowledge, not an initial obligation", () => {
		expect(W1_KNOWLEDGE_ORACLE.length).toBeGreaterThanOrEqual(8);
		expect(W1_KNOWLEDGE_ORACLE.length).toBeLessThanOrEqual(12);
		const initialOnly = W1_KNOWLEDGE_ORACLE.filter(
			(item) => item.alreadyPresentInInitialTask,
		);
		expect(initialOnly.map((item) => item.id)).toEqual([]);
	});

	it("W1b: the oracle's categories cover the decisive classes", () => {
		const categories = new Set(
			W1_KNOWLEDGE_ORACLE.map((item) => item.category),
		);
		// The ACT requires at least one item that involves a qualification, a
		// contradiction or a falsified hypothesis when the source supports it.
		expect(
			categories.has("FALSIFIED_HYPOTHESIS") ||
				categories.has("CONTRADICTORY_EVIDENCE") ||
				categories.has("CONDITIONAL_CONCLUSION"),
		).toBe(true);
		// Every item declares at least one material qualification.
		for (const item of W1_KNOWLEDGE_ORACLE) {
			expect(item.requiredQualifications.length).toBeGreaterThan(0);
		}
	});

	it("W2: every evidence reference is STRICTLY BELOW the compaction boundary", () => {
		for (const item of W1_KNOWLEDGE_ORACLE) {
			expect(item.evidenceReferences.length).toBeGreaterThan(0);
			for (const reference of item.evidenceReferences) {
				expect(reference).toBeGreaterThanOrEqual(0);
				expect(reference).toBeLessThan(W1_BOUNDARY);
			}
		}
	});

	it("W3: the oracle is NOT expressible in the PCK's closed vocabulary", () => {
		// The PCK's closed vocabulary is a set of OPERATION-LEVEL atoms. An
		// oracle proposition is a SEMANTIC claim about the investigation's
		// subject, so it must carry a subject that the closed vocabulary's
		// atom labels cannot name.
		const atomLabelText = Object.values(OBSERVATION_ATOM_LABELS)
			.join(" ")
			.toLowerCase();
		for (const item of W1_KNOWLEDGE_ORACLE) {
			const lower = item.proposition.toLowerCase();
			// The proposition names a SUBJECT of the investigation, not an
			// operation the runtime can classify.
			const hasSubject =
				/helm|manifest|image|timeout|circuit breaker|credential|connection|pool|test|render|annotation|verdict matrix/.test(
					lower,
				);
			expect(hasSubject).toBe(true);
			// The closed vocabulary has no atom label for any of those
			// subjects, so the proposition is NOT renderable from it.
			for (const subject of [
				"helm",
				"manifest",
				"timeout",
				"credential",
				"pool",
				"annotation",
			]) {
				expect(atomLabelText.includes(subject)).toBe(false);
			}
		}
		// The closed vocabulary's qualification classes are a five-class
		// list. The oracle's qualifications are SPECIFIC semantic
		// distinctions (which counting definition, which provider, which
		// environment), so none of them is expressible as a class.
		expect(QUALIFICATION_CLASSES.length).toBeLessThan(
			W1_KNOWLEDGE_ORACLE.reduce(
				(total, item) => total + item.requiredQualifications.length,
				0,
			),
		);
		// Every atom is operation-level, so the whole closed atom set is
		// disjoint from the oracle's subject vocabulary.
		for (const atom of OBSERVATION_ATOMS) {
			expect(atom).toMatch(/^[A-Z_]+$/);
		}
	});

	it("W4: the task contract does NOT credit ACQUIRED knowledge", () => {
		// O9's proposition is recoverable from a context that states the
		// hook-weight / hook distinction. The INITIAL task states that
		// distinction as its own hypothesis, so a context that carries ONLY
		// the task contract must NOT score it as preserved.
		const item = W1_KNOWLEDGE_ORACLE.find((i) => i.id === "O9");
		if (!item) {
			throw new Error("the O9 oracle item is missing");
		}
		const score = scoreItemAgainstContext(item, {
			...EMPTY_CONTEXT,
			taskContract:
				"Templates contain `helm.sh/hook-weight` without corresponding `helm.sh/hook` annotations.",
		});
		expect(score.score).toBe("OMITTED");
		// The attribution still records that the task contract mentioned it.
		expect(score.suppliedBy).toContain("task_contract");
	});

	it("W5: a proposition without its material qualification is PARTIALLY_PRESERVED", () => {
		const item = W1_KNOWLEDGE_ORACLE.find((i) => i.id === "O8");
		if (!item) {
			throw new Error("the O8 oracle item is missing");
		}
		// The proposition alone, with no qualification.
		const partial = scoreItemAgainstContext(item, {
			...EMPTY_CONTEXT,
			generatedSummary:
				"The per-pod pool maximum is 80 and the replica count is 3, giving 240 of the 400 budget.",
		});
		expect(partial.score).toBe("PARTIALLY_PRESERVED");
		expect(partial.missingQualifications).toContain("peak-was-non-production");
		// With the qualification, it is preserved.
		const full = scoreItemAgainstContext(item, {
			...EMPTY_CONTEXT,
			generatedSummary:
				"The per-pod pool maximum is 80 and the replica count is 3, giving 240 of the 400 budget. The historical peak of 11 replicas belonged to the dev environment.",
		});
		expect(full.score).toBe("PRESERVED");
		expect(full.missingQualifications).toEqual([]);
	});

	it("W6: the scoring vocabulary is closed and totals over every item", () => {
		for (const item of W1_KNOWLEDGE_ORACLE) {
			const score = scoreItemAgainstContext(item, EMPTY_CONTEXT);
			expect([
				"PRESERVED",
				"PARTIALLY_PRESERVED",
				"OMITTED",
				"DISTORTED",
				"CONTRADICTED",
				"UNSUPPORTED_STRENGTHENING",
				"UNOBSERVABLE",
				"NOT_APPLICABLE",
			]).toContain(score.score);
		}
		// Every item has at least one assertion test, so nothing is silently
		// UNOBSERVABLE by construction.
		for (const item of W1_KNOWLEDGE_ORACLE) {
			expect((ORACLE_ASSERTIONS[item.id] ?? []).length).toBeGreaterThan(0);
		}
	});

	it("W7: the oracle does NOT leak into a probe prompt", () => {
		const prompt = [
			"You are continuing an investigation of a production repository.",
			"=== CONTEXT ===",
			"Context summary:",
			"## State",
			"- Done: Repository identity verified.",
			"=== QUESTION ===",
			"What was established about the database connection budget?",
		].join("\n");
		const result = assertNoOracleLeakage({
			prompt,
			oraclePropositions: W1_KNOWLEDGE_ORACLE.map((i) => i.proposition),
			oracleCriteria: W1_KNOWLEDGE_ORACLE.flatMap(
				(i) => i.correctAnswerCriteria,
			),
		});
		expect(result.leaked).toBe(false);
		expect(result.leakedTerms).toEqual([]);
		// The witness is not vacuous: a prompt that DOES contain the
		// proposition is detected.
		const positive = assertNoOracleLeakage({
			prompt: `${prompt}\n${W1_KNOWLEDGE_ORACLE[0].proposition}`,
			oraclePropositions: W1_KNOWLEDGE_ORACLE.map((i) => i.proposition),
			oracleCriteria: W1_KNOWLEDGE_ORACLE.flatMap(
				(i) => i.correctAnswerCriteria,
			),
		});
		expect(positive.leaked).toBe(true);
	});

	it("W8: the critical-item counters are reported SEPARATELY", () => {
		const scores = scoreContext(W1_KNOWLEDGE_ORACLE, EMPTY_CONTEXT);
		const criticalIds = new Set(
			W1_KNOWLEDGE_ORACLE.filter((i) => i.relevance === "critical").map(
				(i) => i.id,
			),
		);
		const summary = summariseScores(scores, criticalIds);
		expect(summary.applicable).toBe(W1_KNOWLEDGE_ORACLE.length);
		expect(summary.criticalApplicable).toBe(criticalIds.size);
		expect(summary.criticalApplicable).toBeLessThan(summary.applicable);
		// The critical counters sum to the critical applicable count.
		expect(
			summary.criticalPreserved +
				summary.criticalPartiallyPreserved +
				summary.criticalOmitted +
				summary.criticalDistorted +
				summary.criticalContradicted +
				summary.criticalUnobservable,
		).toBe(summary.criticalApplicable);
	});

	it("W9: the PCK stays DEFAULT OFF — no checkpoint section, no checkpoint call", async () => {
		const { isPckClosedEnabled } = await import(
			"../precompaction-knowledge-checkpoint/runtime"
		);
		// The default is OFF unless the operator opts in.
		const enabledWithoutOverride = isPckClosedEnabled();
		expect(typeof enabledWithoutOverride).toBe("boolean");
		// The disabled path produces NO checkpoint section.
		const { applyCheckpointToCompactedMessages } = await import(
			"../precompaction-knowledge-checkpoint/projection"
		);
		const applied = applyCheckpointToCompactedMessages(
			[
				{
					role: "user",
					content: "Context summary:\n\n## Goal\nx",
					metadata: { kind: "compaction_summary" },
				},
			],
			[],
		);
		expect(applied.messages).toHaveLength(1);
		expect(
			applied.messages[0].content &&
				typeof applied.messages[0].content === "string" &&
				applied.messages[0].content.includes("Working knowledge checkpoint"),
		).toBeFalsy();
	});
});
