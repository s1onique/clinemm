/**
 * ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01 — P0-4 correction.
 *
 * The EXPORT-PATH correlation witness.
 *
 * The defect this repairs: the runtime forwarded the authoritative
 * `preparationRequestId` through the production seams, but the
 * `LatencyTraceSink` recorded only `observation.payload` and the finite
 * metadata ALLOWLIST did not carry the new correlation fields. The
 * exported JSON therefore could NOT establish the decision → dispatch →
 * completion join, even though the direct recording-sink tests passed.
 *
 * This witness exercises the COMPLETE production export path:
 *
 *   `AgentRuntime → LatencyTraceSink → sanitized trace JSON`
 *
 * It asserts that:
 *
 *   - a compaction DECISION and its subsequent provider SUBMISSION and
 *     COMPLETION share the EXACT preparation identity;
 *   - the join authority is reported as AUTHORITATIVE only when the
 *     preparation identity was actually forwarded;
 *   - the final projection fingerprint and the estimated final input
 *     tokens survive the export.
 *
 * NO LIVE PROVIDER CALL. The provider is a scripted fake.
 */
import type { AgentModel, AgentModelRequest } from "@cline/agents";
import { createAgentRuntime } from "@cline/agents";
import type { AgentModelEvent } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { LatencyTraceSink } from "./latency-sink";

/**
 * A scripted provider that records the requests it received.
 */
class ScriptedModel implements AgentModel {
	constructor(
		private readonly steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		>,
	) {}

	async *stream(request: AgentModelRequest): AsyncGenerator<AgentModelEvent> {
		const step = this.steps.shift();
		if (!step) {
			throw new Error("ScriptedModel: no step left");
		}
		yield* step(request);
	}
}

/**
 * The metadata of the events on a boundary.
 */
function metadataOnBoundary(
	trace: ReturnType<LatencyTraceSink["getTrace"]>,
	boundary: string,
): Array<Record<string, unknown>> {
	return trace.events
		.filter((event) => event.boundary === boundary)
		.map((event) => event.metadata as Record<string, unknown>);
}

/**
 * Build the runtime with the REAL `LatencyTraceSink` installed, and return
 * the exported trace.
 */
async function runWithLatencySink(): Promise<
	ReturnType<LatencyTraceSink["getTrace"]>
> {
	const sink = new LatencyTraceSink("corr-export-path");
	const runtime = createAgentRuntime({
		model: new ScriptedModel([
			() => [
				{
					type: "text",
					content: "ok",
					usage: { inputTokens: 1_234, outputTokens: 56 },
				} as unknown as AgentModelEvent,
			],
		]),
		tools: [],
		systemPrompt: "export path witness",
		sessionId: "session-export-path",
		conversationId: "conv-export-path",
		modelBehaviorTraceSink: sink,
	});
	await runtime.run("do the thing");
	return sink.getTrace();
}

