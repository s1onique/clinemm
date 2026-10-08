module Domain exposing
    ( Facts
    , Directive(..)
    , Capability(..)
    , CompletionStatus(..)
    , FailureReason(..)
    , HeldSetProgress(..)
    , CapabilityMap
    , emptyCapabilityMap
    , capabilityMapGet
    , capabilityMapSet
    , factsDefaults
    , factsIsExpected
    , validateHeldSetSortedness
    , Sortedness(..)
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
    already representable in `Facts`.

The semantic policy surface is `Directive` — a closed sum that maps
1:1 onto the TS `CompletionContinuationControl.CompletionStatus` +
`RequiredAction` fields. Tool names, identity, prompt wording, runtime
authority, message role, and host effects stay in TS (C2 / C9 / C32).

ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01 (C0 / C2 / C5 / C6):

  The held-set progress classification — the pure semantic distinction
  between "no progress" (same held set, or pure-superset passive
  accumulation) and "real progress" (contraction or membership shift)
  — moves INTO the kernel. The host-owned temporal state (prior
  snapshot, REARM dedupe lifetime, STALL fingerprint lifetime, terminal
  observation records) stays in TS. Elm never writes diagnostics, never
  mutates the held-set store, and never owns the REARM dedupe. The
  host passes the immutable `priorHeldSetSorted` and the live
  `currentHeldSetSorted` as `Facts`; Elm's `Policy.classifyHeldSetProgress`
  derives the closed `HeldSetProgress` sum and `Policy.decide` consults
  it to gate the P2 stalled-no-progress guard.

  The `stalledNoProgress: Bool` field that AUTHORITY02 used to accept
  from the host is REMOVED from the wire schema. The host no longer
  pre-classifies; Elm derives the verdict from the two held sets.
  This is a breaking change to the closed wire schema (C10) and the
  differential correspondence fixtures (C14); the TS adapter maps
  the new fields and the existing tests are updated accordingly.

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


{-| ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01 (C2 / C5 / C6):

  Closed enum of held-set progress classifications. Derived purely
  from the two immutable held-set snapshots the host passes in. NO
  temporal state lives in this kernel; the host owns the prior
  snapshot lifetime and the REARM dedupe. The variants map exactly
  onto the candidate held-set transition domain from ACT §C2:

    Indeterminate                 -- no prior snapshot (first call)
    NoProgress                    -- prior == current (canonical set equality)
    PassiveAccumulation           -- current is a strict superset of prior
                                    (no model consumption; live STALL/REARM
                                    defect lives here)
    ContractionOrMembershipShift  -- real progress: held set contracted
                                    (model observed something) OR membership
                                    shifted (some cleared, new ones arrived)
                                    — releases the REARM dedupe

  The pre-MIGRATION semantic invariant: BOTH `NoProgress` and
  `PassiveAccumulation` are STALL signals (the live
  STALLED-REARM-LOOP01 defect proven exactly this: 4 x submit_and_exit
  with monotone held accumulation under no observation capability).
  The kernel maps BOTH to `FailClosed StalledNoProgress` (P2). Only
  `ContractionOrMembershipShift` (real consumption) and
  `Indeterminate` (first call) release the directive.

  The empty held set (`[]`) is a valid terminal state — it means
  "no held obligations remain". When the prior set is empty and the
  current set is non-empty, the transition is a `PassiveAccumulation`
  (the prior was empty, the new is non-empty ⇒ strict superset).
  When both are empty, the transition is `NoProgress` (the set is
  unchanged at zero). Neither path STALLs in a meaningful way; the
  directive still depends on `unconsumedCount` and the capabilities.
  This is a deliberate consequence of using set arithmetic as the
  progress signal: an empty held set with no progress is not a
  pathological case (it means nothing is held).
-}
type HeldSetProgress
    = Indeterminate
    | NoProgress
    | PassiveAccumulation
    | ContractionOrMembershipShift


-- ---------------------------------------------------------------------------
-- Facts crossing the boundary
-- ---------------------------------------------------------------------------


{-| Pure inputs from the host snapshot. No identity, no tool names,
no runtime authority (C9).

Why these specific fields:

  - `unconsumedCount`       — number of held terminal results (truth TS owns)
  - `observation`           — capability boolean (TS projection of registry)
  - `completion`            — capability boolean (TS projection of registry)
  - `priorHeldSetSorted`    — canonical sorted snapshot of the held
                              identity set at the LAST successful
                              enqueue (the snapshot that produced
                              `lastCompletionContinuationHeldSetSorted`
                              in the TS host). `[]` means "no prior
                              snapshot" (first call). TS owns the
                              lifetime of this field; Elm only reads
                              it as an immutable fact.
  - `currentHeldSetSorted`  — canonical sorted snapshot of the held
                              identity set at THIS call (the snapshot
                              produced by `getUnconsumedOwnedTerminalJobIds`
                              upstream of `enqueueCompletionContinuationIfHeld`).
                              TS owns the lifetime.
  - `sessionMatches` / `taskMatches` — TS-computed identity matches
  - `alreadyCommitted`      — TS-computed final-commit indicator

ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01 (C5 / C6):

  The `stalledNoProgress: Bool` field that AUTHORITY02 used to accept
  from the host is REMOVED. The host no longer pre-classifies; Elm
  derives the verdict from `priorHeldSetSorted` and `currentHeldSetSorted`
  via `Policy.classifyHeldSetProgress`. This is the load-bearing
  single-authority invariant: there is exactly one semantic authority
  for the no-progress blocking decision.

  Both held-set fields are REQUIRED on the closed schema. A missing
  field → fail-closed `MalformedFacts` (C15). The host always has
  both snapshots available (the prior snapshot is
  `lastCompletionContinuationHeldSetSorted` from the coordinator; the
  current snapshot is the result of the live provider call inside
  `enqueueCompletionContinuationIfHeld`).

Field defaults: see `factsDefaults`. Every field is required by the
closed schema; missing field → fail-closed `MalformedFacts` (C15).
-}
type alias Facts =
    { unconsumedCount : Int
    , observation : CapabilityMap
    , completion : CapabilityMap
    , priorHeldSetSorted : List String
    , currentHeldSetSorted : List String
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
TRUE, every commit sentinel FALSE, both held-set snapshots empty.
Used by tests so a fixture only needs to override the fields it cares
about. The held-set defaults are `[]` (empty), which the policy
interprets as `Indeterminate` (no prior) when paired with another
empty `[]` (no current) — the "first call" semantic.
-}
factsDefaults : Facts
factsDefaults =
    { unconsumedCount = 0
    , observation = emptyCapabilityMap
    , completion = emptyCapabilityMap
    , priorHeldSetSorted = []
    , currentHeldSetSorted = []
    , sessionMatches = True
    , taskMatches = True
    , alreadyCommitted = False
    }


{-| Quick invariant: `factsIsExpected facts` is True iff every field
satisfies the closed-schema constraint. Used by the policy to detect
malformed facts at the boundary BEFORE classification. Negative
`unconsumedCount` and non-integer counts are rejected here (C15).

ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01 (C8): the held-set
fields are JSON-decoded as `List String` by the schema decoder; the
policy re-checks here that both lists are well-formed (i.e. every
element is a non-empty string — Elm's type system already guarantees
the list itself is well-formed, but a host-supplied empty-string
jobId would slip through; we reject it at the boundary so a stray
empty id cannot collapse `PassiveAccumulation` into a false
`NoProgress`).

ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01-CORRECTION02-SORTEDNESS-FAIL-CLOSED (C1):

  Both `*HeldSetSorted` lists MUST be sorted ascending at the
  trust boundary. A mis-sorted input is a violation of the
  classification contract (the host pre-sorts; the kernel walks
  the sorted input as a merge cursor). The previous CORRECTION01
  fix routed unsorted input through `classifyHeldSetProgress`
  → `Indeterminate`, which `Policy.decide` then conflated with
  the legitimate "no prior snapshot" first-call semantic and
  fall-through'd to `decideAfterStallCheck`. With observation
  capability available, the directive became `ObserveThenRetry`
  → `delivered` → the production caller would enqueue a
  continuation against a malformed snapshot, releasing the
  REARM dedupe and progressing through to the next epoch. This
  was a fail-OPEN path for malformed input.

  The CORRECTION02 fix moves the sortedness check INTO
  `factsIsExpected` so it short-circuits at P0 of `decide` with
  `FailClosed MalformedFacts` BEFORE `classifyHeldSetProgress`
  is consulted. `Indeterminate` is now reserved exclusively
  for the legitimate absence of a prior snapshot (an empty
  `prior`).
-}
factsIsExpected : Facts -> Bool
factsIsExpected facts =
    facts.unconsumedCount >= 0
        && allNonEmptyStrings facts.priorHeldSetSorted
        && allNonEmptyStrings facts.currentHeldSetSorted
        && validateHeldSetSortedness facts.priorHeldSetSorted == Sorted
        && validateHeldSetSortedness facts.currentHeldSetSorted == Sorted


allNonEmptyStrings : List String -> Bool
allNonEmptyStrings ids =
    List.all (\id -> String.length id > 0) ids


{-| Sortedness verdict for a `List String`. The closed-schema
contract requires both `*HeldSetSorted` fields to be sorted
ascending. A non-Sorted input is a malformed fact (the host
pre-sorts; the kernel walks the sorted input as a merge cursor
and assumes the cursor property on entry). Reused by
`factsIsExpected` and by `Policy.classifyHeldSetProgress` as
defense-in-depth.
-}
type Sortedness
    = Sorted
    | NotSorted


{-| Tail-recursive index-free sortedness check. The empty list
is Sorted (the merge cursor starts at -infinity and the first
element trivially satisfies the cursor property).
-}
validateHeldSetSortedness : List String -> Sortedness
validateHeldSetSortedness list =
    case list of
        [] ->
            Sorted

        first :: rest ->
            walkSortedness first rest


walkSortedness : String -> List String -> Sortedness
walkSortedness prev xs =
    case xs of
        [] ->
            Sorted

        y :: ys ->
            if prev <= y then
                walkSortedness y ys

            else
                NotSorted