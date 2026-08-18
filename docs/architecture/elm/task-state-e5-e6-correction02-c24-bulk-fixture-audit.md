# C2.4-B-FIXUP01 — C2.3 stateful workloads bulk fixture audit (R4)
ACT: ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-B-FIXUP01
Subject commit: `adbb5e2d5`
File audited: `apps/vscode/src/sdk/__tests__/task-state-shadow-correction02-c23-stateful-workloads.test.ts`

Total NEW `set-active-session` insertions in adbb5e2d5: **24**

The insertions precede the first `canonical` step in the same `it(...)`
block or `buildWNNSteps(...)` function. They mirror the production
lifecycle where the canonical event sessionId equals the active session.
They affect ONLY the live run; the pure replay
(`runPureReplayCanonicalOnly`) does not consult the wiring session guard.

## Insertion map

```
# line  workload_or_it                          sessionId
# ----  --------------------------------------  ----------------
  543    W01 inline steps (describe at line 523)  session-17
  627    W02 inline steps (describe at line 602)  session-1
  715    W03 inline steps (describe at line 690)  session-1
  788    W04 inline steps (describe at line 757)  session-1
  873    W05 inline steps (describe at line 845)  session-W05
  982    W06 inline steps (describe at line 962)  session-W06
  1662   W07 inline steps (describe at line 1642) session-W07
  1784   W08 inline steps (describe at line 1762) session-W08
  5379   buildW01Steps                            session-17
  5438   buildW02Steps                            session-1
  5508   buildW03Steps                            session-1
  5571   buildW04Steps                            session-1
  5645   buildW05Steps                            session-W05
  5719   buildW06Steps                            session-W06
  5782   buildW07Steps                            session-W07
  5863   buildW08Steps                            session-W08
  5924   buildW09Steps                            s-canon
  5959   buildW10Steps                            s-canon
  5987   buildW11Steps                            session-17
  6084   buildW12Steps                            session-17
  6200   buildW13Steps                            session-W13
  6272   buildW14Steps                            session-W14
  6337   buildW15Steps                            session-W15
  6405   buildW16Steps                            session-W16
```

## Cross-check

```
additions in adbb5e2d5 (line count)    = 24
inline describe-it insertions          = 8  (W01-W08)
buildWNNSteps insertions               = 16 (W01-W16)
total                                  = 24 (matches line count) ✓

Pre-existing `set-active-session` usages (present in adbb5e2d5^ and
UNCHANGED by this commit; documented for completeness):
  - 2 in C2.3-CONT.2-CORRECTION04 staleness witnesses (C8.1 R1, C9.4)
  - 8 in C2.3-CONT.4 W11 (4 it-blocks * 2 sessions)
  - 7 in C2.3-CONT.4 W12 (7 it-blocks)
  - 8 in C2.3-CONT.4-CORRECTION01 C9 fence witnesses (4 tests * 2 sessions)
  - 3 in C2.3-CONT.6 PURE_REPLAY_EQUIVALENCE
  - 3 in C2.3-CONT.6 BOUNDED_RECORDING
  - 4 in C2.3-CONT.5 W13/W14/W15/W16 inline (4 it-blocks)
  - 1 in C2.3-CONT.6 W06_REAL_DENY inline (1 it-block)
  + the WorkloadStep union-type variant at line 121
```

## Placement semantics

Each new `set-active-session` step is inserted IMMEDIATELY after the
`host-task` step of its workload, BEFORE the first canonical event.
The harness runStep routes `set-active-session` to
`state.activeSessionId = step.sessionId`, which the wiring
`getActiveSession()` fixture reads once per event. Placement preserves
the temporal ordering of the original scenario: the host-task
`requested` step still arrives first, then the active session is
declared, then the canonical events proceed against the declared session.

## Verification

```
git diff --check                          = PASS
focused test sweep (post-FIXUP01)        = 60/60 tests PASS
                                            B1-B9, F1-CORRECTION01+03,
                                            stateful-workloads, benchmark
full sdk/__tests__/ sweep                 = 214/214 tests PASS
REDUCER_SEMANTIC_DELTA                    = 0
C2.3 not reopened                         = YES
```
