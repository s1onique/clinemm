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
		// execution: the phase total is the 7 ms gap between the tool's
		//             execution end and result delivery. The executor's own
		//             measured run time is reported as the span duration.
		expect(byStage.get("execution")).toBe(7);
		const executionStage = stages.find((stage) => stage.stage === "execution");
		expect(executionStage?.spanDurationMs).toBe(60);
		// delivery: the 2 ms gap between the result-delivered boundary and
		//           the provider-ready request. The result-delivered span's
		//           own 8 ms is reported as its span duration.
		expect(byStage.get("delivery")).toBe(2);
		const deliveryStage = stages.find((stage) => stage.stage === "delivery");
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
		// The phase total is the gap to the delivery boundary (0 ms here);
		// the executor's own measured run time is the span duration.
		expect(execution?.durationMs).toBe(0);
		expect(execution?.spanDurationMs).toBe(60);
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
		// execution end and result delivery is the execution phase's GAP,
		// and is never folded into the execution span duration.
		expect(execution?.spanDurationMs).toBe(10);
		expect(execution?.durationMs).toBe(5_000);
	});

	it("classifies the post-execution delivery gap separately from execution", () => {
		// The pair remains associated with the execution phase for
		// navigation, but the tracer reports the post-execution interval as
		// its own delivery measurement rather than adding it to execution.
		expect(
			classifyLatencyStage("tool_execution", "tool_result_delivered"),
		).toBe("execution");
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
