/**
 * ACT-CLINEMM-PCK-EXACT-HEAD-PACKAGING-01 — C1 bounded P1 preflight.
 *
 * P1 — THE EXECUTION-AUTHORITY PREFLIGHT.
 *
 * ============================================================================
 * THE CONCERN
 * ============================================================================
 *
 * CORRECTION02 derives the command classification of a canonical tool
 * event from the call's OWN declared input, walking a set of keys:
 *
 *   command, commands, query, script, path, file_path, filePath
 *
 * The review flagged this as "broader than an authoritative
 * executable-command boundary" and required that the classified value be
 * "an executable command, not merely a string found somewhere in the
 * tool input".
 *
 * ============================================================================
 * THE PRODUCTION SCHEMA (INSPECTED, NOT ASSUMED)
 * ============================================================================
 *
 * `sdk/packages/core/src/extensions/tools/schemas.ts`
 *
 *   run_commands  -> RunCommandsInputSchema
 *                      { commands: string[], notifyOnCompletion?: boolean }
 *                    .strict()
 *                    The CANONICAL executable-bearing field is `commands`,
 *                    an ARRAY of complete shell command strings.
 *
 *   The lenient union additionally accepts `{command}`, `{cmd}`, a bare
 *   array and a bare string, and `normalizeRunCommandsToolInput()`
 *   canonicalises the confirmed Flint shape `{command: "<JSON array>"}`
 *   into `{commands: [...]}` BEFORE schema validation.
 *
 *   read_files   -> ReadFilesInputSchema
 *                      { files: ReadFileRequest[] }
 *                    where a request carries `path` (and the tolerant
 *                    aliases `file_path` / `filePath`).
 *
 *                    THERE IS NO EXECUTABLE COMMAND IN A READ REQUEST.
 *                    `path` names a FILE. It is metadata.
 *
 * `sdk/packages/core/src/extensions/context/evidence-continuity.test.ts`
 * confirms the canonical history shape used by the production fixtures:
 *
 *   toolCall("call_a", "run_commands", { commands: ["helm template"] })
 *
 * ============================================================================
 * THE DEFECT THIS WITNESS DISCRIMINATES
 * ============================================================================
 *
 * Because the key walk includes `path`, `file_path` and `filePath`, a
 * `read_files` call whose PATH happens to be the string "make build"
 * would be classified as a BUILD INVOCATION. A file named `make build`
 * is not a command, and a command is not inferred from a path.
 *
 * The same over-broad walk admits `query` and `script`, neither of which
 * is an authoritative executable-command field of the production
 * `run_commands` schema.
 *
 * ============================================================================
 * THE EXPECTED OUTCOME
 * ============================================================================
 *
 * Against the CORRECTED implementation this suite PASSES. Against the
 * CORRECTION02 implementation it FAILS, and that failure IS the RED.
 */

import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	collectCanonicalToolEvents,
	interpretCanonicalEvidence,
} from "./evidence";
import { gateClosedProposals } from "./publication-gate";

/**
 * Build a canonical history whose ONLY tool event is one tool call.
 */
function history(input: {
	readonly toolCallId: string;
	readonly toolName: string;
	readonly callInput: unknown;
	readonly result?: string;
	readonly success?: boolean;
}): readonly MessageWithMetadata[] {
	return [
		{
			role: "assistant",
			id: "msg_call",
			content: [
				{
					type: "tool_use",
					id: input.toolCallId,
					name: input.toolName,
					input: input.callInput,
				},
			],
		},
		{
			role: "user",
			id: "msg_result",
			content: [
				{
					type: "tool_result",
					tool_use_id: input.toolCallId,
					content: [
						{
							query: "synthetic",
							result: input.result ?? "ok",
							success: input.success ?? true,
						},
					],
				},
			],
		},
	] as never as MessageWithMetadata[];
}

