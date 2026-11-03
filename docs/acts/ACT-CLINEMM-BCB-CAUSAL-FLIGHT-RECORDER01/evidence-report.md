# ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01 — Evidence Report

**Status:** `PASS_STRUCTURAL_READY_FOR_LIVE`

**Correction:** `ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01` — see
§7. The implementation baseline `4fe85071c` is preserved; the correction
closes three evidence-integrity defects (P0) and one correlation-assertion
defect (P1) without changing production completion semantics.

**Purpose:** Evidence acquisition only. No task-state repair. No change to
phase semantics, barrier predicates, scheduling, or Elm authority.

---

## 1. The gap this ACT closed

The prior diagnostic layer answered *"how many times did X happen?"* but
not *"why did THIS task's completion get held, and what happened to the
barrier afterwards?"*.

Three concrete gaps:

| # | Gap | Evidence before this ACT |
| - | --- | --- |
| 1 | **Coverage** | The BCB capture (`@shared/bcb-observation-unavailable-capture`) fires ONLY inside the eligible coalesced-continuation branch. A hold caused by pending-prompt uncertainty, unconsumed terminal results, or a running owner was recorded **nowhere**. |
| 2 | **Correlation** | The upstream counters (`./completion-continuation-upstream-runtime`) are PROCESS-WIDE aggregates. After the user switched tasks, `sessionMismatch=1` could not be attributed to the task that actually suffered it. |
| 3 | **Identity** | A boolean mismatch counter cannot say WHICH identity mismatched. The marker identity and the active session identity were both absent. |

The RED witness (`completion-incident-flight-recorder.red01.test.ts`)
proved this gap was real, not theoretical: a pending-prompt-uncertainty
hold produced **zero** records from every existing recorder while the
completion was genuinely held.

---

## 2. What was built

### 2.1 The causal flight recorder

`apps/vscode/src/shared/completion-incident-flight-recorder.ts`

A bounded, per-incident flight recorder. The design decisions that matter:

- **Per-task CAPSULES, not a global aggregate.** Every record belongs to
  a capsule keyed by `taskId`. Switching to task B does NOT evict task
  A's evidence.
- **Anomalous capsules are protected.** The last four ANOMALOUS capsules
  are retained even after newer tasks become active. Eviction order is
  oldest-first, but anomalous capsules within the retention window are
  skipped.
- **`NOT_EVALUATED` is distinct from `false`.** A predicate production
  never consulted on a branch is **absent** from the record — never
  reported as `false`. Reporting `false` would assert a fact production
  never established.
- **Every loss is counted.** `evictedCapsules`, `evictedRecords`,
  `capsuleDroppedRecords` and `failedCheckpoints` are surfaced in the
  bundle manifest. A truncated capture is never presented as complete.

The envelope (ACT §2):

```json
{
  "schemaVersion": 1,
  "eventSeq": 42,
  "timestamp": "2026-11-03T01:15:51.933Z",
  "taskId": "...",
  "sessionId": "...",
  "epoch": 12,
  "coordinatorInstanceId": "...",
  "barrierId": "...",
  "stage": "barrier_reevaluation",
  "outcome": "session_mismatch"
}
```

`barrierId` is **diagnostic-only**. It never enters the runtime identity
model, the marker, the epoch, or any public protocol.

### 2.2 The instrumented boundaries

All instrumentation lives in the EXISTING production seams in
`apps/vscode/src/sdk/sdk-session-event-coordinator.ts`. Every captured
value is an **already-evaluated production local** — no provider is
invoked a second time for diagnostics (§11 invariant).

| ACT §1 boundary | Stage recorded | Site |
| --- | --- | --- |
| C10 completion attempt | `completion_attempt` | Site A hold-decision block — captures ALL evaluated hold predicates + the exact `holdReason` conjunct |
| BCB registration | `barrier_registration` | Marker registration — identity triple, hold reason, phase writer |
| BCB reevaluation | `barrier_reevaluation` | Re-evaluation entry — `marker_missing` when no marker exists |
| Early return | `early_return` | Each re-evaluation hold branch (`owner_still_running`, `outstanding_autonomous_work`, `unresolved_containment_failure`) |
| Marker clearance | `marker_clearance` | `released`, `session_mismatch`, `task_mismatch`, `epoch_mismatch`, `session_missing` |
| Continuation | `continuation` | Eligibility (`eligible` / `not_eligible_*`), enqueue attempt, delivery outcome |
| Final authority | `completion_authority` | Elm `authorize` / `hold` / `failure`, plus `committed` at both commit sites |

