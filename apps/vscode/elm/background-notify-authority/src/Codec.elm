module Codec exposing
    ( Envelope
    , factsDecoder
    , factsFromString
    , envelopeDecoder
    , envelopeFromString
    , envelopeToOutbound
    , encodeDecision
    , encodeTerminalState
    , encodeMarkerPresence
    , encodeOwnerKey
    , encodeJobExitCode
    , summaryOf
    )


{-| JSON wire contract for the background-notify-authority kernel.

Inbound facts arrive as tagged JSON. Outbound decisions leave as
tagged JSON. The mapping is closed and FROZEN per ACT C10. Adding
a new tag is a breaking change for the wire contract and the
differential correspondence fixtures.

Closed wire schema (C10):

Inbound `Facts`:

  {
    "version": 1,
    "facts": {
      "jobId": String,
      "terminalState": "exited" | "failed" | "aborted" | "killed"
                       | "containment_failed" | "unknown",
      "isContainmentFailed": Bool,
      "exitCode": Int | -1,
      "reason": String | null,
      "outputTail": String | null,
      "markerSessionId": String | null,
      "markerTaskId": String | null,
      "activeOwnerSessionId": String | null,
      "activeOwnerTaskId": String | null,
      "remainingNotify": Int
    }
  }

`markerSessionId` / `markerTaskId` together encode the
`MarkerPresence` enum. `activeOwnerSessionId` / `activeOwnerTaskId`
together encode the `OwnerKey` enum. `exitCode: -1` is the
sentinel for `Absent`.

Outbound `ConsumeDecision`:

  { "kind": "no_marker" }
  { "kind": "owner_mismatch" }
  { "kind": "containment_no_wake", "jobId": String }
  { "kind": "held", "jobId": String, "heldCount": Int }
  { "kind": "drained", "jobId": String, "drainedCount": Int }

C15 / C10 strict-typing invariant: the inbound port takes a JSON
STRING, not a JS object. The TS adapter MUST pre-serialize the
facts through `JSON.stringify` and pass the resulting JSON STRING
to the kernel. The kernel then calls `Decode.decodeString` which
invokes `JSON.parse` first, so strict `typeof` checks fire.
-}
import Domain exposing (..)
import Json.Decode as Decode exposing (Decoder)
import Json.Encode as Encode exposing (Value)


-- ---------------------------------------------------------------------------
-- Inbound decoder (Facts)
-- ---------------------------------------------------------------------------


{-| Inbound envelope: `version`, optional `requestId` (opaque, host-owned
correlation token), and the typed `facts`. The `requestId` is a
host-owned passthrough — the kernel does NOT consult it for policy
decisions; it only echoes it back on the outbound envelope so the
TS adapter can route concurrent requests to the right pending
resolver.

Wire envelope (C2 correlation protocol):

  {
    "version": 1,
    "requestId": "opaque-host-token",  -- optional, may be null
    "facts": { ... }
  }

When `requestId` is missing or `null` the kernel still emits a
directive; the TS adapter treats that as a non-correlated call
(used by the BNAEC01 audit-only path).
-}
type alias Envelope =
    { version : Int
    , requestId : Maybe String
    , facts : Facts
    }


envelopeDecoder : Decoder Envelope
envelopeDecoder =
    Decode.value
        |> Decode.andThen buildEnvelope


{-| Build an `Envelope` from the full inbound `Decode.Value`. The
`requestId` is extracted via `decodeOptionalString` so a missing
field resolves to `Nothing` (NOT a `Field` error). `version` and
`facts` are decoded strictly.
-}
buildEnvelope : Decode.Value -> Decoder Envelope
buildEnvelope raw =
    Decode.map2
        (\version facts ->
            Envelope version (decodeOptionalStringFromValue raw) facts
        )
        (Decode.field "version" versionDecoder)
        (Decode.field "facts" factsObjectDecoder)


{-| Extract the optional `requestId` from a `Decode.Value`. The
field is OPTIONAL: missing or `null` both resolve to `Nothing`,
present string resolves to `Just <string>`. We deliberately
catch the `Field` error so the optional semantics work.
-}
decodeOptionalStringFromValue : Decode.Value -> Maybe String
decodeOptionalStringFromValue raw =
    case Decode.decodeValue (Decode.field "requestId" decodeNullableString) raw of
        Ok v ->
            v

        Err _ ->
            Nothing


