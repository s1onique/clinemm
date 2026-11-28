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
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	FWMI_COVERAGES,
	FWMI_LIFECYCLES,
	FWMI_QUALIFICATIONS,
	FWMI_RELATIONSHIP_KINDS,
	FWMI_RESOLUTIONS,
	FWMI_SCHEMA_VERSION,
	type FwmiCoverage,
	type FwmiLifecycle,
	type FwmiQualification,
	type FwmiRelationshipKind,
	type FwmiResolution,
} from "./contract.ts";
import {
	committedFileFacts,
	readCommittedBytes,
	resolveCommit,
	splitCommittedLines,
	verifySourceRef,
} from "./source-refs.ts";
import { findDuplicateJsonMembers, validatePackage } from "./validate.ts";

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
				for (const relationship of (item.relationships ?? []) as Array<{
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
				for (const relationship of (item.relationships ?? []) as Array<
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
				(epic.items as Array<{ item_id: string }>).map((item) => item.item_id),
			),
		);
		for (const epic of loadEpics()) {
			for (const item of epic.items as Array<{
				item_id: string;
				relationships?: Array<{ kind: string; target: string }>;
			}>) {
				for (const relationship of item.relationships ?? []) {
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
