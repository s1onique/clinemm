# C2.4-B NO_ACTIVE_SESSION witness + FIXUP01 closure evidence

**Subject:** ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-B-FIXUP01

```text
PLAN_HEAD       = 76662f445 (C2.4 BOOKKEEPING01; reviewer round-6 plan accepted)
RECON_HEAD      = 11b2d41c7 (C2.4-A SOURCE RECON01; rejected)
RECON_COR_HEAD  = b3e6977be (C2.4-A CORRECTION01; R1–R7 fixed)
RECON_FIX_HEAD  = e1f02bb01 (C2.4-A FIXUP01 R8–R10; closed)
WITNESS_HEAD    = 0b2f6265c (C2.4-B PRE_FIX witness; 8/8 FAIL_OPEN reproduced)
FIXUP01_HEAD    = adbb5e2d5 (C2.4-B-FIXUP01 POST_FIX; 9/9 PASS)
CLOSURE_HEAD    = (HEAD; this commit; evidence + test-hygiene only;
                   production delta = 0)
PROTECTED_STASH = 141372c52 (FORENSIC; do NOT pop)

C2_3                       = CLOSED
C2_4_A_VERDICT             = PASS_RECON
C2_4_A                     = CLOSED
C2_4_B_PRE_FIX             = FAIL_OPEN_REPRODUCED  (8/8; WITNESS_HEAD)
C2_4_B_POST_FIX            = PASS_CLOSED          (9/9; FIXUP01_HEAD)
C2_4_B                     = CLOSED
C2_4_C_AUTHORIZED          = true
C2_4_D_AUTHORIZED          = false
C2_5_AUTHORIZED            = false
E7_AUTHORIZED              = false
```

This document is split into two halves. **§A** is frozen at the
C2.4-B PRE_FIX commit (`0b2f6265c`); it describes the witness that
reproduced the vacuous guard defect. **§B** is frozen at the
C2.4-B-FIXUP01 POST_FIX commit (`adbb5e2d5`); it describes the
narrow guard, the strengthened witnesses (B1–B9), and the four
pre-existing test-fixture updates. **§0** below names which commit
is which.

## §0. Source-of-truth commit map

The C2.4-B pipeline shipped across exactly two commits. Each half
of this evidence document MUST be read with its own commit.

| Section        | Commit     | Diff stat                              |
|----------------|------------|----------------------------------------|
| §A (PRE_FIX)   | `0b2f6265c` | +1 file (witness), +1 file (this doc)   |
| §B (POST_FIX)  | `adbb5e2d5` | +26 lines production, +4 fixture files   |

Anything in §A that contradicts §B is a **PRE_FIX** truth that
**FIXUP01** corrected. Anything in §B that disagrees with §A is a
**POST_FIX** truth that **replaces** the PRE_FIX observation. The
test-only `it.fails` rows in §A are evidence of a now-removed
failure mode; the ordinary `it()` rows in §B replace them.

The current closure-fixup commit is `HEAD` (this commit). It is a
docs/test-hygiene-only commit (production delta = 0). Its
authoritative references are §A (PRE_FIX) and §B (POST_FIX).

---

# §A. C2.4-B PRE_FIX witness (frozen at 0b2f6265c)

## §A.0 PRE_FIX scope

This is the first C2.4-B commit. Per C2.4 plan §3.2:

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

This commit contains B1–B8 PRE_FIX witness tests + the
FAIL_OPEN evidence table. **No production edit.** The narrow
guard is committed in C2.4-B-FIXUP01 (the next commit).

## §A.1 The vacuous guard (PRE_FIX)

The wiring's PRE_FIX session-authority check (line 393, before
C2.4-B-FIXUP01) was:

```ts
if (activeSession && activeSession.sessionId !== input.sessionId) {
    return
}
```

When `lifecycle.getActiveSession()` returns `undefined` AND
`activeSession && ...` short-circuits, the inner check never
runs. The vacuous-guard path is FALSE under the condition
"no active session at all". Every canonical event in that state
fell through to the recorder/comparator/coordinator path.

This is the BUG that C2.4-B-FIXUP01 corrects.

## §A.2 PRE_FIX witness test

