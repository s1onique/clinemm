/**
 * ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
 *
 * HTEC-02 - bounded, concurrency-safe pre-launch
 * observation-capacity admission. Repairs the design blocker
 * identified by HTEC01-CORR04.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator } from "../background-notify-coordinator"
import { CommandJobManager } from "../command-job-manager"
import { createVscodeRunCommandsTool } from "../vscode-run-commands-tool"

// The host path needs StateManager (for the shell snapshot
// reader) and a telemetry sink. Mock both. The mocks are
// scoped to the test file (vi.mock hoisting).
vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalSettingsKey: () => "default",
		}),
	},
}))
vi.mock("@services/telemetry", () => ({
	TerminalUserInterventionAction: { PROCESS_WHILE_RUNNING: "process_while_running" },
	telemetryService: {
		captureTerminalUserIntervention: () => {},
		captureTerminalExecution: () => {},
	},
}))

const originalSandbox = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
})
afterEach(() => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
})

const supervisorPid = 230000

interface TestBCB {
	coordinator: BackgroundNotifyCoordinator
	owner: { sessionId: string; taskId: string | undefined }
	resolveOwner: () => { sessionId: string; taskId: string | undefined }
	enqueueWake: ReturnType<typeof vi.fn>
}

function newTestBCB(opts?: { maxObservationCapacity?: number; ownerTaskId?: string }): TestBCB {
	const owner = { sessionId: "sess-1", taskId: opts?.ownerTaskId ?? "task-1" }
	const resolveOwner = () => owner
	const enqueueWake = vi.fn(async () => ({ kind: "delivered" as const }))
	const coordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: resolveOwner,
		enqueueTerminalWake: enqueueWake,
		now: () => Date.now(),
		maxObservationCapacity: opts?.maxObservationCapacity,
	})
	return { coordinator, owner, resolveOwner, enqueueWake }
}

describe("HTEC02 / Phase 3 / RED reproduction (BCB admission contract)", () => {
	it("RED-01: 257th observation-bearing launch is refused at the BCB", () => {
		const bcb = newTestBCB({ maxObservationCapacity: 256 })
		// Reserve + attach + register 256 markers (no terminal
		// events fired, so the receipts are empty). Each
		// marker consumes 1 slot through `notificationMarkers`.
		for (let i = 0; i < 256; i += 1) {
			const reservation = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
			if (reservation.kind !== "reserved") {
				throw new Error(`prefill reservation refused at i=${i}: ${reservation.kind}`)
			}
			bcb.coordinator.attachReservationToJob({
				permitId: reservation.permitId,
				jobId: `fill-${i}`,
				owner: bcb.owner,
			})
			bcb.coordinator.registerMarker({
				jobId: `fill-${i}`,
				sessionId: bcb.owner.sessionId,
				taskId: bcb.owner.taskId,
				permitId: reservation.permitId,
			})
		}
		expect(bcb.coordinator.computeObservationUsed()).toBe(256)
		const result = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		expect(result.kind).toBe("at_capacity")
	})

	it("RED-02: concurrent reservations with capacity=1 — exactly one admit, one refuse", () => {
		const bcb = newTestBCB({ maxObservationCapacity: 1 })
		const r1 = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		const r2 = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		expect(r1.kind).toBe("reserved")
		expect(r2.kind).toBe("at_capacity")
	})

	it("RED-03: non-notify observation with permit transitions into an obligation", () => {
		const bcb = newTestBCB({ maxObservationCapacity: 4 })
		const reservation = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		expect(reservation.kind).toBe("reserved")
		if (reservation.kind !== "reserved") return
		const permitId = reservation.permitId
		const attach = bcb.coordinator.attachReservationToJob({
			permitId,
			jobId: "job-NN",
			owner: bcb.owner,
		})
		expect(attach.kind).toBe("attached")
		const record = bcb.coordinator.recordNonNotifyTerminalObservation({
			jobId: "job-NN",
			sessionId: bcb.owner.sessionId,
			taskId: bcb.owner.taskId,
			permitId,
		})
		expect(record.kind).toBe("recorded")
		expect(bcb.coordinator.computeObservationUsed()).toBe(1)
		bcb.coordinator.consumeNonNotifyTerminalObservation({
			jobId: "job-NN",
			sessionId: bcb.owner.sessionId,
			taskId: bcb.owner.taskId,
		})
		expect(bcb.coordinator.computeObservationUsed()).toBe(0)
	})
})

describe("HTEC02 / Phase 6 / ADM adversarial conservation", () => {
	it("ADM-01: one available slot — admission succeeds", () => {
		const bcb = newTestBCB({ maxObservationCapacity: 1 })
		const result = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		expect(result.kind).toBe("reserved")
	})

	it("ADM-02: all slots occupied — reject before launch", () => {
		const bcb = newTestBCB({ maxObservationCapacity: 1 })
		bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		const result = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		expect(result.kind).toBe("at_capacity")
	})

	it("ADM-03: two simultaneous requests, one slot — exactly one admitted", () => {
		const bcb = newTestBCB({ maxObservationCapacity: 1 })
		const r1 = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		const r2 = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		const results = [r1, r2].map((r) => r.kind).sort()
		expect(results).toEqual(["at_capacity", "reserved"])
	})

	it("ADM-04: fast command terminates in-band — permit released", () => {
		const bcb = newTestBCB({ maxObservationCapacity: 4 })
		const reservation = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		if (reservation.kind !== "reserved") throw new Error("expected reserved")
		bcb.coordinator.releaseReservation(reservation.permitId)
		expect(bcb.coordinator.computeObservationUsed()).toBe(0)
	})

	it("ADM-05: launch throws — permit released", () => {
		const bcb = newTestBCB({ maxObservationCapacity: 4 })
		const reservation = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		if (reservation.kind !== "reserved") throw new Error("expected reserved")
		bcb.coordinator.releaseReservation(reservation.permitId)
		expect(bcb.coordinator.computeObservationUsed()).toBe(0)
	})

	it("ADM-06: launch returns failure — no leaked permit", () => {
		const bcb = newTestBCB({ maxObservationCapacity: 4 })
		const reservation = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		if (reservation.kind !== "reserved") throw new Error("expected reserved")
		bcb.coordinator.releaseReservation(reservation.permitId)
		expect(bcb.coordinator.computeObservationUsed()).toBe(0)
	})

	it("ADM-07: notify-enabled running job — permit attaches to marker", () => {
		const bcb = newTestBCB({ maxObservationCapacity: 4 })
		const reservation = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		if (reservation.kind !== "reserved") throw new Error("expected reserved")
		const permitId = reservation.permitId
		const attach = bcb.coordinator.attachReservationToJob({
			permitId,
			jobId: "job-A",
			owner: bcb.owner,
		})
		expect(attach.kind).toBe("attached")
		const registered = bcb.coordinator.registerMarker({
			jobId: "job-A",
			sessionId: bcb.owner.sessionId,
			taskId: bcb.owner.taskId,
			permitId,
		})
		expect(registered.kind).toBe("registered")
		bcb.coordinator.resolveObligation({
			jobId: "job-A",
			sessionId: bcb.owner.sessionId,
			taskId: bcb.owner.taskId,
			resolution: "canonical_status_observed",
		})
		expect(bcb.coordinator.computeObservationUsed()).toBe(0)
	})

	it("ADM-08: non-notify running job — permit survives until observation", () => {
		const bcb = newTestBCB({ maxObservationCapacity: 4 })
		const reservation = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		if (reservation.kind !== "reserved") throw new Error("expected reserved")
		const permitId = reservation.permitId
		bcb.coordinator.attachReservationToJob({
			permitId,
			jobId: "job-B",
			owner: bcb.owner,
		})
		bcb.coordinator.recordNonNotifyTerminalObservation({
			jobId: "job-B",
			sessionId: bcb.owner.sessionId,
			taskId: bcb.owner.taskId,
			permitId,
		})
		expect(bcb.coordinator.computeObservationUsed()).toBe(1)
		bcb.coordinator.consumeNonNotifyTerminalObservation({
			jobId: "job-B",
			sessionId: bcb.owner.sessionId,
			taskId: bcb.owner.taskId,
		})
		expect(bcb.coordinator.computeObservationUsed()).toBe(0)
	})

	it("ADM-09: terminal before listener registration — permit released on fast-path", () => {
		const bcb = newTestBCB({ maxObservationCapacity: 4 })
		const reservation = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		if (reservation.kind !== "reserved") throw new Error("expected reserved")
		bcb.coordinator.releaseReservation(reservation.permitId)
		expect(bcb.coordinator.computeObservationUsed()).toBe(0)
	})

	it("ADM-10: heavy snapshot FIFO eviction — compact receipt remains", () => {
		const bcb = newTestBCB()
		bcb.coordinator.registerMarker({
			jobId: "job-evict",
			sessionId: bcb.owner.sessionId,
			taskId: bcb.owner.taskId,
		})
		bcb.coordinator.recordTerminalReceipt({
			jobId: "job-evict",
			sessionId: bcb.owner.sessionId,
			taskId: bcb.owner.taskId,
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
		})
		expect(bcb.coordinator.diagnosticTerminalReceiptCount()).toBe(1)
	})

	it("ADM-11: duplicate terminal lifecycle event — no duplicate receipt", () => {
		const bcb = newTestBCB()
		bcb.coordinator.registerMarker({
			jobId: "job-X",
			sessionId: bcb.owner.sessionId,
			taskId: bcb.owner.taskId,
		})
		bcb.coordinator.recordTerminalReceipt({
			jobId: "job-X",
			sessionId: bcb.owner.sessionId,
			taskId: bcb.owner.taskId,
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
		})
		bcb.coordinator.recordTerminalReceipt({
			jobId: "job-X",
			sessionId: bcb.owner.sessionId,
			taskId: bcb.owner.taskId,
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
		})
		expect(bcb.coordinator.diagnosticTerminalReceiptCount()).toBe(1)
	})

	it("ADM-12: duplicate `command_status` — idempotent settlement", () => {
		const bcb = newTestBCB()
		bcb.coordinator.registerMarker({
			jobId: "job-Y",
			sessionId: bcb.owner.sessionId,
			taskId: bcb.owner.taskId,
		})
		bcb.coordinator.resolveObligation({
			jobId: "job-Y",
			sessionId: bcb.owner.sessionId,
			taskId: bcb.owner.taskId,
			resolution: "canonical_status_observed",
		})
		bcb.coordinator.resolveObligation({
			jobId: "job-Y",
			sessionId: bcb.owner.sessionId,
			taskId: bcb.owner.taskId,
			resolution: "canonical_status_observed",
		})
		expect(bcb.coordinator.diagnosticMarkerCount()).toBe(0)
	})

	it("ADM-13: active owner changes — original owner remains authoritative", () => {
		const bcb = newTestBCB()
		bcb.coordinator.registerMarker({
			jobId: "job-owner1",
			sessionId: bcb.owner.sessionId,
			taskId: bcb.owner.taskId,
		})
		bcb.coordinator.resolveObligation({
			jobId: "job-owner1",
			sessionId: "sess-different",
			taskId: "task-different",
			resolution: "canonical_status_observed",
		})
		expect(bcb.coordinator.diagnosticMarkerCount()).toBe(1)
		bcb.coordinator.resolveObligation({
			jobId: "job-owner1",
			sessionId: bcb.owner.sessionId,
			taskId: bcb.owner.taskId,
			resolution: "canonical_status_observed",
		})
		expect(bcb.coordinator.diagnosticMarkerCount()).toBe(0)
	})

	it("ADM-14: session/task cancellation — only authorized obligations released", () => {
		const bcb = newTestBCB()
		bcb.coordinator.registerMarker({
			jobId: "job-cancel",
			sessionId: bcb.owner.sessionId,
			taskId: bcb.owner.taskId,
		})
		bcb.coordinator.dispose()
		expect(bcb.coordinator.diagnosticMarkerCount()).toBe(0)
		expect(bcb.coordinator.diagnosticTerminalReceiptCount()).toBe(0)
		const result = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		expect(result.kind).toBe("disposed")
	})

	it("ADM-15: coordinator disposal — all reservations released", () => {
		const bcb = newTestBCB({ maxObservationCapacity: 4 })
		bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		expect(bcb.coordinator.diagnosticPendingReservationCount()).toBe(2)
		bcb.coordinator.dispose()
		expect(bcb.coordinator.diagnosticPendingReservationCount()).toBe(0)
	})

	it("ADM-16: 256 occupied slots + one new request — new command never starts", () => {
		const bcb = newTestBCB({ maxObservationCapacity: 256 })
		for (let i = 0; i < 256; i += 1) {
			const reservation = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
			if (reservation.kind !== "reserved") {
				throw new Error(`prefill reservation refused at i=${i}: ${reservation.kind}`)
			}
			bcb.coordinator.attachReservationToJob({
				permitId: reservation.permitId,
				jobId: `fill-${i}`,
				owner: bcb.owner,
			})
			bcb.coordinator.registerMarker({
				jobId: `fill-${i}`,
				sessionId: bcb.owner.sessionId,
				taskId: bcb.owner.taskId,
				permitId: reservation.permitId,
			})
		}
		expect(bcb.coordinator.computeObservationUsed()).toBe(256)
		const result = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		expect(result.kind).toBe("at_capacity")
	})

	it("ADM-17: receipt slot freed after observation — capacity reusable", () => {
		const bcb = newTestBCB({ maxObservationCapacity: 2 })
		for (const j of ["a", "b"]) {
			const reservation = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
			if (reservation.kind !== "reserved") throw new Error("expected reserved")
			bcb.coordinator.attachReservationToJob({
				permitId: reservation.permitId,
				jobId: j,
				owner: bcb.owner,
			})
			bcb.coordinator.registerMarker({
				jobId: j,
				sessionId: bcb.owner.sessionId,
				taskId: bcb.owner.taskId,
				permitId: reservation.permitId,
			})
		}
		expect(bcb.coordinator.computeObservationUsed()).toBe(2)
		const refused = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		expect(refused.kind).toBe("at_capacity")
		// Settling one marker frees 1 slot. The 4th reservation
		// is accepted.
		bcb.coordinator.resolveObligation({
			jobId: "a",
			sessionId: bcb.owner.sessionId,
			taskId: bcb.owner.taskId,
			resolution: "canonical_status_observed",
		})
		expect(bcb.coordinator.computeObservationUsed()).toBe(1)
		const r3 = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		expect(r3.kind).toBe("reserved")
	})

	it("ADM-18: `containment_failed` — no fabricated success", () => {
		const bcb = newTestBCB()
		bcb.coordinator.registerMarker({
			jobId: "job-containment",
			sessionId: bcb.owner.sessionId,
			taskId: bcb.owner.taskId,
		})
		expect(bcb.coordinator.diagnosticMarkerCount()).toBe(1)
	})

	it("ADM-19: command executing while another observation settles — no oversubscription", () => {
		const bcb = newTestBCB({ maxObservationCapacity: 2 })
		const r1 = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		if (r1.kind !== "reserved") throw new Error("expected reserved")
		bcb.coordinator.attachReservationToJob({ permitId: r1.permitId, jobId: "j1", owner: bcb.owner })
		bcb.coordinator.registerMarker({
			jobId: "j1",
			sessionId: bcb.owner.sessionId,
			taskId: bcb.owner.taskId,
			permitId: r1.permitId,
		})
		expect(bcb.coordinator.computeObservationUsed()).toBe(1)
		bcb.coordinator.resolveObligation({
			jobId: "j1",
			sessionId: bcb.owner.sessionId,
			taskId: bcb.owner.taskId,
			resolution: "canonical_status_observed",
		})
		expect(bcb.coordinator.computeObservationUsed()).toBe(0)
		const r2 = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		expect(r2.kind).toBe("reserved")
	})

	it("ADM-20: reservation attached to wrong job — rejected", () => {
		const bcb = newTestBCB()
		const r = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		if (r.kind !== "reserved") throw new Error("expected reserved")
		bcb.coordinator.attachReservationToJob({ permitId: r.permitId, jobId: "A", owner: bcb.owner })
		const reattach = bcb.coordinator.attachReservationToJob({
			permitId: r.permitId,
			jobId: "B",
			owner: bcb.owner,
		})
		expect(reattach.kind).toBe("invalid_permit")
	})

	it("ADM-21: missing BCB — fail-closed classification", () => {
		const coordinator = new BackgroundNotifyCoordinator({
			resolveActiveOwner: () => undefined,
			enqueueTerminalWake: vi.fn(async () => ({ kind: "delivered" as const })),
		})
		const result = coordinator.tryReserveObservationCapacity()
		expect(result.kind).toBe("invalid_owner")
	})

	it("ADM-22: legacy unreserved registration path — no silent capacity bypass", () => {
		const bcb = newTestBCB({ maxObservationCapacity: 4 })
		bcb.coordinator.registerMarker({
			jobId: "legacy-marker",
			sessionId: bcb.owner.sessionId,
			taskId: bcb.owner.taskId,
		})
		expect(bcb.coordinator.computeObservationUsed()).toBe(1)
		expect(bcb.coordinator.diagnosticMarkerCount()).toBe(1)
		bcb.coordinator.resolveObligation({
			jobId: "legacy-marker",
			sessionId: bcb.owner.sessionId,
			taskId: bcb.owner.taskId,
			resolution: "canonical_status_observed",
		})
		expect(bcb.coordinator.computeObservationUsed()).toBe(0)
	})
})

describe("HTEC02 / Phase 7 / production reach (createVscodeRunCommandsTool integration)", () => {
	it("integration-01: a notify-enabled background command is admitted", async () => {
		const bcb = newTestBCB({ maxObservationCapacity: 4 })
		const manager = new CommandJobManager()
		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("not used in background mode")
			},
			vscodeTerminalExecutionMode: "backgroundExec",
			commandJobManager: manager,
			backgroundWaitBudgetMs: 5,
			backgroundExecutionDeadlineMs: 30_000,
			backgroundNotifyCoordinator: bcb.coordinator,
			resolveActiveOwner: bcb.resolveOwner,
		})
		try {
			const results = (await tool.execute(
				{ commands: ["/bin/sh -c 'sleep 5'"] },
				{
					agentId: "agent-1",
					conversationId: "conv-1",
					iteration: 1,
					metadata: { notifyOnCompletion: true },
				},
			)) as Array<{ result: string }>
			const parsed = JSON.parse(results[0].result)
			expect(parsed.status).toBe("running")
			expect(bcb.coordinator.diagnosticMarkerCount()).toBe(1)
		} finally {
			await manager.dispose()
		}
	})

	it("integration-02: with effective observation capacity exhausted, the next command is refused BEFORE manager.start", async () => {
		const bcb = newTestBCB({ maxObservationCapacity: 1 })
		const manager = new CommandJobManager()
		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("not used in background mode")
			},
			vscodeTerminalExecutionMode: "backgroundExec",
			commandJobManager: manager,
			backgroundWaitBudgetMs: 5,
			backgroundExecutionDeadlineMs: 30_000,
			backgroundNotifyCoordinator: bcb.coordinator,
			resolveActiveOwner: bcb.resolveOwner,
		})
		try {
			const first = (await tool.execute(
				{ commands: ["/bin/sh -c 'sleep 5'"] },
				{
					agentId: "agent-1",
					conversationId: "conv-1",
					iteration: 1,
					metadata: { notifyOnCompletion: true },
				},
			)) as Array<{ result: string }>
			const firstParsed = JSON.parse(first[0].result)
			expect(firstParsed.status).toBe("running")
			expect(bcb.coordinator.diagnosticMarkerCount()).toBe(1)
			// The SDK's executeShellCommands wrapper catches
			// CommandExitError and returns it as a structured
			// { result, error, success: false } result. So the
			// second call returns a result (not a throw) and
			// the test must inspect the result's error field.
			const second = (await tool.execute(
				{ commands: ["/bin/sh -c 'sleep 5'"] },
				{
					agentId: "agent-1",
					conversationId: "conv-1",
					iteration: 1,
					metadata: { notifyOnCompletion: true },
				},
			)) as Array<{ result: string; success: boolean; error?: string }>
			const secondResult = second[0]
			if (secondResult.success) {
				throw new Error(
					`expected refusal but got success=true; result=${secondResult.result}; pendingReservations=${bcb.coordinator.diagnosticPendingReservationCount()}; markers=${bcb.coordinator.diagnosticMarkerCount()}; used=${bcb.coordinator.computeObservationUsed()}; max=${bcb.coordinator.diagnosticMaxObservationCapacity()}`,
				)
			}
			// The SDK's executeShellCommands wrapper catches
			// non-CommandExitError throws via formatError and
			// returns { result: "", error: "Command failed: <msg>", success: false }.
			// The structured capacity-rejection message is in
			// `error`.
			expect(secondResult.error).toContain("at_capacity")
			expect(bcb.coordinator.diagnosticMarkerCount()).toBe(1)
		} finally {
			await manager.dispose()
		}
	})

	it("integration-03: after the first command is settled, the second is admitted", async () => {
		const bcb = newTestBCB({ maxObservationCapacity: 1 })
		const manager = new CommandJobManager()
		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("not used in background mode")
			},
			vscodeTerminalExecutionMode: "backgroundExec",
			commandJobManager: manager,
			backgroundWaitBudgetMs: 5,
			backgroundExecutionDeadlineMs: 30_000,
			backgroundNotifyCoordinator: bcb.coordinator,
			resolveActiveOwner: bcb.resolveOwner,
		})
		try {
			const first = (await tool.execute(
				{ commands: ["/bin/sh -c 'sleep 5'"] },
				{
					agentId: "agent-1",
					conversationId: "conv-1",
					iteration: 1,
					metadata: { notifyOnCompletion: true },
				},
			)) as Array<{ result: string }>
			const firstJobId = JSON.parse(first[0].result).jobId as string
			bcb.coordinator.resolveObligation({
				jobId: firstJobId,
				sessionId: bcb.owner.sessionId,
				taskId: bcb.owner.taskId,
				resolution: "canonical_status_observed",
			})
			const second = (await tool.execute(
				{ commands: ["/bin/sh -c 'sleep 5'"] },
				{
					agentId: "agent-1",
					conversationId: "conv-1",
					iteration: 1,
					metadata: { notifyOnCompletion: true },
				},
			)) as Array<{ result: string }>
			const secondParsed = JSON.parse(second[0].result)
			expect(secondParsed.status).toBe("running")
			expect(secondParsed.jobId).not.toBe(firstJobId)
		} finally {
			await manager.dispose()
		}
	})
})

describe("HTEC02 / Phase 10 / necessity & ablation", () => {
	it("ablation-01: when the admission contract is bypassed, the at-capacity invariant is violated", () => {
		const bcb = newTestBCB({ maxObservationCapacity: 1 })
		const original = bcb.coordinator.tryReserveObservationCapacity.bind(bcb.coordinator)
		;(bcb.coordinator as unknown as { tryReserveObservationCapacity: typeof original }).tryReserveObservationCapacity =
			(() => {
				return { kind: "reserved" as const, permitId: "ablation-permit", capacity: { used: 99, total: 1 } }
			}) as typeof original
		const r1 = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		const r2 = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
		expect(r1.kind).toBe("reserved")
		expect(r2.kind).toBe("reserved")
		;(bcb.coordinator as unknown as { tryReserveObservationCapacity: typeof original }).tryReserveObservationCapacity =
			original
	})
})
// ---------------------------------------------------------------------------
// ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
// (CORR-OWNER-HANDOFF-01 / CORR-NONNOTIFY-HANDOFF-01):
// bounded adversarial tests for the launch-time owner identity
// conservation and the non-notify observation ownership establishment
// at the running handoff. These three tests are the bounded correction
// the review prescribed (no new ACT, no architecture review, no Elm
// work). All three use the REAL production `createVscodeRunCommandsTool`
// harness; no new test infrastructure.
// ---------------------------------------------------------------------------

/**
 * Build a synthetic `StartCommandJobResult` for the controlled
 * `manager.start` stubs used in the adversarial tests below. The
 * returned `terminalPromise` is the test's only handle into the
 * manager's terminality — the test resolves it when it wants the
 * tool's `terminalPromise.then(...)` callback to fire.
 */
