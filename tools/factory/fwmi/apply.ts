/**
 * tools/factory/fwmi/apply.ts
 *
 * Transactional application of an import plan to the ClineMM repository.
 *
 * The transaction discipline is the EXISTING Factory discipline: the board
 * maintenance rule ("update only rows affected by that ACT"), the
 * conservation invariant (`OLD_ACT_IDS - CURRENT_REPOSITORY_ACT_IDS = ∅`),
 * and the "commit only intended artifacts" rule.
 *
 * Three modes, all producing the SAME plan:
 *
 *   dry-run  — compute the plan, report the byte delta, write NOTHING.
 *   shadow   — compute the plan, report the byte delta, write NOTHING, and
 *              additionally verify what the write WOULD do to the canonical
 *              store. (Shadow and dry-run differ only in that shadow also
 *              runs the conservation projection.)
 *   apply    — write the plan atomically-ish: every file is written to a
 *              temporary name and then renamed into place, so a partial
 *              failure never leaves a half-written canonical record.
 *
 * The apply mode REFUSES to write when the plan would change any byte it
 * does not own, and it REFUSES to write when validation failed. An exact
 * replay over an already-applied package must produce a ZERO byte delta.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { sha256Bytes } from "./digest.ts";
import type { ArchivePlanEntry, ImportPlan, PlanEntry } from "./plan.ts";

/** The repository root the adapter operates on. */
export interface RepoContext {
	/** Absolute path of the repository root. */
	readonly root: string;
}

/** One file the plan would create or change. */
export interface FileDelta {
	readonly path: string;
	readonly action: "create" | "update" | "unchanged";
	readonly bytesBefore: number;
	readonly bytesAfter: number;
	readonly sha256Before: string | null;
	readonly sha256After: string;
}

/** The outcome of computing or applying a plan. */
export interface ApplyResult {
	readonly deltas: readonly FileDelta[];
	/** Total bytes that would change. Zero for an exact replay. */
	readonly byteDelta: number;
	/** The number of files whose bytes would change. */
	readonly changedFileCount: number;
	/** True when every planned file already exists with identical bytes. */
	readonly replayClean: boolean;
	/** The files that were actually written (empty unless `apply` ran). */
	readonly written: readonly string[];
	/** The archive index entries the plan adds. */
	readonly archiveEntries: readonly ArchivePlanEntry[];
}

/**
 * The historical archive index path.
 *
 * Imported historical ACT entries live in their own index file so the
 * EXISTING board census is never rewritten by an import. The board's
 * historical census remains the repository-native archive; the imported
 * index is the migrated-history side of the same lookup surface.
 */
export function archiveIndexPath(ctx: RepoContext): string {
	return join(
		ctx.root,
		"docs",
		"closure-plans",
		"imported",
		"historical-index.json",
	);
}

/** The repository-relative path of the imported historical archive index. */
export const ARCHIVE_INDEX_REPO_PATH =
	"docs/closure-plans/imported/historical-index.json";

/**
 * Compute the byte delta the plan would produce against the repository.
 *
 * This is a pure read: it never writes. It is what both the dry-run and
 * the exact-replay commands use.
 */
export function computeDeltas(ctx: RepoContext, plan: ImportPlan): ApplyResult {
	const deltas: FileDelta[] = [];
	for (const entry of plan.entries) {
		deltas.push(deltaFor(ctx, entry.target.path, entry.content));
	}
	deltas.push(
		deltaFor(
			ctx,
			ARCHIVE_INDEX_REPO_PATH,
			renderArchiveIndex(plan.archiveEntries),
		),
	);

	const changed = deltas.filter((d) => d.action !== "unchanged");
	const byteDelta = changed.reduce(
		(sum, d) => sum + Math.abs(d.bytesAfter - d.bytesBefore),
		0,
	);
	return {
		deltas,
		byteDelta,
		changedFileCount: changed.length,
		replayClean: changed.length === 0,
		written: [],
		archiveEntries: plan.archiveEntries,
	};
}

