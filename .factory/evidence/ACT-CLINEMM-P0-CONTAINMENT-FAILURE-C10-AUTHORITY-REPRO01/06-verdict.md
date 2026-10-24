# 06 — Verdict

## 6.1 The two questions, answered separately

**Q1. Was the process group proven gone for the incident job?**
**NO — and this is NOT ESTABLISHED IN EITHER DIRECTION.**
`UNAVAILABLE_FROM_TRACE`. The liveness ring contains no
`command_job_primary_group_cleanup` (the only carrier of the `postcondition`
verdict), no `command_job_containment_failed`, and no `job_active_removed`
record for `cmd_mvmh3u69j62aclho`. The ONLY record for that jobId in the
entire 256-record ring is a `job_status_lookup` MISS at 1792854767771.
Per the ACT's instruction, the finalization state is NOT inferred from the
later manager miss.

**Q2. Was the terminal observation consumed?**
**NO.** Both BCB captures report `unconsumedOwnedTerminalResultsForC10: 1`
with `ownedTerminalJobIdsForC10: ["cmd_mvmh3u69j62aclho"]` — before AND
after the second submit. The upstream counters agree
(`unconsumedTerminalCountLast: 1`, `lastStopReason: "stalled_no_progress"`).

**Q3. Was C10 authorized?**
**NO.** `submit_and_exit_seen = 2`, `task_completion_committed = 0`. The
turn-state writer provenance contains no `session-event-turn-complete-completed`
write for this task. The final phase was `streaming`; the final webview
push carried `legacyPhase: "streaming"`. No authoritative completion row
was promoted.

## 6.2 Verdict

### On the SPECIFIC INCIDENT: `CAPTURE_INSUFFICIENT`

The original containment event and the final C10 decision cannot be
established from the supplied capture. The missing records are exactly:

1. The `command_job_primary_group_cleanup` (or
   `command_job_residual_detected` / `command_job_containment_failed`)
   record for `cmd_mvmh3u69j62aclho` — the only carrier of the PGID
   postcondition verdict.
2. The `command_job_terminal_committed` / `command_job_containment_failed`
   lifecycle event for that jobId — the only carrier of the terminal
   classification.
3. A per-session Elm authority decision record (the current counters are
   process-global and carry no session/job identity).

**Minimal next capture:** the manager's lifecycle-event stream for the
affected jobId, plus a per-session Elm decision trace. The
`background-job-liveness-authority` ring is bounded at 256 records and
had already rolled past this job's finalization — it is the wrong
instrument for a per-job terminal-verdict record. A per-job
lifecycle-event capture (or a widened ring with `job_active_removed` +
`command_job_primary_group_cleanup` retained) is required.

### On the PRODUCTION SUSPICION: `HALT_P0_REPRODUCED`

An actual safety-contract gap IS reproduced — but it is a DIFFERENT gap
from the one the incident exhibits, and the leading hypothesis is
DISPROVED for this incident.

The reproduced gap: **the C10 completion-commit barrier has no
containment conjunct.** C10 authorization depends on the disappearance of
an observation (`heldObligationForC10`), not on proven containment
(`postcondition === "gone"`). This is proven by ablation, not by
chronology (RED-06 rows 1-4; matrix in `04-discriminator-matrix.md`).

The disproved hypothesis: "the terminal observation was consumed and the
C10 was authorized over an unresolved containment failure." In this
incident the observation was NOT consumed and the C10 was NOT authorized.
The incident is a HOLD-shaped stall (`HALT`-shaped, `stalled_no_progress`),
not an over-commit.

### Is the current completion policy legitimately permitting completion?

**The current policy has no documented intent either way at the C10
boundary.** There is no statement in the C10 contract
(`docs/architecture/task-lifecycle/02-c9-bcb-elm-c10-authority.md`, the
A-02 conjunct table) that mentions containment; the containment fact is
simply absent from the Elm kernel's vocabulary. Meanwhile the sibling Q5
path DOES fail closed on exactly this fact, with an explicit docstring
rationale. That is an **unintended omission**, not a deliberately different
contract: the omission is invisible to the C10 contract, invisible to the
Elm kernel, and inconsistent with the sibling path in the same file.

