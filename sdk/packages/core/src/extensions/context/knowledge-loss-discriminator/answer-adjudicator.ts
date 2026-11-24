/**
 * ACT-CLINEMM-COMPACTION-INCREMENTAL-KNOWLEDGE-LOSS-DISCRIMINATOR-01
 *
 * C5 — the S3 ANSWER ADJUDICATION.
 *
 * ============================================================================
 * WHAT IT DOES
 * ============================================================================
 *
 * It scores a probe ANSWER against an oracle item's ADJUDICATION RUBRIC.
 *
 * ============================================================================
 * WHY THE RUBRIC IS EXPLICIT
 * ============================================================================
 *
 * A model may ASSIST the adjudication, but its self-assessment is not the
 * sole authority. The rubric below is a list of independently-checkable
 * ASSERTIONS, each with an explicit regex over the answer. A criterion is
 * satisfied only when its assertion is present in the answer.
 *
 * The score is therefore:
 *
 *   - `CORRECT`            — every criterion satisfied,
 *   - `PARTIALLY_CORRECT`  — the core assertion satisfied, some criteria not,
 *   - `INCORRECT`          — the core assertion absent,
 *   - `UNSCORABLE`         — the answer is empty or the provider failed.
 *
 * The CORE assertion is the first criterion: it is the proposition itself.
 */

import type { KnowledgeOracleItem } from "./oracle";
import type { BehaviouralClassification } from "./scoring";

export type AnswerScore =
	| "CORRECT"
	| "PARTIALLY_CORRECT"
	| "INCORRECT"
	| "UNSCORABLE";

export interface AdjudicatedAnswer {
	readonly oracleItemId: string;
	readonly score: AnswerScore;
	readonly satisfiedCriteria: readonly string[];
	readonly unsatisfiedCriteria: readonly string[];
	readonly behaviouralClassification: BehaviouralClassification;
	readonly note: string;
}

/**
 * The ADJUDICATION RUBRIC.
 *
 * The FIRST entry of each list is the CORE assertion. The remaining entries
 * are the MATERIAL qualifications. The regexes are written against the
 * SEMANTIC content of the criterion, in several equivalent surface forms.
 */
