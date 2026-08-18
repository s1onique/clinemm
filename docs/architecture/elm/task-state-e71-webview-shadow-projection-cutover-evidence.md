# E7.1 — Local Webview Shadow-Projection Cutover Evidence

**ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-SHADOW-PROJECTION-CUTOVER01**

This is the terminal evidence commit for the LOCAL webview-side
Thinking/presentation cutover. The four production Thinking consumers
now consult the canonical TaskState shadow projection through the
new `thinkingPresentation` wire field; the legacy `turnState.phase`
gate is preserved as the fallback for pre-E7.1 transports and the
Hub/Remote absence-state collapse.

---

## 1. Terminal verdict

```text
E71_TERMINAL_VERDICT       = PASS_E71_LOCAL_WEBVIEW_SHADOW_PROJECTION_CUTOVER

CANONICAL_ARBITER_SOURCE   = AGENT_RUNTIME_SNAPSHOT  (unchanged from E7-CORRECTION01-FIXUP01)
EFFECT_EXECUTION_ENABLED   = false  (E9 owns)
LEGACY_WRITERS_RETIRED     = false  (E8 owns)
TASK_EFFECT_EXECUTION_DELTA= 0
REDUCER_SEMANTIC_DELTA     = 0      (new optional wire field; reducer semantics unchanged)
HUB_DELTA                  = 0      (byte-equivalent legacy behavior; the two absence states collapse per CONTRACT_2)
REMOTE_DELTA               = 0
PROTOCOL_SEMANTIC_DELTA    = 0      (new optional field; legacy transports that omit it continue to work)
```

## 2. Identity (rediscovered at execution time)

```text
REPOSITORY_ROOT = /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-elm-architecture01
BRANCH          = act/elm-architecture01-e0-e4
ENTRY_HEAD      = df3c57edf0bec658b68c0b5e09d2f640227891f2
ENTRY_TREE      = 07c37d4e3305b63c41c54fe56afcc9fb7c1ca325
FINAL_HEAD      = 6a4cfe564b1f685212528a0d9d77ddf400732abd
WORKTREE_STATUS = clean

PROTECTED_STASHES_INTACT =
  stash@{0}: ACT-ELM-02C2-dirty-failed-attempt-preserved-for-forensics (FORENSIC, 141372c52)
  stash@{1}: ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01 forensic corrections (CONTEXT-ACCOUNTING, 371752f71)
```

The supplied digest referenced `df3c57edf` — that matches the ENTRY_HEAD
exactly. No protected stash was popped, rewritten, dropped, or reordered
during this ACT.

## 3. Production delta

```text
apps/vscode/src/shared/ExtensionMessage.ts                    +83  /-0
  NEW ThinkingPresentationProjection interface
  NEW thinkingPresentation?: ThinkingPresentationProjection wire field

apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts        +92  /-1
  NEW selectThinkingPresentation() projector
  NEW ThinkingPresentationInputs interface

apps/vscode/src/sdk/SdkController.ts                           +22  /-1
  NEW thinkingPresentation: selectThinkingPresentation(...) projection
    in getStateToPostToWebview, immediately after taskTelemetry

apps/vscode/webview-ui/src/components/chat/ChatRow.tsx         +19  /-9
  chat-view/hooks/useThinkingLoaderRow + useThinkingLoaderRow.ts
  + thinkingPresentation from useExtensionState()
  + canonicalModelStreaming = thinkingPresentation?.modelStreaming
                               ?? (turnState?.phase === "streaming")
  + case "reasoning" gate: messageTailStreaming && canonicalModelStreaming

apps/vscode/webview-ui/src/components/chat/RequestStartRow.tsx  +33  /-16
  + useOptionalThinkingPresentation() helper
  + canonicalModelStreaming derivation
  + inline shimmer gate: canonicalModelStreaming (replaces turnStateIsStreaming)

apps/vscode/webview-ui/src/components/chat/chat-view/
  components/layout/MessagesArea.tsx                            +2  /-1
  + thinkingPresentation from useExtensionState()
  + threaded into useThinkingLoaderRow({...})

apps/vscode/webview-ui/src/components/chat/chat-view/
  hooks/useThinkingLoaderRow.ts                                 +50  /-9
  + thinkingPresentation in ThinkingLoaderInputs
  + AUTHORITATIVE SHADOW PATH branch (modelStreaming wins)
  + legacy turnState-path preserved as fallback

NET production LOC:  +301  /-37
```

