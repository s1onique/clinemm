#!/usr/bin/env bun
/**
 * NUL-safe parser for `git status --porcelain=v1 -z`.
 *
 * In `-z` mode Git emits raw paths terminated by NUL. Rename/copy records
 * contain a second NUL-terminated path and do not use the human-oriented
 * `old -> new` syntax. Keeping this parser byte-oriented until each complete
 * path is isolated avoids line splitting and Git quote-decoding bugs.
 */

export interface PorcelainV1Entry {
	status: string;
	path: string;
	originalPath: string | null;
}

export function parsePorcelainV1Z(output: Buffer): PorcelainV1Entry[] {
	const records = splitNulRecords(output);
	const entries: PorcelainV1Entry[] = [];

	for (let index = 0; index < records.length; index++) {
		const record = records[index]!;
		if (record.length < 4 || record[2] !== 0x20) {
			throw new Error(`malformed porcelain v1 -z record at index ${index}`);
		}
		const status = record.subarray(0, 2).toString("ascii");
		const path = record.subarray(3).toString("utf8");
		if (path.length === 0) {
			throw new Error(`empty porcelain path at index ${index}`);
		}

		let originalPath: string | null = null;
		if (status.includes("R") || status.includes("C")) {
			index += 1;
			const original = records[index];
			if (!original || original.length === 0) {
				throw new Error(`rename/copy record at index ${index - 1} has no original path`);
			}
			originalPath = original.toString("utf8");
		}

		entries.push({ status, path, originalPath });
	}

	return entries;
}

function splitNulRecords(output: Buffer): Buffer[] {
	const records: Buffer[] = [];
	let start = 0;
	for (let index = 0; index < output.length; index++) {
		if (output[index] !== 0) continue;
		records.push(output.subarray(start, index));
		start = index + 1;
	}
	if (start < output.length) {
		throw new Error("porcelain v1 -z output is not NUL-terminated");
	}
	if (records.at(-1)?.length === 0) records.pop();
	return records;
}
