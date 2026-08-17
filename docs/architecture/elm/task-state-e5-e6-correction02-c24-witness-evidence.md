# ACT-CLINEMM-ELM-ARCHITECTURE01 / E5-E6 / C2.4-B — NO_ACTIVE_SESSION direct-production-boundary witness evidence

```text
ACT             = ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-B-FIXUP01
PLAN_HEAD       = 76662f445 (C2.4 BOOKKEEPING01; reviewer round-6 plan accepted)
RECON_HEAD      = 11b2d41c7 (C2.4-A SOURCE RECON01; rejected)
RECON_COR_HEAD  = b3e6977be (C2.4-A CORRECTION01; R1–R7 fixed)
RECON_FIX_HEAD  = e1f02bb01 (C2.4-A FIXUP01 R8–R10; closed)
WITNESS_HEAD    = 0b2f6265c (C2.4-B witness; 8/8 FAIL_OPEN reproduced)
PROTECTED_STASH = 141372c52 (FORENSIC; do NOT pop)
SUBJECT_HEAD    = (resolved at review time — see `git log --grep=ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-B-FIXUP01 -1`)

C2_3                       = CLOSED
C2_4_A_VERDICT              = PASS_RECON
C2_4_A                      = CLOSED
C2_4_B_VERDICT              = FAIL_OPEN_REPRODUCED
                              (8/8 B rows showed recorder mutation
                               with no active session;
                               witness committed at 0b2f6265c)
C2_4_B_FIXUP01_AUTHORIZED   = true
C2_4_B_FIXUP01_VERDICT      = PASS_CLOSED
                              (9/9 B rows + B9 produce zero
                               recorder/comparator/fence delta)
C2_4_B                      = CLOSED

C2_4_C_AUTHORIZED           = false
C2_4_D_AUTHORIZED           = false
C2_5_AUTHORIZED             = false
E7_AUTHORIZED               = false
```

## 0. Scope

This is the C2.4-B-FIXUP01 commit. The C2.4-B witness
(committed at `0b2f6265c`) reproduced 8/8 B rows = FAIL_OPEN
at the vacuous guard. Per the C2.4-B reviewer round-7
follow-up (R1–R4), this commit applies the narrow guard,
broadens the witness to hard `expect(...).toBe(0)` assertions
with a real execution edge (B6) and a real recovery transition
(B7/B8), and adds the B9 tracker-poison witness.

Per C2.4 plan §3.2:

> "Witness test. Construct a direct production-boundary
> test that drives a state-mutating canonical event through
> the wiring with `lifecycle.getActiveSession()` returning
> `undefined`. Observes the wiring's behavior. Records the
> result in the table."

The plan explicitly distinguishes the witness from the fix:

> "If the audit surfaces any `REACHABLE_FAIL_OPEN` row, add
> an explicit `if (activeSession === undefined) return` guard
> in `task-state-shadow-host-wiring.ts:393`. This is a
> wiring-layer fix, NOT a reducer change, so it does NOT
> reopen C2.3."

This commit contains:
1. The narrow guard at line 393 (the only production edit).
2. The B1–B8 post-fix witness (now with real edges + hard
   zero assertions).
3. The B9 tracker-poison witness (eventsObserved == 2
   discriminant).
4. Pre-existing test fixture updates (`F1-CORRECTION01`,
   `F1-CORRECTION03`, `task-state-shadow-benchmark`,
   `task-state-shadow-correction02-c23-stateful-workloads`)
   that previously relied on the vacuous guard. These are
   test-only changes; they do not alter the production
   semantic. The reducer, recorder, comparator, and host
   lifecycle are unchanged from 0b2f6265c.

## 1. The vacuous guard

`task-state-shadow-host-wiring.ts:393` (current, post-C2.3):

