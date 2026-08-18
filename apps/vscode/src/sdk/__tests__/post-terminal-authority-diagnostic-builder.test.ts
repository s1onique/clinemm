// ============================================================================
// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1
//
// Unit test for the `buildExtensionSnapshotFromState` helper. Pure
// function: no I/O, no allocation beyond the returned object.
// ============================================================================

import { describe, expect, it } from "vitest"
import { buildExtensionSnapshotFromState } from "../post-terminal-authority-diagnostic-builder"
import type { ArbiterSnapshot } from "../task-state-shadow-recorder"

describe("ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1 / builder", () => {
	const baseState = {
		stateVersion: 0,
		epoch: 7,
		taskId: "task-X",
		turnState: { phase: "idle" as const, seq: 12, anchorTs: 99 },
		thinkingPresentation: { modelStreaming: false, source: "shadow" as const, seq: 12 },
		taskTelemetry: { startedAt: 1000, endedAt: 5000, toolCalls: 3, recoveryBudgetFailures: 0 },
	}

	const shadow: ArbiterSnapshot = {
		execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
		recoveryState: "idle",
		status: "idle",
		pendingToolCalls: [],
	}

	const streamingShadow: ArbiterSnapshot = {
		execution: { modelStreaming: true, tooling: false, awaitingApproval: false },
		recoveryState: "idle",
		status: "running",
		pendingToolCalls: ["tc-1", "tc-2"],
	}

	it("B1: happy-path maps every authority field", () => {
		const result = buildExtensionSnapshotFromState({
			state: baseState,
			shadow,
			runtime: {
				status: "idle",
				executionModelStreaming: false,
				executionAwaitingApproval: false,
				pendingToolCalls: 0,
			},
		})
		expect(result.origin).toBe("extension")
		expect(result.stateVersion).toBe(0)
		expect(result.epoch).toBe(7)
		expect(result.taskId).toBe("task-X")
		expect(result.legacyPhase).toBe("idle")
		expect(result.legacySeq).toBe(12)
		expect(result.legacyAnchorTs).toBe(99)
		expect(result.shadowStatus).toBe("idle")
		expect(result.shadowRecoveryState).toBe("idle")
		expect(result.shadowModelStreaming).toBe(false)
		expect(result.shadowTooling).toBe(false)
		expect(result.shadowAwaitingApproval).toBe(false)
		expect(result.shadowPendingToolCount).toBe(0)
		expect(result.thinkingPresentation?.modelStreaming).toBe(false)
		expect(result.taskTelemetry?.startedAt).toBe(1000)
		expect(result.runtimeStatus).toBe("idle")
	})

	it("B2: shadow fields reflect streaming runtime and pending tools", () => {
		const result = buildExtensionSnapshotFromState({
			state: baseState,
			shadow: streamingShadow,
			runtime: {
				status: "running",
				executionModelStreaming: true,
				pendingToolCalls: 2,
			},
		})
		expect(result.shadowModelStreaming).toBe(true)
		expect(result.shadowStatus).toBe("running")
		expect(result.shadowPendingToolCount).toBe(2)
		expect(result.runtimeStatus).toBe("running")
		expect(result.runtimeModelStreaming).toBe(true)
		expect(result.runtimePendingToolCount).toBe(2)
	})

	it("B3: missing stateVersion defaults to 0", () => {
		const { stateVersion, ...stateWithoutVersion } = baseState
		void stateVersion
		const result = buildExtensionSnapshotFromState({
			state: stateWithoutVersion,
			shadow: undefined,
		})
		expect(result.stateVersion).toBe(0)
		expect(result.shadowStatus).toBeUndefined()
	})

	it("B4: shadow can be undefined (no observation yet)", () => {
		const result = buildExtensionSnapshotFromState({
			state: baseState,
			shadow: undefined,
		})
		expect(result.shadowStatus).toBeUndefined()
		expect(result.shadowModelStreaming).toBeUndefined()
		expect(result.shadowPendingToolCount).toBeUndefined()
		// The legacy/thinkingPresentation fields must still be populated.
		expect(result.legacyPhase).toBe("idle")
		expect(result.thinkingPresentation?.modelStreaming).toBe(false)
	})

	it("B5: runtime can be omitted (falls back to shadow-derived fields)", () => {
		// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1-CORRECTION01:
		// When the caller does not pass an explicit runtime arg, the builder
		// derives the runtime fields from the shadow. The shadow IS the
		// canonical runtime projection, so this fallback is the truthful
		// state — not a degraded signal.
		const result = buildExtensionSnapshotFromState({
			state: baseState,
			shadow,
		})
		expect(result.runtimeStatus).toBe("idle")
		expect(result.runtimeModelStreaming).toBe(false)
		expect(result.runtimePendingToolCount).toBe(0)
	})

	it("B6: result has capturedAt = Date.now() (within tolerance)", () => {
		const before = Date.now()
		const result = buildExtensionSnapshotFromState({ state: baseState, shadow })
		const after = Date.now()
		expect(result.capturedAt).toBeGreaterThanOrEqual(before)
		expect(result.capturedAt).toBeLessThanOrEqual(after)
	})
})
