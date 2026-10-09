port module Main exposing (main)


{-| Headless JS entrypoint for the deferred-completion-barrier
E3.1 Elm kernel.

ACT-CLINEMM-ELM-SEAM08 (C1 / C2 / C4 / C10):

  The architecture mirrors the prior SEAM kernels (completion-
  continuation-control, background-notify-authority):

    - one `Platform.worker` with two ports (inbound + outbound)
    - one `init` that emits a `ready` message
    - one `Step` message that decodes the inbound JSON, runs
      `Policy.decide`, and emits the typed directive envelope
    - decode errors emit a correlated `decode_error` message
      (the C4 conservation test path)

  C15 strict-typing: the inbound port takes a JSON STRING. The
  TS adapter MUST pre-serialize through `JSON.stringify` and
  pass the resulting STRING (NOT a JS object). The kernel then
  calls `Decode.decodeString` which invokes `JSON.parse` first,
  so strict `typeof` checks fire (a `{"true".boolean === true}`
  leak like the C1-CORRECTION03 regression would be impossible
  here because the adapter never passes a JS object).

  C1 correlation protocol: the inbound `requestId` is echoed
  back on every outbound message (including `decode_error`).
  The TS adapter uses the echo to match the directive to the
  pending consult; two concurrent requests cannot swap
  responses.
-}
import Codec
import Json.Decode as Decode
import Json.Encode as Encode exposing (Value)
import Policy


port inbound : (String -> msg) -> Sub msg


port outbound : Value -> Cmd msg


type alias Flags =
    Value


type Msg
    = Step String


type alias Model =
    ()


main : Program Flags Model Msg
main =
    Platform.worker
        { init = init
        , update = updateMain
        , subscriptions = subscriptions
        }


init : Flags -> ( Model, Cmd Msg )
init _ =
    ( (), outbound (Encode.object [ ( "kind", Encode.string "ready" ) ]) )


updateMain : Msg -> Model -> ( Model, Cmd Msg )
updateMain (Step jsonString) _ =
    case Codec.envelopeFromString jsonString of
        Ok envelope ->
            let
                decision =
                    Policy.decide envelope.facts
            in
            ( ()
            , outbound (Codec.envelopeToOutbound envelope.requestId decision)
            )

        Err err ->
            -- C4 conservation: decode errors are CORRELATED
            -- when the inbound still carried a requestId. We
            -- attempt to extract the requestId so the TS
            -- adapter can reject the matching pending entry
            -- rather than leave it pending until the timeout.
            let
                requestId : Maybe String
                requestId =
                    case Decode.decodeString Decode.value jsonString of
                        Ok raw ->
                            case Decode.decodeValue (Decode.field "requestId" Decode.string) raw of
                                Ok rid ->
                                    Just rid

                                Err _ ->
                                    Nothing

                        Err _ ->
                            Nothing
            in
            ( ()
            , outbound
                (Encode.object
                    [ ( "kind", Encode.string "decode_error" )
                    , ( "error", Encode.string (Decode.errorToString err) )
                    , ( "requestId"
                      , case requestId of
                            Just rid ->
                                Encode.string rid

                            Nothing ->
                                Encode.null
                      )
                    ]
                )
            )


subscriptions : Model -> Sub Msg
subscriptions _ =
    inbound Step
