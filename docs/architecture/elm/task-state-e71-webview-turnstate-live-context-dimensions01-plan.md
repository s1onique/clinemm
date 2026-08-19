# ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-TURNSTATE-LIVE-CONTEXT-DIMENSIONS01

**STATUS:** AUTHORIZED (R12+R13+R14+R15+R16+R17 fixups applied)
**AUTHORIZATION_BASE_HEAD:** f41d69d2a83aa625f0195b757df54a0805c4e65f (LIVE-SHAPE R10 FIXUP ancestor)
**INITIAL_PLAN_FREEZE_HEAD:** dd4f08d7c348373a9dba5bf8378ebf53e2754c6f (this ACT's first plan commit; superseded by the amendment below for execution purpose only — remains the source-of-truth for §1..§9 as originally written)
**PLAN_AMENDMENT_HEAD:** 695b608a957b8c4d9be978336e6709aec0053d7e (R14 fixup commit — splits identity into a 4-head chain; adds LIVE_UNOBSERVABLE / T7A/T7B/T7C / C0..C4 split)
**IMPLEMENTATION_AUTHORIZED_FROM_HEAD:** 695b608a957b8c4d9be978336e6709aec0053d7e (R16 — renamed from `IMPLEMENTATION_ENTRY_HEAD`; this is a stable ancestor, NOT the literal HEAD at execution time)
**REQUIRED_PLAN_ANCESTOR_HEAD:** cff0218fbb0acbb74c7028ae100b285acdafa33e (R17 — the commit at which the execution contract became complete; **frozen at the R16 docs commit** so that the gate proves the C0 branch contains R16+R16's vocabulary, not just R16's parent; replaces `LATEST_PLAN_HEAD` which never advanced again)
**C0_ENTRY_HEAD:** UNKNOWN_UNTIL_C0 (literal HEAD at the moment C0 begins execution; recorded as evidence by C0; R16)
**DOGFOOD_SOURCE_HEAD:** UNKNOWN_AT_FREEZE (bound at C2 build time to the literal HEAD produced by C1; R15)
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
AUTHORIZATION_BASE_HEAD              = f41d69d2a83aa625f0195b757df54a0805c4e65f
                                       (the LIVE-SHAPE R10 FIXUP commit;
                                        the LIVE-SHAPE ancestor that this
                                        ACT inherits authority from —
                                        R12)

INITIAL_PLAN_FREEZE_HEAD             = dd4f08d7c348373a9dba5bf8378ebf53e2754c6f
                                       (this ACT's first plan commit;
                                        source-of-truth for §1..§9 as
                                        originally written;
                                        superseded for execution
                                        purpose only — NOT the entry
                                        SHA — R14)

PLAN_AMENDMENT_HEAD                  = 695b608a957b8c4d9be978336e6709aec0053d7e
                                       (R14 fixup commit; introduced
                                        the 4-head identity chain,
                                        LIVE_UNOBSERVABLE vocabulary,
                                        T7A/T7B/T7C sub-gates, and
                                        the C0..C4 execution split)

IMPLEMENTATION_AUTHORIZED_FROM_HEAD  = 695b608a957b8c4d9be978336e6709aec0053d7e
                                       (R16 — renamed from
                                        IMPLEMENTATION_ENTRY_HEAD.
                                        Stable ANCESTOR under which C0,
                                        C1, C2 are authorized to
                                        execute. NOT the literal
                                        HEAD at execution time.)

REQUIRED_PLAN_ANCESTOR_HEAD         = cff0218fbb0acbb74c7028ae100b285acdafa33e
                                       (R17 — the commit at which
                                        the execution contract
                                        became complete; frozen
                                        at the R16 docs commit so
                                        the C0 gate proves the C0
                                        branch contains R16's
                                        contract and is NOT a
                                        sibling of R16 forked from
                                        the R16 parent. Replaces
                                        LATEST_PLAN_HEAD; this SHA
                                        does NOT advance with
                                        future docs commits. Any
                                        ordinary later docs commit
                                        that the executor adds
                                        after R17 does not change
                                        this field — C0 will
                                        still see R17 as an
                                        ancestor of C0_ENTRY_HEAD.)

C1_REQUIRED_ANCESTOR_HEAD            = 6449cec47de2ff03a78340767aa254c529f8a855
                                       (R24 — the third C1
                                        ancestry floor; frozen
                                        once at the C0→C1
                                        contract boundary so the
                                        C1 gate proves C1 contains
                                        C0 ∧ C0-CORRECTION01 ∧
                                        R21/R22 plan alignment,
                                        not merely R16. NOT a SHA
                                        treadmill — like
                                        REQUIRED_PLAN_ANCESTOR_HEAD,
                                        this SHA does NOT advance
                                        with future docs commits.
                                        Any ordinary later docs
                                        commit between R21/R22 and
                                        C1 execution does not
                                        change this field — C1
                                        still sees it as an
                                        ancestor of C1_ENTRY_HEAD.)

C0_ENTRY_HEAD                        = UNKNOWN_UNTIL_C0
                                       (R16 — recorded as evidence
                                        by C0; equals `git rev-parse
                                        HEAD` at the moment C0 begins
                                        execution. The plan MUST NOT
                                        pre-bake this SHA. Any future
                                        docs-only commit between
                                        REQUIRED_PLAN_ANCESTOR_HEAD
                                        and C0 execution is allowed;
                                        it does not invalidate C0.)

DOGFOOD_SOURCE_HEAD                  = UNKNOWN_AT_FREEZE
                                       (R15 — literal HEAD at start
                                        of C2; produced by C1's
                                        temporary-capture commit;
                                        bound to the VSIX
                                        payload/version/hash at C2
                                        build time. NOT a freeze-time
                                        value; the executor records
                                        and announces it in C2.)

Do not confuse these:

  - AUTHORIZATION_BASE_HEAD is the LIVE-SHAPE ancestor this ACT
    inherits authority from. (Read-only historical anchor.)

  - INITIAL_PLAN_FREEZE_HEAD is the commit that first froze this
    ACT as a docs-only artifact. (Read-only historical anchor.)

  - PLAN_AMENDMENT_HEAD is the commit that introduced the
    LIVE_UNOBSERVABLE vocabulary and the C0..C4 split.
    (Read-only historical anchor.)

  - IMPLEMENTATION_AUTHORIZED_FROM_HEAD is the lower-stable
    ancestor under which C0, C1, and C2 are authorized to
    execute. (Stable floor — does NOT change.)

  - REQUIRED_PLAN_ANCESTOR_HEAD is the upper-stable ancestor
    that bounds the contract-completion moment. C0_ENTRY_HEAD
    MUST descend from this SHA. (Stable floor — does NOT
    change with future docs commits; replaces the misleading
    LATEST_PLAN_HEAD name.)

  - C0_ENTRY_HEAD is recorded by C0 itself at execution start;
    it is the runtime discovery, not a plan-fixed SHA.
    Must satisfy (canonical lower + upper anchors; see §6.5 C0):
        merge-base --is-ancestor \
          IMPLEMENTATION_AUTHORIZED_FROM_HEAD  C0_ENTRY_HEAD
        merge-base --is-ancestor \
          REQUIRED_PLAN_ANCESTOR_HEAD         C0_ENTRY_HEAD

  - DOGFOOD_SOURCE_HEAD is the runtime discovery at C2 build
    time (the output of C1). Same discipline as C0_ENTRY_HEAD.
    Must satisfy:
        merge-base --is-ancestor REQUIRED_PLAN_ANCESTOR_HEAD  DOGFOOD_SOURCE_HEAD
    (R17 — this was previously tied to IMPLEMENTATION_AUTHORIZED_
    FROM_HEAD, which was correct only because there was no
    upper anchor. With REQUIRED_PLAN_ANCESTOR_HEAD in place,
    the stronger upper anchor takes precedence.)

  - C1_REQUIRED_ANCESTOR_HEAD is the third ancestry floor that
    C1 must descend from (in addition to the lower
    IMPLEMENTATION_AUTHORIZED_FROM_HEAD floor and the upper
    REQUIRED_PLAN_ANCESTOR_HEAD floor). It is frozen once at
    the C0→C1 contract boundary — R24 — and does not advance
    with future docs commits. The three-gate model is the
    same shape as the two-gate R16+R17 model that protects
    C0 from a pre-R16 sibling fork; C1 is now protected
    from a pre-C0/C0-CORRECTION01/R21 sibling fork the same
    way.

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

### §1 R21/R22 plan-amendment log

The freeze contract (§2 capture groups, §2 boundary guarantees,
§6 LCD_T9, §6.5 C0/C1 hand-off) is amended by the post-C0 review:

- **R21 (BLOCKING doc contradiction):** the original guarantee #4
  asserted that every record carries `_ptadPushId`. After
  C0-CORRECTION01 §4.4, it is empirically proven that
  `_ptadPushId` is **NOT** on the W2 wire
  (`rpc subscribeToPartialMessage returns stream ClineMessage`).
  Guarantee #4 has been replaced with the **correlation identity
  contract** — see §2 below. The W1/P and C records keep their
  intrinsic `_ptadPushId`; W2 records use their native identity
  (`{epoch, seq, ts, partial | final}`) with `associationQuality`
  in `{INTERVAL_INFERRED, NONE}`; `INTRINSIC` on a W2 record is
  a data-integrity violation under the current protocol.

- **R22 (synchronized with R21):** the §2 B-group claim that
  `prevState.turnState` is the "literal reducer arg, copied at
  this boundary" is corrected. The literal reducer arg is
  accessible only inside the queued updater; from outside it is
  `LIVE_UNOBSERVABLE`. The plan now distinguishes `B_LITERAL`
  (LIVE_UNOBSERVABLE) from `B0 — REQUEST-SITE APPROXIMATION`
  (the only capturable B; capture kind renamed to
  `webview-*-request-replica`). The §6.5 C0/C1 hand-off uses
  the corrected question names
  (`CAN_B_REQUEST_SITE_REPLICA_CAPTURE`,
  `CAN_B_LITERAL_UPDATER_INPUT_CAPTURE`) and `LCD_T9` is now
  composite.

This amendment is docs-only and is bound to the C0-CORRECTION01
chain. REQUIRED_PLAN_ANCESTOR_HEAD does NOT advance: the
upper-stable floor remains `cff0218fb`; the C0 branch contains
both R16 and the R21/R22 plan-amendment log. Authorization
(R16+R17) is unaffected.

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
  pushId                       (intrinsic _ptadPushId; W1 wire only —
                                see R21 correlation identity contract)
  stateVersion
  snapshot epoch

B — BEFORE UPDATER (R22 epistemic split)
  The "literal reducer input at the updater boundary" is NOT
  empirically capturable from outside the queued updater without a
  diagnostic side effect that violates §3 LC_T_PURITY. The plan
  therefore distinguishes:

    B_LITERAL — LITERAL UPDATER INPUT
      prevState.turnState          (literal reducer arg — NOTREPLAY:
                                    SAFE only by theory; ACTUAL
                                    live capture = LIVE_UNOBSERVABLE;
                                    may NOT be reconstructed by
                                    reading `replicaRef.current`
                                    at the request site, because
                                    React's pending-state queue and
                                    ref mutability guarantee these
                                    can differ)
      replica.turnState
      replica.epoch
      replica.stateVersion

    B0 — REQUEST-SITE APPROXIMATION (the only capturable B)
      replica.turnState            (sampled at the request site —
                                    ONLY a useful approximation;
                                    NOT the literal updater input;
                                    capture kind renamed to
                                    webview-*-request-replica)

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
4. **Correlation identity contract (R21):** Records preserve their
   **strongest native correlation identity**. `_ptadPushId` is used
   only when it is intrinsically available on the source payload.

   ```text
   W1/P:
     _ptadPushId = INTRINSIC (stamped on the ExtensionState push wire)

   C:
     _ptadPushId = the latest committed W1 identity when retained
                   state carries one; cardinality remains per-commit

   W2:
     _ptadPushId = NOT PRESENT ON WIRE (proven empirically — see
                   C0-CORRECTION01 §4.4)
     native identity = { epoch, seq, ts, partial | final }
     associationQuality = INTERVAL_INFERRED | NONE
     "INTRINSIC" on a W2 record = data-integrity violation under
                   the current protocol (reserved for a future wire
                   amendment; requires its own plan revision)

   Q:
     use the intrinsic key only where the requesting source actually
     owns one; otherwise chronology/native identity only
   ```

   Chronological association MUST be explicitly marked as
   **inferred** (via `associationQuality`) and MUST NOT be promoted
   to causal identity. Analysis code that conflates a stamped
   `associatedPushId` with literal push identity violates the
   contract; preferred shape is

   ```ts
   {
     associationQuality: "INTERVAL_INFERRED",
     associatedPushId: undefined,
     intervalInferred: { prevPushId, nextPushId }
   }
   ```
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
  Cardinality discipline, per diagnostic boundary:

    - For each diagnostic boundary whose contract is
      request-cardinality (P, W2, Q), one underlying request
      produces exactly one forensic request-boundary record.
    - Commit-cardinality (C) follows React commit semantics:
      it is NOT required to be 1:1 with updater evaluations
      or with inbound pushes. A push may produce zero or one
      C records; multiple pushes may collapse into one C.
    - Strict Mode's request-boundary contract holds: Strict
      Mode must introduce no duplicate request-boundary records.
      (Strict Mode may invoke the underlying updater function
      more than once in development; the request-boundary
      record is emitted at the request site, not the updater
      site, so it is not duplicated.)

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
LCD_T0   IMPLEMENTATION_ENTRY_IDENTITY  PASS    (C0_ENTRY_HEAD is
                                                    discovered at C0
                                                    start; the gate is
                                                    ancestry-based — see
                                                    §1 and §6.5 C0;
                                                    IMPLEMENTATION_AUTHORIZED_FROM_HEAD
                                                    == 695b608a9 is the
                                                    lower stable floor;
                                                    REQUIRED_PLAN_ANCESTOR_HEAD
                                                    == cff0218fb is the
                                                    upper stable floor
                                                    that ensures the C0
                                                    branch contains the
                                                    completed R16
                                                    contract, NOT a
                                                    sibling of R16;
                                                    R16+R17)

LCD_T0b  C1_REQUIRED_ANCESTOR_HEAD     FROZEN    (R24; = 6449cec47;
                                                    third C1 ancestry
                                                    floor; bound at
                                                    the C0→C1
                                                    contract boundary;
                                                    does NOT advance
                                                    with later docs
                                                    commits)
LCD_T0c  C1_ENTRY_HEAD_RECORDED         PENDING    (C1 records
                                                    C1_ENTRY_HEAD as
                                                    evidence; equals
                                                    `git rev-parse HEAD`
                                                    at C1 start;
                                                    descendant-or-equal
                                                    of
                                                    IMPLEMENTATION_AUTHORIZED_FROM_HEAD,
                                                    REQUIRED_PLAN_ANCESTOR_HEAD,
                                                    and C1_REQUIRED_ANCESTOR_HEAD;
                                                    R16+R17+R24)
LCD_T0d  C1_ANCESTRY_GATE               PENDING    (R24; merge-base
                                                    three floors; the
                                                    same shape as C0's
                                                    gate)

LCD_T0a  C0_ENTRY_HEAD_RECORDED         PASS    (C0 records
                                                    C0_ENTRY_HEAD as
                                                    evidence; equals
                                                    `git rev-parse HEAD`
                                                    at C0 start;
                                                    descendant-or-equal
                                                    of IMPLEMENTATION_AUTHORIZED_FROM_HEAD;
                                                    descendant-or-equal
                                                    of REQUIRED_PLAN_ANCESTOR_HEAD;
                                                    R16+R17)
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
LCD_T9   PUSH_CORRELATION              COMPOSITE       (R21; see §2 corr.
                                                    contract):
                                                      W1_INTRINSIC   PASS
                                                      C_INTRINSIC    PASS
                                                                      (where
                                                                      retained
                                                                      state
                                                                      carries
                                                                      pushId)
                                                      W2_INTRINSIC   NOT_AVAILABLE_BY_PROTOCOL
                                                      W2_CHRONOLOGY  PASS /
                                                                      INTERVAL_INFERRED
                                                      FALSE_CAUSAL_ID 0
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
                                                    diagnostic vsix
                                                    descends from
                                                    REQUIRED_PLAN_ANCESTOR_HEAD
                                                    == cff0218fb (the
                                                    upper stable floor)
                                                    or any later
                                                    descendant; this
                                                    also implies descent
                                                    from IMPLEMENTATION_AUTHORIZED_FROM_HEAD
                                                    == 695b608a9 (the
                                                    lower stable floor);
                                                    the VSIX is bound to
                                                    DOGFOOD_SOURCE_HEAD
                                                    == C1_HEAD; NOT from
                                                    f41d69d2a,
                                                    dd4f08d7c, or any
                                                    pre-R16 sibling of
                                                    0888a6cdf — see §1;
                                                    R14+R16+R17)
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
    - discover C0_ENTRY_HEAD = `git rev-parse HEAD` at start
      (recorded as evidence; R16)
    - ancestry gate (R16+R17):
        assert:
          git merge-base --is-ancestor \
            IMPLEMENTATION_AUTHORIZED_FROM_HEAD  C0_ENTRY_HEAD
          git merge-base --is-ancestor \
            REQUIRED_PLAN_ANCESTOR_HEAD         C0_ENTRY_HEAD
        The lower anchor (AUTHORIZED_FROM_HEAD == 695b608a9)
        grants authorization. The upper anchor
        (REQUIRED_PLAN_ANCESTOR_HEAD == cff0218fb) proves
        the C0 branch contains the completed R16 contract —
        it is NOT a sibling fork of 0888a6cdf that pre-dates
        R16.
        Any number of docs-only commits between
        REQUIRED_PLAN_ANCESTOR_HEAD and C0 execution is
        allowed; C0 is NOT invalidated by them. REQUIRED_PLAN_
        ANCESTOR_HEAD itself does NOT advance with those
        ordinary later docs commits; C0 still sees it as an
        ancestor of C0_ENTRY_HEAD.
    - inventory W1 / W2 / Q / C code boundaries
    - populate the capture-can matrix (R14):
        CAN_P_CAPTURE                       = ?
        CAN_W2_CAPTURE                     = ?
        CAN_Q_CAPTURE                      = ?
        CAN_C_CAPTURE                      = ?
        CAN_B_REQUEST_SITE_REPLICA_CAPTURE     = ?
        CAN_B_LITERAL_UPDATER_INPUT_CAPTURE    = ?
        CAN_R_CAPTURE_WITHOUT_UPDATER_EFFECT   = ?
        CAN_N_CAPTURE_WITHOUT_UPDATER_EFFECT   = ?
      Anything in the second group that resolves to NO
      immediately becomes LIVE_UNOBSERVABLE; no implementation
      experimentation is needed. The B row is split into two
      epistemic categories per R22 (§2):
        B_REQUEST_SITE  — request-site approximation; only one
                          safely capturable
        B_LITERAL       — literal reducer arg at evaluation time;
                          NOT capturable from outside the queued
                          updater without a §3 LC_T_PURITY
                          violation
    - freeze dedicated record schema (§5)
    - freeze enable / dump mechanism
    - commit docs only — no source delta
    - produces C0_HEAD (a docs-only commit on top of
      C0_ENTRY_HEAD).  C0_HEAD must itself descend from
      both IMPLEMENTATION_AUTHORIZED_FROM_HEAD and
      REQUIRED_PLAN_ANCESTOR_HEAD.

