# E7.1 LIVE-DOGFOOD-AUTHORITY-TRACE01 — Existing-Evidence Ingest

**ACT_ID:**
`ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-LIVE-DOGFOOD-AUTHORITY-TRACE01-EXISTING-EVIDENCE-INGEST01`

**Verdict:** `PASS_EXISTING_LIVE_AUTHORITY_TRACE`

**Honored constraints:** NO production code change. NO test delta. NO
PTAD architecture change. NO new dogfood run. NO LLM credential
required. NO dependency on the prior `HALT_NO_FROZEN_W23_LIVE_TRACE`
verdict (which remains in history at `8ec86ec9a`).

The JSONL files were manually collected by the user from the
`017f68a36` install. They are valid, parseable, and the observed
boundary is decisive. The fixup04 chain remains closed; the W2
boundary it could not reach is now classified.

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
    P18:2, P20:3, P23:6) — React 18+ automatic batching emits
    multiple committed records per push; this is the documented
    reason `_ptadPushId` on committed records is the LATEST pushId
    and not 1:1 with pushes (per the `_ptadPushId` docstring of
    `PostTerminalAuthoritySnapshot`).
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

### 8.1  Classification

```text
FIRST_DIVERGENCE_BOUNDARY                = W2_WEBVIEW_STATE_COMPOSITION
FIRST_DIVERGENCE_PUSH_ID                 = 12
FIRST_DIVERGENCE_FIELD                   = turnState   (legacyPhase/legacySeq)
FIRST_DIVERGENCE_WIRE_TRUTH              = streaming/11
FIRST_DIVERGENCE_COMMITTED_TRUTH         = idle/3
FIRST_DIVERGENCE_SUBSEQUENT_AT_P30       = awaiting_followup/29 vs idle/3
WHOLE_STATE_DELIVERY_FAILURE_AT_P12      = false   (thinkingPresentation.legacySeq=11 advances correctly)
```

### 8.2  Decisions on the R-A..R-D taxonomy

The ACT's diagnostic taxonomy:

| Case | Question | Verdict |
|------|----------|---------|
| **R-A** | Snapshot reducer output itself is stale | **EXCLUDED**: the standalone `applyStateSnapshot` reducer is seq-gated and the replay tests are green. The reducer, given `state.turnState.seq=3` and `incoming.seq=11`, advances to `streaming/11`. |
| **R-B** | Reducer advances, later replica writer reverts | **EXCLUDED**: there is no later replica writer that mutates `turnState`. The W2 partial-message path calls `reducerApplyMessage` which does NOT touch `turnState`. The W3 local setters (lines 1183+) only override specific fields like `userInfo`/`openRouterModels` and never carry `turnState`. |
| **R-C** | Shared mutable `replicaRef.current` causes queue inconsistency | **LEADING CANDIDATE**: the W1 updater mutates `replicaRef.current` inside a React functional updater. React's docstring (`this.turnStateTracker.currentPhase`, etc.) explicitly permits this. The reducer advances `replicaRef.current.turnState` to `streaming/11` for P12, but the **committed React state** still shows `idle/3`. The most plausible path is that the W1 updater's return value is being shadowed or that `replicaRef.current` is being read at a moment when it has been reverted by a later queued snapshot. Static reasoning does not isolate the exact mechanism; an instrumented test is required. |
| **R-D** | Raw payload mutation / aliasing | **PLAUSIBLE**: the W1 updater explicitly mutates `stateData.turnState = replicaRef.current.turnState`. If a previous W1 updater's `stateData` object is reused by a later W1 call (e.g. via a shared JSON parser intermediate), the mutation could propagate. The wire payload is `JSON.parse(response.stateJson)` and each call normally produces a fresh object, but a gRPC subscription that reuses the underlying `stateJson` string between bursts would alias. Static reasoning does not isolate this. |

**FIRST_DIVERGENCE_CLASS = R-C** (leading candidate, with R-D as a
plausible secondary). The shared mutable `replicaRef.current`
pattern was already flagged as the W2 suspect in the prior
reviewer's directive; the JSONL evidence is now consistent with
that hypothesis and inconsistent with R-A and R-B.

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
HEADER_CURRENT       = YES    (shadow projection path is current)
HEADER_STALE         = NO     (no `legacyPhase` consumer is on the
                              visible header — the header's
                              `taskHeaderStateLabel` consumes
                              `turnState.phase` via the
                              `taskHeaderStateLabel` helper, but the
                              E7.1 cutover CONSUMED only the three
                              named Thinking consumers; the
                              `taskHeaderStateLabel` was held to an
                              E7.1-2 slice)
