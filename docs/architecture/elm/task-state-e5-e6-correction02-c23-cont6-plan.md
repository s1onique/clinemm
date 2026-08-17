# C2.3-CONT.6 plan — closure/qualification synthesis

```
ACT =
ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.3-CONT.6

ENTRY_HEAD = 8e918ce2c (CONT.5 evidence)
EXIT_HEAD  = <this commit's tip>

PROTECTED_STASHES = 141372c52 (FORENSIC), 371752f71 (CONTEXT)

CONT_6_AUTHORIZED = true (per CONT.5 evidence)
EXPECTED_PRODUCTION_SEMANTIC_DELTA = 0  (closure/synthesis ACT)
```

## 1. Mission

CONT.6 is the **closure/qualification synthesis phase** of C2.3. It is
not an architecture phase. Its work is:

1. **W06 real deny semantics** — determine the production-realistic
   approval-deny canonical sequence from
   `sdk/packages/agents/src/agent-runtime.ts` and
   `apps/vscode/src/sdk/sdk-interaction-coordinator.ts`, then refit
   the W06 fixture and freeze exact counts.
2. **Pure replay equivalence** — capture the typed `TaskMsg`
   sequence produced by live ingress, replay through the pure
   reducer, require identical final `TaskModel` and zero
   mismatches. Suppressed events must NOT appear in the replay
   input.
3. **>256 bounded recording** — drive more than
   `MAX_RECORDS_PER_TASK = 256` observations and verify the
   retained-records cap, `droppedRecords`, and aggregate counters
   remain correct after truncation.
4. **3× determinism** — run the entire deterministic workload
   qualification three times from clean harness state. Freeze a
   machine-safe normalized result and require byte-identical
   outputs across runs.
5. **T1–T12 disposition** — re-baseline each historical witness
   (`task-state-shadow-correction02-witnesses.test.ts`) against
   HEAD and classify each as one of:
   `ACTIVE_DEFECT`, `SUPERSEDED_NEGATIVE_WITNESS`,
   `HARNESS_FIXED`, `CARRIED_FORWARD_BY_NEW_WORKLOAD`. Do NOT edit
   historical tests merely to produce a green suite.
6. **Exact evidence normalization** — convert the
   `>= N`/`toBeGreaterThanOrEqual(...)` assertions in W13/W14/W15/W16
   (and as many W01–W12 as practical) to exact-count assertions.
7. **Wording cleanup** — fix the W15 `activeRunId` sentence in
   CONT.5 evidence to distinguish `reverseTranslator.activeRunId`
   from `canonicalRunIdRef`. Fix the W16 probe (a) terminology
   (exercise-witness vs negative-mutation).
8. **Decide C2.3 closure** — produce the final board + verdict
   whether C2.3 as a whole can authorize C2.4.

## 2. W06 real deny semantics

### 2.1 Production trace (from agent-runtime.ts + sdk-interaction-coordinator.ts)

```
requestToolApproval(toolCall, input, policy)
  raise executionAwaitingApproval = true
  emit execution-state-changed(awaitingApproval false → true)
    -> shadow adapter: approval_requested TaskMsg (canonical)
  await host approval callback
    host returns { approved: false, decision: {kind: "deny"}, reason }
  finally:
    clear executionAwaitingApproval = false
    emit execution-state-changed(awaitingApproval true → false)
      -> shadow adapter: approval_resolved TaskMsg (canonical)
  return { approved: false, decision, reason }

prepareToolExecution sees skipReason = "Tool was not approved"
executePreparedTool(prepared):
  result = { output: { error: skipReason }, isError: true }
  classifyToolRuntimeOutcome(...) -> kind="control_plane",
    controlPlaneOutcome = { hostDenied: true, userRejected: true }
  emit tool-started(snapshot, toolCall)
    -> shadow: tool-started TaskMsg
  emit tool-finished(snapshot, toolCall, {role:"tool", error: skipReason})
    -> shadow: tool-finished TaskMsg
  // run continues, model decides next step
```

Production semantics: **no canonical run-failed, no HOST_TASK
task_cancelled, lifecycle stays `running`, no tool result that
mutates the shadow's lifecycle**. The W06 fixture must mirror
this exactly.

### 2.2 Hard gates

```
lifecycle.kind              === "running"
activity.modelStreaming     === false
activity.activeToolCallIds  === []
activity.awaitingApproval   === false
approval_requested records  === 1  (the raise edge)
approval_resolved records   === 1  (the finally clear)
tool-started records        === 1  (canonical even though skipped)
tool-finished records       === 1
task_completed records      === 0
run_failed records          === 0
D04_APPROVAL_PRECEDENCE     === 1  (legacy awaiting_approval vs shadow idle)
D10_UNKNOWN                 === 0
fallbackReconstructedApplied === 0
eventsObserved              exact N
comparisons                 exact N
```

### 2.3 What this proves

The existing W06 fixture is essentially correct (lifecycle=running),
but it lacks the `tool-started` / `tool-finished` pair that the
runtime emits even on a skipped tool. CONT.6 freezes W06 against
the production-realistic canonical sequence with exact counts.