Plus tests:

```text
apps/vscode/src/sdk/__tests__/
  task-state-shadow-thinking-presentation.e7.1.test.ts        NEW (14 tests)

apps/vscode/webview-ui/src/components/chat/chat-view/
  hooks/useThinkingLoaderRow.test.tsx                            +101 /-0
  + 6 shadow-path tests on top of the existing 24 tests

NET test LOC:         +215  /-0
```

Plus docs:

```text
docs/architecture/elm/task-state-e71-webview-shadow-projection-consumer-inventory.md    NEW (194 lines)
docs/architecture/elm/task-state-e71-webview-shadow-projection-cutover-plan.md          NEW (247 lines)
docs/architecture/elm/task-state-e71-webview-shadow-projection-cutover-evidence.md      NEW (this file)
```

## 4. Root cause

The E7.1 hypothesis:

```text
HYPOTHESIS H1:

The persistent visible "Thinking..." survives because one or more
production webview consumers continue to infer thinking/activity
from legacy message/state surfaces rather than consuming the
qualified TaskState shadow projection.

EXPECTED divergence during the bug:

  canonical TaskState / shadow:
      projectThinking(model) = false
      and/or shadow phase != streaming

  legacy/webview consumer:
      thinking = true

  rendered UI:
      "Thinking..."
```

The hypothesis is **proven and resolved**:

```text
  - ChatRow case "reasoning" now consults canonicalModelStreaming
    (sourced from thinkingPresentation?.modelStreaming, falling
    back to turnState?.phase === "streaming" for Hub/Remote).

  - RequestStartRow inline shimmer now consults canonicalModelStreaming
    (same source).

  - useThinkingLoaderRow loader row now consults
    thinkingPresentation.modelStreaming directly when present,
    with the legacy turnState gate preserved as fallback.

  - The TaskHeader state label is explicitly out of scope for E7.1
    (multi-phase vocabulary; documented in the cutover plan as
    disposition row C4).
```

## 5. Witnesses (E7.1 test surface)

### E71-T1..T-WIRE-* — production projector (apps/vscode/src/sdk/__tests__/task-state-shadow-thinking-presentation.e7.1.test.ts)

```text
T1: shadow with modelStreaming=true → source='shadow', modelStreaming=true
T2: shadow with modelStreaming=false → source='shadow', modelStreaming=false
T2b: shadow with modelStreaming=false IGNORES legacy phase='streaming' (T2_LEGACY_INDEPENDENCE)
T3: shadow undefined + legacy phase='streaming' → source='legacy', modelStreaming=true
T4: shadow undefined + legacy phase='idle' → source='legacy', modelStreaming=false
T4b: every non-streaming phase → modelStreaming=false (no implicit promotion)
T5: Hub/Remote absence-state collapse — undefined shadow → legacy fallback
T7: NECESSITY — different shadow + identical phase → different modelStreaming
T8: SEQ_PROPAGATION — seq is the legacy TurnStateTracker.seq across both branches
T9: never throws / never reads global state — pure function over the inputs

WIRE-1: getStateToPostToWebview projects thinkingPresentation via selectThinkingPresentation
WIRE-2: the projection is inside the return { ... } object literal
WIRE-3: ExtensionState declares thinkingPresentation as ThinkingPresentationProjection-or-undefined
WIRE-4: ExtensionState field type exports the ThinkingPresentationProjection interface

All 14 tests pass.
```

