/**
 * ACT-CLINEMM-PRECOMPACTION-KNOWLEDGE-CHECKPOINT-PROBE-01
 *
 * TEST-LOCAL parser and validation gates for a Working Knowledge Checkpoint.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API. See `checkpoint-schema.ts`.
 * ============================================================================
 *
 * THE CENTRAL RULE
 * ----------------
 *
 * A checkpoint parser may establish:
 *
 *   SCHEMA_VALID               the document has the declared shape
 *   BOUND_TO_CANONICAL_MESSAGE the cited reference resolves in the
 *                              canonical history
 *   SOURCE_REFERENCE_RESOLVED  the evidence reference resolves
 *   PRESERVED_IN_PROJECTION    the record reaches the provider-visible
 *                              continuation
 *
 * It may NOT establish:
 *
 *   FACTUALLY_TRUE             the claim is true
 *   PRODUCTION_VERIFIED        the claim was confirmed by a production system
 *   CAUSALLY_PROVEN            the claim's mechanism was proven
 *
 * The validator therefore NEVER promotes a record to a stronger assurance
 * grade, and NEVER invents a missing evidence reference.
 */

import {
	ASSURANCE_LEVELS,
	CHECKPOINT_LIMITS,
	KNOWLEDGE_KINDS,
	KNOWLEDGE_STATUSES,
	type KnowledgeKind,
	type KnowledgeStatus,
	type WorkingKnowledgeRecord,
} from "./checkpoint-schema";

/** The outcome of parsing a raw model-authored checkpoint document. */
export interface CheckpointParseOutcome {
	/** Whether the document parsed into a structurally valid checkpoint. */
	readonly schemaValid: boolean;
	/** The parsed records, in document order. */
	readonly records: readonly WorkingKnowledgeRecord[];
	/** Machine-readable reasons the document was rejected or degraded. */
	readonly rejections: readonly CheckpointRejection[];
}

/** Why a record or document was rejected or degraded. */
export interface CheckpointRejection {
	/** The record id, when the rejection is record-scoped. */
	readonly recordId?: string;
	/** A stable, machine-readable reason code. */
	readonly code: string;
	/** A short, non-sensitive explanation. */
	readonly detail: string;
}

/**
 * The strongest assurance a record may claim when it cites NO resolvable
 * evidence reference.
 *
 * A claim with no bound evidence is, at best, the model's own report. It is
 * never `tool_observed` and never `runtime_verified`.
 */
export const MAX_ASSURANCE_WITHOUT_EVIDENCE: WorkingKnowledgeRecord["assurance"] =
	"model_reported";

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const out: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string") {
			return undefined;
		}
		out.push(entry);
	}
	return out;
}

/**
 * Parse a raw model-authored checkpoint document.
 *
 * The parser is TOTAL: it never throws on malformed input. A malformed
 * document yields `schemaValid: false` and no records, and the caller
 * leaves the compaction path untouched. A malformed checkpoint must never
 * be able to destroy the original compaction path.
 */
