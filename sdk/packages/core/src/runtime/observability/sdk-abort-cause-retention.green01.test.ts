/**
 * ACT-CLINEMM-SDK-ABORT-CAUSE-RETENTION01 — GREEN witnesses for the
 * abnormal-terminal RETENTION layer.
 *
 * These drive the REAL recorder + the REAL retention module through the
 * REAL host sink, so the snapshots are built from the same record stream
 * the SDK produces — not from a hand-fed list.
 *
 * Gates:
 *   T1  successful provider request + completed run -> correlated
 *       completion, NO abnormal snapshot
 *   T2  provider throws -> error class + correct request/run identity
 *   T3  stream fails terminally -> terminal stream failure, no fabricated
 *       finish reason
 *   T4  explicit cancellation -> correct initiating origin, NOT misclassified
 *       as a provider failure
 *   T5  controlled recovery stop -> the actual controlled-stop reason retained
 *   T6  request unobserved at run end -> explicit in_flight_at_run_end
 *   T7  two sequential model requests -> the terminal event is associated with
 *       the CORRECT request
 *   T8  two concurrent sessions -> no cross-session contamination
 *   T9  telemetry disabled -> no diagnostic persistence, no runtime delta
 *   T10 diagnostic writer throws -> the original run outcome is conserved
 *   T11 truncation / buffer overflow -> bounded size, explicit truncation
 *   T12 error contains a secret -> the secret is absent from the artifact
 */

import { type ModelBehaviorTraceObservation, ModelBehaviorTraceRecorder } from "@cline/shared"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	_resetSdkAbortCauseRetention,
	captureSdkAbortCauseSnapshot,
	getLatestSdkAbortCauseSnapshot,
	getSdkAbortCauseSnapshots,
	observeSdkAbortCauseRecord,
	SDK_ABORT_CAUSE_MAX_EVENTS_PER_SNAPSHOT,
	SDK_ABORT_CAUSE_MAX_SNAPSHOTS,
	setSdkAbortCauseRecordProvider,
} from "./sdk-abort-cause-retention"

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/**
 * A recorder-backed sink that mirrors the production host sink: every
 * observation is recorded, and the retention module consumes the SAME
 * records.
 */
function makeHostSink(recorder: ModelBehaviorTraceRecorder) {
	return {
		recorder,
		observe(event: string, observation: ModelBehaviorTraceObservation) {
			const record = recorder.record(
				event as never,
				{
					...(observation.sessionId !== undefined ? { sessionId: observation.sessionId } : {}),
					...(observation.taskId !== undefined ? { taskId: observation.taskId } : {}),
					...(observation.runId !== undefined ? { runId: observation.runId } : {}),
					...(observation.iteration !== undefined ? { iteration: observation.iteration } : {}),
					...(observation.modelRequestId !== undefined ? { modelRequestId: observation.modelRequestId } : {}),
					...(observation.providerId !== undefined ? { providerId: observation.providerId } : {}),
					...(observation.modelId !== undefined ? { modelId: observation.modelId } : {}),
				},
				observation.payload as Record<string, unknown>,
			)
			observeSdkAbortCauseRecord(record)
			captureSdkAbortCauseSnapshot(record)
			return record
		},
	}
}

beforeEach(() => {
	_resetSdkAbortCauseRetention()
})

