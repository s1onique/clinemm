/**
 * ACT-CLINEMM-PRECOMPACTION-KNOWLEDGE-CHECKPOINT-PROBE-01
 *
 * TEST-LOCAL binding and trust gates for a Working Knowledge Checkpoint.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API. See `checkpoint-schema.ts`.
 * ============================================================================
 *
 * WHAT THIS MODULE DOES
 * ---------------------
 *
 * It turns a structurally valid checkpoint into an ACCEPTED checkpoint by
 * binding each record's evidence references against the CANONICAL history
 * and applying the trust gates.
 *
 * THE TRUST GATES, AND WHY EACH EXISTS
 * ------------------------------------
 *
 *  G1  EVIDENCE RESOLUTION. A record whose references do not resolve loses
 *      those references. A record with NO resolvable reference is DEMOTED
 *      to `model_reported` at most. A missing reference is NEVER replaced
 *      with a fabricated one.
 *
 *  G2  ASSURANCE BOUNDING. A record's assurance is a CLAIM. The validator
 *      never moves it UP. A record that claims `runtime_verified` while
 *      citing only a model-reported source is moved DOWN to what its
 *      evidence supports.
 *
 *  G3  INSTRUCTION INERTIA. A statement that reads like an instruction to
 *      the agent is REJECTED, not sanitized. Tool output and quoted source
 *      content are DATA; a checkpoint must never be able to issue orders to
 *      the continuing agent.
 *
 *  G4  CREDENTIAL INERTIA. A statement or qualification that looks like it
 *      carries a credential is REJECTED. A checkpoint is not a secret store.
 *
 *  G5  ALLEGATION SEPARATION. A record that merely restates the ORIGINAL
 *      USER ALLEGATION as if it were an established observation is
 *      REJECTED when it cites no independent evidence. The original
 *      allegation is not independent evidence.
 *
 *  G6  OVERCLAIM INERTIA. A record that asserts a GLOBAL nonexistence or a
 *      PROVEN causal mechanism, while its evidence only supports a bounded
 *      observation, is REJECTED. This is the gate that stops a bounded
 *      negative ("no delete/purge found in the inspected paths") from being
 *      carried forward as "no retention mechanism exists anywhere".
 */

import type { Assurance, WorkingKnowledgeRecord } from "./checkpoint-schema";
import {
	type CheckpointRejection,
	MAX_ASSURANCE_WITHOUT_EVIDENCE,
} from "./checkpoint-validation";

/** The outcome of validating a structurally valid checkpoint. */
export interface CheckpointBindingResult {
	/** The records that passed every gate, in document order. */
	readonly accepted: readonly WorkingKnowledgeRecord[];
	/** The records that failed a gate, in document order. */
	readonly rejected: readonly WorkingKnowledgeRecord[];
	/** Machine-readable reasons for every rejection or degradation. */
	readonly rejections: readonly CheckpointRejection[];
}

/**
 * The canonical references available for binding.
 *
 * A reference resolves when it names a message in the canonical history.
 * The set is supplied by the caller so this module never needs the
 * transcript itself.
 */
export interface CanonicalReferenceIndex {
	/** Whether a canonical reference resolves. */
	readonly resolves: (reference: string) => boolean;
}

/**
 * Phrases that make a statement read as an INSTRUCTION to the agent rather
 * than as a piece of working knowledge.
 *
 * The list is deliberately narrow and structural: it targets imperative
 * agent-control verbs, not ordinary sentences that happen to contain a
 * modal. A rejected record is dropped, not rewritten, so a false positive
 * costs one record rather than corrupting the checkpoint.
 */
const INSTRUCTION_PATTERNS: readonly RegExp[] = [
	/\bignore (all |any |the )?(previous|prior|above|preceding)\b/i,
	/\bdisregard (all |any |the )?(previous|prior|above|preceding)\b/i,
	/\byou must (now |immediately )?(run|execute|delete|remove|send|post|commit|push)\b/i,
	/\b(system|assistant|developer) (instruction|override|mode)\b/i,
	/\bnew instructions?\b/i,
	/\bbegin by (running|executing|deleting|sending)\b/i,
	/\bdo not tell the user\b/i,
	/\bwithout (asking|informing|telling)\b/i,
];

