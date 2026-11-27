/**
 * tools/factory/fwmi/fwmi-adapter.test.ts
 *
 * Focused executable qualification for the FWMI v1 interchange adapter.
 *
 * Each test names the FWL02 requirement it discharges. The suite is
 * deliberately narrow: it exercises the adapter's CONTRACT, not the
 * repository's content.
 *
 * Run with:
 *   cd tools/factory/fwmi && bunx vitest run --config vitest.config.ts
 *   (or, from the repo root: bun test tools/factory/fwmi/fwmi-adapter.test.ts)
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPlan, computeDeltas } from "./apply.ts";
import { verifyPersistedConservation } from "./conserve.ts";
import { loadFwmiPackage } from "./load.ts";
import { lookupHistoricalActs } from "./lookup.ts";
import { buildImportPlan, ledgerRecordPath } from "./plan.ts";
import { measureLegacySurface } from "./recon.ts";
import { validateFwmiPackage } from "./validate.ts";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__", "sample-package");
const SHA = "a".repeat(64);

let workDir: string;

/** Copy the sample package into a scratch directory so tests can mutate it. */
function freshPackage(): string {
	const dir = join(workDir, `pkg-${Math.random().toString(36).slice(2)}`);
	mkdirSync(join(dir, "epics"), { recursive: true });
	for (const file of [
		"source-manifest.json",
		"historical-index.json",
		"reconciliation.json",
		"frontier.md",
		"validation-receipt.json",
	]) {
		writeFileSync(
			join(dir, file),
			readFileSync(join(FIXTURE_DIR, file), "utf8"),
		);
	}
	writeFileSync(
		join(dir, "epics", "EPIC-ARCHITECTURE.json"),
		readFileSync(join(FIXTURE_DIR, "epics", "EPIC-ARCHITECTURE.json"), "utf8"),
	);
	return dir;
}

/** A minimal repository tree for the adapter to write into. */
function freshRepo(): string {
	const dir = join(workDir, `repo-${Math.random().toString(36).slice(2)}`);
	mkdirSync(join(dir, ".factory", "epics"), { recursive: true });
	mkdirSync(join(dir, "docs", "closure-plans"), { recursive: true });
	writeFileSync(join(dir, ".factory", "epic-board.md"), "# board\n");
	writeFileSync(
		join(dir, ".factory", "epics", "architecture.md"),
		"# architecture\n",
	);
	return dir;
}

/** Read and mutate the epic artifact of a package. */
function editEpics(
	dir: string,
	mutate: (epic: Record<string, unknown>) => void,
): void {
	const path = join(dir, "epics", "EPIC-ARCHITECTURE.json");
	const epic = JSON.parse(readFileSync(path, "utf8")) as Record<
		string,
		unknown
	>;
	mutate(epic);
	writeFileSync(path, `${JSON.stringify(epic, null, 2)}\n`);
}

beforeEach(() => {
	workDir = mkdtempSync(join(tmpdir(), "fwmi-test-"));
});