C1  TEMPORARY CAPTURE                        (source + test commit)
    - discover C1_ENTRY_HEAD = `git rev-parse HEAD` at start
      (recorded as evidence; R16+R17+R24)
    - ancestry gate (R16+R17+R24) — three floors:
        assert:
          git merge-base --is-ancestor \
            IMPLEMENTATION_AUTHORIZED_FROM_HEAD  C1_ENTRY_HEAD
          git merge-base --is-ancestor \
            REQUIRED_PLAN_ANCESTOR_HEAD         C1_ENTRY_HEAD
          git merge-base --is-ancestor \
            C1_REQUIRED_ANCESTOR_HEAD          C1_ENTRY_HEAD
        The lower anchor (IMPLEMENTATION_AUTHORIZED_FROM_HEAD
        == 695b608a9) grants authorization. The middle anchor
        (REQUIRED_PLAN_ANCESTOR_HEAD == cff0218fb) proves the
        branch carries the completed R16 contract — NOT a
        pre-R16 sibling of 0888a6cdf. The new third anchor
        (C1_REQUIRED_ANCESTOR_HEAD == 6449cec47, R24) proves
        the branch carries C0 ∧ C0-CORRECTION01 ∧ R21/R22
        plan alignment — NOT a pre-C0 sibling fork.
        Any number of docs-only commits between
        C1_REQUIRED_ANCESTOR_HEAD and C1 execution is
        allowed; C1 is NOT invalidated by them.
        C1_REQUIRED_ANCESTOR_HEAD itself does NOT advance
        with those ordinary later docs commits; C1 still
        sees it as an ancestor of C1_ENTRY_HEAD.
    - implement P    (if CAN_P_CAPTURE                            = YES)
    - implement W2   (if CAN_W2_CAPTURE                           = YES)
    - implement Q    (if CAN_Q_CAPTURE                            = YES)
    - implement C    (if CAN_C_CAPTURE                            = YES)
    - implement B0   (if CAN_B_REQUEST_SITE_REPLICA_CAPTURE       = YES)
    - skip    B_LITERAL (if CAN_B_LITERAL_UPDATER_INPUT_CAPTURE   = NO)
    - skip    R        (if CAN_R_CAPTURE_WITHOUT_UPDATER_EFFECT    = NO)
    - skip    N        (if CAN_N_CAPTURE_WITHOUT_UPDATER_EFFECT    = NO)
      Otherwise: LIVE_UNOBSERVABLE for that group. Capture kinds
      must use the renamed schema (`webview-*-request-replica`,
      not `webview-before-*-updater`) — see C0-CORRECTION01 §5
      and §2 R22 above.
    - add:
        - default-off witness                (LCD_T7C)
        - StrictMode witness                  (LCD_T7B)
        - correlation / schema tests
        - removal marker
    - VSIX NOT YET built at this stage
    - produces C1_HEAD (a source + test commit on top of C0_HEAD)

