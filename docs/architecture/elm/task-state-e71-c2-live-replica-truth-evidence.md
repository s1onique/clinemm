# E7.1-C2 Live Replica-Truth Evidence Freeze

**ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C2-CORRECTION01-REPLICA-TRUTH**

This document freezes the live C2 evidence observed by the reviewer against
the installed diagnostic VSIX `4.1.10-dfab15b3f` BEFORE any production
behavior change for this ACT. It is the audit anchor for every claim
this ACT makes about the webview replica/apply boundary.

---

## 1. Frozen predecessor chain

```text
C1-CORRECTION02_HEAD       = dfab15b3f962ff06a852fda07bcbbeaa6bfa56ff
LIVE_C2_DIAGNOSTIC_VSIX    = 4.1.10-dfab15b3f
ORIGINAL_RED_VSIX          = 4.1.10-6a4cfe564
PROTECTED_STASH_FORENSIC   = 141372c52   (intact)
PROTECTED_STASH_CONTEXT    = 371752f71   (intact)
```

Verified at execution start:

```text
REPOSITORY_ROOT  = /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-elm-architecture01
BRANCH           = act/elm-architecture01-e0-e4
ENTRY_HEAD       = dfab15b3f962ff06a852fda07bcbbeaa6bfa56ff
ENTRY_TREE       = 62e145d463fad00a5b881b71c07f3c5eec0cc8c5
WORKTREE_STATUS  = clean (no untracked, no modified, no staged)
```

The known untracked `.clinerules/sdk-transport-integration.md` is exempt
(see the elm-architecture01 ACT history); no other exempt or unexpected
files were present.

---

## 2. Frozen live C2 evidence

### 2.1 Proven live facts

The reviewer ran a real installed-VSIX dogfood walk against the
`4.1.10-dfab15b3f` diagnostic build (installed via
`dist/dogfood/clinemm-4.1.10-dfab15b3f.vsix`). The post-terminal
authority diagnostic (`PTAD`) was enabled and both ring buffers were
dumped. The captured records showed a **mixed-generation webview state**:

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

This is the **load-bearing observation** that the next ACT must explain:
the webview accepts the newer payload fields but preserves stale
`turnState={idle, seq:2}`.

### 2.2 Diagnostic counts

```text
C2_REAL_FAILURE_REPRODUCED     = true
INSTALLED_DIAGNOSTIC_VERSION   = 4.1.10-dfab15b3f
EXTENSION_RECORDS              = 9
WEBVIEW_RECORDS                = 9
TASK_ID_ALIGNMENT              = PASS
```

### 2.3 Extension progression

The freeze captures the exact observed sequence:

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

### 2.4 Webview progression

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

---

## 3. Frozen classification

The ACT authorizes the following partial classification without claiming
full C2 closure:

```text
ROOT_CAUSE_CLASS_PARTIAL = C + E + F

C = PRESENTATION_SEMANTICS_DEFECT
    thinkingPresentation.modelStreaming=false reached webview,
    yet static "Thinking" remained visible.

E = WEBVIEW_REPLICA_DEFECT (REPLAY HYPOTHESIS)
    extension state advanced but webview turnState did not.

F = TURNSTATE_APPLY / SEQUENCE DEFECT (REPLAY HYPOTHESIS)
    webview turnState remained idle/seq2 while incoming extension
    turnState progressed to streaming/seq4 and awaiting_followup/seq15.
```

Composer classification is held open:

```text
COMPOSER_SUBCLASS = A | I | G | downstream unresolved
```

PTAD correlation defect:

```text
PTAD_STATEVERSION_CORRELATION = FAIL
    all captured records used stateVersion=0

TEMPORAL_PAIRING = STRONG_BUT_NONAUTHORITATIVE
    timestamp proximity is NOT a same-push proof.
```

---

## 4. ACT scope

### 4.1 Authorized production change

Only if RED proof identifies it:

```text
WEBVIEW_REPLICA_TURNSTATE_APPLY_FIX_ONLY
```

Permitted locations:

```text
apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx
and directly adjacent pure helper(s)/tests if extraction is necessary.
```

### 4.2 Authorized diagnostic change

PTAD may gain:

```text
_ptadPushId?: number
captureKind
```

with no normal-runtime semantics.

### 4.3 Forbidden

```text
NO ChatRow static-Thinking fix
NO RequestStartRow fix
NO InputSection behavior fix
NO ActionButtons behavior fix
NO sendingDisabled mutation
NO useMessageHandlers behavioral change
NO task-header migration
NO TaskState reducer change
NO AgentRuntime change
NO LocalRuntimeHost change
NO Hub/Remote change
NO protocol semantic change
NO E8
NO E9
```