afterEach(() => {
	if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe("FWMI v1 interchange validation", () => {
	it("accepts a well-formed package", () => {
		const loaded = loadFwmiPackage(FIXTURE_DIR);
		expect(loaded.ok).toBe(true);
		if (!loaded.ok) return;
		const result = validateFwmiPackage(loaded.package);
		expect(result.ok).toBe(true);
		expect(result.findings.filter((f) => f.severity === "ERROR")).toHaveLength(
			0,
		);
	});

	it("rejects a package with a missing artifact", () => {
		const dir = freshPackage();
		rmSync(join(dir, "reconciliation.json"));
		const loaded = loadFwmiPackage(dir);
		expect(loaded.ok).toBe(false);
		if (loaded.ok) return;
		expect(loaded.problems.some((p) => p.code === "MISSING_ARTIFACT")).toBe(
			true,
		);
	});

	it("rejects a package whose schema version is wrong", () => {
		const dir = freshPackage();
		const path = join(dir, "source-manifest.json");
		const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<
			string,
			unknown
		>;
		manifest.schema_version = 2;
		writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
		const loaded = loadFwmiPackage(dir);
		expect(loaded.ok).toBe(false);
		if (loaded.ok) return;
		expect(
			loaded.problems.some((p) => p.code === "SCHEMA_VERSION_MISMATCH"),
		).toBe(true);
	});

	it("rejects a source reference whose digest is malformed", () => {
		const dir = freshPackage();
		editEpics(dir, (epic) => {
			const items = epic.items as { source_refs: { sha256: string }[] }[];
			items[0].source_refs[0].sha256 = "NOT-A-DIGEST";
		});
		const loaded = loadFwmiPackage(dir);
		expect(loaded.ok).toBe(true);
		if (!loaded.ok) return;
		const result = validateFwmiPackage(loaded.package);
		expect(result.ok).toBe(false);
		expect(
			result.findings.some((f) => f.code === "SOURCE_REF_SHA256_INVALID"),
		).toBe(true);
	});

	it("rejects a source reference with an inverted line range", () => {
		const dir = freshPackage();
		editEpics(dir, (epic) => {
			const items = epic.items as {
				source_refs: { start_line: number; end_line: number }[];
			}[];
			items[0].source_refs[0].start_line = 500;
			items[0].source_refs[0].end_line = 100;
		});
		const loaded = loadFwmiPackage(dir);
		if (!loaded.ok) return;
		const result = validateFwmiPackage(loaded.package);
		expect(result.ok).toBe(false);
		expect(
			result.findings.some((f) => f.code === "SOURCE_REF_RANGE_INVERTED"),
		).toBe(true);
	});

	it("rejects an unsupported authoritative state transition", () => {
		const dir = freshPackage();
		editEpics(dir, (epic) => {
			const items = epic.items as { lifecycle: string }[];
			items[0].lifecycle = "INVENTED_STATUS";
		});
		const loaded = loadFwmiPackage(dir);
		if (!loaded.ok) return;
		const result = validateFwmiPackage(loaded.package);
		expect(result.ok).toBe(false);
		expect(
			result.findings.some((f) => f.code === "ITEM_LIFECYCLE_INVALID"),
		).toBe(true);
	});

	it("rejects a dependency that resolves to nothing and is not accounted for", () => {
		const dir = freshPackage();
		editEpics(dir, (epic) => {
			const items = epic.items as { dependencies: string[] }[];
			items[0].dependencies = ["EPIC-GHOST/NOWHERE"];
		});
		const loaded = loadFwmiPackage(dir);
		if (!loaded.ok) return;
		const result = validateFwmiPackage(loaded.package);
		expect(result.ok).toBe(false);
		expect(
			result.findings.some((f) => f.code === "DEPENDENCY_UNRESOLVED"),
		).toBe(true);
	});

	it("rejects a package whose producer receipt reports a failing check", () => {
		const dir = freshPackage();
		const path = join(dir, "validation-receipt.json");
		const receipt = JSON.parse(readFileSync(path, "utf8")) as Record<
			string,
			unknown
		>;
		receipt.checks = [
			{ id: "semantic_conservation", status: "FAIL", detail: "not conserved" },
		];
		writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
		const loaded = loadFwmiPackage(dir);
		if (!loaded.ok) return;
		const result = validateFwmiPackage(loaded.package);
		expect(result.ok).toBe(false);
		expect(
			result.findings.some((f) => f.code === "PRODUCER_RECEIPT_FAIL"),
		).toBe(true);
	});

	it("rejects a package whose producer halted on repository trust", () => {
		const dir = freshPackage();
		const path = join(dir, "validation-receipt.json");
		const receipt = JSON.parse(readFileSync(path, "utf8")) as Record<
			string,
			unknown
		>;
		receipt.verdict = "HALT_REPOSITORY_TRUST";
		writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
		const loaded = loadFwmiPackage(dir);
		if (!loaded.ok) return;
		const result = validateFwmiPackage(loaded.package);
		expect(result.ok).toBe(false);
		expect(
			result.findings.some((f) => f.code === "PRODUCER_HALT_REPOSITORY_TRUST"),
		).toBe(true);
	});

	it("rejects duplicate epic identities", () => {
		const dir = freshPackage();
		const src = join(dir, "epics", "EPIC-ARCHITECTURE.json");
		writeFileSync(
			join(dir, "epics", "EPIC-ARCHITECTURE-COPY.json"),
			readFileSync(src, "utf8"),
		);
		const loaded = loadFwmiPackage(dir);
		if (!loaded.ok) return;
		const result = validateFwmiPackage(loaded.package);
		expect(result.ok).toBe(false);
		expect(result.findings.some((f) => f.code === "EPIC_ID_DUPLICATE")).toBe(
			true,
		);
	});
});

describe("FWMI v1 adapter semantics", () => {
	it("preserves unknown status distinctly from intentional deferral", () => {
		const loaded = loadFwmiPackage(FIXTURE_DIR);
		if (!loaded.ok) throw new Error("fixture failed to load");
		const plan = buildImportPlan(loaded.package);
		const unknown = plan.entries.find(
			(e) => e.target.act_id === "EPIC-ARCHITECTURE/E-UNKNOWN",
		);
		expect(unknown).toBeDefined();
		// The source status was unknown (null). It must not be represented as
		// DEFERRED, which would assert an intentional postponement that the
		// source never made.
		expect(unknown!.record.migration.original_status).toBeNull();
		expect(unknown!.record.migration.lifecycle).toBe("UNRESOLVED");
		expect(unknown!.record.migration.lifecycle).not.toBe("DEFERRED");
	});

	it("preserves the original verdict without acceptance promotion", () => {
		const loaded = loadFwmiPackage(FIXTURE_DIR);
		if (!loaded.ok) throw new Error("fixture failed to load");
		const plan = buildImportPlan(loaded.package);
		for (const entry of plan.entries) {
			expect(entry.record.acceptance.state).toBe("NOT_VERIFIED_BY_IMPORT");
		}
		const e7 = plan.entries.find(
			(e) => e.target.act_id === "EPIC-ARCHITECTURE/E7",
		);
		expect(e7!.record.verdict).toBe("STRUCTURAL_ONLY");
		expect(e7!.record.acceptance.source_qualification).toBe("STRUCTURAL_ONLY");
	});

	it("does not treat SOURCE_RECONCILIATION_READY as cutover approval", () => {
		const loaded = loadFwmiPackage(FIXTURE_DIR);
		if (!loaded.ok) throw new Error("fixture failed to load");
		const plan = buildImportPlan(loaded.package);
		expect(plan.reconciliationReady).toBe(true);
		for (const entry of plan.entries) {
			// The reconciliation state is carried, but the acceptance state
			// never becomes an approval.
			expect(entry.record.acceptance.interchange_reconciliation_state).toBe(
				"SOURCE_RECONCILIATION_READY",
			);
			expect(entry.record.acceptance.state).not.toBe("ACCEPTED");
			expect(entry.record.acceptance.state).not.toBe("APPROVED");
		}
	});

	it("conserves cross-links without duplicating authoritative obligations", () => {
		const loaded = loadFwmiPackage(FIXTURE_DIR);
		if (!loaded.ok) throw new Error("fixture failed to load");
		const plan = buildImportPlan(loaded.package);
		const e8 = plan.entries.find(
			(e) => e.target.act_id === "EPIC-ARCHITECTURE/E8",
		);
		expect(e8).toBeDefined();
		const links = e8!.record.migration.cross_links;
		// The CROSS_LINK edge must not carry an obligation; only DEPENDS_ON does.
		const cross = links.find((l) => l.kind === "CROSS_LINK");
		expect(cross).toBeDefined();
		expect(cross!.carries_obligation).toBe(false);
		const depends = links.find((l) => l.kind === "DEPENDS_ON");
		expect(depends).toBeDefined();
		expect(depends!.carries_obligation).toBe(true);
		// The cross-link target must NOT have been duplicated into a second
		// authoritative record.
		const duplicated = plan.entries.filter(
			(e) => e.target.act_id === "EPIC-SAFE-YOLO-SEATBELT/E8",
		);
		expect(duplicated).toHaveLength(0);
	});

	it("preserves explicit dependencies and criteria with their coverage", () => {
		const loaded = loadFwmiPackage(FIXTURE_DIR);
		if (!loaded.ok) throw new Error("fixture failed to load");
		const plan = buildImportPlan(loaded.package);
		const e9 = plan.entries.find(
			(e) => e.target.act_id === "EPIC-ARCHITECTURE/E9",
		);
		expect(e9).toBeDefined();
		expect(e9!.record.migration.dependencies).toContain("EPIC-ARCHITECTURE/E8");
		expect(e9!.record.migration.dependency_coverage).toBe("COMPLETE");
		expect(e9!.record.migration.criteria_coverage).toBe("UNKNOWN");
		// An empty criteria list with UNKNOWN coverage must NOT be
		// normalised to COMPLETE.
		expect(e9!.record.migration.criteria).toHaveLength(0);
		expect(e9!.record.migration.criteria_coverage).not.toBe("COMPLETE");
	});

	it("preserves unresolved migration records", () => {
		const loaded = loadFwmiPackage(FIXTURE_DIR);
		if (!loaded.ok) throw new Error("fixture failed to load");
		const plan = buildImportPlan(loaded.package);
		const unresolvedItem = plan.entries.find(
			(e) => e.target.act_id === "EPIC-ARCHITECTURE/E-UNKNOWN",
		);
		expect(unresolvedItem!.record.migration.lifecycle).toBe("UNRESOLVED");
		// The reconciliation manifest's unresolved cross-link is NOT silently
		// resolved into two independent obligations.
		expect(
			plan.entries.filter((e) =>
				e.target.act_id.includes("TEMP-INTERNAL-CONTROL-CLEANUP"),
			),
		).toHaveLength(0);
	});
});

describe("FWMI v1 persistence, conservation and replay", () => {
	it("writes the imported ledger records into the imported namespace only", () => {
		const repo = freshRepo();
		const loaded = loadFwmiPackage(FIXTURE_DIR);
		if (!loaded.ok) throw new Error("fixture failed to load");
		const plan = buildImportPlan(loaded.package);
		applyPlan({ root: repo }, plan);

		for (const entry of plan.entries) {
			expect(entry.target.path.startsWith("docs/closure-plans/imported/")).toBe(
				true,
			);
			expect(existsSync(join(repo, entry.target.path))).toBe(true);
		}
		// The EXISTING canonical surfaces are untouched.
		expect(readFileSync(join(repo, ".factory", "epic-board.md"), "utf8")).toBe(
			"# board\n",
		);
		expect(
			readFileSync(join(repo, ".factory", "epics", "architecture.md"), "utf8"),
		).toBe("# architecture\n");
		expect(
			existsSync(join(repo, ledgerRecordPath("EPIC-ARCHITECTURE/E8"))),
		).toBe(true);
	});

	it("produces zero unintended canonical byte delta on an exact replay", () => {
		const repo = freshRepo();
		const loaded = loadFwmiPackage(FIXTURE_DIR);
		if (!loaded.ok) throw new Error("fixture failed to load");
		const plan = buildImportPlan(loaded.package);

		const before = computeDeltas({ root: repo }, plan);
		expect(before.byteDelta).toBeGreaterThan(0);

		applyPlan({ root: repo }, plan);

		const after = computeDeltas({ root: repo }, plan);
		expect(after.byteDelta).toBe(0);
		expect(after.changedFileCount).toBe(0);
		expect(after.replayClean).toBe(true);
	});

	it("is deterministic: the same package yields byte-identical records", () => {
		const loaded = loadFwmiPackage(FIXTURE_DIR);
		if (!loaded.ok) throw new Error("fixture failed to load");
		const first = buildImportPlan(loaded.package);
		const second = buildImportPlan(loaded.package);
		expect(first.entries.length).toBe(second.entries.length);
		for (let i = 0; i < first.entries.length; i++) {
			expect(first.entries[i].contentSha256).toBe(
				second.entries[i].contentSha256,
			);
		}
	});

	it("passes persisted semantic conservation after an import", () => {
		const repo = freshRepo();
		const loaded = loadFwmiPackage(FIXTURE_DIR);
		if (!loaded.ok) throw new Error("fixture failed to load");
		const plan = buildImportPlan(loaded.package);
		applyPlan({ root: repo }, plan);

		const result = verifyPersistedConservation(repo, loaded.package, plan);
		const errors = result.findings.filter((f) => f.severity === "ERROR");
		expect(errors).toHaveLength(0);
		expect(result.ok).toBe(true);
		expect(result.recordsChecked).toBe(4);
		expect(result.historicalActsChecked).toBe(2);
	});

	it("detects a persisted record whose unknown status was normalised to deferred", () => {
		const repo = freshRepo();
		const loaded = loadFwmiPackage(FIXTURE_DIR);
		if (!loaded.ok) throw new Error("fixture failed to load");
		const plan = buildImportPlan(loaded.package);
		applyPlan({ root: repo }, plan);

		// Tamper with the persisted record the way the defect the migration
		// exists to prevent would: an unknown status turned into an
		// intentional deferral.
		const path = join(repo, ledgerRecordPath("EPIC-ARCHITECTURE/E-UNKNOWN"));
		const record = JSON.parse(readFileSync(path, "utf8")) as Record<
			string,
			Record<string, unknown>
		>;
		record.migration.lifecycle = "DEFERRED";
		writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

		const result = verifyPersistedConservation(repo, loaded.package, plan);
		expect(result.ok).toBe(false);
		expect(
			result.findings.some((f) => f.severity === "ERROR" && f.check === "C3"),
		).toBe(true);
	});

	it("detects a persisted record whose verdict was promoted to acceptance", () => {
		const repo = freshRepo();
		const loaded = loadFwmiPackage(FIXTURE_DIR);
		if (!loaded.ok) throw new Error("fixture failed to load");
		const plan = buildImportPlan(loaded.package);
		applyPlan({ root: repo }, plan);

		const path = join(repo, ledgerRecordPath("EPIC-ARCHITECTURE/E7"));
		const record = JSON.parse(readFileSync(path, "utf8")) as Record<
			string,
			Record<string, unknown>
		>;
		record.acceptance.state = "ACCEPTED";
		writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

		const result = verifyPersistedConservation(repo, loaded.package, plan);
		expect(result.ok).toBe(false);
		expect(
			result.findings.some((f) => f.severity === "ERROR" && f.check === "C7"),
		).toBe(true);
	});

	it("detects a lost explicit dependency", () => {
		const repo = freshRepo();
		const loaded = loadFwmiPackage(FIXTURE_DIR);
		if (!loaded.ok) throw new Error("fixture failed to load");
		const plan = buildImportPlan(loaded.package);
		applyPlan({ root: repo }, plan);

		const path = join(repo, ledgerRecordPath("EPIC-ARCHITECTURE/E9"));
		const record = JSON.parse(readFileSync(path, "utf8")) as Record<
			string,
			Record<string, unknown>
		>;
		record.migration.dependencies = [];
		writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

		const result = verifyPersistedConservation(repo, loaded.package, plan);
		expect(result.ok).toBe(false);
		expect(
			result.findings.some((f) => f.severity === "ERROR" && f.check === "C5"),
		).toBe(true);
	});

	it("preserves historical ACT lookup with the original verdict", () => {
		const repo = freshRepo();
		const loaded = loadFwmiPackage(FIXTURE_DIR);
		if (!loaded.ok) throw new Error("fixture failed to load");
		const plan = buildImportPlan(loaded.package);
		applyPlan({ root: repo }, plan);

		const result = lookupHistoricalActs(
			repo,
			"ACT-CLINEMM-FACTORIZE-F3-SHADOW-RETIREMENT01",
		);
		expect(result.found).toBe(true);
		const match = result.matches.find((m) =>
			m.sources.includes("imported_index"),
		);
		expect(match).toBeDefined();
		expect(match!.original_verdict).toBe("PASS_STRUCTURAL_ONLY");
		expect(match!.epic_id).toBe("EPIC-ARCHITECTURE");
		expect(match!.work_item_ids).toContain("EPIC-ARCHITECTURE/E8");
	});

	it("preserves an unresolved historical record as unresolved", () => {
		const repo = freshRepo();
		const loaded = loadFwmiPackage(FIXTURE_DIR);
		if (!loaded.ok) throw new Error("fixture failed to load");
		const plan = buildImportPlan(loaded.package);
		applyPlan({ root: repo }, plan);

		const result = lookupHistoricalActs(
			repo,
			"ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01",
		);
		expect(result.found).toBe(true);
		const match = result.matches.find((m) =>
			m.sources.includes("imported_index"),
		);
		expect(match).toBeDefined();
		expect(match!.unresolved).toBe(true);
		expect(match!.original_verdict).toBeNull();
	});

	it("reports a missing historical ACT as not found", () => {
		const repo = freshRepo();
		const result = lookupHistoricalActs(repo, "ACT-CLINEMM-NOT-REAL-0001");
		expect(result.found).toBe(false);
	});
});

describe("FWMI v1 legacy Markdown reconnaissance", () => {
	it("measures the legacy surface without claiming semantic meaning", () => {
		const repo = freshRepo();
		writeFileSync(
			join(repo, ".factory", "epic-board.md"),
			"# board\n\n## Section\n\n| ID | State | Purpose |\n|---|---|---|\n| X | OPEN | do a thing |\n",
		);
		const report = measureLegacySurface(repo);
		expect(report.boardLines).toBeGreaterThan(0);
		expect(report.epicFiles).toBe(1);
		// The reconnaissance tool reports the classes the legacy path cannot
		// carry; it does not attempt to recover them.
		expect(report.semanticLossProfile.length).toBeGreaterThan(0);
		for (const entry of report.semanticLossProfile) {
			expect(entry.count).toBe(0);
		}
	});

	it("does not treat an absent status as an intentional deferral", () => {
		const repo = freshRepo();
		// A row with an empty state cell: the legacy adapter represented
		// these as deferred. The reconnaissance tool counts them so the
		// conflation stays visible.
		writeFileSync(
			join(repo, ".factory", "epic-board.md"),
			"| ID | State | Purpose |\n|---|---|---|\n| X |  | do a thing |\n",
		);
		const report = measureLegacySurface(repo);
		expect(report.unknownStatusCount).toBeGreaterThan(0);
	});
});
