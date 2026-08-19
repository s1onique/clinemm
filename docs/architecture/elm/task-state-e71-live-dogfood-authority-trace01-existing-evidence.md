# E7.1 LIVE-DOGFOOD-AUTHORITY-TRACE01 — Existing-Evidence Ingest

**ACT_ID:**
`ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-LIVE-DOGFOOD-AUTHORITY-TRACE01-EXISTING-EVIDENCE-INGEST01`

**Verdict:** `PASS_EXISTING_LIVE_AUTHORITY_TRACE` (with reviewer-imposed
qualification bounds; see `## §8.1`, `## §8.2`, `## §9`, `## §11`).

**Honored constraints:** NO production code change. NO test delta. NO
PTAD architecture change. NO new dogfood run. NO LLM credential
required. NO dependency on the prior `HALT_NO_FROZEN_W23_LIVE_TRACE`
verdict (which remains in history at `8ec86ec9a`).

**Verdict bounds (per reviewer):**

```text
W2_WEBVIEW_STATE_COMPOSITION       = PROVEN
FIRST_DIVERGENCE_PUSH_ID           = 12
FIRST_DIVERGENCE_FIELD             = turnState
WHOLE_STATE_DELIVERY_FAILURE       = false
TURNSTATE_SELECTIVE_FAILURE        = true
TRANSPORT_LOSS                     = false
WHOLE_SNAPSHOT_LOSS                = false

ROOT_CAUSE_CLASS                   = UNKNOWN
LEADING_ROOT_CAUSE_CANDIDATE       = R-C   (shared mutable replicaRef.current)
R-C PROVEN                         = NO
R-A EXCLUDED                       = NO
R-B EXCLUDED                       = PARTIALLY (writer audit)
R-D (cross-callback JSON.parse alias)  = REJECTED by review
R-D (intra-callback mutation)            = PLAUSIBLE secondary

HEADER_VISUAL_CURRENT              = NOT_PROVEN
HEADER_STATE_AUTHORITY_FROM_TRACE  = TRACE_INSUFFICIENT
HEADER_SHADOW_PROJECTION           = ADVANCES

THINKING_STATE_AUTHORITY           = CURRENT
THINKING_UI_PRESENTATION           = TRACE_INSUFFICIENT
                                    (separate presentation-persistence ACT
                                    required if the user-symptom persists)

COMPOSER_RENDER_SENDABILITY        = OPEN / PASS (terminal observation only)
COMPOSER_LOCAL_DISABLE             = NOT_OBSERVED
BUTTON_CONFIG_DISABLE              = NOT_OBSERVED
FOLLOWUP_ROUTE                     = NOT_EXECUTED
FOLLOWUP_TRANSPORT                 = NOT_EXECUTED
COMPOSER_OVERALL                   = PARTIALLY_QUALIFIED
                                    (composer / follow-up ACT required to
                                    qualify the full path)
```

The JSONL files were manually collected by the user from the
`017f68a36` install. They are valid, parseable, and the observed
boundary is decisive. The fixup04 chain remains closed; the W2
boundary it could not reach is now classified, but the root
cause remains an open question for the next ACT to resolve.

---

## §0  ACT identity

```text
ACT_ID    = ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-LIVE-DOGFOOD-AUTHORITY-TRACE01-EXISTING-EVIDENCE-INGEST01
ENTRY     = 8ec86ec9a5464e6220cd3363579870b686d58c56
ENTRY_TREE = 7248f3ce84d528a34fb61b3b2868ab3df7b7d5db
BRANCH    = act/elm-architecture01-e0-e4
WORKTREE  = clean
STASHES   = 141372c52 (forensic), 371752f71 (context) — intact
```

## §1  Predecessor halt and why it remains valid historically

The previous ACT (`WEBVIEW-TURNSTATE-COMPOSITION01`) closed at
`8ec86ec9a` as `HALT_NO_FROZEN_W23_LIVE_TRACE`. At that moment Cline
had no live walk evidence available. The halt is preserved as-is at
that commit and is NOT undone by this ACT — the previous halt was
correct given what Cline could see at that time.

