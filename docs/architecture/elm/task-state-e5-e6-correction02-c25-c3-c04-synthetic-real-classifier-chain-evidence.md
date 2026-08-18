# C2.5-C3 — C04_SYNTHETIC_REAL_CLASSIFIER_CHAIN evidence

**Subject:** ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.5-C3-C04-SYNTHETIC-REAL-CLASSIFIER-CHAIN

**Status:** classifier contract qualification against the post-mirror semantic shape. C25-C3 implementation PASS (7/7 tests green); C25-C3-CORRECTION01 amends the frozen R4 wording to match the observed behavior (R1 + R2 + R3). No production, no config, no source changes.

**Author:** response to reviewer round-21 verdict on C25-C2A-CORRECTION01 (`4cf549a1f`) and the round-22 disposition that flagged R1/R2/R3 contract drifts in `aa273d922` (C25-C3 implementation).

## Entry freeze

```text
ENTRY_HEAD                       = aa273d922 (C25-C3 implementation, before this correction)
BRANCH                           = act/elm-architecture01-e0-e4
UNEXPECTED_TRACKED_DIRTY         = false
KNOWN_CLINERULES_UNTRACKED_ONLY  = true  (.clinerules/sdk-transport-integration.md; G0.10)
PROTECTED_STASHES_INTACT         = true
  SHA-256 stash@{1} (FORENSIC, 141372c52)         = e4df6de3220647d5c9dbc27165ec8311d2f277683ff26b66ced67f977d26f233
  SHA-256 stash@{2} (CONTEXT-ACCOUNTING)          = ac85c95cfbabf14945b490a121901175700a41939b9dfd3f80767c84fed5755a

CORRECTION_HEAD                  = <this commit> (C25-C3-CORRECTION01)
CORRECTION_REASON                = QUALIFICATION_FOUND_CONTRACT_ERROR (R1 + R2 + R3)
```

## C25-C2A-CORRECTION01 disposition (round-21)

> The structural finding is excellent.
> ...
> 🟢 C25-C3 is authorized
>
> For P, assert not only the retained record but also the exact injected arbiter input at the same observation
>
> Likewise for N2

This commit applies the C25-C3 contract per the reviewer's freeze in C25-C2A-CORRECTION01 R4. The carry-forward `C25_ARB_SOURCE_RESIDUE = OPEN` (consumer-side arbiter-mirror replacement) is **explicitly not addressed** in this commit — per the reviewer's directive:

> C25-C3 is the experiment that proves the classifier behaves correctly once its inputs are independent.
>
> C25-C5 must not authorize E7 without making the dependency explicit:
>
> E7_ENTRY_REQUIREMENT:
>   REPLACE_LEGACY_ARBITER_MIRROR = REQUIRED

## C25-C3-CORRECTION01 — frozen-contract disposition

This is the small correction the reviewer required after the C25-C3
implementation (`aa273d922`) was found to qualify the **correct**
classifier contract but **silently supersede** three points of the
frozen R4 wording in `C25-C2A-CORRECTION01` (`4cf549a1f`).

The classifier behavior itself passes (see `## Tests`, `## P`,
`## N1`, `## N2`, `## N3` below). The correction is **procedural**:
amend the freeze wording so the contract matches what was actually
qualified. No production change. No test semantic change.

### R1 — frozen N1/N3 expected `D10_UNKNOWN`, observed `D00_AGREE`

The C25-C2A-CORRECTION01 freeze said:

```text
N1  legacyPhase = streaming       (remove legacy side)
    arbiterActive = true
    shadowPhase = streaming
    → D01 = 0
    → frozen expected classification = D10_UNKNOWN

N3  legacyPhase = idle
    arbiterActive = true
    shadowPhase = idle            (remove shadow side)
    → D01 = 0
    → frozen expected classification = D10_UNKNOWN
```

The C25-C3 implementation observed:

```text
N1  → classification = D00_AGREE  (divergence is undefined when legacy == shadow)
N3  → classification = D00_AGREE  (divergence is undefined when legacy == shadow)
```

The reviewer correctly identifies this as a `QUALIFICATION_FOUND_CONTRACT_ERROR`,
not a `CLASSIFIER_IMPLEMENTATION_DEFECT`:

```text
CLASSIFIER_IMPLEMENTATION_DEFECT = false
C25_C3_TEST_DEFECT              = false
C25_C3_FREEZE_DEFECT            = true

N1_EXPECTED_CLASS               = D00_AGREE   (not D10_UNKNOWN)
N3_EXPECTED_CLASS               = D00_AGREE   (not D10_UNKNOWN)

ROOT_CAUSE:
  For N1 and N3, legacy and shadow agree on the same phase:
    N1: legacy = "streaming", shadow = "streaming"
    N3: legacy = "idle",      shadow = "idle"
  The comparator's compareWith returns divergence = undefined when
  shadowPhase === legacyPhase (see task-state-shadow.ts:127-141 and
  the early return at task-state-shadow-recorder.ts:530: `if (!divergence)
  return "D00_AGREE"`). The classifier is therefore not reached for
  D00-D10 on N1/N3; the recorder short-circuits to D00_AGREE.
  D10_UNKNOWN is reachable only when a divergence EXISTS but no
  branch matches D00-D09 — a situation that does not arise when
  legacy == shadow.

PRODUCTION_DEFECT = false
TEST_DEFECT       = false
FROZEN_CONTRACT_DEFECT = true
```

The frozen N1, N3 expected classifications were **wrong**;
`D00_AGREE` is the correct expected class. This is the kind of
freeze-discipline finding the matrix is designed to catch.

The frozen N1, N3 expected classifications were **wrong**;
`D00_AGREE` is the correct expected class. This is the kind of
freeze-discipline finding the matrix is designed to catch.

### R2 — frozen topology included real Local transport; C25-C3 bypassed it

The C25-C2A-CORRECTION01 freeze said:

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

The C25-C3 implementation (with reviewer concurrence in R4 of
`C25-C2A-CORRECTION01` itself: "deliberately decouples … so the
classifier contract can be qualified in isolation") entered at
`wiring.observeCanonicalRuntimeEvent(...)` rather than at
`LocalRuntimeHost`. The reviewer's preferred disposition is **Option B**:

```text
Option B — decompose the proof:
  TRANSPORT_PROOF  = C-REAL-1..5  (real Local → real helper → real wiring)
  CLASSIFIER_PROOF = C25-C3       (direct canonical-event ingress into wiring)
  JOINT_SYNTHETIC_REAL_PROOF = TRANSPORT_PROOF ∧ CLASSIFIER_PROOF
```

This option is preferred because re-running the qualified Local
transport inside every classifier matrix case adds setup cost
(isolated home dir, stub agent, `LocalRuntimeHost` factory) without
materially strengthening the **classifier** causal evidence. The
transport was already independently qualified as a 1:1 fan-out
(C-REAL-1..5 PASS); the classifier contract is what C25-C3
qualifies.

The synthetic-real C04 proof is therefore **joint**:

```text
JOINT_SYNTHETIC_REAL_C04_PROOF
  = TRANSPORT_PROOF              (C-REAL-1..5)
  ∧ CLASSIFIER_PROOF             (C25-C3: P, N1, N2, N3, necessity,
                                         diagnostic, type-sanity)

  TRANSPORT_PROOF:
    real LocalRuntimeHost
      → real subscribeCanonicalRuntimeEventsToShadow
      → real TaskShadowHostWiring
    DELIVERS_CANONICAL_EVENTS_1:1    (C-REAL-1: 0 events pre-session,
                                         2 events post-session)
    BOUNDARY_FAILS_CLOSED            (C-REAL-4: no active session in
                                         lifecycle -> wiring drops)

  CLASSIFIER_PROOF:
    synthetic getLegacyPhase
    synthetic getArbiterSnapshot
    synthetic canonical event
      → real wiring.observeCanonicalRuntimeEvent(...)
      → real TaskShadowObservationCoordinator
      → real TaskShadowComparator
      → real TaskStateShadow
      → real TaskShadowRecorder
      → real classify() at task-state-shadow-recorder.ts:521
      → real arbitrate() at task-state-shadow-recorder.ts:616
    PRODUCES_DISCRIMINATING_PREDICATE  (P → D01_LEGACY_FALSE_IDLE,
                                         N1 → D00_AGREE,
                                         N2 → D02_SHADOW_FALSE_ACTIVE,
                                         N3 → D00_AGREE;
                                         necessity: each conjunct matters)
```

The wiring's `observeCanonicalRuntimeEvent(...)` is **the exact
entry point** that `subscribeCanonicalRuntimeEventsToShadow` calls
per canonical event (`canonical-event-subscription.ts`). The
classifier sees an identical `TaskShadowRecordInput` whether the
event came through `LocalRuntimeHost → subscribeCanonicalRuntimeEventsToShadow`
or through direct ingress.

classifier sees an identical `TaskShadowRecordInput` whether the
event came through `LocalRuntimeHost → subscribeCanonicalRuntimeEventsToShadow`
or through direct ingress.

### R3 — "four conjuncts" wording

The C25-C3 test header initially said:

> "All four conjuncts (legacy side, arbiter side, shadow side,
> shadow=streaming specifically) independently matter."

The C04 predicate at `task-state-shadow-recorder.ts:540-547` actually
has three logical requirements:

```text
legacyPhase   === "idle"
shadowPhase   === "streaming"
arbiterActive === (modelStreaming || awaitingApproval || pendingToolCalls.length > 0)
```

The corrected wording is:

```text
THREE_PREDICATE_CONJUNCTS:
  conjunct_1: legacyPhase === "idle"           (legacy side)
  conjunct_2: shadowPhase === "streaming"      (shadow side, streaming specifically)
  conjunct_3: arbiterActive === true           (arbiter side)

N1 removes conjunct_1 (legacy flipped to "streaming")
N2 removes conjunct_3 (arbiter flipped to inactive)
N3 removes conjunct_2 (shadow flipped to "idle")

Each ablation yields D01 = 0 with a distinct non-D01 classification.
```

### Corrected C25-C3 contract (restated)

```text
SYNTHETIC:
  getLegacyPhase
  getArbiterSnapshot
  canonical event stimulus

REAL (TRANSPORT — qualified separately by C-REAL-1..5):
  LocalRuntimeHost
  subscribeCanonicalRuntimeEventsToShadow
  TaskShadowHostWiring

REAL (CLASSIFIER — qualified by C25-C3):
  wiring.observeCanonicalRuntimeEvent(...)
  TaskShadowObservationCoordinator
  TaskShadowComparator
  TaskStateShadow
  TaskShadowRecorder
  classify() at task-state-shadow-recorder.ts:521
  arbitrate() at task-state-shadow-recorder.ts:616

EXPECTED_CLASSIFICATIONS (corrected):
  P   legacyPhase = idle
      arbiterActive = true
      shadowPhase = streaming
      → D01_LEGACY_FALSE_IDLE = 1
      → arbitration = SHADOW_CORRECT
      → D00_AGREE = 0
      → D02_SHADOW_FALSE_ACTIVE = 0
      → D10_UNKNOWN = 0
      → invariantViolations = 0
      → observerErrors = 0
      → evidenceGaps = 0
      → assert exact injected arbiter input at the same observation

  N1  legacyPhase = streaming       (remove conjunct_1)
      arbiterActive = true
      shadowPhase = streaming
      → D01_LEGACY_FALSE_IDLE = 0
      → classification = D00_AGREE   (divergence undefined; not D10_UNKNOWN)
      → assert shadow transitioned (modelStreaming=true, event=model_stream_started)

  N2  legacyPhase = idle
      arbiterActive = false         (remove conjunct_3)
      shadowPhase = streaming
      → D01_LEGACY_FALSE_IDLE = 0
      → D02_SHADOW_FALSE_ACTIVE = 1
      → arbitration = LEGACY_CORRECT
      → assert exact injected arbiter input (all-false) at the same observation

  N3  legacyPhase = idle
      arbiterActive = true
      shadowPhase = idle            (remove conjunct_2)
      → D01_LEGACY_FALSE_IDLE = 0
      → classification = D00_AGREE   (divergence undefined; not D10_UNKNOWN)

NECESSITY (corrected):
  THREE_PREDICATE_CONJUNCTS = (legacy=idle, shadow=streaming, arbiterActive=true)
  Each conjunct independently necessary (verified by input ablation).

VERDICT:
  CLASSIFIER_IMPLEMENTATION_DEFECT = false
  C25_C3_TEST_DEFECT              = false
  C25_C3_FREEZE_DEFECT            = true   (already amended by this correction)

  C25_C3_VERDICT                  = PASS_C04_SYNTHETIC_REAL_CLASSIFIER_CHAIN
  C25_C4_AUTHORIZED               = true
```

### Verbatim contract restatement (for citation by downstream commits)

```text
C25-C3 qualifies the classifier contract for C04_SYNTHETIC_REAL against
the post-mirror semantic shape. The proof is joint:

  TRANSPORT_PROOF  = C-REAL-1..5  (C2.4-C, real Local → real helper → real wiring)
  CLASSIFIER_PROOF = C25-C3       (this commit, direct canonical ingress)

The classifier proof exercises:
  P   → D01_LEGACY_FALSE_IDLE = 1, arbitration = SHADOW_CORRECT
  N1  → D00_AGREE              (NOT D10_UNKNOWN; legacy==shadow, divergence undefined)
  N2  → D02_SHADOW_FALSE_ACTIVE = 1
  N3  → D00_AGREE              (NOT D10_UNKNOWN; legacy==shadow, divergence undefined)

Three predicate conjuncts (legacy=idle, shadow=streaming, arbiterActive=true)
are independently necessary (input ablation). No classifier mutation.

Synthetic inputs:
  getLegacyPhase, getArbiterSnapshot, canonical event stimulus.

Real chain (classifier proof):
  wiring.observeCanonicalRuntimeEvent → coordinator → comparator → shadow
    → recorder.classify → recorder.record → wiring.records()/recorderCounts().

The wiring's canonical-event ingress is the exact entry point that
subscribeCanonicalRuntimeEventsToShadow calls per canonical event, so
the classifier sees an identical TaskShadowRecordInput whether the
event arrived via LocalRuntimeHost transport or direct ingress.

The classifier WILL correctly detect C04 once ELM-02F (or equivalent)
replaces the production arbiter mirror (C25_ARB_SOURCE_RESIDUE).
Current production inputs intentionally cannot express D01; that is the
C25-C2 structural finding and it remains unchanged by C25-C3.
```

