/**
 * ACT-CLINEMM-SDK-ABORT-CAUSE-RETENTION01 — CORRECTION01 — the RED
 * witness for the CORRELATION defect.
 *
 * THE DEFECT
 * ----------
 * The production SDK mints TWO run identities for ONE run:
 *   - the `AgentRuntime` mints its own `runId`
 *     (`agent-runtime.ts`: `this.state.runId = createUID("run")`), and that
 *     is the identity carried by every MODEL-REQUEST observation, and
 *   - the `SessionRuntime` orchestrator mints a SEPARATE `activeRunId`
 *     (`session-runtime-orchestrator.ts`: `run_${Date.now()}_...`), and
 *     that is the identity carried by the RUN-TERMINAL observation.
 *
 * A retention layer keyed on ONE of them silently drops the OTHER half of
 * the evidence: the snapshot that describes a provider failure ends up
 * containing ONLY the run-terminal record, with no provider-terminal
 * record at all. The artifact then says "the run failed" without saying
 * WHY — which is exactly the observability gap this ACT exists to close.
 *
 * The witness drives the REAL `SessionRuntime` orchestrator and the REAL
 * `AgentRuntime` with a deterministic injected provider, so the two run
 * identities are the PRODUCTION ones.
 *
 * RED validity: the assertion concerns MISSING CORRELATED EVIDENCE, not an
 * intentionally failing agent behaviour. The provider failure itself is
 * the normal production failure path.
 */
import type { AgentMessage, ModelBehaviorTraceObservation } from "@cline/shared"
import { ModelBehaviorTraceRecorder } from "@cline/shared"
import { describe, expect, it } from "vitest"
import { createAgentRuntime } from "@cline/agents"
import { SessionRuntime } from "../orchestration/session-runtime-orchestrator"
import {
	captureSdkAbortCauseSnapshot,
	observeSdkAbortCauseRecord,
	setSdkAbortCauseRecordProvider,
} from "./sdk-abort-cause-retention"

/**
 * A deterministic provider that fails with a typed error before the stream
 * yields a chunk.
 */
function makeFailingProvider(errorName: string, message: string) {
	const error = new Error(message)
	error.name = errorName
	return {
		async stream(request: { signal?: AbortSignal }): Promise<
			AsyncIterable<Record<string, unknown>>
		> {
			const signal = request.signal
			return {
				[Symbol.asyncIterator]() {
					return {
						next(): Promise<IteratorResult<Record<string, unknown>>> {
							if (signal?.aborted) {
								return Promise.reject(signal.reason)
							}
							return Promise.reject(error)
						},
					}
				},
			} as AsyncIterable<Record<string, unknown>>
		},
	}
}

const TOOL = {
	name: "read_probe",
	description: "Return a deterministic probe value.",
	inputSchema: {
		type: "object" as const,
		properties: { value: { type: "string" } },
	},
	execute: async () => ({ output: "probe" }),
}

describe("ACT-CLINEMM-SDK-ABORT-CAUSE-RETENTION01 CORRECTION01 — correlation", () => {
	it("RED_OBSERVABILITY_GAP: the provider-terminal record is correlated to the run-terminal record", async () => {
		const recorder = new ModelBehaviorTraceRecorder()
		recorder.setEnabled(true)
		setSdkAbortCauseRecordProvider(() => recorder.getRecords())

		const observe =
			(event: Parameters<ModelBehaviorTraceRecorder["record"]>[0]) =>
			(observation: ModelBehaviorTraceObservation): void => {
				const stored = recorder.record(
					event,
					{
						...(observation.sessionId !== undefined
							? { sessionId: observation.sessionId }
							: {}),
						...(observation.taskId !== undefined
							? { taskId: observation.taskId }
							: {}),
						...(observation.runId !== undefined
							? { runId: observation.runId }
							: {}),
						...(observation.iteration !== undefined
							? { iteration: observation.iteration }
							: {}),
						...(observation.modelRequestId !== undefined
							? { modelRequestId: observation.modelRequestId }
							: {}),
					},
					observation.payload as Record<string, unknown>,
				)
				observeSdkAbortCauseRecord(stored)
				captureSdkAbortCauseSnapshot(stored)
			}

		const sink = {
			isTraceEnabled: () => recorder.isEnabled(),
			onModelRequestStart: observe("model_request_start"),
			onModelRequestFinish: observe("model_request_finish"),
			onModelRequestError: observe("model_request_error"),
			onModelRequestAbort: observe("model_request_abort"),
			onRunAbortRequested: observe("run_abort_requested"),
			onRunTerminated: observe("run_terminated"),
		}

		const provider = makeFailingProvider(
			"PreflightProviderError",
			"deterministic preflight provider failure",
		)

		const session = new SessionRuntime(
			{
				sessionId: "corr-red-01",
				providerId: "synthetic-preflight",
				modelId: "synthetic-preflight-model",
				modelBehaviorTraceSink: sink,
				tools: [TOOL],
				systemPrompt: "abort-cause correlation preflight",
			} as never,
			{
				createAgentRuntimeImpl: (runtimeConfig) =>
					createAgentRuntime({
						...runtimeConfig,
						model: provider as never,
						tools: [TOOL as never],
					} as never),
			},
		)

		const prompt: AgentMessage = {
			id: "corr-red-01-1",
			role: "user",
			content: [{ type: "text", text: "trigger the deterministic failure" }],
			createdAt: Date.now(),
		} as AgentMessage

		await session.run(prompt).catch(() => {})

		// The production run identities really are DIFFERENT.
		const records = recorder.getRecords()
		const requestRecord = records.find((r) => r.event === "model_request_start")
		const terminalRecord = records.find((r) => r.event === "run_terminated")
		expect(requestRecord?.runId).toBeDefined()
		expect(terminalRecord?.runId).toBeDefined()
		expect(requestRecord?.runId).not.toBe(terminalRecord?.runId)

		// The snapshot MUST contain the provider-terminal record.
		const { getLatestSdkAbortCauseSnapshot } = await import(
			"./sdk-abort-cause-retention"
		)
		const snapshot = getLatestSdkAbortCauseSnapshot()
		expect(snapshot).toBeDefined()
		const events = snapshot?.events.map((e) => e.event) ?? []
		// RED_OBSERVABILITY_GAP: before the CORRECTION01 scope fix the
		// snapshot contained ONLY the run-terminal record, so the artifact
		// said "the run failed" without saying why.
		expect(events).toContain("model_request_error")
		expect(events).toContain("run_terminated")
		// The provider failure identity is retained.
		expect(snapshot?.attribution.errorName).toBe("PreflightProviderError")
		// The request correlation id is retained.
		expect(snapshot?.attribution.lastModelRequestId).toBe(
			requestRecord?.modelRequestId,
		)
	})
})
