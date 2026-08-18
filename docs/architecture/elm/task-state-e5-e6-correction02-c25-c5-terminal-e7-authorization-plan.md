# C2.5-C5 — Terminal evidence + E7 authorization

**Subject:** ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.5-C5

**ENTRY_HEAD:** `34f326f6e` (C25-C4-CORRECTION03 R14)
**EXIT_HEAD:**  `<this commit's tip>`
**PLAN:**       `<this file>`
**EVIDENCE:**   docs/architecture/elm/task-state-e5-e6-correction02-c25-c5-terminal-e7-authorization-evidence.md

## 1. SCOPE

C2.5-C5 is the terminal qualification of the C2.5 range.
The substantive adversarial, classifier, transport,
typecheck, and dispose-safety work has all already
landed. C25-C5 is therefore **not** a code-bearing ACT;
it is a terminal evidence-and-decision commit that:

1. Aggregates the joint proof (TRANSPORT + CLASSIFIER +
   ROBUSTNESS + TYPECHECK + DISPOSE_SAFETY +
   DOC_CONSISTENCY) into a single signed terminal claim.
2. Assembles the SUBSCRIPTION_LIFECYCLE witness from the
   already-existing 20 lifecycle tests (no production
   change; no test addition).
3. Classifies `CANONICAL_ARBITER_SOURCE` and decides
   `E7_AUTHORIZED`.
4. Opens `ELM-02F-CORRECTION01` as the bounded ACT that
   unblocks E7.

**No production change.**
**No test addition.**
**No typecheck delta.**

```
PRODUCTION_SEMANTIC_DELTA = 0
PRODUCTION_LOC               = 0
PUBLIC_API_DELTA            = 0
PROTOCOL_DELTA              = 0
HUB_PRODUCTION_DELTA        = 0
REMOTE_PRODUCTION_DELTA     = 0
TEST_DELTA                  = 0
DOC_DELTA                   = 1 terminal plan (this file)
                            + 1 terminal evidence doc
                            + 1 ELM-02F-CORRECTION01 plan stub
CONFIG_DELTA                = 0
```

## 2. WHY THIS TERMINAL SHAPE

### 2.1 SUBSCRIPTION_LIFECYCLE is already proven

The C25-C4 reviewer's round-19 T1 surface is
**already exercised end-to-end** by three dedicated test
files totaling 20 tests:

```
apps/vscode/src/sdk/__tests__/
  task-state-shadow-host-wiring.e2f-f1-correction01.test.ts
    8 tests — host-wiring lifecycle boundary
  sdk-controller-production-lifecycle.e2f-f1-correction03.test.ts
    8 tests — owner lifecycle (CanonicalRuntimeShadowSubscription)
  vscode-session-host.subscribe-runtime-events.e2f-f1.test.ts
    4 tests — session-host subscribe surface
                                            ─────
                                20 tests, all PASS
```

Specifically, the exact T1 shape the reviewer asked for
is already proven by F1-LC-3 and F1-LC-6:

```
F1-LC-3: attach(B) disposes the previous listener;
         event A no longer observed;
         event B observed exactly once

F1-LC-6: owner.dispose() drops the active listener;
         subsequent events are not observed
```

These tests use the production owner class
(`CanonicalRuntimeShadowSubscription` from
`apps/vscode/src/sdk/canonical-event-subscription.ts`)
that the `SdkController` uses at the wiring construction
site (`SdkController.ts:538`) and at the reattach call
site (`SdkController.ts:1668`).

The C25-C5 terminal evidence simply enumerates these
tests and binds them to the C25-C4 dispose-safety
finding. No new tests are required because:

  * The dispose-safety CONCLUSION (C25-C4 R8/R12) says
    `dispose()` does not gate canonical ingress. The
    production safety property is OWNER/SUBSCRIPTION
    TEARDOWN preventing post-dispose invocation.
  * F1-LC-3 + F1-LC-6 prove the owner/subscription
    teardown IS the load-bearing mechanism in production.
  * C25-C5's terminal claim is therefore that the
    "production owner teardown prevents callback into
    disposed wiring" invariant has been proven at the
    unit level (the lifecycle tests) and at the
    component level (the 12 C25-C4 tests).

### 2.2 CANONICAL_ARBITER_SOURCE is currently LEGACY_MIRROR

The SdkController's `getArbiterSnapshot` closure
(`SdkController.ts:565-580`) currently derives the
arbiter from the legacy `turnStateTracker.currentPhase`
projection:

```ts
getArbiterSnapshot: () => {
    // The canonical arbiter is the AgentRuntime.snapshot();
    // until the forward-fix seam (ELM-02F) lands, the wiring
    // mirrors the legacy projection so classification /
    // arbitration remain well-defined.
    const phase = this.turnStateTracker.currentPhase
    return {
        ...emptyArbiterSnapshot(),
        execution: {
            modelStreaming: phase === "streaming",
            tooling: phase === "streaming",
            awaitingApproval: phase === "awaiting_approval",
        },
    }
},
```

