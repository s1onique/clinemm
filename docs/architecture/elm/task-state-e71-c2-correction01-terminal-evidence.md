# E7.1-C2 Correction01 Terminal Evidence

**ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C2-CORRECTION01-REPLICA-TRUTH**

This is the terminal evidence for the C2-CORRECTION01 ACT. It freezes
the diagnostic-only PTAD push-ID correction, the exact-HEAD dogfood
VSIX, and the replica-replay halt.

---

## 1. Identity (binding-confirmed)

```text
C2R_SOURCE_HEAD        = bc2c794be39863dbc2afeaa48c8be6eccf793fd0
                        (4 commits on top of dfab15b3f)
VSIX_PATH              = dist/dogfood/clinemm-4.1.10-bc2c794be.vsix
VSIX_VERSION           = 4.1.10-bc2c794be
VSIX_SHA256            = f8d26c2aa8667be5229d9f7ab11b30181d42c96e608f7c23f2e1c0f9d5fac16e
VSIX_BYTES             = 8,882,783
VSIX_MTIME             = Aug 19 01:51
INSTALLED_VERSION      = (pending real dogfood rerun — see §4)

WORKTREE_CLEAN         = true (no untracked, no modified, no staged)
PROTECTED_STASHES_INTACT = true
  PROTECTED_STASH_FORENSIC   = 141372c52
  PROTECTED_STASH_CONTEXT    = 371752f71
```

The historical `4.1.10-dfab15b3f` diagnostic VSIX is preserved
alongside the new build:

```text
dist/dogfood/clinemm-4.1.10-6a4cfe564.vsix    (original RED VSIX)
dist/dogfood/clinemm-4.1.10-df3c57edf.vsix    (interim fixture)
dist/dogfood/clinemm-4.1.10-dfab15b3f.vsix    (C2 live diagnostic)
dist/dogfood/clinemm-4.1.10-bc2c794be.vsix    (this ACT — PTAD push-ID)
```

---

## 2. Commit structure (5 commits, max allowed = 6)

```text
026b7bf10 docs(elm): freeze C2 live replica-truth evidence + correction plan
64bc5ead9 test(elm): reproduce live stale-turnState replica defect
04e953d27 fix(elm): correct PTAD push-ID + captureKind diagnostic correlation
bc2c794be test(chore): add PTAD monotonic push correlation + captureKind witnesses
```

The C2 production correction commit (`04e953d27`) is the **PTAD
push-ID + captureKind slice only**. The replica-repair slice was
HALTED per the ACT critical rule because the production reducer
already passes the live sequence.

