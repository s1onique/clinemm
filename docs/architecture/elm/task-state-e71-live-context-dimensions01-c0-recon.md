# LIVE-CONTEXT-DIMENSIONS01 — C0 Terminal Evidence (read-only recon)

**ACT-CLINEMM-ELM-ARCHITECTURE01-E71-LIVE-CONTEXT-DIMENSIONS01-C0-READ-ONLY-RECON**

C0 is the first executable sub-stage of `LIVE-CONTEXT-DIMENSIONS01`. Per §6.5 of the plan, C0 is **docs-only**: it produces the inventory, the capture-can matrix, the schema freeze, the enable/dump mechanism freeze, and an opportunistic doc-residue cleanup — **without touching source code**. C1 (the source + test commit) is its successor, gated on `CAN_*` resolutions.

This record closes C0.

## C0-CORRECTION01 amendment log

The original C0 manifest (committed at `6f08c82ae`) was reviewed by the
React state-model engineer and the Factory/ACT reviewer. The review
identified three issues that did not block the C0 docs-only commit but
must be reflected in the C0 evidence record before C1 begins:

- **R18 — B boundary identity.** The original C0 claimed
  `CAN_B_CAPTURE_WITHOUT_UPDATER_EFFECT = YES` and named the kind
  `webview-before-w1-updater`. That name claimed the literal reducer
  input, but the capture is at the request site, BEFORE React evaluates
  the queued updater. React's pending-state queue and `ref.current`'s
  independence from React's state are documented React semantics; the
  values can drift. The B row is split into two epistemic categories:
  request-site (YES, but explicitly the request-site approximation) and
  literal updater-time (NO → LIVE_UNOBSERVABLE). The capture kind is
  renamed to `webview-w1-request-replica` / `webview-w2-request-replica`.

- **R19 — W2 push-correlation provenance.** The original C0 assumed W2
  records carry `_ptadPushId` for push correlation. The proto contract
  (`subscribeToPartialMessage` returns `stream ClineMessage`) and the
  `convertClineMessageToProto` wire shape confirm there is NO
  `_ptadPushId` on the W2 wire. C0 now records
  `DOES_W2_EVENT_CARRY_PTAD_PUSH_ID = NO` and freezes an
  `associationQuality` channel (`INTRINSIC` / `INTERVAL_INFERRED` /
  `NONE`) so the analyzer cannot be lulled into a causal claim it
  cannot prove.