### Why this is a correction, not a re-implementation

```text
PRODUCTION_DELTA           = 0   (no source change in any layer)
TEST_DELTA                 = 0   (the seven tests remain semantically unchanged)
WIRING_DELTA               = 0   (no production wiring code modified)
RECORDER_DELTA             = 0   (no production recorder code modified)
CLASSIFIER_DELTA           = 0   (no production classifier code modified)
CONFIG_DELTA               = 0
EVIDENCE_DOC_DELTA         = +1 (this correction section in C25-C3 evidence)
C25_C2A_CORRECTION01_DELTA = amendment (N1/N3 wording; topology decomposition;
                                       THREE_PREDICATE_CONJUNCTS)
```

The classifier behavior is correct. The R4 freeze wording was slightly
imprecise. This correction makes the freeze match what was actually
qualified.

## Topology (per R4 freeze, amended by R1/R2/R3 disposition above)

```text
synthetic causal inputs (legacyPhase, arbiter, canonical event)
  ↓
REAL wiring.observeCanonicalRuntimeEvent(...)
  ↓                            ← (deliberately decoupled from LocalRuntimeHost;
  REAL TaskShadowCoordinator     C-REAL-1..5 already qualified that transport;
  ↓                             C-REAL-3/4 are boundary invariants, not classifier evidence)
  REAL TaskShadowComparator
  ↓
  REAL recorder.classify(input)
  ↓
  REAL recorder.record(input)
  ↓
  wiring.records() / wiring.recorderCounts()
```