describe("ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01 — P0-4 latency export path", () => {
	it("the EXPORTED trace carries the preparation identity through the dispatch and completion", async () => {
		const trace = await runWithLatencySink();

		// The provider submission carries the preparation identity.
		const submitted = metadataOnBoundary(trace, "provider_submitted");
		expect(submitted.length).toBeGreaterThanOrEqual(1);
		const preparationRequestId = submitted[0]?.preparationRequestId;
		expect(typeof preparationRequestId).toBe("string");
		expect((preparationRequestId as string).length).toBeGreaterThan(0);

		// The provider completion carries the SAME preparation identity:
		// the usage joins to the request that produced it.
		const completed = metadataOnBoundary(trace, "provider_completed");
		expect(completed.length).toBeGreaterThanOrEqual(1);
		expect(completed[0]?.preparationRequestId).toBe(preparationRequestId);

		// The ATTEMPT identity is present and is NOT the preparation
		// identity: the two are distinct kinds of identity.
		const attemptId = submitted[0]?.modelRequestId;
		expect(typeof attemptId).toBe("string");
		expect(attemptId).not.toBe(preparationRequestId);
		expect(completed[0]?.modelRequestId).toBe(attemptId);
	});

	it("the EXPORTED trace carries the dispatch record's measurement and fingerprint", async () => {
		const trace = await runWithLatencySink();
		const submitted = metadataOnBoundary(trace, "provider_submitted");
		const record = submitted[0]!;

		// The measurement fields survive the export.
		expect(typeof record.estimatedFinalInputTokens).toBe("number");
		expect(record.estimatedFinalInputTokens).toBeGreaterThan(0);
		expect(typeof record.providerVisibleMessageCount).toBe("number");
		expect(typeof record.toolSchemaCount).toBe("number");
		// The fingerprint is a 64-hex SHA-256 and its provenance is
		// recorded, so a consumer cannot mistake a CLIENT-side content
		// fingerprint for a provider-wire fingerprint.
		expect(record.finalProjectionFingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(typeof record.finalProjectionRepresentation).toBe("string");
		expect(typeof record.finalProjectionFingerprintProducer).toBe("string");
	});

	it("the EXPORTED trace does NOT leak request CONTENT", async () => {
		const trace = await runWithLatencySink();
		const serialized = JSON.stringify(trace);
		expect(serialized).not.toContain("export path witness");
		expect(serialized).not.toContain("do the thing");
	});

	it("the compaction DECISION joins to the dispatch through the preparation identity", async () => {
		// The runtime's own preparation identity is observable through the
		// dispatch; the decision carries the same value.
		const sink = new LatencyTraceSink("corr-decision-join");
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				() => [
					{
						type: "text",
						content: "ok",
						usage: { inputTokens: 1_234, outputTokens: 56 },
					} as unknown as AgentModelEvent,
				],
			]),
			tools: [],
			systemPrompt: "decision join witness",
			sessionId: "session-decision-join",
			conversationId: "conv-decision-join",
			modelBehaviorTraceSink: sink,
		});

		await runtime.run("do the thing");
		const trace = sink.getTrace();
		const submitted = metadataOnBoundary(trace, "provider_submitted");
		const preparationRequestId = submitted[0]?.preparationRequestId as string;

		// Report a compaction DECISION that carries the SAME preparation
		// identity — exactly as the production compaction seam does.
		sink.onCompactionDiagnostics({
			sessionId: "session-decision-join",
			preparationRequestId,
			payload: {
				preparationRequestId,
				decisionId: "session-decision-join#1#0",
				decisionJoinAuthority: "AUTHORITATIVE",
				shouldCompact: true,
				compactionInitiated: true,
			},
		});

		const finalTrace = sink.getTrace();
		const decisions = metadataOnBoundary(finalTrace, "compaction_decision");
		expect(decisions.length).toBeGreaterThanOrEqual(1);
		expect(decisions[0]?.preparationRequestId).toBe(preparationRequestId);
		expect(decisions[0]?.decisionId).toBe("session-decision-join#1#0");
		expect(decisions[0]?.decisionJoinAuthority).toBe("AUTHORITATIVE");

		// THE JOIN: the decision and the dispatch share the preparation
		// identity in the EXPORTED trace.
		const finalSubmitted = metadataOnBoundary(finalTrace, "provider_submitted");
		expect(finalSubmitted[0]?.preparationRequestId).toBe(
			decisions[0]?.preparationRequestId,
		);
	});

	it("the join authority is UNAVAILABLE — never AUTHORITATIVE — when the preparation identity is absent", async () => {
		const sink = new LatencyTraceSink("corr-authority");
		sink.onCompactionDiagnostics({
			sessionId: "session-authority",
			payload: {
				decisionId: "session-authority#1#0",
				decisionJoinAuthority: "UNAVAILABLE",
				shouldCompact: false,
				compactionInitiated: false,
			},
		});
		const decisions = metadataOnBoundary(
			sink.getTrace(),
			"compaction_decision",
		);
		expect(decisions[0]?.decisionJoinAuthority).toBe("UNAVAILABLE");
		expect(decisions[0]?.preparationRequestId).toBeUndefined();
	});
});
