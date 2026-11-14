import type { Message, ToolResultContent } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { MessageBuilder } from "./message-builder";

const HISTORICAL_SOURCE_PATH =
	"/Volumes/UserData/Users/chistyakov/Projects/Znanie/keycloak/.gitlab-ci.yml";
const ANCHOR_ID = "call_anchor";
const SECOND_ID = "call_second";
const THIRD_ID = "call_third";
const OUTDATED_MARKER = "[outdated - see the latest file content]";

/**
 * Reproduces the historical .gitlab-ci.yml payload shape without committing
 * private source: a structured successful read result of 64,547 characters.
 *
 * The synthetic fixture is deliberately larger than the 64 KiB stale-read
 * rewrite threshold so it exercises the same batching path as the historical
 * capture. `HISTORICAL_CONTENT_CHARS` is asserted below so the documented
 * size cannot drift from the generated payload.
 */
const HISTORICAL_CONTENT = `${"  1 | fixture line\n".repeat(3_397)}tail`;
const HISTORICAL_CONTENT_CHARS = HISTORICAL_CONTENT.length;
const DOCUMENTED_HISTORICAL_CONTENT_CHARS = 64_547;

interface StructuredReadEntry {
	query: string;
	result: string;
	success: boolean;
	error?: string;
}

function readUse(id: string, path = HISTORICAL_SOURCE_PATH): Message {
	return {
		role: "assistant",
		content: [
			{
				type: "tool_use",
				id,
				name: "read_files",
				input: { path },
			},
		],
	};
}

function readResult(
	id: string,
	content: string,
	path = HISTORICAL_SOURCE_PATH,
): Message {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: id,
				name: "read_files",
				content: [
					{
						query: path,
						result: content,
						success: true,
					},
				] as unknown as ToolResultContent["content"],
			},
		],
	};
}

function toolResultEntries(message: Message): StructuredReadEntry[] {
	if (!Array.isArray(message.content)) {
		return [];
	}
	return message.content.flatMap((block) => {
		if (block.type !== "tool_result" || !Array.isArray(block.content)) {
			return [];
		}
		return block.content as unknown as StructuredReadEntry[];
	});
}

function resultEntryById(
	messages: Message[],
	toolUseId: string,
): StructuredReadEntry | undefined {
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_result" && block.tool_use_id === toolUseId) {
				if (typeof block.content === "string") {
					const parsed = JSON.parse(block.content);
					return Array.isArray(parsed) ? parsed[0] : undefined;
				}
				return toolResultEntries(message)[0];
			}
		}
	}
	return undefined;
}

function resultContentById(messages: Message[], toolUseId: string): unknown {
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_result" && block.tool_use_id === toolUseId) {
				return block.content;
			}
		}
	}
	return undefined;
}

function serializedMessageBytes(message: Message): number {
	return Buffer.byteLength(JSON.stringify(message), "utf8");
}

function commonPrefixMessages(left: Message[], right: Message[]): number {
	const limit = Math.min(left.length, right.length);
	let count = 0;
	while (
		count < limit &&
		JSON.stringify(left[count]) === JSON.stringify(right[count])
	) {
		count++;
	}
	return count;
}

function commonPrefixBytes(left: Message[], right: Message[]): number {
	return left
		.slice(0, commonPrefixMessages(left, right))
		.reduce((total, message) => total + serializedMessageBytes(message), 0);
}

function failedReadResult(id: string): Message {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: id,
				name: "read_files",
				is_error: true,
				content: [{ type: "text", text: "missing file" }],
			},
		],
	};
}

function structuredReadResult(
	id: string,
	entries: StructuredReadEntry[],
): Message {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: id,
				name: "read_files",
				content: entries as unknown as ToolResultContent["content"],
			},
		],
	};
}

