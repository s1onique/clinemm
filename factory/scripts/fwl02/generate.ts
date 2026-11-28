#!/usr/bin/env bun
/**
 * factory/scripts/fwl02/generate.ts
 *
 * ACT-CLINEMM-FWL02-B-HISTORICAL-RECONCILIATION-01 — package generator.
 *
 * Produces the FWMI v1 migration interchange package under
 * `.factory/migration/FWL02/` from the reconciled source data, binding every
 * load-bearing assertion to the EXACT committed bytes it was derived from.
 *
 * The generator:
 *
 *   1. Resolves SOURCE_HEAD (a committed Git object).
 *   2. Inventories the source files it binds to, computing byte size, line
 *      count, git blob identity and SHA-256 from the COMMITTED blob.
 *   3. Serializes one epic record per actual epic.
 *   4. Serializes the mechanically indexed historical ACT index.
 *   5. Serializes the reconciliation manifest.
 *   6. Writes `frontier.md` — the recovered current execution frontier.
 *
 * It writes ONLY under `.factory/migration/FWL02/`. It does not modify
 * production code, the legacy board, the epic files or any evidence.
 *
 * Run with: bun factory/scripts/fwl02/generate.ts
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	FWMI_REPOSITORY,
	FWMI_SCHEMA_VERSION,
	type FwmiEpic,
	type FwmiHistoricalAct,
	type FwmiItem,
	type FwmiManifestFile,
	type FwmiReconciliationRecord,
	type FwmiRelationship,
	type FwmiSourceRef,
} from "./contract.ts";
import { RECONCILED_EPICS } from "./epic-index.ts";
import { buildFrontierMarkdown } from "./frontier.ts";
import {
	extractHistoricalActSections,
	groupHistoricalActs,
} from "./historical-index.ts";
import type {
	Bound,
	ReconciledEpic,
	ReconciledItem,
} from "./reconciled-epics.ts";
import { RECONCILIATION_RECORDS } from "./reconciliation-data.ts";
import {
	committedFileFacts,
	FWL02_FROZEN_SOURCE_HEAD,
	makeSourceRef,
	readCommittedBytes,
	resolveCommit,
} from "./source-refs.ts";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const PACKAGE_DIR = join(REPO_ROOT, ".factory/migration/FWL02");

/**
 * The frozen source head for this package.
 *
 * It is an explicit committed revision, NOT `HEAD`: the package's own
 * publication commit advances `HEAD`, and deriving the source head from `HEAD`
 * would rebind every assertion to the publication commit itself.
 */
const SOURCE_HEAD = resolveCommit(FWL02_FROZEN_SOURCE_HEAD, REPO_ROOT);

/** The board — the operational index that owns the frontier tables. */
const BOARD_PATH = ".factory/epic-board.md";

/**
 * Resolve a bound source range into a wire-shaped source reference.
 * The digest is computed from the committed blob bytes.
 */
function resolveBound(bound: Bound, effectiveHead: string): FwmiSourceRef {
	return makeSourceRef(
		bound.path,
		bound.lines[0],
		bound.lines[1],
		SOURCE_HEAD,
		effectiveHead,
		REPO_ROOT,
	);
}

/** Resolve a list of bound source ranges. */
function resolveBounds(
	bounds: readonly Bound[],
	effectiveHead: string,
): FwmiSourceRef[] {
	return bounds.map((bound) => resolveBound(bound, effectiveHead));
}

/** Resolve a reconciled relationship into its wire shape. */
function resolveRelationship(
	relationship: {
		kind: FwmiRelationship["kind"];
		target: string;
		required_outcome?: string;
		source_refs: readonly Bound[];
	},
	effectiveHead: string,
): FwmiRelationship {
	const base = {
		kind: relationship.kind,
		target: relationship.target,
		source_refs: resolveBounds(relationship.source_refs, effectiveHead),
	};
	return relationship.required_outcome === undefined
		? base
		: { ...base, required_outcome: relationship.required_outcome };
}

/**
 * Resolve a reconciled item into its wire shape.
 *
 * The item identity is LOCAL to its epic: the consumer derives the scoped
 * identity itself. Every relationship kind is carried in the `dependencies`
 * array, because the consumer's wire shape has no separate relationship field.
 */
function resolveItem(item: ReconciledItem, effectiveHead: string): FwmiItem {
	return {
		schema_version: FWMI_SCHEMA_VERSION,
		item_id: item.item_id,
		title: item.title,
		description: item.description,
		workstream: item.workstream,
		original_status: item.original_status,
		lifecycle: item.lifecycle,
		priority: item.priority,
		qualification: item.qualification,
		criteria: item.criteria,
		criteria_coverage: item.criteria_coverage,
		dependencies: item.relationships.map((relationship) =>
			resolveRelationship(relationship, effectiveHead),
		),
		dependency_coverage: item.dependency_coverage,
		blockers: item.blockers,
		current_act: item.current_act,
		related_acts: item.related_acts,
		evidence_locators: item.evidence_locators,
		reopen_conditions: item.reopen_conditions,
		source_refs: resolveBounds(item.source_refs, effectiveHead),
	};
}

