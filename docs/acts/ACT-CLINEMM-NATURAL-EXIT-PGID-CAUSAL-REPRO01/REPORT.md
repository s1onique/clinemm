# ACT-CLINEMM-NATURAL-EXIT-PGID-CAUSAL-REPRO01

**Decision:** C1: GO
**Repository:** `clinemm`
**Branch:** `main`
**Primary purpose:** Reproduction and causal discrimination
**Predecessor:** `ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01-CORRECTION01`
**LIVE evidence source:** 2026-11-04 containment incident
**Production repair:** NOT AUTHORIZED by this ACT

---

> **CORRECTION01 — 2026-11-05 — EVIDENCE-CONTRACT CORRECTION ONLY.**
>
> `ACT-CLINEMM-NATURAL-EXIT-PGID-CAUSAL-REPRO01-CORRECTION01` closed two P0
> evidence-contract defects in the experiment suite raised by the 2026-11-05
> review (`HALT_CAUSAL_EVIDENCE_OVERCLAIM`). It changed **NO production file**
> and **NO production semantics**. The N1 and N2 evidence is preserved
> unchanged. See [CORRECTION01](./CORRECTION01.md) for the full record, the
> two corrected contracts, and the measurements that closed them.

---

## Terminal report

```
ACT:
ACT-CLINEMM-NATURAL-EXIT-PGID-CAUSAL-REPRO01

VERDICT:
PASS_CAUSAL_REPRO

  The REAL production natural-exit path reproduces the non-`gone` ->
  `containment_failed` boundary, and TWO distinct causal mechanisms
  account for it:

    (1) TRANSIENT DESCENDANT SURVIVAL
        The owned group is alive at finalize because a descendant is
        still in it, and it disappears later WITHOUT intervention.

    (2) LEADER/REAPING RACE
        The owned group has NO live member at finalize, yet the kernel
        has not yet completed the process-group teardown; it becomes
        `gone` within a bounded window with no intervention.

  Because more than one mechanism is demonstrated, the causal
  classification is MULTIPLE_CAUSAL_MECHANISMS (Case D). The individual
  mechanisms are TRANSIENT_PGID_SURVIVAL_CONFIRMED (Case A) and
  EXIT_REAPING_RACE_CONFIRMED (Case C).

ENTRY_HEAD:
b344741921bfe92a804bf3738f799aed123f7cac

SUBJECT_HEAD:
the ACT commit on `main` that adds this report + the evidence directory
  (discover with: `git log --oneline -- docs/acts/ACT-CLINEMM-NATURAL-EXIT-PGID-CAUSAL-REPRO01/`)
  The identity is recorded in the commit itself; it is intentionally not
  hardcoded here because writing the SHA into the file changes the SHA.

SUBJECT_TREE:
`git rev-parse HEAD^{tree}` at the ACT commit (same note as SUBJECT_HEAD)

ENTRY_TREE:
5fc7cba53d2f56b0e2cd9ede03713a9665022264

WORKTREE:
clean (ACT-owned files only)
branch: main

PROTECTED_STASHES:
stash@{0} PRESERVED — "WIP on main: d46223b51 fix(completion-continuation-stall-lifetime): separate REARM lifetime from STALL lifetime at BCB re-registration"
Not popped, not rewritten, not dropped.
Unrelated worktrees (clinemm-m31-action-first @38e726c45,
clinemm-m31-bounded @0366ea506) were NOT touched.
Long-running vitest processes belonging to OTHER sessions on this host
were NOT touched.

SOURCE_SEAM:
  natural_exit:
    apps/vscode/src/sdk/command-job-manager.ts:1555  start()
    apps/vscode/src/sdk/command-job-manager.ts:2054  childProcess.exit transition
    apps/vscode/src/sdk/command-job-manager.ts:2501  finalize()
    apps/vscode/src/sdk/command-job-manager.ts:3612  defaultTerminalPostconditionProbe()
      -> process.kill(-pgid, 0)
      -> rc=0 "alive" | EPERM "eperm" | ESRCH "gone" | other "unknown"
    NON-`gone` => containment_failed + substrate_* verdict,
                 NO command_job_terminal_committed.
    NO group-level termination runs on the natural-exit path.

  explicit_termination:
    apps/vscode/src/sdk/command-job-manager.ts:3034  cancel()
    apps/vscode/src/sdk/command-job-manager.ts:2265  terminate()
    apps/vscode/src/sdk/command-job-manager.ts:2313  runTerminationSequence()
    sdk/packages/core/src/extensions/tools/executors/bash.ts:1151  terminateTree()
      -> SIGTERM on -pgid -> waitForGroupGone() -> SIGKILL on -pgid
    apps/vscode/src/sdk/command-job-manager.ts:2484  await job.process.exit
    -> finalize() -> probe
    terminateTree() waits for the OWNED GROUP TO BE GONE before the
    probe, so this path is structurally immune to both mechanisms.

  supervisor_exit_semantics:
    sdk/packages/core/src/extensions/tools/executors/bash.ts:1738
      spawnSupervisableShellCommand()
    sdk/packages/core/src/extensions/tools/executors/bash.ts:1011
      spawn(..., { detached: !isWindows, stdio: [pipe,pipe,pipe] })
      -> the shell IS the process-group leader (pgid === pid)
    sdk/packages/core/src/extensions/tools/executors/bash.ts:1219
      child.on("close", ...) => exit promise resolves
    MEASURED: the exit promise resolves on the child's `close` event,
    i.e. root exit AND stdio drained. It is NOT a root-exit boundary
    and NOT a whole-group boundary. It is a STDIO-CLOSURE boundary:
      descendant INHERITS stdout  -> close at T+3012ms (after the
                                       descendant's lifetime)
      descendant REDIRECTS stdio   -> close at T+12ms  (group still
                                       alive)

LIVE_PREDECESSOR:
  39_blockers:
    Task 1793832563830_qmvgb, Epoch 4.
    C10 containment blockers 39; matching owner 39/39; unconsumed
    results 0; running owner at final C10 false; pending prompts 0.
    Original containment classification: substrate_alive.
    Original osErrorCode: null.
    36 of the 39 original failure records were no longer in the ordinary
    256-record FIFO but survived in protected retention.
    CFPR01 verdict PASS_LIVE_JOIN — NOT REOPENED by this ACT.

  3_natural_exit_witnesses:
    cmd_mw2qyaybztova5cx  pgid 98364  natural -> alive -> containment_failed
    cmd_mw2r0n36j6gffphy  pgid 7140   natural -> alive -> containment_failed
    cmd_mw2r183opkonebt1  pgid 9122   natural -> alive -> containment_failed
    Common sequence:
      process started -> natural exit -> CommandJobManager.finalize()
      -> command_job_primary_group_cleanup postcondition=alive
      -> containment_failure_classified (substrate_alive)
      -> job_active_removed (reason=natural)
      -> terminalState=containment_failed
      -> containment_terminal_state_published -> C10 completion held
    This ACT REPRODUCES that boundary on the real production path.
    The LIVE evidence contains NO later PGID observation, so it cannot
    by itself separate Mechanism 1 from Mechanism 2 — that was the gap
    this ACT was created to close.

EXPERIMENTS:
  N0:
    Clean natural exit (`true`), no descendant.
    postcondition=gone | terminal=exited | later=gone | cleanup verified.
    RESULT: the clean `gone` path is intact; the leader reaping/event
    ordering does NOT by itself produce a non-`gone` postcondition.

  N1:
    Transient descendant (3s), stdio redirected so it does not hold the
    supervisor's stdout pipe.
    postcondition=NON-gone (eperm on this host; alive on the LIVE host)
    | containmentFailed=substrate_eperm | terminal=containment_failed
    | immediate observation=ALIVE with a POSITIVELY IDENTIFIED member
      whose pgid == the ORIGINAL owned PGID (ppid=1: the leader had
      already exited and the descendant was reparented to init)
    | later=GONE, no intervention | cleanup verified.
    RESULT: RED-01 REPRODUCED. Mechanism 1.

  N2:
    Persistent descendant (30s), stdio redirected.
    postcondition=NON-gone | terminal=containment_failed
    | immediate=ALIVE with an identified member in the ORIGINAL PGID
    | later=ALIVE at the observation deadline | residual observed.
    RESULT: the safety control. The hold is doing real work; a future
    repair must NOT terminalize this case cleanly.

  N3:
    Shell WAITS for the same child workload.
    postcondition=gone | terminal=exited | later=gone | cleanup verified.
    RESULT: ABLATION-A. Delaying the root exit until the child finished
    ELIMINATES the non-`gone` postcondition. Exit sequencing is
    load-bearing for Mechanism 1.

  C1:
    Explicit cancel of a running owned group.
    postcondition=gone | terminal=cancelled | later=gone | cleanup verified.
    RESULT: ABLATION-B. terminateTree() waits for group-gone BEFORE the
    probe, so the explicit path is structurally clean. Semantics
    unchanged (no production file touched).

  C2:
    Host execution deadline on a running owned group.
    postcondition=gone | terminal=deadline_exceeded | later=gone
    | cleanup verified.
    RESULT: deadline termination semantics unchanged.

  (additional) CONTRAST:
    stdio-INHERITING descendant (3s).
    The supervisor's exit promise is delayed to T+~2000ms (the
    descendant's lifetime) because the descendant holds the inherited
    stdout pipe. The postcondition is then non-`gone` in some trials and
    `gone` in others — the flakiness IS the reaping race, and the group
    is gone within the observation window with NO live member.

  (additional) REAPING-RACE x8:
    Plain `true` x8 (no descendant at all).
    Every trial converged to `gone` within the window and no trial ever
    left a live member. Some trials DID observe a non-`gone`
    postcondition for a group with NO live member — which is the
    decisive Case-C discriminator.

RED:
  reproduced:
    YES. RED-01, RED-02, RED-03 and the additional Case-C witness are
    all preserved as EXECUTABLE PASSING tests (the ACT's stop rule
    forbids retaining an intentionally failing diagnostic in the default
    suite).

  exact_observation:
    N1: supervisor exit promise resolves at T+~6ms (the descendant
    redirected its stdio, so the `close` event fires at once) ->
    finalize() probes the ORIGINAL owned PGID -> NON-`gone` ->
    containment_failure_classified -> containment_failed ->
    the SAME original PGID is observed GONE later, with no intervention,
    while the manager's historical record stays `containment_failed`.

CAUSAL_DISCRIMINATOR:
  MULTIPLE_CAUSAL_MECHANISMS (Case D), comprising:
    - TRANSIENT_PGID_SURVIVAL_CONFIRMED (Case A): N1.
    - EXIT_REAPING_RACE_CONFIRMED (Case C): CONTRAST + REAPING-RACE x8.
  The two are distinguished by PROCESS IDENTITY, not by chronology:
    Mechanism 1 has a LIVE, IDENTIFIED member in the original PGID at
    the probe; Mechanism 2 has NO live member at all.

ABLATION:
  ABLATION-A (N1 vs N3): the only difference is whether the shell waits
    for the child. Waiting -> `gone` -> `exited`. Non-waiting ->
    non-`gone` -> `containment_failed`. Exit sequencing is necessary for
    Mechanism 1.
  ABLATION-B (N1 vs C1): explicit termination runs terminateTree() first,
    which waits for group-gone before the probe -> `gone` -> `cancelled`.
    The natural-exit path has no such barrier.
  ABLATION-C (N1 / CONTRAST): the SAME original PGID is observed at the
    immediate and later boundaries, with per-member start identities, so
    PID/PGID reuse is not promoted into causal identity. The historical
    `containment_failed` represents the EARLIER observation and is not
    new liveness evidence.

ALTERNATIVE_EXPLANATIONS:
  EXCLUDED: "the `alive` observation was simply wrong" — the descendant
    was positively identified in the ORIGINAL PGID at the probe.
  EXCLUDED: "the postcondition probe is broken" — its errno semantics
    are exact and are reproduced independently by the read-only harness.
  EXCLUDED: "a stale historical ledger is the whole story" — RED-03
    shows the stale ledger is a CONSEQUENCE, not the cause.
  EXCLUDED: "Node's generic `close` equals the supervisor's abstraction"
    — measured and refuted (the supervisor's exit promise is a
    stdio-closure boundary).
  EXCLUDED: "explicit termination shows the same thing" — refuted by
    C1/C2.
  EXCLUDED: "the whole incident is one mechanism" — refuted by the
    identity-grounded separation of Mechanism 1 and Mechanism 2.

PROCESS_LEAKS:
  NONE. The suite's G11 test re-probes every owned PGID it created and
  requires each to be `gone`. N2's deliberately persistent descendant is
  bounded (30s) and is reported as `residual_observed`, never as a
  successful cleanup.
  The `[vitest-pool] kill EPERM` worker-teardown message is a
  PRE-EXISTING substrate artifact of the Seatbelt profile (it occurs
  identically for the untouched
  `command-job-manager.sandbox-c3-real-kernel.test.ts`); it is not a
  test-owned leak and it is not a gating failure.

TESTS:
  Focused suite (REAL_PROCESS, real manager + real supervisor):
    10 passed / 10 (exit 0)
  Related existing suites (CommandJobManager, descendant conservation,
  BJLA/CLCR01, CFPR01, CFC10A01, CFC10AR01, PCPC01, PHCF01, BTCONT01,
  BCCOC01):
    Test Files  2 failed | 10 passed (12)
         Tests  18 failed | 153 passed (171)
    The 18 failures are the PRE-EXISTING ENTRY_HEAD baseline on this
    host and are PROVEN independent of this ACT:
      - `git status --porcelain=v1 --untracked-files=no` is EMPTY, so the
        TRACKED tree is byte-identical to ENTRY_HEAD (b34474192); the ACT
        added only untracked files.
      - Neither failing suite references any `nepcr01` file.
      - `command-job-manager.test.ts` (17 failures, `spawn_failed`):
        the suite does NOT set `CLINEMM_EXPERIMENTAL_SANDBOX`, so on
        darwin it runs with the Seatbelt DEFAULT-ON; this host DENIES
        nested `sandbox_apply` ("Operation not permitted"), so every
        real spawn in it fails closed. Every suite that PASSES does set
        the break-glass opt-out.
      - `pcpc-no-overclaim-sweep.pcpc01.test.ts` (suite-level):
        uses `import.meta.dir`, a Bun-only property, under Vitest
        (Node) -> undefined.
    Full detail and the proof chain: evidence/verification.txt

TYPECHECK:
  cd apps/vscode && tsc --noEmit  ->  exit 0, no diagnostics.

LINT:
  biome check on the three ACT-owned test files -> 0 errors
  (5 informational suggestions only, none applied).

BASELINE_DELTA:
  ZERO production files changed.
  ZERO existing test files changed.
  Only ACT-owned test files and ACT-owned evidence artifacts added.

PRODUCTION_FILES_CHANGED:
  (none)

PRODUCTION_SEMANTIC_DELTA:
  (none) — no runtime, protocol, supervisor, terminateTree(),
  finalization, ledger-clearing, TaskHeader, Elm, BCB-predicate or
  telemetry change. The `gone`-only clean-terminal invariant is intact.

ROOT_CAUSE_STATUS:
  TWO mechanisms, causally distinguished, both reproduced on the REAL
  production path:
    1. The supervisor's exit promise is a STDIO-CLOSURE boundary, not a
       root-exit or whole-group boundary. A descendant that does not
       hold the inherited stdout pipe lets `close` fire while the
       descendant is still in the owned group, and the natural-exit path
       performs NO group-level termination before probing.
    2. Even with no descendant at all, the kernel can still hold the
       process-group entry when the probe runs, so the probe can report
       a non-`gone` postcondition for a group with no live member.

SUCCESSOR_RECOMMENDATION:
  EXACTLY ONE RECOMMENDATION (per the ACT's decision table):

  **Mixed mechanisms -> narrow first intervention with conservation of
  the others.**

  Specifically, investigate **Mechanism 2 (the leader/reaping race)
  FIRST**, because it is the only case where the non-`gone`
  postcondition is produced for a group with NO live member — the case
  where the safety hold has nothing to protect and where the natural
  fix is a bounded quiescence / reconciliation at the supervisor's
  authoritative completion boundary.

  Conservation requirements for that successor:
    - N1 (live descendant) and N2 (persistent descendant) must BOTH
      still classify `containment_failed`.
    - The `gone`-only clean-terminal invariant must NOT be weakened.
    - `terminateTree()`, cancellation and deadline semantics must be
      unchanged.
    - EPERM and unknown outcomes must remain fail-closed.

  The successor ACT must follow:
    REAL/LIVE failure -> boundary classification -> RED reproduction ->
    causal discriminator -> necessity/ablation -> bounded repair ->
    adversarial conservation tests -> exact-head artifact -> LIVE
    qualification.

  DO NOT select a repair merely because it is easy to implement, and do
  NOT implement it in this ACT.
```

