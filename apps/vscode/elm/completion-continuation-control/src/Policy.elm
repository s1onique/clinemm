module Policy exposing
    ( decide
    )


{-| Pure decision kernel for the completion-continuation-control
projection (C6 / C8 / C12).

This module is a pure projection `Facts -> Directive`. It does NOT
import anything from `Main` or `Codec`. The closed vocabulary and the
precedence order are FROZEN per ACT-CLINEMM-ELMIZE-P1-COMPLETION-
CONTINUATION-CONTROL-AUTHORITY02 C8.

The semantics pin the predecessor TS policy
(`buildCompletionContinuationControl` at
`apps/vscode/src/sdk/background-notify-coordinator.ts:501-544`)
AND extend it with the load-bearing C17 stall / C6 identity / C7
"already committed" guards.

Precedence (highest priority first; the body shape encodes it, not an
assertion):

  P0  Malformed facts                           -> FailClosed MalformedFacts
  P1  Identity mismatch (session OR task)       -> FailClosed SessionMismatch / TaskMismatch
  P2  Same-fingerprint stall detected (C17)    -> FailClosed StalledNoProgress
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
  CTRL-05 stalled                       -> FailClosed StalledNoProgress (P2)
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
  * decides trust/role (C20).

It is a total function: for any input `Facts` it returns exactly one
`Directive` (no `Result` / `Maybe`).
-}
import Domain exposing
    ( Capability(..)
    , Directive(..)
    , Facts
    , FailureReason(..)
    , capabilityMapGet
    , factsIsExpected
    )


decide : Facts -> Directive
decide facts =
    -- P0 malformed-facts guard (negative unconsumedCount is the only
    -- closed-schema invariant we re-check here; the rest is enforced
    -- by the JSON decoder).
    if not (factsIsExpected facts) then
        FailClosed MalformedFacts

    -- P1 identity mismatch (session takes precedence over task when
    -- both are bad; the TS adapter surfaces whichever was the
    -- upstream fail-closed cause).
    else if not facts.sessionMatches then
        FailClosed SessionMismatch

    else if not facts.taskMatches then
        FailClosed TaskMismatch

    -- P2 same-fingerprint stall (C17). The host scheduler owns the
    -- fingerprint; this kernel only decides the consequence.
    else if facts.stalledNoProgress then
        FailClosed StalledNoProgress

    -- P3 already-committed terminal — the BCB barrier should not
    -- enqueue a continuation after commit; if it did, fail closed.
    else if facts.alreadyCommitted then
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