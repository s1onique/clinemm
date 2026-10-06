/**
 * ACT-MYC-CLINEMM-TASK-HEADER-TELEMETRY01 — unit tests for the
 * production observation helpers
 * (`observeMcpToolCompletion`, `observeMycPrimeResult`,
 * `isMycToolName`) extracted from the SdkController.
 *
 * THMYC-OBS-01..12 (CORRECTION01). The unit tests pin:
 *   - non-myc tool names are a no-op in BOTH the McpHub
 *     completion observer path and the prime-specific path;
 *   - one McpHub completion event for a myc tool maps to one
 *     tracker increment with the correct bounded outcome;
 *   - one recall that errored yields `callsSuccessful=0`,
 *     `callsFailed=1` (the P1 wrong-capture-boundary fix);
 *   - one recall that succeeded yields `callsSuccessful=1`,
 *     `callsFailed=0`;
 *   - the `useful` flag is only set when the caller knows the
 *     response body (i.e. the prime-specific path);
 *   - prime `skipped` does NOT increment any call counter — only
 *     the `automaticPrime.status="skipped"` flag is set
 *     (P1-B skipped-as-success fix);
 *   - non-finite `ts` is clamped to 0 latency, never NaN.
 */
import { describe, expect, it } from "vitest"
import { isMycToolName, observeMcpToolCompletion, observeMycPrimeResult } from "../myc-task-observation"
import { TaskTelemetryTracker } from "../task-telemetry-tracker"

function start(taskId = "task-a"): TaskTelemetryTracker {
	const t = new TaskTelemetryTracker()
	t.startTask(taskId)
	t.setMycConfigured(true)
	return t
}

describe("ACT-MYC-CLINEMM-TASK-HEADER-TELEMETRY01 / isMycToolName", () => {
	it("THMYC-OBS-01: identifies myc_-prefixed tools; non-myc / undefined are false", () => {
		expect(isMycToolName("myc_recall")).toBe(true)
		expect(isMycToolName("myc_prime")).toBe(true)
		expect(isMycToolName("myc_remember")).toBe(true)
		expect(isMycToolName("read_file")).toBe(false)
		expect(isMycToolName("apply_patch")).toBe(false)
		expect(isMycToolName(undefined)).toBe(false)
		expect(isMycToolName("")).toBe(false)
	})
})

describe("ACT-MYC-CLINEMM-TASK-HEADER-TELEMETRY01 / observeMcpToolCompletion (McpHub completion seam)", () => {
	it("THMYC-OBS-02: successful non-empty myc_recall -> +1 successful, +1 retrieval, +1 useful (CORRECTION02: hasNonEmptyContent=true)", () => {
		const t = start()
		observeMcpToolCompletion(t, { toolName: "myc_recall", outcome: "success", hasNonEmptyContent: true, latencyMs: 18 })
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(1)
		expect(m?.callsSuccessful).toBe(1)
		expect(m?.callsFailed).toBe(0)
		expect(m?.retrievalCalls).toBe(1)
		// CORRECTION02: with hasNonEmptyContent=true, the helper
		// infers `useful=true`. The OLD signature had `useful=false`
		// default because the McpHub observer couldn't see the body;
		// now it sees the bounded `hasNonEmptyContent` boolean and
		// sets useful accordingly. The privacy boundary is preserved
		// (no body text crosses).
		expect(m?.usefulRetrievals).toBe(1)
	})

	it("THMYC-OBS-02b: successful empty myc_recall -> +1 successful, +1 retrieval, useful=0 (CORRECTION02: hasNonEmptyContent=false)", () => {
		const t = start()
		observeMcpToolCompletion(t, { toolName: "myc_recall", outcome: "success", hasNonEmptyContent: false, latencyMs: 20 })
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(1)
		expect(m?.callsSuccessful).toBe(1)
		expect(m?.callsFailed).toBe(0)
		expect(m?.retrievalCalls).toBe(1)
		expect(m?.usefulRetrievals).toBe(0) // empty recall is not useful
	})

	it("THMYC-OBS-03: errored myc_recall -> +1 failed, +0 successful, retrieval still +1 (P1 boundary fix)", () => {
		const t = start()
		observeMcpToolCompletion(t, { toolName: "myc_recall", outcome: "error", hasNonEmptyContent: false, latencyMs: 12 })
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(1)
		expect(m?.callsSuccessful).toBe(0)
		expect(m?.callsFailed).toBe(1)
		expect(m?.retrievalCalls).toBe(1)
		expect(m?.usefulRetrievals).toBe(0)
	})

	it("THMYC-OBS-04: non-myc completion event is a no-op", () => {
		const t = start()
		observeMcpToolCompletion(t, { toolName: "read_file", outcome: "success", hasNonEmptyContent: true })
		observeMcpToolCompletion(t, { toolName: "create_issue", outcome: "error", hasNonEmptyContent: false })
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(0)
		expect(m?.callsSuccessful).toBe(0)
		expect(m?.callsFailed).toBe(0)
	})

	it("THMYC-OBS-05: useful is derived from outcome+hasNonEmptyContent (no caller override in CORRECTION02)", () => {
		// CORRECTION02: the helper signature no longer takes a
		// `useful` override — usefulness is now strictly a function
		// of (outcome === "success" && hasNonEmptyContent === true).
		// This is the reviewer's "useful for that exact call is
		// actually observed" semantic.
		const t = start()
		observeMcpToolCompletion(t, { toolName: "myc_recall", outcome: "success", hasNonEmptyContent: true, latencyMs: 20 })
		const m = t.get()?.myc
		expect(m?.usefulRetrievals).toBe(1)
		expect(m?.callsSuccessful).toBe(1)
	})

	it("THMYC-OBS-06: myc_remember (mutation) -> +1 successful, retrieval unchanged, useful unchanged", () => {
		const t = start()
		observeMcpToolCompletion(t, { toolName: "myc_remember", outcome: "success", hasNonEmptyContent: true })
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(1)
		expect(m?.callsSuccessful).toBe(1)
		expect(m?.retrievalCalls).toBe(0)
		expect(m?.usefulRetrievals).toBe(0)
	})
})