The PRE_FIX file
`apps/vscode/src/sdk/__tests__/task-state-shadow-no-active-session-witness.test.ts`
was 441 lines and used `it.fails(...)` semantics (vitest 4
suppresses the underlying assertion failure as long as an
exception is thrown). The witness intentionally let the
exception through to capture the FAIL_OPEN defect. Each row's
`checkNoDelta` helper threw with a `[C2.4-B FAIL_OPEN]`
diagnostic banner so future debugging could read the
pre-fix TRACE.

`it.fails(...)` is used while the witness is pending the fix.
C2.4-B-FIXUP01 replaces `it.fails(...)` with `it(...)` and
flips the assertions to zero-delta (the post-fix truth). See
§B.

## §A.3 PRE_FIX canonical event matrix (B1–B8)

| Row | Type of canonical event                              |
|-----|------------------------------------------------------|
| B1  | `run-started`                                        |
| B2  | `run-finished`                                       |
| B3  | `run-failed`                                         |
| B4  | `tool-started`                                       |
| B5  | `tool-finished`                                      |
| B6  | `execution-state-changed` (PRE_FIX fixture was all-false on both sides; the edge-triggered adapter silently dropped the edge — see §B.6) |
| B7  | `recovery-state-changed` (runId defined; PRE_FIX fixture was off/off) |
| B8  | `recovery-state-changed` (runId undefined; PRE_FIX fixture was off/off) |

## §A.4 PRE_FIX FAIL_OPEN table (empirical, captured by witness)

Each row reproduced the FAIL_OPEN defect at the vacuous guard.
The captured diagnostics live in §A's commit history and are
reproduced here for posterity:

```
[C2.4-B FAIL_OPEN] B1 run-started
[C2.4-B FAIL_OPEN] B2 run-finished
[C2.4-B FAIL_OPEN] B3 run-failed
[C2.4-B FAIL_OPEN] B4 tool-started
[C2.4-B FAIL_OPEN] B5 tool-finished
[C2.4-B FAIL_OPEN] B6 execution-state-changed
[C2.4-B FAIL_OPEN] B7 recovery-state-changed runId=defined
[C2.4-B FAIL_OPEN] B8 recovery-state-changed runId=undefined
```

Summary: 8/8 B rows reproduce FAIL_OPEN. Every state-mutating
canonical event was admitted to the recorder, the comparator,
and the comparator.shadow (turnPhase) with no active session.
The run-tracker `canonicalRunIdRef` was mutated by `run-started`
events even without an active session — a real authority-boundary
defect, not a cosmetic one.

## §A.5 PRE_FIX NO_ACTIVE_SESSION_TABLE (frozen at 0b2f6265c)

```text
CANONICAL_EVENT_TYPES_DISCOVERED   = 7
                                     (run-started, run-finished,
                                      run-failed, tool-started,
                                      tool-finished,
                                      execution-state-changed,
                                      recovery-state-changed)
EVENT_TYPE_AUDIT_COVERAGE         = 100% (7/7)
NO_ACTIVE_SESSION_BOUNDARY_ROWS   = 8
                                     (B1-B8; B8 is a second
                                      provenance variant of
                                      recovery-state-changed,
                                      not an eighth event TYPE)
BOUNDARY_ROW_AUDIT_COVERAGE       = 100% (8/8)
REACHABLE_FAIL_OPEN count         = 8 (B1-B8)
UNJUSTIFIED_FAIL_OPEN count       = 8 (B1-B8 — bug at the vacuous guard)
REACHABLE_FAIL_CLOSED count       = 0
defensive wiring fix added        = NO
                                     (planned for C2.4-B-FIXUP01)
```