## 3. Pure replay equivalence

### 3.1 Mechanism

For each deterministic workload, drive the live ingress through the
canonical Local path harness (buildWiring with
`canonicalAvailable=true`) and capture the typed `TaskMsg` sequence
the comparator's shadow observes. Then replay through the pure
reducer `TaskState.update(model, msg, at)` directly, ignoring the
coordinator's authority gating.

Require:
```
live_ingress(coordinator.observe)    final TaskModel
==
pure_reducer(update(msg[]))           final TaskModel

PURE_REPLAY_MISMATCHES = 0
```

### 3.2 Critical scope: suppressed events

The pure reducer has no authority gate — every `TaskMsg` is applied.
The live ingress path can `SUPPRESS_DUPLICATE` or `DIAGNOSTIC_ONLY`
events, meaning those messages never reach the shadow.

Therefore the replay input must be:

```
live_ingress_applied_msgs = filter(coordinator.applyAndRecord(...).msg)
```

NOT the raw ingress event stream. Suppressed events (stale, dedup,
diagnostic) MUST NOT appear in the replay input. This is the
qualification for the SUPPRESS_DUPLICATE path's correctness: if a
suppressed event reaches the pure reducer, the final TaskModel would
diverge from the live result, exposing an authority-gate hole.

### 3.3 Hard gate

```
PURE_REPLAY_EQUIVALENCE = PASS
PURE_REPLAY_MISMATCHES  = 0
```

### 3.4 What this proves

The authority gating is the only authority for which messages
reach the shadow. Every APPLY'd message is replay-equivalent. No
APPLY'd message has hidden side effects (counters, dedup state)
that would not appear in a pure replay.

## 4. >256 bounded recording

### 4.1 Mechanism

Drive >256 observations through a single wiring. Verify:

```
eventsObserved              > 256
droppedRecords              = eventsObserved - MAX_RECORDS_PER_TASK
retained records length     === MAX_RECORDS_PER_TASK (256)
aggregate counters:
  divergenceCountsByClass   exact
  origin counters           exact
  diagnostic counters       exact
  fallback counts           exact
remain correct after truncation
```

### 4.2 Hard gate

```
BOUNDED_RECORDING                  = PASS
MAX_RETAINED_RECORDS               = 256
retained records length            = 256
droppedRecords                     = eventsObserved - 256
D10_UNKNOWN                        = 0 (no unclassified divergence)
INVARIANT_VIOLATIONS               = 0
OBSERVER_ERRORS                    = 0
EVIDENCE_GAPS                      = 0
```

### 4.3 What this proves

The bounded recorder is correct under stress. The oldest-record
drop policy (FIFO) does not corrupt aggregate counters. A load
test of the differential record path.

## 5. 3× determinism

### 5.1 Mechanism

Run the entire deterministic workload qualification (W01–W16) three
times from clean harness state. For each run, freeze:

```
final TaskModel         (per workload)
eventsObserved          (per workload)
comparisons             (per workload)
D00..D11 counters       (per workload)
origin counters         (per workload)
diagnostic counters     (per workload)
suppressions            (per workload)
fallback counts         (per workload)
staleRunTerminalSuppressed (per workload)
observerErrors          (per workload)
evidenceGaps            (per workload)
```

Require:
```
RUN1 == RUN2 == RUN3
```

Ignore benchmark wall-clock values.

### 5.2 Hard gate

```
THREE_RUN_DETERMINISM = PASS
RUN1_HASH == RUN2_HASH == RUN3_HASH
```

### 5.3 What this proves

The qualification is deterministic. Run order, counter
increments, and final TaskModel are reproducible. No flakiness.

## 6. T1–T12 historical disposition

### 6.1 Mechanism

For each T1–T12 in
`apps/vscode/src/sdk/__tests__/task-state-shadow-correction02-witnesses.test.ts`:

1. Re-run against HEAD.
2. Inspect the assertion that fails (if any).
3. Classify:
   ```
   ACTIVE_DEFECT               — real defect; halt, fix in CONT.6.
   SUPERSEDED_NEGATIVE_WITNESS — fixed by an earlier correction
                                 (the test was a freeze-of-broken
                                 behavior; the frozen behavior is
                                 now wrong). Update the test's
                                 contract to assert the corrected
                                 behavior, with a comment pointing
                                 to the correction that closed it.
   HARNESS_FIXED               — the test failed because of a
                                 harness-side bug (e.g. ordering,
                                 missing arbiter step). Fix the
                                 harness/test, not production.
   CARRIED_FORWARD             — superseded by a newer workload
                                 (e.g. W07, W11, W12). Mark as
                                 carried-forward with a comment
                                 linking to the new workload.
   ```

### 6.2 Hard gate

```
HISTORICAL_UNEXPLAINED_RED = 0
HISTORICAL_ACTIVE_DEFECT   = 0
T1-T12 disposition documented in the evidence doc.
```

### 6.3 What this proves

The historical baseline is reconciled. Every frozen witness has
either been superseded, has its defect fixed, or has its
harness-side issue resolved. There are no unexplained reds
left.

