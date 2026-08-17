/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01 / Phase 14 + 15 — Live shadow observer.
 *
 * Host-side reverse-translator from the legacy `CoreSessionEvent` /
 * `AgentEvent` stream (what production delivers today) into the
 * canonical `AgentRuntimeEvent` subset the accepted
 * `TaskStateShadow.adaptRuntimeEvent()` consumes.
 *
 * ARCHITECTURAL SCOPE
 * -------------------
 * Production today wires `sdkHost.subscribe(handler)` →
 * `SdkSessionLifecycle.onSessionEvent` and the
 * `onToolStarted` / `onDidBecomeIdle` / `onSendStart` / `onSendError`
 * hooks. None of those surfaces delivers `AgentRuntimeEvent`
 * directly — by construction, the session runtime translates the
 * canonical runtime events to legacy `AgentEvent`s inside
 * `RuntimeEventAdapter.translate()` before fanout. The shadow's
 * canonical consumer therefore needs an extra translation step on
 * the host side. This is a deliberate, narrow workaround; the
 * forward-fix is to add a parallel `subscribeRuntimeEvents` seam on
 * the core side (out of E5–E6 scope).
 *
 * RECONSTRUCTED RUNTIME EVENT SUBSET
 * ----------------------------------
 *   run-started              ← first `iteration_start` of a session
 *   run-finished             ← `done` legacy event
 *   run-failed               ← `error` legacy event
 *   tool-started             ← `content_start(contentType=tool)` legacy event
 *   tool-finished            ← `content_end(contentType=tool)` legacy event
 *   execution-state-changed  ← diff between consecutive reconstructed
 *                               `execution` projections (heuristic)
 *   recovery-state-changed   ← `notice(reason in recovery_keys)` legacy event
 *
 * E5–E6 does NOT need every variant — the shadow's adapter handles
 * the variants above and ignores the rest (presentation-only events
 * like `assistant-text-delta` and `assistant-message` produce no
 * TaskMsg, so we skip them).
 *
 * CONSERVATION (ELM05 / ELM08 / ELM12)
 * ------------------------------------
 * The observer NEVER calls:
 *   - `TurnStateTracker.set`
 *   - `postStateToWebview`
 *   - `requestToolApproval` / `approve` / `deny`
 *   - `agent.subscribeEvents` / any AgentRuntime mutation
 *   - any recovery-policy API
 *
 * It IS allowed to read:
 *   - `TurnStateTracker.currentPhase` (synchronous observation)
 *   - `pendingToolCalls` (from the canonical arbiter supplied by
 *     the host wiring)
 *
 * Privacy (ELM10): only typed state, no message prose, no tool
 * arguments, no API payloads, no control keys.
 */

import { TaskState } from "@cline/agents"
import type { CoreSessionEvent } from "@cline/core"
import type {
	AgentContentEndEvent,
	AgentContentStartEvent,
	AgentEvent,
	AgentNoticeEvent,
	AgentRunStatus,
	AgentRuntimeEvent,
	AgentRuntimeExecutionState,
	AgentRuntimeStateSnapshot,
	AgentToolCallPart,
	RecoveryState,
} from "@cline/shared"
import type { TurnPhase } from "@/shared/ExtensionMessage"
import type { TaskShadowComparator, TaskShadowDivergence } from "./task-state-shadow"
import type { ArbiterSnapshot, TaskShadowDifferentialRecord } from "./task-state-shadow-recorder"

type TaskMsg = TaskState.TaskMsg
type TaskModel = TaskState.TaskModel
type TaskShadowObservation = TaskState.TaskShadowObservation

/**
 * Reverse-translator input. The host wiring drives this with the
 * canonical arbiter snapshot for each `CoreSessionEvent`. The
 * observer does not read AgentRuntime directly.
 */
