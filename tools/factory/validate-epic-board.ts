#!/usr/bin/env bun
/**
 * tools/factory/validate-epic-board.ts
 *
 * Final validator for ACT-CLINEMM-FACTORY-EPIC-BOARD-SHARDING01.
 * Runs against the actual current `.factory/epic-board.md` (target ≤220 / hard cap <400).
 * Implements the gates frozen in `.factory/epics/_index-contract.md`.
 *
 * Hard gates (all must PASS):
 *   INDEX_LINES_LT_400
 *   ALL_INDEX_LINKS_EXIST
 *   ALL_INDEX_LINKS_RELATIVE
 *   NO_DUPLICATE_EPIC_ROWS
 *   NO_DUPLICATE_CURRENT_WORK_IDS
 *   EVERY_OPEN_NEXT_ROW_HAS_DETAIL
 *   STATUS_VOCABULARY_VALID
 *   HOST_REQUIRED_QUALIFICATION_VALID
 *   OLD_ACT_IDS_PRESERVED
 *   NO_OVERSIZED_INDEX_TABLE_CELL
 *
 * Advisory (informational, does not fail the build):
 *   INDEX_TARGET_READABLE       (PASS ≤220, WARN 221..399)
 *
 * Conservation: anchors at 5e96cfd3a. CURRENT_DURABLE_IDS =
 * epic-board.md + .factory/epics/*.md + docs/closure-plans/*.json.
 * .factory/evidence/* is treated as optional (a fresh clone can pass).
 *
 * Run with: bun tools/factory/validate-epic-board.ts
 * Exit code: 0 on PASS, 1 on any hard-gate failure.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, normalize, resolve } from "node:path";

// ---------- Configuration ----------
const REPO_ROOT = resolve(import.meta.dir, "../..");
const BOARD_PATH = join(REPO_ROOT, ".factory/epic-board.md");
const EPICS_DIR = join(REPO_ROOT, ".factory/epics");
const CLOSURE_PLANS_DIR = join(REPO_ROOT, "docs/closure-plans");
const EVIDENCE_DIR = join(REPO_ROOT, ".factory/evidence");
const ANCHOR = "5e96cfd3a";

const HARD_CAP = 400;
const TARGET = 220;
const TABLE_CELL_CAP = 280; // per reviewer's "a few hundred characters" guidance

// Closed-class status base tokens per contract §2.
const STATUS_BASE = new Set([
	"NEXT",
	"OPEN",
	"BLOCKED",
	"HOLD",
	"DEFER",
	"CLOSED",
	"SUPERSEDED",
	"NEEDS_CLASSIFICATION",
	"HOST_REQUIRED",
	"ACTIVE",
]);

// ---------- Result helpers ----------
interface GateResult {
	name: string;
	pass: boolean;
	severity: "hard" | "advisory";
	details?: string;
}

const gates: GateResult[] = [];

function hard(name: string, pass: boolean, details?: string) {
	gates.push({ name, pass, severity: "hard", details });
}
function advisory(name: string, pass: boolean, details?: string) {
	gates.push({ name, pass, severity: "advisory", details });
}

// ---------- Load board ----------
const boardRaw = readFileSync(BOARD_PATH, "utf8");
const boardLines = boardRaw.split("\n");

// ---------- Gate 1: INDEX_LINES_LT_400 ----------
{
	const lineCount = boardLines.length;
	hard("INDEX_LINES_LT_400", lineCount < HARD_CAP, `${lineCount} lines (cap: <${HARD_CAP})`);
	advisory("INDEX_TARGET_READABLE", lineCount <= TARGET, `${lineCount} lines (target: ≤${TARGET}, warn 221..399)`);
}

// ---------- Gate 2 + 3: ALL_INDEX_LINKS_EXIST + ALL_INDEX_LINKS_RELATIVE ----------
{
	const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
	const allLinks: { target: string; line: number }[] = [];
	let m: RegExpExecArray | null;
	while ((m = linkRe.exec(boardRaw)) !== null) {
		allLinks.push({ target: m[2], line: boardRaw.slice(0, m.index).split("\n").length });
	}
	const boardDir = resolve(REPO_ROOT, ".factory");
	const brokenLinks: string[] = [];
	const absoluteLinks: string[] = [];
	for (const link of allLinks) {
		const raw = link.target.split("#", 1)[0];
		if (!raw) continue; // anchor-only link
		// Reject absolute github.com URLs (the contract's link rule)
		if (/^https?:\/\//i.test(raw)) {
			absoluteLinks.push(`L${link.line}: ${raw}`);
			continue;
		}
		// Relative: resolve against the board file's directory
		const targetPath = normalize(resolve(boardDir, raw));
		if (!existsSync(targetPath)) {
			brokenLinks.push(`L${link.line}: ${raw}`);
		}
	}
	hard(
		"ALL_INDEX_LINKS_EXIST",
		brokenLinks.length === 0,
		brokenLinks.length === 0 ? `${allLinks.length} relative links, all resolve` : `broken: ${brokenLinks.join(", ")}`,
	);
	hard(
		"ALL_INDEX_LINKS_RELATIVE",
		absoluteLinks.length === 0,
		absoluteLinks.length === 0 ? `${allLinks.length} relative links, no absolute URLs` : `absolute: ${absoluteLinks.join(", ")}`,
	);
}

// ---------- Structural extraction: tables and their headers ----------
interface Table {
	headerLine: number;
	headers: string[];
	rows: string[][];
}
function extractTables(content: string): Table[] {
	const lines = content.split("\n");
	const tables: Table[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|.*\|.*\|\s*$/.test(line)) {
			if (i + 1 < lines.length && /^\s*\|[\s\-:|]+\|\s*$/.test(lines[i + 1])) {
				const headerCells = line.split("|").slice(1, -1).map((c) => c.trim());
				const tbl: Table = { headerLine: i + 1, headers: headerCells, rows: [] };
				let j = i + 2;
				while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) {
					const rowCells = lines[j].split("|").slice(1, -1).map((c) => c.trim());
					tbl.rows.push(rowCells);
					j++;
				}
				tables.push(tbl);
				i = j;
				continue;
			}
		}
		i++;
	}
	return tables;
}

const tables = extractTables(boardRaw);

function findTableUnder(heading: string): Table | undefined {
	const headingIdx = boardLines.findIndex((l) => l.trim() === heading);
	if (headingIdx < 0) return undefined;
	for (const tbl of tables) {
		if (tbl.headerLine > headingIdx) return tbl;
	}
	return undefined;
}

const currentFrontierTbl = findTableUnder("## Current frontier");
const activeEpicsTbl = findTableUnder("## Active epics");
const openWorkTbl = findTableUnder("## Open supporting work");
const deferredTbl = findTableUnder("## Deferred / hold");
const recentlyClosedTbl = findTableUnder("## Recently closed transitions");
// ---------- Gate 4: NO_DUPLICATE_EPIC_ROWS ----------
{
	const epicNames = new Map<string, number>();
	const dupes: string[] = [];
	if (activeEpicsTbl) {
		const epicColIdx = activeEpicsTbl.headers.findIndex((h) => /^Epic$/i.test(h));
		if (epicColIdx >= 0) {
			for (const row of activeEpicsTbl.rows) {
				const name = row[epicColIdx];
				if (!name) continue;
				const seen = epicNames.get(name) ?? 0;
				epicNames.set(name, seen + 1);
			}
			for (const [name, count] of epicNames) {
				if (count > 1) dupes.push(`${name} (x${count})`);
			}
		}
	}
	hard(
		"NO_DUPLICATE_EPIC_ROWS",
		dupes.length === 0,
		dupes.length === 0 ? `${epicNames.size} unique epic rows in Active epics` : `duplicate epic names: ${dupes.join(", ")}`,
	);
}

// ---------- Gate 5: NO_DUPLICATE_CURRENT_WORK_IDS ----------
// Per the reviewer's explicit guidance: inspect the current frontier / open-work
// structural regions for the PRIMARY work ID in each row (the FIRST listed ACT or
// the whole cell if it lists one), not every ACT-CLINEMM-* occurrence (which would
// double-count dependency references in multi-item Frontier cells).
//
// Cross-region sharing is allowed (e.g. `HOST-TEST RUNNER` is the primary work for
// the Host substrate lane AND a shared dependency for the approval lanes). The gate
// fires only if the same ACT ID is the PRIMARY work item in two rows WITHIN THE SAME
// REGION.
{
	const dupes: string[] = [];
	const inspectRegion = (label: string, tbl: Table | undefined, workColIdx: number) => {
		if (!tbl) return;
		const seenInRegion = new Map<string, number>();
		for (let rowIdx = 0; rowIdx < tbl.rows.length; rowIdx++) {
			const row = tbl.rows[rowIdx];
			const workCell = row[workColIdx];
			if (!workCell) continue;
			if (/^\(none\b/i.test(workCell)) continue;
			// Extract ONLY the primary work ID: the first code-fenced token in the cell.
			const m = workCell.match(/`([^`]+)`/);
			if (!m) continue;
			const id = m[1].trim();
			if (seenInRegion.has(id)) {
				dupes.push(`${id} (${label} L${tbl.headerLine + seenInRegion.get(id)!} and L${tbl.headerLine + rowIdx})`);
			} else {
				seenInRegion.set(id, rowIdx);
			}
		}
	};
	if (currentFrontierTbl) {
		const workColIdx = currentFrontierTbl.headers.findIndex((h) => /^Work$/i.test(h));
		inspectRegion("Current frontier", currentFrontierTbl, workColIdx);
	}
	if (activeEpicsTbl) {
		const frontierColIdx = activeEpicsTbl.headers.findIndex((h) => /^Frontier$/i.test(h));
		inspectRegion("Active epics (Frontier)", activeEpicsTbl, frontierColIdx);
	}
	if (openWorkTbl) {
		const workColIdx = openWorkTbl.headers.findIndex((h) => /^Work$/i.test(h));
		inspectRegion("Open supporting work", openWorkTbl, workColIdx);
	}
	hard(
		"NO_DUPLICATE_CURRENT_WORK_IDS",
		dupes.length === 0,
		dupes.length === 0
			? `no within-region duplicate primary work IDs (cross-region sharing is allowed; dependency refs in multi-item Frontier cells are not duplicates; Historical task census + Recently closed transitions excluded by design)`
			: `duplicate primary work IDs: ${dupes.join("; ")}`,
	);
}

// ---------- Gate 6: EVERY_OPEN_NEXT_ROW_HAS_DETAIL ----------
{
	// Accept any relative link to a `.factory/epics/<x>.md` file (via `./epics/...`).
	const detailLinkRe = /\[[^\]]*\]\(\.\/epics\/[^)]+\.md\)/;
	const missing: string[] = [];
	const check = (tbl: Table | undefined, label: string, stateColIdx: number, workColIdx: number, detailColIdx: number) => {
		if (!tbl) return;
		for (const row of tbl.rows) {
			const state = (row[stateColIdx] ?? "").trim();
			const work = (row[workColIdx] ?? "").trim();
			const detail = (row[detailColIdx] ?? "").trim();
			const isOpenOrNext =
				/\bNEXT\b/.test(state) ||
				/\bOPEN\b/.test(state) ||
				/\bNEXT\b/.test(work) ||
				/\bOPEN\b/.test(work) ||
				/\bACTIVE\b/.test(state);
			if (!isOpenOrNext) continue;
			if (!detailLinkRe.test(detail)) {
				missing.push(`${label}: "${work.slice(0, 60)}" has no Detail link`);
			}
		}
	};
	if (currentFrontierTbl) {
		const stateIdx = currentFrontierTbl.headers.indexOf("Work");
		const workIdx = currentFrontierTbl.headers.indexOf("Work");
		const detailIdx = currentFrontierTbl.headers.indexOf("Detail");
		check(currentFrontierTbl, "Current frontier", stateIdx, workIdx, detailIdx);
	}
	if (activeEpicsTbl) {
		const stateIdx = activeEpicsTbl.headers.indexOf("State");
		const workIdx = activeEpicsTbl.headers.indexOf("Frontier");
		const detailIdx = activeEpicsTbl.headers.indexOf("Detail");
		check(activeEpicsTbl, "Active epics", stateIdx, workIdx, detailIdx);
	}
	if (openWorkTbl) {
		const stateIdx = openWorkTbl.headers.indexOf("State");
		const workIdx = openWorkTbl.headers.indexOf("Work");
		const detailIdx = openWorkTbl.headers.indexOf("Detail");
		check(openWorkTbl, "Open supporting work", stateIdx, workIdx, detailIdx);
	}
	hard(
		"EVERY_OPEN_NEXT_ROW_HAS_DETAIL",
		missing.length === 0,
		missing.length === 0 ? "every OPEN/NEXT/ACTIVE row has a Detail link" : `missing: ${missing.join("; ")}`,
	);
}

// ---------- Gate 7: STATUS_VOCABULARY_VALID ----------
{
	const offendingTokens = new Set<string>();
	const checkCell = (raw: string, label: string) => {
		const trimmed = raw.trim();
		if (!trimmed) return;
		const firstWord = trimmed.match(/^[A-Z_]+/)?.[0] ?? "";
		if (!STATUS_BASE.has(firstWord)) {
			offendingTokens.add(`${label}: "${trimmed.slice(0, 60)}"`);
		}
	};
	if (activeEpicsTbl) {
		const stateIdx = activeEpicsTbl.headers.indexOf("State");
		if (stateIdx >= 0) {
			for (const row of activeEpicsTbl.rows) checkCell(row[stateIdx] ?? "", "Active epics State");
		}
	}
	if (openWorkTbl) {
		const stateIdx = openWorkTbl.headers.indexOf("State");
		if (stateIdx >= 0) {
			for (const row of openWorkTbl.rows) checkCell(row[stateIdx] ?? "", "Open supporting work State");
		}
	}
	if (deferredTbl) {
		const stateIdx = deferredTbl.headers.indexOf("State");
		if (stateIdx >= 0) {
			for (const row of deferredTbl.rows) checkCell(row[stateIdx] ?? "", "Deferred/hold State");
// ---------- Gate 8: HOST_REQUIRED_QUALIFICATION_VALID ----------
{
	const orphanHostRequired: string[] = [];
	const checkRow = (tbl: Table | undefined, label: string, stateColIdx: number, workColIdx: number) => {
		if (!tbl) return;
		for (const row of tbl.rows) {
			const state = (row[stateColIdx] ?? "").trim();
			const work = (row[workColIdx] ?? "").trim();
			const stateTokens = state.match(/\b[A-Z][A-Z_]+\b/g) ?? [];
			const stateHasHost = stateTokens.includes("HOST_REQUIRED");
			const stateHasOther = stateTokens.some((t) => t !== "HOST_REQUIRED" && STATUS_BASE.has(t));
			const workHasHost = /\bHOST_REQUIRED\b/.test(work);
			if (stateHasHost && !stateHasOther && !workHasHost) {
				orphanHostRequired.push(`${label}: state="${state.slice(0, 60)}"`);
			}
		}
	};
	if (activeEpicsTbl) {
		const stateIdx = activeEpicsTbl.headers.indexOf("State");
		const workIdx = activeEpicsTbl.headers.indexOf("Frontier");
		checkRow(activeEpicsTbl, "Active epics", stateIdx, workIdx);
	}
	if (currentFrontierTbl) {
		const stateIdx = currentFrontierTbl.headers.indexOf("Work");
		const workIdx = currentFrontierTbl.headers.indexOf("Work");
		checkRow(currentFrontierTbl, "Current frontier", stateIdx, workIdx);
	}
	if (openWorkTbl) {
		const stateIdx = openWorkTbl.headers.indexOf("State");
		const workIdx = openWorkTbl.headers.indexOf("Work");
		checkRow(openWorkTbl, "Open supporting work", stateIdx, workIdx);
	}
	hard(
		"HOST_REQUIRED_QUALIFICATION_VALID",
		orphanHostRequired.length === 0,
		orphanHostRequired.length === 0
			? "HOST_REQUIRED used only as a modifier accompanying another status"
			: `orphan HOST_REQUIRED: ${orphanHostRequired.join("; ")}`,
	);
}

// ---------- Gate 9: OLD_ACT_IDS_PRESERVED (conservation) ----------
{
	const idRe = /\bACT-CLINEMM-[A-Z0-9_-]+\b/g;
	const oldIds = new Set<string>();
	let anchorReadOk = true;
	try {
		// Use spawnSync with explicit maxBuffer so the 6,346-line / ~1.1 MB anchor board
		// does not overflow the default 1 MB execSync buffer.
		const result = spawnSync("git", ["show", `${ANCHOR}:.factory/epic-board.md`], {
			cwd: REPO_ROOT,
			encoding: "utf8",
			maxBuffer: 16 * 1024 * 1024, // 16 MB; anchor board is ~1.1 MB
		});
		if (result.error || result.status !== 0) {
			throw new Error(result.error?.message ?? `git exit ${result.status}`);
		}
		const oldBoard = result.stdout ?? "";
		for (const m of oldBoard.matchAll(idRe)) oldIds.add(m[0]);
	} catch (err) {
		anchorReadOk = false;
		hard(
			"OLD_ACT_IDS_PRESERVED",
			false,
			`failed to read ${ANCHOR}:.factory/epic-board.md: ${(err as Error).message}`,
		);
	}
	if (anchorReadOk) {
		const currentDurable = new Set<string>();
		const idFiles: string[] = [];
		if (existsSync(BOARD_PATH)) {
			for (const m of readFileSync(BOARD_PATH, "utf8").matchAll(idRe)) currentDurable.add(m[0]);
			idFiles.push(BOARD_PATH);
		}
		if (existsSync(EPICS_DIR)) {
			for (const file of readdirSync(EPICS_DIR)) {
				if (!file.endsWith(".md")) continue;
				const p = join(EPICS_DIR, file);
				for (const m of readFileSync(p, "utf8").matchAll(idRe)) currentDurable.add(m[0]);
				idFiles.push(p);
			}
		}
		if (existsSync(CLOSURE_PLANS_DIR)) {
			for (const file of readdirSync(CLOSURE_PLANS_DIR)) {
				if (!file.endsWith(".json")) continue;
				const p = join(CLOSURE_PLANS_DIR, file);
				for (const m of readFileSync(p, "utf8").matchAll(idRe)) currentDurable.add(m[0]);
				idFiles.push(p);
			}
		}
		// Optional: include .factory/evidence/* filenames when present (treat as OPTIONAL_LOCAL_IDS)
		if (existsSync(EVIDENCE_DIR)) {
			for (const entry of readdirSync(EVIDENCE_DIR)) {
				for (const m of entry.matchAll(idRe)) currentDurable.add(m[0]);
			}
		}
		const lost = [...oldIds].filter((id) => !currentDurable.has(id));
		const gained = [...currentDurable].filter((id) => !oldIds.has(id));
		hard(
			"OLD_ACT_IDS_PRESERVED",
			lost.length === 0,
			lost.length === 0
				? `OLD - CURRENT_DURABLE = ∅; ${oldIds.size} in anchor, ${currentDurable.size} in current durable sources (+${gained.length} legitimate new IDs from closure-plans); ${idFiles.length} tracked files scanned`
				: `LOST: ${lost.join(", ")}`,
		);
	}
}

// ---------- Gate 10: NO_OVERSIZED_INDEX_TABLE_CELL ----------
{
	const oversized: string[] = [];
	for (const tbl of tables) {
		for (let r = 0; r < tbl.rows.length; r++) {
			for (let c = 0; c < tbl.rows[r].length; c++) {
				const cell = tbl.rows[r][c];
				if (cell.length > TABLE_CELL_CAP) {
					const header = tbl.headers[c] ?? `col${c}`;
					oversized.push(`table@L${tbl.headerLine} row${r} "${header}" = ${cell.length} chars (>${TABLE_CELL_CAP})`);
				}
			}
		}
	}
	hard(
		"NO_OVERSIZED_INDEX_TABLE_CELL",
		oversized.length === 0,
		oversized.length === 0 ? `all table cells ≤${TABLE_CELL_CAP} chars (no embedded closure reports)` : `oversized: ${oversized.join("; ")}`,
	);
}

// ---------- Output ----------
let pass = true;
const lines: string[] = [];
lines.push(`Validator against .factory/epic-board.md (ANCHOR=${ANCHOR}, ${boardLines.length} lines)`);
lines.push("─".repeat(72));
for (const g of gates) {
	const tag = g.severity === "hard" ? "HARD" : "ADV ";
	const mark = g.pass ? "PASS" : "FAIL";
	lines.push(`[${tag}] [${mark}] ${g.name}`);
	if (g.details) lines.push(`         ${g.details}`);
	if (!g.pass && g.severity === "hard") pass = false;
	lines.push("");
}
lines.push("─".repeat(72));
lines.push(pass ? "RESULT: ALL HARD GATES PASS" : "RESULT: ONE OR MORE HARD GATES FAIL");

console.log(lines.join("\n"));
process.exit(pass ? 0 : 1);
		}
	}
	if (recentlyClosedTbl) {
		const verdictIdx = recentlyClosedTbl.headers.indexOf("Verdict");
		if (verdictIdx >= 0) {
			for (const row of recentlyClosedTbl.rows) checkCell(row[verdictIdx] ?? "", "Recently closed Verdict");
		}
	}
	hard(
		"STATUS_VOCABULARY_VALID",
		offendingTokens.size === 0,
		offendingTokens.size === 0
			? `state cells use closed-class tokens: ${[...STATUS_BASE].join(", ")} (+ qualifiers)`
			: `offending: ${[...offendingTokens].join("; ")}`,
	);
}
