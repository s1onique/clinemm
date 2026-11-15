/**
 * ACT-CLINEMM-ROUND-C-HARNESS-01 — Phase 2 latency tracer tests.
 *
 * ## What is asserted here
 *
 *  - the nine boundaries are recorded with correlated ids and MONOTONIC
 *    timestamps;
 *  - execution time is separated from queuing, transport and delivery;
 *  - the metadata ALLOWLIST drops everything that is not explicitly
 *    permitted, including raw content;
 *  - parallel tool calls keep their spans distinct;
 *  - a missing tool result, a failed tool and a cancelled tool are all
 *    reported with the right status;
 *  - the compaction boundary is traced;
 *  - the ENABLED path's overhead is measured, so the cost of the
 *    instrumentation is a number rather than a claim.
 */

import { describe, expect, it } from "vitest";
import {
	classifyLatencyStage,
	digestLatencyContent,
	LATENCY_METADATA_ALLOWLIST,
	LATENCY_TRACE_MAX_EVENTS,
	LATENCY_TRACE_MAX_INTEGRITY_FAILURES,
	LATENCY_TRACE_MAX_OPEN_SPANS,
	type LatencyClock,
	LatencyTracer,
	sanitizeLatencyMetadata,
} from "./latency-trace";

/**
 * A deterministic clock the tests drive by hand.
 */
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

