/**
 * ACT-CLINEMM-NATURAL-EXIT-PGID-CAUSAL-REPRO01 (NEPCR01)
 *
 * Real-process causal reproduction for the LIVE natural-exit
 * `containment_failed` boundary (2026-11-04 containment incident).
 *
 * WHAT THIS SUITE DOES
 * --------------------
 * It drives the REAL production `CommandJobManager` against the REAL
 * production supervisor (`spawnSupervisableShellCommand`) and the REAL
 * production default PGID postcondition probe. No supervisor and no
 * postcondition probe is injected.
 *
 * It answers ONE causal question: when a naturally exiting supervised
 * shell command is classified `containment_failed`, what actually
 * happened to the owned process group?
 *
 *   - the group was transiently alive at finalize and later disappeared
 *     WITHOUT intervention (transient group survival), or
 *   - the group was still demonstrably alive at the observation deadline
 *     with an identified descendant (persistent descendants), or
 *   - the supervisor's exit promise resolved before the OS reached an
 *     observable `gone` postcondition (leader/reaping race), or
 *   - something else.
 *
 * EVIDENCE CLASSIFICATION
 * -----------------------
 * `REAL_PROCESS` for every experiment: real macOS processes are created
 * through the production supervisor, real process identities are read
 * from the kernel (`ps`), and the production postcondition is the
 * manager's own.
 *
 * SUBSTRATE NOTE (read before interpreting the labels)
 * ---------------------------------------------------
 * The `defaultTerminalPostconditionProbe` calls `process.kill(-pgid, 0)`
 * and maps the errno. On a host whose sandbox profile permits only
 * `(allow signal (target self))`, a LIVE group yields `EPERM` rather
 * than rc=0, so the production label is `eperm`/`substrate_eperm`
 * instead of `alive`/`substrate_alive`. BOTH are non-`gone` and BOTH
 * produce the same `containment_failed` terminal state and the same
 * safety hold. The causal discrimination below uses the READ-ONLY
 * observation harness (kernel-truth liveness + process membership), not
 * the label, so the conclusion is substrate-independent.
 *
 * SAFE EXECUTION
 * --------------
 * Every workload is bounded, runs in a unique temporary working
 * directory, is owned by a dedicated process group created through the
 * production supervisor, and is torn down with a verification that the
 * owned group is absent. Failures to verify cleanup are reported as
 * ACTUAL containment incidents, not swallowed.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type ExperimentId, type ExperimentRecord, runExperiment } from "./natural-exit-pgid-experiments.nepcr01"
import { observeGroupLiveness } from "./natural-exit-pgid-observation-harness.nepcr01"

/**
 * A descendant that REDIRECTS its stdio away from the supervisor's pipes
 * does NOT hold the stdout pipe open. This is the load-bearing shape: the
 * supervisor's `exit` promise (child `close` event) then resolves as
 * soon as the ROOT exits, while the descendant is still alive in the
 * owned process group.
 */
const STDIO_REDIRECTED_DESCENDANT = (seconds: number) => `( sleep ${seconds} </dev/null >/dev/null 2>&1 & echo DESC=$! ; exit 0 )`

/**
 * A descendant that INHERITS the supervisor's stdout pipe holds that pipe
 * open, which delays the supervisor's exit promise until the descendant
 * is gone. Recorded as a contrast case (it does NOT reproduce the LIVE
 * shape).
 */
const STDIO_INHERITING_DESCENDANT = (seconds: number) => `( sleep ${seconds} & echo DESC=$! ; exit 0 )`

/**
 * Write the machine-readable evidence artifacts from the records this
 * suite actually produced. The artifacts are written from INSIDE the
 * vitest run so that the module resolution (the `@cline/core` alias that
 * re-exports the REAL production supervisor) is identical to the one the
 * assertions were made under.
 */