This ACT begins from the fact that the user has now supplied, via
manual collection, the two PTAD JSONL files that the previous ACT
needed:

```text
EXTENSION_JSONL = /Volumes/UserData/Users/chistyakov/Downloads/post-terminal-authority-diagnostic-extension.jsonl
WEBVIEW_JSONL   = /Volumes/UserData/Users/chistyakov/Downloads/post-terminal-authority-diagnostic-webview.jsonl
```

The previous halt's rationale (no embedded version, no committed live
walk) is preserved for the historical record, but the empirical
question the previous ACT was trying to answer — *"is the
extension/wire/committed triad aligned on `turnState`?"* — is now
empirically answerable from the supplied artifacts.

## §2  Source artifact identity

Recorded in `docs/architecture/elm/evidence/e71-live-dogfood-authority-trace01/01-raw-shas.txt`.

```text
EXTENSION_JSONL
  PATH     = /Volumes/UserData/Users/chistyakov/Downloads/post-terminal-authority-diagnostic-extension.jsonl
  EXISTENT = YES
  TYPE     = JSON data
  BYTES    = 8797
  LINES    = 15
  SHA256   = 577f625929d6cee7d79b2905eca0f91fb9095994fdd3a56fc1aff12318f8a454
  MTIME    = 2026-08-19 03:38:44.876611377 +0300

WEBVIEW_JSONL
  PATH     = /Volumes/UserData/Users/chistyakov/Downloads/post-terminal-authority-diagnostic-webview.jsonl
  EXISTENT = YES
  TYPE     = JSON data
  BYTES    = 24409
  LINES    = 63
  SHA256   = 70c3e309ff8f231dc6dd2a24812b824f2a9c4a42ecf35a148d75d687a935ee77
  MTIME    = 2026-08-19 03:38:44.879676721 +0300
```

Both files share the same mtime to within 3 ms, consistent with a
single terminal dump operation. They were created ~7 minutes after
the `017f68a36` VSIX mtime (2026-08-19 03:31), consistent with the
post-walk dump.

The artifacts are NOT modified in any way. They are NEVER
normalized, pretty-printed, reordered, deduplicated, or
re-serialized. Every byte the JSONL files contain is treated as
canonical.

## §3  Generating VSIX attribution status

```text
TRACE_GENERATING_VSIX   = INFERRED
TRACE_SOURCE_HEAD      = UNKNOWN (not embedded in artifacts)
TRACE_INSTALLED_VERSION = UNKNOWN (not embedded in artifacts)
```

**Status is INFERRED, not PROVEN.** The embedding schema does not
carry version metadata. The ACT is intentionally restrained about
attribution:

1. **Negative disambiguator**: the JSONL files contain **no
   `webview-reducer-output` records**. That capture kind was
   removed in commit `f19dbacb9` (the FIXUP04 source fix), which
   is the source of the `017f68a36` VSIX HEAD. The absence of
   `webview-reducer-output` records is positive disambiguating
   evidence that the dump was produced by a POST-FIXUP04 build.
2. **Capture-kind vocabulary matches current
   `PostTerminalAuthorityCaptureKind`** exactly: `extension-push`,
   `webview-raw-incoming`, `webview-committed`, `input-section`,
   `action-buttons`. The webview file also lacks `webview-replica`
   records, consistent with the FIXUP04 consolidation that
   renamed `webview-replica` → `webview-committed`.
3. **Mtime window**: the JSONL files (03:38) are 7 minutes after
   the `017f68a36` VSIX build (03:31). No other dogfood walk is
   known to have happened in that window.

The trace is firmly attributed to the **post-FIXUP04 production
source graph** (i.e. the source-graph at commit `fd24fc4b5`).
That attribution is sufficient for the next-ACT selection.

The ACT does NOT bind the trace to `017f68a36` as a hard fact.
The inference is recorded for traceability but the classification
that follows depends ONLY on the captured boundary fields and the
production source graph, not on the specific VSIX identity.

## §4  JSONL validation