export function parseCheckpointDocument(raw: unknown): CheckpointParseOutcome {
	const rejections: CheckpointRejection[] = [];
	if (!isPlainObject(raw)) {
		return {
			schemaValid: false,
			records: [],
			rejections: [
				{
					code: "NOT_AN_OBJECT",
					detail: "The checkpoint document is not a JSON object.",
				},
			],
		};
	}
	const rawRecords = raw.records;
	if (!Array.isArray(rawRecords)) {
		return {
			schemaValid: false,
			records: [],
			rejections: [
				{
					code: "RECORDS_NOT_AN_ARRAY",
					detail: "The checkpoint document has no records array.",
				},
			],
		};
	}
	if (rawRecords.length > CHECKPOINT_LIMITS.MAX_RECORDS) {
		rejections.push({
			code: "TOO_MANY_RECORDS",
			detail: `The document declares ${rawRecords.length} records; the probe ceiling is ${CHECKPOINT_LIMITS.MAX_RECORDS}. The excess is dropped.`,
		});
	}
	const records: WorkingKnowledgeRecord[] = [];
	const seenIds = new Set<string>();
	for (const rawRecord of rawRecords.slice(0, CHECKPOINT_LIMITS.MAX_RECORDS)) {
		const parsed = parseRecord(rawRecord, seenIds, rejections);
		if (parsed) {
			records.push(parsed);
		}
	}
	return {
		schemaValid: rejections.every(
			(rejection) => rejection.code === "TOO_MANY_RECORDS",
		),
		records,
		rejections,
	};
}
function parseRecord(
	rawRecord: unknown,
	seenIds: Set<string>,
	rejections: CheckpointRejection[],
): WorkingKnowledgeRecord | undefined {
	if (!isPlainObject(rawRecord)) {
		rejections.push({
			code: "RECORD_NOT_AN_OBJECT",
			detail: "A record is not a JSON object.",
		});
		return undefined;
	}
	const id = typeof rawRecord.id === "string" ? rawRecord.id.trim() : "";
	if (!id) {
		rejections.push({
			code: "RECORD_ID_MISSING",
			detail: "A record has no usable id.",
		});
		return undefined;
	}
	if (seenIds.has(id)) {
		rejections.push({
			recordId: id,
			code: "RECORD_ID_DUPLICATE",
			detail: "A record id is duplicated; the later record is dropped.",
		});
		return undefined;
	}
	const kind = rawRecord.kind;
	if (
		typeof kind !== "string" ||
		!KNOWLEDGE_KINDS.includes(kind as KnowledgeKind)
	) {
		rejections.push({
			recordId: id,
			code: "RECORD_KIND_INVALID",
			detail: "A record has an unknown kind.",
		});
		return undefined;
	}
	const assurance = rawRecord.assurance;
	if (
		typeof assurance !== "string" ||
		!ASSURANCE_LEVELS.includes(assurance as WorkingKnowledgeRecord["assurance"])
	) {
		rejections.push({
			recordId: id,
			code: "RECORD_ASSURANCE_INVALID",
			detail: "A record has an unknown assurance grade.",
		});
		return undefined;
	}
	const status = rawRecord.status;
	if (
		typeof status !== "string" ||
		!KNOWLEDGE_STATUSES.includes(status as KnowledgeStatus)
	) {
		rejections.push({
			recordId: id,
			code: "RECORD_STATUS_INVALID",
			detail: "A record has an unknown status.",
		});
		return undefined;
	}
	const statementRaw =
		typeof rawRecord.statement === "string" ? rawRecord.statement : "";
	const statement = statementRaw.trim();
	if (!statement) {
		rejections.push({
			recordId: id,
			code: "RECORD_STATEMENT_EMPTY",
			detail: "A record has no statement.",
		});
		return undefined;
	}
	if (statement.length > CHECKPOINT_LIMITS.MAX_STATEMENT_CHARS) {
		rejections.push({
			recordId: id,
			code: "RECORD_STATEMENT_TRUNCATED",
			detail: `A statement exceeded ${CHECKPOINT_LIMITS.MAX_STATEMENT_CHARS} characters and was truncated.`,
		});
	}
	const evidenceRefsRaw = asStringArray(rawRecord.evidenceRefs) ?? [];
	const qualificationsRaw = asStringArray(rawRecord.qualifications) ?? [];
	if (evidenceRefsRaw.length > CHECKPOINT_LIMITS.MAX_EVIDENCE_REFS) {
		rejections.push({
			recordId: id,
			code: "RECORD_EVIDENCE_REFS_TRUNCATED",
			detail: `A record cited more than ${CHECKPOINT_LIMITS.MAX_EVIDENCE_REFS} evidence references; the excess was dropped.`,
		});
	}
	if (qualificationsRaw.length > CHECKPOINT_LIMITS.MAX_QUALIFICATIONS) {
		rejections.push({
			recordId: id,
			code: "RECORD_QUALIFICATIONS_TRUNCATED",
			detail: `A record carried more than ${CHECKPOINT_LIMITS.MAX_QUALIFICATIONS} qualifications; the excess was dropped.`,
		});
	}
	seenIds.add(id);
	return {
		id,
		kind: kind as KnowledgeKind,
		assurance: assurance as WorkingKnowledgeRecord["assurance"],
		statement: statement.slice(0, CHECKPOINT_LIMITS.MAX_STATEMENT_CHARS),
		evidenceRefs: evidenceRefsRaw
			.map((ref) => ref.trim())
			.filter((ref) => ref.length > 0)
			.slice(0, CHECKPOINT_LIMITS.MAX_EVIDENCE_REFS),
		qualifications: qualificationsRaw
			.map((qualification) => qualification.trim())
			.filter((qualification) => qualification.length > 0)
			.slice(0, CHECKPOINT_LIMITS.MAX_QUALIFICATIONS),
		status: status as KnowledgeStatus,
	};
}
