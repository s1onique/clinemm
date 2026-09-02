# ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01

| Field | Value |
|-------|-------|
| OWNING_EPIC | EPIC-CONTEXT-COMPACTION-TOKEN-ACCOUNTING |
| PREDECESSOR_ACT | ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-AUTHORITY-PUBLISH01 |
| PRODUCTION_DELTA_TARGET | bounded (one new core→host carrier seam + one narrow header numerator switch) |
| DISPOSITION | OPEN — CARRIER_BIND landed + CADENCE FALSIFIED (eighth-pass halt) + ninth-pass causal correction (HALT_DEFAULT_SUITE_RED) applied; committed falsification witness PASSING (default suite GREEN); RED provenance preserved at .factory/evidence/ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01/cadence-discriminator-red.provenance.ts (OUTSIDE default vitest discovery); RED-1/2/3 + named repair field de-authorized |
| C1 | GO_PRODUCER_CADENCE_GREEN (was GO_CARRIER_BIND → GO_CADENCE_INSPECTION; eighth-pass halt falsified SessionCompactionState; ninth-pass causal correction split concepts; next bounded repair = close the publish gap at compaction.ts:730, saveState cadence UNCHANGED) |

## Primary contract (one-line)

Carry the already-authoritative W from the core prepare-turn
boundary to the `TaskHeader` context gauge exactly once,
**without recomputing or transforming its semantic domain**.

W remains canonical (estimate of next provider request
occupancy in `CANONICAL_W_ESTIMATOR` units). The transport
is a pure one-time copy. P/H accounting remains untouched.

## Clean ownership split (frozen)

```text
AUTHORITY-PUBLISH01
  = produce truthful W (commit 6bffd75c0 + fc906dfc6 + 96336dc77)

HEADER-TRANSPORT-REPAIR01
  = transport + consume truthful W (this ACT)
```

Authority is resolved. Transport is open.

## W_PRESENTATION_TRANSPORT = ABSENT (re-calibrated from agent-runtime drop)

`git grep -n -e 'currentWorkingContextEstimate' -e 'ContextPipelinePrepareTurnResult' -- sdk apps` returns exactly:

```text
sdk/packages/core/src/extensions/context/compaction.ts
  :60  interface declaration
  :75  field declaration (currentWorkingContextEstimate?: number)
  :80  function-return type
  :286 function-parameter type
  :734 helper docstring
  :754 helper return type
  :758 helper field emitter
sdk/packages/core/src/extensions/context/compaction.working-context-authority-publish.test.ts
  (producer tests)
sdk/packages/core/src/extensions/context/compaction.working-context-ratio.test.ts
  (producer tests)
```

NO occurrence in:

- `sdk/packages/agents/src/` (the runtime consume site drops it
  on the floor; TODO at `agent-runtime.ts:2300` confirms)
- `sdk/packages/core/src/runtime/` (orchestration, adapters)
- `apps/vscode/` (extension host, webview, header)

So `W_PRESENTATION_TRANSPORT = ABSENT / PROVEN`. This is the
mechanical repo-wide absence bind the P1 calibration asked for.
There is no existing generic carrier that preserves arbitrary
prepare-turn result fields; one bounded addition is justified.

## Transport doctrine (frozen BEFORE implementation)

```text
PRODUCTION_W_AUTHORITIES    = 1
                            (one authority: core prepare-turn seam;
                            only ONE place computes W)

W_RECOMPUTE_IN_AGENT       = forbidden
W_RECOMPUTE_IN_VSCODE      = forbidden
W_RECOMPUTE_IN_CHATVIEW    = forbidden

TEST_ORACLE_RECOMPUTATION  = permitted
                            (a test may independently call
                            estimateRequestInputTokens to derive an
                            oracle; this is NOT a production authority)

P                          = remains last provider-observed request input
H                          = remains compaction estimator telemetry
HEADER                     = consumes transported W
```

