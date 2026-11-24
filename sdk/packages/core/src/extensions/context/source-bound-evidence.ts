/**
 * ACT-CLINEMM-COMPACTION-FACTUAL-PRESERVATION-REPAIR-01
 *
 * C5 — THE SOURCE-BOUND EVIDENCE CARRY-FORWARD.
 *
 * ============================================================================
 * WHAT THIS IS
 * ============================================================================
 *
 * The HYBRID extractive/abstractive compaction: the ordinary summary keeps
 * the narrative (goals, progress, hypotheses, next steps), and a DETERMINISTIC
 * section carries a bounded set of APPROVED, SOURCE-BOUND evidence fragments
 * alongside it — verbatim, without the model regenerating their contents.
 *
 * This is the mechanism the reviewer called the fourth architecture:
 *
 *   | Architecture                             | Outcome                              |
 *   | ---------------------------------------- | ------------------------------------ |
 *   | Closed PCK vocabulary                    | Safe but insufficiently expressive   |
 *   | Ordinary summarization                   | Important evidence omitted           |
 *   | Evidence-enhanced ordinary summarization | Better coverage, factual substitutions|
 *   | Direct original-evidence restoration     | Correct behavioural answers          |
 *
 * This module is the FOURTH row, promoted into the production seam.
 *
 * ============================================================================
 * WHY IT IS NOT "EVIDENCE-ENHANCED SUMMARIZATION"
 * ============================================================================
 *
 * Because the model NEVER WRITES THE EVIDENCE BYTES.
 *
 * `EVIDENCE_ENHANCED_SUMMARIZATION` puts the evidence in the summarizer's
 * input and asks the model to compress it. The model then rewrites the
 * observation, and the rewrite can substitute a value from a neighbouring
 * subsystem — which is exactly what the predecessor measured:
 *
 *   > "`NotificationServiceClient` defaults `500 ms` / `1500 ms`"
 *
 * when the observed socket timeout was 1000 ms.
 *
 * Here, the evidence section is assembled by the RUNTIME from the canonical
 * history at the compaction boundary. The summarizer never sees the evidence
 * at all, so it cannot rewrite it.
 *
 * ============================================================================
 * WHY IT REUSES THE EXISTING CARRY-FORWARD MECHANISM
 * ============================================================================
 *
 * The production already owns a deterministic, idempotent, boundary-stable
 * carry-forward: `applyVerifiedEvidenceToCompactedMessages()` derives the
 * verified-outcome and source-file-fact sections from the CANONICAL history
 * AT THE BOUNDARY and appends them to the existing summary message.
 *
 * This module adds a THIRD section to that same mechanism. It does not add a
 * message, a store, a database, a retrieval service or a protocol.
 *
 * ============================================================================
 * THE ADMISSION CONTRACT
 * ============================================================================
 *
 * A fragment reaches a destination only if it passes ALL of:
 *
 *   1. It originates from the FROZEN CANONICAL SOURCE PREFIX.
 *   2. Its source is NOT a known credential-bearing location.
 *   3. Its body is BOUNDED before it is redacted, so the sanitizer never
 *      sees an unbounded input.
 *   4. Its body is REDACTED with the existing value-position sanitizer.
 *   5. It is BOUNDED per fragment and per request.
 *   6. It is framed as DATA — an observation, not an instruction — and its
 *      delimiters are escaped so it cannot forge a section boundary.
 *
 * Admission is INDEPENDENT for each destination. Authorisation for one
 * destination does not authorise another.
 */

import type { MessageWithMetadata } from "@cline/shared";
import {
	admitEvidenceFragment,
	type BoundedEvidenceFragment,
	type EvidenceFragmentKind,
} from "./bounded-evidence-contract/contract";

/**
 * The HEADING of the source-bound evidence section.
 */
export const SOURCE_BOUND_EVIDENCE_SECTION_HEADING =
	"## Source-bound evidence (canonical excerpts, verbatim)";

/**
 * The BEGIN marker of the section.
 *
 * A carried excerpt can never open or close the generated section, and
 * therefore can never forge a new authority.
 */
const SOURCE_BOUND_EVIDENCE_BEGIN_MARKER =
	"<!-- cline-source-evidence:begin -->";

