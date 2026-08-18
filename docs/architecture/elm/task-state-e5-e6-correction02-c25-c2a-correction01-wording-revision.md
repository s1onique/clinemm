# C25-C2A-CORRECTION01 — Wording revision + C25-C3 contract freeze

**Subject:** ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.5-C2A-CORRECTION01-WORDING

**Status:** evidence-only correction. No production, test, or config changes.

**Author:** response to reviewer round-20 verdict on C25-C2A (`598f2a414`).

## Entry freeze

```text
ENTRY_HEAD                       = 598f2a414 (C25-C2A)
BRANCH                           = act/elm-architecture01-e0-e4
UNEXPECTED_TRACKED_DIRTY         = false
KNOWN_CLINERULES_UNTRACKED_ONLY  = true  (.clinerules/sdk-transport-integration.md; G0.10)
PROTECTED_STASHES_INTACT         = true
  SHA-256 stash@{1} (FORENSIC, 141372c52)         = e4df6de3220647d5c9dbc27165ec8311d2f277683ff26b66ced67f977d26f233
  SHA-256 stash@{2} (CONTEXT-ACCOUNTING)          = ac85c95cfbabf14945b490a121901175700a41939b9dfd3f80767c84fed5755a
```

## Reviewer verdict on C25-C2A (round-20)

> The structural finding is excellent, but I would not accept the current
> `NOT_REPRODUCED_CAPTURE_VALID` wording unchanged.
>
> The substantive discovery should be preserved: **C04 cannot currently
> be an organic D01 because the "arbiter" is still a legacy mirror.**
> The correction is about not turning a source-level impossibility proof
> plus bridge tests into an empirical organic-capture claim.

The reviewer flagged **two epistemic overclaims** in C25-C2A's closure:

```text
R1 — the "organic experiment" did not actually run
R2 — C-REAL-3/C-REAL-4 are not "known non-D01 active states captured"
```

Plus three hygiene / structural corrections:

```text
R3 — reframe C-REAL as CAPTURE_SURFACE_COMPONENT_QUALIFICATION,
     not organic extension execution
R4 — freeze C25-C3 synthetic-vs-real dependency split
R5 — add terminating newline (EOF hygiene defect in C25-C2A file)
```

This commit applies all five.

## R1 — disposition correction (NOT_REPRODUCED_CAPTURE_VALID → PASS_STRUCTURAL_UNREACHABILITY_CURRENT_PRODUCTION)

### What C25-C2A actually proved

C25-C2A's source recon proved (and `git log -p apps/vscode/src/sdk/SdkController.ts` confirms no change since) that the production `getArbiterSnapshot()` at `apps/vscode/src/sdk/SdkController.ts:565-576` MIRRORS the legacy phase:

```typescript
getArbiterSnapshot: () => {
    // The canonical arbiter is the AgentRuntime.snapshot(); until
    // the forward-fix seam (ELM-02F) lands, the wiring mirrors
    // the legacy projection so classification / arbitration
    // remain well-defined. ...
    const phase = this.turnStateTracker.currentPhase
    return {
        ...emptyArbiterSnapshot(),
        execution: {
            modelStreaming: phase === "streaming",
            tooling: phase === "streaming",
            awaitingApproval: phase === "awaiting_approval",
        },
    }
}
```

Under this mirror:

```text
(legacyPhase === "idle")
   ⇒ arbiter.execution.modelStreaming   = false
   ⇒ arbiter.execution.awaitingApproval = false
   ⇒ arbiter.pendingToolCalls           = []   (always empty in current wiring)
   ⇒ arbiterActive                      = false
```

The C04 predicate is:

```text
D01_LEGACY_FALSE_IDLE iff
  legacyPhase === "idle"
  ∧ shadowPhase === "streaming"
  ∧ arbiterActive === true
```

The first conjunct (`legacyPhase === "idle"`) and the third conjunct
(`arbiterActive === true`) are now **co-dependent** — `arbiterActive`
is a function of `legacyPhase` itself (through the mirror). When
`legacyPhase === "idle"`, `arbiterActive === false` by construction.