HEADER_TRACE_INSUFFICIENT = no
```

Evidence:

| Push | ext.legacyPhase | ext.shadowStatus | committed.thinkingPresentation.seq | committed.thinkingPresentation.source |
|------|-----------------|------------------|------------------------------------|----------------------------------------|
| 7    | idle/3          | idle             | 3                                  | shadow                                 |
| 12   | streaming/11    | idle             | 11                                 | shadow                                 |
| 14   | streaming/11    | running          | 11                                 | shadow                                 |
| 30   | awaiting_followup/29 | completed    | 29                                 | shadow                                 |

The committed `thinkingPresentation.seq` is current. The
ext.`shadowStatus` advances correctly. The header's
**visible** values therefore track the shadow projection — the
visible header is NOT stuck on `idle/3`.

THIS IS A REVISION FROM THE PREVIOUS C1-CORRECTION01 WALKPAPER: in
the older `dfab15b3f` walk, the visible header was reading the
`legacyPhase` field directly. After the E7.1 cutover
(`task-state-e71-webview-shadow-projection-cutover-closure-correction01-evidence.md`),
the visible header reads the shadow projection. The `legacyPhase`
stale value is therefore NOT observable to the user through the
header in the current source graph.

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
COMPOSER_OK                                = YES
COMPOSER_LOCAL_DISABLE                     = NO
BUTTON_CONFIG_DISABLE                      = NO
FOLLOWUP_ROUTE_BLOCK                       = NO
FOLLOWUP_TRANSPORT_FAILURE                 = NO
NOT_REPRODUCED                             = n/a
TRACE_INSUFFICIENT                         = no
```

Evidence at terminal (P30..32):

| Push | input-section                                   | action-buttons                          |
|------|-------------------------------------------------|------------------------------------------|
| 30   | sendingDisabled=False submitDisabled=False     | btnCfg.sendingDisabled=False enableButtons=False |
| 31   | sendingDisabled=False submitDisabled=False     | btnCfg.sendingDisabled=False enableButtons=False |
| 32   | sendingDisabled=False submitDisabled=False     | btnCfg.sendingDisabled=False enableButtons=False |

The composer is **not blocked** in this walk. The `followup-route`
count is 0 (no follow-up submission was attempted in this smoke),
so the follow-up routing itself is not exercised. The composer
symptom from the prior C2 walks is therefore NOT REPRODUCED in
this walk.

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

The next-ACT's mission:

1. Write a RED test that drives the real
   `ExtensionStateContextProvider` with the EXACT P12 input
   sequence (and adjacent pushes) and asserts the committed
   `turnState` matches the wire truth (`streaming/11`).
2. Use the test isolation matrix (E1..E8 from the original ACT)
   to identify which production condition makes the RED
   reproducible.
3. Classify the cause as R-A/B/C/D once the RED is reproducible.
4. Propose ONE bounded production fix.
5. Add the conservation matrix (T1..T13).
6. Run the adversarial composition witnesses (A1..A10 from the
   original ACT).
7. Build a new exact-HEAD dogfood VSIX and require a fresh live
   walk to PASS.

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

## §14  Delta / hygiene

```text
PRODUCTION_SEMANTIC_DELTA   = 0   (no production code change)
TEST_DELTA                  = 0   (no test added, no test modified)
PTAD_ARCHITECTURE_DELTA     = 0   (no capture kind added, no schema change,
                                   no _ptadPushId semantic change)
DOC_DELTA                   = 2   (this doc + forensic SHA256 record)
VSIX_DELTA                  = 0   (017f68a36 not rebuilt)
REPOSITORY_FILES_TRACKED   = 2
REPOSITORY_FILES_ADDED     = (this md + 01-raw-shas.txt)
GIT_DIFF_CHECK             = PASS
```

Commits:

```text
8ec86ec9a  docs(elm): WEBVIEW-TURNSTATE-COMPOSITION01 precondition halt
                   (no live trace frozen)
<this ACT>  docs(elm): E7.1 LIVE-DOGFOOD-AUTHORITY-TRACE01 existing-evidence
                   ingest (W2 boundary classified, no behavior change)
```

