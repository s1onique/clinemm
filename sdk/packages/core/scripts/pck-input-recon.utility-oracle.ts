/**
 * ACT-CLINEMM-PCK-EVIDENCE-FIRST-INPUT-RECON-01
 *
 * C3 — the UTILITY ORACLE for the REAL mature canonical history.
 *
 * ============================================================================
 * WHAT IT DOES
 * ============================================================================
 *
 * Before any candidate can be compared, the RELEVANT KNOWLEDGE of the source
 * history must be inventoried INDEPENDENTLY of what any candidate
 * produced. Otherwise "utility" would be measured against the candidate's
 * own output, which is circular.
 *
 * The inventory is built from the source history's own TASK CONTRACT — the
 * frozen findings the session was commissioned to falsify — and it is
 * classified by the runtime's OWN evidence machinery where the history
 * carries tool evidence.
 *
 * ============================================================================
 * THE INVENTORY'S CLASSES
 * ============================================================================
 *
 * The ACT names seven classes:
 *
 *   - established observations,
 *   - unverified hypotheses,
 *   - active constraints,
 *   - unresolved questions,
 *   - superseded evidence,
 *   - contradictory evidence,
 *   - already-preserved task-contract or verified-outcome knowledge.
 *
 * Each inventoried item is tagged with the class it belongs to, the
 * evidence reference it rests on (when the runtime owns one) and whether
 * the item is ALREADY PRESERVED by another production mechanism.
 *
 * ============================================================================
 * WHY THE INVENTORY IS NOT A SECOND EVIDENCE STORE
 * ============================================================================
 *
 * The inventory is DERIVED from the canonical history at RECON time and is
 * written to the GITIGNORED `tmp/` tree. It is an experimental measuring
 * instrument, not a persisted artifact, and it introduces no new storage.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MessageWithMetadata } from "@cline/shared";
import {
	collectCanonicalToolEvents,
	collectObservedCanonicalReferences,
} from "../src/extensions/context/precompaction-knowledge-checkpoint/evidence";

const PRIVATE_ROOT = join(
	process.cwd(),
	"..",
	"..",
	"..",
	"tmp",
	"pck-input-recon",
);

/**
 * The classification of ONE inventoried item.
 */
export type UtilityClass =
	| "established_observation"
	| "unverified_hypothesis"
	| "active_constraint"
	| "unresolved_question"
	| "superseded_evidence"
	| "contradictory_evidence"
	| "already_preserved";

/**
 * ONE inventoried item.
 */
export interface UtilityItem {
	/** The inventory's stable index. */
	readonly index: number;
	/** The class the item belongs to. */
	readonly utilityClass: UtilityClass;
	/** The item's identity (a frozen finding id, or a short label). */
	readonly label: string;
	/** Whether the item is ALREADY preserved by another production mechanism. */
	readonly alreadyPreserved: boolean;
	/** Which production mechanism preserves it, when one does. */
	readonly preservedBy?: string;
	/** The canonical reference the item rests on, when the runtime owns one. */
	readonly evidenceRef?: string;
	/** Whether the runtime's own evidence establishes the item. */
	readonly runtimeEstablished: boolean;
}

/**
 * Read the FIRST user text block of the canonical history: the TASK
 * CONTRACT.
 *
 * The task contract is the session's authoritative statement of WHAT it was
 * commissioned to establish, and it is the source of the frozen findings.
 */
function readTaskContract(
	canonicalMessages: readonly MessageWithMetadata[],
): string {
	for (const message of canonicalMessages) {
		if (message.role !== "user" || !Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "text" && block.text.trim().length > 0) {
				return block.text;
			}
		}
	}
	return "";
}

/**
 * The frozen finding ids the task contract declares.
 *
 * The pattern is the session's own `**R<n> — ...**` heading shape. The
 * inventory records the ORDERED id list so a candidate's coverage can be
 * measured against it.
 */
export function extractFrozenFindingIds(taskContract: string): string[] {
	const ids: string[] = [];
	const pattern = /\*\*(R\d+)\s+—/g;
	let match = pattern.exec(taskContract);
	while (match !== null) {
		if (!ids.includes(match[1])) {
			ids.push(match[1]);
		}
		match = pattern.exec(taskContract);
	}
	return ids;
}

/**
 * The severity/confidence ratings the task contract carries for each frozen
 * finding.
 *
 * The rating is the session's own statement, so it is reproduced verbatim
 * rather than reinterpreted.
 */
export function extractFindingRatings(
	taskContract: string,
): Record<string, string> {
	const ratings: Record<string, string> = {};
	const blocks = taskContract.split(/\*\*(?=R\d+\s+—)/);
	for (const block of blocks) {
		const id = /^(R\d+)/.exec(block)?.[1];
		if (id === undefined) {
			continue;
		}
		const rating =
			/Original:\s*Severity\s*([^,]+),\s*Confidence\s*([^.\n]+)/.exec(block);
		if (rating !== null) {
			ratings[id] = `Severity ${rating[1]}, Confidence ${rating[2]}`;
		}
	}
	return ratings;
}

