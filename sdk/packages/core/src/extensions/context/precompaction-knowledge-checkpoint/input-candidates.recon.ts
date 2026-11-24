/**
 * ACT-CLINEMM-PCK-EVIDENCE-FIRST-INPUT-RECON-01
 *
 * RECON-ONLY input-representation candidates for the Pre-Compaction
 * Knowledge Checkpoint (PCK).
 *
 * ============================================================================
 * THIS IS NOT PRODUCTION CODE
 * ============================================================================
 *
 * Every candidate below is an EXPERIMENTAL DISCRIMINATOR. None of it is
 * wired into the production checkpoint seam, and this module is imported by
 * the recon scripts and the recon tests only.
 *
 * The production input builders remain `buildCheckpointInputView()` /
 * `buildCheckpointRequest()` in `model-request.ts`, and the production
 * publication authority remains `gateClosedProposals()` in
 * `publication-gate.ts`.
 *
 * ============================================================================
 * WHAT THE CANDIDATES ARE
 * ============================================================================
 *
 * Candidate A — the EXISTING full-history input. The production builders,
 * unchanged. This is the baseline.
 *
 * Candidate B — the EVIDENCE-FIRST representation. The runtime's own
 * deterministic evidence classification selects the evidence-bearing messages
 * and bounded supporting excerpts. Hypotheses, constraints, unresolved
 * questions and conflicting evidence are preserved.
 *
 * Candidate C — the EVIDENCE-ONLY representation. Runtime-classified
 * observations and minimal supporting context, with the bulk of the
 * transcript removed.
 *
 * Candidate D — DETERMINISTIC EXTRACTION. No inference at all: the runtime's
 * existing, already-owned evidence produces closed-vocabulary records
 * directly. This is an EXPERIMENTAL DISCRIMINATOR, not an authorised
 * architectural replacement.
 *
 * ============================================================================
 * WHY THE CANDIDATES ARE BOUNDED
 * ============================================================================
 *
 * Every candidate preserves the PRODUCTION trust boundary:
 *
 *   - the closed vocabulary is unchanged,
 *   - the canonical reference membership check is unchanged,
 *   - the atom-scoped deterministic evidence authority is unchanged,
 *   - the assurance downgrade behaviour is unchanged,
 *   - private reasoning (the `thinking` blocks) is NEVER carried,
 *   - tool OUTPUT is never carried verbatim into a candidate that claims an
 *     observation.
 *
 * A reduced input view is NOT a replacement for the canonical publication
 * authority. The candidates only change WHAT THE MODEL SEES; they never
 * change what the gate ACCEPTS.
 */

import type { MessageWithMetadata } from "@cline/shared";
import {
	classifyToolEvidenceClass,
	collectCanonicalToolEvents,
	collectObservedCanonicalReferences,
} from "./evidence";

/**
 * The bounded excerpt length for a supporting context block.
 *
 * The bound is deliberately small: an excerpt is CONTEXT for a decision, not
 * a substitute for the transcript. The full transcript remains available to
 * the ordinary summarizer.
 */
export const RECON_SUPPORTING_EXCERPT_CHARS = 1_200;

/**
 * The bounded number of observations one candidate may carry.
 */
export const RECON_MAX_OBSERVATIONS = 40;

/**
 * ONE deterministic observation recovered from the canonical history.
 *
 * Every field is RUNTIME-OWNED or derived from the runtime's own
 * classification. No model-authored text is present.
 */
export interface ReconObservation {
	/** The canonical tool-call id the observation rests on. */
	readonly toolCallId: string;
	/** The runtime-owned tool name. */
	readonly toolName: string;
	/** The runtime-owned evidence class, when the tool has one. */
	readonly evidenceClass: string | undefined;
	/** Whether the result affirmatively succeeded. */
	readonly succeeded: boolean;
	/** The runtime-owned command classifications. */
	readonly commandClassifications: readonly string[];
	/** The bounded, redacted subject of the call, when one is derivable. */
	readonly subject: string | undefined;
}

/**
 * The runtime's OWN classification of one canonical message.
 *
 * The classification is derived from the message's role and its content
 * blocks. It is NOT a model judgment.
 */
export type ReconMessageClass =
	| "tool_call"
	| "tool_result"
	| "assistant_text"
	| "user_text"
	| "private_only";

/**
 * Classify ONE canonical message deterministically.
 *
 * The classification is total: every message receives exactly one class.
 */
