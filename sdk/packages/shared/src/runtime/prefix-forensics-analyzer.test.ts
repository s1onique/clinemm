/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01.
 *
 * The analyzer's ADVERSARIAL witnesses.
 *
 * These tests establish that the offline analyzer is CORRECT — that it
 * finds a mutation where one exists, does NOT invent one where none
 * exists, and fails CLOSED when the evidence is missing.
 *
 * They establish analyzer CORRECTNESS only. They do NOT establish live
 * causal attribution: the live attribution comes from the captured dogfood
 * records, not from these fixtures.
 *
 * The controls map to the ACT's required adversarial set:
 *
 *   V2  stable continuation      — append-only requests preserve fingerprints
 *   V3  early message mutation   — the change is found at the right boundary
 *   V4  tool schema reorder      — detected independently of definition edits
 *   V5  adapter transformation   — attributed to the adapter, not the runtime
 *   V6  wire distinction         — equal runtime projections ≠ equal wire bodies
 *   V7  retry correlation        — retries stay separate wire attempts
 *   V9  artifact integrity       — missing captures make no fabricated comparison
 *   V10 negative evidence        — the analyzer fails closed
 */
import { describe, expect, it } from "vitest";
import type { PrefixForensicsCaptureRecord } from "./prefix-forensics";
import {
	computeRepresentationFingerprint,
	keyedFingerprintHex,
} from "./prefix-forensics";
import {
	comparePrefixForensicsRequests,
	PREFIX_FORENSICS_STAGES,
	UNAVAILABLE_FROM_TRACE,
} from "./prefix-forensics-analyzer";

const KEY = "test-cohort-key";

/** Build a sanitized capture record for one stage. */
function record(
	stage: string,
	options: {
		messages: unknown[];
		system?: unknown;
		tools?: unknown;
		body?: unknown;
		sessionId?: string;
		preparationRequestId?: string;
		providerAttemptId?: string;
		iteration?: number;
		cohortId?: string;
	},
): PrefixForensicsCaptureRecord {
	const representation = computeRepresentationFingerprint(
		stage,
		options.messages,
		{
			key: KEY,
			...(options.system !== undefined ? { system: options.system } : {}),
			...(options.tools !== undefined ? { tools: options.tools } : {}),
			...(options.body !== undefined ? { body: options.body } : {}),
		},
	);
	const withoutDigest = {
		schemaVersion: 1,
		producer: "@cline/shared/runtime/prefix-forensics",
		capturedAt: "2026-11-20T00:00:00.000Z",
		cohortId: options.cohortId ?? "cohort-1",
		sessionId: options.sessionId ?? "session-1",
		preparationRequestId: options.preparationRequestId ?? "prep-1",
		providerAttemptId: options.providerAttemptId ?? "attempt-1",
		iteration: options.iteration ?? 1,
		source: stage,
		representation,
	};
	return {
		...withoutDigest,
		recordSha256: "0".repeat(64),
	};
}

/** A two-message request. */
const MESSAGES_A = [
	{ role: "user", content: [{ type: "text", text: "hello" }] },
	{
		role: "assistant",
		content: [
			{ type: "text", text: "thinking" },
			{
				type: "tool-call",
				toolCallId: "c1",
				toolName: "read",
				input: { p: 1 },
			},
		],
	},
	{
		role: "tool",
		content: [
			{ type: "tool-result", toolCallId: "c1", toolName: "read", output: "x" },
		],
	},
];

/** The same request with the tool result REWRITTEN in place. */
const MESSAGES_MUTATED = [
	MESSAGES_A[0],
	MESSAGES_A[1],
	{
		role: "tool",
		content: [
			{
				type: "tool-result",
				toolCallId: "c1",
				toolName: "read",
				output: "y-and-much-longer",
			},
		],
	},
];