Terminology tweak (P2, opportunistic): the doctrine is about
**production-side authority count**, not literal function-call
count. Renamed `W_COMPUTE_COUNT` → `PRODUCTION_W_AUTHORITIES`.

The grep probe earlier only proved:

```text
EXPLICIT_W_TRANSPORT = ABSENT / PROVEN
```

It did **not** prove the absence of generic metadata-bearing
carriers. After the seventh-pass calibration:

```text
GENERIC_REUSABLE_CARRIER = BOUND / SessionCompactionState
                          (see Carrier audit below)

NEW_BOUNDED_FIELD        = AUTHORIZED
                          (one bounded optional
                           `currentWorkingContextEstimate?:
                           number` on SessionCompactionState)
```

## Carrier audit (one source pass, 2026-09-03)

Per the seventh-pass review, the previously-drawn topology
was a hypothesis. Real source inspection binds the lowest
existing authoritative seam:

| Candidate | Crosses agents→core? | Accepts scalar metadata? | Reaches VSCode/session projection? | Semantic owner |
|---|:---:|:---:|:---:|---|
| `AgentModelRequest` | yes | via `options` (provider-bound) | no | `@cline/agents` |
| `runtime-event` metadata (`toolCall.metadata`, `sessionStatusNotice.metadata`) | partial¹ | yes | yes² | `@cline/core` |
| **`SessionCompactionState`** | **yes** | **yes** | **yes** | **`@cline/core`** |
| `sessionSnapshot` | yes | yes | yes | `@cline/core` |
| `lastApiReqContextInputTokens` (P) | — | yes | yes | host/webview |

¹ core emits only typed event metadata, not a generic
opaque scalar payload.
² partial: only certain event types cross.

**Chosen carrier = `SessionCompactionState`** because:

1. Architecture doc §9 line 487 — `@cline/core` "persists
   the latest compacted working context as a session
   compaction artifact."
2. Already crosses agents → core → host → VSCode.
3. Already accepts scalar metadata (`version: 1`,
   `source_message_count: number`, etc.).
4. Canonical place where the producer seam's messages +
   system_prompt are stored.
5. Adding ONE bounded optional field
   (`currentWorkingContextEstimate?: number`) is the
   smallest-viable repair; no new protocol field.

**Rejected**: `AgentModelRequest` (would widen provider-bound
shape; architecture doc §9 line 489: "keep compaction logic
out of the low-level agent message builder").

**Rejected**: `runtime-event` metadata (no generic opaque
scalar payload; widening creates a NEW protocol field).

## Resolved carrier chain (REJECTED by eighth-pass cadence check)

```text
ContextPipelinePrepareTurnResult
    .currentWorkingContextEstimate (= W_after)
   ↓
SessionCompactionState  (NEW bounded optional field)
    .currentWorkingContextEstimate?
    (schema: sdk/packages/core/src/session/models/
     session-compaction.ts:18-30;
     persisted: ${sessionId}.compaction.json;
     already written via input.saveState at
     compaction.ts:705-712 + :719-722)
   ↓
Host reads state on resume + via
   updateSessionCompactionState (apps/vscode/src/sdk/
   sdk-compaction-coordinator.ts:518)
   ↓
ExtensionState.lastWorkingContextEstimate  (NEW host field)
   ↓
ExtensionStateContext.currentWorkingContextEstimate
   ↓
TaskHeader → ContextWindow numerator switch:
   lastApiReqContextInputTokens
     → currentWorkingContextEstimate ?? lastApiReqContextInputTokens
   (with a clear "no recent prepare-turn" fallback marker)
```

The chain above is **REJECTED** by the eighth-pass cadence
falsification: `SessionCompactionState` does not move at
W's cadence (it only updates when compaction rewrites
messages; on ordinary prepare-turns the carrier is silent
and `publishWorkingContextEstimate` is also not called).
The cadence-correct carrier is **NOT YET BOUND** — see
"Forward disposition" below for the next causal question.

No recompute is permitted at any layer. The header either
displays the core-published W or falls back to P with a
clear "no recent prepare-turn" marker.

