module Policy exposing (decide, decideFailClosed)

{-| Pure decision kernel for the background-notify-authority
projection.

This module is a pure projection `Facts -> ConsumeDecision`. The
closed vocabulary and the precedence order are FROZEN per
ACT-CLINEMM-ELM-SEAM03-BACKGROUND-NOTIFY-AUTHORITY (C6).

The semantics pin the predecessor TS policy
(`BackgroundNotifyCoordinator.consumeTerminal` at
`apps/vscode/src/sdk/background-notify-coordinator.ts:1658-1756`).

Precedence (highest priority first):

  P0  Malformed facts           -> NoMarker
  P1  containment_failed        -> ContainmentNoWake
  P2  marker absent             -> NoMarker
  P3  owner mismatch / no owner -> OwnerMismatch
  P4  remainingNotify > 0       -> Held
  P5  remainingNotify == 0      -> Drained
  P6  default (unreachable)     -> NoMarker
-}

import Domain exposing (..)


{-| Compute the decision for a valid `Facts`.
-}
decide : Facts -> ConsumeDecision
decide facts =
    if not (factsIsExpected facts) then
        NoMarker

    else if facts.isContainmentFailed then
        ContainmentNoWake facts.jobId

    else
        case facts.markerPresence of
            MarkerAbsent ->
                NoMarker

            MarkerPresent markerSessionId markerTaskId ->
                case facts.activeOwner of
                    NoActiveOwner ->
                        OwnerMismatch

                    ActiveOwner ownerSessionId ownerTaskId ->
                        if markerSessionId /= ownerSessionId then
                            OwnerMismatch

                        else if markerTaskId /= ownerTaskId then
                            OwnerMismatch

                        else if facts.remainingNotify > 0 then
                            Held facts.jobId facts.remainingNotify

                        else
                            Drained facts.jobId 1


{-| Explicit fail-closed decision. The TS adapter routes every
malformed-fact case, every kernel-offline case, and every
decode-error case through this single function so the production
caller never has to handle a "no decision available" branch.
-}
decideFailClosed : Facts -> ConsumeDecision
decideFailClosed _ =
    NoMarker

