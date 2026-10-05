/**
 * ACT-MYC-CLINEMM-TASK-HEADER-TELEMETRY01 — RED tests for the
 * per-task myc telemetry state on `TaskTelemetryTracker`.
 *
 * THMYC-HOST-01..15. ACT §6 counter semantics: callsTotal,
 * callsSuccessful, callsFailed, retrievalCalls, usefulRetrievals,
 * automaticPrime.{attempted, status}.
 *
 * No backend telemetry is added. No new env var. No protocol change.
 */
import { describe, expect, it } from "vitest"
import { TaskTelemetryTracker } from "../task-telemetry-tracker"

function start(taskId = "task-a"): TaskTelemetryTracker {
	const t = new TaskTelemetryTracker()
	t.startTask(taskId)
	return t
}

describe("ACT-MYC-CLINEMM-TASK-HEADER-TELEMETRY01 / host tracker", () => {
	it("THMYC-HOST-01: new task -> configured=false, zero counts, automaticPrime.idle", () => {
		const t = start("task-a")
		const m = t.get()?.myc
		expect(m).toBeDefined()
		expect(m?.configured).toBe(false)
		expect(m?.callsTotal).toBe(0)
		expect(m?.callsSuccessful).toBe(0)
		expect(m?.callsFailed).toBe(0)
		expect(m?.retrievalCalls).toBe(0)
		expect(m?.usefulRetrievals).toBe(0)
		expect(m?.automaticPrime.status).toBe("idle")
		expect(m?.automaticPrime.attempted).toBe(false)
		expect(m?.last).toBeUndefined()
	})

	it("THMYC-HOST-02: automatic prime success -> 1/1 ok; non-empty -> retrieval/useful +1", () => {
		const t = start("task-a")
		t.setMycConfigured(true)
		t.recordMycToolCall("myc", "myc_prime", "success", 18, true)
		t.recordMycPrimeStatus("ok")
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(1)
		expect(m?.callsSuccessful).toBe(1)
		expect(m?.callsFailed).toBe(0)
		expect(m?.retrievalCalls).toBe(1)
		expect(m?.usefulRetrievals).toBe(1)
		expect(m?.automaticPrime.status).toBe("ok")
		expect(m?.automaticPrime.attempted).toBe(true)
	})

	it("THMYC-HOST-03: prime failure -> 1/0/1; status=error; retrieval +1, useful 0", () => {
		const t = start("task-a")
		t.setMycConfigured(true)
		t.recordMycToolCall("myc", "myc_prime", "error", 12, false)
		t.recordMycPrimeStatus("failed")
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(1)
		expect(m?.callsSuccessful).toBe(0)
		expect(m?.callsFailed).toBe(1)
		expect(m?.retrievalCalls).toBe(1)
		expect(m?.usefulRetrievals).toBe(0)
		expect(m?.automaticPrime.status).toBe("error")
	})

	it("THMYC-HOST-04: useful recall -> all four counters +1", () => {
		const t = start("task-a")
		t.setMycConfigured(true)
		t.recordMycToolCall("myc", "myc_recall", "success", 24, true)
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(1)
		expect(m?.callsSuccessful).toBe(1)
		expect(m?.retrievalCalls).toBe(1)
		expect(m?.usefulRetrievals).toBe(1)
	})

	it("THMYC-HOST-05: empty recall -> successful+total+retrieval +1; useful unchanged", () => {
		const t = start("task-a")
		t.setMycConfigured(true)
		t.recordMycToolCall("myc", "myc_recall", "success", 22, false)
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(1)
		expect(m?.callsSuccessful).toBe(1)
		expect(m?.retrievalCalls).toBe(1)
		expect(m?.usefulRetrievals).toBe(0)
	})

	it("THMYC-HOST-06: successful remember -> successful/total +1; retrieval/useful unchanged", () => {
		const t = start("task-a")
		t.setMycConfigured(true)
		t.recordMycToolCall("myc", "myc_remember", "success", 9, false)
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(1)
		expect(m?.callsSuccessful).toBe(1)
		expect(m?.callsFailed).toBe(0)
		expect(m?.retrievalCalls).toBe(0)
		expect(m?.usefulRetrievals).toBe(0)
	})

	it("THMYC-HOST-07: new task identity resets all myc counters (and configured stays as-is)", () => {
		const t = start("task-a")
		t.setMycConfigured(true)
		t.recordMycToolCall("myc", "myc_recall", "success", 22, true)
		t.recordMycToolCall("myc", "myc_recall", "success", 22, false)
		expect(t.get()?.myc?.callsTotal).toBe(2)
		t.startTask("task-b")
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(0)
		expect(m?.callsSuccessful).toBe(0)
		expect(m?.callsFailed).toBe(0)
		expect(m?.retrievalCalls).toBe(0)
		expect(m?.usefulRetrievals).toBe(0)
		expect(m?.automaticPrime.status).toBe("idle")
		expect(m?.automaticPrime.attempted).toBe(false)
		// configured is independent of counters; the next prime observation
		// will re-set it via setMycConfigured (or it remains true if the
		// host chose not to reset on task change). This is a defensive
		// simplification: the wire strip renders `myc 0` either way.
	})

	it("THMYC-HOST-08: non-myc MCP operation does NOT increment myc counters", () => {
		const t = start("task-a")
		t.setMycConfigured(true)
		t.recordMycToolCall("not-myc", "any_tool", "success", 5, false)
		t.recordMycToolCall("github", "create_issue", "success", 30, false)
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(0)
		expect(m?.callsSuccessful).toBe(0)
	})

	it("THMYC-HOST-09: observer-style API; dedup is upstream (pin cardinality surface)", () => {
		const t = start("task-a")
		t.setMycConfigured(true)
		// Recording the same call twice is allowed at this API
		// surface (the host API is per-call). Real dedup is
		// upstream: SdkController wires the McpHub observer and the
		// prime helper to fire recordMycToolCall exactly once per
		// call. This test pins that the wire stays coherent.
		t.recordMycToolCall("myc", "myc_prime", "success", 12, true)
		t.recordMycToolCall("myc", "myc_prime", "success", 12, true)
		expect(t.get()?.myc?.callsTotal).toBe(2)
		expect(t.get()?.myc?.callsSuccessful).toBe(2)
	})

	it("THMYC-HOST-10: configured bit tracks setMycConfigured", () => {
		const t = start("task-a")
		expect(t.get()?.myc?.configured).toBe(false)
		t.setMycConfigured(true)
		expect(t.get()?.myc?.configured).toBe(true)
		t.setMycConfigured(false)
		expect(t.get()?.myc?.configured).toBe(false)
	})

	it("THMYC-HOST-11: clear() zeros myc counters; re-start starts at zero", () => {
		const t = start("task-a")
		t.setMycConfigured(true)
		t.recordMycToolCall("myc", "myc_recall", "success", 1, true)
		t.recordMycPrimeStatus("ok")
		t.clear()
		expect(t.get()).toBeUndefined()
		t.startTask("task-c")
		expect(t.get()?.myc?.callsTotal).toBe(0)
		expect(t.get()?.myc?.automaticPrime.status).toBe("idle")
	})

	it("THMYC-HOST-12: counters remain finite non-negative integers", () => {
		const t = start("task-a")
		t.setMycConfigured(true)
		for (let i = 0; i < 10; i++) {
			t.recordMycToolCall("myc", "myc_recall", "success", 1, true)
		}
		const m = t.get()?.myc
		expect(Number.isFinite(m?.callsTotal)).toBe(true)
		expect((m?.callsTotal ?? 0) >= 0).toBe(true)
		expect((m?.callsTotal ?? 0) <= Number.MAX_SAFE_INTEGER).toBe(true)
	})

	it("THMYC-HOST-13: before startTask, get() returns undefined (whole strip absent)", () => {
		const t = new TaskTelemetryTracker()
		expect(t.get()).toBeUndefined()
	})

	it("THMYC-HOST-14: myc field is present when a task is started (even with zero activity)", () => {
		const t = start("task-a")
		expect(t.get()?.myc).toBeDefined()
	})

	it("THMYC-HOST-15: automaticPrime.attempted toggles on first recordMycPrimeStatus", () => {
		const t = start("task-a")
		expect(t.get()?.myc?.automaticPrime.attempted).toBe(false)
		t.recordMycPrimeStatus("skipped")
		expect(t.get()?.myc?.automaticPrime.status).toBe("skipped")
		expect(t.get()?.myc?.automaticPrime.attempted).toBe(true)
	})
})