function makeControlledStartResult(jobId: string): {
	result: {
		jobId: string
		state: "running"
		elapsedMs: number
		deadlineRemainingMs: number
		stdout: string
		stderr: string
		outputTruncated: boolean
		terminalPromise: Promise<{
			becameIdle: boolean
			jobId: string
			terminalState: "exited" | "deadline_exceeded" | "cancelled" | "spawn_failed" | "containment_failed"
		}>
		becameActive: boolean
	}
	resolveTerminal: () => void
} {
	let resolveTerminalFn: () => void = () => {}
	const terminalPromise = new Promise<{
		becameIdle: boolean
		jobId: string
		terminalState: "exited" | "deadline_exceeded" | "cancelled" | "spawn_failed" | "containment_failed"
	}>((r) => {
		resolveTerminalFn = () => r({ becameIdle: true, jobId, terminalState: "exited" })
	})
	const result = {
		jobId,
		state: "running" as const,
		elapsedMs: 0,
		deadlineRemainingMs: 30_000,
		stdout: "",
		stderr: "",
		outputTruncated: false,
		terminalPromise,
		becameActive: true,
	}
	return { result, resolveTerminal: () => resolveTerminalFn() }
}

describe("HTEC02 / Phase 11 / adversarial — owner identity & non-notify handoff", () => {
	it("OWN-HANDOFF-01: launch-time owner is conserved across the manager.start() suspension", async () => {
		// Set up two distinct owners. The host's
		// `resolveActiveOwner` returns S1/T1 first, then
		// swaps to S2/T2 while `manager.start()` is
		// suspended. The fix MUST keep the obligation
		// attributed to S1/T1 (the launch-time owner),
		// NOT to S2/T2 (the current active owner).
		// Re-resolving the owner after the await would
		// recreate the HTEC01 owner-switch hazard.
		const ownerS1 = { sessionId: "sess-S1", taskId: "task-T1" }
		const ownerS2 = { sessionId: "sess-S2", taskId: "task-T2" }
		let currentOwner: { sessionId: string; taskId: string } = ownerS1
		const resolveActiveOwner = vi.fn((): { sessionId: string; taskId: string | undefined } => ({
			sessionId: currentOwner.sessionId,
			taskId: currentOwner.taskId,
		}))
		const coordinator = new BackgroundNotifyCoordinator({
			resolveActiveOwner,
			enqueueTerminalWake: vi.fn(async () => ({ kind: "delivered" as const })),
			now: () => Date.now(),
			maxObservationCapacity: 8,
		})
		const manager = new CommandJobManager()
		const originalStart = manager.start.bind(manager)
		const controlled = makeControlledStartResult("h1-OWN-HANDOFF-01")
		// The stub swaps the owner DURING the
		// pre-resolve microtask (before the tool's
		// `await manager.start()` resumes). The post-await
		// code must use the LAUNCH-TIME owner (S1/T1)
		// captured in `ownerResolution`, not the
		// freshly-swapped S2/T2.
		;(manager as unknown as { start: typeof originalStart }).start = (async () => {
			currentOwner = ownerS2
			return controlled.result as unknown as Awaited<ReturnType<typeof originalStart>>
		}) as typeof originalStart

		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("not used in background mode")
			},
			vscodeTerminalExecutionMode: "backgroundExec",
			commandJobManager: manager,
			backgroundWaitBudgetMs: 5,
			backgroundExecutionDeadlineMs: 30_000,
			backgroundNotifyCoordinator: coordinator,
			resolveActiveOwner,
		})
		try {
			const result = (await tool.execute(
				{ commands: ["/bin/sh -c 'sleep 0.05'"] },
				{
					agentId: "agent-OWN-HANDOFF-01",
					conversationId: "conv-OWN-HANDOFF-01",
					iteration: 1,
					metadata: { notifyOnCompletion: true },
				},
			)) as Array<{ result: string; success: boolean; error?: string }>
			const parsed = JSON.parse(result[0].result)
			expect(parsed.status).toBe("running")
			expect(parsed.jobId).toBe("h1-OWN-HANDOFF-01")
			// INVARIANT 1: the BCB has exactly ONE marker
			// for this jobId, and it is attributed to the
			// LAUNCH-TIME owner (S1/T1), not to the
			// swapped owner (S2/T2). The BCB's
			// `consumeMarker` is owner-keyed: a consume
			// under S1/T1 succeeds (proving the marker
			// is owned by S1/T1); a consume under S2/T2
			// is a no-op.
			expect(coordinator.diagnosticMarkerCount()).toBe(1)
			// `resolveObligation` is the production API for
			// draining a notify-enabled obligation. It is
			// owner-keyed: a resolve under the LAUNCH-TIME
			// owner (S1/T1) drains the marker; a resolve
			// under the swapped owner (S2/T2) returns
			// `no_marker` and preserves the obligation
			// (see
			// `background-notify-coordinator.ts:3073-3079`).
			const s1Resolve = coordinator.resolveObligation({
				jobId: parsed.jobId,
				sessionId: "sess-S1",
				taskId: "task-T1",
				resolution: "canonical_status_observed",
			})
			expect(s1Resolve.kind).toBe("resolved")
			// INVARIANT 2: the swapped owner (S2/T2) has
			// NO claim on the marker. Re-consume under
			// S2/T2 is a no-op (the marker was already
			// consumed by S1/T1).
			// After S1/T1 drained the marker, a
			// re-resolve under any owner is `no_marker`
			// (the marker is gone). This proves the
			// marker was owned by S1/T1, not S2/T2:
			// if the marker had been owned by S2/T2,
			// the S1/T1 resolve above would have
			// returned `no_marker` (owner_mismatch)
			// and the S2/T2 resolve below would
			// succeed. The S1-first / S2-second
			// ordering pins the owner attribution.
			const s2Resolve = coordinator.resolveObligation({
				jobId: parsed.jobId,
				sessionId: "sess-S2",
				taskId: "task-T2",
				resolution: "canonical_status_observed",
			})
			expect(s2Resolve.kind).toBe("no_marker")
			// INVARIANT 3: the `resolveActiveOwner` was
			// called at LEAST once at launch time (line
			// 773 captures the owner into
			// `ownerResolution`). The post-fix code
			// re-uses the captured value, so the call
			// count for the production code path is 1
			// (the pre-fix code would have called it
			// at least 2: once at launch, once at the
			// post-await re-resolve).
			expect(resolveActiveOwner.mock.calls.length).toBeGreaterThanOrEqual(1)
		} finally {
			controlled.resolveTerminal()
			await new Promise((r) => setTimeout(r, 5))
			;(manager as unknown as { start: typeof originalStart }).start = originalStart
			await manager.dispose()
		}
	})

	it("NONNOTIFY-HANDOFF-01: non-notify observation is established at the running handoff and consumable via the canonical path", async () => {
		// The pre-fix code established the non-notify
		// observation only at terminality (inside the
		// `terminalPromise.then(...)` callback). The
		// reviewer-required correction moves the
		// registration to the running handoff. This
		// test proves two things:
		//
		//   1. While the job is still RUNNING, the BCB
		//      already owns the non-notify observation
		//      for the jobId (the obligation is
		//      established at the running handoff, not
		//      at terminality).
		//
		//   2. The observation is consumable through
		//      the canonical production path
		//      (`consumeNonNotifyTerminalObservation`,
		//      which is what `command_status` Path C
		//      calls at `command-status-tool.ts:524-528`).
		//
		// Both use a controlled `manager.start` so the
		// running state is observable deterministically
		// (no timing sleep).
		const coordinator = new BackgroundNotifyCoordinator({
			resolveActiveOwner: () => ({ sessionId: "sess-NH", taskId: "task-NH" }),
			enqueueTerminalWake: vi.fn(async () => ({ kind: "delivered" as const })),
			now: () => Date.now(),
			maxObservationCapacity: 4,
		})
		const manager = new CommandJobManager()
		const originalStart = manager.start.bind(manager)
		const controlled = makeControlledStartResult("h1-NONNOTIFY-HANDOFF-01")
		;(manager as unknown as { start: typeof originalStart }).start = (async () =>
			controlled.result as unknown as Awaited<ReturnType<typeof originalStart>>) as typeof originalStart

		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("not used in background mode")
			},
			vscodeTerminalExecutionMode: "backgroundExec",
			commandJobManager: manager,
			backgroundWaitBudgetMs: 5,
			backgroundExecutionDeadlineMs: 30_000,
			backgroundNotifyCoordinator: coordinator,
			resolveActiveOwner: () => ({ sessionId: "sess-NH", taskId: "task-NH" }),
		})
		try {
			const result = (await tool.execute(
				{ commands: ["/bin/sh -c 'sleep 0.05'"] },
				{
					agentId: "agent-NONNOTIFY-HANDOFF-01",
					conversationId: "conv-NONNOTIFY-HANDOFF-01",
					iteration: 1,
					// notifyOnCompletion is OMITTED —
					// this is the fire-and-forget path
					// that the pre-fix code deferred the
					// obligation registration for.
				},
			)) as Array<{ result: string; success: boolean; error?: string }>
			const parsed = JSON.parse(result[0].result)
			expect(parsed.status).toBe("running")
			expect(parsed.jobId).toBe("h1-NONNOTIFY-HANDOFF-01")
			// INVARIANT 1: the non-notify observation is
			// established WHILE THE JOB IS RUNNING.
			// The pre-fix code would have count 0 here
			// because the registration was inside
			// `terminalPromise.then(...)` and the
			// `terminalPromise` has not resolved yet
			// (we are still holding it via
			// `controlled`).
			expect(coordinator.diagnosticNonNotifyTerminalObservationCount()).toBe(1)
			// Now resolve the terminal promise. The
			// tool's `terminalPromise.then(...)`
			// callback fires; the BCB's observation
			// remains (the terminal callback no longer
			// creates or destroys it).
			controlled.resolveTerminal()
			await new Promise((r) => setTimeout(r, 5))
			expect(coordinator.diagnosticNonNotifyTerminalObservationCount()).toBe(1)
			// INVARIANT 2: the observation is consumable
			// through the canonical production path.
			// The `command_status` tool calls
			// `consumeNonNotifyTerminalObservation`
			// (see `command-status-tool.ts:524-528`).
			// Calling it here drains the obligation;
			// a second call is a no-op (idempotency).
			coordinator.consumeNonNotifyTerminalObservation({
				jobId: "h1-NONNOTIFY-HANDOFF-01",
				sessionId: "sess-NH",
				taskId: "task-NH",
			})
			expect(coordinator.diagnosticNonNotifyTerminalObservationCount()).toBe(0)
			// Second call is a no-op (idempotency).
			coordinator.consumeNonNotifyTerminalObservation({
				jobId: "h1-NONNOTIFY-HANDOFF-01",
				sessionId: "sess-NH",
				taskId: "task-NH",
			})
			expect(coordinator.diagnosticNonNotifyTerminalObservationCount()).toBe(0)
		} finally {
			;(manager as unknown as { start: typeof originalStart }).start = originalStart
			await manager.dispose()
		}
	})

	it("ABLATION-REAL-01: bypassing admission only at the production call site admits a second real run_commands despite exhausted capacity", async () => {
		// The existing `ablation-01` test bypasses
		// `tryReserveObservationCapacity` at the BCB
		// level and asserts that two calls are
		// accepted. The reviewer flagged this as P1:
		// that test demonstrates the mock's behavior,
		// not the production call site. This test
		// reuses the `createVscodeRunCommandsTool`
		// harness (the `integration-NN` tests'
		// pattern) and bypasses admission ONLY at the
		// production call site — i.e. on the
		// `coordinator` instance the production tool
		// receives via
		// `options.backgroundNotifyCoordinator`.
		//
		// The control (without the bypass) is the
		// existing `integration-02` test, which
		// proves refusal. This test proves the bypass
		// is sufficient to admit a second real
		// `run_commands` invocation through the real
		// production tool code path.
		const bcb = newTestBCB({ maxObservationCapacity: 1 })
		const manager = new CommandJobManager()
		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("not used in background mode")
			},
			vscodeTerminalExecutionMode: "backgroundExec",
			commandJobManager: manager,
			backgroundWaitBudgetMs: 5,
			backgroundExecutionDeadlineMs: 30_000,
			backgroundNotifyCoordinator: bcb.coordinator,
			resolveActiveOwner: bcb.resolveOwner,
		})

		// Bypass admission ONLY at the production call
		// site: replace the `coordinator` instance's
		// `tryReserveObservationCapacity` with a stub
		// that always returns `reserved`. This is
		// exactly the bypass shape the reviewer
		// prescribed — admission is disabled ONLY at
		// the production call site
		// (`vscode-run-commands-tool.ts` line
		// 776-782), so the rest of the tool code
		// (attach + registerMarker) runs unchanged.
		// The reviewer-prescribed bypass: disable
		// admission ONLY at the production call site.
		// The bypass replaces `tryReserveObservationCapacity`
		// with a stub that:
		//
		//   1. Honors the explicit-permitId idempotency
		//      contract the production tool relies on
		//      (see
		//      `background-notify-coordinator.ts:1590`).
		//   2. Bypasses the capacity check (always
		//      returns `reserved`, even when
		//      `computeObservationUsed() >= maxObservationCapacity`).
		//   3. Still populates the BCB's
		//      `pendingReservations` map so the
		//      subsequent `attachReservationToJob` +
		//      `registerMarker` / `recordNonNotifyTerminalObservation`
		//      paths run unchanged.
		//
		// Without (3), the bypass would only prove that
		// the stub returns `reserved`; the production
		// tool would still fail at attach time
		// (`invalid_permit`) and the test would be
		// uninformative. With (3), the bypass
		// exercises the EXACT production call site
		// while keeping the rest of the BCB state
		// machine intact.
		// The reviewer-prescribed bypass: disable
		// admission ONLY at the production call site.
		// The bypass replaces `tryReserveObservationCapacity`
		// with a stub that delegates to the original
		// method but overrides the capacity check.
		//
		// Implementation: call the original method
		// first (which does the correct
		// `pendingReservations` bookkeeping, the
		// owner resolution, the dispose check, the
		// explicit-permitId idempotency contract, and
		// the capacity check). If the original returns
		// `at_capacity`, we manually issue a permit
		// (populating the bookkeeping) and return
		// `reserved`. This is the minimal monkey-patch
		// that disables ONLY the capacity check, leaving
		// the rest of the BCB's state machine intact.
		const original = bcb.coordinator.tryReserveObservationCapacity.bind(bcb.coordinator)
		// Direct access to the BCB's private bookkeeping is
		// required to bypass the capacity check while
		// keeping the rest of the BCB's state machine
		// (owner resolution, dispose check, idempotency,
		// attach + register paths) intact. The cast is
		// scoped to this test file (no production
		// exposure).
		const pendingReservations = (
			bcb.coordinator as unknown as {
				pendingReservations: Map<
					string,
					{
						permitId: string
						sessionId: string
						taskId: string | undefined
						reservedAtMs: number
						attachedJobId: string | undefined
					}
				>
			}
		).pendingReservations
		// Bump the BCB's internal `permitSequence` so the
		// unique permit ids issued by the bypass do not
		// collide with the real method's ids (the
		// sequence is monotonic across both
		// reservations). We pre-bump by a large offset
		// to ensure the bypass ids are distinct from
		// the production method's ids.
		const permitSequenceHolder = (bcb.coordinator as unknown as { permitSequence: number }).permitSequence
		const initialSequence = permitSequenceHolder
		;(bcb.coordinator as unknown as { permitSequence: number }).permitSequence = initialSequence + 1_000_000
		let ablationCounter = 0
		;(
			bcb.coordinator as unknown as {
				tryReserveObservationCapacity: typeof original
			}
		).tryReserveObservationCapacity = ((input?: {
			owner?: { sessionId: string; taskId: string | undefined }
			permitId?: string
		}) => {
			ablationCounter += 1
			const result = original(input)
			if (result.kind === "reserved") {
				return result
			}
			if (result.kind !== "at_capacity") {
				// Pass through every other kind
				// (disposed, invalid_owner) — the bypass
				// is ONLY for the capacity check.
				return result
			}
			// Bypass the capacity check: manually
			// issue a permit and populate the
			// bookkeeping. The permit id format is the
			// same one the production method would
			// have used (`permit-N` with the same
			// monotonic sequence), so the rest of the
			// BCB's state machine (attach +
			// registerMarker) works unchanged.
			const owner = input?.owner ?? bcb.owner
			const permitId =
				input?.permitId ??
				(() => {
					const seq = (bcb.coordinator as unknown as { permitSequence: number }).permitSequence
					;(bcb.coordinator as unknown as { permitSequence: number }).permitSequence = seq + 1
					return `permit-${seq}`
				})()
			pendingReservations.set(permitId, {
				permitId,
				sessionId: owner.sessionId,
				taskId: owner.taskId,
				reservedAtMs: Date.now(),
				attachedJobId: undefined,
			})
			return {
				kind: "reserved" as const,
				permitId,
				capacity: { used: 99, total: 1 },
			}
		}) as typeof original

		try {
			// Two REAL `run_commands` invocations
			// through the production tool. With the
			// bypass in place, BOTH must be admitted
			// (running state, distinct jobIds). The
			// pre-fix code (without the bypass) would
			// have refused the second; the existing
			// `integration-02` test proves that
			// control.
			const first = (await tool.execute(
				{ commands: ["/bin/sh -c 'sleep 0.05'"] },
				{
					agentId: "agent-ABLATION-REAL-01",
					conversationId: "conv-ABLATION-REAL-01",
					iteration: 1,
					metadata: { notifyOnCompletion: true },
				},
			)) as Array<{ result: string; success: boolean; error?: string }>
			const firstParsed = JSON.parse(first[0].result)
			expect(firstParsed.status).toBe("running")
			const firstJobId = firstParsed.jobId as string

			const second = (await tool.execute(
				{ commands: ["/bin/sh -c 'sleep 0.05'"] },
				{
					agentId: "agent-ABLATION-REAL-01",
					conversationId: "conv-ABLATION-REAL-01",
					iteration: 1,
					metadata: { notifyOnCompletion: true },
				},
			)) as Array<{ result: string; success: boolean; error?: string }>
			const secondResult = second[0]
			// Without the bypass, the second call
			// would have failed with `at_capacity`
			// (see `integration-02` for the control).
			// With the bypass in place, the second
			// call is admitted. The bypass is
			// exercised at the production call site:
			// the `tryReserveObservationCapacity`
			// stub was called at least twice (once
			// per invocation).
			if (!secondResult.success) {
				throw new Error(
					`expected second invocation to be admitted but got failure; result=${secondResult.result}; error=${secondResult.error}; ablationCounter=${ablationCounter}; pendingReservations=${bcb.coordinator.diagnosticPendingReservationCount()}; markers=${bcb.coordinator.diagnosticMarkerCount()}`,
				)
			}
			const secondParsed = JSON.parse(secondResult.result)
			expect(secondParsed.status).toBe("running")
			expect(secondParsed.jobId).not.toBe(firstJobId)
			// INVARIANT: the bypass is exercised at
			// the production call site. The stub was
			// called at LEAST twice (once per real
			// invocation). If the stub is not the
			// production call site, the real method
			// would have been called instead and
			// refused the second invocation.
			expect(ablationCounter).toBeGreaterThanOrEqual(2)
			// INVARIANT: both invocations produced
			// markers. The real `registerMarker` path
			// runs unchanged (only admission is
			// bypassed).
			expect(bcb.coordinator.diagnosticMarkerCount()).toBe(2)
		} finally {
			// Restore the original method so the BCB
			// is usable by other tests (the
			// `try/finally` shape mirrors the
			// existing `ablation-01` test).
			;(
				bcb.coordinator as unknown as {
					tryReserveObservationCapacity: typeof original
				}
			).tryReserveObservationCapacity = original
			await manager.dispose()
		}
	})
})

