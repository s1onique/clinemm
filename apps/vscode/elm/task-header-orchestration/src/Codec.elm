module Codec exposing
    ( factsDecoder
    , encodePresentation
    , phaseDecoder
    , phaseEncoder
    , sourceDecoder
    , sourceEncoder
    , decodeErrorToString
    )


{-| JSON wire contract for the Elm TaskHeader presentation kernel.

Inbound facts arrive as tagged JSON. Outbound presentations leave as
tagged JSON. The mapping is closed and FROZEN per ACT §4 (C4 of the
ACT).

Adding a new tag is a breaking change for the wire contract and the
differential correspondence fixtures.

The decoder is **fail-closed**:

  * `canonicalShadowPhase` may be `null` or omitted — both decode to
    `Nothing`. There is no other path for absence.
  * `canonicalShadowObservedTurnSeq` may be `null`, omitted, or a
    non-negative integer — anything else rejects the input.
  * `seq` is required and must be an integer.
  * `currentLegacyPhase` is required and must be a known phase tag.
  * Unknown phase tags reject the input (the closed vocabulary above).
  * Unknown source tags reject the output (the closed vocabulary above).

There is NO silent default-authorize / default-present fallback anywhere
in this module. The TS adapter sees the `Err` branch and surfaces a
bounded classification — it MUST NOT retry, interpret, or auto-present.
-}

import Domain
import Json.Decode as Decode exposing (Decoder)
import Json.Encode as Encode exposing (Value)


{-| Decode a `Facts` value from JSON.

Expected JSON shape (field names mirror the wire `TaskHeaderPresentationInputs`):

    {
      "canonicalShadowPhase"          : "idle" | "streaming" | ... | null,
      "currentLegacyPhase"            : "idle" | "streaming" | ...,
      "seq"                           : <integer>,
      "canonicalShadowObservedTurnSeq": <integer> | null
    }
-}
factsDecoder : Decoder Domain.Facts
factsDecoder =
    Decode.map4
            (\shadowPhase legacyPhase s observedSeq ->
                Domain.Facts shadowPhase legacyPhase s observedSeq
            )
            (Decode.field "canonicalShadowPhase" phaseDecoderNullable)
            (Decode.field "currentLegacyPhase" phaseDecoder)
            (Decode.field "seq" seqDecoder)
            (Decode.field "canonicalShadowObservedTurnSeq" intDecoderNullable)


{-| Decode a `TurnPhase` value. Rejects unknown tags.
-}
phaseDecoder : Decoder Domain.TurnPhase
phaseDecoder =
    Decode.string
        |> Decode.andThen
            (\s ->
                case Domain.turnPhaseFromString s of
                    Just p ->
                        Decode.succeed p

                    Nothing ->
                        Decode.fail ("unknown turn phase: " ++ s)
            )


{-| Decode a nullable `TurnPhase` value. `null` and missing both
collapse to `Nothing`.
-}
phaseDecoderNullable : Decoder (Maybe Domain.TurnPhase)
phaseDecoderNullable =
    Decode.oneOf
        [ Decode.null Nothing
        , Decode.field "tag" (Decode.string |> Decode.andThen decodePhaseFromTagged)
        , Decode.string |> Decode.andThen decodePhaseFromString
        ]


decodePhaseFromString : String -> Decoder (Maybe Domain.TurnPhase)
decodePhaseFromString s =
    case Domain.turnPhaseFromString s of
        Just p ->
            Decode.succeed (Just p)

        Nothing ->
            Decode.fail ("unknown turn phase: " ++ s)


decodePhaseFromTagged : String -> Decoder (Maybe Domain.TurnPhase)
decodePhaseFromTagged tag =
    case Domain.turnPhaseFromString tag of
        Just p ->
            Decode.succeed (Just p)

        Nothing ->
            Decode.fail ("unknown turn phase tag: " ++ tag)


{-| Decode the `seq` integer. Rejects non-integers and non-finite values.
-}
seqDecoder : Decoder Int
seqDecoder =
    Decode.int


{-| Decode a nullable non-negative integer. `null` and missing collapse
to `Nothing`. Negative numbers reject the input (the production seam has
count > 0 by construction).
-}
intDecoderNullable : Decoder (Maybe Int)
intDecoderNullable =
    Decode.oneOf
        [ Decode.null Nothing
        , Decode.int |> Decode.andThen requireNonNegativeInt
        ]


requireNonNegativeInt : Int -> Decoder (Maybe Int)
requireNonNegativeInt n =
    if n < 0 then
        Decode.fail ("canonicalShadowObservedTurnSeq must be non-negative: " ++ String.fromInt n)

    else
        Decode.succeed (Just n)


-- ---------------------------------------------------------------------------
-- Encoding (Presentation -> JSON)
-- ---------------------------------------------------------------------------


encodePresentation : Domain.Presentation -> Value
encodePresentation presentation =
    Encode.object
        [ ( "phase", phaseEncoder presentation.phase )
        , ( "source", sourceEncoder presentation.source )
        , ( "seq", Encode.int presentation.seq )
        ]


phaseEncoder : Domain.TurnPhase -> Value
phaseEncoder phase =
    Encode.string (Domain.turnPhaseToString phase)


sourceEncoder : Domain.PresentationSource -> Value
sourceEncoder source =
    Encode.string (Domain.presentationSourceToString source)


sourceDecoder : Decoder Domain.PresentationSource
sourceDecoder =
    Decode.string
        |> Decode.andThen
            (\s ->
                case Domain.presentationSourceFromString s of
                    Just src ->
                        Decode.succeed src

                    Nothing ->
                        Decode.fail ("unknown presentation source: " ++ s)
            )


{-| Render a JSON decode error as a bounded, fail-closed message. Used by
the Main port to surface the bounded `kind: "decode_error"` shape that
the TS adapter classifies as `task_header_elm_decode_error`.
-}
decodeErrorToString : Decode.Error -> String
decodeErrorToString err =
    Decode.errorToString err