# ACT-CLINEMM-NATURAL-EXIT-PGID-CAUSAL-REPRO01-CORRECTION01

**Verdict:** `PASS_EVIDENCE_CORRECTION`
**Scope:** experiment-contract correction ONLY. **No production repair. No VSIX.
No production file changed. No production semantic changed.**
**Predecessor:** `ACT-CLINEMM-NATURAL-EXIT-PGID-CAUSAL-REPRO01` (`PASS_CAUSAL_REPRO`, unchanged)

---

## The review that prompted this

The 2026-11-05 review (`HALT_CAUSAL_EVIDENCE_OVERCLAIM`) accepted the causal
reproduction but raised two P0 **evidence-contract** defects. Both concerned
what the *committed experiment contract* was entitled to claim, not whether the
causal mechanism was real:

| # | Defect | Review's finding |
|---|--------|------------------|
| P0-1 | Cancellation and deadline controls do not prove successful termination | C1 completed in 30,020 ms and C2 in 30,015 ms for a `sleep 30` workload cancelled at 400 ms / deadlined at 1,200 ms. Both ended at the workload's natural end. The suite treated the eventual `gone` postcondition as proof that `terminateTree()` terminated the group. The captured events cannot distinguish "the sandbox denied the signal" from "the root died while another process held stdio". |
| P0-2 | The reaping-race regression can pass without observing the race | The eight-trial test asserted only `laterLiveness === "gone"` and `cleanupOutcome === "verified_absent"`. All eight trials could return `gone` immediately and the test would still pass. The separately reported 2/5 `EPERM → ESRCH` measurement was not preserved in the committed six-experiment JSONL artifact. |

The instruction was explicit: **fix only the experiment contract**; do not
reopen the causal conclusion, do not modify production code, do not start
another general review; preserve the already-valid N1/N2 evidence; and run
focused typecheck/test gates.

---

## P0-1 — Termination efficacy is now measured, and the substrate cannot prove it

### What the suite now captures

`runExperiment` records three NEW facts that the original contract never
captured:

1. **`terminationRequestedAtMs`** — when the host requested the termination.
   For the cancel path this is the test-side `manager.cancel()` call; for the
   deadline path it is read from the manager's OWN
   `command_job_termination_started` lifecycle event, so it is the production's
   own account of when the deadline fired.
2. **`groupGoneAtMs` / `terminationToGoneMs`** — when the owned group was first
   observed `gone`, and the elapsed time from the request to that
   disappearance. This is the ONLY quantity that can separate "the supervisor
   terminated the group" from "the workload finished on its own".
3. **`supervisorTerminationProbe`** — the PRODUCTION supervisor's own
   termination verdict, read from the `command_job_primary_group_probe`
   lifecycle event. That event's `probeResult` is derived from the
   supervisor's `TerminateTreeResult.treeTerminated`, so it is the production
   authority on whether the termination worked — not a test-side inference.

The suite additionally measures the **substrate's signal capability** with a
read-only probe (`observeSignalCapability()`) that attempts a real signal
against a real, privately-owned process group.

### The substrate fact (measured, not assumed)

The ClineMM Seatbelt profile grants only `(allow signal (target self))`. A
direct probe on this host:

```
group probe (0):                    EPERM
group SIGTERM:                      EPERM
group probe after SIGTERM (0):      EPERM
direct child SIGKILL:               EPERM      <-- even the DIRECT child
group probe after child SIGKILL:    EPERM
signal self (0):                    rc=0
signal own pgroup (0):              rc=0
```

**No termination signal can be delivered to another process on this host** —
not even to the direct child. Signalling *self* succeeds.

### What the corrected contract asserts

The controls are now substrate-aware:

- **On a `signal_capable` substrate** — assert **EFFECTIVE TERMINATION**: the
  supervisor's own verdict must be `gone` and the group must disappear within
  `*_EFFECTIVE_TERMINATION_BOUND_MS` (15,000 ms) of the request, far below the
  workload's 30,000 ms lifetime.
- **Otherwise** — assert only the weaker facts that are actually provable (the
  terminal label, the eventual absence of the group) and report
  **`CAPTURE_INSUFFICIENT_SUBSTRATE`**. The control MUST NOT claim successful
  termination, and the supervisor's verdict is asserted to be **not** `gone`.

### The measurement that closed it

The request-relative offset matters: a group that survives to the workload's
natural end disappears at `workload_lifetime - request_offset` after the
request, which is SHORTER than the workload's absolute lifetime.

| Control | Request | Measured `terminationToGoneMs` | Natural-end prediction | Supervisor verdict | Verdict |
|---------|---------|-------------------------------|------------------------|--------------------|---------|
| C1 (cancel) | +400 ms | **29,432 ms** | 30,000 − 400 = 29,600 ms | `eperm` | `unproven` |
| C2 (deadline) | +1,200 ms | **28,841 ms** | 30,000 − 1,200 = 28,800 ms | `eperm` | `unproven` |

Both land on the natural-end prediction to within 168 ms and 41 ms
respectively, and the PRODUCTION supervisor reported `eperm` — i.e. the
supervisor itself recorded that it could not terminate the group. The
`termination_efficacy` field in `evidence/experiment-matrix.json` now reads
`"unproven"` for both controls instead of silently implying a clean
termination.

**The corrected control therefore proves a DIFFERENT (and weaker, but TRUE)
thing:** on this substrate the cancel and deadline paths classify the job
cleanly and the owned group is eventually absent — but the suite does **not**
claim that `terminateTree()` terminated it, because it demonstrably did not.

### A note on deadline enforcement in this substrate

