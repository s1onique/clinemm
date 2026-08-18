# C2.5 — REAL C04 capture plan

**Subject:** ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.5-REAL-C04-CAPTURE

**Status:** plan-only (Phase C2.5-0); no production, test, or config changes in this commit.

## Authority and entry freeze

```text
ENTRY_HEAD                       = e1a4feaa4 (D4 hygiene fix)
BRANCH                           = act/elm-architecture01-e0-e4
TREE                             = cb91427656af8d56f3a60b6cf36394d090a1be44
UNEXPECTED_TRACKED_DIRTY         = false
KNOWN_CLINERULES_UNTRACKED_ONLY  = true  (.clinerules/sdk-transport-integration.md; G0.10)
PROTECTED_STASHES_INTACT         = true
  SHA-256 stash@{1} (FORENSIC, 141372c52)         = e4df6de3220647d5c9dbc27165ec8311d2f277683ff26b66ced67f977d26f233
  SHA-256 stash@{2} (CONTEXT-ACCOUNTING)          = ac85c95cfbabf14945b490a121901175700a41939b9dfd3f80767c84fed5755a
```

## Predecessor authority (carried forward, NOT re-opened)

```text
C2.3                              CLOSED
C2.4-A SOURCE RECON               PASS_RECON
C2.4-B PRE_FIX witness            FAIL_OPEN
C2.4-B POST_FIX engineering       PASS_CLOSED
C2.4-B closure normalization      PASS
C2.4-B R6/R7 prose correction    PASS
C2.4-C REAL LOCAL transport       CLOSED (C-REAL-1..5, file 3 of the bridge)
C2.4-D0..D3                       CLOSED (D3-CORRECTION01 refresh)
C2.4-D4 E7 SCOPE FREEZE           CLOSED_CLEAN (LOCAL_ONLY frozen)
  E7_INITIAL_BACKEND_SCOPE        = LOCAL_ONLY
  LOCAL_INCLUDED                  = true
  HUB_EXCLUDED                    = true (NOT_YET_QUALIFIED)
  REMOTE_EXCLUDED                 = true (NOT_YET_QUALIFIED)
```

C2.5 inherits D4's scope freeze verbatim. C2.5 itself cannot add
Hub/Remote; that requires a fresh D2/D3/D4 qualification cycle.

## Hard guardrails (carried from the reviewer round-19 plan verbatim)

```text
G0.1  LOCAL_ONLY is immutable throughout C2.5.
G0.2  A HubRuntimeHost / RemoteRuntimeHost event MUST NOT be used as C2.5 evidence.
G0.3  Existing C2.3 W15 is a historical/synthetic control. It MUST NOT be relabeled REAL_C04.
G0.4  "REAL" means the observation was produced by a running production-shaped LOCAL
      extension/runtime path, not by calling comparator/reducer methods directly.
G0.5  "C04_SYNTHETIC_REAL" means: synthetic stimulus + REAL Local runtime/host/wiring/
      capture/classification chain. It does NOT mean a pure unit-test fixture.
G0.6  Never manufacture the expected D01 record directly. Stimulus may be synthetic;
      evidence path may not be.
G0.7  No test may assert success merely because D01_LEGACY_FALSE_IDLE count > 0.
      It must prove the input state that caused the classification.
G0.8  Do not modify historical C2.3/C2.4 evidence to make C2.5 pass. Add current C2.5
      evidence and pointers only.
G0.9  Do not touch the protected stashes.
G0.10 .clinerules/sdk-transport-integration.md remains exempt unless explicitly
      authorized separately.
```

## Recon — C04 end-to-end on the current production LOCAL chain

The C04 divergence shape is **legacy phase `idle` while the canonical
runtime/arbiter is active**. The frozen W15 fixture in
`apps/vscode/src/sdk/__tests__/task-state-shadow-correction02-c23-stateful-workloads.test.ts:5104`
defines this shape. The full chain (file:line citations on the
un-modified production path):

