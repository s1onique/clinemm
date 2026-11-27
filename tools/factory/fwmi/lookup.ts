/**
 * tools/factory/fwmi/lookup.ts
 *
 * HISTORICAL ACT LOOKUP.
 *
 * The requirement is "preserve historical ACT lookup": a reader must be
 * able to find a historical ACT by its identity and see its ORIGINAL
 * disposition together with the source material it came from.
 *
 * The lookup spans BOTH archives:
 *
 *   - the REPOSITORY-NATIVE archive: the board's historical census
 *     (`.factory/epic-board.md`), the per-epic ACT ledgers
 *     (`.factory/epics/*.md`) and the native closure plans
 *     (`docs/closure-plans/*.json`);
 *   - the IMPORTED archive: the persisted imported ledger records and the
 *     imported historical index (`docs/closure-plans/imported/`).
 *
 * A lookup NEVER upgrades a verdict. It reports the verdict the source
 * recorded, and — when the source recorded competing verdicts — reports
 * them as competing, not as a chosen one.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readArchiveIndex, readPersistedRecords } from "./conserve.ts";
import type { LedgerRecord } from "./plan.ts";

/** Where a historical ACT was found. */
export type LookupSource =
	| "native_closure_plan"
	| "imported_index"
	| "imported_ledger"
	| "board_census"
	| "epic_ledger";

/** One historical ACT as the lookup reports it. */
export interface HistoricalActLookup {
	readonly act_id: string;
	readonly found: boolean;
	readonly sources: readonly LookupSource[];
	/** The original verdict, verbatim. Never promoted. */
	readonly original_verdict: string | null;
	/** Competing verdicts, when the source recorded more than one. */
	readonly competing_verdicts: readonly string[];
	readonly epic_id: string | null;
	readonly work_item_ids: readonly string[];
	readonly evidence_locators: readonly string[];
	/** The reconciliation status of the record's identification. */
	readonly reconciliation: string | null;
	/** True when the record's own identification was not resolved. */
	readonly unresolved: boolean;
	/** The source locations the record was derived from. */
	readonly source_locations: readonly string[];
}

/** The result of a lookup. */
export interface LookupResult {
	readonly query: string;
	readonly matches: readonly HistoricalActLookup[];
	/** True when at least one ACT matched. */
	readonly found: boolean;
}

/**
 * Look up historical ACTs by identity.
 *
 * The query is matched EXACTLY against an ACT identity. A prefix match is
 * offered separately (`prefixMatches`) because a reader searching for
 * `TEMP-INTERNAL-CONTROL-CLEANUP` needs to see BOTH candidate
 * representations — collapsing them into one hit is exactly the ambiguity
 * the migration is meant to preserve.
 */
