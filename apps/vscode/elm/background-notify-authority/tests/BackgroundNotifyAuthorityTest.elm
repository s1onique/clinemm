module BackgroundNotifyAuthorityTest exposing (suite)

{-| Pure-Elm unit tests for the background-notify-authority kernel.

These tests exercise `Policy.decide` directly (no Platform.worker,
no port). The test categories mirror the BNA-01..BNA-12 fixtures
defined in `ACT-CLINEMM-ELM-SEAM03-BACKGROUND-NOTIFY-AUTHORITY`
(§CORRESPONDENCE) and the malformed-edge matrix (§BOUNDARY DESIGN).

The differential correspondence against the TS reference runs in
vitest at
`apps/vscode/src/sdk/__tests__/background-notify-authority-elm-correspondence.bnaec01.test.ts`.
-}
import Codec
import Domain exposing (..)
import Expect
import Json.Decode as Decode
import Json.Encode as Encode
import Policy
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "BackgroundNotifyAuthorityKernel"
        [ describe "BNA-01..07: precedence corpus (matches TS reference)"
            bnaPrecedenceSuite
        , describe "BNA-08..12: malformed facts (fail-closed to NoMarker)"
            bnaMalformedSuite
        , describe "Wire round-trip (encoder/decoder symmetry)"
            wireRoundTripSuite
        , describe "Decoder fail-closed (malformed edge matrix)"
            decoderFailClosedSuite
        , describe "Necessity: an alternate Policy MUST diverge"
            necessitySuite
        ]


-- ---------------------------------------------------------------------------
-- BNA-01..07: precedence corpus
-- ---------------------------------------------------------------------------


bnaPrecedenceSuite : List Test
bnaPrecedenceSuite =
    [ test "BNA-01: marker absent -> NoMarker" <|
        \_ ->
            let
                f =
                    { jobId = "J-1"
                    , terminalState = Exited
                    , isContainmentFailed = False
                    , exitCode = JobExitCode 0
                    , reason = Nothing
                    , outputTail = Nothing
                    , markerPresence = MarkerAbsent
                    , activeOwner = ActiveOwner "S" (Just "T")
                    , remainingNotify = 0
                    }
            in
            Policy.decide f
                |> Expect.equal NoMarker

    , test "BNA-02: no active owner -> OwnerMismatch" <|
        \_ ->
            let
                f =
                    { jobId = "J-2"
                    , terminalState = Exited
                    , isContainmentFailed = False
                    , exitCode = JobExitCode 0
                    , reason = Nothing
                    , outputTail = Nothing
                    , markerPresence = MarkerPresent "S" (Just "T")
                    , activeOwner = NoActiveOwner
                    , remainingNotify = 0
                    }
            in
            Policy.decide f
                |> Expect.equal OwnerMismatch

    , test "BNA-03: marker.sessionId != owner.sessionId -> OwnerMismatch" <|
        \_ ->
            let
                f =
                    { jobId = "J-3"
                    , terminalState = Exited
                    , isContainmentFailed = False
                    , exitCode = JobExitCode 0
                    , reason = Nothing
                    , outputTail = Nothing
                    , markerPresence = MarkerPresent "markerS" (Just "T")
                    , activeOwner = ActiveOwner "ownerS" (Just "T")
                    , remainingNotify = 0
                    }
            in
            Policy.decide f
                |> Expect.equal OwnerMismatch

    , test "BNA-04: marker.taskId != owner.taskId -> OwnerMismatch" <|
        \_ ->
            let
                f =
                    { jobId = "J-4"
                    , terminalState = Exited
                    , isContainmentFailed = False
                    , exitCode = JobExitCode 0
                    , reason = Nothing
                    , outputTail = Nothing
                    , markerPresence = MarkerPresent "S" (Just "markerT")
                    , activeOwner = ActiveOwner "S" (Just "ownerT")
                    , remainingNotify = 0
                    }
            in
            Policy.decide f
                |> Expect.equal OwnerMismatch

    , test "BNA-05: containment_failed + marker present -> ContainmentNoWake" <|
        \_ ->
            let
                f =
                    { jobId = "J-5"
                    , terminalState = ContainmentFailed
                    , isContainmentFailed = True
                    , exitCode = JobExitCode 137
                    , reason = Just "killed"
                    , outputTail = Nothing
                    , markerPresence = MarkerPresent "S" (Just "T")
                    , activeOwner = ActiveOwner "S" (Just "T")
                    , remainingNotify = 0
                    }
            in
            Policy.decide f
                |> Expect.equal (ContainmentNoWake "J-5")

    , test "BNA-06: remainingNotify > 0 -> Held" <|
        \_ ->
            let
                f =
                    { jobId = "J-6"
                    , terminalState = Exited
                    , isContainmentFailed = False
                    , exitCode = JobExitCode 0
                    , reason = Nothing
                    , outputTail = Nothing
                    , markerPresence = MarkerPresent "S" (Just "T")
                    , activeOwner = ActiveOwner "S" (Just "T")
                    , remainingNotify = 2
                    }
            in
            Policy.decide f
                |> Expect.equal (Held "J-6" 2)

    , test "BNA-07: remainingNotify == 0 -> Drained" <|
        \_ ->
            let
                f =
                    { jobId = "J-7"
                    , terminalState = Exited
                    , isContainmentFailed = False
                    , exitCode = JobExitCode 0
                    , reason = Nothing
                    , outputTail = Nothing
                    , markerPresence = MarkerPresent "S" (Just "T")
                    , activeOwner = ActiveOwner "S" (Just "T")
                    , remainingNotify = 0
                    }
            in
            Policy.decide f
                |> Expect.equal (Drained "J-7" 1)
    ]