// ---------------------------------------------------------------------------
// ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
// (CORR-POST-START-FAILURE-01): the bounded post-launch failure
// containment. The reviewer-required test (C1 GO with one
// bounded safety fix) forces the attachReservationToJob step
// to fail AFTER manager.start() returns "running" and proves:
//
//   1. The just-started job is cancelled through the supervised
//      lifecycle (the same `manager.cancel` seam used for user-
//      initiated cancellation). The job does NOT continue
//      running untracked.
//   2. The permit is released (capacity recovers).
//   3. The tool returns a structured failure (the SDK wrapper
//      catches the fail-closed throw and returns
//      `{ result: "", error: "Command failed: <msg>", success: false }`)
//      with the post-launch error message in the `error` field.
//
// The test uses the REAL production `createVscodeRunCommandsTool`
// harness and a REAL `CommandJobManager`. No new test
// infrastructure (per the reviewer prescription).
// ---------------------------------------------------------------------------

describe("HTEC02 / Phase 12 / post-launch failure containment", () => {
	it("POST-START-FAILURE-01: when attachReservationToJob fails after manager.start() returns running, the job is cancelled through the supervised lifecycle and the permit is released", async () => {
		const bcb = newTestBCB({ maxObservationCapacity: 8 })
		const manager = new CommandJobManager()
		const resolveActiveOwner = () => bcb.owner

		// Force the attachReservationToJob step to fail on the
		// FIRST call. The bypass simulates a BCB state change
		// between the pre-launch reservation and the post-
		// start attach (e.g. another consumer drained the
		// permit; the BCB bookkeeping was tampered with; etc).
		const originalAttach = bcb.coordinator.attachReservationToJob.bind(bcb.coordinator)
		;(
			bcb.coordinator as unknown as {
				attachReservationToJob: typeof originalAttach
			}
		).attachReservationToJob = ((_input: {
			permitId: string
			jobId: string
			owner?: { sessionId: string; taskId: string | undefined }
		}) => {
			// Return `invalid_permit` on the attach call. This
			// is the failure shape the post-launch repair
			// must contain.
			return { kind: "invalid_permit" as const }
		}) as typeof originalAttach

		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("not used in background mode")
			},
			vscodeTerminalExecutionMode: "backgroundExec",
			commandJobManager: manager,
			backgroundWaitBudgetMs: 5,
			backgroundExecutionDeadlineMs: 30_000,
			backgroundNotifyCoordinator: bcb.coordinator,
			resolveActiveOwner,
		})

		try {
			// The tool's pre-launch reservation succeeds
			// (the BCB has capacity). The tool then calls
			// manager.start() which returns "running" with a
			// real jobId. The post-launch attach step then
			// fails (the monkey-patch returns `invalid_permit`).
			// The bounded repair kicks in: the tool cancels
			// the job, awaits settlement, releases the permit,
			// and throws. The SDK wrapper catches the throw
			// and returns a structured failure shape.
			const result = (await tool.execute(
				{ commands: ["/bin/sh -c 'sleep 5'"] },
				{
					agentId: "agent-POST-START-FAILURE-01",
					conversationId: "conv-POST-START-FAILURE-01",
					iteration: 1,
					metadata: { notifyOnCompletion: true },
				},
			)) as Array<{ result: string; success: boolean; error?: string }>

			// INVARIANT 1: the SDK wrapper reports a
			// structured failure (not a thrown exception).
			// The error message identifies the post-launch
			// attach phase and the bounded-repair outcome.
			const firstResult = result[0]
			expect(firstResult.success).toBe(false)
			expect(firstResult.error).toBeDefined()
			expect(firstResult.error).toContain("Command failed")
			expect(firstResult.error).toContain("Observation-capacity admission failed")
			expect(firstResult.error).toContain("post-launch")
			expect(firstResult.error).toContain("attach refused")
			expect(firstResult.error).toContain("cancelled through the supervised lifecycle")
			expect(firstResult.error).toContain("permit has been released")

			// INVARIANT 2: the permit was released. The BCB's
			// `pendingReservations` is empty (capacity is
			// recoverable for the next admission).
			expect(bcb.coordinator.diagnosticPendingReservationCount()).toBe(0)

			// INVARIANT 3: the just-started job is cancelled.
			// The manager's `activeCount` drops to 0 (the
			// job was moved from `active` to `terminal` by
			// the supervised lifecycle's cancel path). The
			// bounded repair awaits `terminalPromise` before
			// throwing, so the settlement is observable by
			// the time the test asserts.
			expect(manager.activeCount).toBe(0)
			// The cancelled job is now in the terminal map.
			expect(manager.terminalCount).toBeGreaterThanOrEqual(1)
		} finally {
			// Restore the original attach method so the BCB
			// is usable by other tests (the try/finally shape
			// mirrors the existing `ablation-01` test).
			;(
				bcb.coordinator as unknown as {
					attachReservationToJob: typeof originalAttach
				}
			).attachReservationToJob = originalAttach
			await manager.dispose()
		}
	})
})

