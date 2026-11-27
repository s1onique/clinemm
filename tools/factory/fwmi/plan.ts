/**
 * tools/factory/fwmi/plan.ts
 *
 * THE ADAPTER. Deterministic translation of a validated FWMI v1 package into
 * the ClineMM canonical ledger records and the historical archive index.
 *
 * The adapter is the SMALLEST thing that can do the job:
 *
 *   - It reuses the EXISTING canonical store (`docs/closure-plans/*.json`)
 *     and the EXISTING historical archive index. It does NOT define a
 *     second canonical data model.
 *   - It is a PURE FUNCTION of the package. The same package always
 *     yields the same plan; the plan is fully materialised in memory so an
 *     exact replay can be proven byte-for-byte.
 *   - It NEVER promotes authority. A historical qualification assertion is
 *     carried as an assertion. A `SOURCE_RECONCILIATION_READY` verdict is
 *     carried as a reconciliation state, never as an acceptance.
 */

import {
	type FwmiEpic,
	type FwmiItem,
	type FwmiPackage,
	type FwmiRelationship,
	type FwmiSourceRef,
	isPrerequisiteKind,
} from "./contract.ts";
import { sha256Hex } from "./digest.ts";
import { scopedItemId } from "./validate.ts";

/** A cross-link carried into the ledger record. */
export interface FwmiCrossLinkRecord {
	readonly kind: string;
	readonly target: string;
	readonly required_outcome?: string;
	/**
	 * True only for `DEPENDS_ON`. A cross-link NEVER owns an obligation:
	 * the target record remains the sole authority over its own work.
	 */
	readonly carries_obligation: boolean;
}

/** The migration-specific payload of an imported ledger record. */
export interface FwmiMigrationBlock {
	readonly source_kind: "epic" | "work_item";
	readonly source_epic_id: string;
	readonly source_item_id: string | null;
	/** The scoped canonical identity: `<epic>/<item>`. */
	readonly scoped_id: string;
	readonly title: string;
	readonly description: string;
	readonly workstream: string | null;
	/** The source's own status token, verbatim. */
	readonly original_status: string | null;
	readonly lifecycle: string;
	readonly priority: string | null;
	readonly criteria: readonly string[];
	readonly criteria_coverage: string;
	readonly dependencies: readonly string[];
	readonly dependency_coverage: string;
	readonly blockers: readonly string[];
	readonly current_act: string | null;
	readonly related_acts: readonly string[];
	readonly evidence_locators: readonly string[];
	readonly reopen_conditions: readonly string[];
	readonly cross_links: readonly FwmiCrossLinkRecord[];
	readonly source_refs: readonly FwmiSourceRef[];
	/** The interchange package identity this record was imported from. */
	readonly interchange_package_id: string;
	readonly interchange_source_head: string;
}

/**
 * The acceptance block.
 *
 * `state` is deliberately NOT "accepted": an imported qualification
 * assertion is a historical source assertion, and this ACT does not verify
 * it. `NOT_VERIFIED_BY_IMPORT` is the only state this importer may write.
 */
export interface FwmiAcceptanceBlock {
	readonly state: "NOT_VERIFIED_BY_IMPORT";
	/** The producer's historical qualification assertion, carried verbatim. */
	readonly source_qualification: string;
	/** The interchange verdict, as a reconciliation state. Never approval. */
	readonly interchange_reconciliation_state: string | null;
	readonly note: string;
}

/**
 * The canonical ledger record this adapter writes.
 *
 * It extends the EXISTING closure-plan shape (see
 * `docs/closure-plans/*.json`) rather than replacing it: the existing
 * `contract_version` / `act_id` / `parent` / `verdict` / `verdict_basis`
 * fields are preserved, and the migration-specific payload is namespaced
 * under `migration` so a reader can always tell imported records from
 * repository-native ones.
 */
export interface LedgerRecord {
	readonly contract_version: number;
	readonly act_id: string;
	readonly parent: string | null;
	/** The ORIGINAL verdict. Preserved verbatim; never promoted. */
	readonly verdict: string | null;
	readonly verdict_basis: string | null;
	readonly migration: FwmiMigrationBlock;
	readonly acceptance: FwmiAcceptanceBlock;
}

/** Where a planned record will be written. */
export interface LedgerTarget {
	/** Repository-relative path of the ledger record. */
	readonly path: string;
	/** The record's canonical identity. */
	readonly act_id: string;
	readonly kind: "epic" | "work_item";
}

/**
 * The historical archive index entry.
 *
 * The EXISTING archive index is the board's historical census plus the
 * per-epic ACT ledgers. An imported entry is an INDEX ENTRY: it makes a
 * historical ACT discoverable with its original disposition and source
 * material. It does NOT re-assert the ACT's verdict as current evidence.
 */