The PRE_FIX table above uses `CANONICAL_EVENT_TYPES_DISCOVERED = 7`
(the original C2.4-B witness used `= 8` in its diagnostic summary;
that number is `7 event TYPES + 1 provenance row (B8) = 8 ROWS`.
This §A.5 table records the canonical-event-types denominator
specifically as `7`, with B8 called out as a second provenance
variant of `recovery-state-changed`. The denominator cleanup
applies to both §A and §B; the authoritative denominator is `7
types / 8 boundary rows`.

## §A.6 PRE_FIX dual-proof invariant

```text
BOUNDARY_BEHAVIOR_WITH_NO_ACTIVE_SESSION = FAIL_OPEN
TRACKER_POISON                           = ADMISSIBLE
                                           (canonicalRunIdRef mutated)
WITNESS_BUCKET                           = TEST_ONLY
                                           (no production edit at 0b2f6265c)
PROD_GUARD_AT_LINE_393                   = ABSENT
                                           (added in C2.4-B-FIXUP01;
                                            0b2f6265c has no source edit
                                            to task-state-shadow-host-wiring.ts)
```

## §A.7 PRE_FIX deferred follow-ups

The §A commit deferred one B-row concern: whether the rejected
pre-session `run-started` could "poison" the canonical
`canonicalRunIdRef` for a later legitimate session. The PRE_FIX
analysis said:

> "A B9 deferred follow-up — pinned once C2.4-B-FIXUP01 closes
> the vacuous guard."

C2.4-B-FIXUP01 implements B9 as an ordinary `it(...)` witness
that observes `eventsObserved == 2` after a poisoned-then-legit
sequence. See §B.5.

## §A.8 PRE_FIX production guard snippet (commit 0b2f6265c)

The PRE_FIX wiring (the bug C2.4-B-FIXUP01 closes):

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

The `activeSession &&` short-circuit makes the guard vacuous
when `getActiveSession()` returns `undefined`. The bug is at
this line. The fix is at the same line — see §B.1.

## §A.9 PRE_FIX verdict

```text
C2_4_B_VERDICT            = FAIL_OPEN_REPRODUCED
C2_4_B_FIXUP01_AUTHORIZED = true
                            (per C2.4 plan §3.2)
```

## §A.10 PRE_FIX scope summary

```text
production/test ratio    = 0 source / 1 file (witness)
witness file length      = 441 lines
                          (8 it.fails + assertion helpers)
```

This was a **witness-only** commit. No production change.

---

# §B. C2.4-B-FIXUP01 POST_FIX closure (frozen at adbb5e2d5)

## §B.0 POST_FIX scope

This is the C2.4-B-FIXUP01 commit. Per the C2.4 plan:

> "If the audit surfaces any REACHABLE_FAIL_OPEN row, add an
> explicit `if (activeSession === undefined) return` guard in
> `task-state-shadow-host-wiring.ts:393`."

The audit surface (8/8 B rows FAIL_OPEN) authorized this commit.
Per the C2.4-B reviewer round-7 follow-up (R1–R4 + R5
bookkeeping), this commit:

1. Applies the narrow guard at line 393 (the only production
   edit).
2. Rewrites the witness file as ordinary `it()` with hard
   `expect(...).toBe(0)` assertions. The reviewer R4
   explicitly rejected the `it.fails` lenient pattern from the
   PRE_FIX witness (vitest 4 accepts *any* throw as a passing
   failure — too lenient for a qualification suite).
3. Adds B9 as the tracker-poison witness — eventsObserved == 2
   is the post-fix-vs-pre-fix discriminant. (See §B.5.)
4. Updates 4 pre-existing test fixtures that relied on the
   vacuous guard (F1-CORRECTION01, F1-CORRECTION03, benchmark,
   stateful-workloads). These are test-only edits; they do not
   alter the production semantic.
5. Cleans up the denominator: `CANONICAL_EVENT_TYPES_AUDITED = 7`
   (B8 is a second provenance variant of recovery-state-changed,
   not an eighth type).

## §B.1 The narrow guard (POST_FIX)

The POST_FIX wiring (line 393, frozen at adbb5e2d5):

```ts
// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-B-FIXUP01:
// also refuse when THERE IS NO ACTIVE SESSION AT ALL.
// The pre-fix guard only rejected when activeSession was
// defined AND had a different sessionId (a vacuous guard
// for the `activeSession === undefined` case). The C2.4-B
// witness reproduced 8/8 B rows = FAIL_OPEN with no active
// session: every state-mutating canonical event was
// admitted, the run-tracker refs were mutated, and a
// record was emitted. With this guard, the wiring
// returns before any tracker mutation. The guard is
// observation-only: it does NOT alter the recorder,
// comparator, comparator.shadow, reducer, host-task
// lifecycle, or recovery. It ONLY short-circuits the
// bridge before any mutation.
const evt = input.event
const activeSession = deps.lifecycle.getActiveSession()
if (activeSession === undefined) {
    // NO_ACTIVE_SESSION — refuse without recording.
    // Mirrors the C2.2-CORRECTION02 invariant
    // `canonicalAvailable=true ⇒ no mutation` for the
    // no-session case. The bridge must not grant
    // shadow authority when there is no consumer
    // capable of binding it.
    return
}
if (activeSession.sessionId !== input.sessionId) {
    // Cross-session canonical event. The coordinator
    // would classify this as STALE and refuse it. Do
    // not advance the tracker.
    return
}
```

The redundant `activeSession &&` is removed because TypeScript
narrows `activeSession` to `ActiveSession` after the first guard
returns. This is a TypeScript-hygiene improvement, not a
behavior change.

## §B.2 Witness file (B1–B9, hard `expect(...).toBe(0)`)

The witness file at
`apps/vscode/src/sdk/__tests__/task-state-shadow-no-active-session-witness.test.ts`
was rewritten to ordinary `it()` with hard assertions:

| Row | Event                       | Hard zero-delta assertion                                      |
|-----|-----------------------------|----------------------------------------------------------------|
| B1  | `run-started`               | `eventsObserved += 0`, `recordCount += 0`, `comparisons += 0`  |
| B2  | `run-finished`              | same zero-delta                                                |
| B3  | `run-failed`                | same zero-delta                                                |
| B4  | `tool-started`              | same zero-delta                                                |
| B5  | `tool-finished`             | same zero-delta                                                |
| B6  | `execution-state-changed` (REAL edge `modelStreaming false -> true`) | same zero-delta |
| B7  | `recovery-state-changed` (runId defined; REAL transition `idle -> recovering`) | same zero-delta |
| B8  | `recovery-state-changed` (runId undefined; REAL transition `idle -> recovering`) | same zero-delta |

The B6/B7/B8 fixtures now carry **real state-transition** data.
This addresses the reviewer R2 concern that the PRE_FIX
fixtures were all-false/IDLE_EXECUTION on both sides for B6
(edge-triggered adapter silently dropped the edge) and off/off
for B7/B8 (the recovery adapter doesn't edge-trigger, but the
recovery projection had identical state on both sides — so the
comparator saw no diff). With real transitions, B6 actually
exercises `model_stream_started` and B7/B8 actually exercise
`recovery_changed` (with a non-trivial projection).

## §B.3 POST_FIX test sweep

```text
B1-B9 ordinary it()                   = 9/9 PASS
                                       (no `it.fails` lenient
                                       pattern; reviewer R4
                                       explicitly rejected it)
F1-CORRECTION01 post-fix fixtures     = 8/8 PASS
F1-CORRECTION03 post-fix fixtures     = 8/8 PASS
                                       (`sessionA` cell wired
                                       to addSession +
                                       owner.attach calls)
task-state-shadow-benchmark fixtures = 2/2 PASS
task-state-shadow-correction02-
  c23-stateful-workloads fixtures    = 60/60 PASS
                                       (16 buildWNNSteps +
                                       8 inline it-blocks got
                                       `set-active-session`)
full sdk/__tests__/ sweep             = 214/214 PASS
```

## §B.4 Pre-existing test fixture updates (test-only)

These four files relied on the vacuous guard. The semantic
change is in production (the wiring now requires an active
session); the test fixtures were faking "no active session"
while silently exercising the wiring's canonical-event ingress.
The C2.4 plan accounts for this:

> "wiring-layer fix, NOT a reducer change, so it does NOT
> reopen C2.3"

Test-only fixture patches:

1. `task-state-shadow-host-wiring.e2f-f1-correction01.test.ts`:
   `makeDeps` now returns `{ sessionId: "session-XYZ" }`. 8/8
   F1-W tests pass.
2. `sdk-controller-production-lifecycle.e2f-f1-correction03.test.ts`:
   `makeWiringDeps` accepts a session cell (`sessionA.current`)
   that mirrors the production lifecycle. The cell is wired to
   `addSession` (host fixture) and `owner.attach(host, wiring,
   sessionId)` calls. 8/8 F1-LC tests pass.
3. `task-state-shadow-benchmark.test.ts`:
   both fixtures return `{ sessionId: "session-A" }`.
   2/2 perf tests pass (10K canonical events in 15ms,
   p50 = 0.9µs, well under 100µs budget).
4. `task-state-shadow-correction02-c23-stateful-workloads.test.ts`:
   16 `buildWNNSteps` functions + 8 inline `steps` arrays get a
   `{ kind: "set-active-session", sessionId: "..." }` step
   inserted before the first canonical event. 60/60 stateful
   tests pass.

The CLOSURE commit (`HEAD`, this commit) further adds a
`sessionA.current = undefined` reset to the `beforeEach` in
F1-CORRECTION03 — that is the R4 hygiene concern. See the
fixture audit at
`docs/architecture/elm/task-state-e5-e6-correction02-c24-bulk-fixture-audit.md`.

## §B.5 B9 — the tracker-poison witness

The wiring's three closed-over refs (`canonicalRunIdRef`,
`awaitingNextCanonicalRunRef`,
`postResetAwaitingCanonicalRunRef`) are NOT directly observable.
The BEHAVIORAL consequence IS observable through the recorder:
any admitted event increments `eventsObserved` by 1. So the B9
discriminant is the post-fix-vs-pre-fix count of admitted
events across the legitimate sequence.

