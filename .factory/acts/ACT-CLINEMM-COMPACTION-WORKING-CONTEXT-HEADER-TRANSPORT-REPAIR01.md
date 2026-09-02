# ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01

| Field | Value |
|-------|-------|
| OWNING_EPIC | EPIC-CONTEXT-COMPACTION-TOKEN-ACCOUNTING |
| PREDECESSOR_ACT | ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-AUTHORITY-PUBLISH01 |
| PRODUCTION_DELTA_TARGET | bounded (one new core→host carrier seam + one narrow header numerator switch) |
| DISPOSITION | OPEN — CARRIER_BIND landed; RED not yet authored |
| C1 | GO_CARRIER_BIND (was GO_HEADER_TRANSPORT; carrier audit landed; next causal question is RED authoring + bounded GREEN) |

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

## Resolved carrier chain

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

## Things this ACT does NOT do

- does NOT change producer-side code in `compaction.ts`
  (AUTHORITY-PUBLISH01's bound; frozen at `fc906dfc6`)
- does NOT introduce a second estimator in `ChatView`
  (per fifth-pass hard rule "Transport W; do not recompute W")
- does NOT extend the `TokenEstimatedRequest` input contract
- does NOT modify the upstream
  `createContextPipelinePrepareTurn` shape
- does NOT change `getApiMetrics` Strategy-D logic
- does NOT widen `AgentModelRequest` (rejected by carrier audit)
- does NOT widen runtime-event metadata surface (rejected by carrier audit)
- does NOT add any new protocol field beyond ONE bounded
  `currentWorkingContextEstimate?: number` on
  `SessionCompactionState`

## Test artifact target

```text
Three test cases, one per RED seam:

  RED-1 (sdk/packages/core/src/extensions/context/):
    a RED that runs a real prepareTurn call with a
    deterministic injected compact(), inspects the
    state passed to saveState, and asserts the saved
    state carries currentWorkingContextEstimate =
    estimateRequestInputTokens(final returned shape).

  RED-2 (apps/vscode/src/sdk/):
    a RED that constructs a real SessionCompaction-
    State carrying W_after, runs it through the
    host's updateSessionCompactionState path, and
    asserts ExtensionState.lastWorkingContextEstimate
    = W_after.

  RED-3 (webview or extension host side):
    a RED that gives ExtensionState.lastWorking-
    ContextEstimate = W_after, asserts no subsequent
    api_req_started, and asserts TaskHeader /
    ContextWindow projected numerator = W_after
    (oracle = real prepare-turn output, NOT 264_300).

  Plus: compaction-shrink discriminator
    (alongside the transport GREEN, not as evidence
    for carrier selection per seventh-pass review).
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
commit lane 1: RED-1 producer→artifact seam (core)
commit lane 2: GREEN-1 (schema v1→v2 + merge
                        prepare-turn result into
                        saved nextState; backward-compat
                        safeParse)
commit lane 3: RED-2 artifact→host-state seam +
               RED-3 host→header projection seam +
               GREEN-2/3 (host mirror + header
               numerator switch + compaction-shrink
               RED→GREEN transition)
commit lane 4 (optional): wire ContextWindow visual
                          delta into telemetry
```

`NEW_REVIEW_ROUND = NO` for each commit (transport is mechanical;
doctrine is frozen; carrier audit complete; provenance is sufficient).

TYPECHECK expectation = TYPECHECK_DELTA = ZERO at each commit
(subject count reported against running parent baseline).

C1 = `GO_CARRIER_BIND` (was `GO_HEADER_TRANSPORT`; carrier audit
landed; the next causal question is RED authoring + bounded GREEN).
No production code change in this calibration commit.
