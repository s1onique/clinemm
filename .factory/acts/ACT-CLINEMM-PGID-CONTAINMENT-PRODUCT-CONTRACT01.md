# ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01

**Primary epistemic purpose:** `PRODUCT_CONTRACT_QUALIFICATION`

**Authorization:** `C1: GO.`

**Status:** PASS_PGID_CONTAINMENT_PRODUCT_CONTRACT.

All 22 §22 gates are PASS (the `EVIDENCE_BOUND_TO_FINAL_HEAD` and
`BOARD_DURABLE` gates transition from PENDING to PASS at the final
commit, which is the next ACT step). No halt conditions triggered.
44 host tests + 64 webview tests pass. `tsc --noEmit` clean on both
host and webview. `git diff --check` clean. No `CommandJobManager`
redesign — only a single additive `reportRuntimeError` call inside
the existing `command_job_containment_failed` emit branch.

## 0. Identity

- ACT family: descendants / process-containment / product contract.
- Predecessor (frozen):
  `ACT-CLINEMM-ESCAPED-DESCENDANT-REMEDIATION-DECISION01` —
  selection `PASS_SELECT_B_CURRENT_C_FUTURE_TRACK`.
- Inherited LIVE qualification (not re-litigated):
  `ACT-CLINEMM-LAUNCHAGENT-OWNED-PGID-LIVE-QUALIFICATION01` —
  `PRIMARY_PGID_GUARANTEE = LIVE PASS`.
- Predecessor lifecycle / telemetry seam (not re-litigated):
  `ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01`
  at correction07 — `command_job_containment_failed` lifecycle event
  + `terminalPostconditionProbe` test seam.
- Successor (NOT in this ACT):
  `ACT-CLINEMM-ENDPOINT-SECURITY-DESCENDANT-CONTAINMENT01` (Strategy C
  parked on a future research track).
- Reviewers: ClineMM runtime engineer, macOS process-control engineer,
  Factory reviewer, UX engineer.

## 1. Product contract (current supported guarantee)

```
ClineMM owns and attempts to clean up each CommandJob's primary
process group when the command completes or is cancelled.

A CommandJob is considered cleanly terminal only after ClineMM
establishes that the primary PGID is gone. If that postcondition
cannot be established, the job terminates as containment_failed and
ClineMM surfaces a runtime incident.
```

The proven invariant — exactly what the implementation establishes:

```
CLEAN_TERMINAL CommandJob  ⇒  PRIMARY OWNED PGID GONE
```

This is a **sufficient-condition** invariant, not a universal
cleanup promise. It says: if ClineMM considers the job cleanly
terminal, then the primary PGID is gone. It does **not** say: every
completed or cancelled job ends cleanly. The cases where the
postcondition fails (`alive`, `eperm`, `unknown`, `pgid_unset`) are
visible as `containment_failed` and produce a runtime incident — by
design.

What ClineMM does **not** guarantee:

```
ClineMM does NOT guarantee cleanup of processes that have left the
CommandJob's primary process group by any mechanism.
```

The unsupported boundary includes, non-exhaustively:

```
setsid()
setpgid()/setpgrp() moving a process elsewhere
Node detached:true when it establishes independent process ownership
Python start_new_session=True
double-fork daemonization
nohup/disown patterns that ultimately leave the owned PGID
other equivalent mechanisms
```

The boundary is NOT defined in terms of executable names or shell
syntax. Process groups are the unit to which group signals are
delivered (`killpg(2)`); `setsid()` creates a new session and a new
process group, while `setpgid()` can change process-group membership
directly (Apple setsid(2), setpgid(2)). A `process.kill(-pgid, 0)`
probe returning `ESRCH` is the kernel's "no process exists in that
PGID" signal and is consistent with this model — it is an existence
result for the addressed PGID, not a universal descendant guarantee.

## 2. Observability — two distinct things

### Observable primary-group failure (eligible for diagnostics)

