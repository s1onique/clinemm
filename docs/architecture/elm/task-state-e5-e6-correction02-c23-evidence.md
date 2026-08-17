# C2.3 — STATEFUL WORKLOAD QUALIFICATION EVIDENCE (partial W01–W04)

```text
ACT =
ACT-CLINEMM-ELM-ARCHITECTURE01-
E5-E6-SHADOW-DIFFERENTIAL01-
CORRECTION02-C2.3

PARENT_ACT =
ACT-CLINEMM-ELM-ARCHITECTURE01-
E5-E6-SHADOW-DIFFERENTIAL01-
CORRECTION02-C2.2-CORRECTION02

ACT_PLAN  = ff2c053ed... (C2.3-C1 plan/freeze)
ACT_C2A   = ed8ed94ce... (recorder counter split / C23-R2)
ACT_C2    = 64deb36a7... (harness + W01 baseline)
ACT_C3    = 88c2c0b18... (W01-W04 qualification)
THIS_HEAD = THIS-COMMIT

BRANCH     = act/elm-architecture01-e0-e4
WORKTREE   = clean

PROTECTED_STASHES:
  FORENSIC_STASH_OBJECT = 141372c52ddd560f8d65bd438d9f9c22ba0f1f85
  CONTEXT_STASH_OBJECT  = 371752f71e5b9a385af32736e007540386d48b82
```

---

## 0. HONEST VERDICT

```
W01..W04            = PASS (4/16 workloads)
W05..W16            = NOT QUALIFIED (12 remaining)
F01..F03            = NOT QUALIFIED
Bounded recorder    = NOT QUALIFIED
Pure reducer replay = NOT QUALIFIED
Three-run determinism = NOT QUALIFIED

C2_3_VERDICT         =
  PARTIAL_STATEFUL_QUALIFICATION_C2_3_W01_TO_W04

C2_4_AUTHORIZED      = false
E7_AUTHORIZED        = false

NEXT = ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-
        CORRECTION02-C2.3-CONT (continuation of W05-W16)
```

This ACT established the workload harness and proved four W
scenarios GREEN. It does NOT establish authorization for C2.4.
The remaining 12 W workloads plus F01-F03 plus the bounded
recorder and replay gates are documented as explicit
continuation work, not silently deferred.

Per the predecessor ACT halt conditions:

```
H1  production semantic change is needed to make a workload pass
```

None of W01-W04 required production changes. The remaining W
workloads that were NOT completed need their exact counts
trace-frozen before pinning; that work belongs in the
continuation ACT, not in this one.

---

## 1. What was built

### C2.3-C1 — C2.3 plan/freeze doc
File: `docs/architecture/elm/task-state-e5-e6-correction02-c23-plan.md`
(414 lines)

Freeze of:
- Authority model (canonical authority, OPTION_A for LocalRuntimeHost)
- Qualified host scope = LocalRuntimeHost
- C23-R1/R2/R3 carry-forward items
- W01-W16 semantic goals (stateful sequence contract)
- Hard forbidden divergence classes
- Halt conditions
- C2.4 authorization gate

### C2.3-C2a — Recorder counter split (C23-R2)
Files:
- `apps/vscode/src/sdk/task-state-shadow-recorder.ts`
- `apps/vscode/src/sdk/task-state-shadow-coordinator.ts`
- `apps/vscode/src/sdk/__tests__/task-state-shadow-correction02-c22-correction01.test.ts`

Adds `fallbackReconstructedApplied` counter (per C23-R2 split).
`FALLBACK_APPLY` branch in the unified coordinator now dispatches
the increment by `input.origin`. R7.3 witness updated to assert
the new counter (and that `fallbackRecoveryApplied` is NOT
incremented for runtime-reconstructed fallback).

Net production LOC: +6 / -1 = +5.

### C2.3-C2 — Stateful workload harness
File:
`apps/vscode/src/sdk/__tests__/task-state-shadow-correction02-c23-stateful-workloads.test.ts`

WorkloadStep discriminated union:
- canonical    → wiring.observeCanonicalRuntimeEvent(...)
- legacy       → sessionOptions.onSessionEvent(...)
- host-task    → emitTask{Requested|Cancelled|Reset|SameTaskContinued}
- host-recovery → coordinator.observe({kind: "host-recovery"})
- set-active-session / set-active-run / checkpoint

Plus:
- Snapshot fixture helpers
- execEvent / recoveryEvent / runStarted / turnFinished / toolStarted / toolFinished
- arbiterOf / legacyEnvelope
- assertCheckpoint / hardGates

NEVER mutates comparator / recorder / coordinator directly.
Reads back via wiring.records() / wiring.recorderCounts() /
wiring.comparator.debugSnapshot().

### C2.3-C3 — W01-W04 qualification
- W01 text-only streaming run with D11 host-pre-engaged interval
- W02 reasoning/text on legacy stream (zero mutation by design)
- W03 one tool (activeToolCallIds [], [tc1], [])
- W04 parallel tools (toolCalls=2; final activeToolCallIds=[])

All 4 PASS.

---

## 2. Production semantic delta

```
git diff --numstat ff2c053ed..HEAD -- apps/vscode/src/sdk/production paths

Production semantic delta   = 0 net change
Allowed instrumentation     = +5 LOC (C23-R2 counter split)
Test/harness additions      = +172 LOC workload W02-W04,
                               +416 LOC harness + W01 (C2.3-C2 commit)
                               +5 LOC recorder + 1 LOC coordinator dispatcher
Documentation               = +414 LOC plan, +~280 LOC this evidence
```

