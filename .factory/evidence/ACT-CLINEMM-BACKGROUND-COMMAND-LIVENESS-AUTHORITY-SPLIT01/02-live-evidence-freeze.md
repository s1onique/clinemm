# LIVE Evidence Freeze

> Sources: `background-owner-correlation.jsonl` (operator drop) +
> `turn-state-writer-provenance.jsonl` (operator drop). Both files
> preserved at `/Volumes/UserData/Users/chistyakov/Downloads/`.

---

## BOCOR decision (operator-captured)

```text
taskId                  = 1789903873206_g5qvj
sessionEventSessionId   = 1789903873206_g5qvj
activeSessionId         = 1789903873206_g5qvj
queriedOwnerSessionId   = 1789903873206_g5qvj
currentPhase            = streaming
candidatePhase          = awaiting_followup
guardAvailable          = true
guardResult             = false
activeJobs              = []
candidateWriterId       = session-event-turn-complete-resumable-straggler-preserve
capturedAt              = 1789904021698
```

## TSWPD (operator-captured)

```text
taskId                  = 1789903873206_g5qvj
writerId                = session-event-turn-complete-resumable-straggler-preserve
epoch                   = 4
previous                = streaming / seq 20
committed               = awaiting_followup / seq 203
capturedAt              = 1789904021699
```

## UI witness (operator-captured, contemporaneous)

```text
jobId        = cmd_mu9qjxmwxl5hasi8
status       = running
card         = Backgrounded
Cancel       = visible
```

The operator observed that the same jobId was reported as RUNNING
both BEFORE and AFTER the Q5 boundary capture; subsequent polling
continued reporting that command as running.

---

## Discriminator state (frozen, per ACT sec 2)

```text
Q5_GUARD_LOGIC              = EXONERATED_FOR_THIS_OCCURRENCE
OWNER_IDENTITY_MISMATCH     = NOT_THE_PRIMARY_FAILURE_FOR_THIS_OCCURRENCE
LIVE_MANAGER_ACTIVE_SET     = EMPTY
LIVE_USER_VISIBLE_COMMAND   = RUNNING
```

## What this evidence refutes

```text
OC1 missing owner stamp                — REFUTED (no active job to inspect)
OC2 active-session ID drift            — REFUTED (no active job to compare)
OC3 guard unavailable                  — REFUTED (guardAvailable=true, guardResult=false)
TaskHeader projection bug              — REFUTED (out of scope for THIS defect)
Q5 guard-result ignored                — REFUTED (Q5 transition WAS committed; the
                                         defect is BEFORE the owner lookup or in
                                         a split authority, not in the guard
                                         ignoring its result)
```

## What this evidence proves

The defect lies **before** the owner lookup at `sdk-session-event-coordinator.ts:300-302`
(the `hasRunningBackgroundJobForOwner(activeSession.sessionId)` call), or in a
split authority between the Q5 manager and the manager that owns the job.

For this LIVE specimen, the `activeJobs: []` snapshot at the Q5 boundary
means:

  - The authoritative `CommandJobManager.active` map, queried at the
    Q5 boundary, contains zero entries.
  - The job `cmd_mu9qjxmwxl5hasi8` is observably still running through
    some other production surface (UI card, command_status poll, etc.).

The diagnostic this ACT introduces (BJLA — Background Job Liveness
Authority) must reconcile these two observations by recording
`managerInstance` and `hostInstance` identities at every load-bearing
lifecycle seam.

---

## Next-step binding

This freeze is the input for the BJLA diagnostic design (file
`06-diagnostic-design.md`). The diagnostic must capture:

  - which `managerInstance` and `hostInstance` inserted the job at T2
  - which `managerInstance` and `hostInstance` answered the status
    query at T3 (and from which lookup source)
  - whether any removal happened (T5)
  - which `managerInstance` answered the Q5 guard at T7
  - which `managerInstance` the BOCOR snapshot read from

The expected output is one of:

  - CASE_LA2_MANAGER_INSTANCE_SPLIT (start manager != guard manager)
  - CASE_LA5_MANAGER_REPLACEMENT_STRANDS_ACTIVE_JOB (replacement)
  - CASE_LA1_PREMATURE_FINALIZATION (same manager, premature remove)
  - CASE_LA3_STALE_PROJECTION (manager correctly terminal; UI stale)
  - CASE_LA4_STATUS_AUTHORITY_SPLIT (status from non-manager source)
  - CASE_LA6_OTHER_PROVEN_CAUSE
