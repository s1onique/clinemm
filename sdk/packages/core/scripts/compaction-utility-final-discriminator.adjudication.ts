/**
 * ACT-CLINEMM-COMPACTION-UTILITY-FINAL-DISCRIMINATOR-01
 *
 * C1 — THE DIRECT SOURCE ADJUDICATION.
 *
 * ============================================================================
 * WHAT IT DOES
 * ============================================================================
 *
 * It adjudicates the three decisive propositions (O1, O4, O7) DIRECTLY
 * against the CANONICAL SOURCE and the ASSEMBLED ARMS, and classifies each
 * remaining failure into exactly one of the ACT's six categories:
 *
 *   SOURCE_NOT_SELECTED          — the decisive fragment was never chosen;
 *   QUALIFICATION_NOT_SELECTED   — the value was chosen, its material
 *                                  qualification was not;
 *   RELATIONSHIP_NOT_ESTABLISHED — the source's relationship between the
 *                                  value and its qualification is not
 *                                  recoverable from what was carried;
 *   ADMISSION_TRUNCATION         — the admission refused or truncated it;
 *   SCORER_FALSE_NEGATIVE        — the facts ARE present, the matcher missed
 *                                  them;
 *   INSUFFICIENT_EVIDENCE        — the source itself does not establish it.
 *
 * ============================================================================
 * WHY IT IS A SCRIPT AND NOT A NARRATIVE
 * ============================================================================
 *
 * The reviewer is right that the automated regex scorer does not establish
 * the stages it reports, and that the per-item discriminator derives its
 * "admitted" flag from the already-admitted candidate set. This script
 * therefore does NOT reuse those flags. It re-derives, for each proposition
 * and each arm, from the CANONICAL SOURCE:
 *
 *   - the original observation and the observed subject;
 *   - the value or polarity;
 *   - the material qualification;
 *   - whether each is present in the arm's carried section;
 *   - whether the source establishes their RELATIONSHIP.
 *
 * The classification is then the CONSEQUENCE of those facts, not an
 * independent guess.
 *
 * ============================================================================
 * WHAT IT DOES NOT DO
 * ============================================================================
 *
 *   - It makes NO inference request.
 *   - It does NOT tune the oracle, the scorer or the assertions. It only
 *     READS them, so that a matcher failure can be DISTINGUISHED from a
 *     selection failure.
 *   - It does NOT modify production code.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MessageWithMetadata } from "@cline/shared";
import { ORACLE_ASSERTIONS } from "../src/extensions/context/knowledge-loss-discriminator/assertions";
import { W1_KNOWLEDGE_ORACLE } from "../src/extensions/context/knowledge-loss-discriminator/oracle";

const SESSION_ID = process.argv[2] ?? "1795491524406_mutdb";
const BOUNDARY = Number(process.argv[3] ?? 244);

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

/**
 * The three DECISIVE propositions.
 */
const DECISIVE = ["O1", "O4", "O7"] as const;
type DecisiveId = (typeof DECISIVE)[number];

/**
 * The failure taxonomy the ACT names.
 */
type FailureCategory =
	| "NONE"
	| "SOURCE_NOT_SELECTED"
	| "QUALIFICATION_NOT_SELECTED"
	| "RELATIONSHIP_NOT_ESTABLISHED"
	| "ADMISSION_TRUNCATION"
	| "SCORER_FALSE_NEGATIVE"
	| "INSUFFICIENT_EVIDENCE";

/**
 * ============================================================================
 * THE FACT MODEL
 * ============================================================================
 *
 * A FACT is one element of a proposition that must survive compaction. It
 * is declared by the reviewer-independent SOURCE, not by the oracle's
 * matcher: the source text, the literal the fact is carried by, and the
 * canonical index whose tool result establishes it.
 */
interface Fact {
	/** The oracle item this fact belongs to. */
	readonly item: DecisiveId;
	/** What the fact IS. */
	readonly role: "observation" | "value" | "qualification" | "relationship";
	/** The prose statement of the fact. */
	readonly statement: string;
	/** The LITERAL that carries the fact in the source. */
	readonly literal: string;
	/** The canonical index whose tool result establishes the fact. */
	readonly canonicalIndex: number;
}

