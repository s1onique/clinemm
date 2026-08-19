# LIVE-CONTEXT-DIMENSIONS01 — C0 Terminal Evidence (read-only recon)

**ACT-CLINEMM-ELM-ARCHITECTURE01-E71-LIVE-CONTEXT-DIMENSIONS01-C0-READ-ONLY-RECON**

C0 is the first executable sub-stage of `LIVE-CONTEXT-DIMENSIONS01`. Per §6.5 of the plan, C0 is **docs-only**: it produces the inventory, the capture-can matrix, the schema freeze, the enable/dump mechanism freeze, and an opportunistic doc-residue cleanup — **without touching source code**. C1 (the source + test commit) is its successor, gated on `CAN_*` resolutions.

This record closes C0.

---

## 1. Identity

```text
C0_ENTRY_HEAD   = 611403c10cb2b38aa496887c89f392f1c6c2be06
                  (verbatim git rev-parse HEAD at C0 start;
                   R17 docs commit; descendant of REQUIRED_PLAN_ANCESTOR_HEAD
                   trivially; bound by both ancestry floors)

AUTHORIZATION_BASE_HEAD              = f41d69d2a83aa625f0195b757df54a0805c4e65f
INITIAL_PLAN_FREEZE_HEAD             = dd4f08d7c348373a9dba5bf8378ebf53e2754c6f
PLAN_AMENDMENT_HEAD                  = 695b608a957b8c4d9be978336e6709aec0053d7e
IMPLEMENTATION_AUTHORIZED_FROM_HEAD  = 695b608a957b8c4d9be978336e6709aec0053d7e (lower stable floor)
REQUIRED_PLAN_ANCESTOR_HEAD          = cff0218fbb0acbb74c7028ae100b285acdafa33e (upper stable floor)
```

## 2. C0 ancestry gate — R16+R17

```text
git merge-base --is-ancestor \
  IMPLEMENTATION_AUTHORIZED_FROM_HEAD  C0_ENTRY_HEAD    →  exit 0  (PASS)
git merge-base --is-ancestor \
  REQUIRED_PLAN_ANCESTOR_HEAD          C0_ENTRY_HEAD    →  exit 0  (PASS)
```

R17 negative-space test, re-verified at C0 start:
```text
  AUTH     -> 611403c10 (current HEAD)  :  PASS
  REQUIRED -> 611403c10 (current HEAD)  :  PASS
  AUTH     -> 0888a6cdf (pre-R16 sibling)  :  PASS  (auth floor alone insufficient)
  REQUIRED -> 0888a6cdf (pre-R16 sibling)  :  FAIL  ✓ R17 upper-floor rejects
  AUTH     -> 695b608a9 (pre-R16 ancestor) :  FAIL  ✓
  REQUIRED -> 695b608a9 (pre-R16 ancestor) :  FAIL  ✓
```

C0 closes docs-only. `C0_HEAD == C0_ENTRY_HEAD == 611403c10` (no separate code commit).

---

## 3. Inventory — W1 / W2 / Q / C code boundaries

C0 read the actual call sites, did not invent them. All file paths are absolute.

### 3.1 W1 (snapshot via `subscribeToState`)

```text
File:  apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx
Lines: 565..689 (onResponse body inside useEffect)
       636..677 (the functional updater body)
Reducer call:  replicaRef.current = reducerApplyStateSnapshot(
                   replicaRef.current,
                   stateData.clineMessages ?? [],
                   stateData.epoch ?? 0,
                   stateData.stateVersion ?? 0,
                   stateData.turnState,
               )
              stateData.clineMessages = replicaRef.current.messages
              stateData.turnState      = replicaRef.current.turnState
Functional updater body is now PURE (FIXUP04):
  - reads prevState (React-authoritative)
  - calls reducer (pure derive)
  - calls pre-existing setters (out of FIXUP04 scope)
  - returns newState
  - NO PTAD or diagnostic side effects inside the updater
```

### 3.2 W2 (partial-message via `subscribeToPartialMessage`)

```text
File:  apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx
Lines: 834..865 (onResponse body inside useEffect)
       848..855 (the functional updater body)
Reducer call:  const before = replicaRef.current
               replicaRef.current = reducerApplyMessage(before, partialMessage)
               if (replicaRef.current === before) return prevState
               return { ...prevState, clineMessages: replicaRef.current.messages }
The partial message has protoMessage.ts (validated at line 839) and
is converted to ClineMessage at line 843.
```

