/**
 * ACT-CLINEMM-COMPACTION-SUMMARY-CHURN-01 — OFFLINE REPRODUCTION PROBE
 *
 * A DISPOSABLE, OFFLINE experiment. It lives under `.factory/evidence/` and
 * is NOT part of any production build, package export or runtime path.
 *
 * WHAT IT DOES
 * ------------
 * It drives the REAL production functions — and only the real production
 * functions — against a REAL persisted compaction sidecar and a REAL
 * canonical transcript:
 *
 *   projectSessionCompactionState()        (session/models/session-compaction.ts)
 *   applyTaskContractToCompactedMessages() (extensions/context/task-contract.ts)
 *   applyVerifiedEvidenceToCompactedMessages() (extensions/context/evidence-continuity.ts)
 *   MessageBuilder.buildForApi()           (session/services/message-builder.ts)
 *
 * It never calls a provider. It never writes a session. It never mutates the
 * production source.
 *
 * THE QUESTION
 * ------------
 * Does an APPEND-ONLY canonical continuation (H0 -> H1 -> H2) change the
 * provider-visible compaction summary that was already model-visible?
 *
 * The 2x2 ablation switches below (contract on/off, evidence on/off) exist
 * ONLY in this disposable probe. They are not production flags and are not
 * exported from any package barrel.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { MessageWithMetadata } from "@cline/shared";
import {
	applyVerifiedEvidenceToCompactedMessages,
	EVIDENCE_SECTION_HEADING,
	extractVerifiedToolOutcomes,
	renderEvidenceSection,
	stripEvidenceSection,
} from "../../../../sdk/packages/core/src/extensions/context/evidence-continuity";
import {
	applyTaskContractToCompactedMessages,
	renderTaskContractSection,
	stripTaskContractSection,
	TASK_CONTRACT_SECTION_HEADING,
} from "../../../../sdk/packages/core/src/extensions/context/task-contract";
import {
	createSessionCompactionState,
	projectSessionCompactionState,
	type SessionCompactionState,
} from "../../../../sdk/packages/core/src/session/models/session-compaction";
import { MessageBuilder } from "../../../../sdk/packages/core/src/session/services/message-builder";

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

/**
 * A non-reversible, keyed fingerprint.
 *
 * The key is supplied by the operator through the environment and is NEVER
 * committed. There is deliberately NO built-in default: an absent key makes
 * the probe fail loudly rather than emit fingerprints that could be
 * reproduced by anyone holding this file. The receipts committed by this
 * ACT therefore carry opaque, non-reversible identities.
 */
const FINGERPRINT_KEY = process.env.ACT_CHURN_FINGERPRINT_KEY;

if (!FINGERPRINT_KEY) {
	throw new Error(
		"ACT_CHURN_FINGERPRINT_KEY is required; it is never committed and has no default",
	);
}

export function keyedFingerprint(value: string): string {
	return createHash("sha256")
		.update(`${FINGERPRINT_KEY}\n`)
		.update(value)
		.digest("hex");
}

// ---------------------------------------------------------------------------
// Section fingerprints
// ---------------------------------------------------------------------------

const CONTRACT_BEGIN = "<!-- cline-task-contract:begin -->";
const CONTRACT_END = "<!-- cline-task-contract:end -->";
const EVIDENCE_BEGIN = "<!-- cline-evidence:begin -->";
const EVIDENCE_END = "<!-- cline-evidence:end -->";

/** Extract a delimited section (heading + body) from a summary text. */
function extractDelimited(
	text: string,
	heading: string,
	begin: string,
	end: string,
): string | undefined {
	const b = text.indexOf(begin);
	if (b === -1) {
		return undefined;
	}
	const e = text.indexOf(end, b);
	if (e === -1) {
		return text.slice(b);
	}
	const h = text.lastIndexOf(heading, b);
	const start = h !== -1 ? h : b;
	return text.slice(start, e + end.length);
}

/**
 * The summary text with BOTH carried sections removed: the prose that the
 * generator produced and nothing else.
 */
export function summaryProse(summaryText: string): string {
	return stripEvidenceSection(stripTaskContractSection(summaryText)).trimEnd();
}

