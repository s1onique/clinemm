port module Main exposing (main)

{-| Headless JS entrypoint for the completion-continuation-control Elm kernel.

C15 strict-typing invariant: the inbound port takes `String`, NOT `Value`.
The TS adapter MUST pre-serialize the facts through `JSON.stringify`
and pass the resulting JSON STRING to the kernel. The kernel then calls
`Decode.decodeString` which invokes `JSON.parse` on the string,
ensuring the schema's `Decode.bool` sees actual JSON boolean literals
(not JS-coerced truthy strings like "yes").

ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01 (C5 / C6):

  The outbound message now carries the `heldSetProgress` diagnostic
  field alongside the `directive`. The TS adapter MUST NOT consult
  the diagnostic field — the `directive` is the SOLE semantic
  authority. The diagnostic is included for the C14 differential
  correspondence fixtures (which assert the classification) and for
  the LIVE operator's dogfood dump (the held-set progress
  classification is the most actionable signal for diagnosing
  stalled-rearm-loop recurrences).
-}
import Codec
import Domain exposing (HeldSetProgress(..))
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
                directive =
                    Policy.decide facts

                progress =
                    Policy.classifyHeldSetProgress facts.priorHeldSetSorted facts.currentHeldSetSorted
            in
            ( ()
            , outbound
                (Encode.object
                    [ ( "kind", Encode.string "directive" )
                    , ( "directive", Codec.encodeDirective directive )
                    , ( "heldSetProgress", Encode.string (Codec.encodeHeldSetProgress progress) )
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


subscriptions : Model -> Sub Msg
subscriptions _ =
    inbound Step