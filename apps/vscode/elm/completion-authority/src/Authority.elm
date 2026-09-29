module Authority exposing
    ( update
    , updateWithViolations
    , computeHoldReasons
    , completionAuthorized
    , presentationAuthorized
    , unconsumedOwnedTerminalCount
    , hasRunningBackgroundJobForOwner
    , pendingPromptCount
    , scheduledContinuationCount
    , jobRunningCount
    , taskStateName
    , runStateName
    , lifecycleName
    , promptStateName
    , holdReasonName
    , effectName
    , violationName
    )


{-| Pure transition function for the completion / continuation authority.

CORRECTION02 changelog (HALT_ELM_KERNEL_AUTHORITY_MODEL_INCORRECT):
  * P0-1: completion authority is satisfied BEFORE commit;
    presentation authority is satisfied AFTER commit. The model
    no longer treats `committedCompletion == Nothing` as a hold.
  * P0-2: `JobLifecycle` makes a consumed terminal no longer count
    as a running background job.
  * P0-3: `AgentTurnDone` that closes a run transitions the
    matching `PromptRunning` to `PromptConsumed`.
  * P0-4: `TaskCompletionCommitted` is rejected with
    `TaskCompletionCommittedWhileHeld` while any hold applies.
-}
import Domain exposing (..)


update : Msg -> Model -> ( Model, List Effect )
update msg model =
    let
        ( newModel, _, _ ) =
            updateWithViolations msg model
    in
    ( newModel, deriveEffects newModel )


deriveEffects : Model -> List Effect
deriveEffects model =
    let
        reasons =
            computeHoldReasons model

        taskCompletionAuthorized =
            List.isEmpty reasons
    in
    if not taskCompletionAuthorized then
        [ HoldCompletion (List.head reasons |> Maybe.withDefault ActiveRun) ]

    else
        [ if model.committedCompletion == Nothing then
            AuthorizeTaskCompletion

          else
            NoEffect
        , if model.committedCompletion /= Nothing && model.presentedCompletion == Nothing then
            AuthorizeCompletionPresentation

          else
            NoEffect
        ]
            |> List.filter (\e -> e /= NoEffect)


updateWithViolations : Msg -> Model -> ( Model, List Effect, Maybe Violation )
updateWithViolations msg model =
    let
        ( newModel, _, maybeViolation ) =
            handleMsg msg model

        effects =
            deriveEffects newModel
    in
    ( newModel, effects, maybeViolation )


handleMsg : Msg -> Model -> ( Model, List Effect, Maybe Violation )
handleMsg msg model =
    -- CORRECTION02: I11 / ELM-AUTH-17. Once the task has reached
    -- `Completed`, any subsequent event is an
    -- `EventAfterCompletion` violation. The model is left unchanged.
    if model.task == Completed then
        case msg of
            TaskCancelled ->
                ( setTaskState Cancelled model, [], Nothing )

            _ ->
                ( model, [], Just (EventAfterCompletion msg) )

    else
        case msg of
            TaskStarted _ ->
                ( { model | task = Active }, [], Nothing )

            RunStarted newRef origin ->
                handleRunStarted newRef origin model

            AgentTurnDone closingRef ->
                handleAgentTurnDone closingRef model

            TerminalRegistered jobRef owner kind ->
                handleTerminalRegistered jobRef owner kind model

            TerminalObserved jobRef ->
                handleTerminalObserved jobRef model

            PendingPromptEnqueued promptRef _ ->
                handlePendingPromptEnqueued promptRef model

            PendingPromptDequeued promptRef ->
                handlePendingPromptDequeued promptRef model

            ContinuationScheduled promptRef ->
                handleContinuationScheduled promptRef model

            ContinuationStarted promptRef runRef ->
                handleContinuationStarted promptRef runRef model

            SubmitAndExitSeen _ ->
                ( { model | submitCount = model.submitCount + 1 }, [], Nothing )

            TaskCompletionCommitted completionRef ->
                handleTaskCompletionCommitted completionRef model

            CompletionPresented completionRef ->
                handleCompletionPresented completionRef model

            TaskCancelled ->
                ( setTaskState Cancelled model, [], Nothing )

            ExecuteTurnPreludeEnter runRef ->
                ( { model
                    | activeRun = Just runRef
                    , runs = upsertRunState runRef RunActive model.runs
                  }
                , []
                , Nothing
                )