/**
 * The FACTS, established by DIRECT INSPECTION of the canonical source.
 *
 * Each literal below was verified against the canonical tool result at the
 * stated index. They are NOT derived from the oracle's regexes.
 */
const FACTS: readonly Fact[] = [
	// ---------------------------------------------------------------- O1 ----
	{
		item: "O1",
		role: "observation",
		statement: "the production Helm render was attempted and FAILED",
		literal: "exit=1",
		canonicalIndex: 145,
	},
	{
		item: "O1",
		role: "value",
		statement:
			"the failure was a Go-template TYPE error about a non-string environment value",
		literal: "wrong type for value; expected string; got interface {}",
		canonicalIndex: 145,
	},
	{
		item: "O1",
		role: "qualification",
		statement:
			"the SECOND render succeeded and required an explicit environment override the plain render did not supply",
		literal: "--set global.env=prod",
		canonicalIndex: 147,
	},
	// ---------------------------------------------------------------- O4 ----
	{
		item: "O4",
		role: "value",
		statement:
			"the count that matches only files whose basename ends in the conventional test suffix is 47",
		literal: "47",
		canonicalIndex: 7,
	},
	{
		item: "O4",
		role: "value",
		statement:
			"a BROADER pattern that matches any tracked Java path containing the word 'test' yields 73",
		literal: "73",
		canonicalIndex: 65,
	},
	{
		item: "O4",
		role: "relationship",
		statement:
			"the source itself labels the two counts as DIFFERENT counting definitions: it prints 'files named *Test.java only' above the 47, and prints the broader pattern's 73 separately",
		literal: "--- files named *Test.java only ---",
		canonicalIndex: 67,
	},
	// ---------------------------------------------------------------- O7 ----
	{
		item: "O7",
		role: "value",
		statement:
			"the notification-service sender's default connect and socket timeouts are 500 ms and 1000 ms",
		literal: "DEFAULT_SOCKET_TIMEOUT_MILLIS = 1000",
		canonicalIndex: 187,
	},
	{
		item: "O7",
		role: "qualification",
		statement:
			"the read constants are the notification-service provider's DEFAULTS and are overridden from the environment, so they are not proven to be the effective production values",
		literal: "System.getenv(ENV_SOCKET_TIMEOUT)",
		canonicalIndex: 187,
	},
	{
		item: "O7",
		role: "relationship",
		statement:
			"the production default service selection names a DIFFERENT provider (mts-omni) for the default environment",
		literal: "default: mts-omni",
		canonicalIndex: 187,
	},
];

const ITEM_BY_ID = new Map(W1_KNOWLEDGE_ORACLE.map((i) => [i.id, i]));

/**
 * The canonical source, and the tool-result body of ONE index.
 */
const persisted = JSON.parse(
	readFileSync(join(sessionDir, `${SESSION_ID}.messages.json`), "utf8"),
) as { messages: MessageWithMetadata[] };
const canonical = persisted.messages.filter(
	(message) => message.metadata?.displayOnly !== true,
);

function toolResultBodies(index: number): string {
	const message = canonical[index];
	if (!message || !Array.isArray(message.content)) {
		return "";
	}
	const parts: string[] = [];
	for (const block of message.content) {
		if (block.type !== "tool_result") {
			continue;
		}
		const content = (block as { content?: unknown }).content;
		if (!Array.isArray(content)) {
			continue;
		}
		for (const entry of content) {
			if (entry && typeof entry === "object") {
				const payload = entry as { query?: unknown; result?: unknown };
				parts.push(
					`QUERY: ${String(payload.query ?? "")}\nOUTPUT: ${String(payload.result ?? "")}`,
				);
			}
		}
	}
	return parts.join("\n");
}

/**
 * The SOURCE TEXT of ONE index: the query AND the output.
 *
 * The query matters: the counting-definition relationship in O4 is
 * established by the COMMAND that produced the count, not only by the
 * number.
 */
function sourceText(index: number): string {
	return toolResultBodies(index);
}

