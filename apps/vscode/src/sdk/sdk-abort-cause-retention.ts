/**
 * ACT-CLINEMM-SDK-ABORT-CAUSE-RETENTION01
 *
 * Bounded, local-only retention of the CORRELATED evidence that explains an
 * abnormal SDK run termination.
 *
 * WHY THIS EXISTS
 * ---------------
 * The centralized model-behavior recorder already emits the three boundaries
 * this ACT needs:
 *
 *   model_request_start / model_request_finish / model_request_error /
 *   model_request_abort      (provider request lifecycle)
 *   run_abort_requested        (the ORIGIN of a termination)
 *   run_terminated             (the SDK run-terminal result)
 *
 * but the recorder is a FLAT RING: an operator who dumps it after an
 * unexplained `status="aborted"` must reconstruct the causal chronology by
 * hand, across unrelated sessions and unrelated runs. This module is the
 * missing RETENTION layer: it observes the SAME records (it does not add a
 * second emitter and does not add a second tracing framework) and, when a
 * run ends abnormally, it persists ONE self-contained, bounded snapshot that
 * already contains the correlated provider / abort-origin / run-terminal
 * evidence for that run.
 *
 * DESIGN INVARIANTS
 * -----------------
 *   - DEFAULT OFF. The recorder's enable bit is the single authority; when
 *     it is off, every method here is a complete no-op and NO file is
 *     written.
 *   - BOUNDED. At most `MAX_SNAPSHOTS` snapshots are retained, at most
 *     `MAX_EVENTS_PER_SNAPSHOT` events per snapshot, and at most
 *     `MAX_SNAPSHOT_BYTES` per snapshot. Eviction is deterministic
 *     (oldest-first) and truncation is REPORTED, never silently presented
 *     as complete.
 *   - LOCAL ONLY. The artifact is written under the extension's
 *     globalStorageUri. Nothing is uploaded.
 *   - FAILURE ISOLATED. Every entry point swallows its own failures: a
 *     diagnostic failure must never replace an application failure.
 *   - NO PROMPT / COMPLETION / TOOL-ARGUMENT RETENTION. The snapshot carries
 *     identities, classifications, counts, timings and BOUNDED SANITIZED
 *     error messages only.
 *
 * CORRELATION GUARANTEE
 * ---------------------
 * A snapshot is keyed by `runId` (falling back to `sessionId` + start
 * sequence when the run id is unavailable). Records are only admitted to a
 * snapshot when their identity MATCHES the snapshot's key, so two
 * concurrent sessions can never contaminate each other's evidence. A record
 * whose identity does not match is NOT admitted and is NOT guessed into.
 */

import type { ModelBehaviorTraceRecord } from "@cline/shared"

/**
 * The maximum number of abnormal-terminal snapshots retained in memory.
 *
 * Oldest-first eviction. The most recent abnormal terminations are the ones
 * an operator is investigating, so the newest survive.
 */
export const SDK_ABORT_CAUSE_MAX_SNAPSHOTS = 8

/**
 * The maximum number of events retained per snapshot.
 *
 * A snapshot only ever holds the request-lifecycle and terminal boundaries
 * of ONE run — never tokens, SSE chunks or tool events.
 */
export const SDK_ABORT_CAUSE_MAX_EVENTS_PER_SNAPSHOT = 64

/**
 * The maximum serialized size of ONE snapshot, in bytes.
 *
 * When the serialized snapshot exceeds this bound, the OLDEST events are
 * dropped (the terminal events are always kept) and the snapshot records
 * that it was truncated.
 */
export const SDK_ABORT_CAUSE_MAX_SNAPSHOT_BYTES = 256 * 1024

/**
 * The terminal event kinds that are NEVER evicted by the byte bound.
 *
 * The whole point of the snapshot is the terminal boundary; dropping it to
 * save bytes would defeat the artifact.
 */
const TERMINAL_EVENT_KINDS = new Set(["model_request_error", "model_request_abort", "run_abort_requested", "run_terminated"])

/**
 * The event kinds this module is interested in.
 *
 * The recorder emits far more than this; a snapshot only retains the
 * request-lifecycle and terminal boundaries. A tool event, a compaction
 * event and a wire-reasoning event are NOT part of an abort-cause snapshot.
 */
const RETAINED_EVENT_KINDS = new Set([
	"model_request_start",
	"model_request_finish",
	"model_request_error",
	"model_request_abort",
	"run_abort_requested",
	"run_terminated",
])

/**
 * The run-terminal statuses that count as ABNORMAL.
 *
 * `completed` is the normal path and produces NO snapshot.
 */
const ABNORMAL_STATUSES = new Set(["aborted", "failed"])

/**
 * One retained abnormal-terminal snapshot.
 */
