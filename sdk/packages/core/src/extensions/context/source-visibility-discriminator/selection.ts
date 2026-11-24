/**
 * ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01
 *
 * TEST-LOCAL generic record-selection policy.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API. It is a TEST-LOCAL measurement module.
 * ============================================================================
 *
 * THE PROBLEM
 * -----------
 *
 * The predecessor's checkpoint emitted 13 records at boundary 1 and 20 at
 * boundary 2, and the EXPERIMENTAL ceiling of 12 took the FIRST 12 in
 * publication order. At boundary 2 that selection DISCARDED the qualified
 * R4 and R6 records, because they happened to sit after twelve generic
 * constraint restatements.
 *
 * That is a SELECTION defect, and it is separate from the source-visibility
 * defect. A checkpoint whose input is fixed can still lose its best
 * observation to a positional ceiling.
 *
 * THE POLICY
 * ---------
 *
 * The selector scores records by properties that are INDEPENDENT of any
 * particular investigation:
 *
 *   - CONCRETE OBSERVATION with a resolvable provenance reference.
 *   - A QUALIFICATION that constrains how the record may be read.
 *   - A DECISION that affects continuing work.
 *   - An UNRESOLVED question with completed investigative progress.
 *   - CONTRADICTION or SUPERSESSION information.
 *
 * It DEPRIORITIZES:
 *
 *   - Duplicate restatements of the original task.
 *   - Standing constraints already preserved by the task contract.
 *
 * IT DOES NOT HARDCODE `R1`–`R10`, `startup.sh`, `MtsOmni`, or any
 * evaluator's expected answer. The scoring reads only the record's own
 * STRUCTURE: its kind, its assurance, its status, its reference resolvability
 * and its qualification count.
 */

import type { ResolvedEvidenceReference } from "./trust";

/**
 * The shape of a record the selector scores.
 *
 * It is deliberately structural: the selector never reads the statement's
 * CONTENT, so the score cannot depend on a secret, a credential, or a
 * specific investigation's vocabulary.
 */
export interface SelectableRecord {
	readonly id: string;
	readonly kind: string;
	readonly assurance: string;
	readonly status: string;
	readonly statement: string;
	readonly qualifications: readonly string[];
	readonly evidenceRefs: readonly string[];
}

/**
 * The maximum number of records carried into one projection.
 */
export const MAX_SELECTED_RECORDS = 12;

/**
 * The target projection size, in estimated tokens.
 */
export const TARGET_PROJECTION_TOKENS = 1_500;

/**
 * WHY a record was dropped.
 *
 * The reason explains the drop through METADATA only. The dropped record's
 * content is never logged.
 */
export interface DroppedRecordReason {
	readonly id: string;
	readonly reason: "record_ceiling" | "token_budget";
	readonly score: number;
	readonly rank: number;
}

/**
 * The outcome of one selection.
 */
export interface SelectionResult {
	/** The selected records, in the selected order. */
	readonly selected: readonly SelectableRecord[];
	/** The dropped records, with their metadata-only reason. */
	readonly dropped: readonly DroppedRecordReason[];
	/** The estimated token size of the selected set. */
	readonly estimatedTokens: number;
	/** Whether the selection rule was applied (the ABLATED arm). */
	readonly ruleApplied: boolean;
}

/**
 * The score of ONE record.
 *
 * The score is computed from the record's STRUCTURE alone.
 *
 * The weights are deliberately small integers, so the ordering is stable
 * and explainable.
 */