Therefore:

```text
(legacyPhase === "idle") ∧ (arbiterActive === true) = �   (structurally false)
```

This is a **source-level impossibility proof**, not a failed reproduction.

### What C25-C2A did NOT prove

C25-C2A explicitly noted that the three organic attempts were
**source-recon-attested, not debug-harness-attested**:

> "the debug harness is not runnable … The organic attempts are
> therefore source-recon-attested, not debug-harness-attested."

The disposition `NOT_REPRODUCED_CAPTURE_VALID` was therefore overclaiming:

```text
NOT_REPRODUCED_CAPTURE_VALID implies:
  - an organic run was observed
  - organic events were captured
  - capture surface was inspected, found sufficient, and yielded zero D01s

But what actually happened:
  - no organic run was observed
  - the source was reconnoitered
  - source proof shows D01 is structurally unreachable in current production
```

The reviewer's correct reformulation is:

```text
CURRENT_PRODUCTION_C04_REACHABILITY
  = PROVEN_STRUCTURALLY_UNREACHABLE

ORGANIC_REAL_C04_EXPERIMENT
  = NOT_EXECUTED
    (execution unnecessary for reachability determination;
     source proof is decisive)

CAPTURE_SURFACE
  = QUALIFIED_FOR_CANONICAL_BRIDGE

REAL_C04_REPRODUCED
  = false

REAL_C04_NOT_REPRODUCED_EMPIRICALLY
  = NOT_CLAIMED

C25_C2_VERDICT
  = PASS_STRUCTURAL_UNREACHABILITY_CURRENT_PRODUCTION
```

This is **stronger** than `NOT_REPRODUCED_CAPTURE_VALID` because it
explicitly states that the experiment's reachability was determined by
source, not by capture-surface inspection. The capture surface IS
sufficient — the question of sufficiency became moot when reachability
was disproven at the source level.

### Why this is NOT CAPTURE_INSUFFICIENT

The reviewer's `CAPTURE_INSUFFICIENT` examples are:

```text
- classification visible but raw arbiter fields missing
- cannot bind record to current session
- cannot distinguish canonical from reconstructed
- capture output silently drops relevant observations
```

None of these apply:

```text
✗ classification visible but raw arbiter fields missing     N/A
   (recorder preserves modelStreaming, awaitingApproval,
    activeToolCount, toolCalls, pendingToolCalls-derived fields
    on every record — task-state-shadow-recorder.ts:64-90)

✗ cannot bind record to current session                      N/A
   (taskEpochOrOpaqueTaskKey on every record —
    task-state-shadow-recorder.ts:85)

✗ cannot distinguish canonical from reconstructed            N/A
   (origin field on every record — task-state-shadow-recorder.ts:74)

✗ capture output silently drops relevant observations        N/A
   (C-REAL-2 proves 1:1 delivery; env-flag wiring is default-on
    per task-state-shadow-host-wiring.ts:62-69)
```

So:

```text
capture-surface quality = QUALIFIED_FOR_CANONICAL_BRIDGE
reachability in current production = STRUCTURALLY_UNREACHABLE
disposition = PASS_STRUCTURAL_UNREACHABILITY_CURRENT_PRODUCTION
```

## R2 — reframe C-REAL-3 / C-REAL-4 as capture-surface invariants (not negative-control classifier evidence)

C25-C2A claimed:

> "known non-D01 active states captured = YES (negative-control bridge rows)"

This overclaimed. The C-REAL rows are:

```text
C-REAL-3 → disposed subscription does not reach shadow
           (post-dispose delivery suppression)

C-REAL-4 → no-active-session event does not reach shadow
           (NO_ACTIVE_SESSION fail-closed at the wiring boundary)
```

Both are **boundary-suppression** tests, not **active classifier observations**.

What they actually prove:

```text
C-REAL-3 PASSES when
  - canonical event is emitted to the subscription
  - but the subscription has been disposed
  - the shadow observation count does not increase
  - this is fail-closed at the transport boundary

C-REAL-4 PASSES when
  - canonical event is emitted for sessionId S
  - but session S is not in activeSessions
  - the wiring drops the event at the boundary
  - this is fail-closed at the session-binding boundary
```