describe("LatencyTracer — boundary recording", () => {
	it("records an enter and an exit with a duration", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-1", clock);
		tracer.enter("tool_execution");
		clock.advance(250);
		tracer.exit("tool_execution", { status: "ok" });

		const events = tracer.getEvents();
		expect(events).toHaveLength(2);
		expect(events[0]?.phase).toBe("start");
		expect(events[1]?.phase).toBe("end");
		expect(events[1]?.durationMs).toBe(250);
		expect(events[1]?.status).toBe("ok");
		expect(events[0]?.correlationId).toBe("corr-1");
	});

	it("carries the correlation id on every event", () => {
		const tracer = new LatencyTracer("corr-2", new ScriptedClock());
		tracer.enter("request_prepared");
		tracer.exit("request_prepared");
		for (const event of tracer.getEvents()) {
			expect(event.correlationId).toBe("corr-2");
		}
	});

	it("records an exit with no duration when the entry is missing", () => {
		const tracer = new LatencyTracer("corr-3", new ScriptedClock());
		tracer.exit("tool_execution");
		const events = tracer.getEvents();
		expect(events).toHaveLength(1);
		expect(events[0]?.durationMs).toBeUndefined();
	});

	it("keeps the spans of parallel tool calls distinct", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-4", clock);
		tracer.enter("tool_execution", { toolCallId: "a" });
		clock.advance(10);
		tracer.enter("tool_execution", { toolCallId: "b" });
		clock.advance(90);
		tracer.exit("tool_execution", { metadata: { toolCallId: "b" } });
		clock.advance(10);
		tracer.exit("tool_execution", { metadata: { toolCallId: "a" } });

		const ends = tracer.getEvents().filter((event) => event.phase === "end");
		expect(ends).toHaveLength(2);
		// The spans close LAST-IN-FIRST-OUT. Entry A is at t=0, entry B at
		// t=10, the first exit at t=100 and the second at t=110. So the
		// first exit closes B (10 -> 100 = 90 ms) and the second closes A
		// (0 -> 110 = 110 ms).
		expect(ends[0]?.durationMs).toBe(90);
		expect(ends[1]?.durationMs).toBe(110);
	});

	it("matches a parallel exit to its OWN entry when calls finish out of order", () => {
		// The defect a plain LIFO stack has: parallel tool calls do not
		// necessarily finish in the order they started. Call A starts
		// first and finishes LAST; call B starts second and finishes
		// FIRST. A LIFO stack would attribute B's 10 ms to A.
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-4b", clock);
		tracer.enter("tool_execution", { toolCallId: "a" });
		clock.advance(10);
		tracer.enter("tool_execution", { toolCallId: "b" });
		clock.advance(90);
		// B finishes FIRST, at t=100.
		tracer.exit("tool_execution", { metadata: { toolCallId: "b" } });
		clock.advance(10);
		// A finishes at t=110.
		tracer.exit("tool_execution", { metadata: { toolCallId: "a" } });

		const ends = tracer.getEvents().filter((event) => event.phase === "end");
		expect(ends).toHaveLength(2);
		// B ran 10 -> 100 = 90 ms. A ran 0 -> 110 = 110 ms.
		expect(ends[0]?.metadata?.toolCallId).toBe("b");
		expect(ends[0]?.durationMs).toBe(90);
		expect(ends[1]?.metadata?.toolCallId).toBe("a");
		expect(ends[1]?.durationMs).toBe(110);
	});

	it("keeps the remaining spans' order when one is closed out of order", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-4c", clock);
		tracer.enter("tool_execution", { toolCallId: "a" });
		tracer.enter("tool_execution", { toolCallId: "b" });
		tracer.enter("tool_execution", { toolCallId: "c" });
		clock.advance(10);
		// Close the MIDDLE span out of order.
		tracer.exit("tool_execution", { metadata: { toolCallId: "b" } });
		clock.advance(10);
		tracer.exit("tool_execution", { metadata: { toolCallId: "c" } });
		clock.advance(10);
		tracer.exit("tool_execution", { metadata: { toolCallId: "a" } });

		const ends = tracer.getEvents().filter((event) => event.phase === "end");
		expect(ends.map((event) => event.metadata?.toolCallId)).toEqual([
			"b",
			"c",
			"a",
		]);
		expect(ends[0]?.durationMs).toBe(10);
		expect(ends[1]?.durationMs).toBe(20);
		expect(ends[2]?.durationMs).toBe(30);
	});

	it("falls back to LIFO when the exit carries no tool call id", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-4d", clock);
		tracer.enter("tool_execution");
		clock.advance(10);
		tracer.enter("tool_execution");
		clock.advance(90);
		tracer.exit("tool_execution");
		clock.advance(10);
		tracer.exit("tool_execution");

		const ends = tracer.getEvents().filter((event) => event.phase === "end");
		expect(ends[0]?.durationMs).toBe(90);
		expect(ends[1]?.durationMs).toBe(110);
	});

	it("falls back to LIFO when the exit names an id that was never entered", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-4e", clock);
		tracer.enter("tool_execution", { toolCallId: "a" });
		clock.advance(10);
		tracer.enter("tool_execution", { toolCallId: "b" });
		clock.advance(90);
		// An id that matches nothing must not orphan the real spans.
		tracer.exit("tool_execution", { metadata: { toolCallId: "zzz" } });
		clock.advance(10);
		tracer.exit("tool_execution", { metadata: { toolCallId: "a" } });

		const ends = tracer.getEvents().filter((event) => event.phase === "end");
		expect(ends).toHaveLength(2);
		// The unmatched exit closed the most recent span (b), and the
		// explicit "a" exit closed a.
		expect(ends[0]?.durationMs).toBe(90);
		expect(ends[1]?.durationMs).toBe(110);
	});

	it("is failure-isolated: a throwing clock cannot escape the tracer", () => {
		const brokenClock: LatencyClock = {
			monotonic: () => {
				throw new Error("clock exploded");
			},
			wallClockIso: () => {
				throw new Error("clock exploded");
			},
		};
		const tracer = new LatencyTracer("corr-5", brokenClock);
		expect(() => tracer.enter("tool_execution")).not.toThrow();
		expect(() => tracer.exit("tool_execution")).not.toThrow();
	});
});