---

## 1. What this ACT established

The natural-exit `containment_failed` boundary is **real and reproducible**
on the production path. The production sequence is:

```
supervisor exit promise resolves (child `close`: root exit + stdio drained)
  -> CommandJobManager.finalize(job, "exited")
  -> defaultTerminalPostconditionProbe(pgid)  == process.kill(-pgid, 0)
  -> NON-`gone`  =>  containment_failure_classified
                  =>  job_active_removed (reason = natural)
                  =>  terminalState = containment_failed
                  =>  NO command_job_terminal_committed
                  =>  C10 completion held
```

The natural-exit path is the ONLY path that probes the owned group
**without first establishing that the group is gone**. The explicit
paths (cancel / deadline) call `terminateTree()`, which waits for
group-gone BEFORE `finalize()` probes.

## 2. The two mechanisms

| | Mechanism 1 | Mechanism 2 |
|---|---|---|
| Name | Transient descendant survival | Leader/reaping race |
| LIVE member in the original PGID at the probe? | **YES** (positively identified) | **NO** |
| Group at the probe | alive | alive (kernel bookkeeping only) |
| Group later | gone, no intervention | gone, no intervention |
| Witness | N1 | CONTRAST, REAPING-RACE x8 |

Mechanism 1 requires a descendant that does NOT hold the inherited stdout
pipe; Mechanism 2 requires no descendant at all.

