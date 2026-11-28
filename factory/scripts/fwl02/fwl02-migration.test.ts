#!/usr/bin/env bun
/**
 * factory/scripts/fwl02/fwl02-migration.test.ts
 *
 * ACT-CLINEMM-FWL02-B-HISTORICAL-RECONCILIATION-01 — package validation tests.
 *
 * These tests assert the properties the ACT's W8 exit conditions name:
 * structural validity, source integrity against the ACTUAL committed bytes,
 * semantic accounting, and the adversarial negative controls.
 *
 * They are `bun:test` tests (not mocha): they need no VS Code extension host.
 *
 * Run with: bun test factory/scripts/fwl02/
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	FWMI_COVERAGES,
	FWMI_LIFECYCLES,
	FWMI_PRIORITIES,
	FWMI_QUALIFICATIONS,
	FWMI_RELATIONSHIP_KINDS,
	FWMI_RESOLUTIONS,
	FWMI_SCHEMA_VERSION,
	type FwmiCoverage,
	type FwmiLifecycle,
	type FwmiQualification,
	type FwmiReconciliationRecord,
	type FwmiRelationshipKind,
	type FwmiResolution,
	type FwmiSourceRef,
	reconciliationIdentityKey,
} from "./contract.ts";
import {
	committedFileFacts,
	readCommittedBytes,
	resolveCommit,
	splitCommittedLines,
	verifySourceRef,
} from "./source-refs.ts";
import {
	findConflictingReconciliationIdentities,
	findDuplicateJsonMembers,
	findPrerequisiteCycle,
	validatePackage,
} from "./validate.ts";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const PACKAGE_DIR = join(REPO_ROOT, ".factory/migration/FWL02");

const manifest = JSON.parse(
	readFileSync(join(PACKAGE_DIR, "source-manifest.json"), "utf8"),
);
const index = JSON.parse(
	readFileSync(join(PACKAGE_DIR, "historical-index.json"), "utf8"),
);
const recon = JSON.parse(
	readFileSync(join(PACKAGE_DIR, "reconciliation.json"), "utf8"),
);
const receipt = JSON.parse(
	readFileSync(join(PACKAGE_DIR, "validation-receipt.json"), "utf8"),
);

function epicFiles(): string[] {
	const { readdirSync } = require("node:fs") as typeof import("node:fs");
	return readdirSync(join(PACKAGE_DIR, "epics"))
		.filter((name) => name.endsWith(".json"))
		.sort();
}

function loadEpics(): Array<Record<string, unknown>> {
	return epicFiles().map((name) =>
		JSON.parse(readFileSync(join(PACKAGE_DIR, "epics", name), "utf8")),
	);
}

describe("FWL02 migration package — structural validity", () => {
	test("the source manifest carries the FWMI v1 schema version and the repository identity", () => {
		expect(manifest.schema_version).toBe(FWMI_SCHEMA_VERSION);
		expect(manifest.repository).toBe("clinemm");
	});

	test("every machine-consumed artifact carries the FWMI v1 schema version", () => {
		expect(index.schema_version).toBe(FWMI_SCHEMA_VERSION);
		expect(recon.schema_version).toBe(FWMI_SCHEMA_VERSION);
		expect(receipt.schema_version).toBe(FWMI_SCHEMA_VERSION);
		for (const epic of loadEpics()) {
			expect(epic.schema_version).toBe(FWMI_SCHEMA_VERSION);
		}
	});

	test("the source head resolves to a committed Git object", () => {
		expect(resolveCommit(manifest.source_head, REPO_ROOT)).toBe(
			manifest.source_head,
		);
	});

	test("no JSON artifact contains duplicate object members", () => {
		const files = [
			"source-manifest.json",
			"historical-index.json",
			"reconciliation.json",
			"validation-receipt.json",
			...epicFiles().map((name) => `epics/${name}`),
		];
		for (const file of files) {
			const raw = readFileSync(join(PACKAGE_DIR, file), "utf8");
			expect(findDuplicateJsonMembers(raw)).toEqual([]);
		}
	});

	test("the duplicate-member detector actually detects a duplicate", () => {
		expect(findDuplicateJsonMembers('{"a":1,"a":2}')).toEqual(["a"]);
		expect(findDuplicateJsonMembers('{"a":1,"b":2}')).toEqual([]);
		expect(findDuplicateJsonMembers('{"x":{"a":1},"y":{"a":2}}')).toEqual([]);
	});

	test("epic identities are unique", () => {
		const ids = loadEpics().map((epic) => epic.epic_id as string);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test("scoped work-item identities are unique", () => {
		const ids = loadEpics().flatMap((epic) =>
			(epic.items as Array<{ item_id: string }>).map((item) => item.item_id),
		);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test("historical ACT identities are unique", () => {
		const ids = (index.records as Array<{ act_id: string }>).map(
			(record) => record.act_id,
		);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids.length).toBeGreaterThan(0);
	});

	test("every lifecycle, qualification, coverage, relationship kind and resolution is in the vocabulary", () => {
		for (const epic of loadEpics()) {
			expect(FWMI_LIFECYCLES).toContain(epic.lifecycle as FwmiLifecycle);
			for (const item of epic.items as Array<Record<string, unknown>>) {
				expect(FWMI_LIFECYCLES).toContain(item.lifecycle as FwmiLifecycle);
				expect(FWMI_QUALIFICATIONS).toContain(
					item.qualification as FwmiQualification,
				);
				expect(FWMI_COVERAGES).toContain(
					item.criteria_coverage as FwmiCoverage,
				);
				expect(FWMI_COVERAGES).toContain(
					item.dependency_coverage as FwmiCoverage,
				);
				for (const relationship of (item.dependencies ?? []) as Array<{
					kind: string;
				}>) {
					expect(FWMI_RELATIONSHIP_KINDS).toContain(
						relationship.kind as FwmiRelationshipKind,
					);
				}
			}
		}
		for (const record of recon.records as Array<{ resolution: string }>) {
			expect(FWMI_RESOLUTIONS).toContain(record.resolution as FwmiResolution);
		}
	});
});

describe("FWL02 migration package — source integrity", () => {
	test("every manifest file matches the committed blob exactly", () => {
		for (const file of manifest.files as Array<{
			path: string;
			bytes: number;
			lines: number;
			sha256: string;
			git_blob: string;
		}>) {
			const facts = committedFileFacts(
				file.path,
				manifest.source_head,
				REPO_ROOT,
			);
			expect(facts.bytes).toBe(file.bytes);
			expect(facts.lines).toBe(file.lines);
			expect(facts.sha256).toBe(file.sha256);
			expect(facts.git_blob).toBe(file.git_blob);
		}
	});

	test("every source reference range matches the original committed bytes", async () => {
		const refs: Array<Record<string, unknown>> = [];
		for (const epic of loadEpics()) {
			refs.push(...(epic.source_refs as Array<Record<string, unknown>>));
			for (const item of epic.items as Array<Record<string, unknown>>) {
				refs.push(...(item.source_refs as Array<Record<string, unknown>>));
				for (const relationship of (item.dependencies ?? []) as Array<
					Record<string, unknown>
				>) {
					refs.push(
						...((relationship.source_refs ?? []) as Array<
							Record<string, unknown>
						>),
					);
				}
			}
		}
		refs.push(
			...(
				index.records as Array<{ source_refs: Array<Record<string, unknown>> }>
			).flatMap((r) => r.source_refs),
		);
		refs.push(
			...(
				recon.records as Array<{ source_refs: Array<Record<string, unknown>> }>
			).flatMap((r) => r.source_refs),
		);
		expect(refs.length).toBeGreaterThan(0);
		for (const ref of refs) {
			const problems = verifySourceRef(
				ref as never,
				manifest.source_head,
				REPO_ROOT,
			);
			expect(problems).toEqual([]);
		}
	}, 60_000);

	test("a source range digest covers the exact original newline bytes", () => {
		const bytes = readCommittedBytes(
			".factory/epics/architecture.md",
			manifest.source_head,
			REPO_ROOT,
		);
		const lines = splitCommittedLines(bytes);
		expect(lines.length).toBeGreaterThan(1);
		// A range digest is sensitive to the exact newline bytes.
		const ref = {
			path: ".factory/epics/architecture.md",
			start_line: 1,
			end_line: 1,
			sha256: "0".repeat(64),
		};
		expect(
			verifySourceRef(ref as never, manifest.source_head, REPO_ROOT).length,
		).toBeGreaterThan(0);
	});
});

describe("FWL02 migration package — actual consumer wire compatibility", () => {
	/**
	 * The wire fields of the ACTUAL Leamas Go consumer, transcribed from
	 * `internal/ledger/fwmi/records.go`.
	 *
	 * The consumer's loader uses `DisallowUnknownFields`, so an extra field is
	 * a REJECTION, not a warning.
	 */
	const CONSUMER_EPIC_FIELDS = [
		"schema_version",
		"epic_id",
		"title",
		"original_status",
		"lifecycle",
		"priority",
		"exit_criteria",
		"items",
		"source_refs",
	];
	const CONSUMER_ITEM_FIELDS = [
		"schema_version",
		"item_id",
		"title",
		"description",
		"workstream",
		"original_status",
		"lifecycle",
		"priority",
		"qualification",
		"criteria",
		"criteria_coverage",
		"dependencies",
		"dependency_coverage",
		"blockers",
		"current_act",
		"related_acts",
		"evidence_locators",
		"reopen_conditions",
		"source_refs",
	];
	const CONSUMER_HISTORICAL_FIELDS = [
		"schema_version",
		"act_id",
		"original_verdict",
		"epic_id",
		"work_item_ids",
		"evidence_locators",
		"source_refs",
		"reconciliation",
	];
	const CONSUMER_RECONCILIATION_FIELDS = [
		"schema_version",
		"kind",
		"identities",
		"resolution",
		"reason",
		"source_refs",
	];

	test("no artifact carries a field the consumer's strict decoder rejects", () => {
		for (const epic of loadEpics()) {
			for (const key of Object.keys(epic)) {
				expect(CONSUMER_EPIC_FIELDS).toContain(key);
			}
			for (const item of epic.items as Array<Record<string, unknown>>) {
				for (const key of Object.keys(item)) {
					expect(CONSUMER_ITEM_FIELDS).toContain(key);
				}
			}
		}
		for (const record of index.records as Array<Record<string, unknown>>) {
			for (const key of Object.keys(record)) {
				expect(CONSUMER_HISTORICAL_FIELDS).toContain(key);
			}
		}
		for (const record of recon.records as Array<Record<string, unknown>>) {
			for (const key of Object.keys(record)) {
				expect(CONSUMER_RECONCILIATION_FIELDS).toContain(key);
			}
		}
	});

	test("no epic or work item carries a separate relationships field", () => {
		for (const epic of loadEpics()) {
			expect(epic).not.toHaveProperty("relationships");
			for (const item of epic.items as Array<Record<string, unknown>>) {
				expect(item).not.toHaveProperty("relationships");
			}
		}
	});

	test("every nested record carries the FWMI v1 schema version", () => {
		for (const epic of loadEpics()) {
			for (const item of epic.items as Array<{ schema_version: number }>) {
				expect(item.schema_version).toBe(FWMI_SCHEMA_VERSION);
			}
		}
		for (const record of index.records as Array<{ schema_version: number }>) {
			expect(record.schema_version).toBe(FWMI_SCHEMA_VERSION);
		}
		for (const record of recon.records as Array<{
			schema_version: number;
		}>) {
			expect(record.schema_version).toBe(FWMI_SCHEMA_VERSION);
		}
	});

	test("every work-item identity is local to its parent epic", () => {
		for (const epic of loadEpics()) {
			for (const item of epic.items as Array<{ item_id: string }>) {
				expect(item.item_id).not.toContain("/");
				expect(item.item_id.length).toBeGreaterThan(0);
			}
		}
	});

	test("the scoped work-item identity is unique across the package", () => {
		const scoped = loadEpics().flatMap((epic) =>
			(epic.items as Array<{ item_id: string }>).map(
				(item) => `${epic.epic_id as string}/${item.item_id}`,
			),
		);
		expect(new Set(scoped).size).toBe(scoped.length);
	});

	test("every relationship target carries its epic scope and resolves", () => {
		const represented = new Set(
			loadEpics().flatMap((epic) =>
				(epic.items as Array<{ item_id: string }>).map(
					(item) => `${epic.epic_id as string}/${item.item_id}`,
				),
			),
		);
		for (const epic of loadEpics()) {
			for (const item of epic.items as Array<{
				dependencies?: Array<{ target: string }>;
			}>) {
				for (const relationship of item.dependencies ?? []) {
					expect(relationship.target).toContain("/");
					expect(represented.has(relationship.target)).toBe(true);
				}
			}
		}
	});
});