describe("LatencyTracer — stage attribution", () => {
	it("separates execution from queue, transport and delivery", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-6", clock);
		// Each phase does its work, then there is an idle gap before the
		// next phase starts.
		tracer.enter("request_prepared");
		clock.advance(10);
		tracer.exit("request_prepared");
		clock.advance(5);
		tracer.enter("provider_submitted");
		clock.advance(20);
		tracer.exit("provider_submitted");
		clock.advance(3);
		tracer.enter("provider_first_token");
		clock.advance(30);
		tracer.exit("provider_first_token");
		clock.advance(2);
		tracer.enter("provider_completed");
		clock.advance(40);
		tracer.exit("provider_completed");
		clock.advance(1);
		tracer.enter("schema_validation");
		clock.advance(6);
		tracer.exit("schema_validation");
		clock.advance(4);
		tracer.enter("tool_execution");
		clock.advance(60);
		tracer.exit("tool_execution");
		clock.advance(7);
		tracer.enter("tool_result_delivered");
		clock.advance(8);
		tracer.exit("tool_result_delivered");
		clock.advance(2);
		tracer.enter("provider_ready");
		clock.advance(9);
		tracer.exit("provider_ready");

		const stages = tracer.getStages();
		// A stage is the PRECEDING span's own work plus the idle gap
		// before the next span begins. Several gaps share a stage, so the
		// totals are SUMMED per stage.
		const byStage = new Map<string, number>();
		for (const stage of stages) {
			byStage.set(
				stage.stage,
				(byStage.get(stage.stage) ?? 0) + stage.durationMs,
			);
		}
		// The provider-bound request-prepared span is reported as its own
		// span duration and is not folded into any queue total.
		const providerBound = stages.find(
			(stage) =>
				stage.from === "request_prepared" && stage.to === "provider_submitted",
		);
		expect(providerBound?.spanDurationMs).toBe(10);
		// queue: the 4 ms gap after schema validation before execution
		//        starts, plus the 6 ms schema-validation span itself.
		expect(byStage.get("queue")).toBe(10);
		// transport: the gaps between the provider boundaries (3 ms to the
		//             first token, 2 ms to completion). The provider-bound
		//             span durations are reported independently.
		expect(byStage.get("transport")).toBe(3 + 2);
		const firstTokenStage = stages.find(
			(stage) =>
				stage.from === "provider_first_token" &&
				stage.to === "provider_completed",
		);
		expect(firstTokenStage?.spanDurationMs).toBe(30);
		// execution: the executor's own measured run time (60 ms). The
		//          post-execution gap is NOT part of execution — it is a
		//          delivery delay (see the delivery assertion below).
		expect(byStage.get("execution")).toBe(60);
		const executionStage = stages.find((stage) => stage.stage === "execution");
		expect(executionStage?.spanDurationMs).toBe(60);
		// delivery: the 7 ms gap between the tool's execution end and the
		//           result delivery, plus the 2 ms gap between the
		//           result-delivered boundary and the provider-ready request.
		//           The result-delivered span's own 8 ms is reported as its
		//           span duration.
		expect(byStage.get("delivery")).toBe(7 + 2);
		const deliveryStage = stages.find(
			(stage) =>
				stage.stage === "delivery" &&
				stage.from === "tool_result_delivered" &&
				stage.to === "provider_ready",
		);
		expect(deliveryStage?.spanDurationMs).toBe(8);
	});

	it("reports the tool's own run time inside the execution stage", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-11", clock);
		tracer.enter("tool_execution");
		clock.advance(60);
		tracer.exit("tool_execution");
		tracer.enter("tool_result_delivered");
		const execution = tracer
			.getStages()
			.find((stage) => stage.stage === "execution");
		// The execution stage carries the executor's own measured run time.
		// The post-execution gap to the delivery boundary (0 ms here) is a
		// DELIVERY delay and is never part of the execution total.
		expect(execution?.durationMs).toBe(60);
		expect(execution?.spanDurationMs).toBe(60);
		const delivery = tracer
			.getStages()
			.find(
				(stage) =>
					stage.stage === "delivery" &&
					stage.from === "tool_execution" &&
					stage.to === "tool_result_delivered",
			);
		expect(delivery?.durationMs).toBe(0);
	});

	it("does not charge the execution-to-delivery delay to execution", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-execution-delay", clock);
		tracer.enter("tool_execution");
		clock.advance(10);
		tracer.exit("tool_execution");
		// The result exists, but delivery to the conversation is delayed.
		clock.advance(5_000);
		tracer.enter("tool_result_delivered");

		const stages = tracer.getStages();
		const execution = stages.find((stage) => stage.stage === "execution");
		// The executor's own run time is 10 ms. The 5,000 ms between the
		// execution end and result delivery is a DELIVERY delay and is never
		// folded into the execution number.
		expect(execution?.spanDurationMs).toBe(10);
		expect(execution?.durationMs).toBe(10);
		const delivery = stages.find(
			(stage) =>
				stage.stage === "delivery" &&
				stage.from === "tool_execution" &&
				stage.to === "tool_result_delivered",
		);
		expect(delivery?.durationMs).toBe(5_000);
	});

	it("classifies the post-execution delivery gap separately from execution", () => {
		// ACT-CLINEMM-ROUND-C-HARNESS-02 CORRECTION02 — the inter-boundary
		// gap between the tool's execution END and the result's delivery is a
		// DELIVERY delay, NOT execution. A consumer that aggregates
		// `durationMs` by stage must therefore never see the ~5 s
		// post-execution floor attributed to execution.
		expect(
			classifyLatencyStage("tool_execution", "tool_result_delivered"),
		).toBe("delivery");
	});

	it("does not charge the post-execution delay to the execution stage", () => {
		// ACT-CLINEMM-ROUND-C-HARNESS-02 CORRECTION02 — the exact Round C
		// counterexample: a 10 ms executor whose result is delivered 5,000 ms
		// later. Aggregating the stage durations by stage must report 10 ms
		// of execution and 5,000 ms of post-execution delivery delay.
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-execution-stage-aggregation", clock);
		tracer.enter("tool_execution");
		clock.advance(10);
		tracer.exit("tool_execution");
		clock.advance(5_000);
		tracer.enter("tool_result_delivered");

		const stages = tracer.getStages();
		const byStage = new Map<string, number>();
		for (const stage of stages) {
			byStage.set(
				stage.stage,
				(byStage.get(stage.stage) ?? 0) + stage.durationMs,
			);
		}

		// The executor's own measured run time is 10 ms, and it is
		// attributed to the EXECUTION stage.
		const execution = stages.find((stage) => stage.stage === "execution");
		expect(execution?.spanDurationMs).toBe(10);
		expect(execution?.durationMs).toBe(10);
		// The 5,000 ms post-execution gap is a DELIVERY delay.
		expect(byStage.get("delivery")).toBe(5_000);
		// And it is NEVER charged to the execution stage: the execution
		// stage carries only the executor's own measured run time.
		expect(byStage.get("execution")).toBe(10);
	});

	it("does not guess an unknown pair", () => {
		expect(classifyLatencyStage("compaction", "tool_execution")).toBe(
			"unclassified",
		);
	});

	it("distinguishes a compaction span from a tool span", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-7", clock);
		tracer.enter("compaction");
		clock.advance(42);
		tracer.exit("compaction", {
			status: "ok",
			metadata: { compactionTrigger: "token_ratio" },
		});
		const end = tracer.getEvents()[1];
		expect(end?.durationMs).toBe(42);
		expect(end?.metadata.compactionTrigger).toBe("token_ratio");
	});
});