-- ---------------------------------------------------------------------------
-- BNA-08..12: malformed facts
-- ---------------------------------------------------------------------------


bnaMalformedSuite : List Test
bnaMalformedSuite =
    [ test "BNA-08: empty jobId -> NoMarker (fail-closed)" <|
        \_ ->
            let
                f =
                    { jobId = ""
                    , terminalState = Exited
                    , isContainmentFailed = False
                    , exitCode = JobExitCode 0
                    , reason = Nothing
                    , outputTail = Nothing
                    , markerPresence = MarkerPresent "S" (Just "T")
                    , activeOwner = ActiveOwner "S" (Just "T")
                    , remainingNotify = 0
                    }
            in
            Policy.decide f
                |> Expect.equal NoMarker

    , test "BNA-09: negative remainingNotify -> NoMarker (fail-closed)" <|
        \_ ->
            let
                f =
                    { jobId = "J-9"
                    , terminalState = Exited
                    , isContainmentFailed = False
                    , exitCode = JobExitCode 0
                    , reason = Nothing
                    , outputTail = Nothing
                    , markerPresence = MarkerPresent "S" (Just "T")
                    , activeOwner = ActiveOwner "S" (Just "T")
                    , remainingNotify = -1
                    }
            in
            Policy.decide f
                |> Expect.equal NoMarker

    , test "BNA-10: negative exitCode -> NoMarker (fail-closed)" <|
        \_ ->
            let
                f =
                    { jobId = "J-10"
                    , terminalState = Exited
                    , isContainmentFailed = False
                    , exitCode = JobExitCode -2
                    , reason = Nothing
                    , outputTail = Nothing
                    , markerPresence = MarkerPresent "S" (Just "T")
                    , activeOwner = ActiveOwner "S" (Just "T")
                    , remainingNotify = 0
                    }
            in
            Policy.decide f
                |> Expect.equal NoMarker

    , test "BNA-11: malformed facts -> factsIsExpected is False" <|
        \_ ->
            let
                f =
                    { jobId = ""
                    , terminalState = Unknown
                    , isContainmentFailed = False
                    , exitCode = Absent
                    , reason = Nothing
                    , outputTail = Nothing
                    , markerPresence = MarkerAbsent
                    , activeOwner = NoActiveOwner
                    , remainingNotify = -1
                    }
            in
            factsIsExpected f
                |> Expect.equal False

    , test "BNA-12: marker absent + everything else valid -> NoMarker" <|
        \_ ->
            let
                f =
                    { jobId = "J-12"
                    , terminalState = Exited
                    , isContainmentFailed = False
                    , exitCode = JobExitCode 0
                    , reason = Just "duplicate"
                    , outputTail = Nothing
                    , markerPresence = MarkerAbsent
                    , activeOwner = ActiveOwner "S" (Just "T")
                    , remainingNotify = 0
                    }
            in
            Policy.decide f
                |> Expect.equal NoMarker
    ]


