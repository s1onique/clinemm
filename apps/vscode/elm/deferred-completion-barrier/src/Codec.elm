module Codec exposing
    ( Envelope
    , factsDecoder
    , envelopeDecoder
    , envelopeFromString
    , envelopeToOutbound
    , encodeDirective
    )


{-| JSON wire contract for the deferred-completion-barrier E3.1
kernel.

ACT-CLINEMM-ELM-SEAM08 (C2 / C10 / C15):

  Closed wire schema. The TS adapter pre-serializes the input
  through `JSON.stringify` and passes the JSON STRING to the
  inbound port. The kernel calls `Decode.decodeString` which
  invokes `JSON.parse` first, so strict `typeof` checks fire.

C15 strict-typing: inbound port takes a JSON STRING, not a JS
object. The TS adapter MUST pre-serialize.
-}
import Domain exposing (..)
import Json.Decode as Decode exposing (Decoder)
import Json.Encode as Encode exposing (Value)


-- ---------------------------------------------------------------------------
-- Inbound envelope
-- ---------------------------------------------------------------------------


type alias Envelope =
    { version : Int
    , requestId : Maybe String
    , facts : Facts
    }


envelopeDecoder : Decoder Envelope
envelopeDecoder =
    Decode.map3
        (\v rid f -> { version = v, requestId = rid, facts = f })
        (Decode.field "version" Decode.int)
        (optionalString "requestId")
        (Decode.field "facts" factsDecoder)


optionalString : String -> Decoder (Maybe String)
optionalString fieldName =
    Decode.maybe (Decode.field fieldName Decode.string)


-- ---------------------------------------------------------------------------
-- Inbound Facts decoder
-- ---------------------------------------------------------------------------


{-| Decoder for the closed `Facts` shape. Strict typed:
non-Int epochs, non-Bool markerPresent, non-Array held set all
fail the WHOLE decode.

Elm 0.19.2's `Decode` module exposes only `map2..map8`, so we
compose via curried `Decode.succeed` + `Decode.andThen` to
reach all 12 fields. The order is preserved by the closure
shape (each lambda returns a function waiting for the next
field).
-}
factsDecoder : Decoder Facts
factsDecoder =
    Decode.succeed
        (\sid tid msid mtid me ce cse lcse chs phs hc lmp ->
            { sessionId = sid
            , taskId = tid
            , markerSessionId = msid
            , markerTaskId = mtid
            , markerEpoch = me
            , currentEpoch = ce
            , continuationSessionEpoch = cse
            , lastContinuationSessionEpoch = lcse
            , currentHeldSetSorted = chs
            , priorHeldSetSorted = phs
            , heldJobCount = hc
            , liveMarkerPresent = lmp
            }
        )
        |> andThenField (Decode.field "sessionId" Decode.string)
        |> andThenField (optionalString "taskId")
        |> andThenField (Decode.field "markerSessionId" Decode.string)
        |> andThenField (optionalString "markerTaskId")
        |> andThenField (Decode.field "markerEpoch" Decode.int)
        |> andThenField (Decode.field "currentEpoch" Decode.int)
        |> andThenField (Decode.field "continuationSessionEpoch" Decode.string)
        |> andThenField (optionalString "lastContinuationSessionEpoch")
        |> andThenField (sortedStringListDecoder "currentHeldSetSorted")
        |> andThenField (optionalSortedStringList "priorHeldSetSorted")
        |> andThenField (Decode.field "heldJobCount" Decode.int)
        |> andThenField (Decode.field "liveMarkerPresent" Decode.bool)


{-| Apply a field decoder to a curried constructor, threading
the value through. Each step adds one argument to the function
returned by the previous `Decode.succeed`.

This is a local re-implementation of `Json.Decode.Extra.andMap`
without taking a dependency on the extra package.
-}
andThenField : Decoder a -> Decoder (a -> b) -> Decoder b
andThenField fieldDecoder =
    Decode.andThen
        (\f ->
            fieldDecoder
                |> Decode.map f
        )


{-| Strict `List String` decoder for held sets. Rejects
non-list, non-string, empty-string values.
-}
sortedStringListDecoder : String -> Decoder (List String)
sortedStringListDecoder fieldName =
    Decode.field fieldName (Decode.list strictString)


{-| Reject empty strings in the held set. The closed-schema
contract preserves the `factsIsExpected` invariant.
-}
strictString : Decoder String
strictString =
    Decode.string
        |> Decode.andThen
            (\s ->
                if String.isEmpty s then
                    Decode.fail "empty string in held set"

                else
                    Decode.succeed s
            )


{-| Optional sorted string list (the `priorHeldSetSorted` is
nullable; the first-call semantic uses null).
-}
optionalSortedStringList : String -> Decoder (Maybe (List String))
optionalSortedStringList fieldName =
    Decode.maybe (Decode.field fieldName (Decode.list strictString))


{-| Decode the inbound JSON STRING into the typed `Envelope`.
-}
envelopeFromString : String -> Result Decode.Error Envelope
envelopeFromString =
    Decode.decodeString envelopeDecoder


-- ---------------------------------------------------------------------------
-- Outbound encoder
-- ---------------------------------------------------------------------------


{-| Encode a `BarrierDirective` to the closed wire shape.
-}
encodeDirective : BarrierDirective -> Value
encodeDirective d =
    case d of
        PermitEnqueue { mustClearRearm } ->
            Encode.object
                [ ( "kind", Encode.string "permit_enqueue" )
                , ( "mustClearRearm", Encode.bool mustClearRearm )
                ]

        SuppressDuplicate ->
            Encode.object
                [ ( "kind", Encode.string "suppress_duplicate" )
                ]

        PreserveBarrier ->
            Encode.object
                [ ( "kind", Encode.string "preserve_barrier" )
                ]

        RejectStaleIdentity { reason } ->
            Encode.object
                [ ( "kind", Encode.string "reject_stale_identity" )
                , ( "reason", Encode.string (encodeReason reason) )
                ]


encodeReason : BarrierDecisionReason -> String
encodeReason r =
    case r of
        MarkerAbsent ->
            "marker_absent"

        SessionIdentityMismatch ->
            "session_mismatch"

        TaskIdentityMismatch ->
            "task_mismatch"

        EpochMismatch ->
            "epoch_mismatch"


{-| Build the outbound `Value` with the requested `requestId`
echoed back.
-}
envelopeToOutbound : Maybe String -> BarrierDirective -> Value
envelopeToOutbound requestId directive =
    Encode.object
        [ ( "kind", Encode.string "directive" )
        , ( "directive", encodeDirective directive )
        , ( "requestId"
          , case requestId of
                Just rid ->
                    Encode.string rid

                Nothing ->
                    Encode.null
          )
        ]