```text
real user/task action
  ↓
sdk/packages/core AgentRuntime / runtime execution state
  ↓
sdk/packages/core AgentRuntimeEvent
  ↓
sdk/packages/core LocalRuntimeHost canonical fanout
  (sdk/packages/core/src/runtime/host/local-runtime-host.ts)
  ↓
subscribeCanonicalRuntimeEventsToShadow
  (apps/vscode/src/sdk/canonical-event-subscription.ts:57)
  ↓
TaskShadowHostWiring.observeCanonicalRuntimeEvent
  (apps/vscode/src/sdk/task-state-shadow-host-wiring.ts:594
   — canonical-event ingress; observes the legacy TurnStateTracker
   synchronously and feeds the comparator)
  ↓
TaskShadowComparator.compareWith
  (apps/vscode/src/sdk/task-state-shadow.ts:120)
  ↓
TaskShadowRecorder (classify)
  (apps/vscode/src/sdk/task-state-shadow-recorder.ts:521
   — production classifier)
  ↓
D01_LEGACY_FALSE_IDLE record
```

### Hop-by-hop verification

1. **Where is authoritative runtime execution state read?**
   - `TaskShadowHostWiring` samples it via `deps.getArbiterSnapshot()`
     at every observation ingress. The arbiter shape carries
     `execution.modelStreaming`, `execution.awaitingApproval`,
     `pendingToolCalls[]`, `status`, `recoveryState`.
     See `task-state-shadow-host-wiring.ts:599`.

2. **Where is legacy `TurnPhase` read?**
   - Synchronously at every observation ingress via
     `deps.getLegacyPhase()`.
     See `task-state-shadow-host-wiring.ts:598`.
   - The legacy phase is sourced from the `TurnStateTracker.currentPhase`
     (read-only from the shadow's perspective; never written by the
     shadow).
     See `task-state-shadow-host-wiring.ts:8-25`.

3. **At what exact instant are the two sampled?**
   - Both samples are taken **synchronously at the same ingress point**
     (`observeLegacyEvent` / `observeCanonicalRuntimeEvent`). The two
     samples are temporally co-located; they cannot be sampled from
     different logical instants within a single observation.
     See `task-state-shadow-host-wiring.ts:589-602`.

4. **Can they be sampled from different logical instants?**
   - No — see (3). The C04 predicate is therefore well-defined at the
     observation site. The classifier can always read the
     causal inputs (legacy phase + arbiter snapshot) from the same
     instant.

5. **What timestamp/sequence metadata exists?**
   - Every record carries:
     - `seq` (monotonic integer from comparator)
     - `timestamp` (number, captured at observe time)
     - `event` (TaskMsg type or "noop")
     - `legacyPhase`, `shadowPhase`, `lifecycleKind`,
       `modelStreaming`, `activeToolCount`, `awaitingApproval`,
       `toolCalls`, `recoveryBudgetFailures`,
       `taskEpochOrOpaqueTaskKey` (the active session id),
       `runtimeStatus`, `classification`, `arbitration`,
       `origin` (RUNTIME_CANONICAL / RUNTIME_RECONSTRUCTED /
                  HOST_TASK / HOST_RECOVERY).
     See `task-state-shadow-recorder.ts:64-90`.

6. **What sessionId/runId are attached?**
   - `taskEpochOrOpaqueTaskKey` carries the opaque session id (the
     production "task epoch" key for cross-session provenance, set by
     the wiring from `lifecycle.getActiveSession().sessionId`).
   - `runId` / `conversationId` are carried inside the canonical
     `AgentRuntimeEvent` and propagated by the canonical-event ingress
     (via `sessionId` in the envelope from
     `canonical-event-subscription.ts:69-74`).
   - The recorder itself does not store raw `runId` (privacy-safe,
     ELM10), but the canonical event's sessionId IS used to gate
     stale-session drop at `canonical-event-subscription.ts:65`.

7. **Does recorder retain sufficient evidence to prove the C04 predicate?**
   - YES. Every record retains:
     - `legacyPhase` (the legacy side)
     - `shadowPhase`  (the shadow side)
     - `modelStreaming`, `awaitingApproval`, `activeToolCount`,
       `toolCalls` (the runtime/arbiter activity side)
     - `classification` (the classification produced by the
       production `classify()` function)
     - `arbitration` (the outcome)
   - The classifier function is exported
     (`task-state-shadow-recorder.ts:521`) and runs on every
     comparison. The classifier itself reads
     `arbiter.execution.modelStreaming`,
     `arbiter.execution.awaitingApproval`,
     `arbiter.pendingToolCalls.length` to decide D01.
     The recorder stores exactly the fields needed to verify these
     post-hoc.