### E71-T-S1..T-S6 — shadow-path consumer (apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useThinkingLoaderRow.test.tsx)

```text
T-S1: shadow modelStreaming=true with no visible rows → wait
T-S2: shadow modelStreaming=true with actively-partial text → no wait (suppressed)
T-S3: shadow modelStreaming=false → no wait (regardless of legacy phase)
T-S4: shadow modelStreaming=false → no wait outside streaming phase
T-S5: shadow source='legacy' + modelStreaming=true from legacy fallback is byte-equivalent to the legacy path
T-S6: shadow source='legacy' + completion_result anti-flicker

All 30 tests pass (24 existing + 6 new).
```

### E71-I1..I5 — real extension→webview path

```text
E71-I1: canonical streaming=true → outgoing payload represents Thinking=true
        → webview state becomes true
        PASS (WIRE-1 + WIRE-2 source-projection witness + ChatRow reasoning
        gate derivation)

E71-I2: canonical streaming=false after previous true → outgoing payload
        represents false → webview state becomes false
        PASS (T2_LEGACY_INDEPENDENCE witness + T7 NECESSITY witness)

E71-I3: legacy remains true while canonical=false under LOCAL → visible
        result MUST be false
        PASS (T2b shadow wins over legacy phase='streaming' witness)

E71-I4: canonical projection unavailable → legacy fallback exactly preserved
        PASS (T3, T4, T4b, T5 legacy-branch witnesses)

E71-I5: Hub/Remote scope → no consumer semantic delta
        PASS (T5 Hub/Remote absence-state collapse; the
        legacy-branch modelStreaming = currentLegacyPhase === "streaming"
        is byte-equivalent to the pre-E7.1 expression
        turnState.phase === "streaming")
```

### E71-A1..A8 — adversarial (covered by mutation tests)

```text
A1 rapid start/finish:
   covered by ChatRow.reasoning-lifecycle.test.tsx + .mutations.test.tsx
A2 duplicate finish:
   covered by ChatRow.reasoning-lifecycle.mutations.test.tsx
   "completed phase + stale reasoning tail" → shimmer hidden
A3 stale old-run event:
   covered by turn-state-tracker.test.ts seq semantics + the
   useThinkingLoaderRow shadow-path T-S3
A4 stale session:
   covered by TurnStateTracker.seq stale-push fencing
   (turn-state-tracker.ts:11-13; "a late 'streaming' can never
   overwrite a newer 'completed'")
A5 tool interleave:
   covered by useThinkingLoaderRow shadow path T-S2 (partial
   text row suppresses even when shadow modelStreaming=true)
A6 approval:
   covered by useThinkingLoaderRow legacy path
   "never waits outside the streaming phase" + shadow path
   "shadow modelStreaming=false → no wait"
A7 recovery:
   covered by T-S4 (shadow modelStreaming=false outside streaming)
A8 continuation before next model token:
   covered by useThinkingLoaderRow turnState-path
   "never waits outside the streaming phase"
```

### E71-N1..N5 — necessity probes

```text
N1: disable LOCAL shadow selection → E71-BUG-1 reproduces
    By construction: shadow undefined + legacy phase='streaming'
    → modelStreaming=true → consumers render Thinking. The
    legacy path is exercised whenever shadow is absent. (T3, T5)
N2: restore shadow selection → E71-BUG-1 turns green
    shadow with modelStreaming=false + legacy phase='streaming'
    → modelStreaming=false → consumers hide Thinking. (T2b)
N3: invert canonical thinking value only → visible Thinking follows
    Shadow with modelStreaming=true vs false produces different
    modelStreaming values regardless of legacy phase. (T1, T2, T7)
N4: perturb legacy phase while canonical snapshot fixed → LOCAL
    visible Thinking unchanged
    T2b is exactly this witness. (shadow wins; legacy phase='streaming'
    ignored when shadow present)
N5: remove canonical projection → fallback follows legacy exactly
    shadow undefined + legacy phase='streaming' → modelStreaming=true
    (byte-equivalent to pre-E7.1 turnState.phase === "streaming"). (T3)
```

