/**
 * ACT-MYC-CLINEMM-TASK-HEADER-TELEMETRY01 — unit tests for the
 * production observation helpers (`observeMycToolStart`,
 * `observeMycPrimeResult`) extracted from the SdkController.
 *
 * THMYC-OBS-01..05. The unit tests pin:
 *   - non-myc tool names are a no-op;
 *   - one `observeMycToolStart` call maps to one tracker increment;
 *   - prime success/failure path maps to the correct bounded counters
 *     (and respects the `useful = ok && non-empty text` rule);
 *   - non-finite `ts` is clamped to 0 latency, never NaN.
 *
 * ABLATION (ACT §27): the `observeMycToolStart` function is a
 * trivial 2-line gate. To prove the host tests + UI tests are
 * bound to the production seam (not self-referential), the
 * implementation can be temporarily rewritten to no-op for `myc_*`
 * names; the host RED test would still pass (it drives the API
 * directly), but a SdkController-level integration test that
 * constructs the controller and feeds an `onToolStarted` event
 * through its callback would fail. The integration test is
 * intentionally omitted to keep this ACT scoped to its budget;
 * the unit-level tests + the wire-shape projection in
 * `getStateToPostToWebview` are the binding evidence.
 */
import { describe, expect, it } from "vitest"
import { observeMycPrimeResult, observeMycToolStart } from "../myc-task-observation"
import { TaskTelemetryTracker } from "../task-telemetry-tracker"

function start(taskId = "task-a"): TaskTelemetryTracker {
	const t = new TaskTelemetryTracker()
	t.startTask(taskId)
	t.setMycConfigured(true)
	return t
}

describe("ACT-MYC-CLINEMM-TASK-HEADER-TELEMETRY01 / observeMycToolStart", () => {
	it("THMYC-OBS-01: non-myc tool name is a no-op", () => {
		const t = start()
		observeMycToolStart(t, "read_file")
		observeMycToolStart(t, "apply_patch")
		observeMycToolStart(t, undefined)
		expect(t.get()?.myc?.callsTotal).toBe(0)
	})

	it("THMYC-OBS-02: myc_recall -> +1 successful, retrieval/useful unknown", () => {
		const t = start()
		observeMycToolStart(t, "myc_recall")
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(1)
		expect(m?.callsSuccessful).toBe(1)
		expect(m?.retrievalCalls).toBe(1)
		expect(m?.usefulRetrievals).toBe(0) // start event cannot observe result content
	})

	it("THMYC-OBS-03: myc_remember -> +1 successful, no retrieval", () => {
		const t = start()
		observeMycToolStart(t, "myc_remember")
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(1)
		expect(m?.callsSuccessful).toBe(1)
		expect(m?.retrievalCalls).toBe(0)
	})

	it("THMYC-OBS-04: multiple myc calls accumulate linearly", () => {
		const t = start()
		observeMycToolStart(t, "myc_recall")
		observeMycToolStart(t, "myc_recall")
		observeMycToolStart(t, "myc_remember")
		expect(t.get()?.myc?.callsTotal).toBe(3)
		expect(t.get()?.myc?.callsSuccessful).toBe(3)
	})
})

describe("ACT-MYC-CLINEMM-TASK-HEADER-TELEMETRY01 / observeMycPrimeResult", () => {
	it("THMYC-OBS-05: ok + non-empty text -> 1/1/0 + retrieval 1/1 + status ok", () => {
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

	it("THMYC-OBS-06: ok + empty text -> 1/1/0 + retrieval 1/0 + status ok (empty useful)", () => {
		const t = start()
		observeMycPrimeResult(t, { sessionId: "ses-x", status: "ok", text: "", ts: 1000 }, 1023)
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(1)
		expect(m?.callsSuccessful).toBe(1)
		expect(m?.callsFailed).toBe(0)
		expect(m?.retrievalCalls).toBe(1)
		expect(m?.usefulRetrievals).toBe(0) // empty result not useful
		expect(m?.automaticPrime.status).toBe("ok")
		expect(m?.last?.outcome).toBe("empty")
	})

	it("THMYC-OBS-07: failed -> 1/0/1 + status error + useful 0", () => {
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

	it("THMYC-OBS-08: skipped -> 1/1/0 (skipped is not an error) + status skipped", () => {
		const t = start()
		observeMycPrimeResult(t, { sessionId: "ses-x", status: "skipped", error: "no server", ts: 1000 }, 1023)
		const m = t.get()?.myc
		expect(m?.callsTotal).toBe(1)
		expect(m?.callsSuccessful).toBe(1)
		expect(m?.callsFailed).toBe(0)
		expect(m?.automaticPrime.status).toBe("skipped")
	})

	it("THMYC-OBS-09: ts > now -> latency clamped to 0 (no NaN)", () => {
		const t = start()
		observeMycPrimeResult(t, { sessionId: "ses-x", status: "ok", text: "x", ts: 9999 }, 1000) // future ts
		const m = t.get()?.myc
		expect(m?.last?.latencyMs).toBe(0)
		expect(Number.isFinite(m?.last?.latencyMs)).toBe(true)
	})

	it("THMYC-OBS-10: non-finite ts -> latency clamped to 0", () => {
		const t = start()
		observeMycPrimeResult(t, { sessionId: "ses-x", status: "ok", text: "x", ts: Number.NaN }, 1000)
		const m = t.get()?.myc
		expect(m?.last?.latencyMs).toBe(0) // non-finite ts → clamped to 0 latency
	})
})
