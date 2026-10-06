port module Main exposing (main)

{-| Headless JS entrypoint for the TaskHeader presentation Elm kernel.

The Elm kernel is a *pure* projection in `Orchestration` / `Domain`. This
module exists only to:

  1. Give `elm make` a real `Main` so it emits a JS bundle (Elm 0.19
     requires a `Main` module with a `main : Program ...` value at the
     root for JS compilation).
  2. Expose the kernel via two ports so the TS adapter has a coarse
     interop boundary per ACT §5 / C5:

         inbound  : Facts JSON   -> kernel
         outbound : Result JSON  -> TS

     The kernel emits a closed `OutMsg` JSON shape on the outbound
     port: `kind: "presentation" | "decode_error"` with the matching
     payload. The TS adapter reads the predictions.

  3. Guarantee the kernel stays pure: the kernel has no `Task`s or
     `Cmd`s beyond outbound JSON encoding. The `init` model is
     `Nothing`; the kernel holds no state across steps.

This module is intentionally tiny. The reasoning lives in
Orchestration.elm. The wire shape lives in Codec.elm.
-}

import Codec
import Domain
import Json.Decode as Decode
import Json.Encode as Encode exposing (Value)
import Orchestration


port inbound : (Value -> msg) -> Sub msg


port outbound : Value -> Cmd msg


type alias Flags =
    Value


type Msg
    = Step Value


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
updateMain (Step value) _ =
    case Decode.decodeValue Codec.factsDecoder value of
        Ok facts ->
            let
                presentation =
                    Orchestration.projectPresentation facts
            in
            ( (), outbound (Encode.object
                    [ ( "kind", Encode.string "presentation" )
                    , ( "presentation", Codec.encodePresentation presentation )
                    ]
                )
            )

        Err err ->
            ( (), outbound (Encode.object
                    [ ( "kind", Encode.string "decode_error" )
                    , ( "error", Encode.string (Codec.decodeErrorToString err) )
                    ]
                )
            )


subscriptions : Model -> Sub Msg
subscriptions _ =
    inbound Step