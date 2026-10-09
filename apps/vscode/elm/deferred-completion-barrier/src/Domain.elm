module Domain exposing
    ( Facts
    , BarrierDirective(..)
    , BarrierDecisionReason(..)
    , factsDefaults
    , factsIsExpected
    , validateHeldSetSortedness
    , Sortedness(..)
    )


{-| Pure data layer for the deferred-completion-barrier E3.1 Elm kernel.

ACT-CLINEMM-ELM-SEAM08-DEFERRED-COMPLETION-BARRIER-AUTHORITY-MIGRATION (C0 / C2):

  This kernel owns the bounded E3.1 post-await transition in
  `SdkSessionEventCoordinator.enqueueCompletionContinuationIfHeld`
  (apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1442-1726).

  The E3.1 surface is intentionally NARROW. After the existing
  Continuation Control Elm consult (line 1562) returns, the
  remaining TS-authoritative decision is the dedupe-vs-permit step:

    1. if (priorSortedHeld !== undefined) clear REARM dedupe
    2. if (lastCompletionContinuationSessionEpoch === epoch) suppress
    3. if (heldJobIds.length === 0) suppress (no_held_job_ids)

  Those three branches map 1:1 to the closed `BarrierDirective` sum
  below. The kernel is a pure projection `Facts -> BarrierDirective`
  with NO model state, NO port loop, NO Model. This matches the
  precedent of every prior SEAM kernel (completion-continuation-
  control, background-notify-authority, task-header-orchestration).

Closed vocabulary (frozen per ACT §C2 / §C5):

  Inbound `Facts`:

    {
      "sessionId": String,            -- the ACTIVE sessionId at the
                                       -- existing consult point
      "taskId": String | null,        -- the ACTIVE taskId at the
                                       -- existing consult point
      "markerSessionId": String,      -- the BCB marker's sessionId
      "markerTaskId": String | null,  -- the BCB marker's taskId
      "markerEpoch": Int,             -- the BCB marker's epoch
      "currentEpoch": Int,            -- the live minter epoch
      "continuationSessionEpoch":     -- the dedupe key the host
        String,                          computed (`S|T|E` shape)
      "lastContinuationSessionEpoch": -- the persisted REARM dedupe
        String | null                    value (null = cleared)
      "currentHeldSetSorted": [String],
      "priorHeldSetSorted":   [String] | null,
      "heldJobCount": Int,            -- the live count
      "liveMarkerPresent": Bool       -- whether the BCB marker
                                       -- is currently registered
    }

  Outbound `BarrierDirective`:

    | PermitEnqueue { mustClearRearm : Bool }
        -- (a) live marker present
        -- (b) identity matches (session + task)
        -- (c) epoch matches
        -- (d) REARM dedupe NOT pinned to the current dedupe key
        -- (e) held set is non-empty
        -- MUST clear REARM iff `priorHeldSetSorted` is non-null
        -- (real progress; matches the TS L1633 branch)

    | SuppressDuplicate
        -- the REARM dedupe IS pinned to the current dedupe key
        -- (matches the TS L1665 branch — "already_sent")

    | PreserveBarrier
        -- held set is empty at the consult point
        -- (matches the TS L1678 branch — "no_held_job_ids")

    | RejectStaleIdentity Reason
        -- the live state has drifted from the facts the host
        -- presented (marker gone / session mismatch / task
        -- mismatch / epoch mismatch). The TS adapter MUST
        -- revalidate and refuse to commit; this is the C5
        -- TOCTOU discriminator.

C11 invariant: this module never reads wall-clock, never
consults providers, never mutates external state, never
emits telemetry. The kernel is a pure function of `Facts`.
-}


-- ---------------------------------------------------------------------------
-- Closed (no inbound) enums
-- ---------------------------------------------------------------------------


{-| The reason a `BarrierDirective` is `RejectStaleIdentity`. The TS
adapter must REVALIDATE the live state at commit time and refuse
the effect if any of these fired at the consult stage. This is
the C5 stale-decision discriminator.
-}
type BarrierDecisionReason
    = MarkerAbsent
    | SessionIdentityMismatch
    | TaskIdentityMismatch
    | EpochMismatch