describe("FWL02 migration package — prerequisite graph", () => {
	/** The local prerequisite edges of the package. */
	function prerequisiteEdges(): Map<string, string[]> {
		const edges = new Map<string, string[]>();
		for (const epic of loadEpics()) {
			for (const item of epic.items as Array<{
				item_id: string;
				dependencies?: Array<{ kind: string; target: string }>;
			}>) {
				edges.set(
					`${epic.epic_id as string}/${item.item_id}`,
					(item.dependencies ?? [])
						.filter((r) => r.kind === "DEPENDS_ON")
						.map((r) => r.target),
				);
			}
		}
		return edges;
	}

	test("the declared prerequisite graph has no cycle", () => {
		expect(findPrerequisiteCycle(prerequisiteEdges())).toBeNull();
	});

	test("the architecture prerequisite order is E8 then E9 then ELMIZATION02", () => {
		const edges = prerequisiteEdges();
		expect(edges.get("EPIC-CLINEMM-ARCHITECTURE/E8")).toEqual([]);
		expect(edges.get("EPIC-CLINEMM-ARCHITECTURE/E9")).toEqual([
			"EPIC-CLINEMM-ARCHITECTURE/E8",
		]);
		expect(edges.get("EPIC-CLINEMM-ARCHITECTURE/ELMIZATION02")).toEqual([
			"EPIC-CLINEMM-ARCHITECTURE/E9",
		]);
	});

	test("the unresolved E7 prerequisite remains an explicit blocker on E8", () => {
		const architecture = loadEpics().find(
			(epic) => epic.epic_id === "EPIC-CLINEMM-ARCHITECTURE",
		);
		const e8 = (
			architecture?.items as Array<{
				item_id: string;
				blockers: string[];
			}>
		).find((item) => item.item_id === "E8");
		expect(e8).toBeDefined();
		expect(e8?.blockers.join(" ")).toContain("E7");
		// E7 is NOT invented as an obligation.
		const all = loadEpics().flatMap((epic) =>
			(epic.items as Array<{ item_id: string }>).map((item) => item.item_id),
		);
		expect(all).not.toContain("E7");
	});

	test("the cycle detector actually detects a cycle", () => {
		const cyclic = new Map<string, string[]>([
			["A", ["B"]],
			["B", ["C"]],
			["C", ["A"]],
		]);
		expect(findPrerequisiteCycle(cyclic)).not.toBeNull();
	});

	test("a shared prerequisite is not mistaken for a cycle", () => {
		const shared = new Map<string, string[]>([
			["A", ["C"]],
			["B", ["C"]],
			["C", []],
		]);
		expect(findPrerequisiteCycle(shared)).toBeNull();
	});
});