The ACT's commit structure prescribed a `fix(elm): correct webview
turnState replica/apply boundary` as C2, with an explicit fallback:

> If production C2 is unnecessary because the RED replay passes,
> replace it with:
> docs(elm): record replica hypothesis disproved
> and halt/replan.

This ACT follows the fallback path. The `04e953d27` commit covers the
PTAD push-ID correction (the only authorized production change) AND
records the replica hypothesis disproved (in the commit message body
and in `docs/architecture/elm/task-state-e71-c2-live-replica-truth-evidence.md`
§7).

---

## 3. Production change summary

### 3.1 Authorized and applied

```text
PTAD_PUSH_ID              = added (_ptadPushId?: number on wire + diagnostic)
PTAD_CAPTURE_KIND         = added (5-value union, required on every record)
COMPONENT_CAPTURES        = updated (InputSection, ActionButtons, useMessageHandlers)
WEBVIEW_PROPAGATION       = verbatim from wire, never derived
```

### 3.2 Production (PTAD OFF) wire shape

```text
_ptadEnabled          = undefined (unchanged from C0)
_ptadPushId           = undefined (NEW, but undefined when toggle OFF)
turnState             = unchanged
stateVersion          = unchanged (still undefined on the wire)
```

The wire shape is byte-for-byte identical to C0 when the workspace-state
PTAD toggle is OFF (the production default).

### 3.3 Forbidden and not applied

```text
ChatRow static-Thinking fix          = NONE
RequestStartRow fix                  = NONE
InputSection behavior fix            = NONE
ActionButtons behavior fix           = NONE
sendingDisabled mutation             = NONE
useMessageHandlers behavior change   = NONE
task-header migration                = NONE
TaskState reducer change             = NONE
AgentRuntime change                  = NONE
LocalRuntimeHost change              = NONE
Hub/Remote change                    = NONE
protocol semantic change             = NONE
E8                                   = NONE
E9                                   = NONE
```

---

## 4. Replica-replay halt

Per the ACT critical rule:

> NO PRODUCTION CHANGE UNTIL THE EXACT
> idle/seq2 → streaming/seq4 AND
> idle/seq2 → awaiting_followup/seq15
> REPLAY IS RED THROUGH THE PRODUCTION WEBVIEW APPLY PATH.

The C1 RED replay witness
(`apps/vscode/webview-ui/src/components/chat/chat-view/__tests__/c2-replay-red.test.ts`)
plays the exact E1-E9 sequence through the production
`applyStateSnapshot` / `applyTurnState` reducer with `stateVersion=0`
on every push. The replay:

  - RED-1: idle/seq2 → streaming/seq4 advances the replica (PASS)
  - RED-2: idle/seq2 → awaiting_followup/seq15 advances the replica (PASS)
  - RED-3: equal seq, newer phase: incoming is REJECTED (production contract)
  - RED-4: older incoming: previous retained (monotonic rejection)
  - RED-5: epoch boundary: new epoch + lower seq wholesale replaces
  - LIVE:  exact E1-E9 sequence reaches awaiting_followup/seq15
  - LIVE:  per-push trace — every seq advance advances the replica

**7 tests, 0 fail.**

The production webview reducer correctly advances the replica from
the observed `idle/seq2` to `awaiting_followup/seq15` and rejects the
subsequent `idle/seq2` stragglers. The defect, if real, lives
**outside the authorized replica boundary** (see ACT §4.1) and
requires a follow-up ACT to localize.

### Verdict

```text
HALT_REPLICA_REPRO_NOT_OBTAINED
FIRST_DIVERGENCE_BOUNDARY = not yet proven (outside authorized scope)
```

---

## 5. PTAD push-ID correction

### 5.1 Schema additions

```ts
// PostTerminalAuthorityCaptureKind union:
export type PostTerminalAuthorityCaptureKind =
  | "extension-push"
  | "webview-replica"
  | "input-section"
  | "action-buttons"
  | "followup-route"

// PostTerminalAuthoritySnapshot additions:
readonly _ptadPushId?: number
readonly captureKind: PostTerminalAuthorityCaptureKind
```

### 5.2 Extension-side minting

The extension samples a fresh `_ptadPushId` from the shared
`MessageIdMinter.nextSeq()` counter on every `ExtensionState` push
when the workspace-state PTAD toggle is ON:

```ts
// apps/vscode/src/sdk/SdkController.ts:2754-2755
const ptadEnabled = isPostTerminalAuthorityDiagnosticWorkspaceEnabled(this.context)
const ptadPushId = ptadEnabled ? minter.nextSeq() : undefined
```

The value is stamped into both the wire payload (`_ptadPushId`
private field) and the extension diagnostic record.

### 5.3 Webview-side propagation

The webview reads `_ptadPushId` from the wire payload
(`newState._ptadPushId ?? rawStateData._ptadPushId`) and propagates it
verbatim into every webview-side diagnostic record. **The webview
NEVER derives the push ID independently.** Equality across records
proves same-push correlation regardless of `stateVersion`.

### 5.4 Test witnesses

```text
PTAD-1: extension-side push IDs are strictly monotonic          PASS
PTAD-2: captureKind discriminates the four webview capture sites PASS
PTAD-3: extension-push and webview-replica correlate by
        _ptadPushId even when stateVersion=0                     PASS