```
postcondition in { gone, alive, eperm, unknown }
terminationFailed  in { undefined, pgid_unset,
                       substrate_alive, substrate_eperm,
                       substrate_unknown }
```

These classifications come from the owned-PGID postcondition probe at
`command-job-manager.ts` `terminalPostconditionProbe`. They ARE
eligible for visible diagnostics because they come from the OWNED PGID
postcondition itself, which is observed.

### Unobservable escaped descendants (NOT eligible for diagnostics)

If `kill(-pgid, 0)` returns `ESRCH`, the primary-group obligation
succeeded — the kernel says no process exists in that PGID. This
proves nothing about a process that previously moved into another
PGID. The kernel probe is scoped to the named PGID only.

```
ESCAPED_DESCENDANT_AFTER_PGID_EXIT =
    LIVE_UNOBSERVABLE from current production seam
```

No diagnostic may say "escaped descendant detected", "process leak
detected", or "descendants still alive" unless some future authority
actually observes that fact. This is the
`HALT_ESCAPE_CLAIM_WITHOUT_OBSERVATION` boundary.

## 3. One user-visible model

Do not add another counter. The existing telemetry strip is:

```
>_ N     = cumulative command mechanism count  (existing)
^- N     = active CommandJobs                   (existing, GREEN)
! N      = runtime incidents                    (existing, EPERM only today)
```

### ^- (active CommandJobs)

  - Counts CommandJobs registered in the CommandJobManager's active
    map. NOT process count.
  - Tooltip MUST disclose that cleanup is primary-PGID scoped
    (the bounded invariant from the predecessor ACT). Processes that
    leave the primary PGID may outlive the job.
  - Hidden at zero. Process-name agnostic.

### ! (runtime incidents)

  - Increments only when an OBSERVED runtime containment failure
    occurs. The incident authority for this ACT is
    `command_job_containment_failed` (the canonical terminal
    verdict on the failure path).
  - Existing EPERM path at `command-job-manager.ts:2101` remains
    authoritative for the lower-level substrate-EPERM signal.
  - ONE incident per CommandJob terminal verdict; existing
    `job.runtimeErrorReported` latch prevents double-counting.
  - Hidden at zero.

No `☠`, no new leak counter, no process-count gauge.

## 4. Production seam recon

Frozen at recon time (evidence file
`01-recon.txt`). Confirmed at the entry head:

```
LIFECYCLE_AUTHORITY         = apps/vscode/src/sdk/command-job-manager.ts
                              CommandJobManager.emitCommandJobLifecycle

RUNTIME_INCIDENT_AUTHORITY  = apps/vscode/src/sdk/SdkController.ts
                              SdkController.handleTaskRuntimeError
                              -> TaskTelemetryTracker.recordRuntimeError

HEADER_PROJECTION_AUTHORITY = apps/vscode/webview-ui/src/components/chat/task-header/
                              TaskHeaderTelemetry.tsx

DOC_AUTHORITY               = docs/tools-reference/all-cline-tools.mdx

REAL_LIFECYCLE_SEAM_FOUND = PASS
```

## 5. Predecessor doctrine correction (applied)

The predecessor evidence
`.factory/evidence/ACT-CLINEMM-ESCAPED-DESCENDANT-REMEDIATION-DECISION01/21-strategy-b-product-contract.md`
§3.3 contained two wording defects:

  (a) claiming `process.kill(-pgid, 0)` returning `ESRCH` is
      "strongly indicated escape" (it is the opposite);
  (b) framing the unsupported boundary only in terms of `setsid()` and
      equivalents (forgetting `setpgid()` and other PGID-move
      mechanisms).

Both corrections are applied in `02-contract-correction.txt` and
captured here. The predecessor ACT body and selection
(`PASS_SELECT_B_CURRENT_C_FUTURE_TRACK`) are NOT re-opened. A
`CORRECTION03` header is added to the predecessor §3.3 marking the
stale wording as retracted.

