# ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-TURNSTATE-LIVE-CONTEXT-DIMENSIONS01

**STATUS:** AUTHORIZED
**ENTRY HEAD:** f41d69d2a83aa625f0195b757df54a0805c4e65f
**PRECONDITION:** LIVE-SHAPE-REPRODUCTION01 CLOSED_PARTIAL / TRACE_DIMENSIONS_EXHAUSTED
**MISSION:** Acquire the minimum live-only evidence needed to explain why `webview-raw-incoming(streaming/11)` becomes `webview-committed(idle/3)`, **without** changing application-state semantics and **without** attempting a repair.

---

## §0  Why this ACT exists

TRACE01 proved:

```text
webview-raw-incoming streaming/11  ─┐
                                    ├──>  webview-committed idle/3
                                    │      (committed is stale / wrong)
```

LIVE-SHAPE-REPRODUCTION01 established that the synthetic minimal
provider cannot reproduce that raw→committed divergence. Its
`FIRST_GREEN_TO_RED_DELTA = NOT_FOUND`.

Therefore the synthetic GREEN witness is preserved, but **no
further synthetic ladder rung can advance** until the missing
intermediate observations are acquired from the live path:

| Live dimension                                          | Status                  |
|---------------------------------------------------------|-------------------------|
| snapshot epoch                                           | UNAVAILABLE_FROM_TRACE  |
| replica epoch (immediately before W1)                    | UNAVAILABLE_FROM_TRACE  |
| snapshot stateVersion                                    | known (0); matches BASE |
| replica stateVersion (immediately before W1)             | UNAVAILABLE_FROM_TRACE  |
| W1 invocation ordinal per pushId                          | UNAVAILABLE_FROM_TRACE  |
| prevState.turnState (the actual reducer argument)         | UNAVAILABLE_FROM_TRACE  |
| reducer-output turnState                                   | UNAVAILABLE_FROM_TRACE  |
| reducer-output epoch/stateVersion                          | UNAVAILABLE_FROM_TRACE  |
| returned newState.turnState                                | UNAVAILABLE_FROM_TRACE  |
| partial-message epoch / ts / seq                           | UNAVAILABLE_FROM_TRACE  |
| queued local setState writers between raw and commit      | UNAVAILABLE_FROM_TRACE  |

This ACT captures them. It does **not** explain them.

---

## §1  Frozen authority

```text
ENTRY_HEAD                = f41d69d2a83aa625f0195b757df54a0805c4e65f

TRACE01_W2                = PROVEN
  P12 raw                 = streaming/11
  P12 committed            = idle/3
  P30 raw                 = awaiting_followup/29
  P30 committed            = idle/3

ROOT_CAUSE                = UNKNOWN
PRODUCTION_FIX_AUTHORIZED = false
E8_AUTHORIZED             = false
E9_AUTHORIZED             = false

PREDECESSORS =
  RED-FIX01                          ✅ CLOSED_HALTED_CLEAN
  LIVE-SHAPE-REPRODUCTION01          ✅ CLOSED_PARTIAL (R10 FIXUP)

GREEN/RED vocabulary inherited from LIVE-SHAPE §2 (single source
of truth):

  GREEN                — W2 absent; raw == committed
  RED                  — W2 present;  raw != committed
  ALREADY_MATCHED      — same value as BASE on this dimension;
                         not evidence
  UNAVAILABLE_FROM_TRACE — trace did not capture; do NOT fabricate
  BASE                 — known-good real-provider fixture;
                         GREEN by construction
  Stop at the first RED.
```

No fact in this document overrides the GREEN/RED vocabulary. Any
"the committed turnState is X" verdict inherits GREEN/RED semantics
from LIVE-SHAPE §2 verbatim.

---

## §2  Capture groups (boundary-oriented)

The trace is mechanically readable as a pipeline:

```text
RAW(P)
  → BEFORE(P, n)
  → REDUCER(P, n)
  → RETURN(P, n)
  → COMMIT(P)
```

with W2/other-writer records interleaved by timestamp and push
identity. Every observation below is anchored to exactly one of
these boundaries.

```text
P — PUSH IDENTITY
  pushId                       (must reuse existing _ptadPushId
                                for correlation)
  stateVersion
  snapshot epoch

B — BEFORE W1 UPDATER
  invocationOrdinalForPush     (1st, 2nd, ... updater evaluation)
  prevState.turnState          (the literal reducer arg, copied
                                at this boundary, NOT reconstructed)
  replica.turnState
  replica.epoch
  replica.stateVersion

R — REDUCER OUTPUT
  incomingSnapshot.turnState   (the W1 input snapshot's turnState)
  reducerOutput.turnState      (the literal value reducer returned,
                                copied at this boundary)
  reducerOutput.epoch
  reducerOutput.stateVersion

N — RETURNED NEW STATE
  returnedNewState.turnState   (what the caller committed to React)

W2 — PARTIAL-MESSAGE INTERFERENCE
  partial epoch
  partial ts
  partial seq
  partial/final discriminator

Q — UPDATE REQUEST (write only, not effect)
  writerIdentity               (W1_SNAPSHOT_REQUEST, W2_PARTIAL_REQUEST,
                                SET_USER_INFO_REQUEST, etc.)
  associatedPushIdOrKey        (correlation only)

C — COMMIT
  committedTurnState           (existing webview-committed record,
                                read at this boundary)
  committedAt                  (monotonic ordering with raw)
```