## 7. Exact evidence normalization

### 7.1 Mechanism

Audit every `toBeGreaterThanOrEqual(...)` and `toBeGreaterThan(...)`
assertion in the C23 file (W01–W16) and the related test files.
Convert each to an exact-count assertion where the trace is
deterministic (no race, no scheduling variance). Where the count
is genuinely non-deterministic (e.g. depends on host-runtime
ordering), keep the `>= N` form and document why.

### 7.2 Hard gate

```
W01_W16_EXACT_EVIDENCE_NORMALIZED = PASS
each W01–W16 with >= N → exact count or documented variance
```

### 7.3 What this proves

Evidence is at the same strength as W03 (`eventsObserved=7`,
`comparisons=7`). No more loose `>= 1` green tests.

## 8. Wording cleanup

### 8.1 W15 evidence

Replace:
```
RECONSTRUCTED ENVELOPE 2:
  legacy iteration_start (conversationId=run-W15-late)
  -> coordinator.observe RUNTIME_RECONSTRUCTED
  -> Option A: DIAGNOSTIC_ONLY
  -> activeRunId stays run-W15 (canonicalRunIdRef untouched)
```

with:
```
RECONSTRUCTED ENVELOPE 2:
  legacy iteration_start (conversationId=run-W15-late)
  -> reverseTranslator updates internal activeRunId to run-W15-late
  -> coordinator.observe RUNTIME_RECONSTRUCTED
  -> Option A: DIAGNOSTIC_ONLY
  -> canonicalRunIdRef (the production-side ActiveRunId ref)
     stays run-W15
  -> TaskState stays completed
```

### 8.2 W16 probe terminology

Replace:
```
W16 probe (a) is not really a negative mutation
```

with:
```
W16 exercise witness (probe a):
  require >= 1 D08 record = PASS
W16 negative mutation (probe b):
  require reconstructed origin = FAIL
```

### 8.3 Hard gate

```
WORDING_CLEANUP = PASS
```

## 9. Commit decomposition

```
CONT6-C1  docs(elm): CONT.6 plan (this file)
CONT6-C2  test(elm): W06 real-deny semantics refit
CONT6-C3  test(elm): pure replay equivalence harness
CONT6-C4  test(elm): >256 bounded recording
CONT6-C5  test(elm): 3× determinism
CONT6-C6  test(elm): T1-T12 disposition (or test edits per witness)
CONT6-C7  refactor(elm): exact-count normalization
CONT6-C8  docs(elm): CONT.5 evidence wording addendum
CONT6-C9  docs(elm): CONT.6 evidence + final C2.3 closure board
```

If any of CONT6-C2..C7 fails its hard gate, the ACT halts at that
point.

## 10. Halt conditions

```
H1  W06, pure replay, bounded, 3×, T1-T12, or exact-count fails
    its hard gate                                              = HALT
H2  Production semantic delta > 0                              = HALT
    (any reducer, comparator, coordinator, recorder,
    SdkController, emit*, proto, harness, or public-API change)
H3  Protected stashes change                                    = HALT
H4  Typecheck regressions                                       = HALT
H5  C9.x / W11-W16.x regression                                 = HALT
H6  Historical T1-T12 left as ACTIVE_DEFECT                    = HALT
H7  Fixture weakens after observing failure                     = HALT
H8  CONT.5 evidence wording addendum breaks a passing assertion = HALT
H9  Test count increases without corresponding commit note      = HALT
H10 3× determinism shows nondeterminism                         = HALT
H11 Pure replay mismatches > 0                                  = HALT
```

## 11. Exit gate

```
W06_REAL_DENY_SEMANTICS            = PASS

PURE_REPLAY_EQUIVALENCE            = PASS
PURE_REPLAY_MISMATCHES             = 0

BOUNDED_RECORDING                  = PASS
MAX_RETAINED_RECORDS               <= 256

THREE_RUN_DETERMINISM              = PASS

HISTORICAL_UNEXPLAINED_RED         = 0
HISTORICAL_ACTIVE_DEFECT           = 0

W01_W16_EXACT_EVIDENCE_NORMALIZED  = PASS

WORDING_CLEANUP                    = PASS

D10_UNKNOWN                        = 0
INVARIANT_VIOLATIONS               = 0
OBSERVER_ERRORS                    = 0
EVIDENCE_GAPS                      = 0

NEW_TS_ERRORS                      = 0
BUNDLE_BUILD                       = PASS
git diff --check                   = PASS

PROTECTED_STASHES_INTACT           = true
```

Then and only then:

```
VERDICT = PASS_STATEFUL_WORKLOAD_QUALIFICATION_C2_3

C2_4_AUTHORIZED = true
E7_AUTHORIZED   = false
```

## 12. Next after CONT.6

```
C2.4 (NO_ACTIVE_SESSION + reachability)
  LocalRuntimeHost path
  Hub/Remote paths

C2.5 (real C04 capture + C04_SYNTHETIC_REAL capture)

E7 (e2e harness + bundle build qualification)
```