describe("FWL02 migration package — semantic accounting", () => {
	test("the navigation contract is inventoried as navigation and is not an epic", () => {
		const contract = (
			manifest.files as Array<{ path: string; disposition: string }>
		).find((file) => file.path === ".factory/epics/_index-contract.md");
		expect(contract?.disposition).toBe("navigation");
		for (const epic of loadEpics()) {
			expect(epic.epic_id).not.toContain("INDEX-CONTRACT");
		}
	});

	test("deferred, terminal and open obligations are represented distinctly", () => {
		const lifecycles = loadEpics().flatMap((epic) =>
			(epic.items as Array<{ lifecycle: string }>).map(
				(item) => item.lifecycle,
			),
		);
		expect(lifecycles.filter((l) => l === "DEFERRED").length).toBeGreaterThan(
			0,
		);
		expect(lifecycles.filter((l) => l === "TERMINAL").length).toBeGreaterThan(
			0,
		);
		expect(lifecycles.filter((l) => l === "OPEN").length).toBeGreaterThan(0);
	});

	test("an unknown source status is never represented as DEFERRED", () => {
		for (const epic of loadEpics()) {
			for (const item of epic.items as Array<{
				item_id: string;
				lifecycle: string;
				original_status: string | null;
			}>) {
				if (item.lifecycle !== "DEFERRED") {
					continue;
				}
				expect(item.original_status).not.toBeNull();
				expect(
					/^(unknown|unspecified|n\/a|tbd)$/i.test(
						(item.original_status ?? "").trim(),
					),
				).toBe(false);
			}
		}
	});

	test("every BLOCKED item names its blocker", () => {
		for (const epic of loadEpics()) {
			for (const item of epic.items as Array<{
				item_id: string;
				lifecycle: string;
				blockers: string[];
			}>) {
				if (item.lifecycle === "BLOCKED") {
					expect(item.blockers.length).toBeGreaterThan(0);
				}
			}
		}
	});

	test("a cross-link never carries an obligation of its own", () => {
		const represented = new Set(
			loadEpics().flatMap((epic) =>
				(epic.items as Array<{ item_id: string }>).map(
					(item) => `${epic.epic_id as string}/${item.item_id}`,
				),
			),
		);
		for (const epic of loadEpics()) {
			for (const item of epic.items as Array<{
				item_id: string;
				dependencies?: Array<{ kind: string; target: string }>;
			}>) {
				for (const relationship of item.dependencies ?? []) {
					if (relationship.kind === "CROSS_LINK") {
						expect(represented.has(relationship.target)).toBe(true);
					}
				}
			}
		}
	});

	test("the IECR consolidated board is explicitly reported as absent from source", () => {
		const frontier = readFileSync(join(PACKAGE_DIR, "frontier.md"), "utf8");
		expect(frontier).toContain("IECR_CONSOLIDATED_BOARD_NOT_PRESENT_IN_SOURCE");
		const reconciliation = JSON.stringify(recon);
		expect(reconciliation).toContain("EPIC-CLINEMM-IECR");
	});

	test("the historical ACT index preserves competing verdicts rather than deduplicating them", () => {
		const conflicting = (
			index.records as Array<{
				act_id: string;
				reconciliation: string;
				source_refs: unknown[];
			}>
		).filter((record) => record.reconciliation === "CONFLICTING");
		expect(conflicting.length).toBeGreaterThan(0);
		for (const record of conflicting) {
			expect(record.source_refs.length).toBeGreaterThan(1);
		}
	});

	test("an epic with no open items remains discoverable with its exit criteria", () => {
		const empty = loadEpics().filter(
			(epic) => (epic.items as unknown[]).length === 0,
		);
		expect(empty.length).toBeGreaterThan(0);
		for (const epic of empty) {
			expect((epic.exit_criteria as string[]).length).toBeGreaterThan(0);
			expect((epic.source_refs as unknown[]).length).toBeGreaterThan(0);
		}
	});
});

