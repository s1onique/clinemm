module Policy exposing
    ( decide
    )


{-| Pure decision kernel for the E3.1 post-await transition.

ACT-CLINEMM-ELM-SEAM08-DEFERRED-COMPLETION-BARRIER-AUTHORITY-MIGRATION (C2 / C5 / C6):

  This module owns the BOUNDED E3.1 decision in
  `SdkSessionEventCoordinator.enqueueCompletionContinuationIfHeld`.
  The full TS predecessor decision was a single conditional
  cascade (sdk-session-event-coordinator.ts:1633-1685):

    P0  (always applied) factsIsExpected check (in Domain)
    P1  identity mismatch  -> RejectStaleIdentity
    P2  marker absent      -> RejectStaleIdentity MarkerAbsent
    P3  REARM dedupe pinned -> SuppressDuplicate
    P4  held set is empty   -> PreserveBarrier
    P5  otherwise           -> PermitEnqueue { mustClearRearm = (prior != null) }

  Every precedence below corresponds to one production branch
  in the TS predecessor. The closed `BarrierDirective` sum is
  the SOLE output. The TS adapter routes the directive to the
  existing host effects (no new effects, no new fields).

  C6 invariant: the kernel is a pure projection
  `Facts -> BarrierDirective`. It does NOT mutate the host's
  REARM dedupe slot, the marker, the held-set store, or the
  continuation-callback outcome. The TS adapter performs the
  effect AFTER commit-time identity revalidation (C5).
-}
import Domain exposing (..)


{-| E3.1 decision. See module docs for the full precedence.
-}
decide : Facts -> BarrierDirective
decide facts =
    -- P1: identity must match between the live session/task and
    -- the marker's session/task. Mismatch means the obligation
    -- is for a different session/task and must not be re-fired
    -- against this coordinator instance.
    if facts.sessionId /= facts.markerSessionId then
        RejectStaleIdentity { reason = SessionIdentityMismatch }

    else if not (sameTaskIdentity facts.taskId facts.markerTaskId) then
        RejectStaleIdentity { reason = TaskIdentityMismatch }

    -- P2: marker must be present at the consult point. The TS
    -- pre-check at L1498 already returns "not_held" when the
    -- marker is absent; this is a defense-in-depth guard so a
    -- future direct caller that bypasses L1498 still fails
    -- closed.
    else if not facts.liveMarkerPresent then
        RejectStaleIdentity { reason = MarkerAbsent }

    -- P3: epoch must match. The TS pre-check at L1501
    -- establishes marker.epoch == currentEpoch; this is the
    -- C5 stale-decision guard.
    else if facts.markerEpoch /= facts.currentEpoch then
        RejectStaleIdentity { reason = EpochMismatch }

    -- P4: REARM dedupe is pinned to the current dedupe key.
    -- Match the TS L1665 branch exactly.
    else if facts.lastContinuationSessionEpoch == Just facts.continuationSessionEpoch then
        SuppressDuplicate

    -- P5: held set is empty (the count-based fallback path
    -- produced a 0-length list). Match the TS L1678 branch
    -- exactly.
    else if facts.heldJobCount <= 0 then
        PreserveBarrier

    -- P6: permit. The REARM dedupe must be cleared iff the
    -- prior sorted held set is non-null (real progress). The
    -- TS L1633 branch clears it; the absence of a prior
    -- snapshot (first call / cleared) means the slot is
    -- already free.
    else
        PermitEnqueue
            { mustClearRearm =
                case facts.priorHeldSetSorted of
                    Just _ ->
                        True

                    Nothing ->
                        False
            }


{-| Task-identity match. Both `Nothing` (no task yet) and
matching `Just taskId` count as a match; a partial mismatch
(e.g. one side Nothing and the other Just) is a mismatch.
-}
sameTaskIdentity : Maybe String -> Maybe String -> Bool
sameTaskIdentity live marker =
    case ( live, marker ) of
        ( Nothing, Nothing ) ->
            True

        ( Just a, Just b ) ->
            a == b

        ( Nothing, Just _ ) ->
            False

        ( Just _, Nothing ) ->
            False

