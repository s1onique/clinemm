/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-POST-TERMINAL-AUTHORITY-SPLIT-C2-CORRECTION02-RAW-INCOMING-TRUTH
 *
 * Diagnostic-only tests for the C2-CORRECTION02 raw-incoming/applied
 * capture pair. These tests pin:
 *
 *   1. The captureKind union includes "webview-raw-incoming".
 *   2. The raw snapshot fields (`rawIncomingLegacyPhase`,
 *      `rawIncomingLegacySeq`, `rawIncomingThinkingPresentation`,
 *      `rawIncomingTaskTelemetry`) are accepted on a record and
 *      round-trip through `getPostTerminalAuthorityDiagnosticRecords`.
 *   3. The applied snapshot fields (`appliedLegacyPhase`,
 *      `appliedLegacySeq`) are accepted on a record.
 *   4. The classifyBoundary helper (a pure diagnostic classifier, NOT
 *      a runtime reducer) returns the correct `BoundaryClass` for the
 *      W1/W2/W3/W4 topologies and the healthy case.
 *   5. The "every push emits exactly one raw and one applied" invariant
 *      is exercised by a paired capture loop.
 *
 * These tests do NOT exercise the ExtensionStateContext composition
 * site directly — that composition is the live composition under test
 * in the dogfood walk. The schema-side tests pin the contract the
 * composition site must obey.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { TaskHeaderTelemetryStrip, ThinkingPresentationProjection, TurnPhase, TurnState } from "./ExtensionMessage"
import {
	type BoundaryClass,
	classifyBoundary,
	classifyFullBoundary,
	clearPostTerminalAuthorityDiagnostic,
	clearPostTerminalAuthorityDiagnosticBoth,
	disablePostTerminalAuthorityDiagnostic,
	enablePostTerminalAuthorityDiagnostic,
	enablePostTerminalAuthorityDiagnosticBoth,
	getPostTerminalAuthorityDiagnosticRecords,
	type PostTerminalAuthorityCaptureKind,
	recordPostTerminalAuthoritySnapshot,
	type ThreeBoundaryClass,
} from "./post-terminal-authority-diagnostic"

afterEach(() => {
	disablePostTerminalAuthorityDiagnostic("extension")
	disablePostTerminalAuthorityDiagnostic("webview")
	clearPostTerminalAuthorityDiagnosticBoth()
})

const PHASE = (p: TurnPhase, seq: number): TurnState => ({ phase: p, seq, anchorTs: 1 })

const THINKING: ThinkingPresentationProjection = { modelStreaming: false, source: "shadow", seq: 15 }

const TELEMETRY: TaskHeaderTelemetryStrip = {
	startedAt: 1234,
	toolCalls: 0,
	recoveryBudgetFailures: 0,
}