-- ---------------------------------------------------------------------------
-- Wire round-trip
-- ---------------------------------------------------------------------------


wireRoundTripSuite : List Test
wireRoundTripSuite =
    [ test "WR-01: BNA-07 facts encode -> decode -> decide is stable" <|
        \_ ->
            let
                f =
                    { jobId = "J-WR-1"
                    , terminalState = Exited
                    , isContainmentFailed = False
                    , exitCode = JobExitCode 0
                    , reason = Nothing
                    , outputTail = Nothing
                    , markerPresence = MarkerPresent "S" (Just "T")
                    , activeOwner = ActiveOwner "S" (Just "T")
                    , remainingNotify = 0
                    }

                wireValue =
                    Encode.object
                        [ ( "version", Encode.int 1 )
                        , ( "facts", factsToJson f )
                        ]

                roundTripped =
                    Decode.decodeString Codec.factsDecoder
                        (Encode.encode 0 wireValue)
            in
            case roundTripped of
                Ok f2 ->
                    Policy.decide f2
                        |> Expect.equal (Drained "J-WR-1" 1)

                Err err ->
                    Expect.fail (Decode.errorToString err)

    , test "WR-02: BNA-05 facts encode -> decode -> decide is stable" <|
        \_ ->
            let
                f =
                    { jobId = "J-WR-2"
                    , terminalState = ContainmentFailed
                    , isContainmentFailed = True
                    , exitCode = JobExitCode 137
                    , reason = Just "killed"
                    , outputTail = Nothing
                    , markerPresence = MarkerPresent "S" (Just "T")
                    , activeOwner = ActiveOwner "S" (Just "T")
                    , remainingNotify = 0
                    }

                wireValue =
                    Encode.object
                        [ ( "version", Encode.int 1 )
                        , ( "facts", factsToJson f )
                        ]

                roundTripped =
                    Decode.decodeString Codec.factsDecoder
                        (Encode.encode 0 wireValue)
            in
            case roundTripped of
                Ok f2 ->
                    Policy.decide f2
                        |> Expect.equal (ContainmentNoWake "J-WR-2")

                Err err ->
                    Expect.fail (Decode.errorToString err)
    ]


-- ---------------------------------------------------------------------------
-- Decoder fail-closed (malformed edge matrix)
-- ---------------------------------------------------------------------------