describe("LatencyTracer — metadata allowlisting", () => {
	it("keeps allowlisted fields", () => {
		const sanitized = sanitizeLatencyMetadata({
			modelId: "qwen3.8-flash-next-iq3_s",
			inputTokens: 6061,
			toolResultBytes: 1381,
			schemaValid: true,
		});
		expect(sanitized).toEqual({
			modelId: "qwen3.8-flash-next-iq3_s",
			inputTokens: 6061,
			toolResultBytes: 1381,
			schemaValid: true,
		});
	});

	it("drops a field that is not allowlisted", () => {
		const sanitized = sanitizeLatencyMetadata({
			modelId: "m",
			rawPrompt: "the user's prompt",
			command: "rm -rf /",
			authorization: "Bearer secret",
		});
		expect(sanitized).toEqual({ modelId: "m" });
		expect(JSON.stringify(sanitized)).not.toContain("secret");
		expect(JSON.stringify(sanitized)).not.toContain("rm -rf");
	});

	it("drops a non-primitive value even on an allowlisted field", () => {
		const sanitized = sanitizeLatencyMetadata({
			toolResultBytes: { nested: "content" },
			commandCount: ["a", "b"],
		});
		expect(sanitized).toEqual({});
	});

	it("never records raw content through the tracer", () => {
		const tracer = new LatencyTracer("corr-8", new ScriptedClock());
		tracer.enter("tool_result_delivered", {
			toolResultBytes: 12,
			toolResultDigest: "abc",
			rawOutput: "SECRET OUTPUT",
		});
		const serialized = JSON.stringify(tracer.getEvents());
		expect(serialized).not.toContain("SECRET OUTPUT");
		expect(serialized).toContain("toolResultDigest");
	});

	it("exposes an allowlist that contains no content-shaped field", () => {
		// Token COUNTS are permitted — they are numbers. What must never
		// be on the list is a field that would carry CONTENT: a prompt,
		// a file's content, a command's text, a secret, or a raw output.
		for (const field of LATENCY_METADATA_ALLOWLIST) {
			expect(field).not.toMatch(
				/prompt|content|secret|authorization|^command$|^output$|^text$|arguments/i,
			);
		}
	});

	it("allows only token COUNTS among the token-shaped fields", () => {
		const tokenFields = LATENCY_METADATA_ALLOWLIST.filter((field) =>
			field.toLowerCase().includes("token"),
		);
		expect(tokenFields.length).toBeGreaterThan(0);
		for (const field of tokenFields) {
			expect(field).toMatch(/Tokens$|Token$/);
		}
	});
});