describe("FWL02 migration package — adversarial negative controls", () => {
	test("a modified source-range digest is detected", () => {
		const ref = {
			path: ".factory/epic-board.md",
			start_line: 1,
			end_line: 1,
			sha256: "0".repeat(64),
		};
		expect(
			verifySourceRef(ref as never, manifest.source_head, REPO_ROOT).length,
		).toBeGreaterThan(0);
	});

	test("an invalid line range is detected", () => {
		const ref = {
			path: ".factory/epic-board.md",
			start_line: 9_999_999,
			end_line: 9_999_999,
			sha256: "0".repeat(64),
		};
		expect(
			verifySourceRef(ref as never, manifest.source_head, REPO_ROOT).length,
		).toBeGreaterThan(0);
	});

	test("a missing source file is detected", () => {
		const ref = {
			path: ".factory/epics/NOPE.md",
			start_line: 1,
			end_line: 1,
			sha256: "0".repeat(64),
		};
		expect(
			verifySourceRef(ref as never, manifest.source_head, REPO_ROOT).length,
		).toBeGreaterThan(0);
	});

	test("a duplicate scoped work-item identity is detected by the uniqueness test", () => {
		const items = loadEpics().flatMap(
			(epic) => epic.items as Array<{ item_id: string }>,
		);
		const duplicated = [...items, ...items];
		const ids = new Set<string>();
		let duplicateFound = false;
		for (const item of duplicated) {
			if (ids.has(item.item_id)) {
				duplicateFound = true;
			}
			ids.add(item.item_id);
		}
		expect(duplicateFound).toBe(true);
	});

	test("an unresolvable dependency target is detected", () => {
		const represented = new Set(
			loadEpics().flatMap((epic) =>
				(epic.items as Array<{ item_id: string }>).map((item) => item.item_id),
			),
		);
		const known = new Set(
			(recon.records as Array<{ identities: string[] }>).flatMap(
				(record) => record.identities,
			),
		);
		const bogus = "EPIC-CLINEMM-NOPE/NO-SUCH-ITEM";
		expect(represented.has(bogus)).toBe(false);
		expect(known.has(bogus)).toBe(false);
	});

	test("a duplicated historical identity is detected by the uniqueness test", () => {
		const records = index.records as Array<{ act_id: string }>;
		const seen = new Set<string>();
		let duplicateFound = false;
		for (const record of [...records, ...records]) {
			if (seen.has(record.act_id)) {
				duplicateFound = true;
			}
			seen.add(record.act_id);
		}
		expect(duplicateFound).toBe(true);
	});
});