**SYNTHETIC** (test-controlled via the wiring's deps interface):
- `getLegacyPhase`
- `getArbiterSnapshot`
- canonical event stimulus (`execution-state-changed` edge for P/N1/N2; `message-added` for N3)

**REAL** (production paths invoked unchanged by the test):
- `wiring.observeCanonicalRuntimeEvent(...)` (the canonical-event ingress; identical entry point that `subscribeCanonicalRuntimeEventsToShadow` calls per canonical event)
- `TaskShadowObservationCoordinator.observe(...)` (production resolver + recorder path)
- `TaskShadowComparator.observeRuntimeEvent(...)` (production comparator)
- `TaskStateShadow.observeRuntimeEvent(...)` (production shadow)
- `TaskShadowRecorder.record(...)` (production recorder)
- `classify(...)` at `task-state-shadow-recorder.ts:521` (production classifier)
- `arbitrate(...)` at `task-state-shadow-recorder.ts:616` (production arbitration)

The classifier contract is qualified **in isolation** from the
production `LocalRuntimeHost → subscribeCanonicalRuntimeEventsToShadow`
transport (which C-REAL-1..5 already qualified separately). This is the
same decoupling the reviewer authorized in R4:

> "deliberately decouples … so the classifier contract can be qualified in isolation"

## Tests (7 tests, all PASS)

```
✓ P: idle + streaming shadow + active arbiter -> D01_LEGACY_FALSE_IDLE = 1, arbitration = SHADOW_CORRECT
✓ N1: streaming + streaming shadow + active arbiter -> D01 = 0 (D00_AGREE; legacy conjunct matters)
✓ N2: idle + streaming shadow + inactive arbiter -> D02_SHADOW_FALSE_ACTIVE = 1, D01 = 0 (arbiter conjunct matters)
✓ N3: idle + idle shadow + active arbiter -> D01 = 0 (D00_AGREE; shadow conjunct matters)
✓ necessity: D01_LEGACY_FALSE_IDLE fires iff legacy=idle AND shadow=streaming AND arbiterActive=true
✓ diagnostic: production classify() is the writer for D00-D10 (no D11 override was applied to P)
✓ type sanity: records() / recorderCounts() match production shapes
```

Run output:

```text
 RUN  v4.1.10  /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-elm-architecture01/apps/vscode

 ✓ src/sdk/__tests__/c04-synthetic-real-classifier-chain.c25-c3.test.ts (7 tests) 9ms

 Test Files  1 passed (1)
      Tests  7 passed (7)
```

## P — positive witness

### Inputs

```text
getLegacyPhase       = () => "idle"
getArbiterSnapshot   = () => ({
    execution: { modelStreaming: true, tooling: false, awaitingApproval: false },
    recoveryState: "idle",
    status: "running",
    pendingToolCalls: [],
})
canonical event      = execution-state-changed (modelStreaming false → true, edge-triggered)
```

### Expected

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

### Actual

```text
classification       = D01_LEGACY_FALSE_IDLE
arbitration           = SHADOW_CORRECT
eventsObserved        = 1
divergences           = 1
agreements            = 0
divergenceCountsByClass.D01_LEGACY_FALSE_IDLE = 1
divergenceCountsByClass.D02_SHADOW_FALSE_ACTIVE = 0
divergenceCountsByClass.D10_UNKNOWN = 0
divergenceCountsByClass.D00_AGREE = 0
invariantViolations   = 0
observerErrors        = 0
evidenceGaps          = 0
droppedRecords        = 0

origin                = RUNTIME_CANONICAL
legacyPhase           = idle
shadowPhase           = streaming
modelStreaming        = true
awaitingApproval      = false
activeToolCount       = 0
event                 = model_stream_started
```

### Evidence-strengthening: exact injected arbiter at the same observation

```text
arbiterSamples.count             = 1
arbiterSamples.last.execution.modelStreaming   = true
arbiterSamples.last.execution.awaitingApproval = false
arbiterSamples.last.pendingToolCalls.length    = 0
```

`pendingToolCalls.length` participates directly in `arbiterActive`
(the classifier's disjunct), and the test fixture has the input
available — no inference required. The witness is exact, not derived.

### PASS

The classifier's C04 predicate at `task-state-shadow-recorder.ts:540-547`
fires once with `SHADOW_CORRECT` arbitration, exactly as the production
predicate specifies. No classifier regression.

## N1 — remove legacy side

### Inputs

```text
getLegacyPhase       = () => "streaming"
getArbiterSnapshot   = () => arbiterActive()
canonical event      = execution-state-changed (modelStreaming false → true)
```

### Expected

```text
D01_LEGACY_FALSE_IDLE = 0
classification       = D00_AGREE  (divergence is undefined when legacy == shadow)
eventsObserved        = 1
divergences           = 0
agreements            = 1
```

### Actual

```text
classification       = D00_AGREE
arbitration           = undefined  (D00_AGREE short-circuits; no arbitration computed)
eventsObserved        = 1
divergences           = 0
agreements            = 1
divergenceCountsByClass.D01_LEGACY_FALSE_IDLE = 0

shadowPhase           = idle   (default for undefined-divergence records)
legacyPhase           = idle   (default for undefined-divergence records)
modelStreaming        = true   (retained: shadow DID transition)
event                 = model_stream_started
```

### Note: defaulted `shadowPhase` / `legacyPhase` for undefined divergence

The recorder at `task-state-shadow-recorder.ts:330-331` reads:

```typescript
shadowPhase: input.divergence?.shadowPhase ?? "idle",
legacyPhase: input.divergence?.legacyPhase ?? "idle",
```

When `divergence === undefined` (legacy == shadow, comparator
short-circuits), the record's `shadowPhase` and `legacyPhase` fields
default to "idle" regardless of the actual input. The witness that the
shadow actually transitioned is `record.modelStreaming === true` and
`record.event === "model_stream_started"` — both retained on the
record. The discriminator between "shadow transitioned" and "shadow
didn't transition" is the model's `activity.modelStreaming` field,
not the defaulted `shadowPhase`.

### PASS

The legacy-side conjunct matters: with `legacyPhase = "streaming"`,
the classifier's D01 branch (`legacyPhase === "idle"`) cannot fire,
and the comparator returns `divergence = undefined` because legacy ==
shadow. The classifier short-circuits to `D00_AGREE`. **D01 = 0.**

## N2 — remove arbiter side

### Inputs

```text
getLegacyPhase       = () => "idle"
getArbiterSnapshot   = () => ({
    execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
    recoveryState: "idle",
    status: "running",
    pendingToolCalls: [],
})
canonical event      = execution-state-changed (modelStreaming false → true)
```

### Expected

```text
D01_LEGACY_FALSE_IDLE = 0
D02_SHADOW_FALSE_ACTIVE = 1
eventsObserved        = 1
divergences           = 1
```

### Actual

```text
classification       = D02_SHADOW_FALSE_ACTIVE
arbitration           = LEGACY_CORRECT
eventsObserved        = 1
divergences           = 1
divergenceCountsByClass.D01_LEGACY_FALSE_IDLE = 0
divergenceCountsByClass.D02_SHADOW_FALSE_ACTIVE = 1

legacyPhase           = idle
shadowPhase           = streaming
modelStreaming        = true  (shadow transitioned)
```

### Evidence-strengthening: exact injected arbiter at the same observation

```text
arbiterSamples.count                            = 1
arbiterSamples.last.execution.modelStreaming    = false
arbiterSamples.last.execution.awaitingApproval  = false
arbiterSamples.last.pendingToolCalls            = []
```

All three arbiter fields that contribute to `arbiterActive` are at
their injected values. The classifier's D01 branch is skipped (arbiterActive=false);
the classifier's D02 branch fires (idle + streaming shadow + !arbiterActive);
arbitration is LEGACY_CORRECT.

### PASS

The arbiter-side conjunct matters: with `arbiterActive = false`, the
classifier's D01 branch (requires `arbiterActive === true`) cannot fire.
The classifier's D02 branch (`shadowPhase === streaming &&
legacyPhase !== streaming/completed/error/resumable && arbiterActive === false`)
fires instead. **D01 = 0; D02_SHADOW_FALSE_ACTIVE = 1.**

## N3 — remove shadow side

### Inputs

```text
getLegacyPhase       = () => "idle"
getArbiterSnapshot   = () => arbiterActive()
canonical event      = message-added (presentation/prose; shadow adapter produces NO TaskMsg)
```

The shadow's `adaptRuntimeEvent` for `message-added` returns no TaskMsg
(see `shadow-adapter.ts:140-149`: "Remaining event kinds are
presentation/prose and intentionally produce no TaskMsg"). The shadow
stays idle: `model.activity.modelStreaming` remains false;
`projectTurnState` returns "idle".

### Expected

```text
D01_LEGACY_FALSE_IDLE = 0
classification       = D00_AGREE  (divergence is undefined when legacy == shadow == idle)
eventsObserved        = 1
divergences           = 0
agreements            = 1
```

### Actual

```text
classification       = D00_AGREE
arbitration           = undefined
eventsObserved        = 1
divergences           = 0
agreements            = 1
divergenceCountsByClass.D01_LEGACY_FALSE_IDLE = 0

shadowPhase           = idle
legacyPhase           = idle
```

### PASS

The shadow-side conjunct matters: with `shadowPhase = "idle"`, the
classifier's D01 branch (`shadowPhase === "streaming"`) cannot fire,
even with `legacyPhase = "idle"` and `arbiterActive = true`. The
classifier falls through to `D00_AGREE`. **D01 = 0.**

## Necessity matrix (input ablation, no classifier mutation)

The 4 cases above, run as a parametric loop:

```text
P   idle + streaming shadow + active arbiter     -> D01 = 1, D01_LEGACY_FALSE_IDLE
N1  streaming + streaming shadow + active arbiter -> D01 = 0, D00_AGREE
N2  idle + streaming shadow + inactive arbiter    -> D01 = 0, D02_SHADOW_FALSE_ACTIVE
N3  idle + idle shadow + active arbiter           -> D01 = 0, D00_AGREE
```

The only difference between P and each N is **one removed conjunct**:

```text
P -> N1: legacyPhase flipped idle → streaming   (legacy side removed)
P -> N2: arbiterActive flipped true → false     (arbiter side removed)
P -> N3: shadowPhase flipped streaming → idle   (shadow side removed)
```

Each ablation yields **D01 = 0** with a distinct classification
(D00_AGREE / D02_SHADOW_FALSE_ACTIVE / D00_AGREE). The three conjuncts
are independently necessary: removing any one collapses the C04
predicate. **No production classifier code was mutated.**

## Diagnostic — `classify()` (not D11 override) is the writer

```text
classification = D01_LEGACY_FALSE_IDLE
classification != D11_HOST_PREENGAGED
```

The wiring's recorder at `task-state-shadow-recorder.ts:330-331` uses
`classify(input)` as the default when `classificationOverride` is
undefined. Our test cases do not enter the D11 host-pre-engaged
window (the lifecycle provides a session synchronously, no
host-pre-engaged race), so `classificationOverride` is undefined and
the recorder's built-in `classify()` is the writer for D00-D10.

This confirms that the D01 observed for P came from the production
classifier predicate (not from a coordinator override), validating
that the classifier contract — and not some other classification
path — is what C25-C3 is qualifying.

## Type sanity

The recorder/recorderCounts surfaces that `wiring.records()` and
`wiring.recorderCounts()` expose satisfy the production
`TaskShadowRecordInput` / `TaskShadowRecorderCounts` shapes:

```text
eventsObserved:                 number
divergences:                    number
divergenceCountsByClass.D01_LEGACY_FALSE_IDLE: number
divergenceCountsByClass.D00_AGREE:              number
```

The retained record fields (`seq`, `timestamp`, `origin`, `event`,
`legacyPhase`, `shadowPhase`, `lifecycleKind`, `modelStreaming`,
`activeToolCount`, `awaitingApproval`, `toolCalls`,
`recoveryBudgetFailures`, `taskEpochOrOpaqueTaskKey`, `runtimeStatus`,
`classification`, `arbitration?`) match the `TaskShadowDifferentialRecord`
shape from `task-state-shadow-recorder.ts:64-90`.

## Regression sweep

```text
c2-4-c-bridge (C-REAL-1..5)               5 passed (5)
c2-4-d-hub                                15 passed (15)
c04-synthetic-real-classifier-chain       7 passed (7)  ← C25-C3
task-state-shadow-correction02-c23-stateful-workloads
                                          60 passed (60)
  incl. C2.3-CONT.5 W15 (synthetic C04)    (unchanged, G0.3)

typecheck (C25-C3 file)                    clean (no diagnostics)
typecheck:c2-4-d-hub                      1 diagnostic matches baseline
typecheck:c2-4-c-bridge                   1 diagnostic matches baseline

git diff --check (working tree)           exit 0
terminating newline                       present
PROTECTED_STASHES_INTACT                  = true
```

**Pre-existing failures (not introduced by C25-C3):**
- `sdk-task-control-coordinator.test.ts` — fails identically without C25-C3 (verified by stash test)
- `hub-runtime-host.provenance-epoch.c24-d3.test.ts` — unrelated
- `task-state-shadow-workload-matrix.test.ts` and `task-state-shadow.test.ts` typecheck errors — unrelated (pre-existing)

## Conservation

```text
PRODUCTION_SEMANTIC_DELTA  = 0
REDUCER_SEMANTIC_DELTA      = 0
LEGACY_AUTHORITY            = 100%
SHADOW_AUTHORITY            = 0%
DIVERGENCE_ACTION           = RECORD_ONLY
WEBVIEW_CUTOVER             = false
EFFECT_EXECUTION_ENABLED    = false
E7_CONSUMER_DELTA           = 0
D4_SCOPE_DELTA              = 0
HUB_PRODUCTION_DELTA        = 0
REMOTE_PRODUCTION_DELTA     = 0
TEST_DELTA                  = +1 test file (c04-synthetic-real-classifier-chain.c25-c3.test.ts, 7 tests)
CONFIG_DELTA                = 0
```

This commit adds ONE new test file under `apps/vscode/src/sdk/__tests__/`.
No source, no production config, no reducer, no API, no protocol,
no Hub, no Remote changes.

## What is preserved (NOT changed by C25-C3)

```text
✓ structural finding: getArbiterSnapshot mirror makes D01 unreachable
  in current production — apps/vscode/src/sdk/SdkController.ts:565-576
✓ ELM-02F forward-fix seam is the documented replacement path
✓ C-REAL bridge chain delivers 1:1 canonical events with all causal fields
✓ C-REAL-3/4 are transport-boundary invariants (R2 wording frozen)
✓ W15 frozen synthetic C04 control (G0.3) — unchanged, 60/60 PASS
✓ D4 LOCAL_ONLY scope — unchanged
✓ LEGACY_AUTHORITY = 100%, SHADOW_AUTHORITY = 0%, DIVERGENCE_ACTION = RECORD_ONLY
✓ protected stashes intact
✓ C25_ARB_SOURCE_RESIDUE = OPEN (deliberately not addressed in C25-C3)
```

## Carry-forward (NOT closed by C25-C3)

Per the reviewer's round-21 directive:

```text
C25_ARB_SOURCE_RESIDUE =
  CURRENT:
    SdkController.getArbiterSnapshot()
      = LEGACY_MIRROR

  TARGET_FOR_E7:
    arbiter source
      = canonical AgentRuntime snapshot/projection

  STATUS:
    OPEN

E7_ENTRY_REQUIREMENT:
  REPLACE_LEGACY_ARBITER_MIRROR = REQUIRED
```

The current production inputs intentionally cannot express D01 — the
classifier contract qualification proves the classifier WILL correctly
detect C04 once the ELM-02F forward-fix seam replaces the mirror.
The production arbiter-source switch is the consumer-side work that
must precede E7 authorization; that work belongs to a separate
commit (likely C25-C5 or a narrow pre-E7 correction), not C25-C3.

## Board after C25-C3-CORRECTION01

```text
C2.3                                          ✅ CLOSED
C2.4                                          ✅ CLOSED
C2.4-D4                                       ✅ LOCAL_ONLY

C2.5
  C25-C0                                      ✅ PASS_RECON (cf8705544)
  C25-C1                                      ⏭️ SKIPPED (INSTRUMENTATION_REQUIRED=false)

  C25-C2                                      ✅ CLOSED (598f2a414)
    CURRENT_PRODUCTION_C04_REACHABILITY       = STRUCTURALLY_UNREACHABLE
    ORGANIC_REAL_C04_EXPERIMENT               = NOT_EXECUTED (source decisive)
    CAPTURE_SURFACE                           = QUALIFIED_FOR_CANONICAL_BRIDGE
    C-REAL-1..5 boundary + transport          ✅
    SAME_INGRESS_SAMPLE                       ✅
    C25-C2A                                   ✅ CLOSED
    C25-C2A-CORRECTION01                      ✅ CLOSED (4cf549a1f)
                                              AMENDED by this commit (N1/N3 wording,
                                                  topology decomposition, THREE_PREDICATE_CONJUNCTS)

  C25-C3 C04_SYNTHETIC_REAL_CLASSIFIER_CHAIN  ✅ CLOSED (aa273d922)
    P  (idle + streaming shadow + active arbiter → D01 = 1)        ✅
    N1 (streaming + streaming shadow + active arbiter → D01 = 0,
   ) classification = D00_AGREE                                  ✅
    N2 (idle + streaming shadow + inactive arbiter → D01 = 0,
   ) D02_SHADOW_FALSE_ACTIVE = 1                                ✅
    N3 (idle + idle shadow + active arbiter → D01 = 0,
   ) classification = D00_AGREE                                  ✅
    necessity by input ablation (THREE_PREDICATE_CONJUNCTS)       ✅
    diagnostic: production classify() is the writer               ✅
    type sanity: production shapes satisfied                       ✅

  C25-C3-CORRECTION01                          ✅ CLOSED (this commit)
    R1  N1/N3 frozen D10_UNKNOWN → observed D00_AGREE              AMENDED
    R2  frozen Local-transport topology → Option B decomposition   AMENDED
    R3  "four conjuncts" → THREE_PREDICATE_CONJUNCTS               AMENDED
    C25_C3_VERDICT                  = PASS_C04_SYNTHETIC_REAL_CLASSIFIER_CHAIN
    C25_C4_AUTHORIZED               = true

  C25_ARB_SOURCE_RESIDUE                       🟨 OPEN
    current = LEGACY_MIRROR
    target  = CANONICAL ARBITER
    must be dispositioned before E7 execution

  C25-C4 adversarial                           🟢 AUTHORIZED
  C25-C5 terminal + E7 auth                    ⏳ (gated on C25-C4 PASS)

E7                                            ⛔ BLOCKED on C2.5
                                             (E7_ENTRY_REQUIREMENT:
                                              REPLACE_LEGACY_ARBITER_MIRROR)
```

## Next (planned, contingent)

C25-C4 — adversarial probe (per C2.5 plan). C25-C4 will exercise
hostile inputs (interleaved tool events, stale-session events, rapid
execution-state changes) to prove the classifier+recorder chain is
robust under non-causal-minimal conditions. Like C25-C3, C25-C4
deliberately decouples from the production arbiter mirror — the
classifier contract qualification is the focus.

C25-C5 — terminal qualification + E7 authorization decision. Per the
reviewer's freeze:

```text
E7_ENTRY_REQUIREMENT:
  REPLACE_LEGACY_ARBITER_MIRROR = REQUIRED
```

C25-C5 must surface this requirement as an explicit gating dependency
on E7, and must NOT authorize E7 until the consumer-side arbiter
source has been replaced. Whether that replacement belongs to E7
itself or to a narrow pre-E7 correction is a C25-C5 decision; the
disposition must be visible in the C25-C5 evidence file.

## Commit ledger (this commit)

```
<this commit's SHA> docs(elm): C25-C3-CORRECTION01 — frozen-contract disposition (R1 + R2 + R3)
```

Files touched:
- `docs/architecture/elm/task-state-e5-e6-correction02-c25-c3-c04-synthetic-real-classifier-chain-evidence.md`
  (amended — C25-C3-CORRECTION01 section added; R1/R2/R3 disposition,
   corrected contract, verbatim restatement, Board after correction,
   Commit ledger rewritten for correction01)
- `docs/architecture/elm/task-state-e5-e6-correction02-c25-c2a-correction01-wording-revision.md`
  (amended — R4 freeze wording amended to match observed behavior;
   N1/N3 frozen classification corrected to D00_AGREE;
   topology decomposed as TRANSPORT_PROOF ∧ CLASSIFIER_PROOF;
   THREE_PREDICATE_CONJUNCTS instead of "four conjuncts")

C25-C3 implementation commit (predecessor, UNCHANGED):
- `aa273d922` test(elm): C25-C3 C04_SYNTHETIC_REAL_CLASSIFIER_CHAIN —
  classifier contract qualification (7/7 tests PASS)