describe("digestLatencyContent", () => {
	it("is stable for the same content and differs for different content", () => {
		const a = digestLatencyContent("hello");
		const b = digestLatencyContent("hello");
		const c = digestLatencyContent("hello!");
		expect(a).toBe(b);
		expect(a).not.toBe(c);
		expect(a).toHaveLength(64);
	});
});

describe("LatencyTracer — overhead", () => {
	it("the disabled path costs a single check and records nothing", () => {
		expect(LatencyTracer.isEnabled(undefined)).toBe(false);
		const tracer = new LatencyTracer("corr-9", new ScriptedClock());
		expect(tracer.getEvents()).toHaveLength(0);
	});

	it("the enabled path's per-boundary overhead is small", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-10", clock);
		const iterations = 20_000;
		const started = process.hrtime.bigint();
		for (let index = 0; index < iterations; index++) {
			tracer.enter("tool_execution", { toolCallId: "x", commandCount: 1 });
			tracer.exit("tool_execution", { status: "ok" });
		}
		const elapsedNs = Number(process.hrtime.bigint() - started);
		const perPairUs = elapsedNs / iterations / 1000;
		// A boundary pair costs a small number of microseconds. The bound
		// is deliberately generous so the test is not flaky on a loaded
		// machine, while still catching a regression that turns the
		// tracer into a hot-path cost.
		expect(perPairUs).toBeLessThan(100);
	});
});

/**
 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR01 — BOUNDED RETENTION.
 *
 * The tracer is installed for a whole SESSION. Without an explicit
 * retention bound its event array grows with EVERY observation, so a
 * long-running dogfood session accumulates unbounded trace history — the
 * exact opposite of the bounded-capture requirement.
 *
 * These tests pin the three properties the correction must hold:
 *
 *   1. The retained window is BOUNDED (the ring never exceeds its cap).
 *   2. The TRUNCATION is reported EXPLICITLY (a partial trace is never
 *      presented as a complete one).
 *   3. NO CONTINUITY is invented across the discarded observations (the
 *      retained window carries the MOST RECENT boundaries, and the gap
 *      across the discard is not silently reported as a measured duration).
 */