export interface ArchiveIndexEntry {
	readonly act_id: string;
	readonly original_verdict: string | null;
	readonly epic_id: string | null;
	readonly work_item_ids: readonly string[];
	readonly evidence_locators: readonly string[];
	readonly source_refs: readonly FwmiSourceRef[];
	readonly reconciliation: string;
	/** True when the source could not resolve this record. Preserved, not dropped. */
	readonly unresolved: boolean;
}

/** One entry of the deterministic import plan. */
export interface PlanEntry {
	readonly target: LedgerTarget;
	readonly record: LedgerRecord;
	/** The serialized bytes this record will occupy on disk. */
	readonly content: string;
	/** SHA-256 of `content` — the byte identity the replay check compares. */
	readonly contentSha256: string;
}

/** An entry for the historical archive index. */
export interface ArchivePlanEntry {
	readonly act_id: string;
	readonly entry: ArchiveIndexEntry;
	readonly content: string;
	readonly contentSha256: string;
}

/** The complete deterministic import plan. */
export interface ImportPlan {
	readonly packageId: string;
	readonly sourceHead: string;
	readonly entries: readonly PlanEntry[];
	readonly archiveEntries: readonly ArchivePlanEntry[];
	/** The reconciliation verdict carried from the producer. */
	readonly reconciliationVerdict: string;
	/**
	 * True when the producer asserted reconciliation readiness. This is NOT
	 * cutover approval; the plan never treats it as such.
	 */
	readonly reconciliationReady: boolean;
}

/**
 * The canonical ledger-record path for an imported identity.
 *
 * Imported records live in their OWN namespace under `docs/closure-plans/`
 * so they can never collide with a repository-native closure plan, and so
 * their provenance is visible in the filesystem listing.
 */
export function ledgerRecordPath(scopedId: string): string {
	return `docs/closure-plans/imported/${scopedId.replace(/\//g, "__")}.json`;
}

/**
 * Build the deterministic import plan.
 *
 * The plan is a PURE function of the package. It performs no I/O beyond
 * hashing the serialized records, so the same package always yields
 * byte-identical entries — which is what makes the exact-replay byte check
 * meaningful.
 */
export function buildImportPlan(pkg: FwmiPackage): ImportPlan {
	const packageId = pkg.manifest.source_head;
	const sourceHead = pkg.manifest.source_head;
	const reconciliationVerdict = pkg.receipt.verdict ?? "UNKNOWN";
	const reconciliationReady =
		reconciliationVerdict === "SOURCE_RECONCILIATION_READY";

	const entries: PlanEntry[] = [];
	for (const epic of pkg.epics) {
		// The epic itself is a ledger record: an epic is a durable
		// engineering container, not merely a grouping.
		entries.push(materialize(buildEpicRecord(pkg, epic), "epic", epic.epic_id));
		for (const item of epic.items ?? []) {
			const scoped = scopedItemId(epic.epic_id, item.item_id);
			entries.push(
				materialize(buildItemRecord(pkg, epic, item), "work_item", scoped),
			);
		}
	}

	const archiveEntries: ArchivePlanEntry[] = [];
	for (const rec of pkg.historicalIndex.records ?? []) {
		const entry: ArchiveIndexEntry = {
			act_id: rec.act_id,
			original_verdict: rec.original_verdict ?? null,
			epic_id: rec.epic_id ?? null,
			work_item_ids: [...(rec.work_item_ids ?? [])],
			evidence_locators: [...(rec.evidence_locators ?? [])],
			source_refs: [...(rec.source_refs ?? [])],
			reconciliation: rec.reconciliation,
			unresolved:
				rec.reconciliation === "AMBIGUOUS" ||
				rec.reconciliation === "CONFLICTING" ||
				rec.reconciliation === "UNRESOLVED",
		};
		const content = serializeJson(entry);
		archiveEntries.push({
			act_id: rec.act_id,
			entry,
			content,
			contentSha256: sha256Hex(content),
		});
	}

	return {
		packageId,
		sourceHead,
		entries,
		archiveEntries,
		reconciliationVerdict,
		reconciliationReady,
	};
}