handleRunStarted : RunRef -> RunOrigin -> Model -> ( Model, List Effect, Maybe Violation )
handleRunStarted newRef _ model =
    case model.activeRun of
        Just active ->
            ( { model
                | activeRun = Just newRef
                , runs = ( newRef, RunActive ) :: upsertRunState active RunDone model.runs
              }
            , []
            , Just (RunStartedWhileRunActive active newRef)
            )

        Nothing ->
            ( { model
                | activeRun = Just newRef
                , runs = ( newRef, RunActive ) :: model.runs
              }
            , []
            , Nothing
            )


{-| CORRECTION02 (P0-3): when an AgentTurnDone matches the active run,
the kernel now ALSO transitions the matching `PromptRunning runRef`
to `PromptConsumed`.
-}
handleAgentTurnDone : RunRef -> Model -> ( Model, List Effect, Maybe Violation )
handleAgentTurnDone closingRef model =
    case model.activeRun of
        Just active ->
            if active == closingRef then
                ( { model
                    | activeRun = Nothing
                    , runs = upsertRunState closingRef RunDone model.runs
                    , prompts = consumePromptForRun closingRef model.prompts
                  }
                , []
                , Nothing
                )

            else
                ( { model
                    | runs = upsertRunState closingRef RunDone model.runs
                  }
                , []
                , Just (RunClosedByOtherRef active closingRef)
                )

        Nothing ->
            ( { model
                | runs = upsertRunState closingRef RunDone model.runs
              }
            , []
            , Just (IdentityMismatch (runRefToString closingRef))
            )


{-| CORRECTION02 (P0-2): the registered job starts in `JobRunning`.
A terminal observation moves it to `JobTerminal ObservationConsumed`,
which is no longer counted as `RunningBackgroundJob`.
-}
handleTerminalRegistered : JobRef -> OwnerRef -> TerminalKind -> Model -> ( Model, List Effect, Maybe Violation )
handleTerminalRegistered jobRef owner kind model =
    let
        newJobs =
            upsertJob jobRef
                { owner = owner
                , kind = kind
                , lifecycle = JobRunning
                }
                model.jobs
    in
    ( { model | jobs = newJobs }, [], Nothing )


handleTerminalObserved : JobRef -> Model -> ( Model, List Effect, Maybe Violation )
handleTerminalObserved jobRef model =
    case findJob jobRef model.jobs of
        Just jobState ->
            case jobState.lifecycle of
                JobRunning ->
                    let
                        newJobs =
                            upsertJob jobRef
                                { owner = jobState.owner
                                , kind = jobState.kind
                                , lifecycle = JobTerminal ObservationConsumed
                                }
                                model.jobs
                    in
                    ( { model | jobs = newJobs }, [], Nothing )

                JobTerminal ObservationConsumed ->
                    ( model
                    , []
                    , Just (DuplicateObservation jobRef)
                    )

                JobTerminal ObservationPending ->
                    let
                        newJobs =
                            upsertJob jobRef
                                { owner = jobState.owner
                                , kind = jobState.kind
                                , lifecycle = JobTerminal ObservationConsumed
                                }
                                model.jobs
                    in
                    ( { model | jobs = newJobs }, [], Nothing )

        Nothing ->
            ( model, [], Just (IdentityMismatch (jobRefToString jobRef)) )


handlePendingPromptEnqueued : PromptRef -> Model -> ( Model, List Effect, Maybe Violation )
handlePendingPromptEnqueued promptRef model =
    let
        newPrompts =
            upsertPrompt promptRef PromptQueued model.prompts
    in
    ( { model | prompts = newPrompts }, [], Nothing )


handlePendingPromptDequeued : PromptRef -> Model -> ( Model, List Effect, Maybe Violation )
handlePendingPromptDequeued promptRef model =
    case findPrompt promptRef model.prompts of
        Just PromptQueued ->
            let
                newPrompts =
                    upsertPrompt promptRef PromptDequeued model.prompts
            in
            ( { model | prompts = newPrompts }, [], Nothing )

        Just _ ->
            let
                newPrompts =
                    upsertPrompt promptRef PromptDequeued model.prompts
            in
            ( { model | prompts = newPrompts }
            , []
            , Just (PromptScheduledWithoutDequeue promptRef)
            )

        Nothing ->
            let
                newPrompts =
                    upsertPrompt promptRef PromptDequeued model.prompts
            in
            ( { model | prompts = newPrompts }
            , []
            , Just (PromptScheduledWithoutDequeue promptRef)
            )


