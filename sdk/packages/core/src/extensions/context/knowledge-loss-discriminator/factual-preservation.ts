/**
 * ACT-CLINEMM-COMPACTION-FACTUAL-PRESERVATION-REPAIR-01
 *
 * C2 — THE FACTUAL-CONSISTENCY SCORING LAYER.
 *
 * ============================================================================
 * THE DEFECT THIS CORRECTS
 * ============================================================================
 *
 * The predecessor ACT scored a material factual substitution as
 * `PARTIALLY_PRESERVED`:
 *
 *   > "R2: Phone-notification senders use hardcoded/default connect/socket
 *   >  timeouts, e.g. `NotificationServiceClient` defaults `500 ms` / `1500 ms`"
 *
 * The OBSERVED value for the socket timeout is `1000 ms`. The `1500 ms` came
 * from a DIFFERENT subsystem (`KC_NS_KAFKA_SEND_TIMEOUT_MS`) that was also in
 * the summarizer's input. The summary asserted a WRONG VALUE about the RIGHT
 * SUBJECT, and the predecessor's assertion matcher credited it because the
 * proposition-level pattern `\b(500|1000)\b` matched the `500`.
 *
 * That is the failure mode the reviewer named: the conservation metric must
 * not reward an incorrect assertion simply because some of its keywords are
 * present.
 *
 * ============================================================================
 * THE RULE
 * ============================================================================
 *
 *   WRONG_SUBJECT       != PARTIAL
 *   WRONG_VALUE         != PARTIAL
 *   WRONG_UNIT          != PARTIAL
 *   WRONG_POLARITY      != PARTIAL
 *   MISSING_QUALIFIER   == PARTIAL
 *
 * A missing MATERIAL QUALIFICATION is a partial preservation: the proposition
 * is present but under-qualified. A MATERIAL CONTRADICTION is not partial at
 * all: the context asserts something that conflicts with the source.
 *
 * ============================================================================
 * WHY THIS IS A SEPARATE LAYER
 * ============================================================================
 *
 * The predecessor's matcher is a POSITIVE matcher: it asks "does the context
 * contain a phrase that expresses this proposition?". It has no way to ask
 * "does the context assert something that CONTRADICTS this proposition?",
 * because a contradiction is frequently phrased with the SAME keywords as the
 * proposition (only the value differs).
 *
 * So the contradiction check must be EXPLICIT: each oracle item declares the
 * ATOMIC FACTS it asserts, and the layer searches the context for a fact that
 * CONTRADICTS an atomic fact while using the same subject anchor.
 *
 * The result is that a context which asserts BOTH the correct value and an
 * incorrect one is `CONTRADICTED`, not `PRESERVED`: the presence of a correct
 * keyword must not conceal a material contradiction.
 */

import type { KnowledgeOracleItem } from "./oracle";
import type { SemanticScore } from "./scoring";

/**
 * ONE ATOMIC FACT that an oracle item asserts.
 *
 * A fact is the SMALLEST unit that can be independently true or false. It
 * carries:
 *
 *   - `id` — the fact's identity, used in the adjudication note.
 *   - `subject` — the matcher that must identify the SUBJECT the fact is
 *     about. A contradiction is only a contradiction of THIS fact when it is
 *     about the SAME subject.
 *   - `value` — the matcher for the fact's VALUE. A fact without a value
 *     matcher asserts a PROPERTY of the subject rather than a specific value.
 *   - `unit` — the matcher for the fact's UNIT, when the fact has one.
 *   - `polarity` — whether the fact asserts a POSITIVE or a NEGATIVE state.
 */