export function lookupHistoricalActs(
	root: string,
	query: string,
): LookupResult {
	const exact: HistoricalActLookup[] = [];
	const seen = new Set<string>();

	// --- native closure plans ---
	const nativeDir = join(root, "docs", "closure-plans");
	if (existsSync(nativeDir)) {
		for (const file of readdirSync(nativeDir).sort()) {
			if (!file.endsWith(".json")) continue;
			if (file === "historical-index.json") continue;
			let parsed: Record<string, unknown>;
			try {
				parsed = JSON.parse(
					readFileSync(join(nativeDir, file), "utf8"),
				) as Record<string, unknown>;
			} catch {
				continue;
			}
			const actId = typeof parsed.act_id === "string" ? parsed.act_id : "";
			if (actId !== query) continue;
			exact.push({
				act_id: actId,
				found: true,
				sources: ["native_closure_plan"],
				original_verdict:
					typeof parsed.verdict === "string" ? parsed.verdict : null,
				competing_verdicts: [],
				epic_id: typeof parsed.parent === "string" ? parsed.parent : null,
				work_item_ids: [],
				evidence_locators: [],
				reconciliation: null,
				unresolved: false,
				source_locations: [`docs/closure-plans/${file}`],
			});
			seen.add(actId);
		}
	}

	// --- imported historical index ---
	const archive = readArchiveIndex(root);
	for (const rec of archive.records) {
		if (rec.act_id !== query) continue;
		exact.push({
			act_id: rec.act_id,
			found: true,
			sources: ["imported_index"],
			original_verdict: rec.original_verdict,
			competing_verdicts: [],
			epic_id: rec.epic_id,
			work_item_ids: [...rec.work_item_ids],
			evidence_locators: [...rec.evidence_locators],
			reconciliation: rec.reconciliation,
			unresolved: rec.unresolved,
			source_locations: rec.source_refs.map((ref) =>
				String((ref as { path?: unknown })?.path ?? ""),
			),
		});
		seen.add(rec.act_id);
	}

	// --- imported ledger records ---
	for (const rec of readPersistedRecords(root)) {
		const actId = rec.migration?.scoped_id ?? rec.act_id;
		if (actId !== query) continue;
		exact.push({
			act_id: actId,
			found: true,
			sources: ["imported_ledger"],
			original_verdict: rec.verdict,
			competing_verdicts: [],
			epic_id: rec.migration?.source_epic_id ?? null,
			work_item_ids: [],
			evidence_locators: [...(rec.migration?.evidence_locators ?? [])],
			reconciliation: rec.acceptance?.interchange_reconciliation_state ?? null,
			unresolved: rec.acceptance?.state !== "NOT_VERIFIED_BY_IMPORT",
			source_locations: (rec.migration?.source_refs ?? []).map(
				(ref) => ref.path,
			),
		});
		seen.add(rec.act_id);
	}

	// --- board census / epic ledgers (textual, conservative) ---
	for (const hit of searchTextArchives(root, query)) {
		if (seen.has(hit.act_id)) {
			const existing = exact.find((e) => e.act_id === hit.act_id);
			if (existing) {
				(existing.sources as LookupSource[]).push(hit.sources[0]);
				continue;
			}
		}
		exact.push(hit);
		seen.add(hit.act_id);
	}

	return { query, matches: exact, found: exact.length > 0 };
}

/**
 * Search the TEXT archives (board census and epic ledgers) for an ACT id.
 *
 * This is a deliberately narrow, literal search: it looks for the ACT
 * identity as a whole token in the historical census block and in the
 * per-epic ACT ledgers. It does NOT attempt to interpret Markdown
 * structure — that is the universal semantic Markdown parser this ACT
 * forbids. It only records WHERE the identity is present so a reader can
 * navigate to it.
 */
function searchTextArchives(
	root: string,
	query: string,
): HistoricalActLookup[] {
	const results: HistoricalActLookup[] = [];
	const token = new RegExp(`\\b${escapeRegExp(query)}\\b`);

	const boardPath = join(root, ".factory", "epic-board.md");
	if (existsSync(boardPath)) {
		const board = readFileSync(boardPath, "utf8");
		if (token.test(board)) {
			results.push({
				act_id: query,
				found: true,
				sources: ["board_census"],
				original_verdict: null,
				competing_verdicts: [],
				epic_id: null,
				work_item_ids: [],
				evidence_locators: [],
				reconciliation: null,
				unresolved: false,
				source_locations: [".factory/epic-board.md"],
			});
		}
	}

	const epicsDir = join(root, ".factory", "epics");
	if (existsSync(epicsDir)) {
		for (const file of readdirSync(epicsDir).sort()) {
			if (!file.endsWith(".md")) continue;
			const content = readFileSync(join(epicsDir, file), "utf8");
			if (!token.test(content)) continue;
			results.push({
				act_id: query,
				found: true,
				sources: ["epic_ledger"],
				original_verdict: null,
				competing_verdicts: [],
				epic_id: null,
				work_item_ids: [],
				evidence_locators: [],
				reconciliation: null,
				unresolved: false,
				source_locations: [`.factory/epics/${file}`],
			});
		}
	}

	return results;
}

/** Escape a string for literal use inside a regular expression. */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
