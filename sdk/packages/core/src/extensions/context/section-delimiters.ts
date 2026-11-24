/**
 * ACT-CLINEMM-COMPACTION-TASK-CONDITIONED-EVIDENCE-SELECTION-01
 *
 * C2.1 — THE SHARED SECTION-DELIMITER ENCODING PRIMITIVE.
 *
 * ============================================================================
 * WHAT THIS IS
 * ============================================================================
 *
 * A carried section is delimited by a pair of MARKERS. The text the section
 * carries is UNTRUSTED: it is tool output, file content, or a command's
 * stdout. If that text contains a marker, it can close the section early and
 * append text of its own choosing in the section's place — FORGED AUTHORITY.
 *
 * Therefore the markers must be ESCAPED inside the carried text, and the
 * PARSER must recognise the escape. Both halves are load-bearing:
 *
 *   - the WRITER escapes a marker occurrence;
 *   - the READER does not treat an escaped marker as a delimiter.
 *
 * ============================================================================
 * THE DEFECT THIS REPLACES
 * ============================================================================
 *
 * The predecessor ACT escaped a marker with a BACKSLASH PREFIX:
 *
 *     text.split(MARKER).join(`\\${MARKER}`)
 *
 * and then located the section with a PLAIN `indexOf(MARKER)`.
 *
 * That escape convention is one the parser did NOT recognise, because the
 * escaped marker still CONTAINS the literal marker. `indexOf` finds the
 * marker INSIDE it. The strip therefore terminated the section at the
 * escaped marker — inside a carried fragment — instead of at the real end of
 * the section. Everything after the escaped marker survived the strip, and
 * the carry-forward was not idempotent.
 *
 * The defect was reproduced by the reviewer as:
 *
 *     stripRestoresBase=false
 *     canarySurvivesStrip=true
 *     idempotent=false
 *
 * ============================================================================
 * THE ENCODING
 * ============================================================================
 *
 * The escaped marker is emitted as ESCAPE_PREFIX + marker, where the prefix
 * is a ZERO-WIDTH SPACE (U+200B).
 *
 * Two properties make this correct:
 *
 *   1. The READER recognises the convention. `findUnescapedMarker()` skips an
 *      occurrence that is immediately preceded by the prefix, so an escaped
 *      marker is NEVER a delimiter.
 *
 *   2. The prefix is INVISIBLE and INERT. It carries no information, it does
 *      not alter the marker a reader sees, and it cannot turn a genuine
 *      delimiter into an escaped one — because a genuine delimiter is
 *      written by the runtime and is never preceded by the prefix.
 *
 * The reader must ALSO be robust to the LEGACY backslash convention, because
 * a section written by the predecessor build is still in persisted state. A
 * legacy-escaped marker must be treated as escaped too, not as a delimiter.
 *
 * ============================================================================
 * WHY THIS IS A SHARED PRIMITIVE
 * ============================================================================
 *
 * Three carried sections use the same pattern and shared the same defect:
 *
 *   - the verified-outcome section (`cline-evidence`);
 *   - the source-file-fact section (`cline-file-facts`);
 *   - the source-bound evidence section (`cline-source-evidence`).
 *
 * They therefore share ONE encoder and ONE reader here, so the three cannot
 * drift apart again.
 */

/**
 * The ESCAPE PREFIX.
 *
 * It is a ZERO-WIDTH SPACE (U+200B): invisible in rendered text, inert in
 * every text pipeline the runtime uses, and — decisively — it is the marker
 * the reader looks for when it decides whether an occurrence is escaped.
 */
export const SECTION_DELIMITER_ESCAPE_PREFIX = "\u200b";

/**
 * The LEGACY escape prefix.
 *
 * The predecessor's convention. A section written by that build is still in
 * persisted state, so the reader must treat a legacy-escaped marker as
 * escaped rather than as a delimiter.
 */
const LEGACY_SECTION_DELIMITER_ESCAPE_PREFIX = "\\";

/**
 * Escape every occurrence of the given markers inside UNTRUSTED text.
 *
 * The text is escaped with the CURRENT convention. The caller must then
 * render it inside a section and strip that section with
 * `stripDelimitedSection()`, which recognises the escape.
 */
export function escapeSectionDelimiters(
	text: string,
	markers: readonly string[],
): string {
	let escaped = text;
	for (const marker of markers) {
		if (!marker) {
			continue;
		}
		escaped = escaped
			.split(marker)
			.join(`${SECTION_DELIMITER_ESCAPE_PREFIX}${marker}`);
	}
	return escaped;
}

/**
 * Whether the marker occurrence at `index` is ESCAPED.
 *
 * An occurrence is escaped when it is immediately preceded by the current
 * escape prefix or by the legacy escape prefix.
 */
function isEscapedOccurrence(text: string, index: number): boolean {
	const previous = text[index - 1];
	return (
		previous === SECTION_DELIMITER_ESCAPE_PREFIX ||
		previous === LEGACY_SECTION_DELIMITER_ESCAPE_PREFIX
	);
}

