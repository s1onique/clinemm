module Policy exposing
    ( decide
    , classifyHeldSetProgress
    )


{-| Pure decision kernel for the completion-continuation-control
projection (C6 / C8 / C12).

This module is a pure projection `Facts -> Directive`. It does NOT
import anything from `Main` or `Codec`. The closed vocabulary and the
precedence order are FROZEN per ACT-CLINEMM-ELMIZE-P1-COMPLETION-
CONTINUATION-CONTROL-AUTHORITY02 C8 (with the held-set progress
migration layered on by ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-
AUTHORITY01).

The semantics pin the predecessor TS policy
(`buildCompletionContinuationControl` at
`apps/vscode/src/sdk/background-notify-coordinator.ts:501-544`)
AND extend it with the load-bearing C17 stall / C6 identity / C7
"already committed" guards.

Precedence (highest priority first; the body shape encodes it, not an
assertion):

  P0  Malformed facts                           -> FailClosed MalformedFacts
  P1  Identity mismatch (session OR task)       -> FailClosed SessionMismatch / TaskMismatch
  P2  Held-set progress = NoProgress /
       PassiveAccumulation                      -> FailClosed StalledNoProgress
       (HELD-SET-PROGRESS-AUTHORITY01: the
       classification is derived by
       `classifyHeldSetProgress` from the
       two immutable snapshots the host
       passes; no host-side pre-computed
       boolean. The host's REARM dedupe is
       released iff the classification is
       `ContractionOrMembershipShift` or
       `Indeterminate`.)
  P3  Already-committed terminal                -> FailClosed AlreadyCommitted
  P4  Held + observation available              -> ObserveThenRetry
  P5  Held + observation unavailable            -> FailClosed ObservationUnavailable
  P6  Not held + retry available                -> RetryCompletion
  P7  Not held + retry unavailable              -> FailClosed RetryUnavailable
  P8  Default fail-closed                       -> FailClosed RetryUnavailable
       (unreachable under C5 closed schema; included for completeness)

Correspondence with predecessor TS:

  CTRL-01 HELD + observations + retry   -> ObserveThenRetry (P4)
  CTRL-02 HELD + no observations        -> FailClosed ObservationUnavailable (P5)
  CTRL-03 not held + retry              -> RetryCompletion (P6)
  CTRL-04 not held + retry unavailable  -> FailClosed RetryUnavailable (P7)
  CTRL-05 stalled (held sets equal or   -> FailClosed StalledNoProgress (P2)
                 strict superset)
  CTRL-05b real progress (contraction   -> not stalled, fall through
                  or membership shift)
  CTRL-05c indeterminate (no prior      -> not stalled, fall through
                   snapshot)
  CTRL-06 session/task mismatch         -> FailClosed SessionMismatch/TaskMismatch (P1)
  CTRL-07 already committed             -> FailClosed AlreadyCommitted (P3)
  CTRL-08 malformed                     -> FailClosed MalformedFacts (P0)

C21 prompt rendering invariant: this module NEVER renders prose.
The TS adapter maps `Directive` -> `CompletionContinuationControl` via
`switch (directive)` and the formatter maps `CompletionContinuationControl`
-> prompt string via a `switch (requiredAction)`. No `if heldCount > 0`
conditional appears in either adapter or formatter.

This module NEVER:
  * reads global state;
  * reads wall-clock time;
  * mutates any model;
  * emits telemetry;
  * invokes I/O of any kind;
  * decides trust/role (C20);
  * mutates the host's prior-snapshot or REARM-dedupe store
    (HELD-SET-PROGRESS-AUTHORITY01 C6).

It is a total function: for any input `Facts` it returns exactly one
`Directive` (no `Result` / `Maybe`).
-}
import Domain exposing
    ( Capability(..)
    , Directive(..)
    , Facts
    , FailureReason(..)
    , HeldSetProgress(..)
    , capabilityMapGet
    , factsIsExpected
    )


decide : Facts -> Directive
decide facts =
    -- P0 malformed-facts guard. The trust boundary in
    -- `Domain.factsIsExpected` re-checks every closed-schema
    -- invariant: non-negative unconsumedCount, non-empty-string
    -- jobIds on BOTH `*HeldSetSorted` lists, AND (after
    -- CORRECTION02-SORTEDNESS-FAIL-CLOSED) ascending sortedness
    -- on both lists. A malformed snapshot — including a
    -- mis-sorted one — fails closed here, BEFORE the
    -- `classifyHeldSetProgress` walk is consulted. The kernel
    -- never authorizes delivery against a malformed snapshot.
    if not (factsIsExpected facts) then
        FailClosed MalformedFacts

    -- P1 identity mismatch (session takes precedence over task when
    -- both are bad; the TS adapter surfaces whichever was the
    -- upstream fail-closed cause).
    else if not facts.sessionMatches then
        FailClosed SessionMismatch

    else if not facts.taskMatches then
        FailClosed TaskMismatch

    -- P2 held-set progress STALL (HELD-SET-PROGRESS-AUTHORITY01).
    -- The host no longer pre-computes `stalledNoProgress`; Elm
    -- derives it from the two snapshots the host passes in.
    -- BOTH `NoProgress` (canonical-set equality) and
    -- `PassiveAccumulation` (strict-superset accumulation) are
    -- STALL signals; only `ContractionOrMembershipShift` (real
    -- progress) and `Indeterminate` (no prior snapshot) release
    -- the directive. This pin preserves the live
    -- STALLED-REARM-LOOP01 fix invariant.
    else
        let
            progress =
                classifyHeldSetProgress facts.priorHeldSetSorted facts.currentHeldSetSorted
        in
        case progress of
            NoProgress ->
                FailClosed StalledNoProgress

            PassiveAccumulation ->
                FailClosed StalledNoProgress

            ContractionOrMembershipShift ->
                -- Real progress: fall through to the rest of the
                -- policy (P3..P8). The TS host independently
                -- clears its REARM dedupe on this transition (the
                -- pre-migration inlined set comparison at
                -- sdk-session-event-coordinator.ts:1531 did this;
                -- the migration moves the classification here but
                -- the host's REARM-clearing effect stays in TS so
                -- Elm never owns the dedupe lifetime).
                decideAfterStallCheck facts

            Indeterminate ->
                -- No prior snapshot (first call / cleared). The
                -- closed-schema convention is: an empty `prior`
                -- means "first call". Fall through to the rest
                -- of the policy.
                decideAfterStallCheck facts


