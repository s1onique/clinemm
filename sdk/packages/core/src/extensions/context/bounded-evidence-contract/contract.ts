/**
 * ACT-CLINEMM-COMPACTION-BOUNDED-EVIDENCE-INPUT-CONTRACT-RECON-01
 *
 * C2 — the BOUNDED, ATTRIBUTED EVIDENCE INPUT CONTRACT.
 *
 * ============================================================================
 * WHAT THIS IS
 * ============================================================================
 *
 * The missing knowledge contract the predecessor ACT identified, expressed
 * as an EXECUTABLE admission rule for the ordinary summarizer's input.
 *
 * The predecessor established that the ordinary summarizer receives a
 * transcript from which the runtime has already removed most substantive
 * command evidence: `renderStructuredToolPayload()` replaces every
 * structured payload's body with `[result omitted]` unless it is an
 * approved scalar or a source-file fact.
 *
 * This module defines the FOUR authorities the reviewer required to remain
 * distinct:
 *
 *   | Authority          | Responsibility                                        |
 *   | ------------------ | ----------------------------------------------------- |
 *   | Runtime            | Which tool executed, its identity, observed result     |
 *   |                    | metadata                                             |
 *   | Evidence selection | Which source material may enter the summarizer request |
 *   | Summarizer         | Interpret and compress the permitted evidence          |
 *
 * ============================================================================
 * THE ADMISSION RULE IS SHAPE-BASED, NOT PROVIDER-BASED
 * ============================================================================
 *
 * The rule below admits an excerpt when the payload is a
 * SOURCE-ATTRIBUTED OBSERVATION with a bounded, non-sensitive body. It does
 * NOT branch on a provider id, a tool name or a command string, and it does
 * NOT re-implement a shell.
 *
 * A command identity, a source reference or a successful exit alone is
 * NEVER sufficient to establish a semantic proposition. The admission rule
 * carries OBSERVED CONTENT plus its ATTRIBUTION, never an inference.
 *
 * ============================================================================
 * WHAT THIS IS NOT
 * ============================================================================
 *
 *   - It is NOT a new command parser. The existing `classifyCommand()` is
 *     reused unchanged.
 *   - It is NOT a new evidence store. There is no persistent state.
 *   - It is NOT a retrieval tool and NOT a semantic-memory subsystem.
 *   - It is NOT a production repair. This ACT produces a RECON verdict.
 */

import {
	isSensitiveSourceFilePath,
	sanitizeOutcomeText,
} from "../evidence-continuity";

/**
 * The class of an admitted evidence fragment.
 *
 * The class is part of the fragment's IDENTITY: the summarizer is told what
 * KIND of observation it is reading, so that a measurement is not read as a
 * configuration and a default is not read as an effective value.
 */
export type EvidenceFragmentKind =
	/** A bounded excerpt of a source-attributed observation. */
	| "OBSERVED_EXCERPT"
	/** A negative observation: the operation failed, and that is the fact. */
	| "NEGATIVE_OBSERVATION"
	/** A bounded excerpt of an ERROR message. */
	| "OBSERVED_ERROR";

/**
 * The admission verdict for ONE structured tool payload.
 */
export type AdmissionVerdict =
	/** The payload's body may be admitted as a bounded excerpt. */
	| "ADMITTED"
	/** The payload is a negative observation; its failure is admissible. */
	| "ADMITTED_NEGATIVE"
	/** The payload is admissible, but only as an approved scalar. */
	| "ADMITTED_SCALAR"
	/** The payload is omitted under the confidentiality policy. */
	| "OMITTED_CONFIDENTIALITY"
	/** The payload's shape was not recognized. */
	| "OMITTED_UNRECOGNIZED_SHAPE";

/**
 * The maximum number of characters carried by ONE admitted excerpt.
 *
 * It is a FIXED COST, so the summarizer input never grows with the
 * transcript size. It matches the existing `SOURCE_FILE_FACT_CHAR_LIMIT`
 * so that the two admission routes have the same per-item cost.
 */
export const BOUNDED_EVIDENCE_EXCERPT_CHAR_LIMIT = 2_000;

