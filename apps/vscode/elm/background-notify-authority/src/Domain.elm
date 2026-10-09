module Domain exposing
    ( Facts
    , ConsumeDecision(..)
    , TerminalState(..)
    , MarkerPresence(..)
    , OwnerKey(..)
    , JobExitCode(..)
    , factsDefaults
    , factsIsExpected
    )

{-| Pure data layer for the background-notify-authority Elm kernel.

This module holds *only* types and pure validators. It does not import
anything from `Policy` or `Codec`. The closed vocabulary is FROZEN for
ACT-CLINEMM-ELM-SEAM03-BACKGROUND-NOTIFY-AUTHORITY.

ACT-CLINEMM-ELM-SEAM03-BACKGROUND-NOTIFY-AUTHORITY (C0 / C2):

  The kernel implements a **pure projection** `Facts -> ConsumeDecision`.
  It does NOT require a `Model` / `Msg` state machine because:

    - The current implementation of `BackgroundNotifyCoordinator.consumeTerminal`
      (the predecessor TS policy at
      `apps/vscode/src/sdk/background-notify-coordinator.ts:1658-1756`) is
      already a pure function of an immutable host snapshot.

    - There is no previous-policy state held by the host that is not
      already representable in `Facts`.

  The semantic policy surface is `ConsumeDecision` — a closed sum
  that maps 1:1 onto the TS `ConsumeTerminalDecision` discriminated
  union. The wake dispatch, the held-queue mutation, the marker
  delete, the diagnostic capture, and the dual-delivery ack
  trackers all stay in TS (C3 / C4 / C5).

Adding a new constructor here is a breaking change for the wire
codec and the differential correspondence fixtures.
-}


-- ---------------------------------------------------------------------------
-- Closed (no inbound) enums
-- ---------------------------------------------------------------------------


{-| Closed enum of terminal-state classifications the host may surface
to the kernel. The TS adapter maps the real `CommandJobState` (a wider
union) into this closed enum; Elm NEVER sees the full state machine.
-}
type TerminalState
    = Exited
    | Failed
    | Aborted
    | Killed
    | ContainmentFailed
    | Unknown


{-| Marker presence for a given jobId at the decision instant.
-}
type MarkerPresence
    = MarkerAbsent
    | MarkerPresent String (Maybe String)


{-| Active owner identity at the decision instant.
-}
type OwnerKey
    = ActiveOwner String (Maybe String)
    | NoActiveOwner


{-| Job exit code envelope.
-}
type JobExitCode
    = JobExitCode Int
    | Absent


{-| Pure decision of the kernel — 1:1 with the TS
`ConsumeTerminalDecision` discriminated union:

  - `NoMarker`                — no marker existed at the decision
                                  instant (or the coordinator was
                                  disposed). The TS effect
                                  interpreter does nothing.
  - `OwnerMismatch`           — the marker is bound to a different
                                  session/task than the active
                                  owner. The TS effect interpreter
                                  records the diagnostic and
                                  leaves the marker alone.
  - `ContainmentNoWake jobId` — the terminal classification was
                                  `containment_failed`. The wake is
                                  SUPPRESSED per the N9 contract;
                                  the marker is already deleted
                                  upstream.
  - `Held jobId heldCount`    — other notify markers are still
                                  outstanding for the active owner.
                                  The TS effect interpreter pushes
                                  the new terminal into the held
                                  queue.
  - `Drained jobId drainCount`— this was the last outstanding
                                  notify. The TS effect interpreter
                                  dispatches the wake (and any
                                  previously-held terminals for the
                                  same owner) into the host.
-}
type ConsumeDecision
    = NoMarker
    | OwnerMismatch
    | ContainmentNoWake String
    | Held String Int
    | Drained String Int


{-| Inbound facts — the typed surface the TS adapter projects into.

Every field is REQUIRED at the wire boundary (the closed-schema
invariant from C8). The schema decoder rejects any missing or
wrong-typed field. The `factsIsExpected` validator below is a
defense-in-depth check that runs BEFORE `Policy.decide` is
consulted; a malformed input short-circuits to `NoMarker` (the
fail-closed conservative action — see `Policy.decideFailClosed`).
-}
type alias Facts =
    { jobId : String
    , terminalState : TerminalState
    , isContainmentFailed : Bool
    , exitCode : JobExitCode
    , reason : Maybe String
    , outputTail : Maybe String
    , markerPresence : MarkerPresence
    , activeOwner : OwnerKey
    , remainingNotify : Int
    }


{-| Closed-schema default for use by tests and the differential
correspondence fixtures. Production callers NEVER use this — the
host always supplies every field.
-}
factsDefaults : Facts
factsDefaults =
    { jobId = ""
    , terminalState = Unknown
    , isContainmentFailed = False
    , exitCode = Absent
    , reason = Nothing
    , outputTail = Nothing
    , markerPresence = MarkerAbsent
    , activeOwner = NoActiveOwner
    , remainingNotify = 0
    }


{-| Validate the closed-schema constraints on a `Facts`. Used by
the policy to detect malformed facts at the boundary BEFORE
classification. Negative `remainingNotify` and negative exit code
are rejected here (C8).
-}
factsIsExpected : Facts -> Bool
factsIsExpected facts =
    (String.length facts.jobId > 0)
        && (facts.remainingNotify >= 0)
        && validJobExitCode facts.exitCode


validJobExitCode : JobExitCode -> Bool
validJobExitCode ec =
    case ec of
        JobExitCode n ->
            n >= 0

        Absent ->
            True