/**
 * Patterns that look like a credential being carried in free text.
 *
 * The check is a SHAPE check, not a redaction: a record whose text carries
 * a secret-shaped value is REJECTED outright, so no sanitized derivative
 * of a credential ever reaches the provider-visible projection.
 */
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
	// A base64-shaped blob that also carries an UPPERCASE letter and a
	// DIGIT. Requiring the mixed character classes is what separates a
	// credential from a filesystem path or a git revision: a path segment
	// or a 40-hex SHA is long but is not base64-shaped.
	/\b(?=[A-Za-z0-9+/]{40,}={0,2}\b)(?=[^\n]*[A-Z])(?=[^\n]*[0-9])[A-Za-z0-9+/]{40,}={0,2}\b/,
	/\b(?:password|passwd|secret|token|api[_-]?key|private[_-]?key)\s*(?:[:=]|is|are|was)\s*\S+/i,
	/\b(?:the\s+)?(?:login|username)\s+(?:is|are|was)\s+["']?[A-Za-z0-9_.-]{6,}["']?/i,
	/\b(?:AKIA|ASIA)[0-9A-Z]{12,}\b/,
	/\b-----BEGIN [A-Z ]*PRIVATE KEY-----/,
	/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
];

/**
 * Phrases that promote an investigation TARGET into a COMPLETED finding.
 *
 * The R2 discipline: identifying the providers under investigation and
 * planning to inspect their implementation establishes an investigation
 * target, NOT a completed finding about timeout safety. A record that
 * asserts a completed, verified finding about a subject whose status was
 * never established is dropped.
 */
const COMPLETED_FINDING_PATTERNS: readonly RegExp[] = [
	/\b(?:timeout|safety|finding|verdict|conclusion)s? (?:was|were|is|are) (?:confirmed|verified|established|proven)\b/i,
	/\bconfirmed that .{0,60}(?:timeout|safety|circuit ?breaker|fallback)/i,
	/\b(?:has|have) been (?:confirmed|verified|established) (?:that )?/i,
	/\bproves? that .{0,60}(?:timeout|safety)/i,
];

/**
 * Phrases that assert a GLOBAL nonexistence from what is only a bounded
 * observation.
 */
const GLOBAL_NEGATION_PATTERNS: readonly RegExp[] = [
	/\bno retention mechanism exists anywhere\b/i,
	/\bthere is no (?:delete|purge|cleanup|retention)\b/i,
	/\bno .{0,40}(?:delete|purge|cleanup) (?:is|are) (?:implemented|present|possible) anywhere\b/i,
	/\bnever (?:deleted|purged|cleaned)\b/i,
	/\bdoes not exist anywhere\b/i,
];

/**
 * Phrases that assert a PROVEN causal mechanism from what is only an
 * observed co-occurrence.
 */
const PROVEN_CAUSALITY_PATTERNS: readonly RegExp[] = [
	/\bproves? that .{0,60}causes?\b/i,
	/\bcauses? configuration drift\b/i,
	/\bthereby (?:causing|causes) drift\b/i,
	/\bproves? .{0,40}(?:drift|mismatch|regression)\b/i,
	/\bconfirmed? to cause\b/i,
];

/** The assurance grade order, weakest to strongest. */
const ASSURANCE_RANK: readonly Assurance[] = [
	"unverified",
	"model_reported",
	"tool_observed",
	"runtime_verified",
];

function assuranceAtOrBelow(assurance: Assurance, ceiling: Assurance): boolean {
	return ASSURANCE_RANK.indexOf(assurance) <= ASSURANCE_RANK.indexOf(ceiling);
}

/**
 * Bind a structurally valid checkpoint against the canonical history and
 * apply every trust gate.
 *
 * The function is TOTAL: it never throws, and a rejected record never
 * prevents the remaining records from being accepted. An absent or wholly
 * malformed checkpoint therefore leaves the original compaction path
 * untouched.
 */