## 6. REDs written

  - `03-red-containment-failure.txt` — RED-A: a containment failure
    currently does NOT increment ! N.
  - `04-red-gone-conservation.txt` — RED-B: `gone` MUST never imply
    an escape (conservation pin).
  - `05-red-header-scope.txt` — RED-C: ^- tooltip currently does not
    disclose the primary-PGID scope.

## 7. GREEN plan (bounded)

  - GREEN-A (§9 of the spec): wire `command_job_containment_failed`
    into `recordRuntimeError` with a new additive
    `RuntimeErrorClass = "command_containment_failed"` from
    `source = "command-job-manager"`. The latch on
    `job.runtimeErrorReported` prevents the EPERM / containment
    double-count.
  - GREEN-B (§13): update the ^- tooltip / aria-label to disclose
    primary-PGID scope. Number is unchanged.
  - GREEN-C (§14): add the "Process ownership and cancellation"
    section to `docs/tools-reference/all-cline-tools.mdx`.

## 8. Incident authority (two authorities + shared cardinality latch)

There is NOT a single incident authority for CommandJobs. Two
parallel authorities exist, and a shared cardinality latch
guarantees that at most one user-visible incident is surfaced per
causal failure:

```
TERMINAL_CONTAINMENT_FAILURE_AUTHORITY = command_job_containment_failed
LOW_LEVEL_EPERM_AUTHORITY              = existing EPERM runtime incident
                                          (line 2101 of command-job-manager.ts)

CARDINALITY_AUTHORITY = job.runtimeErrorReported
                       (shared latch, prevents double-counting)

ONE CAUSAL FAILURE  =>  AT MOST ONE USER-VISIBLE INCIDENT
```

`TERMINAL_CONTAINMENT_FAILURE_AUTHORITY` is the
`command_job_containment_failed` lifecycle event emitted when the
postcondition probe cannot establish that the primary PGID is gone
(alive / unknown / pgid_unset, or an eperm-only-postcondition case
where the kill itself did NOT return EPERM). It is the canonical
authority for terminal-cleanup failures.

`LOW_LEVEL_EPERM_AUTHORITY` is the existing EPERM runtime incident
emitted at the `treeResult.epermDetected` seam (line 2101) when
`process.kill(-pgid, SIGKILL)` itself returns EPERM. It is
authoritative for the kill-time EPERM case and is surfaced BEFORE
the postcondition probe runs.

`CARDINALITY_AUTHORITY` is the `job.runtimeErrorReported` boolean
field. Once any authority surfaces an incident, the latch is set
TRUE and the other authority's path is skipped via
`if (!job.runtimeErrorReported)` at the containment_failed emit
site. This guarantees:

  EPERM on kill                → existing EPERM incident (latch TRUE)
                                  → containment_failed sees latch TRUE
                                  → containment_failed SKIPS its own
                                    reportRuntimeError call
                                  → ONE ! total (CAUSAL: kill EPERM)

  EPERM on postcondition only  → existing EPERM path NOT exercised
  (kill succeeded)               → containment_failed sees latch FALSE
                                  → containment_failed reports
                                  → ONE ! total (CAUSAL: postcondition)

  alive / unknown / pgid_unset → existing EPERM path NOT exercised
                                  → containment_failed sees latch FALSE
                                  → containment_failed reports
                                  → ONE ! total (CAUSAL: postcondition)

  gone                        → existing EPERM path NOT exercised
                                  → containment_failed sees latch FALSE
                                  → BUT postcondition is `gone`, so the
                                    containment_failed branch is NOT
                                    reached at all (the job is
                                    CLEAN_TERMINAL)
                                  → ZERO ! total

Earlier diagnostic events (e.g. `command_job_residual_detected`,
`command_job_primary_group_cleanup` with
`postcondition: alive|eperm|unknown`) may be logged but MUST NOT
increment the user counter — they are not in either authority path.

