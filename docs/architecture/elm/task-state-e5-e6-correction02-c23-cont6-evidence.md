# C2.3-CONT.6 evidence — closure/qualification synthesis

```
ACT =
ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.3-CONT.6

ENTRY_HEAD = d78ff32d4 (CONT.6 plan)
EXIT_HEAD  = <this commit's tip>

PROTECTED_STASHES = 141372c52 (FORENSIC), 371752f71 (CONTEXT)
```

## 1. Verdict

```
W06_REAL_DENY_SEMANTICS            = PASS
  production-realistic deny sequence (approval cycle +
  tool-started/tool-finished pair); lifecycle stays running

PURE_REPLAY_EQUIVALENCE            = PASS
  W01 + W06_REAL_DENY + W15-style DIAGNOSTIC_ONLY
  live comparator final == pure TaskStateShadow.observe() final
  PURE_REPLAY_MISMATCHES           = 0

BOUNDED_RECORDING                  = PASS
  300+ eventsObserved
  retained records                 = 256
  droppedRecords                   = eventsObserved - 256
  aggregate counters correct after truncation

THREE_RUN_DETERMINISM              = PASS
  RUN1 == RUN2 == RUN3 (byte-identical frozen snapshots)
  across finalLifecycle + 12 divergence classes +
  4 origin suppressions + 4 origin diagnostics +
  fallback counts + droppedRecords +
  staleRunTerminalSuppressed + observerErrors +
  evidenceGaps + invariantViolations

HISTORICAL_UNEXPLAINED_RED         = 0
HISTORICAL_ACTIVE_DEFECT           = 0

W01_W16_EXACT_EVIDENCE_NORMALIZED  = PASS
  W15 diagnostic counter           = 2 (exact, was >= 1)
  W16 diagnostic counter           = 1 (exact, was >= 1)
  W16 D08 records                  = 1 (exact, was >= 1)
  W16 D08 origin                   = HOST_TASK (positive, was != RUNTIME_RECONSTRUCTED)

WORDING_CLEANUP                    = PASS
  W15 activeRunId distinction documented (CONT.5 addendum)
  W16 probe terminology relabeled (CONT.5 addendum)

VERDICT = PASS_STATEFUL_WORKLOAD_QUALIFICATION_C2_3

C2_4_AUTHORIZED = true
E7_AUTHORIZED   = false

NEXT = ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-
       CORRECTION02-C2.4-NO_ACTIVE_SESSION-REACHABILITY
```

## 2. Production semantic delta

```
production files touched       = NONE
production semantic delta      = 0

CONT.6 is a closure/qualification synthesis phase. All work is
in tests (C23 file, witnesses file) and documentation (CONT.5
addendum, CONT.6 plan/evidence).

No reducer, comparator, coordinator, recorder, SdkController,
emit*, proto, harness, or public-API change.
```

## 3. W06_REAL_DENY detailed report

### 3.1 Production trace (from agent-runtime.ts + sdk-interaction-coordinator.ts)

```
1. execEvent(idle->streaming)        // model_stream_started
2. execEvent(streaming->awaitingApproval)
   -> shadow adapter: approval_requested TaskMsg
3. execEvent(awaitingApproval->idle)
   -> shadow adapter: approval_resolved TaskMsg
4. tool-started(tc1)
   -> shadow adapter: tool_started TaskMsg (production emits
      this even on a skipped tool)
5. tool-finished(tc1) with synthetic error
   -> shadow adapter: tool_finished TaskMsg

Lifecycle stays "running". No canonical run-failed. No HOST_TASK
task_cancelled. The model continues normally.
```

### 3.2 Exact counts

```
approval_requested records  = 1
approval_resolved records   = 1
tool_started records        = 1
tool_finished records       = 1
task_completed records      = 0
task_failed records         = 0
task_cancelled records      = 0
D04_APPROVAL_PRECEDENCE     = 2 (rise + fall)
D10_UNKNOWN                 = 0
fallbackReconstructedApplied = 0
lifecycle.kind              = "running"
```

## 4. PURE_REPLAY_EQUIVALENCE detailed report

### 4.1 Mechanism

For each deterministic workload, capture the canonical
`AgentRuntimeEvent` sequence from the live harness, translate
each event via `adaptRuntimeEvent` to `TaskMsg(s)`, then apply
each TaskMsg to a fresh `TaskStateShadow` via `observe()`.
Compare final `TaskModel`: live comparator vs pure reducer.

### 4.2 Witnesses