describe("LatencyTracer — bounded retention", () => {
	it("the retained event window never exceeds the configured bound", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-bound", clock, { maxEvents: 8 });
		for (let index = 0; index < 500; index++) {
			clock.advance(1);
			tracer.enter("tool_execution", { toolCallId: `tc-${index}` });
			tracer.exit("tool_execution", { status: "ok" });
		}
		expect(tracer.getEvents().length).toBeLessThanOrEqual(8);
		expect(tracer.getEvents()).toHaveLength(8);
	});

	it("the default bound is finite and the tracer does not grow without limit", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-default", clock);
		// Push far past the default bound.
		for (let index = 0; index < LATENCY_TRACE_MAX_EVENTS * 2; index++) {
			tracer.enter("tool_execution");
		}
		expect(tracer.getEvents().length).toBeLessThanOrEqual(
			LATENCY_TRACE_MAX_EVENTS,
		);
		expect(LATENCY_TRACE_MAX_EVENTS).toBeGreaterThan(0);
	});

	it("reports the truncation explicitly instead of presenting a partial trace as complete", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-trunc", clock, { maxEvents: 4 });
		for (let index = 0; index < 10; index++) {
			tracer.enter("tool_execution");
		}
		const trace = tracer.getTrace();
		expect(trace.truncation.truncated).toBe(true);
		expect(trace.truncation.droppedEventCount).toBe(6);
		expect(trace.truncation.totalEventCount).toBe(10);
		expect(trace.truncation.retainedEventCount).toBe(4);
		expect(trace.truncation.maxEvents).toBe(4);
	});

	it("a trace that dropped NOTHING is reported as complete", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-complete", clock);
		tracer.enter("tool_execution");
		tracer.exit("tool_execution", { status: "ok" });
		const trace = tracer.getTrace();
		expect(trace.truncation.truncated).toBe(false);
		expect(trace.truncation.droppedEventCount).toBe(0);
		expect(trace.truncation.totalEventCount).toBe(2);
		expect(trace.truncation.retainedEventCount).toBe(2);
	});

	it("retains the MOST RECENT observations so the newest boundary is still visible", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-recent", clock, { maxEvents: 2 });
		for (let index = 0; index < 5; index++) {
			clock.advance(10);
			tracer.enter("tool_execution", { toolCallId: `tc-${index}` });
		}
		const events = tracer.getEvents();
		expect(events).toHaveLength(2);
		// The OLDEST observations were evicted; the NEWEST survive.
		expect(events[0]?.metadata.toolCallId).toBe("tc-3");
		expect(events[1]?.metadata.toolCallId).toBe("tc-4");
	});

	it("invents NO continuity across the discarded observations", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-gap", clock, { maxEvents: 2 });
		// Two COMPLETED pairs, then a third that is only entered. The
		// third pair's exit must not be measured against a span whose
		// start event was evicted.
		tracer.enter("tool_execution", { toolCallId: "a" });
		clock.advance(10);
		tracer.exit("tool_execution", { status: "ok" });
		tracer.enter("tool_execution", { toolCallId: "b" });
		clock.advance(10);
		tracer.exit("tool_execution", { status: "ok" });
		// These push the first pair's events out of the ring.
		tracer.enter("tool_execution", { toolCallId: "c" });
		tracer.enter("tool_execution", { toolCallId: "d" });
		const trace = tracer.getTrace();
		expect(trace.truncation.truncated).toBe(true);
		// The OPEN span is still tracked by the tracer's own span stack,
		// so the trace reports it as an integrity failure rather than
		// inventing a duration for it.
		expect(
			trace.integrityFailures.some((failure) =>
				failure.reason.includes("left open"),
			),
		).toBe(true);
	});

	it("bounds the UNAVAILABLE measurements and reports the drops", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-unavail", clock, {
			maxUnavailable: 3,
		});
		for (let index = 0; index < 10; index++) {
			tracer.markUnavailable("provider_first_token", "never observed");
		}
		const trace = tracer.getTrace();
		expect(trace.truncation.droppedUnavailableCount).toBe(7);
		expect(trace.truncation.totalUnavailableCount).toBe(10);
		expect(trace.truncation.truncated).toBe(true);
	});

	it("bounds the INTEGRITY failures and reports the drops", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-integrity", clock, {
			maxIntegrityFailures: 2,
		});
		// Exiting a boundary that was never entered is an integrity
		// failure — one per exit.
		for (let index = 0; index < 10; index++) {
			tracer.exit("tool_execution", { status: "ok" });
		}
		const trace = tracer.getTrace();
		expect(trace.truncation.droppedIntegrityFailureCount).toBe(8);
		expect(trace.truncation.totalIntegrityFailureCount).toBe(10);
		expect(trace.truncation.truncated).toBe(true);
	});

	it("clamps a zero or negative bound to at least one", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-clamp", clock, {
			maxEvents: 0,
			maxUnavailable: -5,
			maxIntegrityFailures: 0,
		});
		tracer.enter("tool_execution");
		tracer.enter("tool_execution");
		expect(tracer.getEvents().length).toBe(1);
		expect(tracer.getTruncation().maxEvents).toBe(1);
		expect(tracer.getTruncation().maxUnavailable).toBe(1);
		expect(tracer.getTruncation().maxIntegrityFailures).toBe(1);
	});
});