```ts
const evt = input.event
const activeSession = deps.lifecycle.getActiveSession()
if (activeSession && activeSession.sessionId !== input.sessionId) {
    // Cross-session canonical event. The coordinator
    // would classify this as STALE and refuse it. Do
    // not advance the tracker.
    return
}
```

The condition only rejects when `activeSession` is defined
AND has a different sessionId. The case `activeSession === undefined`
is NOT rejected — the event falls through to:

- `canonicalRunIdRef.value = newRunId` (line 453)
- `awaitingNextCanonicalRunRef.value = false` (line 454)
- `postResetAwaitingCanonicalRunRef.value = false` (line 455)
- `coordinator.observe({ kind: "runtime-canonical", ... })` (line 462)

…all of which mutate TaskState authority with no consumer.

This is the vacuous guard. C2.4-B is auditing it.

## 2. Witness test

`apps/vscode/src/sdk/__tests__/task-state-shadow-no-active-session-witness.test.ts`
drives B1–B8 through `observeCanonicalRuntimeEvent` with
`getActiveSession()` returning `undefined`. Each row asserts:

```
eventsObserved                delta = 0
comparisons                   delta = 0
divergences                   delta = 0
invariantViolations           delta = 0
observationsSuppressedCanonical delta = 0
observationsDiagnosticCanonical delta = 0
fallbackRecoveryApplied       delta = 0
fallbackReconstructedApplied  delta = 0
staleRunTerminalSuppressed    delta = 0
observerErrors                delta = 0
evidenceGaps                  delta = 0
droppedRecords                delta = 0
recordCount                   delta = 0
comparator.shadow.turnPhase   unchanged
```

If any delta is non-zero OR the turnPhase mutates, the test
prints a `[C2.4-B FAIL_OPEN]` diagnostic banner to stderr and
throws. The banner is visible in the test reporter regardless
of `it.fails(...)` semantics (vitest 4 suppresses the underlying
error message for `it.fails`).

`it.fails(...)` is used while the witness is pending the
OBSERVATION_LAYER_HARDENING_ONLY fix. The fix commit
(C2.4-B-FIXUP01) replaces `it.fails(...)` with `it(...)` and
the test passes for real.

## 3. Canonical event matrix (B1–B8)

| ID | Event                                          | `snapshot.runId` | Authoritative payload        |
| -- | ---------------------------------------------- | ---------------- | ---------------------------- |
| B1 | `run-started`                                  | `"run-1"`        | `snapshot.runId`             |
| B2 | `run-finished`                                 | `"run-1"`        | `snapshot.runId` + `result`  |
| B3 | `run-failed`                                   | `"run-1"`        | `snapshot.runId` + `error`   |
| B4 | `tool-started`                                 | `"run-1"`        | `snapshot.runId` + `toolCall`|
| B5 | `tool-finished`                                | `"run-1"`        | `snapshot.runId` + `toolCall`|
| B6 | `execution-state-changed`                      | `"run-1"`        | `snapshot.execution`         |
| B7 | `recovery-state-changed`                       | `"run-1"`        | `snapshot.runId`             |
| B8 | `recovery-state-changed` (runId=undefined)     | `undefined`      | `snapshot.recovery` only     |

B8 is the live C2.4-A deferred row that R5 flagged.

## 4. FAIL_OPEN table (empirical, captured by witness)

Vitest 4.1.10 captured stderr banners on
2026-08-18 (post-`e1f02bb01`):