What they do **NOT** prove:

```text
active canonical observation
  → classifier executes
  → predicate false
  → classification != D01
```

That would require an active observation where the classifier runs and
yields a non-D01 result. C-REAL-3 and C-REAL-4 deliberately prevent the
classifier from running (boundary suppression). They are
**transport-boundary invariants**, not **classifier discriminative evidence**.

### Correct reframing

The C-REAL evidence chain now stands as:

```text
C-REAL-1  pre-session subscribe is point-in-time
C-REAL-2  fresh subscribe + canonical sequence = 1:1 host → shadow
C-REAL-3  post-dispose: shadow delta = 0   (transport-boundary invariant)
C-REAL-4  no-active-session: shadow delta = 0 (session-binding invariant)
C-REAL-5  package-pin (production wiring + production LocalRuntimeHost)
```

What this collectively proves:

```text
✓ transport object identity is correct
✓ canonical subscription delivers exactly one observation per canonical event
✓ disposed subscriptions do not leak into shadow
✓ events for non-active sessions do not leak into shadow
✓ wiring factory + LocalRuntimeHost are production-typed
```

What it does **NOT** prove:

```text
✗ the classifier discriminates correctly under active inputs
  (that requires C25-C3 C04_SYNTHETIC_REAL_CLASSIFIER_CHAIN)
✗ non-D01 active states are observed in production
  (that would require organic REAL_C04 execution, which is NOT_EXECUTED)
```

The classifier-discriminative claim was structural, not captured:

```text
The classifier discriminates because:
  - classify() at task-state-shadow-recorder.ts:521 is structural
  - the C04 predicate at recorder.ts:542-547 is exact
  - if the predicate held, D01 returns; otherwise the classifier
    falls through to D02 / D03 / D05 / D10 etc.
  - this is provable by reading the classifier, not by capturing it.
```

This is the correct epistemic split: **boundary invariants from the
bridge tests, structural classifier behavior from source reading, and
discriminative classifier evidence from C25-C3.**

## R3 — reframe C-REAL as CAPTURE_SURFACE_COMPONENT_QUALIFICATION

The reviewer's epistemic split (frozen at C25-C0):

```text
REAL_C04
  = actual running extension/task/session execution

C04_SYNTHETIC_REAL
  = synthetic stimulus through real Local transport/wiring/classifier
```

C-REAL exercises the C-REAL chain with a stub agent (test `createAgent` seam). It is **not** an organic extension execution. It qualifies the **components** of the canonical path: the transport object, the canonical subscription, the wiring's observation ingress, the differential computation, the recorder. It is **not** a qualification of "the production process produces D01".

The correct label is:

```text
CAPTURE_SURFACE
  = QUALIFIED_FOR_CANONICAL_BRIDGE
  = real LocalRuntimeHost + real subscribeRuntimeEvents +
    real subscribeCanonicalRuntimeEventsToShadow + real wiring +
    real recorder
  = production-typed at every observation-ingress component
  = NOT organic extension execution
  = NOT evidence of organic REAL_C04
```

This is the correct epistemic label. C-REAL demonstrates that if an
organic canonical event flows through the production transport, the
recorder will receive it. It does not demonstrate that the organic
event flow itself produces D01 — that is the C04_SYNTHETIC_REAL contract.

## R4 — C25-C3 synthetic-vs-real dependency split

The honest topology for C25-C3 (per the reviewer):

```text
SYNTHETIC:
  getLegacyPhase
  getArbiterSnapshot
  canonical event stimulus

REAL:
  transport object
  canonical subscription
  observation ingress
  shadow transition
  differential computation
  classifier
  recorder
```

The full topology:

```text
synthetic causal inputs (legacyPhase, arbiter, canonical event)
  ↓
REAL LocalRuntimeHost
  ↓
REAL subscribeRuntimeEventsToShadow
  ↓
REAL TaskShadowHostWiring
  ↓
REAL comparator
  ↓
REAL recorder/classify()
```