**Both identities on mismatch.** Every `marker_clearance` record carries
`markerIdentity` (the session that held the obligation) AND
`activeIdentity` (the session that is now current) as SEPARATE fields.

### 2.3 The one-command bundle

`apps/vscode/src/sdk/completion-incident-bundle-runtime.ts` +
the `cline.debug.dumpCompletionIncidentBundle` command.

```
completion-incident-<timestamp>/
├── manifest.json
├── barrier-timeline.jsonl
├── turn-state-writers.jsonl
├── continuation-events.jsonl
├── completion-authority.jsonl
├── header-selection.jsonl
└── summary.json
```

**Reuse, not duplication.** Every file is built from the EXISTING
recorders' read APIs. The bundle re-collects nothing:

| File | Source |
| --- | --- |
| `barrier-timeline.jsonl` | the causal flight recorder |
| `turn-state-writers.jsonl` | `@shared/turn-state-writer-provenance` |
| `continuation-events.jsonl` | `@shared/bcb-observation-unavailable-capture` + `@/sdk/continuation-cardinality-authority` |
| `completion-authority.jsonl` | the flight recorder's `completion_authority` stage |
| `header-selection.jsonl` | `@/sdk/task-header-selector-input-capture` |

`manifest.json` reports the extension version, source commit (when
available), capture profiles, included sessions/task ids, recorder
coverage, dropped records, and — per source — whether it was
`available` or `unavailable`. An empty source is reported as
`unavailable`, never silently omitted.

`summary.json` derives its result purely from the records. **It never
infers a missing transition from silence**: a fact the evidence does
not establish is reported as `UNOBSERVED`.

### 2.4 Checkpoint persistence

`apps/vscode/src/sdk/completion-incident-checkpoint-runtime.ts`

The capsules survive a task switch (`SdkController.showTaskWithId`) and
an extension-host shutdown (`extension.ts` `deactivate`), and are
restored on the next activation.

Both writes are **fire-and-forget** — the production path never awaits
them, so a slow or failing disk can never block task execution. A
failed write is counted and reported in the manifest, never thrown.

The checkpoint file is bounded (512 KiB). When the serialized
checkpoint exceeds the cap, the oldest NON-anomalous capsules are
dropped first, so the incident the operator is investigating is the
last thing lost.

---

## 3. Acceptance gates (ACT §5)

All gates are executable and drive the REAL `SdkSessionEventCoordinator`
seam through the shared harness
(`completion-incident-flight-recorder-harness.ts`) — not a
re-implementation of the barrier predicates.

| Gate | Test | Result |
| --- | --- | --- |
| BCB hold caused solely by pending-prompt uncertainty → exact predicate captured | `green01.test.ts` G1.1 | PASS |
| BCB hold caused by unconsumed terminal results → held identities/count captured | `green01.test.ts` G2.1 | PASS |
| Marker cleared by session mismatch → both identities and clearance captured | `green01.test.ts` G3.1 | PASS |
| Barrier eventually releases → original hold linked to authoritative completion | `green01.test.ts` G4.1 | PASS |
| A task pauses, then user switches to task B → task A evidence survives | `green01.test.ts` G5.1 | PASS |
| Normal completion → no fabricated holds or errors | `green01.test.ts` G6.1 | PASS |
| Non-dogfood profile → instrumentation is `DEFAULT_OFF` | `green01.test.ts` G7.1 | PASS |
| Recorder overflow → loss reported explicitly | `green01.test.ts` G8.1–G8.3 | PASS |

Plus the bundle gates (`bundle01.test.ts`, 9 tests) and the checkpoint
gates (`cp01.test.ts`, 6 tests).

### The RED-then-GREEN sequence