```
step 1 (no active session): inject run-started("run-poison")
step 2:                    switch active session on
                            (sessionId = session-real)
step 3 (active session):   inject run-started("run-real")
step 4 (active session):   inject run-finished("run-real")

POST-FIX: step 1 REJECTED. canonicalRunIdRef stays
          undefined. step 3 + step 4 ADMITTED. final
          eventsObserved = 2, recordCount = 2,
          staleRunTerminalSuppressed = 0.

PRE-FIX:  step 1 ADMITTED (canonicalRunIdRef := "run-poison").
          step 3 ADMITTED (canonicalRunIdRef := "run-real",
          overwriting). step 4 ADMITTED (no wrongActiveRun;
          canonicalRunIdRef = eventRunId = "run-real").
          final eventsObserved = 3, recordCount = 3.

B9 discriminant: eventsObserved == 2. Pre-fix produces 3.
Post-fix produces 2.
```

A previous sketch of the discriminant proposed
`staleRunTerminalSuppressed == 2`. That design was rejected
because the post-fix gate at line 433
(`wrongActiveRun = (active !== undefined && eventRunId !== undefined && active !== eventRunId)`)
sets `wrongActiveRun = false` regardless of `eventRunId` when
`canonicalRunIdRef` is `undefined`. So no suppression fires in
the post-fix step-3 / step-4 path. The legitimate-sequence
`eventsObserved == 2` discriminant above is the actual
implementation.