export function classifyReconMessage(
	message: MessageWithMetadata,
): ReconMessageClass {
	if (!Array.isArray(message.content)) {
		return "user_text";
	}
	let hasToolCall = false;
	let hasToolResult = false;
	let hasText = false;
	for (const block of message.content) {
		if (block.type === "tool_use") {
			hasToolCall = true;
			continue;
		}
		if (block.type === "tool_result") {
			hasToolResult = true;
			continue;
		}
		if (block.type === "text") {
			hasText = true;
		}
	}
	if (hasToolCall) {
		return "tool_call";
	}
	if (hasToolResult) {
		return "tool_result";
	}
	if (hasText) {
		return message.role === "assistant" ? "assistant_text" : "user_text";
	}
	// Only private reasoning (or nothing) is present. Such a message
	// contributes NOTHING to a checkpoint candidate: private reasoning must
	// not become the substrate of published working knowledge.
	return "private_only";
}

/**
 * The bounded, redacted SUBJECT of a tool call.
 *
 * The subject is the tool's OWN runtime-owned classification plus the
 * allowlisted command subject. It never carries the raw command line, so a
 * path, a URL or a credential in the command cannot leak into a candidate.
 */
export function deriveReconSubject(
	toolName: string,
	commandClassifications: readonly string[],
): string | undefined {
	if (commandClassifications.length > 0) {
		return commandClassifications.join("+");
	}
	return classifyToolEvidenceClass(toolName);
}

/**
 * Collect the runtime's OWN observations from a canonical history.
 *
 * The observations come from the SAME runtime-owned ledger the publication
 * gate's evidence interpreter uses (`collectCanonicalToolEvents()`), so
 * candidate D cannot assert anything the production interpreter would
 * downgrade.
 */
export function collectReconObservations(
	canonicalMessages: readonly MessageWithMetadata[],
): readonly ReconObservation[] {
	const events = collectCanonicalToolEvents(canonicalMessages);
	return events.map((event) => ({
		toolCallId: event.toolCallId,
		toolName: event.toolName,
		evidenceClass: event.evidenceClass,
		succeeded: event.succeeded,
		commandClassifications: event.commandClassifications,
		subject: deriveReconSubject(event.toolName, event.commandClassifications),
	}));
}

/**
 * The RESULT of a tool result's own status, rendered for the candidates.
 *
 * The body of a tool result is NOT carried: it can be arbitrarily large and
 * it can carry content that is not attributable to the runtime. What IS
 * carried is the result's own STATUS, which is the runtime-owned signal.
 */
function renderResultStatus(resultBlock: unknown): string | undefined {
	const record = resultBlock as { is_error?: unknown; content?: unknown };
	if (record.is_error === true) {
		return "failed";
	}
	const payloads =
		Array.isArray(record.content) &&
		record.content.every((item) => item && typeof item === "object")
			? (record.content as Record<string, unknown>[])
			: [];
	let sawSuccess = false;
	for (const payload of payloads) {
		if (payload.success === false || payload.isError === true) {
			return "failed";
		}
		if (payload.success === true) {
			sawSuccess = true;
			continue;
		}
		return "unknown";
	}
	return sawSuccess ? "succeeded" : "unknown";
}

/**
 * The bounded supporting excerpt of ONE message.
 *
 * The excerpt is the message's own PUBLIC text, truncated. Private
 * reasoning is excluded. A tool result contributes its STATUS only.
 */
function renderSupportingExcerpt(
	message: MessageWithMetadata,
	limit: number,
): string | undefined {
	if (!Array.isArray(message.content)) {
		const text = typeof message.content === "string" ? message.content : "";
		return text.trim().length === 0 ? undefined : text.slice(0, limit);
	}
	const parts: string[] = [];
	for (const block of message.content) {
		if (block.type === "text") {
			parts.push(block.text);
			continue;
		}
		if (block.type === "tool_result") {
			const status = renderResultStatus(block);
			if (status !== undefined) {
				parts.push(`[tool result status=${status}]`);
			}
		}
	}
	const joined = parts.join("\n").trim();
	if (joined.length === 0) {
		return undefined;
	}
	return joined.length > limit ? `${joined.slice(0, limit)}...` : joined;
}

/**
 * ONE candidate's rendered input.
 */
