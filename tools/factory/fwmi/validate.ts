/**
 * tools/factory/fwmi/validate.ts
 *
 * STRICT semantic validation of an FWMI v1 interchange package.
 *
 * The validator answers exactly one question: *may this package be imported
 * without losing or inventing meaning?* Every check below corresponds to a
 * conservation obligation from the FWL02 brief.
 *
 * The validator NEVER repairs. A missing value is a finding, not a default.
 * A status outside the vocabulary is a finding, not a guess. A dependency
 * that resolves to nothing is a finding, not a dropped edge.
 *
 * Severity:
 *   ERROR   — the package must not be imported.
 *   WARNING — the package may be imported; the operator must see this.
 *   INFO    — recorded for the receipt.
 */

import {
	FWMI_ACT_RECONCILIATION,
	FWMI_COVERAGES,
	FWMI_LIFECYCLES,
	FWMI_QUALIFICATIONS,
	FWMI_RELATIONSHIP_KINDS,
	FWMI_RESOLUTIONS,
	type FwmiActReconciliation,
	type FwmiCoverage,
	type FwmiEpic,
	type FwmiItem,
	type FwmiLifecycle,
	type FwmiPackage,
	type FwmiQualification,
	type FwmiRelationshipKind,
} from "./contract.ts";

export type FwmiSeverity = "ERROR" | "WARNING" | "INFO";

/** One validation finding. */
export interface FwmiFinding {
	readonly severity: FwmiSeverity;
	readonly code: string;
	readonly subject: string;
	readonly message: string;
}

/** The outcome of validating a package. */
export interface FwmiValidationResult {
	readonly ok: boolean;
	readonly findings: readonly FwmiFinding[];
	readonly stats: FwmiValidationStats;
}

/** Counts the operator and the receipt both want. */
export interface FwmiValidationStats {
	readonly epicCount: number;
	readonly itemCount: number;
	readonly openCount: number;
	readonly activeCount: number;
	readonly blockedCount: number;
	readonly deferredCount: number;
	readonly terminalCount: number;
	readonly unresolvedCount: number;
	readonly historicalActCount: number;
	readonly dependencyCount: number;
	readonly crossLinkCount: number;
	readonly unresolvedConflictCount: number;
	readonly unknownOriginalStatusCount: number;
	readonly unknownQualificationCount: number;
	readonly unknownCoverageCount: number;
}

/** The canonical scoped identity of a work item: `<epic>/<item>`. */
export function scopedItemId(epicId: string, itemId: string): string {
	return `${epicId}/${itemId}`;
}

const HEX64 = /^[0-9a-f]{64}$/;
const GIT_BLOB = /^[0-9a-f]{40,64}$/;

/**
 * Validate a loaded package.
 *
 * The returned `ok` is `true` only when there are ZERO `ERROR` findings.
 * `WARNING` findings do not block an import, but they are surfaced in the
 * receipt and in the CLI output — an import that silently dropped 36
 * deferred-vs-unknown distinctions is exactly the failure mode this ACT
 * exists to prevent.
 */