/**
 * The END marker of the section.
 */
const SOURCE_BOUND_EVIDENCE_END_MARKER = "<!-- cline-source-evidence:end -->";

/**
 * The maximum number of fragments carried into ONE summary.
 *
 * It is a FIXED cost, independent of the transcript size, so the compacted
 * context never grows with the session.
 */
export const MAX_CARRIED_SOURCE_BOUND_EVIDENCE = 12;

/**
 * The maximum number of characters carried by ONE fragment.
 *
 * It matches the existing excerpt bound so the two admission routes have the
 * same per-item cost.
 */
export const MAX_CARRIED_SOURCE_BOUND_EVIDENCE_CHARS = 2_000;

/**
 * ACT-CLINEMM-COMPACTION-FACTUAL-PRESERVATION-REPAIR-01
 *
 * Whether the source-bound evidence carry-forward is ENABLED.
 *
 * It is OFF by default, exactly like the existing source-file-fact
 * carry-forward (`SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED`). The new behaviour
 * must not change the production request until the exact-head installed-live
 * qualification has passed.
 *
 * The switch is at the ADMISSION boundary — `admitEvidenceFragment()` — so
 * it governs EVERY consumer at once. There is no path by which an excerpt is
 * carried while the switch is off.
 */
export const SOURCE_BOUND_EVIDENCE_CARRY_FORWARD_ENABLED = false;

/**
 * The RESOLVED state of the source-bound evidence carry-forward.
 *
 * The override exists so that the CAPABILITY can be exercised by a test
 * (and, later, by an explicit opt-in configuration) without changing the
 * default that production uses.
 *
 * The override is read through a function rather than captured at module
 * load, so a test can set it for the duration of one case and restore it.
 */
let sourceBoundEvidenceCarryForwardOverride: boolean | undefined;

/**
 * Whether the source-bound evidence carry-forward is currently enabled.
 */
export function isSourceBoundEvidenceCarryForwardEnabled(): boolean {
	return (
		sourceBoundEvidenceCarryForwardOverride ??
		SOURCE_BOUND_EVIDENCE_CARRY_FORWARD_ENABLED
	);
}

/**
 * Override the source-bound evidence carry-forward for the duration of a
 * test.
 *
 * The returned function RESTORES the previous state, so a test can never
 * leak the override into another case. Production never calls this.
 */
export function setSourceBoundEvidenceCarryForwardForTesting(
	enabled: boolean | undefined,
): () => void {
	const previous = sourceBoundEvidenceCarryForwardOverride;
	sourceBoundEvidenceCarryForwardOverride = enabled;
	return () => {
		sourceBoundEvidenceCarryForwardOverride = previous;
	};
}

/**
 * ONE admitted, source-bound evidence fragment.
 *
 * The fragment carries its OWN attribution: where the observation was made,
 * what the runtime recorded about it, and what KIND of observation it is.
 * The subject-value relationship is preserved because the excerpt is the
 * ORIGINAL text, not a description of it.
 */
export interface SourceBoundEvidence {
	/** Where the observation was made. */
	readonly source: string;
	/** The runtime-recorded status of the observation. */
	readonly status: string;
	/** The class of the observation. */
	readonly kind: EvidenceFragmentKind;
	/** The ORIGINAL, bounded, redacted excerpt. */
	readonly excerpt: string;
	/**
	 * The canonical message index the observation came from.
	 *
	 * It records PROVENANCE: the reader can tell which observation is older.
	 */
	readonly canonicalIndex: number;
}

/**
 * Escape the section's own delimiters inside a carried excerpt.
 *
 * Without this, an excerpt containing the END marker could close the section
 * early and append text of its own choosing in its place.
 */
function escapeSectionDelimiters(text: string): string {
	return text
		.split(SOURCE_BOUND_EVIDENCE_BEGIN_MARKER)
		.join(`\\${SOURCE_BOUND_EVIDENCE_BEGIN_MARKER}`)
		.split(SOURCE_BOUND_EVIDENCE_END_MARKER)
		.join(`\\${SOURCE_BOUND_EVIDENCE_END_MARKER}`);
}