/**
 * The maximum number of DISTINCT excerpt LINES carried from ONE payload.
 *
 * A command's output is usually a list of records; the first N lines
 * usually carry the observation, and the rest is bulk. The bound keeps the
 * cost per payload small and predictable.
 */
export const BOUNDED_EVIDENCE_MAX_LINES = 40;

/**
 * The maximum number of admitted excerpts carried for the WHOLE request.
 *
 * The budget is a REQUEST-level bound, not a transcript-level one: it caps
 * the total added cost so that the summarizer input stays inside the
 * existing input budget.
 */
export const BOUNDED_EVIDENCE_MAX_FRAGMENTS = 24;

/**
 * A BOUNDED, ATTRIBUTED evidence fragment.
 *
 * Every fragment names:
 *
 *   - the SOURCE it came from (a path, or a source reference),
 *   - the OBSERVED STATUS (what the runtime recorded),
 *   - the CLASS of observation,
 *   - the BOUNDED excerpt.
 *
 * The excerpt is the tool's OWN output. It is never authored, summarised or
 * inferred by this module.
 */
export interface BoundedEvidenceFragment {
	/** The source the observation was made against. */
	readonly source: string;
	/** The runtime-recorded status of the observation. */
	readonly status: string;
	/** The class of the observation. */
	readonly kind: EvidenceFragmentKind;
	/** The bounded excerpt of the observed body. */
	readonly excerpt: string;
}

/**
 * The admission verdict together with whatever was admitted.
 */
export interface EvidenceAdmission {
	readonly verdict: AdmissionVerdict;
	readonly fragment?: BoundedEvidenceFragment;
	/**
	 * A human-readable reason the payload was not admitted.
	 *
	 * It is recorded so that the ACT can REPORT which evidence was omitted
	 * because of budget or confidentiality restrictions, rather than
	 * silently dropping it.
	 */
	readonly reason?: string;
}

/**
 * The SENSITIVE-PATH rule for an evidence source.
 *
 * A source whose PATH is a known credential-bearing location is never
 * admitted. The rule is applied to the PATH, because the path is the one
 * property that CAN be established: a `.pgpass` file is a credential
 * container by construction, whatever its content looks like.
 *
 * The existing production rule (`isSensitiveSourceFilePath`) is REUSED
 * unchanged rather than re-implemented.
 */
export function isSensitiveEvidenceSource(source: string): boolean {
	return isSensitiveSourceFilePath(source);
}

/**
 * The maximum number of characters a single EXCERPT LINE may carry.
 *
 * A single line can be arbitrarily long (a minified bundle on one line, a
 * base64 blob). The bound is applied PER LINE as well as to the whole
 * excerpt, so one pathological line cannot consume the whole budget.
 */
export const BOUNDED_EVIDENCE_LINE_CHAR_LIMIT = 300;

/**
 * Bound ONE excerpt line.
 */
function boundLine(line: string): string {
	if (line.length <= BOUNDED_EVIDENCE_LINE_CHAR_LIMIT) {
		return line;
	}
	return `${line.slice(0, BOUNDED_EVIDENCE_LINE_CHAR_LIMIT)}...[line truncated]`;
}

/**
 * Bound an excerpt to the per-fragment budget.
 *
 * The bound is applied BEFORE the redaction, so that the sanitizer never has
 * to scan an unbounded body.
 *
 * ============================================================================
 * WHY THE ORDER IS BOUND-THEN-REDACT
 * ============================================================================
 *
 * The production `sanitizeOutcomeText()` applies a value-position
 * credential regex whose alternation can backtrack catastrophically on a
 * LONG body with no match — a 500 000-character run of a single repeated
 * character does not terminate in reasonable time.
 *
 * That is a property of the PRODUCTION sanitizer, and it is a real finding
 * of this ACT (recorded in the evidence), but it is NOT this ACT's repair:
 * the production sanitizer is shared with the evidence-continuity module and
 * changing it is a separate, wider change.
 *
 * What this contract does is BOUND FIRST. The body is cut to the per-
 * fragment budget, and only the bounded text is handed to the sanitizer.
 * The consequence for confidentiality is the SAFE direction: the sanitizer
 * sees at most `BOUNDED_EVIDENCE_EXCERPT_CHAR_LIMIT` characters, and the
 * truncation happens BEFORE any byte could be published.
 */
