/**
 * ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-LIVE-CAPTURE01
 *
 * Test contract for the LIVE-synchronized-state capture extension to the
 * existing post-terminal-authority diagnostic. The capture is purely
 * additive -- production semantics are unchanged when the diagnostic is
 * default-off. The tests pin:
 *
 *   D1: disabled => zero records, zero semantic effect (no new fields
 *       leak into the ring buffer when enabled===false).
 *   D2: coherent Idle => no contradiction flag (TaskHeader=idle,
 *       secondaryAction=undefined, modelStreaming=false).
 *   D3: Idle + Cancel input => IDLE_PLUS_CANCEL flag.
 *   D4: Idle + modelStreaming=true => IDLE_PLUS_MODEL_STREAMING flag.
 *   D5: records preserve one supplied committed-state identity -- the
 *       foregroundCommandRunning / backgroundCommandRunning / composerEnabled
 *       / messageTail fields round-trip exactly through the ring buffer.
 *   D6: ring buffer bounded -- the new fields do not change the existing
 *       ring-buffer size policy (DEFAULT_BUFFER_SIZE = 64).
 *
 * This is a structural/diagnostic test, NOT a product RED. The
 * ACT-LIVE-CAPTURE01 directive (per Factory) explicitly forbids
 * synthesizing these as production REDs.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	classifyContradiction,
	clearPostTerminalAuthorityDiagnosticBoth,
	disablePostTerminalAuthorityDiagnosticBoth,
	enablePostTerminalAuthorityDiagnosticBoth,
	findPostTerminalAuthorityContradictions,
	getPostTerminalAuthorityDiagnosticRecords,
	type PostTerminalAuthorityCaptureKind,
	type PostTerminalAuthoritySnapshot,
	recordPostTerminalAuthoritySnapshot,
} from "./post-terminal-authority-diagnostic"

afterEach(() => {
	disablePostTerminalAuthorityDiagnosticBoth()
	clearPostTerminalAuthorityDiagnosticBoth()
})

describe("ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-LIVE-CAPTURE01 / post-terminal-authority diagnostic", () => {
	describe("D1: disabled => zero records, zero semantic effect", () => {
		beforeEach(() => {
			disablePostTerminalAuthorityDiagnosticBoth()
			clearPostTerminalAuthorityDiagnosticBoth()
		})

		it("D1.1: recordPostTerminalAuthoritySnapshot is a no-op when disabled (no new fields leak)", () => {
			recordPostTerminalAuthoritySnapshot({
				origin: "webview",
				captureKind: "action-buttons" as PostTerminalAuthorityCaptureKind,
				stateVersion: 10,
				_ptadPushId: 100,
				capturedAt: Date.now(),
				foregroundCommandRunning: true,
				backgroundCommandRunning: false,
				composerEnabled: true,
				messageTail: { ts: 4, type: "say", say: "text", partial: true, seq: 4, epoch: 2 },
			})
			expect(getPostTerminalAuthorityDiagnosticRecords("webview")).toEqual([])
			expect(getPostTerminalAuthorityDiagnosticRecords("extension")).toEqual([])
		})

		it("D1.2: classifyContradiction is a pure predicate (does not read the ring buffer)", () => {
			const kind = classifyContradiction({
				origin: "webview",
				captureKind: "action-buttons" as PostTerminalAuthorityCaptureKind,
				stateVersion: 10,
				_ptadPushId: 100,
				capturedAt: Date.now(),
				taskHeaderPresentation: { phase: "idle", seq: 16, source: "shadow" },
				buttonConfig: { secondaryAction: "cancel" },
			})
			expect(kind).toBe("IDLE_PLUS_CANCEL")
			expect(getPostTerminalAuthorityDiagnosticRecords("webview")).toEqual([])
		})
	})

	describe("D2: coherent Idle => no contradiction flag", () => {
		beforeEach(() => {
			enablePostTerminalAuthorityDiagnosticBoth()
		})

		it("D2.1: TaskHeader=idle, secondaryAction=undefined, modelStreaming=false => null", () => {
			const snap: PostTerminalAuthoritySnapshot = {
				origin: "webview",
				captureKind: "action-buttons" as PostTerminalAuthorityCaptureKind,
				stateVersion: 11,
				_ptadPushId: 200,
				capturedAt: Date.now(),
				taskHeaderPresentation: { phase: "idle", seq: 16, source: "shadow" },
				thinkingPresentation: { modelStreaming: false, seq: 16, source: "shadow" },
				buttonConfig: {
					sendingDisabled: false,
					enableButtons: false,
					primaryAction: undefined,
					secondaryAction: undefined,
				},
			}
			recordPostTerminalAuthoritySnapshot(snap)
			expect(classifyContradiction(snap)).toBeNull()
			expect(findPostTerminalAuthorityContradictions("webview")).toEqual([])
		})

		it("D2.2: TaskHeader=waiting => null even when thinking=true (streaming is legitimate)", () => {
			const snap: PostTerminalAuthoritySnapshot = {
				origin: "webview",
				captureKind: "action-buttons" as PostTerminalAuthorityCaptureKind,
				stateVersion: 10,
				_ptadPushId: 150,
				capturedAt: Date.now(),
				taskHeaderPresentation: { phase: "awaiting_followup", seq: 15, source: "host" },
				thinkingPresentation: { modelStreaming: true, seq: 15, source: "shadow" },
				buttonConfig: {
					sendingDisabled: true,
					enableButtons: true,
					primaryAction: undefined,
					secondaryAction: "cancel",
				},
			}
			expect(classifyContradiction(snap)).toBeNull()
		})
	})

	describe("D3: Idle + Cancel input => IDLE_PLUS_CANCEL", () => {
		beforeEach(() => {
			enablePostTerminalAuthorityDiagnosticBoth()
		})

		it("D3.1: TaskHeader=idle + secondaryAction=cancel => IDLE_PLUS_CANCEL (LIVE contradiction)", () => {
			const snap: PostTerminalAuthoritySnapshot = {
				origin: "webview",
				captureKind: "action-buttons" as PostTerminalAuthorityCaptureKind,
				stateVersion: 11,
				_ptadPushId: 201,
				capturedAt: Date.now(),
				taskHeaderPresentation: { phase: "idle", seq: 16, source: "shadow" },
				buttonConfig: {
					sendingDisabled: true,
					enableButtons: true,
					primaryAction: undefined,
					secondaryAction: "cancel",
				},
				foregroundCommandRunning: false,
				backgroundCommandRunning: false,
			}
			recordPostTerminalAuthoritySnapshot(snap)
			const flags = findPostTerminalAuthorityContradictions("webview")
			expect(flags.length).toBe(1)
			expect(flags[0]?.kind).toBe("IDLE_PLUS_CANCEL")
			expect(flags[0]?.snapshot.stateVersion).toBe(11)
			expect(flags[0]?.snapshot._ptadPushId).toBe(201)
		})

		it("D3.2: foregroundCommandRunning=true does NOT mask the Idle+Cancel flag", () => {
			const snap: PostTerminalAuthoritySnapshot = {
				origin: "webview",
				captureKind: "action-buttons" as PostTerminalAuthorityCaptureKind,
				stateVersion: 11,
				_ptadPushId: 202,
				capturedAt: Date.now(),
				taskHeaderPresentation: { phase: "idle", seq: 16, source: "shadow" },
				buttonConfig: {
					sendingDisabled: true,
					enableButtons: true,
					primaryAction: undefined,
					secondaryAction: "cancel",
				},
				foregroundCommandRunning: true,
				backgroundCommandRunning: false,
			}
			expect(classifyContradiction(snap)).toBe("IDLE_PLUS_CANCEL")
		})
	})

	describe("D4: Idle + modelStreaming=true => IDLE_PLUS_MODEL_STREAMING", () => {
		beforeEach(() => {
			enablePostTerminalAuthorityDiagnosticBoth()
		})

		it("D4.1: TaskHeader=idle + modelStreaming=true (no Cancel) => IDLE_PLUS_MODEL_STREAMING", () => {
			const snap: PostTerminalAuthoritySnapshot = {
				origin: "webview",
				captureKind: "action-buttons" as PostTerminalAuthorityCaptureKind,
				stateVersion: 12,
				_ptadPushId: 300,
				capturedAt: Date.now(),
				taskHeaderPresentation: { phase: "idle", seq: 16, source: "shadow" },
				thinkingPresentation: { modelStreaming: true, seq: 16, source: "shadow" },
				buttonConfig: {
					sendingDisabled: false,
					enableButtons: false,
					primaryAction: undefined,
					secondaryAction: undefined,
				},
			}
			recordPostTerminalAuthoritySnapshot(snap)
			const flags = findPostTerminalAuthorityContradictions("webview")
			expect(flags.length).toBe(1)
			expect(flags[0]?.kind).toBe("IDLE_PLUS_MODEL_STREAMING")
		})

		it("D4.2: TaskHeader=completed + active work => COMPLETED_PLUS_ACTIVE_WORK", () => {
			const snap: PostTerminalAuthoritySnapshot = {
				origin: "webview",
				captureKind: "action-buttons" as PostTerminalAuthorityCaptureKind,
				stateVersion: 13,
				_ptadPushId: 301,
				capturedAt: Date.now(),
				taskHeaderPresentation: { phase: "completed", seq: 20, source: "shadow" },
				thinkingPresentation: { modelStreaming: true, seq: 20, source: "shadow" },
				buttonConfig: {
					sendingDisabled: false,
					enableButtons: false,
					primaryAction: undefined,
					secondaryAction: undefined,
				},
			}
			expect(classifyContradiction(snap)).toBe("COMPLETED_PLUS_ACTIVE_WORK")
		})
	})

	describe("D5: records preserve one supplied committed-state identity", () => {
		beforeEach(() => {
			enablePostTerminalAuthorityDiagnosticBoth()
		})

		it("D5.1: foregroundCommandRunning / backgroundCommandRunning / composerEnabled / messageTail round-trip exactly", () => {
			const snap: PostTerminalAuthoritySnapshot = {
				origin: "webview",
				captureKind: "action-buttons" as PostTerminalAuthorityCaptureKind,
				stateVersion: 14,
				_ptadPushId: 400,
				capturedAt: 1234567890,
				foregroundCommandRunning: true,
				backgroundCommandRunning: false,
				composerEnabled: false,
				messageTail: {
					ts: 4,
					type: "say",
					say: "text",
					partial: true,
					seq: 4,
					epoch: 2,
				},
			}
			recordPostTerminalAuthoritySnapshot(snap)
			const records = getPostTerminalAuthorityDiagnosticRecords("webview")
			expect(records.length).toBe(1)
			const r = records[0]!
			expect(r.foregroundCommandRunning).toBe(true)
			expect(r.backgroundCommandRunning).toBe(false)
			expect(r.composerEnabled).toBe(false)
			expect(r.messageTail).toEqual({
				ts: 4,
				type: "say",
				say: "text",
				partial: true,
				seq: 4,
				epoch: 2,
			})
			expect(r.capturedAt).toBe(1234567890)
			expect(r.stateVersion).toBe(14)
			expect(r._ptadPushId).toBe(400)
		})

		it("D5.2: missing clineMessages => messageTail undefined (no bodies, no garbage)", () => {
			const snap: PostTerminalAuthoritySnapshot = {
				origin: "webview",
				captureKind: "action-buttons" as PostTerminalAuthorityCaptureKind,
				stateVersion: 15,
				_ptadPushId: 401,
				capturedAt: Date.now(),
				foregroundCommandRunning: false,
				backgroundCommandRunning: false,
				composerEnabled: true,
			}
			recordPostTerminalAuthoritySnapshot(snap)
			const r = getPostTerminalAuthorityDiagnosticRecords("webview")[0]!
			expect(r.messageTail).toBeUndefined()
		})
	})

	describe("D6: ring buffer remains bounded (LIVE-CAPTURE01 fields do not enlarge the policy)", () => {
		beforeEach(() => {
			enablePostTerminalAuthorityDiagnosticBoth()
		})

		it("D6.1: 64 records with new fields all fit; the 65th evicts the oldest", () => {
			for (let i = 0; i < 64; i++) {
				recordPostTerminalAuthoritySnapshot({
					origin: "webview",
					captureKind: "action-buttons" as PostTerminalAuthorityCaptureKind,
					stateVersion: 100 + i,
					_ptadPushId: 1000 + i,
					capturedAt: Date.now(),
					foregroundCommandRunning: i % 2 === 0,
					backgroundCommandRunning: false,
					composerEnabled: true,
					messageTail: { ts: i, type: "say", say: "text", seq: i },
				})
			}
			expect(getPostTerminalAuthorityDiagnosticRecords("webview").length).toBe(64)
			recordPostTerminalAuthoritySnapshot({
				origin: "webview",
				captureKind: "action-buttons" as PostTerminalAuthorityCaptureKind,
				stateVersion: 164,
				_ptadPushId: 1064,
				capturedAt: Date.now(),
				foregroundCommandRunning: true,
				backgroundCommandRunning: false,
				composerEnabled: true,
				messageTail: { ts: 65, type: "say", say: "text", seq: 65 },
			})
			const records = getPostTerminalAuthorityDiagnosticRecords("webview")
			expect(records.length).toBe(64)
			expect(records[0]?.stateVersion).toBe(101)
			expect(records[records.length - 1]?.stateVersion).toBe(164)
		})
	})

	describe("backward-compatibility witness", () => {
		it("a snapshot with NO new fields remains well-typed and goes through the existing gate", () => {
			const snap: PostTerminalAuthoritySnapshot = {
				origin: "webview",
				captureKind: "action-buttons" as PostTerminalAuthorityCaptureKind,
				stateVersion: 16,
				capturedAt: Date.now(),
			}
			expect(classifyContradiction(snap)).toBeNull()
		})
	})
})