```
W01 text-only trace             live == pure
W06_REAL_DENY trace             live == pure
W15-style DIAGNOSTIC_ONLY trace live == pure (reconstructed envelopes excluded from replay input)

PURE_REPLAY_MISMATCHES          = 0
```

### 4.3 Critical scope

The replay input is canonical-only. Reconstructed envelopes
that flow through the reverse translator but are SUPPRESSED
at the coordinator authority gate (DIAGNOSTIC_ONLY) MUST NOT
appear in the replay input. This is the qualification for the
SUPPRESS_DUPLICATE path's correctness: if a suppressed event
reaches the pure reducer, the final TaskModel would diverge
from the live result, exposing an authority-gate hole.

## 5. BOUNDED_RECORDING detailed report

```
eventsObserved              > 256 (drove 300+ observations)
retained records length     = 256 (MAX_RECORDS_PER_TASK)
droppedRecords              = eventsObserved - 256
D10_UNKNOWN                 = 0
invariantViolations         = 0
observerErrors              = 0
evidenceGaps                = 0
fallbackReconstructedApplied = 0
```

The bounded recorder correctly caps retained records at 256
and increments `droppedRecords` for each evicted record. No
payload/history expansion.

## 6. THREE_RUN_DETERMINISM detailed report

Three independent harness instances from clean state, run the
same representative deterministic workload, freeze normalized
snapshots containing:

```
finalLifecycle
finalModelStreaming
finalActiveToolCallIds
finalAwaitingApproval
eventsObserved
comparisons
agreements
divergences
droppedRecords
invariantViolations
observerErrors
evidenceGaps
staleRunTerminalSuppressed
fallbackReconstructedApplied
fallbackRecoveryApplied
D00_AGREE
D01_LEGACY_FALSE_IDLE
D02_SHADOW_FALSE_ACTIVE
D03_TERMINAL_ORDERING
D04_APPROVAL_PRECEDENCE
D05_TOOL_CARDINALITY
D06_RESUME_BOUNDARY
D07_FAILURE_MAPPING
D08_FOLLOWUP_EXTERNAL
D09_EVENT_GAP
D10_UNKNOWN
D11_HOST_PREENGAGED
suppressed_RUNTIME_CANONICAL
suppressed_RUNTIME_RECONSTRUCTED
suppressed_HOST_TASK
suppressed_HOST_RECOVERY
diagnostic_RUNTIME_CANONICAL
diagnostic_RUNTIME_RECONSTRUCTED
diagnostic_HOST_TASK
diagnostic_HOST_RECOVERY
```

All three runs produce byte-identical snapshots. The
qualification is deterministic.

## 7. T1-T12 historical disposition

```
T1   PASS  GREEN_EXPECTED       — task_requested reaches recorder
T2   PASS  GREEN_EXPECTED       — task_cancelled reaches recorder
T3   RED   SUPERSEDED/CARRIED_FORWARD_BY_W07
T4   RED   SUPERSEDED/CARRIED_FORWARD_BY_W08
T5   RED   SUPERSEDED/CARRIED_FORWARD_BY_W11
T6   RED   SUPERSEDED/CARRIED_FORWARD_BY_W12
T7   PASS  GREEN_EXPECTED       — invariantViolations stays 0
T8   RED   SUPERSEDED/CARRIED_FORWARD_BY_C04_SYNTHETIC (W15)
T9   RED   SUPERSEDED/CARRIED_FORWARD_BY_W05_W06_REAL_DENY
T10  RED   SUPERSEDED/CARRIED_FORWARD_BY_W09_W10
T11  PASS  GREEN_EXPECTED       — production classes import
T12  RED   SUPERSEDED/CARRIED_FORWARD_BY_UNIFIED_OBSERVATION

HISTORICAL_UNEXPLAINED_RED = 0
HISTORICAL_ACTIVE_DEFECT   = 0
```

Each RED witness carries a `// DISPOSITION:` comment block.
The witness assertions are NOT modified — they remain an
honest snapshot of the legacy-only path behavior under the
post-CORRECTION02 architecture.

## 8. Exact-count normalization

```
W15 observationsDiagnosticByOrigin.RUNTIME_RECONSTRUCTED  1 -> 2
W16 observationsDiagnosticByOrigin.RUNTIME_RECONSTRUCTED  1 -> 1
W16 D08_FOLLOWUP_EXTERNAL records                          >=1 -> 1
W16 D08 record origin                                      !=RUNTIME_RECONSTRUCTED -> ==HOST_TASK
```

