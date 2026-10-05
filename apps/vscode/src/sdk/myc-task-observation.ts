/**
 * ACT-MYC-CLINEMM-TASK-HEADER-TELEMETRY01 — pure helper that converts
 * a model-driven `onToolStarted` event into a per-task myc
 * tracker increment. Extracted as a tiny pure function so the
 * production wiring is testable in isolation and so the SdkController
 * seam stays minimal.
 *
 * Usage from SdkController:
 *
 *   onToolStarted: (event) => {
 *       this.taskTelemetry.recordToolStartedWithName(event.toolName)
 *       observeMycToolStart(this.taskTelemetry, event.toolName)
 *   }
 *
 * The function is a no-op for non-myc tool names. It MUST NOT be
 * called from anywhere that does not also feed the `onToolStarted`
 * runtime event, because the underlying assumption is that ONE
 * `content_start(tool)` corresponds to ONE observed call.
 *
 * Privacy: does not see argument values, only the toolName. No
 * network emission.
 */
import type { MycPrimeResult } from "./myc-prime-automation"
import type { TaskTelemetryTracker } from "./task-telemetry-tracker"

const MYC_TOOL_PREFIX = "myc_"

export function observeMycToolStart(tracker: TaskTelemetryTracker, toolName: string | undefined): void {
	if (typeof toolName !== "string" || !toolName.startsWith(MYC_TOOL_PREFIX)) {
		return
	}
	tracker.recordMycToolCall("myc", toolName, "success")
}
/**
 * ACT-MYC-CLINEMM-TASK-HEADER-TELEMETRY01 — record the canonical
 * `MycPrimeResult` outcome into the per-task tracker. ONE prime ⇒
 * ONE call to `recordMycToolCall` plus ONE call to
 * `recordMycPrimeStatus`. Cardinality invariant (ACT §17).
 *
 * `ts` (the prime's recorded timestamp) and `now` (the wall clock at
 * the moment we feed the tracker) yield the latency. Both MUST be
 * numbers; non-finite values are clamped to 0.
 */
export function observeMycPrimeResult(tracker: TaskTelemetryTracker, result: MycPrimeResult, now: number = Date.now()): void {
	// "skipped" = no myc server configured (not an error). We still
	// observe the call as successful (the call completed without
	// throwing); the bounded prime status carries the "skipped"
	// reason. ACT §6 + §10.
	const isFailure = result.status === "failed"
	const isUseful = result.status === "ok" && Boolean(result.text && result.text.length > 0)
	const outcome: "success" | "empty" | "error" = isFailure ? "error" : isUseful ? "success" : "empty"
	// Latency: clamp to 0 if ts is non-finite OR in the future
	// (clock skew safety). 0 is a valid latency observation.
	const latencyMs = typeof result.ts === "number" && Number.isFinite(result.ts) ? Math.max(0, now - result.ts) : 0
	tracker.recordMycToolCall("myc", "myc_prime", outcome, latencyMs, isUseful)
	tracker.recordMycPrimeStatus(result.status)
}