export interface AtomicFact {
	readonly id: string;
	/** Matches text that identifies the SUBJECT the fact is about. */
	readonly subject: RegExp;
	/**
	 * Matches text that names the RELATION between the subject and the value.
	 *
	 * The relation is what makes the fact atomic: "the socket timeout OF the
	 * notification-service client IS 1000 ms" is one relation. A value that
	 * belongs to a DIFFERENT relation (the Kafka send timeout) is therefore
	 * not a candidate value for this relation at all.
	 */
	readonly relation: RegExp;
	/**
	 * The OBSERVED value of the relation.
	 *
	 * A fact without an observed value asserts a PROPERTY of the subject
	 * rather than a specific value.
	 */
	readonly observedValue?: string;
	/**
	 * The OBSERVED unit of the relation, when the fact carries one.
	 *
	 * It is compared against the unit actually asserted in the context, so a
	 * correct number with the wrong unit is detectable.
	 */
	readonly observedUnit?: RegExp;
	/**
	 * The polarity the fact asserts.
	 *
	 * A `negative` fact asserts that something did NOT happen (the first
	 * render FAILED). A context asserting the opposite is a REVERSED
	 * POLARITY contradiction.
	 */
	readonly polarity: "positive" | "negative";
	/**
	 * For a `negative` fact, the matcher that asserts the OPPOSITE.
	 *
	 * It is required for a negative fact: without it, "the render failed"
	 * and "the render succeeded" cannot be told apart.
	 */
	readonly oppositeAssertion?: RegExp;
	/**
	 * The SIBLING RELATIONS that share this fact's value list.
	 *
	 * A summary commonly states several relations and their values as two
	 * parallel lists:
	 *
	 *     "connect/socket timeouts ... 500 ms / 1500 ms"
	 *
	 * The relations are paired with the values BY POSITION, so detecting the
	 * socket timeout's value requires knowing that the connect timeout is its
	 * sibling. The sibling list establishes that pairing.
	 */
	readonly siblingRelations?: readonly RegExp[];
}

/**
 * A CONTRADICTION of an atomic fact, observed in a context.
 */
export interface FactualContradiction {
	readonly oracleItemId: string;
	readonly factId: string;
	/**
	 * The KIND of the contradiction. It is recorded so that a report can
	 * distinguish a wrong value from a wrong subject from a wrong unit from a
	 * reversed polarity.
	 */
	readonly kind:
		| "WRONG_VALUE"
		| "WRONG_SUBJECT"
		| "WRONG_UNIT"
		| "REVERSED_POLARITY";
	/** A short, human-readable adjudication of the contradiction. */
	readonly note: string;
}

/**
 * The SUBJECT anchor for the notification-service sender.
 *
 * It matches the CAMEL-CASE class name (`NotificationServiceClient`) as well
 * as the kebab/spaced forms (`notification-service`, `notification service`),
 * because a summary names the subject in whichever shape the source used.
 */
const NOTIFICATION_SERVICE_SUBJECT =
	/notification[- _]?service(?:[- _]?client)?/i;

/**
 * The FACTS each oracle item asserts.
 *
 * The list is deliberately SMALL and ATOMIC. It contains only the facts whose
 * loss or distortion is the material risk, and each fact names its own
 * subject so that a neighbouring subsystem's value cannot be mistaken for
 * it.
 */
export const ORACLE_ATOMIC_FACTS: Readonly<
	Record<string, readonly AtomicFact[]>
> = {
	/**
	 * O7 — the notification-service sender's default timeouts.
	 *
	 * The RELATION anchor is the timeout CONSTANT NAME, so the Kafka send
	 * timeout (a different constant in a different subsystem) is not a
	 * candidate value for either relation.
	 */
	O7: [
		{
			id: "connect-timeout-500",
			subject: NOTIFICATION_SERVICE_SUBJECT,
			relation: /connect(?:ion)?[_ \-/]*timeout/i,
			siblingRelations: [/socket[_ \-/]*timeout/i],
			observedValue: "500",
			observedUnit: /\bms\b|milliseconds?/i,
			polarity: "positive",
		},
		{
			id: "socket-timeout-1000",
			subject: NOTIFICATION_SERVICE_SUBJECT,
			relation: /socket[_ \-/]*timeout/i,
			siblingRelations: [/connect(?:ion)?[_ \-/]*timeout/i],
			observedValue: "1000",
			observedUnit: /\bms\b|milliseconds?/i,
			polarity: "positive",
		},
	],
	/**
	 * O1 — the first render FAILED.
	 *
	 * The fact is a NEGATIVE one, so a context asserting that the render
	 * SUCCEEDED (without qualification) contradicts it.
	 *
	 * The OPPOSITE assertion is scoped to the SUBJECT: the carried verified-
	 * outcome section records every tool call as "succeeded", so an unscoped
	 * opposite matcher would fire on the section's own boilerplate and report
	 * a contradiction that the summary never made.
	 */
	O1: [
		{
			id: "first-render-failed",
			subject: /render|helm\s+template/i,
			relation: /render|helm\s+template/i,
			polarity: "negative",
			oppositeAssertion:
				/\bsuccess(?:ful|fully)?\b|\bsucceeded\b|\bobtained\b|\bpassed\b|exit\s*(?:status|code)?\s*=?\s*0\b|\bwithout\s+(?:any\s+)?error/i,
		},
	],
	/**
	 * O4 — the conventional-suffix count is 47.
	 */
	O4: [
		{
			id: "conventional-suffix-count-47",
			subject: /\*test|conventional|suffix|test[- ]?suffix/i,
			relation: /count|files?|\b\d+\b/i,
			observedValue: "47",
			polarity: "positive",
		},
	],
};

