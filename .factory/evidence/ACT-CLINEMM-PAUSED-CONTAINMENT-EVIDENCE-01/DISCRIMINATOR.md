# ACT-CLINEMM-PAUSED-CONTAINMENT-EVIDENCE-01 — Discriminator (C4)

## Competing hypotheses (as stated in the ACT brief, none pre-selected)

| ID | Hypothesis |
|---|---|
| H1 | Containment really failed and remained blocked |
| H2 | Settlement / reconciliation was not initiated |
| H3 | Reconciliation ran but was not recorded |
| H4 | Blocker remained stale after verified exit |
| H5 | UI banner represented an earlier boundary |

## The discriminating observations

### O1 — The historical postcondition verdict is `alive` + `osErrorCode: null` (LIVE / archive)

`containment-provenance.json` records, for BOTH jobs:
`postcondition: "alive"`, `osErrorCode: null`, `containmentFailed: "substrate_alive"`.

Under the production probe (`defaultTerminalPostconditionProbe`,
`apps/vscode/src/sdk/command-job-manager.ts:4260-4274`) that **pair is only
producible by `process.kill(-pgid, 0)` returning rc=0**:

```
rc=0   -> { postcondition: "alive",  osErrorCode: null }   <-- the recorded pair
EPERM  -> { postcondition: "eperm",  osErrorCode: "EPERM" }
ESRCH  -> { postcondition: "gone",   osErrorCode: "ESRCH" }
other  -> { postcondition: "unknown", osErrorCode: <other> }
```

**Discriminates H1 from H2/H3/H4:** the group **provably existed** and the probe
was **permitted**. The hold was a *correct* verdict at the moment it was taken,
not a denied probe and not a projection of a stale state.

### O2 — The failing jobs were genuine long-lived background processes (LIVE / log)

`apps/vscode/src/sdk/vscode-run-commands-tool.ts` runs every command in
`backgroundExec` mode (`1-Cline.log`: `[VscodeRunCommands] Executing command in
backgroundExec mode`). The measured spawn->containment-failure intervals are:

| Job | Spawn (log) | Containment failure (log) | Interval | `TERM_GRACE_MS` |
|---|---|---|---|---|
| `cmd_mwh14ea1zuxmau36` | 23:20:51.880Z | 23:21:00.641Z | **8.761 s** | 5 000 ms |
| `cmd_mwh15l67vap32h26` | 23:21:50.191Z | 23:21:56.255Z | **6.064 s** | 5 000 ms |

Both intervals **exceed the 5 s SIGTERM grace** (`TERM_GRACE_MS`,
`apps/vscode/src/sdk/command-job-manager.ts:1144`), i.e. a full
`terminateTree(SIGTERM -> 5 s grace -> SIGKILL)` cycle ran and the group was
**still there afterwards**. This is the `job.treeEscapee = true` shape
(`:3086-3094`).

**Discriminates H1 from H4:** a group that is still alive *after* the full
terminate sequence is a genuine survivor, not a group that exited shortly
afterwards.

### O3 — The reconciliation machinery WORKS at this seam (REAL / executable)

`D2` in
`apps/vscode/src/sdk/__tests__/paused-containment-evidence01.discriminator.pce01.test.ts`
drives the REAL `CommandJobManager` + REAL supervisor + REAL default probe with
a group that exits inside the bounded horizon. The kernel proves `gone`, the
manager publishes `command_job_containment_reconciled`, the blocking set drains.
Result: **PASS**.

**Discriminates H4 from H1:** if the incident's blockers had been *stale* (i.e.
the same verified identity had exited), this seam would have drained them. The
incident's blockers did **not** drain, and the archive shows why: at probe time
they were alive. **A stale blocker is OBSERVABLE at this seam and is therefore
excluded as the incident's cause.**

### O4 — The empty `reconciliation-timeline.jsonl` is a DEFAULT-OFF CAPTURE GAP, not a missing registration (REAL / executable)

`D3` in the same file arms **nothing** (the production default) and drives the
REAL manager. Result:

- the **independent, unconditional** lifecycle channel
  `command_job_containment_reconciled` **IS emitted**, and
- the diagnostic record list is **EMPTY** and classifies as
  `UNAVAILABLE_FROM_TRACE`.

**Discriminates H2 from H3:** "missing registration" (H2) and "missing capture"
(H3) are separated at the owning producer. With the sink disarmed the producer
still registers and still publishes — only the *observation* is absent. The
incident's persisted snapshot (`incident.json`) confirms the disarmed state:
`reconciliationTimeline: []`, and the live 53 865-line extension-host log
contains **zero** occurrences of `reconcil` (case-insensitive).

