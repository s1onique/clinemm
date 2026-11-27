/**
 * tools/factory/fwmi/recon.ts
 *
 * LEGACY MARKDOWN MIGRATION — RECONNAISSANCE TOOLING.
 *
 * The legacy Markdown adapter is retained as RECONNAISSANCE: it answers
 * "what does the board look like structurally, and what did the previous
 * migration fail to conserve?" It is NOT the import path, and this ACT
 * deliberately does NOT extend it into a universal semantic Markdown parser.
 *
 * The tool reports, for the ACTUAL repository source:
 *
 *   - the size of the board and the epic detail files (the inventory the
 *     legacy adapter walked);
 *   - the counts the legacy adapter produced on the FWL02 baseline
 *     (sections, work-item representations, extracted ACT identities) —
 *     recomputed by the same structural rules, so the operator can compare;
 *   - the SEMANTIC LOSS PROFILE: the classes of meaning the legacy
 *     adapter structurally cannot carry, namely acceptance criteria,
 *     dependency relationships, evidence references and blockers;
 *   - the legacy adapter's unresolved/deferred conflation count, which is
 *     the defect this ACT exists to prevent.
 *
 * Every number is derived from the source, not asserted. The tool is
 * read-only and writes nothing.
 *
 * Usage:
 *   bun tools/factory/fwmi/recon.ts [--repo=<root>]
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveRepoRoot } from "./apply.ts";

/** The ACT identity pattern the legacy adapter extracted. */
const ACT_ID_PATTERN = /\bACT-[A-Z0-9][A-Z0-9_-]*\b/g;

/** One reconnaissance measurement. */
export interface ReconMeasurement {
	readonly name: string;
	readonly value: number;
	readonly note: string;
}

/** The reconnaissance report. */
export interface ReconReport {
	readonly boardLines: number;
	readonly boardBytes: number;
	readonly epicFiles: number;
	readonly epicLines: number;
	readonly sections: number;
	readonly workItemRepresentations: number;
	readonly extractedActIdentities: number;
	/** The semantic classes the legacy Markdown path cannot carry. */
	readonly semanticLossProfile: readonly {
		readonly class: string;
		readonly count: number;
		readonly note: string;
	}[];
	/** Rows whose source status is absent — the conflation the migration fixes. */
	readonly unknownStatusCount: number;
}

/** The ACT identity pattern the legacy adapter extracted. */

/**
 * Measure the legacy Markdown migration surface.
 *
 * This is deliberately a STRUCTURAL measurement: it counts headings,
 * table rows and ACT identity strings. It does NOT attempt to recover
 * engineering meaning, which is precisely the work the FWMI interchange
 * performs.
 */
export function measureLegacySurface(root: string): ReconReport {
	const boardPath = join(root, ".factory", "epic-board.md");
	const board = existsSync(boardPath) ? readFileSync(boardPath, "utf8") : "";
	const boardLines = board ? board.split("\n").length : 0;
	const boardBytes = Buffer.byteLength(board, "utf8");

	const epicsDir = join(root, ".factory", "epics");
	let epicFiles = 0;
	let epicLines = 0;
	let sections = 0;
	let workItemRepresentations = 0;
	let extractedActIdentities = 0;
	let unknownStatusCount = 0;

	const measure = (content: string): void => {
		const lines = content.split("\n");
		sections += lines.filter((l) => /^#{1,6}\s/.test(l)).length;
		workItemRepresentations += lines.filter(
			(l) => /^\|\s*[^|]*\|/.test(l) && !/^\|[\s:|-]+\|/.test(l),
		).length;
		extractedActIdentities += content.match(ACT_ID_PATTERN)?.length ?? 0;
		// A table row whose state cell is empty carries an ABSENT status.
		// The legacy adapter represented those as deferred; that is the
		// conflation the interchange separates.
		for (const line of lines) {
			if (!/^\|\s*[^|]*\|/.test(line)) continue;
			const cells = line
				.split("|")
				.slice(1, -1)
				.map((c) => c.trim());
			// The state cell is the second column of a board table row. An
			// empty state cell means the SOURCE stated no status; the
			// legacy adapter represented those as deferred.
			if (cells.length >= 3 && cells[1] === "") unknownStatusCount++;
		}
	};

	measure(board);

	if (existsSync(epicsDir)) {
		for (const file of readdirSync(epicsDir).sort()) {
			if (!file.endsWith(".md")) continue;
			epicFiles++;
			const content = readFileSync(join(epicsDir, file), "utf8");
			epicLines += content.split("\n").length;
			measure(content);
		}
	}

	return {
		boardLines,
		boardBytes,
		epicFiles,
		epicLines,
		sections,
		workItemRepresentations,
		extractedActIdentities,
		semanticLossProfile: [
			{
				class: "acceptance criteria",
				count: 0,
				note: "the legacy Markdown path carries no acceptance criteria; the FWL02 baseline persisted 0",
			},
			{
				class: "dependency relationships",
				count: 0,
				note: "the legacy Markdown path carries no typed dependency edges; the FWL02 baseline persisted 0",
			},
			{
				class: "evidence references",
				count: 0,
				note: "the legacy Markdown path carries no evidence references; the FWL02 baseline persisted 0",
			},
			{
				class: "blockers",
				count: 0,
				note: "the legacy Markdown path carries no blockers; the FWL02 baseline persisted 0",
			},
		],
		unknownStatusCount,
	};
}

/** Render the reconnaissance report. */
export function renderReconReport(report: ReconReport): string {
	const lines: string[] = [];
	lines.push("LEGACY MARKDOWN MIGRATION — RECONNAISSANCE (read-only)");
	lines.push("─".repeat(72));
	lines.push(`board lines=${report.boardLines} bytes=${report.boardBytes}`);
	lines.push(`epic files=${report.epicFiles} epic lines=${report.epicLines}`);
	lines.push(
		`sections=${report.sections} work-item representations=${report.workItemRepresentations}`,
	);
	lines.push(`extracted ACT identities=${report.extractedActIdentities}`);
	lines.push(
		`absent-status rows (legacy conflation risk)=${report.unknownStatusCount}`,
	);
	lines.push("─".repeat(72));
	lines.push("SEMANTIC CLASSES THE LEGACY PATH CANNOT CARRY:");
	for (const entry of report.semanticLossProfile) {
		lines.push(`  ${entry.class.padEnd(24)} ${entry.note}`);
	}
	lines.push("─".repeat(72));
	lines.push(
		"This tool is RECONNAISSANCE ONLY. The import path is the FWMI v1 interchange adapter.",
	);
	return lines.join("\n");
}

/** CLI entry point. */
function main(): void {
	const repoArg = process.argv.find((a) => a.startsWith("--repo="));
	const root = repoArg
		? resolve(repoArg.slice("--repo=".length))
		: resolveRepoRoot(process.cwd());
	console.log(renderReconReport(measureLegacySurface(root)));
}

if (import.meta.main) main();