decoderFailClosedSuite : List Test
decoderFailClosedSuite =
    [ test "DE-01: missing version field -> decode error" <|
        \_ ->
            Decode.decodeString Codec.factsDecoder """{"facts":{}}"""
                |> Expect.err

    , test "DE-02: version != 1 -> decode error" <|
        \_ ->
            Decode.decodeString Codec.factsDecoder """{"version":2,"facts":{}}"""
                |> Expect.err

    , test "DE-03: missing facts field -> decode error" <|
        \_ ->
            Decode.decodeString Codec.factsDecoder """{"version":1}"""
                |> Expect.err

    , test "DE-04: missing jobId -> decode error" <|
        \_ ->
            Decode.decodeString Codec.factsDecoder """{"version":1,"facts":{}}"""
                |> Expect.err

    , test "DE-05: jobId not a string -> decode error" <|
        \_ ->
            Decode.decodeString Codec.factsDecoder """{"version":1,"facts":{"jobId":42}}"""
                |> Expect.err

    , test "DE-06: unknown terminalState tag -> decode error" <|
        \_ ->
            Decode.decodeString Codec.factsDecoder
                """{"version":1,"facts":{"jobId":"J","terminalState":"zombie","isContainmentFailed":false,"exitCode":0,"reason":null,"outputTail":null,"markerSessionId":null,"markerTaskId":null,"activeOwnerSessionId":null,"activeOwnerTaskId":null,"remainingNotify":0}}"""
                |> Expect.err

    , test "DE-07: negative exitCode (not -1 sentinel) -> decode error" <|
        \_ ->
            Decode.decodeString Codec.factsDecoder
                """{"version":1,"facts":{"jobId":"J","terminalState":"exited","isContainmentFailed":false,"exitCode":-7,"reason":null,"outputTail":null,"markerSessionId":null,"markerTaskId":null,"activeOwnerSessionId":null,"activeOwnerTaskId":null,"remainingNotify":0}}"""
                |> Expect.err

    , test "DE-08: negative remainingNotify -> decode error" <|
        \_ ->
            Decode.decodeString Codec.factsDecoder
                """{"version":1,"facts":{"jobId":"J","terminalState":"exited","isContainmentFailed":false,"exitCode":-1,"reason":null,"outputTail":null,"markerSessionId":null,"markerTaskId":null,"activeOwnerSessionId":null,"activeOwnerTaskId":null,"remainingNotify":-1}}"""
                |> Expect.err

    , test "DE-09: markerSessionId present + markerTaskId null -> decode error" <|
        \_ ->
            Decode.decodeString Codec.factsDecoder
                """{"version":1,"facts":{"jobId":"J","terminalState":"exited","isContainmentFailed":false,"exitCode":0,"reason":null,"outputTail":null,"markerSessionId":"S","markerTaskId":null,"activeOwnerSessionId":null,"activeOwnerTaskId":null,"remainingNotify":0}}"""
                |> Expect.err

    , test "DE-10: isContainmentFailed not bool -> decode error" <|
        \_ ->
            Decode.decodeString Codec.factsDecoder
                """{"version":1,"facts":{"jobId":"J","terminalState":"exited","isContainmentFailed":"yes","exitCode":0,"reason":null,"outputTail":null,"markerSessionId":null,"markerTaskId":null,"activeOwnerSessionId":null,"activeOwnerTaskId":null,"remainingNotify":0}}"""
                |> Expect.err
    ]


-- ---------------------------------------------------------------------------
-- Necessity
-- ---------------------------------------------------------------------------


necessitySuite : List Test
necessitySuite =
    [ test "NE-01: precedence corpus has >=6 non-NoMarker fixtures" <|
        \_ ->
            -- We do NOT have a second Policy here; instead, we
            -- demonstrate necessity by showing that the
            -- precedence-ordering is non-trivial. If the policy
            -- short-circuited to always return `NoMarker`, the
            -- BNA-02..07 corpus (six fixtures) would all
            -- diverge. The C32 necessity evidence in the vitest
            -- layer mutates the compiled JS to assert the gate
            -- fails.
            let
                corpus =
                    [ bna02
                    , bna03
                    , bna04
                    , bna05
                    , bna06
                    , bna07
                    ]

                divergent =
                    List.length
                        (List.filter
                            (\f -> Policy.decide f /= NoMarker)
                            corpus
                        )
            in
            Expect.atLeast 6 divergent
    ]


-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------


bna02 : Facts
bna02 =
    { jobId = "J"
    , terminalState = Exited
    , isContainmentFailed = False
    , exitCode = JobExitCode 0
    , reason = Nothing
    , outputTail = Nothing
    , markerPresence = MarkerPresent "S" (Just "T")
    , activeOwner = NoActiveOwner
    , remainingNotify = 0
    }


