module Codec exposing
    ( encodeMsg
    , decoder
    , encodeModel
    , encodeViolation
    , encodeHoldReason
    , originToTag
    , tagToOrigin
    , tagToPromptOrigin
    , kindTag
    , kindFromTag
    )

{-| JSON wire contract for the Elm kernel.

Inbound events from the TS adapter arrive as tagged JSON. Outbound
predictions and diagnostics leave as tagged JSON. The mapping is
closed and FROZEN per ACT §20.

Adding a new tag is a breaking change for the wire contract and the
historical replay fixtures.
-}

import Domain exposing (..)
import Authority
import Json.Decode as Decode exposing (Decoder)
import Json.Encode as Encode exposing (Value)


decoder : Decoder Msg
decoder =
    Decode.field "tag" Decode.string
        |> Decode.andThen decodeMsgFromTag


decodeMsgFromTag : String -> Decoder Msg
decodeMsgFromTag tag =
    case tag of
        "task_started" ->
            Decode.map TaskStarted (Decode.field "taskId" (Decode.map TaskRef Decode.string))

        "run_started" ->
            Decode.map2 RunStarted
                (Decode.field "runId" (Decode.map RunRef Decode.string))
                (Decode.field "origin" Decode.string |> Decode.andThen (\t -> Decode.succeed (tagToOrigin t)))

        "agent_turn_done" ->
            Decode.map AgentTurnDone (Decode.field "runId" (Decode.map RunRef Decode.string))

        "terminal_registered" ->
            Decode.map3 TerminalRegistered
                (Decode.field "jobId" (Decode.map JobRef Decode.string))
                (Decode.field "ownerId" (Decode.map OwnerRef Decode.string))
                (Decode.field "kind" Decode.string |> Decode.andThen terminalKindDecoder)

        "terminal_observed" ->
            Decode.map TerminalObserved (Decode.field "jobId" (Decode.map JobRef Decode.string))

        "pending_prompt_enqueued" ->
            Decode.map2 PendingPromptEnqueued
                (Decode.field "promptId" (Decode.map PromptRef Decode.string))
                (Decode.field "origin" Decode.string |> Decode.andThen (\t -> Decode.succeed (tagToPromptOrigin t)))

        "pending_prompt_dequeued" ->
            Decode.map PendingPromptDequeued (Decode.field "promptId" (Decode.map PromptRef Decode.string))

        "continuation_scheduled" ->
            Decode.map ContinuationScheduled (Decode.field "promptId" (Decode.map PromptRef Decode.string))

        "continuation_started" ->
            Decode.map2 ContinuationStarted
                (Decode.field "promptId" (Decode.map PromptRef Decode.string))
                (Decode.field "runId" (Decode.map RunRef Decode.string))

        "submit_and_exit_seen" ->
            Decode.map SubmitAndExitSeen (Decode.field "submitId" (Decode.map SubmitRef Decode.string))

        "task_completion_committed" ->
            Decode.map TaskCompletionCommitted (Decode.field "completionId" (Decode.map CompletionRef Decode.string))

        "completion_presented" ->
            Decode.map CompletionPresented (Decode.field "completionId" (Decode.map CompletionRef Decode.string))

        "task_cancelled" ->
            Decode.succeed TaskCancelled

        "execute_turn_prelude_enter" ->
            Decode.map ExecuteTurnPreludeEnter (Decode.field "runId" (Decode.map RunRef Decode.string))

        other ->
            Decode.fail ("unknown msg tag: " ++ other)


terminalKindDecoder : String -> Decoder TerminalKind
terminalKindDecoder tag =
    case kindFromTag tag of
        Just k ->
            Decode.succeed k

        Nothing ->
            Decode.fail ("unknown terminal kind: " ++ tag)

-- ---------------------------------------------------------------------------
-- Outbound: Msg encoder (for diagnostics + replay)
-- ---------------------------------------------------------------------------


