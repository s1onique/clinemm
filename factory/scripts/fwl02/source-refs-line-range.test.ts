#!/usr/bin/env bun
/**
 * factory/scripts/fwl02/source-refs-line-range.test.ts
 *
 * ACT-CLINEMM-FWL02-B-HISTORICAL-RECONCILIATION-01 (CORRECTION-04) —
 * source-range byte binding tests at the ACTUAL production seam.
 *
 * `lineRangeBytes()` is the single place where a source reference's byte
 * range is computed. It MUST select the requested lines BY POSITION, not by
 * searching for their content: a content search cannot distinguish the
 * FIRST occurrence of `same` from the THIRD, cannot locate an empty line at
 * all, and can land on a SUBSTRING of a different line.
 *
 * Every assertion below compares the produced bytes against an EXPLICIT
 * literal expected buffer. The expectation is never computed by another
 * call into the production helper — otherwise the test would only prove that
 * the helper agrees with itself.
 *
 * These are `bun:test` tests (not mocha): they need no VS Code extension
 * host.
 *
 * Run with: bun test factory/scripts/fwl02/
 */

import { describe, expect, test } from "bun:test";
import { lineRangeBytes, splitCommittedLines } from "./source-refs.ts";

/** Build a buffer from a literal string. */
function buf(text: string): Buffer {
	return Buffer.from(text, "utf8");
}

describe("lineRangeBytes — positional byte-range selection", () => {
	test("a repeated line is bound by position, not by content occurrence", () => {
		// Lines: 1 "same", 2 "A", 3 "same", 4 "B", 5 "same"
		const bytes = buf("same\nA\nsame\nB\nsame\n");
		const range = lineRangeBytes(bytes, 3, 4);
		expect(range.toString("utf8")).toBe("same\nB\n");
		expect(range.equals(buf("same\nB\n"))).toBe(true);
	});

	test("an empty starting line is bound by position", () => {
		// Lines: 1 "", 2 "alpha", 3 "beta"
		const bytes = buf("\nalpha\nbeta\n");
		const range = lineRangeBytes(bytes, 1, 2);
		expect(range.toString("utf8")).toBe("\nalpha\n");
		expect(range.equals(buf("\nalpha\n"))).toBe(true);
	});

	test("an empty ending line is bound by position", () => {
		// Lines: 1 "alpha", 2 "beta", 3 ""
		const bytes = buf("alpha\nbeta\n\n");
		const range = lineRangeBytes(bytes, 2, 3);
		expect(range.toString("utf8")).toBe("beta\n\n");
		expect(range.equals(buf("beta\n\n"))).toBe(true);
	});

	test("a repeated Markdown table separator is bound by position", () => {
		// The `| --- |` separator repeats on every table row.
		const bytes = buf("| a |\n| --- |\n| b |\n| --- |\n| c |\n| --- |\n");
		const range = lineRangeBytes(bytes, 5, 6);
		expect(range.toString("utf8")).toBe("| c |\n| --- |\n");
		expect(range.equals(buf("| c |\n| --- |\n"))).toBe(true);
	});

	test("CRLF terminators are preserved exactly", () => {
		const bytes = buf("alpha\r\nbeta\r\ngamma\r\n");
		const range = lineRangeBytes(bytes, 2, 3);
		expect(range.toString("utf8")).toBe("beta\r\ngamma\r\n");
		expect(range.equals(buf("beta\r\ngamma\r\n"))).toBe(true);
	});

	test("LF terminators are preserved exactly", () => {
		const bytes = buf("alpha\nbeta\ngamma\n");
		const range = lineRangeBytes(bytes, 2, 3);
		expect(range.toString("utf8")).toBe("beta\ngamma\n");
		expect(range.equals(buf("beta\ngamma\n"))).toBe(true);
	});

	test("mixed CRLF and LF terminators are preserved exactly", () => {
		// Lines: 1 "alpha" CRLF, 2 "beta" LF, 3 "gamma" CRLF
		const bytes = buf("alpha\r\nbeta\ngamma\r\n");
		const range = lineRangeBytes(bytes, 1, 3);
		expect(range.toString("utf8")).toBe("alpha\r\nbeta\ngamma\r\n");
		expect(range.equals(buf("alpha\r\nbeta\ngamma\r\n"))).toBe(true);
	});

	test("Unicode content is bound by byte position, not by character position", () => {
		// "é" is two bytes; the range must still cover the exact bytes.
		const bytes = buf("éé\n中文\nz\n");
		const range = lineRangeBytes(bytes, 2, 2);
		expect(range.equals(buf("中文\n"))).toBe(true);
		expect(range.length).toBe(Buffer.byteLength("中文\n"));
	});

	test("a final line without a terminator ends at EOF", () => {
		const bytes = buf("alpha\nbeta");
		const range = lineRangeBytes(bytes, 2, 2);
		expect(range.toString("utf8")).toBe("beta");
		expect(range.equals(buf("beta"))).toBe(true);
		// The range must NOT invent a trailing newline.
		expect(range.includes(0x0a)).toBe(false);
	});

	test("a range that ends on an unterminated final line does not include a newline", () => {
		const bytes = buf("alpha\nbeta\ngamma");
		const range = lineRangeBytes(bytes, 2, 3);
		expect(range.toString("utf8")).toBe("beta\ngamma");
		expect(range.equals(buf("beta\ngamma"))).toBe(true);
	});

	test("a whole-file range reproduces the original bytes exactly", () => {
		const bytes = buf("same\nA\nsame\nB\nsame\n");
		const range = lineRangeBytes(bytes, 1, 5);
		expect(range.equals(bytes)).toBe(true);
	});

	test("a single line range covers exactly that line and its terminator", () => {
		const bytes = buf("one\ntwo\nthree\n");
		expect(lineRangeBytes(bytes, 2, 2).equals(buf("two\n"))).toBe(true);
	});

	test("an out-of-range request is rejected", () => {
		const bytes = buf("one\ntwo\nthree\n");
		expect(() => lineRangeBytes(bytes, 1, 99)).toThrow();
		expect(() => lineRangeBytes(bytes, 0, 1)).toThrow();
		expect(() => lineRangeBytes(bytes, 3, 1)).toThrow();
	});
});

describe("splitCommittedLines — line accounting agrees with the range seam", () => {
	test("the line count matches the number of selectable ranges", () => {
		const bytes = buf("same\nA\nsame\nB\nsame\n");
		const lines = splitCommittedLines(bytes);
		expect(lines.length).toBe(5);
		expect(lines.map((line) => line.content.toString("utf8"))).toEqual([
			"same",
			"A",
			"same",
			"B",
			"same",
		]);
		expect(lines.map((line) => line.newline)).toEqual([
			"\n",
			"\n",
			"\n",
			"\n",
			"\n",
		]);
	});

	test("a file without a trailing newline still exposes its final line", () => {
		const bytes = buf("alpha\nbeta");
		const lines = splitCommittedLines(bytes);
		expect(lines.length).toBe(2);
		expect(lines[1]!.newline).toBe("");
	});

	test("a file that is only a newline has exactly one empty line", () => {
		const bytes = buf("\n");
		const lines = splitCommittedLines(bytes);
		expect(lines.length).toBe(1);
		expect(lines[0]!.content.length).toBe(0);
		expect(lines[0]!.newline).toBe("\n");
	});
});