/**
 * Render ONE fragment as a single carried line.
 *
 * The line names the source, the status and the kind BEFORE the excerpt, so
 * that a reader (or a model) cannot mistake a default for an effective value,
 * or a configuration for a measurement.
 */
function renderFragment(fragment: SourceBoundEvidence): string {
	const source = escapeSectionDelimiters(fragment.source);
	const excerpt = escapeSectionDelimiters(fragment.excerpt);
	return `- [${fragment.kind}] ${source} (${fragment.status}): ${excerpt}`;
}

/**
 * Render the deterministic carry-forward section.
 *
 * Returns `undefined` when there is nothing to carry, so a summary without
 * approved evidence is never rewritten.
 */
export function renderSourceBoundEvidenceSection(
	fragments: readonly SourceBoundEvidence[],
): string | undefined {
	if (fragments.length === 0) {
		return undefined;
	}
	return [
		SOURCE_BOUND_EVIDENCE_SECTION_HEADING,
		SOURCE_BOUND_EVIDENCE_BEGIN_MARKER,
		...fragments.map(renderFragment),
		SOURCE_BOUND_EVIDENCE_END_MARKER,
	].join("\n");
}

/**
 * Remove any previously carried source-bound evidence section from a summary
 * text.
 *
 * The carry-forward is therefore IDEMPOTENT: a later compaction replaces the
 * section rather than appending a second copy.
 */
export function stripSourceBoundEvidenceSection(summaryText: string): string {
	const begin = summaryText.indexOf(SOURCE_BOUND_EVIDENCE_BEGIN_MARKER);
	if (begin === -1) {
		return summaryText;
	}
	const end = summaryText.indexOf(SOURCE_BOUND_EVIDENCE_END_MARKER, begin);
	const headingIndex = summaryText.lastIndexOf(
		SOURCE_BOUND_EVIDENCE_SECTION_HEADING,
		begin,
	);
	const sectionStart =
		headingIndex !== -1 &&
		summaryText
			.slice(headingIndex + SOURCE_BOUND_EVIDENCE_SECTION_HEADING.length, begin)
			.trim() === ""
			? headingIndex
			: begin;
	if (end === -1) {
		// A malformed (truncated) section is removed to its end so a partial
		// record can never be presented as a complete one.
		return summaryText.slice(0, sectionStart).trimEnd();
	}
	const before = summaryText.slice(0, sectionStart).trimEnd();
	const after = summaryText
		.slice(end + SOURCE_BOUND_EVIDENCE_END_MARKER.length)
		.trimStart();
	if (!before) {
		return after;
	}
	if (!after) {
		return before;
	}
	return `${before}\n\n${after}`;
}

/**
 * Apply the source-bound evidence carry-forward to a summary text.
 *
 * It is a PURE function of the summary text and the fragments. The previous
 * section is stripped first, so repeated applications converge.
 */
export function applySourceBoundEvidenceToSummary(
	summaryText: string,
	fragments: readonly SourceBoundEvidence[],
): string {
	const section = renderSourceBoundEvidenceSection(fragments);
	const stripped = stripSourceBoundEvidenceSection(summaryText).trimEnd();
	if (!section) {
		return stripped;
	}
	if (!stripped) {
		return section;
	}
	return `${stripped}\n\n${section}`;
}

/**
 * The REPORT of one extraction.
 *
 * It records what was admitted, what was refused and WHY, so that a caller
 * can REPORT which evidence was omitted because of budget or confidentiality
 * restrictions rather than silently dropping it.
 */
export interface SourceBoundEvidenceReport {
	/** The admitted fragments, in canonical order. */
	readonly admitted: readonly SourceBoundEvidence[];
	/** The count of admitted fragments. */
	readonly admittedCount: number;
	/** The count of fragments refused for CONFIDENTIALITY reasons. */
	readonly omittedConfidentiality: number;
	/** The count of fragments refused because the REQUEST budget was spent. */
	readonly omittedBudget: number;
	/** The characters the admitted fragments add to the summary. */
	readonly addedChars: number;
}