export interface SectionFingerprints {
	readonly summaryBytes: number;
	readonly summaryFingerprint: string;
	readonly contractPresent: boolean;
	readonly contractFingerprint: string | undefined;
	readonly evidencePresent: boolean;
	readonly evidenceFingerprint: string | undefined;
	readonly proseFingerprint: string;
	readonly proseBytes: number;
}

export function fingerprintSummary(summaryText: string): SectionFingerprints {
	const contract = extractDelimited(
		summaryText,
		TASK_CONTRACT_SECTION_HEADING,
		CONTRACT_BEGIN,
		CONTRACT_END,
	);
	const evidence = extractDelimited(
		summaryText,
		EVIDENCE_SECTION_HEADING,
		EVIDENCE_BEGIN,
		EVIDENCE_END,
	);
	const prose = summaryProse(summaryText);
	return {
		summaryBytes: Buffer.byteLength(summaryText, "utf8"),
		summaryFingerprint: keyedFingerprint(summaryText),
		contractPresent: contract !== undefined,
		contractFingerprint:
			contract === undefined ? undefined : keyedFingerprint(contract),
		evidencePresent: evidence !== undefined,
		evidenceFingerprint:
			evidence === undefined ? undefined : keyedFingerprint(evidence),
		proseFingerprint: keyedFingerprint(prose),
		proseBytes: Buffer.byteLength(prose, "utf8"),
	};
}

// ---------------------------------------------------------------------------
// Classification of a change
// ---------------------------------------------------------------------------

export type ChangeClass =
	| "TASK_CONTRACT_SECTION"
	| "VERIFIED_EVIDENCE_SECTION"
	| "SUMMARY_PROSE"
	| "MESSAGE_BUILDER_TRANSFORM"
	| "MULTIPLE_SECTIONS"
	| "UNCHANGED"
	| "UNKNOWN";

export function classifyChange(
	before: SectionFingerprints,
	after: SectionFingerprints,
): ChangeClass {
	const contractChanged =
		before.contractFingerprint !== after.contractFingerprint;
	const evidenceChanged =
		before.evidenceFingerprint !== after.evidenceFingerprint;
	const proseChanged = before.proseFingerprint !== after.proseFingerprint;
	const changed = [contractChanged, evidenceChanged, proseChanged].filter(
		Boolean,
	).length;
	if (changed === 0) {
		return "UNCHANGED";
	}
	if (changed > 1) {
		return "MULTIPLE_SECTIONS";
	}
	if (contractChanged) {
		return "TASK_CONTRACT_SECTION";
	}
	if (evidenceChanged) {
		return "VERIFIED_EVIDENCE_SECTION";
	}
	return "SUMMARY_PROSE";
}

// ---------------------------------------------------------------------------
// Production-shaped fixtures
// ---------------------------------------------------------------------------

export function userTurn(text: string): MessageWithMetadata {
	return { role: "user", content: [{ type: "text", text }] };
}

export function assistantTurn(text: string): MessageWithMetadata {
	return { role: "assistant", content: [{ type: "text", text }] };
}

export function toolCall(
	id: string,
	name: string,
	input: Record<string, unknown>,
): MessageWithMetadata {
	return {
		role: "assistant",
		content: [{ type: "tool_use", id, name, input }],
	};
}

export function toolResult(
	toolUseId: string,
	name: string,
	content: unknown,
	options: { isError?: boolean } = {},
): MessageWithMetadata {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: toolUseId,
				name,
				content,
				...(options.isError ? { is_error: true } : {}),
			} as never,
		],
	};
}

/**
 * A SUCCESSFUL canonical tool call/result pair in the production persisted
 * payload shape.
 */
export function successfulPair(
	id: string,
	command: string,
): MessageWithMetadata[] {
	return [
		toolCall(id, "run_commands", { commands: [command] }),
		toolResult(id, "run_commands", [
			{ query: command, result: "ok", success: true },
		]),
	];
}

// ---------------------------------------------------------------------------
// The production pipeline
// ---------------------------------------------------------------------------

export interface VariantSwitches {
	readonly contract: boolean;
	readonly evidence: boolean;
}