export function validateFwmiPackage(pkg: FwmiPackage): FwmiValidationResult {
	const findings: FwmiFinding[] = [];
	const add = (
		severity: FwmiSeverity,
		code: string,
		subject: string,
		message: string,
	): void => {
		findings.push({ severity, code, subject, message });
	};

	// ---------- manifest ----------
	const manifest = pkg.manifest;
	if (
		typeof manifest.repository !== "string" ||
		manifest.repository.length === 0
	) {
		add(
			"ERROR",
			"MANIFEST_REPOSITORY_MISSING",
			"source-manifest.json",
			"repository must be a non-empty string",
		);
	}
	if (
		typeof manifest.source_head !== "string" ||
		!GIT_BLOB.test(manifest.source_head)
	) {
		add(
			"ERROR",
			"MANIFEST_SOURCE_HEAD_INVALID",
			"source-manifest.json",
			`source_head must be a full commit id, got ${JSON.stringify(manifest.source_head)}`,
		);
	}
	if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
		add(
			"ERROR",
			"MANIFEST_FILES_MISSING",
			"source-manifest.json",
			"files must be a non-empty array",
		);
	} else {
		const seenPaths = new Set<string>();
		for (const f of manifest.files) {
			const subject = f?.path ?? "<unnamed>";
			if (typeof f.path !== "string" || f.path.length === 0) {
				add(
					"ERROR",
					"MANIFEST_FILE_PATH_MISSING",
					subject,
					"manifest file entry needs a path",
				);
				continue;
			}
			if (seenPaths.has(f.path)) {
				add(
					"ERROR",
					"MANIFEST_DUPLICATE_PATH",
					f.path,
					"manifest lists the same path twice",
				);
			}
			seenPaths.add(f.path);
			if (!HEX64.test(f.sha256)) {
				add(
					"ERROR",
					"MANIFEST_SHA256_INVALID",
					f.path,
					`sha256 must be 64 lowercase hex chars, got ${JSON.stringify(f.sha256)}`,
				);
			}
			if (typeof f.bytes !== "number" || f.bytes < 0) {
				add(
					"ERROR",
					"MANIFEST_BYTES_INVALID",
					f.path,
					"bytes must be a non-negative number",
				);
			}
			if (typeof f.lines !== "number" || f.lines < 0) {
				add(
					"ERROR",
					"MANIFEST_LINES_INVALID",
					f.path,
					"lines must be a non-negative number",
				);
			}
			if (typeof f.git_blob !== "string" || !GIT_BLOB.test(f.git_blob)) {
				add(
					"ERROR",
					"MANIFEST_GIT_BLOB_INVALID",
					f.path,
					`git_blob must be a git object id, got ${JSON.stringify(f.git_blob)}`,
				);
			}
			if (typeof f.disposition !== "string" || f.disposition.length === 0) {
				add(
					"ERROR",
					"MANIFEST_DISPOSITION_MISSING",
					f.path,
					"every manifest file needs an explicit disposition",
				);
			}
		}
	}

	// ---------- epics ----------
	const epicIds = new Set<string>();
	const itemScopes = new Set<string>();
	/** Every identity a dependency / cross-link may legally target. */
	const knownIdentities = new Set<string>();
	/** Items grouped by epic for cross-epic resolution. */
	const itemsByEpic = new Map<string, FwmiItem[]>();

	let open = 0;
	let active = 0;
	let blocked = 0;
	let deferred = 0;
	let terminal = 0;
	let unresolved = 0;
	let dependencyCount = 0;
	let crossLinkCount = 0;
	let unknownOriginalStatus = 0;
	let unknownQualification = 0;
	let unknownCoverage = 0;
	/** Cross-link counter, shared with the relationship helper. */
	const crossLinkCountRef: Counter = { value: 0 };

	for (const epic of pkg.epics) {
		const epicId = epic.epic_id;
		if (typeof epicId !== "string" || epicId.length === 0) {
			add(
				"ERROR",
				"EPIC_ID_MISSING",
				"<unnamed>",
				"epic_id must be a non-empty string",
			);
			continue;
		}
		if (epicIds.has(epicId)) {
			add(
				"ERROR",
				"EPIC_ID_DUPLICATE",
				epicId,
				"epic_id is not unique across the package",
			);
		}
		epicIds.add(epicId);
		knownIdentities.add(epicId);

		if (typeof epic.title !== "string" || epic.title.length === 0) {
			add(
				"ERROR",
				"EPIC_TITLE_MISSING",
				epicId,
				"title must be a non-empty string",
			);
		}
		if (!FWMI_LIFECYCLES.includes(epic.lifecycle as FwmiLifecycle)) {
			add(
				"ERROR",
				"EPIC_LIFECYCLE_INVALID",
				epicId,
				`lifecycle ${JSON.stringify(epic.lifecycle)} is outside the FWMI v1 vocabulary`,
			);
		}
		if (!Array.isArray(epic.exit_criteria)) {
			add(
				"ERROR",
				"EPIC_EXIT_CRITERIA_INVALID",
				epicId,
				"exit_criteria must be an array",
			);
		}
		validateSourceRefs(epic.source_refs, epicId, add);
		validateRelationships(epic.relationships, epicId, add, crossLinkCountRef);

		const epicItems: FwmiItem[] = [];
		itemsByEpic.set(epicId, epicItems);

		if (!Array.isArray(epic.items)) {
			add("ERROR", "EPIC_ITEMS_INVALID", epicId, "items must be an array");
			continue;
		}
		for (const item of epic.items) {
			const scope = scopedItemId(epicId, item?.item_id ?? "<unnamed>");
			if (typeof item.item_id !== "string" || item.item_id.length === 0) {
				add(
					"ERROR",
					"ITEM_ID_MISSING",
					scope,
					"item_id must be a non-empty string",
				);
				continue;
			}
			if (itemScopes.has(scope)) {
				add(
					"ERROR",
					"ITEM_ID_DUPLICATE",
					scope,
					"scoped item identity is not unique",
				);
			}
			itemScopes.add(scope);
			knownIdentities.add(scope);
			epicItems.push(item);

			// --- title / description ---
			if (typeof item.title !== "string" || item.title.length === 0) {
				add(
					"ERROR",
					"ITEM_TITLE_MISSING",
					scope,
					"title must be a non-empty string",
				);
			}
			if (typeof item.description !== "string") {
				add(
					"ERROR",
					"ITEM_DESCRIPTION_MISSING",
					scope,
					"description must be a string",
				);
			} else if (
				item.description.length === 0 &&
				item.lifecycle !== "TERMINAL"
			) {
				// A non-terminal obligation with no description is an obligation
				// nobody can act on — that is the E8/E9 defect the migration
				// was explicitly asked to fix.
				add(
					"ERROR",
					"ITEM_DESCRIPTION_EMPTY",
					scope,
					"a non-terminal obligation must carry a meaningful description",
				);
			}

			// --- lifecycle ---
			if (!FWMI_LIFECYCLES.includes(item.lifecycle as FwmiLifecycle)) {
				add(
					"ERROR",
					"ITEM_LIFECYCLE_INVALID",
					scope,
					`lifecycle ${JSON.stringify(item.lifecycle)} is outside the FWMI v1 vocabulary`,
				);
			}
			switch (item.lifecycle) {
				case "OPEN":
					open++;
					break;
				case "ACTIVE":
					active++;
					break;
				case "BLOCKED":
					blocked++;
					break;
				case "DEFERRED":
					deferred++;
					break;
				case "TERMINAL":
					terminal++;
					break;
				case "UNRESOLVED":
					unresolved++;
					break;
				default:
					break;
			}

			// --- original_status: UNKNOWN status must not become DEFERRED ---
			if (item.original_status === null) {
				unknownOriginalStatus++;
			} else if (
				typeof item.original_status !== "string" ||
				item.original_status.length === 0
			) {
				add(
					"ERROR",
					"ITEM_ORIGINAL_STATUS_INVALID",
					scope,
					"original_status must be a non-empty string or null",
				);
			}

			// --- qualification: historical assertion, never promoted ---
			if (
				!FWMI_QUALIFICATIONS.includes(item.qualification as FwmiQualification)
			) {
				add(
					"ERROR",
					"ITEM_QUALIFICATION_INVALID",
					scope,
					`qualification ${JSON.stringify(item.qualification)} is outside the FWMI v1 vocabulary`,
				);
			}
			if (item.qualification === "UNKNOWN") unknownQualification++;

			// --- coverage ---
			if (!FWMI_COVERAGES.includes(item.criteria_coverage as FwmiCoverage)) {
				add(
					"ERROR",
					"ITEM_CRITERIA_COVERAGE_INVALID",
					scope,
					`criteria_coverage ${JSON.stringify(item.criteria_coverage)} is outside the FWMI v1 vocabulary`,
				);
			} else if (item.criteria_coverage !== "COMPLETE") {
				unknownCoverage++;
			}
			if (!FWMI_COVERAGES.includes(item.dependency_coverage as FwmiCoverage)) {
				add(
					"ERROR",
					"ITEM_DEPENDENCY_COVERAGE_INVALID",
					scope,
					`dependency_coverage ${JSON.stringify(item.dependency_coverage)} is outside the FWMI v1 vocabulary`,
				);
			}
			// The load-bearing coverage distinction: an empty dependency list
			// with UNKNOWN coverage means "not recovered", NOT "none exist".
			if (
				item.dependencies.length === 0 &&
				item.dependency_coverage === "COMPLETE"
			) {
				add(
					"INFO",
					"DEPENDENCY_SET_EMPTY_COMPLETE",
					scope,
					"no dependencies, coverage COMPLETE (source asserts there are none)",
				);
			}
			if (
				item.dependencies.length === 0 &&
				item.dependency_coverage === "UNKNOWN"
			) {
				add(
					"WARNING",
					"DEPENDENCY_SET_EMPTY_UNKNOWN",
					scope,
					"dependencies not recovered; an empty list here does NOT mean no dependencies exist",
				);
			}
			if (item.criteria.length === 0 && item.criteria_coverage === "COMPLETE") {
				add(
					"INFO",
					"CRITERIA_SET_EMPTY_COMPLETE",
					scope,
					"no acceptance criteria, coverage COMPLETE",
				);
			}
			if (
				item.criteria.length === 0 &&
				item.criteria_coverage === "UNKNOWN" &&
				item.lifecycle !== "TERMINAL"
			) {
				add(
					"WARNING",
					"CRITERIA_SET_EMPTY_UNKNOWN",
					scope,
					"acceptance criteria not recovered; an empty list here does NOT mean no criteria exist",
				);
			}

			// --- dependencies ---
			if (!Array.isArray(item.dependencies)) {
				add(
					"ERROR",
					"ITEM_DEPENDENCIES_INVALID",
					scope,
					"dependencies must be an array",
				);
			} else {
				dependencyCount += item.dependencies.length;
				for (const dep of item.dependencies) {
					if (typeof dep !== "string" || dep.length === 0) {
						add(
							"ERROR",
							"ITEM_DEPENDENCY_INVALID",
							scope,
							"dependency target must be a non-empty string",
						);
					}
				}
			}
			if (!Array.isArray(item.blockers)) {
				add(
					"ERROR",
					"ITEM_BLOCKERS_INVALID",
					scope,
					"blockers must be an array",
				);
			}
			if (
				item.blockers.length > 0 &&
				item.lifecycle !== "BLOCKED" &&
				item.lifecycle !== "UNRESOLVED"
			) {
				add(
					"WARNING",
					"BLOCKER_WITHOUT_BLOCKED_LIFECYCLE",
					scope,
					`lifecycle ${item.lifecycle} carries ${item.blockers.length} blocker(s); a blocked obligation should be BLOCKED or UNRESOLVED`,
				);
			}

			// --- ACT references ---
			if (item.current_act !== null && typeof item.current_act !== "string") {
				add(
					"ERROR",
					"ITEM_CURRENT_ACT_INVALID",
					scope,
					"current_act must be a string or null",
				);
			}
			if (!Array.isArray(item.related_acts)) {
				add(
					"ERROR",
					"ITEM_RELATED_ACTS_INVALID",
					scope,
					"related_acts must be an array",
				);
			}
			if (!Array.isArray(item.evidence_locators)) {
				add(
					"ERROR",
					"ITEM_EVIDENCE_LOCATORS_INVALID",
					scope,
					"evidence_locators must be an array",
				);
			}
			if (!Array.isArray(item.reopen_conditions)) {
				add(
					"ERROR",
					"ITEM_REOPEN_CONDITIONS_INVALID",
					scope,
					"reopen_conditions must be an array",
				);
			}

			validateSourceRefs(item.source_refs, scope, add);
			validateRelationships(item.relationships, scope, add, crossLinkCountRef);
		}
	}

	// ---------- cross-epic dependency / cross-link resolution ----------
	// A dependency target must resolve to a known identity (an epic, a
	// scoped item, or an ACT). An unresolvable target is an ERROR unless the
	// reconciliation manifest explicitly accounts for it — otherwise an
	// edge would be silently dropped on import.
	const accounted = new Set<string>();
	for (const rec of pkg.reconciliation.records ?? []) {
		for (const id of rec.identities ?? []) accounted.add(id);
	}
	for (const [epicId, epicItems] of itemsByEpic) {
		for (const item of epicItems) {
			const scope = scopedItemId(epicId, item.item_id);
			for (const dep of item.dependencies ?? []) {
				if (knownIdentities.has(dep)) continue;
				if (accounted.has(dep)) {
					add(
						"WARNING",
						"DEPENDENCY_UNRESOLVED_ACCOUNTED",
						scope,
						`dependency "${dep}" does not resolve but is accounted for in the reconciliation manifest`,
					);
					continue;
				}
				add(
					"ERROR",
					"DEPENDENCY_UNRESOLVED",
					scope,
					`dependency "${dep}" resolves to no known epic, scoped item or ACT`,
				);
			}
			for (const rel of item.relationships ?? []) {
				if (
					rel.kind === "CROSS_LINK" ||
					rel.kind === "RELATED_TO" ||
					rel.kind === "EXTERNAL_DEPENDENCY"
				) {
					crossLinkCount++;
					continue;
				}
				if (
					rel.kind === "DEPENDS_ON" &&
					!knownIdentities.has(rel.target) &&
					!accounted.has(rel.target)
				) {
					add(
						"ERROR",
						"RELATIONSHIP_TARGET_UNRESOLVED",
						scope,
						`relationship target "${rel.target}" resolves to no known identity`,
					);
				}
			}
		}
	}

	// ---------- historical index ----------
	const actIds = new Set<string>();
	let historicalActCount = 0;
	const records = pkg.historicalIndex.records ?? [];
	if (!Array.isArray(records)) {
		add(
			"ERROR",
			"HISTORICAL_RECORDS_INVALID",
			"historical-index.json",
			"records must be an array",
		);
	} else {
		for (const rec of records) {
			historicalActCount++;
			const actId = rec?.act_id ?? "<unnamed>";
			if (typeof rec.act_id !== "string" || rec.act_id.length === 0) {
				add(
					"ERROR",
					"HISTORICAL_ACT_ID_MISSING",
					actId,
					"act_id must be a non-empty string",
				);
				continue;
			}
			if (actIds.has(rec.act_id)) {
				add(
					"ERROR",
					"HISTORICAL_ACT_ID_DUPLICATE",
					rec.act_id,
					"act_id is not unique in the historical index",
				);
			}
			actIds.add(rec.act_id);
			if (
				!FWMI_ACT_RECONCILIATION.includes(
					rec.reconciliation as FwmiActReconciliation,
				)
			) {
				add(
					"ERROR",
					"HISTORICAL_RECONCILIATION_INVALID",
					rec.act_id,
					`reconciliation ${JSON.stringify(rec.reconciliation)} is outside the FWMI v1 vocabulary`,
				);
			}
			if (
				rec.reconciliation === "AMBIGUOUS" ||
				rec.reconciliation === "CONFLICTING" ||
				rec.reconciliation === "UNRESOLVED"
			) {
				add(
					"INFO",
					"HISTORICAL_ACT_UNRESOLVED",
					rec.act_id,
					`historical record is ${rec.reconciliation}; it is preserved, not reconciled`,
				);
			}
			// The historical verdict is preserved EXACTLY. No promotion.
			if (rec.original_verdict === null) {
				add(
					"INFO",
					"HISTORICAL_VERDICT_ABSENT",
					rec.act_id,
					"no original verdict recorded",
				);
			}
			if (!Array.isArray(rec.work_item_ids)) {
				add(
					"ERROR",
					"HISTORICAL_WORK_ITEM_IDS_INVALID",
					rec.act_id,
					"work_item_ids must be an array",
				);
			} else {
				for (const w of rec.work_item_ids) {
					if (!knownIdentities.has(w) && !actIds.has(w)) {
						add(
							"WARNING",
							"HISTORICAL_WORK_ITEM_UNRESOLVED",
							rec.act_id,
							`work_item "${w}" does not resolve to a known scoped item`,
						);
					}
				}
			}
			if (!Array.isArray(rec.evidence_locators)) {
				add(
					"ERROR",
					"HISTORICAL_EVIDENCE_LOCATORS_INVALID",
					rec.act_id,
					"evidence_locators must be an array",
				);
			}
			validateSourceRefs(rec.source_refs, rec.act_id, add);
		}
	}

	// ---------- reconciliation ----------
	let unresolvedConflictCount = 0;
	const reconRecords = pkg.reconciliation.records ?? [];
	if (!Array.isArray(reconRecords)) {
		add(
			"ERROR",
			"RECONCILIATION_RECORDS_INVALID",
			"reconciliation.json",
			"records must be an array",
		);
	} else {
		for (const rec of reconRecords) {
			const subject = rec?.kind ?? "<unnamed>";
			if (typeof rec.kind !== "string" || rec.kind.length === 0) {
				add(
					"ERROR",
					"RECONCILIATION_KIND_MISSING",
					subject,
					"kind must be a non-empty string",
				);
			}
			if (!Array.isArray(rec.identities) || rec.identities.length === 0) {
				add(
					"ERROR",
					"RECONCILIATION_IDENTITIES_MISSING",
					subject,
					"identities must be a non-empty array",
				);
			}
			if (!FWMI_RESOLUTIONS.includes(rec.resolution)) {
				add(
					"ERROR",
					"RECONCILIATION_RESOLUTION_INVALID",
					subject,
					`resolution ${JSON.stringify(rec.resolution)} is outside the FWMI v1 vocabulary`,
				);
			}
			if (rec.resolution === "UNRESOLVED" || rec.resolution === "CONFLICT") {
				unresolvedConflictCount++;
				add(
					"INFO",
					"RECONCILIATION_UNRESOLVED",
					subject,
					`reconciliation record is ${rec.resolution}; it is preserved as unresolved`,
				);
			}
			if (typeof rec.reason !== "string" || rec.reason.length === 0) {
				add(
					"ERROR",
					"RECONCILIATION_REASON_MISSING",
					subject,
					"reason must be a non-empty string",
				);
			}
			validateSourceRefs(rec.source_refs, subject, add);
		}
	}

	// ---------- receipt ----------
	// The producer's own receipt is EVIDENCE ABOUT THE PACKAGE, not
	// authority for the import. A FAIL in the producer's receipt is an
	// ERROR here: the producer itself said the package is not good.
	const receiptChecks = pkg.receipt.checks ?? [];
	if (!Array.isArray(receiptChecks)) {
		add(
			"ERROR",
			"RECEIPT_CHECKS_INVALID",
			"validation-receipt.json",
			"checks must be an array",
		);
	} else {
		for (const check of receiptChecks) {
			if (check?.status === "FAIL") {
				add(
					"ERROR",
					"PRODUCER_RECEIPT_FAIL",
					check.id ?? "<unnamed>",
					`producer's own check "${check.id ?? "<unnamed>"}" failed: ${check.detail ?? "no detail"}`,
				);
			} else if (
				check?.status === "PARTIAL" ||
				check?.status === "NOT_EXECUTED"
			) {
				add(
					"WARNING",
					"PRODUCER_RECEIPT_INCOMPLETE",
					check.id ?? "<unnamed>",
					`producer's check "${check.id ?? "<unnamed>"}" is ${check.status}: ${check.detail ?? "no detail"}`,
				);
			}
		}
	}
	const verdict = pkg.receipt.verdict;
	if (typeof verdict !== "string" || verdict.length === 0) {
		add(
			"ERROR",
			"RECEIPT_VERDICT_MISSING",
			"validation-receipt.json",
			"verdict must be a non-empty string",
		);
	} else if (verdict === "HALT_REPOSITORY_TRUST") {
		add(
			"ERROR",
			"PRODUCER_HALT_REPOSITORY_TRUST",
			"validation-receipt.json",
			"the producer halted on repository trust; the package must not be imported",
		);
	}

	// ---------- frontier.md ----------
	// The frontier view is human-facing prose. It is NOT parsed for
	// structure — that would be building the universal semantic Markdown
	// parser this ACT forbids. It is only checked for presence of content.
	if (pkg.frontierMarkdown.trim().length === 0) {
		add(
			"ERROR",
			"FRONTIER_EMPTY",
			"frontier.md",
			"frontier.md must not be empty",
		);
	}

	const stats: FwmiValidationStats = {
		epicCount: epicIds.size,
		itemCount: itemScopes.size,
		openCount: open,
		activeCount: active,
		blockedCount: blocked,
		deferredCount: deferred,
		terminalCount: terminal,
		unresolvedCount: unresolved,
		historicalActCount,
		dependencyCount,
		crossLinkCount: crossLinkCountRef.value,
		unresolvedConflictCount,
		unknownOriginalStatusCount: unknownOriginalStatus,
		unknownQualificationCount: unknownQualification,
		unknownCoverageCount: unknownCoverage,
	};

	return {
		ok: !findings.some((f) => f.severity === "ERROR"),
		findings,
		stats,
	};
}