/**
 * Build the utility inventory.
 */
export function buildUtilityInventory(
	canonicalMessages: readonly MessageWithMetadata[],
): readonly UtilityItem[] {
	const taskContract = readTaskContract(canonicalMessages);
	const frozenIds = extractFrozenFindingIds(taskContract);
	const ratings = extractFindingRatings(taskContract);
	const events = collectCanonicalToolEvents(canonicalMessages);
	const items: UtilityItem[] = [];
	let index = 0;

	// (1) The FROZEN FINDINGS are the task contract's own knowledge. They
	// are ALREADY PRESERVED by the task-contract mechanism, so a candidate
	// that reproduces them adds NO incremental utility beyond ordinary
	// compaction.
	for (const id of frozenIds) {
		index += 1;
		items.push({
			index,
			utilityClass: "already_preserved",
			label: `${id}${ratings[id] === undefined ? "" : ` — ${ratings[id]}`}`,
			alreadyPreserved: true,
			preservedBy: "task_contract",
			runtimeEstablished: false,
		});
	}

	// (2) The RUNTIME-OWNED observations are the tool events the runtime can
	// join and classify. Each is an established observation ONLY when the
	// runtime's own interpreter establishes the complete rendered claim;
	// the remainder are carried as observations whose SPECIFIC claim is not
	// runtime-established.
	for (const event of events) {
		index += 1;
		const runtimeEstablished =
			event.succeeded &&
			event.evidenceClass === "command_execution" &&
			event.commandClassifications.length > 0;
		items.push({
			index,
			utilityClass: "established_observation",
			label: `${event.toolName} ${
				event.commandClassifications.join("+") || "(unclassified)"
			} status=${event.succeeded ? "succeeded" : "not-succeeded"}`,
			alreadyPreserved: false,
			evidenceRef: event.toolCallId,
			runtimeEstablished,
		});
	}

	// (3) The ACTIVE CONSTRAINTS are the task contract's own prohibitions.
	// They are preserved by the task contract, so they are already
	// preserved.
	const constraintCount = (taskContract.match(/^- (?:Do not|No )/gm) ?? [])
		.length;
	for (let n = 0; n < constraintCount; n += 1) {
		index += 1;
		items.push({
			index,
			utilityClass: "already_preserved",
			label: "task-contract prohibition",
			alreadyPreserved: true,
			preservedBy: "task_contract",
			runtimeEstablished: false,
		});
	}

	return items;
}

/**
 * The summary of the inventory.
 */
export interface UtilityOracleSummary {
	readonly frozenFindingCount: number;
	readonly frozenFindingIds: readonly string[];
	readonly frozenFindingRatings: Readonly<Record<string, string>>;
	readonly runtimeOwnedObservationCount: number;
	readonly runtimeEstablishedObservationCount: number;
	readonly alreadyPreservedItemCount: number;
	readonly totalItemCount: number;
	readonly canonicalReferenceCount: number;
	/**
	 * The number of items that a candidate could carry that are NOT already
	 * preserved by another production mechanism.
	 */
	readonly incrementalCandidateItemCount: number;
}

/**
 * Summarise the inventory.
 */
export function summarizeUtilityInventory(
	items: readonly UtilityItem[],
	canonicalMessages: readonly MessageWithMetadata[],
): UtilityOracleSummary {
	const taskContract = readTaskContract(canonicalMessages);
	const frozenIds = extractFrozenFindingIds(taskContract);
	const alreadyPreserved = items.filter((item) => item.alreadyPreserved).length;
	return {
		frozenFindingCount: frozenIds.length,
		frozenFindingIds: frozenIds,
		frozenFindingRatings: extractFindingRatings(taskContract),
		runtimeOwnedObservationCount: items.filter(
			(item) => item.utilityClass === "established_observation",
		).length,
		runtimeEstablishedObservationCount: items.filter(
			(item) => item.runtimeEstablished,
		).length,
		alreadyPreservedItemCount: alreadyPreserved,
		totalItemCount: items.length,
		canonicalReferenceCount:
			collectObservedCanonicalReferences(canonicalMessages).length,
		incrementalCandidateItemCount: items.length - alreadyPreserved,
	};
}

/**
 * The CLI entry point.
 */
async function main(): Promise<void> {
	const sessionId = process.argv[2];
	if (!sessionId) {
		console.error("usage: pck-input-recon.utility-oracle.ts <sessionId>");
		process.exit(2);
	}
	const canonicalMessages = JSON.parse(
		readFileSync(join(PRIVATE_ROOT, `${sessionId}.canonical.json`), "utf8"),
	) as MessageWithMetadata[];
	const items = buildUtilityInventory(canonicalMessages);
	const summary = summarizeUtilityInventory(items, canonicalMessages);
	writeFileSync(
		join(PRIVATE_ROOT, `${sessionId}.utility-oracle.json`),
		JSON.stringify({ summary, items }, null, 2),
		"utf8",
	);
	console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.main) {
	await main();
}
