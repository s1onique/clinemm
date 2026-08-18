# ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-POST-TERMINAL-AUTHORITY-SPLIT-C2-CORRECTION02-RAW-INCOMING-TRUTH

**ACT_ID**

```text
ACT-CLINEMM-ELM-ARCHITECTURE01-
E7.1-POST-TERMINAL-AUTHORITY-SPLIT-
C2-CORRECTION02-RAW-INCOMING-TRUTH
```

## 0. Factory hard rule

```text
THE CORRELATED bc2c794be LIVE TRACE IS EVIDENCE OF SELECTIVE
TURNSTATE STALENESS, NOT PROOF OF WHERE THAT STALENESS IS CREATED.

DO NOT MODIFY TURNSTATE BEHAVIOR UNTIL THE SAME _ptadPushId SHOWS:

  EITHER

    extension.current != rawIncoming
    rawIncoming == applied

  OR

    extension.current == rawIncoming
    rawIncoming != applied

THE FIRST PROVEN UNEQUAL EDGE OWNS THE REPAIR.

STATIC THINKING AND FOLLOW-UP ROUTING ARE DOWNSTREAM OBSERVATIONS
AND MUST NOT BE PATCHED IN THIS ACT.
```

## 1. Entry identity (frozen at execution start)

```text
REPOSITORY_ROOT  = /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-elm-architecture01
BRANCH           = act/elm-architecture01-e0-e4
ENTRY_HEAD       = 2f1a9999b4542a2cbbb7a671999390f1dba0d7c9
ENTRY_TREE       = <see git rev-parse HEAD^{tree}>
ORIGIN_MAIN      = 6fe6218a297b7214f476f32dfc89b725c4a7f826
WORKTREE_STATUS  = clean (no untracked, no modified, no staged)

PROTECTED_STASH_FORENSIC_OID        = 141372c52   (intact)
PROTECTED_STASH_CONTEXT_ACCOUNTING  = 371752f71   (intact)

C1-CORRECTION02_HEAD   = dfab15b3f962ff06a852fda07bcbbeaa6bfa56ff
C2R_IMPLEMENTATION_HEAD = bc2c794be39863dbc2afeaa48c8be6eccf793fd0
C2R_CLOSURE_HEAD        = 2f1a9999b4542a2cbbb7a671999390f1dba0d7c9

LIVE_DIAGNOSTIC_VSIX         = 4.1.10-bc2c794be
LIVE_DIAGNOSTIC_VSIX_SHA256  = f8d26c2aa8667be5229d9f7ab11b30181d42c96e608f7c23f2e1c0f9d5fac16e
LIVE_DIAGNOSTIC_VSIX_BYTES   = 8,882,783

UNTRACKED_EXEMPT  = .clinerules/sdk-transport-integration.md (the one exempt file from
                    the elm-architecture01 ACT history; size 8150 bytes, mtime Aug 18 22:22)
HALT_UNEXPECTED_DIRTY_WORK = not applicable (worktree clean apart from the exempt file)
```

## 2. Live dogfood visual state (frozen)

```text
VISIBLE_HEADER_STATE         = Idle
VISIBLE_TIMER                = 00:00
VISIBLE_TOOL_COUNT           = 0
ANSWER_COMPLETED             = true
STATIC_THINKING_VISIBLE      = true
COMPOSER_TEXT_ENTRY_WORKS    = true
FOLLOWUP_SEND_WORKS          = false
```

## 3. Correlated machine result (frozen)

```text
extension-push(P):
  turnState.phase = awaiting_followup
  turnState.seq   = 15  (current)
  thinkingPresentation.modelStreaming = false

webview-replica(P):
  turnState.phase = idle
  turnState.seq   = 2  (stale)
  thinkingPresentation.modelStreaming = false (current)

INPUT_SECTION:
  sendingDisabled      = false
  allowQueuedSubmit    = false
  submitDisabled       = false

ACTION_BUTTONS:
  buttonConfig.sendingDisabled = false
  buttonConfig.enableButtons   = false

FOLLOWUP_ROUTE:
  canSubmit                 = false
  route                     = clineAsk.turnAllowsFollowup.blocked:idle
  pendingResponsePresent    = true
  pendingUserMessagePresent = false
```

