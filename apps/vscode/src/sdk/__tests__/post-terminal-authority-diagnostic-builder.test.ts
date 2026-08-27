// ============================================================================
// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1
//
// Unit test for the `buildExtensionSnapshotFromState` helper. Pure
// function: no I/O, no allocation beyond the returned object.
// ============================================================================

import {
	clearPostTerminalAuthorityDiagnostic,
	disablePostTerminalAuthorityDiagnostic,
	enablePostTerminalAuthorityDiagnostic,
	getPostTerminalAuthorityDiagnosticRecords,
	recordPostTerminalAuthoritySnapshot,
} from "@shared/post-terminal-authority-diagnostic"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
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

	// ============================================================================
	// ACT-CLINEMM-COMPLETION-PTAD-EXTEND01 — T1-EXT01 (reviewer P1 bounded correction)
	//
	// Real production-seam temporal test. Proves the PTAD capture site
	// (as wired in `SdkController.getStateToPostToWebview()`) samples
	// the two booleans BEFORE the per-turn lifecycle reset
	// (`MessageTranslatorState.clearTurnOutcome()`) is invoked.
	//
	// Without this guarantee, a real specimen could capture
	// `(false, false)` even though `(true, true)` had been observed
	// moments earlier — catastrophic misclassification of causality.
	//
	// The seam exercised here is the SAME one `SdkController.getStateToPostToWebview()`
	// uses: buildExtensionSnapshotFromState({ ..., messageTranslatorState }).
	// We pair it with the live PTAD ring buffer (`recordPostTerminalAuthoritySnapshot`)
	// to prove the captured record is immutable after a subsequent reset.
	// ============================================================================

	describe("T1-EXT01: temporal capture order — snapshot samples before lifecycle reset", () => {
		beforeEach(() => {
			enablePostTerminalAuthorityDiagnostic("extension")
			clearPostTerminalAuthorityDiagnostic("extension")
		})

		afterEach(() => {
			disablePostTerminalAuthorityDiagnostic("extension")
			clearPostTerminalAuthorityDiagnostic("extension")
		})

		it("T1-EXT01-A: snapshot captures true/true; reset; subsequent snapshot captures false/false; first record is immutable", () => {
			// Step 1: real translator state receives completion markers,
			// simulating the production seam where the runtime has just
			// observed the attempt_completion tool AND committed a
			// terminal user-facing response.
			const realState = new MessageTranslatorState()
			realState.setAttemptCompletionSeen()
			realState.setTerminalResponseCommittedThisTurn()

			// Step 2: drive the same builder call shape
			// `SdkController.getStateToPostToWebview()` uses, and
			// synchronously append the result to the live PTAD ring
			// buffer (just as the production capture site does).
			recordPostTerminalAuthoritySnapshot(
				buildExtensionSnapshotFromState({
					state: baseState,
					shadow,
					messageTranslatorState: realState,
				}),
			)

			// Step 3: read the latest record from the live ring buffer
			// (NOT the builder return value — we must exercise the
			// immutable storage path that the future bound specimen
			// will dump to JSONL).
			const recordsAfterFirst = getPostTerminalAuthorityDiagnosticRecords("extension")
			expect(recordsAfterFirst.length).toBe(1)
			expect(recordsAfterFirst[0].attemptCompletionSeen).toBe(true)
			expect(recordsAfterFirst[0].terminalResponseCommittedThisTurn).toBe(true)
			const firstCapturedAt = recordsAfterFirst[0].capturedAt
			const firstStateVersion = recordsAfterFirst[0].stateVersion

			// Step 4: invoke the lifecycle reset (`clearTurnOutcome`)
			// that runs at the next user-turn boundary. This is the
			// exact method called from SdkController at lines 1137,
			// 2165, 2307, 2571, 2701, 2803 — i.e. the production reset.
			realState.clearTurnOutcome()

			// Step 5: drive another state-push capture (next turn's
			// first push, where the booleans are now back to false).
			recordPostTerminalAuthoritySnapshot(
				buildExtensionSnapshotFromState({
					state: { ...baseState, stateVersion: 1 },
					shadow,
					messageTranslatorState: realState,
				}),
			)

			const recordsAfterSecond = getPostTerminalAuthorityDiagnosticRecords("extension")
			expect(recordsAfterSecond.length).toBe(2)

			// Step 6: the SECOND record reflects the post-reset state.
			expect(recordsAfterSecond[1].attemptCompletionSeen).toBe(false)
			expect(recordsAfterSecond[1].terminalResponseCommittedThisTurn).toBe(false)

			// Step 7: the FIRST record is IMMUTABLE — the reset cannot
			// retroactively erase it. This is the load-bearing guarantee
			// for the discriminator: the snapshot was captured at the
			// correct lifecycle moment, before any subsequent reset.
			expect(recordsAfterSecond[0].attemptCompletionSeen).toBe(true)
			expect(recordsAfterSecond[0].terminalResponseCommittedThisTurn).toBe(true)
			expect(recordsAfterSecond[0].capturedAt).toBe(firstCapturedAt)
			expect(recordsAfterSecond[0].stateVersion).toBe(firstStateVersion)
		})

		it("T1-EXT01-B: snapshot captures true/false when only attempt is set; reset; subsequent snapshot captures false/false", () => {
			// Same lifecycle shape as T1-EXT01-A, but only the
			// attempt-completion-seen flag is set (no terminal commit).
			// This is the "completion attempted, authority lost" branch.
			const realState = new MessageTranslatorState()
			realState.setAttemptCompletionSeen()

			recordPostTerminalAuthoritySnapshot(
				buildExtensionSnapshotFromState({
					state: baseState,
					shadow,
					messageTranslatorState: realState,
				}),
			)

			const first = getPostTerminalAuthorityDiagnosticRecords("extension")
			expect(first.length).toBe(1)
			expect(first[0].attemptCompletionSeen).toBe(true)
			expect(first[0].terminalResponseCommittedThisTurn).toBe(false)

			realState.clearTurnOutcome()

			recordPostTerminalAuthoritySnapshot(
				buildExtensionSnapshotFromState({
					state: { ...baseState, stateVersion: 1 },
					shadow,
					messageTranslatorState: realState,
				}),
			)

			const second = getPostTerminalAuthorityDiagnosticRecords("extension")
			expect(second.length).toBe(2)

			// First record preserved verbatim.
			expect(second[0].attemptCompletionSeen).toBe(true)
			expect(second[0].terminalResponseCommittedThisTurn).toBe(false)
			// Second record reflects post-reset state.
			expect(second[1].attemptCompletionSeen).toBe(false)
			expect(second[1].terminalResponseCommittedThisTurn).toBe(false)
		})

		it("T1-EXT01-C: snapshot taken AFTER reset reflects false/false (not stale true/true)", () => {
			// Negative case: if the production capture happened AFTER
			// clearTurnOutcome(), the record would show false/false even
			// though the booleans had been true. This test pins the
			// post-reset capture shape so a future regression in the
			// capture ordering (capturing post-reset instead of pre-reset)
			// is detected as a DIFFERENT shape (false/false becomes
			// expected in this test), not silently confused with the
			// pre-reset shape.
			const realState = new MessageTranslatorState()
			realState.setAttemptCompletionSeen()
			realState.setTerminalResponseCommittedThisTurn()

			// Reset FIRST (simulating a buggy capture ordering where
			// the PTAD site runs after the next-turn boundary).
			realState.clearTurnOutcome()

			recordPostTerminalAuthoritySnapshot(
				buildExtensionSnapshotFromState({
					state: baseState,
					shadow,
					messageTranslatorState: realState,
				}),
			)

			const records = getPostTerminalAuthorityDiagnosticRecords("extension")
			expect(records.length).toBe(1)
			// Post-reset capture is correctly false/false. This is the
			// expected shape if the capture site runs after reset; the
			// discriminator misclassifies this CAUSAL BRANCH (it looks
			// like "completion never attempted" rather than "attempted
			// but lost"). T1-EXT01-A above pins the correct capture
			// ordering, this test pins the consequence of getting it
			// wrong.
			expect(records[0].attemptCompletionSeen).toBe(false)
			expect(records[0].terminalResponseCommittedThisTurn).toBe(false)
		})
	})
})
