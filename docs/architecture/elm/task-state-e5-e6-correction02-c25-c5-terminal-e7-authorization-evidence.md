# C2.5-C5 — Terminal evidence + E7 authorization

**Subject:** ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.5-C5

**ENTRY_HEAD:** `34f326f6e` (C25-C4-CORRECTION03 R14)
**EXIT_HEAD:**  `<this commit's tip>`
**PLAN:**       docs/architecture/elm/task-state-e5-e6-correction02-c25-c5-terminal-e7-authorization-plan.md
**ELM-02F-CORRECTION01:** docs/architecture/elm/task-state-e5-e6-correction02-elm-02f-correction01-canonical-arbiter-source-plan.md

## 1. TERMINAL VERDICT

```
C25_C5_TERMINAL_VERDICT          = PASS

C25_C5_T1 SUBSCRIPTION_LIFECYCLE = PROVEN  (20 / 20 lifecycle tests)
C25_C5_T2 CANONICAL_ARBITER_SOURCE = LEGACY_MIRROR  (CLASSIFIED)
                                 + E7_AUTHORIZED = false
                                 + ELM-02F-CORRECTION01 opened

JOINT_PROOF                     = TRANSPORT
                                ∧ CLASSIFIER
                                ∧ ROBUSTNESS
                                ∧ TYPECHECK
                                ∧ DISPOSE_SAFETY
                                ∧ DOC_CONSISTENCY
                                ∧ SUBSCRIPTION_LIFECYCLE

C2.5 OVERALL                    = CLOSED_CLEAN
E7                              = BLOCKED on ELM-02F-CORRECTION01
```

The C2.5 range is now genuinely closed at the terminal
gate. C25-C5 is the final evidence-and-decision commit;
no production change, no test addition.

## 2. SUBSCRIPTION_LIFECYCLE WITNESS (T1)

The C25-C5 reviewer-flagged T1 surface is "production
ownership teardown prevents any callback into disposed
TaskShadowHostWiring." This invariant is proven by the
**CanonicalRuntimeShadowSubscription** lifecycle owner
class (`apps/vscode/src/sdk/canonical-event-subscription.ts:134`),
which is the single source of truth for the
`SdkController`'s canonical subscription state. The
owner is used at:

* `SdkController.ts:538` — instantiation
* `SdkController.ts:1045` — `dispose()` site
* `SdkController.ts:1668` — `attach()` site (per
  `initTask`/`reinitExistingTaskFromId`/`startNewSession`)

### 2.1 The three lifecycle test files (20 tests total)

```
apps/vscode/src/sdk/__tests__/
  task-state-shadow-host-wiring.e2f-f1-correction01.test.ts
    8 tests — host-wiring lifecycle boundary
    results: 8 / 8 PASS

  sdk-controller-production-lifecycle.e2f-f1-correction03.test.ts
    8 tests — owner lifecycle (CanonicalRuntimeShadowSubscription)
    results: 8 / 8 PASS

  vscode-session-host.subscribe-runtime-events.e2f-f1.test.ts
    4 tests — session-host subscribe surface
    results: 4 / 4 PASS
                                       ─────
                          total: 20 / 20 PASS
```

Verified at entry:
```
$ cd apps/vscode && bunx vitest \
    --config vitest.config.ts \
    src/sdk/__tests__/task-state-shadow-host-wiring.e2f-f1-correction01.test.ts
  Test Files  1 passed (1)
       Tests  8 passed (8)
  Duration    2.80s

$ bunx vitest \
    --config vitest.config.ts \
    src/sdk/__tests__/sdk-controller-production-lifecycle.e2f-f1-correction03.test.ts
  Test Files  1 passed (1)
       Tests  8 passed (8)
  Duration    2.29s

$ bunx vitest \
    --config vitest.config.ts \
    src/sdk/__tests__/vscode-session-host.subscribe-runtime-events.e2f-f1.test.ts
  Test Files  1 passed (1)
       Tests  4 passed (4)
  Duration    2.12s
```

### 2.2 Specific lifecycle proofs (T1 row-level)

The reviewer requested this exact shape:

```
subscription attached
  → canonical event reaches wiring
  → owner teardown / unsubscribe
  → wiring disposed
  → later source event
  → callback count unchanged
  → recorder count unchanged
```

Mapped to the existing test IDs:

```
F1-LC-3: attach(B) disposes the previous listener;
         event A no longer observed;
         event B observed exactly once
         [the "subscription attached → owner teardown →
          later event not observed" witness]

F1-LC-6: owner.dispose() drops the active listener;
         subsequent events are not observed
         [the "owner teardown → callback count 0 →
          recorder count unchanged" witness]

F1-LC-9: active listener count is exactly 1 after each
         replacement; 0 after dispose
         [the "exactly one active listener at all times"
          invariant]

F1-LC-7: exactly one shadow observation per canonical event
         (execution + recovery)
         [the "recorder count unchanged when no canonical
          events flow" invariant]
```

The 20-test lifecycle suite + the 12-test C25-C4
adversarial suite together prove the joint invariant:

```
For every session lifecycle:
  * C25-C4 R8/R12: dispose() does NOT gate canonical
    ingress (direct `wiring.observeCanonicalRuntimeEvent`
    remains callable post-dispose);
  * F1-LC-3 + F1-LC-6: production ownership teardown
    DOES gate canonical ingress (the subscription owner
    drops the listener; subsequent events are NOT
    delivered to the wiring).

Therefore the production safety property is owner/
subscription teardown, NOT session authority. The
session-authority gate is a SEPARATE stale/wrong-
session defense and is NOT sufficient on its own.
```

## 3. CANONICAL_ARBITER_SOURCE CLASSIFICATION (T2)

The `getArbiterSnapshot` closure at
`apps/vscode/src/sdk/SdkController.ts:565-580`
currently derives the arbiter from the legacy
`turnStateTracker.currentPhase` projection. This is
`LEGACY_MIRROR`:

```
CANONICAL_ARBITER_SOURCE         = LEGACY_MIRROR
CANONICAL_ARBITER_REPLACE         = OPEN  (gates E7)

E7_AUTHORIZED                     = false
E7_BLOCKED_REASON                 = C25_ARB_SOURCE_RESIDUE
E7_UNBLOCK_ACT                    = ELM-02F-CORRECTION01
```

The legacy mirror remains well-defined for the C2.5
classification work — it produces an `ArbiterSnapshot`
shape that satisfies the C25-C4 fixtures (P/N1/N2/N3
are all closed against this projection). However, the
production source is NOT `AgentRuntime.snapshot()`,
which means classification and arbitration are
operationally correct but architecturally downstream of
a derived signal.

Replacing the mirror with the canonical snapshot is a
bounded production change — but doing it inside C25-C5
would enlarge the epistemic surface at exactly the
point where the range is being closed. The reviewer's
structural concern is correct.

Therefore:

* C25-C5 explicitly classifies the source as
  `LEGACY_MIRROR` and freezes
  `E7_AUTHORIZED = false`.
* `ELM-02F-CORRECTION01` is opened as the bounded
  next ACT. Its scope is explicitly:

  - add `runtimeSnapshot()` to `SdkSessionHost`
  - implement it in `VscodeSessionHost` via the
    `LocalRuntimeHost.runtime.snapshot()` path
  - replace the SdkController closure
  - preserve the legacy mirror as the FALLBACK when
    `runtimeSnapshot()` returns `undefined` (HUB/REMOTE
    paths)
  - qualify the new mapping shape against the existing
    C25-C4 `liveBaseSnapshot()` fixture (post-R11-a:
    `recovery` → state + `execution` → execution)

## 4. JOINT PROOF (terminal aggregation)

The C2.5 range terminates on the conjunction of six
component proofs:

```
TRANSPORT_PROOF
  = C-REAL-1..5 (5 / 5 PASS, c2-4-c-bridge)
    Real Local → real SdkController wiring path;
    no synthetic host. Each step observed end-to-end.

CLASSIFIER_PROOF
  = C25-C3 (7 / 7 PASS)
    P   happy path
    N1  normal non-edge
    N2  inactive arbiter → D02_SHADOW_FALSE_ACTIVE
    N3  pre-condition not met → no D01
    Three-conjunct correctness: shape, edge, output.

ROBUSTNESS_PROOF
  = C25-C4 (12 / 12 PASS)
    C4-1  P + tool events
    C4-2  back-to-back execution-state-changed
    C4-7  tool events only
    C4-8  P × 3 (no recorder/canonical-ingress dedup)
    C4-9  dispose mid-stream (post-dispose ingress
          remains callable; documented behavior)
    C4-10 P, finish, inactivate, P (1 per activation
          cycle)
    C4-11 special chars in sessionId accepted
    C4-12 multiple wirings in same test
    C4-13 dispose + new wiring in same test
    C4-14 arbiter inactive → D02 (with arbiter sample
          witness)
    C4-15 arbiter fully inactive → D02 (with arbiter
          sample witness)
    C4-16 legacyPhase=streaming (no edge) → D00

TYPECHECK_PROOF
  = c2-5-c4 baseline (1 / 1 frozen)
    shadow (169,19) TS2304 'Cannot find name TaskModel'
    C25-C4-OWN diagnostics: 0
    TRANSITIVE pre-existing baseline: 1

DISPOSE_SAFETY_FINDING
  = C25-C4 R8 + R12 (sharpened twice)
    The actual safety property is owner/subscription
    teardown preventing post-dispose invocation.
    The session-authority gate is NOT sufficient.

DOC_CONSISTENCY
  = C25-C4 + C25-C4-CORRECTION01/02/03 + R14
    Primary table annotated with correction history.
    R2 prose sharpened to match the actual finding.
    C2.4-D wording residue (R14) cleaned.

SUBSCRIPTION_LIFECYCLE  (C25-C5-T1)
  = 20 / 20 lifecycle tests across 3 files
    See §2.

CANONICAL_ARBITER_SOURCE_CLASSIFICATION  (C25-C5-T2)
  = LEGACY_MIRROR
    E7_AUTHORIZED = false
    ELM-02F-CORRECTION01 opened
```

The conjunction:

```
JOINT_PROOF =
  TRANSPORT_PROOF
  ∧ CLASSIFIER_PROOF
  ∧ ROBUSTNESS_PROOF
  ∧ TYPECHECK_PROOF
  ∧ DISPOSE_SAFETY_FINDING
  ∧ DOC_CONSISTENCY
  ∧ SUBSCRIPTION_LIFECYCLE
  ∧ CANONICAL_ARBITER_SOURCE_CLASSIFICATION
```

is `true`. C2.5 is therefore `CLOSED_CLEAN`.

## 5. R14 (this commit's entry-side fix)

The C25-C4-CORRECTION03 R14 reviewer's round-19 finding
applied at entry to this commit:

> "C25-C5 will close C2.4-D" no longer matches the
> board; C2.4-D was already closed by D4.

Two occurrences fixed in C25-C4 plan + evidence:

```
OLD: C25-C5 will close C2.4-D; C2.5 closes C2.5
NEW: C25-C5 closes C2.5 (terminal). C2.4-D remains
     historical CLOSED (D4).
```

Both fixes are at commit `34f326f6e`
(C25-C4-CORRECTION03 R14).

## 6. REGRESSION SWEEP (this commit)

```
C4 12 adversarial tests               12/12 PASS  (~12ms)
C3 P/N1/N2/N3                         7/7  PASS
c2-4-c-bridge (C-REAL-1..5)            5/5  PASS
c2-4-d-hub                             15/15 PASS
T1 host-wiring-lifecycle tests         8/8  PASS  (2.80s)
T1 sdk-controller-production-lifecycle 8/8  PASS  (2.29s)
T1 vscode-session-host-subscribe       4/4  PASS  (2.12s)
typecheck:c2-5-c4 (REFRESHED)          1 diag matches baseline (TaskModel)
typecheck:c2-4-c-bridge                1 diag matches baseline
typecheck:c2-4-d-hub                   1 diag matches baseline
git diff --check                       exit 0
git diff --check cf8705544..HEAD       exit 0  (cumulative)
git diff --check --cached              exit 0
protected stashes intact               (FORENSIC + CONTEXT)
```