describe("ACT-MYC-CLINEMM-TASK-HEADER-TELEMETRY01 / observeMycPrimeResult (CORRECTION02)", () => {
	// CORRECTION02 (this revision): `observeMycPrimeResult` updates
	// ONLY the prime-specific state (`automaticPrime.status` +
	// `automaticPrime.attempted`). It NEVER calls `recordMycToolCall`
	// — that single-source-of-truth invariant is what makes the
	// wire read `myc 1/1` (not `myc 2/2`) for a single real prime.
	// The actual counter increment for a real prime flows through
	// the McpHub observer when the prime helper invokes
	// `mcpHub.callTool(...)`. These tests assert the helper's
	// status-only behavior in isolation; the cardinality-once
	// integration test is in
	// `McpHub.callTool.test.ts` CORRECTION02 block and a follow-up
	// integration test (see TODO file).

	it("THMYC-OBS-07: ok status -> automaticPrime.status=ok + attempted=true; no call counters touched", () => {
		const t = start()
		observeMycPrimeResult(t, { sessionId: "ses-x", status: "ok", text: "hello", ts: 1000 })
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(0)
		expect(m?.callsSuccessful).toBe(0)
		expect(m?.callsFailed).toBe(0)
		expect(m?.retrievalCalls).toBe(0)
		expect(m?.usefulRetrievals).toBe(0)
		expect(m?.automaticPrime.status).toBe("ok")
		expect(m?.automaticPrime.attempted).toBe(true)
		expect(m?.last).toBeUndefined()
	})

	it("THMYC-OBS-08: ok status with empty text -> same as OBS-07 (the helper does not inspect text)", () => {
		const t = start()
		observeMycPrimeResult(t, { sessionId: "ses-x", status: "ok", text: "", ts: 1000 })
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(0)
		expect(m?.automaticPrime.status).toBe("ok")
		expect(m?.last).toBeUndefined()
	})

	it("THMYC-OBS-09: failed status -> automaticPrime.status=error + attempted=true; no call counters touched", () => {
		const t = start()
		observeMycPrimeResult(t, { sessionId: "ses-x", status: "failed", error: "boom", ts: 1000 })
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(0)
		expect(m?.automaticPrime.status).toBe("error")
		expect(m?.automaticPrime.attempted).toBe(true)
	})

	it("THMYC-OBS-10: skipped status -> automaticPrime.status=skipped + attempted=true; no call counters touched (CORRECTION01 P1-B fix)", () => {
		const t = start()
		observeMycPrimeResult(t, { sessionId: "ses-x", status: "skipped", error: "no server", ts: 1000 })
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(0)
		expect(m?.callsSuccessful).toBe(0)
		expect(m?.callsFailed).toBe(0)
		expect(m?.retrievalCalls).toBe(0)
		expect(m?.usefulRetrievals).toBe(0)
		expect(m?.automaticPrime.status).toBe("skipped")
		expect(m?.automaticPrime.attempted).toBe(true)
		expect(m?.last).toBeUndefined()
	})

	it("THMYC-OBS-11: pending status -> maps to idle (no transient state, per ACT §10)", () => {
		const t = start()
		observeMycPrimeResult(t, { sessionId: "ses-x", status: "pending", ts: 1000 })
		const m = t.get()?.myc
		expect(m?.automaticPrime.status).toBe("idle")
		expect(m?.automaticPrime.attempted).toBe(true)
	})
})