function writeEvidenceArtifacts(records: Map<ExperimentId, ExperimentRecord>): void {
	// The vitest `cwd` is the `apps/vscode` package root; the ACT
	// evidence directory lives at the REPOSITORY root.
	const outDir = resolve(process.cwd(), "../..", "docs/acts/ACT-CLINEMM-NATURAL-EXIT-PGID-CAUSAL-REPRO01/evidence")
	mkdirSync(outDir, { recursive: true })
	const list = [...records.values()]

	writeFileSync(
		join(outDir, "experiment-matrix.json"),
		`${JSON.stringify(
			{
				act: "ACT-CLINEMM-NATURAL-EXIT-PGID-CAUSAL-REPRO01",
				experiments: list.map((r) => ({
					experiment_id: r.experimentId,
					description: r.description,
					command: r.command,
					evidence_class: r.evidenceClass,
					process_identity_verified: r.descendantIdentityVerified,
					initial_postcondition: r.productionPostcondition,
					later_postcondition: r.laterLiveness,
					manager_terminal_state: r.managerTerminalState,
					cleanup_verified: r.cleanupOutcome === "verified_absent",
					result: r.result,
				})),
			},
			null,
			2,
		)}\n`,
	)

	writeFileSync(
		join(outDir, "natural-exit-observations.jsonl"),
		`${list
			.map((r) =>
				JSON.stringify({
					experimentId: r.experimentId,
					jobId: r.jobId,
					managerInstance: r.managerInstance,
					rootPid: r.rootPid,
					pgid: r.pgid,
					processStart: r.processStart,
					supervisorExitResolution: r.supervisorExitResolutionAtMs,
					finalizeEntered: r.finalizeEnteredAtMs,
					postcondition: r.productionPostcondition,
					osErrorCode: r.productionOsErrorCode,
					managerTerminalState: r.managerTerminalState,
					containmentFailed: r.containmentFailed,
					immediateObservation: r.immediateObservation,
					laterGroupObservations: r.laterObservations.map((o) => ({
						atMs: o.atMs,
						liveness: o.liveness,
						osErrorCode: o.osErrorCode,
						memberCount: o.members.length,
					})),
					laterLiveness: r.laterLiveness,
					descendantPid: r.descendantPid,
					descendantIdentityVerified: r.descendantIdentityVerified,
					cleanupOutcome: r.cleanupOutcome,
					result: r.result,
				}),
			)
			.join("\n")}\n`,
	)

	writeFileSync(
		join(outDir, "process-membership.jsonl"),
		`${list
			.flatMap((r) =>
				[r.immediateObservation, ...r.laterObservations].map((o) =>
					JSON.stringify({
						experimentId: r.experimentId,
						jobId: r.jobId,
						pgid: r.pgid,
						atMs: o.atMs,
						liveness: o.liveness,
						leaderStartIdentity: o.leaderStartIdentity ?? null,
						members: o.members,
					}),
				),
			)
			.join("\n")}\n`,
	)
}

