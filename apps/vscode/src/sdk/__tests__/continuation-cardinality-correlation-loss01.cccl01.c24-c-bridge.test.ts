/**
 * ACT-CLINEMM-CONTINUATION-CARDINALITY-CORRELATION-LOSS01 / CCARD-CORR-LOSS01
 * (RED discriminator).
 *
 * The CORRECTION01 live qualification P4 FAILED:
 *
 *   pending_prompt_enqueued   = 2, origin=pending_prompt_drain
 *   pending_prompt_dequeued   = 2, origin=pending_prompt_drain
 *   continuation_scheduled    = 2, origin=pending_prompt_drain
 *   run_turn_started          = 4, origin=explicit_user
 *   agent_turn_done           = 4, origin=explicit_user
 *
 * wake_created records CONTAIN jobId.
 * pending_prompt_enqueued/dequeued/continuation_scheduled records do NOT.
 *
 * Recon: the `BackgroundNotifyCoordinator.enqueueTerminalWake` callback
 * contract at `background-notify-coordinator.ts:281` does NOT carry jobId.
 * `buildSdkControllerEnqueueTerminalWake` (SdkController.ts:707) destructures
 * `{sessionId, prompt}` and calls `active.sdkHost.send({sessionId, prompt,
 * delivery: "queue"})` at line 730 -- jobId is never supplied to send().
 *
 * This RED test drives the REAL `BackgroundNotifyCoordinator.consumeTerminal`
 * -> REAL `buildSdkControllerEnqueueTerminalWake` -> REAL `sdkHost.send`
 * chain with a unique sentinel jobId. The discriminator asserts the sentinel
 * is present on the `send(...)` argument. PRE-FIX this FAILS.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator } from "@/sdk/background-notify-coordinator"
import type { ActiveSession } from "@/sdk/cline-session-factory"
import {
	clearContinuationCardinalityAuthorityCapture,
	getContinuationCardinalityAuthorityCaptureRecords,
	setContinuationCardinalityAuthorityCaptureEnabled,
} from "@/sdk/continuation-cardinality-authority"
import { buildSdkControllerEnqueueTerminalWake } from "@/sdk/SdkController"

const SENTINEL = "ccard-corr-loss-sentinel"

interface MakeSessionResult {
	session: ActiveSession
	send: ReturnType<typeof vi.fn>
}

function makeFakeSession(sessionId: string, sendImpl?: (input: unknown) => Promise<unknown>): MakeSessionResult {
	const send = vi.fn(sendImpl ?? (async () => undefined))
	const sdkHost = {
		runtimeAddress: undefined,
		start: vi.fn(async () => ({})),
		send,
		getAccumulatedUsage: vi.fn(async () => undefined),
		abort: vi.fn(async () => undefined),
		stop: vi.fn(async () => undefined),
		dispose: vi.fn(async () => undefined),
		get: vi.fn(async () => undefined),
		list: vi.fn(async () => []),
		listHistory: vi.fn(async () => []),
		delete: vi.fn(async () => false),
		readMessages: vi.fn(async () => []),
	} as unknown as ActiveSession["sdkHost"]
	const session: ActiveSession = {
		sessionId,
		startConfig: undefined,
		sdkHost,
		unsubscribe: () => undefined,
		startResult: undefined,
		isRunning: true,
	}
	return { session, send }
}

beforeEach(() => {
	clearContinuationCardinalityAuthorityCapture()
	setContinuationCardinalityAuthorityCaptureEnabled(true)
})

describe("CCCL01 -- RED: wake_created.jobId must reach sdkHost.send(input)", () => {
	it("CCCL-RED-01: BackgroundNotifyCoordinator.consumeTerminal -> send() preserves jobId sentinel", async () => {
		const { session, send } = makeFakeSession("sess-ccard-1")
		const warns: string[] = []
		const wake = buildSdkControllerEnqueueTerminalWake({
			getActiveSession: () => session,
			logger: { warn: (msg: string) => warns.push(msg) },
		})

		const coordinator = new BackgroundNotifyCoordinator({
			resolveActiveOwner: () => ({ sessionId: session.sessionId, taskId: "task-ccard-1" }),
			enqueueTerminalWake: wake,
		})

		coordinator.registerMarker({
			jobId: SENTINEL,
			sessionId: session.sessionId,
			taskId: "task-ccard-1",
		})
		const decision = coordinator.consumeTerminal({
			jobId: SENTINEL,
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
		})
		expect(decision.kind).toBe("drained")

		await new Promise((resolve) => setImmediate(resolve))
		await new Promise((resolve) => setImmediate(resolve))

		const records = getContinuationCardinalityAuthorityCaptureRecords()
		const wakeCreated = records.find((r) => r.stage === "wake_created")
		expect(wakeCreated).toBeDefined()
		expect(wakeCreated?.jobId).toBe(SENTINEL)

		expect(send).toHaveBeenCalledTimes(1)
		const sentArg = send.mock.calls[0]?.[0] as Record<string, unknown> | undefined
		expect(sentArg).toBeDefined()
		expect(sentArg?.["sessionId"]).toBe(session.sessionId)
		expect(sentArg?.["delivery"]).toBe("queue")
		expect(sentArg?.["jobId"]).toBe(SENTINEL)

		expect(warns).toHaveLength(0)
	})

	it("CCCL-RED-02: held-then-drained second jobId also reaches sdkHost.send(input)", async () => {
		const { session, send } = makeFakeSession("sess-ccard-2")
		const wake = buildSdkControllerEnqueueTerminalWake({
			getActiveSession: () => session,
			logger: { warn: () => {} },
		})

		const coordinator = new BackgroundNotifyCoordinator({
			resolveActiveOwner: () => ({ sessionId: session.sessionId, taskId: "task-ccard-2" }),
			enqueueTerminalWake: wake,
		})

		const J1 = "ccard-corr-loss-sentinel-j1"
		const J2 = "ccard-corr-loss-sentinel-j2"

		coordinator.registerMarker({ jobId: J1, sessionId: session.sessionId, taskId: "task-ccard-2" })
		coordinator.registerMarker({ jobId: J2, sessionId: session.sessionId, taskId: "task-ccard-2" })

		const d1 = coordinator.consumeTerminal({
			jobId: J1,
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
		})
		expect(d1.kind).toBe("held")

		const d2 = coordinator.consumeTerminal({
			jobId: J2,
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
		})
		expect(d2.kind).toBe("drained")

		await new Promise((resolve) => setImmediate(resolve))
		await new Promise((resolve) => setImmediate(resolve))

		expect(send).toHaveBeenCalledTimes(2)
		const sent1 = send.mock.calls[0]?.[0] as Record<string, unknown> | undefined
		const sent2 = send.mock.calls[1]?.[0] as Record<string, unknown> | undefined
		expect(sent1?.["sessionId"]).toBe(session.sessionId)
		expect(sent2?.["sessionId"]).toBe(session.sessionId)
		expect(sent1?.["jobId"]).toBe(J1)
		expect(sent2?.["jobId"]).toBe(J2)

		const records = getContinuationCardinalityAuthorityCaptureRecords()
		const wakeCreatedRecords = records.filter((r) => r.stage === "wake_created")
		expect(wakeCreatedRecords).toHaveLength(2)
		const wakeJobIds = wakeCreatedRecords.map((r) => r.jobId).sort()
		expect(wakeJobIds).toEqual([J1, J2].sort())
	})
})
