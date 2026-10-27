import { describe, expect, it } from "vitest";
import {
	categorizeTraceTool,
	classifyEvidenceBoundary,
	describeEditRequest,
	MODEL_BEHAVIOR_TRACE_MAX_BYTES,
	MODEL_BEHAVIOR_TRACE_MAX_RECORDS,
	ModelBehaviorTraceRecorder,
	normalizeTraceArguments,
	sanitizePayload,
} from "./model-behavior-trace";

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01 — focused recorder witnesses.
 *
 * Gates covered here:
 *   T01  Default OFF produces no records.
 *   T02  Runtime toggle works without session recreation.
 *   T05  Non-consecutive repeated actions remain detectable.
 *   T06  Expected retries remain distinguishable from model repetition.
 *   T11  Dump is bounded, parseable and reports truncation.
 *   T12  Sensitive content is not recorded.
 */

function makeRecorder(
	overrides: Partial<
		ConstructorParameters<typeof ModelBehaviorTraceRecorder>[0]
	> = {},
) {
	return new ModelBehaviorTraceRecorder({
		traceId: "trace-test",
		fingerprintKey: "test-key",
		now: () => 1_700_000_000_000,
		...overrides,
	});
}

describe("ModelBehaviorTraceRecorder", () => {
	it("T01: default OFF produces no records", () => {
		const recorder = makeRecorder();
		expect(recorder.isEnabled()).toBe(false);
		const record = recorder.record("model_request_start", { sessionId: "s1" });
		expect(record).toBeUndefined();
		expect(recorder.getRecordCount()).toBe(0);
		expect(recorder.dump().records).toHaveLength(0);
	});

	it("T02: runtime toggle works without session recreation", () => {
		const recorder = makeRecorder();
		// Before the toggle: nothing is captured.
		recorder.record("model_request_start", { sessionId: "s1" });
		expect(recorder.getRecordCount()).toBe(0);

		// Toggle ON at runtime — no new recorder, no session recreation.
		recorder.setEnabled(true);
		const captured = recorder.record("model_request_start", {
			sessionId: "s1",
		});
		expect(captured).toBeDefined();
		expect(recorder.getRecordCount()).toBe(1);

		// Toggle OFF again: subsequent events are not captured, but the
		// previously captured evidence survives for the dump.
		recorder.setEnabled(false);
		recorder.record("model_request_start", { sessionId: "s1" });
		expect(recorder.getRecordCount()).toBe(1);
		expect(recorder.dump().records).toHaveLength(1);
	});

	it("T05: non-consecutive repeated actions remain detectable", async () => {
		const recorder = makeRecorder();
		recorder.setEnabled(true);

		const fingerprintA = await recorder.fingerprintArguments("read_file", {
			path: "/a.ts",
		});
		const fingerprintB = await recorder.fingerprintArguments("read_file", {
			path: "/b.ts",
		});
		const fingerprintAAgain = await recorder.fingerprintArguments("read_file", {
			path: "/a.ts",
		});
		expect(fingerprintA?.fingerprint).toBe(fingerprintAAgain?.fingerprint);
		expect(fingerprintA?.fingerprint).not.toBe(fingerprintB?.fingerprint);

		// A → B → A is a NON-consecutive repetition: the same action is
		// revisited after other work happened in between.
		recorder.record(
			"tool_start",
			{ runId: "r1" },
			{
				toolName: "read_file",
				argumentFingerprint: fingerprintA?.fingerprint,
			},
		);
		recorder.record(
			"tool_start",
			{ runId: "r1" },
			{
				toolName: "read_file",
				argumentFingerprint: fingerprintB?.fingerprint,
			},
		);
		recorder.record(
			"tool_start",
			{ runId: "r1" },
			{
				toolName: "read_file",
				argumentFingerprint: fingerprintAAgain?.fingerprint,
			},
		);

		const records = recorder.getRecords();
		expect(records).toHaveLength(3);
		// The third action repeats the first, but is NOT adjacent to it.
		expect(records[2]?.payload.argumentFingerprint).toBe(
			records[0]?.payload.argumentFingerprint,
		);
		expect(records[2]?.seq).toBeGreaterThan(records[1]?.seq ?? 0);
	});

	it("T06: expected retries remain distinguishable from model repetition", () => {
		const recorder = makeRecorder();
		recorder.setEnabled(true);

		// An expected retry: the SAME action fails and is retried.
		recorder.record(
			"tool_start",
			{ runId: "r1", iteration: 1 },
			{
				toolName: "run_tests",
				argumentFingerprint: "fp-tests",
			},
		);
		recorder.record(
			"tool_finish",
			{ runId: "r1", iteration: 1 },
			{
				toolName: "run_tests",
				argumentFingerprint: "fp-tests",
				outcome: "error",
				errorClassification: "transient",
			},
		);
		// The retry succeeds.
		recorder.record(
			"tool_start",
			{ runId: "r1", iteration: 2 },
			{
				toolName: "run_tests",
				argumentFingerprint: "fp-tests",
			},
		);
		recorder.record(
			"tool_finish",
			{ runId: "r1", iteration: 2 },
			{
				toolName: "run_tests",
				argumentFingerprint: "fp-tests",
				outcome: "success",
			},
		);

		const finishes = recorder
			.getRecords()
			.filter((record) => record.event === "tool_finish");
		// The retry is distinguishable from a model repetition because the
		// outcome differs AND the iteration advanced — the offline analysis
		// reads exactly these two facts.
		expect(finishes[0]?.payload.outcome).toBe("error");
		expect(finishes[1]?.payload.outcome).toBe("success");
		expect(finishes[0]?.iteration).toBe(1);
		expect(finishes[1]?.iteration).toBe(2);
	});

	it("T11: dump is bounded, parseable and reports truncation", () => {
		const recorder = makeRecorder({ maxRecords: 4 });
		recorder.setEnabled(true);
		for (let index = 0; index < 10; index += 1) {
			recorder.record("model_request_start", { sessionId: "s1" }, { index });
		}

		const dump = recorder.dump();
		expect(dump.records).toHaveLength(4);
		expect(dump.truncation.truncated).toBe(true);
		expect(dump.truncation.droppedCount).toBe(6);
		expect(dump.truncation.droppedFromSeq).toBe(1);
		expect(dump.truncation.droppedToSeq).toBe(6);
		expect(dump.truncation.totalRecorded).toBe(10);
		expect(dump.truncation.retainedCount).toBe(4);

		// Every record is JSON-serializable and round-trips.
		for (const record of dump.records) {
			expect(JSON.parse(JSON.stringify(record))).toEqual(record);
		}
	});

	it("T11b: the byte cap bounds the ring independently of the record cap", () => {
		const recorder = makeRecorder({ maxRecords: 10_000, maxBytes: 600 });
		recorder.setEnabled(true);
		for (let index = 0; index < 50; index += 1) {
			recorder.record(
				"model_request_start",
				{ sessionId: "s1" },
				{
					index,
					padding: "x".repeat(32),
				},
			);
		}
		const truncation = recorder.getTruncation();
		expect(truncation.truncated).toBe(true);
		expect(truncation.retainedBytes).toBeLessThanOrEqual(600);
	});

	it("T12: sensitive content is not recorded", () => {
		const recorder = makeRecorder();
		recorder.setEnabled(true);
		const record = recorder.record(
			"tool_start",
			{ sessionId: "s1" },
			{
				toolName: "run_command",
				command: "cat /etc/passwd",
				prompt: "please delete the secrets",
				apiKey: "sk-live-abcdef",
				authorization: "Bearer token",
				stdout: "sensitive output",
				path: "/home/user/private",
				reasoning: "internal thought",
				text: "raw model text",
				output: "raw tool output",
				input: { nested: "raw" },
				env: { AWS_SECRET_ACCESS_KEY: "value" },
				safeField: "kept",
			},
		);
		expect(record).toBeDefined();
		const serialized = JSON.stringify(record);
		// None of the sensitive values may appear anywhere in the record.
		expect(serialized).not.toContain("sk-live-abcdef");
		expect(serialized).not.toContain("cat /etc/passwd");
		expect(serialized).not.toContain("please delete the secrets");
		expect(serialized).not.toContain("Bearer token");
		expect(serialized).not.toContain("sensitive output");
		expect(serialized).not.toContain("/home/user/private");
		expect(serialized).not.toContain("internal thought");
		expect(serialized).not.toContain("raw model text");
		expect(serialized).not.toContain("AWS_SECRET_ACCESS_KEY");
		// The safe field survives.
		expect(record?.payload.safeField).toBe("kept");
	});

	it("T12b: argument normalization preserves shape but not content", () => {
		const normalized = normalizeTraceArguments({
			path: "/very/long/path/that/should/not/be/recoverable.ts",
			count: 42,
			flag: true,
		});
		const serialized = JSON.stringify(normalized);
		expect(serialized).not.toContain("/very/long/path");
		expect(serialized).not.toContain("42");
		expect(serialized).toContain("$type");
	});

	it("T12c: fingerprints are stable within a trace and differ across traces", async () => {
		const first = makeRecorder({ fingerprintKey: "key-one" });
		const second = makeRecorder({ fingerprintKey: "key-two" });
		first.setEnabled(true);
		second.setEnabled(true);

		const a1 = await first.fingerprintArguments("read_file", { path: "/a.ts" });
		const a2 = await first.fingerprintArguments("read_file", { path: "/a.ts" });
		const b1 = await second.fingerprintArguments("read_file", {
			path: "/a.ts",
		});

		expect(a1?.fingerprint).toBe(a2?.fingerprint);
		// A different ephemeral key yields a different fingerprint, so a dump
		// cannot be used as a cross-session rainbow table.
		expect(a1?.fingerprint).not.toBe(b1?.fingerprint);
		// The key itself is never exposed; only a short key id.
		expect(a1?.keyId).not.toContain("key-one");
		expect(a1?.keyId).toMatch(/^k_[0-9a-f]{8}$/);
	});

	it("T12d: evidence boundary classifies missing identities", () => {
		expect(classifyEvidenceBoundary({})).toBe("no_identity");
		expect(classifyEvidenceBoundary({ sessionId: "s" })).toBe(
			"partial_identity",
		);
		expect(
			classifyEvidenceBoundary({ sessionId: "s", taskId: "t", runId: "r" }),
		).toBe("observed");
	});

	it("tool categorization is name-based and model-agnostic", () => {
		expect(categorizeTraceTool("run_tests")).toBe("test");
		expect(categorizeTraceTool("read_file")).toBe("read");
		expect(categorizeTraceTool("search_codebase")).toBe("search");
		expect(categorizeTraceTool("write_file")).toBe("write");
		expect(categorizeTraceTool("execute_command")).toBe("command");
		expect(categorizeTraceTool("some_unknown_tool")).toBe("other");
	});

	it("sanitizePayload drops forbidden keys structurally", () => {
		const sanitized = sanitizePayload({
			toolName: "read_file",
			command: "rm -rf /",
			prompt: "secret",
			count: 3,
		});
		expect(sanitized.toolName).toBe("read_file");
		expect(sanitized.command).toBe("[REDACTED_BY_TRACE_SCHEMA]");
		expect(sanitized.prompt).toBe("[REDACTED_BY_TRACE_SCHEMA]");
		expect(sanitized.count).toBe(3);
	});

	it("exposes the documented default bounds", () => {
		expect(MODEL_BEHAVIOR_TRACE_MAX_RECORDS).toBe(8_192);
		expect(MODEL_BEHAVIOR_TRACE_MAX_BYTES).toBe(4 * 1024 * 1024);
	});
});

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01 — recorder-level
 * witnesses for the edit observation channel.
 *
 * Gates covered here:
 *   EE01  The edit event kinds are recordable and DEFAULT OFF.
 *   EE02  The file/path fingerprints are stable within one capture and
 *         differ across captures.
 *   EE03  The file/content fingerprints are OFF by default.
 *   EE04  A recorded edit attempt never carries a raw path.
 *   EE05  The edit request description is structural, not textual.
 */