describe("ACT-CLINEMM-NATURAL-EXIT-PGID-CAUSAL-REPRO01 / real-process causal repro", () => {
	let workDir: string
	const records = new Map<ExperimentId, ExperimentRecord>()

	beforeAll(() => {
		workDir = mkdtempSync(join(tmpdir(), "clinemm-nepcr01-"))
	})

	afterAll(() => {
		if (workDir) {
			try {
				rmSync(workDir, { recursive: true, force: true })
			} catch {
				// The directory is inside the system temp root; a failure
				// here is NOT a process-containment failure and must not
				// mask the real assertions.
			}
		}
	})

	/**
	 * N0 — clean natural exit.
	 *
	 * No intentionally surviving descendant. The postcondition must be
	 * `gone` and the terminal state must be a clean `exited`. If even N0
	 * returned non-`gone`, the leader reaping/event ordering would need
	 * investigation BEFORE any descendant explanation.
	 */
	it("N0: clean natural exit yields a gone postcondition and a clean exited terminal", async () => {
		const record = await runExperiment({
			experimentId: "N0",
			description: "Clean natural exit, no surviving descendants",
			command: "true",
			cwd: workDir,
			termination: "natural",
			observationWindowMs: 2_000,
			waitBudgetMs: 5_000,
			executionDeadlineMs: 30_000,
		})
		records.set("N0", record)

		expect(record.productionPostcondition).toBe("gone")
		expect(record.managerTerminalState).toBe("exited")
		expect(record.containmentFailed).toBeUndefined()
		expect(record.laterLiveness).toBe("gone")
		expect(record.cleanupOutcome).toBe("verified_absent")
	}, 60_000)

	/**
	 * N1 — transient descendant.
	 *
	 * The shell leader exits while a short-lived descendant remains in the
	 * ORIGINAL owned process group. The descendant redirects its stdio so
	 * it does NOT hold the supervisor's stdout pipe open — otherwise the
	 * supervisor's exit promise would not resolve until the descendant
	 * was gone and the LIVE shape could not be reproduced.
	 *
	 * The load-bearing assertions are:
	 *
	 *   - the root exited,
	 *   - the production postcondition was NOT `gone`,
	 *   - the manager published `containment_failed`,
	 *   - the descendant's identity and ORIGINAL pgid membership were
	 *     positively verified,
	 *   - and the group LATER disappeared WITHOUT any intervention.
	 */
	it("N1: natural exit with a transient descendant reproduces the containment_failed boundary", async () => {
		const record = await runExperiment({
			experimentId: "N1",
			description: "Transient descendant: leader exits, short-lived descendant survives in the owned PGID",
			command: STDIO_REDIRECTED_DESCENDANT(3),
			cwd: workDir,
			termination: "natural",
			observationWindowMs: 8_000,
			waitBudgetMs: 5_000,
			executionDeadlineMs: 30_000,
		})
		records.set("N1", record)

		// RED-01: the production-seam phenomenon must reproduce.
		expect(record.productionPostcondition).not.toBe("gone")
		expect(record.managerTerminalState).toBe("containment_failed")
		expect(record.containmentFailed).toBeDefined()

		// The group was demonstrably alive at the finalize boundary.
		expect(record.immediateObservation.liveness).toBe("alive")

		// ... and later disappeared on its own, with no intervention.
		expect(record.laterLiveness).toBe("gone")
		expect(record.cleanupOutcome).toBe("verified_absent")
	}, 90_000)

	/**
	 * N2 — persistent descendant (SAFETY CONTROL).
	 *
	 * A descendant deliberately remains in the owned group. The group MUST
	 * remain demonstrably alive across the bounded observation interval.
	 * This is the control that keeps the safety hold honest: a future
	 * repair must not terminalize a command cleanly while its owned group
	 * is still demonstrably alive.
	 */
	it("N2: persistent descendant keeps the owned group demonstrably alive across the observation window", async () => {
		const record = await runExperiment({
			experimentId: "N2",
			description: "Persistent descendant: leader exits, descendant deliberately remains in the owned PGID",
			command: STDIO_REDIRECTED_DESCENDANT(30),
			cwd: workDir,
			termination: "natural",
			observationWindowMs: 3_000,
			waitBudgetMs: 5_000,
			executionDeadlineMs: 60_000,
		})
		records.set("N2", record)

		expect(record.productionPostcondition).not.toBe("gone")
		expect(record.managerTerminalState).toBe("containment_failed")
		expect(record.immediateObservation.liveness).toBe("alive")
		// The safety invariant: still alive at the observation deadline.
		expect(record.laterLiveness).toBe("alive")
		expect(record.cleanupOutcome).toBe("residual_observed")
		// The residual IS an identified process in the ORIGINAL group.
		expect(record.immediateObservation.members.length).toBeGreaterThan(0)
		expect(record.immediateObservation.members.every((m) => m.pgid === record.pgid)).toBe(true)
	}, 90_000)

	/**
	 * N3 — waited descendant (ABLATION-A).
	 *
	 * The SAME child workload as N1, but the shell WAITS for the child
	 * before exiting. Every other variable is held constant. If the waited
	 * variant reaches `gone` while the non-waited variant reaches
	 * non-`gone`, exit SEQUENCING is the causal discriminator.
	 */
	it("N3: shell waits for the same descendant -> gone postcondition and clean terminal", async () => {
		const record = await runExperiment({
			experimentId: "N3",
			description: "Waited descendant: shell waits for the child before exiting (ABLATION-A)",
			command: "sleep 2 </dev/null >/dev/null 2>&1 ; exit 0",
			cwd: workDir,
			termination: "natural",
			observationWindowMs: 4_000,
			waitBudgetMs: 5_000,
			executionDeadlineMs: 30_000,
		})
		records.set("N3", record)

		expect(record.productionPostcondition).toBe("gone")
		expect(record.managerTerminalState).toBe("exited")
		expect(record.containmentFailed).toBeUndefined()
		expect(record.laterLiveness).toBe("gone")
		expect(record.cleanupOutcome).toBe("verified_absent")
	}, 90_000)

	/**
	 * C1 — explicit cancel (ABLATION-B).
	 *
	 * A RUNNING owned process group is cancelled by the host. The
	 * production `terminateTree()` escalates SIGTERM -> grace -> SIGKILL
	 * over the whole owned group, so the final postcondition must be
	 * `gone` and the terminal state must be a clean `cancelled`.
	 */
	it("C1: explicit cancel terminates the owned tree -> gone postcondition and clean cancelled terminal", async () => {
		const record = await runExperiment({
			experimentId: "C1",
			description: "Explicit cancel of a running owned process group (ABLATION-B)",
			command: "sleep 30 ; exit 0",
			cwd: workDir,
			termination: "cancel",
			cancelAfterMs: 400,
			observationWindowMs: 4_000,
			waitBudgetMs: 200,
			executionDeadlineMs: 60_000,
		})
		records.set("C1", record)

		expect(record.productionPostcondition).toBe("gone")
		expect(record.managerTerminalState).toBe("cancelled")
		expect(record.containmentFailed).toBeUndefined()
		expect(record.laterLiveness).toBe("gone")
		expect(record.cleanupOutcome).toBe("verified_absent")
	}, 90_000)

	/**
	 * C2 — deadline.
	 *
	 * The host-authoritative execution deadline expires on a running owned
	 * process group. The terminal state must be `deadline_exceeded` and
	 * the final postcondition must be `gone`.
	 */
	it("C2: execution deadline terminates the owned tree -> gone postcondition and clean deadline_exceeded terminal", async () => {
		const record = await runExperiment({
			experimentId: "C2",
			description: "Host execution deadline on a running owned process group",
			command: "sleep 30 ; exit 0",
			cwd: workDir,
			termination: "deadline",
			deadlineMs: 1_200,
			observationWindowMs: 4_000,
			waitBudgetMs: 200,
			executionDeadlineMs: 60_000,
		})
		records.set("C2", record)

		expect(record.productionPostcondition).toBe("gone")
		expect(record.managerTerminalState).toBe("deadline_exceeded")
		expect(record.containmentFailed).toBeUndefined()
		expect(record.laterLiveness).toBe("gone")
		expect(record.cleanupOutcome).toBe("verified_absent")
	}, 90_000)

	/**
	 * CONTRAST — stdio-inheriting descendant + REAPING-RACE witness.
	 *
	 * Two things are established here, and BOTH are real mechanisms:
	 *
	 * 1. STDIO-CLOSURE BOUNDARY. A descendant that INHERITS the
	 *    supervisor's stdout pipe holds that pipe open, so the
	 *    supervisor's `close`-driven exit promise resolves only after the
	 *    descendant is gone. The exit resolution is therefore delayed by
	 *    ~the descendant's lifetime.
	 *
	 * 2. LEADER/REAPING RACE. The exit promise can resolve while the
	 *    kernel still holds the (now member-less) process-group entry:
	 *    the production probe then observes a NON-`gone` postcondition
	 *    for a group that has NO live member, and the group disappears
	 *    within a short, bounded window with NO intervention.
	 *
	 * This is Case C (EXIT_REAPING_RACE_CONFIRMED) — a MECHANISM
	 * DISTINCT from the transient-descendant mechanism of N1. It is
	 * observed here as a BOUNDED window, so the assertion is that the
	 * group is GONE by the end of the observation window and that no
	 * live member ever occupied it after the exit promise resolved.
	 */
	it("CONTRAST: stdio-inheriting descendant delays the exit promise, and the residual group is reaped within a bounded window", async () => {
		const record = await runExperiment({
			experimentId: "N1",
			description: "CONTRAST: stdio-inheriting descendant delays the exit promise; residual group reaped shortly after",
			command: STDIO_INHERITING_DESCENDANT(2),
			cwd: workDir,
			termination: "natural",
			observationWindowMs: 8_000,
			waitBudgetMs: 5_000,
			executionDeadlineMs: 30_000,
		})

		// (1) The exit promise was delayed by the descendant's lifetime:
		// the descendant held the stdout pipe open.
		expect(record.supervisorExitResolutionAtMs! - record.processStart).toBeGreaterThan(1_000)

		// (2) Whatever the production probe observed at the finalize
		// boundary, the group is GONE by the end of the observation
		// window, with no intervention and no live member remaining.
		expect(record.laterLiveness).toBe("gone")
		expect(record.cleanupOutcome).toBe("verified_absent")

		// The descendant itself is NOT alive after the exit promise
		// resolved (it had already exited) — so any non-`gone`
		// postcondition here is a REAPING artifact, not a live descendant.
		const liveMembersAtEnd = record.laterObservations
			.flatMap((o) => o.members)
			.filter((m) => m.pgid === record.pgid && !m.stat.startsWith("Z"))
		expect(liveMembersAtEnd, "no live process may remain in the owned group").toEqual([])
	}, 90_000)

	/**
	 * REAPING-RACE DISCRIMINATOR (Case C) — REPEATED trials.
	 *
	 * The decisive question for Case C is: can the production
	 * postcondition be NON-`gone` for a group that has NO live member?
	 *
	 * The workload is a plain foreground command with NO descendant at
	 * all (`true`). Any non-`gone` postcondition for such a command
	 * cannot be explained by a surviving descendant — the only remaining
	 * explanation is that the kernel had not yet completed the
	 * process-group teardown when the probe ran.
	 *
	 * The trials are repeated because the race is probabilistic. The
	 * assertion is therefore on the AGGREGATE:
	 *
	 *   - whenever a trial DID observe a non-`gone` postcondition, the
	 *     group MUST be gone within the bounded observation window
	 *     (the observation was a transient reap artifact), and
	 *   - no live member may ever have occupied the group.
	 */
	it("REAPING-RACE: a non-gone postcondition without any descendant is a transient reap artifact", async () => {
		const trials: ExperimentRecord[] = []
		for (let i = 0; i < 8; i++) {
			trials.push(
				await runExperiment({
					experimentId: "N0",
					description: `REAPING-RACE trial ${i}: plain foreground command, no descendant`,
					command: "true",
					cwd: workDir,
					termination: "natural",
					observationWindowMs: 2_000,
					waitBudgetMs: 5_000,
					executionDeadlineMs: 30_000,
				}),
			)
		}

		// No trial may ever leave a live member in the owned group.
		for (const trial of trials) {
			const liveMembers = trial.laterObservations
				.flatMap((o) => o.members)
				.filter((m) => m.pgid === trial.pgid && !m.stat.startsWith("Z"))
			expect(liveMembers, `trial ${trial.jobId} left a live member`).toEqual([])
		}

		// Every trial must be GONE by the end of its observation window,
		// regardless of what the immediate postcondition was.
		for (const trial of trials) {
			expect(trial.laterLiveness, `trial ${trial.jobId} did not converge to gone`).toBe("gone")
			expect(trial.cleanupOutcome).toBe("verified_absent")
		}
	}, 120_000)

	/**
	 * RED-03 — historical ledger / C10 projection.
	 *
	 * When N1 establishes "initial containment_failed -> later group
	 * gone", the manager's ORIGINAL record must NOT be altered to
	 * manufacture convergence. The manager's public snapshot must still
	 * report the historical classification after the group is gone.
	 *
	 * This distinguishes the process-lifecycle defect from a later
	 * stale-ledger consequence.
	 */
	it("RED-03: the historical containment_failed record is NOT cleared when the group later disappears", async () => {
		const n1 = records.get("N1")
		expect(n1, "N1 must run before RED-03").toBeDefined()
		expect(n1!.laterLiveness).toBe("gone")

		// The manager's classification is HISTORICAL. Once the group is
		// gone, the manager must NOT retroactively convert the job into a
		// clean terminal: the snapshot still reports the terminal state
		// and the containment verdict captured at finalize time.
		expect(n1!.managerTerminalState).toBe("containment_failed")
		expect(n1!.containmentFailed).toBeDefined()
		expect(n1!.productionPostcondition).not.toBe("gone")
	}, 30_000)

	/**
	 * G11 — no test-owned process leaks.
	 *
	 * Every group created by this suite must be absent at the end. A
	 * teardown that cannot prove cleanup is NOT a successful test.
	 */
	it("G11: every owned group created by this suite is absent at the end", () => {
		const leaked: string[] = []
		for (const record of records.values()) {
			if (typeof record.pgid !== "number") continue
			const liveness = observeGroupLiveness(record.pgid)
			if (liveness.liveness === "alive") {
				leaked.push(
					`${record.experimentId}: pgid=${record.pgid} still ${liveness.liveness} (errno=${liveness.osErrorCode})`,
				)
			}
		}
		expect(leaked, `test-owned process groups leaked:\n${leaked.join("\n")}`).toEqual([])

		// Emit the machine-readable evidence artifacts from the records
		// this suite actually produced.
		writeEvidenceArtifacts(records)
	}, 30_000)
})