## 6.3 Bounded repair contract (one successor ACT)

**Successor ACT: ACT-CLINEMM-P0-CONTAINMENT-FAILURE-C10-AUTHORITY-REPAIR01**
(targeting the smallest production seam).

### Scope — the smallest seam

Add ONE containment conjunct to the C10 barrier predicate, in BOTH places
that compute it, reusing the ALREADY-WIRED PHCF01 authority inputs:

  - `sdk-session-event-coordinator.ts` L3494-3525 (the `handleSessionEvent`
    barrier block), and
  - `sdk-session-event-coordinator.ts` L1736-1805
    (`reevaluateDeferredCompletionBarrier`).

The conjunct must be the SAME owner-scoped fail-closed computation the Q5
path already uses (L1087-1132): read `getBackgroundCommandJobStates`,
filter `reason === "containment_failed"`, scope by
`getBackgroundCommandJobOwners` with the SAME fail-closed rule (unknown
owner -> RETAIN the obligation; a foreign owner -> EXCLUDE).

Factor the Q5 computation into ONE shared private helper so the two paths
CANNOT drift again — that is the actual defect class.

### Explicit non-goals

- **NO change to the Elm kernel.** No new Elm authority. No new Elm input.
  The fix is a TS-predicate conjunct, exactly like the other three.
- **NO change to React updater semantics.**
- **NO change to the completion-continuation / continuation-control
  machinery.**
- **NO change to the PCBC receipt channel** — the `gone`-gating of the
  receipt channel (E4) is CORRECT and must be preserved.
- **NO claim of descendant safety** — the containment fact remains scoped
  to the OWNED primary PGID (the PCPC01 contract).

### Required controls in the successor

1. **Clean-terminal conservation:** a `postcondition: "gone"` job MUST
   still permit C10 (RED-03-C must remain green).
2. **Foreign-owner conservation:** a foreign owner's `containment_failed`
   MUST NOT hold this task's C10 (RED-04-A must remain green).
3. **Unknown-owner fail-closed:** a `containment_failed` entry with NO
   recorded owner MUST hold the C10 (the Q5 fail-closed rule).
4. **Elm boundary preserved:** an Elm HOLD must still suppress the commit
   (RED-03-D must remain green).
5. **The RED witness must flip:** RED-03-B must go from "C10 commits = 1"
   to "C10 commits = 0" over an unresolved containment failure.
6. **BCB re-evaluation parity:** the deferred release path must apply the
   SAME conjunct, or a held completion could be released later through
   `reevaluateDeferredCompletionBarrier`.

### Successor-ACT obligations this ACT does NOT discharge

- The pre-existing baseline RED in `bcb01 / bcb01-c / bcb01-c2 /
  bcb01-c3 / bcb01-c4 / pcca01` (30 failed | 12 passed at pristine
  ENTRY_HEAD) is a SEPARATE harness defect: those harnesses do not inject
  the now-required `getElmCompletionAuthorityDecision`. It MUST be
  repaired (or explicitly baselined) before any conservation claim that
  relies on those suites can be made.
- The `CAPTURE_INSUFFICIENT` boundary on the incident requires the minimal
  next capture described in §6.2 before the incident itself can be
  re-adjudicated.

## 6.4 No synthetic-to-live promotion

Every case in the new suite is classified **SYNTHETIC_REAL**: the manager,
the BCB, the coordinator and the status tool are the REAL production
seams; only the supervisor and the manager's own documented
`terminalPostconditionProbe` are injected. NO live process-group claim is
made anywhere in this report. Per the ACT's §7, the known
EPERM-constrained sandbox was used only for controlled structural
reproduction; an eligible host would be required for an actual
process-group experiment, which this ACT did not need.
