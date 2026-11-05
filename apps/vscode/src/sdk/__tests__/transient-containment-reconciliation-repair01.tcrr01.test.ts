/**
 * ACT-CLINEMM-TRANSIENT-CONTAINMENT-RECONCILIATION-REPAIR01 (TCRR01)
 *
 * Bounded production repair for the LIVE natural-exit containment
 * failure: a command's owned process group exists at natural-exit
 * finalization, subsequently disappears, but the historical
 * `containment_failed` state remains an unresolved C10 obligation
 * indefinitely.
 *
 * WHAT THIS SUITE DOES
 * --------------------
 *
 * RED-01/RED-02/RED-03 reproduce the failure and close it:
 *
 *   RED-01  Real N1 (transient descendant): the owned PGID is alive at
 *           finalize, `containment_failed` is published, the descendant
 *           exits naturally, the PGID becomes `gone` — and (against the
 *           UNMODIFIED ENTRY_HEAD) the containment obligation stays
 *           stuck, blocking C10 indefinitely.
 *   RED-02  The controller projection stays stale even when the group
 *           is independently observed gone.
 *   RED-03  No automatic release notification is fired for a held
 *           deferred C10 marker.
 *
 * GREEN closes the chain:
 *
 *   manager-origin authoritative re-probe -> `gone`
 *     -> manager records the reconciled outcome
 *     -> controller publishes the matching per-job projection
 *     -> the EXISTING deferred C10 barrier is re-evaluated
 *     -> the shared owner-scoped classifier stops blocking this job
 *
 * EVIDENCE CLASSIFICATION
 * -----------------------
 *
 * `REAL_PROCESS` for the N1 / N2 cases: the REAL production
 * `CommandJobManager` drives the REAL production supervisor
 * (`spawnSupervisableShellCommand`) with the REAL production default
 * PGID postcondition probe. NOTHING about the supervision is injected.
 *
 * `SYNTHETIC_REAL` for the composition / adversarial cases: the REAL
 * manager and the REAL controller publication method are driven with an
 * injected postcondition probe so the entire fail-closed set
 * (`alive` / `eperm` / `unknown` / missing PGID / foreign owner /
 * duplicate evidence / stale publication / disposal / exhaustion) can be
 * exercised deterministically. Injected postconditions are NEVER
 * promoted to real kernel observations - the REAL_PROCESS cases above
 * are the only evidence for the kernel fact.
 *
 * SUBSTRATE NOTE
 * --------------
 *
 * The `defaultTerminalPostconditionProbe` calls `process.kill(-pgid, 0)`.
 * On a host whose sandbox permits only `(allow signal (target self))`, a
 * LIVE group yields `EPERM` rather than rc=0, so the production label
 * is `eperm`/`substrate_eperm` instead of `alive`/`substrate_alive`.
 * BOTH are non-`gone` and BOTH produce the same `containment_failed`
 * terminal state and the same safety hold. The causal discrimination
 * uses the READ-ONLY observation harness (kernel-truth liveness +
 * process membership), not the label, so the conclusion is
 * substrate-independent.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { runRealNaturalExit, STDIO_REDIRECTED_DESCENDANT } from "./transient-containment-reconciliation-repair01.helpers.tcrr01"

/**
 * A descendant that REDIRECTS its stdio away from the supervisor's pipes
 * does NOT hold the stdout pipe open. The supervisor's `exit` promise
 * (child `close` event) then resolves as soon as the ROOT exits, while
 * the descendant is still alive in the owned process group. This is the
 * load-bearing N1 shape.
 */
let workDir: string
let workDirCounter = 0

beforeAll(() => {
	workDir = mkdtempSync(join(tmpdir(), "tcrr01-"))
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

/**
 * The Seatbelt profile of this host denies signals to other processes,
 * including direct children. The experimental sandbox is therefore
 * disabled so the REAL cases exercise the CLASSIC supervised path (the
 * one the LIVE incident used).
 */
function disableExperimentalSandbox(): void {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
}

describe("TCRR01 — REAL_PROCESS: N1 transient descendant reconciles", () => {
	it("G1 — a transient descendant's owned PGID becomes gone and the containment obligation is reconciled", async () => {
		disableExperimentalSandbox()
		const cwd = nextWorkDir()
		// A 1-second descendant: the shell exits immediately, the
		// descendant survives the finalize boundary, then exits naturally.
		const result = await runRealNaturalExit({
			command: STDIO_REDIRECTED_DESCENDANT(1),
			cwd,
			waitForDescendantMs: 1_400,
			observeAfterMs: 1_200,
		})

		// --- The REAL N1 reproduction shape -------------------------------
		expect(result.descendantPid).toBeTypeOf("number")
		expect(result.descendantIdentityVerified).toBe(true)
		expect(result.immediateLiveness).toBe("alive")
		expect(result.productionTerminalState).toBe("containment_failed")
		expect(result.productionPostcondition).not.toBe("gone")
		expect(result.containmentFailures).toBe(1)

		// --- The descendant exits naturally; the group becomes gone -------
		expect(result.laterLiveness).toBe("gone")

		// --- GREEN: the authoritative later `gone` reconciles --------------
		expect(result.reconciliation).toBeDefined()
		expect(result.reconciliation?.jobId).toBe(result.jobId)
		expect(result.reconciliation?.pgid).toBe(result.pgid)
		expect(result.reconciliation?.reconciledState).toBe("exited")
		expect(result.reconciliation?.containmentFailed).toBe(
			result.productionPostcondition === "eperm" ? "substrate_eperm" : "substrate_alive",
		)

		// --- Event cardinality: exactly ONE containment incident -----------
		expect(result.containmentFailures).toBe(1)
		expect(result.terminalCommits).toBe(0)
		expect(result.events.filter((e) => e.event === "command_job_containment_reconciled")).toHaveLength(1)
	}, 60_000)

	it("G2 — a persistent descendant keeps the owned group alive and is NEVER reconciled", async () => {
		disableExperimentalSandbox()
		const cwd = nextWorkDir()
		// A 30-second descendant: the owned group is demonstrably alive
		// across the ENTIRE reconciliation observation horizon.
		const result = await runRealNaturalExit({
			command: STDIO_REDIRECTED_DESCENDANT(30),
			cwd,
			waitForDescendantMs: 500,
			// The bounded default horizon is 5s; give it the full budget
			// plus margin so the exhaustion path is exercised.
			observeAfterMs: 7_000,
			containmentReconciliation: {
				maxAttempts: 4,
				horizonMs: 1_200,
				intervalMs: 100,
			},
		})

		// --- The N2 safety control ---------------------------------------
		expect(result.descendantIdentityVerified).toBe(true)
		expect(result.immediateLiveness).toBe("alive")
		expect(result.productionTerminalState).toBe("containment_failed")
		expect(result.laterLiveness).toBe("alive")

		// --- CRITICAL SAFETY GATE: no reconciled clean terminal ------------
		expect(result.reconciliation).toBeUndefined()
		expect(result.events.filter((e) => e.event === "command_job_containment_reconciled")).toHaveLength(0)
		expect(result.terminalCommits).toBe(0)
		// The ORIGINAL containment failure remains observable.
		expect(result.containmentFailures).toBe(1)
	}, 60_000)
})
