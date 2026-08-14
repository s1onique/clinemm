/**
 * Command Normalizer Parity Tests
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION01
 *
 * These tests verify that the local `normalizeCommandInput` wrapper
 * is compatible with the canonical SDK normalizer's behavior on a
 * fixed set of well-defined inputs.
 *
 * The canonical normalizer is invoked INDIRECTLY via the wrapper
 * (which itself imports it from @cline/core). Each test asserts
 * that the wrapper accepts/rejects the same inputs that the canonical
 * logic would accept/reject, and produces structurally equivalent
 * outputs.
 *
 * "Indirect" means: the wrapper is the single source of truth used
 * by the security boundary. If the wrapper and the canonical
 * normalizer disagree, the wrapper has the final say for the security
 * boundary. The test set below pins the wrapper's behavior to
 * expected canonical normalizer behavior.
 */

import { describe, expect, it } from "bun:test"
import { normalizeCommandInput } from "./command-policy"

describe("normalizer behavior (pinned to canonical)", () => {
	// Each case documents what the canonical normalizer
	// (sdk/packages/core/src/extensions/tools/helpers.ts) does.
	// When the canonical changes, update these tests.

	describe("canonical ACCEPT paths", () => {
		const ACCEPT_CASES: ReadonlyArray<{ name: string; input: unknown; expectedCount: number }> = [
			{ name: "bare string", input: "ls -la", expectedCount: 1 },
			{ name: "single command object", input: { command: "ls -la" }, expectedCount: 1 },
			{
				name: "commands array of objects",
				input: { commands: [{ command: "ls" }, { command: "pwd" }] },
				expectedCount: 2,
			},
			{
				name: "structured command with args",
				input: { command: "rm", args: ["-rf", "/"] },
				expectedCount: 1,
			},
			{ name: "bare string array", input: ["ls", "pwd"], expectedCount: 2 },
			{ name: "legacy cmd field", input: { cmd: "ls" }, expectedCount: 1 },
		]

		for (const c of ACCEPT_CASES) {
			it(`accepts: ${c.name}`, () => {
				const result = normalizeCommandInput(c.input)
				expect(result.ok).toBe(true)
				if (result.ok) {
					expect(result.commands.length).toBe(c.expectedCount)
				}
			})
		}
	})

	describe("canonical REJECT paths (wrapper tightens over canonical)", () => {
		const REJECT_CASES: ReadonlyArray<{ name: string; input: unknown }> = [
			{ name: "null", input: null },
			{ name: "undefined", input: undefined },
			{ name: "number", input: 42 },
			{ name: "boolean", input: true },
			{ name: "empty string", input: "" },
			{ name: "empty array", input: [] },
			{ name: "empty object", input: {} },
			{ name: "object with empty command", input: { command: "" } },
			{ name: "object with empty commands array", input: { commands: [] } },
			{ name: "object with null command", input: { command: null } },
			{ name: "object with number command", input: { command: 42 } },
		]

		for (const c of REJECT_CASES) {
			it(`rejects: ${c.name}`, () => {
				const result = normalizeCommandInput(c.input)
				// The wrapper MUST reject these for the security boundary.
				expect(result.ok).toBe(false)
			})
		}
	})

	describe("production usage shapes", () => {
		it("accepts the exact shape produced by execute_command error response", () => {
			// The error response example from core/prompts/responses.ts uses:
			//   <execute_command>
			//     <command>cd /path && python -m pytest tests/</command>
			//     <requires_approval>false</requires_approval>
			//   </execute_command>
			// which serializes to:
			const input = {
				command: "cd /path && python -m pytest tests/",
				requires_approval: false,
			}
			const result = normalizeCommandInput(input)
			expect(result.ok).toBe(true)
			if (result.ok) {
				expect(result.commands[0]).toBe("cd /path && python -m pytest tests/")
			}
		})
	})
})