export interface ReconCandidateInput {
	/** The candidate's identifier. */
	readonly candidate: "A" | "B" | "C" | "D";
	/** The rendered text the model would see. */
	readonly text: string;
	/** The canonical references available for citation. */
	readonly references: readonly string[];
	/** The number of canonical messages the candidate was derived from. */
	readonly sourceMessageCount: number;
	/** The number of messages the candidate actually carried. */
	readonly carriedMessageCount: number;
	/** The number of runtime observations the candidate carried. */
	readonly carriedObservationCount: number;
	/** The serialized size of the candidate's text, in characters. */
	readonly textChars: number;
}

/**
 * The header that names the candidate's representation to the model.
 *
 * The header is RUNTIME-OWNED and carries no model-authored text.
 */
function candidateHeader(candidate: "A" | "B" | "C" | "D"): string {
	switch (candidate) {
		case "A":
			return "--- FULL SESSION TRANSCRIPT ---";
		case "B":
			return "--- EVIDENCE-BEARING MESSAGES WITH SUPPORTING EXCERPTS ---";
		case "C":
			return "--- RUNTIME-CLASSIFIED OBSERVATIONS ---";
		case "D":
			return "--- DETERMINISTIC CLOSED-VOCABULARY OBSERVATIONS ---";
	}
}

/**
 * CANDIDATE A — the EXISTING full-history input.
 *
 * The production builder is used VERBATIM. The candidate adds only the
 * header so the four candidates are distinguishable in the evidence.
 */
export function buildCandidateA(
	canonicalMessages: readonly MessageWithMetadata[],
	inputViewText: string,
): ReconCandidateInput {
	return {
		candidate: "A",
		text: [candidateHeader("A"), "", inputViewText].join("\n"),
		references: collectObservedCanonicalReferences(canonicalMessages),
		sourceMessageCount: canonicalMessages.length,
		carriedMessageCount: canonicalMessages.length,
		carriedObservationCount: 0,
		textChars: inputViewText.length,
	};
}

/**
 * Select the EVIDENCE-BEARING messages of a canonical history.
 *
 * A message is evidence-bearing when it carries a tool call, a tool result,
 * or assistant text. A message that carries ONLY private reasoning is
 * EXCLUDED: private reasoning must never become the substrate of a
 * published checkpoint.
 *
 * The ORDER is preserved, so the sequence of the session remains legible.
 */
export function selectEvidenceBearingMessages(
	canonicalMessages: readonly MessageWithMetadata[],
): readonly {
	readonly message: MessageWithMetadata;
	readonly kind: ReconMessageClass;
}[] {
	const selected: {
		readonly message: MessageWithMetadata;
		readonly kind: ReconMessageClass;
	}[] = [];
	for (const message of canonicalMessages) {
		const kind = classifyReconMessage(message);
		if (kind === "private_only") {
			continue;
		}
		selected.push({ message, kind });
	}
	return selected;
}

/**
 * CANDIDATE B — the EVIDENCE-FIRST representation.
 *
 * Every evidence-bearing message is carried, with its supporting excerpt
 * BOUNDED. Hypotheses, constraints, unresolved questions and conflicting
 * evidence live in the assistant's and user's TEXT, so they are preserved.
 */
export function buildCandidateB(
	canonicalMessages: readonly MessageWithMetadata[],
): ReconCandidateInput {
	const selected = selectEvidenceBearingMessages(canonicalMessages);
	const observations = collectReconObservations(canonicalMessages);
	const lines: string[] = [];
	let carried = 0;
	for (const entry of selected) {
		const excerpt = renderSupportingExcerpt(
			entry.message,
			RECON_SUPPORTING_EXCERPT_CHARS,
		);
		if (excerpt === undefined) {
			continue;
		}
		carried += 1;
		const reference = entry.message.id ? `id:${entry.message.id}` : undefined;
		lines.push(reference === undefined ? excerpt : `[${reference}] ${excerpt}`);
	}
	// The runtime's OWN observation ledger is carried alongside, so the
	// model sees the runtime-owned classifications it must not contradict.
	const observationLines = observations
		.slice(0, RECON_MAX_OBSERVATIONS)
		.map(
			(observation) =>
				`[observation ref=${observation.toolCallId} tool=${observation.toolName} class=${observation.evidenceClass ?? "unclassified"} status=${observation.succeeded ? "succeeded" : "not-succeeded"} subject=${observation.subject ?? "none"}]`,
		);
	const text = [
		candidateHeader("B"),
		"",
		"Runtime-classified observations:",
		...observationLines,
		"",
		"Supporting evidence:",
		...lines,
	].join("\n");
	return {
		candidate: "B",
		text,
		references: collectObservedCanonicalReferences(canonicalMessages),
		sourceMessageCount: canonicalMessages.length,
		carriedMessageCount: carried,
		carriedObservationCount: Math.min(
			observations.length,
			RECON_MAX_OBSERVATIONS,
		),
		textChars: text.length,
	};
}