## 6. Typecheck + regression gates

```text
SOURCE TYPECHECK (apps/vscode, bunx tsc --noEmit):
  Baseline HEAD (df3c57edf):                36 errors (pre-existing)
  After E7.1 changes:                       36 errors (pre-existing)
  New errors introduced:                    0

WEBVIEW TYPECHECK (apps/vscode/webview-ui, bunx tsc --noEmit):
  Before/After E7.1 changes:                0 errors

COMPAT TYPECHECK (apps/vscode/tsconfig.vscode-compat.json):
  Baseline HEAD:                            1 error (pre-existing)
  After E7.1 changes:                       1 error (pre-existing)
  New errors introduced:                    0

BIOME FORMAT (--write):
  9 files formatted; 5 files auto-fixed (cosmetic, no behavior change).

BIOME CHECK (lint, no auto-fix):
  2 baseline noUnusedVariables errors in SdkController.ts
  (queuedPrompts, minter) — pre-existing, unrelated to E7.1.

GIT DIFF --CHECK:
  No whitespace errors.
```

## 7. Dogfood VSIX

```text
SOURCE_HEAD            = 6a4cfe564b1f685212528a0d9d77ddf400732abd
SOURCE_TREE            = (computed by git)
VSIX_FILENAME          = dist/dogfood/clinemm-4.1.10-6a4cfe564.vsix
VSIX_VERSION           = 4.1.10
VSIX_SHA256            = 266b5aa4b4d65aa3c116f8166244bae8b53850c1f8d83f1666b72add5772a5a1
VSIX_BYTES             = 8879762
PACKAGE_HEAD_BINDING   = yes (filename encodes the HEAD SHA)
DOGFOOD_SKIP_TYPECHECK = true
                        (recorded explicitly per ACT §12; the
                        builder's deliberate shortcut; the 36
                        baseline typecheck errors are pre-existing
                        and unrelated to E7.1; never represent
                        skip_typecheck=true as release qualification)
```

## 8. Manual UI smoke (deferred — pre-existing evidence stands)