The review also asked about effective deadline enforcement. The measurement
answers it: the deadline path's `deadline_exceeded` terminal state was
published **immediately** at the 1,200 ms deadline (the manager's own
`command_job_termination_started` event timestamp), while the group itself
persisted to the workload's natural end. The deadline was enforced as a
*terminal classification*; it could not be enforced as a *termination*, because
the substrate refuses the signal.

---

## P0-2 — The reaping-race witness is now non-vacuous

### What was wrong

The original eight-trial test asserted only that every trial converged to
`gone` with no live member. All eight trials could return `gone` immediately
and the test would pass — so the suite never actually witnessed the mechanism
it claimed to guard.

**The committed evidence proves the vacuity.** The corrected default run's
per-trial ledger (`evidence/reaping-race-witness.json`) records the OBSERVED
production postcondition of each of the 8 default trials:

```
witness_count: 0   trial_count: 8
  post=gone errno=ESRCH live=0 later=gone race_observed=False   (×8)
```

**Zero** of the eight trials observed the race. The original test would have
passed identically — and would have claimed to guard a mechanism it never
witnessed.

### Where the race actually lives (measured)

The mechanism is the gap between the supervisor's exit boundary and the
kernel's group teardown. Measured on this host (40 trials, 1 ms sampling after
the supervisor's exit promise resolves):

```
FIRST-GONE DELAYS(ms): 3,5,5,5,4,7,7,5,4,6,5,7,6,5,5,6,5,6,6,5,6,6,6,5,7,6,5,5,5,5,5,6,7,5,5,5,5,4,5
SAMPLED: {"eperm":215,"gone":7785}
```

The group is reaped **3–7 ms** after the supervisor's exit promise resolves.
Probing at that exact boundary yields `EPERM` (the group still exists) in
**79/80** trials; the production `CommandJobManager`'s own probe lands a few
milliseconds later — after the teardown — and therefore observes `gone` in
60/60 manager-path trials.

**This is the precise reason the original test was vacuous:** the manager's
await gap (spawn → helper registration → lifecycle emission) closes the ~5 ms
window. The race is real; the original assertion simply could not see it.

### The corrected contract

Two parts, with the probabilistic requirement deliberately quarantined:

1. **Default suite (deterministic).** The conditional invariant is now stated
   explicitly rather than left implicit: a trial that observed a non-`gone`
   production postcondition MUST have had no live member at that boundary
   (which is what makes it a reap artifact rather than a surviving descendant)
   AND MUST have converged to `gone` within the bounded window. The per-trial
   ledger is written to the evidence artifact so a reader can see whether the
   race was observed.

2. **Opt-in bounded reproduction (`CLINEMM_NEPCR01_REAPING_WITNESS=1`).**
   This REQUIRES an actual witness: at least one trial whose production
   postcondition at the production exit boundary is NOT `gone`, with CONFIRMED
   ABSENCE of surviving live members, and whose group then disappears without
   intervention. It runs at most `REAPING_WITNESS_MAX_TRIALS` (40) trials and
   FAILS if no witness was observed — a **bounded failure, never a hang**. The
   requirement is NOT in the default suite, so the default suite stays
   non-flaky.

   The witness is taken at the **supervisor's exit boundary** — the production
   completion boundary the `CommandJobManager` itself consumes — using the
   REAL production supervisor (`spawnSupervisableShellCommand`), the REAL
   production spawn shape and the REAL production exit promise. No process
   supervision is simulated and no execution seam is replaced; only the
   READ-ONLY probe is moved to the boundary it characterises. (The manager's
   own probe cannot witness the race on this substrate because its await gap
   closes the window — that is a fact about the observation point, not about
   the mechanism.)

### The preserved passing witness

```
CLINEMM_NEPCR01_REAPING_WITNESS=1 bun x vitest run \
  src/sdk/__tests__/natural-exit-pgid-causal-repro01.nepcr01.test.ts

✓ REAPING-RACE WITNESS: a real non-gone -> gone witness is observed with no surviving live member
```

`evidence/reaping-race-witness.json` (40 trials, 4 witnesses):

| Field | Value |
|-------|-------|
| `boundaryPostcondition` | `alive` (the group still existed at the exit boundary) |
| `boundaryOsErrorCode` | `EPERM` (the kernel still held the process-group entry) |
| `liveMemberCountAtBoundary` | **`0`** (confirmed absence of surviving live members) |
| `laterLiveness` | `gone` (the group disappeared on its own) |
| `cleanupOutcome` | `verified_absent` |
| `race_observed` | `true` on 40/40 trials |

This is the non-vacuous witness the original contract required.

---

## What was NOT changed

- **No production file changed.** `command-job-manager.ts`, `bash.ts` (the
  supervisor), the Seatbelt backend/profile, the helper and every other
  production source are byte-identical to the predecessor.
- **No production semantic changed.** The `gone`-only clean-terminal invariant
  is untouched. The `containment_failed` classification, the historical ledger
  behaviour (RED-03) and the safety hold (N2) are untouched.
- **N1 and N2 evidence preserved.** The transient-descendant reproduction and
  the persistent-descendant safety control are unchanged and still pass.
- **No VSIX built, no install, no push, no branch created.**
- **The protected stash `stash@{0}` is intact** and was never popped, staged or
  rewritten. All three worktrees are untouched.

## Verification

See `evidence/verification-correction01.txt` for the full record.

| Gate | Result |
|------|--------|
| `tsc --noEmit` (apps/vscode) | **EXIT 0** |
| Focused suite, default | **11/11 PASS** (the opt-in witness test is skipped) |
| Focused suite, opt-in witness | **PASS** with 4 observed witnesses |
| `biome` lint on the touched test files | **0 errors** |
| Production files changed | **0** |