The +5 recorder/coordinator LOC is the `fallbackReconstructedApplied`
counter split. No semantic behavior change.

---

## 3. Hard gates (W01-W04)

```
INVARIANT_VIOLATIONS        = 0  (every W01-W04)
EVIDENCE_GAPS               = 0  (every W01-W04)
OBSERVER_ERRORS             = 0  (every W01-W04)
D10_UNKNOWN                 = 0  (every W01-W04)
LOCAL_RECONSTRUCTED_MUTATIONS = 0 (every W01-W04)
PRIVACY_VIOLATIONS          = 0  (every W01-W04; assertions match
                                  the structural privacy test for the
                                  recorder)
```

The remaining W05-W16 workloads were NOT exercised in this ACT.

---

## 4. Carry-forward corrections (inherited from C2.2-CORRECTION02)

Per the predecessor ACT §2 / §3:

```
CORRECTION PREVIOUS      :
  CANONICAL_THEN_RECONSTRUCTED_MUTATIONS = 0   (WRONG)
  LEGACY_AUTHORITY = 0%                      (WRONG)

CORRECTION CURRENT       :
  CANONICAL_THEN_RECONSTRUCTED_MUTATIONS = 1
  LEGACY_AUTHORITY    = 100%   (no cutover has occurred)
  SHADOW_AUTHORITY    = 0%
  TASKSTATE_AUTHORITY = 0%
```

These inherit into this ACT and are NOT reset by it.

---

## 5. C23 carry-forward items

### C23-R1 — one-coordinator sequential-session fallback witness

NOT YET BUILT. Requires a separate test under
`canonicalAvailable=false`. The harness supports it (the W01-W04
tests use `buildWiring({canonicalAvailable: true})`; F01 will
override to `false`), but F01 was not added in this ACT.

Continuation commitment: required before C2.4.

### C23-R2 — truthful fallback counters

CLOSED (see C2.3-C2a). `fallbackReconstructedApplied` and
`fallbackRecoveryApplied` are mutually exclusive per coordinator
dispatch.

### C23-R3 — host coverage honesty

Respectable in this ACT:
- Tests in this ACT exercise the canonical LocalRuntimeHost path.
- No HubRuntimeHost / RemoteRuntimeHost production wiring tests
  added in this ACT.
- E7 contract remains: LocalRuntimeHost qualified, Hub/Remote
  unit-tested fallback only, E7 gated on C2.4+ decisions.

---

## 6. Halt conditions check

```
H1  production semantic change is needed to make a workload pass
     (W01-W04 did not need it; no scope beyond W04 exercised)
H2  invariantViolations > 0
     NOT TRIGGERED for W01-W04
H3-H22 not triggered in this ACT
```

---

## 7. Test totals

```
@cline/core       : 516 passed (unchanged)
@cline/vscode focused C23 suite : 4 passed (W01-W04)
@cline/vscode other suites       : unchanged from C2.3-C2a baseline
@cline/vscode full vitest         : 1427 + 4 = 1431 passed,
                                     9 failed (8 pre-existing
                                     historical RED, 1 sdk-task-control
                                     pre-existing baseline)
```

**Typecheck**: vscode 16 → 16 (0 new errors).

---

## 8. Active board

```
ELM-02F F0/F0-CORR01/F1/F1-CORR01..03  ✅
ELM-02C2 C2.0/C2.1                      ✅
ELM-02C2 C2.2 + CORR01 + CORR02         ✅
ELM-02C2 C2.3 stateful W01-W04          🟨 partial (4/16)

ELM-02C2 C2.3 stateful W05-W16          🟧 NOT STARTED in this ACT
ELM-02C2 C2.3 fallback F01-F03          🟧 NOT STARTED in this ACT
ELM-02C2 C2.3 replay + bounded + 3x     🟧 NOT STARTED in this ACT

ELM-02C2 C2.4 production qualification  ⛔
ELM-02C2 C2.5 real E6 dogfood           ⛔

ELM-03 E7                               ⛔
```

---

## 9. Continuation ACT (NEXT)

This ACT is intentionally NOT closing C2.2-CORRECTION02 →
C2.4. The remaining W workloads and F01-F03 require substantial
fixture work (failure / recovery / cancellation / approval
modeling) that did not fit in this ACT's evidence window.

The continuation ACT will:

1. Qualify W05-W16 using the same WorkloadStep harness.
2. Add F01-F03 under `canonicalAvailable=false`.
3. Add the long bounded-recording workload.
4. Add pure-reducer replay equivalence tests.
5. Run three consecutive runs and require deterministic
   exact counts.
6. Re-baseline the historical T1-T12 file at the new HEAD.
7. Either:
   (a) PASS all 16 W + F01-F03 + replay + bounded + 3x
       → C2_4_AUTHORIZED = true, OR
   (b) HALT and create a smaller correction ACT.

```
NEXT =
ACT-CLINEMM-ELM-ARCHITECTURE01-
E5-E6-SHADOW-DIFFERENTIAL01-
CORRECTION02-C2.3-CONT
(CONT = CONTINUATION)
```

---

## 10. Protected stash gate

```
FORENSIC_STASH_OBJECT = 141372c52ddd560f8d65bd438d9f9c22ba0f1f85  (intact)
CONTEXT_STASH_OBJECT  = 371752f71e5b9a385af32736e007540386d48b82  (intact)
```

Both preserved unchanged through every commit in this ACT.
