/**
 * ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION02-DOGFOOD-DIAGNOSTIC-GATE-AND-ARTIFACT-BINDING
 *
 * RED/GREEN tests for the diagnostic enablement boundary:
 *
 *   CCDCO-DOGFOOD-01 — diagnostic OFF outside dogfood
 *     - runtime profile = NOT dogfood (default)
 *     - production callback invoked with a valid matching
 *       ActiveSession and a resolving sdkHost.send
 *     - production outcome.kind === "delivered" (semantic unchanged)
 *     - counters stay at zero (record functions short-circuit)
 *     - lastOutcome === null, lastRequestedSessionMatched === null
 *     - This is the load-bearing RED that motivated CORRECTION02:
 *       the predecessor runtime collected unconditionally.
 *
 *   CCDCO-DOGFOOD-02 — diagnostic ON inside dogfood
 *     - runtime profile = dogfood
 *     - production callback invoked with a valid matching
 *       ActiveSession and a resolving sdkHost.send
 *     - production outcome.kind === "delivered"
 *     - counters increment as expected
 *     - Activated through the SAME production seam
 *       (applyCompletionContinuationDeliveryDiagnosticProfile) the
 *       extension host uses during activation.
 *
 *   CCDCO-DOGFOOD-03 — profile conservation
 *     - applyCompletionContinuationDeliveryDiagnosticProfile(true)
 *       enables the diagnostic
 *     - applyCompletionContinuationDeliveryDiagnosticProfile(false)
 *       disables it
 *     - The enable/disable decision is strict (no override matrix,
 *       no env var). The factory reviewer explicitly forbade a
 *       new operator knob.
 *
 *   ABLATION (operator toggle via comment — proves both halves
 *   of the enablement contract):
 *     - temporarily remove the applyX call in extension.ts:activate
 *         -> CCDCO-DOGFOOD-02 stays RED (counters stay zero)
 *     - temporarily revert the enabled guard in the runtime
 *         -> CCDCO-DOGFOOD-01 stays RED (counters increment
 *            while dogfood OFF)
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest"
import type { ActiveSession } from "../cline-session-factory"
import {
	type CompletionContinuationDeliveryCountersSnapshot,
	getCompletionContinuationDeliveryCounters,
	resetCompletionContinuationDeliveryForTests,
	setCompletionContinuationDeliveryEnabled,
} from "../completion-continuation-delivery-runtime"
import { applyCompletionContinuationDeliveryDiagnosticProfile } from "../dogfood-diagnostic-profile"
import { buildSdkControllerEnqueueCompletionContinuation } from "../SdkController"

function snapshot(): CompletionContinuationDeliveryCountersSnapshot {
	return getCompletionContinuationDeliveryCounters()
}

function makeSession(opts: { sessionId: string }): {
	session: ActiveSession
	sdkHostSendCalls: Array<Record<string, unknown>>
	sdkHost: { send: (input: Record<string, unknown>) => Promise<unknown> }
} {
	const sdkHostSendCalls: Array<Record<string, unknown>> = []
	const sdkHost = {
		send: (_input: Record<string, unknown>) => {
			sdkHostSendCalls.push(_input)
			return Promise.resolve(undefined)
		},
	}
	const session: ActiveSession = {
		sessionId: opts.sessionId,
		startConfig: { providerId: "mock-provider", modelId: "mock-model" },
		sdkHost: sdkHost as unknown as ActiveSession["sdkHost"],
		unsubscribe: () => undefined,
		startResult: undefined,
		isRunning: false,
	}
	return { session, sdkHostSendCalls, sdkHost }
}

beforeEach(() => {
	resetCompletionContinuationDeliveryForTests()
})

afterEach(() => {
	applyCompletionContinuationDeliveryDiagnosticProfile(false)
	resetCompletionContinuationDeliveryForTests()
})

describe("CCDCO-DOGFOOD-01 — diagnostic OFF outside dogfood (default)", () => {
	test("production callback returns delivered; counters stay zero (no record increment)", async () => {
		// Confirm we start in the default-off state. The fixture
		// does NOT call applyCompletionContinuationDeliveryDiagnosticProfile(true)
		// here — the only path that enables the diagnostic is the
		// production extension.ts:activate site which is gated on
		// the dogfood profile bit (we deliberately keep this test
		// free of that bit to prove the public path is no-op).
		const before = snapshot()
		expect(before.callbackEntered).toBe(0)
		expect(before.delivered).toBe(0)

		const { session, sdkHostSendCalls } = makeSession({ sessionId: "sess-ccdco-dogfood-01" })
		const cb = buildSdkControllerEnqueueCompletionContinuation({
			getActiveSession: () => session,
			// ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION06-CAPABILITY-FAIL-CLOSED-P1:
			// Test fixture supplies the historical default tool
			// list so the production seam's capability projection
			// has an honest input. The diagnostic the test cares
			// about (delivery counter) does not depend on the
			// exact capability projection.
			liveTools: () => ["command_status", "submit_and_exit"],
			logger: { warn: () => undefined },
		})
		// Production semantic is unchanged: callback delivers.
		const outcome = await cb({
			sessionId: "sess-ccdco-dogfood-01",
			taskId: "task-ccdco-dogfood-01",
			heldJobIds: ["cmd_a", "cmd_b"],
		})
		expect(outcome.kind).toBe("delivered")

		// The sdkHost.send was still invoked (production unchanged),
		// but the diagnostic counters are zero because the runtime
		// is default-off outside dogfood.
		expect(sdkHostSendCalls.length).toBe(1)
		expect(sdkHostSendCalls[0].delivery).toBe("queue")

		const after = snapshot()
		expect(after.total).toBe(0)
		expect(after.callbackEntered).toBe(0)
		expect(after.activeSessionMissing).toBe(0)
		expect(after.sessionIdMismatch).toBe(0)
		expect(after.sdkHostSendEntered).toBe(0)
		expect(after.delivered).toBe(0)
		expect(after.rejected).toBe(0)
		expect(after.sessionGone).toBe(0)
		expect(after.noHeldJobIds).toBe(0)
		expect(after.sendThrew).toBe(0)
		expect(after.lastOutcome).toBeNull()
		expect(after.lastRequestedSessionMatched).toBeNull()
	})

	test("direct setCompletionContinuationDeliveryEnabled(true) works at the runtime seam", () => {
		// Sanity: the production seam exists and is callable; this
		// is the same function the dogfood apply helper invokes.
		setCompletionContinuationDeliveryEnabled(true)
		// Restore for the test's own afterEach.
		setCompletionContinuationDeliveryEnabled(false)
	})
})

describe("CCDCO-DOGFOOD-02 — diagnostic ON inside dogfood (default)", () => {
	test("production callback returns delivered; counters increment per CALLBACK-OUTCOME-01", async () => {
		// ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION02-DOGFOOD-DIAGNOSTIC-GATE-AND-ARTIFACT-BINDING:
		// arm the diagnostic through the SAME production seam
		// extension.ts:activate uses during a dogfood install
		// (isDogfood=true). The fixture's beforeEach starts the test
		// in the default-off state; the explicit
		// applyCompletionContinuationDeliveryDiagnosticProfile(true)
		// below is the only way to enable it.
		const activation = applyCompletionContinuationDeliveryDiagnosticProfile(true)
		expect(activation.enabled).toBe(true)

		const { session, sdkHostSendCalls } = makeSession({ sessionId: "sess-ccdco-dogfood-02" })
		const cb = buildSdkControllerEnqueueCompletionContinuation({
			getActiveSession: () => session,
			liveTools: () => ["command_status", "submit_and_exit"],
			logger: { warn: () => undefined },
		})
		const outcome = await cb({
			sessionId: "sess-ccdco-dogfood-02",
			taskId: "task-ccdco-dogfood-02",
			heldJobIds: ["cmd_a", "cmd_b"],
		})
		expect(outcome.kind).toBe("delivered")
		expect(sdkHostSendCalls.length).toBe(1)

		const s = snapshot()
		expect(s.callbackEntered).toBe(1)
		expect(s.sdkHostSendEntered).toBe(1)
		expect(s.delivered).toBe(1)
		expect(s.lastOutcome).toBe("delivered")
		expect(s.lastRequestedSessionMatched).toBe(true)
		// No spurious side-effects.
		expect(s.rejected).toBe(0)
		expect(s.sendThrew).toBe(0)
		expect(s.sessionGone).toBe(0)
		expect(s.activeSessionMissing).toBe(0)
		expect(s.sessionIdMismatch).toBe(0)
		expect(s.noHeldJobIds).toBe(0)
	})
})

describe("CCDCO-DOGFOOD-03 — profile conservation", () => {
	test("isDogfood=true enables the diagnostic; isDogfood=false disables it", () => {
		const initial = applyCompletionContinuationDeliveryDiagnosticProfile(false)
		expect(initial.enabled).toBe(false)

		// Flip ON
		const on = applyCompletionContinuationDeliveryDiagnosticProfile(true)
		expect(on.enabled).toBe(true)
		expect(on.flipped).toBe(true)

		// Calling again with the same value: idempotent, no flip.
		const onAgain = applyCompletionContinuationDeliveryDiagnosticProfile(true)
		expect(onAgain.enabled).toBe(true)
		expect(onAgain.flipped).toBe(false)

		// Flip OFF
		const off = applyCompletionContinuationDeliveryDiagnosticProfile(false)
		expect(off.enabled).toBe(false)
		expect(off.flipped).toBe(true)
	})

	test("disabled state is observable via the production callback path (no public knob)", async () => {
		applyCompletionContinuationDeliveryDiagnosticProfile(false)

		const { session } = makeSession({ sessionId: "sess-ccdco-profile-conservation" })
		const cb = buildSdkControllerEnqueueCompletionContinuation({
			getActiveSession: () => session,
			liveTools: () => ["command_status", "submit_and_exit"],
			logger: { warn: () => undefined },
		})
		const outcome = await cb({
			sessionId: "sess-ccdco-profile-conservation",
			taskId: undefined,
			heldJobIds: ["cmd_only"],
		})
		expect(outcome.kind).toBe("delivered")
		expect(snapshot().callbackEntered).toBe(0)
		expect(snapshot().delivered).toBe(0)
	})
})
