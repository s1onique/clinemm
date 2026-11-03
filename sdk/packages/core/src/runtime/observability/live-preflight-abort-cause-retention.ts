/**
 * ACT-CLINEMM-SDK-ABORT-CAUSE-RETENTION01 — installed-extension
 * qualification harness (SDK side).
 *
 * PURPOSE
 * -------
 * Prove that the abnormal-terminal RETENTION produces a usable, correlated
 * artifact through the REAL production SDK path, and that the artifact can
 * be FOUND without manually reconstructing the event chronology.
 *
 * WHAT IS REAL
 * -------------
 *   - `ModelBehaviorTraceRecorder` (@cline/shared) — the production bounded
 *     ring recorder, with its production limits and privacy sanitizer.
 *   - `SessionRuntime` — the production session orchestrator. It owns the
 *     production RUN-TERMINAL boundary and the production abort-origin
 *     forwarding.
 *   - `AgentRuntime` (@cline/agents) — the production agent runtime, with
 *     the production model-request and abort-initiation observation seams.
 *   - `sdk-abort-cause-retention.ts` — the production retention module.
 *
 * WHAT IS SYNTHETIC (and is labelled as such)
 * --------------------------------------------
 *   - The PROVIDER. A deterministic injected provider stands in for the
 *     live MiniMax transport, so the failure is reproducible. This is
 *     `SYNTHETIC_REAL / REAL_PRODUCTION_SEAM`: it exercises the real
 *     runtime seams but it is NOT a live MiniMax reproduction, and it is
 *     NOT evidence that the historical production incident is explained.
 *
 * USAGE
 * -----
 *   cd sdk/packages/core
 *   bun src/runtime/observability/live-preflight-abort-cause-retention.ts \
 *     --out /tmp/clinemm-abort-cause
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { createAgentRuntime } from "@cline/agents"
import type { AgentMessage } from "@cline/shared"
import { ModelBehaviorTraceRecorder } from "@cline/shared"
import { SessionRuntime } from "../orchestration/session-runtime-orchestrator"
import {
	captureSdkAbortCauseSnapshot,
	observeSdkAbortCauseRecord,
	setSdkAbortCauseRecordProvider,
} from "./sdk-abort-cause-retention"

function arg(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`)
	if (index === -1) {
		return undefined
	}
	const value = process.argv[index + 1]
	return value && !value.startsWith("--") ? value : undefined
}

const OUT_DIR = resolve(arg("out") ?? "/tmp/clinemm-abort-cause")

/**
 * The recorder + sink.
 *
 * The shape mirrors the production host adapter
 * (`apps/vscode/src/sdk/model-behavior-trace-runtime.ts`): the SDK hands
 * over privacy-safe observations and the recorder owns the ring.
 */
const recorder = new ModelBehaviorTraceRecorder()
recorder.setEnabled(true)
setSdkAbortCauseRecordProvider(() => recorder.getRecords())

function record(event: Parameters<ModelBehaviorTraceRecorder["record"]>[0]) {
	return (observation: {
		sessionId?: string
		taskId?: string
		runId?: string
		iteration?: number
		modelRequestId?: string
		providerId?: string
		modelId?: string
		payload: Readonly<Record<string, unknown>>
	}): void => {
		const stored = recorder.record(
			event,
			{
				...(observation.sessionId !== undefined
					? { sessionId: observation.sessionId }
					: {}),
				...(observation.taskId !== undefined ? { taskId: observation.taskId } : {}),
				...(observation.runId !== undefined ? { runId: observation.runId } : {}),
				...(observation.iteration !== undefined
					? { iteration: observation.iteration }
					: {}),
				...(observation.modelRequestId !== undefined
					? { modelRequestId: observation.modelRequestId }
					: {}),
				...(observation.providerId !== undefined
					? { providerId: observation.providerId }
					: {}),
				...(observation.modelId !== undefined ? { modelId: observation.modelId } : {}),
			},
			observation.payload as Record<string, unknown>,
		)
		observeSdkAbortCauseRecord(stored)
		captureSdkAbortCauseSnapshot(stored)
	}
}

const sink = {
	isTraceEnabled: () => recorder.isEnabled(),
	onModelRequestStart: record("model_request_start"),
	onModelRequestFinish: record("model_request_finish"),
	onModelRequestError: record("model_request_error"),
	onModelRequestAbort: record("model_request_abort"),
	onRunAbortRequested: record("run_abort_requested"),
	onRunTerminated: record("run_terminated"),
}

/**
 * Build the deterministic provider.
 *
 * `mode`:
 *   "before_stream" — the provider throws BEFORE any chunk (a provider error).
 *   "mid_stream"    — the provider yields one chunk and then throws (a stream
 *                     error).
 *   "hang"          — the provider stays in flight until the request's abort
 *                     signal fires (a cancellation).
 */
