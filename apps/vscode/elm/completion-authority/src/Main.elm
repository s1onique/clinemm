port module Main exposing (main)

{-| Headless JS entrypoint for the completion-authority Elm kernel.

The Elm kernel is a *pure* state machine in `Authority` / `Domain`. This
module exists only to:

  1. Give `elm make` a real `Main` so it emits a JS bundle (Elm 0.19
     requires a `Main` module with a `main : Program ...` value at the
     root for JS compilation).
  2. Expose the kernel via two ports so the TS adapter has a coarse
     interop boundary per ACT §3 / §19:

        inbound  : Msg JSON   -> kernel
        outbound : Model JSON -> TS

     No effect is ever executed by this kernel — every effect is
     predicted and emitted as JSON. The TS side reads the predictions.

  3. Guarantee the kernel stays pure: the `init` model is
     `Domain.emptyModel` and there are no `Task`s or `Cmd`s beyond
     outbound JSON encoding.

This module is intentionally tiny. The reasoning lives in Authority.elm.
-}

import Authority exposing (updateWithViolations, violationName)
import Codec exposing (decoder, encodeModel)
import Domain exposing (Model, emptyModel)
import Json.Decode as Decode
import Json.Encode as Encode exposing (Value)


port inbound : (Value -> msg) -> Sub msg
port outbound : Value -> Cmd msg


type alias Flags =
    Value


type Msg
    = Step Value


main : Program Flags Model Msg
main =
    Platform.worker
        { init = init
        , update = updateMain
        , subscriptions = subscriptions
        }


init : Flags -> ( Model, Cmd Msg )
init _ =
    ( emptyModel
    , outbound
        (Encode.object [ ( "kind", Encode.string "ready" ) ])
    )


updateMain : Msg -> Model -> ( Model, Cmd Msg )
updateMain (Step value) model =
    case Decode.decodeValue decoder value of
        Ok elmMsg ->
            let
                ( newModel, _, mViolation ) =
                    updateWithViolations elmMsg model

                violationField =
                    case
                    mViolation
                    of
                        Just v ->
                            [ ( "violation"
                              , Encode.string (violationName v)
                              )
                            ]

                        Nothing ->
                            []
            in
            ( newModel
            , outbound
                (Encode.object
                    ([ ( "kind", Encode.string "state" )
                     , ( "model", encodeModel newModel )
                     ]
                        ++ violationField
                    )
                )
            )

        Err err ->
            ( model
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
