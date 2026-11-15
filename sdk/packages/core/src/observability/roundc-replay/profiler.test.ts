/**
 * ACT-CLINEMM-ROUND-C-HARNESS-01 — Phase 1 offline replay profiler tests.
 *
 * ## What is asserted here
 *
 * The suite runs against SYNTHETIC transcripts whose expected metrics are
 * computed by construction (see `synthetic-fixture.ts`). The real Round C
 * session dumps are never committed and never required to run the suite.
 *
 * The Round C BASELINE crosswalk lives in `roundc-baseline.test.ts`, which
 * checks the profiler's definitions against the sanitized baseline's
 * published numbers using a fixture whose metrics are constructed to match.
 */

import { describe, expect, it } from "vitest";
import { summarizeProfile, toDeterministicJson } from "./json-output";
import {
	classifyRunCommandsInput,
	countValidCommandStrings,
	isStrictRunCommandsShape,
	parseTranscript,
	profileTranscript,
} from "./profiler";
import { buildSyntheticFixture } from "./synthetic-fixture";

describe("parseTranscript", () => {
	it("parses a synthetic transcript into the typed model", () => {
		const fixture = buildSyntheticFixture({ turns: 2 });
		const transcript = parseTranscript(fixture.transcript);
		expect(transcript.sessionId).toBe("synthetic-session");
		expect(transcript.origin?.version).toBe("synthetic-0.0.0");
		expect(transcript.messages).toHaveLength(fixture.expected.messageCount);
	});

	it("accepts JSON text as well as an already-parsed document", () => {
		const fixture = buildSyntheticFixture({ turns: 1 });
		const fromText = parseTranscript(JSON.stringify(fixture.transcript));
		const fromObject = parseTranscript(fixture.transcript);
		expect(fromText.messages).toHaveLength(fromObject.messages.length);
	});

	it("degrades to an empty transcript instead of throwing on corrupt input", () => {
		const transcript = parseTranscript("{not json");
		expect(transcript.messages).toHaveLength(0);
		expect(transcript.sessionId).toBe("unknown");
	});

	it("preserves unknown content block types rather than dropping them", () => {
		const transcript = parseTranscript({
			sessionId: "s",
			messages: [
				{ id: "a", role: "assistant", content: [{ type: "brand_new" }] },
			],
		});
		expect(transcript.messages[0]?.content[0]?.type).toBe("unknown");
	});
});

describe("classifyRunCommandsInput", () => {
	it.each([
		["canonical list", { commands: ["ls"] }, "canonical_list"],
		["single string", { commands: '["ls"]' }, "string_commands"],
		["object entries", { commands: [{ command: "ls" }] }, "object_entries"],
		["absent", { other: 1 }, "absent"],
		["non-object", "ls", "other"],
		["array input", ["ls"], "other"],
	])("classifies %s", (_label, input, expected) => {
		expect(classifyRunCommandsInput(input)).toBe(expected);
	});

	it("treats an empty list as the canonical shape", () => {
		expect(classifyRunCommandsInput({ commands: [] })).toBe("canonical_list");
	});
});

describe("countValidCommandStrings", () => {
	it("counts a canonical list", () => {
		expect(countValidCommandStrings({ commands: ["a", "b"] })).toBe(2);
	});

	it("counts zero for a whole-list-serialized string", () => {
		expect(countValidCommandStrings({ commands: '["a","b"]' })).toBe(0);
	});

	it("counts one per object entry", () => {
		expect(
			countValidCommandStrings({
				commands: [{ command: "a" }, { command: "b" }],
			}),
		).toBe(2);
	});

	it("returns null for shapes that carry no command list", () => {
		expect(countValidCommandStrings({ other: 1 })).toBeNull();
	});
});

describe("isStrictRunCommandsShape", () => {
	it("accepts only a list of strings", () => {
		expect(isStrictRunCommandsShape({ commands: ["a"] })).toBe(true);
		expect(isStrictRunCommandsShape({ commands: '["a"]' })).toBe(false);
		expect(isStrictRunCommandsShape({ commands: [{ command: "a" }] })).toBe(
			false,
		);
	});
});