8. **Is the recorder already externally inspectable?**
   - YES. `recorderCounts()` and `records()` are public methods on
     `TaskShadowHostWiring` (re-exported from the recorder). See
     `task-state-shadow-recorder.ts:419` (`recorderCounts` accessor)
     and the wiring's passthrough accessors.
   - In addition, the C-REAL-5 bridge test already proves the chain
     `real LocalRuntimeHost → real subscribeCanonicalRuntimeEventsToShadow
      → real TaskShadowHostWiring` is end-to-end observable
     (`real-local-to-shadow-bridge.c24-c-correction01.test.ts:75-83`).

9. **Does the real extension host already expose a telemetry/debug sink
   sufficient for capture?**
   - YES, via the wiring's `records()` / `recorderCounts()`. The
     wiring is wired into the production SdkController
     (`SdkController.ts:1661`), is enabled by default
     (`CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL` default `true`,
     `task-state-shadow-host-wiring.ts:62-69`), and the records it
     produces are privacy-safe (ELM10 enforced structurally).
   - Phase C2.5-1 disposition: existing capture surface (option A +
     option B from the reviewer's hierarchy) is sufficient. No new
     telemetry or observation hooks are required.

## Frozen C04 predicate (verbatim from production classifier)

Copied from `task-state-shadow-recorder.ts:542-547`:

```typescript
if (legacyPhase === "idle" && shadowPhase === "streaming") {
    const arbiterActive =
        arbiter.execution.modelStreaming ||
        arbiter.execution.awaitingApproval ||
        arbiter.pendingToolCalls.length > 0
    if (arbiterActive) return "D01_LEGACY_FALSE_IDLE"
}
```

The C04 predicate (Phase C2.5-0.3 freeze):

```text
C04_PREDICATE =
    legacyPhase        == "idle"
  ∧ shadowPhase         == "streaming"
  ∧ arbiterActive       = (execution.modelStreaming
                          ∨ execution.awaitingApproval
                          ∨ pendingToolCalls.length > 0)
  ∧ classification      = "D01_LEGACY_FALSE_IDLE"

C04_ARBITRATION =
    arbiterActive = true → "SHADOW_CORRECT"
    arbiterActive = false → "LEGACY_CORRECT"
```

Note: under the real Local path the shadow must observe the
canonical `modelStreaming` via `subscribeCanonicalRuntimeEventsToShadow`
(`origin: RUNTIME_CANONICAL`). The W15 fixture uses a `RUNTIME_RECONSTRUCTED`
envelope (the synthetic path), which under Option A is
**DIAGNOSTIC_ONLY** and does NOT produce a `TaskShadowDifferentialRecord`.
C2.5's REAL C04 must therefore use the **canonical** path, not the
reconstructed path. This is a deliberate and necessary contrast
with the frozen W15 control.

## C25_RECON_VERDICT

```text
C25_RECON_VERDICT               = PASS_RECON
EXISTING_CAPTURE_SUFFICIENT     = true
INSTRUMENTATION_REQUIRED        = false   (Phase C2.5-1 hierarchy option A+B)
C04_EXACT_PREDICATE_FROZEN      = true
C04_CLASSIFICATION              = D01_LEGACY_FALSE_IDLE
C04_ARBITRATION                 = SHADOW_CORRECT (canonical-side arbiter active)
PRODUCTION_CAPTURE_TOPOLOGY     = REAL LocalRuntimeHost
                                 → subscribeCanonicalRuntimeEventsToShadow
                                 → TaskShadowHostWiring
                                 → TaskShadowComparator
                                 → TaskShadowRecorder
                                 → classification()
LEGACY_FALSE_SIDE               = idle
AUTHORITATIVE_ACTIVE_SIDE       = execution.modelStreaming
                                 ∨ execution.awaitingApproval
                                 ∨ pendingToolCalls.length > 0
HUB_USED_AS_C25_EVIDENCE        = false   (G0.2)
REMOTE_USED_AS_C25_EVIDENCE     = false   (G0.2)
```

## REAL_CAPTURE_SURFACE — what we already have

Per Phase C2.5-1 hierarchy (reviewer round-19 plan):

```text
A. Existing TaskShadowRecorder records     ✓ in use
   — TaskShadowHostWiring.records()
   — TaskShadowHostWiring.recorderCounts()
B. Existing test-visible diagnostics API   ✓ in use
   — canonical-event-subscription.ts
   — bridge test C-REAL-1..5
C. Existing telemetry/debug dump emitted
   by production                          ✓ in use (ENV-flag-gated wiring)
D. Narrow observation-only capture hook    ✗ NOT NEEDED
```

## Phase plan (commits)

The C2.5 plan will produce, at most, the following commits. **C25-C1
is contingent on C25-C0** proving the recon verdict `INSTRUMENTATION_REQUIRED
= false` (which this plan documents). If C25-C0 holds, C25-C1 is
skipped per the reviewer's "do not create infrastructure because the
plan happened to anticipate it" rule.

```text
C25-C0  docs(elm): freeze C2.5 real-C04 capture contract + recon
       (THIS COMMIT — plan only, no code changes)

[ C25-C1  test/obs(elm): establish production C04 capture surface
          ONLY IF C25-C0 surfaced an INSTRUMENTATION_REQUIRED = true gap ]

C25-C2  test(elm): C2.5 REAL C04 capture witness
       (organic attempt through C-REAL chain; dispositions per the
        reviewer's 3-way: REPRODUCED, NOT_REPRODUCED_CAPTURE_VALID,
        CAPTURE_INSUFFICIENT → HALT)

C25-C3  test(elm): C04_SYNTHETIC_REAL positive/negative/necessity
       (synthetic stimulus on the C-REAL canonical chain; must yield
        D01 count = 1 in positive, 0 in negative, 0 when only one
        side of the predicate is mutated)

C25-C4  test(elm): C2.5 adversarial stale/session/run controls
       (stale session, no active session, stale run, duplicate)

C25-C5  docs(elm): C2.5 terminal evidence + E7 authorization
       (terminal evidence doc + freeze E7_AUTHORIZED = true under
        LOCAL_ONLY; or BLOCK E7 on C2.5 = BLOCKED)
```

This commit is **C25-C0 only**.

## Halt conditions (carried from reviewer round-19)

```text
H1   unexpected tracked dirty work             → HALT
H2   protected stash fingerprint changes       → HALT
H3   real capture requires Hub or Remote       → HALT; violates D4
H4   C04 captured only via direct
     comparator/recorder call                   → HALT; not REAL
H5   classifier result exists but causal
     input fields cannot be recovered          → CAPTURE_INSUFFICIENT
H6   synthetic-real requires production
     reducer semantic change                    → HALT; wrong layer
H7   C2.5 uncovers a genuine Local semantic
     defect                                     → freeze evidence, classify,
                                                 open C2.5-CORRECTION;
                                                 do not paper it over
H8   D10_UNKNOWN > 0 on target C04 path        → FAIL qualification
H9   invariant violation on valid Local exec   → FAIL qualification
H10  Hub/Remote scope accidentally expands    → FAIL / restore D4 LOCAL_ONLY
```

## Conservation (carried forward)

```text
LEGACY_AUTHORITY              = 100%
SHADOW_AUTHORITY              = 0%
DIVERGENCE_ACTION             = RECORD_ONLY
WEBVIEW_CUTOVER               = false
EFFECT_EXECUTION_ENABLED      = false
REDUCER_SEMANTIC_DELTA        = 0   (target)
E7_CONSUMER_DELTA             = 0   (target)
D4_SCOPE_DELTA                = 0   (target)
HUB_PRODUCTION_DELTA          = 0
REMOTE_PRODUCTION_DELTA       = 0
```

## Expected board after execution (success)

```text
C2.3                                       ✅ CLOSED
C2.4-A/B/C/D                               ✅ CLOSED
C2.4-D4                                    ✅ CLOSED_CLEAN
  E7_INITIAL_BACKEND_SCOPE                 LOCAL_ONLY

C2.5
  C04 recon/capture contract               ✅
  REAL Local capture surface               ✅
  REAL C04 experiment                      ✅ REPRODUCED
                                            or
                                            ✅ NOT_REPRODUCED_CAPTURE_VALID
  C04_SYNTHETIC_REAL                       ✅
  negative + necessity probes              ✅
  adversarial provenance controls          ✅
  regressions                              ✅
  verdict                                  ✅ CLOSED

E7                                         🟢 AUTHORIZED
  INITIAL_BACKEND_SCOPE                    LOCAL_ONLY
  consumer cutover                         NOT YET EXECUTED
```

## Failure case

```text
C2.5                                       🛑 BLOCKED
E7                                         ⛔ BLOCKED
```

## Commit discipline

This commit (C25-C0) is doc-only. The diff budget:

```text
+1 doc  (this plan)
 0 prod
 0 test
 0 config
```

## Stash integrity

Verified at entry. Both SHA-256 fingerprints match the D3-C7
witness. No stash operations in this commit.