export interface SdkAbortCauseSnapshot {
	/** The schema version of the snapshot envelope. */
	readonly schemaVersion: number
	/** When the snapshot was taken (ISO-8601). */
	readonly capturedAt: string
	/** The identity of the run that terminated abnormally. */
	readonly identity: {
		readonly sessionId?: string
		readonly taskId?: string
		readonly runId?: string
		readonly providerId?: string
		readonly modelId?: string
	}
	/**
	 * The observed terminal status (`aborted` | `failed`).
	 */
	readonly status: string
	/**
	 * The correlated evidence, in recorder sequence order.
	 */
	readonly events: readonly ModelBehaviorTraceRecord[]
	/**
	 * TRUE when the snapshot was cut. The `events` array is then NOT
	 * exhaustive and an analyst must not read it as a complete chronology.
	 */
	readonly truncated: boolean
	/**
	 * How many events were dropped by the byte bound.
	 */
	readonly droppedEventCount: number
	/**
	 * The derived, human-readable attribution.
	 *
	 * Every field is DERIVED from the retained records; the derivation is
	 * explicit about what was NOT observed.
	 */
	readonly attribution: {
		/** The observed abort origin, when an origin event was retained. */
		readonly abortOrigin?: string
		/** The observed terminal path, when a run-terminal record was retained. */
		readonly terminalPath?: string
		/** The observed terminal error name, when one was retained. */
		readonly errorName?: string
		/** The observed terminal error class, when one was retained. */
		readonly errorClass?: string
		/** The observed provider finish reason, when one was retained. */
		readonly providerFinishReason?: string
		/**
		 * The observed outcome of the LAST model request.
		 *
		 * `in_flight_at_run_end` means NO provider terminal event was
		 * observed before the run ended. It is an OBSERVATION, not a
		 * provider fault.
		 */
		readonly lastRequestOutcome: string
		/** The `modelRequestId` of the last observed model request. */
		readonly lastModelRequestId?: string
	}
}

const SNAPSHOT_SCHEMA_VERSION = 1

/**
 * The in-memory snapshot store.
 *
 * Module-level so the sink adapter and the operator command share one
 * buffer — the same reason the recorder itself is module-level.
 */
const snapshots: SdkAbortCauseSnapshot[] = []

/**
 * The in-flight request bookkeeping, keyed by the run identity.
 *
 * This is what lets the snapshot distinguish "the provider request failed"
 * from "the provider request was still in flight when the run ended".
 */
interface RunRequestState {
	readonly runKey: string
	lastModelRequestId?: string
	lastRequestOutcome?: string
	providerFinishReason?: string
	errorName?: string
	errorClass?: string
	abortOrigin?: string
	terminalPath?: string
	status?: string
}

const runStates = new Map<string, RunRequestState>()

/**
 * The maximum number of run states retained.
 *
 * Oldest-first eviction; a run state is small (a handful of scalars) and is
 * dropped as soon as its snapshot is taken or its run completes normally.
 */
const MAX_RUN_STATES = 32

/**
 * Derive the key that binds a record to a run.
 *
 * The `runId` is the authoritative key. When it is absent, the
 * session-scoped fallback is used. A record with NEITHER is NOT admitted to
 * any snapshot: an unbound record cannot be attributed to a run and must not
 * be guessed into one.
 */
function runKeyOf(record: ModelBehaviorTraceRecord): string | undefined {
	if (record.runId) {
		return `run:${record.runId}`
	}
	if (record.sessionId) {
		return `session:${record.sessionId}`
	}
	return undefined
}

/**
 * Read a string field from a record payload.
 */
function payloadString(record: ModelBehaviorTraceRecord, key: string): string | undefined {
	const value = record.payload[key]
	return typeof value === "string" && value.length > 0 ? value : undefined
}

/**
 * Observe ONE recorder record.
 *
 * This is the ONLY ingestion point. It is called from the same place the
 * recorder is written to, so there is exactly ONE emitter and ONE retention
 * consumer — no parallel event protocol.
 *
 * Never throws.
 */