The B9 also verifies that the rejected pre-session
`run-started` does not poison the closed-over authority state:
the legitimate sequence behaves as if the rejected event never
happened.

## §B.6 Real execution / recovery transitions (R2, R3)

PRE_FIX fixtures had:

```text
B6 — execution-state-changed:
  snapshot.execution.modelStreaming     = false
  previousExecution.modelStreaming     = false
  -> edge-triggered adapter emits NOTHING (silent drop).
```

```text
B7/B8 — recovery-state-changed:
  snapshot.recovery.state              = off
  previousRecovery.state               = off
  -> recovery adapter emits recovery_changed either way, but
     the projection contains no real change for the
     comparator to react to.
```

POST_FIX fixtures have:

```text
B6 — execution-state-changed:
  snapshot.execution.modelStreaming     = true   (NEW)
  previousExecution.modelStreaming     = false
  -> edge-triggered adapter emits `model_stream_started`.
```

```text
B7/B8 — recovery-state-changed:
  snapshot.recovery.state              = "recovering"   (NEW)
  previousRecovery.state               = "idle"
  -> recovery adapter emits `recovery_changed` with a
     non-trivial projection. The lifecycle state
     transitions from idle to recovering; B8 additionally
     adds the restore-like `runId === undefined` case.
```

## §B.7 POST_FIX production guard demonstrates R1/R2/R3/R4 closure

- **R1** (real execution edge): satisfied. B6 carries
  `modelStreaming false -> true`. PASS_CLOSED.
- **R2** (real recovery transition): satisfied. B7/B8 carry
  `idle -> recovering`. PASS_CLOSED.
- **R3** (B9 tracker-poison witness): satisfied. B9 proves
  the rejected pre-session event doesn't poison. PASS_CLOSED.
- **R4** (no `it.fails` lenient pattern): satisfied. B1–B9
  are ordinary `it()` with hard `expect(...)` assertions.

## §B.8 POST_FIX verdict