/**
 * The CARRIED SECTION of ONE arm.
 */
function carriedSection(arm: "A" | "B" | "C"): string {
	const path = join(PRIVATE_ROOT, `${SESSION_ID}.arm-${arm}.messages.json`);
	if (!existsSync(path)) {
		throw new Error(
			`the arm ${arm} has not been assembled: ${path} is missing. Run the arms script first.`,
		);
	}
	const messages = JSON.parse(
		readFileSync(path, "utf8"),
	) as MessageWithMetadata[];
	const summary =
		(messages[0]?.metadata as { summary?: string } | undefined)?.summary ?? "";
	const heading = summary.indexOf("## Source-bound evidence");
	return heading === -1 ? "" : summary.slice(heading);
}

/**
 * The TAIL text of ONE arm: the retained canonical tail, which is the same
 * in every arm.
 */
function tailText(arm: "A" | "B" | "C"): string {
	const path = join(PRIVATE_ROOT, `${SESSION_ID}.arm-${arm}.messages.json`);
	const messages = JSON.parse(
		readFileSync(path, "utf8"),
	) as MessageWithMetadata[];
	return messages
		.slice(1)
		.map((message) =>
			Array.isArray(message.content)
				? message.content
						.map((block) =>
							block.type === "text"
								? String((block as { text?: string }).text ?? "")
								: JSON.stringify(block),
						)
						.join("\n")
				: String(message.content ?? ""),
		)
		.join("\n");
}

/**
 * Whether a LITERAL is present in a text.
 *
 * The literal may be a multi-token phrase; every token must be present.
 */
function containsLiteral(text: string, literal: string): boolean {
	if (!text) {
		return false;
	}
	return literal
		.split(";")
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.every((part) => text.includes(part));
}

/**
 * The BODY of ONE carried fragment, located by its production attribution.
 *
 * The renderer emits one line per fragment:
 *
 *   - [OBSERVED_EXCERPT] run_commands#<canonicalIndex + 1> (status; ...): body
 *
 * The attribution is therefore the fragment's IDENTITY, and the body is the
 * fragment's own bytes. The body runs until the next attribution marker.
 */
function fragmentFor(
	section: string,
	canonicalIndex: number,
): string | undefined {
	if (!section) {
		return undefined;
	}
	const attribution = `run_commands#${canonicalIndex + 1}`;
	const start = section.indexOf(attribution);
	if (start === -1) {
		return undefined;
	}
	const next = section.indexOf("\n- [", start + attribution.length);
	return next === -1 ? section.slice(start) : section.slice(start, next);
}

/**
 * ============================================================================
 * THE ADJUDICATION OF ONE FACT IN ONE ARM
 * ============================================================================
 */
interface FactAdjudication {
	readonly item: DecisiveId;
	readonly role: Fact["role"];
	readonly statement: string;
	readonly literal: string;
	readonly canonicalIndex: number;
	/** The fact is established by the CANONICAL SOURCE. */
	readonly sourceEstablishes: boolean;
	/** The fragment that carries the fact was ADMITTED by the contract. */
	readonly admitted: boolean;
	/** The fact's fragment was SELECTED and its bytes are CARRIED. */
	readonly carriedInSection: boolean;
	/** The fact's text also reaches the arm through the retained TAIL. */
	readonly carriedInTail: boolean;
	/** The RELATIONSHIP of this fact to its proposition is established by the source. */
	readonly relationshipEstablished: boolean;
}