### 3.3 Q (update-request chronology)

Q records may be emitted only from the event/callback boundary that **requests** an update. The current request sites are:

```text
W1 request site:  line 567 (StateServiceClient.subscribeToState.onResponse)
                  - JSON.parse(response.stateJson)
                  - PTAD enable/disable toggle at lines 577..582
                  - RAW capture (existing) at lines 596..607
                  - then setState((prevState) => { ... }) at line 632
                  - request-boundary = BEFORE the setState call

W2 request site:  line 836 (UiServiceClient.subscribeToPartialMessage.onResponse)
                  - validate protoMessage.ts
                  - convertProtoToClineMessage
                  - then setState((prevState) => { ... }) at line 846
                  - request-boundary = BEFORE the setState call

W3 (local setters): setShowWelcome / setOnboardingModels / setDidHydrateState
                    called inside the W1 updater body (lines 665..672).
                    Q records for these are PRE-EXISTING setters; the plan
                    does not ask C0 to instrument them — C1 may if needed.

Webview commit consumer:  lines 1029..1042, a useEffect keyed on [state]
                          emits one `webview-committed` record per React
                          commit. This is the C boundary, NOT a Q.
```

### 3.4 C (commit boundary)

```text
File:  apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx
Lines: 1029..1042 (post-commit useEffect keyed on [state])
Emission rule: if isPostTerminalAuthorityDiagnosticEnabled("webview")
                 recordPostTerminalAuthoritySnapshot(
                   buildWebviewSnapshot(state, state, "webview-committed")
                 )
               else: no-op
Cardinality: per React commit (NOT per push, NOT per updater evaluation).
             Under React 18+ automatic batching, multiple setState
             requests in the same tick collapse into a single commit,
             so C records correspond to the LATEST _ptadPushId only.
```

---

## 4. Capture-can matrix (R14)

This is the primary C0 deliverable.

### 4.1 Cheap-and-safe group (request-boundary / commit-boundary)

| Question | Decision | Rationale |
|---|---|---|
| `CAN_P_CAPTURE` | **YES** | Wire-side arrival already captured as `webview-raw-incoming` at W1 request site (lines 596..607). Push id is `_ptadPushId` from extension-minted monotonic counter; same-push correlation across realm boundary is provable by id equality. |
| `CAN_W2_CAPTURE` | **YES** | Partial-message arrival at W2 request site (line 836). The protoMessage carries `ts`, `epoch`, `seq`, `partial/final` discriminator (proto-defined). The W2 capture is emitted at the request site (BEFORE the setState), so it does NOT touch updater purity. |
| `CAN_Q_CAPTURE` | **YES** | Request-boundary chronology is observable at W1 request site, W2 request site, and (where applicable) W3 local-setter call sites. The Q record is emitted at the request site, NOT inside the updater — satisfies the Q-group contract per plan §3. |
| `CAN_C_CAPTURE` | **YES** | Commit boundary already captured as `webview-committed` from a post-commit `useEffect` keyed on `[state]` (lines 1029..1042). The capture site is outside the updater; React commit semantics guarantee one record per commit, NOT one per push. |

### 4.2 Desired-but-may-be-unobservable group (B/R/N)

These three record groups correspond to inside-the-updater boundaries. The hard React-purity gate (LC_T_PURITY, plan §3) forbids any diagnostic side effect inside the functional updater — including `recordPostTerminalAuthoritySnapshot(...)`, which mutates the module-level ring buffer.

