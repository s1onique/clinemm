#!/usr/bin/env bun

/**
 * factory/scripts/fwl02/historical-index.ts
 *
 * ACT-CLINEMM-FWL02-B-HISTORICAL-RECONCILIATION-01 — the historical ACT index.
 *
 * COLD treatment (W3): historical ACT reports are MECHANICALLY INDEXED — their
 * identities, verdicts and source locators — where possible. Their complete
 * original bytes remain in the committed source archive; this index does not
 * reconstruct every historical experiment semantically and does NOT turn every
 * historical ACT into a new work item.
 *
 * A historical ACT verdict is a HISTORICAL ASSERTION. It must never be
 * interpreted as newly verified engineering acceptance, and the
 * `reconciliation` field records whether the identity's representations agree.
 *
 * The extraction is deterministic: it reads the committed board blob, finds
 * every `# ACT-... — VERDICT — date` section header, and records the exact
 * line range of that section. Competing verdicts for one identity are retained
 * as separate claims and the identity is marked CONFLICTING.
 */

import type { FwmiActReconciliation } from "./contract.ts";
import { splitCommittedLines } from "./source-refs.ts";

/** One extracted historical ACT section. */
export interface HistoricalActSection {
	readonly act_id: string;
	readonly verdict: string;
	readonly start_line: number;
	end_line: number;
}

/**
 * The board section header shape:
 *
 *   `# ACT-CLINEMM-... — VERDICT — 2026-11-27`
 *   `# ACT-CLINEMM-... — VERDICT - 2026-10-15`
 *
 * Some headers carry a parenthetical qualifier in the ACT id, e.g.
 * `# ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (CORRECTION-01) — ...`.
 * The parenthesised suffix is part of the ACT identity in the source and is
 * preserved verbatim.
 */
const HEADER_PATTERN =
	/^#\s+(ACT-[A-Za-z0-9._()-]+)\s+[—-]\s+(.+?)\s+[—-]\s+\d{4}-\d{2}-\d{2}/;

/**
 * Extract every historical ACT section header from the committed board.
 *
 * Returns sections sorted by start_line. The end_line of a section is the line
 * before the next section header (or the end of the board's index region).
 */
export function extractHistoricalActSections(
	boardBytes: Buffer,
): HistoricalActSection[] {
	const lines = splitCommittedLines(boardBytes);
	const sections: HistoricalActSection[] = [];
	for (let index = 0; index < lines.length; index++) {
		const text = lines[index]?.content.toString("utf8");
		const match = HEADER_PATTERN.exec(text);
		if (!match) {
			continue;
		}
		const actId = match[1]?.trim();
		const verdict = match[2]?.trim();
		sections.push({
			act_id: actId,
			verdict,
			start_line: index + 1,
			end_line: index + 1,
		});
	}
	// A section ends immediately before the next section header.
	for (let index = 0; index < sections.length - 1; index++) {
		sections[index]!.end_line = sections[index + 1]?.start_line - 1;
	}
	return sections;
}

/**
 * Group extracted sections by ACT identity, preserving every competing verdict.
 *
 * The FIRST occurrence keeps the canonical `source_refs` range (the most
 * recent report, because the board is prepend-ordered); every distinct
 * verdict is preserved in `competing_verdicts` so a conflicting historical
 * claim is never silently deduplicated.
 */
export interface GroupedHistoricalAct {
	readonly act_id: string;
	readonly original_verdict: string;
	readonly competing_verdicts: readonly string[];
	readonly occurrences: readonly HistoricalActSection[];
	readonly reconciliation: FwmiActReconciliation;
}

/** Group historical ACT sections by identity, preserving competing verdicts. */
export function groupHistoricalActs(
	sections: readonly HistoricalActSection[],
): GroupedHistoricalAct[] {
	const byIdentity = new Map<string, HistoricalActSection[]>();
	for (const section of sections) {
		const existing = byIdentity.get(section.act_id);
		if (existing) {
			existing.push(section);
		} else {
			byIdentity.set(section.act_id, [section]);
		}
	}
	const grouped: GroupedHistoricalAct[] = [];
	for (const [actId, occurrences] of byIdentity) {
		const verdicts = new Set(
			occurrences.map((occurrence) => occurrence.verdict),
		);
		const reconciliation: FwmiActReconciliation =
			verdicts.size === 1
				? occurrences.length === 1
					? "UNAMBIGUOUS"
					: "AMBIGUOUS"
				: "CONFLICTING";
		grouped.push({
			act_id: actId,
			original_verdict: occurrences[0]?.verdict,
			competing_verdicts: [...verdicts].sort(),
			occurrences,
			reconciliation,
		});
	}
	return grouped.sort((left, right) =>
		left.act_id < right.act_id ? -1 : left.act_id > right.act_id ? 1 : 0,
	);
}