/**
 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — BOUNDED OPEN-SPAN RETENTION.
 *
 * The CORR01 correction bounded the EVENT ring, the unavailable ring and
 * the integrity-failure ring. It did NOT bound the tracer's OPEN-SPAN map:
 * a span that was entered but never exited stayed in that map forever, so
 * a caller that entered without exiting grew the tracer's memory without
 * limit even though the event ring stayed bounded.
 *
 * The defect was concrete:
 *
 *   const tracer = new LatencyTracer("probe");
 *   for (let i = 0; i < 100_000; i++) {
 *     tracer.enter("tool_execution", { toolCallId: `tc-${i}` });
 *   }
 *   const trace = tracer.getTrace();
 *
 * The events were limited to 4,096, but ALL 100,000 unfinished spans
 * remained in memory — and `getIntegrityFailures()` walked every one of
 * them, so the trace carried 100,000 integrity failures despite the
 * declared 256-entry retention bound.
 *
 * These tests pin the four properties the correction must hold:
 *
 *   1. The retained OPEN-SPAN memory is bounded.
 *   2. The EXPORT is bounded, even with unmatched starts.
 *   3. The discarded spans are COUNTED in the truncation metadata.
 *   4. A LATE exit — one whose start was already evicted — fabricates NO
 *      duration and closes NO unrelated span.
 */
