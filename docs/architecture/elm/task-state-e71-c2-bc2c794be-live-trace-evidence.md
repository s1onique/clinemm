# E7.1-C2 bc2c794be Live Trace Evidence Freeze

**ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-POST-TERMINAL-AUTHORITY-SPLIT-C2-CORRECTION02-RAW-INCOMING-TRUTH**

This document freezes the live `bc2c794be` trace evidence independently of
later corrections. It is the audit anchor for every claim this ACT makes
about the live state-boundary observation. The captured VSIX is the
historical evidence and is not overwritten.

---

## 1. Frozen predecessor chain

```text
C1-CORRECTION02_HEAD       = dfab15b3f962ff06a852fda07bcbbeaa6bfa56ff
LIVE_DIAGNOSTIC_VSIX       = 4.1.10-bc2c794be
LIVE_DIAGNOSTIC_VSIX_SHA   = f8d26c2aa8667be5229d9f7ab11b30181d42c96e608f7c23f2e1c0f9d5fac16e
LIVE_DIAGNOSTIC_VSIX_BYTES = 8,882,783

PROTECTED_STASH_FORENSIC   = 141372c52   (intact)
PROTECTED_STASH_CONTEXT    = 371752f71   (intact)
```

Verified at execution start of this ACT:

```text
REPOSITORY_ROOT  = /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-elm-architecture01
BRANCH           = act/elm-architecture01-e0-e4
ENTRY_HEAD       = 2f1a9999b4542a2cbbb7a671999390f1dba0d7c9  (C2R_CLOSURE_HEAD)
WORKTREE_STATUS  = clean (no untracked, no modified, no staged)

UNTRACKED_EXEMPT = .clinerules/sdk-transport-integration.md (8150 bytes, Aug 18 22:22;
                  exempt per elm-architecture01 ACT history)
```

The known untracked `.clinerules/sdk-transport-integration.md` is exempt; no
other exempt or unexpected files were present.

## 2. Frozen live C2 evidence

### 2.1 Proven live facts (from the `4.1.10-dfab15b3f` walk; frozen in
    `task-state-e71-c2-live-replica-truth-evidence.md` §2)

The reviewer ran a real installed-VSIX dogfood walk against the
`4.1.10-dfab15b3f` diagnostic build. The post-terminal authority diagnostic
(`PTAD`) was enabled and both ring buffers were dumped. The captured records
showed a mixed-generation webview state:

```text
extension truth (snapshot per push V):
  turnState.phase = awaiting_followup
  turnState.seq   = 15
  runtime.status  = completed
  shadow.status   = completed
  thinkingPresentation.modelStreaming = false

webview truth (snapshot per push V):
  turnState.phase = idle
  turnState.seq   = 2

while newer webview fields DID update on the same push:
  thinkingPresentation.seq               = 15
  thinkingPresentation.modelStreaming    = false
  taskTelemetry                           = populated
```

This is the load-bearing observation that the next ACT must explain: the
webview accepts the newer payload fields but preserves stale
`turnState={idle, seq:2}`.

### 2.2 Diagnostic counts

```text
C2_REAL_FAILURE_REPRODUCED     = true
INSTALLED_DIAGNOSTIC_VERSION   = 4.1.10-dfab15b3f (frozen predecessor)
EXTENSION_RECORDS              = 9
WEBVIEW_RECORDS                = 9
TASK_ID_ALIGNMENT              = PASS
```

### 2.3 Extension progression (frozen)

```text
E1  idle              seq=2   runtime=idle
E2  streaming         seq=4   runtime=idle
E3  streaming         seq=4   runtime=running
E4  streaming         seq=4   runtime=running/modelStreaming=true
E5  awaiting_followup seq=15  runtime=completed/shadow=completed
E6-E9  terminal-equivalent state
```

At terminal (E5):

```text
legacyPhase                 = awaiting_followup
legacySeq                   = 15
runtimeStatus               = completed
runtimeModelStreaming       = false
runtimePendingToolCount     = 0
shadowStatus                = completed
shadowModelStreaming        = false
thinkingPresentation:
  modelStreaming            = false
  seq                       = 15
  source                    = shadow
```

### 2.4 Webview progression (frozen)

```text
WEBVIEW_TURNSTATE_PHASE = idle       on all captured records
WEBVIEW_TURNSTATE_SEQ   = 2          on all captured records
```

while newer fields progressed (thinkingPresentation updated to seq=15
and modelStreaming=false; taskTelemetry populated). Therefore:

```text
WEBVIEW_MESSAGE_DELIVERY_TOTAL_FAILURE = false
```

The webview demonstrably received newer state for the same push.

### 2.5 Visual / machine correlated freeze

The `4.1.10-bc2c794be` dogfood walk (the one this ACT freezes) confirmed:

