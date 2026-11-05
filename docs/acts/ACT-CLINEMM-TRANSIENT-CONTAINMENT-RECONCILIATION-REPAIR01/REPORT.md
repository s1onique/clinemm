# ACT-CLINEMM-TRANSIENT-CONTAINMENT-RECONCILIATION-REPAIR01 — Report

**Short name:** TCRR01
**ENTRY_HEAD:** `d03d475e1f4ab064ea123eb464b59a4f2b112176`
**ENTRY_TREE:** `bc16cc846080e7bc98221a6020822ac7d746acb8`
**SUBJECT_HEAD:** `03f2e8d00ecf521c1691dd6e7f3a961d51971884`
**SUBJECT_TREE:** `67252a539e78d68d27667de041cf7c3cc0e4cba3`

---

## 1. Problem

A `run_commands` background job can finish with a **transient** descendant still
alive in its owned process group at the moment the supervisor's shell exits
naturally. The `CommandJobManager`'s synchronous finalization gate correctly
refuses to certify a clean terminal, so the job is classified
`containment_failed` — and that classification is **stuck forever**, even
after the transient descendant exits and the ORIGINAL owned PGID is provably
`gone`.

The stuck `containment_failed` projection keeps the shared, owner-scoped
containment classifier (`unresolvedContainmentFailuresForOwner()`) reporting
an unresolved obligation, so the deferred C10 completion barrier holds the
completion forever. The job was in fact cleanly over; only the **observation**
was stale.

The defect is an **observation** defect, not a classification defect: the
manager classified correctly at the moment it looked, and never looked again.

## 2. Repair

A bounded, manager-origin reconciliation that re-probes the **ORIGINAL owned
PGID** on a fixed schedule and reconciles the canonical state **only** after a
fresh authoritative `gone` observation.

### 2.1 Production changes

**`apps/vscode/src/sdk/command-job-manager.ts`** — the command authority.

- New internal lifecycle event `command_job_containment_reconciled`.
- New private `PendingContainmentReconciliation` record retaining the original
  job id, **original PGID**, launch-time owner, the **original intended
  terminal class** and the **original failure classification**.
- Bounded re-probing schedule: defaults **20 attempts × 250 ms**, a **5 s**
  observation horizon, and a hard cap of **64** simultaneously pending jobs.
  Every bound is a hard stop; on exhaustion the obligation simply remains
  unresolved (fail-closed).
- Reconciliation is registered **only** when: the schedule is enabled; the
  PGID is positively identified (never `pgid_unset`); the original failure
  class is a substrate class; and the original intended terminal class is
  restorable (`exited` / `cancelled` / `deadline_exceeded` — never
  `spawn_failed`).
- The reconciliation re-uses the **existing** `terminalPostconditionProbe`
  seam. Only a fresh `gone` verdict authorizes it. `alive`, `eperm`,
  `unknown`, a missing PGID, budget exhaustion and manager disposal all leave
  the obligation unresolved.
- `dispose()` explicitly cancels every reconciliation timer and clears the
  pending map — no timer and no later mutation survives disposal.

**`apps/vscode/src/sdk/SdkController.ts`** — the publication path.

- The reconciliation lifecycle event is published through the **existing**
  per-job projection path `updateBackgroundCommandState()`, preserving the
  launch-time owner identity and invoking the existing C10 re-evaluation
  (`maybeReevaluateDeferredContinuation` → `reevaluateDeferredCompletionBarrier`).
- A causal-ordering marker set refuses a **delayed, stale**
  `containment_failed` publication for a job that has already been reconciled,
  so an older fact can never overwrite a newer authoritative one. The marker is
  dropped only when the job id is reused for a fresh start.

### 2.2 What the repair deliberately does NOT do

- It does **not** change `unresolvedContainmentFailuresForOwner()` — the
  shared classifier remains the single authority.
- It does **not** add a second job-state map, a second classifier, a
  completion coordinator, or a public protocol / wire field.
- It does **not** re-resolve the terminal-transition promise, re-fire
  `command_job_terminal_committed`, re-enter `reportRuntimeError`, or touch
  the active-job cardinality.
- It does **not** erase the historical `command_job_containment_failed`
  event or its `substrate_alive` classification.
- It does **not** broaden the invariant. It proves the disappearance of the
  **primary owned process group** and nothing more.

**Conservation invariant (unchanged):**
`CLEAN_TERMINAL ⇒ authoritative owned primary PGID gone`

## 3. Evidence

| Artifact | Content |
|---|---|
| `evidence/production-seam-map.md` | Structural map of the frozen `finalize()` gate, the seven recon answers, the chosen implementation shape and the anti-goals. |
| `evidence/red-reproduction.txt` | REAL_PROCESS RED at ENTRY_HEAD: the transient group becomes `gone` but the obligation stays stuck; GREEN G1 fails at ENTRY_HEAD while the N2 safety control passes. |
| `evidence/reconciliation-timeline.jsonl` | 12 machine-readable per-case records (REAL_PROCESS + SYNTHETIC_REAL) of the reconciliation decision and the C10 outcome. |
| `evidence/ablation-results.txt` | Two causal discriminators + three single-link ablations proving every link in the chain is necessary. |
| `evidence/adversarial-results.txt` | The adversarial safety matrix (G4–G18) plus the REAL_PROCESS N2 persistent-descendant control and the non-release factor list. |
| `evidence/verification.txt` | The full command-by-command verification log. |
| `evidence/artifact-identity.json` | Machine-readable identity of every ACT-owned artifact and the reconciliation defaults. |

## 4. P1 collateral repair

`apps/vscode/src/sdk/__tests__/natural-exit-pgid-causal-repro01.nepcr01.test.ts`
teardown previously called `writeReapingRaceWitnessArtifact([], [])` on **every**
suite invocation, overwriting a genuinely captured opt-in reaping-race witness
with an empty artifact. The default run now leaves that artifact untouched;
the opt-in capture owns it. NEPCR01 remains 11/11 green and the witness
SHA-256 is unchanged after a default run.

## 5. Scope

Production changes are confined to two files in `apps/vscode/src/sdk/`.
No protocol, proto, webview, storage, or public-surface change. The shared
containment classifier, the C10/Q5/commit-boundary guards, and the Elm
completion authority are untouched.

## 6. Verification

See `evidence/verification.txt` for the full log.

## 7. Known limitations

- The broad Vitest sweep cannot complete on this substrate: the Seatbelt
  profile denies signals to other processes, so Vitest's worker teardown
  reports `kill EPERM` and the runner aborts before writing a report. The
  ACT-scoped **per-file** sweep is used instead, and it is run against BOTH
  the ENTRY_HEAD baseline and the subject head so the per-test-id delta is
  exact.
- `command-job-manager.test.ts` has 18 Seatbelt-related failures that are
  **identical at ENTRY_HEAD**; they are not caused by this ACT.
- A **GUI-driven** LIVE qualification is not possible on this substrate:
  every VS Code GUI process is killed with `SIGSEGV` by the Seatbelt
  profile. This is demonstrated for the branded VS Code, for the
  harness-downloaded VS Code, AND for the project's own sanctioned debug
  harness, so it is a substrate limitation rather than an ACT defect.
  The LIVE-equivalent qualification was therefore performed against the
  **packaged, installed** artifact itself (the `CommandJobManager` class
  that ships inside the installed VSIX, driven with real child processes
  against the real kernel probe): see `evidence/verification.txt` §9c.