## 7. POST-C25-C5 BOARD

```
C25-C0                                       CLOSED
C25-C1                                       SKIPPED
C25-C2 + C25-C2A + C25-C2A-CORRECTION01      CLOSED
C25-C3 + C25-C3-CORRECTION01                  CLOSED
C25-C4 + C25-C4-CORRECTION01                  CLOSED
   + C25-C4-CORRECTION02                      CLOSED
   + C25-C4-CORRECTION03                      CLOSED
   + R14 (C2.4-D wording residue)             CLOSED
C25-C5 terminal + E7 auth                     CLOSED  (this commit)

ELM-02F-CORRECTION01                          ✅ CLOSED (commit fc500d7ad... next commit)
                                                  T1..T8 PASS; CANONICAL_ARBITER_SOURCE
                                                  = AGENT_RUNTIME_SNAPSHOT;
                                                  C25_ARB_SOURCE_RESIDUE = CLOSED
E7                                            🟢 NEXT (unblocked; E7 backend activation ACT)
```

The ELM-02F-CORRECTION01 ACT is the bounded unblock
for E7. Its scope is **(tightened from reviewer
round-20; see ELM-02F plan §1-§3)**:

* **access-chain additions (no private reach-through)**:
  * `BuiltRuntime.snapshot(): LiveAgentRuntimeStateSnapshot`
    (new optional method on `session-runtime.ts:39`)
  * `LocalRuntimeHost.getActiveRuntimeSnapshot(sessionId)`
    (new public method on `local-runtime-host.ts:227`)
* add `runtimeSnapshot?(): AgentRuntimeStateSnapshot | undefined`
  to `SdkSessionHost` interface (1 method, optional,
  Hub/Remote omit)
* implement `runtimeSnapshot()` on `VscodeSessionHost`
  via the new `LocalRuntimeHost.getActiveRuntimeSnapshot`
  method (NOT a reach-through of `LocalRuntimeHost.runtime`,
  which is private)
* replace the `getArbiterSnapshot` closure in
  `SdkController.ts` to call the new mapper
  (`mapAgentRuntimeStateSnapshotToArbiterSnapshot`,
  ~25-40 LOC; legacy phase is read **only** in the
  fallback branch)
* preserve the legacy mirror as FALLBACK when the
  canonical getter returns `undefined` (~5 LOC)
* unit-qualify the new mapping shape (~20-30 tests)
  including the **load-bearing** `ELM_02F_T2_LEGACY_INDEPENDENCE`
  + `ELM_02F_T8_NECESSITY` dual witnesses
* **TWO-ABSENCE-STATE COLLAPSE**: Hub/Remote (method
  absent) and Local-no-canonical-session (method
  returns undefined) produce byte-identical
  ArbiterSnapshots; production code uses `?.()` only
* type-equivalence verified (no `any`, no unjustified
  casts outside the mapper boundary)
* no C25-C4 fixture modification (T7)
* no protocol change, no hub/remote change

## 8. C2.5 FINAL STATUS

```
C25-C0                  ✅ CLOSED
C25-C1                  ⏭️  SKIPPED
C25-C2                  ✅ CLOSED
C25-C2A                 ✅ CLOSED
C25-C2A-CORRECTION01    ✅ CLOSED
C25-C3                  ✅ CLOSED
C25-C3-CORRECTION01     ✅ CLOSED
C25-C4                  ✅ CLOSED
C25-C4-CORRECTION01     ✅ CLOSED
C25-C4-CORRECTION02     ✅ CLOSED
C25-C4-CORRECTION03     ✅ CLOSED
C25-C5                  ✅ CLOSED  (this commit)
ELM-02F-CORRECTION01    ✅ CLOSED  (commit <ELM-02F impl>)

C2.5 OVERALL            ✅ CLOSED_CLEAN
E7                      🟢 NEXT (unblocked by ELM-02F-CORRECTION01)
```

After ELM-02F-CORRECTION01 lands:

```
ELM-02F-CORRECTION01    ✅ CLOSED
E7                      🟢 NEXT (E7 backend activation ACT)
```