/**
 * The production provider-visible restoration, with the disposable 2x2
 * ablation switches applied AROUND the real production functions.
 *
 * The composition order is the PRODUCTION order, read from
 * `createCompactionStateAwarePrepareTurn()`:
 *
 *   projectSessionCompactionState()          -> the projected transcript
 *   applyTaskContractToCompactedMessages()   -> the contract section
 *   applyVerifiedEvidenceToCompactedMessages()-> the evidence section
 *
 * The switches are applied OUTSIDE the production functions, never inside
 * them. When a switch is OFF, that production function is simply not
 * invoked — which is exactly the ablation the ACT requires.
 */
export async function prepareProviderVisible(
	projected: readonly MessageWithMetadata[],
	canonical: readonly MessageWithMetadata[],
	switches: VariantSwitches,
): Promise<readonly MessageWithMetadata[]> {
	let messages = projected;
	if (switches.contract) {
		const contracted = await applyTaskContractToCompactedMessages(
			messages,
			canonical,
		);
		messages = contracted.messages;
	}
	if (switches.evidence) {
		const evidenced = applyVerifiedEvidenceToCompactedMessages(
			messages,
			canonical,
		);
		messages = evidenced.messages;
	}
	return messages;
}

/**
 * The REAL provider-request preparation seam.
 *
 * `MessageBuilder` is documented as STATEFUL, so each call here uses a FRESH
 * builder. The production path uses a long-lived builder; using a fresh one
 * per measurement keeps the accounting-only probe from mutating the
 * production builder's sticky cross-call state.
 */
export function buildProviderRequest(
	messages: readonly MessageWithMetadata[],
): MessageWithMetadata[] {
	return new MessageBuilder().buildForApi(messages) as MessageWithMetadata[];
}

/** The provider-visible text of the summary carrier. */
export function providerSummaryText(
	messages: readonly MessageWithMetadata[],
): string {
	const summary = messages.find(
		(message) =>
			(message.metadata as { kind?: string } | undefined)?.kind ===
			"compaction_summary",
	);
	if (!summary) {
		return "";
	}
	if (typeof summary.content === "string") {
		return summary.content;
	}
	if (!Array.isArray(summary.content)) {
		return "";
	}
	return summary.content
		.filter(
			(block): block is { type: "text"; text: string } =>
				block.type === "text" && typeof block.text === "string",
		)
		.map((block) => block.text)
		.join("\n");
}

/**
 * The byte length of the longest common prefix of two strings — the
 * structural common-prefix measure the ACT requires.
 */
/**
 * The byte length of the longest common prefix of two strings.
 *
 * The result is counted in UTF-16 CODE UNITS, which is JavaScript's native
 * string index. For the ASCII-dominant content of a compaction summary this
 * coincides with the byte count, but it is NOT a byte count in general: a
 * non-ASCII character occupies two code units and one to three UTF-8 bytes.
 *
 * The name therefore says "code units" rather than "bytes". The ACT's
 * "provider-visible structural common prefix" is a STRUCTURAL measure; it
 * is not a tokenizer offset and it is not a byte count.
 */
export function commonPrefixCodeUnits(left: string, right: string): number {
	const limit = Math.min(left.length, right.length);
	let index = 0;
	while (index < limit && left[index] === right[index]) {
		index += 1;
	}
	return index;
}

// ---------------------------------------------------------------------------
// Live-artifact loading
// ---------------------------------------------------------------------------

export interface LiveArtifacts {
	readonly sidecar: SessionCompactionState;
	readonly canonical: MessageWithMetadata[];
	readonly sidecarSourceCount: number;
}

export function loadLiveArtifacts(
	sidecarPath: string,
	canonicalPath: string,
): LiveArtifacts {
	const sidecar = JSON.parse(
		readFileSync(sidecarPath, "utf8"),
	) as SessionCompactionState;
	const canonical = (
		JSON.parse(readFileSync(canonicalPath, "utf8")) as {
			messages: MessageWithMetadata[];
		}
	).messages;
	return {
		sidecar,
		canonical,
		sidecarSourceCount: sidecar.source_message_count,
	};
}

// ---------------------------------------------------------------------------
// The live transition matrix
// ---------------------------------------------------------------------------

export interface LiveCapture {
	readonly iteration: number;
	readonly stage: string;
	readonly capturedAt: string;
	readonly messageCount: number;
	readonly summaryBytes: number | undefined;
	readonly summaryFingerprint: string | undefined;
	readonly systemFingerprint: string | undefined;
	readonly toolFingerprints: readonly string[];
	/**
	 * HOW the summary carrier was identified for this record.
	 *
	 * - `structural` — the carrier was identified by the compaction
	 *   summary's own producer, not by a size heuristic.
	 * - `size-heuristic` — the capture carried no structural marker and the
	 *   carrier was inferred from being the largest text part.
	 * - `none` — no carrier could be identified.
	 */
	readonly carrierIdentification: "structural" | "size-heuristic" | "none";
}