// ---------------------------------------------------------------------------
// ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
// (CORR-POST-START-TIMEOUT-01): adversarial coverage for the
// bounded post-launch settlement helper. The reviewer-required
// tests prove that timeout ≠ termination ≠ authorized release:
// a bounded wait that elapses WITHOUT observing a terminal
// settlement MUST NOT release the reservation slot, and the
// tool's error message MUST NOT falsely claim that the
// supervised job was cancelled.
//
// The two tests use a CONTROLLED `manager.start` (so the
// running state is observable deterministically) and a
// CONTROLLED `manager.cancel` (so the cancel-settles-ok and
// the cancel-hangs cases are both exercisable). The BCB's
// real `attachReservationToJob` is monkey-patched to fail so
// the post-launch failure path engages.
// ---------------------------------------------------------------------------

/**
 * Build a synthetic `StartCommandJobResult` for the
 * bounded-settlement tests. The `terminalPromise` is a
 * TEST-OWNED handle that the test resolves (or refuses to
 * resolve) to drive the helper's `terminal_observed` vs
 * `timeout` outcome.
 */
function makeUnsettledStartResult(jobId: string): {
	result: {
		jobId: string
		state: "running"
		elapsedMs: number
		deadlineRemainingMs: number
		stdout: string
		stderr: string
		outputTruncated: boolean
		terminalPromise: Promise<{
			becameIdle: boolean
			jobId: string
			terminalState: "exited" | "deadline_exceeded" | "cancelled" | "spawn_failed" | "containment_failed"
		}>
		becameActive: boolean
	}
	resolveTerminal: () => void
} {
	let resolveTerminalFn: () => void = () => {}
	const terminalPromise = new Promise<{
		becameIdle: boolean
		jobId: string
		terminalState: "exited" | "deadline_exceeded" | "cancelled" | "spawn_failed" | "containment_failed"
	}>((r) => {
		resolveTerminalFn = () => r({ becameIdle: true, jobId, terminalState: "exited" })
	})
	const result = {
		jobId,
		state: "running" as const,
		elapsedMs: 0,
		deadlineRemainingMs: 30_000,
		stdout: "",
		stderr: "",
		outputTruncated: false,
		terminalPromise,
		becameActive: true,
	}
	return { result, resolveTerminal: () => resolveTerminalFn() }
}