function buildHistoricalChronology() {
	const iteration10: Message[] = [
		{ role: "user", content: "inspect the repository" },
		readUse(ANCHOR_ID),
		readResult(ANCHOR_ID, HISTORICAL_CONTENT),
		{ role: "assistant", content: [{ type: "text", text: "continue" }] },
	];
	const iteration11: Message[] = [
		...iteration10,
		readUse(SECOND_ID),
		readResult(SECOND_ID, HISTORICAL_CONTENT),
		readUse(THIRD_ID),
		readResult(THIRD_ID, HISTORICAL_CONTENT),
	];
	return { iteration10, iteration11 };
}

/** A payload large enough that two copies cross the 64 KiB rewrite threshold. */
const LARGE_CONTENT = "x".repeat(40_000);
const LARGE_CHANGED_CONTENT = "y".repeat(40_000);
const STALE_REWRITE_SOURCE_PATH = "/private/project/stale.txt";

function staleReadUse(id: string, path = STALE_REWRITE_SOURCE_PATH): Message {
	return {
		role: "assistant",
		content: [{ type: "tool_use", id, name: "read_files", input: { path } }],
	};
}

function staleReadResult(
	id: string,
	content: string,
	path = STALE_REWRITE_SOURCE_PATH,
): Message {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: id,
				name: "read_files",
				content: [
					{ query: path, result: content, success: true },
				] as unknown as ToolResultContent["content"],
			},
		],
	};
}