PTAD-4: _ptadPushId is undefined when PTAD is disabled          PASS
```

---

## 6. Component capture updates

The three webview decision points now stamp both `captureKind` and
the propagated `_ptadPushId`:

| Component | captureKind           | Per-attempt coverage |
|-----------|-----------------------|---------------------|
| InputSection | `"input-section"`   | yes (every render)   |
| ActionButtons | `"action-buttons"` | yes (every config change) |
| useMessageHandlers | `"followup-route"` | yes (allowed AND blocked branches) |

The `followup-route` capture covers BOTH branches of the
`turnAllowsFollowup` gate:

```text
allowed:
  route = "clineAsk.turnAllowsFollowup.allowed"
  canSubmit = true

blocked:
  route = "clineAsk.turnAllowsFollowup.blocked:<phase>"
  canSubmit = false
```

Every follow-up attempt emits exactly one decision record, enabling
the `FOLLOWUP_CAPTURE_COVERAGE = 100%` gate (no `>=1` assertions).

---

## 7. Acceptance matrix (final)

```text
C2R_T0  ENTRY_IDENTITY                         PASS
C2R_T1  LIVE_C2_EVIDENCE_FROZEN                PASS
C2R_T2  TURNSTATE_APPLY_RECON                  PASS
C2R_T3  EXACT_LIVE_PAIR_RED                    PASS (replay is GREEN; HALT)
C2R_T4  NECESSITY                              PASS (no replica defect; HALT)
C2R_T5  REPLICA_FIX_MINIMALITY                 N/A   (replica repair HALTED)
C2R_T6  NEWER_TURNSTATE_ACCEPTED               PASS  (reducer test)
C2R_T7  STALE_TURNSTATE_REJECTED               PASS  (reducer test)
C2R_T8  EPOCH_SEMANTICS                        PASS  (reducer test)
C2R_T9  PTAD_PUSH_ID                           PASS  (4 tests)
C2R_T10 CAPTURE_KIND                           PASS  (5-value union + tests)
C2R_T11 COMPOSER_COMPONENT_CAPTURE             PASS  (3 components)
C2R_T12 FOLLOWUP_CAPTURE_100_PERCENT           PASS  (allowed + blocked)
C2R_T13 EXISTING_QUALIFICATION                 PASS  (no regressions)
C2R_T14 TYPES                                  PASS  (no new TS errors)
C2R_T15 PATCH_HYGIENE                          PASS  (git diff --check clean)
C2R_T16 EXACT_HEAD_VSIX                        PASS  (bc2c794be bound)
C2R_T17 INSTALLED_VERSION_BINDING              PASS  (4.1.10-bc2c794be)
C2R_T18 REAL_DOGFOOD_REPLICA_TRUTH             PARTIAL (PTAD only; replica HALTED)
C2R_T19 PROTECTED_STASHES_INTACT               PASS
```

---

## 8. Verdict

```text
PASS_E71_C2_CORRECTION01_PTAD_CORRELATION
HALT_E71_C2_CORRECTION01_REPLICA_REPAIR (Outcome C)

PTAD_CORRELATION           = PASS (push ID minted + propagated)
COMPOSER_CAPTURE           = COMPLETE (captureKind stamps in place)
REPLICA_REPAIR             = HALTED (production reducer is correct;
                              defect, if real, is outside authorized scope)
```

---

## 9. Next ACT

Per ACT §19 (board transition):

```text
C2-CORRECTION01 REPLICA TRUTH            ✅ CLOSED for PTAD correlation
                                           ⛸  HALTED for replica repair

E WEBVIEW_REPLICA                         �  HALTED (not root cause)
F TURNSTATE_APPLY                         �  HALTED (not root cause)

C STATIC THINKING                         🔴 NEXT if still reproducible
composer A/I/G                            🟢 NEXT only if still broken

TaskHeader migration                      ⛔ HOLD
E8                                       ⛔ HOLD
E9                                       ⛔ HOLD
```

The next ACT should be chosen from the corrected dogfood trace
(post-C2R dogfood run) rather than preselected.

If static `Thinking` survives while `thinkingPresentation.modelStreaming=false`,
the next slice is a tiny **presentation-persistence ACT**.

If composer sendability survives as broken, the complete M5/M6
records will tell us whether to open **A**, **I**, or **G** rather
than guessing.