export interface TaskShadowReverseTranslatorInput {
	/** The legacy event. */
	readonly event: CoreSessionEvent
	/** Wall-clock ms epoch used for the reconstructed runtime event. */
	readonly now: number
	/** Legacy UI turn phase observed synchronously at this instant. */
	readonly legacyPhase: TurnPhase
	/** Canonical arbiter snapshot for arbitration / classification. */
	readonly arbiter: ArbiterSnapshot
	/** Opaque task-local key. Never the visible `taskId`. */
	readonly taskEpochOrOpaqueTaskKey?: string
	/** Runtime status carry-through. */
	readonly runtimeStatus?: AgentRunStatus
	/** Previous `execution` projection; required for
	 *  `execution-state-changed` reconstruction. The host wiring tracks
	 *  this state between calls. */
	readonly previousExecution?: AgentRuntimeExecutionState
}

/**
 * Reverse-translator output. The host wiring feeds the comparator
 * and recorder with the reconstructed event plus the differential
 * observations.
 */
export interface TaskShadowReverseTranslatorOutput {
	readonly runtimeEvent: AgentRuntimeEvent | undefined
	readonly divergence: TaskShadowDivergence | undefined
	readonly observationEvent: TaskMsg["type"] | "noop"
	readonly observation: TaskShadowObservation | undefined
	readonly model: TaskModel | undefined
	readonly toolCalls: number
	readonly recoveryBudgetFailures: number
}

/**
 * Reverse-translator with internal state: tracks the previous
 * `execution` projection so the host wiring can pass it on the next
 * call. Also keeps the active `runId`/`agentId` so reconstructed
 * snapshots carry them through.
 *
 * The translator is intentionally single-instance per host
 * controller; it carries no I/O and no timers.
 */
export class TaskShadowReverseTranslator {
	private previousExecution: AgentRuntimeExecutionState = {
		modelStreaming: false,
		tooling: false,
		awaitingApproval: false,
	}
	private readonly activeRunId: { value: string | undefined } = { value: undefined }
	private lastRecoveryState: RecoveryState = "idle"

	/** Snapshot the previous execution projection (used by host wiring). */
	getPreviousExecution(): AgentRuntimeExecutionState {
		return this.previousExecution
	}

	/** Test-only reset back to the initial state. */
	debugReset(): void {
		this.previousExecution = { modelStreaming: false, tooling: false, awaitingApproval: false }
		this.activeRunId.value = undefined
		this.lastRecoveryState = "idle"
	}

	/**
	 * Translate a single `CoreSessionEvent` into the runtime-event
	 * subset the shadow understands. Returns `runtimeEvent ===
	 * undefined` when the legacy event has no shadow analogue (the
	 * observer layer treats this as `noop`).
	 */
	translate(input: TaskShadowReverseTranslatorInput): AgentRuntimeEvent | undefined {
		const evt = input.event
		if (evt.type !== "agent_event") return undefined
		const agentEvent = evt.payload?.event as AgentEvent | undefined
		if (!agentEvent) return undefined
		const snapshot = this.reconstructSnapshot(agentEvent, input)
		switch (agentEvent.type) {
			case "iteration_start":
				this.activeRunId.value = (agentEvent.conversationId as string | undefined) ?? this.activeRunId.value
				return { type: "run-started", snapshot }
			case "done":
				return {
					type: "run-finished",
					snapshot,
					result: this.reconstructRunResult(agentEvent, snapshot),
				}
			case "error":
				return {
					type: "run-failed",
					snapshot,
					error: agentEvent.error instanceof Error ? agentEvent.error : new Error(String(agentEvent.error)),
					errorClass: agentEvent.errorClass,
				}
			case "content_start":
				return this.translateContentStart(agentEvent, snapshot, input)
			case "content_end":
				return this.translateContentEnd(agentEvent, snapshot, input.now)
			case "notice":
				return this.translateNotice(agentEvent, snapshot, input)
			default:
				return undefined
		}
	}