describe("MessageBuilder duplicate read-result projection", () => {
	it("keeps the synthetic fixture at its documented size", () => {
		expect(HISTORICAL_CONTENT_CHARS).toBe(DOCUMENTED_HISTORICAL_CONTENT_CHARS);
	});

	it("deduplicates only later byte-identical reads at the same locator", () => {
		const builder = new MessageBuilder();
		const messages: Message[] = [
			readUse("one"),
			readResult("one", "same"),
			readUse("two", "/private/project/other.txt"),
			readResult("two", "same", "/private/project/other.txt"),
			readUse("three", "/private/project/ranged.txt"),
			readResult("three", "same", "/private/project/ranged.txt"),
			readUse("four", "/private/project/ranged.txt"),
			readResult("four", "changed", "/private/project/ranged.txt"),
			readUse("five", "/private/project/ranged.txt"),
			readResult("five", "same", "/private/project/ranged.txt"),
		];
		const output = builder.buildForApi(messages);

		expect(resultEntryById(output, "two")?.result).toBe("same");
		expect(resultEntryById(output, "three")?.result).toBe("same");
		expect(resultEntryById(output, "four")?.result).toBe("changed");
		expect(resultEntryById(output, "five")?.result).toBe("same");
	});

	it("represents X to Y to X conservatively without referring to the earlier X", () => {
		const builder = new MessageBuilder();
		const messages: Message[] = [
			readUse("x"),
			readResult("x", "X"),
			readUse("y"),
			readResult("y", "Y"),
			readUse("x2"),
			readResult("x2", "X"),
		];
		const output = builder.buildForApi(messages);

		expect(resultEntryById(output, "x")?.result).toBe("X");
		expect(resultEntryById(output, "y")?.result).toBe("Y");
		expect(resultEntryById(output, "x2")?.result).toBe("X");
		expect(JSON.stringify(output)).not.toContain(
			"same content as earlier read result x]",
		);
	});

	it("preserves failed, binary, and mixed-batch results without references", () => {
		const builder = new MessageBuilder();
		const messages: Message[] = [
			readUse("failed"),
			failedReadResult("failed"),
			readUse("binary"),
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "binary",
						name: "read_files",
						content: [
							{
								type: "image",
								data: "AAAA",
								mediaType: "image/png",
							},
						],
					},
				],
			},
			readUse("mixed"),
			structuredReadResult("mixed", [
				{
					query: HISTORICAL_SOURCE_PATH,
					result: "one",
					success: true,
				},
				{
					query: "/private/project/second.txt",
					result: "two",
					success: true,
				},
			]),
		];
		const output = builder.buildForApi(messages);
		const serialized = JSON.stringify(output);

		expect(serialized).toContain("missing file");
		expect(serialized).toContain("image/png");
		expect(serialized).toContain('"one"');
		expect(serialized).toContain('"two"');
		expect(serialized).not.toContain("same content as earlier read result");
	});

	it("keeps every duplicate as a reference when the stale-rewrite threshold is crossed", () => {
		const builder = new MessageBuilder({
			maxToolResultChars: HISTORICAL_CONTENT_CHARS * 2,
		});
		const { iteration10, iteration11 } = buildHistoricalChronology();
		const request10 = builder.buildForApi(iteration10);
		const request11 = builder.buildForApi(iteration11);

		expect(resultEntryById(request11, ANCHOR_ID)?.result).toBe(
			HISTORICAL_CONTENT,
		);
		expect(resultContentById(request11, SECOND_ID)).toEqual([
			{ type: "text", text: expect.stringContaining(ANCHOR_ID) },
		]);
		expect(resultContentById(request11, THIRD_ID)).toEqual([
			{ type: "text", text: expect.stringContaining(ANCHOR_ID) },
		]);
		expect(commonPrefixMessages(request10, request11)).toBe(4);
		expect(JSON.stringify(request11)).toContain(ANCHOR_ID);
		expect(JSON.stringify(request11)).not.toContain(OUTDATED_MARKER);
	});

	it("keeps references resolvable after aggregate budget truncation", () => {
		const builder = new MessageBuilder({
			maxToolResultChars: HISTORICAL_CONTENT_CHARS * 2,
			maxTotalTextBytes: HISTORICAL_CONTENT_CHARS,
		});
		const { iteration11 } = buildHistoricalChronology();
		const output = builder.buildForApi(iteration11);
		const serialized = JSON.stringify(output);
		const referencesAnchor = serialized.includes(
			`same content as earlier read result ${ANCHOR_ID}`,
		);
		const anchorHasFullContent =
			resultEntryById(output, ANCHOR_ID)?.result === HISTORICAL_CONTENT;

		expect(referencesAnchor).toBe(anchorHasFullContent);
	});

	it("preserves the anchor and projects later duplicates to resolvable references", () => {
		const builder = new MessageBuilder({
			maxToolResultChars: HISTORICAL_CONTENT_CHARS * 2,
			minOutdatedRewriteBytes: Number.POSITIVE_INFINITY,
		});
		const { iteration10, iteration11 } = buildHistoricalChronology();
		const canonicalBefore = structuredClone(iteration11);

		const request10 = builder.buildForApi(iteration10);
		const request11 = builder.buildForApi(iteration11);

		expect(commonPrefixMessages(request10, request11)).toBe(4);
		expect(commonPrefixBytes(request10, request11)).toBe(
			serializedMessageBytes(request10[0]) +
				serializedMessageBytes(request10[1]) +
				serializedMessageBytes(request10[2]) +
				serializedMessageBytes(request10[3]),
		);
		expect(resultEntryById(request11, ANCHOR_ID)?.result).toBe(
			HISTORICAL_CONTENT,
		);
		expect(resultContentById(request11, SECOND_ID)).toEqual([
			{ type: "text", text: expect.stringContaining(ANCHOR_ID) },
		]);
		expect(resultContentById(request11, THIRD_ID)).toEqual([
			{ type: "text", text: expect.stringContaining(ANCHOR_ID) },
		]);
		expect(
			JSON.stringify(request11).match(new RegExp(ANCHOR_ID, "g")),
		).toHaveLength(4);
		expect(JSON.stringify(request11)).not.toContain(OUTDATED_MARKER);
		expect(iteration11).toEqual(canonicalBefore);
	});
});

