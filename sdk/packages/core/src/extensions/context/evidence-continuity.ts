/**
 * ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-RECON01
 *
 * Verified tool-outcome continuity across Agentic compaction.
 *
 * PROBLEM
 * -------
 *
 * An Agentic compaction replaces the compacted prefix with a generated
 * summary. The generated summary is a LOSSY PROJECTION of the canonical
 * history, and it can drop a DECISIVE fact: an operation that actually
 * executed successfully.
 *
 * The reproduced instance (Round C session `1794780088950_tc1vx`):
 *
 *   - The canonical history carried a SUCCESSFUL `helm template` render
 *     (`rc=0`, resolved image, `runAsNonRoot: true`, `fsGroup: 1000`).
 *   - That evidence REACHED the summarizer's input window (the causal
 *     discriminator proved every marker present in the production
 *     serialization of the folded prefix).
 *   - The INSTALLED SUMMARY carried NONE of it, and the final report
 *     consequently claimed the render was `NOT_EXECUTED` — a statement
 *     contradicted by the canonical record.
 *
 * The violated invariant:
 *
 *   A generated summary may omit historical detail, but it must NOT become
 *   MORE AUTHORITATIVE than the canonical record of what actually executed.
 *
 * AUTHORITY
 * ---------
 *
 * The canonical session history is the ONLY authority, exactly as for the
 * active task contract (`task-contract.ts`). This module never becomes a
 * second evidence owner, never invents a new durable representation and
 * never reads a previous summary as an authority source. Every carried
 * outcome is derived from a CANONICAL tool-call/tool-result PAIR, matched
 * by its tool-call id, and classified by the result's OWN success signal.
 *
 * WHAT COUNTS AS "VERIFIED"
 * -------------------------
 *
 * A tool outcome is carried only when ALL of the following hold:
 *
 *   1. The canonical history contains the tool CALL (`tool_use` block).
 *   2. The canonical history contains the matching tool RESULT
 *      (`tool_result` block with the same `tool_use_id`).
 *   3. The result is NOT an error (`is_error` is not set).
 *   4. The result carries an explicit, POSITIVE success signal.
 *
 * Rule 4 is deliberately strict. A result with no success signal at all
 * is NOT carried: "no evidence of failure" is not "evidence of success",
 * and promoting an unclassified result would repeat the very defect this
 * module repairs (asserting an outcome the canonical record does not
 * establish). A FAILED or NOT-RUN operation is therefore NEVER carried as
 * a success — the absence of a carried entry is the truthful representation
 * of "not established".
 *
 * The positive success signals recognised are the shapes the production
 * tool executors actually emit. They are matched on the DATA SHAPE, never
 * on a provider id or a tool name, so the rule applies uniformly.
 *
 * BOUNDEDNESS
 * -----------
 *
 * The carried section is bounded on BOTH axes: at most
 * `MAX_CARRIED_OUTCOMES` outcomes, each at most
 * `MAX_CARRIED_OUTCOME_CHARS` characters of sanitized output. The
 * overhead is therefore a fixed constant, not a function of the transcript
 * size.
 *
 * CREDENTIAL SAFETY
 * -----------------
 *
 * Carried output is SANITIZED: values that look like credentials are
 * redacted before they can reach the carried section. The sanitizer is
 * deliberately conservative — it redacts on shape, never on content
 * meaning — and it runs on the SAME text the model would otherwise read
 * from the tool result, so nothing is weakened by the carry-forward.
 */

import type { MessageWithMetadata } from "@cline/shared";

/**
 * The maximum number of verified outcomes carried into one summary.
 *
 * The count is a fixed constant: the carried section's size must not grow
 * with the length of the session.
 */
export const MAX_CARRIED_OUTCOMES = 12;

/**
 * The maximum number of characters of a single outcome's sanitized output.
 */
export const MAX_CARRIED_OUTCOME_CHARS = 240;

/**
 * The section heading. A stable, greppable marker so a carried section can
 * be located and replaced deterministically on a later compaction instead
 * of accumulating copies.
 */
export const EVIDENCE_SECTION_HEADING =
	"## Verified tool outcomes (canonical record)";

const EVIDENCE_BEGIN_MARKER = "<!-- cline-evidence:begin -->";
const EVIDENCE_END_MARKER = "<!-- cline-evidence:end -->";

/** The outcome classification of a canonical tool result. */
export type VerifiedOutcomeStatus = "succeeded" | "failed" | "unknown";