{-| Closed sum of post-await transitions. Maps 1:1 onto the
TS adapter's decision routing.
-}
type BarrierDirective
    = PermitEnqueue
        { mustClearRearm : Bool
        }
    | SuppressDuplicate
    | PreserveBarrier
    | RejectStaleIdentity
        { reason : BarrierDecisionReason
        }


-- ---------------------------------------------------------------------------
-- Facts crossing the boundary
-- ---------------------------------------------------------------------------


{-| Pure inputs from the host snapshot. No identity token, no
runtime authority (C2 / C9).

Every field is an immutable fact the host already collected at
the consult point. The kernel never re-reads host state.
-}
type alias Facts =
    { sessionId : String
    , taskId : Maybe String
    , markerSessionId : String
    , markerTaskId : Maybe String
    , markerEpoch : Int
    , currentEpoch : Int
    , continuationSessionEpoch : String
    , lastContinuationSessionEpoch : Maybe String
    , currentHeldSetSorted : List String
    , priorHeldSetSorted : Maybe (List String)
    , heldJobCount : Int
    , liveMarkerPresent : Bool
    }



-- ---------------------------------------------------------------------------
-- Validation
-- ---------------------------------------------------------------------------


{-| Trust-boundary validator. A `False` here means the inbound
payload is structurally invalid and the kernel MUST reject the
consult. The TS adapter surfaces the rejection as
`ElmUnavailable_UsePredecessor` (C4 / C13).

  - sessionId is non-empty
  - markerSessionId is non-empty
  - markerEpoch is non-negative
  - currentEpoch is non-negative
  - continuationSessionEpoch is non-empty
  - currentHeldSetSorted is sorted ascending with no empty strings
-}
factsIsExpected : Facts -> Bool
factsIsExpected f =
    not (String.isEmpty f.sessionId)
        && not (String.isEmpty f.markerSessionId)
        && f.markerEpoch >= 0
        && f.currentEpoch >= 0
        && not (String.isEmpty f.continuationSessionEpoch)
        && validateHeldSetSortedness f.currentHeldSetSorted == Sorted


{-| Closed enum used by the kernel to defend the input
invariant. Mirrors the equivalent in completion-continuation-
control/src/Domain.elm.
-}
type Sortedness
    = Sorted
    | NotSorted


{-| The held-set list is sorted ascending with no empty
strings. This is the same shape as the prior kernels use; we
duplicate the small helper here to keep the new kernel
self-contained (no cross-kernel import graph).
-}
validateHeldSetSortedness : List String -> Sortedness
validateHeldSetSortedness xs =
    let
        cleaned : List String
        cleaned =
            List.filter (\s -> not (String.isEmpty s)) xs
    in
    case cleaned of
        [] ->
            Sorted

        first :: rest ->
            if not (isAscending first rest) then
                NotSorted

            else
                Sorted


isAscending : String -> List String -> Bool
isAscending prev rest =
    case rest of
        [] ->
            True

        next :: tail ->
            if prev <= next && not (String.isEmpty next) then
                isAscending next tail

            else
                False

{-| Default-empty `Facts` for unit tests. Production callers
MUST populate every field (C8 / C10).
-}
factsDefaults : Facts
factsDefaults =
    { sessionId = ""
    , taskId = Nothing
    , markerSessionId = ""
    , markerTaskId = Nothing
    , markerEpoch = 0
    , currentEpoch = 0
    , continuationSessionEpoch = ""
    , lastContinuationSessionEpoch = Nothing
    , currentHeldSetSorted = []
    , priorHeldSetSorted = Nothing
    , heldJobCount = 0
    , liveMarkerPresent = True
    }

-- C12 invariant: adding a new constructor here is a breaking
-- change to the wire codec and the differential correspondence
-- fixtures. The vocabulary is FROZEN at the four constructors
-- above.