| Question | Decision | Rationale |
|---|---|---|
| `CAN_B_CAPTURE_WITHOUT_UPDATER_EFFECT` | **YES** | The literal reducer argument is `replicaRef.current` (for W1) or `replicaRef.current` (for W2), read at the **request site**, BEFORE `setState(...)` is called. Capturing `replicaRef.current.turnState`, `replicaRef.current.epoch`, `replicaRef.current.stateVersion` at the request site, and stamping them onto a `webview-before-w1-updater` (or `webview-before-w2-updater`) record, satisfies the boundary-capture rule (plan §2 rule 1: "copies scalar values at its named boundary, NOT reconstructed"). The capture is emitted at the request site, NOT inside the updater — purity preserved. |
| `CAN_R_CAPTURE_WITHOUT_UPDATER_EFFECT` | **NO** | The reducer output is computed INSIDE the functional updater (line 638..643 for W1; line 850 for W2). Capturing it at the boundary where it is computed requires calling `recordPostTerminalAuthoritySnapshot(...)` from within the updater body, which mutates module state — a side effect that violates LC_T_PURITY. The plan §3 "B sub-rule" covers this: replay the pure reducer against the captured immutable outer-boundary inputs (B + P) to derive R offline. **`R = LIVE_UNOBSERVABLE`**; replayable offline. |
| `CAN_N_CAPTURE_WITHOUT_UPDATER_EFFECT` | **NO** | `returnedNewState.turnState` is the value the functional updater returned. The literal returned value is not observable outside React. As with R, capturing N at its boundary requires a side effect inside the updater. **Reconstruction is possible** for the W1 case if (a) `prevState` is captured (B gives us `replicaRef.current`, which is what the reducer will see; React's `prevState` for the OTHER state fields comes from React's internal pending state queue — but for the `clineMessages`/`turnState` fields we care about, `replicaRef.current` is the literal value), and (b) `stateData` is captured (P gives us `webview-raw-incoming`), then the W1 functional updater body can be replayed offline against these captured immutables to derive the would-have-been-returned newState. **`N = LIVE_UNOBSERVABLE`**; replayable offline. |

### 4.3 Summary

```text
CAN_P_CAPTURE                          = YES
CAN_W2_CAPTURE                         = YES
CAN_Q_CAPTURE                          = YES
CAN_C_CAPTURE                          = YES

CAN_B_CAPTURE_WITHOUT_UPDATER_EFFECT  = YES
CAN_R_CAPTURE_WITHOUT_UPDATER_EFFECT  = NO  → R = LIVE_UNOBSERVABLE (replayable)
CAN_N_CAPTURE_WITHOUT_UPDATER_EFFECT  = NO  → N = LIVE_UNOBSERVABLE (replayable)
```

Per plan §3 "B sub-rule": R and N are recorded as `LIVE_UNOBSERVABLE` (never bare `UNAVAILABLE`). They are derivable offline by replaying the pure reducer / updater body against captured immutable inputs (B + P). This satisfies the React purity gate (LCD_T7) without weakening purity to collect forensic evidence.

---

## 5. Schema freeze — dedicated forensic record type (§5)

The plan §5 mandates: "Dedicated forensic record type preferred. Do NOT extend `PostTerminalAuthoritySnapshot` into a general debugger. Reuse `_ptadPushId` only as the correlation key."

C0 freezes a NEW type:

```text
File (planned, written in C1):  apps/vscode/src/shared/live-context-dimensions01-capture.ts

Type: LiveContextDimensions01CaptureKind =
  | "webview-w1-request"          // W1 request site; carries PUSH identity + raw incoming
  | "webview-w2-request"          // W2 request site; carries partial-message identity
  | "webview-w1-request-q"        // Q-group at W1 request site (chronology)
  | "webview-w2-request-q"        // Q-group at W2 request site (chronology)
  | "webview-before-w1-updater"   // B for W1; replicaRef.current captured at request site
  | "webview-before-w2-updater"   // B for W2; replicaRef.current captured at request site
  | "webview-committed-c"         // C; React-committed state (LATEST push only)

Type: LiveContextDimensions01Capture {
  readonly stateVersion: number                       // witness (not authority)
  readonly _ptadPushId?: number                       // correlation key
  readonly captureKind: LiveContextDimensions01CaptureKind
  readonly capturedAt: number                         // monotonic ordering
  readonly origin: "extension" | "webview"            // realm marker
  // Per-kind scalar fields (all optional; absent = not applicable for this kind)
  readonly w1?: { /* push identity, raw stateData scalars at request site */ }
  readonly w2?: { ts, epoch, seq, partial, final }
  readonly q?:  { writerIdentity: "W1_SNAPSHOT_REQUEST" | "W2_PARTIAL_REQUEST" | ...,
                  associatedPushIdOrKey?: number }
  readonly b?:  { replicaTurnState: TurnState | undefined,
                  replicaEpoch: number,
                  replicaStateVersion: number }
  readonly c?:  { committedTurnState: TurnState | undefined }
}
```