Call this explicitly:

```text
C04_SYNTHETIC_REAL_CLASSIFIER_CHAIN
```

rather than implying the current SdkController dependencies themselves are real.

The synthetic dependency injection is required because the actual
production `getArbiterSnapshot()` MIRROR makes D01 impossible. This is
the same structural finding that drives C25-C2's disposition — the
C25-C3 phase deliberately decouples the classifier+recorder+transport
chain from the mirror so the **classifier contract** can be qualified
in isolation.

This is legitimate: C04_SYNTHETIC_REAL_CLASSIFIER_CHAIN is a
**classifier contract qualification against the post-mirror semantic
shape**, not a "simulate something production should currently
produce" claim. The forward-fix seam `ELM-02F` will replace the mirror
in production; C25-C3 validates that the classifier+recorder chain
correctly detects C04 once that seam lands.

### Required positive witness (frozen)

Construct one causally minimal observation:

```text
inputs:
  legacyPhase = idle
  arbiter.execution.modelStreaming = true
  arbiter.execution.awaitingApproval = false
  arbiter.pendingToolCalls = []

  canonical event causes:
    shadowPhase = streaming
```

Require exact:

```text
D01_LEGACY_FALSE_IDLE = 1
D10_UNKNOWN           = 0
invariantViolations   = 0
observerErrors        = 0
evidenceGaps          = 0

origin                = RUNTIME_CANONICAL
legacyPhase           = idle
shadowPhase           = streaming
modelStreaming        = true
arbitration           = SHADOW_CORRECT
```

Do not merely count D01; assert the retained record's raw causal fields.

### Required negative matrix (frozen)

