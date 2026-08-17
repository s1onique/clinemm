# C2.3 — STATEFUL WORKLOAD QUALIFICATION CONTRACT (freeze)

```text
ACT =
ACT-CLINEMM-ELM-ARCHITECTURE01-
E5-E6-SHADOW-DIFFERENTIAL01-
CORRECTION02-C2.3

PARENT_ACT =
ACT-CLINEMM-ELM-ARCHITECTURE01-
E5-E6-SHADOW-DIFFERENTIAL01-
CORRECTION02-C2.2-CORRECTION02

PLAN_FREEZE_HEAD = THIS-COMMIT
  (the plan was frozen BEFORE C2.3-C2a; the
   production-semantics base for the contract is
   ff2c053ed..., the C2.2-CORRECTION02 final state.)

PRODUCTION_BASE_HEAD =
ff2c053ede26108817883c5e438eaac4cd461de1
  (the C2.2-CORRECTION02 final state — invariant of
   authority model, host scope, TaskState shape)

FINAL_HEAD = THIS-COMMIT

BRANCH     = act/elm-architecture01-e0-e4

PROTECTED_STASHES:
  FORENSIC_STASH_OBJECT = 141372c52ddd560f8d65bd438d9f9c22ba0f1f85
  CONTEXT_STASH_OBJECT  = 371752f71e5b9a385af32736e007540386d48b82

WORKTREE   = clean
```

---

## 0. Scope

C2.3 qualifies the unified observation boundary and TaskState under
deterministic, **stateful** multi-step sequences. C2.0/C2.1/C2.2 were
largely single-step or static-arbiter workloads; C2.3 forbids that
shape.

C2.3 is **qualification**, not architecture. Expected production
semantic delta:

```text
0
```

Allowed production code change: <= 50 net LOC of
instrumentation/evidence cleanup. The previous C2.3-C2a commit added
+5 LOC for the per-origin fallback counters (C23-R2).

If a W01–W16 workload requires changing production semantics,
HALT and create a narrow correction ACT.

---

## 1. Authority model (frozen throughout C2.3)

```text
LEGACY_AUTHORITY          = 100%
SHADOW_AUTHORITY          = 0%
TASKSTATE_AUTHORITY       = 0%

RUNTIME_CANONICAL:
  authoritative for runtime truth
  arrival 1: APPLY (no dedup needed; runtime emits each event
  exactly once per edge by contract)
  records with origin = RUNTIME_CANONICAL

RUNTIME_RECONSTRUCTED:
  LocalRuntimeHost (canonicalAvailable=true) =
      DIAGNOSTIC_ONLY
      increments observationsDiagnosticByOrigin.RUNTIME_RECONSTRUCTED
      NEVER applies; NEVER cross-dedups
  HubRuntimeHost / RemoteRuntimeHost (canonicalAvailable=false) =
      FALLBACK_APPLY
      increments fallbackReconstructedApplied
      scoped dedup (sessionId:runId:baseEdge)
      records with origin = RUNTIME_RECONSTRUCTED

HOST_TASK:
  authoritative for host-only task semantics
  always APPLY (unconditional)
  records with origin = HOST_TASK

HOST_RECOVERY:
  LocalRuntimeHost (canonicalAvailable=true) =
      DIAGNOSTIC_ONLY
      increments observationsDiagnosticByOrigin.HOST_RECOVERY
  HubRuntimeHost / RemoteRuntimeHost (canonicalAvailable=false) =
      FALLBACK_APPLY
      increments fallbackRecoveryApplied

WEBVIEW_CUTOVER           = false
EFFECT_EXECUTION_ENABLED  = false
DIVERGENCE_ACTION         = RECORD_ONLY
```

No consumer sees TaskState as authority during C2.3.

---

## 2. Carry-forward corrections from C2.2-CORRECTION02

Two C2.2-CORRECTION02 evidence lines are wrong:

```text
WAS: CANONICAL_THEN_RECONSTRUCTED_MUTATIONS = 0
NOW: CANONICAL_THEN_RECONSTRUCTED_MUTATIONS = 1
     (one canonical mutation; reconstructed was DIAGNOSTIC_ONLY)

WAS: LEGACY_AUTHORITY = 0%
NOW: LEGACY_AUTHORITY = 100%   (no cutover has occurred)
```

Both are visible in the predecessor digest. C2.3 inherits the
corrected form.

---