- **R20 — purity wording.** The original C0 said the W1 updater "is
  now PURE". LC_T_PURITY forbids NEW diagnostic side effects; it does
  NOT certify the existing pre-PTAD application updater as pure. The
  updater has pre-existing mutations (`replicaRef.current` writes) and
  pre-existing local-setter calls. C0 now records
  `NEW_DIAGNOSTIC_UPDATER_SIDE_EFFECTS = 0` and
  `EXISTING_W1_UPDATER_GLOBAL_PURITY = NOT_PROVEN` (separate from the
  ACT's own scope).

R18 consequence — `OFFLINE_R_N_REPLAY_AUTHORITY = HYPOTHESIS_ONLY`,
because the B + P replay inputs are not the literal updater-time
inputs; replaying the reducer against them yields a hypothesis probe,
not a live-evidence reconstruction. This narrows the expected
§4 classification set: P/W2/Q/C plus request-site replica context may
classify LC-E (secondary writer) and some queue/order families. LC-A,
LC-B, LC-C, and LC-D may default to LC-F unless a successor probe
supplies stronger evidence.

C1 is gated on this corrected matrix.

---

## 1. Identity

```text
C0_ENTRY_HEAD        = 611403c10cb2b38aa496887c89f392f1c6c2be06
                       (verbatim git rev-parse HEAD at C0 start;
                        R17 docs commit; descendant of
                        REQUIRED_PLAN_ANCESTOR_HEAD trivially;
                        bound by both ancestry floors)

C0_HEAD              = 6f08c82ae3b244d6c92daeb79ca909c8fcac0e15
                       (C0 docs-only commit; carries the C0
                        recon + capture-can matrix + schema +
                        enable/dump freeze; an own descendant
                        of C0_ENTRY_HEAD; the C0 result, not
                        the C0 entry — R23)

C0_CORRECTION01_HEAD = 475a3de75122b6ecb9280f94f5a1c7f4b842e5ed
                       (R18/R19/R20 corrections; C0 evidence
                        reframed; plan left untouched in this
                        commit; R21/R22 alignment landed
                        separately at R21_R22_HEAD)

R21_R22_HEAD         = 6449cec47de2ff03a78340767aa254c529f8a855
                       (plan-side alignment to C0-CORRECTION01;
                        replaced §2 guarantee #4 with the
                        correlation identity contract; split
                        §2 B-group into B_LITERAL/B0; LCD_T9
                        composite)

C1_REQUIRED_ANCESTOR_HEAD = 6449cec47de2ff03a78340767aa254c529f8a855
                       (R24 — third C1 ancestry floor; frozen
                        at the C0→C1 contract boundary; any
                        future docs-only commit between
                        R21_R22_HEAD and C1 execution does
                        NOT advance this SHA; C1_ENTRY_HEAD
                        must descend from this)

AUTHORIZATION_BASE_HEAD              = f41d69d2a83aa625f0195b757df54a0805c4e65f
INITIAL_PLAN_FREEZE_HEAD             = dd4f08d7c348373a9dba5bf8378ebf53e2754c6f
PLAN_AMENDMENT_HEAD                  = 695b608a957b8c4d9be978336e6709aec0053d7e
IMPLEMENTATION_AUTHORIZED_FROM_HEAD  = 695b608a957b8c4d9be978336e6709aec0053d7e (lower stable floor)
REQUIRED_PLAN_ANCESTOR_HEAD          = cff0218fbb0acbb74c7028ae100b285acdafa33e (upper stable floor)
```

Lifecycle role distinction (R23):

```text
C0_ENTRY_HEAD        = execution entry (what `git rev-parse HEAD`
                                 returned at C0 start)
C0_HEAD              = C0 result (the docs-only commit that froze
                                 the recon + capture-can matrix +
                                 schema + enable/dump freeze)
C0_CORRECTION01_HEAD = C0 evidence reframed (R18/R19/R20)
R21_R22_HEAD         = plan-side alignment of C0 evidence

C0_HEAD != C0_ENTRY_HEAD
```

(Note: `C0_CORRECTION01_HEAD` and `R21_R22_HEAD` SHAs above are
reproductions of the actual git refs — `475a3de75...` and
`6449cec47...` — as evidence this commit is descended from them;
see the §11 invariants block and the git log for verbatim values.)

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

C0 closes docs-only. **C0_HEAD != C0_ENTRY_HEAD** (R23):

  C0_ENTRY_HEAD = 611403c10cb2b38aa496887c89f392f1c6c2be06
                  (R17 commit — what `git rev-parse HEAD` returned
                   at C0 start; frozen at C0 entry per R16+R17)
  C0_HEAD       = 6f08c82ae3b244d6c92daeb79ca909c8fcac0e15
                  (the docs-only commit that froze the C0 recon +
                   capture-can matrix + schema + enable/dump freeze;
                   an own descendant of C0_ENTRY_HEAD; the C0 result)

There is no separate code commit; both commits are docs-only.

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
Functional updater body — observations (FIXUP04 baseline):
  - reads prevState (React-authoritative)
  - calls reducer (pure derive)
  - calls pre-existing setters (setShowWelcome / setOnboardingModels /
    setDidHydrateState) — these were there before PTAD; out of this
    ACT's scope
  - mutates `replicaRef.current` (module-level ref) — this is an
    EXISTING updater-side mutation, also pre-existing
  - returns newState
  - NEW_DIAGNOSTIC_UPDATER_SIDE_EFFECTS = 0
    (FIXUP04 removed the FIXUP03 PTAD side effects; this ACT
     introduces NO new diagnostic side effects inside the updater.)

EXISTING_W1_UPDATER_GLOBAL_PURITY = NOT_PROVEN
  LC_T_PURITY forbids NEW diagnostic side effects; it does NOT
  certify the existing pre-PTAD application updater as pure. The
  local-setter calls and `replicaRef.current` mutation are pre-
  existing and out of this ACT's scope. LC-D explicitly investigates
  shared-mutable/updater impurity; this ACT does not adjudicate it.
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

R18 — the B row is split into two distinct epistemic categories. The plan §2 definition states `B.replica` is the **literal reducer argument** observed at the updater boundary. The original C0 conflated this with the request-site `replicaRef.current` snapshot. They are not the same instant: React queues updater functions and processes them against pending state, while `ref.current` is mutable outside React's state queue and can change without causing a render. Therefore:

```text
REQUEST_SITE_B      = replicaRef.current sampled at the gRPC onResponse
                       callback, BEFORE setState((prev) => ...) is invoked.
                       Observable. NOT proof of updater-time input.

LITERAL_UPDATER_B   = replicaRef.current sampled at the moment React
                       evaluates the queued updater. Protected by React's
                       state queue. NOT observable from outside the
                       function body without a diagnostic side effect.
```

The original C0 manifest row said `CAN_B_CAPTURE_WITHOUT_UPDATER_EFFECT = YES` and named the kind `webview-before-w1-updater`. That is now corrected to the honest naming `webview-w1-request-replica` (and `webview-w2-request-replica`), because the request-site snapshot is NOT the updater-time literal.

| Question | Decision | Rationale |
|---|---|---|
| `CAN_B_REQUEST_SITE_REPLICA_CAPTURE` | **YES** | `replicaRef.current` is observable at the request site (gRPC `onResponse` callback, BEFORE `setState(...)` is invoked). The capture is emitted at the request site, NOT inside the updater — purity preserved. Honest naming: `webview-w1-request-replica` / `webview-w2-request-replica`. This is a useful approximation but is NOT proof of the literal updater-time input. |
| `CAN_B_LITERAL_UPDATER_INPUT_CAPTURE` | **NO** | The literal replica value at the moment React evaluates the queued updater is protected by React's pending-state queue. Sampling it requires either a diagnostic side effect inside the updater (forbidden by LC_T_PURITY) or some other invasive mechanism. **`B_LITERAL = LIVE_UNOBSERVABLE`**. |
| `CAN_R_CAPTURE_WITHOUT_UPDATER_EFFECT` | **NO** | The reducer output is computed INSIDE the functional updater (line 638..643 for W1; line 850 for W2). Capturing it at the boundary where it is computed requires calling `recordPostTerminalAuthoritySnapshot(...)` from within the updater body, which mutates module state — a side effect that violates LC_T_PURITY. **`R = LIVE_UNOBSERVABLE`**; **NOT replayable-from-current-captures as a literal reproduction** — see OFFLINE_R_N_REPLAY_AUTHORITY below. |
| `CAN_N_CAPTURE_WITHOUT_UPDATER_EFFECT` | **NO** | `returnedNewState.turnState` is the value the functional updater returned. The literal returned value is not observable outside React. As with R, capturing N at its boundary requires a side effect inside the updater. React processes updater functions sequentially using pending state generated by earlier queued updates, so the "would-have-been" committed value depends on the actual queued-update sequence. **`N = LIVE_UNOBSERVABLE`**; **NOT replayable as a literal reproduction** — see OFFLINE_R_N_REPLAY_AUTHORITY below. |

#### R18 consequence — OFFLINE_R_N_REPLAY_AUTHORITY

```text
OFFLINE_R_N_REPLAY_AUTHORITY = HYPOTHESIS_ONLY

  The original C0 said R and N can be reconstructed offline by
  replaying the pure reducer against B + P. This is INCORRECT in
  general, because:

    1. B is the REQUEST-SITE replica snapshot, not the literal
       updater-input replica. React's pending-state queue may
       have advanced between capture and evaluation.

    2. React's functional updater receives `prevState` that
       includes the result of any earlier queued updaters in
       the same batch. The reducer input at the request site
       does not, in general, equal the reducer input at the
       evaluation site.

  Therefore replaying the reducer against B + P yields a
  HYPOTHESIS, not a live-evidence reconstruction. The regression
  is permissible only as a probe to investigate whether a
  particular boundary is suspect; it is NOT equivalent to live
  updater evaluation.

  Consequence for §4 classification: P/W2/Q/C plus request-site
  replica context may classify LC-E (secondary writer) and some
  queue/order families. LC-A (replica-input authority), LC-B
  (composition), LC-C (React queue), and LC-D (updater impurity)
  cannot be definitively classified from these captures alone
  and may default to LC-F (HALT_CAPTURE_INSUFFICIENT) unless a
  successor probe supplies stronger evidence.
```

### 4.3 Summary (R18 corrected)

```text
CAN_P_CAPTURE                              = YES
CAN_W2_CAPTURE                             = YES    (R19: native W2 identity only;
                                                         no intrinsic _ptadPushId on
                                                         the W2 wire; see §4.4)
CAN_Q_CAPTURE                              = YES
CAN_C_CAPTURE                              = YES

CAN_B_REQUEST_SITE_REPLICA_CAPTURE         = YES    (request-site observation;
                                                         NOT proof of updater-time input)
CAN_B_LITERAL_UPDATER_INPUT_CAPTURE        = NO     → B_LITERAL = LIVE_UNOBSERVABLE

CAN_R_CAPTURE_WITHOUT_UPDATER_EFFECT       = NO     → R = LIVE_UNOBSERVABLE
CAN_N_CAPTURE_WITHOUT_UPDATER_EFFECT       = NO     → N = LIVE_UNOBSERVABLE

OFFLINE_R_N_REPLAY_AUTHORITY               = HYPOTHESIS_ONLY
  (replaying the reducer against B + P is a probe, not live-evidence
   reproduction; see OFFLINE_R_N_REPLAY_AUTHORITY in §4.2)
```

Per plan §3 "B sub-rule": R, N, and B_LITERAL are recorded as `LIVE_UNOBSERVABLE` (never bare `UNAVAILABLE`). R and N are NOT replayable as a literal reproduction; their offline replay is a hypothesis probe only. This satisfies the React purity gate (LCD_T7) without weakening purity to collect forensic evidence.

### 4.4 R19 — W2 push-correlation provenance

The proto contract is:

```proto
rpc subscribeToPartialMessage(EmptyRequest) returns (stream ClineMessage);
```

The stream element is a `ClineMessage`. The wire shape (from `convertClineMessageToProto`) is:

```text
ProtoClineMessage {
  ts, type, ask, say, text, reasoning, images, files,
  partial, seq, epoch, lastCheckpointHash, isCheckpointCheckedOut,
  isOperationOutsideWorkspace, conversationHistoryIndex,
  conversationHistoryDeletedRange, modelInfo, ...
}
```

`_ptadPushId` is stamped only on the snapshot `ExtensionState` push (W1 wire); it is NOT a field on the W2 wire in either direction. The W2 emission path on the extension side is:

```text
WebviewGrpcBridge.pushPartialMessage(message)
  → convertClineMessageToProto(message)   // drops _ptadPushId (not on message)
  → sendPartialMessageEvent(protoMessage) // ClineMessage-typed stream element
```

Therefore:

```text
DOES_W2_EVENT_CARRY_PTAD_PUSH_ID = NO
  (intrinsic; not on the proto element; not stamped by the bridge)
```

The C0 schema therefore records:

```text
w2: {
  ts, epoch, seq, partial, final, ...
}

// W2 records may carry an OPTIONAL associatedPushId stamped at
// the request site, but only with an explicit associationQuality
// marker so the analyzer can reject causal claims it cannot prove.
associatedPushId?: number
associationQuality: "INTRINSIC" | "INTERVAL_INFERRED" | "NONE"
```

Correlation rules:

1. **INTRINSIC** — assertable only when the W2 wire itself carries the
   push ID. For the current proto contract, this is impossible; the
   field is reserved for a future wire amendment that earns a
   separate plan revision.
2. **INTERVAL_INFERRED** — when the W2 request lands between two W1
   snapshots with `prevPushId` and `nextPushId`, the W2 record may
   carry `associatedPushId = undefined` plus `intervalInferred: {
   prevPushId, nextPushId }`. The analyzer correlates by chronology,
   not by identity.
3. **NONE** — when no enclosing W1 snapshot exists (e.g. cold-start
   W2 before the first snapshot lands). The record carries the W2
   native identity fields and is correlated only by `capturedAt` to
   the surrounding P/Q/C records.

```text
W2_PUSH_ID_CORRELATION = NONE_INTRINSIC;
                        INTERVAL_INFERRED via chronology;
                        no causal identity claim
```

A W2 record stamped with `associationQuality = "INTRINSIC"` MUST be
treated as a data-integrity violation by the analyzer; the field
exists only for forward compatibility.

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
  | "webview-w1-request-replica"  // request-site B for W1; replicaRef.current sampled
                                  //   at the request site BEFORE setState is invoked;
                                  //   NOT proof of the literal updater-time input
  | "webview-w2-request-replica"  // request-site B for W2; same disclaimer
  | "webview-committed-c"         // C; React-committed state (LATEST push only)

Type: AssociationQuality = "INTRINSIC" | "INTERVAL_INFERRED" | "NONE"

Type: LiveContextDimensions01Capture {
  readonly stateVersion: number                       // witness (not authority)
  readonly _ptadPushId?: number                       // correlation key (only on W1/C records;
                                                       // undefined for W2 unless INTERVAL_INFERRED)
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
                  replicaStateVersion: number,
                  capturedAt: number }                 // explicitly the request-site
                                                       // wall-clock, NOT the
                                                       // evaluator-time wall-clock
  readonly c?:  { committedTurnState: TurnState | undefined }
  readonly associatedPushId?: number
  readonly associationQuality: AssociationQuality     // how (or whether) _ptadPushId
                                                       // was derived for this record
  readonly intervalInferred?: { prevPushId: number, nextPushId: number }
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
LCD_T7A  NEW_UPDATER_SIDE_EFFECTS      PASS  (= 0; ALL captures at request site
                                                or post-commit; none inside updater)
LCD_T7B  STRICT_MODE_CARDINALITY       PASS  (W2/Q/P request-cardinality: 1:1; C is per-commit)
LCD_T7C  DEFAULT_OFF_EQUIVALENCE       PASS  (recorder is complete no-op when env unset)
LCD_T8   CAPTURE_AT_BOUNDARY           PASS  (rule 1; request-site reads of
                                                 replicaRef.current / stateData / protoMessage)
LCD_T9   PUSH_CORRELATION              PASS  for W1/C (intrinsic _ptadPushId on
                                                 ExtensionState push);
                                                 PARTIAL for W2 (no intrinsic push ID;
                                                 INTERVAL_INFERRED via chronology;
                                                 see §4.4 R19)
LCD_T10  W2_CONTEXT_CAPTURE            PASS  (CAN_W2 = YES; protoMessage carries
                                                 ts/epoch/seq/partial; W2 native identity
                                                 is the canonical correlation key)
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
    webview-w1-request-replica (B0; request-site approximation)
    webview-w2-request-replica (B0; request-site approximation)
    webview-committed-c (C)
- Skip R and N groups; emit nothing for them. Offline replay of
  R and N against B + P is HYPOTHESIS_ONLY — useful as a probe
  for whether the boundary could be reconstructed, never as a
  reproduction of what the literal queued updater evaluated.
- DO NOT IMPLEMENT B_LITERAL, R, or N — they are
  LIVE_UNOBSERVABLE without violating §3 LC_T_PURITY.
- Add tests:
    - default-off witness              (LCD_T7C)
    - StrictMode witness                (LCD_T7B; W2/Q/P request-cardinality)
    - correlation / schema tests
    - removal marker
- VSIX NOT YET built; that is C2.
```

C1 must descend from three SHAs (R24):

```bash
git merge-base --is-ancestor \
  "$IMPLEMENTATION_AUTHORIZED_FROM_HEAD" "$C1_ENTRY_HEAD"

git merge-base --is-ancestor \
  "$REQUIRED_PLAN_ANCESTOR_HEAD"         "$C1_ENTRY_HEAD"

git merge-base --is-ancestor \
  "$C1_REQUIRED_ANCESTOR_HEAD"          "$C1_ENTRY_HEAD"
```

`C1_REQUIRED_ANCESTOR_HEAD = 6449cec47...` is the third floor; it
proves C1 actually contains C0 ∧ C0-CORRECTION01 ∧ R21/R22
plan alignment, not merely R16. The two original floors (R16+R17)
remain unchanged; the third floor is **not** a SHA treadmill — it
is a one-time pin at the C0→C1 contract boundary, exactly as
`REQUIRED_PLAN_ANCESTOR_HEAD` was frozen once at the plan-
completion boundary. Future docs-only commits between
`R21_R22_HEAD` and C1 execution do NOT advance it.

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