/** A single tool outcome recovered from the canonical history. */
export interface VerifiedToolOutcome {
	/** The canonical tool-call id this outcome belongs to. */
	toolUseId: string;
	/** The tool name, as the canonical call declared it. */
	toolName: string;
	/** The outcome classification derived from the result itself. */
	status: VerifiedOutcomeStatus;
	/** The canonical index of the tool CALL. */
	sourceIndex: number;
	/** A sanitized, bounded excerpt of the result output. */
	excerpt: string;
}

/** The verified outcomes recovered from a canonical history. */
export interface VerifiedOutcomeLedger {
	outcomes: VerifiedToolOutcome[];
}

/**
 * The text of a tool result, flattened the way `flattenToolResultContent()`
 * flattens it for the compaction serialization.
 */
function toolResultText(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	const parts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") {
			continue;
		}
		const record = block as Record<string, unknown>;
		if (record.type === "text" && typeof record.text === "string") {
			parts.push(record.text);
			continue;
		}
		if (record.type === "file" && typeof record.content === "string") {
			parts.push(record.content);
			continue;
		}
		// Some executors persist their payload as a `{query, result, success}`
		// shape rather than a typed text block. The persisted result text is
		// the outcome output, so it is read here.
		if (typeof record.result === "string") {
			parts.push(record.result);
		}
	}
	return parts.join("\n");
}

/**
 * The explicit success/failure signal of a tool result.
 *
 * The signal is read from the RESULT ITSELF, never from the tool name and
 * never from a provider id. Three shapes are recognised:
 *
 *   1. The typed `is_error` flag on the result block.
 *   2. A persisted `success: boolean` field on the result payload.
 *   3. A persisted `isError: boolean` field on the result payload.
 *
 * Anything else is `unknown` - the outcome is NOT carried.
 */
export function classifyToolResultStatus(resultBlock: {
	is_error?: boolean;
	content: unknown;
}): VerifiedOutcomeStatus {
	if (resultBlock.is_error === true) {
		return "failed";
	}
	const payloads =
		Array.isArray(resultBlock.content) &&
		resultBlock.content.every((item) => item && typeof item === "object")
			? (resultBlock.content as Record<string, unknown>[])
			: [];
	for (const payload of payloads) {
		if (payload.success === true) {
			return "succeeded";
		}
		if (payload.success === false) {
			return "failed";
		}
		if (payload.isError === true) {
			return "failed";
		}
		if (payload.isError === false) {
			return "succeeded";
		}
	}
	return "unknown";
}

/**
 * Redact values that look like credentials.
 *
 * The sanitizer is shape-based and conservative. It never inspects whether
 * the value IS a credential - a value that matches a credential SHAPE is
 * redacted regardless, so the carried section can never become a new
 * credential-exposure surface.
 */