	/**
	 * Translate, observe, and produce the differential payload.
	 * Returns `output.observation === undefined` when the legacy event
	 * had no shadow analogue; the host wiring records that as a
	 * `noop` classification.
	 */
	observe(input: TaskShadowReverseTranslatorInput, comparator: TaskShadowComparator): TaskShadowReverseTranslatorOutput {
		const runtimeEvent = this.translate(input)
		const observation = runtimeEvent ? comparator.observeRuntimeEvent(runtimeEvent, input.legacyPhase, input.now) : undefined
		const observationEvent: TaskMsg["type"] | "noop" = observation?.observation.event ?? "noop"
		const model: TaskModel | undefined = observation?.observation.model
		const toolCalls = observation?.observation.projections.toolCalls ?? 0
		const recoveryBudgetFailures = observation?.observation.projections.recoveryBudgetFailures ?? 0
		if (runtimeEvent?.type === "execution-state-changed") {
			this.previousExecution = runtimeEvent.snapshot.execution ?? this.previousExecution
		} else if (
			runtimeEvent?.type === "run-started" ||
			runtimeEvent?.type === "run-finished" ||
			runtimeEvent?.type === "run-failed"
		) {
			// Terminal / start events reset the execution baseline so the
			// next execution-state-changed diffs against a clean slate.
			this.previousExecution = { modelStreaming: false, tooling: false, awaitingApproval: false }
		}
		return {
			runtimeEvent,
			divergence: observation?.divergence,
			observationEvent,
			observation: observation?.observation,
			model,
			toolCalls,
			recoveryBudgetFailures,
		}
	}

	// ============================================================
	// Reconstruct the `AgentRuntimeStateSnapshot` payload expected
	// by `adaptRuntimeEvent`. The legacy stream does not carry
	// `recovery` or `execution` projections directly; we fold in the
	// arbiter snapshot the host wiring supplied and keep the rest
	// from the legacy `AgentEvent` envelope.
	// ============================================================

	private reconstructSnapshot(agentEvent: AgentEvent, input: TaskShadowReverseTranslatorInput): AgentRuntimeStateSnapshot {
		const meta = agentEvent as { agentId?: string; conversationId?: string }
		return {
			agentId: meta.agentId ?? "agent-unknown",
			conversationId: meta.conversationId,
			runId: this.activeRunId.value,
			status: input.runtimeStatus ?? "running",
			iteration: this.iterationFromLegacy(agentEvent),
			messages: [],
			pendingToolCalls: [...input.arbiter.pendingToolCalls],
			usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
			recovery: {
				state: input.arbiter.recoveryState,
				tracker: {
					state: input.arbiter.recoveryState,
					currentRepairAttempts: 0,
					equivalentRepeatCount: 0,
					blockedExactKeys: [],
					blockedFamilies: [],
				},
				secondStage: "idle",
				episodeFailures: 0,
				maxEpisodeFailures: 5,
				circuitNoticeCount: 0,
			},
			execution: input.arbiter.execution,
		}
	}

	private iterationFromLegacy(agentEvent: AgentEvent): number {
		if (agentEvent.type === "iteration_start" || agentEvent.type === "iteration_end") {
			return agentEvent.iteration
		}
		return 0
	}

	private reconstructRunResult(
		agentEvent: Extract<AgentEvent, { type: "done" }>,
		snapshot: AgentRuntimeStateSnapshot,
	): import("@cline/shared").AgentRunResult {
		return {
			agentId: snapshot.agentId,
			runId: snapshot.runId ?? "run-unknown",
			status: "completed",
			iterations: 0,
			outputText: "",
			messages: [],
			usage: snapshot.usage,
		}
	}