## 4. Disposition (frozen)

```text
A_BUTTON_AUTHORITY_STUCK        = REJECTED
I_CHAT_REDUCER_LOCK             = REJECTED
G_FOLLOWUP_ROUTE                = CONFIRMED
C_STATIC_THINKING               = CONFIRMED

E_SELECTIVE_TURNSTATE_STALENESS = CONFIRMED
E_EXACT_SUBBOUNDARY             = UNKNOWN

F_APPLYTURNSTATE_ALGORITHM      = REJECTED  (C2R prior ACT isolated-replay PASS)
```

## 5. Authority graph (frozen)

```text
SdkController.getStateToPostToWebview()  (apps/vscode/src/sdk/SdkController.ts:2649)
   snapshot = { ..., turnState: this.turnStateTracker.get(), taskTelemetry,
                thinkingPresentation, _ptadEnabled, _ptadPushId, ... }
   recordPostTerminalAuthoritySnapshot(extension-side, captureKind="extension-push")
        │
        ▼
subscribeToState.sendStateUpdate()  (apps/vscode/src/core/controller/state/subscribeToState.ts:61)
   stateJson = JSON.stringify(state)
        │
        │  asynchronous VS Code webview boundary
        ▼
StateServiceClient.subscribeToState.onResponse  (ExtensionStateContext.tsx:507)
   stateData = JSON.parse(response.stateJson) as ExtensionState   <-- raw incoming payload
        │
        ▼
setState((prevState) => {
   replicaRef.current = reducerApplyStateSnapshot(replicaRef.current,
       stateData.clineMessages ?? [], stateData.epoch ?? 0,
       stateData.stateVersion ?? 0, stateData.turnState)          <-- W2 boundary candidate
   stateData.clineMessages = replicaRef.current.messages
   stateData.turnState    = replicaRef.current.turnState           <-- raw turnState overwritten
   newState = { ...stateData, autoApprovalSettings: ... }
   recordPostTerminalAuthoritySnapshot(buildWebviewSnapshot(newState, stateData, "webview-replica"))
        │
        ▼
React context consumers
   ├── InputSection  (captures "input-section")
   ├── ActionButtons (captures "action-buttons")
   ├── ChatRow / TaskHeader
   └── useMessageHandlers (captures "followup-route" via turnAllowsFollowup)
```

Forensic observation: the current `webview-replica` capture reads from `newState`,
NOT from `stateData`. After `stateData.turnState = replicaRef.current.turnState`
(line 546), the raw incoming turnState is no longer observable on `stateData`.
The schema cannot distinguish raw incoming from applied until this ACT adds
the explicit `rawIncoming*` aliases.

## 6. Phase plan

### C0 — source recon (completed)

- See §5 above. Single composition site identified.
- The `webview-replica` record currently captures from `newState` (post-reducer).
- The raw `stateData` (pre-reducer) turnState is overwritten in place at line 546
  and is not directly observable from the current schema.

Coverage gate:

```text
EXTENSION_STATE_POST_SITES_DISCOVERED = 1
EXTENSION_STATE_POST_SITES_AUDITED    = 1
EXTENSION_POST_COVERAGE               = 100%

WEBVIEW_STATE_RECEIVE_SITES_DISCOVERED = 1
WEBVIEW_STATE_RECEIVE_SITES_AUDITED    = 1
WEBVIEW_RECEIVE_COVERAGE               = 100%

TURNSTATE_WRITE_SITES_DISCOVERED = 1   (ExtensionStateContext.tsx:546)
TURNSTATE_WRITE_SITES_AUDITED    = 1
TURNSTATE_WRITE_COVERAGE         = 100%

UNRESOLVED_STATE_PATHS           = 0
```