/**
 * CANDIDATE C — the EVIDENCE-ONLY representation.
 *
 * The runtime's OWN observation ledger only. The bulk of the transcript is
 * REMOVED, so this candidate answers the question: can the model prioritise
 * useful working knowledge without seeing the full transcript?
 */
export function buildCandidateC(
	canonicalMessages: readonly MessageWithMetadata[],
): ReconCandidateInput {
	const observations = collectReconObservations(canonicalMessages);
	const lines: string[] = [];
	let carried = 0;
	for (const observation of observations.slice(0, RECON_MAX_OBSERVATIONS)) {
		carried += 1;
		lines.push(
			[
				`[observation ref=${observation.toolCallId}`,
				`tool=${observation.toolName}`,
				`class=${observation.evidenceClass ?? "unclassified"}`,
				`status=${observation.succeeded ? "succeeded" : "not-succeeded"}`,
				`subject=${observation.subject ?? "none"}`,
				`]`,
			].join(" "),
		);
	}
	const text = [candidateHeader("C"), "", ...lines].join("\n");
	return {
		candidate: "C",
		text,
		references: collectObservedCanonicalReferences(canonicalMessages),
		sourceMessageCount: canonicalMessages.length,
		carriedMessageCount: carried,
		carriedObservationCount: carried,
		textChars: text.length,
	};
}

/**
 * ONE deterministic, closed-vocabulary record.
 *
 * This is the Candidate D PRODUCT: a record the runtime can produce WITHOUT
 * inference, drawn from the SAME runtime-owned evidence the production
 * interpreter uses.
 */
export interface ReconDeterministicRecord {
	readonly kind: "observation" | "open_question";
	readonly assurance: "tool_observed" | "model_reported";
	readonly status: "active" | "unresolved";
	readonly atom: string;
	readonly argument?: string;
	readonly evidenceRefs: readonly string[];
}

/**
 * CANDIDATE D — the DETERMINISTIC EXTRACTION discriminator.
 *
 * The runtime's OWN command classifications establish the operation atoms,
 * exactly as the production interpreter does. Only the `build` argument has
 * a non-empty runtime-owned classification set, so only a `make build` call
 * establishes an operation here. Every other call establishes NOTHING and
 * is NOT claimed.
 *
 * NO model judgment, NO open question, NO causation and NO stronger
 * assurance is manufactured here.
 */
export function buildCandidateDRecords(
	canonicalMessages: readonly MessageWithMetadata[],
): readonly ReconDeterministicRecord[] {
	const events = collectCanonicalToolEvents(canonicalMessages);
	const records: ReconDeterministicRecord[] = [];
	for (const event of events) {
		if (!event.succeeded) {
			continue;
		}
		for (const classification of event.commandClassifications) {
			if (classification === "make build") {
				records.push({
					kind: "observation",
					assurance: "tool_observed",
					status: "active",
					atom: "OPERATION_INVOKED",
					argument: "build",
					evidenceRefs: [event.toolCallId],
				});
				break;
			}
		}
	}
	return records;
}

/**
 * CANDIDATE D — the rendered deterministic candidate.
 *
 * The candidate is the deterministic record set, rendered in the CLOSED
 * vocabulary. The point of the candidate is to establish how much useful
 * knowledge the runtime already owns WITHOUT spending an inference request.
 */
export function buildCandidateD(
	canonicalMessages: readonly MessageWithMetadata[],
): ReconCandidateInput {
	const records = buildCandidateDRecords(canonicalMessages);
	const lines = records.map(
		(record) =>
			`[record kind=${record.kind} assurance=${record.assurance} status=${record.status} atom=${record.atom}${record.argument ? ` argument=${record.argument}` : ""} evidenceRefs=${record.evidenceRefs.join(",")}]`,
	);
	const text = [candidateHeader("D"), "", ...lines].join("\n");
	return {
		candidate: "D",
		text,
		references: collectObservedCanonicalReferences(canonicalMessages),
		sourceMessageCount: canonicalMessages.length,
		carriedMessageCount: records.length,
		carriedObservationCount: records.length,
		textChars: text.length,
	};
}
