/**
 * ACT-CLINEMM-ROUND-C-HARNESS-02 — Phase 1 D2/D3: latency lifecycle and
 * parallel attribution.
 *
 * ## The defects
 *
 * **D2 — the synthetic first token.** `LatencyTraceSink.onModelRequestFinish`
 * entered the `provider_first_token` boundary and exited it in the SAME
 * call. The runtime reports ONE event when the provider's stream ends,
 * so the "first token" boundary was a zero-duration span recorded at
 * stream completion. A consumer reading that span would conclude the
 * first token arrived at the instant the stream ended — a fabricated
 * time-to-first-token.
 *
 * The ACT requires that an UNAVAILABLE measurement be represented
 * EXPLICITLY rather than as a synthetic zero-duration success.
 *
 * **D3 — overlapping spans.** The tracer's stage attribution sums span
 * durations. When two operations overlap, that sum exceeds the wall
 * clock. The ACT requires that wall-clock time NOT be derived by
 * blindly summing overlapping spans.
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
		return `1970-01-01T00:00:00.${String(this.now).padStart(3, "0")}Z`;
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

describe("D2 — latency lifecycle", () => {
	it("closes every request span it opens on a successful request", () => {
		const clock = new ScriptedClock();
		const sink = new LatencyTraceSink("corr-lc-1", clock);
		sink.onModelRequestStart(observation({ modelId: "m" }));
		clock.advance(120);
		sink.onModelRequestFinish(observation({ inputTokens: 6061 }));

		const events = sink.getTrace().events;
		const open = new Map<string, number>();
		for (const event of events) {
			if (event.phase === "start") {
				open.set(event.boundary, (open.get(event.boundary) ?? 0) + 1);
			} else {
				open.set(event.boundary, (open.get(event.boundary) ?? 0) - 1);
			}
		}
		for (const [boundary, count] of open) {
			expect(`${boundary}:${count}`).toBe(`${boundary}:0`);
		}
	});

	it("keeps the timestamps monotonic", () => {
		const clock = new ScriptedClock();
		const sink = new LatencyTraceSink("corr-lc-2", clock);
		sink.onModelRequestStart(observation());
		clock.advance(10);
		sink.onToolStart(observation({ toolCallId: "t1" }));
		clock.advance(10);
		sink.onToolFinish(observation({ toolCallId: "t1" }));
		clock.advance(10);
		sink.onModelRequestFinish(observation());

		const times = sink.getTrace().events.map((event) => event.monotonicMs);
		for (let i = 1; i < times.length; i++) {
			expect(times[i] as number).toBeGreaterThanOrEqual(times[i - 1] as number);
		}
	});

	it("does NOT report a measured time-to-first-token", () => {
		// The runtime reports ONE event at stream end. The first-token
		// boundary must therefore be recorded as UNAVAILABLE, not as a
		// zero-duration success.
		const clock = new ScriptedClock();
		const sink = new LatencyTraceSink("corr-lc-3", clock);
		sink.onModelRequestStart(observation());
		clock.advance(500);
		sink.onModelRequestFinish(observation());

		const firstTokenEvents = sink
			.getTrace()
			.events.filter((event) => event.boundary === "provider_first_token");
		// There must be no MEASURED first-token span.
		for (const event of firstTokenEvents) {
			if (event.phase === "end") {
				expect(event.durationMs).toBeUndefined();
			}
		}
		// And the trace must say the measurement is unavailable, rather
		// than staying silent about it.
		expect(
			sink
				.getTrace()
				.unavailable?.some((item) => item.boundary === "provider_first_token"),
		).toBe(true);
	});

	it("records a real first-token duration when one IS observable", () => {
		const clock = new ScriptedClock();
		const sink = new LatencyTraceSink("corr-lc-4", clock);
		sink.onModelRequestStart(observation());
		clock.advance(20);
		sink.onProviderFirstResponse(observation());
		clock.advance(30);
		sink.onProviderFirstToken(observation());
		clock.advance(80);
		sink.onModelRequestFinish(observation());

		const firstToken = sink
			.getTrace()
			.events.find(
				(event) =>
					event.boundary === "provider_first_token" && event.phase === "end",
			);
		expect(firstToken?.durationMs).toBe(50);
		const firstResponse = sink
			.getTrace()
			.events.find(
				(event) =>
					event.boundary === "provider_first_response" && event.phase === "end",
			);
		// The first response event is a SEPARATE measurement: 0 -> 20.
		expect(firstResponse?.durationMs).toBe(20);
		expect(
			sink
				.getTrace()
				.unavailable?.some((item) => item.boundary === "provider_first_token"),
		).toBeFalsy();
	});

	it("classifies a failed model request as failed, not successful", () => {
		const clock = new ScriptedClock();
		const sink = new LatencyTraceSink("corr-lc-5", clock);
		sink.onModelRequestStart(observation());
		clock.advance(40);
		sink.onModelRequestError(observation({ error: "boom" }));

		const ends = sink
			.getTrace()
			.events.filter((event) => event.phase === "end");
		expect(ends.length).toBeGreaterThan(0);
		for (const event of ends) {
			expect(event.status).not.toBe("ok");
		}
		const providerEnd = ends.find(
			(event) => event.boundary === "provider_completed",
		);
		expect(providerEnd?.status).toBe("failed");
	});

	it("classifies an aborted model request as aborted", () => {
		const clock = new ScriptedClock();
		const sink = new LatencyTraceSink("corr-lc-6", clock);
		sink.onModelRequestStart(observation());
		clock.advance(40);
		sink.onModelRequestAbort(observation());

		const providerEnd = sink
			.getTrace()
			.events.find(
				(event) =>
					event.boundary === "provider_completed" && event.phase === "end",
			);
		expect(providerEnd?.status).toBe("aborted");
	});

	it("records a cancelled tool as cancelled", () => {
		const clock = new ScriptedClock();
		const sink = new LatencyTraceSink("corr-lc-7", clock);
		sink.onToolStart(observation({ toolCallId: "t1" }));
		clock.advance(70);
		sink.onToolFinish(observation({ toolCallId: "t1" }), "cancelled");

		const end = sink
			.getTrace()
			.events.find(
				(event) => event.boundary === "tool_execution" && event.phase === "end",
			);
		expect(end?.status).toBe("cancelled");
		expect(end?.durationMs).toBe(70);
	});

	it("makes a missing start or end observable as a trace-integrity failure", () => {
		const clock = new ScriptedClock();
		const sink = new LatencyTraceSink("corr-lc-8", clock);
		// An end with no matching start.
		sink.record("schema_validation", "end", { status: "ok" });

		expect(
			sink
				.getTrace()
				.integrityFailures?.some(
					(item) => item.boundary === "schema_validation",
				),
		).toBe(true);
	});

	it("makes an unmatched span id observable as a trace-integrity failure", () => {
		const clock = new ScriptedClock();
		const sink = new LatencyTraceSink("corr-lc-9", clock);
		sink.onToolStart(observation({ toolCallId: "a" }));
		clock.advance(10);
		// An exit naming a tool call that was never entered.
		sink.onToolFinish(observation({ toolCallId: "zzz" }));

		expect(
			sink
				.getTrace()
				.integrityFailures?.some((item) => item.reason.includes("unmatched")),
		).toBe(true);
	});
});

describe("D3 — parallel timing", () => {
	it("gives each of two interleaved tool calls its own duration", () => {
		const clock = new ScriptedClock();
		const sink = new LatencyTraceSink("corr-par-1", clock);
		// A starts at 0; B starts at 10; B finishes at 100; A finishes
		// at 110. Non-LIFO completion.
		sink.onToolStart(observation({ toolCallId: "a" }));
		clock.advance(10);
		sink.onToolStart(observation({ toolCallId: "b" }));
		clock.advance(90);
		sink.onToolFinish(observation({ toolCallId: "b" }));
		clock.advance(10);
		sink.onToolFinish(observation({ toolCallId: "a" }));

		const ends = sink
			.getTrace()
			.events.filter(
				(event) => event.boundary === "tool_execution" && event.phase === "end",
			);
		expect(ends).toHaveLength(2);
		const byId = new Map(
			ends.map((event) => [event.metadata?.toolCallId, event]),
		);
		expect(byId.get("b")?.durationMs).toBe(90);
		expect(byId.get("a")?.durationMs).toBe(110);
	});

	it("does NOT derive wall-clock time by summing overlapping spans", () => {
		const clock = new ScriptedClock();
		const sink = new LatencyTraceSink("corr-par-2", clock);
		// Two 100 ms tool calls that OVERLAP: A runs 0..100, B runs
		// 10..110. The wall clock is 110 ms, but the durations sum to
		// 200 ms.
		sink.onToolStart(observation({ toolCallId: "a" }));
		clock.advance(10);
		sink.onToolStart(observation({ toolCallId: "b" }));
		clock.advance(90);
		sink.onToolFinish(observation({ toolCallId: "a" }));
		clock.advance(10);
		sink.onToolFinish(observation({ toolCallId: "b" }));

		const trace = sink.getTrace();
		const ends = trace.events.filter(
			(event) => event.boundary === "tool_execution" && event.phase === "end",
		);
		const summed = ends.reduce(
			(total, event) => total + (event.durationMs ?? 0),
			0,
		);
		const wallClock =
			(trace.events[trace.events.length - 1]?.monotonicMs ?? 0) -
			(trace.events[0]?.monotonicMs ?? 0);
		expect(summed).toBe(200);
		expect(wallClock).toBe(110);
		// The trace must report a WALL CLOCK figure that is NOT the naive
		// sum, and must say the spans overlapped.
		expect(trace.wallClockMs).toBe(110);
		expect(trace.overlapping).toBe(true);
	});

	it("keeps two interleaved MODEL requests on separate correlation ids", () => {
		const clock = new ScriptedClock();
		const a = new LatencyTraceSink("corr-a", clock);
		const b = new LatencyTraceSink("corr-b", clock);
		a.onModelRequestStart(observation());
		clock.advance(5);
		b.onModelRequestStart(observation());
		clock.advance(95);
		a.onModelRequestFinish(observation());
		clock.advance(10);
		b.onModelRequestFinish(observation());

		const aEnds = a.getTrace().events.filter((event) => event.phase === "end");
		const bEnds = b.getTrace().events.filter((event) => event.phase === "end");
		expect(aEnds.every((event) => event.correlationId === "corr-a")).toBe(true);
		expect(bEnds.every((event) => event.correlationId === "corr-b")).toBe(true);
	});
});