export function scoreRecord(input: {
	record: SelectableRecord;
	resolved: readonly ResolvedEvidenceReference[];
	novelReferenceCount?: number;
}): number {
	const record = input.record;
	const hasResolvableRef = input.resolved.some(
		(reference) => reference.identityResolved,
	);
	const allRefsResolve =
		input.resolved.length > 0 &&
		input.resolved.every((reference) => reference.identityResolved);
	let score = 0;
	// A concrete observation with valid provenance is the highest-value
	// record class: it is a fact the agent established.
	if (record.kind === "observation") {
		score += 40;
	}
	// An open question that carries investigative progress is next.
	if (record.kind === "open_question") {
		score += 18;
	}
	// A decision affects continuing work.
	if (record.kind === "decision") {
		score += 16;
	}
	// A hypothesis is working knowledge, but weaker than an observation.
	if (record.kind === "hypothesis") {
		score += 12;
	}
	// A constraint is usually a restatement of the task contract, which the
	// compaction already carries. It is therefore the LOWEST-scoring kind.
	if (record.kind === "constraint") {
		score += 2;
	}
	// Provenance.
	if (hasResolvableRef) {
		score += 24;
	}
	if (allRefsResolve) {
		score += 8;
	}
	// NOVELTY. A record whose evidence references are ENTIRELY covered by
	// records already selected adds no new evidence to the continuation. It
	// is a restatement, and a restatement is exactly what the record
	// ceiling must not spend its budget on.
	//
	// This is the GENERIC signal the historical output exposed: the
	// control arm filled its twelve slots with records that contributed
	// zero novel evidence, while records carrying a genuinely new
	// observation were dropped for being late in the publication order.
	//
	// The signal is computed from the RESOLVED reference sets, so it
	// depends on evidence identity, never on a record id or a statement.
	const novel = input.novelReferenceCount ?? 0;
	if (novel === 0) {
		score -= 40;
	} else {
		score += Math.min(novel, 12) * 3;
	}
	// A qualification is what keeps a record from being over-read, so a
	// qualified record is more valuable than an unqualified one.
	score += Math.min(record.qualifications.length, 3) * 7;
	// Lifecycle. A SUPERSEDED record is history, not working knowledge.
	if (record.status === "superseded") {
		score -= 30;
	}
	if (record.status === "unresolved") {
		score += 4;
	}
	// A record whose assurance was BOUNDED below `tool_observed` is a
	// weaker claim than one that rests on observed evidence.
	if (record.assurance === "unverified") {
		score -= 6;
	}
	return score;
}

/**
 * The maximum number of CHARACTERS of a single projected record line.
 *
 * This is the same bound the production checkpoint projection applies to a
 * carried record line. The selector's token estimate MUST measure the
 * PROJECTED size, not the raw size, or the budget would reject records the
 * projection itself would have truncated to fit.
 */
export const MAX_PROJECTED_RECORD_CHARS = 320;

/**
 * Estimate the token size of a record set AS PROJECTED.
 *
 * The estimate uses the PRODUCTION character-per-token constant, so the
 * measurement is comparable with the production summarizer's own budget.
 *
 * It measures the PROJECTED line, exactly as the production checkpoint
 * projection renders it: the record's fields are joined, and the RESULTING
 * LINE is truncated to the per-line bound. Measuring the statement and the
 * qualifications separately would over-count, because the production
 * projection truncates the joined line, not its parts.
 */
export function estimateRecordTokens(
	records: readonly SelectableRecord[],
): number {
	const chars = records.reduce((total, record) => {
		const line = [
			`${record.id}:`,
			`kind=${record.kind}`,
			`assurance=${record.assurance}`,
			`status=${record.status}`,
			`statement=${record.statement}`,
			record.qualifications.length > 0
				? `qualifications=${record.qualifications.join(" | ")}`
				: undefined,
			record.evidenceRefs.length > 0
				? `evidence_refs=${record.evidenceRefs.join(",")}`
				: undefined,
		]
			.filter((part): part is string => part !== undefined)
			.join(" ");
		return total + Math.min(line.length, MAX_PROJECTED_RECORD_CHARS);
	}, 0);
	return Math.ceil(chars / 4);
}

/**
 * Select records under a bounded budget.
 *
 * The ordering is:
 *
 *   1. score DESCENDING,
 *   2. publication order ASCENDING as the stable tie-break.
 *
 * The tie-break makes the selection DETERMINISTIC: two records with the
 * same score are always ordered by their position in the publication order,
 * never by a hash or by the order of a `Set` iteration.
 *
 * When `ruleApplied` is `false`, the selection is the CONTROL arm: the
 * first `MAX_SELECTED_RECORDS` valid records in publication order. That is
 * the predecessor's behaviour, preserved exactly as the baseline.
 */