```text
EXTENSION_JSON_PARSE_ERRORS = 0   (15 non-empty lines, 16 records)
WEBVIEW_JSON_PARSE_ERRORS   = 0   (63 non-empty lines, 64 records)
```

Every non-empty line parses as a single JSON object. No line is
truncated, no line contains unparsable trailing characters, no
record is partially formed.


## §5  Capture-kind inventory

```text
EXTENSION
  extension-push                                       = 16

WEBVIEW
  webview-committed                                    = 24
  input-section                                        = 16
  webview-raw-incoming                                 = 12
  action-buttons                                       = 12
```

Total webview records: 64. No `followup-route` records (consistent
with prior C2 walks; the smoke did not attempt a follow-up
submission, so `followup-route` was never recorded).

The vocabulary matches the current `PostTerminalAuthorityCaptureKind`
enum (per `apps/vscode/src/shared/post-terminal-authority-diagnostic.ts`).
No leftover "older" capture kinds (e.g. `webview-reducer-output`)
appear in the dumps — confirming the dump was produced by the
post-FIXUP04 build.

## §6  Push correlation integrity

```text
EXTENSION push IDs
  distinct   = 16
  range      = 2..32
  duplicates = none

WEBVIEW raw-incoming push IDs
  distinct   = 12
  range      = 7..32
  duplicates = none

WEBVIEW committed push IDs
  distinct   = 12
  range      = 7..32
  duplicates per pushId are EXPECTED (P8:2, P12:2, P14:2, P16:2,
    P18:2, P20:3, P23:6) — `_ptadPushId` on `webview-committed`
    records identifies the LATEST extension push represented by
    the committed state. Multiple committed observations may
    share the same pushId when additional local/context renders
    or commits occur before another extension push advances the
    id. No 1:1 `webview-raw-incoming` ↔ `webview-committed`
    cardinality is assumed by the diagnostic.
```

EXTENSION_WITHOUT_RAW **{2, 4, 5, 6}** — the very first 4
extension pushes predate the moment the webview subscription
stabilized. This is the expected early-walk asymmetry and not a
defect.

RAW_WITHOUT_EXTENSION = **empty** — every webview raw record has
a corresponding extension push record. Clean.

COMMON_SET_SIZE = 12. The 12 reconcilable pushIds (7..32 with
gaps) are the authoritative boundary under analysis.

## §7  Complete / condensed chronology

### 7.1  Full per-push-granularity table

| PID | extension                       | raw (wire)                     | committed_apl                 | committed_rawIn               | ext_thinking_stream | raw_thinking_stream | committed_thinking_stream |
|-----|---------------------------------|--------------------------------|-------------------------------|-------------------------------|---------------------|---------------------|---------------------------|
| 2   | idle/1                          | -                              | -                             | -                             | False (legacy)      | -                   | -                         |
| 4   | idle/3                          | -                              | -                             | -                             | False (shadow)      | -                   | -                         |
| 5   | idle/3                          | -                              | -                             | -                             | False (shadow)      | -                   | -                         |
| 6   | idle/3                          | -                              | -                             | -                             | False (shadow)      | -                   | -                         |
| 7   | idle/3                          | idle/3                         | idle/3                        | idle/3                        | False (shadow)      | False (shadow)      | False (shadow)            |
| 8   | idle/3                          | idle/3                         | idle/3 / idle/3               | idle/3 / idle/3               | False (shadow)      | False (shadow)      | False (shadow)            |
| 10  | idle/3                          | idle/3                         | idle/3                        | idle/3                        | False (shadow)      | False (shadow)      | False (shadow)            |
| 12  | **streaming/11**                | **streaming/11**               | **idle/3 / idle/3**           | **idle/3 / idle/3**           | False (shadow)      | False (shadow)      | False (shadow)            |
| 14  | streaming/11                    | streaming/11                   | idle/3 / idle/3               | idle/3 / idle/3               | False (shadow)      | False (shadow)      | False (shadow)            |
| 16  | streaming/11                    | streaming/11                   | idle/3 / idle/3               | idle/3 / idle/3               | True (shadow)       | True (shadow)       | True (shadow)             |
| 18  | streaming/11                    | streaming/11                   | idle/3 / idle/3               | idle/3 / idle/3               | True (shadow)       | True (shadow)       | True (shadow)             |
| 20  | streaming/11                    | streaming/11                   | idle/3 ×3                     | idle/3 ×3                     | True (shadow)       | True (shadow)       | True (shadow)             |
| 23  | streaming/11                    | streaming/11                   | idle/3 ×6                     | idle/3 ×6                     | True (shadow)       | True (shadow)       | True (shadow)             |
| 30  | **awaiting_followup/29**        | **awaiting_followup/29**       | **idle/3**                    | **idle/3**                    | False (shadow)      | False (shadow)      | False (shadow)            |
| 31  | awaiting_followup/29            | awaiting_followup/29           | idle/3                        | idle/3                        | False (shadow)      | False (shadow)      | False (shadow)            |
| 32  | awaiting_followup/29            | awaiting_followup/29           | idle/3                        | idle/3                        | False (shadow)      | False (shadow)      | False (shadow)            |

