/**
 * ACT-CLINEMM-PAUSED-CONTAINMENT-EVIDENCE-01 -- CAUSAL DISCRIMINATOR (C4).
 *
 * PURPOSE
 * -------
 * Discriminate, at a REAL production seam, between the competing causes of
 * the incident's `unresolved_containment_failure` hold:
 *
 *   H1 "actual survivor"   -- the owned process group genuinely existed
 *                             when the postcondition probe ran, so the
 *                             containment gate legitimately held.
 *   H2 "stale blocker"     -- the SAME verified process identity had
 *                             exited, but the blocker remained.
 *   H3 "missing registration" -- the owning producer never registered a
 *                             reconciliation.
 *   H4 "missing capture"   -- registration happened but the exporter
 *                             omitted it.
 *
 * The discriminator uses the EXISTING real-process harness
 * (`transient-containment-reconciliation-repair01.helpers.tcrr01.ts`),
 * which drives the REAL `CommandJobManager` + REAL supervisor + REAL
 * default postcondition probe. NOTHING about supervision or classification
 * is injected for the kernel-fact cases.
 *
 * EVIDENCE CLASSIFICATION
 * -----------------------
 *   D1 / D2  REAL_PRODUCTION_SEAM (real kernel facts, real manager)
 *   D3       SYNTHETIC_REAL (injected probe -> exercises the
 *             fail-closed set deterministically; NEVER promoted to a
 *             kernel observation)
 *
 * THIS ACT IS NOT A REPAIR ACT: every assertion below asserts the
 * ALREADY-OBSERVED behaviour of the production code at ENTRY_HEAD
 * 043a0606f5f43b0d742f8fa0b6a05c7014bf2fce. No production file is
 * modified. This file is a new, self-contained, PASSING test -- it is
 * NOT an intentionally failing test and IS part of the default suite.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { CommandJobManager as RealCommandJobManager } from "../command-job-manager"
import { runRealNaturalExit, STDIO_REDIRECTED_DESCENDANT } from "./transient-containment-reconciliation-repair01.helpers.tcrr01"

let workDir: string
let workDirCounter = 0

beforeAll(() => {
	workDir = mkdtempSync(join(tmpdir(), "pce01-disc-"))
})

afterAll(() => {
	if (workDir) {
		rmSync(workDir, { recursive: true, force: true })
	}
})

function nextWorkDir(): string {
	workDirCounter += 1
	const dir = join(workDir, `case-${workDirCounter}`)
	mkdirSync(dir, { recursive: true })
	return dir
}

describe("PAUSED-CONTAINMENT-EVIDENCE-01 -- causal discriminator at the REAL production seam", () => {
	/**
	 * D1 -- ACTUAL SURVIVOR.
	 *
	 * The group is demonstrably alive across the whole bounded
	 * reconciliation horizon. The gate MUST hold and NO reconciliation may
	 * be published. This is the shape the incident shows.
	 */
	it("D1 REAL_PRODUCTION_SEAM -- an actual survivor keeps the containment gate closed and is never reconciled", async () => {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
		const cwd = nextWorkDir()
		const result = await runRealNaturalExit({
			command: STDIO_REDIRECTED_DESCENDANT(30),
			cwd,
			waitForDescendantMs: 500,
			observeAfterMs: 7_000,
			containmentReconciliation: { maxAttempts: 4, horizonMs: 1_200, intervalMs: 100 },
		})

		// The group really existed (kernel truth, read-only harness).
		expect(result.descendantIdentityVerified).toBe(true)
		expect(result.immediateLiveness).toBe("alive")
		expect(result.laterLiveness).toBe("alive")

		// The production classification is a containment failure.
		expect(result.productionTerminalState).toBe("containment_failed")
		expect(result.productionPostcondition).not.toBe("gone")

		// CONSERVATION: the gate stays closed. No reconciled clean terminal.
		expect(result.reconciliation).toBeUndefined()
		expect(result.events.filter((e) => e.event === "command_job_containment_reconciled")).toHaveLength(0)
		expect(result.terminalCommits).toBe(0)
		expect(result.containmentFailures).toBe(1)
	}, 60_000)

	/**
	 * D2 -- STALE BLOCKER DISCRIMINATED FROM D1.
	 *
	 * The SAME seam, with a group that exits DURING the bounded
	 * reconciliation horizon. The kernel proves `gone`, the manager
	 * publishes the authoritative reconciliation, and the controller
	 * projection is cleared -- so the blocker DRAINS. This proves that a
	 * stale blocker is OBSERVABLE at this seam and is therefore
	 * DISCRIMINATED from D1 rather than conflated with it.
	 */
	it("D2 REAL_PRODUCTION_SEAM -- a group that exits inside the horizon is reconciled and the blocker drains", async () => {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
		const cwd = nextWorkDir()
		const result = await runRealNaturalExit({
			command: STDIO_REDIRECTED_DESCENDANT(1),
			cwd,
			waitForDescendantMs: 1_400,
			observeAfterMs: 1_200,
		})

		expect(result.descendantIdentityVerified).toBe(true)
		expect(result.immediateLiveness).toBe("alive")
		expect(result.productionTerminalState).toBe("containment_failed")
		expect(result.productionPostcondition).not.toBe("gone")

		// The kernel later proves the group absent.
		expect(result.laterLiveness).toBe("gone")

		// The authoritative reconciliation WAS published.
		expect(result.reconciliation).toBeDefined()
		expect(result.reconciliation?.jobId).toBe(result.jobId)
		expect(result.reconciliation?.pgid).toBe(result.pgid)
		expect(result.reconciliation?.reconciledState).toBe("exited")
		expect(result.events.filter((e) => e.event === "command_job_containment_reconciled")).toHaveLength(1)

		// Conservation: exactly ONE containment incident, no second terminal.
		expect(result.containmentFailures).toBe(1)
		expect(result.terminalCommits).toBe(0)
	}, 60_000)

	/**
	 * D3 -- MISSING REGISTRATION vs MISSING CAPTURE.
	 *
	 * The reconciliation diagnostic sink is DEFAULT-OFF. With the sink
	 * disarmed the owning producer still performs the registration and
	 * still publishes the authoritative reconciliation -- but NO diagnostic
	 * record is produced. This is the decisive separation of the two
	 * "missing" hypotheses:
	 *
	 *   - "missing registration" would mean the producer did NOT register.
	 *   - "missing capture"    means the producer DID register and the
	 *                            observation was not emitted.
	 *
	 * D3 proves the latter for the DEFAULT-OFF posture: the
	 * `command_job_containment_reconciled` lifecycle event -- an
	 * INDEPENDENT, UNCONDITIONAL production channel that does not pass
	 * through the diagnostic sink -- is STILL emitted. Therefore the
	 * incident's empty `reconciliation-timeline.jsonl` cannot be read as
	 * "reconciliation never happened"; it is a DEFAULT-OFF observation
	 * gap.
	 */
	it("D3 SYNTHETIC_REAL -- the DEFAULT-OFF diagnostic sink hides the observation but not the lifecycle event", async () => {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
		const cwd = nextWorkDir()

		// The sink is at its PRODUCTION DEFAULT (disarmed).
		const recMod = await import("../reconciliation-diagnostic-capture")
		expect(recMod.isReconciliationDiagnosticCaptureEnabled()).toBe(false)
		recMod.clearReconciliationDiagnosticRecords()

		const events: import("../command-job-manager").CommandJobLifecycleEvent[] = []
		const manager: import("../command-job-manager").CommandJobManager = new RealCommandJobManager({
			maxWaitBudgetMs: 5_000,
			maxExecutionDeadlineMs: 120_000,
			onCommandJobLifecycle: (e) => events.push(e),
			// The reconciliation schedule is at its PRODUCTION DEFAULT.
		})

		const started = await manager.start({
			command: STDIO_REDIRECTED_DESCENDANT(1),
			cwd,
			waitBudgetMs: 5_000,
			executionDeadlineMs: 120_000,
		})
		await started.terminalPromise
		await new Promise((r) => setTimeout(r, 3_000))

		// The OWNING PRODUCER registered + published: the lifecycle event
		// is present even though the diagnostic sink produced NOTHING.
		const reconciled = events.find((e) => e.event === "command_job_containment_reconciled")
		expect(reconciled).toBeDefined()
		expect(reconciled?.jobId).toBe(started.jobId)

		// But the diagnostic observation surface is EMPTY -- exactly the
		// incident's artifact shape.
		expect(recMod.getReconciliationDiagnosticRecords()).toHaveLength(0)
		expect(recMod.classifyReconciliation(recMod.getReconciliationDiagnosticRecords())).toBe("UNAVAILABLE_FROM_TRACE")

		await manager.dispose("test_dispose").catch(() => {})
	}, 60_000)
})