export function sanitizeOutcomeText(text: string): string {
	return (
		text
			// KEY=value / KEY: value assignments whose key names a secret.
			.replace(
				/\b([A-Za-z0-9_.-]*(?:password|passwd|secret|token|api[_-]?key|apikey|credential|private[_-]?key|access[_-]?key|auth[_-]?key)[A-Za-z0-9_.-]*)(\s*[:=]\s*)("?)([^\s"'`,;)}\]]+)(\3)/gi,
				"$1$2$3[REDACTED]$3",
			)
			// Bearer headers.
			.replace(
				/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
				"$1 [REDACTED]",
			)
			// PEM private key blocks.
			.replace(
				/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
				"[REDACTED PRIVATE KEY]",
			)
			// Common provider-shaped keys that are not key=value.
			.replace(
				/\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
				"[REDACTED]",
			)
	);
}

/**
 * Bound and normalize an outcome excerpt.
 *
 * The excerpt keeps the outcome's LEADING LINES, not just its first line:
 * a decisive result is routinely spread over several lines (an exit code,
 * then the resolved value, then the security context), and keeping only the
 * first line would drop exactly the facts the carry-forward exists to
 * preserve. The excerpt is bounded on BOTH axes - a line budget and a
 * character budget - so it stays a fixed-size record.
 */
function buildExcerpt(text: string): string {
	const sanitized = sanitizeOutcomeText(text)
		.replace(/\r\n/g, "\n")
		.replace(/[ \t]+/g, " ")
		.trim();
	if (!sanitized) {
		return "";
	}
	const lines = sanitized
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (lines.length === 0) {
		return "";
	}
	let excerpt = "";
	for (const line of lines) {
		const candidate = excerpt ? `${excerpt}\n${line}` : line;
		if (candidate.length > MAX_CARRIED_OUTCOME_CHARS) {
			break;
		}
		excerpt = candidate;
	}
	if (!excerpt) {
		// The first line alone is longer than the budget: keep its head so
		// the outcome still carries SOME decisive text.
		excerpt = `${lines[0].slice(0, MAX_CARRIED_OUTCOME_CHARS)}...`;
	}
	return excerpt;
}

/**
 * Recover the verified tool outcomes from the CANONICAL history.
 *
 * The canonical history MUST be the canonical history, not a compacted
 * projection: a previous summary is never an authority source, and a
 * projection may already have dropped the very outcomes being recovered.
 *
 * Outcomes are returned in canonical order (the order the calls were made),
 * and at most `MAX_CARRIED_OUTCOMES` of them are kept - the most RECENT
 * ones, because a later verification supersedes an earlier one for the
 * same subject.
 */
export function extractVerifiedToolOutcomes(
	canonicalMessages: readonly MessageWithMetadata[],
): VerifiedOutcomeLedger {
	/** The canonical tool calls, by tool-call id. */
	const callsById = new Map<
		string,
		{ toolName: string; sourceIndex: number }
	>();
	/** The canonical tool results, by tool-call id (first result wins). */
	const resultsById = new Map<
		string,
		{ status: VerifiedOutcomeStatus; text: string }
	>();

	for (let index = 0; index < canonicalMessages.length; index += 1) {
		const message = canonicalMessages[index];
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_use") {
				if (!callsById.has(block.id)) {
					callsById.set(block.id, {
						toolName: block.name,
						sourceIndex: index,
					});
				}
				continue;
			}
			if (block.type !== "tool_result") {
				continue;
			}
			if (resultsById.has(block.tool_use_id)) {
				continue;
			}
			resultsById.set(block.tool_use_id, {
				status: classifyToolResultStatus(block),
				text: toolResultText(block.content),
			});
		}
	}

	const outcomes: VerifiedToolOutcome[] = [];
	for (const [toolUseId, result] of resultsById) {
		// A result with NO matching canonical call is not a verified
		// outcome: the call/result pair is the unit of authority, and an
		// unmatched result cannot be attributed to an operation.
		const call = callsById.get(toolUseId);
		if (!call) {
			continue;
		}
		// Only a POSITIVE success signal is carried. A failed or
		// unclassified operation is never promoted to a success.
		if (result.status !== "succeeded") {
			continue;
		}
		outcomes.push({
			toolUseId,
			toolName: call.toolName,
			status: result.status,
			sourceIndex: call.sourceIndex,
			excerpt: buildExcerpt(result.text),
		});
	}

	outcomes.sort((left, right) => left.sourceIndex - right.sourceIndex);
	if (outcomes.length > MAX_CARRIED_OUTCOMES) {
		outcomes.splice(0, outcomes.length - MAX_CARRIED_OUTCOMES);
	}
	return { outcomes };
}

/**
 * Escape delimiter occurrences inside carried source text.
 *
 * Anti-spoofing: an occurrence of a delimiter inside a carried excerpt is
 * escaped before the excerpt is embedded, so tool output can never open or
 * close the generated section and thereby forge a new authority.
 */
function escapeDelimiters(text: string): string {
	return text
		.split(EVIDENCE_BEGIN_MARKER)
		.join(`\\${EVIDENCE_BEGIN_MARKER}`)
		.split(EVIDENCE_END_MARKER)
		.join(`\\${EVIDENCE_END_MARKER}`);
}

/**
 * Render the deterministic carry-forward section for the verified outcomes.
 *
 * Returns `undefined` when there is nothing verified to carry, so the
 * caller can leave the summary untouched - no synthetic section is invented.
 *
 * The output is a pure function of the canonical outcomes: the same canonical
 * history always yields byte-identical text.
 */
export function renderEvidenceSection(
	ledger: VerifiedOutcomeLedger,
): string | undefined {
	if (ledger.outcomes.length === 0) {
		return undefined;
	}
	const lines: string[] = [];
	for (const outcome of ledger.outcomes) {
		const excerpt = outcome.excerpt
			? ` — ${escapeDelimiters(outcome.excerpt)}`
			: "";
		lines.push(
			`- ${outcome.toolName} (${outcome.toolUseId}): succeeded${excerpt}`,
		);
	}
	return [
		EVIDENCE_SECTION_HEADING,
		EVIDENCE_BEGIN_MARKER,
		...lines,
		EVIDENCE_END_MARKER,
	].join("\n");
}