/**
 * The provider-visible compaction summary is produced by
 * `buildSummaryMessage()`, which renders `Context summary:\n\n<summary>` as a
 * SINGLE text part on a `user` message.
 *
 * The forensics capture records the part's fingerprint and byte count but
 * NOT its content, so the carrier cannot be identified by reading the
 * marker. It CAN, however, be identified STRUCTURALLY: the summary is
 * ALWAYS the FIRST user message of a compacted request, and the production
 * projector places it at index 0 of the projected transcript.
 *
 * The first attempt used a size heuristic (the largest text part). That is
 * a HEURISTIC, and a heuristic cannot establish the carrier's identity.
 * The structural rule below is the authority; the heuristic is retained
 * ONLY as a fallback and is REPORTED as such, so a reader can tell which
 * identification was used for any given record.
 */
function identifySummaryCarrier(
	messages: {
		role: string;
		bytes: number;
		fingerprint: string;
		parts: { type: string; bytes: number; fingerprint: string }[];
	}[],
): {
	carrier: { bytes: number; fingerprint: string } | undefined;
	identification: "structural" | "size-heuristic" | "none";
} {
	// STRUCTURAL: the compaction summary is the FIRST user message of the
	// projected transcript. It is the only user message whose FIRST part is
	// a text part carrying the whole summary.
	const firstUser = messages.find((message) => message.role === "user");
	if (firstUser) {
		const textPart = firstUser.parts.find((part) => part.type === "text");
		if (textPart) {
			return {
				carrier: {
					bytes: textPart.bytes,
					fingerprint: textPart.fingerprint,
				},
				identification: "structural",
			};
		}
	}
	// FALLBACK (reported): the largest text part.
	let carrier: { bytes: number; fingerprint: string } | undefined;
	for (const message of messages) {
		for (const part of message.parts) {
			if (
				part.type === "text" &&
				(carrier === undefined || part.bytes > carrier.bytes)
			) {
				carrier = { bytes: part.bytes, fingerprint: part.fingerprint };
			}
		}
	}
	return {
		carrier,
		identification: carrier === undefined ? "none" : "size-heuristic",
	};
}

export function loadLiveCaptures(dir: string): LiveCapture[] {
	const out: LiveCapture[] = [];
	for (const name of readdirSync(dir).sort()) {
		if (!name.endsWith(".prefix-forensics.json")) {
			continue;
		}
		const record = JSON.parse(readFileSync(`${dir}/${name}`, "utf8")) as {
			iteration?: number;
			source: string;
			capturedAt: string;
			representation: {
				messageCount: number;
				messages: {
					role: string;
					bytes: number;
					fingerprint: string;
					parts: { type: string; bytes: number; fingerprint: string }[];
				}[];
				systemFingerprint?: string;
				toolFingerprints?: { name: string; fingerprint: string }[];
				complete?: boolean;
			};
		};
		const rep = record.representation;
		const { carrier, identification } = identifySummaryCarrier(rep.messages);
		out.push({
			iteration: record.iteration ?? -1,
			stage: record.source,
			capturedAt: record.capturedAt,
			messageCount: rep.messageCount,
			summaryBytes: carrier?.bytes,
			summaryFingerprint: carrier?.fingerprint,
			carrierIdentification: identification,
			systemFingerprint: rep.systemFingerprint,
			toolFingerprints: (rep.toolFingerprints ?? []).map(
				(tool) => tool.fingerprint,
			),
		});
	}
	out.sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
	return out;
}

// ---------------------------------------------------------------------------
// Re-exports for the probe driver
// ---------------------------------------------------------------------------

export {
	applyTaskContractToCompactedMessages,
	applyVerifiedEvidenceToCompactedMessages,
	createSessionCompactionState,
	extractVerifiedToolOutcomes,
	projectSessionCompactionState,
	renderEvidenceSection,
	renderTaskContractSection,
	stripEvidenceSection,
	stripTaskContractSection,
};