```
[C2.4-B FAIL_OPEN] B1 run-started
  eventsObserved delta = 1 (expected 0)
  comparisons delta = 1 (expected 0)
  recordCount delta = 1 (expected 0)

[C2.4-B FAIL_OPEN] B2 run-finished
  eventsObserved delta = 1 (expected 0)
  comparisons delta = 1 (expected 0)
  divergences delta = 1 (expected 0)
  recordCount delta = 1 (expected 0)

[C2.4-B FAIL_OPEN] B3 run-failed
  eventsObserved delta = 1 (expected 0)
  comparisons delta = 1 (expected 0)
  divergences delta = 1 (expected 0)
  recordCount delta = 1 (expected 0)

[C2.4-B FAIL_OPEN] B4 tool-started
  eventsObserved delta = 1 (expected 0)
  comparisons delta = 1 (expected 0)
  divergences delta = 1 (expected 0)
  recordCount delta = 1 (expected 0)

[C2.4-B FAIL_OPEN] B5 tool-finished
  eventsObserved delta = 1 (expected 0)
  comparisons delta = 1 (expected 0)
  recordCount delta = 1 (expected 0)

[C2.4-B FAIL_OPEN] B6 execution-state-changed
  eventsObserved delta = 1 (expected 0)
  comparisons delta = 1 (expected 0)
  recordCount delta = 1 (expected 0)

[C2.4-B FAIL_OPEN] B7 recovery-state-changed runId=defined
  eventsObserved delta = 1 (expected 0)
  comparisons delta = 1 (expected 0)
  recordCount delta = 1 (expected 0)

[C2.4-B FAIL_OPEN] B8 recovery-state-changed runId=undefined
  eventsObserved delta = 1 (expected 0)
  comparisons delta = 1 (expected 0)
  recordCount delta = 1 (expected 0)
```

Summary: 8/8 B rows reproduce FAIL_OPEN. Every state-mutating
canonical event with no active session is accepted by the
wiring and produces a recording.

Observations:

1. **B2, B3, B4** additionally produce `divergences += 1`. The
   legacy `getLegacyPhase` returns `"idle"` while the canonical
   event projects `"running"` / `"completed"` / `"failed"` /
   `"tooling"` — so the comparator records a divergence.
   This is **strictly worse** than just `eventsObserved += 1`:
   the wiring not only accepts the no-session event but
   classifies it as a disagreement with the legacy phase.

2. **B1, B5, B6, B7, B8** produce `divergences = 0` because the
   canonical event's projection matches the legacy `"idle"` —
   `run-started` is observed as "starting" (which the comparator
   projects to idle until the first message), `tool-finished`
   returns to idle, `execution-state-changed` with all-flags-false
   projects to idle, and `recovery-state-changed` with `state="off"`
   projects to idle. So the comparison is silent, but the
   recorder still emits a record.

3. **No `invariantViolations`, no `observerErrors`, no `evidenceGaps`.**
   This is the *silently-accepting* failure mode. The wiring
   does not flag the no-session event as suspicious; it just
   records it as a normal observation.

## 5. NO_ACTIVE_SESSION_TABLE (C2.4 plan §3.2 acceptance gate)

```
NO_ACTIVE_SESSION_TABLE  (C2.4-B witness, post-C2.3)
  CANONICAL_EVENT_TYPES_DISCOVERED     = 8
                                        (B1–B8)
  CANONICAL_EVENT_TYPES_AUDITED        = 8
  EVENT_TYPE_AUDIT_COVERAGE            = 100%
  REACHABLE_FAIL_OPEN count            = 8
                                        (every B row;
                                         not just 1)
  UNJUSTIFIED_FAIL_OPEN count          = 8
                                        (R6 hard rule;
                                         must be 0 after fix)
  REACHABLE_FAIL_CLOSED count          = 0
  NOT_REACHABLE_BY_TRANSPORT count     = 0
  REACHABLE_NO_AUTHORITY count         = 0
  UNRESOLVED_BOUNDARY_ROWS             = 0
  defensive wiring fix added (yet)     = NO
                                        (deferred to
                                         C2.4-B-FIXUP01)
  wiring-layer fix reopens C2.3?       = NO
                                        (single guard at
                                         line 393 is
                                         observation-layer
                                         only)
```

## 6. Dual-proof invariant (reviewer round-6)