/**
 * The window, in characters, within which a value is considered to be
 * asserted ABOUT a relation mention.
 *
 * It is bounded on purpose: a value that belongs to a DIFFERENT relation —
 * even one that appears in the same context — is not collected, which is
 * exactly the Kafka-send-timeout case.
 */
const VALUE_ASSERTION_WINDOW = 80;

/**
 * The window, in characters, within which a relation is considered to be
 * scoped to the fact's SUBJECT.
 *
 * The subject is the anchor that keeps a relation in scope: a
 * `NotificationServiceClient` mention scopes the relations around it. The
 * scope is BIDIRECTIONAL, because natural prose states the relation BEFORE
 * the subject at least as often as after it ("connect/socket timeouts ...
 * NotificationServiceClient defaults ...").
 */
const SUBJECT_SCOPE_WINDOW = 240;

/**
 * A candidate VALUE asserted for a relation.
 */
interface AssertedValue {
	/** The literal text the value was read from. */
	readonly text: string;
	/** The numeric token itself. */
	readonly token: string;
	/** Whether a unit accompanied the value. */
	readonly hasUnit: boolean;
	/** The unit text, when one was found. */
	readonly unitText?: string;
	/** The offset of the value in the context. */
	readonly offset: number;
}

/**
 * The VALUE TOKEN pattern.
 *
 * It reads a number, optionally followed by a unit word. It is deliberately
 * simple: the RELATION window is what decides whether the value belongs to
 * the fact's relation, not the value's own shape.
 *
 * The DIGIT SEPARATOR is accepted and then normalised away: Java, Kotlin and
 * Rust write a grouped number as `10_000`, which is TEN THOUSAND — not ten
 * followed by three zeros. Reading it as `10` would report a wrong value for
 * a correct observation.
 */
/**
 * The ASSIGNED-VALUE pattern.
 *
 * A value that is bound to a relation by an assignment or a declaration. It
 * is the only form that establishes "this relation HAS this value".
 */
const ASSIGNED_VALUE =
	/(?:=|:)\s*"?(\d+(?:_\d+)*(?:\.\d+)?)\s*(ms|milliseconds?|s|seconds?|m|min(?:ute)?s?|h|hours?|%|files?)?\b/gi;

/**
 * The FILE-PATH GUTTER.
 *
 * The canonical source format prefixes every line with its file line number:
 *
 *     Foo.java:141:    .socketTimeOutMillis(socketTimeoutMillis);
 *
 * The `141` is a LINE NUMBER. It is followed by a colon, which is what
 * distinguishes it from a value: a value is not followed by a colon.
 */
const FILE_PATH_GUTTER = /:(\d+):/g;

const VALUE_TOKEN =
	/(\d+(?:_\d+)*(?:(?:\.\d+)?))\s*(ms|milliseconds?|s|seconds?|m|min(?:ute)?s?|h|hours?|%|files?)?\b/gi;

/**
 * The RELATION mention, with its offset in the context.
 */
interface RelationMention {
	readonly offset: number;
	readonly text: string;
}

/**
 * Find the RELATION mentions that are IN SCOPE of the fact's subject,
 * INCLUDING the fact's SIBLING relations.
 *
 * A relation is in scope when a subject mention is near it — before OR after
 * it, within the scope window. A relation that belongs to a DIFFERENT
 * subsystem — for example the Kafka send timeout, which has no
 * notification-service subject anywhere near it — is therefore not in scope.
 *
 * The SIBLING relations are collected too, because the value list is shared
 * across them and the positional pairing is computed over the whole group.
 */