`completion-incident-flight-recorder.red01.test.ts` was written FIRST,
against the UN-instrumented coordinator, and it PASSED by proving the
gap: a real hold produced **zero** records from every existing
diagnostic layer.

After the instrumentation landed, the same file was rewritten to assert
the OPPOSITE (the hold IS recorded; the mismatch IS attributable) and
now serves as the regression guard for the closure. The file's header
documents this history explicitly, so the RED→GREEN transition is
auditable rather than hidden.

---

## 4. Terminal evidence

| Item | Value |
| --- | --- |
| Base commit | `a424fe70c254759c1d9911478181fa5ca38f67b9` (branch `main`) |
| Typecheck | `tsc --noEmit` — **92 errors before, 92 after** (zero new; the pre-existing 92 are missing generated proto/SDK artifacts, verified by stash-baseline comparison) |
| Lint | `biome lint --diagnostic-level=error` on all 8 changed/new source files — clean |
| Format | `biome format` clean on all 14 touched files |
| New tests | 4 suites, 33 tests, all passing against the real coordinator seam |
| Regression check | the 5 BCB-adjacent suites fail with **byte-identical** counts with and without this ACT (see §4.1) |
| Example bundle | generated by `bundle01.test.ts` into a temp `globalStorageUri`; the file set and manifest shape are asserted there |

### 4.1 Regression check (stash-baseline comparison)

The repository has a substantial set of PRE-EXISTING failing suites (49
suites at the time of measurement, driven by missing generated
proto/SDK artifacts in this environment). To prove this ACT introduced
no regression, the same suite set was run twice — once with this ACT's
changes stashed, once with them applied — and the failure profiles were
diffed:

```
$ diff <(mine) <(baseline) && echo 'IDENTICAL FAILURE PROFILE'
IDENTICAL FAILURE PROFILE
```

| Suite | Baseline | With this ACT |
| --- | --- | --- |
| `sdk-session-event-coordinator.test.ts` | 2 failed | 2 failed |
| `continuation-pathological-corpus01.swcm04.test.ts` | 11 failed | 11 failed |
| `host-blocked-outcome-publication01.hbop01.test.ts` | 8 failed | 8 failed |
| `task-terminal-divergence-red01.tdd-red01.test.ts` | 3 failed | 3 failed |
| `c10-filter-ablation01.ablation.test.ts` | 3 failed | 3 failed |

**One regression WAS found and fixed during this ACT.** The first wiring
placed the CIFR profile activation BETWEEN the CCARD and CCDO
activations in `extension.ts`. The pre-existing test `CCDCO01.G`
asserts those two calls are positional siblings
(`Math.abs(applyIdx - ccardIdx) < 2000`), so the insertion broke it —
`completion-continuation-delivery-callback-outcome01.ccdco01.test.ts`
failed when run alongside the new suites. The activation was moved to
BEFORE the CCARD activation, restoring the CCDO↔CCARD adjacency. The
suite now passes (9/9) both alone and alongside the new suites.

### Files changed

```
 M apps/vscode/package.json                                  (+5)   command declaration
 M apps/vscode/src/extension.ts                              (+79)  activation + dump command + shutdown checkpoint
 M apps/vscode/src/registry.ts                               (+12)  command id
 M apps/vscode/src/sdk/SdkController.ts                      (+14)  task-switch checkpoint
 M apps/vscode/src/sdk/dogfood-diagnostic-profile.ts         (+66)  profile resolver (DEFAULT_OFF in public)
 M apps/vscode/src/sdk/sdk-session-event-coordinator.ts      (+597)  the 7 instrumented boundaries
```

### Files added

```
 src/shared/completion-incident-flight-recorder.ts                 the recorder
 src/sdk/completion-incident-bundle-runtime.ts                     the bundle export
 src/sdk/completion-incident-checkpoint-runtime.ts                 the checkpoint persistence
 src/sdk/__tests__/completion-incident-flight-recorder-harness.ts  the shared real-seam harness
 src/sdk/__tests__/completion-incident-flight-recorder.red01.test.ts    the RED→closure guard
 src/sdk/__tests__/completion-incident-flight-recorder.green01.test.ts  the 8 acceptance gates
 src/sdk/__tests__/completion-incident-bundle.bundle01.test.ts          the bundle gates
 src/sdk/__tests__/completion-incident-checkpoint.cp01.test.ts          the checkpoint gates
```