describe("ACT-CLINEMM-PCK-EXACT-HEAD-PACKAGING-01 — C1 execution authority preflight", () => {
	it("P1.1: the PRODUCTION run_commands shape {commands:[...]} IS classified", () => {
		// THE POSITIVE WITNESS, USING THE REAL CANONICAL INPUT SHAPE.
		//
		// The production schema's executable-bearing field is `commands`,
		// an array of complete shell command strings. This is the shape
		// the production fixtures use.
		const events = collectCanonicalToolEvents(
			history({
				toolCallId: "tool_call_real",
				toolName: "run_commands",
				callInput: { commands: ["make build"] },
			}),
		);
		expect(events.length).toBe(1);
		expect(events[0].commandClassifications).toContain("make build");
	});

	it("P1.2: the PRODUCTION run_commands shape {commands:[...]} DOES reach tool_observed", () => {
		const messages = history({
			toolCallId: "tool_call_real",
			toolName: "run_commands",
			callInput: { commands: ["make build"] },
			result: "build succeeded",
		});
		expect(
			interpretCanonicalEvidence({
				canonicalMessages: messages,
				references: ["tool_call_real"],
				atom: "OPERATION_ARGUMENT_SET",
				argument: "build",
			}),
		).toBe("tool_observed");
	});

	it("P1.3: a read_files PATH is NOT an executable command", () => {
		// THE NEGATIVE WITNESS.
		//
		// A file named "make build" is not a build invocation. The
		// `read_files` schema carries `files` / `path` / `file_path` /
		// `filePath`, and NONE of them is an executable-command field.
		const events = collectCanonicalToolEvents(
			history({
				toolCallId: "tool_call_read",
				toolName: "read_files",
				callInput: { files: [{ path: "make build" }] },
			}),
		);
		expect(events.length).toBe(1);
		// A read_files call establishes NO command classification.
		expect(events[0].commandClassifications).toEqual([]);
	});

	it("P1.4: a read_files PATH does NOT establish a build invocation", () => {
		const messages = history({
			toolCallId: "tool_call_read",
			toolName: "read_files",
			callInput: { files: [{ path: "make build" }] },
			result: "file content",
		});
		expect(
			interpretCanonicalEvidence({
				canonicalMessages: messages,
				references: ["tool_call_read"],
				atom: "OPERATION_ARGUMENT_SET",
				argument: "build",
			}),
		).toBe("model_reported");
	});

	it("P1.5: the file_path / filePath aliases are ALSO not commands", () => {
		for (const alias of ["file_path", "filePath"]) {
			const events = collectCanonicalToolEvents(
				history({
					toolCallId: "tool_call_read",
					toolName: "read_files",
					callInput: { files: [{ [alias]: "make build" }] },
				}),
			);
			expect(events[0].commandClassifications).toEqual([]);
		}
	});

	it("P1.6: an unrelated METADATA string does NOT establish a build invocation", () => {
		// The `query` and `script` keys are not authoritative
		// executable-command fields of the production `run_commands`
		// schema, so a metadata string under them establishes nothing.
		for (const key of ["query", "script", "path"]) {
			const messages = history({
				toolCallId: "tool_call_meta",
				toolName: "run_commands",
				callInput: { [key]: "make build" },
				result: "ok",
			});
			expect(
				interpretCanonicalEvidence({
					canonicalMessages: messages,
					references: ["tool_call_meta"],
					atom: "OPERATION_ARGUMENT_SET",
					argument: "build",
				}),
			).toBe("model_reported");
		}
	});

	it("P1.7: a MULTI-command batch is classified per member", () => {
		// The production `commands` field is an array. Every member is an
		// independent command, so the classification set covers them all.
		const events = collectCanonicalToolEvents(
			history({
				toolCallId: "tool_call_batch",
				toolName: "run_commands",
				callInput: { commands: ["make build", "git status"] },
			}),
		);
		expect(events[0].commandClassifications).toContain("make build");
		expect(events[0].commandClassifications).toContain("git status");
	});

	it("P1.8: a batch that does NOT contain the argument does NOT establish it", () => {
		const messages = history({
			toolCallId: "tool_call_batch",
			toolName: "run_commands",
			callInput: { commands: ["git status", "ls -la"] },
			result: "ok",
		});
		expect(
			interpretCanonicalEvidence({
				canonicalMessages: messages,
				references: ["tool_call_batch"],
				atom: "OPERATION_ARGUMENT_SET",
				argument: "build",
			}),
		).toBe("model_reported");
	});

	it("P1.9: the published proposition is limited to INVOCATION, not to artifact creation", () => {
		// The review raised a further semantic boundary: "invoking
		// `make build` does not necessarily establish that a build
		// occurred or that an artifact was produced. GNU Make, for
		// example, supports dry-run execution."
		//
		// The published statement must therefore name the INVOCATION and
		// must NOT claim that a build happened, that an artifact was
		// produced, or that anything was deployed.
		const messages = history({
			toolCallId: "tool_call_make",
			toolName: "run_commands",
			callInput: { commands: ["make build"] },
			result: "make: Nothing to be done for 'build'.",
		});
		const gate = gateClosedProposals({
			proposals: [
				{
					kind: "observation",
					assurance: "tool_observed",
					status: "active",
					atom: "OPERATION_ARGUMENT_SET",
					argument: "build",
					evidenceRefs: ["tool_call_make"],
				},
			],
			evidence: {
				canonicalReferences: ["tool_call_make"],
				maximumAssuranceFor: (references, atom, argument) =>
					interpretCanonicalEvidence({
						canonicalMessages: messages,
						references,
						atom,
						argument,
					}),
			},
			sourcePrefixKey: "preflight",
		});
		expect(gate.records.length).toBe(1);
		const statement = gate.records[0].statement;
		// The statement names the INVOCATION.
		expect(statement).toBe("operation invoked with argument: build");
		// It does NOT claim that a build happened or that an artifact
		// was produced.
		expect(statement).not.toContain("build succeeded");
		expect(statement).not.toContain("artifact");
		expect(statement).not.toContain("deployed");
		expect(statement).not.toContain("completed");
	});
});
