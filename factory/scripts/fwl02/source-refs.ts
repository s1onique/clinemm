#!/usr/bin/env bun
/**
 * factory/scripts/fwl02/source-refs.ts
 *
 * ACT-CLINEMM-FWL02-B-HISTORICAL-RECONCILIATION-01 — source-reference primitives.
 *
 * Every load-bearing engineering assertion carried by the FWMI v1 migration
 * package is bound to an EXACT byte range of a COMMITTED git blob. This module
 * is the single place where such a range is computed, so the producer and the
 * validator cannot disagree about what a range means.
 *
 * Rules enforced here:
 *
 *   1. Bytes are read from a committed git object (`git cat-file blob`), never
 *      from the working tree. A working-tree read would let an uncommitted
 *      edit silently change a digest.
 *   2. Line numbers are one-based and inclusive.
 *   3. A range digest covers the EXACT original bytes of those lines,
 *      INCLUDING their original newline bytes. No newline normalization, no
 *      reserialization, no trailing-whitespace stripping.
 *   4. A file with no trailing newline yields a final line whose range ends at
 *      EOF; the digest of the last line therefore does not include a newline
 *      that does not exist.
 *   5. `sha256` is lowercase hexadecimal.
 *
 * This module is DATA + plumbing only. It performs no import and writes no
 * ledger state.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

/** A source reference, matching the FWMI v1 wire shape. */
export interface FwmiSourceRef {
	readonly path: string;
	readonly start_line: number;
	readonly end_line: number;
	readonly sha256: string;
	/** Explicit source HEAD when the reference belongs to a different revision. */
	readonly source_head?: string;
}

/** Committed-byte facts about one tracked file at one revision. */
export interface CommittedFileFacts {
	readonly path: string;
	readonly bytes: number;
	readonly lines: number;
	readonly sha256: string;
	readonly git_blob: string;
}

/**
 * The FROZEN source head for the FWL02 package.
 *
 * The package's source head is FROZEN at an explicit committed revision. It is
 * NOT derived from `HEAD` at generation time: the package's own publication
 * commit advances `HEAD`, and re-deriving the source head would silently
 * rebind every assertion to the publication commit itself — which would make
 * the package non-reproducible and would create a self-referential digest.
 *
 * The frozen head is the repository state the migration was reconciled FROM.
 */
export const FWL02_FROZEN_SOURCE_HEAD =
	"e196d0e6243f40ebfd76d2cf0db7bda74e97d6d6";

/**
 * Run a git command against the repository and return its raw stdout buffer.
 * Throws when git fails, so a broken repository never yields silent empty data.
 */
export function gitBuffer(args: readonly string[], cwd?: string): Buffer {
	const result = spawnSync("git", [...args], {
		cwd,
		maxBuffer: 1024 * 1024 * 1024,
		encoding: "buffer",
	});
	if (result.error) {
		throw new Error(`git ${args.join(" ")} failed: ${result.error.message}`);
	}
	if (result.status !== 0) {
		const stderr = result.stderr?.toString("utf8") ?? "";
		throw new Error(
			`git ${args.join(" ")} exited ${result.status}: ${stderr.trim()}`,
		);
	}
	return result.stdout ?? Buffer.alloc(0);
}

/** Run a git command and decode stdout as UTF-8 text. */
export function gitText(args: readonly string[], cwd?: string): string {
	return gitBuffer(args, cwd).toString("utf8");
}

/** Resolve a revision to its full 40-char commit id. Throws when it does not resolve. */
export function resolveCommit(rev: string, cwd?: string): string {
	const out = gitText(["rev-parse", "--verify", `${rev}^{commit}`], cwd).trim();
	if (!/^[0-9a-f]{40}$/.test(out)) {
		throw new Error(`revision did not resolve to a commit: ${rev}`);
	}
	return out;
}