/**
 * Remove any previously carried evidence section from a summary text.
 *
 * This makes the carry-forward IDEMPOTENT: a later compaction replaces the
 * carried section with the section derived from the CURRENT canonical
 * authority instead of appending a second copy.
 *
 * The HEADING is removed together with the delimited body. Stripping only
 * the body would leave an orphaned heading behind, and the next carry-forward
 * would then produce a duplicate heading - the exact accumulation this
 * function exists to prevent.
 */
export function stripEvidenceSection(summaryText: string): string {
	const begin = summaryText.indexOf(EVIDENCE_BEGIN_MARKER);
	if (begin === -1) {
		return summaryText;
	}
	const end = summaryText.indexOf(EVIDENCE_END_MARKER, begin);
	// The section's own heading, when present, sits immediately before the
	// begin marker.
	const headingIndex = summaryText.lastIndexOf(EVIDENCE_SECTION_HEADING, begin);
	const sectionStart =
		headingIndex !== -1 &&
		summaryText
			.slice(headingIndex + EVIDENCE_SECTION_HEADING.length, begin)
			.trim() === ""
			? headingIndex
			: begin;
	if (end === -1) {
		// A malformed (truncated) section is removed to its end so a partial
		// record can never be presented as a complete one.
		return summaryText.slice(0, sectionStart).trimEnd();
	}
	const before = summaryText.slice(0, sectionStart).trimEnd();
	const after = summaryText.slice(end + EVIDENCE_END_MARKER.length).trimStart();
	if (!before) {
		return after;
	}
	if (!after) {
		return before;
	}
	return `${before}\n\n${after}`;
}

/**
 * Apply the carry-forward to a summary text: strip any previously carried
 * section and append the section derived from the canonical outcomes.
 *
 * Returns the original text unchanged when there is nothing verified to
 * carry, so a summary without verified outcomes is never rewritten.
 */
export function applyEvidenceToSummary(
	summaryText: string,
	ledger: VerifiedOutcomeLedger,
): string {
	const section = renderEvidenceSection(ledger);
	const stripped = stripEvidenceSection(summaryText).trimEnd();
	if (!section) {
		return stripped;
	}
	if (!stripped) {
		return section;
	}
	return `${stripped}\n\n${section}`;
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
 * metadata field (kind, displayRole, userRunSpan, details, tokensBefore,
 * generatedAt) and the message envelope unchanged.
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
 * The outcome of applying the evidence carry-forward.
 */
export interface EvidenceApplicationResult {
	/** The message list to use (carried when applied, original otherwise). */
	messages: MessageWithMetadata[];
	/** Whether the carry-forward was actually applied. */
	applied: boolean;
	/** The number of verified outcomes carried. */
	carriedOutcomeCount: number;
}

/**
 * Apply the verified-outcome carry-forward to a compacted message list.
 *
 * The outcomes are attached to the EXISTING `compaction_summary` message -
 * the message `buildSummaryMessage()` already produced. No second summary
 * message is created, no provider tool call is added, and every other
 * projected message is preserved unchanged.
 *
 * The provider-visible text AND `metadata.summary` are updated together, so
 * the representation a later compaction reads as `previousSummary` agrees
 * with what the model sees. (A repair that changed only one of the two
 * would be incorrect.)
 *
 * The carry-forward is a pure function of the CANONICAL history. A previous
 * summary is never an authority source: a summary that already carries a
 * section has it STRIPPED and replaced, so repeated compactions converge on
 * the canonical record instead of accumulating copies.
 */
export function applyVerifiedEvidenceToCompactedMessages(
	compactedMessages: readonly MessageWithMetadata[],
	canonicalMessages: readonly MessageWithMetadata[],
): EvidenceApplicationResult {
	const ledger = extractVerifiedToolOutcomes(canonicalMessages);
	const summaryIndex = compactedMessages.findIndex(
		(message) =>
			(message.metadata as { kind?: string } | undefined)?.kind ===
			"compaction_summary",
	);
	if (summaryIndex === -1) {
		return {
			messages: [...compactedMessages],
			applied: false,
			carriedOutcomeCount: ledger.outcomes.length,
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
			carriedOutcomeCount: ledger.outcomes.length,
		};
	}
	const nextSummary = applyEvidenceToSummary(currentSummary, ledger);
	if (nextSummary === currentSummary) {
		return {
			messages: [...compactedMessages],
			applied: false,
			carriedOutcomeCount: ledger.outcomes.length,
		};
	}
	const nextMessages = [...compactedMessages];
	nextMessages[summaryIndex] = rebuildSummaryMessage(
		summaryMessage,
		nextSummary,
	);
	return {
		messages: nextMessages,
		applied: true,
		carriedOutcomeCount: ledger.outcomes.length,
	};
}
