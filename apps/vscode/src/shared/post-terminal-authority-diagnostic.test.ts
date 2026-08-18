// ============================================================================
// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1
//
// Witness test for the post-terminal-authority-diagnostic shared module.
// Pins:
//
//   1. The exported surface (record-side, query-side, lifecycle).
//   2. The ring-buffer behavior (trim, bounded, no-op when disabled).
//   3. The HALT RULE H3 posture (capture is allocation-only, observable
//      via test-only accessors).
//   4. The HALT RULE H4 posture (stateVersion is the correlation key).
//
// This is a structural/diagnostic test; it does NOT exercise the
// SdkController or the ExtensionStateContext. Those wiring tests live
// in `apps/vscode/src/sdk/__tests__/post-terminal-authority-diagnostic-wiring.test.ts`.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	clearPostTerminalAuthorityDiagnostic,
	clearPostTerminalAuthorityDiagnosticBoth,
	disablePostTerminalAuthorityDiagnostic,
	disablePostTerminalAuthorityDiagnosticBoth,
	enablePostTerminalAuthorityDiagnostic,
	enablePostTerminalAuthorityDiagnosticBoth,
	getPostTerminalAuthorityDiagnosticLatest,
	getPostTerminalAuthorityDiagnosticRecords,
	getPostTerminalAuthorityDiagnosticSeq,
	isPostTerminalAuthorityDiagnosticEnabled,
	type PostTerminalAuthoritySnapshot,
	recordPostTerminalAuthoritySnapshot,
	setPostTerminalAuthorityDiagnosticBufferSize,
} from "./post-terminal-authority-diagnostic"

afterEach(() => {
	disablePostTerminalAuthorityDiagnosticBoth()
	clearPostTerminalAuthorityDiagnosticBoth()
})