function findInScopeRelations(
	fact: AtomicFact,
	context: string,
): readonly RelationMention[] {
	const subjectPattern = new RegExp(
		fact.subject.source,
		`${fact.subject.flags.replace(/[gy]/g, "")}g`,
	);
	const subjects: number[] = [];
	let subjectMatch: RegExpExecArray | null = subjectPattern.exec(context);
	while (subjectMatch !== null) {
		subjects.push(subjectMatch.index);
		subjectMatch = subjectPattern.exec(context);
	}
	if (subjects.length === 0) {
		return [];
	}
	const patterns = [fact.relation, ...(fact.siblingRelations ?? [])];
	const found: RelationMention[] = [];
	for (const pattern of patterns) {
		const scanner = new RegExp(
			pattern.source,
			`${pattern.flags.replace(/[gy]/g, "")}g`,
		);
		let match: RegExpExecArray | null = scanner.exec(context);
		while (match !== null) {
			const inScope = subjects.some(
				(offset) => Math.abs(match!.index - offset) <= SUBJECT_SCOPE_WINDOW,
			);
			if (inScope) {
				found.push({ offset: match.index, text: match[0] });
			}
			match = scanner.exec(context);
		}
	}
	// Document order, so the positional pairing is stable.
	return found.sort((left, right) => left.offset - right.offset);
}

/**
 * The SPANS occupied by file-path gutters in a line.
 */
function collectGutterSpans(line: string): { start: number; end: number }[] {
	const spans: { start: number; end: number }[] = [];
	FILE_PATH_GUTTER.lastIndex = 0;
	let match: RegExpExecArray | null = FILE_PATH_GUTTER.exec(line);
	while (match !== null) {
		spans.push({ start: match.index, end: match.index + match[0].length });
		match = FILE_PATH_GUTTER.exec(line);
	}
	return spans;
}

/**
 * Collect the VALUES of a relation group, in document order.
 *
 * ============================================================================
 * WHY A VALUE MUST BE BOUND TO ITS RELATION
 * ============================================================================
 *
 * A bare integer in the neighbourhood of a subject is NOT an assertion about
 * that subject. The canonical source format prefixes every line with its
 * file line number:
 *
 *     52:    static final int DEFAULT_CONNECT_TIMEOUT_MILLIS = 500;
 *     53:    static final int DEFAULT_SOCKET_TIMEOUT_MILLIS = 1000;
 *
 * so a file path followed by `:65` reads as "the subject has the value 65".
 * It does not: 65 is a line number.
 *
 * A value therefore counts only when it is BOUND to a relation — that is,
 * when the relation and the value are on the SAME LINE.
 *
 * A PAIRED LIST ("connect/socket timeouts ... 500 ms / 1500 ms") is still
 * supported: there the relation list and the value list are separate, and the
 * pairing is by position. The window after the LAST relation is collected for
 * that case.
 */