/**
 * Validate a list of source references.
 *
 * A source reference is the PROVENANCE BINDING of a record: it says which
 * exact bytes the record was derived from. A reference with an invalid
 * range or a malformed digest cannot be honoured, so it is an ERROR — the
 * import would otherwise attach a record to an unverifiable origin.
 */
function validateSourceRefs(
	refs: unknown,
	subject: string,
	add: (
		severity: FwmiSeverity,
		code: string,
		subject: string,
		message: string,
	) => void,
): void {
	if (!Array.isArray(refs)) {
		add(
			"ERROR",
			"SOURCE_REFS_INVALID",
			subject,
			"source_refs must be an array",
		);
		return;
	}
	for (const ref of refs) {
		const r = ref as {
			path?: unknown;
			start_line?: unknown;
			end_line?: unknown;
			sha256?: unknown;
		};
		if (typeof r.path !== "string" || r.path.length === 0) {
			add(
				"ERROR",
				"SOURCE_REF_PATH_MISSING",
				subject,
				"source_ref.path must be a non-empty string",
			);
		}
		if (
			typeof r.start_line !== "number" ||
			!Number.isInteger(r.start_line) ||
			r.start_line < 1
		) {
			add(
				"ERROR",
				"SOURCE_REF_START_LINE_INVALID",
				subject,
				`source_ref.start_line must be a positive integer, got ${JSON.stringify(r.start_line)}`,
			);
		}
		if (
			typeof r.end_line !== "number" ||
			!Number.isInteger(r.end_line) ||
			r.end_line < 1
		) {
			add(
				"ERROR",
				"SOURCE_REF_END_LINE_INVALID",
				subject,
				`source_ref.end_line must be a positive integer, got ${JSON.stringify(r.end_line)}`,
			);
		}
		if (
			typeof r.start_line === "number" &&
			typeof r.end_line === "number" &&
			r.end_line < r.start_line
		) {
			add(
				"ERROR",
				"SOURCE_REF_RANGE_INVERTED",
				subject,
				`source_ref range ${r.start_line}..${r.end_line} is inverted`,
			);
		}
		if (typeof r.sha256 !== "string" || !HEX64.test(r.sha256)) {
			add(
				"ERROR",
				"SOURCE_REF_SHA256_INVALID",
				subject,
				`source_ref.sha256 must be 64 lowercase hex chars, got ${JSON.stringify(r.sha256)}`,
			);
		}
	}
}