### C1 — add RAW-INCOMING truth

Extend the `PostTerminalAuthorityCaptureKind` union with `webview-raw-incoming`.

Add new raw fields (additive aliases, do NOT silently re-purpose existing fields):

```ts
// on the raw record:
readonly rawIncomingLegacyPhase?: TurnPhase
readonly rawIncomingLegacySeq?: number
readonly rawIncomingThinkingPresentation?: ThinkingPresentationProjection
readonly rawIncomingTaskTelemetry?: TaskHeaderTelemetryStrip

// on the applied record (explicit rename, additive):
readonly appliedLegacyPhase?: TurnPhase
readonly appliedLegacySeq?: number
// legacyPhase / legacySeq remain as today (post-reducer view, for
// compatibility with all the existing C2R tests that read them as the
// post-reducer applied view).
```

Single capture site rule:

```text
stateData
   ↓
capture RAW (captureKind="webview-raw-incoming")
   ↓
reducerApplyStateSnapshot + stateData.turnState overwrite
   ↓
newState
   ↓
capture APPLIED (captureKind="webview-replica")
```

Both records carry the same `_ptadPushId`. The webview NEVER mints a replacement.

### C2 — RED tests (diagnostic classification helper)

```text
W1 corruption-before-reducer:   raw != extension, applied == raw
W2 corruption-during-reducer:   raw == extension, applied != raw
W3 healthy:                     raw == extension, applied == extension
W4 three-way mismatch:          raw != extension, raw != applied
```

A pure classifier helper is acceptable:

```ts
type BoundaryClass =
  | "NO_DIVERGENCE"
  | "W1_PRE_APPLY"
  | "W2_DURING_APPLY"
  | "W3_POST_CONTEXT"
  | "W4_MULTI_BOUNDARY"

function classifyBoundary(ext, raw, applied): BoundaryClass { ... }
```

### C3 — exact correlation invariants

```text
extension-push(P)        = exactly 1
webview-raw-incoming(P)  = exactly 1
webview-replica(P)       = exactly 1
```

### C4 — source-level replay at the discovered boundary

Add a production-shaped composition test. The new test must drive the actual
`setState` composition site (or its nearest extractable helper) and verify
that for the live E1-E9 sequence, the `webview-raw-incoming` capture records
the extension's `awaiting_followup/seq15` value while the `webview-replica`
record records the same (because the reducer is correct).

### C5 — causal classification

```text
W1 → CAUSE_CLASS = PRE_APPLY_STATE_SHAPING_OR_DELIVERY
W2 → CAUSE_CLASS = REAL_COMPOSED_APPLY_PATH
W3 → CAUSE_CLASS = POST_CONTEXT_CONSUMER_OR_MEMOIZATION  (HALT, consumer ACT)
W4 → CAUSE_CLASS = MULTI_BOUNDARY                        (HALT, replan)
```

### C6 — repair only if boundary proven

Repair scope is exactly the proven boundary. Forbidden:

```text
NO TaskState reducer change
NO AgentRuntime change
NO LocalRuntimeHost change
NO Hub/Remote change
NO protocol semantic change
NO static Thinking fix
NO follow-up routing fix
NO sendingDisabled fix
NO TaskHeader migration
NO E8
NO E9
```

### C7 — regression matrix

```text
PTAD shared-schema tests
PTAD runtime tests
PTAD wiring tests
C2R previous replay tests (frozen, do not rewrite)
NEW raw/applied correlation tests
ExtensionStateContext tests
E7.1 Thinking projection tests
C-REAL bridge tests
C25 relevant classifier/robustness tests
```

Hard gates: NEW_TS_ERRORS = 0, BIOME = PASS, git diff --check = PASS,
PROTECTED_STASHES_INTACT = true.