function boundExcerpt(text: string): string {
	const lines = selectInformativeLines(text);
	const bounded = lines.map((line) => boundLine(line));
	const droppedLines = text.split("\n").length - bounded.length;
	const body = bounded.join("\n");
	if (body.length <= BOUNDED_EVIDENCE_EXCERPT_CHAR_LIMIT) {
		return droppedLines > 0
			? `${body}\n...[${droppedLines} further lines omitted]`
			: body;
	}
	return `${body.slice(0, BOUNDED_EVIDENCE_EXCERPT_CHAR_LIMIT)}\n...[excerpt truncated]`;
}

/**
 * The OBSERVED STATUS vocabulary for an admitted fragment.
 *
 * It is deliberately the SAME vocabulary the production renderer uses, so
 * that the summarizer sees one status language across the whole input.
 */
export type ObservedStatus = "succeeded" | "failed" | "unknown";

/**
 * Classify a structured payload's status by its OWN status signal.
 *
 * The semantics are identical to the production
 * `classifyStructuredPayloadStatus()`:
 *
 *   - `success: false` / `isError: true` -> "failed"
 *   - `success: true`                   -> "succeeded"
 *   - no affirmative signal             -> "unknown"
 *
 * "No evidence of failure" is not "evidence of success".
 */
export function classifyObservedStatus(
	payload: Record<string, unknown>,
): ObservedStatus {
	if (payload.success === false || payload.isError === true) {
		return "failed";
	}
	if (payload.success === true) {
		return "succeeded";
	}
	return "unknown";
}

/**
 * The SOURCE REFERENCE for an observation that is not a file read.
 *
 * A command's own arguments are NEVER carried: they may contain a path, a
 * URL or a credential. The reference is therefore a STABLE, NON-SECRET
 * description of WHERE the observation was made, derived from the payload's
 * own query only when the query is a source-shaped reference.
 *
 * When no safe reference can be established, the observation is attributed
 * to the tool's result INDEX, which is unambiguous and carries nothing.
 */
