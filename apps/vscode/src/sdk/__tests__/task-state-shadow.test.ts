/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01 / Phase 16 — Differential comparator
 * test. Reproduces the live C04 bug class (legacy=idle, shadow=streaming)
 * and asserts the comparator records the divergence.
 */
import type { AgentRuntimeEvent } from "@cline/shared"
import { describe, expect, it } from "vitest"
import { TaskShadowComparator } from "../task-state-shadow"

const NOW = 1_700_000_000_000

function snapshotBase(overrides: Partial<AgentRuntimeEvent> = {}): AgentRuntimeEvent {
	const base: AgentRuntimeEvent = {
		type: "run-started",
		snapshot: {
			agentId: "a",
			status: "running",
			iteration: 0,
			messages: [],
			pendingToolCalls: [],
			usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
			runId: "run-1",
			recovery: {
				state: "idle",
				tracker: {
					state: "idle",
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
			execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
		},
	}
	return { ...base, ...overrides } as AgentRuntimeEvent
}

describe("TaskShadowComparator — E4-DIFF-01 ACTIVE_LEGACY_IDLE_DIVERGENCE", () => {
	it("captures legacy=idle / shadow=streaming divergence deterministically", () => {
		const cmp = new TaskShadowComparator()
		// Live bug shape: legacy TurnStateTracker has been prematurely
		// set to "idle" (e.g. followup-abandoned handler ran) while
		// the runtime is actively streaming. The legacy phase
		// recorded at this instant is "idle".
		const event = snapshotBase({
			type: "execution-state-changed",
			snapshot: {
				agentId: "a",
				status: "running",
				iteration: 1,
				messages: [],
				pendingToolCalls: [],
				usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
				runId: "run-1",
				recovery: {
					state: "idle",
					tracker: {
						state: "idle",
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
				execution: { modelStreaming: true, tooling: false, awaitingApproval: false },
			},
			previousExecution: { modelStreaming: false, tooling: false, awaitingApproval: false },
		})
		const { divergence } = cmp.observeRuntimeEvent(event, "idle", NOW + 1)
		expect(divergence).toBeDefined()
		expect(divergence?.legacyPhase).toBe("idle")
		expect(divergence?.shadowPhase).toBe("streaming")
		expect(divergence?.modelStreaming).toBe(true)
		// CORRECTION01-CLOSURE02: strict assertion.
		// The fixture is an `execution-state-changed` event whose
		// `previousExecution` differs from `execution` ONLY on
		// `modelStreaming` (false -> true). The edge-triggered
		// adapter therefore emits EXACTLY one TaskMsg:
		// `model_stream_started`. `tooling` and `awaitingApproval`
		// are unchanged (false -> false) and produce no TaskMsg.
		expect(divergence?.event).toBe("model_stream_started")
	})

	it("no divergence when legacy and shadow agree", () => {
		const cmp = new TaskShadowComparator()
		const event = snapshotBase({
			type: "execution-state-changed",
			snapshot: {
				agentId: "a",
				status: "running",
				iteration: 1,
				messages: [],
				pendingToolCalls: [],
				usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
				runId: "run-1",
				recovery: {
					state: "idle",
					tracker: {
						state: "idle",
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
				execution: { modelStreaming: true, tooling: false, awaitingApproval: false },
			},
			previousExecution: { modelStreaming: false, tooling: false, awaitingApproval: false },
		})
		const { divergence } = cmp.observeRuntimeEvent(event, "streaming", NOW + 1)
		expect(divergence).toBeUndefined()
	})

	it("privacy: divergences contain only typed state, no message prose", () => {
		const cmp = new TaskShadowComparator()
		const event = snapshotBase({
			type: "execution-state-changed",
			snapshot: {
				agentId: "a",
				status: "running",
				iteration: 1,
				messages: [],
				pendingToolCalls: [],
				usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
				runId: "run-1",
				recovery: {
					state: "idle",
					tracker: {
						state: "idle",
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
				execution: { modelStreaming: true, tooling: false, awaitingApproval: false },
			},
			previousExecution: { modelStreaming: false, tooling: false, awaitingApproval: false },
		})
		cmp.observeRuntimeEvent(event, "idle", NOW + 1)
		const all = cmp.getDivergences()
		expect(all).toHaveLength(1)
		const d = all[0]
		// Privacy: only typed values are present.
		const allowedKeys = new Set([
			"seq",
			"event",
			"legacyPhase",
			"shadowPhase",
			"lifecycleKind",
			"modelStreaming",
			"tooling",
			"awaitingApproval",
		])
		expect(new Set(Object.keys(d))).toEqual(allowedKeys)
	})
})