### 7.2  Transition table (when does anything change?)

The ONLY column that does not advance is **`committed_apl.turnState`**
(boldmark: `idle/3` from P12 onward). Every other column advances
in lockstep with the wire truth.

```text
PID=4   ext adv: idle/1 → idle/3 (+seq)
         ext thnk: legacy → shadow
PID=7   raw arrives (webview subscription stabilizes)
         committed matches raw (idle/3)
PID=12  ext & raw adv: idle/3 → streaming/11 (+seq)
         committed STAYS at idle/3                        ← FAIL
PID=14  ext & raw adv: streaming/11 (same seq)
         committed STAYS at idle/3                        ← FAIL
PID=16  ext shadow adv: running/False → running/True
         ext & raw thnk: modelStreaming False → True
         committed STAYS at idle/3 (but thnk advances)    ← FAIL
PID=20  ext raw: streaming/11 (same seq)
         committed STAYS at idle/3 (3 commits)            ← FAIL
PID=23  ext raw: streaming/11 (same seq)
         committed STAYS at idle/3 (6 commits)            ← FAIL
PID=30  ext & raw adv: streaming/11 → awaiting_followup/29 (+seq)
         committed STAYS at idle/3                        ← FAIL
PID=32  ext & raw: awaiting_followup/29 (same seq)
         committed STAYS at idle/3                        ← FAIL
```

### 7.3  Single-event P12 trace (most diagnostic row)

```
1787099909220  PID=12 ext          legacy=streaming/11
1787099909221  PID=12 raw          rawIn=streaming/11 think_seq=11
1787099909222  PID=12 buttons      btnCfg.sendingDisabled=false btnCfg.enableButtons=false
1787099909222  PID=12 input        sendingDisabled=false submitDisabled=false allowQueued=false
1787099909222  PID=12 committed    apl=idle/3 rawIn=idle/3 think_seq=11
1787099909233  PID=12 input        sendingDisabled=true submitDisabled=true
1787099909338  PID=12 committed    apl=idle/3 rawIn=idle/3 think_seq=11
```

The wire advances `streaming/11` at `1787099909221`. The immediately
following React commit at `1787099909222` (1 ms later) shows `idle/3`.
The `thinkingPresentation` field, by contrast, advances correctly to
seq=11 (the per-push truth for that field). This is the **selective
`turnState` composition failure** the original ACT hypothesized.


## §8  First divergence

### 8.1  Classification (PROVEN portion)

```text
FIRST_DIVERGENCE_BOUNDARY                = W2_WEBVIEW_STATE_COMPOSITION   [PROVEN]
FIRST_DIVERGENCE_PUSH_ID                 = 12
FIRST_DIVERGENCE_FIELD                   = turnState   (legacyPhase/legacySeq)
FIRST_DIVERGENCE_WIRE_TRUTH              = streaming/11
FIRST_DIVERGENCE_COMMITTED_TRUTH         = idle/3
FIRST_DIVERGENCE_SUBSEQUENT_AT_P30       = awaiting_followup/29 vs idle/3
WHOLE_STATE_DELIVERY_FAILURE_AT_P12      = false   (thinkingPresentation.legacySeq=11 advances correctly)
```

