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
import Domain exposing (ConsumeDecision(..))
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
    case Codec.factsFromString jsonString of
        Ok facts ->
            let
                decision =
                    Policy.decide facts
            in
            ( ()
            , outbound
                (Encode.object
                    [ ( "kind", Encode.string "directive" )
                    , ( "decision", Codec.encodeDecision decision )
                    , ( "summary", Encode.string (summaryOf decision) )
                    ]
                )
            )

        Err err ->
            ( ()
            , outbound
                (Encode.object
                    [ ( "kind", Encode.string "decode_error" )
                    , ( "error", Encode.string (Decode.errorToString err) )
                    ]
                )
            )


{-| Compact one-line diagnostic summary of the decision. Used for
the C14 differential correspondence fixtures and for the LIVE
operator's dogfood dump. The TS adapter does NOT consult this
field.
-}
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


subscriptions : Model -> Sub Msg
subscriptions _ =
    inbound Step