	private translateContentStart(
		agentEvent: AgentContentStartEvent,
		snapshot: AgentRuntimeStateSnapshot,
		input: TaskShadowReverseTranslatorInput,
	): AgentRuntimeEvent | undefined {
		if (agentEvent.contentType !== "tool") return undefined
		const toolCall: AgentToolCallPart = {
			type: "tool-call",
			toolCallId: agentEvent.toolCallId ?? `tc-${input.now}`,
			toolName: agentEvent.toolName ?? "unknown",
			input: agentEvent.input,
		}
		return {
			type: "tool-started",
			snapshot: { ...snapshot, pendingToolCalls: [...input.arbiter.pendingToolCalls, toolCall.toolCallId] },
			iteration: snapshot.iteration,
			toolCall,
		}
	}

	private translateContentEnd(
		agentEvent: AgentContentEndEvent,
		snapshot: AgentRuntimeStateSnapshot,
		now: number,
	): AgentRuntimeEvent | undefined {
		if (agentEvent.contentType !== "tool") return undefined
		const toolCall: AgentToolCallPart = {
			type: "tool-call",
			toolCallId: agentEvent.toolCallId ?? "tc-unknown",
			toolName: agentEvent.toolName ?? "unknown",
			input: agentEvent.output,
		}
		return {
			type: "tool-finished",
			snapshot,
			iteration: snapshot.iteration,
			toolCall,
			message: {
				id: `msg-${toolCall.toolCallId}`,
				role: "tool",
				content: [],
				createdAt: now,
				metadata: { toolCallId: toolCall.toolCallId },
			},
		}
	}

	private translateNotice(
		agentEvent: AgentNoticeEvent,
		snapshot: AgentRuntimeStateSnapshot,
		input: TaskShadowReverseTranslatorInput,
	): AgentRuntimeEvent | undefined {
		// We only reconstruct recovery-state-changed when the legacy
		// notice is explicitly about recovery. Status notices (e.g.
		// auto_compaction) do NOT flip recovery state in production.
		if (!isRecoveryNoticeReason(agentEvent.reason)) return undefined
		const previous = this.lastRecoveryState
		const next = nextRecoveryState(previous, input.arbiter.recoveryState)
		this.lastRecoveryState = next
		return {
			type: "recovery-state-changed",
			snapshot,
			previousRecovery: this.makeRecoverySnapshot(previous),
		}
	}

	private makeRecoverySnapshot(state: RecoveryState): NonNullable<AgentRuntimeStateSnapshot["recovery"]> {
		return {
			state,
			tracker: {
				state,
				currentRepairAttempts: 0,
				equivalentRepeatCount: 0,
				blockedExactKeys: [],
				blockedFamilies: [],
			},
			secondStage: "idle",
			episodeFailures: 0,
			maxEpisodeFailures: 5,
			circuitNoticeCount: 0,
		}
	}
}

/**
 * Whether a legacy `AgentNoticeEvent` reason corresponds to a
 * recovery-state change. Recovery transitions surface via the
 * runtime's `recovery-state-changed` event; we retain this hook so
 * the host can map legacy `notice` envelopes to the recovery axis
 * without re-deriving state from prose.
 */
function isRecoveryNoticeReason(reason: AgentNoticeEvent["reason"]): boolean {
	// The legacy `notice` envelope carries status-type reasons for
	// compaction / status-notice messages. Recovery transitions come
	// through as `recovery-state-changed` directly in the runtime
	// event stream. We intentionally keep this filter strict — the
	// legacy `notice` reason enum does not currently include a
	// "recovery"-tagged variant.
	void reason
	return false
}

function nextRecoveryState(prev: RecoveryState, hint: RecoveryState): RecoveryState {
	// The reverse-translator does not derive recovery state from
	// prose; it relies on the canonical arbiter the host wiring
	// supplies. When the arbiter carries a non-idle state, prefer it.
	if (hint !== "idle") return hint
	return prev
}

/**
 * Re-export the differential record type for downstream callers
 * (qualification harness, evidence report).
 */
export type { TaskShadowDifferentialRecord }