/** Lowercase hex SHA-256 of a byte buffer. */
export function sha256Hex(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/**
 * A per-process cache of committed blobs.
 *
 * The validator resolves hundreds of source references that frequently point
 * into the same large file. Caching the blob bytes avoids re-spawning git for
 * every reference and keeps a full validation run well inside a test timeout.
 */
const BLOB_CACHE = new Map<string, Buffer>();

/** Read the committed bytes of `path` at `rev`. Throws when the path is not in that revision. */
export function readCommittedBytes(
	path: string,
	rev: string,
	cwd?: string,
): Buffer {
	const key = `${rev}\u0000${path}`;
	const cached = BLOB_CACHE.get(key);
	if (cached) {
		return cached;
	}
	const bytes = gitBuffer(["cat-file", "blob", `${rev}:${path}`], cwd);
	BLOB_CACHE.set(key, bytes);
	return bytes;
}

/**
 * Split committed bytes into lines, preserving the EXACT newline bytes.
 *
 * Each entry is `{ content, newline }` where `content` excludes the newline
 * and `newline` is the literal terminator bytes ("" for a final line with no
 * terminator). This makes the digest of a line range reproducible without
 * ever normalizing line endings.
 */
export function splitCommittedLines(
	bytes: Buffer,
): Array<{ content: Buffer; newline: string }> {
	const lines: Array<{ content: Buffer; newline: string }> = [];
	let start = 0;
	for (let index = 0; index < bytes.length; index++) {
		const byte = bytes[index]!;
		if (byte === 0x0a) {
			lines.push({ content: bytes.subarray(start, index), newline: "\n" });
			start = index + 1;
			continue;
		}
		if (byte === 0x0d && bytes[index + 1] === 0x0a) {
			lines.push({ content: bytes.subarray(start, index), newline: "\r\n" });
			start = index + 2;
			index++;
		}
	}
	// The trailing remainder is a final line. An empty remainder after a
	// trailing newline is NOT a line (the file ended with a newline).
	if (start < bytes.length) {
		lines.push({ content: bytes.subarray(start), newline: "" });
	}
	return lines;
}

/**
 * The POSITIONAL byte boundaries of every line in `bytes`.
 *
 * `start` is the byte offset at which the line's content begins; `end` is the
 * byte offset just past the line's terminator (i.e. the start of the NEXT
 * line). For a final line with no terminator, `end` is the buffer length.
 *
 * These offsets are accumulated while scanning, so they identify a line by
 * POSITION. A content search cannot: it cannot tell the first `same` from the
 * third, it cannot find an empty line at all, and it can land on a substring
 * of an unrelated line.
 */
interface LineBoundaries {
	readonly start: number;
	readonly end: number;
}

/**
 * Compute the positional byte boundaries of every line in `bytes`.
 *
 * The returned array is indexed by zero-based line number, so line N
 * (one-based) lives at index N-1.
 */
function lineBoundaries(bytes: Buffer): LineBoundaries[] {
	const boundaries: LineBoundaries[] = [];
	let start = 0;
	for (let index = 0; index < bytes.length; index++) {
		const byte = bytes[index]!;
		if (byte === 0x0a) {
			boundaries.push({ start, end: index + 1 });
			start = index + 1;
			continue;
		}
		if (byte === 0x0d && bytes[index + 1] === 0x0a) {
			boundaries.push({ start, end: index + 2 });
			start = index + 2;
			index++;
		}
	}
	// The trailing remainder is a final line. An empty remainder after a
	// trailing newline is NOT a line (the file ended with a newline).
	if (start < bytes.length) {
		boundaries.push({ start, end: bytes.length });
	}
	return boundaries;
}

/** The exact byte range of a one-based inclusive line span within committed bytes. */
export function lineRangeBytes(
	bytes: Buffer,
	startLine: number,
	endLine: number,
): Buffer {
	if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
		throw new Error(`non-integer line range: ${startLine}..${endLine}`);
	}
	if (startLine < 1) {
		throw new Error(`start_line must be >= 1, got ${startLine}`);
	}
	if (endLine < startLine) {
		throw new Error(`end_line (${endLine}) < start_line (${startLine})`);
	}
	const boundaries = lineBoundaries(bytes);
	if (boundaries.length === 0) {
		throw new Error(
			`range ${startLine}..${endLine} requested from an empty file`,
		);
	}
	if (endLine > boundaries.length) {
		throw new Error(
			`end_line (${endLine}) exceeds file line count (${boundaries.length})`,
		);
	}
	// Select the requested lines BY POSITION: the range starts at the first
	// selected line's content offset and ends just past the last selected
	// line's terminator. The result is an exact subarray of the ORIGINAL
	// bytes — no normalization, no trimming, no decode/re-encode.
	const first = boundaries[startLine - 1]!;
	const last = boundaries[endLine - 1]!;
	return bytes.subarray(first.start, last.end);
}