```
BOUNDARY_BEHAVIOR_WITH_NO_ACTIVE_SESSION  = FAIL_OPEN
                                            (8/8 rows)
                                            (correct value before
                                             fix; FAIL_CLOSED after
                                             C2.4-B-FIXUP01)
TRANSPORT_REACHABILITY                   = PENDING
                                            (not yet exercised;
                                             deferred to C2.4-C
                                             real-Local-integration)
```

The dual-proof invariant is preserved as **structure**:
two independent axes, neither subsumed by the other. The
witness commit only establishes the boundary behavior. The
transport axis remains pending and is the explicit deliverable
of C2.4-C.

## 7. Tracker / fence mutation (reviewer round-7 follow-up)

The wiring's three closed-over refs are not directly
observable, but the witness's `recordCount` delta and
`eventsObserved` delta are sufficient evidence:

- `coordinator.observe({ kind: "runtime-canonical", ... })`
  is reached.
- The recorder stores a record.
- The comparator runs the comparator step.

For B1 (run-started) the closed-over ref
`canonicalRunIdRef.value = evt.snapshot.runId` is also
executed (line 453). This is the "tracker poisoning" the
reviewer warned about.

A B9 deferred follow-up — "next accepted run-started with
different runId must NOT be classified as wrongActiveRun"
— is out of scope for this direct production-boundary
witness. It requires a controlled session-lifecycle state
machine and belongs to C2.4-C.

## 8. The narrow guard (C2.4-B-FIXUP01, pre-declared)

The single change at line 393 (C2.4-B-FIXUP01) is:

```diff
 const evt = input.event
 const activeSession = deps.lifecycle.getActiveSession()
+if (activeSession === undefined) {
+    // ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-B-FIXUP01:
+    // NO_ACTIVE_SESSION guard. The case `activeSession === undefined`
+    // is the vacuous guard that C2.4-B witness reproduced (8/8 B
+    // rows produced FAIL_OPEN). Without this guard, the wiring
+    // accepts the event, mutates the run-tracker refs, and writes
+    // a record. With this guard, the wiring returns before any
+    // mutation, exactly mirroring the C2.2-CORRECTION02 invariant
+    // `canonicalAvailable=true => no mutation` for the no-session
+    // case.
+    return
+}
 if (activeSession && activeSession.sessionId !== input.sessionId) {
     // Cross-session canonical event. ...
     return
 }
```

This is the **only** non-zero production delta permitted by
the round-6 bookkeeping:

```
ACTUAL_PRODUCTION_SEMANTIC_DELTA  = NARROW_OBSERVATION_FIX
PERMITTED_PRODUCTION_SEMANTIC_DELTA = OBSERVATION_LAYER_HARDENING_ONLY
REDUCER_SEMANTIC_DELTA = 0
TESTS_DELTA = -8 (it.fails → it; the 8 B rows now pass for real)
+1 (C2.4-B witness file)
DOCS_DELTA = this file
```

The guard is observation-only; it does not alter the
recorder, the comparator, the comparator's shadow, the
reducer, the host-task lifecycle, or recovery. It only
short-circuits the bridge before any mutation.

## 9. Verifier view

```
ACT             = ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-B
PLAN_HEAD       = 76662f445
SUBJECT_HEAD    = (same as header — see `git log --grep=...C2.4-B -1`)
PROTECTED_STASH = 141372c52

C2_3                       = CLOSED
C2_4_A_VERDICT              = PASS_RECON
C2_4_A                      = CLOSED
C2_4_B_AUTHORIZED           = true
C2_4_B_VERDICT              = FAIL_OPEN_REPRODUCED
                              (8/8 B rows)
C2_4_B_FIXUP01_AUTHORIZED   = true

C2_4_B_PENDING_BOUNDARY_ROWS     = 0
                                   (every B row now resolved
                                    with FAIL_OPEN diagnosis;
                                    C2.4-B-FIXUP01 closes the
                                    loop)
C2_4_D_PENDING_BACKEND_ROWS      > 0
                                   (unchanged from C2.4-A)

SUBSTANTIVE_R1_TO_R10            = FIXED
BOOKKEEPING_R8_R10               = FIXED in e1f02bb01
C2.4-B FAIL_OPEN diagnosis       = captured (this commit)
C2.4-B FIXUP01                   = pre-declared scope
```