/**
 * The SELECTIVITY of a fragment.
 *
 * A fragment that names a concrete, checkable observation is more valuable
 * than one that repeats boilerplate, so the budget is spent on the former.
 * The score is deliberately SHAPE-BASED: it does not branch on a provider, a
 * tool name or a command string.
 *
 * ============================================================================
 * WHAT THE SCORE REWARDS
 * ============================================================================
 *
 * The decisive evidence in this domain is a DECLARED CONSTANT WITH ITS
 * VALUE:
 *
 *     static final int DEFAULT_SOCKET_TIMEOUT_MILLIS = 1000;
 *
 * A fragment that carries several such declarations is decisive; one that
 * carries prose is not. The score therefore rewards:
 *
 *   - a DECLARED CONSTANT with a value (the strongest signal);
 *   - a concrete number;
 *   - an identifier that names a subject;
 *   - a path-like token;
 *   - a negative observation.
 *
 * It penalises boilerplate. It deliberately does NOT reward a long excerpt:
 * the predecessor's lesson was that "more input" is not "more knowledge".
 */
function selectivityScore(excerpt: string): number {
	const nonEmptyLines = excerpt
		.split("\n")
		.filter((line) => line.trim().length > 0);
	let score = 0;
	// A DECLARED CONSTANT WITH ITS VALUE. This is the decisive form: the
	// subject and the value are in ONE token, so the relationship cannot be
	// lost by a later rewrite.
	const declarations = excerpt.match(
		/\b[A-Za-z_][A-Za-z0-9_]*\s*(?:=|:)\s*"?-?\d+(?:\.\d+)?/g,
	);
	const declarationCount = declarations?.length ?? 0;
	score += Math.min(declarationCount, 8) * 12;
	// The DENSITY of declarations. A file excerpt that is mostly constants
	// is decisive; an excerpt that mentions one constant in a page of prose
	// is not. The density is what separates them, because the LENGTH does
	// not: a long source excerpt is usually the most informative one.
	if (nonEmptyLines.length > 0) {
		score += Math.round((declarationCount / nonEmptyLines.length) * 40);
	}
	// An identifier that names a subject.
	if (/\b[A-Z][a-z]+[A-Z]\w{2,}\b/.test(excerpt)) {
		score += 5;
	}
	// A path-like token identifies the subject of the observation.
	if (/[\\/][\w.-]+/.test(excerpt)) {
		score += 4;
	}
	// A negative observation is knowledge too.
	if (/\b(fail(?:ed|ure)?|error|exception|denied|refused)\b/i.test(excerpt)) {
		score += 3;
	}
	// Boilerplate is worth less.
	if (/\b(usage|help|welcome|deprecated)\b/i.test(excerpt)) {
		score -= 8;
	}
	return score;
}

/**
 * Collect the structured payloads of ONE tool result.
 *
 * The collection is deliberately LOOSE about the entry shape: a payload is
 * anything that is a plain object. The admission contract owns the
 * shape rule; this function only finds the candidates.
 *
 * It mirrors the existing `extractSourceFileFactsFromContent()` pattern, so
 * the two admission routes agree on what a payload is.
 */
function collectStructuredPayloads(
	content: unknown,
): Record<string, unknown>[] {
	if (!Array.isArray(content)) {
		return [];
	}
	return content.filter(
		(payload): payload is Record<string, unknown> =>
			payload !== null &&
			typeof payload === "object" &&
			!Array.isArray(payload),
	);
}

/**
 * Extract the APPROVED, SOURCE-BOUND evidence from the CANONICAL history at
 * the compaction boundary.
 *
 * The extraction is a pure function of the canonical prefix. It is therefore
 * STABLE across every continuation: appending messages to the session does
 * not change the carried section, and a re-compaction replaces the section
 * with the same one rather than accumulating copies.
 *
 * The ADMISSION is delegated to the bounded-evidence contract, which owns the
 * shape rule, the sensitive-path rule, the bound-then-redact order and the
 * runtime-metadata neutralisation.
 */