function collectGroupValues(
	fact: AtomicFact,
	relations: readonly RelationMention[],
	context: string,
): readonly AssertedValue[] {
	if (relations.length === 0) {
		return [];
	}
	const values: AssertedValue[] = [];
	const seen = new Set<string>();
	for (const relation of relations) {
		// The LINE the relation is on. A value on the SAME line is bound to
		// it.
		const lineStart = context.lastIndexOf("\n", relation.offset) + 1;
		const lineEnd = context.indexOf("\n", relation.offset);
		const line = context.slice(
			lineStart,
			lineEnd === -1 ? context.length : lineEnd,
		);
		// The SUBJECT must be on the SAME LINE as the relation and the value.
		//
		// Without this, a value that belongs to a DIFFERENT subject is read as
		// this subject's value: `BCallConfig`'s `DEFAULT_SOCKET_TIMEOUT_MS =
		// 10_000` is not `NotificationServiceClient`'s socket timeout, and
		// reporting it as one is exactly the wrong-subject failure the
		// reviewer named.
		if (!fact.subject.test(line)) {
			continue;
		}
		// A value must be BOUND to the relation by an ASSIGNMENT. A number
		// that merely shares the line is not the relation's value: the
		// canonical source format prefixes every line with its file line
		// number (`...java:141:`), so a co-located integer is a LINE NUMBER,
		// not a measurement.
		//
		// The bound forms are:
		//
		//   DEFAULT_SOCKET_TIMEOUT_MS = 10_000;
		//   timeout: 500
		//
		// The FILE-PATH GUTTER is excluded: its numbers are line numbers,
		// not measurements.
		const gutterSpans = collectGutterSpans(line);
		ASSIGNED_VALUE.lastIndex = 0;
		let valueMatch: RegExpExecArray | null = ASSIGNED_VALUE.exec(line);
		while (valueMatch !== null) {
			const isGutter = gutterSpans.some(
				(span) =>
					valueMatch !== null &&
					valueMatch.index >= span.start &&
					valueMatch.index < span.end,
			);
			const key = `${valueMatch.index}:${valueMatch[0]}`;
			if (!isGutter && !seen.has(key)) {
				seen.add(key);
				values.push({
					text: valueMatch[0],
					// The DIGIT SEPARATOR is normalised away. Java, Kotlin and Rust
					// write a grouped number as `10_000`, which is TEN THOUSAND — not
					// ten followed by three zeros. Reading it as `10` would report a
					// wrong value for a correct observation.
					token: valueMatch[1].replace(/_/g, ""),
					hasUnit: valueMatch[2] !== undefined,
					unitText: valueMatch[2],
					offset: lineStart + valueMatch.index,
				});
			}
			valueMatch = ASSIGNED_VALUE.exec(line);
		}
	}
	// The PAIRED LIST case: the values follow the relation list as a separate
	// list, so the window after the LAST relation is collected too.
	const last = relations[relations.length - 1];
	const tail = context.slice(last.offset, last.offset + VALUE_ASSERTION_WINDOW);
	// The SUBJECT must be in scope: a paired list that names the subject
	// ("`NotificationServiceClient` defaults 500 ms / 1500 ms") is an assertion
	// about that subject, and a list that does not name it is not.
	const tailHasSubject = fact.subject.test(tail);
	VALUE_TOKEN.lastIndex = 0;
	let tailMatch: RegExpExecArray | null = VALUE_TOKEN.exec(tail);
	while (tailMatch !== null) {
		const key = `${last.offset + tailMatch.index}:${tailMatch[0]}`;
		if (tailHasSubject && !seen.has(key)) {
			seen.add(key);
			values.push({
				text: tailMatch[0],
				token: tailMatch[1].replace(/_/g, ""),
				hasUnit: tailMatch[2] !== undefined,
				unitText: tailMatch[2],
				offset: last.offset + tailMatch.index,
			});
		}
		tailMatch = VALUE_TOKEN.exec(tail);
	}
	values.sort((left, right) => left.offset - right.offset);
	return values;
}

/**
 * Assign a VALUE to a relation.
 *
 * When the group holds a SINGLE relation, every value in the group is a
 * candidate for it — a summary that says "the socket timeout is 1500 ms"
 * names one relation and one value.
 *
 * When the group holds SEVERAL DISTINCT relations, the values are PAIRED BY
 * POSITION: the Nth relation takes the Nth value. A group whose value list is
 * SHORTER than its relation list is ambiguous, so no pairing is claimed for
 * it.
 *
 * When the SAME relation appears MORE THAN ONCE, every value asserted after
 * any of its mentions is a candidate for it. A context that states the
 * observed value AND then contradicts it is an EXPLICIT CONTRADICTION, and it
 * must not be scored as if the contradicting clause were absent.
 */
function assignValueToRelation(
	fact: AtomicFact,
	relations: readonly RelationMention[],
	groupValues: readonly AssertedValue[],
): readonly AssertedValue[] {
	const matching = relations.filter((relation) =>
		fact.relation.test(relation.text),
	);
	if (matching.length === 0) {
		return [];
	}
	if (matching.length > 1) {
		// The relation is stated more than once. Every value that follows any
		// of its mentions belongs to it.
		const firstMention = matching[0].offset;
		const lastMention = matching[matching.length - 1].offset;
		return groupValues.filter(
			(value) =>
				value.offset >= firstMention &&
				value.offset <= lastMention + VALUE_ASSERTION_WINDOW,
		);
	}
	if (relations.length === 1) {
		return groupValues;
	}
	if (groupValues.length < relations.length) {
		// Ambiguous pairing: refuse to claim a value for this relation.
		return [];
	}
	// The index of THIS fact's relation inside the group.
	const index = relations.findIndex((relation) =>
		fact.relation.test(relation.text),
	);
	if (index < 0 || index >= groupValues.length) {
		return [];
	}
	return [groupValues[index]];
}

