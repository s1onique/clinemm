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
 * private source: 47,253 characters in a structured successful read result.
 */
const HISTORICAL_CONTENT = `${"  1 | fixture line\n".repeat(3_397)}tail`;
const HISTORICAL_CONTENT_CHARS = HISTORICAL_CONTENT.length;

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

describe("MessageBuilder duplicate read-result projection", () => {
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