---

## 5. Critical rule

```text
THE LIVE C2 DUMP IS EVIDENCE, NOT A LICENSE TO PATCH THE FIRST
SUSPICIOUS CONDITION.

NO PRODUCTION CHANGE UNTIL THE EXACT
idle/seq2 → streaming/seq4
AND
idle/seq2 → awaiting_followup/seq15
REPLAY IS RED THROUGH THE PRODUCTION WEBVIEW APPLY PATH.
```

The next sections of this ACT report the recon and replay that either
produces RED (which authorizes the repair) or fails to produce RED (which
mandates HALT/replan per Outcome C of the ACT).

---

## 6. PTAD push-ID repair scope

Independent of the replica-replay outcome, the live experiment proved
that `stateVersion` is not usable as the PTAD join key:

```text
stateVersion = 0 on all extension and webview records
```

The fix is a **diagnostic-only monotonic push ID** that the extension
mints per `ExtensionState` push and stamps into both the wire payload
(a private `_ptadPushId` field) and the extension diagnostic record.
The webview propagates the same `_ptadPushId` into its diagnostic
records. The webview **never derives** the push ID independently.

This is the only authorized production change in this ACT unless
Section 7 produces a RED replica replay.

---

## 7. Replica-replay outcome

The C1 RED replay (production reducer, exact live sequence) **PASSES**.
See:

- `apps/vscode/webview-ui/src/components/chat/chat-view/messageReducer.test.ts`
  (16 reducer tests including the canonical
  "stale snapshot does NOT revert phase" case)
- `apps/vscode/webview-ui/src/components/chat/chat-view/__tests__/c2-replay-red.test.ts`
  (this ACT's witness; replay of the exact E1-E6 sequence through
  the production reducer)

The production `applyTurnState` correctly advances the replica from
`idle/seq2 → streaming/seq4 → awaiting_followup/seq15` and rejects the
subsequent `idle/seq2` straggler. The seq-gate does not produce the
observed webview behavior.

Per the ACT critical rule and Outcome C, **the replica-repair is
HALTED**. The defect, if real, lives outside the authorized replica
boundary and requires a follow-up ACT to localize.

---

## 8. Acceptance matrix (pre-fix)

```text
C2R_T0  ENTRY_IDENTITY                         PASS
C2R_T1  LIVE_C2_EVIDENCE_FROZEN                PASS
C2R_T2  TURNSTATE_APPLY_RECON                  PASS
C2R_T3  EXACT_LIVE_PAIR_RED                    FAIL   (replay is GREEN; defect elsewhere)
C2R_T4  NECESSITY                              FAIL   (no replica defect proven)
C2R_T5  REPLICA_FIX_MINIMALITY                 N/A
C2R_T6  NEWER_TURNSTATE_ACCEPTED               PASS   (reducer test)
C2R_T7  STALE_TURNSTATE_REJECTED               PASS   (reducer test)
C2R_T8  EPOCH_SEMANTICS                        PASS   (reducer test)
C2R_T9  PTAD_PUSH_ID                           PASS   (implemented by this ACT)
C2R_T10 CAPTURE_KIND                           PASS   (implemented by this ACT)
C2R_T11 COMPOSER_COMPONENT_CAPTURE             PASS   (implemented by this ACT)
C2R_T12 FOLLOWUP_CAPTURE_100_PERCENT           PASS   (implemented by this ACT)
C2R_T13 EXISTING_QUALIFICATION                 PASS
C2R_T14 TYPES                                  PASS
C2R_T15 PATCH_HYGIENE                          PASS
C2R_T16 EXACT_HEAD_VSIX                        PASS
C2R_T17 INSTALLED_VERSION_BINDING              PASS
C2R_T18 REAL_DOGFOOD_REPLICA_TRUTH             PASS   (PTAD correlation only; replica HALTED)
C2R_T19 PROTECTED_STASHES_INTACT               PASS
```

---

## 9. Verdict

```text
HALT_REPLICA_REPRO_NOT_OBTAINED
FIRST_DIVERGENCE_BOUNDARY = not yet proven (outside authorized scope)

PTAD_CORRELATION           = PASS (push ID minted + propagated)
COMPOSER_CAPTURE           = COMPLETE (captureKind stamps in place)
```

The replica-repair slice of this ACT is HALTED per Outcome C. The
PTAD-correlation slice is closed. The next ACT should be chosen from
the corrected dogfood trace (post-C2R dogfood run) rather than
preselected.

Static `Thinking` survival (CLASS_C) and composer sendability (CLASS_A/I/G)
remain unresolved by this ACT; they are deliberately left to the
follow-up slice chosen after the post-C2R dogfood trace is captured.
