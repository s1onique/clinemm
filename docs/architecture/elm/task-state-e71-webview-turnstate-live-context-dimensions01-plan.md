# ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-TURNSTATE-LIVE-CONTEXT-DIMENSIONS01

**STATUS:** AUTHORIZED (R12+R13 fixup applied)
**AUTHORIZATION_BASE_HEAD:** f41d69d2a83aa625f0195b757df54a0805c4e65f (LIVE-SHAPE R10 FIXUP ancestor)
**PLAN_FREEZE_HEAD:** dd4f08d7c348373a9dba5bf8378ebf53e2754c6f (this ACT's first plan commit)
**IMPLEMENTATION_ENTRY_HEAD:** dd4f08d7c348373a9dba5bf8378ebf53e2754c6f (literal HEAD at C0..C4 start; R12)
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

| Live dimension                                          | Status (epistemic)        |
|---------------------------------------------------------|---------------------------|
| snapshot epoch                                           | UNAVAILABLE_FROM_TRACE    |
| replica epoch (immediately before W1)                    | LIVE_UNOBSERVABLE (R13)   |
| snapshot stateVersion                                    | ALREADY_MATCHED           |
| replica stateVersion (immediately before W1)             | LIVE_UNOBSERVABLE (R13)   |
| W1 invocation ordinal per pushId                          | LIVE_UNOBSERVABLE (R13)   |
| prevState.turnState (the actual reducer argument)         | LIVE_UNOBSERVABLE (R13)   |
| reducer-output turnState                                   | LIVE_UNOBSERVABLE (R13)   |
| reducer-output epoch/stateVersion                          | LIVE_UNOBSERVABLE (R13)   |
| returned newState.turnState                                | LIVE_UNOBSERVABLE (R13)   |
| partial-message epoch / ts / seq                           | UNAVAILABLE_FROM_TRACE    |
| queued local setState writers between raw and commit      | LIVE_UNOBSERVABLE (R13)   |

Epistemic vocabulary (R13 — three distinct states):

  UNAVAILABLE_FROM_TRACE
      The old TRACE01 instrumentation never captured this
      dimension; the gap predates this ACT.

  LIVE_UNOBSERVABLE
      The current live diagnostic cannot capture this dimension
      without violating either
      (a) the capture-at-the-boundary guarantee (§2), or
      (b) LC_T_PURITY / the React functional-updater purity rule.
      The dimension is real and live; the capture mechanism is
      what is insufficient. Offline replay from immutable
      captured inputs is the correct substitute.

  CAPTURE_INSUFFICIENT
      Even with what we can capture, available observations do
      not isolate a single boundary. This is a §4 halt, not a
      §2 epistemic label.

Crucially: do **not** reuse bare `UNAVAILABLE`, and do **not**
substitute `UNAVAILABLE_FROM_TRACE` for `LIVE_UNOBSERVABLE` (or
vice-versa). They are different epistemic categories.

This ACT captures what is safely live-observable. It does **not**
explain the divergence.

---

## §1  Frozen authority

```text
AUTHORIZATION_BASE_HEAD   = f41d69d2a83aa625f0195b757df54a0805c4e65f
                            (the LIVE-SHAPE R10 FIXUP commit; the
                             predecessor whose R10 FIXUP closed the
                             GREEN/RED vocabulary; not the execution
                             HEAD for this ACT)

PLAN_FREEZE_HEAD          = dd4f08d7c348373a9dba5bf8378ebf53e2754c6f
                            (this ACT's authorization plan commit;
                             the source-of-truth for §1..§9 as written
                             at freeze time)

IMPLEMENTATION_ENTRY_HEAD = dd4f08d7c348373a9dba5bf8378ebf53e2754c6f
                            (literal HEAD when implementation ACTs
                             C0..C4 begin)

Do not confuse these:
  - AUTHORIZATION_BASE_HEAD is the LIVE-SHAPE ancestor that this ACT
    inherits authority from.
  - PLAN_FREEZE_HEAD == IMPLEMENTATION_ENTRY_HEAD is where
    implementation must start.

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
  LIVE_UNOBSERVABLE     — see §0 / §2; capture mechanism cannot
                         safely observe without violating §2 or
                         LC_T_PURITY; offline replay substitute
  CAPTURE_INSUFFICIENT  — see §0 / §4; even observable captures do
                         not isolate a boundary; halt signal
  BASE                 — known-good real-provider fixture;
                         GREEN by construction
  Stop at the first RED.
```

No fact in this document overrides the GREEN/RED vocabulary. Any
"the committed turnState is X" verdict inherits GREEN/RED semantics
from LIVE-SHAPE §2 verbatim. The three new epistemic labels
(`LIVE_UNOBSERVABLE`, `CAPTURE_INSUFFICIENT`, plus the explicit
absence of bare `UNAVAILABLE`) are R13 additions and do not alter
LIVE-SHAPE §2.

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
3. Each observation that cannot be safely captured is recorded
   as `LIVE_UNOBSERVABLE` (R13). The bare word `UNAVAILABLE` is
   forbidden — it conflates two distinct epistemic categories
   (`UNAVAILABLE_FROM_TRACE` = old TRACE gap vs. `LIVE_UNOBSERVABLE`
   = current live mechanism cannot capture safely).
   `LIVE_UNOBSERVABLE` is preferred to fabricating a value.
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
     LIVE_OBSERVABILITY = LIVE_UNOBSERVABLE
     (R13; never bare UNAVAILABLE)
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

**Capture priority for C1.** Not every capture group is equally
cheap. The following priority order is part of this ACT:

```text
P    — incoming snapshot identity           (cheap; safe)
W2   — partial-message identity            (cheap; safe)
Q    — update-request chronology           (cheap; safe; Q-group only)
C    — committed result                     (cheap; safe)

B / R / N are desired, not mandatory. They are observable only
if the executor can implement them without breaking LC_T_PURITY.
If they cannot, mark them LIVE_UNOBSERVABLE and rely on offline
replay from immutable outer-boundary inputs (e.g., running the
same pure reducer against the captured immutable prevState).
```

**Sub-gates.** React documents that functional updater functions
must be pure and that development Strict Mode intentionally
re-invokes functions expected to be pure to expose impurity.
Therefore, beyond the abstract `LC_T_PURITY` rule, the executor
must also satisfy (and the test suite must verify) three concrete
sub-gates:

```text
LCD_T7A NEW_UPDATER_SIDE_EFFECTS = 0
  No diagnostic call introduced by this ACT adds a record append,
  ref mutation, counter increment, or setState call inside any
  functional updater introduced or modified by this ACT.

LCD_T7B STRICT_MODE_CARDINALITY = PASS
  Under React development Strict Mode, diagnostic appends and
  diagnostic-state changes are cardinality-stable: each
  diagnostic event is observed exactly once in the live trace
  per triggering request, despite Strict Mode's deliberate
  re-invocation. (Equivalently: no diagnostic counter advances
  more than once per underlying React updater call.)

LCD_T7C DEFAULT_OFF_EQUIVALENCE = PASS
  With the diagnostic enable-flag off:
    - same callback inputs
    - same externally visible app state
    - no forensic records emitted
  Not byte-identical JS execution, but semantic equivalence
  (no observer — including the user — can tell the difference).
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
      Same push's repeated updater evaluation observes different
      external replica inputs (e.g., second invocation sees
      different replica.turnState than the first).

      OBSERVABILITY NOTE (R13):
        Direct observation of each updater evaluation is exactly
        where LC_T_PURITY constrains this ACT. Therefore:

        LC-D is only assignable if the phenomenon is observable
        WITHOUT introducing new updater-side diagnostic effects.

        Otherwise:
          LC-D = NOT_DIRECTLY_OBSERVABLE
          and classification falls to LC-F unless offline replay
          (§3 / "B" sub-rule: replay the pure reducer against
          captured immutable outer-boundary inputs) yields a
          separately qualified witness.
      → next ACT: UPDATER-IMPURITY-REPRODUCTION01

LC-E  SECONDARY_WRITER
      another update request between raw and commit carries or
      reconstructs stale turnState
      → next ACT: SECONDARY-WRITER-REPRODUCTION01
      (LC-E is the family most likely to be isolated by the
      cheap-and-safe P / W2 / Q / C captures alone; if Q records
      show a non-W1 update request between raw and commit, that
      is a strong LC-E signal even with B / R / N unobserved.)

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
LCD_T0   IMPLEMENTATION_ENTRY_IDENTITY  PASS    (HEAD == dd4f08d7c;
                                                    f41d69d2a is the
                                                    AUTHORIZATION_BASE,
                                                    not the entry SHA —
                                                    see §1)
LCD_T1   TRACE01_PREDECESSOR           CLOSED_CLEAN
LCD_T2   LIVE_SHAPE_PREDECESSOR        CLOSED_PARTIAL  (R10 FIXUP)
LCD_T3   GREEN_RED_VOCABULARY          CANONICAL       (LIVE-SHAPE §2)

LCD_T4   TEMP_SCHEMA_DEFINED           PASS            (this ACT)
LCD_T5   DEFAULT_OFF                   PASS
LCD_T6   NO_STATE_SEMANTIC_DELTA       PASS
LCD_T7   UPDATER_PURITY_GATE           PASS            (LC_T_PURITY abstract
                                                    rule — §3)
LCD_T7A  NEW_UPDATER_SIDE_EFFECTS      PASS            (= 0; §3 sub-gate)
LCD_T7B  STRICT_MODE_CARDINALITY       PASS            (§3 sub-gate)
LCD_T7C  DEFAULT_OFF_EQUIVALENCE       PASS            (§3 sub-gate)
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
                                                    post-ACT vsix;
                                                    diagnostic vsix must
                                                    descend from
                                                    dd4f08d7c, NOT
                                                    f41d69d2a — see §1)
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

## §6.5  C0..C4 execution split

The ACT is implemented in five discrete sub-stages. Each stage
is itself an executable; each one freezes its own boundary and
its own acceptance gate. No stage authorizes what its scope
doesn't permit.

```text
C0  READ-ONLY RECON                          (docs only commit)
    - rediscover exact HEAD at execution start
      (assert: HEAD == IMPLEMENTATION_ENTRY_HEAD == dd4f08d7c)
    - inventory W1 / W2 / Q / C code boundaries
    - identify which B / R / N values are live-observable
      WITHOUT impurity, vs which must be marked
      LIVE_UNOBSERVABLE
    - freeze dedicated record schema (§5)
    - freeze enable / dump mechanism
    - commit docs only — no source delta

C1  TEMPORARY CAPTURE                        (source + test commit)
    - implement P
    - implement W2
    - implement Q
    - implement C correlation
    - implement only safely observable B / R / N fields
      (mark the rest LIVE_UNOBSERVABLE)
    - add:
        - default-off witness                (LCD_T7C)
        - StrictMode witness                  (LCD_T7B)
        - correlation / schema tests
        - removal marker
    - VSIX NOT YET built at this stage

C2  EXACT-HEAD DOGFOOD VSIX                  (build commit)
    - bun run protos (if any .proto touched)  [n/a: none expected]
    - bun esbuild.mjs
    - SHA-bind
    - assert VSIX builds from HEAD == dd4f08d7c
    - install (via debug harness; per operational policy)

C3  USER LIVE WALK                           (artifact commit)
    - acquire forensic artifact
    - classify LC-A..F
    - NO FIX
    - capture INSIDE the existing reproduction UI flow

C4  TERMINAL                                 (docs commit)
    - either:
        PASS_LIVE_CONTEXT_DIMENSIONS_ACQUIRED
        or
        HALT_CAPTURE_INSUFFICIENT
    - freeze the successor ACT name
    - enforce removal trigger (§5)
```

Important: C3 does not require a *new* UI workflow. It reuses the
existing live reproduction surface. The user reproduces the faulty
run, the temporary trace is dumped to disk, and the files are
handed back to the executor for §4 classification.

`production_fix` is forbidden in every C-stage, including C4.

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
                                          (R13 — distinct from
                                           LIVE_UNOBSERVABLE)
  first GREEN→RED delta                   NOT_FOUND
  producer reclassification              RETRACTED
  GREEN/RED vocabulary                    ✅ CANONICAL (R10 FIXUP)

LIVE-CONTEXT-DIMENSIONS01
  authorization plan                      ✅ dd4f08d7c
  AUTHORIZATION_BASE_HEAD                 f41d69d2a (predecessor; not entry)
  PLAN_FREEZE_HEAD / ENTRY_HEAD           ✅ dd4f08d7c (R12 split)
  LIVE_UNOBSERVABLE vocabulary            ✅ R13 (no bare UNAVAILABLE)
  LC-D observability note                 ✅ R13 (NOT_DIRECTLY_OBSERVABLE)
  C0 read-only recon                      ⏳ NEXT (docs-only commit)
  C1 temporary capture                    ⏳
  C2 exact-head dogfood VSIX              ⏳
  C3 user live walk                       ⏳
  C4 terminal classification              ⏳

R11 stale test prose                     🟡 NON-BLOCKING CLEANUP
E8                                       ⛔ HOLD
E9                                       ⛔ HOLD
PRODUCTION FIX                           ⛔ FORBIDDEN
```