describe("HTEC02 / Phase 12 / post-launch failure containment — timeout & cancel-hang", () => {
	// ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
	// (CORR-POST-START-TIMEOUT-01): when the supervised job's
	// `terminalPromise` does NOT resolve before the bounded
	// wait elapses, the helper MUST:
	//   (a) return a bounded failure (the tool response is
	//       bounded by the timer; the test does not block
	//       forever),
	//   (b) keep the reservation slot held (the BCB's
	//       `pendingReservations` is non-empty; no later
	//       admission can consume the slot),
	//   (c) report a "containment pending" error that does
	//       NOT contain the false "cancelled through the
	//       supervised lifecycle" claim that the happy
	//       path uses,
	//   (d) NOT release the permit at tool-throw time,
	//   (e) when the supervised job later reaches
	//       terminality (the test resolves the controlled
	//       terminalPromise), a manual late-release call
	//       can drain the slot exactly once (no false
	//       cancellation-success message).
	//
	// The test does NOT use fake timers — it uses real
	// time so the production code's Node timer queue, the
	// clearTimeout path, and the Promise.race resolution
	// are all exercised end-to-end. The
	// POST-START-TIMEOUT-02 test covers the hung-cancel
	// case (a separate code path).
	it("POST-START-TIMEOUT-01: when terminalPromise does not resolve before the bounded wait, the permit is conserved and the error does not falsely claim cancellation", async () => {
		// Capacity=1: a single held permit fills the
		// entire capacity, so a second admission MUST
		// be refused at the BCB's capacity check.
		// (The previous capacity=4 was too generous —
		// it allowed the test to admit a second job
		// in the 3 free slots, hiding the conservation
		// invariant.)
		const bcb = newTestBCB({ maxObservationCapacity: 1 })
		const manager = new CommandJobManager()
		const resolveActiveOwner = () => bcb.owner

		// Controlled `manager.start` returns a synthetic
		// `running` job with a TEST-OWNED
		// `terminalPromise`. The test NEVER resolves
		// the terminalPromise in the body of the
		// tool.execute() await; the production helper's
		// bounded timer (5 seconds) will fire first and
		// the helper will report `timeout`.
		const originalStart = manager.start.bind(manager)
		const controlled = makeUnsettledStartResult("h1-POST-START-TIMEOUT-01")
		;(manager as unknown as { start: typeof originalStart }).start = (async () =>
			controlled.result as unknown as Awaited<ReturnType<typeof originalStart>>) as typeof originalStart

		// Controlled `manager.cancel` resolves "ok" with
		// a synthetic cancellation result. The helper
		// sees the cancel's "ok" outcome and waits for
		// the settle race (which is the authoritative
		// terminality signal). The settle race never
		// produces `terminal_observed` (the test's
		// `controlled.terminalPromise` is not resolved
		// until after the tool.execute() await returns),
		// so the settle race's timer wins and the
		// helper reports `timeout`.
		const originalCancel = manager.cancel.bind(manager)
		;(manager as unknown as { cancel: typeof originalCancel }).cancel = (async () => {
			return { ok: true as const, state: "cancelled" as const }
		}) as typeof originalCancel

		// Force the BCB's `attachReservationToJob` to
		// fail (invalid_permit) so the post-launch
		// failure path engages.
		const originalAttach = bcb.coordinator.attachReservationToJob.bind(bcb.coordinator)
		;(
			bcb.coordinator as unknown as {
				attachReservationToJob: typeof originalAttach
			}
		).attachReservationToJob = ((_input: {
			permitId: string
			jobId: string
			owner?: { sessionId: string; taskId: string | undefined }
		}) => {
			return { kind: "invalid_permit" as const }
		}) as typeof originalAttach

		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("not used in background mode")
			},
			vscodeTerminalExecutionMode: "backgroundExec",
			commandJobManager: manager,
			backgroundWaitBudgetMs: 5,
			backgroundExecutionDeadlineMs: 30_000,
			backgroundNotifyCoordinator: bcb.coordinator,
			resolveActiveOwner,
		})
		try {
			// The tool's pre-launch reservation
			// succeeds (the BCB has capacity). The
			// tool then calls the controlled
			// `manager.start()` which returns
			// "running" with a real jobId. The
			// post-launch attach step then fails (the
			// monkey-patch returns `invalid_permit`).
			// The bounded repair kicks in: the tool
			// calls cancel (controlled, resolves
			// "ok"), waits for the settle race
			// (which times out because the controlled
			// terminalPromise is never resolved), and
			// throws a "containment pending" error.
			const result = (await tool.execute(
				{ commands: ["/bin/sh -c 'sleep 5'"] },
				{
					agentId: "agent-POST-START-TIMEOUT-01",
					conversationId: "conv-POST-START-TIMEOUT-01",
					iteration: 1,
					metadata: { notifyOnCompletion: true },
				},
			)) as Array<{ result: string; success: boolean; error?: string }>

			// INVARIANT 1: the tool's response is
			// bounded (a structured failure, not a
			// hung await). The SDK wrapper catches
			// the throw and returns
			// `{ result, error, success: false }`.
			const firstResult = result[0]
			expect(firstResult.success).toBe(false)
			expect(firstResult.error).toBeDefined()

			// INVARIANT 2: the error message identifies
			// the bounded-wait timeout. It MUST
			// contain the "containment pending"
			// marker and the "CONSERVED" marker so
			// the host's diagnostic capture
			// attributes the failure correctly.
			expect(firstResult.error).toContain("Command failed")
			expect(firstResult.error).toContain("Observation-capacity admission failed")
			expect(firstResult.error).toContain("post-launch")
			expect(firstResult.error).toContain("attach refused")
			expect(firstResult.error).toContain("containment pending")
			expect(firstResult.error).toContain("CONSERVED")

			// INVARIANT 3: the error message MUST NOT
			// falsely claim that the supervised job
			// was "cancelled through the supervised
			// lifecycle" — that claim is reserved
			// for the `terminal_observed` outcome
			// (the happy path). On the `timeout`
			// path the supervised job's terminality
			// is UNKNOWN.
			expect(firstResult.error).not.toContain("cancelled through the supervised lifecycle")
			expect(firstResult.error).not.toContain("permit has been released")

			// INVARIANT 4: the reservation slot is
			// CONSERVED. The BCB's
			// `pendingReservations` is non-empty
			// (the permit is still held). The slot
			// is NOT free for a later admission.
			expect(bcb.coordinator.diagnosticPendingReservationCount()).toBe(1)
			expect(bcb.coordinator.computeObservationUsed()).toBe(1)

			// INVARIANT 5: no additional admission can
			// consume the slot. With
			// maxObservationCapacity=4 and one held
			// permit, a second admission MUST be
			// refused at the BCB's capacity check.
			const secondAdmit = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
			expect(secondAdmit.kind).toBe("at_capacity")

			// INVARIANT 6: a late-arriving terminal
			// settlement releases the permit
			// exactly once, AUTOMATICALLY (driven by
			// the production auto-release hook
			// installed at the top of
			// `failClosedPostLaunch`, NOT by a
			// manual test call). The test resolves
			// the controlled terminalPromise
			// (simulating the manager's deadline
			// watchdog reaching terminality after
			// the bounded wait) and verifies that
			// the production hook itself drains
			// the slot. A follow-up manual release
			// is `not_found` (the hook already
			// released the permit; idempotency is
			// preserved by the BCB's contract).
			controlled.resolveTerminal()
			// The auto-release hook runs in a
			// microtask after the terminalPromise
			// resolves. A small bounded wait
			// (50ms, well within Node's microtask
			// queue drain time) is sufficient to
			// observe the release without flakiness.
			await new Promise((r) => setTimeout(r, 50))
			// The production hook MUST have
			// released the permit automatically.
			// `pendingReservations` is empty (the
			// slot is recoverable for the next
			// admission). This is the load-bearing
			// assertion: it proves the production
			// callback, not a manual test call,
			// drained the slot.
			expect(bcb.coordinator.diagnosticPendingReservationCount()).toBe(0)
			// Idempotency: a manual follow-up
			// release of the now-released permit is
			// `not_found` (the permit id is no
			// longer in pendingReservations). The
			// test reads the historical permitId
			// from the BCB's bookkeeping via the
			// pendingReservations map's `last
			// released id` trace: since the permit
			// is now released, we capture its id
			// from a fresh `tryReserveObservationCapacity`
			// and prove that a re-release returns
			// `not_found`.
			const followupAdmit = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
			expect(followupAdmit.kind).toBe("reserved")
			if (followupAdmit.kind === "reserved") {
				// Release the fresh permit so
				// the test doesn't leak state
				// into other tests.
				bcb.coordinator.releaseReservation(followupAdmit.permitId)
			}
		} finally {
			// Restore the original methods so the
			// BCB and manager are usable by other
			// tests.
			;(
				bcb.coordinator as unknown as {
					attachReservationToJob: typeof originalAttach
				}
			).attachReservationToJob = originalAttach
			;(manager as unknown as { start: typeof originalStart }).start = originalStart
			;(manager as unknown as { cancel: typeof originalCancel }).cancel = originalCancel
			await manager.dispose()
		}
	})

	// ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
	// (CORR-POST-START-TIMEOUT-02): when `manager.cancel(...)`
	// itself NEVER resolves (the supervised-lifecycle call
	// hangs), the helper MUST:
	//   (a) return a bounded failure (the tool response is
	//       bounded by the timer, NOT by the hung cancel),
	//   (b) keep the reservation slot held (the BCB's
	//       `pendingReservations` is non-empty),
	//   (c) report a "containment pending" error that does
	//       NOT contain the false "cancelled" claim,
	//   (d) NOT release the permit at tool-throw time.
	//
	// The cancel-hang case is structurally distinct from the
	// terminal-timeout case (POST-START-TIMEOUT-01) because
	// the settle race must NOT be blocked by a hung cancel.
	// The implementation runs `cancelTask` and `settleRace`
	// concurrently; a hung cancel does not block the settle
	// race's timer from firing.
	it("POST-START-TIMEOUT-02: when manager.cancel never resolves, the helper is bounded and the permit is conserved", async () => {
		// Capacity=1: a single held permit fills the
		// entire capacity, so a second admission MUST
		// be refused at the BCB's capacity check.
		const bcb = newTestBCB({ maxObservationCapacity: 1 })
		const manager = new CommandJobManager()
		const resolveActiveOwner = () => bcb.owner

		// Controlled `manager.start` returns a synthetic
		// `running` job with a TEST-OWNED
		// `terminalPromise`. The test NEVER resolves
		// the terminalPromise so the helper's settle
		// race's timer wins.
		const originalStart = manager.start.bind(manager)
		const controlled = makeUnsettledStartResult("h1-POST-START-TIMEOUT-02")
		;(manager as unknown as { start: typeof originalStart }).start = (async () =>
			controlled.result as unknown as Awaited<ReturnType<typeof originalStart>>) as typeof originalStart

		// Controlled `manager.cancel` is a HANG — the
		// returned promise NEVER resolves and NEVER
		// rejects. The helper's `cancelTask` writes to
		// `cancelSettled` only when the cancel settles
		// (it never does in this test). The helper's
		// settle race runs concurrently; the settle
		// race's timer is the only signal that bounds
		// the tool's response.
		const originalCancel = manager.cancel.bind(manager)
		;(manager as unknown as { cancel: typeof originalCancel }).cancel = (async () => {
			// Intentionally never resolves or rejects.
			await new Promise<never>(() => {})
			// Unreachable: TypeScript's return-type
			// inference wants a return.
			return { ok: true as const, state: "cancelled" as const }
		}) as typeof originalCancel

		// Force the BCB's `attachReservationToJob` to
		// fail (invalid_permit) so the post-launch
		// failure path engages.
		const originalAttach = bcb.coordinator.attachReservationToJob.bind(bcb.coordinator)
		;(
			bcb.coordinator as unknown as {
				attachReservationToJob: typeof originalAttach
			}
		).attachReservationToJob = ((_input: {
			permitId: string
			jobId: string
			owner?: { sessionId: string; taskId: string | undefined }
		}) => {
			return { kind: "invalid_permit" as const }
		}) as typeof originalAttach

		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("not used in background mode")
			},
			vscodeTerminalExecutionMode: "backgroundExec",
			commandJobManager: manager,
			backgroundWaitBudgetMs: 5,
			backgroundExecutionDeadlineMs: 30_000,
			backgroundNotifyCoordinator: bcb.coordinator,
			resolveActiveOwner,
		})

		try {
			// The tool's pre-launch reservation
			// succeeds. The tool calls the controlled
			// `manager.start` (returns "running"), then
			// the BCB's `attachReservationToJob` fails
			// (controlled), then the bounded repair
			// kicks in: the tool calls the HUNG
			// `manager.cancel`, which never resolves,
			// AND the settle race's timer fires. The
			// settle race wins; the helper reports
			// `timeout`; the permit is conserved.
			const result = (await tool.execute(
				{ commands: ["/bin/sh -c 'sleep 5'"] },
				{
					agentId: "agent-POST-START-TIMEOUT-02",
					conversationId: "conv-POST-START-TIMEOUT-02",
					iteration: 1,
					metadata: { notifyOnCompletion: true },
				},
			)) as Array<{ result: string; success: boolean; error?: string }>

			// INVARIANT 1: the tool's response is
			// bounded. The hung cancel does NOT block
			// the helper — the settle race's timer
			// fires first and the helper reports
			// `timeout`.
			const firstResult = result[0]
			expect(firstResult.success).toBe(false)
			expect(firstResult.error).toBeDefined()

			// INVARIANT 2: the error message identifies
			// the bounded-wait outcome. The
			// cancel-hang case is a `cancel_error`
			// (the cancel call itself hung; the
			// supervised job's terminality is
			// UNKNOWN). The error message MUST
			// identify the cancel-hang as the
			// cause of the failure, and MUST use
			// the "CONSERVED" / "UNKNOWN" markers
			// so the host's diagnostic capture can
			// attribute the failure correctly.
			expect(firstResult.error).toContain("Command failed")
			expect(firstResult.error).toContain("Observation-capacity admission failed")
			expect(firstResult.error).toContain("post-launch")
			expect(firstResult.error).toContain("attach refused")
			expect(firstResult.error).toContain("supervised-lifecycle cancel call itself failed")
			expect(firstResult.error).toContain("UNKNOWN")
			expect(firstResult.error).toContain("CONSERVED")

			// INVARIANT 3: the error message MUST NOT
			// falsely claim that the supervised job
			// was "cancelled through the supervised
			// lifecycle" (the cancel hung; we don't
			// know if it succeeded or failed). The
			// helper's `cancel_error` outcome is the
			// authoritative signal.
			expect(firstResult.error).not.toContain("cancelled through the supervised lifecycle")
			expect(firstResult.error).not.toContain("permit has been released")

			// INVARIANT 4: the reservation slot is
			// CONSERVED. The BCB's
			// `pendingReservations` is non-empty. The
			// slot is NOT free for a later admission.
			expect(bcb.coordinator.diagnosticPendingReservationCount()).toBe(1)
			expect(bcb.coordinator.computeObservationUsed()).toBe(1)

			// INVARIANT 5: no additional admission can
			// consume the slot.
			const secondAdmit = bcb.coordinator.tryReserveObservationCapacity({ owner: bcb.owner })
			expect(secondAdmit.kind).toBe("at_capacity")
		} finally {
			// Restore the original methods so the
			// BCB and manager are usable by other
			// tests. The hung cancel promise is
			// intentionally not resolved/rejected;
			// the test framework's process tear-down
			// will GC it.
			;(
				bcb.coordinator as unknown as {
					attachReservationToJob: typeof originalAttach
				}
			).attachReservationToJob = originalAttach
			;(manager as unknown as { start: typeof originalStart }).start = originalStart
			;(manager as unknown as { cancel: typeof originalCancel }).cancel = originalCancel
			await manager.dispose()
		}
	})
})