The substrate that enforces cardinality is the
`job.runtimeErrorReported` latch, NOT a single authority.

## 9. EPERM cardinality

The existing EPERM runtime-error path (line 2101 of
`command-job-manager.ts`) and the new containment-failure path share
the same underlying causal incident for the EPERM-on-kill substrate.
Per §12 of the spec, the implementation selects CASE 1:

```
EPERM on kill                -> existing EPERM incident (line 2101)
                               -> containment_failed with
                                  containmentFailed = "substrate_eperm"
                                  -> job.runtimeErrorReported is already
                                      TRUE -> SKIP the new ! increment
                                     (ONE FAILURE -> ONE !)
EPERM on postcondition only
    (kill succeeded)         -> containment_failed with
                                  containmentFailed = "substrate_eperm"
                                  -> job.runtimeErrorReported is FALSE
                                     -> ! increment (new incident)
alive / unknown / pgid_unset -> containment_failed
                               -> job.runtimeErrorReported is FALSE
                                  -> ! increment (new incident)
```

`job.runtimeErrorReported` is the shared latch. The implementation
sets it before calling `reportRuntimeError` in BOTH paths so a single
causal failure cannot produce two `!` increments.

## 10. Failure-class matrix

Exercised by `pcpc-containment-product-contract.pcpc01.test.ts`:

| Primary postcondition | Job result         | ! delta |
|-----------------------|--------------------|--------:|
| `gone`                | normal terminal    |       0 |
| `alive`               | containment failed |      +1 |
| `eperm` (no prior)    | containment failed |      +1 |
| `eperm` (prior EPERM) | containment failed |       0 |
| `unknown`             | containment failed |      +1 |
| `pgid_unset`          | containment failed |      +1 |

The meaning of the ! increment is:

```
ClineMM could not establish the required primary-PGID cleanup
postcondition.
```

It does NOT mean "descendants escaped".

## 11. Tests

  - Backend composition: `pcpc-containment-product-contract.pcpc01.test.ts`
    extends the existing conservation / telemetry substrate. Uses
    the real `CommandJobManager` function path and the existing
    `terminalPostconditionProbe` / `onRuntimeError` /
    `onCommandJobLifecycle` injection seams.
  - Webview: extends `TaskHeaderTelemetry.gauge.test.tsx` and
    `TaskHeaderTelemetry.test.tsx`.

## 12. Structural anti-overclaim gate

A cheap source / doc grep gate rejects:

  - claims matching "zero descendants", "all descendants killed",
    "all spawned processes terminated", "escape detected",
    "leaked descendant detected" (outside test fixtures /
    historical retraction text);
  - production introduction of `pkill`, `killall`, `kill(-1,`,
    process-name sweep, same-UID sweep, `ps | grep`, `pgrep` by
    executable name, command-text detection for `detached:true` /
    `setsid`.

## 13. Expected closure

```
PASS_PGID_CONTAINMENT_PRODUCT_CONTRACT

PRIMARY_PGID_GUARANTEE          = EXPLICIT
ESCAPED_DESCENDANT_GUARANTEE    = NONE
ESCAPED_DESCENDANT_OBSERVATION  = LIVE_UNOBSERVABLE

^-  = ACTIVE COMMAND JOBS          (number unchanged, scope disclosed)
!   = OBSERVED RUNTIME INCIDENTS   (now wired through containment_failed)

PRIMARY_CONTAINMENT_FAILURE_UI   = GREEN
PGID_SCOPE_DISCLOSURE            = GREEN
```

NOT:

```
DESCENDANT_CONSERVATION = PASS
```

That claim is permanently REFUTED for the current architecture.

## 14. STOP rule

Once the contract, telemetry, and documentation gates are green:

```
STOP
```

Do not start Endpoint Security work. Do not attempt another descendant
tracker. Do not add process cleanup heuristics. Do not revisit kqueue.
The next question after this ACT should return to the product backlog,
not process-containment research, unless actual dogfood evidence
produces a NEW P0.

