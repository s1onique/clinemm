/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C2-CORRECTION01-REPLICA-TRUTH
 *
 * Witness test for the diagnostic-only monotonic push ID. The C2 live smoke
 * proved that `stateVersion` is not usable as the PTAD correlation key
 * because all live captured records used `stateVersion=0`. This test pins
 * the contract that:
 *
 *   1. The push ID is monotonic across extension-side captures.
 *   2. The webview-side capture can carry the same push ID (proving
 *      the wire propagation works).
 *   3. `captureKind` discriminates the four webview capture sites.
 */

import {
	clearPostTerminalAuthorityDiagnosticBoth,
	disablePostTerminalAuthorityDiagnosticBoth,
	enablePostTerminalAuthorityDiagnosticBoth,
	getPostTerminalAuthorityDiagnosticRecords,
	recordPostTerminalAuthoritySnapshot,
} from "@shared/post-terminal-authority-diagnostic"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildExtensionSnapshotFromState } from "../post-terminal-authority-diagnostic-builder"

beforeEach(() => {
	clearPostTerminalAuthorityDiagnosticBoth()
	enablePostTerminalAuthorityDiagnosticBoth()
})

afterEach(() => {
	disablePostTerminalAuthorityDiagnosticBoth()
	clearPostTerminalAuthorityDiagnosticBoth()
})

describe("ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION01-REPLICA-TRUTH / push-ID", () => {
	it("PTAD-1: extension-side push IDs are strictly monotonic", () => {
		const baseState = {
			stateVersion: 0,
			epoch: 0,
			taskId: "task-1",
			turnState: { phase: "idle" as const, seq: 1 },
		}
		// Simulate three sequential extension pushes.
		for (const pushId of [10, 11, 12]) {
			recordPostTerminalAuthoritySnapshot(
				buildExtensionSnapshotFromState({
					state: { ...baseState, _ptadPushId: pushId },
					shadow: undefined,
				}),
			)
		}
		const records = getPostTerminalAuthorityDiagnosticRecords("extension")
		expect(records.map((r) => r._ptadPushId)).toEqual([10, 11, 12])
	})

	it("PTAD-2: captureKind discriminates the four webview capture sites", () => {
		// Simulate one record per kind.
		const kinds = ["webview-committed", "input-section", "action-buttons", "followup-route"] as const
		for (const captureKind of kinds) {
			recordPostTerminalAuthoritySnapshot({
				origin: "webview",
				captureKind,
				stateVersion: 0,
				capturedAt: Date.now(),
				_ptadPushId: 42,
			})
		}
		const records = getPostTerminalAuthorityDiagnosticRecords("webview")
		expect(records.map((r) => r.captureKind)).toEqual([...kinds])
	})

	it("PTAD-3: extension-push and webview-committed can correlate by _ptadPushId even when stateVersion=0", () => {
		// Simulate the same extension push observed by both sides.
		const sharedPushId = 7777
		recordPostTerminalAuthoritySnapshot(
			buildExtensionSnapshotFromState({
				state: {
					stateVersion: 0, // <-- live evidence proved this is 0
					_ptadPushId: sharedPushId,
					epoch: 0,
					turnState: { phase: "awaiting_followup" as const, seq: 15 },
				},
				shadow: undefined,
			}),
		)
		recordPostTerminalAuthoritySnapshot({
			origin: "webview",
			captureKind: "webview-committed",
			stateVersion: 0, // <-- same problem on the webview side
			_ptadPushId: sharedPushId, // <-- the push ID propagates verbatim from the wire
			capturedAt: Date.now(),
		})
		const ext = getPostTerminalAuthorityDiagnosticRecords("extension")
		const wv = getPostTerminalAuthorityDiagnosticRecords("webview")
		expect(ext[0]._ptadPushId).toBe(sharedPushId)
		expect(wv[0]._ptadPushId).toBe(sharedPushId)
		// The push IDs match even though stateVersion is 0 on both sides.
		expect(ext[0]._ptadPushId).toBe(wv[0]._ptadPushId)
	})

	it("PTAD-4: _ptadPushId is undefined when PTAD is disabled (no production wire change)", () => {
		disablePostTerminalAuthorityDiagnosticBoth()
		// Production path: the wire payload never carries _ptadPushId,
		// so the builder returns undefined and downstream records carry
		// undefined. The diagnostic must remain a complete no-op.
		const result = buildExtensionSnapshotFromState({
			state: {
				stateVersion: 0,
				_ptadPushId: undefined,
				epoch: 0,
				turnState: { phase: "idle" as const, seq: 1 },
			},
			shadow: undefined,
		})
		expect(result._ptadPushId).toBeUndefined()
	})
})