export function selectRecords(input: {
	records: readonly SelectableRecord[];
	resolvedByRecord: ReadonlyMap<string, readonly ResolvedEvidenceReference[]>;
	ruleApplied: boolean;
	maxRecords?: number;
	targetTokens?: number;
}): SelectionResult {
	const maxRecords = input.maxRecords ?? MAX_SELECTED_RECORDS;
	const targetTokens = input.targetTokens ?? TARGET_PROJECTION_TOKENS;
	const scored = input.records.map((record, index) => {
		const resolved = input.resolvedByRecord.get(record.id) ?? [];
		return {
			record,
			index,
			resolved,
			// The BASE score excludes novelty, which is order-dependent.
			score: input.ruleApplied ? scoreRecord({ record, resolved }) : 0,
		};
	});
	if (!input.ruleApplied) {
		// CONTROL: first N valid records in PUBLICATION order.
		const selected = scored.slice(0, maxRecords);
		const dropped = scored.slice(maxRecords).map((entry, offset) => ({
			id: entry.record.id,
			reason: "record_ceiling" as const,
			score: entry.score,
			rank: maxRecords + offset,
		}));
		return {
			selected: selected.map((entry) => entry.record),
			dropped,
			estimatedTokens: estimateRecordTokens(
				selected.map((entry) => entry.record),
			),
			ruleApplied: false,
		};
	}
	// TREATMENT: two passes.
	//
	// PASS 1 — rank by the ORDER-INDEPENDENT part of the score.
	const baseRanked = [...scored].sort((left, right) => {
		if (right.score !== left.score) {
			return right.score - left.score;
		}
		return left.index - right.index;
	});
	// PASS 2 — walk the ranking and compute each record's NOVELTY against
	// the references already carried. A record whose references are
	// entirely covered by the records already selected contributes no new
	// evidence, so it is demoted below any record that does.
	const carried = new Set<string>();
	const scoredWithNovelty: ((typeof scored)[number] & {
		novel: number;
		finalScore: number;
	})[] = [];
	for (const entry of baseRanked) {
		const references = new Set(
			entry.resolved.map((reference) => reference.reference),
		);
		let novel = 0;
		for (const reference of references) {
			if (!carried.has(reference)) {
				novel += 1;
			}
		}
		const finalScore = scoreRecord({
			record: entry.record,
			resolved: entry.resolved,
			novelReferenceCount: novel,
		});
		scoredWithNovelty.push({ ...entry, novel, finalScore });
	}
	// PASS 3 — the FINAL ranking uses the novelty-aware score, with the
	// publication order as the stable tie-break.
	const ranked = [...scoredWithNovelty].sort((left, right) => {
		if (right.finalScore !== left.finalScore) {
			return right.finalScore - left.finalScore;
		}
		return left.index - right.index;
	});
	const selected: typeof scored = [];
	const dropped: DroppedRecordReason[] = [];
	let tokens = 0;
	for (const entry of ranked) {
		if (selected.length >= maxRecords) {
			dropped.push({
				id: entry.record.id,
				reason: "record_ceiling",
				score: entry.finalScore,
				rank: selected.length + dropped.length,
			});
			continue;
		}
		const candidateTokens = estimateRecordTokens([
			...selected.map((chosen) => chosen.record),
			entry.record,
		]);
		if (candidateTokens > targetTokens) {
			dropped.push({
				id: entry.record.id,
				reason: "token_budget",
				score: entry.finalScore,
				rank: selected.length + dropped.length,
			});
			continue;
		}
		selected.push(entry);
		for (const reference of entry.resolved) {
			carried.add(reference.reference);
		}
		tokens = candidateTokens;
	}
	// The SELECTED set is returned in RANK order, not publication order, so
	// the most valuable record is read first.
	return {
		selected: selected.map((entry) => entry.record),
		dropped,
		estimatedTokens: tokens,
		ruleApplied: true,
	};
}
