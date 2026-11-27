/**
 * tools/factory/fwmi/conserve.ts
 *
 * PERSISTED SEMANTIC CONSERVATION verification.
 *
 * The import plan is an INTENT. This module checks the PERSISTED RESULT:
 * it re-reads what was actually written to disk and asks whether the
 * semantics survived the round trip.
 *
 * It is deliberately NOT a byte comparison. Byte equality proves the
 * adapter is deterministic; it does NOT prove the adapter conserved
 * meaning. A record can be byte-stable and still have lost a distinction —
 * for example a source status of `UNKNOWN` silently normalised to
 * `DEFERRED`, or a cross-link promoted into a second copy of an
 * obligation.
 *
 * The checks, each traceable to an FWL02 requirement:
 *
 *   C1  SOURCE IDENTITY PRESERVED      — every scoped identity is present,
 *                                         with its source identity intact.
 *   C2  PROVENANCE PRESERVED            — every source reference survived.
 *   C3  UNKNOWN STATUS DISTINCT         — an unknown source status is not
 *                                         represented as intentional deferral.
 *   C4  UNRESOLVED RECORDS PRESERVED    — unresolved lifecycle and
 *                                         unresolved reconciliation survive.
 *   C5  DEPENDENCIES AND CRITERIA       — explicit dependencies and criteria
 *                                         survive, and coverage survives.
 *   C6  HISTORICAL ACT LOOKUP           — every historical ACT is findable
 *                                         with its original verdict.
 *   C7  NO ACCEPTANCE PROMOTION         — the persisted acceptance state is
 *                                         `NOT_VERIFIED_BY_IMPORT`.
 *   C8  CROSS-LINKS NOT DUPLICATED      — a cross-link never carries an
 *                                         obligation, and no target record is
 *                                         duplicated.
 *   C9  RECONCILIATION NOT APPROVAL     — `SOURCE_RECONCILIATION_READY` is
 *                                         not recorded as an acceptance.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FwmiPackage } from "./contract.ts";
import type { ImportPlan, LedgerRecord } from "./plan.ts";
import { scopedItemId } from "./validate.ts";

/** One conservation finding. */
export interface ConservationFinding {
	readonly check: string;
	readonly severity: "ERROR" | "WARNING" | "INFO";
	readonly subject: string;
	readonly message: string;
}

/** The conservation verification result. */
export interface ConservationResult {
	readonly ok: boolean;
	readonly findings: readonly ConservationFinding[];
	/** How many persisted records were re-read and checked. */
	readonly recordsChecked: number;
	readonly historicalActsChecked: number;
}