export function resolveEvidenceSource(input: {
	readonly payload: Record<string, unknown>;
	readonly index: number;
	readonly toolName?: string;
}): string {
	const rawQuery = input.payload.query;
	if (typeof rawQuery === "string") {
		const trimmed = rawQuery.trim();
		// A source reference is only used when it is a PATH-SHAPED token with
		// no whitespace, no shell metacharacter and no query shape. A command
		// line is therefore never carried, and a URL is never carried.
		if (
			trimmed.length > 0 &&
			trimmed.length <= 256 &&
			!/\s/.test(trimmed) &&
			!/[$`(){}[\]<>*?~!&|"';]/.test(trimmed) &&
			!trimmed.includes("://") &&
			(trimmed.includes("/") || trimmed.includes("\\"))
		) {
			return trimmed;
		}
	}
	const toolName = input.toolName?.trim();
	if (toolName) {
		return `${toolName}#${input.index + 1}`;
	}
	return `#${input.index + 1}`;
}

/**
 * The APPROVED SCALAR rule.
 *
 * It is the SAME rule the production renderer already applies: a finite
 * boolean or number is carried as `result=<value>`, and anything else is
 * omitted. The contract REUSES it rather than widening it, because a
 * widened scalar rule is a new publication channel.
 */
export function renderApprovedScalar(
	payload: Record<string, unknown>,
): string | undefined {
	const rawResult = payload.result;
	if (typeof rawResult === "boolean") {
		return `result=${rawResult}`;
	}
	if (typeof rawResult === "number" && Number.isFinite(rawResult)) {
		return `result=${rawResult}`;
	}
	return undefined;
}

/**
 * The RUNTIME-METADATA IMPERSONATION MARKERS.
 *
 * A tool body can contain text that LOOKS like runtime metadata — a
 * `[System]:` prefix, an `<!-- cline-...:begin -->` marker, a
 * `BEGIN OBSERVED DATA` frame opener. If such a marker reached the
 * summarizer verbatim, the body could pose as a channel the runtime owns.
 *
 * The marker is NEUTRALISED by escaping its delimiters, not by deleting the
 * text: the observation itself is knowledge, and deleting a line because it
 * happens to start with a bracket would destroy knowledge for a cosmetic
 * reason. Escaping the delimiters preserves the observation and denies the
 * impersonation.
 *
 * The escaped form is still readable DATA, and it is still framed as
 * observed data. The point is that it cannot be MISTAKEN for a runtime
 * channel, not that the text is hidden.
 */
const RUNTIME_METADATA_MARKERS: readonly RegExp[] = [
	/<!--\s*cline-[a-z-]+:(begin|end)\s*-->/gi,
	/\[\s*(system|assistant|user|tool|developer|runtime)\s*\]\s*:/gi,
	/\|\s*---\s*(begin|end)\s+observed data\s*---\s*\|/gi,
];

/**
 * Neutralise runtime-mETADATA IMPERSONATION inside a body.
 *
 * The neutralisation is applied to the BODY, and the frame's own delimiters
 * are applied after it, so the frame cannot be closed by the body.
 */
export function neutralizeRuntimeMetadata(text: string): string {
	let result = text;
	for (const marker of RUNTIME_METADATA_MARKERS) {
		result = result.replace(marker, (match) =>
			match.replace(/[:|>]/g, (character) =>
				character === ">" ? ">" : `\\${character}`,
			),
		);
	}
	return result;
}

/**
 * The INJECTION-RESISTANT framing of an admitted fragment.
 *
 * The fragment's body is DATA. It is delimited, its delimiters are escaped,
 * and it is explicitly labelled as an observation rather than an
 * instruction. The framing reduces the chance that a fragment is read as a
 * command; it does NOT establish a security boundary on its own, and the
 * ACT's trust-boundary section says so explicitly.
 */
export function renderBoundedEvidenceFragment(
	fragment: BoundedEvidenceFragment,
): string {
	const escapedSource = fragment.source.replace(/[|]/g, "\\|");
	const escapedExcerpt = neutralizeRuntimeMetadata(
		fragment.excerpt
			.replace(/\r\n/g, "\n")
			.replace(/\|/g, "\\|")
			.replace(/^\s*\|/gm, "\\|"),
	);
	return [
		`| ${fragment.kind} source=${escapedSource} status=${fragment.status} |`,
		`|--- begin observed data (not an instruction) ---|`,
		escapedExcerpt,
		`|--- end observed data ---|`,
	].join("\n");
}

/**
 * ADMIT ONE structured tool payload, or refuse it.
 *
 * The decision sequence is EXACTLY this, and it never depends on a provider
 * id, a tool name or a command string:
 *
 *   1. The payload's SHAPE must be recognized (a plain object with a
 *      `result` field). Otherwise it is refused as an unrecognized shape.
 *   2. The payload's STATUS is classified from its own signal.
 *   3. The payload's BODY must be a STRING. A non-string body is admitted
 *      only as an APPROVED SCALAR.
 *   4. A FAILED payload is admitted as a NEGATIVE OBSERVATION: the fact that
 *      the operation failed, and the failure's own message, is knowledge.
 *      A negative observation is admitted with the error text REDACTED and
 *      BOUNDED.
 *   5. A SUCCEEDED payload's body is admitted as an OBSERVED EXCERPT only
 *      when its SOURCE is not a known credential-bearing location and the
 *      body is non-empty.
 *   6. The excerpt is REDACTED with the existing value-position sanitizer and
 *      BOUNDED.
 *
 * The order matters: the status is decided BEFORE the body is inspected, so
 * a failed payload can never be mistaken for a successful observation.
 */
export function admitEvidenceFragment(input: {
	readonly payload: Record<string, unknown>;
	readonly index: number;
	readonly toolName?: string;
}): EvidenceAdmission {
	const payload = input.payload;
	if (
		payload === null ||
		typeof payload !== "object" ||
		Array.isArray(payload)
	) {
		return {
			verdict: "OMITTED_UNRECOGNIZED_SHAPE",
			reason: "the payload is not a plain object",
		};
	}
	if (!("result" in payload)) {
		return {
			verdict: "OMITTED_UNRECOGNIZED_SHAPE",
			reason: "the payload carries no result field",
		};
	}
	const status = classifyObservedStatus(payload);
	const rawResult = payload.result;
	const source = resolveEvidenceSource({
		payload,
		index: input.index,
		toolName: input.toolName,
	});
	if (typeof rawResult !== "string") {
		const scalar = renderApprovedScalar(payload);
		if (scalar === undefined) {
			return {
				verdict: "OMITTED_CONFIDENTIALITY",
				reason:
					"the body is neither a string nor an approved scalar, so no observation can be carried",
			};
		}
		return {
			verdict: "ADMITTED_SCALAR",
			fragment: {
				source,
				status,
				kind: "OBSERVED_EXCERPT",
				excerpt: scalar,
			},
		};
	}
	if (rawResult.trim().length === 0) {
		return {
			verdict: "OMITTED_CONFIDENTIALITY",
			reason: "the body is empty, so it establishes no observation",
		};
	}
	if (isSensitiveEvidenceSource(source)) {
		return {
			verdict: "OMITTED_CONFIDENTIALITY",
			reason:
				"the source is a known credential-bearing location, so its content is never carried",
		};
	}
	// BOUND FIRST, THEN REDACT. The sanitizer's credential regex can
	// backtrack catastrophically on a long body, so it must never see an
	// unbounded one. The truncation happens before any byte is published, so
	// the confidentiality direction is the safe one.
	const bounded = boundExcerpt(rawResult);
	const redacted = sanitizeOutcomeText(bounded);
	const excerpt = redacted;
	if (excerpt.trim().length === 0) {
		return {
			verdict: "OMITTED_CONFIDENTIALITY",
			reason: "the body carried nothing after redaction",
		};
	}
	const kind: EvidenceFragmentKind =
		status === "failed" ? "NEGATIVE_OBSERVATION" : "OBSERVED_EXCERPT";
	return {
		verdict: status === "failed" ? "ADMITTED_NEGATIVE" : "ADMITTED",
		fragment: {
			source,
			status,
			kind,
			excerpt,
		},
	};
}

/**
 * The report of ONE summarizer-input projection under the contract.
 *
 * It records what was admitted, what was refused and WHY, so that the ACT
 * can report which evidence was omitted because of budget or confidentiality
 * restrictions rather than silently dropping it.
 */
export interface EvidenceProjectionReport {
	/** The admitted fragments, in admission order. */
	readonly admitted: readonly BoundedEvidenceFragment[];
	/** The count of admitted fragments. */
	readonly admittedCount: number;
	/** The count of fragments refused for CONFIDENTIALITY reasons. */
	readonly omittedConfidentiality: number;
	/** The count of fragments refused because the REQUEST budget was spent. */
	readonly omittedBudget: number;
	/** The count of fragments refused because their shape was not recognized. */
	readonly omittedUnrecognizedShape: number;
	/** The characters the admitted fragments add to the serialized input. */
	readonly addedChars: number;
	/** The reasons the refusals were recorded, grouped by verdict. */
	readonly omissionReasons: readonly {
		readonly reason: string;
		readonly count: number;
	}[];
}

/**
 * PROJECT ONE summarizer-input transcript under the contract.
 *
 * The projection walks the messages in order and admits a bounded set of
 * fragments. The REQUEST-level budget (`BOUNDED_EVIDENCE_MAX_FRAGMENTS`) is
 * spent in ORDER, so the fragments that are admitted are the EARLIEST ones.
 *
 * The budget is deliberately a FRAGMENT COUNT and not a character budget:
 * a character budget would let one verbose fragment consume the whole
 * allowance, and a count budget makes the added cost predictable and
 * bounded per request.
 *
 * The projection does NOT decide which evidence is RELEVANT. Relevance
 * selection is a separate, harder problem, and the ACT's scope forbids
 * inventing a general extraction framework. What this projection
 * establishes is that the evidence REACHES the summarizer input at all —
 * which is the boundary the predecessor ACT identified as the loss.
 */
export function projectBoundedEvidence(input: {
	readonly messages: readonly MessageWithMetadataLike[];
	readonly maxFragments?: number;
}): EvidenceProjectionReport {
	const maxFragments = input.maxFragments ?? BOUNDED_EVIDENCE_MAX_FRAGMENTS;
	const admitted: BoundedEvidenceFragment[] = [];
	const reasonCounts = new Map<string, number>();
	let omittedConfidentiality = 0;
	let omittedBudget = 0;
	let omittedUnrecognizedShape = 0;
	const note = (reason: string): void => {
		reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
	};
	for (const message of input.messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type !== "tool_result") {
				continue;
			}
			const content = (block as { content?: unknown }).content;
			if (!Array.isArray(content)) {
				continue;
			}
			for (const [index, entry] of content.entries()) {
				if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
					omittedUnrecognizedShape += 1;
					note("the payload entry is not a plain object");
					continue;
				}
				const decision = admitEvidenceFragment({
					payload: entry as Record<string, unknown>,
					index,
					toolName: (block as { name?: string }).name,
				});
				if (decision.fragment === undefined) {
					if (decision.verdict === "OMITTED_UNRECOGNIZED_SHAPE") {
						omittedUnrecognizedShape += 1;
					} else {
						omittedConfidentiality += 1;
					}
					note(decision.reason ?? decision.verdict);
					continue;
				}
				if (admitted.length >= maxFragments) {
					omittedBudget += 1;
					note(
						`the request evidence budget of ${maxFragments} fragments was already spent`,
					);
					continue;
				}
				admitted.push(decision.fragment);
			}
		}
	}
	const addedChars = admitted.reduce(
		(total, fragment) => total + renderBoundedEvidenceFragment(fragment).length,
		0,
	);
	return {
		admitted,
		admittedCount: admitted.length,
		omittedConfidentiality,
		omittedBudget,
		omittedUnrecognizedShape,
		addedChars,
		omissionReasons: [...reasonCounts.entries()]
			.map(([reason, count]) => ({ reason, count }))
			.sort((left, right) => right.count - left.count),
	};
}

