/**
 * tools/factory/fwmi/digest.ts
 *
 * Digest and byte-range helpers shared by the FWMI adapter.
 *
 * The source-range digest is the mechanism that lets the adapter VERIFY
 * provenance rather than trust it: the producer's `source_ref.sha256` covers
 * the exact original bytes of a line range, so the importer can re-read the
 * committed blob at the recorded source HEAD and confirm the record was
 * derived from bytes that still exist.
 */

import { createHash } from "node:crypto";

/** Lowercase hex SHA-256 of a UTF-8 string. */
export function sha256Hex(content: string): string {
	return createHash("sha256")
		.update(Buffer.from(content, "utf8"))
		.digest("hex");
}

/** Lowercase hex SHA-256 of raw bytes. */
export function sha256Bytes(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Extract the exact bytes of a one-based, inclusive line range.
 *
 * The extraction preserves the ORIGINAL newline bytes: a range that ends on
 * a line keeps that line's terminator, and a range that ends mid-file
 * keeps whatever follows the last line up to the next newline. The digest
 * therefore matches the producer's digest only when both used the same
 * convention — which is exactly the binding we want to verify.
 */
export function extractLineRange(
	content: string,
	startLine: number,
	endLine: number,
): string | undefined {
	if (!Number.isInteger(startLine) || !Number.isInteger(endLine))
		return undefined;
	if (startLine < 1 || endLine < startLine) return undefined;
	const lines = content.split("\n");
	if (startLine > lines.length) return undefined;
	const last = Math.min(endLine, lines.length);
	const slice = lines.slice(startLine - 1, last);
	let text = slice.join("\n");
	// The trailing newline of the final included line is part of the range
	// when that line is not the last line of the file.
	if (last < lines.length) text += "\n";
	return text;
}