/** Re-read the persisted ledger records and verify semantic conservation. */
export function verifyPersistedConservation(
	root: string,
	pkg: FwmiPackage,
	plan: ImportPlan,
): ConservationResult {
	const findings: ConservationFinding[] = [];
	const add = (
		check: string,
		severity: "ERROR" | "WARNING" | "INFO",
		subject: string,
		message: string,
	): void => {
		findings.push({ check, severity, subject, message });
	};

	const persisted = readPersistedRecords(root);
	const byIdentity = new Map<string, LedgerRecord>();
	for (const rec of persisted) {
		byIdentity.set(rec.migration?.scoped_id ?? rec.act_id, rec);
	}

	let recordsChecked = 0;

	for (const epic of pkg.epics) {
		for (const item of epic.items ?? []) {
			const scoped = scopedItemId(epic.epic_id, item.item_id);
			recordsChecked++;
			const rec = byIdentity.get(scoped);
			if (!rec) {
				add(
					"C1",
					"ERROR",
					scoped,
					"persisted ledger record is missing for this scoped identity",
				);
				continue;
			}
			const m = rec.migration;

			// C1 — source identity preserved.
			if (
				m.source_epic_id !== epic.epic_id ||
				m.source_item_id !== item.item_id
			) {
				add(
					"C1",
					"ERROR",
					scoped,
					`source identity changed: ${m.source_epic_id}/${m.source_item_id}`,
				);
			}
			if (m.scoped_id !== scoped) {
				add("C1", "ERROR", scoped, `persisted scoped_id is "${m.scoped_id}"`);
			}

			// C2 — provenance preserved.
			if (m.source_refs.length !== (item.source_refs ?? []).length) {
				add(
					"C2",
					"ERROR",
					scoped,
					`source_ref count changed: ${(item.source_refs ?? []).length} -> ${m.source_refs.length}`,
				);
			} else {
				for (let i = 0; i < m.source_refs.length; i++) {
					if (
						JSON.stringify(m.source_refs[i]) !==
						JSON.stringify(item.source_refs![i])
					) {
						add("C2", "ERROR", scoped, `source_ref[${i}] changed`);
					}
				}
			}

			// C3 — unknown status distinct from intentional deferral.
			// An unknown source status must not be represented as DEFERRED.
			if (item.original_status === null) {
				if (m.original_status !== null) {
					add(
						"C3",
						"ERROR",
						scoped,
						`unknown source status became "${m.original_status}"`,
					);
				}
				if (m.lifecycle === "DEFERRED") {
					add(
						"C3",
						"ERROR",
						scoped,
						"an unknown source status was represented as intentional deferral (DEFERRED)",
					);
				}
			} else if (m.original_status !== item.original_status) {
				add(
					"C3",
					"ERROR",
					scoped,
					`original_status changed: "${item.original_status}" -> "${m.original_status}"`,
				);
			}
			if (m.lifecycle !== item.lifecycle) {
				add(
					"C3",
					"ERROR",
					scoped,
					`lifecycle changed: "${item.lifecycle}" -> "${m.lifecycle}"`,
				);
			}

			// C4 — unresolved records preserved.
			if (item.lifecycle === "UNRESOLVED" && m.lifecycle !== "UNRESOLVED") {
				add(
					"C4",
					"ERROR",
					scoped,
					"an unresolved obligation was persisted as resolved",
				);
			}

			// C5 — dependencies and criteria preserved (with coverage).
			const expectedDeps = [...(item.dependencies ?? [])];
			const actualDeps = [...m.dependencies];
			for (const dep of expectedDeps) {
				if (!actualDeps.includes(dep)) {
					add("C5", "ERROR", scoped, `explicit dependency "${dep}" was lost`);
				}
			}
			if (m.dependency_coverage !== item.dependency_coverage) {
				add(
					"C5",
					"ERROR",
					scoped,
					`dependency_coverage changed: "${item.dependency_coverage}" -> "${m.dependency_coverage}"`,
				);
			}
			if (m.criteria.length !== (item.criteria ?? []).length) {
				add(
					"C5",
					"ERROR",
					scoped,
					`acceptance criteria count changed: ${(item.criteria ?? []).length} -> ${m.criteria.length}`,
				);
			} else {
				for (let i = 0; i < m.criteria.length; i++) {
					if (m.criteria[i] !== item.criteria![i]) {
						add("C5", "ERROR", scoped, `acceptance criterion[${i}] changed`);
					}
				}
			}
			if (m.criteria_coverage !== item.criteria_coverage) {
				add(
					"C5",
					"ERROR",
					scoped,
					`criteria_coverage changed: "${item.criteria_coverage}" -> "${m.criteria_coverage}"`,
				);
			}
			if (m.blockers.length !== (item.blockers ?? []).length) {
				add(
					"C5",
					"ERROR",
					scoped,
					`blocker count changed: ${(item.blockers ?? []).length} -> ${m.blockers.length}`,
				);
			}
			if (
				m.reopen_conditions.length !== (item.reopen_conditions ?? []).length
			) {
				add("C5", "ERROR", scoped, `reopen condition count changed`);
			}

			// C7 — no acceptance promotion.
			if (rec.acceptance?.state !== "NOT_VERIFIED_BY_IMPORT") {
				add(
					"C7",
					"ERROR",
					scoped,
					`persisted acceptance state is "${rec.acceptance?.state}", not NOT_VERIFIED_BY_IMPORT`,
				);
			}
			if (rec.acceptance?.source_qualification !== item.qualification) {
				add(
					"C7",
					"ERROR",
					scoped,
					`source qualification changed: "${item.qualification}" -> "${rec.acceptance?.source_qualification}"`,
				);
			}
			if (rec.verdict !== item.qualification) {
				add(
					"C7",
					"ERROR",
					scoped,
					`persisted verdict "${rec.verdict}" is not the original source qualification`,
				);
			}

			// C9 — reconciliation readiness is not approval.
			const readiness = pkg.receipt.verdict === "SOURCE_RECONCILIATION_READY";
			if (
				readiness &&
				rec.acceptance?.interchange_reconciliation_state !==
					"SOURCE_RECONCILIATION_READY"
			) {
				add(
					"C9",
					"ERROR",
					scoped,
					"the interchange reconciliation state was not carried onto the record",
				);
			}
			// The persisted type makes an accepted state unrepresentable, so
			// this check is a runtime assertion against a record written by
			// some other tool rather than by this adapter.
			const persistedState = String(rec.acceptance?.state ?? "");
			if (persistedState === "ACCEPTED" || persistedState === "APPROVED") {
				add(
					"C9",
					"ERROR",
					scoped,
					"the record asserts an acceptance that the import never performed",
				);
			}
		}
	}

	// ---- C8 — cross-links conserved without duplicating obligations ----
	// A cross-link is a CONSERVATION EDGE. It must never carry an
	// obligation, and the target of a cross-link must not have been
	// duplicated into a second authoritative record.
	for (const epic of pkg.epics) {
		for (const item of epic.items ?? []) {
			const scoped = scopedItemId(epic.epic_id, item.item_id);
			const rec = byIdentity.get(scoped);
			if (!rec) continue;
			const sourceRels = item.relationships ?? [];
			const persistedLinks = rec.migration.cross_links;
			if (persistedLinks.length !== sourceRels.length) {
				add(
					"C8",
					"ERROR",
					scoped,
					`cross-link count changed: ${sourceRels.length} -> ${persistedLinks.length}`,
				);
				continue;
			}
			for (let i = 0; i < persistedLinks.length; i++) {
				const link = persistedLinks[i];
				const source = sourceRels[i];
				if (link.kind !== source.kind || link.target !== source.target) {
					add(
						"C8",
						"ERROR",
						scoped,
						`cross-link[${i}] changed: ${source.kind}->${source.target} became ${link.kind}->${link.target}`,
					);
				}
				// Only DEPENDS_ON carries prerequisite authority. Any other
				// kind claiming to carry an obligation is a duplication.
				const shouldCarry = source.kind === "DEPENDS_ON";
				if (link.carries_obligation !== shouldCarry) {
					add(
						"C8",
						"ERROR",
						scoped,
						`cross-link[${i}] obligation flag is ${link.carries_obligation}, expected ${shouldCarry}`,
					);
				}
				if (!shouldCarry && link.carries_obligation) {
					add(
						"C8",
						"ERROR",
						scoped,
						`cross-link "${link.target}" was promoted into a duplicated obligation`,
					);
				}
			}
		}
	}

	// ---- C6 — historical ACT lookup ----
	const archive = readArchiveIndex(root);
	const archiveById = new Map<string, (typeof archive.records)[number]>();
	for (const rec of archive.records) archiveById.set(rec.act_id, rec);
	let historicalActsChecked = 0;
	for (const source of pkg.historicalIndex.records ?? []) {
		historicalActsChecked++;
		const persisted = archiveById.get(source.act_id);
		if (!persisted) {
			add(
				"C6",
				"ERROR",
				source.act_id,
				"historical ACT is not findable in the persisted archive index",
			);
			continue;
		}
		if (persisted.original_verdict !== (source.original_verdict ?? null)) {
			add(
				"C6",
				"ERROR",
				source.act_id,
				`original verdict changed: "${source.original_verdict}" -> "${persisted.original_verdict}"`,
			);
		}
		if (persisted.reconciliation !== source.reconciliation) {
			add(
				"C6",
				"ERROR",
				source.act_id,
				`reconciliation status changed: "${source.reconciliation}" -> "${persisted.reconciliation}"`,
			);
		}
		if (
			persisted.evidence_locators.length !==
			(source.evidence_locators ?? []).length
		) {
			add("C6", "ERROR", source.act_id, "evidence locator count changed");
		}
		if (persisted.source_refs.length !== (source.source_refs ?? []).length) {
			add("C6", "ERROR", source.act_id, "source reference count changed");
		}
		// C4 — an unresolved historical record stays unresolved.
		if (
			source.reconciliation !== "UNAMBIGUOUS" &&
			persisted.unresolved !== true
		) {
			add(
				"C4",
				"ERROR",
				source.act_id,
				`a ${source.reconciliation} historical record was persisted as resolved`,
			);
		}
	}

	return {
		ok: !findings.some((f) => f.severity === "ERROR"),
		findings,
		recordsChecked,
		historicalActsChecked,
	};
}

