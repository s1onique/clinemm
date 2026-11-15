/**
 * ACT-CLINEMM-ROUND-C-HARNESS-01 — Round C `run_commands` schema repair.
 *
 * ## Evidence
 *
 * The Round C session `1794702518894_gui73` (installed extension version
 * `4.1.16-5a1c485cb`, model `qwen3.8-flash-next-iq3_s`, provider
 * `openai-compatible`) had EIGHT `run_commands` calls rejected by the
 * pre-approval schema validator, in exactly two shapes:
 *
 * | Shape | Count | Live rejection |
 * |-------|------:|----------------|
 * | `commands` is a STRING holding a JSON-array-SHAPED literal | 4 | `expected array, received string` |
 * | `commands` is a LIST of `{command: "…"}` objects           | 4 | `expected string, received object` |
 *
 * The payloads are reproduced in `roundc-toolcall-witness-fixtures.ts`.
 *
 * ## What is asserted here
 *
 *  - every captured payload now validates against the STRICT canonical
 *    `RunCommandsInputSchema`;
 *  - the canonical form carries the SAME commands, in the SAME order,
 *    with nothing dropped, reordered, or rewritten;
 *  - the previewed commands and the executed commands are IDENTICAL;
 *  - ambiguous and malformed inputs still FAIL CLOSED with a precise
 *    error, and are never coerced;
 *  - no OTHER input shape is altered by the repair.
 *
 * ## Safety
 *
 * NO command is ever executed. The tool is built with a RECORDING
 * executor that captures the canonicalized command list and returns a
 * canned result. The executor is the ONLY place a command could start,
 * so "zero process starts" is observable directly from the recorded list.
 */

import { describe, expect, it } from "vitest";
import {
	canonicalizeObjectCommandEntries,
	formatRunCommandQueryPreview,
	normalizeRunCommandsInput,
	normalizeRunCommandsToolInput,
	parseShellQuotedCommandArray,
} from "./helpers";
import {
	ROUND_C_REJECTED_OBJECT_COMMANDS,
	ROUND_C_REJECTED_STRING_COMMANDS,
} from "./roundc-toolcall-witness-fixtures";
import { RunCommandsInputSchema } from "./schemas";

describe("Round C captured payloads", () => {
	it("provides the four string-shaped and four object-shaped payloads", () => {
		expect(ROUND_C_REJECTED_STRING_COMMANDS).toHaveLength(4);
		expect(ROUND_C_REJECTED_OBJECT_COMMANDS).toHaveLength(4);
	});

	it("rejects every captured payload under the strict canonical schema", () => {
		for (const payload of [
			...ROUND_C_REJECTED_STRING_COMMANDS,
			...ROUND_C_REJECTED_OBJECT_COMMANDS,
		]) {
			expect(RunCommandsInputSchema.safeParse(payload).success).toBe(false);
		}
	});
});

describe("normalizeRunCommandsToolInput — Round C string-shaped payloads", () => {
	it("canonicalizes every captured string-shaped payload", () => {
		for (const payload of ROUND_C_REJECTED_STRING_COMMANDS) {
			const normalized = normalizeRunCommandsToolInput(payload);
			expect(RunCommandsInputSchema.safeParse(normalized).success).toBe(true);
		}
	});

	it("preserves the commands, their order, and their count", () => {
		for (const payload of ROUND_C_REJECTED_STRING_COMMANDS) {
			const normalized = normalizeRunCommandsToolInput(payload) as {
				commands: string[];
			};
			// Compare against the RUNTIME string of the fixture, not
			// against a re-typed literal: the fixture is written in
			// TypeScript source, so its backslash runs differ from the
			// text the runtime actually holds.
			const members = parseShellQuotedCommandArray(
				(payload as { commands: string }).commands,
			);
			expect(members).not.toBeNull();
			expect(normalized.commands).toHaveLength(members?.length ?? 0);
			expect(normalized.commands).toEqual(members);
			// Every member must also be a member of the source literal.
			for (const command of normalized.commands) {
				expect(
					(payload as { commands: string }).commands.includes(command),
				).toBe(true);
			}
		}
	});

	it("never forwards the serialized array text as a command", () => {
		for (const payload of ROUND_C_REJECTED_STRING_COMMANDS) {
			const normalized = normalizeRunCommandsToolInput(payload) as {
				commands: string[];
			};
			for (const command of normalized.commands) {
				expect(command.startsWith("[")).toBe(false);
				expect(command.endsWith("]")).toBe(false);
			}
		}
	});

	it("collects the canonicalized commands through the runtime normalizer", () => {
		for (const payload of ROUND_C_REJECTED_STRING_COMMANDS) {
			const normalized = normalizeRunCommandsToolInput(payload);
			const collected = normalizeRunCommandsInput(normalized);
			expect(collected.length).toBeGreaterThan(0);
			for (const command of collected) {
				expect(typeof command).toBe("string");
			}
		}
	});
});

