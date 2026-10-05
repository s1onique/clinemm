/**
 * ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION01-LIVE-CALLBACK-OUTCOME
 *
 * RED tests (CALLBACK-OUTCOME-01..05 from ACT §9). Pins the
 * diagnostic semantics on the production callback factory
 * `buildSdkControllerEnqueueCompletionContinuation` BEFORE the LIVE
 * launch. These tests do NOT mutate callback control flow; they
 * verify the counter increments match the discriminator table.
 *
 * Test plan:
 *     A. CALLBACK-OUTCOME-01 — delivered
 *        active session exists, matching sessionId, sdkHost.send
 *        resolves normally
 *        -> callbackEntered=1, sdkHostSendEntered=1, delivered=1,
 *           lastOutcome="delivered"
 *     B. CALLBACK-OUTCOME-02 — session gone
 *        getActiveSession() returns undefined
 *        -> activeSessionMissing=1, sessionGone=1,
 *           sdkHostSendEntered=0
 *     C. CALLBACK-OUTCOME-03 — session mismatch
 *        active session exists but sessionId differs
 *        -> sessionIdMismatch=1, sessionGone=1, sdkHostSendEntered=0
 *     D. CALLBACK-OUTCOME-04 — send throws
 *        sdkHost.send throws
 *        -> sdkHostSendEntered=1, sendThrew=1, rejected=1
 *     E. CALLBACK-OUTCOME-05 — dump is read-only
 *        Dumping counters must not mutate/reset callback or queue state
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest"
import type { ActiveSession } from "../cline-session-factory"
import {
	type CompletionContinuationDeliveryCountersSnapshot,
	getCompletionContinuationDeliveryCounters,
	resetCompletionContinuationDeliveryForTests,
} from "../completion-continuation-delivery-runtime"
import { buildSdkControllerEnqueueCompletionContinuation } from "../SdkController"

function snapshot(): CompletionContinuationDeliveryCountersSnapshot {
	return getCompletionContinuationDeliveryCounters()
}

function makeSession(opts: { sessionId: string; heldJobIds?: readonly string[]; taskId?: string }): {
	session: ActiveSession
	sdkHostSendCalls: Array<Record<string, unknown>>
	sdkHost: { send: (input: Record<string, unknown>) => Promise<unknown> }
} {
	const sdkHostSendCalls: Array<Record<string, unknown>> = []
	const sdkHost = {
		send: (input: Record<string, unknown>) => {
			sdkHostSendCalls.push(input)
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

function makeCallback(opts: { active?: ActiveSession }): (input: {
	sessionId: string
	taskId: string | undefined
	heldJobIds: readonly string[]
}) => Promise<{
	kind: "delivered" | "rejected" | "session_gone" | "no_held_job_ids"
}> {
	const warns: string[] = []
	const cb = buildSdkControllerEnqueueCompletionContinuation({
		getActiveSession: () => opts.active,
		logger: { warn: (msg: string) => warns.push(msg) },
	})
	return cb
}

beforeEach(() => {
	resetCompletionContinuationDeliveryForTests()
})

afterEach(() => {
	resetCompletionContinuationDeliveryForTests()
})

describe("CALLBACK-OUTCOME-01 — delivered", () => {
	test("callbackEntered=1, sdkHostSendEntered=1, delivered=1, lastOutcome=delivered, sdkHost.send invoked once with delivery=queue", async () => {
		const { session, sdkHostSendCalls } = makeSession({ sessionId: "sess-ccdo-01" })
		const cb = makeCallback({ active: session })
		const outcome = await cb({ sessionId: "sess-ccdo-01", taskId: "task-ccdo-01", heldJobIds: ["cmd_a", "cmd_b"] })
		expect(outcome.kind).toBe("delivered")
		const s = snapshot()
		expect(s.callbackEntered).toBe(1)
		expect(s.sdkHostSendEntered).toBe(1)
		expect(s.delivered).toBe(1)
		expect(s.lastOutcome).toBe("delivered")
		expect(s.lastRequestedSessionMatched).toBe(true)
		// No sends => no rejections, no session-gone, no held-job-id miss, no throws.
		expect(s.rejected).toBe(0)
		expect(s.sendThrew).toBe(0)
		expect(s.sessionGone).toBe(0)
		expect(s.activeSessionMissing).toBe(0)
		expect(s.sessionIdMismatch).toBe(0)
		expect(s.noHeldJobIds).toBe(0)
		// sdkHost.send was invoked exactly once with delivery=queue.
		expect(sdkHostSendCalls.length).toBe(1)
		expect(sdkHostSendCalls[0].delivery).toBe("queue")
	})
})

describe("CALLBACK-OUTCOME-02 — session gone", () => {
	test("activeSessionMissing=1, sessionGone=1, sdkHostSendEntered=0; returned kind=session_gone", async () => {
		const cb = makeCallback({ active: undefined })
		const outcome = await cb({ sessionId: "sess-ccdo-02", taskId: "task-ccdo-02", heldJobIds: ["cmd_x"] })
		expect(outcome.kind).toBe("session_gone")
		const s = snapshot()
		expect(s.callbackEntered).toBe(1)
		expect(s.activeSessionMissing).toBe(1)
		expect(s.sessionGone).toBe(1)
		expect(s.sessionIdMismatch).toBe(0)
		expect(s.sdkHostSendEntered).toBe(0)
		expect(s.delivered).toBe(0)
		expect(s.rejected).toBe(0)
		expect(s.sendThrew).toBe(0)
		expect(s.noHeldJobIds).toBe(0)
		expect(s.lastOutcome).toBe("session_gone")
		expect(s.lastRequestedSessionMatched).toBeNull()
	})
})

describe("CALLBACK-OUTCOME-03 — session mismatch", () => {
	test("sessionIdMismatch=1, sessionGone=1, sdkHostSendEntered=0; returned kind=session_gone", async () => {
		const { session } = makeSession({ sessionId: "sess-active" })
		const cb = makeCallback({ active: session })
		const outcome = await cb({ sessionId: "sess-requested-but-missing", taskId: undefined, heldJobIds: ["cmd_y"] })
		expect(outcome.kind).toBe("session_gone")
		const s = snapshot()
		expect(s.callbackEntered).toBe(1)
		expect(s.sessionIdMismatch).toBe(1)
		expect(s.sessionGone).toBe(1)
		// Identity mismatch is NOT counted as activeSessionMissing
		// — the active session existed, the IDs just differed.
		expect(s.activeSessionMissing).toBe(0)
		expect(s.sdkHostSendEntered).toBe(0)
		expect(s.delivered).toBe(0)
		expect(s.rejected).toBe(0)
		expect(s.sendThrew).toBe(0)
		expect(s.noHeldJobIds).toBe(0)
		expect(s.lastOutcome).toBe("session_gone")
		expect(s.lastRequestedSessionMatched).toBe(false)
	})
})

describe("CALLBACK-OUTCOME-04 — send throws", () => {
	test("sdkHostSendEntered=1, sendThrew=1, rejected=1; returned kind=rejected", async () => {
		const sdkHostSendCalls: Array<Record<string, unknown>> = []
		const sdkHost = {
			send: (input: Record<string, unknown>) => {
				sdkHostSendCalls.push(input)
				return Promise.reject(new Error("synthetic send failure"))
			},
		}
		const session: ActiveSession = {
			sessionId: "sess-ccdo-04",
			startConfig: { providerId: "mock-provider", modelId: "mock-model" },
			sdkHost: sdkHost as unknown as ActiveSession["sdkHost"],
			unsubscribe: () => undefined,
			startResult: undefined,
			isRunning: false,
		}
		const warns: string[] = []
		const cb = buildSdkControllerEnqueueCompletionContinuation({
			getActiveSession: () => session,
			logger: { warn: (msg: string) => warns.push(msg) },
		})
		const outcome = await cb({ sessionId: "sess-ccdo-04", taskId: "task-ccdo-04", heldJobIds: ["cmd_z"] })
		expect(outcome.kind).toBe("rejected")
		const s = snapshot()
		expect(s.callbackEntered).toBe(1)
		expect(s.sdkHostSendEntered).toBe(1)
		expect(s.sendThrew).toBe(1)
		expect(s.rejected).toBe(1)
		expect(s.delivered).toBe(0)
		expect(s.sessionGone).toBe(0)
		expect(s.lastOutcome).toBe("rejected")
		expect(s.lastRequestedSessionMatched).toBe(true)
		// Send was attempted exactly once (the throw happened inside the
		// single sdkHost.send invocation), and the original logger.warn
		// path still ran.
		expect(sdkHostSendCalls.length).toBe(1)
		expect(warns.length).toBe(1)
	})
})

describe("CALLBACK-OUTCOME-05 — dump is read-only", () => {
	test("getCompletionContinuationDeliveryCounters() does NOT reset counters", async () => {
		const { session } = makeSession({ sessionId: "sess-ccdo-05" })
		const cb = makeCallback({ active: session })
		await cb({ sessionId: "sess-ccdo-05", taskId: "task-ccdo-05", heldJobIds: ["cmd_p"] })
		const before = snapshot()
		// Read the counters multiple times — must not mutate.
		const read1 = snapshot()
		const read2 = snapshot()
		const read3 = snapshot()
		expect(read1).toEqual(before)
		expect(read2).toEqual(before)
		expect(read3).toEqual(before)
		// No reset on read.
		expect(before.delivered).toBe(1)
		expect(before.callbackEntered).toBe(1)
	})
})