/**
 * Whether the OPPOSITE assertion appears NEAR a mention of the fact's
 * subject.
 *
 * The window is the same one the positive facts use. An opposite assertion
 * that is nowhere near the subject belongs to something else, and must not
 * contradict this fact.
 */
function isOppositeAssertionScoped(fact: AtomicFact, context: string): boolean {
	if (!fact.oppositeAssertion) {
		return false;
	}
	const subjectPattern = new RegExp(
		fact.subject.source,
		`${fact.subject.flags.replace(/[gy]/g, "")}g`,
	);
	let match: RegExpExecArray | null = subjectPattern.exec(context);
	while (match !== null) {
		const window = context.slice(
			match.index,
			match.index + VALUE_ASSERTION_WINDOW,
		);
		if (fact.oppositeAssertion.test(window)) {
			return true;
		}
		match = subjectPattern.exec(context);
	}
	return false;
}

/**
 * Find a CONTRADICTION of ONE atomic fact in a context.
 *
 * The check is:
 *
 *   1. For a POSITIVE fact: the context must mention the fact's SUBJECT and
 *      assert a VALUE for the fact's RELATION. When that value is NOT the
 *      observed value, the fact is DISTORTED — the subject is preserved but
 *      the value is wrong. When the observed value IS also present, the
 *      context carries an EXPLICIT CONTRADICTION.
 *
 *   2. For a NEGATIVE fact: the context must mention the fact's SUBJECT and
 *      assert the OPPOSITE of the fact. The polarity is REVERSED.
 *
 * ============================================================================
 * THE PAIRED-LIST CASE
 * ============================================================================
 *
 * A very common surface form states SEVERAL relations and SEVERAL values in
 * two parallel lists:
 *
 *     "connect/socket timeouts ... 500 ms / 1500 ms"
 *
 * The relation list and the value list are PAIRED BY POSITION. The socket
 * timeout is therefore the SECOND value, not the first — and the first value
 * belongs to the connect timeout.
 *
 * Assigning the values positionally is what makes the observation "the socket
 * timeout is 1500 ms" detectable as a contradiction of the observed
 * "the socket timeout is 1000 ms", without falsely contradicting a summary
 * that correctly states "500 ms / 1000 ms".
 */
export function findContradictionOfFact(
	fact: AtomicFact,
	context: string,
): FactualContradiction["kind"] | undefined {
	if (!context || !fact.subject.test(context)) {
		return undefined;
	}
	if (fact.polarity === "negative") {
		// The OPPOSITE assertion is scoped to the SUBJECT. The carried
		// verified-outcome section records every tool call as "succeeded", so
		// an unscoped matcher would fire on the section's own boilerplate and
		// report a contradiction the context never made.
		if (fact.oppositeAssertion && isOppositeAssertionScoped(fact, context)) {
			return "REVERSED_POLARITY";
		}
		return undefined;
	}
	if (fact.observedValue === undefined) {
		// The fact asserts a property rather than a value.
		return undefined;
	}
	const relations = findInScopeRelations(fact, context);
	if (relations.length === 0) {
		return undefined;
	}
	// The value list of the WHOLE relation group, so the positional pairing
	// can be computed across the group rather than per relation.
	const groupValues = collectGroupValues(fact, relations, context);
	const assigned = assignValueToRelation(fact, relations, groupValues);
	if (assigned.length === 0) {
		return undefined;
	}
	const conflicting = assigned.filter(
		(candidate) => candidate.token !== fact.observedValue,
	);
	// A candidate that carries the OBSERVED number but a DIFFERENT unit is
	// also a conflict: "500 s" is not "500 ms".
	const unitConflicts = assigned.filter(
		(candidate) =>
			candidate.token === fact.observedValue &&
			fact.observedUnit !== undefined &&
			candidate.hasUnit &&
			!fact.observedUnit.test(candidate.unitText ?? ""),
	);
	if (conflicting.length === 0 && unitConflicts.length === 0) {
		// Only the observed value, with the observed unit, is asserted for
		// this relation.
		return undefined;
	}
	if (unitConflicts.length > 0 && conflicting.length === 0) {
		// The number is right and the unit is wrong.
		return "WRONG_UNIT";
	}
	const correctPresent = assigned.some(
		(candidate) =>
			candidate.token === fact.observedValue &&
			(fact.observedUnit === undefined ||
				!candidate.hasUnit ||
				fact.observedUnit.test(candidate.unitText ?? "")),
	);
	if (!correctPresent) {
		return "WRONG_VALUE";
	}
	// Both are present. Distinguish a UNIT error from a plain VALUE error.
	for (const candidate of conflicting) {
		if (
			fact.observedUnit &&
			candidate.hasUnit &&
			!fact.observedUnit.test(candidate.unitText ?? "")
		) {
			return "WRONG_UNIT";
		}
	}
	return "WRONG_VALUE";
}

