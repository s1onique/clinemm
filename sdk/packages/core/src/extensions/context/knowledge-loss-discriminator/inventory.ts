/**
 * ACT-CLINEMM-COMPACTION-INCREMENTAL-KNOWLEDGE-LOSS-DISCRIMINATOR-01
 *
 * C3 — the S1 / S2 KNOWLEDGE INVENTORY.
 *
 * ============================================================================
 * WHAT IT DOES
 * ============================================================================
 *
 * It inventories, for a given CONTEXT (the compacted state's message list or
 * a provider-visible continuation), which oracle propositions the context
 * can supply, and by WHICH MECHANISM.
 *
 * The mechanism is the important part. A context can supply a proposition
 * through:
 *
 *   - `generated_summary` — the summarizer's own prose,
 *   - `task_contract` — the carried task contract section,
 *   - `verified_outcome` — the carried verified tool outcomes,
 *   - `adjudication` — the carried adjudication section,
 *   - `retained_tail` — the canonical tail messages,
 *   - `evidence_body` — a tool-result body that survived into the context.
 *
 * A proposition that is NOT recoverable from any mechanism is `OMITTED`.
 */

import { ORACLE_ASSERTIONS } from "./assertions";
import type { KnowledgeOracleItem, SourceAuthority } from "./oracle";
import type { OracleScore, SemanticScore } from "./scoring";

export const SUPPLY_MECHANISMS = [
	"generated_summary",
	"task_contract",
	"verified_outcome",
	"adjudication",
	"source_bound_evidence",
	"retained_tail",
	"evidence_body",
] as const;

export type SupplyMechanism = (typeof SUPPLY_MECHANISMS)[number];

/**
 * A CONTEXT, decomposed into the mechanisms that can supply knowledge.
 */
export interface KnowledgeContext {
	/** The summarizer's generated prose. */
	readonly generatedSummary: string;
	/** The carried task-contract section. */
	readonly taskContract: string;
	/** The carried verified-outcome section. */
	readonly verifiedOutcome: string;
	/** The carried adjudication section. */
	readonly adjudication: string;
	/**
	 * The carried SOURCE-BOUND EVIDENCE section.
	 *
	 * ACT-CLINEMM-COMPACTION-TASK-CONDITIONED-EVIDENCE-SELECTION-01 (C2.4):
	 * it is a RUNTIME-ASSEMBLED section of verbatim canonical excerpts. It
	 * is its OWN mechanism, because attributing it to `generatedSummary`
	 * would credit the MODEL with bytes the model never wrote, and because
	 * the factual-consistency scorer runs over `generatedSummary` — so a
	 * carried excerpt would otherwise MASK a contradiction the summarizer
	 * actually introduced.
	 */
	readonly sourceBoundEvidence: string;
	/** The retained canonical tail, serialised. */
	readonly retainedTail: string;
	/** Any tool-result bodies that survived into the context. */
	readonly evidenceBodies: string;
}

const MECHANISM_TEXT: Readonly<
	Record<SupplyMechanism, keyof KnowledgeContext>
> = {
	generated_summary: "generatedSummary",
	task_contract: "taskContract",
	verified_outcome: "verifiedOutcome",
	adjudication: "adjudication",
	source_bound_evidence: "sourceBoundEvidence",
	retained_tail: "retainedTail",
	evidence_body: "evidenceBodies",
};

/**
 * Score ONE oracle item against ONE context.
 *
 * The scoring is DETERMINISTIC and depends only on the context text and the
 * item's assertion tests. It is therefore reproducible and reviewable.
 *
 * ============================================================================
 * WHY THE TASK CONTRACT DOES NOT CREDIT ACQUIRED KNOWLEDGE
 * ============================================================================
 *
 * The carried task contract is the session's OWN COMMISSIONED BRIEF: it
 * states the inherited findings as INITIAL HYPOTHESES, verbatim. A matcher
 * that credited it would score the PRESERVATION OF THE INITIAL TASK as the
 * PRESERVATION OF ACQUIRED KNOWLEDGE — a circular, self-confirming result.
 *
 * The task contract therefore contributes to the mechanism attribution ONLY
 * for an item whose proposition is itself an initial obligation. For an
 * ACQUIRED proposition it is recorded as `task_contract` in the attribution
 * but it does NOT satisfy the proposition's assertions.
 *
 * The ACQUIRED-PROPOSITION-AUTHORITY rule is therefore: an acquired
 * proposition counts as supplied only by the GENERATED SUMMARY, the
 * RETAINED TAIL, or a surviving EVIDENCE BODY.
 */