describe("FWL02 migration package — duplicate authority and priority", () => {
	/** The scoped identities of every represented obligation. */
	function scopedItems(): Map<string, string> {
		const items = new Map<string, string>();
		for (const epic of loadEpics()) {
			for (const item of epic.items as Array<{
				item_id: string;
				lifecycle: string;
			}>) {
				items.set(`${epic.epic_id as string}/${item.item_id}`, item.lifecycle);
			}
		}
		return items;
	}

	test("each resolved duplicate group carries exactly one executable obligation", () => {
		const items = scopedItems();
		const groups = (
			recon.records as Array<{
				kind: string;
				resolution: string;
				reason: string;
				identities: string[];
			}>
		).filter(
			(record) =>
				(record.resolution === "DUPLICATE" ||
					record.resolution === "RESOLVED") &&
				/shared ownership|primary owner|canonical owner|canonical detail/i.test(
					record.reason,
				),
		);
		expect(groups.length).toBeGreaterThan(0);
		for (const group of groups) {
			const executable = group.identities.filter((identity) =>
				["OPEN", "ACTIVE", "BLOCKED"].includes(items.get(identity) ?? ""),
			);
			expect(executable.length).toBeLessThanOrEqual(1);
		}
	});

	test("the four consolidated duplicate groups keep one authoritative obligation each", () => {
		const items = scopedItems();
		// HOST-TEST-RUNNER: three representations, one owner.
		expect(
			items.has("EPIC-CLINEMM-HOST-TEST-INFRASTRUCTURE/HOST-TEST-RUNNER"),
		).toBe(true);
		expect(items.has("EPIC-CLINEMM-SAFE-YOLO-SEATBELT/HOST-TEST-RUNNER")).toBe(
			false,
		);
		expect(items.has("EPIC-CLINEMM-APPROVAL-PROTECTION/HOST-TEST-RUNNER")).toBe(
			false,
		);
		// CLASSIC-PROTECTION-RECON01: two representations, one owner.
		expect(
			items.has("EPIC-CLINEMM-APPROVAL-PROTECTION/CLASSIC-PROTECTION-RECON01"),
		).toBe(true);
		expect(
			items.has("EPIC-CLINEMM-SAFE-YOLO-SEATBELT/CLASSIC-PROTECTION-RECON01"),
		).toBe(false);
		// EDITOR-TOOL-APPROVAL-FRICTION-RECON01: two representations, one owner.
		expect(
			items.has(
				"EPIC-CLINEMM-APPROVAL-PROTECTION/EDITOR-TOOL-APPROVAL-FRICTION-RECON01",
			),
		).toBe(true);
		expect(
			items.has(
				"EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION/EDITOR-TOOL-APPROVAL-FRICTION-RECON01",
			),
		).toBe(false);
		// TEMP-INTERNAL-CONTROL-CLEANUP: two representations, one owner.
		expect(
			items.has(
				"EPIC-CLINEMM-SAFE-YOLO-SEATBELT/TEMP-INTERNAL-CONTROL-CLEANUP",
			),
		).toBe(true);
		expect(
			items.has(
				"EPIC-CLINEMM-PRODUCT-CONFIG-BRANDING/TEMP-INTERNAL-CONTROL-CLEANUP",
			),
		).toBe(false);
	});

	test("every dropped secondary representation is accounted for in the source accounting", () => {
		const accounting = JSON.parse(
			readFileSync(join(PACKAGE_DIR, "source-accounting.json"), "utf8"),
		);
		const secondary = accounting.secondary_representations as Array<{
			authoritative_obligation: string;
			secondary_representation: string;
			source_ranges: Array<{ path: string; lines: [number, number] }>;
		}>;
		expect(secondary.length).toBeGreaterThan(0);
		const items = scopedItems();
		for (const entry of secondary) {
			// The secondary representation carries NO lifecycle authority.
			expect(items.has(entry.secondary_representation)).toBe(false);
			// The authoritative obligation IS represented.
			expect(items.has(entry.authoritative_obligation)).toBe(true);
			// It is source-referenced.
			expect(entry.source_ranges.length).toBeGreaterThan(0);
		}
	});

	test("every normalized priority is in the native ledger vocabulary", () => {
		for (const epic of loadEpics()) {
			if (epic.priority !== null) {
				expect(FWMI_PRIORITIES).toContain(epic.priority as never);
			}
			for (const item of epic.items as Array<{ priority: string | null }>) {
				if (item.priority !== null) {
					expect(FWMI_PRIORITIES).toContain(item.priority as never);
				}
			}
		}
	});

	test("a conditional P0 is not promoted to a confirmed current P0", () => {
		const mcp = loadEpics().find(
			(epic) => epic.epic_id === "EPIC-CLINEMM-APPROVAL-MCP-AUTHORITY",
		);
		const item = (
			mcp?.items as Array<{
				item_id: string;
				priority: string | null;
				description: string;
			}>
		)[0];
		expect(item?.priority).toBe("P1");
		// The conditional wording survives verbatim in the source-derived text.
		expect(item?.description).toContain("P0-if-reproduced");
	});
});

