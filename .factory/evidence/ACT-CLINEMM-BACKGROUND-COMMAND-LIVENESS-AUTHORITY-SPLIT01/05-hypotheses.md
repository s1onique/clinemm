# Hypotheses (per ACT sec 5)

The LIVE occurrence is classified against the six hypotheses
below. The diagnostic this ACT introduces will mechanically prove
which case applies on the next LIVE run.

---

## LA1 — premature finalization (CASE_LA1_PREMATURE_FINALIZATION)

```text
same managerInstance M1:

T2:
  active.set(jobId)

T5:
  active.delete(jobId)

AND after T5:
  process/status probe proves original process still alive
```

The `job_active_inserted` and `job_active_removed` records carry
the same `managerInstance` token. The `job_active_removed` record
fires BEFORE the `command_job_primary_group_cleanup` postcondition
probe resolves to `gone`. The PGID probe (a separate kernel call)
proves the process is still alive.

This case is the upstream-referenced shell-wrapper/child lifecycle
divergence. The bounded invariant `CLEAN_TERMINAL CommandJob ⇒
PRIMARY OWNED PGID GONE` is REFUTED for this job — the postcondition
probe returns `alive` / `eperm` / `unknown` (not `gone`), and the
manager nonetheless removes the job from `active`.

**Diagnostic discriminator**:
- `job_active_removed.managerInstance === job_active_inserted.managerInstance`
- `job_active_removed.terminalState === "containment_failed"` (the
  correction06 over-write of `exited` / `cancelled` / etc.)
- `command_job_primary_group_cleanup.postcondition !== "gone"`
  (lifecycle event published BEFORE the active.remove)

## LA2 — manager instance split (CASE_LA2_MANAGER_INSTANCE_SPLIT)

```text
job start/status:
  managerInstance = M1

guard snapshot:
  managerInstance = M2

M1 != M2

M1 still contains job
M2 active=[]
```

The diagnostic dump mechanically proves this by joining the BJLA
ring records (which carry `managerInstance`) to the enriched BOCOR
record (which carries the guard's `managerInstance`).

**Diagnostic discriminator**:
- `job_active_inserted.managerInstance !== guard_record.managerInstance`
- `job_status_lookup.managerInstance === job_active_inserted.managerInstance`
- `guard_record.activeJobs === []`
- `job_cancel_lookup.managerInstance === job_active_inserted.managerInstance`
  AND `job_cancel_lookup.found === false`

The mechanical evidence is `M1` at insert / status / cancel; `M2`
at the Q5 guard. The dump is single-record proof of the split.
---

## LA3 — stale projection (CASE_LA3_STALE_PROJECTION)

```text
manager M1 removes job legitimately
process is terminal
status lookup is terminal

BUT
backgroundCommandRunning remains true
Cancel remains projected
```

The runner's `background_state_change_published` record carries the
projection transition (running=true → running=false) when the
manager's `terminalPromise` resolves with `becameIdle=true`. If the
projection stayed `true` despite the runner publishing `false`,
the LA3 hypothesis is proven: the host's
`onBackgroundStateChange` callback never updated the projection.

**Diagnostic discriminator**:
- `job_active_removed.managerInstance === job_active_inserted.managerInstance`
- `job_active_removed.terminalState` is clean (exited/cancelled/etc.)
- `command_job_primary_group_cleanup.postcondition === "gone"`
- `background_state_change_published.running === false` AND
  `background_state_change_published.jobId === null`
- BUT the UI projection stayed `true` (per operator screenshot)
- AND `job_status_lookup.source === "terminal"` (not "active")

This case is the runner-side projection bug. It requires the
manager's lifecycle to be terminal AND the projection to be stale.

## LA4 — status authority split (CASE_LA4_STATUS_AUTHORITY_SPLIT)

```text
Q5 manager M1:
  no job

status lookup:
  source != M1 active map
  returns running
```

The dump must prove the status path consulted a non-manager source
(a stale snapshot, a cached projection, a separate authority). In
production today, the `manager.status()` method is the SOLE status
path; the LA4 hypothesis is therefore only achievable if a parallel
status authority exists in the runtime.

**Diagnostic discriminator**:
- `job_status_lookup.managerInstance !== guard_record.managerInstance`
  AND `job_status_lookup.source === "miss"`
- BUT the model-visible status payload (returned via
  `command_status` tool) reports `state="running"`
- AND the `job_status_lookup.returnedState !== "running"`

This case requires the production code to have a SECOND status
authority. Today's audit (`04-recon.txt` §G) shows none; if the
next LIVE run proves LA4, the next ACT must locate the parallel
authority.
---

## LA5 — replacement strands old manager (CASE_LA5_MANAGER_REPLACEMENT_STRANDS_ACTIVE_JOB)

```text
M1 starts job
H1/session lifecycle replacement occurs
M2 becomes active manager
M1 remains alive with job
Q5/status paths split across M1/M2
```

More specific than LA2: the replacement is observed via the
`manager_dispose_begin` / `manager_dispose_end` records. M1's
dispose records the pre-dispose active set; M2's construction
record fires after the replacement.

**Diagnostic discriminator**:
- `manager_dispose_begin.managerInstance === M1`
- `manager_dispose_begin.activeJobIdsBeforeDispose` contains the jobId
- `manager_constructed.managerInstance === M2` (FIRES AFTER the
  replacement)
- `M2 !== M1`
- `job_active_inserted.managerInstance === M1`
- `guard_record.managerInstance === M2`

The diagnostic records the dispose/construct pair chronologically;
the join between the two surfaces the replacement.

## LA6 — other proven cause (CASE_LA6_OTHER_PROVEN_CAUSE)

```text
none of LA1..LA5 matches the captured evidence
```

The next ACT will record this when no other case fits. No
speculation allowed.

---

## Allowed verdicts

```text
CASE_LA1_PREMATURE_FINALIZATION
CASE_LA2_MANAGER_INSTANCE_SPLIT
CASE_LA3_STALE_PROJECTION
CASE_LA4_STATUS_AUTHORITY_SPLIT
CASE_LA5_MANAGER_REPLACEMENT_STRANDS_ACTIVE_JOB
CASE_LA6_OTHER_PROVEN_CAUSE
NOT_REPRODUCED
CAPTURE_INSUFFICIENT
```

Repair verdicts (next ACT):

```text
PASS_CASE_LA1_REPAIRED
PASS_CASE_LA2_REPAIRED
PASS_CASE_LA3_REPAIRED
PASS_CASE_LA4_REPAIRED
PASS_CASE_LA5_REPAIRED
PASS_CASE_LA6_REPAIRED
```

The repair contract for each case is in the ACT body (§21..§24).
This ACT does NOT apply any repair — that is the next ACT's
responsibility.
