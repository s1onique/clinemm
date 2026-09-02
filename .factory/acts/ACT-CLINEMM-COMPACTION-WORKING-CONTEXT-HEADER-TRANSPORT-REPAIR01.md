# ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01

| Field | Value |
|-------|-------|
| OWNING_EPIC | EPIC-CONTEXT-COMPACTION-TOKEN-ACCOUNTING |
| PREDECESSOR_ACT | ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-AUTHORITY-PUBLISH01 |
| PRODUCTION_DELTA_TARGET | bounded (one new core→host carrier seam + one narrow header numerator switch) |
| DISPOSITION | OPEN — CARRIER_BIND landed (e66883634) + CADENCE FALSIFIED (8b857f634 eighth-pass halt) + ninth-pass causal correction (HALT_DEFAULT_SUITE_RED) applied (9b0930bd6) + tenth-pass PRODUCER_CADENCE_GREEN landed (PUBLISH_GAP fixed at compaction.ts:730 with P1_1 NO_COMPACTION_REQUEST_SEMANTICS_DELTA = 0 control; RED provenance file retired); default suite GREEN; next = per-turn carrier inspection |
| C1 | GO_PER_TURN_CARRIER_INSPECTION (was GO_CARRIER_BIND → GO_CADENCE_INSPECTION → GO_PRODUCER_CADENCE_GREEN; producer cadence GREEN landed in tenth-pass; next causal question = audit existing per-turn event/snapshot carriers without assuming a new event or AgentRuntimeStateSnapshot field) |

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

## Tenth-pass (2026-09-03) — producer cadence GREEN

The factory causal reviewer + context-pipeline engineer
issued `PASS_WITH_ONE_P1_FIX` on 9b0930bd6. Two P1s
landed in this commit:

  P1_1 (semantic conservation, reviewer-mandated):
    Adding the producer cadence GREEN naively
    (`return publishWorkingContextEstimate(
       context.messages, context.systemPrompt,
       context.tools)`) would have populated
    `result.messages` and `result.systemPrompt` on the
    no-compaction branch. The downstream consumer at
    `sdk/packages/agents/src/agent-runtime.ts:2319-2324`
    treats the result as a projection when either
    field is set — `cloneMessages(result.messages)` and
    `result.systemPrompt` replacement fire. That
    changes `next !== request` and breaks the no-op
    projection invariant the reviewer required
    (`NO_COMPACTION_REQUEST_SEMANTICS_DELTA = 0`).

    Fix: new metadata-only helper
    `publishWorkingContextEstimateMetadataOnly` that
    returns ONLY `currentWorkingContextEstimate`
    (messages + systemPrompt NOT set). Downstream
    falls through both projection branches; the
    load-bearing P1_1 control asserts
    `result.messages === undefined` and
    `result.systemPrompt === undefined` on the
    no-compaction branch (B/C).

  P1_2 (RED provenance file portability, opportunistic):
    The ninth-pass RED evidence file
    `.factory/evidence/.../cadence-discriminator-red.
    provenance.ts` imported `compaction.ts` via an
    absolute workstation path. The fix: RETIRE the
    file entirely (its captured RED is no longer
    reproducible after the producer cadence GREEN
    lands) rather than fix the portability in
    isolation. The post-fix GREEN state is now
    authoritative in the committed CARRIER_CADENCE
    test.

### Architecture preserved

```text
W publication cadence       = every prepareTurn
durable artifact cadence    = actual compactions only
NO_COMPACTION_REQUEST_SEMANTICS_DELTA = 0
```

### Interface revision

`ContextPipelinePrepareTurnResult.messages` and
`systemPrompt` are now OPTIONAL (was `messages` required,
`systemPrompt` optional). The new contract reflects the
actual three return shapes from `prepareTurn`:

  1. `undefined`                            — no return
  2. `{ messages, systemPrompt?, W? }`     — projection
  3. `{ currentWorkingContextEstimate }`    — metadata-only

Cascade fixes in 4 test files; final typecheck count
= 23 (baseline; zero new errors).

### GREEN matrix observed (mechanically)

```text
              resultA      resultB      resultC
compaction    yes          no           no
W defined     yes          yes          yes
W value       670          !=A          !=B
saveState     +1           unchanged    unchanged
messages      T[]          undefined    undefined  ← P1_1
systemPrompt  string       undefined    undefined  ← P1_1
```

### Test updated