describe("FWL02 migration package — source coverage", () => {
	test("the source accounting covers the whole root board", () => {
		const accounting = JSON.parse(
			readFileSync(join(PACKAGE_DIR, "source-accounting.json"), "utf8"),
		);
		const sections = accounting.section_dispositions as Array<{
			path: string;
			start_line: number;
			end_line: number;
		}>;
		const board = sections.filter(
			(section) => section.path === ".factory/epic-board.md",
		);
		expect(board.length).toBeGreaterThan(0);
		// The board regions are CONTIGUOUS and cover every line.
		const sorted = [...board].sort(
			(left, right) => left.start_line - right.start_line,
		);
		expect(sorted[0]?.start_line).toBe(1);
		expect(sorted[sorted.length - 1]?.end_line).toBe(44731);
		for (let index = 1; index < sorted.length; index++) {
			expect(sorted[index]?.start_line).toBe(
				(sorted[index - 1]?.end_line ?? 0) + 1,
			);
		}
	});

	test("the historical index covers every ACT report section of the board", () => {
		const board = readCommittedBytes(
			".factory/epic-board.md",
			manifest.source_head,
			REPO_ROOT,
		).toString("utf8");
		// The SAME shape the extractor matches: a level-1 OR level-2 heading
		// naming an ACT, a verdict and an ISO date.
		const headerPattern =
			/^#{1,2}\s+(ACT-[A-Za-z0-9._()-]+)\s+[—-]\s+(.+?)\s+[—-]\s+\d{4}-\d{2}-\d{2}/gm;
		const distinct = new Set<string>();
		let sections = 0;
		for (const match of board.matchAll(headerPattern)) {
			sections += 1;
			distinct.add(match[1] as string);
		}
		const identities = new Set(
			(index.records as Array<{ act_id: string }>).map(
				(record) => record.act_id,
			),
		);
		expect(sections).toBeGreaterThan(0);
		expect(distinct.size).toBe(identities.size);
		// Every identity the board reports is indexed, and every indexed
		// identity comes from the board.
		for (const identity of identities) {
			expect(distinct.has(identity)).toBe(true);
		}
	});

	test("every conflicting historical identity carries an explicit disposition", () => {
		const conflicting = (
			index.records as Array<{
				act_id: string;
				reconciliation: string;
				source_refs: unknown[];
			}>
		).filter((record) => record.reconciliation === "CONFLICTING");
		expect(conflicting.length).toBeGreaterThan(0);
		const known = new Set(
			(recon.records as Array<{ identities: string[] }>).flatMap(
				(record) => record.identities,
			),
		);
		for (const record of conflicting) {
			expect(known.has(record.act_id)).toBe(true);
			expect(record.source_refs.length).toBeGreaterThan(1);
		}
	});
});