export function extractSourceBoundEvidence(input: {
	readonly canonicalMessages: readonly MessageWithMetadata[];
	readonly maxFragments?: number;
}): SourceBoundEvidenceReport {
	if (!isSourceBoundEvidenceCarryForwardEnabled()) {
		// The carry-forward is OFF by default. Returning here is what makes the
		// containment complete: the extraction is the ONLY route to a carried
		// excerpt, so no consumer can carry one while the switch is off.
		return {
			admitted: [],
			admittedCount: 0,
			omittedConfidentiality: 0,
			omittedBudget: 0,
			addedChars: 0,
		};
	}
	const maxFragments = input.maxFragments ?? MAX_CARRIED_SOURCE_BOUND_EVIDENCE;
	const candidates: SourceBoundEvidence[] = [];
	let omittedConfidentiality = 0;
	let omittedBudget = 0;
	let addedChars = 0;
	for (let index = 0; index < input.canonicalMessages.length; index += 1) {
		const message = input.canonicalMessages[index];
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type !== "tool_result") {
				continue;
			}
			const payloads = collectStructuredPayloads(block.content);
			for (const payload of payloads) {
				const admission = admitEvidenceFragment({
					payload,
					index,
					toolName:
						typeof (block as { name?: unknown }).name === "string"
							? ((block as { name?: string }).name as string)
							: undefined,
				});
				if (
					admission.verdict === "OMITTED_CONFIDENTIALITY" ||
					admission.verdict === "OMITTED_UNRECOGNIZED_SHAPE"
				) {
					omittedConfidentiality += 1;
					continue;
				}
				const fragment = admission.fragment;
				if (!fragment) {
					continue;
				}
				const bounded =
					fragment.excerpt.length > MAX_CARRIED_SOURCE_BOUND_EVIDENCE_CHARS
						? `${fragment.excerpt.slice(0, MAX_CARRIED_SOURCE_BOUND_EVIDENCE_CHARS)}\n...[excerpt truncated]`
						: fragment.excerpt;
				candidates.push({
					source: fragment.source,
					status: fragment.status,
					kind: fragment.kind,
					excerpt: bounded,
					canonicalIndex: index,
				});
			}
		}
	}
	// The budget is spent on the MOST SELECTIVE evidence, so a decisive
	// observation late in the session is not crowded out by boilerplate.
	//
	// The ORDER of these two steps is load-bearing: the SELECTION must
	// happen BEFORE the budget is applied. Applying the budget first would
	// admit the EARLIEST fragments and report the rest as budget omissions,
	// which is the defect the predecessor ACT found.
	candidates.sort((left, right) => {
		const delta =
			selectivityScore(right.excerpt) - selectivityScore(left.excerpt);
		return delta !== 0 ? delta : left.canonicalIndex - right.canonicalIndex;
	});
	const admitted = candidates.slice(0, maxFragments);
	omittedBudget = candidates.length - admitted.length;
	for (const fragment of admitted) {
		addedChars += fragment.excerpt.length + fragment.source.length;
	}
	return {
		admitted,
		admittedCount: admitted.length,
		omittedConfidentiality,
		omittedBudget,
		addedChars,
	};
}

/**
 * The result of applying the source-bound evidence carry-forward.
 */
export interface SourceBoundEvidenceApplicationResult {
	/** The message list to use (carried when applied, original otherwise). */
	readonly messages: MessageWithMetadata[];
	/** Whether the carry-forward was actually applied. */
	readonly applied: boolean;
	/** The number of fragments carried. */
	readonly carriedFragmentCount: number;
	/** The characters the carried section added. */
	readonly addedChars: number;
	/** The number of fragments refused for confidentiality reasons. */
	readonly omittedConfidentiality: number;
	/** The number of fragments refused because the budget was spent. */
	readonly omittedBudget: number;
}

/**
 * The provider-visible text of a summary message: `buildSummaryMessage()`
 * renders `Context summary:\n\n<summary>`.
 */