bna03 : Facts
bna03 =
    { jobId = "J"
    , terminalState = Exited
    , isContainmentFailed = False
    , exitCode = JobExitCode 0
    , reason = Nothing
    , outputTail = Nothing
    , markerPresence = MarkerPresent "S1" (Just "T")
    , activeOwner = ActiveOwner "S2" (Just "T")
    , remainingNotify = 0
    }


bna04 : Facts
bna04 =
    { jobId = "J"
    , terminalState = Exited
    , isContainmentFailed = False
    , exitCode = JobExitCode 0
    , reason = Nothing
    , outputTail = Nothing
    , markerPresence = MarkerPresent "S" (Just "T1")
    , activeOwner = ActiveOwner "S" (Just "T2")
    , remainingNotify = 0
    }


bna05 : Facts
bna05 =
    { jobId = "J"
    , terminalState = ContainmentFailed
    , isContainmentFailed = True
    , exitCode = JobExitCode 137
    , reason = Just "killed"
    , outputTail = Nothing
    , markerPresence = MarkerPresent "S" (Just "T")
    , activeOwner = ActiveOwner "S" (Just "T")
    , remainingNotify = 0
    }


bna06 : Facts
bna06 =
    { jobId = "J"
    , terminalState = Exited
    , isContainmentFailed = False
    , exitCode = JobExitCode 0
    , reason = Nothing
    , outputTail = Nothing
    , markerPresence = MarkerPresent "S" (Just "T")
    , activeOwner = ActiveOwner "S" (Just "T")
    , remainingNotify = 2
    }


bna07 : Facts
bna07 =
    { jobId = "J"
    , terminalState = Exited
    , isContainmentFailed = False
    , exitCode = JobExitCode 0
    , reason = Nothing
    , outputTail = Nothing
    , markerPresence = MarkerPresent "S" (Just "T")
    , activeOwner = ActiveOwner "S" (Just "T")
    , remainingNotify = 0
    }


factsToJson : Facts -> Encode.Value
factsToJson f =
    Encode.object
        [ ( "jobId", Encode.string f.jobId )
        , ( "terminalState", Encode.string (Codec.encodeTerminalState f.terminalState) )
        , ( "isContainmentFailed", Encode.bool f.isContainmentFailed )
        , ( "exitCode", Encode.int (Codec.encodeJobExitCode f.exitCode) )
        , ( "reason"
          , case f.reason of
                Just s ->
                    Encode.string s

                Nothing ->
                    Encode.null
          )
        , ( "outputTail"
          , case f.outputTail of
                Just s ->
                    Encode.string s

                Nothing ->
                    Encode.null
          )
        , ( "markerSessionId", nullableString (markerSessionIdOf f.markerPresence) )
        , ( "markerTaskId", nullableString (markerTaskIdOf f.markerPresence) )
        , ( "activeOwnerSessionId", nullableString (activeOwnerSessionIdOf f.activeOwner) )
        , ( "activeOwnerTaskId", nullableString (activeOwnerTaskIdOf f.activeOwner) )
        , ( "remainingNotify", Encode.int f.remainingNotify )
        ]


nullableString : Maybe String -> Encode.Value
nullableString m =
    case m of
        Just s ->
            Encode.string s

        Nothing ->
            Encode.null


markerSessionIdOf : MarkerPresence -> Maybe String
markerSessionIdOf mp =
    case mp of
        MarkerAbsent ->
            Nothing

        MarkerPresent s _ ->
            Just s


markerTaskIdOf : MarkerPresence -> Maybe String
markerTaskIdOf mp =
    case mp of
        MarkerAbsent ->
            Nothing

        MarkerPresent _ t ->
            t


activeOwnerSessionIdOf : OwnerKey -> Maybe String
activeOwnerSessionIdOf ok =
    case ok of
        NoActiveOwner ->
            Nothing

        ActiveOwner s _ ->
            Just s


activeOwnerTaskIdOf : OwnerKey -> Maybe String
activeOwnerTaskIdOf ok =
    case ok of
        NoActiveOwner ->
            Nothing

        ActiveOwner _ t ->
            t