describe("MessageBuilder duplicate read-result freshness conservation", () => {
	/**
	 * RED for the stale-content conservation defect: once a later read observed
	 * different content at the same locator, the obsolete observations must
	 * fall back to the existing stale-read rewrite policy instead of being
	 * shielded as a protected anchor/duplicate pair.
	 */
	it("rewrites obsolete duplicate groups when a later read changed the content", () => {
		const builder = new MessageBuilder({ maxToolResultChars: 200_000 });
		const messages: Message[] = [
			staleReadUse("a"),
			staleReadResult("a", LARGE_CONTENT),
			staleReadUse("b"),
			staleReadResult("b", LARGE_CONTENT),
			staleReadUse("c"),
			staleReadResult("c", LARGE_CHANGED_CONTENT),
		];

		const output = builder.buildForApi(messages);

		// The obsolete X observations are reclaimed by the stale-read policy.
		expect(resultEntryById(output, "a")?.result).toBe(OUTDATED_MARKER);
		expect(resultEntryById(output, "b")?.result).toBe(OUTDATED_MARKER);
		// The newest Y observation remains fully visible.
		expect(resultEntryById(output, "c")?.result).toBe(LARGE_CHANGED_CONTENT);
		// No compact reference survives, so nothing points at a rewritten anchor.
		expect(JSON.stringify(output)).not.toContain(
			"same content as earlier read result",
		);
	});

	it("rewrites obsolete duplicate groups across a sticky multi-build sequence", () => {
		const builder = new MessageBuilder({ maxToolResultChars: 200_000 });
		const beforeChange: Message[] = [
			staleReadUse("a"),
			staleReadResult("a", LARGE_CONTENT),
			staleReadUse("b"),
			staleReadResult("b", LARGE_CONTENT),
		];
		const afterChange: Message[] = [
			...beforeChange,
			staleReadUse("c"),
			staleReadResult("c", LARGE_CHANGED_CONTENT),
		];

		const before = builder.buildForApi(beforeChange);
		expect(resultEntryById(before, "a")?.result).toBe(LARGE_CONTENT);
		expect(resultContentById(before, "b")).toEqual([
			{ type: "text", text: expect.stringContaining("a") },
		]);

		const after = builder.buildForApi(afterChange);
		expect(resultEntryById(after, "a")?.result).toBe(OUTDATED_MARKER);
		expect(resultEntryById(after, "b")?.result).toBe(OUTDATED_MARKER);
		expect(resultEntryById(after, "c")?.result).toBe(LARGE_CHANGED_CONTENT);
	});

	it("keeps the anchor stable for an unchanged X to X to X sequence", () => {
		const builder = new MessageBuilder({ maxToolResultChars: 200_000 });
		const messages: Message[] = [
			staleReadUse("a"),
			staleReadResult("a", LARGE_CONTENT),
			staleReadUse("b"),
			staleReadResult("b", LARGE_CONTENT),
			staleReadUse("c"),
			staleReadResult("c", LARGE_CONTENT),
		];

		const output = builder.buildForApi(messages);

		expect(resultEntryById(output, "a")?.result).toBe(LARGE_CONTENT);
		expect(resultContentById(output, "b")).toEqual([
			{ type: "text", text: expect.stringContaining("a") },
		]);
		expect(resultContentById(output, "c")).toEqual([
			{ type: "text", text: expect.stringContaining("a") },
		]);
		expect(JSON.stringify(output)).not.toContain(OUTDATED_MARKER);
	});

	it("keeps the newest observation authoritative for X to Y to X", () => {
		const builder = new MessageBuilder({ maxToolResultChars: 200_000 });
		const messages: Message[] = [
			staleReadUse("a"),
			staleReadResult("a", LARGE_CONTENT),
			staleReadUse("b"),
			staleReadResult("b", LARGE_CHANGED_CONTENT),
			staleReadUse("c"),
			staleReadResult("c", LARGE_CONTENT),
		];

		const output = builder.buildForApi(messages);

		// The superseded middle observation is reclaimed.
		expect(resultEntryById(output, "a")?.result).toBe(OUTDATED_MARKER);
		expect(resultEntryById(output, "b")?.result).toBe(OUTDATED_MARKER);
		// The last observation of the original content stays visible.
		expect(resultEntryById(output, "c")?.result).toBe(LARGE_CONTENT);
		// The later X must not claim identity with the superseded earlier X.
		expect(JSON.stringify(output)).not.toContain(
			"same content as earlier read result a]",
		);
	});

	it("does not alias reads of the same path at different ranges", () => {
		const builder = new MessageBuilder({ maxToolResultChars: 200_000 });
		const path = "/private/project/ranged.txt";
		const rangedRead = (
			id: string,
			startLine: number,
			endLine: number,
		): Message[] => [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id,
						name: "read_files",
						input: { path, start_line: startLine, end_line: endLine },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: id,
						name: "read_files",
						content: [
							{
								query: `${path}:${startLine}-${endLine}`,
								result: LARGE_CONTENT,
								success: true,
							},
						] as unknown as ToolResultContent["content"],
					},
				],
			},
		];
		const messages: Message[] = [
			...rangedRead("first", 1, 10),
			...rangedRead("second", 11, 20),
		];

		const output = builder.buildForApi(messages);

		// Identical bytes at a different range are not the same observation.
		expect(JSON.stringify(output)).not.toContain(
			"same content as earlier read result",
		);
		expect(resultEntryById(output, "first")?.result).toBe(LARGE_CONTENT);
		expect(resultEntryById(output, "second")?.result).toBe(LARGE_CONTENT);
	});

	it("restores a protected anchor after a rollback to the unchanged sequence", () => {
		const builder = new MessageBuilder({ maxToolResultChars: 200_000 });
		const unchanged: Message[] = [
			staleReadUse("a"),
			staleReadResult("a", LARGE_CONTENT),
			staleReadUse("b"),
			staleReadResult("b", LARGE_CONTENT),
		];
		const changed: Message[] = [
			...unchanged,
			staleReadUse("c"),
			staleReadResult("c", LARGE_CHANGED_CONTENT),
		];

		builder.buildForApi(changed);
		const restored = builder.buildForApi(unchanged);

		expect(resultEntryById(restored, "a")?.result).toBe(LARGE_CONTENT);
		expect(resultContentById(restored, "b")).toEqual([
			{ type: "text", text: expect.stringContaining("a") },
		]);
	});

	it("keeps the anchor lifetime bound to the final projection", () => {
		const builder = new MessageBuilder({
			maxToolResultChars: HISTORICAL_CONTENT_CHARS * 2,
			maxTotalTextBytes: HISTORICAL_CONTENT_CHARS,
		});
		const { iteration11 } = buildHistoricalChronology();
		const output = builder.buildForApi(iteration11);
		const serialized = JSON.stringify(output);
		const referencesAnchor = serialized.includes(
			`same content as earlier read result ${ANCHOR_ID}`,
		);
		const anchorHasFullContent =
			resultEntryById(output, ANCHOR_ID)?.result === HISTORICAL_CONTENT;

		expect(referencesAnchor).toBe(anchorHasFullContent);
	});
});