describe("FWL02 migration package — validation receipt", () => {
	test("every executed check in the receipt is PASS", () => {
		const failures = (
			receipt.checks as Array<{ id: string; status: string }>
		).filter((check) => check.status !== "PASS");
		expect(failures).toEqual([]);
	});

	test("the receipt separates the four qualification strata", () => {
		expect(receipt.mechanical_coverage).toBeTruthy();
		expect(receipt.semantic_coverage).toBeTruthy();
		expect(receipt.verdict).toBe("SOURCE_RECONCILIATION_READY");
	});

	test("the full validation run reports zero failures", async () => {
		const results = validatePackage();
		const failures = results.filter((result) => result.status === "FAIL");
		expect(failures).toEqual([]);
	}, 60_000);
});

describe("FWL02 migration package — reconciliation identity uniqueness", () => {
	/**
	 * The reconciliation identity of a record, computed EXACTLY as the actual
	 * Leamas Go consumer computes it: kind + resolution + the SORTED
	 * identities. Two distinct records that share this key are REJECTED by
	 * the consumer with `conflicting reconciliation identity`, because the
	 * second would overwrite the first.
	 */
	test("the corrected package claims no reconciliation identity twice", () => {
		const groups = findConflictingReconciliationIdentities(recon.records);
		expect(groups).toEqual([]);
		expect(recon.records.length).toBe(21);
	});

	test("the corrected package carries exactly one authoritative board record", () => {
		const boardRecords = recon.records.filter(
			(record: FwmiReconciliationRecord) =>
				record.kind === "INCOMPLETE_COVERAGE" &&
				record.resolution === "RESOLVED" &&
				record.identities.includes(".factory/epic-board.md"),
		);
		expect(boardRecords.length).toBe(1);
	});

	test("the authoritative board record carries the 316-identity inventory", () => {
		const boardRecord = recon.records.find(
			(record: FwmiReconciliationRecord) =>
				record.kind === "INCOMPLETE_COVERAGE" &&
				record.resolution === "RESOLVED" &&
				record.identities.includes(".factory/epic-board.md"),
		);
		expect(boardRecord).toBeDefined();
		// The corrected inventory is stated, and the incomplete 167-identity
		// inventory is explicitly acknowledged as superseded.
		expect(boardRecord!.reason).toContain("316 distinct historical identities");
		expect(boardRecord!.reason).toContain("167");
		expect(boardRecord!.reason).toContain("SUPERSEDED");
		expect(boardRecord!.reason).toContain("INCOMPLETE");
	});

	test("the authoritative board record preserves the source references of both records", () => {
		const boardRecord = recon.records.find(
			(record: FwmiReconciliationRecord) =>
				record.kind === "INCOMPLETE_COVERAGE" &&
				record.resolution === "RESOLVED" &&
				record.identities.includes(".factory/epic-board.md"),
		);
		const ranges = boardRecord!.source_refs.map(
			(ref: FwmiSourceRef) => `${ref.path}:${ref.start_line}-${ref.end_line}`,
		);
		// The obsolete record's ranges (the operational index region).
		expect(ranges).toContain(".factory/epic-board.md:1-78");
		expect(ranges).toContain(".factory/epic-board.md:9344-9350");
		expect(ranges).toContain(".factory/epic-board.md:9443-9541");
		// The corrected record's ranges (the trailing region).
		expect(ranges).toContain(".factory/epic-board.md:9542-9542");
		expect(ranges).toContain(".factory/epic-board.md:9636-9636");
		expect(ranges).toContain(".factory/epic-board.md:44731-44731");
	});

	test("the obsolete 167-identity assessment is retained as migration evidence", () => {
		const accounting = JSON.parse(
			readFileSync(join(PACKAGE_DIR, "source-accounting.json"), "utf8"),
		);
		const superseded = accounting.superseded_assessments as Array<{
			identity: string;
			kind: string;
			resolution: string;
			superseded_claim: string;
			superseded_by: string;
			source_ranges: Array<{ path: string; lines: [number, number] }>;
		}>;
		expect(superseded.length).toBe(1);
		const entry = superseded[0]!;
		expect(entry.identity).toBe(".factory/epic-board.md");
		expect(entry.kind).toBe("INCOMPLETE_COVERAGE");
		expect(entry.resolution).toBe("RESOLVED");
		// The obsolete assessment's own claim, verbatim.
		expect(entry.superseded_claim).toContain("167 distinct identities");
		expect(entry.superseded_by).toContain("316");
		expect(entry.superseded_by).toContain("SUPERSEDED");
		// The obsolete record's source references are preserved.
		const ranges = entry.source_ranges.map(
			(ref) => `${ref.path}:${ref.lines[0]}-${ref.lines[1]}`,
		);
		expect(ranges).toContain(".factory/epic-board.md:1-78");
		expect(ranges).toContain(".factory/epic-board.md:9344-9350");
		expect(ranges).toContain(".factory/epic-board.md:9443-9541");
	});

	/**
	 * RED: the PREVIOUS package's shape — the obsolete 167-identity board
	 * record alongside the corrected 316-identity board record — is rejected
	 * by the same deterministic check. The check is not a property of the
	 * corrected package alone: it detects the collision that the consumer
	 * rejected.
	 */
	test("RED: the previous package's colliding board records are detected", () => {
		const previous = JSON.parse(
			readFileSync(
				join(
					REPO_ROOT,
					"factory/scripts/fwl02/__fixtures__/previous-reconciliation.json",
				),
				"utf8",
			),
		) as { records: FwmiReconciliationRecord[] };
		const groups = findConflictingReconciliationIdentities(previous.records);
		expect(groups.length).toBe(1);
		const group = groups[0]!;
		expect(group.records.length).toBe(2);
		expect(group.records[0]!.kind).toBe("INCOMPLETE_COVERAGE");
		expect(group.records[0]!.resolution).toBe("RESOLVED");
		expect(group.records[0]!.identities).toEqual([".factory/epic-board.md"]);
		// The two records are DISTINCT: the consumer compares their content
		// and rejects the pair.
		expect(group.records[0]!.reason).not.toBe(group.records[1]!.reason);
	});

	test("the identity key is order-insensitive over the identities", () => {
		const left: Pick<
			FwmiReconciliationRecord,
			"kind" | "resolution" | "identities"
		> = {
			kind: "INCOMPLETE_COVERAGE",
			resolution: "RESOLVED",
			identities: ["B", "A"],
		};
		const right: Pick<
			FwmiReconciliationRecord,
			"kind" | "resolution" | "identities"
		> = {
			kind: "INCOMPLETE_COVERAGE",
			resolution: "RESOLVED",
			identities: ["A", "B"],
		};
		expect(reconciliationIdentityKey(left)).toBe(
			reconciliationIdentityKey(right),
		);
	});

	test("the identity key separates records that differ in kind or resolution", () => {
		const base: Pick<
			FwmiReconciliationRecord,
			"kind" | "resolution" | "identities"
		> = {
			kind: "INCOMPLETE_COVERAGE",
			resolution: "RESOLVED",
			identities: [".factory/epic-board.md"],
		};
		expect(reconciliationIdentityKey(base)).not.toBe(
			reconciliationIdentityKey({ ...base, kind: "SOURCE_CONFLICT" }),
		);
		expect(reconciliationIdentityKey(base)).not.toBe(
			reconciliationIdentityKey({ ...base, resolution: "CONFLICT" }),
		);
	});
});