C2  EXACT-HEAD DOGFOOD VSIX                  (build commit)
    - bun run protos (if any .proto touched)  [n/a: none expected]
    - bun esbuild.mjs
    - assert at C2 start:
        DOGFOOD_SOURCE_HEAD = git HEAD  (literal)
        DOGFOOD_SOURCE_HEAD descends from
          REQUIRED_PLAN_ANCESTOR_HEAD == cff0218fb
          (the upper stable floor; R17 — proves the C2 branch
           carries the completed R16 contract, NOT a
           pre-R16 sibling fork)
        DOGFOOD_SOURCE_HEAD also descends from
          IMPLEMENTATION_AUTHORIZED_FROM_HEAD == 695b608a9
          (the lower authorization floor; R16 — implied by
           the upper check but kept explicit for clarity)
        VSIX payload / version / SHA-bound tag binds to
          DOGFOOD_SOURCE_HEAD
      C2 does NOT pre-bake a SHA; it records and announces
      DOGFOOD_SOURCE_HEAD = C1_HEAD.  R15+R17.
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
  initial plan freeze                     ✅ dd4f08d7c (docs only)
  R12+R13 fixup                           ✅ 695b608a9
  R14+R15 fixup                           ✅ 0888a6cdf
  R16 dynamic-C0-entry binding            ✅ cff0218fb
  R17 required-plan-ancestor upper anchor ✅ (this commit; pinned at
                                                cff0218fb so the gate
                                                proves the C0 branch
                                                carries R16's contract,
                                                not a pre-R16 sibling
                                                fork; LATEST_PLAN_HEAD
                                                retired; this SHA does
                                                NOT advance with future
                                                docs commits)
  AUTHORIZATION_BASE_HEAD                 f41d69d2a (LIVE-SHAPE R10 FIXUP ancestor)
  INITIAL_PLAN_FREEZE_HEAD                dd4f08d7c (superseded for execution)
  PLAN_AMENDMENT_HEAD                     695b608a9 (R14 amendment)
  IMPLEMENTATION_AUTHORIZED_FROM_HEAD     695b608a9 (R16 — lower stable floor,
                                                NOT an exact equality target)
  REQUIRED_PLAN_ANCESTOR_HEAD             cff0218fb (R17 — upper stable floor;
                                                frozen at contract-completion
                                                commit; C0_ENTRY_HEAD must
                                                descend from this; this SHA
                                                does NOT advance)
  C0_ENTRY_HEAD                           ⏳ recorded at C0 start (R16;
                                                must descend from
                                                AUTHORIZED_FROM +
                                                REQUIRED_PLAN_ANCESTOR;
                                                R16+R17)
  DOGFOOD_SOURCE_HEAD                     ⏳ produced by C1, bound at C2 (R15);
                                                must descend from
                                                REQUIRED_PLAN_ANCESTOR_HEAD
                                                (R17)
  LIVE_UNOBSERVABLE vocabulary            ✅ R13 (no bare UNAVAILABLE)
  LC-D observability note                 ✅ R13 (NOT_DIRECTLY_OBSERVABLE)
  T7B cardinality discipline              ✅ R14 (request vs commit cardinality)
  Capture-can matrix in C0                ✅ R14
  C0 read-only recon                      ✅ 6f08c82ae (docs-only commit;
                                                C0_ENTRY_HEAD = 611403c10;
                                                capture-can matrix populated;
                                                R16+R17)
  C0-CORRECTION01 (R18/R19/R20)           ✅ 475a3de75 (C0 evidence
                                                reframed; plan untouched
                                                in this commit)
  R21/R22 plan amendment                  ✅ 6449cec47 (plan aligned to
                                                C0-CORRECTION01 evidence)
  R23/R24 C0→C1 boundary correction      ⏳ NEXT (this commit;
                                                C0_HEAD != C0_ENTRY_HEAD
                                                record; C1_REQUIRED_ANCESTOR_HEAD
                                                third-gate)
  C1 temporary capture                    ⏳ (after R23/R24 lands)
  C2 exact-head dogfood VSIX              ⏳
  C3 user live walk                       ⏳
  C4 terminal classification              ⏳

R11 stale test prose                     🟡 NON-BLOCKING CLEANUP
E8                                       ⛔ HOLD
E9                                       ⛔ HOLD
PRODUCTION FIX                           ⛔ FORBIDDEN
```