The five boundary guarantees:

1. Each record copies scalar values **at its named boundary**.
   No record may reconstruct `replicaBefore := currentReplica`
   or `rawSnapshot := mutatedStateData`.
2. Capture is **observation-only**. It must not influence the
   observed code path.
3. Each observation may be `UNAVAILABLE` if the boundary cannot
   be observed live without violating (2). Recording
   `UNAVAILABLE` is preferred to fabricating a value.
4. Records are tagged with the `_ptadPushId` they belong to so
   they can be correlated with the existing TRACE01 JSONL.
5. Records carry no application-state semantic delta. Anything
   observable from the webview today remains observable; nothing
   new is exported on the public API.

---

## §3  Hard React-purity gate (LCD_T7)

React documents that functional updater functions are queued and
executed during rendering, that they must be pure, and that
development Strict Mode intentionally re-invokes them twice to
expose accidental impurity. Strict Mode likewise intentionally
re-invokes functions expected to be pure to surface mutations and
side effects.

Therefore the following is **forbidden** in any diagnostic added
during this ACT:

```text
LC_T_PURITY:
  diagnostic code MUST NOT:
    - append records inside a functional updater
    - mutate a diagnostic ref inside an updater
    - increment forensic counters inside an updater
    - call other setters from inside an updater purely for
      diagnostics
```

For each requested intermediate:

```text
A. First try to observe it without changing updater purity.

B. If the intermediate cannot be observed without an updater-side
   effect:
     LIVE_OBSERVABILITY = UNAVAILABLE
     derive/replay later from immutable captured inputs
     (e.g., return value of a pure reducer call replayed in a
     test harness against captured immutable state)

C. Do NOT weaken purity to collect forensic evidence.
```

**This gate applies to the ACT only.** Pre-existing application
setters / updater functions are legitimate suspects under
investigation; the ACT may record their externally visible
*request* boundaries (the "Q" group above), but it must not
introduce new mutation or side effects inside an updater for the
sake of measurement.

The Q-group contract is precisely that:

```text
Q records may be emitted only from the event/callback boundary
that REQUESTS an update

Q records must NOT be emitted from inside the functional updater
that CALCULATES it
```

---

## §4  Mechanically decidable classification

After capture, the first divergent push `P` is classified into
exactly one of the following families. These are **classifications,
not fix authorizations.** Each one is allowed to authorize a
follow-up reproduction ACT, never a production fix.

```text
LC-A  REPLICA_INPUT_AUTHORITY
      replica-before is already high-authority / stale such that
      the reducer rejects the incoming streaming/11
      → next ACT: REPLICA-AUTHORITY-REPRODUCTION01

LC-B  COMPOSITION
      reducer output = streaming/11
      returned newState = idle/3
      → next ACT: COMPOSITION-REPRODUCTION01

LC-C  REACT_QUEUE / LATER_WRITER
      returned newState = streaming/11
      committed = idle/3
      → next ACT: REACT-QUEUE-REPRODUCTION01

LC-D  SHARED_MUTABLE_AUTHORITY / UPDATER_IMPURITY
      same push's repeated updater evaluation observes different
      external replica inputs (e.g., second invocation sees
      different replica.turnState than the first)
      → next ACT: UPDATER-IMPURITY-REPRODUCTION01

LC-E  SECONDARY_WRITER
      another update request between raw and commit carries or
      reconstructs stale turnState
      → next ACT: SECONDARY-WRITER-REPRODUCTION01

LC-F  HALT_CAPTURE_INSUFFICIENT
      available observations do not isolate one boundary
      → close this ACT as HALT_CAPTURE_INSUFFICIENT;
        escalate to a successor evidence ACT
```

Crucially:

- LC-A..E do **not** license a fix by themselves.
- LC-A..E each license one specific successor ACT (named).
- LC-F halts this ACT cleanly without further speculation.
- No other classification is permitted. If the live data doesn't
  fit any of these, the ACT halts as `CAPTURE_INSUFFICIENT`.

---

## §5  Temporary instrumentation contract

The instrumentation added by this ACT is temporary. It carries
explicit removal semantics, no permanent public API, no
permanent wire fields.

```text
DIAGNOSTIC_ID    = E71_LIVE_CONTEXT_DIMENSIONS01

OPT_IN           = true
DEFAULT_OFF      = true
ENABLE_FLAG      = process.env.CLINE_LIVE_CONTEXT_DIMENSIONS01 === '1'
                  (or equivalent feature flag; chosen at impl time)
STATE_SEMANTIC_DELTA   = 0
PUBLIC_PRODUCT_API_DELTA = 0
WIRE_FIELD_DELTA        = 0

TEMPORARY        = true
REMOVAL_REQUIRED = true

REMOVAL_TRIGGER = first of:
    (a) a root-cause family is classified LC-A..E and a follow-up
        reproduction ACT succeeds
    (b) the ACT closes as HALT_CAPTURE_INSUFFICIENT (LC-F)
    (c) a successor evidence ACT supersedes this schema

PERMANENT_PUBLIC_API_ALLOWED    = false
PERMANENT_WIRE_FIELD_ALLOWED    = false unless separately reviewed
E8_AUTHORITY_CHANGE             = forbidden
E9_AUTHORITY_CHANGE             = forbidden
```