/**
 * Find the first UNESCAPED occurrence of `marker` in `text`, at or after
 * `fromIndex`.
 *
 * Returns `-1` when there is none. An ESCAPED occurrence is skipped, so a
 * carried fragment can never close or open a section.
 */
export function findUnescapedMarker(
	text: string,
	marker: string,
	fromIndex = 0,
): number {
	if (!marker) {
		return -1;
	}
	let index = text.indexOf(marker, Math.max(0, fromIndex));
	while (index !== -1) {
		if (!isEscapedOccurrence(text, index)) {
			return index;
		}
		index = text.indexOf(marker, index + 1);
	}
	return -1;
}

/**
 * Find the LAST unescaped occurrence of `marker` at or before `fromIndex`.
 *
 * It is the backwards counterpart of `findUnescapedMarker()`, used to locate
 * a section's heading when the heading may itself be preceded by an escaped
 * occurrence.
 */
export function findLastUnescapedMarker(
	text: string,
	marker: string,
	fromIndex: number,
): number {
	if (!marker) {
		return -1;
	}
	let index = text.lastIndexOf(marker, fromIndex);
	while (index !== -1) {
		if (!isEscapedOccurrence(text, index)) {
			return index;
		}
		index = text.lastIndexOf(marker, index - 1);
	}
	return -1;
}

/**
 * The result of removing a delimited section.
 */
export interface StrippedSection {
	/** The text BEFORE the section, trimmed at the end. */
	readonly before: string;
	/** The text AFTER the section, trimmed at the start. */
	readonly after: string;
	/** Whether a BEGIN marker was found at all. */
	readonly found: boolean;
}

/**
 * Remove ONE delimited section from `text`.
 *
 * The section runs from the BEGIN marker to the matching END marker. The
 * `heading` — when it is present and IMMEDIATELY precedes the BEGIN marker —
 * is removed together with the body, so a later carry-forward cannot leave
 * an orphaned heading behind and then produce a duplicate one.
 *
 * A TRUNCATED section (a BEGIN marker with no END marker) is removed to the
 * end of the text, so a partial record can never be presented as a complete
 * one.
 */
export function stripDelimitedSection(input: {
	readonly text: string;
	readonly beginMarker: string;
	readonly endMarker: string;
	readonly heading?: string;
}): StrippedSection {
	const { text, beginMarker, endMarker, heading } = input;
	const begin = findUnescapedMarker(text, beginMarker);
	if (begin === -1) {
		return { before: text, after: "", found: false };
	}
	const end = findUnescapedMarker(text, endMarker, begin);
	const headingIndex = heading
		? findLastUnescapedMarker(text, heading, begin)
		: -1;
	const sectionStart =
		headingIndex !== -1 &&
		heading !== undefined &&
		text.slice(headingIndex + heading.length, begin).trim() === ""
			? headingIndex
			: begin;
	if (end === -1) {
		// A malformed (truncated) section is removed to its end.
		return {
			before: text.slice(0, sectionStart).trimEnd(),
			after: "",
			found: true,
		};
	}
	return {
		before: text.slice(0, sectionStart).trimEnd(),
		after: text.slice(end + endMarker.length).trimStart(),
		found: true,
	};
}

/**
 * Remove EVERY delimited section from `text`.
 *
 * Removing only the FIRST section would leave a DUPLICATE behind, and the
 * carry-forward would then not converge: applying the same evidence twice
 * would produce a summary with two copies of the section. The removal is
 * therefore applied REPEATEDLY until no section remains.
 *
 * A TRUNCATED section (a BEGIN marker with no END marker) is removed to the
 * end of the text, so a partial record can never be presented as a complete
 * one.
 */
export function stripAllDelimitedSections(input: {
	readonly text: string;
	readonly beginMarker: string;
	readonly endMarker: string;
	readonly heading?: string;
}): StrippedSection {
	let text = input.text;
	let found = false;
	// The loop is bounded by the number of sections that can be present: each
	// pass removes at least the BEGIN marker it found, so the text strictly
	// shrinks and the loop terminates.
	for (;;) {
		const stripped = stripDelimitedSection({ ...input, text });
		if (!stripped.found) {
			break;
		}
		found = true;
		const joined = joinStrippedSection(stripped);
		if (joined === text) {
			// A defensive guard: a removal that changed nothing would loop
			// forever. It cannot happen with a well-formed section, but the
			// guard keeps the function total.
			break;
		}
		text = joined;
	}
	return { before: text, after: "", found };
}

/**
 * Join the text before and after a removed section.
 *
 * An empty side contributes nothing, so removing a section never leaves a
 * doubled blank line or a stray separator.
 */
export function joinStrippedSection(stripped: StrippedSection): string {
	if (!stripped.found) {
		return stripped.before;
	}
	if (!stripped.before) {
		return stripped.after;
	}
	if (!stripped.after) {
		return stripped.before;
	}
	return `${stripped.before}\n\n${stripped.after}`;
}