## RED plan — three REDs each at an existing production boundary

Per seventh-pass review: **the previously-sketched RED
preselected the repair** by referring to
`ExtensionState.lastWorkingContextEstimate` — which doesn't
exist yet. The reviewer is correct: a RED must exercise an
**existing** production boundary and fail on the required
invariant, not invent the repair API first.

Three REDs at three existing seams; each fails at HEAD with
the same invariant. No preselection.

```text
RED-1 (producer → artifact seam; RED at HEAD):
  Given a real prepareTurn call whose result carries
        currentWorkingContextEstimate = W_after,
  AND SessionCompactionState schema accepts an optional
        currentWorkingContextEstimate? field,
  WHEN createCompactionStateAwarePrepareTurn persists the
       next state via input.saveState,
  EXPECTED (post-fix):
    persisted state carries
    currentWorkingContextEstimate = W_after
  ACTUAL (HEAD):
    persisted state has NO field for
    currentWorkingContextEstimate; the prepare-turn
    result's W is thrown away at compaction.ts:712-724
    (publishWorkingContextEstimate return values are
     NOT merged into the saved nextState).

RED-2 (artifact → host-state seam):
  Given SessionCompactionState carries
        currentWorkingContextEstimate = W_after,
  AND host reads it via updateSessionCompactionState
        (apps/vscode/src/sdk/sdk-compaction-coordinator
         .ts:518),
  EXPECTED: ExtensionState.lastWorkingContextEstimate
            = W_after
  ACTUAL (HEAD):
    ExtensionState does NOT carry this field; the host
    throws it away.

RED-3 (host → header projection; the final RED that
       completes the chain):
  Given ExtensionState.lastWorkingContextEstimate
        = W_after,
  AND no subsequent api_req_started occurs,
  EXPECTED: TaskHeader / ContextWindow projected numerator
            = W_after
  ACTUAL (HEAD): numerator = P
                  (lastApiReqContextInputTokens)
  Oracle = real prepare-turn output (NOT 264_300).
```

Each RED is load-bearing on its own seam. RED-1 alone
proves the **transport gap**; RED-2 alone proves the
**host-mirror gap**; RED-3 alone proves the
**projection-gap**. None preselects the repair.

## Compaction-shrink discriminator (added per fifth-pass review)

Deterministic injected `compact()` returns visibly smaller canonical
messages:

```ts
it('W_after < W_before when compaction shrinks estimator inputs',
   async () => {
     const wBefore = estimateRequestInputTokens({before shape});
     const result  = await runPrepareTurn({
       compact: () => smallerCanonicalMessages,
     });
     const wAfter  = result.currentWorkingContextEstimate;
     expect(wAfter).toBeLessThan(wBefore);
     expect(wAfter).toBe(
       estimateRequestInputTokens({smaller final shape})
     );
   });
```

`<` is causally legitimate because the fixture is constructed to
shrink estimator-bearing content. It says nothing about `H_a`
(cross-scale ratio remains FORBIDDEN).

## Conservation locked for this ACT

```text
P (lastApiReqContextInputTokens)         = preserved as provider observation
H (compaction H-space)                   = preserved as estimator telemetry
Strategy-D (getApiMetrics.ts:174-225)    = untouched
Cumulative usage / provider billing      = unchanged
PRODUCTION_W_AUTHORITIES                  = 1 (one authority: core prepare-turn seam)
H_a_TO_W_EQUIVALENCE                     = still UNPROVEN
```

## Eighth-pass halt (2026-09-03) — HALT_WRONG_CARRIER_SEMANTICS

The factory causal reviewer halted the seventh-pass carrier
verdict (`GENERIC_REUSABLE_CARRIER = BOUND / SessionCompactionState`)
on the ground that the audit optimized for **reachability**
("can this scalar reach VSCode?") and missed the **cadence
invariant**:

> for every successful prepareTurn producing authoritative W_n:
>   host-visible W eventually = W_n
> without requiring:
>   compaction occurred
>   provider response arrived
>   api_req_started arrived