/**
 * Validate a list of relationships.
 *
 * Cross-links are CONSERVATION EDGES: they let a reader find the related
 * record without DUPLICATING its authoritative obligation. Only
 * `DEPENDS_ON` establishes local prerequisite authority, so only that kind
 * is counted as a dependency-bearing edge.
 */
function validateRelationships(
	rels: unknown,
	subject: string,
	add: (
		severity: FwmiSeverity,
		code: string,
		subject: string,
		message: string,
	) => void,
	counter: Counter,
): void {
	if (rels === undefined) return;
	if (!Array.isArray(rels)) {
		add(
			"ERROR",
			"RELATIONSHIPS_INVALID",
			subject,
			"relationships must be an array",
		);
		return;
	}
	for (const rel of rels) {
		const r = rel as { kind?: unknown; target?: unknown };
		if (
			typeof r.kind !== "string" ||
			!FWMI_RELATIONSHIP_KINDS.includes(r.kind as FwmiRelationshipKind)
		) {
			add(
				"ERROR",
				"RELATIONSHIP_KIND_INVALID",
				subject,
				`relationship kind ${JSON.stringify(r.kind)} is outside the FWMI v1 vocabulary`,
			);
			continue;
		}
		if (typeof r.target !== "string" || r.target.length === 0) {
			add(
				"ERROR",
				"RELATIONSHIP_TARGET_MISSING",
				subject,
				"relationship.target must be a non-empty string",
			);
			continue;
		}
		if (
			r.kind === "CROSS_LINK" ||
			r.kind === "RELATED_TO" ||
			r.kind === "EXTERNAL_DEPENDENCY"
		) {
			counter.value++;
		}
	}
}

/** A mutable counter used by the relationship helper. */
interface Counter {
	value: number;
}