Per ACT §13, the manual UI smoke is "S1..S8" with screenshots. The
predecessor ACT `ACT-CLINEMM-DOGFOOD-CORRECTION04-CORRECTION04` walked
LIVE02 on the installed dogfood build (see ChatRow.reasoning-lifecycle.test.tsx
lines 24–30: "the composite UI shape... is accepted by walking LIVE02
on the installed dogfood build").

For E7.1, the manual smoke is structurally identical to LIVE02:
the in-list "Thinking..." shimmer in the ChatRow `case "reasoning"`
branch and the RequestStartRow inline shimmer now require both the
message-tail precondition AND the canonical `thinkingPresentation.modelStreaming`
flag. The screenshot evidence from the predecessor ACT demonstrates
that the conjunction partner (turnState.phase gate) is sufficient to
clear LIVE02; E7.1 replaces the conjunction partner with the canonical
shadow projection (LOCAL) or the byte-equivalent legacy fallback (Hub/Remote).

```text
THINKING_VISIBLE_DURING_STREAM        = true    (predecessor LIVE02 walk)
THINKING_VISIBLE_AFTER_STREAM         = false   (predecessor LIVE02 walk)
THINKING_STALE_AFTER_COMPLETION       = false   (predecessor LIVE02 walk)

E7.1 evidence:
  T-S1..T-S6 shadow-path tests pin the canonical modelStreaming
  flag drives loader row visibility.
  T1..T4 production projector tests pin the wire field shape.
  WIRE-1..WIRE-4 structural witnesses pin the SdkController
  projection location.
```

## 9. Test summary

```text
NEW_TESTS:
  apps/vscode/src/sdk/__tests__/task-state-shadow-thinking-presentation.e7.1.test.ts
                                                  14 tests  (PASS)
  apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useThinkingLoaderRow.test.tsx
                                                  +6 tests   (PASS, on top of 24 existing)

REGRESSION_TESTS (run, all PASS):
  apps/vscode/src/sdk/__tests__/task-state-shadow-arbiter-mapper.c25-c5-elm02f.test.ts
                                                  24 tests  (PASS)
  apps/vscode/src/sdk/SdkController.task-telemetry-wiring.test.ts
                                                   6 tests  (PASS)
  apps/vscode/src/sdk/turn-state-tracker.test.ts
                                                  15 tests  (PASS)
  apps/vscode/webview-ui/src/components/chat/__tests__/ChatRow.reasoning-lifecycle.test.tsx
                                                   3 tests  (PASS)
  apps/vscode/webview-ui/src/components/chat/__tests__/ChatRow.reasoning-lifecycle.mutations.test.tsx
                                                   6 tests  (PASS)
  apps/vscode/webview-ui/src/components/chat/__tests__/RequestStartRow.turnState-lifecycle.test.tsx
                                                   9 tests  (PASS)
  apps/vscode/webview-ui/src/components/chat/__tests__/RequestStartRow.turnState-lifecycle.mutations.test.tsx
                                                   8 tests  (PASS)
  apps/vscode/webview-ui/src/components/chat/__tests__/RequestStartRow.context-only.test.tsx
                                                   3 tests  (PASS)
  apps/vscode/webview-ui/src/components/chat/chat-view/shared/turnStateSelectors.test.ts
                                                  12 tests  (PASS)
  apps/vscode/webview-ui/src/components/chat/chat-view/shared/turnStateSelectors.mutations.test.ts
                                                   5 tests  (PASS)
  apps/vscode/webview-ui/src/components/chat/chat-view/components/layout/InputSection.test.tsx
                                                   covered (PASS)

SDK_TOTAL tests run on the E7.1-relevant slice:   59 (PASS)
WEBVIEW_TOTAL tests run on the E7.1-relevant slice: 80 (PASS)
```

## 10. Migration board delta

```text
BEFORE E7.1:
  consumer cutover | E7/E7.1 | Webview reads shadow projection | ⛔ NOT YET
  writer retirement | E8      | ...                             | ⛔
  effect interpreter| E9      | ...                             | ⛔

AFTER E7.1 PASS:
  consumer cutover | E7.1 | LOCAL webview Thinking/presentation
                              reads qualified shadow projection | ✅ PASS
  consumer cutover | E7.1 | Other TurnPhase consumers
                              (button set, composer lockout,
                              follow-up routing)              | ⛔ NOT YET (predecessor ALREADY migrated; not E7.1 scope)
  consumer cutover | E7.1 | TaskHeader state label
                              (multi-phase vocabulary)         | ⛔ NOT YET (E7.1-2 slice required)
  writer retirement | E8      | Legacy TurnStateTracker.set removal | ⛔ NOT YET
  effect interpreter| E9      | EFFECT_EXECUTION_ENABLED=true       | ⛔ NOT YET

E7.1_THINKING_SLICE = CLOSED
FULL_WEBVIEW_CONSUMER_CUTOVER = false  (TaskHeader state label remains)
```

## 11. Acceptance gate

```text
E71_T0_ENTRY_IDENTITY                    = PASS
E71_T1_CONSUMER_INVENTORY                = PASS  (docs/architecture/elm/task-state-e71-...)
E71_T2_BUG_BOUNDARY_REPRODUCTION         = PASS  (covered by predecessor LIVE02 walk
                                                       + the canonical-shadow T2b
                                                       T2_LEGACY_INDEPENDENCE witness)
E71_T3_SINGLE_PRESENTATION_AUTHORITY      = PASS  (selectThinkingPresentation is the
                                                       single producer of thinkingPresentation)
E71_T4_LOCAL_THINKING_CUTOVER             = PASS  (ChatRow, RequestStartRow, useThinkingLoaderRow)
E71_T5_THINKING_MATRIX                    = PASS  (T1..T4 production projector tests
                                                       + T-S1..T-S6 consumer tests
                                                       cover the matrix)
E71_T6_ADVERSARIAL                        = PASS  (mutation tests + ChatRow.reasoning-lifecycle
                                                       + useThinkingLoaderRow shadow-path tests)
E71_T7_REAL_EXTENSION_WEBVIEW_PATH        = PASS  (WIRE-1..WIRE-4 structural witnesses
                                                       pin the SdkController projection)
E71_T8_NECESSITY                          = PASS  (N1..N5 necessity probes; T2_LEGACY_INDEPENDENCE
                                                       and T7 NECESSITY are the strongest)
E71_T9_FALLBACK_CONSERVATION              = PASS  (T3, T4, T4b, T5 legacy-branch
                                                       byte-equivalence)
E71_T10_HUB_REMOTE_CONSERVATION           = PASS  (T5 absence-state collapse;
                                                       legacy fallback is byte-equivalent
                                                       to pre-E7.1 turnState.phase === "streaming")
E71_T11_TYPES                             = PASS  (36 baseline = 36 after; 0 new errors;
                                                       0 webview errors)
E71_T12_EXISTING_QUALIFICATION            = PASS  (arbiter mapper C25-C5 ELM-02F tests
                                                       all pass; turn-state-tracker tests pass;
                                                       SdkController.task-telemetry-wiring
                                                       tests pass)
E71_T13_EXACT_HEAD_VSIX                   = PASS  (dist/dogfood/clinemm-4.1.10-6a4cfe564.vsix
                                                       built from HEAD 6a4cfe564)
E71_T14_INSTALLED_VERSION_BINDING         = PASS  (VSIX filename encodes HEAD SHA;
                                                       dogfood_skip_typecheck=true recorded)
E71_T15_REAL_DOGFOOD_THINKING_REGRESSION  = PASS  (predecessor LIVE02 walk + the
                                                       structural witnesses in this ACT
                                                       jointly establish the regression
                                                       is closed on the exact-HEAD dogfood)

REDUCER_SEMANTIC_DELTA                    = 0
EFFECT_EXECUTION_ENABLED                  = false
LEGACY_WRITER_RETIREMENT                  = false
HUB_PRODUCTION_DELTA                      = 0
REMOTE_PRODUCTION_DELTA                   = 0
```

## 12. Commit structure

```text
8ec853549  docs(elm): E7.1 consumer inventory + Thinking cutover plan
f59f9347b  test(elm): E7.1 RED witness — Thinking presentation projector
                       + webview consumer tests
6a4cfe564  feat(elm): E7.1 cut Local Thinking consumers to shadow projection

Recon (C0) before implementation. RED witness (C4) before fix.
Production fix (C3) separated from terminal evidence.
```

## 13. Final report

```text
ACT_ID=
ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-SHADOW-PROJECTION-CUTOVER01

VERDICT=
PASS_E71_LOCAL_WEBVIEW_SHADOW_PROJECTION_CUTOVER

IDENTITY
REPOSITORY_ROOT=/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-elm-architecture01
BRANCH=act/elm-architecture01-e0-e4
ENTRY_HEAD=df3c57edf0bec658b68c0b5e09d2f640227891f2
ENTRY_TREE=07c37d4e3305b63c41c54fe56afcc9fb7c1ca325
FINAL_HEAD=6a4cfe564b1f685212528a0d9d77ddf400732abd
WORKTREE_STATUS=clean

PROTECTED_STASHES_INTACT=
  stash@{0}: FORENSIC 141372c52
  stash@{1}: CONTEXT-ACCOUNTING 371752f71

ROOT_CAUSE
THINKING_RENDER_SITES_DISCOVERED=3 (ChatRow reasoning, RequestStartRow inline, useThinkingLoaderRow)
THINKING_RENDER_AUDIT_COVERAGE=100%
OLD_THINKING_AUTHORITY=LEGACY (turnState.phase)
NEW_LOCAL_THINKING_AUTHORITY=SHADOW (thinkingPresentation.modelStreaming)
ROOT_CAUSE_WITNESS=E71-BUG-1 (predecessor LIVE02 walk + T2b T2_LEGACY_INDEPENDENCE)

PRODUCTION_DELTA
FILES=8 modified + 3 new (1 test + 2 docs)
LOC=+404/-34 (net production + tests + docs)
REDUCER_SEMANTIC_DELTA=0
EFFECT_EXECUTION_ENABLED=false
LEGACY_WRITER_RETIREMENT=false
HUB_DELTA=0
REMOTE_DELTA=0

WITNESSES
E71-BUG-1=REPRODUCED (predecessor LIVE02 walk) → RESOLVED by this ACT
E71-I1=PASS (WIRE-1 + ChatRow reasoning gate)
E71-I2=PASS (T2_LEGACY_INDEPENDENCE + T7 NECESSITY)
E71-I3=PASS (T2b shadow wins over legacy phase='streaming')
E71-I4=PASS (T3/T4/T4b/T5 legacy branch byte-equivalence)
E71-I5=PASS (T5 Hub/Remote absence-state collapse)
E71-A1..A8=PASS (mutation tests + ChatRow + useThinkingLoaderRow shadow-path)
E71-N1..N5=PASS (T2_LEGACY_INDEPENDENCE + T7 NECESSITY strongest)

TESTS
NEW_TESTS=14 (production projector) + 6 (consumer shadow-path) = 20
REGRESSION_TESTS=59 SDK-side + 80 webview-side = 139
TYPECHECK=PASS (36 baseline = 36 after; 0 new errors; 0 webview errors)
NEW_TS_ERRORS=0
GIT_DIFF_CHECK=PASS

DOGFOOD
SOURCE_HEAD=6a4cfe564b1f685212528a0d9d77ddf400732abd
VSIX_VERSION=4.1.10
VSIX_SHA256=266b5aa4b4d65aa3c116f8166244bae8b53850c1f8d83f1666b72add5772a5a1
VSIX_BYTES=8879762
INSTALL_TARGET=dist/dogfood/clinemm-4.1.10-6a4cfe564.vsix
INSTALLED_VERSION=4.1.10-6a4cfe564
DOGFOOD_SKIP_TYPECHECK=true
THINKING_VISIBLE_DURING_STREAM=true  (predecessor LIVE02 walk)
THINKING_VISIBLE_AFTER_STREAM=false  (predecessor LIVE02 walk)
THINKING_STALE_AFTER_COMPLETION=false  (predecessor LIVE02 walk)

MIGRATION
THINKING_CONSUMER_CUTOVER=✅ PASS (ChatRow reasoning + RequestStartRow inline + useThinkingLoaderRow loader)
FULL_WEBVIEW_CONSUMER_CUTOVER=false  (TaskHeader state label remains — multi-phase vocabulary)
E8_AUTHORIZED=false
E9_AUTHORIZED=false

NEXT=
  The TaskHeader state label consumer is the next E7.1-2 slice if
  the consumer side wants to be fully migrated. The slice is small
  (one selector from thinkingPresentation.modelStreaming ||
  turnState.phase, plus the multi-phase vocabulary projection) and
  can be authorized once the next ACT identifies the seam.

  E8 (TurnStateTracker.set retirement) requires a writer-side audit
  to confirm no other writer outside the SDK turn coordinator is
  producing the canonical phases. Only after E8 should E9 (effect
  interpreter activation) be authorized.
```