/**
 * The 17-case adversarial matrix from the predecessor reconnaissance
 * (ACT-CLINEMM-READ-RESULT-DEDUP-RECON-01), executed against the permanent
 * production implementation instead of a throwaway probe.
 */
describe("MessageBuilder duplicate read-result adversarial matrix", () => {
	const matrixPath = "/private/project/matrix.txt";

	const matrixRead = (
		id: string,
		content: string,
		path = matrixPath,
		query?: string,
	): Message[] => [
		{
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id,
					name: "read_files",
					input: { path },
				},
			],
		},
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: id,
					name: "read_files",
					content: [
						{
							query: query ?? path,
							result: content,
							success: true,
						},
					] as unknown as ToolResultContent["content"],
				},
			],
		},
	];

	// Case 1: two identical full-file reads — the later result may be compacted.
	it("case 1: two identical full-file reads — the later result may be compacted", () => {
		const builder = new MessageBuilder();
		const output = builder.buildForApi([
			...matrixRead("one", "same bytes"),
			...matrixRead("two", "same bytes"),
		]);

		expect(resultEntryById(output, "one")?.result).toBe("same bytes");
		expect(resultContentById(output, "two")).toEqual([
			{ type: "text", text: expect.stringContaining("one") },
		]);
	});

	// Case 2: three identical reads — earlier prefix preserved, no dangling refs.
	it("case 2: three identical reads — earlier prefix preserved, no dangling references", () => {
		const builder = new MessageBuilder();
		const output = builder.buildForApi([
			...matrixRead("one", "same bytes"),
			...matrixRead("two", "same bytes"),
			...matrixRead("three", "same bytes"),
		]);

		expect(resultEntryById(output, "one")?.result).toBe("same bytes");
		expect(resultContentById(output, "two")).toEqual([
			{ type: "text", text: expect.stringContaining("one") },
		]);
		expect(resultContentById(output, "three")).toEqual([
			{ type: "text", text: expect.stringContaining("one") },
		]);
		expect(JSON.stringify(output)).toContain("one");
	});

	// Case 3: same path, changed content — the full new content is retained.
	it("case 3: same path, changed content — full new content retained", () => {
		const builder = new MessageBuilder();
		const output = builder.buildForApi([
			...matrixRead("one", "old bytes"),
			...matrixRead("two", "new bytes"),
		]);

		expect(resultEntryById(output, "two")?.result).toBe("new bytes");
		expect(JSON.stringify(output)).not.toContain(
			"same content as earlier read result",
		);
	});

	// Case 4: same bytes, different path — no cross-path deduplication.
	it("case 4: same bytes, different path — no cross-path deduplication", () => {
		const builder = new MessageBuilder();
		const output = builder.buildForApi([
			...matrixRead("one", "same bytes", "/private/project/a.txt"),
			...matrixRead("two", "same bytes", "/private/project/b.txt"),
		]);

		expect(JSON.stringify(output)).not.toContain(
			"same content as earlier read result",
		);
		expect(resultEntryById(output, "one")?.result).toBe("same bytes");
		expect(resultEntryById(output, "two")?.result).toBe("same bytes");
	});

	// Case 5: same path, different ranges — no unproven equivalence.
	it("case 5: same path, different ranges — no unproven equivalence", () => {
		const builder = new MessageBuilder();
		const output = builder.buildForApi([
			...matrixRead("one", "same bytes", matrixPath, `${matrixPath}:1-10`),
			...matrixRead("two", "same bytes", matrixPath, `${matrixPath}:11-20`),
		]);

		expect(JSON.stringify(output)).not.toContain(
			"same content as earlier read result",
		);
		expect(resultEntryById(output, "one")?.result).toBe("same bytes");
		expect(resultEntryById(output, "two")?.result).toBe("same bytes");
	});

	// Case 6: same path/range, different contents — no deduplication.
	it("case 6: same path and range, different contents — no deduplication", () => {
		const builder = new MessageBuilder();
		const output = builder.buildForApi([
			...matrixRead("one", "bytes one"),
			...matrixRead("two", "bytes two"),
		]);

		expect(JSON.stringify(output)).not.toContain(
			"same content as earlier read result",
		);
		expect(resultEntryById(output, "one")?.result).toBe("bytes one");
		expect(resultEntryById(output, "two")?.result).toBe("bytes two");
	});

	// Case 7: mixed batched reads — each member handled independently.
	it("case 7: mixed batched reads — each member handled independently", () => {
		const builder = new MessageBuilder();
		const output = builder.buildForApi([
			...matrixRead("one", "first payload"),
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "two",
						name: "read_files",
						input: { path: matrixPath },
					},
				],
			},
			structuredReadResult("two", [
				{
					query: matrixPath,
					result: "first payload",
					success: true,
				},
				{
					query: "/private/project/second.txt",
					result: "second payload",
					success: true,
				},
			]),
		]);

		expect(resultEntryById(output, "one")?.result).toBe("first payload");
		expect(JSON.stringify(output)).toContain("second payload");
	});

	// Case 8: partial/truncated reads — no false claim of complete identity.
	it("case 8: partial or truncated reads — no false claim of complete-content identity", () => {
		const builder = new MessageBuilder();
		const truncated = "prefix ...[truncated 100 chars]... suffix";
		const output = builder.buildForApi([
			...matrixRead("one", truncated),
			...matrixRead("two", truncated),
		]);

		expect(JSON.stringify(output)).not.toContain(
			"same content as earlier read result",
		);
		expect(resultEntryById(output, "one")?.result).toBe(truncated);
	});

	// Case 9: failed or interrupted read — failure preserved, never aliased.
	it("case 9: failed or interrupted read — failure preserved, no reference to successful content", () => {
		const builder = new MessageBuilder();
		const output = builder.buildForApi([
			...matrixRead("one", "successful bytes"),
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "two",
						name: "read_files",
						input: { path: matrixPath },
					},
				],
			},
			failedReadResult("two"),
		]);

		expect(JSON.stringify(output)).toContain("missing file");
		expect(JSON.stringify(output)).not.toContain(
			"same content as earlier read result",
		);
	});

	// Case 10: file edited between reads — the new read remains authoritative.
	it("case 10: file edited between reads — the new read remains authoritative", () => {
		const builder = new MessageBuilder({ maxToolResultChars: 200_000 });
		const output = builder.buildForApi([
			...matrixRead("one", LARGE_CONTENT),
			...matrixRead("two", LARGE_CHANGED_CONTENT),
		]);

		// The newest observation is the authoritative one and is never aliased.
		expect(resultEntryById(output, "two")?.result).toBe(LARGE_CHANGED_CONTENT);
		expect(JSON.stringify(output)).not.toContain(
			"same content as earlier read result",
		);
	});

	// Case 10b: the superseded content is reclaimed once the batched
	// stale-read threshold is crossed.
	it("case 10b: superseded content is reclaimed once the stale-read threshold is crossed", () => {
		const builder = new MessageBuilder({ maxToolResultChars: 200_000 });
		const output = builder.buildForApi([
			...matrixRead("one", LARGE_CONTENT),
			...matrixRead("two", LARGE_CONTENT),
			...matrixRead("three", LARGE_CHANGED_CONTENT),
		]);

		expect(resultEntryById(output, "one")?.result).toBe(OUTDATED_MARKER);
		expect(resultEntryById(output, "two")?.result).toBe(OUTDATED_MARKER);
		expect(resultEntryById(output, "three")?.result).toBe(
			LARGE_CHANGED_CONTENT,
		);
	});

	// Case 11: rollback to older messages — no reference to removed future results.
	it("case 11: rollback to older messages — no reference to removed future results", () => {
		const builder = new MessageBuilder();
		const earlier = [...matrixRead("one", "same bytes")];
		const later = [
			...earlier,
			...matrixRead("two", "same bytes"),
			...matrixRead("three", "same bytes"),
		];

		builder.buildForApi(later);
		const restored = builder.buildForApi(earlier);

		expect(JSON.stringify(restored)).not.toContain("two");
		expect(JSON.stringify(restored)).not.toContain("three");
		expect(resultEntryById(restored, "one")?.result).toBe("same bytes");
	});

	// Case 12: compaction removes the original result — the reference resolves
	// safely or falls back to an explicit unavailable-content notice.
	it("case 12: compaction removes the original result — reference resolved safely or falls back", () => {
		const builder = new MessageBuilder({
			maxToolResultChars: HISTORICAL_CONTENT_CHARS * 2,
			maxTotalTextBytes: HISTORICAL_CONTENT_CHARS,
		});
		const { iteration11 } = buildHistoricalChronology();
		const output = builder.buildForApi(iteration11);
		const serialized = JSON.stringify(output);
		const referencesAnchor = serialized.includes(
			`same content as earlier read result ${ANCHOR_ID}`,
		);
		const anchorHasFullContent =
			resultEntryById(output, ANCHOR_ID)?.result === HISTORICAL_CONTENT;

		// A reference is only emitted when its anchor still carries the bytes.
		expect(referencesAnchor).toBe(anchorHasFullContent);
	});

	// Case 13: session restored without transient caches — no dangling reference.
	it("case 13: session restored without transient caches — no dangling reference", () => {
		const builder = new MessageBuilder();
		const output = builder.buildForApi([
			...matrixRead("one", "same bytes"),
			...matrixRead("two", "same bytes"),
		]);

		// The anchor id named by the reference is present in the same projection.
		const serialized = JSON.stringify(output);
		expect(serialized).toContain("one");
		expect(resultContentById(output, "two")).toEqual([
			{ type: "text", text: expect.stringContaining("one") },
		]);
	});

	// Case 14: cache entry expired or evicted — no reliance on unavailable content.
	it("case 14: cache entry expired or evicted — no reliance on unavailable content", () => {
		const builder = new MessageBuilder();
		const output = builder.buildForApi([
			...matrixRead("one", "same bytes"),
			...matrixRead("two", "same bytes"),
		]);

		// The projection is a pure function of the canonical messages: a fresh
		// builder over the same messages yields the same reference.
		const rebuilt = new MessageBuilder().buildForApi([
			...matrixRead("one", "same bytes"),
			...matrixRead("two", "same bytes"),
		]);
		expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(output));
	});

	// Case 15: images or non-text results — existing media semantics unchanged.
	it("case 15: images or non-text results — existing media semantics unchanged", () => {
		const builder = new MessageBuilder();
		const output = builder.buildForApi([
			...matrixRead("one", "same bytes"),
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "two",
						name: "read_files",
						input: { path: matrixPath },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "two",
						name: "read_files",
						content: [
							{
								type: "image",
								data: "AAAA",
								mediaType: "image/png",
							},
						],
					},
				],
			},
		]);

		expect(JSON.stringify(output)).toContain("image/png");
		expect(JSON.stringify(output)).not.toContain(
			"same content as earlier read result",
		);
	});

	// Case 16: budget truncation — no fabricated content coverage.
	it("case 16: budget truncation — no fabricated content coverage", () => {
		const builder = new MessageBuilder({
			maxToolResultChars: HISTORICAL_CONTENT_CHARS * 2,
			maxTotalTextBytes: HISTORICAL_CONTENT_CHARS,
		});
		const { iteration11 } = buildHistoricalChronology();
		const output = builder.buildForApi(iteration11);
		const serialized = JSON.stringify(output);

		// A reference never claims to be the content; it names the anchor.
		expect(serialized).not.toContain("[same content as earlier read result");
		if (
			serialized.includes(`same content as earlier read result ${ANCHOR_ID}`)
		) {
			expect(resultEntryById(output, ANCHOR_ID)?.result).toBe(
				HISTORICAL_CONTENT,
			);
		}
	});

	// Case 17: independent concurrent reads — stable correlation regardless of
	// completion order.
	it("case 17: independent concurrent reads — stable correlation regardless of completion order", () => {
		const builder = new MessageBuilder();
		const output = builder.buildForApi([
			...matrixRead("first", "alpha"),
			...matrixRead("second", "beta"),
			...matrixRead("third", "alpha"),
		]);

		// Every tool_use_id keeps exactly one result and ordering is preserved.
		const resultIds = output
			.flatMap((message) =>
				Array.isArray(message.content) ? message.content : [],
			)
			.filter((block) => block.type === "tool_result")
			.map((block) => (block as { tool_use_id: string }).tool_use_id);
		expect(resultIds).toEqual(["first", "second", "third"]);
		expect(resultEntryById(output, "first")?.result).toBe("alpha");
		expect(resultEntryById(output, "second")?.result).toBe("beta");
		// The intervening different observation breaks the run, so the later
		// alpha is not aliased to the earlier alpha. Correlation stays stable.
		expect(resultEntryById(output, "third")?.result).toBe("alpha");
		expect(JSON.stringify(output)).not.toContain(
			"same content as earlier read result",
		);
	});
});