handleContinuationScheduled : PromptRef -> Model -> ( Model, List Effect, Maybe Violation )
handleContinuationScheduled promptRef model =
    case findPrompt promptRef model.prompts of
        Just PromptDequeued ->
            let
                newPrompts =
                    upsertPrompt promptRef PromptScheduled model.prompts
            in
            ( { model | prompts = newPrompts }, [], Nothing )

        Just _ ->
            let
                newPrompts =
                    upsertPrompt promptRef PromptScheduled model.prompts
            in
            ( { model | prompts = newPrompts }
            , []
            , Just (PromptScheduledWithoutDequeue promptRef)
            )

        Nothing ->
            let
                newPrompts =
                    upsertPrompt promptRef PromptScheduled model.prompts
            in
            ( { model | prompts = newPrompts }
            , []
            , Just (PromptScheduledWithoutDequeue promptRef)
            )


handleContinuationStarted : PromptRef -> RunRef -> Model -> ( Model, List Effect, Maybe Violation )
handleContinuationStarted promptRef runRef model =
    let
        newPrompts =
            upsertPrompt promptRef (PromptRunning runRef) model.prompts
    in
    case findPrompt promptRef model.prompts of
        Just PromptScheduled ->
            ( { model
                | prompts = newPrompts
                , activeRun = Just runRef
                , runs = upsertRunState runRef RunActive model.runs
              }
            , []
            , Nothing
            )

        Just _ ->
            ( { model
                | prompts = newPrompts
                , activeRun = Just runRef
                , runs = upsertRunState runRef RunActive model.runs
              }
            , []
            , Just (ContinuationStartedWithoutSchedule promptRef runRef)
            )

        Nothing ->
            ( { model
                | prompts = newPrompts
                , activeRun = Just runRef
                , runs = upsertRunState runRef RunActive model.runs
              }
            , []
            , Just (ContinuationStartedWithoutSchedule promptRef runRef)
            )


{-| CORRECTION02 (P0-4): commit is rejected while any hold applies.
The model is left unchanged.
-}
handleTaskCompletionCommitted : CompletionRef -> Model -> ( Model, List Effect, Maybe Violation )
handleTaskCompletionCommitted completionRef model =
    case model.committedCompletion of
        Just existing ->
            ( model
            , []
            , Just (DuplicateCompletionRef existing completionRef)
            )

        Nothing ->
            case computeHoldReasons model of
                firstReason :: _ ->
                    ( model
                    , []
                    , Just (TaskCompletionCommittedWhileHeld firstReason)
                    )

                [] ->
                    ( { model
                        | task = CompletionCommitted
                        , committedCompletion = Just completionRef
                      }
                    , []
                    , Nothing
                    )


handleCompletionPresented : CompletionRef -> Model -> ( Model, List Effect, Maybe Violation )
handleCompletionPresented completionRef model =
    case model.committedCompletion of
        Just committed ->
            if committed == completionRef then
                ( { model
                    | task = Completed
                    , presentedCompletion = Just completionRef
                  }
                , []
                , Nothing
                )

            else
                ( model
                , []
                , Just (PresentationBeforeCommit completionRef)
                )

        Nothing ->
            ( model
            , []
            , Just (PresentationBeforeCommit completionRef)
            )


{-| Compute the *set* of hold reasons currently applicable.

CORRECTION02 (P0-1): `CompletionNotCommitted` is no longer a hold
reason. The kernel's task-completion authority is satisfied BEFORE
a commit.

CORRECTION02 (P0-2): `RunningBackgroundJob` now only counts
`JobRunning`. `UnconsumedTerminalObservation` matches jobs that are
still `JobRunning` or `JobTerminal ObservationPending`.
-}
computeHoldReasons : Model -> List HoldReason
computeHoldReasons model =
    let
        isPendingOrScheduledPrompt (_, state) =
            case state of
                PromptQueued ->
                    True

                PromptDequeued ->
                    True

                PromptScheduled ->
                    True

                PromptRunning _ ->
                    True

                PromptConsumed ->
                    False

        isScheduledOrRunning (_, state) =
            case state of
                PromptScheduled ->
                    True

                PromptRunning _ ->
                    True

                _ ->
                    False

        isUnconsumedOwnedTerminal (_, job) =
            job.kind == TerminalOwned
                && (job.lifecycle == JobRunning
                    || job.lifecycle == JobTerminal ObservationPending
                   )

        isRunningBackgroundJob (_, job) =
            job.lifecycle == JobRunning

        pendingOrScheduled =
            List.filter isPendingOrScheduledPrompt model.prompts

        scheduledOrRunning =
            List.filter isScheduledOrRunning model.prompts

        unconsumedTerminals =
            List.filter isUnconsumedOwnedTerminal model.jobs

        runningBackgroundJobs =
            List.filter isRunningBackgroundJob model.jobs

        activeRunHeld =
            model.activeRun /= Nothing

        pendingPromptHeld =
            not (List.isEmpty pendingOrScheduled)

        scheduledContinuationHeld =
            not (List.isEmpty scheduledOrRunning)

        unconsumedTerminalHeld =
            not (List.isEmpty unconsumedTerminals)

        runningBackgroundJobHeld =
            not (List.isEmpty runningBackgroundJobs)
    in
    [ if activeRunHeld then
        Just ActiveRun

      else
        Nothing
    , if pendingPromptHeld then
        Just PendingPrompt

      else
        Nothing
    , if scheduledContinuationHeld then
        Just ScheduledContinuation

      else
        Nothing
    , if unconsumedTerminalHeld then
        Just UnconsumedTerminalObservation

      else
        Nothing
    , if runningBackgroundJobHeld then
        Just RunningBackgroundJob

      else
        Nothing
    ]
        |> List.filterMap identity