/**
 * The minimal message shape the projection needs.
 *
 * It is declared LOCALLY so that this module does not widen the production
 * message contract, and so that a synthetic fixture can be projected without
 * constructing a full production message.
 */
export interface MessageWithMetadataLike {
	readonly role: string;
	readonly content?: unknown;
}

/**
 * The SCORE a fragment receives for being SELECTIVE.
 *
 * ============================================================================
 * WHY SELECTIVITY IS NECESSARY (THE ACT'S KEY MEASURED FINDING)
 * ============================================================================
 *
 * On the real W1 workload the boundary prefix contains 123 structured
 * payloads. A FIRST-COME-FIRST-SERVED budget of 24 fragments therefore
 * reaches only the FIRST ~24 payloads — roughly the first tenth of the
 * investigation — and the evidence that establishes the decisive
 * propositions (which sits at canonical message indexes 65, 67, 187 and 189)
 * is NEVER reached.
 *
 * The measurement is unambiguous: the "47" count at canonical index 7 WAS
 * admitted (it is fragment #6) and the summarizer DID use the admitted
 * evidence, but the deep evidence was never offered at all.
 *
 * So the budget cannot be spent in transcript order. It must be spent in
 * RELEVANCE order.
 *
 * ============================================================================
 * THE SELECTIVITY SCORE
 * ============================================================================
 *
 * A fragment's selectivity is measured on the OBSERVED BODY itself, by the
 * properties that make an observation worth carrying:
 *
 *   - it reports a CONCRETE, CHECKABLE value (a count, a timeout, a
 *     version, a status), and
 *   - it is SHORT enough to be a measurement rather than a dump.
 *
 * The score is deliberately SHAPE-BASED and workload-agnostic. It does not
 * name a workload-specific value, and it does not use a model. It is a
 * heuristic over the observed text, and the ACT records that it is one.
 */