{-| Body of the policy after the P2 held-set progress guard. Split
out so the precedence structure is readable; semantically identical
to inlining these branches into `decide`.
-}
decideAfterStallCheck : Facts -> Directive
decideAfterStallCheck facts =
    -- P3 already-committed terminal — the BCB barrier should not
    -- enqueue a continuation after commit; if it did, fail closed.
    if facts.alreadyCommitted then
        FailClosed AlreadyCommitted

    -- P4 / P5: held unconsumed results.
    else if facts.unconsumedCount > 0 then
        let
            canObserve =
                capabilityMapGet ObserveHeldResults facts.observation
        in
        if canObserve then
            ObserveThenRetry

        else
            FailClosed ObservationUnavailable

    -- P6 / P7 / P8: nothing held — proceed to retry or fail closed.
    else
        let
            canRetry =
                capabilityMapGet CanRetryCompletion facts.completion
        in
        if canRetry then
            RetryCompletion

        else
            FailClosed RetryUnavailable



{-| ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01 (C2 / C5 / C6):

  Pure held-set progress classification. Reads two immutable canonical
  sorted snapshots; returns one of the four closed `HeldSetProgress`
  variants. NEVER mutates any state, NEVER reads wall-clock time, NEVER
  consults providers — the host passes the snapshots in.

  - `prior` is the canonical sorted snapshot at the LAST successful
    enqueue (`lastCompletionContinuationHeldSetSorted` in the TS host).
    An empty `prior` means "no prior snapshot" → `Indeterminate`.
  - `next` is the canonical sorted snapshot at the current call
    (the live `getUnconsumedOwnedTerminalJobIds` projection).

  Both inputs are required to be sorted ascending. The trust boundary
  validator is `Domain.validateHeldSetSortedness`, called from
  `Domain.factsIsExpected` BEFORE `Policy.decide` is consulted; a
  mis-sorted input causes `decide` to return
  `FailClosed MalformedFacts` (P0). The classifier here
  re-checks sortedness as defense-in-depth (so a future direct
  caller that bypasses `factsIsExpected` still fails closed at
  the diagnostic surface) and routes a non-sorted input to
  `Indeterminate` — BUT under the production path, a non-sorted
  input never reaches this function (the trust boundary in
  `factsIsExpected` short-circuits at P0 of `decide` first).

  ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01-CORRECTION02-SORTEDNESS-FAIL-CLOSED:
  after the CORRECTION02 fix, `Indeterminate` here is reserved
  exclusively for the legitimate absence of a prior snapshot (an
  empty `prior`) or for a mis-sorted input (defense-in-depth).
  Both cases release the directive in `decide` (P2 → fall
  through to `decideAfterStallCheck`). The fail-OPEN path
  closed in CORRECTION02 was: mis-sorted snapshot → classifier
  `Indeterminate` → `decide` fall-through → `ObserveThenRetry`
  with observation capability → `delivered`. After CORRECTION02,
  mis-sorted input → `factsIsExpected` False → `decide` P0 →
  `FailClosed MalformedFacts` → production caller terminal
  with `failureReason: "malformed_facts"`.

  Algorithm: tail-recursive linear pattern-matching walk. Each step
  consumes one element from `prior` (and possibly one from `next`).
  No index arithmetic; no `List.length`; no `nth`. Worst case
  O(|prior| + |next|) work, O(|prior| + |next|) auxiliary stack
  space (which the Elm compiler will optimize to a loop).
-}
classifyHeldSetProgress : List String -> List String -> HeldSetProgress
classifyHeldSetProgress prior next =
    case ( Domain.validateHeldSetSortedness prior, Domain.validateHeldSetSortedness next ) of
        ( Domain.NotSorted, _ ) ->
            Indeterminate

        ( _, Domain.NotSorted ) ->
            Indeterminate

        ( Domain.Sorted, Domain.Sorted ) ->
            -- An empty `prior` means "no prior snapshot" — the
            -- closed-schema first-call semantic. The classifier
            -- MUST return `Indeterminate` (NOT
            -- `PassiveAccumulation`, which the walk would
            -- otherwise emit for `([] :: non-empty)` per the
            -- canonical-set-equality distinction below). The
            -- CORRECTION01 fix preserves the first-call semantic.
            if List.isEmpty prior then
                Indeterminate

            else
                walk prior next


walk : List String -> List String -> HeldSetProgress
walk prior next =
    case ( prior, next ) of
        ( [], [] ) ->
            NoProgress

        ( [], _ :: _ ) ->
            PassiveAccumulation

        ( _ :: _, [] ) ->
            ContractionOrMembershipShift

        ( p :: ps, c :: cs ) ->
            if p == c then
                walk ps cs

            else if p < c then
                ContractionOrMembershipShift

            else
                walk prior cs