describe("ModelBehaviorTraceRecorder — edit observation", () => {
	it("EE01: the edit event kinds are recordable and default OFF", () => {
		const recorder = makeRecorder();
		// OFF: nothing is recorded, not even the edit events.
		expect(
			recorder.record("edit_attempt", {}, { toolName: "editor" }),
		).toBeUndefined();
		expect(
			recorder.record("edit_application", {}, { outcome: "applied" }),
		).toBeUndefined();
		expect(
			recorder.record(
				"edit_failure",
				{},
				{ failureCategory: "text_not_found" },
			),
		).toBeUndefined();
		expect(recorder.getRecordCount()).toBe(0);

		// ON: the events are recorded with the normal correlation identity.
		recorder.setEnabled(true);
		const record = recorder.record(
			"edit_application",
			{ sessionId: "s1", runId: "r1" },
			{
				toolName: "editor",
				outcome: "applied",
				mutatedFileCount: 1,
				unmutatedFileCount: 0,
				noOp: false,
				provenance: "REAL_PRODUCTION_SEAM",
			},
		);
		expect(record).toBeDefined();
		expect(record?.event).toBe("edit_application");
		expect(record?.payload.mutatedFileCount).toBe(1);
		expect(record?.payload.provenance).toBe("REAL_PRODUCTION_SEAM");
	});

	it("EE02: the file fingerprint is stable within a capture and differs across captures", async () => {
		const first = makeRecorder({ fingerprintKey: "key-one" });
		const second = makeRecorder({ fingerprintKey: "key-two" });
		first.setEnabled(true);
		second.setEnabled(true);

		const a1 = await first.fingerprintFilePath("/workspace/src/a.ts");
		const a2 = await first.fingerprintFilePath("/workspace/src/a.ts");
		const b1 = await second.fingerprintFilePath("/workspace/src/a.ts");

		expect(a1).toBeDefined();
		expect(a1).toBe(a2);
		// A different ephemeral key yields a different fingerprint, so a dump
		// is not a cross-session rainbow table.
		expect(a1).not.toBe(b1);
		// The raw path NEVER appears in the fingerprint.
		expect(a1).not.toContain("a.ts");
		expect(a1).not.toContain("/workspace");
	});

	it("EE03: the file fingerprints are OFF by default", async () => {
		const recorder = makeRecorder();
		expect(await recorder.fingerprintFilePath("/a.ts")).toBeUndefined();
		expect(await recorder.fingerprintFileContent("secret")).toBeUndefined();
	});

	it("EE04: a recorded edit attempt never carries a raw path", () => {
		const recorder = makeRecorder();
		recorder.setEnabled(true);
		const record = recorder.record(
			"edit_attempt",
			{ sessionId: "s1" },
			{
				toolName: "editor",
				toolCallId: "tc-1",
				operation: "replace",
				// The file identity is an opaque fingerprint.
				fileIdentity: "0123456789abcdef0123456789abcdef",
				targetCount: 1,
				requestedChars: 12,
				approvalOutcome: "approved",
				executionInvoked: true,
			},
		);
		expect(record).toBeDefined();
		const serialized = JSON.stringify(record);
		expect(serialized).not.toContain("/workspace");
		expect(serialized).not.toContain(".ts");
		expect(record?.payload.fileIdentity).toBe(
			"0123456789abcdef0123456789abcdef",
		);
	});

	it("EE05: the edit request description is structural, not textual", () => {
		const editorShape = describeEditRequest("editor", {
			path: "/workspace/src/a.ts",
			old_text: "old",
			new_text: "new",
		});
		expect(editorShape.operation).toBe("replace");
		expect(editorShape.targetCount).toBe(1);
		expect(editorShape.requestedChars).toBe(6);
		expect(editorShape.resolvedPath).toBe("/workspace/src/a.ts");

		const insertShape = describeEditRequest("editor", {
			path: "/a.ts",
			insert_line: 3,
			new_text: "x",
		});
		expect(insertShape.operation).toBe("insert");

		const createShape = describeEditRequest("editor", {
			path: "/a.ts",
			new_text: "x",
		});
		expect(createShape.operation).toBe("create");

		const patchShape = describeEditRequest("apply_patch", {
			input: [
				"*** Update File: a.ts",
				"@@",
				" a",
				"+b",
				"*** Add File: b.ts",
				"+c",
			].join("\n"),
		});
		expect(patchShape.operation).toBe("update");
		expect(patchShape.targetCount).toBe(2);
		expect(patchShape.requestedChars).toBeGreaterThan(0);
	});
});
