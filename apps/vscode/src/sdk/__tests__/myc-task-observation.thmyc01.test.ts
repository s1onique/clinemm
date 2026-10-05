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
	it("THMYC-OBS-02: successful myc_recall -> +1 successful, +1 retrieval, useful=0 (caller cannot see body)", () => {
		const t = start()
		observeMcpToolCompletion(t, { toolName: "myc_recall", outcome: "success", latencyMs: 18 })
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(1)
		expect(m?.callsSuccessful).toBe(1)
		expect(m?.callsFailed).toBe(0)
		expect(m?.retrievalCalls).toBe(1)
		expect(m?.usefulRetrievals).toBe(0)
	})

	it("THMYC-OBS-03: errored myc_recall -> +1 failed, +0 successful, retrieval still +1 (P1 boundary fix)", () => {
		const t = start()
		observeMcpToolCompletion(t, { toolName: "myc_recall", outcome: "error", latencyMs: 12 })
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(1)
		expect(m?.callsSuccessful).toBe(0)
		expect(m?.callsFailed).toBe(1)
		expect(m?.retrievalCalls).toBe(1)
		expect(m?.usefulRetrievals).toBe(0)
	})

	it("THMYC-OBS-04: non-myc completion event is a no-op", () => {
		const t = start()
		observeMcpToolCompletion(t, { toolName: "read_file", outcome: "success" })
		observeMcpToolCompletion(t, { toolName: "create_issue", outcome: "error" })
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(0)
		expect(m?.callsSuccessful).toBe(0)
		expect(m?.callsFailed).toBe(0)
	})

	it("THMYC-OBS-05: useful=true is honored when caller supplies it (rare — body-aware callers)", () => {
		const t = start()
		observeMcpToolCompletion(t, { toolName: "myc_recall", outcome: "success", latencyMs: 20 }, true)
		const m = t.get()?.myc
		expect(m?.usefulRetrievals).toBe(1)
		expect(m?.callsSuccessful).toBe(1)
	})

	it("THMYC-OBS-06: myc_remember (mutation) -> +1 successful, retrieval unchanged, useful unchanged", () => {
		const t = start()
		observeMcpToolCompletion(t, { toolName: "myc_remember", outcome: "success" })
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(1)
		expect(m?.callsSuccessful).toBe(1)
		expect(m?.retrievalCalls).toBe(0)
		expect(m?.usefulRetrievals).toBe(0)
	})
})

describe("ACT-MYC-CLINEMM-TASK-HEADER-TELEMETRY01 / observeMycPrimeResult", () => {
	it("THMYC-OBS-07: ok + non-empty text -> 1/1/0 + retrieval 1/1 + status ok + useful +1", () => {
		const t = start()
		observeMycPrimeResult(t, { sessionId: "ses-x", status: "ok", text: "hello", ts: 1000 }, 1023)
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(1)
		expect(m?.callsSuccessful).toBe(1)
		expect(m?.callsFailed).toBe(0)
		expect(m?.retrievalCalls).toBe(1)
		expect(m?.usefulRetrievals).toBe(1)
		expect(m?.automaticPrime.status).toBe("ok")
		expect(m?.automaticPrime.attempted).toBe(true)
		expect(m?.last?.operation).toBe("prime")
		expect(m?.last?.outcome).toBe("success")
		expect(m?.last?.latencyMs).toBe(23)
	})

	it("THMYC-OBS-08: ok + empty text -> 1/1/0 + retrieval 1/0 + status ok (empty useful)", () => {
		const t = start()
		observeMycPrimeResult(t, { sessionId: "ses-x", status: "ok", text: "", ts: 1000 }, 1023)
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(1)
		expect(m?.callsSuccessful).toBe(1)
		expect(m?.callsFailed).toBe(0)
		expect(m?.retrievalCalls).toBe(1)
		expect(m?.usefulRetrievals).toBe(0)
		expect(m?.automaticPrime.status).toBe("ok")
		expect(m?.last?.outcome).toBe("empty")
	})

	it("THMYC-OBS-09: failed -> 1/0/1 + status error + useful 0", () => {
		const t = start()
		observeMycPrimeResult(t, { sessionId: "ses-x", status: "failed", error: "boom", ts: 1000 }, 1023)
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(1)
		expect(m?.callsSuccessful).toBe(0)
		expect(m?.callsFailed).toBe(1)
		expect(m?.retrievalCalls).toBe(1)
		expect(m?.usefulRetrievals).toBe(0)
		expect(m?.automaticPrime.status).toBe("error")
		expect(m?.last?.outcome).toBe("error")
	})

	it("THMYC-OBS-10: skipped -> zero call counters + status skipped (P1-B fix: skipped is not a call)", () => {
		const t = start()
		observeMycPrimeResult(t, { sessionId: "ses-x", status: "skipped", error: "no server", ts: 1000 }, 1023)
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

	it("THMYC-OBS-11: ts > now -> latency clamped to 0 (no NaN)", () => {
		const t = start()
		observeMycPrimeResult(t, { sessionId: "ses-x", status: "ok", text: "x", ts: 9999 }, 1000)
		const m = t.get()?.myc
		expect(m?.last?.latencyMs).toBe(0)
		expect(Number.isFinite(m?.last?.latencyMs)).toBe(true)
	})

	it("THMYC-OBS-12: non-finite ts -> latency clamped to 0", () => {
		const t = start()
		observeMycPrimeResult(t, { sessionId: "ses-x", status: "ok", text: "x", ts: Number.NaN }, 1000)
		const m = t.get()?.myc
		expect(m?.last?.latencyMs).toBe(0)
	})
})