The PROVEN portion is bounded to the OBSERVABLE boundary. The
JSONL records only two observable webview boundaries
(`webview-raw-incoming` and `webview-committed`). The wire/committed
mismatch on `turnState`, in the presence of a corresponding
non-mismatch on `thinkingPresentation`, is what the trace
establishes.

### 8.2  Root cause (LEADING CANDIDATE, not PROVEN)

```text
ROOT_CAUSE_CLASS                 = UNKNOWN
LEADING_ROOT_CAUSE_CANDIDATE     = R-C   (shared mutable replicaRef.current)
SECONDARY_ROOT_CAUSE_CANDIDATE   = R-D   (intra-callback mutation or
                                              ownership defect)
R-A ACTUAL_REPLICA_INPUT_STATE   = OPEN  (not excluded — see 8.3)
R-B STALE_WRITER_REVERTS         = PARTIALLY_EXCLUDED (writer audit below)
R-C LEADING                      = yes
R-C PROVEN                       = no
```

#### 8.2.1  R-C — LEADING CANDIDATE

The W1 updater mutates `replicaRef.current` inside a React
functional updater. The reducer advances
`replicaRef.current.turnState` to `streaming/11` for the
isolated state, but the **committed React state** still shows
`idle/3`. The most plausible path is that the W1 updater's
return value is being shadowed, or that `replicaRef.current`
is being read at a moment when it has been reverted by a
later queued snapshot. Static reasoning does not isolate the
exact mechanism; the RED ACT's instrumented test is required
to convert this candidate into a cause.

#### 8.2.2  R-D — PLAUSIBLE SECONDARY

A real R-D mechanism could exist as an intra-callback mutation
or ownership defect: e.g. the raw `stateData` is mutated by
the W1 updater (line 647) and an object reference from the
computed state is subsequently mutated before/while becoming
committed.

The previous draft's specific R-D rationale — that `JSON.parse`
on a reused `stateJson` string causes object aliasing — was
**rejected by review**. `JSON.parse` constructs a new object
graph for every call regardless of whether the source string
is reused; the string reuse cannot produce an alias. That
rationale has been removed from this section.

#### 8.2.3  R-A — NOT EXCLUDED