{-| CORRECTION02 (P0-1): task-completion authority is satisfied iff
there are NO hold reasons. The presence or absence of a commit does
NOT factor into task-completion authority.
-}
completionAuthorized : Model -> Bool
completionAuthorized model =
    List.isEmpty (computeHoldReasons model)


{-| CORRECTION02 (P0-1): presentation is authorized iff
task-completion is authorized AND a completion has been committed
AND it has not yet been presented.
-}
presentationAuthorized : Model -> Bool
presentationAuthorized model =
    completionAuthorized model
        && model.committedCompletion /= Nothing
        && model.presentedCompletion == Nothing


unconsumedOwnedTerminalCount : Model -> Int
unconsumedOwnedTerminalCount model =
    List.length
        (List.filter
            (\( _, job ) ->
                job.kind == TerminalOwned
                    && (job.lifecycle == JobRunning
                        || job.lifecycle == JobTerminal ObservationPending
                       )
            )
            model.jobs
        )


hasRunningBackgroundJobForOwner : Model -> OwnerRef -> Bool
hasRunningBackgroundJobForOwner model owner =
    List.any
        (\( _, job ) ->
            job.owner == owner
                && job.kind == TerminalOwned
                && job.lifecycle == JobRunning
        )
        model.jobs


pendingPromptCount : Model -> Int
pendingPromptCount model =
    List.length
        (List.filter
            (\( _, state ) ->
                case state of
                    PromptQueued ->
                        True

                    PromptDequeued ->
                        True

                    PromptScheduled ->
                        True

                    PromptRunning _ ->
                        True

                    PromptConsumed ->
                        False
            )
            model.prompts
        )


scheduledContinuationCount : Model -> Int
scheduledContinuationCount model =
    List.length
        (List.filter
            (\( _, state ) ->
                case state of
                    PromptScheduled ->
                        True

                    PromptRunning _ ->
                        True

                    _ ->
                        False
            )
            model.prompts
        )


jobRunningCount : Model -> Int
jobRunningCount model =
    Domain.jobRunningCount model


{-| CORRECTION02 (P0-3): transition the prompt that was running this
run to `PromptConsumed`.
-}
consumePromptForRun : RunRef -> List ( PromptRef, PromptState ) -> List ( PromptRef, PromptState )
consumePromptForRun closingRef promptList =
    List.map
        (\p ->
            let
                ( ref, state ) =
                    p
            in
            case state of
                PromptRunning r ->
                    if r == closingRef then
                        ( ref, PromptConsumed )

                    else
                        p

                _ ->
                    p
        )
        promptList


upsertRunState : RunRef -> RunState -> List ( RunRef, RunState ) -> List ( RunRef, RunState )
upsertRunState ref state runs =
    if List.any (\( r, _ ) -> r == ref) runs then
        List.map
            (\( r, s ) ->
                if r == ref then
                    ( r, state )

                else
                    ( r, s )
            )
            runs

    else
        ( ref, state ) :: runs


upsertJob : JobRef -> JobState -> List ( JobRef, JobState ) -> List ( JobRef, JobState )
upsertJob ref state jobs =
    if List.any (\( r, _ ) -> r == ref) jobs then
        List.map
            (\( r, s ) ->
                if r == ref then
                    ( r, state )

                else
                    ( r, s )
            )
            jobs

    else
        ( ref, state ) :: jobs