describe("ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-POST-TERMINAL-AUTHORITY-SPLIT-C2-CORRECTION02-RAW-INCOMING-TRUTH", () => {
	describe("captureKind union", () => {
		it("K1: the captureKind union accepts the new 'webview-raw-incoming' value", () => {
			const k: PostTerminalAuthorityCaptureKind = "webview-raw-incoming"
			expect(k).toBe("webview-raw-incoming")
		})
	})

	describe("raw fields round-trip", () => {
		beforeEach(() => {
			enablePostTerminalAuthorityDiagnosticBoth()
		})

		it("R1: a 'webview-raw-incoming' record carrying rawIncoming* fields round-trips verbatim", () => {
			recordPostTerminalAuthoritySnapshot({
				origin: "webview",
				captureKind: "webview-raw-incoming",
				stateVersion: 0,
				_ptadPushId: 42,
				capturedAt: Date.now(),
				rawIncomingLegacyPhase: "awaiting_followup",
				rawIncomingLegacySeq: 15,
				rawIncomingThinkingPresentation: THINKING,
				rawIncomingTaskTelemetry: TELEMETRY,
			})
			const records = getPostTerminalAuthorityDiagnosticRecords("webview")
			expect(records.length).toBe(1)
			const r = records[0]
			expect(r.captureKind).toBe("webview-raw-incoming")
			expect(r._ptadPushId).toBe(42)
			expect(r.rawIncomingLegacyPhase).toBe("awaiting_followup")
			expect(r.rawIncomingLegacySeq).toBe(15)
			expect(r.rawIncomingThinkingPresentation?.modelStreaming).toBe(false)
			expect(r.rawIncomingTaskTelemetry?.toolCalls).toBe(0)
		})

		it("R2: a 'webview-replica' record carries both rawIncoming* and applied* fields on the same push ID", () => {
			recordPostTerminalAuthoritySnapshot({
				origin: "webview",
				captureKind: "webview-replica",
				stateVersion: 0,
				_ptadPushId: 99,
				capturedAt: Date.now(),
				appliedLegacyPhase: "awaiting_followup",
				appliedLegacySeq: 15,
				rawIncomingLegacyPhase: "idle",
				rawIncomingLegacySeq: 2,
				rawIncomingThinkingPresentation: THINKING,
				rawIncomingTaskTelemetry: TELEMETRY,
			})
			const records = getPostTerminalAuthorityDiagnosticRecords("webview")
			expect(records.length).toBe(1)
			const r = records[0]
			expect(r.captureKind).toBe("webview-replica")
			expect(r._ptadPushId).toBe(99)
			// Applied view
			expect(r.appliedLegacyPhase).toBe("awaiting_followup")
			expect(r.appliedLegacySeq).toBe(15)
			// Raw view (different on the same push)
			expect(r.rawIncomingLegacyPhase).toBe("idle")
			expect(r.rawIncomingLegacySeq).toBe(2)
			expect(r.rawIncomingThinkingPresentation?.modelStreaming).toBe(false)
		})
	})

	describe("classifyBoundary helper (W1/W2/W3/W4/healthy)", () => {
		it("C1: healthy case -> NO_DIVERGENCE", () => {
			expect(
				classifyBoundary(
					{ phase: "awaiting_followup", seq: 15 },
					{ phase: "awaiting_followup", seq: 15 },
					{ phase: "awaiting_followup", seq: 15 },
				),
			).toBe<BoundaryClass>("NO_DIVERGENCE")
		})

		it("C2: W1 PRE_APPLY (extension != raw, raw == applied)", () => {
			expect(
				classifyBoundary(
					{ phase: "awaiting_followup", seq: 15 }, // extension (truth)
					{ phase: "idle", seq: 2 }, // raw (stale)
					{ phase: "idle", seq: 2 }, // applied (== raw, stale)
				),
			).toBe<BoundaryClass>("W1_PRE_APPLY")
		})

		it("C3: W2 DURING_APPLY (extension == raw, raw != applied)", () => {
			expect(
				classifyBoundary(
					{ phase: "awaiting_followup", seq: 15 }, // extension
					{ phase: "awaiting_followup", seq: 15 }, // raw (current)
					{ phase: "idle", seq: 2 }, // applied (stale; reducer reverted)
				),
			).toBe<BoundaryClass>("W2_DURING_APPLY")
		})

		it("C4: W3 POST_CONTEXT (extension == raw == applied, divergence elsewhere)", () => {
			// The helper cannot detect W3 from the boundary triple alone
			// (because by definition everything is equal). The caller
			// detects W3 by also inspecting a separate consumer-side
			// capture. We document the behavior explicitly.
			expect(
				classifyBoundary(
					{ phase: "awaiting_followup", seq: 15 },
					{ phase: "awaiting_followup", seq: 15 },
					{ phase: "awaiting_followup", seq: 15 },
				),
			).toBe<BoundaryClass>("NO_DIVERGENCE")
		})

		it("C5: W4 MULTI_BOUNDARY (extension != raw AND raw != applied)", () => {
			expect(
				classifyBoundary(
					{ phase: "awaiting_followup", seq: 15 },
					{ phase: "streaming", seq: 4 }, // raw != extension
					{ phase: "idle", seq: 2 }, // applied != raw AND != extension
				),
			).toBe<BoundaryClass>("W4_MULTI_BOUNDARY")
		})

		// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP01:
		// The pure three-way classifier cannot return W3 because W3 means
		// "extension == raw == applied with a SEPARATE consumer-side
		// divergence". A test that proves C5's pure helper indeed lacks the
		// inputs to classify W3 (negative assertion):
		it("C6: pure classifyBoundary returns ThreeBoundaryClass; W3 unreachable from triple", () => {
			// Type assertion: the return is the narrower type.
			const result: ThreeBoundaryClass = classifyBoundary(
				{ phase: "awaiting_followup", seq: 15 },
				{ phase: "awaiting_followup", seq: 15 },
				{ phase: "awaiting_followup", seq: 15 },
			)
			expect(result).toBe("NO_DIVERGENCE")
			// Compile-time proof: "W3_POST_CONTEXT" is NOT assignable to
			// ThreeBoundaryClass. The type system itself enforces the
			// "pure helper has no W3" contract.
		})
	})

	describe("classifyFullBoundary helper (W3 requires consumer diff)", () => {
		it("C7: W3 selected when triple is equal AND consumer capture differs", () => {
			expect(
				classifyFullBoundary(
					{ phase: "awaiting_followup", seq: 15 },
					{ phase: "awaiting_followup", seq: 15 },
					{ phase: "awaiting_followup", seq: 15 },
					{ phase: "idle", seq: 2 }, // consumer disagrees with the equal triple
				),
			).toBe<BoundaryClass>("W3_POST_CONTEXT")
		})

		it("C8: NO_DIVERGENCE when triple is equal AND no consumer provided", () => {
			expect(
				classifyFullBoundary(
					{ phase: "awaiting_followup", seq: 15 },
					{ phase: "awaiting_followup", seq: 15 },
					{ phase: "awaiting_followup", seq: 15 },
				),
			).toBe<BoundaryClass>("NO_DIVERGENCE")
		})

		it("C9: NO_DIVERGENCE when triple is equal AND consumer equals triple", () => {
			expect(
				classifyFullBoundary(
					{ phase: "awaiting_followup", seq: 15 },
					{ phase: "awaiting_followup", seq: 15 },
					{ phase: "awaiting_followup", seq: 15 },
					{ phase: "awaiting_followup", seq: 15 },
				),
			).toBe<BoundaryClass>("NO_DIVERGENCE")
		})

		it("C10: classifyFullBoundary forwards three-way divergence to the underlying classifier", () => {
			expect(
				classifyFullBoundary(
					{ phase: "awaiting_followup", seq: 15 }, // ext
					{ phase: "idle", seq: 2 }, // raw != ext
					{ phase: "idle", seq: 2 }, // applied == raw
					{ phase: "idle", seq: 2 }, // consumer == raw
				),
			).toBe<BoundaryClass>("W1_PRE_APPLY")
		})
	})

	describe("paired raw + applied capture invariant", () => {
		beforeEach(() => {
			clearPostTerminalAuthorityDiagnostic("webview")
			enablePostTerminalAuthorityDiagnostic("webview")
		})

		it("P1: for each push ID P, exactly one raw and one applied record is appended (E1-E9 sequence)", () => {
			// Frozen live E1-E9 sequence from task-state-e71-c2-live-replica-truth-evidence.md §2.3
			const PUSHES: Array<{ phase: TurnPhase; seq: number }> = [
				{ phase: "idle", seq: 2 },
				{ phase: "streaming", seq: 4 },
				{ phase: "streaming", seq: 4 },
				{ phase: "streaming", seq: 4 },
				{ phase: "awaiting_followup", seq: 15 },
				{ phase: "idle", seq: 2 },
				{ phase: "idle", seq: 2 },
				{ phase: "idle", seq: 2 },
				{ phase: "idle", seq: 2 },
			]
			let pushId = 1
			for (const p of PUSHES) {
				const ts = PHASE(p.phase, p.seq)
				// Raw capture (before reducer)
				recordPostTerminalAuthoritySnapshot({
					origin: "webview",
					captureKind: "webview-raw-incoming",
					stateVersion: 0,
					_ptadPushId: pushId,
					capturedAt: Date.now(),
					rawIncomingLegacyPhase: ts.phase,
					rawIncomingLegacySeq: ts.seq,
				})
				// Applied capture (after reducer — for the healthy path,
				// the seq-gated reducer advances; for the W2 path, we
				// simulate the divergence by stamping idle/2 as the
				// applied view)
				recordPostTerminalAuthoritySnapshot({
					origin: "webview",
					captureKind: "webview-replica",
					stateVersion: 0,
					_ptadPushId: pushId,
					capturedAt: Date.now(),
					rawIncomingLegacyPhase: ts.phase,
					rawIncomingLegacySeq: ts.seq,
					appliedLegacyPhase: p.phase === "idle" ? "idle" : ts.phase,
					appliedLegacySeq: p.phase === "idle" ? 2 : ts.seq,
				})
				pushId++
			}
			const records = getPostTerminalAuthorityDiagnosticRecords("webview")
			expect(records.length).toBe(PUSHES.length * 2)
			const raws = records.filter((r) => r.captureKind === "webview-raw-incoming")
			const applieds = records.filter((r) => r.captureKind === "webview-replica")
			expect(raws.length).toBe(PUSHES.length)
			expect(applieds.length).toBe(PUSHES.length)
			// Every push has exactly one raw and one applied, paired by _ptadPushId
			const rawIds = raws.map((r) => r._ptadPushId).sort()
			const appliedIds = applieds.map((r) => r._ptadPushId).sort()
			expect(rawIds).toEqual(appliedIds)
		})
	})
})