---

## 5. Diagnostic-profile checks

| Profile | Recorder | Command |
| --- | --- | --- |
| `isDogfood === false` (public) | **OFF** (`profile-off`) | available (unconditional dump) |
| `isDogfood === true` (dogfood) | **ON** (`profile-on`) | available |

There is **no new env var**, no override matrix, and no workspace
toggle. The enablement is owned by the central dogfood profile, exactly
mirroring the EHLOOP / CCARD / BJLA / BOCOR / TSWPD / BCAPT01
precedent.

The dump command itself is **unconditional** (an operator must always be
able to inspect whatever was captured) and **dump != clear** (the
recorders are never reset by the dump).

---

## 6. Honest limitations

1. **This cannot reconstruct the incident that already happened.** It
   prepares the NEXT occurrence. The evidence for the past `Paused`
   incident is gone.
2. **`LIVE_UNOBSERVABLE` classifications.** No field in this ACT
   required instrumentation that changes semantics, so no field is
   classified `LIVE_UNOBSERVABLE`. The one boundary whose values are
   NOT observable from a capture is the Elm kernel's internal
   reasoning — the bundle reports the Elm DECISION (authorize / hold /
   failure) and its reason, not the kernel's internal state. That is
   reported as the decision, not as a fabricated internal fact.
3. **The `completionCommitted` field is tri-state.** When neither a
   commit nor a withhold was observed, the summary reports
   `UNOBSERVED` — it does NOT infer "not committed" from the absence of
   a commit record. This is asserted by `bundle01.test.ts` BUNDLE-03.1
   and BUNDLE-03.2.
4. **The summary's `status` is `CAPTURE_INSUFFICIENT` when no commit
   or withhold was observed**, even if the hold itself was captured.
   This is deliberate: "we saw the hold but not its resolution" is not
   a sufficient capture.
5. **The checkpoint write on task switch is best-effort.** It is
   fire-and-forget by design; a crash between the task switch and the
   async write can lose the checkpoint. The in-memory capsule is
   unaffected, and the failure counter reports the loss.

---

## 7. Removal trigger

Remove — TOGETHER — the recorder module, the bundle runtime, the
checkpoint runtime, the coordinator instrumentation, the profile
resolver, the registry entry, the package.json declaration and the
extension.ts handler when: first of (a) the incident class is
diagnosed from a single dump on a LIVE incident, (b) the capture is
classified `CAPTURE_INSUFFICIENT`, or (c) successor evidence supersedes
it.

---

## 8. CORRECTION01 — evidence-integrity corrections

`ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01` is a bounded
correction on top of the implementation baseline `4fe85071c`. The
architecture is NOT reopened; only the evidence-summary, loss-accounting
and correlation-assertion seams are corrected. **Production completion
semantics are unchanged** — no phase semantics, barrier predicate,
scheduling or Elm-authority change.

### 8.1 P0 — incident-scoped summaries (the bundle could report the wrong task)

`buildCompletionIncidentBundleSummary(records)` searched across ALL
retained task records and selected the LAST commit/withhold it found.
With task A held (`Paused`) and task B completed, it selected task B's
`committed` record and reported:

```json
{ "status": "CAPTURE_SUFFICIENT", "lastObservedPhase": "completed", "completionCommitted": true }
```

— even though task A's incident was unresolved. The retained evidence
was correct; the SUMMARY told the wrong story.

**Correction.** Summaries are now **INCIDENT-SCOPED**:

| Function | Role |
| --- | --- |
| `buildCompletionIncidentBundleSummaries(records)` | ONE independent summary per retained task capsule (the causal identity). |
| `buildCompletionIncidentBundleSummary(records)` | The bundle-wide **OVERVIEW**. It NEVER asserts an incident's outcome: `completionCommitted` is always `UNOBSERVED`, and its notes name each incident's verdict. |

The bundle writes `incident-summaries.json` (the per-incident
conclusions) alongside `summary.json` (the overview).