**Therefore H3 ("reconciliation ran but was not recorded") is the only
hypothesis consistent with the evidence for the reconciliation stage.** H2 is
excluded *for the diagnostic stage*: the producer was never asked to record.

### O5 — The reconciliation sink is DEFAULT-OFF in the installed public profile (STRUCTURAL / source + LIVE)

`apps/vscode/src/sdk/reconciliation-diagnostic-capture.ts:216-218` returns
immediately when disarmed. It is armed **only** by
`applyReconciliationDiagnosticCaptureProfile(isDogfood, userOptedIn)`
(`apps/vscode/src/sdk/dogfood-diagnostic-profile.ts:2213-2231`), called at
`apps/vscode/src/extension.ts:544`, where `isDogfood` is
`isDogfoodRuntime(process.env)` and `userOptedIn` is the persisted
`clineDetailedLocalDiagnosticsEnabled` (default **false**,
`apps/vscode/src/shared/storage/state-keys.ts:123`).

The incident ran on a **public** VSCodium profile (`.vscodium-clinemm`). The
runtime was therefore in the default-OFF posture for the entire incident.

### O6 — `phase-writers.jsonl` and `continuation-summary.json` are structurally un-wired (STRUCTURAL / source)

The **only** production call site of
`buildAutomaticIncidentExportBundle` is
`apps/vscode/src/sdk/automatic-incident-export-runtime.ts:170-174`, which passes
only `incident`, `buildIdentity` and `containmentProvenance`. It passes
**neither** `phaseWriters` **nor** `continuationSummary`.

**Consequence:** in every production export `phase-writers.jsonl` is empty and
`continuation-summary.json` is the literal constant
`{"status":"unavailable","reason":"no continuation summary was captured for this
incident"}` — **independent of what actually happened**. The archive's
`continuation-summary.json` is therefore **uninformative**, and the ACT brief's
"Continuation outcome is unavailable" is true of the artifact but says nothing
about the runtime.

**This is a MISSING_PRODUCER, proven from source — not a missing runtime event.**
It also means the 0-byte `phase-writers.jsonl` was **never** going to contain
evidence, even with every diagnostic armed.

### O7 — The banner represented TWO boundaries, and the terminal one was the containment hold (LIVE / archive)

`completion-timeline.jsonl` records two `held_phase_published` observations
with the **same** phase writer `session-event-bcb-hold-resumable` but
**different** hold reasons:

| Time | holdReason |
|---|---|
| 2026-11-14T23:33:02.217Z (12 observations, 23:33:02 -> 23:38:36) | `suppress_originating_completion` |
| 2026-11-14T23:38:44.760Z (1 observation) | `unresolved_containment_failure` |

**Discriminates H5:** the FIRST banner was indeed an earlier boundary
(`suppress_originating_completion`), but the **last** observed phase was
`resumable` with `holdReason: unresolved_containment_failure`. H5 is
**partially supported for the first banner and excluded as the terminal
explanation.**

### O8 — The incident-era process groups are provably GONE at ACT time; the numeric PGIDs are now occupied by UNRELATED processes (LIVE / read-only OS)

| Observation | Result |
|---|---|
| `ps -p 9667` / `ps -p 13450` (the recorded leaders) | **both ABSENT** |
| `ps` members of PGID 9667 | PID **9668**, `bun /tmp/seam-host.ts`, started **2026-11-15T02:20:54Z** |
| `ps` members of PGID 13450 | PID **13453**, `bun /tmp/seam-host.ts`, started **2026-11-15T02:21:50Z** |
| `kill -0 -9667` / `kill -0 -13450` | **EPERM** ("operation not permitted") |

The incident occurred at **2026-11-14T23:21Z**; the current PGID members started
**~3 hours later**. They are **PID/PGID reuse** by an unrelated test harness
(`/tmp/seam-host.ts` drives `apps/vscode/src/sdk/control-seam/control-seam-server.ts`),
**not** the incident's processes.

**Consequences (conservation / safety):**
1. The incident's original process groups are **provably gone**.
2. The numeric PGID today is a **foreign, unowned** group; `kill -0` returns
   **EPERM**, which the production probe classifies as `eperm`, **not** `gone`.
3. **No signal was ever sent** to PID 9667, PID 13450, PGID 9667 or PGID 13450
   by this ACT. `kill -0` is an existence/permission probe, not a signal
   delivery, and no process was terminated.
4. This demonstrates the **identity-changed** hazard the ACT named: a numeric
   PGID match alone never authorizes a release — the production code already
   requires a fresh `gone` verdict from the SAME owned identity
   (`apps/vscode/src/sdk/command-job-manager.ts:1660-1662`).

### O9 — The C10 reevaluation performs NO OS re-probe (STRUCTURAL / source)