describe("profileTranscript", () => {
	it("reproduces the constructed metrics of a synthetic fixture", () => {
		const fixture = buildSyntheticFixture({ turns: 4, commandsPerTurn: 2 });
		const profile = profileTranscript(parseTranscript(fixture.transcript));

		expect(profile.elapsedMs.value).toBe(fixture.expected.elapsedMs);
		expect(profile.messageCount.value).toBe(fixture.expected.messageCount);
		expect(profile.modelTurns.value).toBe(fixture.expected.modelTurns);
		expect(profile.toolInvocations.value).toBe(
			fixture.expected.toolInvocations,
		);
		expect(profile.validCommandStrings.value).toBe(
			fixture.expected.validCommandStrings,
		);
		expect(profile.intervalMsByKind.model.value).toBe(
			fixture.expected.intervalModelMs,
		);
		expect(profile.intervalMsByKind.tool.value).toBe(
			fixture.expected.intervalToolMs,
		);
		expect(profile.intervalMsByKind.other.value).toBe(
			fixture.expected.intervalOtherMs,
		);
		expect(profile.inputTokens.value).toBe(fixture.expected.inputTokens);
		expect(profile.outputTokens.value).toBe(fixture.expected.outputTokens);
		expect(profile.cacheReadTokens.value).toBe(
			fixture.expected.cacheReadTokens,
		);
	});

	it("separates transcript-reported metrics from profiler-derived metrics", () => {
		const fixture = buildSyntheticFixture({ turns: 1 });
		const profile = profileTranscript(parseTranscript(fixture.transcript));
		expect(profile.inputTokens.provenance).toBe("transcript_reported");
		expect(profile.outputTokens.provenance).toBe("transcript_reported");
		expect(profile.cacheReadTokens.provenance).toBe("transcript_reported");
		expect(profile.elapsedMs.provenance).toBe("profiler_derived");
		expect(profile.messageCount.provenance).toBe("profiler_derived");
		expect(profile.validCommandStrings.provenance).toBe("profiler_derived");
		expect(profile.intervalMsByKind.model.provenance).toBe("profiler_derived");
	});

	it("is deterministic: the same transcript yields the same profile", () => {
		const fixture = buildSyntheticFixture({ turns: 5, commandsPerTurn: 3 });
		const first = profileTranscript(parseTranscript(fixture.transcript));
		const second = profileTranscript(parseTranscript(fixture.transcript));
		expect(toDeterministicJson(first)).toBe(toDeterministicJson(second));
	});

	it("counts a schema rejection and classifies its shape", () => {
		const fixture = buildSyntheticFixture({
			turns: 3,
			shape: "string",
			rejected: true,
		});
		const profile = profileTranscript(parseTranscript(fixture.transcript));
		expect(profile.rejectedCommandSchemaInvocations.value).toBe(3);
		expect(profile.rejectedCommandSchemaByShape.string_commands).toBe(3);
		expect(profile.validCommandStrings.value).toBe(0);
	});

	it("records the rejection message without inventing result items", () => {
		const fixture = buildSyntheticFixture({ turns: 1, rejected: true });
		const profile = profileTranscript(parseTranscript(fixture.transcript));
		const invocation = profile.perToolInvocation[0];
		expect(invocation?.schemaError).toBe(true);
		expect(invocation?.resultItems).toBe(0);
		expect(invocation?.successItems).toBe(0);
		expect(invocation?.failedItems).toBe(0);
		expect(invocation?.schemaErrorMessage).toContain("Invalid input");
	});

	it("counts success and failure of individual result items", () => {
		const fixture = buildSyntheticFixture({ turns: 1, commandsPerTurn: 2 });
		const profile = profileTranscript(parseTranscript(fixture.transcript));
		const invocation = profile.perToolInvocation[0];
		expect(invocation?.resultItems).toBe(2);
		expect(invocation?.successItems).toBe(2);
		expect(invocation?.failedItems).toBe(0);
	});

	it("pairs a tool call with its result by id, not by position", () => {
		const transcript = parseTranscript({
			sessionId: "s",
			messages: [
				{
					id: "a",
					role: "assistant",
					ts: 1000,
					content: [
						{
							type: "tool_use",
							id: "call-1",
							name: "run_commands",
							input: { commands: ["x"] },
						},
						{
							type: "tool_use",
							id: "call-2",
							name: "run_commands",
							input: { commands: ["y"] },
						},
					],
				},
				{
					id: "u",
					role: "user",
					ts: 1100,
					content: [
						{
							type: "tool_result",
							tool_use_id: "call-2",
							content: [{ query: "y", result: "out", success: true }],
						},
						{
							type: "tool_result",
							tool_use_id: "call-1",
							content: [{ query: "x", result: "out", success: false }],
						},
					],
				},
			],
		});
		const profile = profileTranscript(transcript);
		const first = profile.perToolInvocation[0];
		const second = profile.perToolInvocation[1];
		expect(first?.successItems).toBe(0);
		expect(first?.failedItems).toBe(1);
		expect(second?.successItems).toBe(1);
		expect(second?.failedItems).toBe(0);
	});

	it("reports a tool call whose result is missing as producing no items", () => {
		const transcript = parseTranscript({
			sessionId: "s",
			messages: [
				{
					id: "a",
					role: "assistant",
					ts: 1000,
					content: [
						{
							type: "tool_use",
							id: "call-1",
							name: "run_commands",
							input: { commands: ["x"] },
						},
					],
				},
			],
		});
		const profile = profileTranscript(transcript);
		expect(profile.perToolInvocation[0]?.resultItems).toBe(0);
		expect(profile.perToolInvocation[0]?.schemaError).toBe(false);
	});

	it("tolerates a non-finite reported token count", () => {
		const transcript = parseTranscript({
			sessionId: "s",
			messages: [
				{
					id: "a",
					role: "assistant",
					ts: 1000,
					content: [],
					metrics: { inputTokens: Number.NaN, outputTokens: 5 },
				},
			],
		});
		const profile = profileTranscript(transcript);
		expect(profile.inputTokens.value).toBe(0);
		expect(profile.outputTokens.value).toBe(5);
	});
});

describe("summarizeProfile", () => {
	it("produces a stable, provenance-tagged summary", () => {
		const fixture = buildSyntheticFixture({ turns: 2 });
		const profile = profileTranscript(parseTranscript(fixture.transcript));
		const summary = summarizeProfile(profile);
		expect(summary.session_id).toBe("synthetic-session");
		expect(summary.token_provenance).toBe("transcript_reported");
		expect(summary.elapsed_ms_provenance).toBe("profiler_derived");
		expect(toDeterministicJson(summary)).toBe(
			toDeterministicJson(summarizeProfile(profile)),
		);
	});
});