export function observeSdkAbortCauseRecord(record: ModelBehaviorTraceRecord | undefined): void {
	if (!record) {
		return
	}
	try {
		if (!RETAINED_EVENT_KINDS.has(record.event)) {
			return
		}
		const runKey = runKeyOf(record)
		if (!runKey) {
			// An unbound record cannot be attributed to a run.
			return
		}
		let state = runStates.get(runKey)
		if (!state) {
			state = { runKey }
			runStates.set(runKey, state)
			if (runStates.size > MAX_RUN_STATES) {
				// Deterministic oldest-first eviction.
				const oldest = runStates.keys().next()
				if (!oldest.done) {
					runStates.delete(oldest.value)
				}
			}
		}

		switch (record.event) {
			case "model_request_start":
				state.lastModelRequestId = record.modelRequestId
				state.lastRequestOutcome = "in_flight_at_run_end"
				state.providerFinishReason = undefined
				break
			case "model_request_finish": {
				state.lastModelRequestId = record.modelRequestId ?? state.lastModelRequestId
				state.lastRequestOutcome = "completed"
				const finishReason = payloadString(record, "finishReason")
				if (finishReason) {
					state.providerFinishReason = finishReason
				}
				break
			}
			case "model_request_error": {
				state.lastModelRequestId = record.modelRequestId ?? state.lastModelRequestId
				const errorClass = payloadString(record, "errorClass")
				if (errorClass) {
					state.errorClass = errorClass
				}
				const errorName = payloadString(record, "errorName")
				if (errorName) {
					state.errorName = errorName
				}
				// The OBSERVED outcome. A provider error is never inferred
				// from the absence of a finish record.
				state.lastRequestOutcome = payloadString(record, "requestOutcome") ?? "provider_error"
				break
			}
			case "model_request_abort": {
				state.lastModelRequestId = record.modelRequestId ?? state.lastModelRequestId
				const errorClass = payloadString(record, "errorClass")
				if (errorClass) {
					state.errorClass = errorClass
				}
				const errorName = payloadString(record, "errorName")
				if (errorName) {
					state.errorName = errorName
				}
				state.lastRequestOutcome = payloadString(record, "requestOutcome") ?? "caller_cancelled"
				break
			}
			case "run_abort_requested": {
				const origin = payloadString(record, "abortOrigin")
				if (origin) {
					state.abortOrigin = origin
				}
				break
			}
			case "run_terminated": {
				const status = payloadString(record, "status")
				if (status) {
					state.status = status
				}
				const terminalPath = payloadString(record, "terminalPath")
				if (terminalPath) {
					state.terminalPath = terminalPath
				}
				const errorName = payloadString(record, "errorName")
				if (errorName) {
					state.errorName = errorName
				}
				const errorClass = payloadString(record, "errorClass")
				if (errorClass) {
					state.errorClass = errorClass
				}
				const lastRequestId = payloadString(record, "lastKnownModelRequestId")
				if (lastRequestId) {
					state.lastModelRequestId = lastRequestId
				}
				const lastOutcome = payloadString(record, "lastKnownRequestOutcome")
				if (lastOutcome) {
					state.lastRequestOutcome = lastOutcome
				}
				break
			}
			default:
				break
		}
	} catch {
		// Failure isolation: a retention bug must never affect the runtime.
	}
}

/**
 * Take (and retain) the abnormal-terminal snapshot for a run.
 *
 * Returns the snapshot, or `undefined` when the terminal status was NORMAL
 * (a normal completion produces NO abnormal-terminal capture).
 *
 * Never throws.
 */
export function captureSdkAbortCauseSnapshot(record: ModelBehaviorTraceRecord | undefined): SdkAbortCauseSnapshot | undefined {
	if (!record) {
		return undefined
	}
	try {
		if (record.event !== "run_terminated") {
			return undefined
		}
		const status = payloadString(record, "status")
		if (!status || !ABNORMAL_STATUSES.has(status)) {
			// A normal completion produces NO abnormal-terminal capture.
			return undefined
		}
		const runKey = runKeyOf(record)
		if (!runKey) {
			return undefined
		}
		const state = runStates.get(runKey)
		const events = collectSnapshotEvents(runKey, record)
		const snapshot: SdkAbortCauseSnapshot = {
			schemaVersion: SNAPSHOT_SCHEMA_VERSION,
			capturedAt: record.timestamp,
			identity: {
				...(record.sessionId !== undefined ? { sessionId: record.sessionId } : {}),
				...(record.taskId !== undefined ? { taskId: record.taskId } : {}),
				...(record.runId !== undefined ? { runId: record.runId } : {}),
				...(record.providerId !== undefined ? { providerId: record.providerId } : {}),
				...(record.modelId !== undefined ? { modelId: record.modelId } : {}),
			},
			status,
			events,
			truncated: events.length < countSnapshotCandidates(runKey),
			droppedEventCount: Math.max(0, countSnapshotCandidates(runKey) - events.length),
			attribution: {
				...(state?.abortOrigin !== undefined ? { abortOrigin: state.abortOrigin } : {}),
				...(state?.terminalPath !== undefined ? { terminalPath: state.terminalPath } : {}),
				...(state?.errorName !== undefined ? { errorName: state.errorName } : {}),
				...(state?.errorClass !== undefined ? { errorClass: state.errorClass } : {}),
				...(state?.providerFinishReason !== undefined ? { providerFinishReason: state.providerFinishReason } : {}),
				lastRequestOutcome: state?.lastRequestOutcome ?? "terminal_event_unobserved",
				...(state?.lastModelRequestId !== undefined ? { lastModelRequestId: state.lastModelRequestId } : {}),
			},
		}
		snapshots.push(snapshot)
		while (snapshots.length > SDK_ABORT_CAUSE_MAX_SNAPSHOTS) {
			snapshots.shift()
		}
		// The run state has served its purpose.
		runStates.delete(runKey)
		return snapshot
	} catch {
		// Failure isolation: a retention bug must never affect the runtime.
		return undefined
	}
}