Use **three orthogonal negatives** (the reviewer's matrix + shadow-side ablation):

```text
P   legacyPhase = idle
    arbiterActive = true
    shadowPhase = streaming
    → D01 = 1, arbitration = SHADOW_CORRECT

N1  legacyPhase = streaming       (remove legacy side)
    arbiterActive = true
    shadowPhase = streaming
    → D01 = 0
    → frozen expected classification = D10_UNKNOWN
       (no legacy-shadow divergence; classifier falls through)

N2  legacyPhase = idle
    arbiterActive = false         (remove arbiter side)
    shadowPhase = streaming
    → D01 = 0
    → frozen expected classification = D02_SHADOW_FALSE_ACTIVE
       (task-state-shadow-recorder.ts:550-557)

N3  legacyPhase = idle
    arbiterActive = true
    shadowPhase = idle            (remove shadow side)
    → D01 = 0
    → frozen expected classification = D10_UNKNOWN
       (no shadow-streaming branch reached)
```

The expected classifications are derived from the classifier at
`task-state-shadow-recorder.ts:521-595`. They MUST be frozen exactly
in the C25-C3 evidence — if `classify()` returns anything else for N1,
N2, or N3, that is a classifier regression and C25-C3 halts.

### Necessity probe (frozen)

The cleaner necessity proof is **input ablation**, not classifier mutation:

```text
P   → D01 = 1
N1  → D01 = 0    (legacy side matters)
N2  → D01 = 0    (arbiter side matters)
N3  → D01 = 0    (shadow side matters)
```

This demonstrates that all three parts of the predicate independently
matter. No production classifier code is mutated. If a mutation probe
is desired, it stays secondary and **uncommitted** (lives in a stash
or scratch file, never enters a commit in this epic).

This demonstrates that all three parts of the predicate independently
matter. No production classifier code is mutated. If a mutation probe
is desired, it stays secondary and **uncommitted** (lives in a stash
or scratch file, never enters a commit in this epic).

### R4 amendment (C25-C3-CORRECTION01 — frozen-contract disposition)

When the C25-C3 implementation landed at `aa273d922`, the reviewer's
round-22 disposition identified three contract drifts between this
R4 freeze and what the implementation actually qualified. They are
**dispositioned here** rather than silently superseding the freeze.

**CLASSIFIER_IMPLEMENTATION_DEFECT = false**
**C25_C3_TEST_DEFECT              = false**
**C25_C3_FREEZE_DEFECT            = true** (this amendment corrects it)

#### N1, N3 frozen expected classification: `D10_UNKNOWN` → `D00_AGREE`

The freeze above said:

```text
N1  → frozen expected classification = D10_UNKNOWN
       (no legacy-shadow divergence; classifier falls through)

N3  → frozen expected classification = D10_UNKNOWN
       (no shadow-streaming branch reached)
```

The C25-C3 implementation observed `D00_AGREE` for both N1 and N3.

**Root cause:** for N1 and N3, `legacyPhase === shadowPhase`. The
comparator's `compareWith` returns `divergence === undefined`. The
recorder's classifier entry (`task-state-shadow-recorder.ts:530`)
short-circuits with `if (!divergence) return "D00_AGREE"`. The
classifier is therefore not reached for D00-D10 on N1/N3.

`D10_UNKNOWN` is reachable only when a divergence EXISTS but no
branch matches D00-D09 — a situation that does not arise when
legacy == shadow.

**Disposition:** the frozen expected classifications were wrong;
`D00_AGREE` is the correct expected class for both N1 and N3.
This is exactly the kind of freeze-discipline finding the matrix
is designed to catch. `QUALIFICATION_FOUND_CONTRACT_ERROR = true`.

#### Topology decomposition: full chain → TRANSPORT_PROOF ∧ CLASSIFIER_PROOF

The freeze above said the full topology starts at `LocalRuntimeHost`.
The C25-C3 implementation entered at `wiring.observeCanonicalRuntimeEvent(...)`
— which is **the exact entry point** that `subscribeCanonicalRuntimeEventsToShadow`
calls per canonical event. Reviewer's preferred disposition:

```text
Option B — decompose the proof:
  TRANSPORT_PROOF  = C-REAL-1..5  (real Local → real helper → real wiring)
  CLASSIFIER_PROOF = C25-C3       (direct canonical-event ingress into wiring)
  JOINT_SYNTHETIC_REAL_PROOF = TRANSPORT_PROOF ∧ CLASSIFIER_PROOF
```

Re-running already-qualified Local transport inside every classifier
matrix case adds setup cost without materially strengthening the
classifier causal evidence. The proof is joint:
`JOINT_SYNTHETIC_REAL_C04_PROOF = TRANSPORT_PROOF ∧ CLASSIFIER_PROOF`.

#### "Three parts" → THREE_PREDICATE_CONJUNCTS

The freeze above uses the word "three parts" (which is correct —
legacy side, arbiter side, shadow side). The C25-C3 test header
later used "four conjuncts" which was an imprecise wording. The
corrected wording:

```text
THREE_PREDICATE_CONJUNCTS:
  conjunct_1: legacyPhase === "idle"           (legacy side)
  conjunct_2: shadowPhase === "streaming"      (shadow side, streaming specifically)
  conjunct_3: arbiterActive === true           (arbiter side)

N1 removes conjunct_1 (legacy flipped to "streaming")
N2 removes conjunct_3 (arbiter flipped to inactive)
N3 removes conjunct_2 (shadow flipped to "idle")
```

#### Corrected C25-C3 frozen contract (this amendment supersedes the R4 wording above for C25-C3 only)

```text
EXPECTED_CLASSIFICATIONS:
  P   → D01_LEGACY_FALSE_IDLE = 1, arbitration = SHADOW_CORRECT
  N1  → D01 = 0, classification = D00_AGREE
  N2  → D01 = 0, classification = D02_SHADOW_FALSE_ACTIVE
  N3  → D01 = 0, classification = D00_AGREE

JOINT_SYNTHETIC_REAL_C04_PROOF:
  TRANSPORT_PROOF  = C-REAL-1..5
  CLASSIFIER_PROOF = C25-C3

THREE_PREDICATE_CONJUNCTS = (legacy=idle, shadow=streaming, arbiterActive=true)

VERDICT (after C25-C3-CORRECTION01):
  CLASSIFIER_IMPLEMENTATION_DEFECT = false
  C25_C3_TEST_DEFECT              = false
  C25_C3_FREEZE_DEFECT            = true   (now amended)

  C25_C3_VERDICT                  = PASS_C04_SYNTHETIC_REAL_CLASSIFIER_CHAIN
  C25_C4_AUTHORIZED               = true
```

This amendment does NOT modify R1, R2, R3 of this doc (which
remain as-applied for the C25-C2A disposition). It is a R4-only
amendment that scopes precisely to the C25-C3 freeze wording. The
R4-corrected contract has been carried into the C25-C3 evidence
file at `docs/architecture/elm/task-state-e5-e6-correction02-c25-c3-c04-synthetic-real-classifier-chain-evidence.md`
under `## C25-C3-CORRECTION01 — frozen-contract disposition`.

## R5 — terminating newline (EOF hygiene defect in C25-C2A file)

C25-C2A's evidence file `task-state-e5-e6-correction02-c25-c2-real-c04-capture-evidence.md`
lacked a terminating newline. `git diff --check` exit-0 was technically
consistent (git's `--check` does not flag missing-final-newline as a
whitespace error — it flags tab/space/CRLF/conflict-marker errors per
`git diff-options` documentation), but this epic's hygiene standard
demands a trailing newline at EOF.

The reviewer noted:

> "Given how many EOF-hygiene corrections this epic has already needed,
> fix this before or in the C25-C2A correction commit."

R5 is applied in this commit: BOTH files now have terminating newlines.
The C25-C2A file gets a `\\ No newline at end of file`-removing
amendment, and the new C25-C2A-CORRECTION01 file is written with a
trailing newline from the start.

## Summary of corrections applied in this commit

| R# | What | Where | Status |
|----|------|-------|--------|
| R1 | NOT_REPRODUCED_CAPTURE_VALID → PASS_STRUCTURAL_UNREACHABILITY_CURRENT_PRODUCTION | C25-C2A evidence doc, this doc | APPLIED |
| R2 | Remove "non-D01 active states captured" claim; reframe C-REAL-3/4 as transport-boundary invariants | C25-C2A evidence doc (amend), this doc | APPLIED |
| R3 | Reframe C-REAL as CAPTURE_SURFACE_COMPONENT_QUALIFICATION (not organic) | C25-C2A evidence doc (amend), this doc | APPLIED |
| R4 | Freeze C25-C3 synthetic-vs-real dependency split + P/N1/N2/N3 necessity matrix + frozen expected classifications | this doc | APPLIED |
| R4 amendment (C25-C3-CORRECTION01) | Dispositioned R1 + R2 + R3 drifts found in `aa273d922`; N1/N3 D10_UNKNOWN → D00_AGREE; topology decomposed as TRANSPORT_PROOF ∧ CLASSIFIER_PROOF; THREE_PREDICATE_CONJUNCTS | this doc + C25-C3 evidence doc | APPLIED |
| R5 | Add terminating newline to C25-C2A file + this file | both files | APPLIED |

## What is preserved (NOT changed by R1..R5 + R4 amendment)

```text
✓ structural finding: getArbiterSnapshot mirror makes D01 unreachable
  in current production — apps/vscode/src/sdk/SdkController.ts:565-576
✓ ELM-02F forward-fix seam is the documented replacement path
  (per the comment on getArbiterSnapshot itself)
✓ C-REAL bridge chain delivers 1:1 canonical events with all causal fields
✓ C-REAL-3/4 are transport-boundary invariants (R2 only reframes the wording)
✓ W15 frozen synthetic C04 control (G0.3) — unchanged, 60/60 PASS
✓ D4 LOCAL_ONLY scope — unchanged
✓ LEGACY_AUTHORITY = 100%, SHADOW_AUTHORITY = 0%, DIVERGENCE_ACTION = RECORD_ONLY
✓ protected stashes intact
```

## Conservation (this correction commit)

```text
PRODUCTION_SEMANTIC_DELTA  = 0
REDUCER_SEMANTIC_DELTA      = 0
LEGACY_AUTHORITY            = 100%
SHADOW_AUTHORITY            = 0%
DIVERGENCE_ACTION           = RECORD_ONLY
WEBVIEW_CUTOVER             = false
EFFECT_EXECUTION_ENABLED = false
E7_CONSUMER_DELTA           = 0
D4_SCOPE_DELTA              = 0
HUB_PRODUCTION_DELTA        = 0
REMOTE_PRODUCTION_DELTA     = 0
TEST_DELTA                  = 0
CONFIG_DELTA                = 0
```

This C25-C2A-CORRECTION01 commit modifies documentation only. No source,
no test, no config, no new commit shape.

## Regression sweep (at C25-C2A-CORRECTION01)

```text
c2-4-c-bridge (C-REAL-1..5)                5 passed (5)
c2-4-d-hub                                 15 passed (15)
task-state-shadow-correction02-c23-stateful-workloads
                                          60 passed (60)
  incl. C2.3-CONT.5 W15 (synthetic C04)    (unchanged, G0.3)
check-types:c2-4-d-hub                     1 diagnostic matches baseline
check-types:c2-4-c-bridge                  1 diagnostic matches baseline
git diff --check HEAD~1..HEAD              exit 0
git diff --check 598f2a414..HEAD           exit 0
git diff --check (working tree)            exit 0
PROTECTED_STASHES_INTACT                   = true
```

## Stash integrity

Verified at C25-C2A-CORRECTION01 entry. Both SHA-256 fingerprints
match the D3-C7 witness unchanged.

## Board after C25-C2A-CORRECTION01

```text
C2.3                                         ✅ CLOSED
C2.4                                         ✅ CLOSED
C2.4-D4                                      ✅ LOCAL_ONLY

C2.5
  C25-C0                                     ✅ PASS_RECON (cf8705544)
  C25-C1                                     �️ SKIPPED (INSTRUMENTATION_REQUIRED=false)

  C25-C2
    CURRENT_PRODUCTION_C04_REACHABILITY      = STRUCTURALLY_UNREACHABLE
    ORGANIC_REAL_C04_EXPERIMENT               = NOT_EXECUTED (source decisive)
    CAPTURE_SURFACE                           = QUALIFIED_FOR_CANONICAL_BRIDGE
    C-REAL-1..5 boundary + transport          ✅
    SAME_INGRESS_SAMPLE                       ✅
    C25-C2A-CORRECTION01                      🟢 APPLIED (this commit)

  C25-C3 C04_SYNTHETIC_REAL_CLASSIFIER_CHAIN � AUTHORIZED
    P  (idle + streaming shadow + active arbiter → D01 = 1)
    N1 (streaming + streaming shadow + active arbiter → D01 = 0)
    N2 (idle + streaming shadow + inactive arbiter → D01 = 0)
    N3 (idle + idle shadow + active arbiter → D01 = 0)
    necessity by input ablation, not classifier mutation
  C25-C4 adversarial                          ⏳
  C25-C5 terminal + E7 auth                   ⏳

E7                                            ⛔ BLOCKED on C2.5
```

## Next (planned, contingent)

C25-C3 — C04_SYNTHETIC_REAL_CLASSIFIER_CHAIN. One test file (or a
small fixture) that:

1. Builds the C-REAL bridge chain (real LocalRuntimeHost + real
   subscribeCanonicalRuntimeEventsToShadow + real wiring)
2. Injects synthetic causal inputs (legacyPhase, arbiter, canonical event)
3. Asserts the P / N1 / N2 / N3 matrix exactly as frozen above
4. Asserts the retained record's raw causal fields for P
5. Asserts frozen expected classifications for N1 / N2 / N3

C25-C3 lives in `apps/vscode/src/sdk/__tests__/c04-synthetic-real-classifier-chain.c25-c3.test.ts`
(per the planned edit target in C25-C0's summary).

C25-C3 must remain a separate commit from C25-C2A-CORRECTION01. The
epistemic split between "structural reachability proof" (C25-C2) and
"classifier contract qualification" (C25-C3) is the reviewer's
structural requirement.