R-A ("the actual live `replicaRef.current` presented to the
reducer at P12 was not the isolated `idle/3` we assume") cannot
be excluded by the trace alone. The standalone replay tests
prove the reducer's *isolated* behavior is correct, but the
JSONL does not capture the value of `replicaRef.current` at
the moment the live W1 updater ran the reducer. A different
R-A subclass (e.g. an upstream mutation that left the replica
at `seq >= 11` before P12 arrived, so the reducer correctly
returned the same state) is consistent with the JSONL. The
RED ACT must explicitly probe this.

#### 8.2.4  R-B — PARTIALLY EXCLUDED

R-B is partially excluded by writer audit:

* The W2 partial-message path calls `reducerApplyMessage` and
  does NOT touch `turnState`.
* The W3 local setters (lines 1183+ of `ExtensionStateContext.tsx`)
  only override specific fields like `userInfo`/
  `openRouterModels` and never carry `turnState`.

A 100% exclusion of R-B requires a complete writer audit, which
is out of scope for the ingest ACT. The RED ACT's instrumented
test is the proper discriminator.

### 8.3  What static analysis CANNOT determine

The exact mechanism within the W1 updater that prevents the
expected `newState.turnState = streaming/11` from propagating to
the React commit cannot be determined from the JSONL alone. The
JSONL is recorded at the OBSERVABLE boundaries only (the wire
arrival and the post-commit React state). The intermediate state
of `replicaRef.current` is not captured, and the W1 updater body
itself is not in the trace.

The next-ACT must add a unit-level RED test that drives the real
`ExtensionStateContextProvider` and asserts the committed
`turnState` per push. That test is the next-ACT deliverable, not
this ACT's.

### 8.4  No-divergence branch

The `NO_STATE_AUTHORITY_DIVERGENCE` verdict is EXCLUDED here. The
extension/wire/committed triad on `turnState` is misaligned at
P12, P14, P16, P18, P20, P23, P30, P31, P32 — 9 of the 12
reconcilable pushes. The divergence is not a transient; it is
persistent.

## §9  Header disposition

```text
HEADER_STATE_AUTHORITY_FROM_TRACE   = TRACE_INSUFFICIENT
HEADER_VISUAL_CURRENT               = NOT_PROVEN
HEADER_SHADOW_PROJECTION            = ADVANCES (committed.thinkingPresentation.seq
                                        moves 3 → 11 → 29 in step with
                                        the wire; ext.shadowStatus moves
                                        idle → running → completed)
```

### 9.1  What the trace does and does not establish

The trace establishes:

* The extension's `shadowStatus` advances correctly
  (`idle → running → completed`).
* The committed `thinkingPresentation.seq` advances correctly
  (3 → 11 → 29) with `source = "shadow"`.
* The committed `thinkingPresentation.modelStreaming` flips
  False → True during streaming and back to False at terminal,
  in step with the wire.

The trace does **not** establish:

* That any specific visible header element consumes the shadow
  projection channel rather than `turnState.phase` directly. The
  E7.1 cutover migrated three named Thinking consumers
  (`ChatRow` `case "reasoning"`, `RequestStartRow` inline
  shimmer, `useThinkingLoaderRow`) to read the shadow projection;
  the `TaskHeader`'s `taskHeaderStateLabel` helper was explicitly
  held for an E7.1-2 slice and still consumes `turnState.phase`.
* Whether the visible header is therefore current, stale, or
  mixed.

### 9.2  Source-recon to qualify this (next-ACT deliverable)

The next-ACT (or a smaller header-trace sub-ACT) must enumerate
the currently displayed header fields and the selectors they
consume. Until that audit is performed, the verdict on
`HEADER_VISUAL_CURRENT` remains `NOT_PROVEN`.

### 9.3  Historical revision note

The previous C1-CORRECTION01 walkpaper (`dfab15b3f`) concluded
`HEADER_CURRENT = YES`. That conclusion was based on the
header at that time reading the shadow projection channel. The
E7.1 cutover has since partially changed the header's data
sources (per the source comment at
`task-state-e71-webview-shadow-projection-cutover-closure-correction01-evidence.md`),
so the older `dfab15b3f` conclusion does not transfer to the
current source graph without a fresh audit.

## §10  Thinking disposition

```text
THINKING_CONSUMER_PRESENTATION   = TRACE_INSUFFICIENT
THINKING_STATE_AUTHORITY         = CURRENT
THINKING_NOT_REPRODUCED          = n/a
```

Evidence: the committed `thinkingPresentation` record advances
correctly:

| Push | committed.thinkingPresentation                       |
|------|------------------------------------------------------|
| 12   | modelStreaming=False, source=shadow, seq=11          |
| 16   | modelStreaming=True,  source=shadow, seq=11          |
| 30   | modelStreaming=False, source=shadow, seq=29          |

The state authority for `thinkingPresentation` is current and
correct. Therefore the static `Thinking` UI persistence symptom
(if it still reproduces for the user) is **NOT** a state-authority
defect — it is a **presentation-persistence defect** in the
`useThinkingLoaderRow`/`ChatRow Thinking-row` rendering.

The JSONL does not capture the visual presentation, so the
ACT CANNOT confirm whether static `Thinking` is still visible to
the user. The next-ACT for that symptom is a separate, smaller
presentation-persistence slice (not part of this ACT's scope).

## §11  Composer disposition

```text
COMPOSER_RENDER_SENDABILITY = OPEN  / PASS
COMPOSER_RENDER_GATE        = ENABLED
COMPOSER_LOCAL_DISABLE      = NOT_OBSERVED
BUTTON_CONFIG_DISABLE       = NOT_OBSERVED
FOLLOWUP_ROUTE              = NOT_EXECUTED
FOLLOWUP_TRANSPORT          = NOT_EXECUTED
COMPOSER_OVERALL            = PARTIALLY_QUALIFIED
```

### 11.1  What the trace does establish

Evidence at terminal (P30..32):

| Push | input-section                                   | action-buttons                          |
|------|-------------------------------------------------|------------------------------------------|
| 30   | sendingDisabled=False submitDisabled=False     | btnCfg.sendingDisabled=False enableButtons=False |
| 31   | sendingDisabled=False submitDisabled=False     | btnCfg.sendingDisabled=False enableButtons=False |
| 32   | sendingDisabled=False submitDisabled=False     | btnCfg.sendingDisabled=False enableButtons=False |

At terminal, the composer render gate is **open**: nothing in the
captured input-section or action-buttons fields is blocking the
send button. A user with this state would see an enabled send
button at the end of the walk.

### 11.2  What the trace does NOT establish

* `FOLLOWUP_ROUTE` — the `followup-route` capture kind
  appeared 0 times in the webview JSONL. The walk did not
  attempt a follow-up submission, so the follow-up routing
  path is `NOT_EXECUTED` in this trace. A blocked
  `followup-route` is not excluded; a transport failure on the
  follow-up channel is not excluded.
* `COMPOSER_LOCAL_DISABLE` — observed only in the
  `sendingDisabled` / `submitDisabled` captures, which are
  False at terminal. Intermediate moments of disable (e.g. the
  P8 `sendingDisabled=true` at 1787099908973) were observed,
  but no sustained local-only disable was reproduced.
* `BUTTON_CONFIG_DISABLE` — observed only in
  `buttonConfig.sendingDisabled`, which is False at terminal.
  The `enableButtons` field is False throughout, but per the
  schema `enableButtons` does not gate sending; it gates the
  auxiliary command buttons.

### 11.3  What the prior C2 symptom was

The historical user symptom was "can't send the next prompt".
That symptom requires (a) the send button to be disabled, OR
(b) the follow-up route to be blocked, OR (c) a follow-up
transport failure. None of (a), (b), or (c) is proven by this
trace. (a) and (c) are NOT_OBSERVED; (b) is NOT_EXECUTED.

A `COMPOSER_OK = YES` verdict is therefore too broad. The
correct disposition is `COMPOSER_RENDER_SENDABILITY = OPEN` at
the terminal observation, with the follow-up path
`NOT_EXECUTED`. A separate composer / follow-up ACT (or a
follow-up-prompt variant of this trace) is required to qualify
the full path.

## §12  Targeted source recon

The first divergence is W2, so the source-recon scope is the
webview state composition layer:

```text
apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx
  - Line 39-118:    buildWebviewSnapshot                                   (capture factory)
  - Line 540-696:   W1 subscription handler (state pushes via gRPC)
  - Line 633-647:   W1 functional updater (reducer + replicaRef write)
  - Line 647:       stateData.turnState = replicaRef.current.turnState   (the mutation)
  - Line 818-855:   W2 partial-message handler
  - Line 844:       replicaRef.current = reducerApplyMessage(before, ...) (W2 share)
  - Line 1011-1042: post-commit useEffect for webview-committed capture
```

Key readings:

1. The W1 updater (line 630) is a pure functional updater that
   returns a new `state` object. Inside the updater body:
   - `replicaRef.current` is mutated by the reducer (line 640).
   - `stateData.turnState` is mutated by the assignment at line 647.
   - `newState` is built by spreading `stateData` AND overriding
     `autoApprovalSettings` from `prevState` (line 654).
2. The bug-defeating expectation: if `replicaRef.current.turnState`
   is `streaming/11` after the reducer call, then `stateData.turnState`
   becomes `streaming/11`, and `newState.turnState` becomes `streaming/11`.
3. The committed record shows `idle/3`. So either:
   - The reducer did NOT advance `replicaRef.current.turnState`
     (R-A subclass: would require `state.turnState.seq >= 11` at
     the moment of the reducer call, which the JSONL does not
     show).
   - The reducer advanced but `stateData.turnState` was overwritten
     somewhere between line 647 and the React commit (R-D subclass).
   - React's update queue discarded the W1 updater's return value
     (R-C subclass: shared `replicaRef.current` mutation disrupts
     the queue ordering).

Static reasoning cannot isolate the mechanism. The next-ACT
must add a unit-level RED test that drives the real
`ExtensionStateContextProvider` and asserts the committed
`turnState` per push.

## §13  Next-ACT selection

```text
NEXT_ACT = ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-TURNSTATE-COMPOSITION-RED-FIX01
```

The next-ACT's first job is **not** to "fix `replicaRef`." Its
first job is to convert a candidate into a cause by instrumenting
the live boundary:

1. Drive the real `ExtensionStateContextProvider` with the EXACT
   P12 input sequence (and adjacent pushes).
2. Reproduce the symptom: incoming `streaming/11` → committed
   `idle/3`.
3. Expose the intermediate state at each step of the W1
   updater:
   * raw input `turnState`
   * `replicaRef.current.turnState` *before* the reducer call
   * `replicaRef.current.turnState` *after* the reducer call
   * `stateData.turnState` after the in-place mutation
   * `newState.turnState` returned from the functional updater
   * committed `state.turnState` (already captured)
4. From that single RED, distinguish R-A (actual replica input
   state was different) from R-C (queue/shared-replica behavior
   rejected the return) from a real R-D mechanism.
5. Propose ONE bounded production fix in the webview
   composition substrate.
6. Add the conservation matrix (T1..T13).
7. Run the adversarial composition witnesses (A1..A10 from the
   original ACT).
8. Build a new exact-HEAD dogfood VSIX and require a fresh live
   walk to PASS with `extension == raw == committed`.

The next-ACT MUST observe the original ACT's halt rules:

- H5: real RED must reproduce the live W2 failure.
- H7: must be a single root cause.
- H8: production fix must remain in the webview composition
  substrate.
- H16: no new type errors.
- H17: regression must not break the frozen reducer safety.
- H20: post-fix live walk must show `extension == raw == committed`.

This ACT does not open the next-ACT. The reviewer must
authorize it.

The leading candidate (R-C) MUST NOT be used to pre-bias the RED
construction. The RED must be neutral with respect to R-A, R-C,
and R-D, and let the intermediate state instrumentation reveal
which is the actual cause.

## §14  Delta / hygiene

```text
PRODUCTION_SEMANTIC_DELTA   = 0   (no production code change)
TEST_DELTA                  = 0   (no test added, no test modified)
PTAD_ARCHITECTURE_DELTA     = 0   (no capture kind added, no schema change,
                                   no _ptadPushId semantic change)
DOC_DELTA                   = 2   (this doc + forensic SHA256 record)
VSIX_DELTA                  = 0   (017f68a36 not rebuilt)
REPOSITORY_FILES_TRACKED    = 2
REPOSITORY_FILES_ADDED      = (this md + 01-raw-shas.txt)
GIT_DIFF_CHECK              = PASS
    (verified: `git diff --check HEAD~1..HEAD`,
     `git diff --check ed184c042..HEAD`, and
     `git diff --check` on the uncommitted state)
```

Commits:

```text
8ec86ec9a  docs(elm): WEBVIEW-TURNSTATE-COMPOSITION01 precondition halt
                   (no live trace frozen)
a4908d59c  docs(elm): E7.1 LIVE-DOGFOOD-AUTHORITY-TRACE01 existing-evidence
                   ingest (W2 boundary classified, no behavior change)
<correction> docs(elm): TRACE01 hygiene + qualification bounds
                   (reviewer-imposed: EOF cleanup, root-cause demoted to
                    LEADING CANDIDATE, header/composer downgraded to
                    TRACE_INSUFFICIENT / NOT_EXECUTED, R-D cross-callback
                    aliasing rationale removed)
```