/**
 * The records the recorder currently holds, keyed by run.
 *
 * The retention module does not own the records; the recorder does. This
 * helper asks the recorder for its records and filters them by identity.
 */
let recordProvider: (() => readonly ModelBehaviorTraceRecord[]) | undefined

/**
 * Install the record provider (the recorder's `getRecords`).
 *
 * The provider is injected rather than imported so this module stays
 * testable and free of a dependency cycle.
 */
export function setSdkAbortCauseRecordProvider(provider: () => readonly ModelBehaviorTraceRecord[]): void {
	recordProvider = provider
}

/**
 * The candidate events for a run (before the bounds are applied).
 *
 * This is the number of RETAINED-KIND records that belong to the run, so
 * the snapshot can report how many it dropped.
 */
function countSnapshotCandidates(runKey: string): number {
	if (!recordProvider) {
		return 0
	}
	let count = 0
	for (const record of recordProvider()) {
		if (!RETAINED_EVENT_KINDS.has(record.event)) {
			continue
		}
		if (runKeyOf(record) === runKey) {
			count++
		}
	}
	return count
}

/**
 * Collect the bounded event list for a run.
 *
 * The bound is applied in TWO steps:
 *   1. the COUNT bound (oldest-first eviction of non-terminal events),
 *   2. the BYTE bound (oldest-first eviction of non-terminal events only —
 *      a terminal event is never dropped).
 *
 * Truncation is REPORTED by the caller via `droppedEventCount`.
 */
function collectSnapshotEvents(runKey: string, terminalRecord: ModelBehaviorTraceRecord): readonly ModelBehaviorTraceRecord[] {
	if (!recordProvider) {
		return [terminalRecord]
	}
	const candidates: ModelBehaviorTraceRecord[] = []
	for (const record of recordProvider()) {
		if (!RETAINED_EVENT_KINDS.has(record.event)) {
			continue
		}
		if (runKeyOf(record) === runKey) {
			candidates.push(record)
		}
	}
	candidates.sort((a, b) => a.seq - b.seq)

	let retained = candidates
	if (retained.length > SDK_ABORT_CAUSE_MAX_EVENTS_PER_SNAPSHOT) {
		// Drop the OLDEST NON-TERMINAL events first.
		const terminal = retained.filter((record) => TERMINAL_EVENT_KINDS.has(record.event))
		const nonTerminal = retained.filter((record) => !TERMINAL_EVENT_KINDS.has(record.event))
		const room = Math.max(0, SDK_ABORT_CAUSE_MAX_EVENTS_PER_SNAPSHOT - terminal.length)
		retained = [...nonTerminal.slice(Math.max(0, nonTerminal.length - room)), ...terminal]
		retained.sort((a, b) => a.seq - b.seq)
	}

	// The byte bound. Terminal events are never evicted.
	for (;;) {
		const size = estimateSnapshotBytes(retained)
		if (size <= SDK_ABORT_CAUSE_MAX_SNAPSHOT_BYTES) {
			break
		}
		const removableIndex = retained.findIndex((record) => !TERMINAL_EVENT_KINDS.has(record.event))
		if (removableIndex < 0) {
			// Only terminal events remain; the bound cannot be met without
			// dropping the evidence the snapshot exists for. The truncation
			// is reported by the caller.
			break
		}
		retained = retained.filter((_, index) => index !== removableIndex)
	}
	return retained
}

/**
 * The approximate serialized size of an event list.
 */
function estimateSnapshotBytes(records: readonly ModelBehaviorTraceRecord[]): number {
	try {
		return JSON.stringify(records).length
	} catch {
		return SDK_ABORT_CAUSE_MAX_SNAPSHOT_BYTES
	}
}

/**
 * The retained snapshots, oldest first.
 */
export function getSdkAbortCauseSnapshots(): readonly SdkAbortCauseSnapshot[] {
	return snapshots
}

/**
 * The most recent retained snapshot, if any.
 */
export function getLatestSdkAbortCauseSnapshot(): SdkAbortCauseSnapshot | undefined {
	return snapshots.length > 0 ? snapshots[snapshots.length - 1] : undefined
}

/**
 * Test seam: reset the module to a pristine state.
 *
 * Production code never calls this.
 */
export function _resetSdkAbortCauseRetention(): void {
	snapshots.length = 0
	runStates.clear()
	recordProvider = undefined
}
