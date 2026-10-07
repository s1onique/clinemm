module Domain exposing
    ( Facts
    , Directive(..)
    , Capability(..)
    , CompletionStatus(..)
    , FailureReason(..)
    , CapabilityMap
    , emptyCapabilityMap
    , capabilityMapGet
    , capabilityMapSet
    , factsDefaults
    , factsIsExpected
    )


{-| Pure data layer for the completion-continuation-control Elm kernel.

This module holds *only* types and pure constructors. It does not import
anything from `Policy` or `Codec`. The closed vocabulary and identity
wrappers are FROZEN for
ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02.

ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02 (C0 / C8):

The kernel implements a **pure projection** `Facts -> Directive`. It does
NOT require a `Model` / `Msg` state machine because:

  - The current implementation of `buildCompletionContinuationControl`
    (the predecessor TS policy at
    `apps/vscode/src/sdk/background-notify-coordinator.ts:501-544`) is
    already a pure function of an immutable host snapshot:
        completionStatus = f(unconsumedCount, observation, completion)
        requiredAction  = f(unconsumedCount, observation, completion)

  - There is no previous-policy state held by the host that is not
    already representable in `Facts`. Same-state stalls are surfaced
    upstream by `shouldStallSameStateControl` (TS scheduler, C17) and
    propagate here as a `Facts` (the caller computes the boolean
    `stalledNoProgress` and passes it in).

The semantic policy surface is `Directive` — a closed sum that maps
1:1 onto the TS `CompletionContinuationControl.CompletionStatus` +
`RequiredAction` fields. Tool names, identity, prompt wording, runtime
authority, message role, and host effects stay in TS (C2 / C9 / C32).

Adding a new constructor here is a breaking change for the wire codec
and the differential correspondence fixtures.
-}


-- ---------------------------------------------------------------------------
-- Closed (no inbound) enums
-- ---------------------------------------------------------------------------


{-| Closed enum of capabilities the host may expose to the resumed
turn. The TS adapter projects the **actual resumed-turn tool registry**
(C3) into these booleans; Elm NEVER sees the literal tool names.
-}
type Capability
    = ObserveHeldResults
    | CanRetryCompletion


{-| Closed enum of completion-status semantic values. Mirrors the
existing TS enum `CompletionContinuationControl["completionStatus"]`.
-}
type CompletionStatus
    = Held
    | ReadyToRetry
    | Committed
    | CannotContinue


{-| Closed enum of failure reasons the policy can return. Mirrors
TS `CompletionContinuationControl["requiredAction"] == "fail_closed"`
carriers. New variants are a wire-contract break.
-}
type FailureReason
    = ObservationUnavailable
    | RetryUnavailable
    | StalledNoProgress
    | SessionMismatch
    | TaskMismatch
    | AlreadyCommitted
    | MalformedFacts


{-| Closed enum of directives returned by the kernel. The TS adapter
translates each variant 1:1 onto a `CompletionContinuationControl`-
shaped output WITHOUT adding further conditional logic (C12).

The TS-side existing TS enum values are:

  ObserveThenRetry   = completionStatus=Held, requiredAction=observe_then_submit
  RetryCompletion    = completionStatus=ReadyToRetry, requiredAction=retry_commission
  WaitForHost        = completionStatus=Committed, requiredAction=retry_commission
  FailClosed         = completionStatus=CannotContinue, requiredAction=fail_closed (with reason)
-}
type Directive
    = ObserveThenRetry
    | RetryCompletion
    | WaitForHost
    | FailClosed FailureReason


-- ---------------------------------------------------------------------------
-- Facts crossing the boundary
-- ---------------------------------------------------------------------------


{-| Pure inputs from the host snapshot. No identity, no tool names,
no runtime authority (C9).

Why these specific fields:

  - `unconsumedCount` — number of held terminal results (truth TS owns)
  - `observation`     — capability boolean (TS projection of registry)
  - `completion`      — capability boolean (TS projection of registry)
  - `stalledNoProgress` — TS-computed fingerprint hit (C17)
  - `sessionMatches` / `taskMatches` — TS-computed identity matches
  - `alreadyCommitted` — TS-computed final-commit indicator

Field defaults: see `factsDefaults`. Every field is required by the
closed schema; missing field → fail-closed `MalformedFacts` (C15).
-}
type alias Facts =
    { unconsumedCount : Int
    , observation : CapabilityMap
    , completion : CapabilityMap
    , stalledNoProgress : Bool
    , sessionMatches : Bool
    , taskMatches : Bool
    , alreadyCommitted : Bool
    }


{-| `CapabilityMap` is a small closed dict keyed on `Capability`. It
is exposed as a record rather than `List Capability` so the closed
schema can reject duplicates and the TS adapter can map two booleans
into a 1:1 shape without ordering ambiguity.

The default is `emptyCapabilityMap` (no capability).
-}
type alias CapabilityMap =
    { observeHeldResults : Bool
    , retryCompletion : Bool
    }


emptyCapabilityMap : CapabilityMap
emptyCapabilityMap =
    { observeHeldResults = False
    , retryCompletion = False
    }


capabilityMapGet : Capability -> CapabilityMap -> Bool
capabilityMapGet cap m =
    case cap of
        ObserveHeldResults ->
            m.observeHeldResults

        CanRetryCompletion ->
            m.retryCompletion


capabilityMapSet : Capability -> Bool -> CapabilityMap -> CapabilityMap
capabilityMapSet cap v m =
    case cap of
        ObserveHeldResults ->
            { m | observeHeldResults = v }

        CanRetryCompletion ->
            { m | retryCompletion = v }


{-| Default `Facts` with every capability off, every identity match
FALSE, every commit sentinel FALSE. Used by tests so a fixture only
needs to override the fields it cares about.
-}
factsDefaults : Facts
factsDefaults =
    { unconsumedCount = 0
    , observation = emptyCapabilityMap
    , completion = emptyCapabilityMap
    , stalledNoProgress = False
    , sessionMatches = True
    , taskMatches = True
    , alreadyCommitted = False
    }


{-| Quick invariant: `factsIsExpected facts` is True iff every field
satisfies the closed-schema constraint. Used by the policy to detect
malformed facts at the boundary BEFORE classification. Negative
`unconsumedCount` and non-integer counts are rejected here (C15).
-}
factsIsExpected : Facts -> Bool
factsIsExpected facts =
    facts.unconsumedCount >= 0