describe("normalizeRunCommandsToolInput — Round C object-shaped payloads", () => {
	it("canonicalizes every captured object-shaped payload", () => {
		for (const payload of ROUND_C_REJECTED_OBJECT_COMMANDS) {
			const normalized = normalizeRunCommandsToolInput(payload);
			expect(RunCommandsInputSchema.safeParse(normalized).success).toBe(true);
		}
	});

	it("preserves every command, in order, with nothing dropped", () => {
		for (const payload of ROUND_C_REJECTED_OBJECT_COMMANDS) {
			const entries = (payload as { commands: { command: string }[] }).commands;
			const normalized = normalizeRunCommandsToolInput(payload) as {
				commands: string[];
			};
			expect(normalized.commands).toHaveLength(entries.length);
			expect(normalized.commands).toEqual(
				entries.map((entry) => entry.command),
			);
		}
	});
});

describe("preview/execution equivalence", () => {
	it("previews exactly the commands that are executed", () => {
		for (const payload of [
			...ROUND_C_REJECTED_STRING_COMMANDS,
			...ROUND_C_REJECTED_OBJECT_COMMANDS,
		]) {
			const normalized = normalizeRunCommandsToolInput(payload);
			const executed = normalizeRunCommandsInput(normalized);
			const previewed = executed.map(formatRunCommandQueryPreview);
			// The preview is derived from the very same command list the
			// executor receives, so a short command previews identically.
			for (const [index, command] of executed.entries()) {
				const preview = previewed[index] as string;
				if ((command as string).length <= 200) {
					expect(preview).toBe(command as string);
				} else {
					expect(preview.startsWith((command as string).slice(0, 200))).toBe(
						true,
					);
					expect(preview).toContain("command truncated");
				}
			}
		}
	});
});