upsertPrompt : PromptRef -> PromptState -> List ( PromptRef, PromptState ) -> List ( PromptRef, PromptState )
upsertPrompt ref state promptList =
    if List.any (\( r, _ ) -> r == ref) promptList then
        List.map
            (\( r, s ) ->
                if r == ref then
                    ( r, state )

                else
                    ( r, s )
            )
            promptList

    else
        ( ref, state ) :: promptList


findJob : JobRef -> List ( JobRef, JobState ) -> Maybe JobState
findJob ref jobs =
    jobs
        |> List.filter (\( r, _ ) -> r == ref)
        |> List.map (\( _, s ) -> s)
        |> List.head


findPrompt : PromptRef -> List ( PromptRef, PromptState ) -> Maybe PromptState
findPrompt ref promptList =
    promptList
        |> List.filter (\( r, _ ) -> r == ref)
        |> List.map (\( _, s ) -> s)
        |> List.head


setTaskState : TaskState -> Model -> Model
setTaskState task model =
    { model | task = task }


taskStateName : TaskState -> String
taskStateName state =
    case state of
        Idle ->
            "idle"

        Active ->
            "active"

        AwaitingAuthority ->
            "awaiting_authority"

        CompletionCommitted ->
            "completion_committed"

        Completed ->
            "completed"

        Cancelled ->
            "cancelled"


runStateName : RunState -> String
runStateName state =
    case state of
        RunActive ->
            "active"

        RunDone ->
            "done"


lifecycleName : JobLifecycle -> String
lifecycleName lifecycle =
    case lifecycle of
        JobRunning ->
            "running"

        JobTerminal ObservationPending ->
            "terminal_pending"

        JobTerminal ObservationConsumed ->
            "terminal_consumed"


promptStateName : PromptState -> String
promptStateName state =
    case state of
        PromptQueued ->
            "queued"

        PromptDequeued ->
            "dequeued"

        PromptScheduled ->
            "scheduled"

        PromptRunning _ ->
            "running"

        PromptConsumed ->
            "consumed"


holdReasonName : HoldReason -> String
holdReasonName reason =
    case reason of
        ActiveRun ->
            "active_run"

        RunningBackgroundJob ->
            "running_background_job"

        UnconsumedTerminalObservation ->
            "unconsumed_terminal_observation"

        PendingPrompt ->
            "pending_prompt"

        ScheduledContinuation ->
            "scheduled_continuation"


effectName : Effect -> String
effectName effect =
    case effect of
        HoldCompletion reason ->
            "hold_completion:" ++ holdReasonName reason

        AuthorizeContinuation promptRef ->
            "authorize_continuation:" ++ promptRefToString promptRef

        AuthorizeTaskCompletion ->
            "authorize_task_completion"

        AuthorizeCompletionPresentation ->
            "authorize_completion_presentation"

        NoEffect ->
            "no_effect"


violationName : Violation -> String
violationName v =
    case v of
        RunStartedWhileRunActive a b ->
            "RunStartedWhileRunActive "
                ++ runRefToString a
                ++ " -> "
                ++ runRefToString b

        RunClosedByOtherRef a b ->
            "RunClosedByOtherRef "
                ++ runRefToString a
                ++ " closed by "
                ++ runRefToString b

        PromptScheduledWithoutDequeue p ->
            "PromptScheduledWithoutDequeue " ++ promptRefToString p

        ContinuationStartedWithoutSchedule p r ->
            "ContinuationStartedWithoutSchedule "
                ++ promptRefToString p
                ++ " run="
                ++ runRefToString r

        DuplicateCompletionRef a b ->
            "DuplicateCompletionRef "
                ++ completionRefToString a
                ++ " vs "
                ++ completionRefToString b

        PresentationBeforeCommit c ->
            "PresentationBeforeCommit " ++ completionRefToString c

        ScheduledContinuationWhileCommitted ->
            "ScheduledContinuationWhileCommitted"

        EventAfterCompletion _ ->
            "EventAfterCompletion"

        UnknownStage tag ->
            "UnknownStage " ++ tag

        DuplicateObservation j ->
            "DuplicateObservation " ++ jobRefToString j

        IdentityMismatch s ->
            "IdentityMismatch " ++ s

        TaskCompletionCommittedWhileHeld reason ->
            "TaskCompletionCommittedWhileHeld " ++ holdReasonName reason

        PromptRunningUnconsumedAtRunClose p r ->
            "PromptRunningUnconsumedAtRunClose "
                ++ promptRefToString p
                ++ " run="
                ++ runRefToString r