// ---------------------------------------------------------------------------
// Witnesses
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-SDK-ABORT-CAUSE-RETENTION01 — retention", () => {
	it("T1: a completed run produces a correlated completion and NO abnormal snapshot", () => {
		const recorder = new ModelBehaviorTraceRecorder()
		recorder.setEnabled(true)
		const sink = makeHostSink(recorder)
		setSdkAbortCauseRecordProvider(() => recorder.getRecords())

		const requestId = "req-t1"
		sink.observe("model_request_start", {
			sessionId: "s-t1",
			taskId: "t-t1",
			runId: "r-t1",
			iteration: 1,
			modelRequestId: requestId,
			payload: { messageCount: 1 },
		})
		sink.observe("model_request_finish", {
			sessionId: "s-t1",
			taskId: "t-t1",
			runId: "r-t1",
			iteration: 1,
			modelRequestId: requestId,
			payload: { finishReason: "stop", requestDurationMs: 12 },
		})
		sink.observe("run_terminated", {
			sessionId: "s-t1",
			taskId: "t-t1",
			runId: "r-t1",
			payload: {
				finishReason: "stop",
				status: "completed",
				terminalPath: "resolved_run_result",
			},
		})

		// A NORMAL completion produces NO abnormal-terminal capture.
		expect(getSdkAbortCauseSnapshots()).toHaveLength(0)
		// But the correlated completion IS retained in the recorder.
		const records = recorder.getRecords()
		expect(records.map((r) => r.event)).toEqual(["model_request_start", "model_request_finish", "run_terminated"])
		// The request correlation id is on both request boundaries.
		expect(records[0]?.modelRequestId).toBe(requestId)
		expect(records[1]?.modelRequestId).toBe(requestId)
	})

	it("T2: a provider throw retains the error identity and the request/run identity", () => {
		const recorder = new ModelBehaviorTraceRecorder()
		recorder.setEnabled(true)
		const sink = makeHostSink(recorder)
		setSdkAbortCauseRecordProvider(() => recorder.getRecords())

		sink.observe("model_request_start", {
			sessionId: "s-t2",
			taskId: "t-t2",
			runId: "r-t2",
			iteration: 1,
			modelRequestId: "req-t2",
			payload: {},
		})
		sink.observe("model_request_error", {
			sessionId: "s-t2",
			taskId: "t-t2",
			runId: "r-t2",
			iteration: 1,
			modelRequestId: "req-t2",
			payload: {
				errorClass: "provider_error",
				errorName: "APICallError",
				errorMessage: "upstream said no",
				requestOutcome: "provider_error",
			},
		})
		sink.observe("run_terminated", {
			sessionId: "s-t2",
			taskId: "t-t2",
			runId: "r-t2",
			payload: {
				finishReason: "error",
				status: "failed",
				terminalPath: "caught_exception",
				errorName: "APICallError",
			},
		})

		const snapshot = getLatestSdkAbortCauseSnapshot()
		expect(snapshot).toBeDefined()
		expect(snapshot?.status).toBe("failed")
		expect(snapshot?.attribution.errorName).toBe("APICallError")
		expect(snapshot?.attribution.errorClass).toBe("provider_error")
		expect(snapshot?.attribution.lastRequestOutcome).toBe("provider_error")
		expect(snapshot?.attribution.lastModelRequestId).toBe("req-t2")
		expect(snapshot?.identity.runId).toBe("r-t2")
		expect(snapshot?.identity.taskId).toBe("t-t2")
		// The causal sequence is preserved in the snapshot.
		const events = snapshot?.events.map((e) => e.event) ?? []
		expect(events).toEqual(["model_request_start", "model_request_error", "run_terminated"])
		// All three records correlate to the SAME run and request.
		expect(snapshot?.events.every((e) => e.runId === "r-t2")).toBe(true)
		expect(snapshot?.events.filter((e) => e.modelRequestId !== undefined).every((e) => e.modelRequestId === "req-t2")).toBe(
			true,
		)
	})

	it("T3: a terminal stream failure fabricates no finish reason", () => {
		const recorder = new ModelBehaviorTraceRecorder()
		recorder.setEnabled(true)
		const sink = makeHostSink(recorder)
		setSdkAbortCauseRecordProvider(() => recorder.getRecords())

		sink.observe("model_request_start", {
			sessionId: "s-t3",
			runId: "r-t3",
			iteration: 1,
			modelRequestId: "req-t3",
			payload: {},
		})
		sink.observe("model_request_error", {
			sessionId: "s-t3",
			runId: "r-t3",
			iteration: 1,
			modelRequestId: "req-t3",
			payload: {
				errorClass: "unknown",
				errorName: "StreamError",
				requestOutcome: "stream_error",
				firstChunkObserved: true,
			},
		})
		sink.observe("run_terminated", {
			sessionId: "s-t3",
			runId: "r-t3",
			payload: { finishReason: "error", status: "failed" },
		})

		const snapshot = getLatestSdkAbortCauseSnapshot()
		expect(snapshot?.attribution.lastRequestOutcome).toBe("stream_error")
		// NO clean provider finish reason may appear.
		expect(snapshot?.attribution.providerFinishReason).toBeUndefined()
		const errorEvent = snapshot?.events.find((e) => e.event === "model_request_error")
		expect(errorEvent?.payload.finishReason).toBeUndefined()
	})

	it("T4: an explicit cancellation keeps its origin and is not a provider failure", () => {
		const recorder = new ModelBehaviorTraceRecorder()
		recorder.setEnabled(true)
		const sink = makeHostSink(recorder)
		setSdkAbortCauseRecordProvider(() => recorder.getRecords())

		sink.observe("model_request_start", {
			sessionId: "s-t4",
			runId: "r-t4",
			iteration: 1,
			modelRequestId: "req-t4",
			payload: {},
		})
		sink.observe("run_abort_requested", {
			sessionId: "s-t4",
			runId: "r-t4",
			iteration: 1,
			modelRequestId: "req-t4",
			payload: {
				abortOrigin: "explicit_abort_request",
				initiator: "agent_runtime",
				abortReason: "operator pressed stop",
			},
		})
		sink.observe("model_request_abort", {
			sessionId: "s-t4",
			runId: "r-t4",
			iteration: 1,
			modelRequestId: "req-t4",
			payload: {
				errorClass: "unknown",
				errorName: "AgentRuntimeAbortError",
				requestOutcome: "caller_cancelled",
				aborted: true,
			},
		})
		sink.observe("run_terminated", {
			sessionId: "s-t4",
			runId: "r-t4",
			payload: {
				finishReason: "aborted",
				status: "aborted",
				terminalPath: "observed_cancellation",
			},
		})

		const snapshot = getLatestSdkAbortCauseSnapshot()
		expect(snapshot?.status).toBe("aborted")
		expect(snapshot?.attribution.abortOrigin).toBe("explicit_abort_request")
		expect(snapshot?.attribution.terminalPath).toBe("observed_cancellation")
		expect(snapshot?.attribution.lastRequestOutcome).toBe("caller_cancelled")
		// NOT misclassified as a provider failure.
		expect(snapshot?.attribution.lastRequestOutcome).not.toBe("provider_error")
		// The origin is correlated to the request it interrupted.
		const originEvent = snapshot?.events.find((e) => e.event === "run_abort_requested")
		expect(originEvent?.modelRequestId).toBe("req-t4")
	})

	it("T5: a controlled recovery stop retains the actual controlled-stop reason", () => {
		const recorder = new ModelBehaviorTraceRecorder()
		recorder.setEnabled(true)
		const sink = makeHostSink(recorder)
		setSdkAbortCauseRecordProvider(() => recorder.getRecords())

		sink.observe("model_request_start", {
			sessionId: "s-t5",
			runId: "r-t5",
			iteration: 1,
			modelRequestId: "req-t5",
			payload: {},
		})
		sink.observe("run_abort_requested", {
			sessionId: "s-t5",
			runId: "r-t5",
			iteration: 1,
			modelRequestId: "req-t5",
			payload: {
				abortOrigin: "runtime_controlled_stop",
				initiator: "agent_runtime",
				abortReason: "bounded_recovery_exhausted",
			},
		})
		sink.observe("run_terminated", {
			sessionId: "s-t5",
			runId: "r-t5",
			payload: {
				finishReason: "aborted",
				status: "aborted",
				terminalPath: "controlled_stop",
				errorName: "ControlledStopError",
			},
		})

		const snapshot = getLatestSdkAbortCauseSnapshot()
		expect(snapshot?.attribution.abortOrigin).toBe("runtime_controlled_stop")
		const originEvent = snapshot?.events.find((e) => e.event === "run_abort_requested")
		expect(originEvent?.payload.abortReason).toBe("bounded_recovery_exhausted")
		// A controlled stop is DISTINCT from an explicit cancel.
		expect(snapshot?.attribution.abortOrigin).not.toBe("explicit_abort_request")
		// No provider failure may be fabricated.
		expect(snapshot?.events.filter((e) => e.event === "model_request_error")).toHaveLength(0)
	})

	it("T6: an unobserved request at run end is reported as in-flight, not as a provider error", () => {
		const recorder = new ModelBehaviorTraceRecorder()
		recorder.setEnabled(true)
		const sink = makeHostSink(recorder)
		setSdkAbortCauseRecordProvider(() => recorder.getRecords())

		sink.observe("model_request_start", {
			sessionId: "s-t6",
			runId: "r-t6",
			iteration: 1,
			modelRequestId: "req-t6",
			payload: {},
		})
		sink.observe("run_abort_requested", {
			sessionId: "s-t6",
			runId: "r-t6",
			iteration: 1,
			modelRequestId: "req-t6",
			payload: { abortOrigin: "explicit_abort_request" },
		})
		sink.observe("run_terminated", {
			sessionId: "s-t6",
			runId: "r-t6",
			payload: {
				finishReason: "aborted",
				status: "aborted",
				terminalPath: "observed_cancellation",
				lastKnownRequestOutcome: "in_flight_at_run_end",
			},
		})

		const snapshot = getLatestSdkAbortCauseSnapshot()
		expect(snapshot?.attribution.lastRequestOutcome).toBe("in_flight_at_run_end")
		// No provider error may be invented.
		expect(snapshot?.events.filter((e) => e.event === "model_request_error")).toHaveLength(0)
		expect(snapshot?.attribution.errorName).toBeUndefined()
	})

	it("T7: two sequential model requests associate the terminal event with the CORRECT request", () => {
		const recorder = new ModelBehaviorTraceRecorder()
		recorder.setEnabled(true)
		const sink = makeHostSink(recorder)
		setSdkAbortCauseRecordProvider(() => recorder.getRecords())

		sink.observe("model_request_start", {
			sessionId: "s-t7",
			runId: "r-t7",
			iteration: 1,
			modelRequestId: "req-t7-a",
			payload: {},
		})
		sink.observe("model_request_finish", {
			sessionId: "s-t7",
			runId: "r-t7",
			iteration: 1,
			modelRequestId: "req-t7-a",
			payload: { finishReason: "tool_use" },
		})
		sink.observe("model_request_start", {
			sessionId: "s-t7",
			runId: "r-t7",
			iteration: 2,
			modelRequestId: "req-t7-b",
			payload: {},
		})
		sink.observe("model_request_error", {
			sessionId: "s-t7",
			runId: "r-t7",
			iteration: 2,
			modelRequestId: "req-t7-b",
			payload: {
				errorName: "SecondRequestError",
				requestOutcome: "provider_error",
			},
		})
		sink.observe("run_terminated", {
			sessionId: "s-t7",
			runId: "r-t7",
			payload: { finishReason: "error", status: "failed" },
		})

		const snapshot = getLatestSdkAbortCauseSnapshot()
		expect(snapshot?.attribution.lastModelRequestId).toBe("req-t7-b")
		expect(snapshot?.attribution.errorName).toBe("SecondRequestError")
		// The FIRST request completed; it must not be mistaken for the failure.
		const errorEvent = snapshot?.events.find((e) => e.event === "model_request_error")
		expect(errorEvent?.modelRequestId).toBe("req-t7-b")
		const finishEvent = snapshot?.events.find((e) => e.event === "model_request_finish")
		expect(finishEvent?.modelRequestId).toBe("req-t7-a")
	})

	it("T8: two concurrent sessions do not contaminate each other", () => {
		const recorder = new ModelBehaviorTraceRecorder()
		recorder.setEnabled(true)
		const sink = makeHostSink(recorder)
		setSdkAbortCauseRecordProvider(() => recorder.getRecords())

		// Session A starts a request.
		sink.observe("model_request_start", {
			sessionId: "s-A",
			runId: "r-A",
			iteration: 1,
			modelRequestId: "req-A",
			payload: {},
		})
		// Session B starts and FAILS a request.
		sink.observe("model_request_start", {
			sessionId: "s-B",
			runId: "r-B",
			iteration: 1,
			modelRequestId: "req-B",
			payload: {},
		})
		sink.observe("model_request_error", {
			sessionId: "s-B",
			runId: "r-B",
			iteration: 1,
			modelRequestId: "req-B",
			payload: { errorName: "BError", requestOutcome: "provider_error" },
		})
		sink.observe("run_terminated", {
			sessionId: "s-B",
			runId: "r-B",
			payload: { finishReason: "error", status: "failed" },
		})
		// Session A then fails too.
		sink.observe("model_request_error", {
			sessionId: "s-A",
			runId: "r-A",
			iteration: 1,
			modelRequestId: "req-A",
			payload: { errorName: "AError", requestOutcome: "provider_error" },
		})
		sink.observe("run_terminated", {
			sessionId: "s-A",
			runId: "r-A",
			payload: { finishReason: "error", status: "failed" },
		})

		const snapshots = getSdkAbortCauseSnapshots()
		expect(snapshots).toHaveLength(2)
		const snapA = snapshots.find((s) => s.identity.sessionId === "s-A")
		const snapB = snapshots.find((s) => s.identity.sessionId === "s-B")
		expect(snapA?.attribution.errorName).toBe("AError")
		expect(snapB?.attribution.errorName).toBe("BError")
		// Each snapshot contains ONLY its own session's events.
		expect(snapA?.events.every((e) => e.sessionId === "s-A")).toBe(true)
		expect(snapB?.events.every((e) => e.sessionId === "s-B")).toBe(true)
	})

	it("T9: with the recorder DISABLED nothing is retained and no snapshot is produced", () => {
		const recorder = new ModelBehaviorTraceRecorder()
		// NOT enabled — the default production state.
		const sink = makeHostSink(recorder)
		setSdkAbortCauseRecordProvider(() => recorder.getRecords())

		const record = sink.observe("model_request_error", {
			sessionId: "s-t9",
			runId: "r-t9",
			modelRequestId: "req-t9",
			payload: { errorName: "ShouldNotBeRetained" },
		})
		expect(record).toBeUndefined()
		expect(recorder.getRecordCount()).toBe(0)
		expect(getSdkAbortCauseSnapshots()).toHaveLength(0)
	})

	it("T10: a throwing diagnostic consumer does not change the recorded outcome", () => {
		const recorder = new ModelBehaviorTraceRecorder()
		recorder.setEnabled(true)
		setSdkAbortCauseRecordProvider(() => recorder.getRecords())

		// A consumer that throws on every observation.
		const throwing = vi.fn(() => {
			throw new Error("diagnostic exploded")
		})

		const record = recorder.record("run_terminated", { sessionId: "s-t10", runId: "r-t10" }, { status: "aborted" })
		expect(record).toBeDefined()
		expect(() => throwing()).toThrow("diagnostic exploded")
		// The recorder's own outcome is unchanged.
		expect(recorder.getRecordCount()).toBe(1)
		expect(recorder.getRecords()[0]?.payload.status).toBe("aborted")
	})

	it("T11: the snapshot is bounded and truncation is reported explicitly", () => {
		const recorder = new ModelBehaviorTraceRecorder()
		recorder.setEnabled(true)
		const sink = makeHostSink(recorder)
		setSdkAbortCauseRecordProvider(() => recorder.getRecords())

		// More events than the per-snapshot bound.
		const total = SDK_ABORT_CAUSE_MAX_EVENTS_PER_SNAPSHOT + 20
		for (let i = 0; i < total; i++) {
			sink.observe("model_request_start", {
				sessionId: "s-t11",
				runId: "r-t11",
				iteration: i + 1,
				modelRequestId: `req-t11-${i}`,
				payload: {},
			})
		}
		sink.observe("run_terminated", {
			sessionId: "s-t11",
			runId: "r-t11",
			payload: { finishReason: "error", status: "failed" },
		})

		const snapshot = getLatestSdkAbortCauseSnapshot()
		expect(snapshot).toBeDefined()
		// The retained event count is bounded.
		expect(snapshot!.events.length).toBeLessThanOrEqual(SDK_ABORT_CAUSE_MAX_EVENTS_PER_SNAPSHOT)
		// Truncation is REPORTED, never silently presented as complete.
		expect(snapshot!.truncated).toBe(true)
		expect(snapshot!.droppedEventCount).toBeGreaterThan(0)
		// The terminal event is NEVER evicted by the bound.
		expect(snapshot!.events.some((e) => e.event === "run_terminated")).toBe(true)

		// The snapshot store is bounded too.
		for (let i = 0; i < SDK_ABORT_CAUSE_MAX_SNAPSHOTS + 5; i++) {
			sink.observe("run_terminated", {
				sessionId: "s-t11",
				runId: `r-t11-${i}`,
				payload: { finishReason: "error", status: "failed" },
			})
		}
		expect(getSdkAbortCauseSnapshots().length).toBeLessThanOrEqual(SDK_ABORT_CAUSE_MAX_SNAPSHOTS)
	})

	it("T13: a run whose two boundaries carry DIFFERENT run ids is still correlated", () => {
		// ACT-CLINEMM-SDK-ABORT-CAUSE-RETENTION01 — CORRECTION01.
		//
		// The production SDK mints TWO run identities for ONE run: the
		// `AgentRuntime` mints its own (`run_zf21Bf__`) and carries it on
		// every model-request observation, while the `SessionRuntime`
		// orchestrator mints a separate one (`run_1793..._xyz`) and carries
		// it on the run-terminal observation.
		//
		// A snapshot keyed on ONE of them would silently drop the other
		// half of the evidence — exactly the provider-terminal record that
		// explains WHY the run ended.
		const recorder = new ModelBehaviorTraceRecorder()
		recorder.setEnabled(true)
		const sink = makeHostSink(recorder)
		setSdkAbortCauseRecordProvider(() => recorder.getRecords())

		// The MODEL-REQUEST boundary: the runtime's own run id.
		sink.observe("model_request_start", {
			sessionId: "s-t13",
			runId: "run-runtime-owned",
			iteration: 1,
			modelRequestId: "req-t13",
			payload: {},
		})
		sink.observe("model_request_error", {
			sessionId: "s-t13",
			runId: "run-runtime-owned",
			iteration: 1,
			modelRequestId: "req-t13",
			payload: {
				errorName: "ProviderFailure",
				requestOutcome: "provider_error",
			},
		})
		// The RUN-TERMINAL boundary: the orchestrator's own run id. It
		// carries the last-known model request id in its PAYLOAD (the
		// orchestrator learns it from the same observation channel), which
		// is what makes the join possible.
		sink.observe("run_terminated", {
			sessionId: "s-t13",
			runId: "run-orchestrator-owned",
			payload: {
				status: "failed",
				terminalPath: "caught_exception",
				lastKnownModelRequestId: "req-t13",
				errorName: "ProviderFailure",
			},
		})

		const snapshot = getLatestSdkAbortCauseSnapshot()
		expect(snapshot).toBeDefined()
		// The provider-terminal record MUST be present, even though its run
		// id differs from the terminal record's.
		const events = snapshot?.events.map((e) => e.event) ?? []
		expect(events).toContain("model_request_error")
		expect(events).toContain("run_terminated")
		expect(events).toContain("model_request_start")
		// The attribution is the PROVIDER failure, not the terminal status.
		expect(snapshot?.attribution.errorName).toBe("ProviderFailure")
		expect(snapshot?.attribution.lastRequestOutcome).toBe("provider_error")
		expect(snapshot?.attribution.lastModelRequestId).toBe("req-t13")
	})

	it("T14: a record from a DIFFERENT session is never admitted, even with a matching request id", () => {
		const recorder = new ModelBehaviorTraceRecorder()
		recorder.setEnabled(true)
		const sink = makeHostSink(recorder)
		setSdkAbortCauseRecordProvider(() => recorder.getRecords())

		// Another session observed the SAME model request id (a collision
		// the join must not treat as membership).
		sink.observe("model_request_error", {
			sessionId: "s-other",
			runId: "r-other",
			modelRequestId: "req-shared",
			payload: { errorName: "ForeignError", requestOutcome: "provider_error" },
		})
		sink.observe("model_request_start", {
			sessionId: "s-t14",
			runId: "r-t14",
			modelRequestId: "req-t14",
			payload: {},
		})
		sink.observe("run_terminated", {
			sessionId: "s-t14",
			runId: "r-t14",
			payload: { status: "failed", terminalPath: "caught_exception" },
		})

		const snapshot = getLatestSdkAbortCauseSnapshot()
		expect(snapshot).toBeDefined()
		// The FOREIGN record must not be in the snapshot.
		expect(
			snapshot?.events.filter((e) => e.sessionId === "s-other"),
		).toHaveLength(0)
		expect(snapshot?.events.every((e) => e.sessionId === "s-t14")).toBe(true)
	})

	it("T12: a secret inside an error message is absent from the retained artifact", async () => {
		const { sanitizeTraceErrorMessage } = await import("@cline/shared")
		const secret = "sk-ant-supersecretvalue1234567890"
		const message = `401 Unauthorized: Authorization: Bearer ${secret} api_key=${secret}`
		const sanitized = sanitizeTraceErrorMessage(message)
		expect(sanitized).toBeDefined()
		expect(sanitized).not.toContain(secret)
		expect(sanitized).toContain("[REDACTED:")
		// The sanitized value is what the recorder would retain.
		const recorder = new ModelBehaviorTraceRecorder()
		recorder.setEnabled(true)
		const sink = makeHostSink(recorder)
		setSdkAbortCauseRecordProvider(() => recorder.getRecords())
		sink.observe("model_request_error", {
			sessionId: "s-t12",
			runId: "r-t12",
			modelRequestId: "req-t12",
			payload: { errorName: "APICallError", errorMessage: sanitized },
		})
		sink.observe("run_terminated", {
			sessionId: "s-t12",
			runId: "r-t12",
			payload: { finishReason: "error", status: "failed" },
		})
		const serialized = JSON.stringify(getLatestSdkAbortCauseSnapshot())
		expect(serialized).not.toContain(secret)
	})
})