```text
VISIBLE_HEADER_STATE         = Idle
VISIBLE_TIMER                = 00:00
VISIBLE_TOOL_COUNT           = 0
ANSWER_COMPLETED             = true
STATIC_THINKING_VISIBLE      = true
COMPOSER_TEXT_ENTRY_WORKS    = true
FOLLOWUP_SEND_WORKS          = false

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

## 3. Disposition (frozen)

```text
A_BUTTON_AUTHORITY_STUCK        = REJECTED
I_CHAT_REDUCER_LOCK             = REJECTED
G_FOLLOWUP_ROUTE                = CONFIRMED
C_STATIC_THINKING               = CONFIRMED

E_SELECTIVE_TURNSTATE_STALENESS = CONFIRMED
E_EXACT_SUBBOUNDARY             = UNKNOWN  <-- what this ACT resolves

F_APPLYTURNSTATE_ALGORITHM      = REJECTED
   The C1/C2R replay
   (apps/vscode/webview-ui/src/components/chat/chat-view/__tests__/c2-replay-red.test.ts)
   passes the exact live E1-E9 sequence through the production
   applyStateSnapshot / applyTurnState reducer with stateVersion=0
   on every push:

     RED-1: idle/seq2 → streaming/seq4 advances the replica  PASS
     RED-2: idle/seq2 → awaiting_followup/seq15 advances the replica  PASS
     RED-3: equal seq, newer phase: incoming REJECTED        PASS
     RED-4: older incoming: previous retained                PASS
     RED-5: epoch boundary: new epoch + lower seq replaces   PASS
     LIVE: exact E1-E9 sequence reaches awaiting_followup/seq15  PASS
     LIVE: per-push trace — every seq advance advances the replica  PASS

   7 tests, 0 fail. The production webview reducer correctly advances
   the replica from the observed `idle/seq2` to `awaiting_followup/seq15`
   and rejects the subsequent `idle/seq2` stragglers. The defect, if real,
   lives OUTSIDE the authorized replica boundary (between the extension
   snapshot and the reducer invocation, OR between the reducer output
   and the React consumer) and requires a follow-up ACT to localize.
```

## 4. Open question this ACT must resolve

The live trace proves:
- extension current turnState = awaiting_followup / seq 15
- webview applied turnState  = idle / seq 2

But the existing schema cannot distinguish:
- W1 corruption-before-reducer:
  extension current ≠ webview raw incoming; webview raw incoming = webview applied
- W2 corruption-during-reducer:
  extension current = webview raw incoming; webview raw incoming ≠ webview applied
- W3 corruption-post-context:
  extension current = webview raw incoming = webview applied;
  but React consumer sees stale (memoization / context value mismatch)
- W4 multi-boundary:
  both raw and applied are unequal to the extension truth in independent ways

This ACT adds a new capture (`webview-raw-incoming`) BEFORE the reducer
runs, paired on the same `_ptadPushId` as the existing
`webview-replica` capture, so the next dogfood walk produces a binary
boundary decision (Phase C9).

## 5. What this ACT does NOT do

```text
- It does NOT modify turnState behavior.
- It does NOT modify the production applyStateSnapshot / applyTurnState reducer.
- It does NOT modify AgentRuntime / LocalRuntimeHost / Hub / Remote.
- It does NOT change the protocol semantics on the wire.
- It does NOT patch the static Thinking presentation.
- It does NOT patch the follow-up routing.
- It does NOT patch sendingDisabled.
- It does NOT migrate the TaskHeader.
- It does NOT open E8 or E9.
```

It adds an opt-in, diagnostic-only capture (`webview-raw-incoming`) that
records the raw `stateData` payload BEFORE the reducer mutates it. The
capture is gated on the same workspace-state PTAD toggle as the existing
`webview-replica` capture. In production (PTAD off) the new capture is
a no-op and the wire shape is byte-for-byte unchanged.

## 6. Cross-references

```text
- task-state-e71-c2-live-replica-truth-evidence.md        (C2 live trace evidence)
- task-state-e71-c2-correction01-terminal-evidence.md     (C2R closure evidence)
- task-state-e71-c2-correction02-raw-incoming-truth-plan.md (this ACT's plan)
- apps/vscode/webview-ui/src/components/chat/chat-view/__tests__/c2-replay-red.test.ts
                                                            (frozen C2R replay)
- apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx
                                                            (production composition site)
- apps/vscode/src/shared/post-terminal-authority-diagnostic.ts
                                                            (shared schema, ring buffer)
- apps/vscode/src/sdk/SdkController.ts:2649
                                                            (extension snapshot site)
- apps/vscode/src/core/controller/state/subscribeToState.ts:61
                                                            (wire serialization)
```