### 8.2 P0 — conservative sufficiency and an explicit barrier stage set

The status vocabulary is now **three-valued**:

| Status | Meaning |
| --- | --- |
| `CAPTURE_SUFFICIENT` | This incident's OWN records establish a terminal outcome AND the capture was not lossy. |
| `CAPTURE_INSUFFICIENT` | This incident's own records do NOT establish a terminal outcome — the incident is unresolved. |
| `CAPTURE_EVIDENCE_LOST` | The capture for this incident was lossy, so the evidence CANNOT establish the outcome. Explicitly distinct from "the incident did not finish": we do not know. |

`lastBarrierOutcome` now comes from an **explicit barrier-stage set**
(`completion_attempt`, `barrier_registration`, `barrier_reevaluation`,
`early_return`, `marker_clearance`, `completion_authority`). The
previous `stage !== "continuation"` filter admitted an arbitrary
non-continuation record (for example a `completion_attempt`
`not_held`) as a barrier outcome.

### 8.3 P0 — loss-safe checkpointing

| Defect | Correction |
| --- | --- |
| `buildBoundedCheckpoint()` computed `droppedCapsules`; the caller DISCARDED it. | The truncation counts are recorded into the recorder's loss accounting (`checkpointTruncatedCapsules` / `checkpointTruncatedRecords`) and surfaced in the bundle manifest. |
| `restoreCompletionIncidentCheckpoint()` restored the capsules but NOT the eviction/failure statistics. | The checkpoint's `stats` block is restored (truncation counters as a high-water mark so a repeated checkpoint never double-counts). The checkpoint artifact also carries its OWN truncation counts, so the persisted file is honest about the loss it incurred. |
| The 512-KiB bound was enforced with `String.length` (UTF-16 code units). | The bound is enforced with actual UTF-8 byte counts (`Buffer.byteLength(value, "utf8")`) — exactly what `writeFile(..., "utf8")` persists. `MAX_CHECKPOINT_BYTES` is exported so the bound is assertable. |

### 8.4 P1 — exact barrier-identity correlation

`mintBarrierId()` embedded `state.seq` — the process-wide event counter —
so the fallback minted a DIFFERENT id for every record of one lifecycle.
The coordinator never supplied an explicit id, so the broken fallback was
always taken: a single lifecycle produced N unrelated ids and the causal
chain could not be followed through the timeline.

**Correction.** The barrier id is minted ONCE per barrier **lifecycle**,
keyed by `(coordinatorInstanceId, sessionId, taskId, epoch)`:

- registration → re-evaluation → clearance → completion in the SAME
  epoch share ONE id (it is the same obligation);
- a **re-registration WITHIN the same epoch** reuses the SAME id;
- a NEW epoch mints a NEW id (it is a new lifecycle).

The id remains **diagnostic-only**: it never enters the runtime identity
model, the marker, the epoch, or any public protocol.

### 8.5 Executable evidence

| Suite | Covers |
| --- | --- |
| `completion-incident-bundle-correction01.inc-scope.test.ts` | Task A held → task B completed: A's summary never reports B's commit; B's summary does; the overview asserts no incident's outcome; `lastBarrierOutcome` comes from a real barrier stage. |
| `completion-incident-checkpoint-correction01.loss.test.ts` | Checkpoint truncation → restart → bundle: the truncation is counted, survives the restart, the persisted artifact stays within the UTF-8 byte bound, the bundle declares `evidenceLoss: true`, and a lossy incident is never `CAPTURE_SUFFICIENT`. |
| `completion-incident-barrier-identity-correction01.corr.test.ts` | Exact same-lifecycle barrier id across registration / re-evaluation / completion, and across a re-registration within one epoch — asserted through the REAL coordinator seam. |

Focused result: **48 passing** across the four baseline suites and the
three correction suites.

The truncation path is reached in the test by raising the recorder's
CONFIGURABLE bounds (`setCompletionIncidentRecorderBounds`); the
recorder's default caps (16 capsules / 2048 records) keep the
checkpoint far below the byte bound. The truncation code path itself is
unchanged production code.