`unresolvedContainmentFailuresForOwner`
(`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1202-1263`) reads ONLY the
cached controller-level `backgroundCommandJobStates` map
(`apps/vscode/src/sdk/SdkController.ts:2916`). It never probes the OS. The
blocking set can **only** drain through the
`command_job_containment_reconciled` chain.

**Consequence:** the hold is permanent *by construction* unless a reconciliation
resolves. A group that dies after the bounded horizon is **never** noticed by
the C10 path — but that is NOT the incident's cause, because O1/O2 show the
groups were alive at (and after) the probe, and O3 shows a group that dies
inside the horizon DOES drain.

### O10 — The incident extension host is STILL ALIVE and IS the incident's host (LIVE)

`extensionHostInstanceId: "extension-host-47602-mwg6a71m"` in the archive
matches the runtime-diag file
`.../runtime-diag/clinemm-v2-cf7602d8-mwg6a71m.jsonl` (suffix `mwg6a71m`).
PID **47602** is alive (started **2026-11-14T11:57:36Z**, PGID 47523) and
`lsof -p 47602` proves it is the writer of the `1-Cline.log` this ACT read, and
of the `~/.vscodium-clinemm/cline-data/db/sessions.db` the incident used.

## Ablation / necessity

The discriminator suite is an **ablation over the single varying factor**: the
liveness of the owned group at the reconcile horizon.

| Arm | Varying factor | Observed | Conclusion |
|---|---|---|---|
| D1 | group alive across the horizon | `containment_failed`, **no** reconciliation, **no** terminal commit | the hold is CORRECT for a survivor |
| D2 | group exits inside the horizon | `containment_failed` then `command_job_containment_reconciled`, blocker drains | the hold is RELEASABLE when the group dies in time |
| D3 | diagnostic sink disarmed (production default) | lifecycle event **present**, diagnostic records **empty** | the empty timeline is a CAPTURE artifact |

**Necessity result:** a reconciliation event is **necessary and sufficient** to
drain the C10 blocking set. No other production path writes a non-
`containment_failed` projection for a contained job
(`apps/vscode/src/sdk/SdkController.ts:6217-6233`).

**Corroboration from the incident runtime itself:** the live log shows the
containment hold repeated **10 times** between 23:33:10Z and 23:38:44Z
(`submit_and_exit requested ... unresolved containment failure ... holding
completion (CFC10AR01 barrier)`), each time re-reading the SAME two job ids. No
release ever occurred — exactly the O9 "permanent by construction" behaviour
when no reconciliation resolves.

## Selected verdict

**H1 (containment really failed and remained blocked) is SELECTED**, with
**H3 (reconciliation ran but was not recorded)** selected **for the
reconciliation-observation stage only** (the sink was disarmed), and **H5
partially supported** for the first banner only.

**Excluded:** H2 (settlement not initiated) — the producer's registration path
is proven present and, per D3, the sink's disarm suppresses only the
*observation*, never the registration; H4 (stale blocker after verified exit) —
the probe verdict was `alive` with a permitted rc=0, the terminate sequence had
already run its full 5 s grace + SIGKILL, and D2 proves a group that dies inside
the horizon drains.

**Remaining residual (not selectable from this evidence):** whether the two
groups died *after* the 5 s reconciliation horizon (in which case they would be
"survivors at horizon, dead later" — a genuine survivor at the only moment the
system looked, hence a correct hold). The incident's `alive` verdict is
recorded at the probe, and the reconciliation horizon is 5 s; the archive cannot
resolve the groups' fate *after* the horizon because the sink was disarmed.
That residual does **not** change the selection: the gate behaved correctly at
every boundary it could observe.

## Evidence classification of every claim

| Claim | Classification |
|---|---|
| Historical postcondition was `alive` (rc=0, permitted) | REAL (archive, verified member hashes) |
| Spawn->failure intervals exceed `TERM_GRACE_MS` | LIVE (read-only incident log) |
| Reconciliation machinery drains a stale blocker | REAL_PRODUCTION_SEAM (D2, executed) |
| A survivor is never reconciled | REAL_PRODUCTION_SEAM (D1, executed) |
| The empty timeline is a default-off capture gap | REAL_PRODUCTION_SEAM (D3, executed) + STRUCTURAL (source) |
| The reconciliation sink is default-off | STRUCTURAL (source) |
| `phase-writers.jsonl` / `continuation-summary.json` are structurally un-wired | STRUCTURAL (source) |
| Two banner boundaries with different hold reasons | REAL (archive) |
| Original groups are gone; numeric PGIDs now foreign | LIVE (read-only `ps` / `kill -0`) |
| C10 reevaluation performs no OS re-probe | STRUCTURAL (source) |
| The incident extension host is PID 47602 and is still alive | LIVE (`ps` + `lsof`) |