`compaction.test.ts:4637` ("keeps stale sidecar state
when replacement compaction returns no result") now
asserts the post-fix metadata-only return contract
(`result.messages === undefined`,
`result.systemPrompt === undefined`) instead of
`result === undefined`. The functional behavior is
identical for downstream projection logic; only the
type shape changes.

### Disposition

```text
ACT                       = HEADER-TRANSPORT-REPAIR01 = OPEN
CHOSEN CARRIER (C2 live W) = REJECTED
PUBLISH_GAP               = FIXED
SIDECAR_CADENCE           = PRESERVED
CARRIER_CADENCE_FALSIFIED = PASS / GREEN
P0_1                      = RESOLVED (split concepts)
P0_2                      = RESOLVED (split concepts)
P1_1                      = LANDED (NO_COMPACTION_REQUEST
                            _SEMANTICS_DELTA = 0 asserted)
P1_2                      = LANDED (RED file retired)
PRODUCTION_RUNTIME_DELTA  = NONZERO this commit
TYPECHECK_DELTA           = ZERO (23 = baseline)
DEFAULT_SUITE_STATE       = GREEN

NEXT_QUESTION = per-turn carrier inspection
  (audit existing agent/runtime event/snapshot
   surfaces; do NOT assume a new event or
   AgentRuntimeStateSnapshot field yet).
NEW_REVIEW_ROUND          = NO
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

## Eleventh-pass (2026-09-03) — API export bind (P1) + P2 strengthened assertions

The factory causal reviewer + TypeScript SDK/API
engineer issued `PASS_WITH_ONE_P1_FIX` on 054ee75b9.
This commit resolves that P1 mechanically + tightens
the P2 the reviewer flagged (no new review round, no
producer-algorithm revisit).

### P1 — API export bind

```bash
git grep -n \
  -e 'ContextPipelinePrepareTurnResult' \
  -- \
  sdk/packages/core/src/index* \
  sdk/packages/core/package.json \
  sdk/packages/*/src/index*
```

Result: **ZERO matches**.

Wider sweep:

```bash
git grep -n -e 'ContextPipelinePrepareTurnResult' \
  -- sdk/ apps/ | \
  grep -v 'extensions/context/compaction'
```

Result: **ZERO matches**.

`@cline/core/src/index.ts` re-exports from
`./extensions/context/compaction`:

```ts
export {
    createCompactionStateAwarePrepareTurn,
    createContextCompactionPrepareTurn,
} from "./extensions/context/compaction";
```

Function-only. The interface
`ContextPipelinePrepareTurnResult` is declared in the
implementation file but is NOT a named export of the
canonical `@cline/core` package surface.

### Verdict

```text
API_SURFACE_DELTA = INTERNAL_ONLY
→ GO
```

External consumers of `@cline/core` get the two
factory functions; the interface is reachable only
via:

  - direct path import
    (`@cline/core/dist/extensions/context/compaction`)
  - `Awaited<ReturnType<typeof
    createCompactionStateAwarePrepareTurn>>`
    inference

Both are non-canonical access patterns. The optionality
change in 054ee75b9 (`messages?: T[]`, was `T[]`) is
safe at the documented public surface.

### P2 — strengthen W-monotonicity assertions

The tenth-pass committed CARRIER_CADENCE test asserted
`B.W != A.W` (inequality) but its commentary said
"W grows monotonically" (strict). The fixture adds
0/4/8 padding turns to A/B/C; the estimator is roughly
linear in character count, so strict growth is
supported. Strengthened assertions:

```ts
// Before
expect(A.W).not.toBe(B.W);
expect(B.W).not.toBe(C.W);
// After
expect(A.W).toBeLessThan(B.W);
expect(B.W).toBeLessThan(C.W);
```

All 3 sub-tests still GREEN; typecheck = 23 = baseline.

### Disposition

```text
ACT                       = HEADER-TRANSPORT-REPAIR01 = OPEN
PRODUCER_CADENCE_GREEN    = PASS (unchanged)
API_SURFACE_DELTA         = INTERNAL_ONLY → GO
P2 W-monotonicity         = STRENGTHENED (not.toBe →
                            toBeLessThan)
P0 / P1 / P2              = ALL CLOSED
PRODUCTION_RUNTIME_DELTA  = ZERO this commit
TYPECHECK_DELTA           = ZERO (23 = baseline)
DEFAULT_SUITE_STATE       = GREEN

NEXT_QUESTION = per-turn carrier inspection
  (auditor pass; do NOT assume a new event or
   AgentRuntimeStateSnapshot field yet).
NEW_REVIEW_ROUND = NO.
```

## Forward disposition (tenth-pass)

Producer cadence GREEN landed in this commit. The next
causal question is per-turn carrier inspection: audit
existing agent/runtime event/snapshot surfaces that
already move per prepareTurn. Do NOT assume a new event
or `AgentRuntimeStateSnapshot` field yet. Selection
invariant (unchanged):

```text
for each prepareTurn yielding W_n:
  downstream host eventually observes W_n
without requiring:
  compaction, provider response, api_req_started
```

`NEW_REVIEW_ROUND = NO` for the producer cadence GREEN
(mechanical, doctrine-frozen). Per-turn carrier
inspection is the next review surface.

## Twelfth-pass (2026-09-03) — per-turn carrier inspection COMPLETED

The factory causal reviewer + SDK runtime/state
engineer issued PASS on `47fd3c995` with C1:
GO_PER_TURN_CARRIER_INSPECTION. This commit produces
the source topology + executable RED the reviewer
demanded (not more Factory prose).

### Verdict

```text
CADENCE_CORRECT_EXISTING_CARRIER = ABSENT / PROVEN
NEW_TYPED_PER_TURN_CARRIER       = AUTHORIZED
```

Source topology (full table in entry-freeze.txt):

```text
+------------------------------------+----------+----------------+--------------+--------------+------------+
| candidate seam                     | after    | receives       | agents->core?| core->host?  | verdict    |
|                                    | every    | exact W w/o    |              |              |            |
|                                    | prepareT?| recompute?     |              |              |            |
+------------------------------------+----------+----------------+--------------+--------------+------------+
| AgentRuntimeEvent                  | NO       | n/a            | n/a          | n/a          | TEMPORAL   |
|   e.g. turn-started                | (fires   |                |              |              | BIND FAIL  |
|   (agent-runtime.ts:1374)          | BEFORE)  |                |              |              |            |
+------------------------------------+----------+----------------+--------------+--------------+------------+
| AgentRuntime.snapshot()            | YES      | NO             | n/a          | n/a          | IDENTITY   |
|   AgentRuntimeStateSnapshot        | (query-  | (no W field)   |              |              | BIND FAIL  |
|   (agent-runtime.ts:1001)          | able)    |                |              |              |            |
+------------------------------------+----------+----------------+--------------+--------------+------------+
| snapshot.usage                     | YES      | NO             | n/a          | n/a          | NO         |
|   (shared/src/agent.ts:125)        |          | (usage from    |              |              | RECOMPUTE  |
|                                    |          | provider)      |              |              | VIOLATION  |
+------------------------------------+----------+----------------+--------------+--------------+------------+
| LocalRuntimeHost                   | NO       | n/a            | NO           | n/a          | INHERITS   |
|   session.updated / current        | (derives |                | (downstream) |              | UPSTREAM   |
|   snapshot projection              | from snap|                |              |              | GAP        |
+------------------------------------+----------+----------------+--------------+--------------+------------+
| usage / context event              | NO       | n/a            | n/a          | n/a          | POST-      |
|   (fires only on provider          | (fires   |                |              |              | PROVIDER   |
|   response)                        | on resp.)|                |              |              | (forbids)  |
+------------------------------------+----------+----------------+--------------+--------------+------------+
```

### RED (authored + reproduced mechanically)

File:
`.factory/evidence/ACT-CLINEMM-COMPACTION-WORKING-
  CONTEXT-HEADER-TRANSPORT-REPAIR01/per-turn-carrier-
  inspection-red.provenance.ts`

Invocation:

```bash
bun .factory/evidence/ACT-CLINEMM-COMPACTION-WORKING-\
  CONTEXT-HEADER-TRANSPORT-REPAIR01/per-turn-carrier-\
  inspection-red.provenance.ts
```

Mechanical output (HEAD = `47fd3c995`):

```text
{
  "status": "RED",
  "error": "snapshot.currentWorkingContextEstimate is
            undefined; AgentRuntimeStateSnapshot at
            shared/src/agent.ts:273 has NO currentWorking
            ContextEstimate field; prepareTurn returned
            4242 but the value is discarded at
            agent-runtime.ts:1738-1770 (only flows into
            the model request via openTaskLifecycleStream)",
  "prepareTurnCalls": 1
}
```

The RED ends at the existing host-facing boundary
(`runtime.snapshot()`), NOT yet at TaskHeader (per
reviewer's directive). The file lives outside any
vitest config (same convention as prior cadence RED
file); default suite stays GREEN.

### Next bounded repair (C2 carrier bind)

Authorize one new typed field on
`AgentRuntimeStateSnapshot` that captures
`result.currentWorkingContextEstimate` from
`prepareTurnForModelRequest`:

  (a) capture result.currentWorkingContextEstimate
      in this.state at agent-runtime.ts:1738
  (b) include it in AgentRuntimeStateSnapshot
      at agent-runtime.ts:1001
  (c) optionally emit a per-turn event that
      crosses the agents->core seam

Do NOT resurrect `SessionCompactionState`. Do NOT
widen the usage event. The TODO at
agent-runtime.ts:2300 explicitly anticipates this:
"have `prepareTurn` report the token estimates it
already computed (before/after)".

```text
PRODUCER_W           = CLOSED / GREEN (054ee75b9)
API_SURFACE_BIND     = PASS / INTERNAL_ONLY (47fd3c995)
CARRIER_INSPECTION   = COMPLETED (this commit)
CADENCE_CORRECT_CARRIER = ABSENT / PROVEN
NEW_TYPED_PER_TURN   = AUTHORIZED
RED_AFTER_BINDING    = AUTHORED + REPRODUCED
PRODUCTION_DELTA     = ZERO this commit
TYPECHECK_DELTA      = ZERO
DEFAULT_SUITE_STATE  = GREEN
NEW_REVIEW_ROUND     = NO
C1                   = GO_C2_CARRIER_BIND
```