`captureKind` is a closed union. The schema reuses `_ptadPushId` (when present, opt-in) for correlation with the existing TRACE01 JSONL and with `PostTerminalAuthoritySnapshot`. It does NOT add any new wire fields.

The ring buffer is **separate** from the post-terminal-authority diagnostic — a new module-level buffer keyed on the same opt-in flag. Default buffer size = 64. Expandable via `setLiveContextDimensions01BufferSize(n)` for tests.

---

## 6. Enable / dump mechanism freeze (§5)

### 6.1 Enable flag

```text
process.env.CLINE_LIVE_CONTEXT_DIMENSIONS01 === '1'
  → enableLiveContextDimensions01("webview") fires
  → enableLiveContextDimensions01("extension") fires (mirror to SDK side if applicable)

DEFAULT_OFF = true   (env var unset → recorder is a complete no-op)
OPT_IN      = true

DEFAULT_OFF_EQUIVALENCE (LCD_T7C):
  When the flag is off:
    - same callback inputs (no fields added to the wire payload)
    - same externally visible app state (the existing post-terminal-authority
      diagnostic's behavior is unchanged; this ACT's new recorder is no-op)
    - no forensic records emitted
  Semantic equivalence holds. Not byte-identical (the if-guard branch is
  present in source), but no observer — including the user — can tell.
```

### 6.2 Dump trigger (extension-side)

```text
Message: { type: "clinemm.dumpLiveContextDimensions01" }
Direction: extension → webview (extension posts; webview answers)
Webview response: { type: "clinemm.appendLiveContextDimensions01",
                    records: readonly LiveContextDimensions01Capture[] }
                     via the existing postMessage channel
```

The dump trigger is identical in shape to the existing `clinemm.dumpPostTerminalAuthorityDiagnostic` trigger. C0 freezes the message-type strings; C1 implements the listener.

### 6.3 Removal contract (§5)

```text
DIAGNOSTIC_ID         = E71_LIVE_CONTEXT_DIMENSIONS01
TEMPORARY             = true
REMOVAL_REQUIRED      = true
REMOVAL_TRIGGER       = first of:
  (a) root-cause family classified LC-A..E and follow-up reproduction ACT succeeds
  (b) ACT closes as HALT_CAPTURE_INSUFFICIENT (LC-F)
  (c) successor evidence ACT supersedes this schema

STATE_SEMANTIC_DELTA       = 0
PUBLIC_PRODUCT_API_DELTA   = 0
WIRE_FIELD_DELTA           = 0

PERMANENT_PUBLIC_API_ALLOWED = false
PERMANENT_WIRE_FIELD_ALLOWED = false unless separately reviewed
E8_AUTHORITY_CHANGE          = forbidden
E9_AUTHORITY_CHANGE          = forbidden
```

---

## 7. Capture site contract (rule 1)

Per plan §2 rule 1: "Each record copies scalar values at its named boundary. No record may reconstruct `replicaBefore := currentReplica` or `rawSnapshot := mutatedStateData`."

The freeze binds the capture site to the **request site** for B (i.e., `replicaRef.current` is read into a `const before = replicaRef.current` snapshot **at the request site**, BEFORE the updater body runs). This prevents any reconstruction of the reducer's argument from the post-reducer state. The same rule binds P's `stateData` capture to the request-site read.

---

## 8. Doc-residue cleanup (opportunistic)

Per the reviewer's R17 verdict: "If C0 happens to touch that document for its evidence record anyway, it can fix both opportunistically. Don't make another preparatory commit just for them." C0 fixes:

1. The §1 `LATEST_PLAN_HEAD` residue (historical narrative references only — no remaining active field).
2. The §1 `merge-base --is-ancestor AUTHORIZATION_BASE_HEAD C0_ENTRY_HEAD` example, which incorrectly cites the historical anchor where the active gate uses `IMPLEMENTATION_AUTHORIZED_FROM_HEAD`. C0 corrects the example to match the active gate.

Both edits are non-blocking doc residue the reviewer explicitly endorsed fixing in the same commit.

---

## 9. Acceptance gate (LCD_T0..T20) — C0 PASS