/**
 * Compute the committed-byte facts for one tracked file at one revision.
 * Throws when the path does not exist at that revision.
 */
export function committedFileFacts(
	path: string,
	rev: string,
	cwd?: string,
): CommittedFileFacts {
	const bytes = readCommittedBytes(path, rev, cwd);
	const lines = splitCommittedLines(bytes);
	const blob = gitText(["rev-parse", `${rev}:${path}`], cwd).trim();
	if (!/^[0-9a-f]{40}$/.test(blob)) {
		throw new Error(`could not resolve blob id for ${path}@${rev}`);
	}
	return {
		path,
		bytes: bytes.length,
		lines: lines.length,
		sha256: sha256Hex(bytes),
		git_blob: blob,
	};
}

/**
 * Build a source reference for a one-based inclusive line range at `rev`.
 * The `source_head` is only emitted when the reference belongs to a revision
 * other than the package's effective source head.
 */
export function makeSourceRef(
	path: string,
	startLine: number,
	endLine: number,
	rev: string,
	effectiveHead: string,
	cwd?: string,
): FwmiSourceRef {
	const bytes = readCommittedBytes(path, rev, cwd);
	const range = lineRangeBytes(bytes, startLine, endLine);
	const base = {
		path,
		start_line: startLine,
		end_line: endLine,
		sha256: sha256Hex(range),
	};
	return rev === effectiveHead ? base : { ...base, source_head: rev };
}

/**
 * Verify a source reference against the committed bytes at its effective head.
 * Returns a list of human-readable problems; an empty list means the
 * reference is intact.
 */
export function verifySourceRef(
	ref: FwmiSourceRef,
	effectiveHead: string,
	cwd?: string,
): string[] {
	const problems: string[] = [];
	const rev = ref.source_head ?? effectiveHead;
	let bytes: Buffer;
	try {
		bytes = readCommittedBytes(ref.path, rev, cwd);
	} catch {
		return [`${ref.path}@${rev}: file does not resolve at that revision`];
	}
	const lines = splitCommittedLines(bytes);
	if (ref.start_line < 1) {
		problems.push(`${ref.path}: start_line ${ref.start_line} < 1`);
	}
	if (ref.end_line < ref.start_line) {
		problems.push(
			`${ref.path}: end_line ${ref.end_line} < start_line ${ref.start_line}`,
		);
	}
	if (ref.end_line > lines.length) {
		problems.push(
			`${ref.path}: end_line ${ref.end_line} exceeds file line count ${lines.length}`,
		);
		return problems;
	}
	let range: Buffer;
	try {
		range = lineRangeBytes(bytes, ref.start_line, ref.end_line);
	} catch (error) {
		problems.push(`${ref.path}: ${(error as Error).message}`);
		return problems;
	}
	const actual = sha256Hex(range);
	if (actual !== ref.sha256) {
		problems.push(
			`${ref.path}:${ref.start_line}-${ref.end_line}: digest mismatch (expected ${ref.sha256}, actual ${actual})`,
		);
	}
	if (ref.source_head !== undefined) {
		try {
			resolveCommit(ref.source_head, cwd);
		} catch {
			problems.push(
				`${ref.path}: source_head ${ref.source_head} does not resolve to a commit`,
			);
		}
	}
	return problems;
}
