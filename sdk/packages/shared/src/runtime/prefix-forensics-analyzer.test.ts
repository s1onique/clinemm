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
	computeCaptureRecordSha256,
	computeRepresentationFingerprint,
	keyedFingerprintHex,
} from "./prefix-forensics";
import {
	comparePrefixForensicsBundles,
	comparePrefixForensicsRequests,
	establishRequestLineage,
	groupCapturesIntoRequestBundles,
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
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION03: the
		// record carries its REAL content digest, so two records that
		// observed DIFFERENT content are distinguishable. A constant digest
		// made every record look identical to the duplicate detector.
		recordSha256: computeCaptureRecordSha256(withoutDigest),
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

/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION03: remove the named
 * identities from a record.
 *
 * The `record()` helper DEFAULTS every identity, so a witness that needs a
 * record WITHOUT an identity must remove it explicitly — otherwise the
 * witness would pass vacuously.
 */
function stripIdentities(
	record: PrefixForensicsCaptureRecord,
	names: readonly (keyof PrefixForensicsCaptureRecord)[],
): PrefixForensicsCaptureRecord {
	const copy: Record<string, unknown> = { ...record };
	for (const name of names) {
		delete copy[name];
	}
	return copy as PrefixForensicsCaptureRecord;
}

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
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01: the
		// runtime projection does not DIFFER — but the other two
		// representation boundaries are UNAVAILABLE, so the pair does NOT
		// support a full equality claim. The pre-correction implementation
		// treated an unavailable stage as "equal" and returned `true` here.
		expect(diff.stages[0]?.differs).toBe(false);
		expect(diff.allStagesEqual).toBe(false);
		expect(diff.unavailableStages).toContain("ai_sdk_prompt");
		expect(diff.unavailableStages).toContain("wire_request");

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

	it("V5-CORR: a FULL three-stage pair attributes an adapter change to the adapter stage", () => {
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01: the
		// V5 witness above compares ONE stage at a time, which cannot
		// demonstrate an END-TO-END stage transition. This witness supplies
		// ALL THREE stages of the SAME request pair and shows that the
		// earliest differing stage is read across the whole pair.
		const beforeRuntime = record("runtime_projection", {
			messages: MESSAGES_A,
		});
		const afterRuntime = record("runtime_projection", {
			messages: MESSAGES_A,
			preparationRequestId: "prep-2",
			providerAttemptId: "attempt-2",
			iteration: 2,
		});
		const beforePrompt = record("ai_sdk_prompt", { messages: MESSAGES_A });
		const afterPrompt = record("ai_sdk_prompt", {
			messages: MESSAGES_MUTATED,
			preparationRequestId: "prep-2",
			providerAttemptId: "attempt-2",
			iteration: 2,
		});
		const beforeWire = record("wire_request", {
			messages: MESSAGES_A,
			body: '{"messages":[],"serialization":"A"}',
		});
		const afterWire = record("wire_request", {
			messages: MESSAGES_MUTATED,
			body: '{"messages":[],"serialization":"B"}',
			preparationRequestId: "prep-2",
			providerAttemptId: "attempt-2",
			iteration: 2,
		});
		const diff = comparePrefixForensicsRequests({
			before: beforeRuntime,
			after: afterRuntime,
		});
		// The runtime projection stage did not differ; the two other
		// boundaries are absent from THIS pair.
		expect(diff.stages[0]?.available).toBe(true);
		expect(diff.stages[0]?.differs).toBe(false);
		expect(diff.earliestDifferingStage).toBeUndefined();
		expect(diff.allStagesEqual).toBe(false);

		// The AI SDK stage of the same pair DOES differ.
		const promptDiff = comparePrefixForensicsRequests({
			before: beforePrompt,
			after: afterPrompt,
		});
		expect(
			promptDiff.stages.find((s) => s.stage === "ai_sdk_prompt")?.differs,
		).toBe(true);
		expect(
			promptDiff.stages.find((s) => s.stage === "ai_sdk_prompt")
				?.differingCategories,
		).toContain("messages");
		// And the wire stage of the same pair differs in BOTH the messages
		// and the serialized body.
		const wireDiff = comparePrefixForensicsRequests({
			before: beforeWire,
			after: afterWire,
		});
		const wireStage = wireDiff.stages.find((s) => s.stage === "wire_request");
		expect(wireStage?.differs).toBe(true);
		expect(wireStage?.differingCategories).toContain("messages");
		expect(wireStage?.differingCategories).toContain("body");
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
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01: the wire
		// stage does not differ, but the other two representation boundaries
		// are UNAVAILABLE, so the pair does NOT support a full equality
		// claim. The pre-correction implementation treated an unavailable
		// stage as "equal" and returned `true` here.
		expect(diff.stages[0]?.differs).toBe(false);
		expect(diff.allStagesEqual).toBe(false);
		expect(diff.unavailableStages).toContain("runtime_projection");
		expect(diff.unavailableStages).toContain("ai_sdk_prompt");
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

	it("CORR-01: an UNAVAILABLE stage can NEVER imply full equality", () => {
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01.
		//
		// The pre-correction implementation computed:
		//
		//     stages.every((s) => !s.available || s.differences.length === 0)
		//
		// so an UNAVAILABLE stage counted as "equal". A comparison with
		// only ONE of the three representation boundaries present therefore
		// produced a POSITIVE equality result — a claim the evidence did
		// not support.
		const before = record("runtime_projection", { messages: MESSAGES_A });
		const after = record("runtime_projection", {
			messages: MESSAGES_A,
			preparationRequestId: "prep-2",
			providerAttemptId: "attempt-2",
			iteration: 2,
		});
		const diff = comparePrefixForensicsRequests({ before, after });

		// Two of the three boundaries are absent.
		expect(diff.unavailableStages).toHaveLength(2);
		expect(diff.allStagesEqual).toBe(false);
	});

	it("CORR-02: a TOOL-ONLY change is attributed to its stage", () => {
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01.
		//
		// The pre-correction stage attribution read ONLY the message list
		// (`stage.differences.length > 0`), so a TOOL-ONLY change — the
		// messages are byte-identical — was invisible to
		// `earliestDifferingStage`.
		const toolsBefore = { alpha: { name: "alpha", description: "a" } };
		const toolsAfter = { alpha: { name: "alpha", description: "a-changed" } };
		const before = record("runtime_projection", {
			messages: MESSAGES_A,
			tools: toolsBefore,
		});
		const after = record("runtime_projection", {
			messages: MESSAGES_A,
			tools: toolsAfter,
			preparationRequestId: "prep-2",
			providerAttemptId: "attempt-2",
			iteration: 2,
		});
		const diff = comparePrefixForensicsRequests({ before, after });
		const stage = diff.stages.find(
			(candidate) => candidate.stage === "runtime_projection",
		);
		// The MESSAGES are identical.
		expect(stage?.differences).toHaveLength(0);
		// But the TOOLS changed, so the stage DIFFERS and the attribution
		// names it.
		expect(stage?.differs).toBe(true);
		expect(stage?.differingCategories).toEqual(["tools"]);
		expect(diff.earliestDifferingStage).toBe("runtime_projection");
	});

	it("CORR-03: a BODY-ONLY change is attributed to its stage", () => {
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01: a
		// change that appears ONLY in the serialized body — with identical
		// messages — must still be attributed.
		const before = record("wire_request", {
			messages: MESSAGES_A,
			body: '{"serialization":"A"}',
		});
		const after = record("wire_request", {
			messages: MESSAGES_A,
			body: '{"serialization":"B"}',
			preparationRequestId: "prep-2",
			providerAttemptId: "attempt-2",
			iteration: 2,
		});
		const diff = comparePrefixForensicsRequests({ before, after });
		const stage = diff.stages.find(
			(candidate) => candidate.stage === "wire_request",
		);
		expect(stage?.differences).toHaveLength(0);
		expect(stage?.differs).toBe(true);
		expect(stage?.differingCategories).toEqual(["body"]);
		expect(diff.earliestDifferingStage).toBe("wire_request");
	});

	it("CORR-04: a SYSTEM-ONLY change is attributed to its stage", () => {
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01.
		const before = record("runtime_projection", {
			messages: MESSAGES_A,
			system: "system prompt A",
		});
		const after = record("runtime_projection", {
			messages: MESSAGES_A,
			system: "system prompt B",
			preparationRequestId: "prep-2",
			providerAttemptId: "attempt-2",
			iteration: 2,
		});
		const diff = comparePrefixForensicsRequests({ before, after });
		const stage = diff.stages.find(
			(candidate) => candidate.stage === "runtime_projection",
		);
		expect(stage?.differences).toHaveLength(0);
		expect(stage?.differs).toBe(true);
		expect(stage?.differingCategories).toEqual(["system"]);
		expect(diff.earliestDifferingStage).toBe("runtime_projection");
	});

	it("CORR-05: an INCOMPLETE representation is never compared as an empty request", () => {
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01.
		//
		// An unparseable wire body produces a capture whose message list
		// could not be determined. It must NOT be compared as a complete
		// zero-message request.
		const incomplete = record("wire_request", {
			messages: MESSAGES_A,
			body: '{"serialization":"A"}',
		});
		const before: PrefixForensicsCaptureRecord = {
			...incomplete,
			representation: {
				...incomplete.representation,
				complete: false,
				incompleteReason:
					"the message list was absent or not an array; the representation " +
					"could not be observed as a complete request",
			},
		};
		const after = record("wire_request", {
			messages: MESSAGES_A,
			body: '{"serialization":"B"}',
			preparationRequestId: "prep-2",
			providerAttemptId: "attempt-2",
			iteration: 2,
		});
		const diff = comparePrefixForensicsRequests({ before, after });
		const stage = diff.stages.find(
			(candidate) => candidate.stage === "wire_request",
		);
		expect(stage?.available).toBe(false);
		expect(stage?.unavailableReason).toContain("INCOMPLETE");
		expect(diff.allStagesEqual).toBe(false);
	});

	it("CORR-06: an EMPTY but PRESENT message list is a COMPLETE observation", () => {
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01: the
		// completeness contract distinguishes "absent" from "empty".
		const before = record("wire_request", { messages: [], body: "a" });
		const after = record("wire_request", {
			messages: [],
			body: "b",
			preparationRequestId: "prep-2",
			providerAttemptId: "attempt-2",
			iteration: 2,
		});
		expect(before.representation.complete).toBe(true);
		expect(before.representation.messageCount).toBe(0);
		const diff = comparePrefixForensicsRequests({ before, after });
		const stage = diff.stages.find(
			(candidate) => candidate.stage === "wire_request",
		);
		expect(stage?.available).toBe(true);
		expect(stage?.differs).toBe(true);
		expect(stage?.differingCategories).toEqual(["body"]);
	});

	it("CORR-07: a same-session chronology is NOT authoritative without an EXACT lineage", () => {
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01, as
		// CORRECTED by CORRECTION02.
		//
		// The offline CLI pairs captures by session + source + file order.
		// The analyzer's authority rule accepts a shared SESSION, so
		// without an explicit gate a same-session chronology was labelled
		// authoritative without establishing that the two captures are
		// consecutive model turns.
		//
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION02: the
		// runtime's own identities are the authority. `preparationRequestId`
		// is minted ONCE PER PREPARED REQUEST, so two SUCCESSIVE TURNS
		// carry DIFFERENT preparation identities, and a RETRY keeps the
		// SAME preparation identity while re-minting the attempt id. The
		// CORRECTION01 witness had these two cases inverted.
		//
		// (a) Two SUCCESSIVE TURTS: same session, ADJACENT iterations,
		//     DISTINCT preparations. This IS consecutive.
		const turn29 = record("runtime_projection", {
			messages: MESSAGES_A,
			sessionId: "session-1",
			preparationRequestId: "prep-29",
			providerAttemptId: "attempt-29",
			iteration: 29,
		});
		const turn30 = record("runtime_projection", {
			messages: MESSAGES_A,
			sessionId: "session-1",
			preparationRequestId: "prep-30",
			providerAttemptId: "attempt-30",
			iteration: 30,
		});
		expect(establishRequestLineage(turn29, turn30).consecutive).toBe(true);
		expect(establishRequestLineage(turn29, turn30).relation).toBe(
			"consecutive_turn",
		);

		// (b) A NON-ADJACENT iteration gap is refused — the missing turn is
		//     never bridged.
		const turn31 = record("runtime_projection", {
			messages: MESSAGES_A,
			sessionId: "session-1",
			preparationRequestId: "prep-31",
			providerAttemptId: "attempt-31",
			iteration: 31,
		});
		const gapped = establishRequestLineage(turn29, turn31);
		expect(gapped.consecutive).toBe(false);
		expect(gapped.reason).toContain("not adjacent");

		// (c) A transport RETRY of the same preparation is NOT a turn: the
		//     preparation identity is unchanged and the iteration does not
		//     advance.
		const retry = record("runtime_projection", {
			messages: MESSAGES_A,
			sessionId: "session-1",
			preparationRequestId: "prep-29",
			providerAttemptId: "attempt-29-retry",
			iteration: 29,
		});
		const retryVerdict = establishRequestLineage(turn29, retry);
		expect(retryVerdict.consecutive).toBe(false);
		expect(retryVerdict.relation).toBe("retry");

		// (d) The two representation STAGES of ONE request are aggregated,
		//     never compared as two turns.
		const sameRequestOtherStage = record("ai_sdk_prompt", {
			messages: MESSAGES_A,
			sessionId: "session-1",
			preparationRequestId: "prep-29",
			providerAttemptId: "attempt-29",
			iteration: 29,
		});
		const sameRequest = establishRequestLineage(turn29, sameRequestOtherStage);
		expect(sameRequest.consecutive).toBe(false);
		expect(sameRequest.relation).toBe("same_request");
	});

	it("AUTH-01: a MISSING preparation identity can never be a consecutive turn", () => {
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION03.
		//
		// The CORRECTION02 gate checked that the preparation identities
		// DIFFER only when BOTH were present:
		//
		//     before.preparationRequestId !== undefined &&
		//     after.preparationRequestId !== undefined &&
		//     before.preparationRequestId === after.preparationRequestId
		//
		// so a record with NO preparation identity SKIPPED the check
		// entirely and fell through to `consecutive: true`. That promoted
		// incomplete capture evidence into a positive attribution, and it
		// contradicted CORRECTION02's own stated contract that "every
		// required identity is mandatory".
		//
		// NOTE: the record helper DEFAULTS every identity, so the record
		// must be built with the identity explicitly REMOVED — otherwise
		// the witness would pass vacuously.
		const withPrep = record("runtime_projection", {
			messages: MESSAGES_A,
			sessionId: "session-1",
			preparationRequestId: "prep-29",
			providerAttemptId: "attempt-29",
			iteration: 29,
		});
		const withoutPrep = stripIdentities(
			record("runtime_projection", {
				messages: MESSAGES_A,
				sessionId: "session-1",
				preparationRequestId: "prep-30",
				providerAttemptId: "attempt-30",
				iteration: 30,
			}),
			["preparationRequestId"],
		);
		const verdict = establishRequestLineage(withPrep, withoutPrep);
		expect(verdict.consecutive).toBe(false);
		expect(verdict.reason).toBeTruthy();
		expect(verdict.reason).toContain("preparation");
	});

	it("AUTH-02: a MISSING attempt identity can never be a consecutive turn", () => {
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION03: the
		// attempt identity follows the same rule as the preparation one.
		const withAttempt = record("runtime_projection", {
			messages: MESSAGES_A,
			sessionId: "session-1",
			preparationRequestId: "prep-29",
			providerAttemptId: "attempt-29",
			iteration: 29,
		});
		const withoutAttempt = stripIdentities(
			record("runtime_projection", {
				messages: MESSAGES_A,
				sessionId: "session-1",
				preparationRequestId: "prep-30",
				providerAttemptId: "attempt-30",
				iteration: 30,
			}),
			["providerAttemptId"],
		);
		const verdict = establishRequestLineage(withAttempt, withoutAttempt);
		expect(verdict.consecutive).toBe(false);
		expect(verdict.reason).toBeTruthy();
		expect(verdict.reason).toContain("attempt");
	});

	it("AUTH-03: a MISSING cohort can never be a consecutive turn", () => {
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION03: the
		// cohort is the KEYED-FINGERPRINT scope. Two records whose cohort is
		// unknown cannot be established as comparable at all.
		const before = record("runtime_projection", {
			messages: MESSAGES_A,
			sessionId: "session-1",
			preparationRequestId: "prep-29",
			providerAttemptId: "attempt-29",
			iteration: 29,
		});
		const after = stripIdentities(
			record("runtime_projection", {
				messages: MESSAGES_A,
				sessionId: "session-1",
				preparationRequestId: "prep-30",
				providerAttemptId: "attempt-30",
				iteration: 30,
			}),
			["cohortId"],
		);
		const verdict = establishRequestLineage(before, after);
		expect(verdict.consecutive).toBe(false);
		expect(verdict.reason).toContain("cohort");
	});

	it("AUTH-04: the bundle comparator applies the lineage gate ITSELF", () => {
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION03.
		//
		// `comparePrefixForensicsBundles()` returned `authoritative: true`
		// after only a COHORT compatibility check, so any caller that did
		// not separately apply the lineage gate could publish an
		// authoritative comparison of two arbitrary bundles. The authority
		// validation is now CENTRALIZED in the comparator.
		const bundles = groupCapturesIntoRequestBundles([
			record("runtime_projection", {
				messages: MESSAGES_A,
				sessionId: "session-1",
				preparationRequestId: "prep-29",
				providerAttemptId: "attempt-29",
				iteration: 29,
			}),
			record("runtime_projection", {
				messages: MESSAGES_A,
				sessionId: "session-1",
				preparationRequestId: "prep-30",
				providerAttemptId: "attempt-30",
				iteration: 30,
			}),
		]);
		expect(bundles).toHaveLength(2);
		const diff = comparePrefixForensicsBundles({
			before: bundles[0],
			after: bundles[1],
		});
		// The two bundles ARE consecutive turns...
		expect(diff.authoritative).toBe(true);
	});

	it("AUTH-05: the bundle comparator REFUSES two bundles that are not consecutive turns", () => {
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION03: the
		// comparator must apply the lineage gate ITSELF, so a caller cannot
		// bypass it.
		const bundles = groupCapturesIntoRequestBundles([
			record("runtime_projection", {
				messages: MESSAGES_A,
				sessionId: "session-1",
				preparationRequestId: "prep-29",
				providerAttemptId: "attempt-29",
				iteration: 29,
			}),
			record("runtime_projection", {
				messages: MESSAGES_A,
				sessionId: "session-1",
				preparationRequestId: "prep-31",
				providerAttemptId: "attempt-31",
				iteration: 31,
			}),
		]);
		expect(bundles).toHaveLength(2);
		const diff = comparePrefixForensicsBundles({
			before: bundles[0],
			after: bundles[1],
		});
		// A NON-ADJACENT iteration gap is not an authoritative comparison.
		expect(diff.authoritative).toBe(false);
		expect(diff.unavailableReason).toBeTruthy();
		expect(diff.unavailableReason).toContain("adjacent");
	});

	it("AUTH-06: a CONFLICTING same-stage duplicate is EXCLUDED, not silently overwritten", () => {
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION03.
		//
		// The grouping used `stages.set(...)`, so a second record for the
		// same identity AND the same stage silently REPLACED the first.
		// Two different observations of one boundary are a conflict, not a
		// duplicate: the bundle must exclude the stage rather than pick
		// one arbitrarily.
		const first = record("runtime_projection", {
			messages: MESSAGES_A,
			sessionId: "session-1",
			preparationRequestId: "prep-29",
			providerAttemptId: "attempt-29",
			iteration: 29,
		});
		// The SAME identity and stage, but a DIFFERENT observation.
		const conflicting = record("runtime_projection", {
			messages: MESSAGES_MUTATED,
			sessionId: "session-1",
			preparationRequestId: "prep-29",
			providerAttemptId: "attempt-29",
			iteration: 29,
		});
		const bundles = groupCapturesIntoRequestBundles([first, conflicting]);
		expect(bundles).toHaveLength(1);
		// The conflicting stage is EXCLUDED — it is not silently the
		// second record.
		expect(bundles[0]?.stages.has("runtime_projection")).toBe(false);
	});

	it("AUTH-07: an IDENTICAL same-stage duplicate is collapsed, not excluded", () => {
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION03: a
		// byte-identical re-emission of the same observation is a harmless
		// duplicate and must not empty the bundle.
		const first = record("runtime_projection", {
			messages: MESSAGES_A,
			sessionId: "session-1",
			preparationRequestId: "prep-29",
			providerAttemptId: "attempt-29",
			iteration: 29,
		});
		const identical = record("runtime_projection", {
			messages: MESSAGES_A,
			sessionId: "session-1",
			preparationRequestId: "prep-29",
			providerAttemptId: "attempt-29",
			iteration: 29,
		});
		const bundles = groupCapturesIntoRequestBundles([first, identical]);
		expect(bundles).toHaveLength(1);
		expect(bundles[0]?.stages.has("runtime_projection")).toBe(true);
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