export function bindCheckpointRecords(
	records: readonly WorkingKnowledgeRecord[],
	index: CanonicalReferenceIndex,
): CheckpointBindingResult {
	const accepted: WorkingKnowledgeRecord[] = [];
	const rejected: WorkingKnowledgeRecord[] = [];
	const rejections: CheckpointRejection[] = [];
	for (const record of records) {
		const resolvedRefs = record.evidenceRefs.filter((ref) =>
			index.resolves(ref),
		);
		const droppedRefs = record.evidenceRefs.length - resolvedRefs.length;
		if (droppedRefs > 0) {
			rejections.push({
				recordId: record.id,
				code: "EVIDENCE_REF_UNRESOLVED",
				detail: `${droppedRefs} cited evidence reference(s) did not resolve against the canonical history and were dropped. No replacement was fabricated.`,
			});
		}
		if (resolvedRefs.length === 0) {
			rejections.push({
				recordId: record.id,
				code: "ASSURANCE_DEMOTED_NO_EVIDENCE",
				detail: `The record cites no resolvable evidence, so its assurance was capped at "${MAX_ASSURANCE_WITHOUT_EVIDENCE}".`,
			});
		}
		const cappedAssurance = capAssurance(
			record.assurance,
			resolvedRefs.length > 0,
		);
		if (cappedAssurance !== record.assurance) {
			rejections.push({
				recordId: record.id,
				code: "ASSURANCE_DEMOTED",
				detail: `The record claimed assurance "${record.assurance}" but its evidence supports at most "${cappedAssurance}".`,
			});
		}
		const bound: WorkingKnowledgeRecord = {
			...record,
			assurance: cappedAssurance,
			evidenceRefs: resolvedRefs,
		};
		const gate = applyTrustGates(bound, rejections);
		if (gate === "REJECT") {
			rejected.push(bound);
			continue;
		}
		accepted.push(bound);
	}
	return { accepted, rejected, rejections };
}

/**
 * Cap a claimed assurance at the strongest grade the evidence supports.
 *
 * Nothing is ever moved UP: a record claiming `unverified` keeps
 * `unverified` even when it cites resolvable evidence, because the
 * validator has no authority to assert that the author's own conservative
 * grade was wrong.
 */
function capAssurance(
	claimed: Assurance,
	hasResolvableEvidence: boolean,
): Assurance {
	if (!hasResolvableEvidence) {
		return assuranceAtOrBelow(claimed, MAX_ASSURANCE_WITHOUT_EVIDENCE)
			? claimed
			: MAX_ASSURANCE_WITHOUT_EVIDENCE;
	}
	return claimed;
}

/**
 * Apply the instruction, credential and overclaim gates.
 *
 * Returns `"REJECT"` when the record must be dropped, `"ACCEPT"` otherwise.
 */
function applyTrustGates(
	record: WorkingKnowledgeRecord,
	rejections: CheckpointRejection[],
): "ACCEPT" | "REJECT" {
	const texts = [record.statement, ...record.qualifications];
	const joined = texts.join("\n");
	for (const pattern of INSTRUCTION_PATTERNS) {
		if (pattern.test(joined)) {
			rejections.push({
				recordId: record.id,
				code: "INSTRUCTION_SHAPED_TEXT",
				detail:
					"A record read as an instruction to the agent rather than as working knowledge, and was dropped. Tool output and quoted source content are data.",
			});
			return "REJECT";
		}
	}
	for (const pattern of CREDENTIAL_PATTERNS) {
		if (pattern.test(joined)) {
			rejections.push({
				recordId: record.id,
				code: "CREDENTIAL_SHAPED_TEXT",
				detail:
					"A record carried credential-shaped text and was dropped. A checkpoint is not a secret store.",
			});
			return "REJECT";
		}
	}
	for (const pattern of GLOBAL_NEGATION_PATTERNS) {
		if (pattern.test(joined)) {
			rejections.push({
				recordId: record.id,
				code: "GLOBAL_NEGATION_OVERCLAIM",
				detail:
					"A record asserted a global nonexistence that its bounded evidence does not support, and was dropped.",
			});
			return "REJECT";
		}
	}
	for (const pattern of PROVEN_CAUSALITY_PATTERNS) {
		if (pattern.test(joined)) {
			rejections.push({
				recordId: record.id,
				code: "UNPROVEN_CAUSALITY_OVERCLAIM",
				detail:
					"A record asserted a proven causal mechanism that its evidence does not establish, and was dropped.",
			});
			return "REJECT";
		}
	}
	for (const pattern of COMPLETED_FINDING_PATTERNS) {
		if (pattern.test(joined)) {
			rejections.push({
				recordId: record.id,
				code: "UNRESOLVED_INVESTIGATION_PROMOTED",
				detail:
					"A record promoted an investigation target into a completed finding, and was dropped.",
			});
			return "REJECT";
		}
	}
	return "ACCEPT";
}