/**
 * Collect EVERY contradiction of an oracle item in a context.
 */
export function findFactualContradictions(
	item: KnowledgeOracleItem,
	context: string,
): readonly FactualContradiction[] {
	const facts = ORACLE_ATOMIC_FACTS[item.id] ?? [];
	const contradictions: FactualContradiction[] = [];
	for (const fact of facts) {
		const kind = findContradictionOfFact(fact, context);
		if (kind) {
			contradictions.push({
				oracleItemId: item.id,
				factId: fact.id,
				kind,
				note: `the context asserts a value for the ${fact.id} subject that conflicts with the observed value`,
			});
		}
	}
	return contradictions;
}

/**
 * The FACTUAL-PRESERVATION verdict for one oracle item in one context.
 *
 * It is computed INDEPENDENTLY of the predecessor's positive matcher, so it
 * can be applied as a CORRECTION to that matcher's result.
 */
export type FactualVerdict = "CONSISTENT" | "DISTORTED" | "CONTRADICTED";

/**
 * Decide the factual verdict for an oracle item in a context.
 *
 * The rule:
 *
 *   - A contradiction of a NEGATIVE fact (the observation said it FAILED and
 *     the context says it SUCCEEDED) is `CONTRADICTED`: the context asserts
 *     the opposite of the observation.
 *   - A contradiction of a POSITIVE fact (the observation said 1000 ms and
 *     the context says 1500 ms) is `DISTORTED`: the context preserves the
 *     subject but substitutes the value.
 *   - Otherwise the context is `CONSISTENT` with respect to this item.
 */
export function decideFactualVerdict(
	item: KnowledgeOracleItem,
	context: string,
): FactualVerdict {
	const facts = ORACLE_ATOMIC_FACTS[item.id] ?? [];
	for (const fact of facts) {
		const kind = findContradictionOfFact(fact, context);
		if (!kind) {
			continue;
		}
		// A REVERSED POLARITY asserts the OPPOSITE of the observation, which
		// is a contradiction. A wrong VALUE or UNIT preserves the subject but
		// substitutes the value, which is a distortion.
		return kind === "REVERSED_POLARITY" ? "CONTRADICTED" : "DISTORTED";
	}
	return "CONSISTENT";
}

/**
 * CORRECT a predecessor score with the factual verdict.
 *
 * The predecessor's positive matcher cannot see a contradiction, so a
 * `PRESERVED` or `PARTIALLY_PRESERVED` score can hide one. This function is
 * the correction:
 *
 *   - `CONTRADICTED` overrides everything with `CONTRADICTED`.
 *   - `DISTORTED` overrides everything with `DISTORTED`.
 *   - `CONSISTENT` leaves the score unchanged.
 *
 * A MISSING MATERIAL QUALIFICATION remains `PARTIALLY_PRESERVED`: that is the
 * one case the reviewer classified as PARTIAL.
 */
export function correctScoreForFactualVerdict(
	score: SemanticScore,
	verdict: FactualVerdict,
): SemanticScore {
	if (verdict === "CONTRADICTED") {
		return "CONTRADICTED";
	}
	if (verdict === "DISTORTED") {
		return "DISTORTED";
	}
	return score;
}