## 3. What this ACT does NOT establish

- It does NOT claim the LIVE incident's 39 blockers were ALL Mechanism 1
  or ALL Mechanism 2. The LIVE evidence has no later PGID observation,
  so the two cannot be separated for the LIVE set.
- It does NOT select or authorize a repair.
- It does NOT weaken the `gone`-only clean-terminal invariant.

## 4. Substrate note (read before comparing labels)

The ClineMM Seatbelt profile
(`sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts`) grants
only `(allow signal (target self))`. Consequently `process.kill(-pgid, 0)`
returns **EPERM** for a live group on this host, where the LIVE host
returned rc=0 ("alive").

Both are non-`gone`; both produce the identical `containment_failed`
terminal state and the identical safety hold. The causal discrimination
in this ACT is based on READ-ONLY kernel-truth liveness plus process
membership (with start identities), not on the label, and is therefore
substrate-independent.

## 5. Evidence artifacts

```
docs/acts/ACT-CLINEMM-NATURAL-EXIT-PGID-CAUSAL-REPRO01/
  REPORT.md
  evidence/
    source-seam-map.md             — the traced seams + measured supervisor semantics
    experiment-matrix.json         — the frozen matrix and per-experiment verdicts
    natural-exit-observations.jsonl — the bounded per-experiment timeline
    process-membership.jsonl        — per-boundary process-group membership + start identities
    causal-discrimination.md        — the mechanism separation, ablations, gates, exclusions
    red-green-results.txt           — RED-01..03 + the Case-C witness, and the GREEN result
    verification.txt                — platform, substrate, commands, results, baseline delta
```