encodeMsg : Msg -> Value
encodeMsg msg =
    case msg of
        TaskStarted t ->
            Encode.object
                [ ( "tag", Encode.string "task_started" )
                , ( "taskId", Encode.string (taskRefToString t) )
                ]

        RunStarted r o ->
            Encode.object
                [ ( "tag", Encode.string "run_started" )
                , ( "runId", Encode.string (runRefToString r) )
                , ( "origin", Encode.string (originToTag o) )
                ]

        AgentTurnDone r ->
            Encode.object
                [ ( "tag", Encode.string "agent_turn_done" )
                , ( "runId", Encode.string (runRefToString r) )
                ]

        TerminalRegistered j o k ->
            Encode.object
                [ ( "tag", Encode.string "terminal_registered" )
                , ( "jobId", Encode.string (jobRefToString j) )
                , ( "ownerId", Encode.string (ownerRefToString o) )
                , ( "kind", Encode.string (kindTag k) )
                ]

        TerminalObserved j ->
            Encode.object
                [ ( "tag", Encode.string "terminal_observed" )
                , ( "jobId", Encode.string (jobRefToString j) )
                ]

        PendingPromptEnqueued p o ->
            Encode.object
                [ ( "tag", Encode.string "pending_prompt_enqueued" )
                , ( "promptId", Encode.string (promptRefToString p) )
                , ( "origin", Encode.string (promptOriginToTag o) )
                ]

        PendingPromptDequeued p ->
            Encode.object
                [ ( "tag", Encode.string "pending_prompt_dequeued" )
                , ( "promptId", Encode.string (promptRefToString p) )
                ]

        ContinuationScheduled p ->
            Encode.object
                [ ( "tag", Encode.string "continuation_scheduled" )
                , ( "promptId", Encode.string (promptRefToString p) )
                ]

        ContinuationStarted p r ->
            Encode.object
                [ ( "tag", Encode.string "continuation_started" )
                , ( "promptId", Encode.string (promptRefToString p) )
                , ( "runId", Encode.string (runRefToString r) )
                ]

        SubmitAndExitSeen s ->
            Encode.object
                [ ( "tag", Encode.string "submit_and_exit_seen" )
                , ( "submitId", Encode.string (submitRefToString s) )
                ]

        TaskCompletionCommitted c ->
            Encode.object
                [ ( "tag", Encode.string "task_completion_committed" )
                , ( "completionId", Encode.string (completionRefToString c) )
                ]

        CompletionPresented c ->
            Encode.object
                [ ( "tag", Encode.string "completion_presented" )
                , ( "completionId", Encode.string (completionRefToString c) )
                ]

        TaskCancelled ->
            Encode.object [ ( "tag", Encode.string "task_cancelled" ) ]

        ExecuteTurnPreludeEnter r ->
            Encode.object
                [ ( "tag", Encode.string "execute_turn_prelude_enter" )
                , ( "runId", Encode.string (runRefToString r) )
                ]


-- ---------------------------------------------------------------------------
-- Outbound: Model + hold reason + violation
-- ---------------------------------------------------------------------------


encodeModel : Model -> Value
encodeModel model =
    Encode.object
        [ ( "task", Encode.string (Authority.taskStateName model.task) )
        , ( "activeRun"
          , case model.activeRun of
                Just r ->
                    Encode.string (runRefToString r)

                Nothing ->
                    Encode.null
          )
        , ( "submitCount", Encode.int model.submitCount )
        , ( "committedCompletion"
          , case model.committedCompletion of
                Just c ->
                    Encode.string (completionRefToString c)

                Nothing ->
                    Encode.null
          )
        , ( "presentedCompletion"
          , case model.presentedCompletion of
                Just c ->
                    Encode.string (completionRefToString c)

                Nothing ->
                    Encode.null
          )
        ]


encodeHoldReason : HoldReason -> Value
encodeHoldReason r =
    Encode.string (Authority.holdReasonName r)


encodeViolation : Value -> Value
encodeViolation name =
    Encode.object
        [ ( "kind", Encode.string "violation" )
        , ( "name", name )
        ]


-- ---------------------------------------------------------------------------
-- Origin / kind tag mapping (closed, FROZEN)
-- ---------------------------------------------------------------------------


originToTag : RunOrigin -> String
originToTag o =
    case o of
        OriginExplicitUser ->
            "explicit_user"

        OriginPendingPromptDrain ->
            "pending_prompt_drain"

        OriginDeferredContinuation ->
            "deferred_continuation"

        OriginModeContinuation ->
            "mode_continuation"

        OriginSessionResume ->
            "session_resume"

        OriginUnknown _ ->
            "unknown"


tagToOrigin : String
    -> RunOrigin
tagToOrigin s =
    case s of
        "explicit_user" ->
            OriginExplicitUser

        "pending_prompt_drain" ->
            OriginPendingPromptDrain

        "deferred_continuation" ->
            OriginDeferredContinuation

        "mode_continuation" ->
            OriginModeContinuation

        "session_resume" ->
            OriginSessionResume

        _ ->
            OriginUnknown s


promptOriginToTag : PromptOrigin -> String
promptOriginToTag o =
    case o of
        PromptExplicitUser ->
            "explicit_user"

        PromptPendingPromptDrain ->
            "pending_prompt_drain"

        PromptDeferredContinuation ->
            "deferred_continuation"

        PromptModeContinuation ->
            "mode_continuation"

        PromptUnknown _ ->
            "unknown"


tagToPromptOrigin : String
    -> PromptOrigin
tagToPromptOrigin s =
    case s of
        "explicit_user" ->
            PromptExplicitUser

        "pending_prompt_drain" ->
            PromptPendingPromptDrain

        "deferred_continuation" ->
            PromptDeferredContinuation

        "mode_continuation" ->
            PromptModeContinuation

        _ ->
            PromptUnknown s


kindTag : TerminalKind -> String
kindTag k =
    case k of
        TerminalOwned ->
            "owned"

        TerminalBackgroundNotOwned ->
            "background_not_owned"


kindFromTag : String
    -> Maybe TerminalKind
kindFromTag s =
    case s of
        "owned" ->
            Just TerminalOwned

        "background_not_owned" ->
            Just TerminalBackgroundNotOwned

        _ ->
            Nothing