For `SessionCompactionState`, the cadence question is textually
answerable at HEAD:

```text
createCompactionStateAwarePrepareTurn (compaction.ts:670-731)
  if (existingState && projectedMessages) {
    result = await input.compact(...)
    if (result?.messages) {
      saveState(nextState, ...)       ← ONLY fires here
      return publishWorkingContextEstimate(...)  ← ONLY here too
    }
    return publishWorkingContextEstimate(projectedMessages, ...)
                                       ← no saveState
  }
  result = await input.compact(...)
  if (result?.messages) {
    saveState(nextState, ...)         ← ONLY fires here
    return publishWorkingContextEstimate(...)
  }
  return result                       ← BOTH gaps: no
                                          saveState AND no
                                          publish
                                          (the third branch)
```

Two coupled gaps on the no-compaction branch:

1. **Publish gap**: `compaction.ts:730` returns `result` which
   is `undefined` when the upstream `compact` returned
   undefined; `publishWorkingContextEstimate` is **not** called.
   `currentWorkingContextEstimate` is therefore not even
   computed on the prepare-turn result.
2. **Cadence gap**: `input.saveState` is only called inside
   `if (result?.messages)` branches — i.e. only when
   compaction rewrote messages. On an ordinary prepare-turn
   where compaction is skipped, the carrier does not move.