function makeProvider(
	mode: "before_stream" | "mid_stream" | "hang",
	errorName: string,
	message: string,
) {
	const error = new Error(message)
	error.name = errorName
	return {
		async stream(request: { signal?: AbortSignal }): Promise<
			AsyncIterable<Record<string, unknown>>
		> {
			const signal = request.signal
			return {
				[Symbol.asyncIterator]() {
					let delivered = false
					return {
						next(): Promise<IteratorResult<Record<string, unknown>>> {
							if (signal?.aborted) {
								return Promise.reject(signal.reason)
							}
							if (mode === "hang") {
								return new Promise<IteratorResult<Record<string, unknown>>>(
									(_, reject) => {
										signal?.addEventListener(
											"abort",
											() => reject(signal.reason),
											{ once: true },
										)
									},
								)
							}
							if (mode === "mid_stream" && !delivered) {
								delivered = true
								return Promise.resolve({
									done: false,
									value: { type: "text-delta", text: "partial" },
								})
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
	description: "Return a deterministic probe value for the given key.",
	inputSchema: {
		type: "object" as const,
		properties: { value: { type: "string" } },
		required: ["value"],
	},
	execute: async (input: Record<string, unknown>) => ({
		output: `probe:${String(input.value ?? "")}`,
	}),
}

/**
 * Drive ONE run through the REAL `SessionRuntime` orchestrator with the
 * REAL `AgentRuntime` and the deterministic provider.
 */
async function drive(
	label: string,
	mode: "before_stream" | "mid_stream" | "hang",
	errorName: string,
	message: string,
): Promise<void> {
	const provider = makeProvider(mode, errorName, message)
	const session = new SessionRuntime(
		{
			sessionId: `preflight-${label}`,
			providerId: "synthetic-preflight",
			modelId: "synthetic-preflight-model",
			modelBehaviorTraceSink: sink,
			tools: [TOOL],
			systemPrompt: "abort-cause retention preflight",
		} as never,
		{
			// The REAL orchestrator builds the REAL runtime; only the MODEL
			// is replaced, with the deterministic provider.
			createAgentRuntimeImpl: (runtimeConfig) =>
				createAgentRuntime({
					...runtimeConfig,
					model: provider as never,
					tools: [TOOL as never],
				} as never),
		},
	)

	const prompt: AgentMessage = {
		id: `preflight-${label}-1`,
		role: "user",
		content: [{ type: "text", text: "trigger the deterministic failure" }],
		createdAt: Date.now(),
	} as AgentMessage

	if (mode === "hang") {
		const running = session.run(prompt)
		await new Promise((r) => setTimeout(r, 40))
		session.abort("preflight operator cancel", "explicit_abort_request")
		await running.catch(() => {})
		return
	}
	await session.run(prompt).catch(() => {})
}

async function main(): Promise<void> {
	await mkdir(OUT_DIR, { recursive: true })

	// 1) A provider exception (before the stream opens).
	await drive(
		"provider-error",
		"before_stream",
		"PreflightProviderError",
		"deterministic preflight provider failure",
	)

	// 2) A mid-stream terminal failure.
	await drive(
		"stream-error",
		"mid_stream",
		"PreflightStreamError",
		"deterministic preflight mid-stream failure",
	)

	// 3) An explicit cancellation of an in-flight request.
	await drive("cancel", "hang", "PreflightCancelError", "never reached")

	// 4) Write the artifact.
	const { getSdkAbortCauseSnapshots } = await import(
		"./sdk-abort-cause-retention"
	)
	const snapshots = getSdkAbortCauseSnapshots()
	const artifactPath = join(OUT_DIR, "sdk-abort-cause-snapshots.json")
	await writeFile(
		artifactPath,
		`${JSON.stringify(
			{
				kind: "sdk_abort_cause_snapshots",
				schemaVersion: 1,
				dumpedAt: new Date().toISOString(),
				snapshotCount: snapshots.length,
				snapshots,
			},
			null,
			2,
		)}\n`,
		"utf8",
	)

	const report = {
		act: "ACT-CLINEMM-SDK-ABORT-CAUSE-RETENTION01",
		evidenceClass: "SYNTHETIC_REAL / REAL_PRODUCTION_SEAM",
		evidenceClassNote:
			"A deterministic injected provider drives the REAL SessionRuntime, the REAL " +
			"AgentRuntime and the REAL retention module. It is NOT a live MiniMax " +
			"reproduction and it is NOT evidence that the historical production " +
			"incident is explained.",
		artifactPath,
		snapshotCount: snapshots.length,
	}
	await writeFile(
		join(OUT_DIR, "preflight-report.json"),
		`${JSON.stringify(report, null, 2)}\n`,
		"utf8",
	)

	if (snapshots.length === 0) {
		console.error("PREFLIGHT: NO SNAPSHOT PRODUCED")
		process.exitCode = 1
		return
	}
	console.log(`PREFLIGHT: ${snapshots.length} snapshot(s) -> ${artifactPath}`)
	for (const snapshot of snapshots) {
		console.log(
			`  status=${snapshot.status} origin=${snapshot.attribution.abortOrigin ?? "none"} ` +
				`outcome=${snapshot.attribution.lastRequestOutcome} ` +
				`errorName=${snapshot.attribution.errorName ?? "none"} ` +
				`terminalPath=${snapshot.attribution.terminalPath ?? "none"} ` +
				`runId=${snapshot.identity.runId ?? "none"} ` +
				`modelRequestId=${snapshot.attribution.lastModelRequestId ?? "none"} ` +
				`events=${snapshot.events.map((e) => e.event).join(",")}`,
		)
	}
	const stats = await stat(artifactPath)
	console.log(`PREFLIGHT: artifact mode=${(stats.mode & 0o777).toString(8)}`)
}

await main()