factsDecoder : Decoder Facts
factsDecoder =
    Decode.field "facts" factsObjectDecoder


envelopeFromString : String -> Result Decode.Error Envelope
envelopeFromString =
    Decode.decodeString envelopeDecoder


envelopeToOutbound : Maybe String -> ConsumeDecision -> Value
envelopeToOutbound requestId decision =
    Encode.object
        [ ( "kind", Encode.string "directive" )
        , ( "decision", encodeDecision decision )
        , ( "summary", Encode.string (summaryOf decision) )
        , ( "requestId"
          , case requestId of
                Just rid ->
                    Encode.string rid

                Nothing ->
                    Encode.null
          )
        ]


summaryOf : ConsumeDecision -> String
summaryOf d =
    case d of
        NoMarker ->
            "no_marker"

        OwnerMismatch ->
            "owner_mismatch"

        ContainmentNoWake jobId ->
            "containment_no_wake:" ++ jobId

        Held jobId heldCount ->
            "held:" ++ jobId ++ ":" ++ String.fromInt heldCount

        Drained jobId drainedCount ->
            "drained:" ++ jobId ++ ":" ++ String.fromInt drainedCount


versionDecoder : Decoder Int
versionDecoder =
    Decode.int
        |> Decode.andThen
            (\v ->
                if v == 1 then
                    Decode.succeed v

                else
                    Decode.fail "unsupported version (expected 1)"
            )


factsObjectDecoder : Decoder Facts
factsObjectDecoder =
    let
        firstThird =
            Decode.map3
                (\jobId ts icf ->
                    ( jobId, ts, icf )
                )
                (Decode.field "jobId" Decode.string)
                (Decode.field "terminalState" decodeTerminalState)
                (Decode.field "isContainmentFailed" Decode.bool)

        secondThird =
            Decode.map3
                (\ec r o ->
                    ( ec, r, o )
                )
                (Decode.field "exitCode" decodeJobExitCode)
                (Decode.field "reason" decodeNullableString)
                (Decode.field "outputTail" decodeNullableString)
    in
    Decode.map3
        (\( jobId, ts, icf ) ( ec, r, o ) ( mp, ao, rn ) ->
            { jobId = jobId
            , terminalState = ts
            , isContainmentFailed = icf
            , exitCode = ec
            , reason = r
            , outputTail = o
            , markerPresence = mp
            , activeOwner = ao
            , remainingNotify = rn
            }
        )
        firstThird
        secondThird
        (Decode.map3
            (\mp ao rn -> ( mp, ao, rn ))
            markerPresenceDecoder
            ownerKeyDecoder
            (Decode.field "remainingNotify" nonNegativeInt)
        )


{-| Decode a `TerminalState` from a wire string.
-}
decodeTerminalState : Decoder TerminalState
decodeTerminalState =
    Decode.string
        |> Decode.andThen
            (\s ->
                case s of
                    "exited" ->
                        Decode.succeed Exited

                    "failed" ->
                        Decode.succeed Failed

                    "aborted" ->
                        Decode.succeed Aborted

                    "killed" ->
                        Decode.succeed Killed

                    "containment_failed" ->
                        Decode.succeed ContainmentFailed

                    "unknown" ->
                        Decode.succeed Unknown

                    other ->
                        Decode.fail
                            ("unknown terminalState tag: " ++ other)
            )


{-| Decode an `JobExitCode` from the wire sentinel encoding. The TS
adapter MUST emit `-1` for the absent case.
-}
decodeJobExitCode : Decoder JobExitCode
decodeJobExitCode =
    Decode.int
        |> Decode.andThen
            (\n ->
                if n == -1 then
                    Decode.succeed Absent

                else if n >= 0 then
                    Decode.succeed (JobExitCode n)

                else
                    Decode.fail
                        ("negative exitCode (not -1 sentinel): " ++ String.fromInt n)
            )