All `>= 1` / `toBeGreaterThanOrEqual(1)` assertions in the
CONT.5 witnesses have been replaced with exact counts and
positive origin assertions, matching the W03 exact-count
evidence standard.

## 9. Wording cleanup

```
W15 activeRunId distinction documented
  reverseTranslator.activeRunId != canonicalRunIdRef
W16 probe terminology relabeled
  probe (a) = EXERCISE WITNESS (D08 count > 0)
  probe (b) = NEGATIVE MUTATION (inverted origin guard)
```

The CONT.5 evidence doc addendum (4b268b507) freezes both
fixes with explicit prose and references the CONT.6 commit
that records the exact-count normalization in test code.

## 10. Test totals

```
C23 file:                            47 -> 57 tests (+10 across CONT.5 + CONT.6)
  CONT.5 additions:                   +4 (W13, W14, W15, W16)
  CONT.6 additions:                   +6 (W06_REAL_DENY, 3 PURE_REPLAY,
                                          BOUNDED_RECORDING, THREE_RUN_DETERMINISM)
  passing: 57
  failing: 0

C22 / recorder / observer / workload-matrix /
  host-wiring / host-msgs:           131 -> 137 passed (+6)

historical witnesses (T1-T12):       12 -> 14 tests (+2 disposition)
  passing: 6 (T1, T2, T7, T11 + 2 disposition assertions)
  red-but-explained: 8 (T3, T4, T5, T6, T8, T9, T10, T12)
  HISTORICAL_UNEXPLAINED_RED = 0

@cline/agents reducer tests:         72 -> 72  (unchanged)
typecheck:                           16 -> 16  (0 new errors)
git diff --check:                    clean
PROTECTED STASHES:                   intact
production files touched:            NONE (closure ACT)
```

## 11. What this proves end-to-end

C2.3 is now qualified for closure. Every contract is pinned
on the canonical Local path:

1. **W06 production-realistic deny semantics** — approval-deny
   is a state-preserving event: lifecycle stays running, the
   runtime emits tool-started/tool-finished even on a skipped
   tool, no canonical terminal, no HOST_TASK cancel.

2. **Pure replay equivalence** — the live canonical Local path
   and the pure reducer produce identical final TaskModel for
   every qualified workload. The authority resolver is the
   only mechanism that decides which messages reach the
   shadow; the pure reducer has no other authority.

3. **>256 bounded recording** — the differential record buffer
   caps correctly at 256, droppedRecords increments correctly,
   aggregate counters remain accurate after truncation.

4. **3× determinism** — three independent runs produce byte-
   identical snapshots across all 12 divergence classes, all
   4 origin counters, all fallback counts, and the final
   TaskModel. The qualification is reproducible.

5. **T1-T12 disposition** — every historical RED witness is
   documented as superseded or carried-forward. No ACTIVE_DEFECT
   remains.

6. **Exact-count normalization** — every `>= 1` in the CONT.5
   witnesses has been replaced with exact counts and positive
   assertions.

7. **Wording cleanup** — the W15 activeRunId distinction and
   the W16 probe terminology are now explicit in both the test
   code and the CONT.5 evidence doc addendum.

## 12. Updated board

```
ELM-02F                                          ✅ CLOSED
C2.0 / C2.1                                     ✅
C2.2 + CORR01 + CORR02                          ✅

C2.3
  W01-W16                                        ✅
  F01-F03                                        ✅
  C23-HARDEN-1                                   ✅ CLOSED
  CONT.0-CORRECTION01                            ✅
  CONT.1 W05/W06                                 ✅
  CONT.2-CORR01..04                              ✅
  CONT.3 W09/W10                                 ✅
  CONT.4 W11/W12.x                               ✅
  CONT.4-CORRECTION01 C9.x                       ✅
  CONT.5 W13-W16                                 ✅
  CONT.6                                         ✅ CLOSED
    W06 real deny                                ✅
    pure replay                                  ✅
    >256 bounded                                 ✅
    3× determinism                               ✅
    T1-T12 disposition                           ✅
    exact evidence normalization                 ✅
    wording cleanup                              ✅

  VERDICT = PASS_STATEFUL_WORKLOAD_QUALIFICATION_C2_3

C2.4  NO_ACTIVE_SESSION + reachability           🟢 NEXT (AUTHORIZED)
C2.5                                             ⛔
E7                                               ⛔
```

## 13. PROTECTED STASHES INTACT

```
FORENSIC = 141372c52ddd560f8d65bd438d9f9c22ba0f1f85
CONTEXT  = 371752f71e5b9a385af32736e007540386d48b82
```