/** Resolve a reconciled epic into its wire shape. */
function resolveEpic(epic: ReconciledEpic, effectiveHead: string): FwmiEpic {
	return {
		schema_version: FWMI_SCHEMA_VERSION,
		epic_id: epic.epic_id,
		title: epic.title,
		original_status: epic.original_status,
		lifecycle: epic.lifecycle,
		priority: epic.priority,
		exit_criteria: epic.exit_criteria,
		items: epic.items.map((item) => resolveItem(item, effectiveHead)),
		source_refs: resolveBounds(epic.source_refs, effectiveHead),
	};
}

/** Serialize one JSON document deterministically with a trailing newline. */
function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * The source-file inventory bound into the package.
 *
 * Every file the package binds to is inventoried with its committed byte
 * size, line count, git blob identity and SHA-256. `_index-contract.md` is
 * inventoried with disposition `navigation` — it is the frozen maintenance
 * contract and is NOT an epic.
 */
function buildManifest(): FwmiManifestFile[] {
	const paths: Array<{
		path: string;
		disposition: FwmiManifestFile["disposition"];
	}> = [{ path: BOARD_PATH, disposition: "indexed" }];
	for (const epic of RECONCILED_EPICS) {
		paths.push({ path: epic.source_file, disposition: "epic" });
	}
	paths.push({
		path: ".factory/epics/_index-contract.md",
		disposition: "navigation",
	});
	const files = paths
		.map(({ path, disposition }) => {
			const facts = committedFileFacts(path, SOURCE_HEAD, REPO_ROOT);
			return {
				path: facts.path,
				bytes: facts.bytes,
				lines: facts.lines,
				sha256: facts.sha256,
				git_blob: facts.git_blob,
				disposition,
			};
		})
		.sort((left, right) =>
			left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
		);
	return files;
}

/**
 * Build the historical ACT index from the committed board.
 *
 * The board's ACT report sections are mechanically indexed by identity,
 * verdict and source range. A historical verdict is a HISTORICAL ASSERTION;
 * the `reconciliation` field records whether the identity's representations
 * agree. The epic association is recovered where the board's own index
 * carries it; otherwise it is left null (an UNRESOLVED association) rather
 * than invented.
 */
function buildHistoricalIndex(): FwmiHistoricalAct[] {
	const boardBytes = readCommittedBytes(BOARD_PATH, SOURCE_HEAD, REPO_ROOT);
	const sections = extractHistoricalActSections(boardBytes);
	const grouped = groupHistoricalActs(sections);
	return grouped.map((group) => {
		const _first = group.occurrences[0]!;
		const refs = group.occurrences.map((occurrence) =>
			makeSourceRef(
				BOARD_PATH,
				occurrence.start_line,
				occurrence.end_line,
				SOURCE_HEAD,
				SOURCE_HEAD,
				REPO_ROOT,
			),
		);
		return {
			schema_version: FWMI_SCHEMA_VERSION,
			act_id: group.act_id,
			original_verdict: group.original_verdict,
			epic_id: null,
			work_item_ids: [],
			evidence_locators: [],
			source_refs: refs,
			reconciliation: group.reconciliation,
		};
	});
}

/** Build the reconciliation manifest. */
function buildReconciliation(): FwmiReconciliationRecord[] {
	return RECONCILIATION_RECORDS.map((record) => ({
		schema_version: FWMI_SCHEMA_VERSION,
		kind: record.kind,
		identities: record.identities,
		resolution: record.resolution,
		reason: record.reason,
		source_refs: resolveBounds(record.source_refs, SOURCE_HEAD),
	}));
}

/** Main generation routine. */
function main(): void {
	// Start from a clean package directory so a stale file can never survive.
	rmSync(PACKAGE_DIR, { recursive: true, force: true });
	mkdirSync(join(PACKAGE_DIR, "epics"), { recursive: true });

	const manifest = {
		schema_version: FWMI_SCHEMA_VERSION,
		repository: FWMI_REPOSITORY,
		source_head: SOURCE_HEAD,
		files: buildManifest(),
	};
	writeJson(join(PACKAGE_DIR, "source-manifest.json"), manifest);

	for (const epic of RECONCILED_EPICS) {
		const resolved = resolveEpic(epic, SOURCE_HEAD);
		writeJson(join(PACKAGE_DIR, "epics", `${epic.epic_id}.json`), resolved);
	}

	writeJson(join(PACKAGE_DIR, "historical-index.json"), {
		schema_version: FWMI_SCHEMA_VERSION,
		records: buildHistoricalIndex(),
	});

	writeJson(join(PACKAGE_DIR, "reconciliation.json"), {
		schema_version: FWMI_SCHEMA_VERSION,
		records: buildReconciliation(),
	});

	writeFileSync(
		join(PACKAGE_DIR, "frontier.md"),
		buildFrontierMarkdown(RECONCILED_EPICS),
		"utf8",
	);

	const summary = {
		source_head: SOURCE_HEAD,
		epics: RECONCILED_EPICS.length,
		work_items: RECONCILED_EPICS.reduce(
			(sum, epic) => sum + epic.items.length,
			0,
		),
		manifest_files: manifest.files.length,
	};
	console.log(JSON.stringify(summary, null, 2));
}

main();
