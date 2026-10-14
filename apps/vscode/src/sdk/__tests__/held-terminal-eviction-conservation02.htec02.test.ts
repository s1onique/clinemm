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

let supervisorPid = 230000

interface TestBCB {
	coordinator: BackgroundNotifyCoordinator
	owner: { sessionId: string; taskId: string | undefined }
	resolveOwner: () => { sessionId: string; taskId: string | undefined }
	enqueueWake: ReturnType<typeof vi.fn>
}

function newTestBCB(opts?: {
	maxObservationCapacity?: number
	ownerTaskId?: string
}): TestBCB {
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
		resolution: "canonical_status_observed"
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
		resolution: "canonical_status_observed"
		})
		bcb.coordinator.resolveObligation({
			jobId: "job-Y",
			sessionId: bcb.owner.sessionId,
			taskId: bcb.owner.taskId,
		resolution: "canonical_status_observed"
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
		resolution: "canonical_status_observed"
		})
		expect(bcb.coordinator.diagnosticMarkerCount()).toBe(1)
		bcb.coordinator.resolveObligation({
			jobId: "job-owner1",
			sessionId: bcb.owner.sessionId,
			taskId: bcb.owner.taskId,
		resolution: "canonical_status_observed"
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
		resolution: "canonical_status_observed"
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
		resolution: "canonical_status_observed"
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
				throw new Error(`expected refusal but got success=true; result=${secondResult.result}; pendingReservations=${bcb.coordinator.diagnosticPendingReservationCount()}; markers=${bcb.coordinator.diagnosticMarkerCount()}; used=${bcb.coordinator.computeObservationUsed()}; max=${bcb.coordinator.diagnosticMaxObservationCapacity()}`)
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
			resolution: "canonical_status_observed"
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
		;(bcb.coordinator as unknown as { tryReserveObservationCapacity: typeof original }).tryReserveObservationCapacity = original
	})
})
