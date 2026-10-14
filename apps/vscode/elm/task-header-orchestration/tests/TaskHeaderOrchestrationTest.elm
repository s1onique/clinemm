module TaskHeaderOrchestrationTest exposing (suite)

{-| Elm-side unit tests for the TaskHeader orchestration kernel.

Every test exercises the REAL pure selector `Orchestration.projectPresentation`
with the same fixture table the TS-side differential correspondence suite uses
(see `apps/vscode/src/sdk/__tests__/task-header-elm-orchestration-shadow01.fixtures.ts`).

The Elm-side tests verify that the pure Elm kernel reproduces the production
semantics in isolation (no TS adapter, no ports, no JSON). The TS-side
differential correspondence suite verifies that the compiled JS kernel
(via `Main.elm`'s `Platform.worker`) reproduces the production TS selector
exactly.

Together: TS production == Elm kernel (over JSON) == Elm kernel (pure).
-}

import Domain exposing
    ( Facts
    , Presentation
    , PresentationSource(..)
    , TurnPhase(..)
    )
import Expect
import Orchestration
import Test exposing (Test, describe, test)


{-| Fixture table — the canonical input quadruple the production selector
sees at its seam, paired with the expected projection. These inputs are NOT
chosen to favor Elm; they are derived from the TS production selector's known
precedence (see ACT §C3 "fixtures" — what production semantics support).
-}
type alias Fixture =
    { label : String
    , facts : Facts
    , expected : Presentation
    }


fixtures : List Fixture
fixtures =
    [ -- R1: HOST COMPACTION OVERRIDE
      Fixture "R1: compacting legacy beats canonical shadow"
        { canonicalShadowPhase = Just PhaseStreaming
        , currentLegacyPhase = PhaseCompacting
        , seq = 10
        , canonicalShadowObservedTurnSeq = Just 10
        }
        { phase = PhaseCompacting
        , source = SourceHost
        , seq = 10
        }

    -- R2: HOST AWAITING_FOLLOWUP OVERRIDE
    , Fixture "R2: awaiting_followup legacy beats canonical shadow (TCCC01-B1)"
        { canonicalShadowPhase = Just PhaseIdle
        , currentLegacyPhase = PhaseAwaitingFollowup
        , seq = 11
        , canonicalShadowObservedTurnSeq = Just 11
        }
        { phase = PhaseAwaitingFollowup
        , source = SourceHost
        , seq = 11
        }

    -- R3-1: CANONICAL SHADOW (fresh, not UNBOUND-demoting)
    , Fixture "R3: canonical shadow wins when fresh and not UNBOUND-demoting"
        { canonicalShadowPhase = Just PhaseStreaming
        , currentLegacyPhase = PhaseStreaming
        , seq = 5
        , canonicalShadowObservedTurnSeq = Just 5
        }
        { phase = PhaseStreaming
        , source = SourceShadow
        , seq = 5
        }

    -- R3-2: stale shadow falls through to legacy
    , Fixture "R3-fallthrough-stale: stale shadow falls through to legacy"
        { canonicalShadowPhase = Just PhaseIdle
        , currentLegacyPhase = PhaseStreaming
        , seq = 5
        , canonicalShadowObservedTurnSeq = Just 2
        }
        { phase = PhaseStreaming
        , source = SourceLegacy
        , seq = 5
        }

    -- R3-3: UNBOUND shadow demotion guard (idle shadow vs streaming legacy)
    , Fixture "R3-fallthrough-unbound-demote: UNBOUND shadow cannot demote active legacy"
        { canonicalShadowPhase = Just PhaseIdle
        , currentLegacyPhase = PhaseStreaming
        , seq = 27545
        , canonicalShadowObservedTurnSeq = Nothing
        }
        { phase = PhaseStreaming
        , source = SourceLegacy
        , seq = 27545
        }

    -- R3-4: UNBOUND shadow allowed (terminal shadow vs idle legacy)
    , Fixture "R3-allowed-unbound-terminal: UNBOUND terminal shadow allowed when legacy is terminal"
        { canonicalShadowPhase = Just PhaseIdle
        , currentLegacyPhase = PhaseIdle
        , seq = 1
        , canonicalShadowObservedTurnSeq = Nothing
        }
        { phase = PhaseIdle
        , source = SourceShadow
        , seq = 1
        }

    -- R3-5: UNBOUND demote (terminal shadow vs awaiting_approval legacy)
    , Fixture "R3-fallthrough-unbound-demote-2: UNBOUND terminal shadow demoting awaiting_approval legacy"
        { canonicalShadowPhase = Just PhaseCompleted
        , currentLegacyPhase = PhaseAwaitingApproval
        , seq = 50
        , canonicalShadowObservedTurnSeq = Nothing
        }
        { phase = PhaseAwaitingApproval
        , source = SourceLegacy
        , seq = 50
        }

    -- R2.5: HOST ERROR / RESUMABLE OVERRIDE (PTBPC01)
    , Fixture "R2.5: error legacy beats canonical shadow (host authority)"
        { canonicalShadowPhase = Just PhaseCompleted
        , currentLegacyPhase = PhaseError
        , seq = 13
        , canonicalShadowObservedTurnSeq = Just 13
        }
        { phase = PhaseError
        , source = SourceHost
        , seq = 13
        }
    , Fixture "R2.5: resumable legacy beats canonical shadow (host authority)"
        { canonicalShadowPhase = Just PhaseCompleted
        , currentLegacyPhase = PhaseResumable
        , seq = 14
        , canonicalShadowObservedTurnSeq = Just 14
        }
        { phase = PhaseResumable
        , source = SourceHost
        , seq = 14
        }

    -- R4-1: ABSENCE FALLBACK — the legacy R4 behavior for
    -- `resumable` has been SUPERSEDED by R2.5 (PTBPC01). R4
    -- still applies to non-host-authority phases when the shadow
    -- is absent.
    , Fixture "R4: shadow absent + resumable legacy -> R2.5 host authority (PTBPC01)"
        { canonicalShadowPhase = Nothing
        , currentLegacyPhase = PhaseResumable
        , seq = 3
        , canonicalShadowObservedTurnSeq = Nothing
        }
        { phase = PhaseResumable
        , source = SourceHost
        , seq = 3
        }

    -- R4-2: ABSENCE FALLBACK (idle finished)
    , Fixture "R4-2: shadow absent, idle finished via legacy"
        { canonicalShadowPhase = Nothing
        , currentLegacyPhase = PhaseCompleted
        , seq = 4
        , canonicalShadowObservedTurnSeq = Nothing
        }
        { phase = PhaseCompleted
        , source = SourceLegacy
        , seq = 4
        }

    -- ABSEQUAL: shadow agrees with legacy
    , Fixture "shadow==legacy: canonical idle equals legacy idle, shadow source wins"
        { canonicalShadowPhase = Just PhaseIdle
        , currentLegacyPhase = PhaseIdle
        , seq = 2
        , canonicalShadowObservedTurnSeq = Just 2
        }
        { phase = PhaseIdle
        , source = SourceShadow
        , seq = 2
        }

    -- LIVE specimen
    , Fixture "LIVE-specimen: canonical=idle, legacy=streaming, UNBOUND -> legacy wins"
        { canonicalShadowPhase = Just PhaseIdle
        , currentLegacyPhase = PhaseStreaming
        , seq = 27545
        , canonicalShadowObservedTurnSeq = Nothing
        }
        { phase = PhaseStreaming
        , source = SourceLegacy
        , seq = 27545
        }

    -- ------------------------------------------------------------------
    -- ACT-CLINEMM-TASKHEADER-UNOBSERVED-IDLE-DEMOTES-COMPLETED-REPAIR01
    -- G01..G11 conservation matrix.
    -- ------------------------------------------------------------------
    , Fixture "G01: TUIDC01 captured defect -- legacy completed wins"
        { canonicalShadowPhase = Just PhaseIdle
        , currentLegacyPhase = PhaseCompleted
        , seq = 1309
        , canonicalShadowObservedTurnSeq = Nothing
        }
        { phase = PhaseCompleted
        , source = SourceLegacy
        , seq = 1309
        }
    , Fixture "G02: TUSA01 active guard -- legacy streaming wins"
        { canonicalShadowPhase = Just PhaseIdle
        , currentLegacyPhase = PhaseStreaming
        , seq = 50
        , canonicalShadowObservedTurnSeq = Nothing
        }
        { phase = PhaseStreaming
        , source = SourceLegacy
        , seq = 50
        }
    , Fixture "G03: TUSA01 approval guard -- legacy awaiting_approval wins"
        { canonicalShadowPhase = Just PhaseIdle
        , currentLegacyPhase = PhaseAwaitingApproval
        , seq = 51
        , canonicalShadowObservedTurnSeq = Nothing
        }
        { phase = PhaseAwaitingApproval
        , source = SourceLegacy
        , seq = 51
        }
    , Fixture "G04: legitimate observed idle -- shadow wins (stamp present)"
        { canonicalShadowPhase = Just PhaseIdle
        , currentLegacyPhase = PhaseCompleted
        , seq = 100
        , canonicalShadowObservedTurnSeq = Just 100
        }
        { phase = PhaseIdle
        , source = SourceShadow
        , seq = 100
        }
    , Fixture "G05: stale observed idle -- legacy completed wins (staleness gate)"
        { canonicalShadowPhase = Just PhaseIdle
        , currentLegacyPhase = PhaseCompleted
        , seq = 105
        , canonicalShadowObservedTurnSeq = Just 90
        }
        { phase = PhaseCompleted
        , source = SourceLegacy
        , seq = 105
        }
    , Fixture "G06: valid observed completion -- shadow wins (legitimate observation)"
        { canonicalShadowPhase = Just PhaseCompleted
        , currentLegacyPhase = PhaseCompleted
        , seq = 110
        , canonicalShadowObservedTurnSeq = Just 110
        }
        { phase = PhaseCompleted
        , source = SourceShadow
        , seq = 110
        }
    , Fixture "G07: no canonical shadow -- legacy completed (R4 absence)"
        { canonicalShadowPhase = Nothing
        , currentLegacyPhase = PhaseCompleted
        , seq = 120
        , canonicalShadowObservedTurnSeq = Nothing
        }
        { phase = PhaseCompleted
        , source = SourceLegacy
        , seq = 120
        }
    , Fixture "G08: PTBPC01 error override -- host wins"
        { canonicalShadowPhase = Just PhaseIdle
        , currentLegacyPhase = PhaseError
        , seq = 130
        , canonicalShadowObservedTurnSeq = Nothing
        }
        { phase = PhaseError
        , source = SourceHost
        , seq = 130
        }
    , Fixture "G09: PTBPC01 resumable override -- host wins"
        { canonicalShadowPhase = Just PhaseIdle
        , currentLegacyPhase = PhaseResumable
        , seq = 140
        , canonicalShadowObservedTurnSeq = Nothing
        }
        { phase = PhaseResumable
        , source = SourceHost
        , seq = 140
        }
    , Fixture "G10: TCCC01 awaiting_followup override -- host wins"
        { canonicalShadowPhase = Just PhaseIdle
        , currentLegacyPhase = PhaseAwaitingFollowup
        , seq = 150
        , canonicalShadowObservedTurnSeq = Nothing
        }
        { phase = PhaseAwaitingFollowup
        , source = SourceHost
        , seq = 150
        }
    , Fixture "G11: R1 compacting override -- host wins"
        { canonicalShadowPhase = Just PhaseIdle
        , currentLegacyPhase = PhaseCompacting
        , seq = 160
        , canonicalShadowObservedTurnSeq = Nothing
        }
        { phase = PhaseCompacting
        , source = SourceHost
        , seq = 160
        }
    ]


{-| Walk the full fixture table and verify each row.
-}
suite : Test
suite =
    describe "TaskHeaderOrchestration"
        [ describe "projectPresentation correspondence to TS production selector"
            (List.map fixtureTest fixtures)
        , describe "seq is preserved verbatim"
            (List.indexedMap
                (\i fx ->
                    test fx.label (\_ -> assertSeqVerbatim i fx)
                )
                fixtures
            )
        ]


fixtureTest : Fixture -> Test
fixtureTest fx =
    test fx.label (\_ -> assertPresentation fx)


assertPresentation : Fixture -> Expect.Expectation
assertPresentation fx =
    let
        actual =
            Orchestration.projectPresentation fx.facts
    in
    if actual == fx.expected then
        Expect.pass

    else
        Expect.fail
            ("fixture "
                ++ fx.label
                ++ " expected "
                ++ Debug.toString fx.expected
                ++ " got "
                ++ Debug.toString actual
            )


assertSeqVerbatim : Int -> Fixture -> Expect.Expectation
assertSeqVerbatim _ fx =
    let
        actualSeq =
            (Orchestration.projectPresentation fx.facts).seq
    in
    if actualSeq == fx.facts.seq then
        Expect.pass

    else
        Expect.fail
            ("seq preservation violated in fixture "
                ++ fx.label
                ++ ": expected "
                ++ String.fromInt fx.facts.seq
                ++ ", got "
                ++ String.fromInt actualSeq
            )