function adjudicateFact(
	fact: Fact,
	section: string,
	tail: string,
): FactAdjudication {
	const source = sourceText(fact.canonicalIndex);
	const sourceEstablishes = containsLiteral(source, fact.literal);
	// The fact is matched FRAGMENT-SCOPED, not against the whole section.
	//
	// The production renderer attributes every carried fragment with
	// `run_commands#<canonicalIndex + 1>` — a ONE-BASED index — so the
	// attribution is the identity of the fragment that carries the fact. A
	// fragment-scoped match is exact: a bare number in an UNRELATED
	// fragment can no longer satisfy a fact, which is what a whole-section
	// match would allow.
	const carriedFragment = fragmentFor(section, fact.canonicalIndex);
	const carriedInSection =
		carriedFragment !== undefined &&
		containsLiteral(carriedFragment, fact.literal);
	const carriedInTail = containsLiteral(tail, fact.literal);
	return {
		item: fact.item,
		role: fact.role,
		statement: fact.statement,
		literal: fact.literal,
		canonicalIndex: fact.canonicalIndex,
		sourceEstablishes,
		// The ADMISSION is measured by the CONTRACT: a fact is admitted when
		// the source text carries it and the source is not a credential-
		// bearing location. The arm's carried section is the OBSERVATION of
		// that admission.
		admitted: sourceEstablishes && carriedInSection,
		carriedInSection,
		carriedInTail,
		relationshipEstablished: sourceEstablishes,
	};
}

/**
 * ============================================================================
 * THE CLASSIFICATION OF ONE PROPOSITION IN ONE ARM
 * ============================================================================
 */
interface PropositionAdjudication {
	readonly item: DecisiveId;
	readonly arm: "A" | "B" | "C";
	readonly facts: readonly FactAdjudication[];
	/**
	 * The CATEGORY of the remaining failure.
	 *
	 * It is DERIVED from the facts, in this order:
	 *
	 *   1. the source does not establish it          -> INSUFFICIENT_EVIDENCE
	 *   2. the value is not carried at all            -> SOURCE_NOT_SELECTED
	 *      (or ADMISSION_TRUNCATION when the contract
	 *       refused or truncated the fragment)
	 *   3. the value is carried, the qualification
	 *      is not                                  -> QUALIFICATION_NOT_SELECTED
	 *   4. both are carried, but their RELATIONSHIP
	 *      is not carried                           -> RELATIONSHIP_NOT_ESTABLISHED
	 *   5. everything is carried                     -> NONE
	 *
	 * A SCORER_FALSE_NEGATIVE is reported SEPARATELY: it is the case where
	 * every fact IS carried and the automated matcher still reports the
	 * proposition as OMITTED. It is a property of the MATCHER, not of the
	 * arm, and it does not change the arm's category.
	 */
	readonly category: FailureCategory;
	readonly scorerFalseNegative: boolean;
	readonly automatedScore: string;
	readonly missingQualifications: readonly string[];
	readonly notes: readonly string[];
}