The cadence discriminator (this commit's only RED) settles the
question mechanically:

```text
RED-CADENCE (CARRIER_CADENCE in compaction.working-context-
authority-publish.test.ts:176):

  Given three sequential prepare-turns A, B, C with B and C
  having no compaction (compact returns undefined) and
  canonical messages strictly increasing:

  EXPECTED: each prepare-turn publishes W AND each prepare-
            turn calls saveState with state semantically
            representing the new W.

  ACTUAL (HEAD, mechanically observed):
    - resultA.currentWorkingContextEstimate: defined
    - resultB.currentWorkingContextEstimate: undefined
          (compaction.ts:730 returns `result` undefined;
           publishWorkingContextEstimate not called)
    - resultC.currentWorkingContextEstimate: undefined
          (same reason)
    - saveState calls: 1 (only A)

  RED at the publish-gap assertion
  (expect(wObserved[1]).toBeDefined() fails at HEAD).
```

The verdict is settled:

```text
GENERIC_REUSABLE_CARRIER = NOT YET SEMANTICALLY BOUND

SessionCompactionState
  = REACHABILITY_BOUND / STRONG
  = C2_CADENCE = FALSIFIED

NEW_BOUNDED_FIELD = NOT YET AUTHORIZED
  (no schema bump yet; depends on cadence-correct
   carrier's parser/migration contract)

CHOSEN CARRIER (C2 live W) = NOT YET BOUND
  (the audit's "reaches host?" column was insufficient;
   the missing column was "emits/updates every prepare-
   turn?")

PROVISIONAL USE OF SessionCompactionState:
  valuable for resume qualification (durable W at
  compacted boundary + canonical tail projection);
  NOT the C2 live carrier.

A likely final design may COMPOSE:
  durable compaction artifact
    = baseline / resume authority
  live per-turn runtime event/snapshot
    = current W authority
  Both compose; do not build the composed design yet.
  First prove the cadence-correct carrier.
```

RED-1/RED-2/RED-3 from the seventh-pass are
**de-authorized**: they tested persistence-on-compaction,
not cadence, and were structurally preselected by the
rejected SessionCompactionState verdict. The RED-2/3 plan
also named a proposed repair field
(`ExtensionState.lastWorkingContextEstimate`) — that
preselects the repair (P1 from the seventh-pass review)
and is therefore also de-authorized.

## Ninth-pass correction (2026-09-03) — HALT_DEFAULT_SUITE_RED + causal correction

The factory causal reviewer + runtime/context-pipeline
engineer issued a second halt on the eighth-pass RED
commit (8b857f634). Two distinct P0s:

  P0_1 — administrative: the eighth-pass RED test was
  committed in the default vitest suite. Repository
  rule: transient RED evidence = good, committed RED
  in default = not allowed.

  P0_2 — causal (the load-bearing correction): the
  RED test encoded `saveStateCalls === 3` as the
  future GREEN, conflating two distinct lifecycles.
  Upstream architecture assigns persistence to
  @cline/core (the sidecar is the latest COMPACTED
  working context, NOT generic per-turn state) and
  turn preparation + runtime-event emission to
  @cline/agents. Making saveState fire on every
  prepareTurn would mutate a durable compaction
  artifact at per-turn cadence and erase that
  architectural distinction.

```text
PUBLISH_GAP     = REPRODUCED (real defect, next repair)
SIDECAR_CADENCE = EXPECTED ARCHITECTURAL FACT
                  (saveState only on real compaction —
                   durable artifact cadence preserved)
CHOSEN CARRIER  = REJECTED AS LIVE W CARRIER

RED PROVENANCE preserved at:
  .factory/evidence/ACT-CLINEMM-COMPACTION-WORKING-
    CONTEXT-HEADER-TRANSPORT-REPAIR01/
    cadence-discriminator-red.provenance.ts
  (TRANSIENT RED evidence, OUTSIDE default vitest
   discovery; invocation: bun $EVIDENCE_FILE)
```

### The corrected committed test (PASSING falsification witness)

```ts
// compaction.working-context-authority-publish.test.ts:176
// — PASSING in default suite:

expect(resultA?.currentWorkingContextEstimate)
  .toBeDefined()
// A: real compaction → W published (producer-seam GREEN
//   from fc906dfc6)

expect(saveStateCalls).toHaveLength(1)
// Architectural separation: durable compaction artifact
// moves ONLY on real compactions.

expect(resultB).toBeDefined()  // REMOVED (was RED)
// expect(resultC).toBeDefined()  // REMOVED (was RED)
// At HEAD the no-compaction branch returns undefined;
// that is the PUBLISH_GAP RED provenance (preserved in
// evidence file, not in default suite).
```

After the next bounded repair (commit lane 2, producer
cadence GREEN at compaction.ts:730) the GREEN matrix is:

```text
A: compaction               W defined   saveState +1
B: no compaction, changed   W defined   saveState UNCHANGED
C: no compaction, changed   W defined   saveState UNCHANGED
                            (B.W !== A.W, C.W !== B.W)
```

That proves the architecture we want:

```text
W publication cadence      = every prepareTurn
durable artifact cadence   = actual compactions only
```

This is stronger than forcing both to cadence 3.

### The next production repair is bounded

```text
no compaction:
  final request shape = original / projected
  → publishWorkingContextEstimate(final shape)
  → return prepareTurn result carrying W

actual compaction:
  preserve existing behavior
  → save SessionCompactionState
  → publish W from compacted final shape

saveState cadence remains compaction-only
```

### Required GREEN matrix (commit lane 2)

```text
A: compaction               W defined   saveState +1
B: no compaction, changed   W defined   saveState unchanged
C: no compaction, changed   W defined   saveState unchanged
```

Executable causality. No host carrier needed yet.

### Then inspect the real cadence carrier

After W exists every prepare-turn, audit existing
agent/runtime event/snapshot surfaces that already move
per prepare-turn:

| Candidate                             | Naturally emits every prepare-turn? | Already reaches core/host? | Snapshot/current-state semantics? |
| ------------------------------------- | ----------------------------------: | -------------------------: | --------------------------------: |
| existing agent runtime event          |                                   ? |                          ? |                               n/a |
| agent/runtime state snapshot          |                                   ? |                          ? |                               yes |
| session.updated / snapshot projection |                                   ? |                          ? |                               yes |
| existing usage/context event          |                                   ? |                          ? |                                 ? |

Do NOT assume a new event or AgentRuntimeStateSnapshot
field yet. Selection invariant (the only load-bearing
criterion):

```text
for each prepareTurn yielding W_n:
  downstream host eventually observes W_n

without requiring:
  compaction, provider response, api_req_started
```

### Disposition

```text
ACT =
  ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-
  HEADER-TRANSPORT-REPAIR01

SessionCompactionState =
  REACHABILITY_BOUND
  C2_CADENCE_FALSIFIED
  REJECTED AS LIVE W CARRIER

CADENCE_DISCOVERY     = PASS
PUBLISH_GAP           = REPRODUCED
COMPACTION_ARTIFACT_CADENCE
                      = save only on actual compaction
                        PRESERVE

P0_1                  = intentionally failing test in
                        default suite [RESOLVED via
                        split into committed GREEN
                        witness + transient RED
                        provenance file]
P0_2                  = test encoded
                        saveStateCalls === 3 as future
                        GREEN [RESOLVED: split into
                        PUBLISH_GAP + SIDECAR_CADENCE]

FIX_ONCE              = preserve RED evidence
                        → repair W publication on every
                          prepareTurn (compaction.ts:730)
                        → keep saveState compaction-only
                        → cadence test GREEN with:
                             W_A / W_B / W_C defined and
                             independently current
                             saveState still only on real
                             compaction

NEXT                  = producer cadence GREEN (lane 2)
                        → per-turn carrier inspection
                        → cadence-correct transport GREEN
                        → header RED → bounded repair

SCHEMA_BUMP           = NOT AUTHORIZED
NEW_RUNTIME_EVENT     = NOT AUTHORIZED YET
HEADER_FIELD          = NOT AUTHORIZED YET
NEW_REVIEW_ROUND      = NO

VERDICT               = HALT_DEFAULT_SUITE_RED
                        [RESOLVED in this commit]

REOPEN_CONDITION      = default suite GREEN with:
                          W_A / W_B / W_C all defined
                          and independently current
                          saveState still only on real
                          compaction
```

## Things this ACT does NOT do

- does NOT introduce a second estimator in `ChatView`
  (per fifth-pass hard rule "Transport W; do not recompute W")
- does NOT extend the `TokenEstimatedRequest` input contract
- does NOT change `getApiMetrics` Strategy-D logic
- does NOT widen `AgentModelRequest` (rejected by carrier audit)

  IN-SCOPE-but-DEFERRED (until cadence-correct carrier is
  bound):
  - bumping `SessionCompactionState` schema to v2 (NOT
    authorized yet; depends on cadence-correct carrier's
    parser/migration contract)
  - adding a NEW typed runtime event that fires per
    prepareTurn (NOT preselected; bound only after the
    cadence-correct carrier is chosen)

  DEAUTHORIZED:
  - RED-1/RED-2/RED-3 from the seventh-pass (tested
    persistence-on-compaction, not cadence, and were
    structurally preselected by the rejected
    SessionCompactionState verdict)
  - the seventh-pass RED-2/3 plan's named repair field
    `ExtensionState.lastWorkingContextEstimate`
    (preselected the repair before the cadence-correct
    carrier was bound)

## Test artifact target

```text
Cadence discriminator split into TWO forms per
ninth-pass causal correction:

1. COMMITTED FALSIFICATION WITNESS (GREEN, in default
   suite per "transient RED = good / committed
   intentionally-failing default = not allowed" rule):
     CARRIER_CADENCE in compaction.working-context-
     authority-publish.test.ts:176
     — asserts the GREEN architectural invariant:
         resultA.currentWorkingContextEstimate defined
         saveState only on real compaction
     — resultB/resultC intentionally NOT asserted
       (their RED provenance lives in evidence file)

2. TRANSIENT RED PROVENANCE (RED, OUTSIDE default
   vitest discovery):
     .factory/evidence/ACT-CLINEMM-COMPACTION-WORKING-
       CONTEXT-HEADER-TRANSPORT-REPAIR01/
       cadence-discriminator-red.provenance.ts
     — full mechanical RED observation (PUBLISH_GAP
       REAL DEFECT)
     — invocation:
         bun $EVIDENCE_FILE
     — 4 PUBLISH_GAP REDs + 1 informational GREEN +
       informational SIDECAR_CADENCE preservation
       note

Seventh-pass RED-1/RED-2/RED-3:
  DEAUTHORIZED (ninth-pass correction; wrong invariant;
  structurally preselected by the rejected
  SessionCompactionState verdict; also named a
  preselected repair field)

Plus: compaction-shrink discriminator preserved
  (alongside transport GREEN, not as evidence for
  carrier selection)
```
```

## Out-of-scope cleanup (P2 only — not a cleanup commit)

If the test header in AUTHORITY-PUBLISH01's test file is touched
during this work, prefer:

```text
W_AT_PREPARE_TURN (durable test name)
with comment:
  pre-fix RED: MISSING_W_AT_PREPARE_TURN reproduced at 6bffd75c0
```

over the historical test-name-and-comment combination.

## Forward disposition

```text
commit lane 1: cadence discriminator split into
                committed GREEN falsification witness
                + transient RED provenance file
                (this commit; eighth-pass halt
                resolved + ninth-pass causal
                correction applied; default suite
                GREEN; RED provenance preserved
                OUTSIDE default vitest discovery
                in
                .factory/evidence/ACT-CLINEMM-
                  COMPACTION-WORKING-CONTEXT-HEADER-
                  TRANSPORT-REPAIR01/
                  cadence-discriminator-red.provenance.ts)

commit lane 2: producer cadence GREEN at
                compaction.ts:730
                — close the publish gap: call
                  publishWorkingContextEstimate on
                  the no-compaction branch with
                  the final request shape (original
                  or projected messages +
                  systemPrompt + tools)
                — saveState cadence UNCHANGED
                  (still only on real compaction)
                — required GREEN matrix:
                    A: compaction
                       W defined   saveState +1
                    B: no compaction
                       W defined   saveState unchanged
                    C: no compaction
                       W defined   saveState unchanged
                       (B.W !== A.W, C.W !== B.W)

commit lane 3: per-turn carrier inspection (NEW source
                pass; no production code change)
                — audit existing agent/runtime event/
                  snapshot surfaces that already move
                  per prepare-turn
                — choose the lowest cadence-correct
                  carrier using the selection
                  invariant
                — do NOT assume a new event or
                  AgentRuntimeStateSnapshot field yet

commit lane 4: cadence-correct transport GREEN +
                populate ExtensionState + header
                numerator switch + compaction-shrink
                discriminator

commit lane 5 (optional): compose durable compaction
                artifact (resume baseline) with live
                per-turn event (current W authority)
```

`NEW_REVIEW_ROUND = NO` for each commit (cadence discriminator
is mechanical; doctrine is frozen; provenance is sufficient;
RED-1/2/3 + named repair field are de-authorized, not
pending review).

PRODUCTION_RUNTIME_DELTA = ZERO at each commit
(subject count reported against running parent baseline;
this commit changed ONE default-test case to its
committed-falsification-witness GREEN form + added ONE
transient RED provenance file outside default discovery;
zero production source touched).

TYPECHECK expectation = TYPECHECK_DELTA = ZERO at each commit
(same implication; typecheck scope = source tree).

DEFAULT_SUITE_STATE = GREEN
(committed test in compaction.working-context-authority-
publish.test.ts:176 is a passing falsification witness;
the RED form is the transient evidence file in
.factory/evidence/... — OUTSIDE default discovery).

C1 = `GO_PRODUCER_CADENCE_GREEN` (was `GO_CARRIER_BIND`
→ `GO_CADENCE_INSPECTION`; the eighth-pass halt falsified
SessionCompactionState; the ninth-pass causal correction
split concepts; the next causal question is the bounded
producer-cadence repair at compaction.ts:730 with saveState
cadence UNCHANGED, followed by per-turn carrier inspection
+ cadence-correct transport GREEN).
No production code change in this commit.