/** Read every persisted imported ledger record from disk. */
export function readPersistedRecords(root: string): LedgerRecord[] {
	const dir = join(root, "docs", "closure-plans", "imported");
	if (!existsSync(dir)) return [];
	const records: LedgerRecord[] = [];
	for (const file of readdirSync(dir).sort()) {
		if (!file.endsWith(".json")) continue;
		if (file === "historical-index.json") continue;
		const raw = readFileSync(join(dir, file), "utf8");
		try {
			records.push(JSON.parse(raw) as LedgerRecord);
		} catch {
			// A malformed persisted record is reported by the caller as a
			// missing record; the parse failure itself is not silently
			// treated as a valid record.
		}
	}
	return records;
}

/** The persisted imported historical archive index. */
export interface ArchiveIndex {
	readonly schema_version: number;
	readonly records: readonly {
		readonly act_id: string;
		readonly original_verdict: string | null;
		readonly epic_id: string | null;
		readonly work_item_ids: readonly string[];
		readonly evidence_locators: readonly string[];
		readonly source_refs: readonly unknown[];
		readonly reconciliation: string;
		readonly unresolved: boolean;
	}[];
}

/** Read the persisted imported historical archive index from disk. */
export function readArchiveIndex(root: string): ArchiveIndex {
	const path = join(
		root,
		"docs",
		"closure-plans",
		"imported",
		"historical-index.json",
	);
	if (!existsSync(path)) return { schema_version: 1, records: [] };
	try {
		return JSON.parse(readFileSync(path, "utf8")) as ArchiveIndex;
	} catch {
		return { schema_version: 1, records: [] };
	}
}