decodeNullableString : Decoder (Maybe String)
decodeNullableString =
    Decode.oneOf
        [ Decode.null Nothing
        , Decode.string |> Decode.map Just
        ]


markerPresenceDecoder : Decoder MarkerPresence
markerPresenceDecoder =
    Decode.map2
        (\sid tid ->
            case ( sid, tid ) of
                ( Nothing, Nothing ) ->
                    Decode.succeed MarkerAbsent

                ( Just s, Just t ) ->
                    Decode.succeed (MarkerPresent s (Just t))

                ( Just _, Nothing ) ->
                    Decode.fail
                        "markerSessionId present + markerTaskId null is an invalid partial marker"

                ( Nothing, Just _ ) ->
                    Decode.fail
                        "markerSessionId null + markerTaskId present is an invalid partial marker"
        )
        (Decode.field "markerSessionId" decodeNullableString)
        (Decode.field "markerTaskId" decodeNullableString)
        |> Decode.andThen identity


ownerKeyDecoder : Decoder OwnerKey
ownerKeyDecoder =
    Decode.map2
        (\sid tid ->
            case ( sid, tid ) of
                ( Nothing, Nothing ) ->
                    Decode.succeed NoActiveOwner

                ( Just s, Just t ) ->
                    Decode.succeed (ActiveOwner s (Just t))

                ( Just _, Nothing ) ->
                    Decode.fail
                        "activeOwnerSessionId present + activeOwnerTaskId null is an invalid partial owner"

                ( Nothing, Just _ ) ->
                    Decode.fail
                        "activeOwnerSessionId null + activeOwnerTaskId present is an invalid partial owner"
        )
        (Decode.field "activeOwnerSessionId" decodeNullableString)
        (Decode.field "activeOwnerTaskId" decodeNullableString)
        |> Decode.andThen identity


nonNegativeInt : Decoder Int
nonNegativeInt =
    Decode.int
        |> Decode.andThen
            (\n ->
                if n >= 0 then
                    Decode.succeed n

                else
                    Decode.fail
                        ("negative remainingNotify: " ++ String.fromInt n)
            )


{-| Decode the inbound JSON STRING into the typed `Facts`.
-}
factsFromString : String -> Result Decode.Error Facts
factsFromString =
    Decode.decodeString factsDecoder


-- ---------------------------------------------------------------------------
-- Outbound encoder (ConsumeDecision)
-- ---------------------------------------------------------------------------


encodeDecision : ConsumeDecision -> Value
encodeDecision d =
    case d of
        NoMarker ->
            Encode.object [ ( "kind", Encode.string "no_marker" ) ]

        OwnerMismatch ->
            Encode.object [ ( "kind", Encode.string "owner_mismatch" ) ]

        ContainmentNoWake jobId ->
            Encode.object
                [ ( "kind", Encode.string "containment_no_wake" )
                , ( "jobId", Encode.string jobId )
                ]

        Held jobId heldCount ->
            Encode.object
                [ ( "kind", Encode.string "held" )
                , ( "jobId", Encode.string jobId )
                , ( "heldCount", Encode.int heldCount )
                ]

        Drained jobId drainedCount ->
            Encode.object
                [ ( "kind", Encode.string "drained" )
                , ( "jobId", Encode.string jobId )
                , ( "drainedCount", Encode.int drainedCount )
                ]


encodeTerminalState : TerminalState -> String
encodeTerminalState ts =
    case ts of
        Exited ->
            "exited"

        Failed ->
            "failed"

        Aborted ->
            "aborted"

        Killed ->
            "killed"

        ContainmentFailed ->
            "containment_failed"

        Unknown ->
            "unknown"


encodeMarkerPresence : MarkerPresence -> String
encodeMarkerPresence mp =
    case mp of
        MarkerAbsent ->
            "absent"

        MarkerPresent _ _ ->
            "present"


encodeOwnerKey : OwnerKey -> String
encodeOwnerKey ok =
    case ok of
        NoActiveOwner ->
            "absent"

        ActiveOwner _ _ ->
            "present"


encodeJobExitCode : JobExitCode -> Int
encodeJobExitCode ec =
    case ec of
        JobExitCode n ->
            n

        Absent ->
            -1