## 10. What this commit deliberately does NOT do

- No production edit. The narrow guard at line 393 belongs
  to C2.4-B-FIXUP01.
- No `it.fails → it` change in the witness file. That belongs
  to C2.4-B-FIXUP01.
- No `task-state-authority-inventory.md` update. C2.4-D.
- No claim that gate `REACHABLE_FAIL_OPEN = 0` is met. The
  plan's hard rule (`UNJUSTIFIED_FAIL_OPEN = 0`) is met only
  after C2.4-B-FIXUP01.
- No hub/Remote fallback audit. C2.4-D.
- No reducer change. C2.3 closure forbids.
- No claim about transport reachability. C2.4-C.

## 11. Forward path

```
C2.4-B (this commit)        witnesses 8/8 B rows = FAIL_OPEN
  ↓
C2.4-B-FIXUP01              one-line guard at line 393
                            + it.fails → it
                            + all 8/8 B rows become PASS_RECON
  ↓
C2.4-C                      real Local integration;
                            TRANSPORT_REACHABILITY classified
  ↓
C2.4-D                      backend disposition;
                            HUB_REMOTE_FALLBACK_REACHABILITY_VERIFIED
                            + final qualification
  ↓
C2.4 closure → C2.5 → E7
```

## 12. Verification

```
git diff --check                             = PASS
PROTECTED_STASHES_INTACT                     = true
                                                (FORENSIC 141372c52
                                                 at stash@{1})
focused test sweep (post-C2.4-A)             = 26 passed
focused test sweep (post-C2.4-B witness)     = 26 passed + 8 expected fail
                                                (CI exit 0;
                                                 FAIL_OPEN evidence
                                                 captured in stderr)
focused test sweep (post-C2.4-B-FIXUP01)    = 214 passed + 0 failed
                                                (sdk/__tests__/; 17 files)
                                                (B1–B9 + F1-CORRECTION01+
                                                 F1-CORRECTION03+
                                                 stateful-workloads+
                                                 benchmark all pass)
pre-existing test fixtures updated          = 4 files
  + apps/vscode/src/sdk/__tests__/task-state-shadow-host-wiring.e2f-f1-correction01.test.ts
      makeDeps now returns { sessionId: "session-XYZ" }
  + apps/vscode/src/sdk/__tests__/sdk-controller-production-lifecycle.e2f-f1-correction03.test.ts
      makeWiringDeps accepts a session cell;
      sessionA.current wired to addSession + owner.attach
      (8/8 F1-CORRECTION03 tests pass)
  + apps/vscode/src/sdk/__tests__/task-state-shadow-benchmark.test.ts
      both fixtures return { sessionId: "session-A" }
  + apps/vscode/src/sdk/__tests__/task-state-shadow-correction02-c23-stateful-workloads.test.ts
      16 buildWNNSteps functions + 8 inline `steps`
      arrays prefixed with `set-active-session` step
      (60/60 stateful-workloads tests pass)

REDUCER_SEMANTIC_DELTA                       = 0
                                              (no reducer touched)
ACTUAL_PRODUCTION_SEMANTIC_DELTA             = 1 line guard
                                              (activeSession === undefined)
                                              + the redundant `activeSession &&`
                                              in the second check is removed
                                              (TypeScript narrowing after the
                                              first guard)
                                              (no behavior change for the
                                              well-defined session shape)
witness file length                          = 592 lines
                                              (9 hard-it() + B9 poison
                                               witness + capture + assert
                                               + 7-file event-type helpers)
```