/** Build the ledger record for an epic. */
function buildEpicRecord(pkg: FwmiPackage, epic: FwmiEpic): LedgerRecord {
	const migration: FwmiMigrationBlock = {
		source_kind: "epic",
		source_epic_id: epic.epic_id,
		source_item_id: null,
		scoped_id: epic.epic_id,
		title: epic.title,
		description: epic.title,
		workstream: null,
		original_status: epic.original_status ?? null,
		lifecycle: epic.lifecycle,
		priority: epic.priority ?? null,
		criteria: [...(epic.exit_criteria ?? [])],
		criteria_coverage: epic.exit_criteria?.length ? "COMPLETE" : "UNKNOWN",
		dependencies: [],
		dependency_coverage: "UNKNOWN",
		blockers: [],
		current_act: null,
		related_acts: [],
		evidence_locators: [],
		reopen_conditions: [],
		cross_links: toCrossLinks(epic.relationships ?? []),
		source_refs: [...(epic.source_refs ?? [])],
		interchange_package_id: pkg.manifest.source_head,
		interchange_source_head: pkg.manifest.source_head,
	};
	return {
		contract_version: 1,
		act_id: epic.epic_id,
		parent: null,
		verdict: null,
		verdict_basis: null,
		migration,
		acceptance: {
			state: "NOT_VERIFIED_BY_IMPORT",
			source_qualification: "UNKNOWN",
			interchange_reconciliation_state: pkg.receipt.verdict ?? null,
			note: "Epic metadata imported from the FWMI v1 interchange. The interchange verdict is a reconciliation state, not cutover approval.",
		},
	};
}

/** Build the ledger record for a work item (a persistent engineering obligation). */
function buildItemRecord(
	pkg: FwmiPackage,
	epic: FwmiEpic,
	item: FwmiItem,
): LedgerRecord {
	const scoped = scopedItemId(epic.epic_id, item.item_id);
	const dependencies = [...(item.dependencies ?? [])];
	// The authoritative dependency edges are the `DEPENDS_ON` relationships.
	// They are merged into the dependency list without DUPLICATING the
	// target's obligation: the target record keeps its own criteria and
	// status, and this record only records that it waits on it.
	const dependsOn = (item.relationships ?? [])
		.filter((r) => isPrerequisiteKind(r.kind))
		.map((r) => r.target)
		.filter((t) => !dependencies.includes(t));

	const migration: FwmiMigrationBlock = {
		source_kind: "work_item",
		source_epic_id: epic.epic_id,
		source_item_id: item.item_id,
		scoped_id: scoped,
		title: item.title,
		description: item.description,
		workstream: item.workstream ?? null,
		original_status: item.original_status ?? null,
		lifecycle: item.lifecycle,
		priority: item.priority ?? null,
		criteria: [...(item.criteria ?? [])],
		criteria_coverage: item.criteria_coverage,
		dependencies: [...dependencies, ...dependsOn],
		dependency_coverage: item.dependency_coverage,
		blockers: [...(item.blockers ?? [])],
		current_act: item.current_act ?? null,
		related_acts: [...(item.related_acts ?? [])],
		evidence_locators: [...(item.evidence_locators ?? [])],
		reopen_conditions: [...(item.reopen_conditions ?? [])],
		cross_links: toCrossLinks(item.relationships ?? []),
		source_refs: [...(item.source_refs ?? [])],
		interchange_package_id: pkg.manifest.source_head,
		interchange_source_head: pkg.manifest.source_head,
	};
	return {
		contract_version: 1,
		act_id: scoped,
		parent: epic.epic_id,
		// The ORIGINAL qualification assertion is preserved verbatim and
		// NEVER promoted. It is the source's assertion about this item.
		verdict: item.qualification ?? null,
		verdict_basis: null,
		migration,
		acceptance: {
			state: "NOT_VERIFIED_BY_IMPORT",
			// The producer's HISTORICAL qualification assertion, carried
			// verbatim. It is NOT a new acceptance decision.
			source_qualification: item.qualification,
			interchange_reconciliation_state: pkg.receipt.verdict ?? null,
			note: "Historical source qualification assertion imported verbatim. Not independently verified by this import; not an acceptance promotion.",
		},
	};
}

/**
 * Convert relationships into cross-link records.
 *
 * A cross-link NEVER carries an obligation. Only `DEPENDS_ON` does, and
 * even then only as "this record waits on that record" — the target keeps
 * the sole authority over its own obligation.
 */
function toCrossLinks(
	rels: readonly FwmiRelationship[],
): FwmiCrossLinkRecord[] {
	return rels.map((r) => ({
		kind: r.kind,
		target: r.target,
		...(r.required_outcome === undefined
			? {}
			: { required_outcome: r.required_outcome }),
		carries_obligation: isPrerequisiteKind(r.kind),
	}));
}

/** Materialize a plan entry: the record plus its exact serialized bytes. */
function materialize(
	record: LedgerRecord,
	kind: "epic" | "work_item",
	scopedId: string,
): PlanEntry {
	const content = serializeJson(record);
	return {
		target: { path: ledgerRecordPath(scopedId), act_id: scopedId, kind },
		record,
		content,
		contentSha256: sha256Hex(content),
	};
}

/**
 * Serialize a record to its canonical on-disk bytes.
 *
 * The serialization is DETERMINISTIC: two-space indent, stable key order
 * (the record's own construction order), a trailing newline. This is what
 * makes the exact-replay byte check meaningful — the same input must
 * produce the same bytes, and those bytes must match what is on disk.
 */
export function serializeJson(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}