export function selectivityScore(excerpt: string): number {
	const trimmed = excerpt.trim();
	if (trimmed.length === 0) {
		return 0;
	}
	let score = 0;
	// A concrete NUMBER is the strongest single signal that an observation
	// carries a checkable value.
	const numericMatches = trimmed.match(/\b\d+(?:\.\d+)?\b/g);
	if (numericMatches) {
		score += Math.min(5, numericMatches.length);
	}
	// A STATUS or a QUALIFICATION word marks an observation that carries a
	// distinction rather than a bare value.
	if (
		/\b(fail|failed|error|timeout|exceeded|missing|absent|denied|rejected)\b/i.test(
			trimmed,
		)
	) {
		score += 3;
	}
	// A NAMED CONSTANT that carries a value is the highest-signal
	// observation class: it is a DEFAULT, a LIMIT or a THRESHOLD, and it is
	// exactly the shape of knowledge the omission policy was destroying.
	//
	// The measurement on the real W1 workload is decisive: the timeout
	// constants (`DEFAULT_CONNECT_TIMEOUT_MILLIS = 500`) are worth more to
	// the investigation than any prose, and without this term they rank
	// 83rd out of 122 admissible fragments — far outside any sane budget.
	if (/\b[A-Z][A-Z0-9_]{3,}\b\s*=\s*\d/.test(trimmed)) {
		score += 6;
	}
	// A measurement is usually SHORT. A long body is usually a dump, and a
	// dump is what the omission policy was protecting against.
	if (trimmed.length <= 200) {
		score += 2;
	} else if (trimmed.length <= 800) {
		score += 1;
	}
	return score;
}