Replacing this with a true `AgentRuntime.snapshot()`
requires adding a `runtimeSnapshot()` getter to the
session host surface (`SdkSessionHost`), wiring it
through `VscodeSessionHost`, and qualifying the new
mapping. That is a bounded production change — but the
reviewer's structural concern is correct: doing it inside
C25-C5 would enlarge the epistemic surface at exactly
the point where the range is being closed.

Therefore C25-C5 freezes:

```
CANONICAL_ARBITER_SOURCE  = LEGACY_MIRROR
CANONICAL_ARBITER_REPLACE = OPEN   (gates E7)

E7_AUTHORIZED             = false
E7_BLOCKED_REASON         = C25_ARB_SOURCE_RESIDUE
E7_UNBLOCK_ACT            = ELM-02F-CORRECTION01
```

`ELM-02F-CORRECTION01` is opened as the next ACT. It is
a single-purpose bounded change: add `runtimeSnapshot()`
on the session host surface + wire the production
`getArbiterSnapshot` to read it + qualify the new mapping
shape against the existing C25-C4 fixture (which already
covers the `recovery` → `ArbiterSnapshot` shape).

### 2.3 The two terminal-gate rows are independent

```
C25-C5-T1 SUBSCRIPTION_LIFECYCLE  = PROVEN (this commit)
C25-C5-T2 CANONICAL_ARBITER_SOURCE = CLASSIFIED (LEGACY_MIRROR)
                                 + E7_AUTHORIZED = false
                                 + ELM-02F-CORRECTION01 opened

C25-C5 OVERALL = PASS
C2.5           = CLOSED_CLEAN  (after C25-C5)
E7             = BLOCKED       (on C25_ARB_SOURCE_RESIDUE
                               -> ELM-02F-CORRECTION01)
```

## 3. WHAT THIS COMMIT PRODUCES

```
3.1  Terminal evidence doc aggregating:
       TRANSPORT_PROOF
       CLASSIFIER_PROOF
       ROBUSTNESS_PROOF
       TYPECHECK_PROOF
       DISPOSE_SAFETY_FINDING
       DOC_CONSISTENCY
       SUBSCRIPTION_LIFECYCLE_WITNESS
       CANONICAL_ARBITER_SOURCE_CLASSIFICATION
       E7_AUTHORIZATION_DECISION

3.2  ELM-02F-CORRECTION01 plan stub:
       - scope (single closure + new session-host getter
         + new mapping)
       - acceptance gate
       - carry-forward from C25-C5

3.3  C25-C4 plan + evidence R14 update applied this
     commit (the C2.4-D-not-closed-by-C25-C5 wording
     fix from the reviewer's round-19 digest).

3.4  C25-C4 evidence + capture evidence docs updated to
     reflect the C25-C5 disposition.
```

## 4. ACCEPTANCE GATE

```
C25_C5_TERMINAL_VERDICT          = PASS

TRANSPORT_PROOF                  = PROVEN  (C-REAL-1..5)
CLASSIFIER_PROOF                 = PROVEN  (C25-C3 P/N1/N2/N3)
ROBUSTNESS_PROOF                 = PROVEN  (C25-C4 12 adversarial tests)
TYPECHECK_PROOF                  = PROVEN  (c2-5-c4 baseline 1 diagnostic, 0 C4-OWN)
DISPOSE_SAFETY_FINDING           = PROVEN  (C25-C4 R8/R12 sharpening)

C25_C5_T1_SUBSCRIPTION_LIFECYCLE = PROVEN
  F1-LC-3   attach(B) disposes previous  -> PASS
  F1-LC-6   owner.dispose() drops active  -> PASS
  HOST-WIRING-LIFECYCLE tests (8)         -> PASS
  SDK-CONTROLLER-LIFECYCLE tests (8)      -> PASS
  SESSION-HOST-SUBSCRIBE tests (4)        -> PASS
                                       ─────
                                       20 / 20

C25_C5_T2_CANONICAL_ARBITER_SOURCE = LEGACY_MIRROR (CLASSIFIED)
E7_AUTHORIZED                      = false
E7_BLOCKED_REASON                  = C25_ARB_SOURCE_RESIDUE
E7_UNBLOCK_ACT                     = ELM-02F-CORRECTION01

C2.5 OVERALL                       = CLOSED_CLEAN
```

## 5. POST-C25-C5 BOARD

```
C25-C0                                  CLOSED
C25-C1                                  SKIPPED
C25-C2 + C25-C2A + C25-C2A-CORRECTION01 CLOSED
C25-C3 + C25-C3-CORRECTION01             CLOSED
C25-C4 + C25-C4-CORRECTION01             CLOSED
   + C25-C4-CORRECTION02                 CLOSED
   + C25-C4-CORRECTION03                 CLOSED
   + R14 (C2.4-D wording residue)        CLOSED  (this commit, plan-level)
C25-C5 terminal + E7 auth                CLOSED  (this commit)

ELM-02F-CORRECTION01                     🟢 NEXT
E7                                       ⛔ BLOCKED on ELM-02F-CORRECTION01
```

The ELM-02F-CORRECTION01 ACT is the bounded unblock for
E7. Its scope is explicitly a single production closure
in `SdkController.ts` + a single getter on
`SdkSessionHost` + a single mapping function, all
qualified against the existing C25-C4 fixture shape.