function classify(
	item: DecisiveId,
	arm: "A" | "B" | "C",
	facts: readonly FactAdjudication[],
	automatedScore: string,
	missingQualifications: readonly string[],
	section: string,
): PropositionAdjudication {
	const notes: string[] = [];
	const value = facts.find((f) => f.role === "value");
	const qualifications = facts.filter((f) => f.role === "qualification");
	const relationships = facts.filter((f) => f.role === "relationship");
	const observations = facts.filter((f) => f.role === "observation");

	// 1. The SOURCE must establish the facts at all.
	const sourceEstablishesAll = facts.every((f) => f.sourceEstablishes);
	if (!sourceEstablishesAll) {
		const missing = facts
			.filter((f) => !f.sourceEstablishes)
			.map((f) => `${f.role}@${f.canonicalIndex}`);
		notes.push(`the canonical source does not establish ${missing.join(", ")}`);
		return {
			item,
			arm,
			facts,
			category: "INSUFFICIENT_EVIDENCE",
			scorerFalseNegative: false,
			automatedScore,
			missingQualifications,
			notes,
		};
	}

	// 2. The VALUE must be carried.
	//
	//    Three distinct mechanisms can withhold it, and they must NOT be
	//    conflated:
	//
	//    a) the decisive fragment was never SELECTED into the section;
	//    b) the fragment WAS selected, but the ADMISSION contract BOUNDED
	//       or REDACTED its bytes away;
	//    c) the arm carries no evidence section at all (the ordinary arm),
	//       in which case the fragment was neither selected nor bounded —
	//       the arm simply carries no evidence.
	const valueCarried =
		(value?.carriedInSection ?? false) || (value?.carriedInTail ?? false);
	if (!valueCarried) {
		const decisive = facts.filter(
			(f) => f.sourceEstablishes && !f.carriedInSection && !f.carriedInTail,
		);
		// The fragment's ATTRIBUTION is what proves the fragment itself was
		// carried. The production renderer emits `run_commands#<index>`
		// for every carried fragment, so its absence proves the fragment
		// was not carried at all.
		const attribution = `run_commands#${(decisive[0]?.canonicalIndex ?? 0) + 1}`;
		const fragmentCarried = section.includes(attribution);
		if (!fragmentCarried) {
			notes.push(
				section.trim().length === 0
					? "the arm carries NO evidence section, so the decisive fragment was never selected"
					: `the decisive fragment (${attribution}) was never selected into the carried section`,
			);
			return {
				item,
				arm,
				facts,
				category: "SOURCE_NOT_SELECTED",
				scorerFalseNegative: false,
				automatedScore,
				missingQualifications,
				notes,
			};
		}
		// The fragment WAS carried, so the bytes must have been BOUNDED or
		// REDACTED away by the admission contract.
		notes.push(
			`the fragment (${attribution}) WAS carried, but the admission contract BOUNDED or REDACTED the literal away`,
		);
		return {
			item,
			arm,
			facts,
			category: "ADMISSION_TRUNCATION",
			scorerFalseNegative: false,
			automatedScore,
			missingQualifications,
			notes,
		};
	}

	// 3. The QUALIFICATIONS must be carried.
	const missingQualification = qualifications.find(
		(f) => !f.carriedInSection && !f.carriedInTail,
	);
	if (missingQualification) {
		notes.push(
			`the material qualification is NOT carried: ${missingQualification.statement}`,
		);
		return {
			item,
			arm,
			facts,
			category: "QUALIFICATION_NOT_SELECTED",
			scorerFalseNegative: false,
			automatedScore,
			missingQualifications,
			notes,
		};
	}

	// 4. The OBSERVATION and the RELATIONSHIP must be carried.
	const missingRelationship = relationships.find(
		(f) => !f.carriedInSection && !f.carriedInTail,
	);
	if (missingRelationship) {
		notes.push(
			`the source-established RELATIONSHIP is NOT carried: ${missingRelationship.statement}`,
		);
		return {
			item,
			arm,
			facts,
			category: "RELATIONSHIP_NOT_ESTABLISHED",
			scorerFalseNegative: false,
			automatedScore,
			missingQualifications,
			notes,
		};
	}
	const missingObservation = observations.find(
		(f) => !f.carriedInSection && !f.carriedInTail,
	);
	if (missingObservation) {
		notes.push(
			`the observation is NOT carried: ${missingObservation.statement}`,
		);
		return {
			item,
			arm,
			facts,
			category: "SOURCE_NOT_SELECTED",
			scorerFalseNegative: false,
			automatedScore,
			missingQualifications,
			notes,
		};
	}

	// 5. Everything is carried. The automated score may still be OMITTED:
	//    that is a SCORER_FALSE_NEGATIVE, reported separately.
	const scorerFalseNegative =
		automatedScore === "OMITTED" ||
		(automatedScore === "PARTIALLY_PRESERVED" &&
			missingQualifications.length > 0);
	if (scorerFalseNegative) {
		notes.push(
			`every fact IS carried, but the automated matcher reports ${automatedScore} with missing qualifications ${JSON.stringify(missingQualifications)}`,
		);
	}
	return {
		item,
		arm,
		facts,
		category: "NONE",
		scorerFalseNegative,
		automatedScore,
		missingQualifications,
		notes,
	};
}

/**
 * ============================================================================
 * THE MAIN
 * ============================================================================
 */
const ARMS = ["A", "B", "C"] as const;
type ArmId = (typeof ARMS)[number];

/**
 * The automated scores, READ from the arms report.
 */
const armsReport = JSON.parse(
	readFileSync(join(PRIVATE_ROOT, `${SESSION_ID}.arms.json`), "utf8"),
) as {
	arms: {
		id: ArmId;
		scores: {
			oracleItemId: string;
			score: string;
			missingQualifications: string[];
		}[];
	}[];
};