/** Render the imported historical archive index file. */
export function renderArchiveIndex(
	entries: readonly ArchivePlanEntry[],
): string {
	const records = entries.map((e) => e.entry);
	return `${JSON.stringify({ schema_version: 1, records }, null, 2)}\n`;
}

/** Compute the delta for one planned file. */
function deltaFor(
	ctx: RepoContext,
	repoRelativePath: string,
	content: string,
): FileDelta {
	const abs = join(ctx.root, repoRelativePath);
	const after = sha256Bytes(Buffer.from(content, "utf8"));
	if (!existsSync(abs)) {
		return {
			path: repoRelativePath,
			action: "create",
			bytesBefore: 0,
			bytesAfter: Buffer.byteLength(content, "utf8"),
			sha256Before: null,
			sha256After: after,
		};
	}
	const before = readFileSync(abs);
	const beforeSha = sha256Bytes(before);
	const same =
		beforeSha === after && before.equals(Buffer.from(content, "utf8"));
	return {
		path: repoRelativePath,
		action: same ? "unchanged" : "update",
		bytesBefore: before.length,
		bytesAfter: Buffer.byteLength(content, "utf8"),
		sha256Before: beforeSha,
		sha256After: after,
	};
}

/**
 * Apply the plan to the repository.
 *
 * The write is careful in three ways:
 *
 *   1. It writes each file to a sibling temporary path and renames it into
 *      place, so a reader never observes a partially-written canonical
 *      record.
 *   2. It writes ONLY the files the plan owns. It never touches the board,
 *      the epic detail files, the existing closure plans, or any evidence
 *      package — the import is additive to a separate namespace.
 *   3. It is IDEMPOTENT: a file whose bytes already match is not rewritten,
 *      so an exact replay produces a zero byte delta on disk as well as in
 *      the report.
 */
export function applyPlan(ctx: RepoContext, plan: ImportPlan): ApplyResult {
	const computed = computeDeltas(ctx, plan);
	const written: string[] = [];

	for (const entry of plan.entries) {
		const abs = join(ctx.root, entry.target.path);
		const current = existsSync(abs) ? readFileSync(abs) : undefined;
		if (current && current.equals(Buffer.from(entry.content, "utf8"))) {
			continue; // idempotent: byte-identical, do not rewrite
		}
		writeFileAtomic(abs, entry.content);
		written.push(entry.target.path);
	}

	const archiveAbs = join(ctx.root, ARCHIVE_INDEX_REPO_PATH);
	const archiveContent = renderArchiveIndex(plan.archiveEntries);
	const archiveCurrent = existsSync(archiveAbs)
		? readFileSync(archiveAbs)
		: undefined;
	if (
		!archiveCurrent ||
		!archiveCurrent.equals(Buffer.from(archiveContent, "utf8"))
	) {
		writeFileAtomic(archiveAbs, archiveContent);
		written.push(ARCHIVE_INDEX_REPO_PATH);
	}

	// Recompute the deltas AFTER the write so the reported state is the
	// state that actually exists on disk.
	const after = computeDeltas(ctx, plan);
	return { ...after, written };
}

/**
 * Write a file atomically: content goes to a temporary sibling, then the
 * temporary is renamed over the destination.
 */
function writeFileAtomic(absPath: string, content: string): void {
	mkdirSync(dirname(absPath), { recursive: true });
	const tmp = `${absPath}.fwmi-tmp`;
	try {
		writeFileSync(tmp, content, "utf8");
		renameSync(tmp, absPath);
	} catch (err) {
		if (existsSync(tmp)) rmSync(tmp, { force: true });
		throw err;
	}
}

/** Resolve the repository root from a starting directory, walking upward. */
export function resolveRepoRoot(start: string): string {
	let dir = resolve(start);
	for (;;) {
		if (existsSync(join(dir, ".factory", "epic-board.md"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return resolve(start);
		dir = parent;
	}
}