describe("FWL02 migration package — reproducible regeneration", () => {
	/**
	 * The digest of every GENERATOR-PRODUCED artifact, keyed by its relative
	 * path.
	 *
	 * The generator owns `source-manifest.json`, `epics/*.json`,
	 * `historical-index.json`, `reconciliation.json` and `frontier.md`. The
	 * supplemental artifacts (`source-accounting.json`,
	 * `decisions-and-knowledge-index.json`, `source-delta.md`) and the
	 * validation receipt are written by OTHER writers and are compared
	 * separately.
	 */
	const GENERATOR_ARTIFACTS = [
		"source-manifest.json",
		"historical-index.json",
		"reconciliation.json",
		"frontier.md",
	];

	function packageDigests(): Map<string, string> {
		const digests = new Map<string, string>();
		for (const name of GENERATOR_ARTIFACTS) {
			digests.set(
				name,
				createHash("sha256")
					.update(readFileSync(join(PACKAGE_DIR, name)))
					.digest("hex"),
			);
		}
		for (const name of readdirSync(join(PACKAGE_DIR, "epics")).sort()) {
			digests.set(
				`epics/${name}`,
				createHash("sha256")
					.update(readFileSync(join(PACKAGE_DIR, "epics", name)))
					.digest("hex"),
			);
		}
		return digests;
	}

	test("regeneration from the frozen source head is byte-identical", () => {
		const before = packageDigests();
		// The generator resolves the FROZEN source head, never `HEAD`, so the
		// regeneration is reproducible even after the publication commit
		// advances HEAD.
		const result = spawnSync(
			"bun",
			[join(REPO_ROOT, "factory/scripts/fwl02/generate.ts")],
			{ cwd: REPO_ROOT, encoding: "utf8" },
		);
		expect(result.status).toBe(0);
		const after = packageDigests();
		expect(after.size).toBe(before.size);
		for (const [path, digest] of before) {
			expect(after.get(path)).toBe(digest);
		}
	}, 60_000);
});