### C8 — exact-HEAD VSIX

Build only after the diagnostic and any proven repair are committed.

### C9 — live dogfood

Use exactly one task: `Say hello and stop`, then one follow-up attempt `Try again`.
Do NOT reload between them.

Capture M0-M6 and the live binary boundary table.

## 7. Acceptance matrix

```text
C2C2_T0  ENTRY_IDENTITY                         PASS
C2C2_T1  bc2c794be_LIVE_TRACE_FROZEN           PASS
C2C2_T2  SOURCE_PATH_RECON                      PASS
C2C2_T3  POST_SITE_COVERAGE                     100%
C2C2_T4  RECEIVE_SITE_COVERAGE                  100%
C2C2_T5  TURNSTATE_WRITE_COVERAGE               100%

C2C2_T6  PTAD_RAW_CAPTURE                       PASS
C2C2_T7  PTAD_APPLIED_CAPTURE                   PASS
C2C2_T8  PUSH_ID_3WAY_CORRELATION               PASS
C2C2_T9  CAPTURE_CARDINALITY                    PASS

C2C2_T10 PRODUCTION_COMPOSITION_REPLAY          PASS
C2C2_T11 FIRST_UNEQUAL_EDGE                     IDENTIFIED
C2C2_T12 CAUSE_CLASS                            W1|W2|W3|W4|NO_DIVERGENCE

C2C2_T13 NECESSITY                              PASS if repair
C2C2_T14 REPAIR_MINIMALITY                      PASS if repair
C2C2_T15 CONSERVATION                           PASS if repair

C2C2_T16 EXISTING_QUALIFICATION                 PASS
C2C2_T17 TYPES                                  PASS
C2C2_T18 PATCH_HYGIENE                          PASS
C2C2_T19 EXACT_HEAD_VSIX                        PASS
C2C2_T20 INSTALLED_VERSION_BINDING              PASS
C2C2_T21 REAL_DOGFOOD_RAW_TRUTH                 PASS
C2C2_T22 COMPOSER_OBSERVATION                   COMPLETE
C2C2_T23 THINKING_OBSERVATION                   COMPLETE
C2C2_T24 PROTECTED_STASHES                      PASS
```

## 8. Allowed terminal verdicts

```text
A. PASS_C2_CORRECTION02_PRE_APPLY_STATE_TRUTH      (CAUSE_CLASS = W1_PRE_APPLY)
B. PASS_C2_CORRECTION02_APPLY_COMPOSITION_TRUTH   (CAUSE_CLASS = W2_DURING_APPLY)
C. PASS_DIAGNOSIS_ONLY                            (CAUSE_CLASS = W3_POST_CONTEXT, NEXT_ACT = consumer)
D. HALT_MULTI_BOUNDARY                            (CAUSE_CLASS = W4_MULTI_BOUNDARY)
E. PASS_NO_DIVERGENCE_CURRENT_EXACT_HEAD          (CAUSE_CLASS = NO_DIVERGENCE)
F. HALT_CAPTURE_INSUFFICIENT
```

## 9. Halt rules

```text
H1  unexpected tracked dirty work
H2  FORENSIC stash changed
H3  CONTEXT stash changed
H4  live bc2c794be evidence cannot be reconstructed
H5  _ptadPushId mismatch
H6  raw record not exactly one per state push
H7  applied record not exactly one per state push
H8  source recon reveals multiple unrelated state transports
H9  proposed repair requires TaskState reducer changes
H10 proposed repair requires AgentRuntime/SDK-core change
H11 proposed repair changes Hub/Remote semantics
H12 proposed repair touches static Thinking
H13 proposed repair touches composer routing
H14 proposed repair touches TaskHeader
H15 baseline type errors increase
H16 exact-HEAD VSIX cannot be built
H17 installed version cannot be bound
H18 live raw/applied evidence is ambiguous
```