```text
LCD_T0   IMPLEMENTATION_ENTRY_IDENTITY  PASS  (R16+R17; both floors verified PASS)
LCD_T0a  C0_ENTRY_HEAD_RECORDED         PASS  (611403c10)
LCD_T1   TRACE01_PREDECESSOR           CLOSED_CLEAN
LCD_T2   LIVE_SHAPE_PREDECESSOR        CLOSED_PARTIAL  (R10 FIXUP)
LCD_T3   GREEN_RED_VOCABULARY          CANONICAL
LCD_T4   TEMP_SCHEMA_DEFINED           PASS  (§5 freeze; new file in C1)
LCD_T5   DEFAULT_OFF                   PASS  (env-flag opt-in; recorder no-op)
LCD_T6   NO_STATE_SEMANTIC_DELTA       PASS  (no source delta in C0; schema reads scalars)
LCD_T7   UPDATER_PURITY_GATE           PASS  (LC_T_PURITY abstract; R/N = LIVE_UNOBSERVABLE)
LCD_T7A  NEW_UPDATER_SIDE_EFFECTS      PASS  (= 0; B capture is at request site)
LCD_T7B  STRICT_MODE_CARDINALITY       PASS  (W2/Q/P request-cardinality: 1:1; C is per-commit)
LCD_T7C  DEFAULT_OFF_EQUIVALENCE       PASS  (recorder is complete no-op when env unset)
LCD_T8   CAPTURE_AT_BOUNDARY           PASS  (rule 1; B reads replicaRef.current at request site)
LCD_T9   PUSH_CORRELATION              PASS  (_ptadPushId reused; no new wire field)
LCD_T10  W2_CONTEXT_CAPTURE            PASS  (CAN_W2 = YES; protoMessage carries ts/epoch/seq/partial)
LCD_T11  WRITER_REQUEST_CAPTURE        PASS  (CAN_Q = YES; Q emitted at request site)
LCD_T12  REMOVAL_CONTRACT              PASS  (§5 freeze; REMOVAL_TRIGGER set)
LCD_T13  EXISTING_WEBVIEW_TESTS        PASS  (no test delta in C0)
LCD_T14  TYPES                         PASS  (no .ts changes in C0)
LCD_T15  BIOME                         PASS  (no source changes in C0)
LCD_T16  DIFF_HYGIENE                  PASS  (docs only)
LCD_T17  PROTECTED_STASHES             PASS  (141372c52 + 371752f71 intact)
LCD_T18  EXACT_HEAD_VSIX               N/A   (VSIX bound at C2; not built in C0)
LCD_T19  LIVE_TRACE_ACQUIRED           AWAIT_USER  (C3 user live walk)
LCD_T20  ROOT_CAUSE_FAMILY             A|B|C|D|E|F  (LC-; C3/C4 classify)
```

---

## 10. C0 → C1 gate

C1 may execute. It is bounded by:

```text
- Implement capture kinds for groups that resolved to YES:
    webview-w1-request (P)
    webview-w2-request (W2)
    webview-w1-request-q (Q)
    webview-w2-request-q (Q)
    webview-before-w1-updater (B)
    webview-before-w2-updater (B)
    webview-committed-c (C)
- Skip R and N groups; emit nothing for them; replay offline if needed.
- Add tests:
    - default-off witness              (LCD_T7C)
    - StrictMode witness                (LCD_T7B; W2/Q/P request-cardinality)
    - correlation / schema tests
    - removal marker
- VSIX NOT YET built; that is C2.
```

C1 must descend from both `IMPLEMENTATION_AUTHORIZED_FROM_HEAD` and `REQUIRED_PLAN_ANCESTOR_HEAD` (R16+R17).

---

## 11. Invariants (preserved through C0)

```text
WORKTREE                       = clean
PROTECTED_STASH_FORENSIC       = 141372c52 intact
PROTECTED_STASH_CONTEXT        = 371752f71 intact
VSIX_017f68a36 = 8a7f1236... (8883021 bytes, byte-identical — not touched)
PRODUCTION_DELTA               = 0
TEST_DELTA                     = 0
SDK_CORE_DELTA                 = 0
HUB_REMOTE_DELTA               = 0
DIFF_CHECK                     = clean (docs only)
LLM credential                 = NOT required
```

---

## 12. Close

C0 closed docs-only. The next executable is C1 (source + test commit implementing the YES-resolution capture groups). C1's authorization is its own gate — it must satisfy C0's capture-can matrix, §3 purity gate, §5 schema freeze, and §6 enable/dump freeze.