const ADJUDICATION_RUBRIC: Readonly<Record<string, readonly RegExp[]>> = {
	O1: [
		/render[^\n]{0,60}(fail|error)|helm template[^\n]{0,60}(fail|error)|first[^\n]{0,30}render[^\n]{0,30}(fail|error)|exit[^\n]{0,10}1|non-?zero/i,
		/type error|wrong type|expected string|got interface|non-?string/i,
		/(second|other|later)[^\n]{0,60}render[^\n]{0,60}(succe|success)|succe[^\n]{0,40}render|render[^\n]{0,40}succe/i,
		/global\.env|--set|environment override|explicit[^\n]{0,30}environment/i,
	],
	O2: [
		/(no|not)[^\n]{0,40}(demonstrably|proven|established)?[^\n]{0,20}(run|running|uses|use)[^\n]{0,40}(own|custom|organisation|organization)[^\n]{0,20}image|stock[^\n]{0,40}image|upstream[^\n]{0,30}image/i,
		/quay\.io|upstream|stock|vanilla/i,
		/(development|dev overlay|pipeline|CI)[^\n]{0,60}(override|--set|pin)/i,
	],
	O3: [
		/digest/i,
		/(guard|fatal|check|refus|require)[^\n]{0,60}(digest|artifact)/i,
		/manual[^\n]{0,60}(not|does not|isn't|is not)[^\n]{0,40}(cover|guard|check)|manual[^\n]{0,40}(upgrade)[^\n]{0,40}(uncovered|not guarded|omitt)/i,
	],
	O4: [
		/\b47\b/,
		/\b73\b/,
		/(conventional|suffix|\*Test|ends with)[^\n]{0,40}(47|count)/i,
		/(different|multiple)[^\n]{0,40}(count|definition)|counting definition|not (a )?contradiction/i,
	],
	O5: [
		/skipTests|skip[- ]tests/i,
		/(not|no)[^\n]{0,40}(establish|identified|proven)[^\n]{0,40}(test|execution)|absence of evidence|cannot confirm/i,
	],
	O6: [
		/(does|do)[^\n]{0,40}(have|contain|has)[^\n]{0,40}circuit breaker|circuit breaker[^\n]{0,40}(exists|found|present|is there)|(contains|has)[^\n]{0,30}circuit breaker/i,
		/notification[- ]service/i,
		/(not|only)[^\n]{0,40}(all|every|each)[^\n]{0,20}sender|other sender|different provider|carrier sender|MTS/i,
		/(not|n't)[^\n]{0,40}(proven|established)[^\n]{0,40}(production|active)|threshold[^\n]{0,40}(not established|unknown)/i,
	],
	O7: [
		/\b(500|1000)\b/,
		/notification[- ]service/i,
		/(carrier|MTS|mts-omni|default service)/i,
		/(not|n't)[^\n]{0,40}proven[^\n]{0,40}effective|default[^\n]{0,40}(not|only)|overridable|environment override|not the effective/i,
	],
	O8: [
		/\b80\b/,
		/\b3\b/,
		/\b240\b/,
		/\b400\b/,
		/(within|under|inside)[^\n]{0,30}budget|not violated|does not reproduce|no longer|does not apply|exceeds/i,
		/11[^\n]{0,60}(dev|pp|non-?production|not production)|peak[^\n]{0,60}(dev|pp|non-?production)|historically/i,
	],
	O9: [
		/hook-weight/i,
		/(no|not|lacks?|without)[^\n]{0,40}helm\.sh\/hook\b|(hook annotation)[^\n]{0,40}(absent|not found|missing|without)/i,
		/(not|isn't)[^\n]{0,30}(a )?hook resource|ordinary[^\n]{0,30}resource|ordered[^\n]{0,30}not/i,
	],
	O10: [
		/bootstrap[^\n]{0,60}(password|credential|admin)|plaintext|committed/i,
		/both[^\n]{0,40}(environment|values|env)[^\n]{0,20}files|two[^\n]{0,30}values files|both[^\n]{0,20}environments/i,
		/(not|n't)[^\n]{0,40}(tested|verified)|no[^\n]{0,40}credential test|prohibit/i,
	],
	O11: [
		/(not|isn't)[^\n]{0,30}(resolved|established|determined|answered)|unresolved|still (open|missing|unknown)|not established/i,
		/live[^\n]{0,40}(cluster|deployment|state|system)|actual[^\n]{0,20}running/i,
	],
	O12: [
		/verdict[^\n]{0,20}matrix|matrix[^\n]{0,30}(R1|R10|verdict)|ten[^\n]{0,20}findings|R1[^\n]{0,20}R10/i,
		/(supporting[^\n]{0,30}counter|counter-?evidence[^\n]{0,30}support|path[^\n]{0,20}line|cite|citation)/i,
		/CONFIRMED|NARROWED|CONDITIONAL|DISPROVEN|UNKNOWN/i,
	],
};

/**
 * The CORE assertion is the FIRST criterion.
 */
export function adjudicateAnswer(input: {
	readonly item: KnowledgeOracleItem;
	readonly answer: string;
	readonly providerFailed: boolean;
	/**
	 * Whether the arm's CONTEXT supplied the item at all. It is the S2
	 * verdict for the same item, so the behavioural classification can
	 * distinguish a COMPACTION loss from a MODEL failure.
	 */
	readonly informationAvailable: boolean;
	readonly fullSourceArm: boolean;
}): AdjudicatedAnswer {
	const rubric = ADJUDICATION_RUBRIC[input.item.id] ?? [];
	const answer = input.answer ?? "";
	if (input.providerFailed || answer.trim().length === 0) {
		return {
			oracleItemId: input.item.id,
			score: "UNSCORABLE",
			satisfiedCriteria: [],
			unsatisfiedCriteria: rubric.map((_, index) => `criterion-${index}`),
			behaviouralClassification: input.fullSourceArm
				? "MODEL_FAILURE_WITH_FULL_SOURCE"
				: "INFORMATION_AVAILABLE_AND_USED",
			note: "the provider failed or returned no answer",
		};
	}
	if (rubric.length === 0) {
		return {
			oracleItemId: input.item.id,
			score: "UNSCORABLE",
			satisfiedCriteria: [],
			unsatisfiedCriteria: [],
			behaviouralClassification: "INFORMATION_AVAILABLE_AND_USED",
			note: "no adjudication rubric is defined for this oracle item",
		};
	}
	const satisfied: string[] = [];
	const unsatisfied: string[] = [];
	for (const [index, pattern] of rubric.entries()) {
		if (pattern.test(answer)) {
			satisfied.push(`criterion-${index}`);
		} else {
			unsatisfied.push(`criterion-${index}`);
		}
	}
	const coreSatisfied = satisfied.includes("criterion-0");
	const score: AnswerScore = coreSatisfied
		? unsatisfied.length === 0
			? "CORRECT"
			: "PARTIALLY_CORRECT"
		: "INCORRECT";
	let behaviouralClassification: BehaviouralClassification;
	if (score === "CORRECT") {
		behaviouralClassification = "INFORMATION_AVAILABLE_AND_USED";
	} else if (!input.informationAvailable) {
		behaviouralClassification = "INFORMATION_MISSING_AFTER_COMPACTION";
	} else if (input.fullSourceArm) {
		behaviouralClassification = "MODEL_FAILURE_WITH_FULL_SOURCE";
	} else {
		behaviouralClassification = "INFORMATION_AVAILABLE_BUT_IGNORED";
	}
	return {
		oracleItemId: input.item.id,
		score,
		satisfiedCriteria: satisfied,
		unsatisfiedCriteria: unsatisfied,
		behaviouralClassification,
		note: coreSatisfied
			? unsatisfied.length === 0
				? "every criterion of the rubric is satisfied"
				: "the core assertion is satisfied but material criteria are not"
			: "the core assertion is absent from the answer",
	};
}

/**
 * The S3 SUMMARY over a set of adjudicated answers.
 */
export interface BehaviouralSummary {
	readonly adjudicated: number;
	readonly correct: number;
	readonly partiallyCorrect: number;
	readonly incorrect: number;
	readonly unscorable: number;
	readonly criticalCorrect: number;
	readonly criticalPartiallyCorrect: number;
	readonly criticalIncorrect: number;
	readonly criticalUnscorable: number;
	readonly byClassification: Readonly<Record<string, number>>;
}

export function summariseBehaviour(
	answers: readonly AdjudicatedAnswer[],
	criticalItemIds: ReadonlySet<string>,
): BehaviouralSummary {
	const byClassification: Record<string, number> = {};
	for (const answer of answers) {
		byClassification[answer.behaviouralClassification] =
			(byClassification[answer.behaviouralClassification] ?? 0) + 1;
	}
	const critical = answers.filter((a) => criticalItemIds.has(a.oracleItemId));
	return {
		adjudicated: answers.length,
		correct: answers.filter((a) => a.score === "CORRECT").length,
		partiallyCorrect: answers.filter((a) => a.score === "PARTIALLY_CORRECT")
			.length,
		incorrect: answers.filter((a) => a.score === "INCORRECT").length,
		unscorable: answers.filter((a) => a.score === "UNSCORABLE").length,
		criticalCorrect: critical.filter((a) => a.score === "CORRECT").length,
		criticalPartiallyCorrect: critical.filter(
			(a) => a.score === "PARTIALLY_CORRECT",
		).length,
		criticalIncorrect: critical.filter((a) => a.score === "INCORRECT").length,
		criticalUnscorable: critical.filter((a) => a.score === "UNSCORABLE").length,
		byClassification,
	};
}