/**
 * The LINE-WINDOW SELECTION.
 *
 * ============================================================================
 * THE MEASURED PROBLEM
 * ============================================================================
 *
 * The decisive timeout constants (O7) live at LINE 52-53 of a 2 527-character
 * file read. A first-N-lines excerpt cuts them away, and the observed body
 * then carries none of the value it was admitted for.
 *
 * The same is true of the test counts: they live at the END of a long
 * `git ls-files` output, not at the beginning.
 *
 * ============================================================================
 * THE RULE
 * ============================================================================
 *
 * When a body exceeds the line budget, the KEPT LINES are the ones that
 * carry a CONCRETE, CHECKABLE observation — a numeric assignment, a status
 * word, or a named constant — rather than the first N lines.
 *
 * The selection is deterministic (the lines are ranked by a total order and
 * then re-sorted into their ORIGINAL order, so the excerpt still reads as a
 * contiguous fragment of the source), and it is applied to the REDACTED
 * text, so a kept line can never contain a byte the sanitizer removed.
 */
export function selectInformativeLines(
	text: string,
	maxLines: number = BOUNDED_EVIDENCE_MAX_LINES,
): string[] {
	const lines = text.split("\n");
	if (lines.length <= maxLines) {
		return lines;
	}
	const scored = lines.map((line, index) => ({
		line,
		index,
		score: lineInformativeScore(line),
	}));
	// The rank is: score DESCENDING, then original index ASCENDING. The kept
	// lines are then restored to their ORIGINAL order, so the excerpt reads
	// as a fragment of the source rather than as a ranked list.
	const ordered = [...scored].sort((left, right) => {
		if (right.score !== left.score) {
			return right.score - left.score;
		}
		return left.index - right.index;
	});
	const kept = ordered
		.slice(0, maxLines)
		.sort((left, right) => left.index - right.index);
	return kept.map((entry) => entry.line);
}

/**
 * The informativeness of ONE line.
 *
 * A line is informative when it carries a VALUE that can be checked — a
 * numeric assignment, a declared constant, a status — rather than prose.
 */
export function lineInformativeScore(line: string): number {
	const trimmed = line.trim();
	if (trimmed.length === 0) {
		return 0;
	}
	let score = 0;
	// A NUMERIC ASSIGNMENT or a DECLARED CONSTANT.
	if (
		/\b\d+(?:\.\d+)?\b/.test(trimmed) &&
		/(=|:|\bstatic\b|\bfinal\b|\bconst\b|\bdefault\b)/i.test(trimmed)
	) {
		score += 5;
	}
	// A NUMBER anywhere.
	if (/\b\d+(?:\.\d+)?\b/.test(trimmed)) {
		score += 2;
	}
	// A STATUS or a QUALIFICATION word.
	if (
		/\b(fail|failed|error|timeout|exceeded|missing|absent|denied|rejected|warn)\b/i.test(
			trimmed,
		)
	) {
		score += 3;
	}
	// A SHORT line is more likely to be a measurement than a paragraph.
	if (trimmed.length <= 120) {
		score += 1;
	}
	return score;
}