export function scoreItemAgainstContext(
	item: KnowledgeOracleItem,
	context: KnowledgeContext,
): OracleScore {
	const tests = ORACLE_ASSERTIONS[item.id] ?? [];
	if (tests.length === 0) {
		return {
			oracleItemId: item.id,
			score: "UNOBSERVABLE",
			suppliedBy: [],
			missingQualifications: [],
			note: "no assertion test is defined for this oracle item",
		};
	}
	const suppliedBy: string[] = [];
	let propositionSatisfied = false;
	// The mechanisms that can establish an ACQUIRED proposition. The task
	// contract is EXCLUDED for the proposition itself (it states the initial
	// hypothesis), but it is still recorded in the attribution.
	const propositionMechanisms: SupplyMechanism[] =
		item.alreadyPresentInInitialTask
			? [...SUPPLY_MECHANISMS]
			: SUPPLY_MECHANISMS.filter((m) => m !== "task_contract");
	for (const mechanism of SUPPLY_MECHANISMS) {
		const text = context[MECHANISM_TEXT[mechanism]];
		if (!text || text.trim().length === 0) {
			continue;
		}
		const matched = tests.filter((test) => test.pattern.test(text));
		if (matched.length === 0) {
			continue;
		}
		suppliedBy.push(mechanism);
		if (
			propositionMechanisms.includes(mechanism) &&
			matched.some((test) => !test.isMaterialQualification)
		) {
			propositionSatisfied = true;
		}
	}
	const missingQualifications: string[] = [];
	for (const test of tests.filter((t) => t.isMaterialQualification)) {
		const satisfied = propositionMechanisms.some((mechanism) => {
			const text = context[MECHANISM_TEXT[mechanism]];
			return !!text && test.pattern.test(text);
		});
		if (!satisfied) {
			missingQualifications.push(test.id);
		}
	}
	let score: SemanticScore;
	if (!propositionSatisfied) {
		score = "OMITTED";
	} else if (missingQualifications.length > 0) {
		score = "PARTIALLY_PRESERVED";
	} else {
		score = "PRESERVED";
	}
	return {
		oracleItemId: item.id,
		score,
		suppliedBy,
		missingQualifications,
		note: propositionSatisfied
			? missingQualifications.length > 0
				? "the proposition is recoverable, but material qualifications are missing"
				: "the proposition and every material qualification are recoverable"
			: "no mechanism in the inspected context supplies the proposition",
	};
}

/**
 * The AUTHORITY that a context can confer on an oracle item.
 *
 * A proposition recovered only from a MODEL-AUTHORED source is not
 * runtime-verified merely because it appears in a summary.
 */
export function contextAuthorityFor(
	item: KnowledgeOracleItem,
	context: KnowledgeContext,
): SourceAuthority {
	const tests = ORACLE_ASSERTIONS[item.id] ?? [];
	const matches = (text: string): boolean =>
		tests.some((test) => !!text && test.pattern.test(text));
	if (matches(context.evidenceBodies)) {
		return "tool_observed";
	}
	if (matches(context.generatedSummary)) {
		return "model_reported";
	}
	return item.sourceAuthority;
}

/**
 * Score a WHOLE oracle against a context.
 */
export function scoreContext(
	items: readonly KnowledgeOracleItem[],
	context: KnowledgeContext,
): OracleScore[] {
	return items.map((item) => scoreItemAgainstContext(item, context));
}