## 3. Three mandatory C2.3 carry-forward items (close in C2.3)

### C23-R1 — true one-coordinator sequential-session fallback witness

Add a new witness using ONE coordinator with no `debugReset()`:

```text
activeSession = A
fallback run-started: session=A, run=run-A → APPLY

activeSession = B
fallback run-started: session=B, run=run-B → APPLY

eventsObserved = 2
suppressed     = 0

session=B, run=run-B, same edge → SUPPRESS_DUPLICATE
```

This closes actual cross-session resolver-state qualification.

### C23-R2 — truthful fallback counters (closed in C2.3-C2a)

```text
fallbackReconstructedApplied: RUNTIME_RECONSTRUCTED fallback APPLY count
fallbackRecoveryApplied:      HOST_RECOVERY fallback APPLY count
```

Mutually exclusive per coordinator dispatch.

### C23-R3 — host coverage honesty

Frozen scope statement:

```text
LocalRuntimeHost:
  production canonical path = QUALIFIED

HubRuntimeHost:
  fallback logic = IMPLEMENTED + UNIT TESTED
  production wiring = NOT QUALIFIED

RemoteRuntimeHost:
  fallback logic = IMPLEMENTED + UNIT TESTED
  production wiring = NOT QUALIFIED
```

C2.3 unit-tests Hub/Remote fallback paths through the coordinator,
but explicitly labels them "not production wiring" — E7 decisions
come later.

---

## 4. Qualified host scope

```text
QUALIFIED_E5_E6_HOST_SCOPE =
  LocalRuntimeHost canonical path
  HubRuntimeHost / RemoteRuntimeHost unit-tested fallback
```

C2.4 will qualify the LocalRuntimeHost production surface.

---

## 5. W01–W16 semantic goals (stateful sequence contract)

Each W is an ORDERED `WorkloadStep[]`. Every step carries the
facts valid AT THAT INSTANT — `legacyPhase`, `arbiterSnapshot`,
`activeSessionId`, `lifecycle` — so a frozen replay produces the
same terminal state every time.

```
W01   text-only run             task_requested → canonical run
                                  → host-pre-engaged D11
                                  → modelStreaming false→true
                                  → modelStreaming true→false
                                  → canonical run completion
                                  terminal lifecycle=completed

W02   text + reasoning          text + reasoning on legacy stream
                                  reasoning prose must NOT mutate
                                  canonical execution owns streaming

W03   one tool                  tool-started(tc1) → tool-finished(tc1)
                                  activeToolCallIds: []→[tc1]→[]
                                  completedTools counter += 1 exact

W04   parallel tools            [] → [tc1] → [tc1,tc2] → [tc2] → []
                                  finishing tc1 while tc2 active
                                  does NOT clear tooling

W05   approval allow            awaitingApproval false→true→false
                                  approval_requested = exactly 1
                                  approval_resolved  = exactly 1

W06   approval deny             awaitingApproval false→true→false
                                  terminal lifecycle frozen
                                  by production adapter semantics

W07   cancellation in stream    task_cancelled while streaming
                                  task_cancelled BEFORE run completion
                                  terminal lifecycle per contract
                                  late stream-finish events are stale

W08   cancel tool active        tool-started(tc1)
                                  task_cancelled
                                  late tool-finished(tc1) stale
                                  active-tool invariant holds

W09   provider/runtime failure  terminal lifecycle=failed
                                  late events cannot reactivate

W10   recovery episode          canonical recovery APPLY'd exactly 1
                                  host recovery DIAGNOSTIC_ONLY
                                  evidenceGaps=0 observerErrors=0

W11   same-task continuation    visibleTaskId unchanged
                                  runtime session/run changed
                                  run 2 NOT suppressed by run 1
                                  reconstructed run 2 diagnostic only

W12   brand-new task (Model A)  task A completes → task_reset
                                  legacy initializes B
                                  task_requested(B)
                                  canonical session/run B begins
                                  B != A; no collision

W13   stale after completion    late canonical activity
                                  → IGNORED_STALE
                                  no lifecycle reactivation

W14   stale after cancel        late activity after cancel
                                  same_task_continued remains
                                  only valid exit

W15   C04 synthetic legacy false idle
                                  reconstructed is DIAGNOSTIC_ONLY
                                  canonical owns TaskState truth
                                  C04_SYNTHETIC = PASS
                                  C04_REAL_CAPTURE = NOT_TESTED_HERE

W16   awaiting follow-up        origin=HOST_TASK only D08 records
                                  never reconstructed-origin authoritative
```