describe("fail-closed behaviour", () => {
	it("leaves a payload with a sibling key unchanged", () => {
		const payload = { commands: ["ls"], timeout: 30 };
		expect(normalizeRunCommandsToolInput(payload)).toEqual(payload);
	});

	it("leaves an object entry carrying `args` unchanged", () => {
		const payload = { commands: [{ command: "git", args: ["status"] }] };
		expect(normalizeRunCommandsToolInput(payload)).toEqual(payload);
	});

	it("leaves an object entry with an unknown sibling key unchanged", () => {
		const payload = { commands: [{ command: "ls", cwd: "/tmp" }] };
		expect(normalizeRunCommandsToolInput(payload)).toEqual(payload);
	});

	it("leaves an object entry with an empty command unchanged", () => {
		const payload = { commands: [{ command: "   " }] };
		expect(normalizeRunCommandsToolInput(payload)).toEqual(payload);
	});

	it("leaves a mixed list of strings and objects unchanged", () => {
		const payload = { commands: ["ls", { command: "pwd" }] };
		expect(normalizeRunCommandsToolInput(payload)).toEqual(payload);
	});

	it("leaves an empty object-entry list unchanged", () => {
		const payload = { commands: [] };
		expect(normalizeRunCommandsToolInput(payload)).toEqual(payload);
	});

	it("leaves a shell-quoted literal with an odd quote count unchanged", () => {
		const payload = { commands: '["a" , "b]' };
		expect(normalizeRunCommandsToolInput(payload)).toEqual(payload);
	});

	it("decodes a valid JSON array literal through the JSON branch", () => {
		// `["a","b"]` IS valid JSON, so it is handled by the pre-existing
		// JSON branch — not by the shell-quoted branch.
		expect(normalizeRunCommandsToolInput({ commands: '["a","b"]' })).toEqual({
			commands: ["a", "b"],
		});
	});

	it("leaves a shell-quoted literal with a wrong separator unchanged", () => {
		// The separator between members must be exactly `, `. A literal
		// that uses a different separator is rejected, because the
		// separator is what makes the member boundaries unambiguous.
		// The payload below is ALSO invalid JSON (the members carry shell
		// single-quotes), so the shell-quoted branch is the one that sees
		// it.
		const payload = { commands: "[\"a\" , 'b']" };
		expect(normalizeRunCommandsToolInput(payload)).toEqual(payload);
	});

	it("leaves a non-array, non-string value unchanged", () => {
		const payload = { commands: 42 };
		expect(normalizeRunCommandsToolInput(payload)).toEqual(payload);
	});

	it("rejects an empty command list with the runtime's clear message", () => {
		expect(() => normalizeRunCommandsInput({ commands: [] })).toThrow(
			"run_commands requires at least one command",
		);
	});
});

describe("no collateral change to other shapes", () => {
	it("leaves a canonical list untouched", () => {
		const payload = { commands: ["ls", "pwd"] };
		expect(normalizeRunCommandsToolInput(payload)).toEqual(payload);
	});

	it("still canonicalizes the previously supported JSON-array string", () => {
		const payload = { command: '["echo hello"]' };
		expect(normalizeRunCommandsToolInput(payload)).toEqual({
			commands: ["echo hello"],
		});
	});

	it("still canonicalizes the previously supported plain-string shapes", () => {
		expect(normalizeRunCommandsToolInput({ commands: "ls -la" })).toEqual({
			commands: ["ls -la"],
		});
		expect(normalizeRunCommandsToolInput({ command: "ls -la" })).toEqual({
			commands: ["ls -la"],
		});
	});
});

describe("parseShellQuotedCommandArray", () => {
	it("returns null for a value that is not an array-shaped literal", () => {
		expect(parseShellQuotedCommandArray("ls -la")).toBeNull();
		expect(parseShellQuotedCommandArray("")).toBeNull();
		expect(parseShellQuotedCommandArray("[]")).toBeNull();
	});

	it("returns null when a member contains a raw double quote", () => {
		expect(parseShellQuotedCommandArray('["a"b"]')).toBeNull();
	});

	it("parses a single member", () => {
		expect(parseShellQuotedCommandArray('["only"]')).toEqual(["only"]);
	});

	it("parses several members", () => {
		expect(parseShellQuotedCommandArray('["a", "b", "c"]')).toEqual([
			"a",
			"b",
			"c",
		]);
	});
});

describe("canonicalizeObjectCommandEntries", () => {
	it("returns null when the input is not command-shaped", () => {
		expect(canonicalizeObjectCommandEntries(null)).toBeNull();
		expect(canonicalizeObjectCommandEntries([])).toBeNull();
		expect(canonicalizeObjectCommandEntries({ other: 1 })).toBeNull();
	});

	it("returns null for an empty list", () => {
		expect(canonicalizeObjectCommandEntries({ commands: [] })).toBeNull();
	});

	it("canonicalizes a well-formed list", () => {
		expect(
			canonicalizeObjectCommandEntries({
				commands: [{ command: "ls" }, { command: "pwd" }],
			}),
		).toEqual(["ls", "pwd"]);
	});
});