**Dedicated forensic record type preferred.** Do **not** extend
`PostTerminalAuthoritySnapshot` into a general debugger. Reuse
`_ptadPushId` only as the correlation key.

---

## §6  Acceptance gate

```text
LCD_T0   ENTRY_IDENTITY                PASS   (HEAD == f41d69d2a)
LCD_T1   TRACE01_PREDECESSOR           CLOSED_CLEAN
LCD_T2   LIVE_SHAPE_PREDECESSOR        CLOSED_PARTIAL  (R10 FIXUP)
LCD_T3   GREEN_RED_VOCABULARY          CANONICAL       (LIVE-SHAPE §2)

LCD_T4   TEMP_SCHEMA_DEFINED           PASS            (this ACT)
LCD_T5   DEFAULT_OFF                   PASS
LCD_T6   NO_STATE_SEMANTIC_DELTA       PASS
LCD_T7   UPDATER_PURITY_GATE           PASS            (LC_T_PURITY)
LCD_T8   CAPTURE_AT_BOUNDARY           PASS            (no after-the-fact
                                                    reads)
LCD_T9   PUSH_CORRELATION              PASS            (_ptadPushId reused)
LCD_T10  W2_CONTEXT_CAPTURE            PASS
LCD_T11  WRITER_REQUEST_CAPTURE        PASS            (Q-group only)
LCD_T12  REMOVAL_CONTRACT              PASS            (§5)

LCD_T13  EXISTING_WEBVIEW_TESTS        PASS            (no test delta)
LCD_T14  TYPES                         PASS
LCD_T15  BIOME                         PASS
LCD_T16  DIFF_HYGIENE                  PASS            (no config delta)
LCD_T17  PROTECTED_STASHES             PASS            (141372c52 + 371752f71)

LCD_T18  EXACT_HEAD_VSIX               PASS            (8a7f1236... vs
                                                    post-ACT vsix)
LCD_T19  LIVE_TRACE_ACQUIRED           AWAIT_USER      (this ACT's primary
                                                    output)
LCD_T20  ROOT_CAUSE_FAMILY             A|B|C|D|E|F     (LC- classification
                                                    from §4)
```

The primary exit criterion for this ACT is **either**:

```text
PASS_LIVE_CONTEXT_DIMENSIONS_ACQUIRED
```

or, if the capture cannot isolate a boundary:

```text
HALT_CAPTURE_INSUFFICIENT
```

In neither case does the ACT itself authorize a fix.

---

## §7  Out of scope

This ACT does **not** authorize:

- any production code change that alters state semantics
- any permanent public API
- any permanent wire field
- E8 (recorder/converter separation)
- E9 (authority/visibility flip)
- any other side-effect on the existing GREEN witness test

The ACT may **observe** the existing app side, but it must
not **change** the existing app side.

---

## §8  Non-blocking residue

R11 (stale overclaim in the retained GREEN-witness test comment
that says "the simple `replicaRef + batching` story is shown
empirically closed", which the later cleanup evidence correctly
narrows to `MINIMAL_W1_W2_W1_BATCHING_HYPOTHESIS = NOT_REPRODUCED`
+ `GLOBAL_REPLICA_QUEUE_INTERACTION = NOT_EXCLUDED`) is not
addressed by this ACT.

If/when a future ACT cleans it up, it does so as a
docs/test-prose-only fixup, never by weakening the GREEN-witness
or by altering any test assertion. It is **not** a blocker for
LIVE-CONTEXT-DIMENSIONS01.

---

## §9  Board after this ACT authorization

```text
TRACE01                                  ✅ CLOSED_CLEAN
  live W2 raw→committed                   ✅ PROVEN
  root cause                              ❓ UNKNOWN

RED-FIX01                                ✅ CLOSED_HALTED_CLEAN
  minimal synthetic W2                    GREEN / NOT_REPRODUCED
  production delta                        0

LIVE-SHAPE-REPRODUCTION01                ✅ CLOSED_PARTIAL
  stateVersion                            ALREADY_MATCHED
  remaining live dimensions              UNAVAILABLE_FROM_TRACE
  first GREEN→RED delta                   NOT_FOUND
  producer reclassification              RETRACTED
  GREEN/RED vocabulary                    ✅ CANONICAL (R10 FIXUP)

R11 stale test prose                     🟡 NON-BLOCKING CLEANUP

LIVE-CONTEXT-DIMENSIONS01                🟢 AUTHORIZED (this ACT)
  evidence acquisition only
  temporary instrumentation
  updater-purity hard gate
  explicit removal clause
  no repair

E8                                       ⛔ HOLD
E9                                       ⛔ HOLD
```
