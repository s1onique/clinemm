module Domain exposing
    ( TurnPhase(..)
    , PresentationSource(..)
    , Facts
    , Presentation
    , emptyFacts
    , isTerminalShadowPhase
    , isActiveLegacyPhase
    , phaseIsCompactingOrFollowup
    , turnPhaseToString
    , turnPhaseFromString
    , presentationSourceToString
    , presentationSourceFromString
    )


{-| Pure data layer for the TaskHeader presentation projection.

This module holds *only* types and pure constructors / predicates. It does
NOT import anything from `Orchestration` or `Codec`. The closed vocabulary
and identity wrappers are FROZEN for ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-
ORCHESTRATION01.

Why this exists: the production seam at
`apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts` is a 4-rule
projection (`selectTaskHeaderPresentation`). That function is the only
authoritative TaskHeader presentation selector in the current tree.

This module mirrors the *input* and *output* shapes as Elm types:

  * `Facts`     — the four semantic inputs the selector reads.
  * `Presentation` — the three semantic outputs the selector writes.

The conversion rules between these Elm types and the TS wire types live
in `Codec`. The pure decision logic lives in `Orchestration`.

Closed TurnPhase vocabulary — matches the wire `TurnPhase` in
`apps/vscode/src/shared/ExtensionMessage.ts`. Adding a new variant here
is a breaking change for the Elm differential correspondence suite, the
historical fixture table, and the wire contract.
-}


-- ---------------------------------------------------------------------------
-- TurnPhase
-- ---------------------------------------------------------------------------


type TurnPhase
    = PhaseIdle
    | PhaseStreaming
    | PhaseAwaitingApproval
    | PhaseAwaitingFollowup
    | PhaseCompacting
    | PhaseCompleted
    | PhaseError
    | PhaseResumable


turnPhaseToString : TurnPhase -> String
turnPhaseToString phase =
    case phase of
        PhaseIdle ->
            "idle"

        PhaseStreaming ->
            "streaming"

        PhaseAwaitingApproval ->
            "awaiting_approval"

        PhaseAwaitingFollowup ->
            "awaiting_followup"

        PhaseCompacting ->
            "compacting"

        PhaseCompleted ->
            "completed"

        PhaseError ->
            "error"

        PhaseResumable ->
            "resumable"


turnPhaseFromString : String -> Maybe TurnPhase
turnPhaseFromString s =
    case s of
        "idle" ->
            Just PhaseIdle

        "streaming" ->
            Just PhaseStreaming

        "awaiting_approval" ->
            Just PhaseAwaitingApproval

        "awaiting_followup" ->
            Just PhaseAwaitingFollowup

        "compacting" ->
            Just PhaseCompacting

        "completed" ->
            Just PhaseCompleted

        "error" ->
            Just PhaseError

        "resumable" ->
            Just PhaseResumable

        _ ->
            Nothing


{-| Returns `True` for the two phases the host owns outright —
`compacting` and `awaiting_followup`. The production selector
short-circuits to the host-source branch for these phases. The Elm
kernel replicates that short-circuit.
-}
phaseIsCompactingOrFollowup : TurnPhase -> Bool
phaseIsCompactingOrFollowup phase =
    case phase of
        PhaseCompacting ->
            True

        PhaseAwaitingFollowup ->
            True

        _ ->
            False


{-| Closed set of phases that, when shadow-projected, semantically close the
turn lifecycle (idle / completed / error / resumable). Matches the
`isTerminalShadowPhase` predicate at
`task-state-shadow-arbiter-mapper.ts:541–543`. Used by the UNBOUND-demotion
guard. `awaiting_followup` is intentionally NOT in this set.
-}
isTerminalShadowPhase : TurnPhase -> Bool
isTerminalShadowPhase phase =
    case phase of
        PhaseIdle ->
            True

        PhaseCompleted ->
            True

        PhaseError ->
            True

        PhaseResumable ->
            True

        _ ->
            False


{-| Closed set of phases that semantically indicate an in-progress /
non-idle turn. Matches the `isActiveLegacyPhase` predicate at
`task-state-shadow-arbiter-mapper.ts:555–557`. Used by the UNBOUND-demotion
guard.
-}
isActiveLegacyPhase : TurnPhase -> Bool
isActiveLegacyPhase phase =
    case phase of
        PhaseStreaming ->
            True

        PhaseAwaitingApproval ->
            True

        _ ->
            False


-- ---------------------------------------------------------------------------
-- PresentationSource
-- ---------------------------------------------------------------------------


type PresentationSource
    = SourceHost
    | SourceShadow
    | SourceLegacy


presentationSourceToString : PresentationSource -> String
presentationSourceToString source =
    case source of
        SourceHost ->
            "host"

        SourceShadow ->
            "shadow"

        SourceLegacy ->
            "legacy"


presentationSourceFromString : String -> Maybe PresentationSource
presentationSourceFromString s =
    case s of
        "host" ->
            Just SourceHost

        "shadow" ->
            Just SourceShadow

        "legacy" ->
            Just SourceLegacy

        _ ->
            Nothing


-- ---------------------------------------------------------------------------
-- Facts (input)
-- ---------------------------------------------------------------------------


{-| Semantic inputs to the TaskHeader presentation selector.

Matches the `TaskHeaderPresentationInputs` interface at
`apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:418–469`.
`Maybe Int` is used for "absent" rather than `Int` (Elm 0.19 has no
`undefined`); the TS adapter passes `undefined` -> `Nothing`.

The `seq` value is the TurnStateTracker-domain monotonic counter. The
`canonicalShadowObservedTurnSeq` is the phase-keyed TurnState-domain
stamp the shadow recorded at the moment of its last observation
yielding the projection currently being read. Both values are typed
as `Int`; the cross-domain numeric comparison CORRECTION01 attempted
has been removed.

`canonicalShadowPhase` is the canonical shadow's last `turnPhase`
projection (`TurnPhase | MISSING`). When `Nothing`, the selector falls
through to the legacy branch (rule 4).
-}
type alias Facts =
    { canonicalShadowPhase : Maybe TurnPhase
    , currentLegacyPhase : TurnPhase
    , seq : Int
    , canonicalShadowObservedTurnSeq : Maybe Int
    }


emptyFacts : Facts
emptyFacts =
    { canonicalShadowPhase = Nothing
    , currentLegacyPhase = PhaseIdle
    , seq = 0
    , canonicalShadowObservedTurnSeq = Nothing
    }


-- ---------------------------------------------------------------------------
-- Presentation (output)
-- ---------------------------------------------------------------------------


{-| Semantic output of the TaskHeader presentation selector.

Matches the `TaskHeaderPresentationProjection` interface at
`apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:387–416`. The
`seq` is always the input `seq` (TurnStateTracker.seq) — the Elm
selector preserves the input `seq` verbatim.
-}
type alias Presentation =
    { phase : TurnPhase
    , source : PresentationSource
    , seq : Int
    }