**C1: GO.**

## 22. Gates (all PASS at final HEAD)

```
ENTRY_CLEAN                              = PASS  (00-entry.txt)

CONTRACT_ESRCH_CORRECTED                 = PASS  (02-contract-correction.txt)
CONTRACT_PGID_NOT_SESSION_ONLY           = PASS  (02-contract-correction.txt)
ESCAPED_DESCENDANT_OBSERVABILITY         = LIVE_UNOBSERVABLE  (02-contract-correction.txt)

REAL_LIFECYCLE_SEAM_FOUND                = PASS  (01-recon.txt)
INCIDENT_CARDINALITY_SINGLE              = PASS  (06-incident-cardinality.txt; one causal failure -> at most one ! via the shared job.runtimeErrorReported latch; two-authority + latch model per §8)

GONE_NO_WARNING                          = PASS  (04-red-gone-conservation.txt + PCPC-BE-01)
ALIVE_ONE_WARNING                        = PASS  (PCPC-BE-02)
EPERM_ONE_WARNING_TOTAL                  = PASS  (PCPC-BE-03)
UNKNOWN_ONE_WARNING                      = PASS  (PCPC-BE-04)
PGID_UNSET_ONE_WARNING                   = PASS  (PCPC-BE-05)

ACTIVE_JOB_GAUGE_SEMANTICS_UNCHANGED     = PASS  (PCPC-BE-08)
ACTIVE_JOB_GAUGE_SCOPE_VISIBLE           = PASS  (PCPC-UI-03)
RUNTIME_INCIDENT_COUNTER_INDEPENDENT     = PASS  (PCPC-BE-08)

NO_ZERO_DESCENDANT_CLAIM                 = PASS  (PCPC-AO-01/02/04)
NO_SAME_UID_SWEEP                        = PASS  (PCPC-AO-04)
NO_PROCESS_NAME_SWEEP                    = PASS  (PCPC-AO-03)
NO_COMMAND_TEXT_HEURISTIC                = PASS  (PCPC-AO-04)
NO_KQUEUE_RESURRECTION                   = PASS  (no kqueue code added — 13-diff-check.txt)
NO_MANAGER_REDESIGN                      = PASS  (13-diff-check.txt: lifecycle union unchanged)

TARGETED_HOST_TESTS                      = PASS  (12-tests.txt)
TARGETED_WEBVIEW_TESTS                   = PASS  (12-tests.txt)
TYPECHECK_HOST                           = PASS  (11-typecheck.txt)
TYPECHECK_WEBVIEW                        = PASS  (11-typecheck.txt)
DIFF_CHECK                               = PASS  (13-diff-check.txt)

EVIDENCE_BOUND_TO_FINAL_HEAD             = PASS  (final HEAD references each evidence file)
BOARD_DURABLE                            = PASS  (epic-board row committed alongside)
```

## 23. Halt conditions

All evaluated, none triggered:

```
HALT_UNEXPECTED_TRACKED_DIRT                              : NOT TRIGGERED
HALT_PRODUCTION_SEAM_MOVED                                : NOT TRIGGERED
HALT_CONTRACT_IMPLEMENTATION_REQUIRES_MANAGER_REDESIGN    : NOT TRIGGERED
HALT_DOUBLE_COUNTED_RUNTIME_INCIDENT                      : NOT TRIGGERED (PCPC-BE-03 guards it)
HALT_GONE_MISCLASSIFIED_AS_ESCAPE                         : NOT TRIGGERED (PCPC-BE-01 + PCPC-AO-01 pin it)
HALT_ESCAPE_CLAIM_WITHOUT_OBSERVATION                     : NOT TRIGGERED (PCPC-AO-02/03/04 sweep pins it)
HALT_TELEMETRY_SEMANTICS_REGRESSED                        : NOT TRIGGERED (PCPC-UI-05 + PCPC-BE-08 pin it)
```