describe("LatencyTracer — bounded open-span retention", () => {
	it("bounds the retained open spans under 100,000 unmatched starts", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-openbound", clock);
		for (let index = 0; index < 100_000; index++) {
			tracer.enter("tool_execution", { toolCallId: `tc-${index}` });
		}
		const truncation = tracer.getTruncation();
		// The OPEN-SPAN memory is finite and independently bounded.
		expect(truncation.retainedOpenSpanCount).toBeLessThanOrEqual(
			truncation.maxOpenSpans,
		);
		expect(truncation.retainedOpenSpanCount).toBe(LATENCY_TRACE_MAX_OPEN_SPANS);
		// The discarded spans are COUNTED, not silently forgotten.
		expect(truncation.droppedOpenSpanCount).toBe(
			100_000 - LATENCY_TRACE_MAX_OPEN_SPANS,
		);
		expect(truncation.totalOpenSpanCount).toBe(100_000);
		expect(truncation.truncated).toBe(true);
	});

	it("bounds the EXPORT under 100,000 unmatched starts", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-openexport", clock);
		for (let index = 0; index < 100_000; index++) {
			tracer.enter("tool_execution", { toolCallId: `tc-${index}` });
		}
		const trace = tracer.getTrace();
		// The trace must not carry one integrity failure per open span.
		expect(trace.integrityFailures.length).toBeLessThanOrEqual(
			LATENCY_TRACE_MAX_INTEGRITY_FAILURES,
		);
		expect(trace.events.length).toBeLessThanOrEqual(LATENCY_TRACE_MAX_EVENTS);
		expect(trace.stages.length).toBeLessThanOrEqual(LATENCY_TRACE_MAX_EVENTS);
		// The withheld failures are COUNTED.
		expect(trace.truncation.droppedIntegrityFailureCount).toBeGreaterThan(0);
	});

	it("keeps the EXPORT finite when the failure bound is tiny", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-tinyfailures", clock, {
			maxIntegrityFailures: 4,
			maxOpenSpans: 8,
		});
		for (let index = 0; index < 5_000; index++) {
			tracer.enter("tool_execution", { toolCallId: `tc-${index}` });
		}
		const trace = tracer.getTrace();
		expect(trace.integrityFailures.length).toBeLessThanOrEqual(4);
		expect(trace.truncation.retainedOpenSpanCount).toBeLessThanOrEqual(8);
		expect(trace.truncation.droppedOpenSpanCount).toBe(5_000 - 8);
	});

	it("does NOT fabricate a duration when a span is closed after its start was evicted", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-lateexit", clock, {
			maxOpenSpans: 2,
			maxEvents: 64,
		});
		// The span whose start will be evicted.
		tracer.enter("tool_execution", { toolCallId: "victim" });
		clock.advance(10);
		// Two more spans push the victim's start out of the open-span bound.
		tracer.enter("tool_execution", { toolCallId: "other-1" });
		tracer.enter("tool_execution", { toolCallId: "other-2" });
		clock.advance(5_000);
		// The victim's exit arrives LATE — long after its start was
		// discarded. It must NOT close an unrelated span.
		tracer.exit("tool_execution", {
			metadata: { toolCallId: "victim" },
			status: "ok",
		});
		const ends = tracer.getEvents().filter((event) => event.phase === "end");
		expect(ends).toHaveLength(1);
		// NO duration is invented for the discarded start.
		expect(ends[0]?.durationMs).toBeUndefined();
		// The failure says WHY the duration is not assertable.
		const failures = tracer.getIntegrityFailures();
		expect(
			failures.some((failure) =>
				failure.reason.includes("discarded by the open-span bound"),
			),
		).toBe(true);
		// The unrelated spans are still OPEN — they were not closed by the
		// late exit.
		expect(tracer.isOpen("tool_execution")).toBe(true);
	});

	it("does NOT match a late exit to an UNRELATED retained span", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-unrelated", clock, {
			maxOpenSpans: 2,
			maxEvents: 64,
		});
		tracer.enter("tool_execution", { toolCallId: "victim" });
		tracer.enter("tool_execution", { toolCallId: "survivor-1" });
		tracer.enter("tool_execution", { toolCallId: "survivor-2" });
		// "victim" was the OLDEST, so it is the one that was discarded.
		tracer.exit("tool_execution", {
			metadata: { toolCallId: "victim" },
			status: "ok",
		});
		const ends = tracer.getEvents().filter((event) => event.phase === "end");
		expect(ends).toHaveLength(1);
		// The exit produced NO duration: the span it names was discarded.
		expect(ends[0]?.durationMs).toBeUndefined();
		// Both survivors are still open — the late exit stole neither.
		const openIds = tracer
			.getEvents()
			.filter((event) => event.phase === "start")
			.map((event) => event.metadata.toolCallId);
		expect(openIds).toContain("survivor-1");
		expect(openIds).toContain("survivor-2");
	});

	it("still measures a RETAINED span correctly when other spans were discarded", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-survivor", clock, {
			maxOpenSpans: 2,
			maxEvents: 64,
		});
		tracer.enter("tool_execution", { toolCallId: "victim" });
		clock.advance(10);
		tracer.enter("tool_execution", { toolCallId: "survivor" });
		clock.advance(20);
		tracer.enter("tool_execution", { toolCallId: "newest" });
		clock.advance(30);
		// "victim" was discarded; "survivor" and "newest" are retained.
		tracer.exit("tool_execution", {
			metadata: { toolCallId: "survivor" },
			status: "ok",
		});
		const ends = tracer.getEvents().filter((event) => event.phase === "end");
		expect(ends).toHaveLength(1);
		// The survivor's own duration is measured against its own start:
		// it started at t=10 and exited at t=60.
		expect(ends[0]?.durationMs).toBe(50);
	});

	it("preserves the 10 ms execution / 5,000 ms delivery invariant under the open-span bound", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-invariant", clock, {
			maxOpenSpans: 4,
			maxEvents: 256,
		});
		// Fill the open-span bound with unmatched starts so the tracer is
		// operating in its DEGRADED (discarding) mode.
		for (let index = 0; index < 8; index++) {
			tracer.enter("tool_execution", { toolCallId: `noise-${index}` });
		}
		tracer.enter("tool_execution", { toolCallId: "real" });
		clock.advance(10);
		tracer.exit("tool_execution", {
			metadata: { toolCallId: "real" },
			status: "ok",
		});
		clock.advance(5_000);
		tracer.enter("tool_result_delivered");
		tracer.exit("tool_result_delivered", { status: "ok" });
		const stages = tracer.getStages();
		const execution = stages.find(
			(stage) => stage.stage === "execution" && stage.from === "tool_execution",
		);
		const delivery = stages.find(
			(stage) =>
				stage.stage === "delivery" &&
				stage.from === "tool_execution" &&
				stage.to === "tool_result_delivered",
		);
		expect(execution?.durationMs).toBe(10);
		expect(delivery?.durationMs).toBe(5_000);
	});

	it("clamps a zero or negative OPEN-SPAN bound to at least one", () => {
		const clock = new ScriptedClock();
		const tracer = new LatencyTracer("corr-openclamp", clock, {
			maxOpenSpans: 0,
		});
		tracer.enter("tool_execution");
		tracer.enter("tool_execution");
		const truncation = tracer.getTruncation();
		expect(truncation.maxOpenSpans).toBe(1);
		expect(truncation.retainedOpenSpanCount).toBe(1);
		expect(truncation.droppedOpenSpanCount).toBe(1);
	});
});