describe("ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01 — the analyzer", () => {
	it("V2: an append-only continuation preserves every existing component fingerprint", () => {
		const before = record("runtime_projection", { messages: MESSAGES_A });
		const after = record("runtime_projection", {
			messages: [
				...MESSAGES_A,
				{ role: "user", content: [{ type: "text", text: "more" }] },
			],
			preparationRequestId: "prep-2",
			providerAttemptId: "attempt-2",
			iteration: 2,
		});
		const diff = comparePrefixForensicsRequests({ before, after });
		expect(diff.authoritative).toBe(true);
		const stage = diff.stages.find(
			(candidate) => candidate.stage === "runtime_projection",
		);
		expect(stage?.available).toBe(true);
		expect(stage?.commonPrefixLength).toBe(3);
		expect(stage?.differences).toHaveLength(1);
		expect(stage?.differences[0]?.kind).toBe("inserted");
		expect(stage?.differences[0]?.index).toBe(3);
		expect(stage?.tools.kind).toBe("unchanged");
		expect(stage?.system.systemChanged).toBe(false);
	});

	it("V3: an early message mutation is found at the correct message and part boundary", () => {
		const before = record("runtime_projection", { messages: MESSAGES_A });
		const after = record("runtime_projection", {
			messages: MESSAGES_MUTATED,
			preparationRequestId: "prep-2",
			providerAttemptId: "attempt-2",
			iteration: 2,
		});
		const diff = comparePrefixForensicsRequests({ before, after });
		const stage = diff.stages.find(
			(candidate) => candidate.stage === "runtime_projection",
		);
		expect(stage?.commonPrefixLength).toBe(2);
		const first = stage?.firstDifference;
		expect(first?.index).toBe(2);
		expect(first?.kind).toBe("modified");
		expect(first?.roleBefore).toBe("tool");
		expect(first?.roleAfter).toBe("tool");
		expect(first?.involvesToolResult).toBe(true);
		expect(first?.changedPartTypes).toContain("tool-result");
		expect(first?.bytesBefore).not.toBe(first?.bytesAfter);
		// The change is located at the PART level, not only at the message
		// level: the tool-result part's byte length moved.
		expect(first?.partBytesBefore).toEqual([1]);
		expect(first?.partBytesAfter).not.toEqual(first?.partBytesBefore);
		expect(diff.earliestDifferingStage).toBe("runtime_projection");
	});

	it("V4: a tool REORDER is detected independently of a tool definition change", () => {
		const toolsBefore = {
			alpha: { name: "alpha", description: "a" },
			beta: { name: "beta", description: "b" },
		};
		const toolsReordered = {
			beta: { name: "beta", description: "b" },
			alpha: { name: "alpha", description: "a" },
		};
		const before = record("runtime_projection", {
			messages: MESSAGES_A,
			tools: toolsBefore,
		});
		const after = record("runtime_projection", {
			messages: MESSAGES_A,
			tools: toolsReordered,
			preparationRequestId: "prep-2",
			providerAttemptId: "attempt-2",
			iteration: 2,
		});
		const diff = comparePrefixForensicsRequests({ before, after });
		const stage = diff.stages.find(
			(candidate) => candidate.stage === "runtime_projection",
		);
		// The MESSAGES are identical — only the tool ORDER changed.
		expect(stage?.commonPrefixLength).toBe(3);
		expect(stage?.differences).toHaveLength(0);
		expect(stage?.tools.kind).toBe("order_changed");
		expect(stage?.tools.addedTools).toBeUndefined();
		expect(stage?.tools.removedTools).toBeUndefined();
		expect(stage?.tools.changedDefinitionTools).toBeUndefined();
	});

	it("V5: an adapter-introduced transformation is attributed to the adapter stage", () => {
		// The runtime projection is IDENTICAL between the two requests...
		const beforeProjection = record("runtime_projection", {
			messages: MESSAGES_A,
		});
		const afterProjection = record("runtime_projection", {
			messages: MESSAGES_A,
			preparationRequestId: "prep-2",
			providerAttemptId: "attempt-2",
			iteration: 2,
		});
		// ...but the AI SDK prompt DIFFERS — the adapter changed it.
		const beforePrompt = record("ai_sdk_prompt", { messages: MESSAGES_A });
		const afterPrompt = record("ai_sdk_prompt", {
			messages: MESSAGES_MUTATED,
			preparationRequestId: "prep-2",
			providerAttemptId: "attempt-2",
			iteration: 2,
		});
		const diff = comparePrefixForensicsRequests({
			before: beforeProjection,
			after: afterProjection,
		});
		expect(diff.stages[0]?.differences).toHaveLength(0);
		expect(diff.allStagesEqual).toBe(true);

		// The analyzer is per-stage, so the adapter attribution is read from
		// the pair that actually carries the AI SDK stage.
		const promptDiff = comparePrefixForensicsRequests({
			before: beforePrompt,
			after: afterPrompt,
		});
		expect(promptDiff.earliestDifferingStage).toBe("ai_sdk_prompt");
		const promptStage = promptDiff.stages.find(
			(candidate) => candidate.stage === "ai_sdk_prompt",
		);
		expect(promptStage?.firstDifference?.index).toBe(2);
	});

	it("V6: equal runtime projections do NOT force a claim that the wire payloads are equal", () => {
		const beforeProjection = record("runtime_projection", {
			messages: MESSAGES_A,
		});
		const afterProjection = record("runtime_projection", {
			messages: MESSAGES_A,
			preparationRequestId: "prep-2",
			providerAttemptId: "attempt-2",
			iteration: 2,
		});
		const diff = comparePrefixForensicsRequests({
			before: beforeProjection,
			after: afterProjection,
		});
		const projection = diff.stages.find(
			(candidate) => candidate.stage === "runtime_projection",
		);
		expect(projection?.differences).toHaveLength(0);

		// The WIRE stage is a SEPARATE representation: it carries its own
		// body fingerprint, and a differing body is reported even when the
		// runtime projection is identical.
		const beforeWire = record("wire_request", {
			messages: MESSAGES_A,
			body: '{"messages":[],"serialization":"A"}',
		});
		const afterWire = record("wire_request", {
			messages: MESSAGES_A,
			body: '{"messages":[],"serialization":"B"}',
			preparationRequestId: "prep-2",
			providerAttemptId: "attempt-2",
			iteration: 2,
		});
		const wireDiff = comparePrefixForensicsRequests({
			before: beforeWire,
			after: afterWire,
		});
		const wireStage = wireDiff.stages.find(
			(candidate) => candidate.stage === "wire_request",
		);
		expect(wireStage?.bodyFingerprintChanged).toBe(true);
		expect(wireStage?.differences).toHaveLength(0);
	});

	it("V7: a retry stays a separate attempt under the same preparation identity", () => {
		const before = record("wire_request", {
			messages: MESSAGES_A,
			body: "same-body",
			preparationRequestId: "prep-7",
			providerAttemptId: "attempt-1",
			iteration: 4,
		});
		const after = record("wire_request", {
			messages: MESSAGES_A,
			body: "same-body",
			preparationRequestId: "prep-7",
			providerAttemptId: "attempt-2",
			iteration: 4,
		});
		const diff = comparePrefixForensicsRequests({ before, after });
		// Same preparation lineage ⇒ the comparison IS authoritative.
		expect(diff.authoritative).toBe(true);
		expect(diff.stages[0]?.differences).toHaveLength(0);
		expect(diff.allStagesEqual).toBe(true);
		// The two attempts are DISTINCT identities.
		expect(diff.beforeIdentity.providerAttemptId).toBe("attempt-1");
		expect(diff.afterIdentity.providerAttemptId).toBe("attempt-2");
		expect(diff.beforeIdentity.preparationRequestId).toBe("prep-7");
		expect(diff.afterIdentity.preparationRequestId).toBe("prep-7");
	});

	it("V9: a missing capture does NOT generate a fabricated comparison", () => {
		const before = record("runtime_projection", { messages: MESSAGES_A });
		const diff = comparePrefixForensicsRequests({ before, after: undefined });
		expect(diff.authoritative).toBe(false);
		expect(diff.unavailableReason).toContain("absent");
		expect(diff.stages).toHaveLength(0);
	});

	it("V10: the analyzer FAILS CLOSED when a cohort or a lineage is wrong", () => {
		// A DIFFERENT cohort is not comparable.
		const before = record("runtime_projection", {
			messages: MESSAGES_A,
			cohortId: "cohort-a",
		});
		const after = record("runtime_projection", {
			messages: MESSAGES_MUTATED,
			cohortId: "cohort-b",
			preparationRequestId: "prep-2",
			providerAttemptId: "attempt-2",
		});
		const cohortDiff = comparePrefixForensicsRequests({ before, after });
		expect(cohortDiff.authoritative).toBe(false);
		expect(cohortDiff.unavailableReason).toContain("cohort");

		// A DIFFERENT session and preparation lineage is NOT authoritative.
		const before2 = record("runtime_projection", {
			messages: MESSAGES_A,
			sessionId: "session-1",
			preparationRequestId: "prep-1",
		});
		const after2 = record("runtime_projection", {
			messages: MESSAGES_MUTATED,
			sessionId: "session-2",
			preparationRequestId: "prep-2",
		});
		const lineageDiff = comparePrefixForensicsRequests({
			before: before2,
			after: after2,
		});
		expect(lineageDiff.authoritative).toBe(false);
		expect(lineageDiff.unavailableReason).toContain("NOT authoritative");
	});

	it("reports UNAVAILABLE_FROM_TRACE for a stage whose capture is absent", () => {
		const before = record("runtime_projection", { messages: MESSAGES_A });
		const after = record("runtime_projection", {
			messages: MESSAGES_A,
			preparationRequestId: "prep-2",
			providerAttemptId: "attempt-2",
		});
		const diff = comparePrefixForensicsRequests({ before, after });
		// Only ONE stage is present in the records, so the other stages are
		// reported as unavailable rather than compared.
		const unavailable = diff.stages.filter((stage) => !stage.available);
		expect(unavailable.length).toBeGreaterThan(0);
		expect(unavailable[0]?.representation).toBe(UNAVAILABLE_FROM_TRACE);
		expect(unavailable[0]?.unavailableReason).toBeTruthy();
	});

	it("exposes exactly the three representation boundaries, in causal order", () => {
		expect([...PREFIX_FORENSICS_STAGES]).toEqual([
			"runtime_projection",
			"ai_sdk_prompt",
			"wire_request",
		]);
	});

	it("uses a KEYED fingerprint: the same content under a different key differs", () => {
		const a = keyedFingerprintHex("key-a", "secret-content");
		const b = keyedFingerprintHex("key-b", "secret-content");
		expect(a).not.toBe(b);
		expect(a).toBe(keyedFingerprintHex("key-a", "secret-content"));
		expect(a.length).toBe(64);
	});

	it("V8: the sanitized record carries NO raw prompt, tool command or credential", () => {
		const secret = "sk-ant-SUPER-SECRET-KEY-12345";
		const captured = record("wire_request", {
			messages: [
				{
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: "c1",
							toolName: "run_commands",
							output: `rm -rf /Users/someone/private/project ${secret}`,
						},
					],
				},
			],
			system: `You are Cline. ${secret}`,
			tools: { bash: { name: "bash", description: `run ${secret}` } },
		});
		const serialized = JSON.stringify(captured);
		expect(serialized).not.toContain(secret);
		expect(serialized).not.toContain("rm -rf");
		expect(serialized).not.toContain("/Users/someone");
		expect(serialized).not.toContain("SUPER-SECRET");
	});
});