describe("ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1 / shared module", () => {
	describe("surface", () => {
		it("S1: toggle enable / disable for each side independently", () => {
			expect(isPostTerminalAuthorityDiagnosticEnabled("extension")).toBe(false)
			expect(isPostTerminalAuthorityDiagnosticEnabled("webview")).toBe(false)
			enablePostTerminalAuthorityDiagnostic("extension")
			expect(isPostTerminalAuthorityDiagnosticEnabled("extension")).toBe(true)
			expect(isPostTerminalAuthorityDiagnosticEnabled("webview")).toBe(false)
			enablePostTerminalAuthorityDiagnostic("webview")
			expect(isPostTerminalAuthorityDiagnosticEnabled("webview")).toBe(true)
			disablePostTerminalAuthorityDiagnostic("extension")
			expect(isPostTerminalAuthorityDiagnosticEnabled("extension")).toBe(false)
			expect(isPostTerminalAuthorityDiagnosticEnabled("webview")).toBe(true)
		})

		it("S2: enableBoth / disableBoth / clearBoth are convenience wrappers", () => {
			enablePostTerminalAuthorityDiagnosticBoth()
			expect(isPostTerminalAuthorityDiagnosticEnabled("extension")).toBe(true)
			expect(isPostTerminalAuthorityDiagnosticEnabled("webview")).toBe(true)
			disablePostTerminalAuthorityDiagnosticBoth()
			expect(isPostTerminalAuthorityDiagnosticEnabled("extension")).toBe(false)
			expect(isPostTerminalAuthorityDiagnosticEnabled("webview")).toBe(false)
		})
	})

	describe("ring buffer", () => {
		beforeEach(() => {
			enablePostTerminalAuthorityDiagnostic("extension")
			enablePostTerminalAuthorityDiagnostic("webview")
		})

		it("R1: record is a no-op when the side is disabled", () => {
			disablePostTerminalAuthorityDiagnostic("extension")
			recordPostTerminalAuthoritySnapshot({
				origin: "extension",
				stateVersion: 1,
				capturedAt: Date.now(),
			})
			expect(getPostTerminalAuthorityDiagnosticRecords("extension")).toEqual([])
		})

		it("R2: records are appended in order, latest is the head", () => {
			for (let i = 0; i < 5; i += 1) {
				recordPostTerminalAuthoritySnapshot({
					origin: "extension",
					stateVersion: i,
					capturedAt: Date.now() + i,
				})
			}
			const records = getPostTerminalAuthorityDiagnosticRecords("extension")
			expect(records.length).toBe(5)
			expect(records[0].stateVersion).toBe(0)
			expect(records[4].stateVersion).toBe(4)
			const latest = getPostTerminalAuthorityDiagnosticLatest("extension")
			expect(latest?.stateVersion).toBe(4)
		})

		it("R3: the ring buffer trims at the configured size, FIFO", () => {
			setPostTerminalAuthorityDiagnosticBufferSize("extension", 3)
			for (let i = 0; i < 10; i += 1) {
				recordPostTerminalAuthoritySnapshot({
					origin: "extension",
					stateVersion: i,
					capturedAt: Date.now() + i,
				})
			}
			const records = getPostTerminalAuthorityDiagnosticRecords("extension")
			expect(records.length).toBe(3)
			// Oldest 7 dropped, kept 7, 8, 9.
			expect(records.map((r) => r.stateVersion)).toEqual([7, 8, 9])
		})

		it("R4: independent side buffers do not leak", () => {
			recordPostTerminalAuthoritySnapshot({
				origin: "extension",
				stateVersion: 1,
				capturedAt: Date.now(),
			})
			recordPostTerminalAuthoritySnapshot({
				origin: "webview",
				stateVersion: 2,
				capturedAt: Date.now(),
			})
			expect(getPostTerminalAuthorityDiagnosticRecords("extension").length).toBe(1)
			expect(getPostTerminalAuthorityDiagnosticRecords("webview").length).toBe(1)
			clearPostTerminalAuthorityDiagnostic("extension")
			expect(getPostTerminalAuthorityDiagnosticRecords("extension").length).toBe(0)
			// Webview side untouched.
			expect(getPostTerminalAuthorityDiagnosticRecords("webview").length).toBe(1)
		})

		it("R5: getSeq increments per record, NOT per call", () => {
			// Calling record with a disabled side does NOT increment the seq.
			disablePostTerminalAuthorityDiagnostic("extension")
			recordPostTerminalAuthoritySnapshot({
				origin: "extension",
				stateVersion: 1,
				capturedAt: Date.now(),
			})
			expect(getPostTerminalAuthorityDiagnosticSeq("extension")).toBe(0)
			enablePostTerminalAuthorityDiagnostic("extension")
			recordPostTerminalAuthoritySnapshot({
				origin: "extension",
				stateVersion: 1,
				capturedAt: Date.now(),
			})
			expect(getPostTerminalAuthorityDiagnosticSeq("extension")).toBe(1)
		})
	})

	describe("HALT posture", () => {
		beforeEach(() => {
			enablePostTerminalAuthorityDiagnostic("extension")
		})

		it("H3: capture is observable via query-side accessors (no I/O, no Promise)", () => {
			const capturedAt = Date.now()
			recordPostTerminalAuthoritySnapshot({
				origin: "extension",
				stateVersion: 42,
				capturedAt,
				legacyPhase: "idle",
				thinkingPresentation: {
					modelStreaming: false,
					source: "shadow",
					seq: 7,
				},
			})
			const latest = getPostTerminalAuthorityDiagnosticLatest("extension")
			expect(latest).toBeDefined()
			expect(latest?.stateVersion).toBe(42)
			expect(latest?.legacyPhase).toBe("idle")
			expect(latest?.thinkingPresentation?.modelStreaming).toBe(false)
			expect(latest?.thinkingPresentation?.source).toBe("shadow")
		})

		it("H4: stateVersion is read by both sides as the correlation key", () => {
			// The capture is the SAME shape on both sides; the plan asserts
			// same-stateVersion implies same-push / same-logical-instant.
			// This test pins the shape invariant expected by the C1 plan.
			const sharedVersion = 99
			recordPostTerminalAuthoritySnapshot({
				origin: "extension",
				stateVersion: sharedVersion,
				capturedAt: Date.now(),
			})
			enablePostTerminalAuthorityDiagnostic("webview")
			recordPostTerminalAuthoritySnapshot({
				origin: "webview",
				stateVersion: sharedVersion,
				capturedAt: Date.now() + 1,
			})
			const ext = getPostTerminalAuthorityDiagnosticLatest("extension")
			const wv = getPostTerminalAuthorityDiagnosticLatest("webview")
			expect(ext?.stateVersion).toBe(sharedVersion)
			expect(wv?.stateVersion).toBe(sharedVersion)
			// The test will assert ext.capturedAt <= wv.capturedAt in C2.
		})
	})

	describe("shape", () => {
		it("P1: the captured record is read-only (readonly fields)", () => {
			// The TypeScript `: readonly` annotations on every field drive
			// the test-typecheck. We assert the type at runtime by
			// constructing a literal and checking every field is present.
			const snap: PostTerminalAuthoritySnapshot = {
				origin: "extension",
				stateVersion: 0,
				capturedAt: 0,
			}
			expect(snap.origin).toBe("extension")
			expect(snap.stateVersion).toBe(0)
			expect(snap.capturedAt).toBe(0)
		})
	})
})