/**
 * PROJECT ONE summarizer-input transcript, spending the budget in
 * RELEVANCE order.
 *
 * ============================================================================
 * THE DIFFERENCE FROM `projectBoundedEvidence`
 * ============================================================================
 *
 * `projectBoundedEvidence()` spends the budget in TRANSCRIPT ORDER: the
 * earliest payloads win. The measurement on the real W1 workload shows that
 * this cannot reach the decisive evidence — 123 payloads exist in the
 * boundary prefix, and the evidence that establishes the decisive
 * propositions sits far beyond the first 24.
 *
 * This projection scores every admitted fragment by its SELECTIVITY and
 * spends the budget on the HIGHEST-scoring fragments. The transcript order
 * is preserved as the TIE-BREAK, so the selection is deterministic and a
 * fragment's position never changes the result except through its score.
 *
 * The confidentiality rules are UNCHANGED: a fragment that the admission
 * rule refuses is refused here too. Only the ORDER in which the budget is
 * spent changes.
 */
export function projectBoundedEvidenceByRelevance(input: {
	readonly messages: readonly MessageWithMetadataLike[];
	readonly maxFragments?: number;
}): EvidenceProjectionReport & {
	readonly scoredFragments: readonly {
		readonly fragment: BoundedEvidenceFragment;
		readonly score: number;
		readonly transcriptIndex: number;
	}[];
} {
	const maxFragments = input.maxFragments ?? BOUNDED_EVIDENCE_MAX_FRAGMENTS;
	const scored: {
		fragment: BoundedEvidenceFragment;
		score: number;
		transcriptIndex: number;
	}[] = [];
	const reasonCounts = new Map<string, number>();
	let omittedConfidentiality = 0;
	let omittedUnrecognizedShape = 0;
	let transcriptIndex = 0;
	const note = (reason: string): void => {
		reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
	};
	for (const message of input.messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type !== "tool_result") {
				continue;
			}
			const content = (block as { content?: unknown }).content;
			if (!Array.isArray(content)) {
				continue;
			}
			for (const [index, entry] of content.entries()) {
				const decision = admitEvidenceFragment({
					payload: entry as Record<string, unknown>,
					index,
					toolName: (block as { name?: string }).name,
				});
				if (decision.fragment === undefined) {
					if (decision.verdict === "OMITTED_UNRECOGNIZED_SHAPE") {
						omittedUnrecognizedShape += 1;
					} else {
						omittedConfidentiality += 1;
					}
					note(decision.reason ?? decision.verdict);
					continue;
				}
				scored.push({
					fragment: decision.fragment,
					score: selectivityScore(decision.fragment.excerpt),
					transcriptIndex: transcriptIndex++,
				});
			}
		}
	}
	// The ORDER is: score DESCENDING, then transcript index ASCENDING. It is
	// a total order, so the selection is deterministic.
	const ordered = [...scored].sort((left, right) => {
		if (right.score !== left.score) {
			return right.score - left.score;
		}
		return left.transcriptIndex - right.transcriptIndex;
	});
	const admitted = ordered
		.slice(0, maxFragments)
		.map((entry) => entry.fragment);
	const omittedBudget = ordered.length - admitted.length;
	if (omittedBudget > 0) {
		note(
			`the request evidence budget of ${maxFragments} fragments was already spent`,
		);
	}
	const addedChars = admitted.reduce(
		(total, fragment) => total + renderBoundedEvidenceFragment(fragment).length,
		0,
	);
	return {
		admitted,
		admittedCount: admitted.length,
		omittedConfidentiality,
		omittedBudget,
		omittedUnrecognizedShape,
		addedChars,
		omissionReasons: [...reasonCounts.entries()]
			.map(([reason, count]) => ({ reason, count }))
			.sort((left, right) => right.count - left.count),
		scoredFragments: ordered,
	};
}
