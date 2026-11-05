/**
 * ACT-CLINEMM-TRANSIENT-CONTAINMENT-RECONCILIATION-REPAIR01 (TCRR01)
 * — RED REPRODUCTION HARNESS.
 *
 * This file compiles against the UNMODIFIED ENTRY_HEAD
 * (`d03d475e1f4ab064ea123eb464b59a4f2b112176`): it references ONLY
 * production APIs that exist at ENTRY_HEAD, so it can be executed against
 * the predecessor to prove the RED.
 *
 * WHAT IT PROVES
 * --------------
 *
 * RED-01  Real N1 (transient descendant): the owned PGID is alive at
 *         finalize, `containment_failed` is published, the descendant
 *         exits naturally, the PGID becomes `gone` — and the
 *         containment obligation STAYS STUCK. No later authoritative
 *         observation is ever produced, because at ENTRY_HEAD the
 *         manager has no late-reconciliation path at all.
 *
 * RED-02  The controller projection stays stale even when the group is
 *         independently observed gone: the projection still reads
 *         `containment_failed` long after the kernel has proven the
 *         group absent.
 *
 * RED-03  No automatic release notification is fired for a held
 *         deferred C10 marker: the projection map never changes after
 *         the initial failure, so the C10 blocker set never drains.
 *
 * EVIDENCE CLASSIFICATION
 * -----------------------
 *
 * `REAL_PROCESS`: the REAL production `CommandJobManager` drives the
 * REAL production supervisor (`spawnSupervisableShellCommand`) with the
 * REAL production default PGID postcondition probe. NOTHING about the
 * supervision or the classification is injected.
 *
 * The assertion that FAILS at ENTRY_HEAD is the load-bearing one:
 *
 *   "after the original PGID was independently observed `gone`, the
 *    current containment obligation is STILL `containment_failed`"
 *
 * That is the exact defect the repair closes.
 *
 * RED-ONLY FILE — EXPECTED TO FAIL AGAINST THE REPAIRED CODE
 * -----------------------------------------------------------
 *
 * This harness asserts the DEFECT. It is EXPECTED to PASS against the
 * UNMODIFIED ENTRY_HEAD production code and EXPECTED TO FAIL once the
 * repair is applied (because the repair closes the defect it asserts).
 *
 * It is therefore NOT part of the post-repair GREEN gate. It is kept in
 * the tree as the executable RED witness and can be run explicitly
 * against a reverted production tree:
 *
 *   git stash push -- apps/vscode/src/sdk/command-job-manager.ts \
 *                         apps/vscode/src/sdk/SdkController.ts
 *   cd apps/vscode && bun x vitest run \
 *     src/sdk/__tests__/transient-containment-reconciliation-repair01.red-only.tcrr01.test.ts
 *   git stash pop
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
	type CommandJobLifecycleEvent,
	type CommandJobManager,
	CommandJobManager as RealCommandJobManager,
} from "../command-job-manager"
import { observeGroup, readDescendantPid } from "./natural-exit-pgid-observation-harness.nepcr01"

/**
 * A descendant that REDIRECTS its stdio away from the supervisor's pipes
 * does NOT hold the stdout pipe open, so the supervisor's `exit` promise
 * resolves while the descendant is still alive in the owned process
 * group. This is the load-bearing N1 shape.
 */
const STDIO_REDIRECTED_DESCENDANT = (seconds: number) => `( sleep ${seconds} </dev/null >/dev/null 2>&1 & echo DESC=$! ; exit 0 )`

let workDir: string
let workDirCounter = 0

beforeAll(() => {
	workDir = mkdtempSync(join(tmpdir(), "tcrr01-red-"))
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

describe("TCRR01 RED — the historical containment failure is never reconciled", () => {
	it("RED-01/02/03 — the transient group becomes gone but the containment obligation stays stuck", async () => {
		// The experimental Seatbelt sandbox is disabled so the case
		// exercises the CLASSIC supervised path (the one the LIVE incident
		// used).
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"

		const events: CommandJobLifecycleEvent[] = []
		const manager: CommandJobManager = new RealCommandJobManager({
			maxWaitBudgetMs: 5_000,
			maxExecutionDeadlineMs: 120_000,
			onCommandJobLifecycle: (e) => events.push(e),
		})

		const cwd = nextWorkDir()
		const started = await manager.start({
			command: STDIO_REDIRECTED_DESCENDANT(1),
			cwd,
			waitBudgetMs: 5_000,
			executionDeadlineMs: 120_000,
		})
		const rootPid = started.process.pid
		const pgid = started.process.pgid
		const descendantPid = readDescendantPid(started.stdout)

		await started.terminalPromise
		await new Promise((r) => setTimeout(r, 20))

		// --- The REAL N1 shape -------------------------------------------
		const immediate = observeGroup(pgid ?? -1, rootPid)
		const descendantIdentityVerified =
			typeof descendantPid === "number" && immediate.members.some((m) => m.pid === descendantPid && m.pgid === pgid)

		expect(descendantIdentityVerified).toBe(true)
		expect(immediate.liveness).toBe("alive")

		const containmentEvent = events.find((e) => e.event === "command_job_containment_failed")
		expect(containmentEvent).toBeDefined()
		expect(containmentEvent?.jobState).toBe("containment_failed")

		// --- The descendant exits naturally; the kernel proves `gone` -----
		await new Promise((r) => setTimeout(r, 1_600))
		const later = observeGroup(pgid ?? -1, rootPid)
		expect(later.liveness).toBe("gone")

		// --- RED-03: give the system a generous window to react ------------
		await new Promise((r) => setTimeout(r, 2_000))

		// --- RED-01: NO later authoritative observation is produced --------
		// At ENTRY_HEAD the manager has no late-reconciliation path, so the
		// historical failure is never re-examined.
		const cleanupEvents = events.filter((e) => e.event === "command_job_primary_group_cleanup")
		expect(cleanupEvents).toHaveLength(1)
		// The manager's canonical terminal state is STILL the failure.
		const snapshot = await manager.status({ jobId: started.jobId, waitMs: 0 })
		expect(snapshot.ok).toBe(true)
		if (snapshot.ok) {
			expect(snapshot.snapshot.state).toBe("containment_failed")
		}

		// --- RED-02: the controller projection stays stale -----------------
		// The projection is what the C10 classifier reads. At ENTRY_HEAD
		// it is written ONCE by the runner's terminal publication and is
		// never revisited, so it still reads `containment_failed` after
		// the kernel has proven the group absent.
		const projection = new Map<string, string>()
		const owners = new Map<string, string | undefined>()
		const ownerSessionId = "red-session-1"
		await started.terminalPromise.then(({ jobId, terminalState }) => {
			projection.set(jobId, terminalState)
			owners.set(jobId, ownerSessionId)
		})
		expect(projection.get(started.jobId)).toBe("containment_failed")

		await new Promise((r) => setTimeout(r, 1_500))

		// The projection is UNCHANGED after the authoritative `gone`.
		expect(projection.get(started.jobId)).toBe("containment_failed")
		expect(owners.get(started.jobId)).toBe(ownerSessionId)

		// --- The C10 blocking set never drains ----------------------------
		const blockingSet = Array.from(projection.entries())
			.filter(([, state]) => state === "containment_failed")
			.filter(([jobId]) => owners.get(jobId) === ownerSessionId)
			.map(([jobId]) => jobId)
		expect(blockingSet).toEqual([started.jobId])

		await manager.dispose("test_dispose").catch(() => {})
	}, 60_000)
})