function readSummaryTextFromContent(
	message: MessageWithMetadata,
): string | undefined {
	if (typeof message.content === "string") {
		return message.content;
	}
	if (!Array.isArray(message.content)) {
		return undefined;
	}
	const text = message.content
		.filter(
			(block): block is { type: "text"; text: string } =>
				block.type === "text" && typeof block.text === "string",
		)
		.map((block) => block.text)
		.join("\n");
	if (!text) {
		return undefined;
	}
	const prefix = "Context summary:\n\n";
	return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

/**
 * Rebuild a summary message with a new summary text, keeping every other
 * metadata field and the message envelope unchanged.
 */
function rebuildSummaryMessage(
	message: MessageWithMetadata,
	summary: string,
): MessageWithMetadata {
	const metadata = message.metadata
		? { ...message.metadata, summary }
		: { summary };
	return {
		...message,
		content: [{ type: "text", text: `Context summary:\n\n${summary}` }],
		metadata,
	};
}

/**
 * Apply the SOURCE-BOUND EVIDENCE carry-forward to a compacted message list.
 *
 * The fragments are attached to the EXISTING `compaction_summary` message —
 * the message `buildSummaryMessage()` already produced. No second summary
 * message is created, no provider tool call is added, and every other
 * projected message is preserved unchanged.
 *
 * The carry-forward is a pure function of the CANONICAL history AT THE
 * BOUNDARY. A previous summary is never an authority source: a summary that
 * already carries a section has it STRIPPED and replaced, so repeated
 * compactions converge on the canonical record instead of accumulating copies.
 */
export function applySourceBoundEvidenceToCompactedMessages(
	compactedMessages: readonly MessageWithMetadata[],
	canonicalMessages: readonly MessageWithMetadata[],
	options: {
		/**
		 * The number of canonical messages that belonged to the compacted
		 * prefix — the persisted sidecar's `source_message_count`.
		 *
		 * It is an INDEX into the CANONICAL message collection (the
		 * display-only messages excluded), which is the same collection the
		 * persisted boundary was counted over.
		 */
		readonly sourceMessageCount?: number;
		/**
		 * The maximum number of fragments to carry.
		 *
		 * It defaults to the module's own budget. A caller may lower it for
		 * a specific destination, because admission is INDEPENDENT per
		 * destination.
		 */
		readonly maxFragments?: number;
	} = {},
): SourceBoundEvidenceApplicationResult {
	const canonical = canonicalMessages.filter(
		(message) => message.metadata?.displayOnly !== true,
	);
	const boundaryCount = Math.max(
		0,
		Math.min(options.sourceMessageCount ?? canonical.length, canonical.length),
	);
	const boundaryPrefix = canonical.slice(0, boundaryCount);
	const report = extractSourceBoundEvidence({
		canonicalMessages: boundaryPrefix,
		maxFragments: options.maxFragments,
	});
	const summaryIndex = compactedMessages.findIndex(
		(message) =>
			(message.metadata as { kind?: string } | undefined)?.kind ===
			"compaction_summary",
	);
	if (summaryIndex === -1 || report.admitted.length === 0) {
		return {
			messages: [...compactedMessages],
			applied: false,
			carriedFragmentCount: report.admittedCount,
			addedChars: 0,
			omittedConfidentiality: report.omittedConfidentiality,
			omittedBudget: report.omittedBudget,
		};
	}
	const summaryMessage = compactedMessages[summaryIndex];
	const currentSummary =
		(summaryMessage.metadata as { summary?: string } | undefined)?.summary ??
		readSummaryTextFromContent(summaryMessage);
	if (typeof currentSummary !== "string") {
		return {
			messages: [...compactedMessages],
			applied: false,
			carriedFragmentCount: report.admittedCount,
			addedChars: 0,
			omittedConfidentiality: report.omittedConfidentiality,
			omittedBudget: report.omittedBudget,
		};
	}
	const nextSummary = applySourceBoundEvidenceToSummary(
		currentSummary,
		report.admitted,
	);
	if (nextSummary === currentSummary) {
		return {
			messages: [...compactedMessages],
			applied: false,
			carriedFragmentCount: report.admittedCount,
			addedChars: 0,
			omittedConfidentiality: report.omittedConfidentiality,
			omittedBudget: report.omittedBudget,
		};
	}
	const messages = [...compactedMessages];
	messages[summaryIndex] = rebuildSummaryMessage(summaryMessage, nextSummary);
	return {
		messages,
		applied: true,
		carriedFragmentCount: report.admittedCount,
		addedChars: report.addedChars,
		omittedConfidentiality: report.omittedConfidentiality,
		omittedBudget: report.omittedBudget,
	};
}
