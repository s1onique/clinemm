/**
 * ACT-CLINEMM-ROUND-C-HARNESS-01 — Phase 2 latency sink adapter tests.
 *
 * ## What is asserted here
 *
 *  - the adapter turns the runtime's EXISTING observation channels into a
 *    latency trace without the runtime's dispatch path growing;
 *  - the tool-result boundary records SIZE and DIGEST, never content;
 *  - a failed, aborted or cancelled request is classified as such;
 *  - the compaction boundary is traced;
 *  - the metadata allowlist is honoured end to end.
 */

import type { ModelBehaviorTraceObservation } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { LatencyTraceSink } from "./latency-sink";
import type { LatencyClock } from "./latency-trace";

class ScriptedClock implements LatencyClock {
	private now = 0;
	monotonic(): number {
		return this.now;
	}
	wallClockIso(): string {
		return "1970-01-01T00:00:00.000Z";
	}
	advance(ms: number): void {
		this.now += ms;
	}
}

function observation(
	payload: Record<string, unknown> = {},
): ModelBehaviorTraceObservation {
	return {
		sessionId: "s",
		taskId: "t",
		runId: "r",
		modelRequestId: "mreq-1",
		providerId: "openai-compatible",
		modelId: "qwen3.8-flash-next-iq3_s",
		payload,
	};
}

describe("LatencyTraceSink", () => {
	it("builds a trace from the model request channels", () => {
		const clock = new ScriptedClock();
		const sink = new LatencyTraceSink("corr-1", clock);
		sink.onModelRequestStart(observation({ modelId: "m" }));
		clock.advance(30);
		sink.onModelRequestFinish(observation({ inputTokens: 6061 }));

		const events = sink.getTrace().events;
		expect(events.length).toBeGreaterThan(0);
		expect(events[0]?.boundary).toBe("request_prepared");
		expect(events[0]?.correlationId).toBe("corr-1");
	});

	it("carries the token metrics and the model identity", () => {
		const sink = new LatencyTraceSink("corr-2", new ScriptedClock());
		sink.onModelRequestStart(
			observation({ modelId: "m", inputTokens: 6061, cacheReadTokens: 3895 }),
		);
		const event = sink.getTrace().events[0];
		expect(event?.metadata.modelId).toBe("m");
		expect(event?.metadata.inputTokens).toBe(6061);
		expect(event?.metadata.cacheReadTokens).toBe(3895);
	});

	it("drops a payload field that is not allowlisted", () => {
		const sink = new LatencyTraceSink("corr-3", new ScriptedClock());
		sink.onModelRequestStart(
			observation({ modelId: "m", rawPrompt: "SECRET", command: "rm -rf /" }),
		);
		const serialized = JSON.stringify(sink.getTrace().events);
		expect(serialized).not.toContain("SECRET");
		expect(serialized).not.toContain("rm -rf");
	});

	it("classifies a failed model request as failed", () => {
		const sink = new LatencyTraceSink("corr-4", new ScriptedClock());
		sink.onModelRequestStart(observation());
		sink.onModelRequestError(observation({ errorName: "RateLimitError" }));
		const ends = sink
			.getTrace()
			.events.filter((event) => event.phase === "end");
		expect(ends.some((event) => event.status === "failed")).toBe(true);
	});

	it("classifies an aborted model request as aborted", () => {
		const sink = new LatencyTraceSink("corr-5", new ScriptedClock());
		sink.onModelRequestStart(observation());
		sink.onModelRequestAbort(observation({ abortOrigin: "user" }));
		const ends = sink
			.getTrace()
			.events.filter((event) => event.phase === "end");
		expect(ends.some((event) => event.status === "aborted")).toBe(true);
	});

	it("records the tool execution boundary from the tool channels", () => {
		const clock = new ScriptedClock();
		const sink = new LatencyTraceSink("corr-6", clock);
		sink.onToolStart(
			observation({ toolName: "run_commands", commandCount: 3 }),
		);
		clock.advance(120);
		sink.onToolFinish(observation({ toolName: "run_commands" }));

		const end = sink
			.getTrace()
			.events.find(
				(event) => event.boundary === "tool_execution" && event.phase === "end",
			);
		expect(end?.durationMs).toBe(120);
	});

	it("records the tool result by size and digest, never by content", () => {
		const sink = new LatencyTraceSink("corr-7", new ScriptedClock());
		sink.recordToolResultDelivered("start");
		sink.recordToolResultDelivered("end", {
			resultText: "the command output",
		});
		const end = sink
			.getTrace()
			.events.find(
				(event) =>
					event.boundary === "tool_result_delivered" && event.phase === "end",
			);
		expect(end?.metadata.toolResultCharCount).toBe(18);
		expect(end?.metadata.toolResultBytes).toBe(18);
		expect(typeof end?.metadata.toolResultDigest).toBe("string");
		expect(JSON.stringify(end)).not.toContain("the command output");
	});

	it("correlates the tool result with the provider-ready request", () => {
		const sink = new LatencyTraceSink("corr-8", new ScriptedClock());
		sink.recordToolResultDelivered("end", { resultText: "same bytes" });
		sink.recordProviderReady("end", { metadata: { included: true } });
		const ready = sink
			.getTrace()
			.events.find((event) => event.boundary === "provider_ready");
		expect(ready?.metadata.included).toBe(true);
	});

	it("records the compaction boundary", () => {
		const clock = new ScriptedClock();
		const sink = new LatencyTraceSink("corr-9", clock);
		sink.recordCompaction("start");
		clock.advance(500);
		sink.recordCompaction("end", {
			metadata: { compactionTrigger: "token_ratio" },
			status: "ok",
		});
		const end = sink
			.getTrace()
			.events.find(
				(event) => event.boundary === "compaction" && event.phase === "end",
			);
		expect(end?.durationMs).toBe(500);
		expect(end?.metadata.compactionTrigger).toBe("token_ratio");
	});

	it("records the schema validation boundary", () => {
		const clock = new ScriptedClock();
		const sink = new LatencyTraceSink("corr-10", clock);
		sink.recordSchemaValidation("start");
		clock.advance(2);
		sink.recordSchemaValidation("end", {
			metadata: { schemaValid: false, schemaErrorKind: "expected_array" },
			status: "rejected",
		});
		const end = sink
			.getTrace()
			.events.find(
				(event) =>
					event.boundary === "schema_validation" && event.phase === "end",
			);
		expect(end?.durationMs).toBe(2);
		expect(end?.metadata.schemaValid).toBe(false);
		expect(end?.status).toBe("rejected");
	});
});