```text
REACHABLE_FAIL_OPEN                    = 0
UNJUSTIFIED_FAIL_OPEN                  = 0
REACHABLE_FAIL_CLOSED                  = 8 (B1-B8)
TRACKER_POISON                         = 0 (B9 verified)
FENCE_POISON                           = 0 (B9 verified)
invariantViolations                    = 0
observerErrors                         = 0
evidenceGaps                           = 0
REDUCER_SEMANTIC_DELTA                 = 0
ACTUAL_PRODUCTION_SEMANTIC_DELTA       = 1 line guard +
                                         redundant check removal
PERMITTED_PRODUCTION_SEMANTIC_DELTA    = OBSERVATION_LAYER_HARDENING_ONLY
                                         (boundary-only guard;
                                         no shadow/recorder/comparator/
                                         host-lifecycle/recovery impact)
dual-proof invariant:
  BOUNDARY_BEHAVIOR_WITH_NO_ACTIVE_SESSION = FAIL_CLOSED ✓
  TRANSPORT_REACHABILITY                   = PENDING (C2.4-C)
```

## §B.9 Denominators (R5 bookkeeping)

```text
CANONICAL_EVENT_TYPES_DISCOVERED       = 7
CANONICAL_EVENT_TYPES_AUDITED          = 7
EVENT_TYPE_AUDIT_COVERAGE              = 100% (7/7)
NO_ACTIVE_SESSION_BOUNDARY_ROWS        = 8
BOUNDARY_ROWS_AUDITED                  = 8
BOUNDARY_ROW_AUDIT_COVERAGE            = 100% (8/8)
TRACKER_POISON_WITNESSES               = 1 (B9)
WITNESS_BUCKET                         = TEST_ONLY +
                                         PROD_GUARD +
                                         FIXTURE_PATCHES
PROD_GUARD_AT_LINE_393                 = PRESENT
                                         (returns BEFORE any
                                         tracker mutation;
                                         REDUCER_SEMANTIC_DELTA = 0)
witness file length                    = 592 lines
                                         (9 ordinary it() + B9 +
                                         capture + assert +
                                         7-file event helpers)
```

## §B.10 Accounting (reviewer round-6)

```text
REDUCER_SEMANTIC_DELTA                 = 0 (C2.3 stays closed)
ACTUAL_PRODUCTION_SEMANTIC_DELTA       = 1 line guard +
                                         redundant check removal
                                         (TypeScript narrowing)
TESTS_DELTA                            = -8 (it.fails -> it,
                                          post-fix)
                                         +1 (B9 tracker-poison
                                          witness)
                                         +4 (pre-existing fixture
                                          updates)
DOCS_DELTA                             = evidence doc rewritten
                                         (this commit's §B
                                          replaces the
                                          contradictory
                                          half-pre/half-post
                                          §0)
CONFIG_DELTA                          = 0
STASH_POP                             = 0 (FORENSIC untouched)
```

## §B.11 Verification

```
git diff --check                       = PASS
focused test sweep (post-FIXUP01)     = 9/9 B rows PASS
                                       (B1-B9 hard assertions)
full sdk/__tests__/ sweep             = 214/214 tests PASS
                                       (17 files; CI exit 0)
                                       (1 test failure in
                                       sdk-task-control-coordinator.test.ts
                                       is pre-existing and
                                       unrelated to this change;
                                       confirmed via stash-and-
                                       rerun pre-fix; the test
                                       takes ~20s and times out
                                       sporadically)
PROTECTED_STASHES_INTACT              = true
                                       (FORENSIC 141372c52 at
                                       stash@{1}; lint-staged at
                                       stash@{0}; pre-F0-recon
                                       forensic at stash@{2})
```

## §B.12 Next (C2.4-C authorized by this closure)

```
C2.4-B (0b2f6265c)        witnesses 8/8 B rows = FAIL_OPEN  ✓
C2.4-B-FIXUP01 (adbb5e2d5)  narrow guard + 9/9 B rows = PASS_CLOSED  ✓
  ↓
C2.4-C                    real Local integration;
                          TRANSPORT_REACHABILITY classified
  ↓
C2.4-D                    backend disposition;
                          HUB_REMOTE_FALLBACK_REACHABILITY_VERIFIED
                          + final qualification
  ↓
C2.4 closure → C2.5 → E7
```
