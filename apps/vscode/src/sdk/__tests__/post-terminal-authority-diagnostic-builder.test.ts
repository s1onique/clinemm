// ============================================================================
// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1
//
// Unit test for the `buildExtensionSnapshotFromState` helper. Pure
// function: no I/O, no allocation beyond the returned object.
// ============================================================================

import { describe, expect, it } from "vitest"
import { MessageTranslatorState } from "../message-translator"
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

	it("B7: captureKind is always 'extension-push' (extension-side producer invariant)", () => {
		// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C2-CORRECTION01-REPLICA-TRUTH:
		// Every extension-side record is stamped with `captureKind: "extension-push"`.
		// The C2 live smoke proved that without `captureKind` the webview records
		// collapsed into a single ambiguous bucket; this pins the extension-side
		// discriminator so the per-site assertion is testable.
		const result = buildExtensionSnapshotFromState({ state: baseState, shadow })
		expect(result.captureKind).toBe("extension-push")
	})

	it("B8: _ptadPushId propagates verbatim from state._ptadPushId", () => {
		// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C2-CORRECTION01-REPLICA-TRUTH:
		// The extension mints the push ID and stamps it into both the wire payload
		// (a private `_ptadPushId` field) and the diagnostic record. The builder
		// just passes the value through — it must NOT derive, increment, or mutate
		// the push ID.
		const result = buildExtensionSnapshotFromState({
			state: { ...baseState, _ptadPushId: 4242 },
			shadow,
		})
		expect(result._ptadPushId).toBe(4242)
	})

	it("B9: _ptadPushId is undefined when the state does not carry one", () => {
		// In production (PTAD toggle OFF) the wire payload never carries a push ID,
		// so the diagnostic record must reflect that with `undefined` rather than
		// fabricating a value.
		const result = buildExtensionSnapshotFromState({ state: baseState, shadow })
		expect(result._ptadPushId).toBeUndefined()
	})

	// ============================================================================
	// ACT-CLINEMM-COMPLETION-PTAD-EXTEND01
	//
	// B1-EXT01 through B4-EXT01 pin the matrix over the new
	// `attemptCompletionSeen` / `terminalResponseCommittedThisTurn`
	// fields, sourced from `MessageTranslatorState` via the
	// structural `Pick<>` type on the builder args.
	//
	// S1-EXT01 is the load-bearing structural authority test: it
	// proves the snapshot values come from the real
	// `MessageTranslatorState` accessors, not from a duplicated
	// boolean invented in the builder or PTAD.
	// ============================================================================

	it("B1-EXT01: no messageTranslatorState → both new fields are undefined (no-zero-delta)", () => {
		// When `messageTranslatorState` is NOT supplied (the PTAD-disabled
		// code path, or call sites predating the EXTEND01 schema), the
		// new fields must propagate `undefined` — NOT default to `false`,
		// because that would conflate "PTAD off" with "PTAD on, false".
		// Absent vs false is load-bearing for the discriminator: a
		// specimen with `attemptCompletionSeen === undefined` proves
		// no measurement was taken, while `=== false` proves the
		// canonical authority answered no.
		const result = buildExtensionSnapshotFromState({ state: baseState, shadow })
		expect(result.attemptCompletionSeen).toBeUndefined()
		expect(result.terminalResponseCommittedThisTurn).toBeUndefined()
	})

	it("B2-EXT01: attempt=false, committed=false → snapshot has false/false (NOT undefined)", () => {
		// The structural `Pick<MessageTranslatorState, ...>` is satisfied
		// by a minimal duck-typed stub here. The full real
		// `MessageTranslatorState` is exercised by S1-EXT01 below.
		const stub = {
			wasAttemptCompletionSeen: () => false,
			wasTerminalResponseCommittedThisTurn: () => false,
		}
		const result = buildExtensionSnapshotFromState({ state: baseState, shadow, messageTranslatorState: stub })
		expect(result.attemptCompletionSeen).toBe(false)
		expect(result.terminalResponseCommittedThisTurn).toBe(false)
	})

	it("B3-EXT01: attempt=true, committed=false → snapshot has true/false", () => {
		// The completion tool was invoked but the canonical terminal
		// surface was never committed. This is the
		// "completion attempted, authority lost" branch.
		const stub = {
			wasAttemptCompletionSeen: () => true,
			wasTerminalResponseCommittedThisTurn: () => false,
		}
		const result = buildExtensionSnapshotFromState({ state: baseState, shadow, messageTranslatorState: stub })
		expect(result.attemptCompletionSeen).toBe(true)
		expect(result.terminalResponseCommittedThisTurn).toBe(false)
	})

	it("B4-EXT01: attempt=true, committed=true → snapshot has true/true", () => {
		// Both flags true means the canonical terminal surface WAS
		// published. Presentation defects are then the relevant
		// downstream causal seam (not completion-protocol-liveness).
		const stub = {
			wasAttemptCompletionSeen: () => true,
			wasTerminalResponseCommittedThisTurn: () => true,
		}
		const result = buildExtensionSnapshotFromState({ state: baseState, shadow, messageTranslatorState: stub })
		expect(result.attemptCompletionSeen).toBe(true)
		expect(result.terminalResponseCommittedThisTurn).toBe(true)
	})

	it("S1-EXT01: snapshot values come from real MessageTranslatorState authority (load-bearing)", () => {
		// PROVES the snapshot reads `wasAttemptCompletionSeen` /
		// `wasTerminalResponseCommittedThisTurn` from a real
		// `MessageTranslatorState` instance (constructed via the real
		// constructor, mutated via the real public setters), and that
		// the snapshot preserves the values verbatim — NOT as duplicated
		// booleans invented in the builder or in PTAD.
		//
		// If this test fails, the discriminator has been silently
		// severed from its canonical authority and any future capture
		// is INVALID for causal classification.
		const realState = new MessageTranslatorState()
		realState.setAttemptCompletionSeen()
		realState.setTerminalResponseCommittedThisTurn()

		const result = buildExtensionSnapshotFromState({
			state: baseState,
			shadow,
			messageTranslatorState: realState,
		})
		expect(result.attemptCompletionSeen).toBe(true)
		expect(result.terminalResponseCommittedThisTurn).toBe(true)

		// Reset and confirm the snapshot tracks the live state.
		// (We don't reset in-place because that would invalidate the
		// reference; we build a fresh state and check the false/false
		// case as a second probe.)
		const realStateFalse = new MessageTranslatorState()
		const result2 = buildExtensionSnapshotFromState({
			state: baseState,
			shadow,
			messageTranslatorState: realStateFalse,
		})
		expect(result2.attemptCompletionSeen).toBe(false)
		expect(result2.terminalResponseCommittedThisTurn).toBe(false)
	})
})