function automated(
	arm: ArmId,
	item: string,
): {
	score: string;
	missingQualifications: string[];
} {
	const entry = armsReport.arms
		.find((a) => a.id === arm)
		?.scores.find((s) => s.oracleItemId === item);
	return {
		score: entry?.score ?? "UNSCORABLE",
		missingQualifications: entry?.missingQualifications ?? [],
	};
}

/**
 * The ADMITTED set of the contract, measured by the SECTION ITSELF: the
 * production publication path carries a fragment's bytes only when the
 * admission contract admitted it. The section is therefore the OBSERVATION
 * of the admission.
 */
const adjudications: PropositionAdjudication[] = [];
for (const arm of ARMS) {
	const section = carriedSection(arm);
	const tail = tailText(arm);
	for (const item of DECISIVE) {
		const facts = FACTS.filter((fact) => fact.item === item).map((fact) =>
			adjudicateFact(fact, section, tail),
		);
		const auto = automated(arm, item);
		adjudications.push(
			classify(
				item,
				arm,
				facts,
				auto.score,
				auto.missingQualifications,
				section,
			),
		);
	}
}

/**
 * The SCORER_FALSE_NEGATIVE count.
 *
 * A proposition is a SCORER_FALSE_NEGATIVE when every fact is carried and
 * the automated matcher still reports a material omission. The count is
 * the DIFFERENCE between the DIRECT adjudication and the automated score.
 */
const scorerFalseNegatives = adjudications.filter((a) => a.scorerFalseNegative);

const report = {
	sessionId: SESSION_ID,
	boundary: BOUNDARY,
	facts: FACTS.map((fact) => ({
		...fact,
		sourceEstablishes: containsLiteral(
			sourceText(fact.canonicalIndex),
			fact.literal,
		),
	})),
	adjudications,
	scorerFalseNegatives: scorerFalseNegatives.map((a) => ({
		item: a.item,
		arm: a.arm,
		automatedScore: a.automatedScore,
		missingQualifications: a.missingQualifications,
	})),
	byItem: Object.fromEntries(
		DECISIVE.map((item) => [
			item,
			Object.fromEntries(
				ARMS.map((arm) => {
					const entry = adjudications.find(
						(a) => a.item === item && a.arm === arm,
					);
					return [
						arm,
						{
							category: entry?.category ?? "INSUFFICIENT_EVIDENCE",
							automatedScore: entry?.automatedScore ?? "UNSCORABLE",
							scorerFalseNegative: entry?.scorerFalseNegative ?? false,
						},
					];
				}),
			),
		]),
	),
	oracleCriteria: Object.fromEntries(
		DECISIVE.map((item) => [
			item,
			{
				proposition: ITEM_BY_ID.get(item)?.proposition ?? "",
				requiredQualifications:
					ITEM_BY_ID.get(item)?.requiredQualifications ?? [],
				assertionIds: (ORACLE_ASSERTIONS[item] ?? []).map((a) => ({
					id: a.id,
					isMaterialQualification: a.isMaterialQualification,
				})),
			},
		]),
	),
};

mkdirSync(PRIVATE_ROOT, { recursive: true });
writeFileSync(
	join(PRIVATE_ROOT, `${SESSION_ID}.adjudication.json`),
	JSON.stringify(report, null, 2),
);

const lines: string[] = [];
lines.push("DIRECT_SOURCE_ADJUDICATION");
for (const item of DECISIVE) {
	for (const arm of ARMS) {
		const entry = adjudications.find((a) => a.item === item && a.arm === arm);
		lines.push(
			[
				`item=${item}`,
				`arm=${arm}`,
				`category=${entry?.category}`,
				`automated=${entry?.automatedScore}`,
				`scorerFalseNegative=${entry?.scorerFalseNegative}`,
			].join(" "),
		);
		for (const note of entry?.notes ?? []) {
			lines.push(`    NOTE ${note}`);
		}
	}
}
lines.push(
	`SCORER_FALSE_NEGATIVES=${scorerFalseNegatives.length} of ${adjudications.length} adjudications`,
);
lines.push("ADDITIONAL_INFERENCE_REQUESTS=0");
console.log(lines.join("\n"));
