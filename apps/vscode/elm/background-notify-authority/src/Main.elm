port module Main exposing (main)

{-| Headless JS entrypoint for the background-notify-authority Elm
kernel.

C15 strict-typing invariant: the inbound port takes `String`, NOT
`Value`. The TS adapter MUST pre-serialize the facts through
`JSON.stringify` and pass the resulting JSON STRING to the kernel.
The kernel then calls `Decode.decodeString` which invokes
`JSON.parse` on the string, ensuring the schema's `Decode.bool`
sees actual JSON boolean literals (not JS-coerced truthy strings
like "yes").

ACT-CLINEMM-ELM-SEAM03-BACKGROUND-NOTIFY-AUTHORITY:

  The outbound message carries the typed `ConsumeDecision` plus a
  diagnostic `summary` field. The TS adapter MUST NOT consult the
  `summary` field — the `kind` (and its payload) is the SOLE
  semantic authority. The `summary` is included for the
  differential correspondence fixtures (which assert the
  classification) and for the LIVE operator's dogfood dump.

  The architecture is identical to the prior kernels: a
  `Platform.worker` with two ports, no React, no DOM. The TS
  adapter calls `kernel.sendInbound(jsonString)` and reads the
  next outbound message via `kernel.recvOutbound()`. The kernel
  is loaded from the runtime asset at
  `runtime-assets/background-notify-authority.js` (added to
  `scripts/build_dogfood_vsix_lib.py:_ELM_KERNELS` in this ACT).
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
            -- Decode errors are CORRELATED when the inbound still
            -- carried a requestId (e.g. version mismatch, partial
            -- owner). We attempt to extract the requestId so the
            -- TS adapter can reject the matching pending entry
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