---

## 6. Hard forbidden divergence classes

Throughout C2.3, `D10_UNKNOWN === 0` for every valid workload.

Stale-session, duplicate-mutation, and cross-dedup defects are
forbidden (each has explicit witnesses).

---

## 7. Expected counts (deterministic, NOT `toBeGreaterThan(0)`)

Every workload asserts EXACT expected counts for:

```text
EXPECTED_APPLIED_TRANSITIONS
EXPECTED_RECORDS
EXPECTED_DIAGNOSTIC_OBSERVATIONS
EXPECTED_SUPPRESSIONS
EXPECTED_FALLBACK_APPLIES
EXPECTED_ORIGIN_COUNTS (per origin)
EXPECTED_D00..D11_COUNTS
evidenceGaps = 0
observerErrors = 0
invariantViolations = 0
D10_UNKNOWN = 0
```

After trace-freeze (C3.2), exact counts are deterministic from
typed inputs only.

---

## 8. Universal hard gates (every W01–W16)

```text
INVARIANT_VIOLATIONS = 0
D10_UNKNOWN          = 0
OBSERVER_ERRORS      = 0
EVIDENCE_GAPS        = 0
STALE_SESSION_MUTATIONS = 0
DUPLICATE_CANONICAL_RECONSTRUCTED_MUTATIONS = 0
DUPLICATE_RECOVERY_MUTATIONS                = 0
LOCAL_RECONSTRUCTED_MUTATIONS               = 0
PRIVACY_VIOLATIONS = 0
```

---

## 9. Fallback qualification (F01–F03)

```text
F01: one coordinator, fallback, sequential sessions (C23-R1)
F02: one coordinator, fallback, same session, sequential runIds
F03: exact duplicate same session/run/edge → SUPPRESS_DUPLICATE
```

Use `canonicalAvailable=false`. These are coordinator/fallback
qualification tests, NOT claims that Hub/Remote production wiring
is proven.

---

## 10. Replay / determinism

For each deterministic W:

```text
typed TaskMsg sequence
  → live shadow
  → pure TaskState.update() replay
final state equivalent
```

Three consecutive runs must produce identical typed counts.

---

## 11. Bounded recorder

At least one long stateful workload exceeds `MAX_RECORDS_PER_TASK =
256`. Require:

```text
retained records <= 256
eventsObserved > 256
droppedRecords correct
aggregate divergence / origin counters correct
```

No new history store.

---

## 12. Expected production delta

```text
git diff --numstat ed8ed94ce..HEAD -- <production paths>
  semantic production LOC = 0
  allowed <= 50 net LOC instrumentation cleanup
```

Baseline at C2.3-C2a is +5 net (the recorder counter split).

---

## 13. Halt conditions (subset)

The full halt list is in the predecessor ACT §48. Critical subset:

```text
H2  invariantViolations > 0
H3  D10_UNKNOWN > 0
H4  evidenceGaps > 0
H5  observerErrors > 0
H6  one semantic edge mutates shadow twice
H7  reconstructed Local event mutates TaskState
H8  stale session event mutates TaskState
H16 new TS error
H17 protected stash changes
H19 C2.3 begins wiring Hub/Remote fallback as incidental scope creep
```

---

## 14. C2.4 authorization gate

```text
VERDICT                      = PASS_STATEFUL_WORKLOAD_QUALIFICATION_C2_3
C2_4_AUTHORIZED              = true   (only if every W01–W16 + F01–F03 + replay + bounded passes)
E7_AUTHORIZED                = false  (gated on C2.4)
SEMANTIC_PRODUCTION_DELTA    = 0
NEW_TS_ERRORS                = 0
PROTECTED_STASHES_INTACT     = true
THREE_RUN_DETERMINISM        = PASS
```

---

## 15. Board

```text
ELM-02F  F0/F0-CORR01/F1/F1-CORR01..03  ✅
ELM-02C2 C2.0/C2.1/C2.2 + CORR01 + CORR02 ✅
ELM-02C2 C2.3 stateful W01-W16            🟢 ACTIVE (this ACT)

ELM-02C2 C2.4 production qualification  ⛔
ELM-02C2 C2.5 real E6 dogfood           ⛔

ELM-03 E7                               ⛔
```
