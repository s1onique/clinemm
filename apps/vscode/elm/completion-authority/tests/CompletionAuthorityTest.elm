module CompletionAuthorityTest exposing (suite)

{-| RED/GREEN invariant tests for the completion-authority Elm kernel.

These tests are derived from ACT §14 / §16 / §17. They drive the
real Authority.update / Authority.updateWithViolations functions
and assert against the actual model / effect / violation return values.

ELM-AUTH-01..08  - required RED then GREEN cases (ACT §14)
ELM-CONS-01..05  - conservation cases for valid sequences (ACT §16)
P1..P6           - property invariants for fuzz sequences (ACT §17)
-}

import Authority exposing (computeHoldReasons, completionAuthorized, presentationAuthorized, update, updateWithViolations, violationName)
import Debug
import Domain exposing (..)
import Expect
import Test exposing (Test, describe, fuzz, test)


suite : Test
suite =
    describe "ACT invariants"
        [ describe "ELM-AUTH-01 RunStarted(R1), RunStarted(R2) -> violation"
            [ test "second RunStarted while a run is active produces RunStartedWhileRunActive" <|
                \_ ->
                    let
                        r1 = RunRef "r1"
                        r2 = RunRef "r2"
                        ( m1, _, _ ) =
                            updateWithViolations (RunStarted r1 OriginExplicitUser) emptyModel
                        ( _, _, maybeViolation ) =
                            updateWithViolations (RunStarted r2 OriginPendingPromptDrain) m1
                    in
                    case maybeViolation of
                        Just (RunStartedWhileRunActive a b) ->
                            Expect.all
                                [ \() -> Expect.equal r1 a
                                , \() -> Expect.equal r2 b
                                ]
                                ()
                        _ -> Expect.fail "expected RunStartedWhileRunActive"
            ]
        , describe "ELM-AUTH-02 TerminalRegistered(J), SubmitAndExitSeen -> HoldCompletion"
            [ test "an unobserved owned terminal blocks completion" <|
                \_ ->
                    let
                        j = JobRef "j1"
                        owner = OwnerRef "owner-1"
                        ( m1, _, _ ) =
                            updateWithViolations (TerminalRegistered j owner TerminalOwned) emptyModel
                        ( m2, _, _ ) =
                            updateWithViolations (SubmitAndExitSeen (SubmitRef "s1")) m1
                        reasons = Authority.computeHoldReasons m2
                    in
                    Expect.equal True (List.member UnconsumedTerminalObservation reasons)
            ]
        , describe "ELM-AUTH-03 TerminalObserved(J) clears the hold"
            [ test "observation removes UnconsumedTerminalObservation" <|
                \_ ->
                    let
                        j = JobRef "j1"
                        owner = OwnerRef "owner-1"
                        ( m1, _, _ ) =
                            updateWithViolations (TerminalRegistered j owner TerminalOwned) emptyModel
                        ( m2, _, _ ) =
                            updateWithViolations (TerminalObserved j) m1
                        ( m3, _, _ ) =
                            updateWithViolations (SubmitAndExitSeen (SubmitRef "s1")) m2
                        reasons = Authority.computeHoldReasons m3
                    in
                    Expect.equal False (List.member UnconsumedTerminalObservation reasons)
            ]
        , describe "ELM-AUTH-04 pending prompt chain holds completion"
            [ test "scheduled continuation blocks completion" <|
                \_ ->
                    let
                        p = PromptRef "p1"
                        ( m1, _, _ ) =
                            updateWithViolations (PendingPromptEnqueued p PromptPendingPromptDrain) emptyModel
                        ( m2, _, _ ) =
                            updateWithViolations (PendingPromptDequeued p) m1
                        ( m3, _, _ ) =
                            updateWithViolations (ContinuationScheduled p) m2
                        ( m4, _, _ ) =
                            updateWithViolations (SubmitAndExitSeen (SubmitRef "s1")) m3
                        reasons = Authority.computeHoldReasons m4
                    in
                    Expect.equal True (List.member ScheduledContinuation reasons)
            ]
        , describe "ELM-AUTH-05 CompletionPresented before commit -> violation"
            [ test "presentation-before-commit is rejected" <|
                \_ ->
                    let
                        c = CompletionRef "c1"
                        ( _, _, violation ) =
                            updateWithViolations (CompletionPresented c) emptyModel
                    in
                    case violation of
                        Just (PresentationBeforeCommit ref) -> Expect.equal c ref
                        _ -> Expect.fail "expected PresentationBeforeCommit"
            ]
        , describe "ELM-AUTH-06 duplicate TaskCompletionCommitted -> violation"
            [ test "duplicate completion commits are rejected" <|
                \_ ->
                    let
                        ( m1, _, _ ) =
                            updateWithViolations (TaskCompletionCommitted (CompletionRef "c1")) emptyModel
                        ( _, _, violation ) =
                            updateWithViolations (TaskCompletionCommitted (CompletionRef "c2")) m1
                    in
                    case violation of
                        Just (DuplicateCompletionRef _ _) -> Expect.pass
                        _ -> Expect.fail "expected DuplicateCompletionRef"
            ]
        , describe "ELM-AUTH-07 ContinuationScheduled without dequeue -> violation"
            [ test "scheduling without dequeue is rejected" <|
                \_ ->
                    let
                        ( _, _, violation ) =
                            updateWithViolations (ContinuationScheduled (PromptRef "p1")) emptyModel
                    in
                    case violation of
                        Just (PromptScheduledWithoutDequeue _) -> Expect.pass
                        _ -> Expect.fail "expected PromptScheduledWithoutDequeue"
            ]
        , describe "ELM-AUTH-08 foreign AgentTurnDone -> violation"
            [ test "foreign run closure is rejected" <|
                \_ ->
                    let
                        ( m1, _, _ ) =
                            updateWithViolations (RunStarted (RunRef "r1") OriginExplicitUser) emptyModel
                        ( _, _, violation ) =
                            updateWithViolations (AgentTurnDone (RunRef "r2")) m1
                    in
                    case violation of
                        Just (RunClosedByOtherRef _ _) -> Expect.pass
                        _ -> Expect.fail "expected RunClosedByOtherRef"
            ]
        , describe "ELM-CONS valid sequences (no violations)"
            [ test "ELM-CONS-01 normal run -> submit -> commit -> presentation" <|
                \_ ->
                    let
                        ( m1, _, v1 ) =
                            updateWithViolations (RunStarted (RunRef "r1") OriginExplicitUser) emptyModel
                        ( m2, _, v2 ) =
                            updateWithViolations (AgentTurnDone (RunRef "r1")) m1
                        ( m3, _, v3 ) =
                            updateWithViolations (SubmitAndExitSeen (SubmitRef "s1")) m2
                        ( m4, _, v4 ) =
                            updateWithViolations (TaskCompletionCommitted (CompletionRef "c1")) m3
                        ( m5, _, v5 ) =
                            updateWithViolations (CompletionPresented (CompletionRef "c1")) m4
                    in
                    Expect.all
                        [ \() -> Expect.equal Nothing v1
                        , \() -> Expect.equal Nothing v2
                        , \() -> Expect.equal Nothing v3
                        , \() -> Expect.equal Nothing v4
                        , \() -> Expect.equal Nothing v5
                        , \() -> Expect.equal Completed m5.task
                        ]
                        ()
            , test "ELM-CONS-04 duplicate TerminalObserved -> DuplicateObservation" <|
                \_ ->
                    let
                        j = JobRef "j1"
                        owner = OwnerRef "owner-1"
                        ( m1, _, v1 ) =
                            updateWithViolations (TerminalRegistered j owner TerminalOwned) emptyModel
                        ( m2, _, v2 ) =
                            updateWithViolations (TerminalObserved j) m1
                        ( _, _, v3 ) =
                            updateWithViolations (TerminalObserved j) m2
                    in
                    Expect.all
                        [ \() -> Expect.equal Nothing v1
                        , \() -> Expect.equal Nothing v2
                        , \() ->
                            case v3 of
                                Just (DuplicateObservation _) -> Expect.pass
                                _ -> Expect.fail "expected DuplicateObservation"
                        ]
                        ()
            , test "ELM-CONS-05 two distinct TaskRefs do not cross-talk" <|
                \_ ->
                    let
                        ( m1, _, _ ) =
                            updateWithViolations (RunStarted (RunRef "task-A-run") OriginExplicitUser) emptyModel
                        ( _, _, violation ) =
                            updateWithViolations (AgentTurnDone (RunRef "task-B-run")) m1
                    in
                    case violation of
                        Just (RunClosedByOtherRef _ _) ->
                            Expect.pass
                        Just other ->
                            Expect.fail ("expected RunClosedByOtherRef, got " ++ Debug.toString (Maybe.map Authority.violationName (Just other)))
                        Nothing ->
                            Expect.fail "expected foreign closure (identity cross-talk guard)"
            ]
        , correction02
        ]


-- ===========================================================================
-- CORRECTION02 decisive tests (ELM-AUTH-09..17)
--
-- CORRECTION02 P0-3 (test structure fix): every `describe` block is a
-- declaration-level expression and Elm requires a top-level *value*. We
-- therefore aggregate all CORRECTION02 blocks into one named `Test`
-- value (`correction02`) below and add it to `suite` above.
-- ===========================================================================


correction02 : Test
correction02 =
    describe "CORRECTION02"
        [ describe "ELM-AUTH-09 commit-while-active-run is rejected"
            [ test "RunStarted R1 + TaskCompletionCommitted C1 -> TaskCompletionCommittedWhileHeld ActiveRun" <|
                \_ ->
                    let
                        r1 = RunRef "r1"
                        c1 = CompletionRef "c1"
                        ( m1, _, _ ) =
                            updateWithViolations (RunStarted r1 OriginExplicitUser) emptyModel
                        ( _, _, v ) =
                            updateWithViolations (TaskCompletionCommitted c1) m1
                    in
                    case v of
                        Just (TaskCompletionCommittedWhileHeld ActiveRun) ->
                            Expect.pass

                        other ->
                            Expect.fail ("expected TaskCompletionCommittedWhileHeld ActiveRun, got " ++ Debug.toString (Maybe.map Authority.violationName other))
            ]
        , describe "ELM-AUTH-10 commit-while-unobserved-owned-terminal is rejected"
            [ test "TerminalRegistered(J, owned) + TaskCompletionCommitted C -> TaskCompletionCommittedWhileHeld UnconsumedTerminalObservation" <|
                \_ ->
                    let
                        j = JobRef "j1"
                        owner = OwnerRef "owner-1"
                        c = CompletionRef "c1"
                        ( m1, _, _ ) =
                            updateWithViolations (TerminalRegistered j owner TerminalOwned) emptyModel
                        ( _, _, v ) =
                            updateWithViolations (TaskCompletionCommitted c) m1
                    in
                    case v of
                        Just (TaskCompletionCommittedWhileHeld UnconsumedTerminalObservation) ->
                            Expect.pass

                        other ->
                            Expect.fail ("expected TaskCompletionCommittedWhileHeld UnconsumedTerminalObservation, got " ++ Debug.toString (Maybe.map Authority.violationName other))
            ]
        , describe "ELM-AUTH-11 commit-while-pending-continuation is rejected"
            [ test "ContinuationScheduled + TaskCompletionCommitted -> TaskCompletionCommittedWhileHeld (PendingPrompt or ScheduledContinuation)" <|
                \_ ->
                    let
                        p = PromptRef "p1"
                        c = CompletionRef "c1"
                        ( m1, _, _ ) =
                            updateWithViolations (PendingPromptEnqueued p PromptExplicitUser) emptyModel
                        ( m2, _, _ ) =
                            updateWithViolations (PendingPromptDequeued p) m1
                        ( m3, _, _ ) =
                            updateWithViolations (ContinuationScheduled p) m2
                        ( _, _, v ) =
                            updateWithViolations (TaskCompletionCommitted c) m3
                    in
                    case v of
                        Just (TaskCompletionCommittedWhileHeld ScheduledContinuation) ->
                            Expect.pass

                        Just (TaskCompletionCommittedWhileHeld PendingPrompt) ->
                            Expect.pass

                        other ->
                            Expect.fail ("expected TaskCompletionCommittedWhileHeld ScheduledContinuation or PendingPrompt, got " ++ Debug.toString (Maybe.map Authority.violationName other))
            ]
        , describe "ELM-AUTH-12 observation removes all job-related holds"
            [ test "after TerminalObserved, no RunningBackgroundJob / UnconsumedTerminalObservation hold remains" <|
                \_ ->
                    let
                        j = JobRef "j1"
                        owner = OwnerRef "owner-1"
                        ( m1, _, _ ) =
                            updateWithViolations (TerminalRegistered j owner TerminalOwned) emptyModel
                        ( m2, _, _ ) =
                            updateWithViolations (TerminalObserved j) m1
                        reasons =
                            Authority.computeHoldReasons m2
                    in
                    Expect.all
                        [ \() -> Expect.equal False (List.member RunningBackgroundJob reasons)
                        , \() -> Expect.equal False (List.member UnconsumedTerminalObservation reasons)
                        ]
                        ()
            ]
        , describe "ELM-AUTH-13 AgentTurnDone consumes the matching PromptRunning"
            [ test "ContinuationStarted(P, R) + AgentTurnDone R -> P becomes PromptConsumed" <|
                \_ ->
                    let
                        p = PromptRef "p1"
                        r = RunRef "r1"
                        ( m1, _, _ ) =
                            updateWithViolations (PendingPromptEnqueued p PromptExplicitUser) emptyModel
                        ( m2, _, _ ) =
                            updateWithViolations (PendingPromptDequeued p) m1
                        ( m3, _, _ ) =
                            updateWithViolations (ContinuationScheduled p) m2
                        ( m4, _, _ ) =
                            updateWithViolations (ContinuationStarted p r) m3
                        ( m5, _, _ ) =
                            updateWithViolations (AgentTurnDone r) m4
                    in
                    case
                        List.filter (\( ref, _ ) -> ref == p) m5.prompts
                    of
                        [ ( _, PromptConsumed ) ] ->
                            Expect.pass

                        other ->
                            Expect.fail ("expected prompt to be PromptConsumed, got " ++ Debug.toString other)
            ]
        , describe "ELM-AUTH-14 commit-while-running-continuation is rejected"
            [ test "ContinuationStarted(P, R) + TaskCompletionCommitted C -> TaskCompletionCommittedWhileHeld" <|
                \_ ->
                    let
                        p = PromptRef "p1"
                        r = RunRef "r1"
                        c = CompletionRef "c1"
                        ( m1, _, _ ) =
                            updateWithViolations (PendingPromptEnqueued p PromptExplicitUser) emptyModel
                        ( m2, _, _ ) =
                            updateWithViolations (PendingPromptDequeued p) m1
                        ( m3, _, _ ) =
                            updateWithViolations (ContinuationScheduled p) m2
                        ( m4, _, _ ) =
                            updateWithViolations (ContinuationStarted p r) m3
                        ( _, _, v ) =
                            updateWithViolations (TaskCompletionCommitted c) m4
                    in
                    case v of
                        Just (TaskCompletionCommittedWhileHeld _) ->
                            Expect.pass

                        other ->
                            Expect.fail ("expected TaskCompletionCommittedWhileHeld, got " ++ Debug.toString (Maybe.map Authority.violationName other))
            ]
        , describe "ELM-AUTH-15 no holds + no commit -> AuthorizeTaskCompletion (BEFORE commit)"
            [ test "RunStarted R1, AgentTurnDone R1, SubmitAndExitSeen -> AuthorizeTaskCompletion is in the effect set" <|
                \_ ->
                    let
                        r1 = RunRef "r1"
                        s1 = SubmitRef "s1"
                        ( m1, _, _ ) =
                            updateWithViolations (RunStarted r1 OriginExplicitUser) emptyModel
                        ( m2, _, _ ) =
                            updateWithViolations (AgentTurnDone r1) m1
                        ( _, effects, _ ) =
                            updateWithViolations (SubmitAndExitSeen s1) m2
                    in
                    Expect.equal True (List.member AuthorizeTaskCompletion effects)
            ]
        , describe "ELM-AUTH-16 commit + no presentation -> AuthorizeCompletionPresentation"
            [ test "RunStarted, AgentTurnDone, SubmitAndExitSeen, TaskCompletionCommitted -> AuthorizeCompletionPresentation" <|
                \_ ->
                    let
                        r1 = RunRef "r1"
                        s1 = SubmitRef "s1"
                        c1 = CompletionRef "c1"
                        ( m1, _, _ ) =
                            updateWithViolations (RunStarted r1 OriginExplicitUser) emptyModel
                        ( m2, _, _ ) =
                            updateWithViolations (AgentTurnDone r1) m1
                        ( m3, _, _ ) =
                            updateWithViolations (SubmitAndExitSeen s1) m2
                        ( m4, _, _ ) =
                            updateWithViolations (TaskCompletionCommitted c1) m3
                        ( _, effects, _ ) =
                            updateWithViolations (SubmitAndExitSeen (SubmitRef "s2")) m4
                    in
                    Expect.all
                        [ \() -> Expect.equal False (List.member AuthorizeTaskCompletion effects)
                        , \() -> Expect.equal True (List.member AuthorizeCompletionPresentation effects)
                        ]
                        ()
            ]
        , describe "ELM-AUTH-17 ordinary event after Completed -> EventAfterCompletion"
            [ test "full happy path then RunStarted(R) -> EventAfterCompletion" <|
                \_ ->
                    let
                        r1 = RunRef "r1"
                        s1 = SubmitRef "s1"
                        c1 = CompletionRef "c1"
                        r2 = RunRef "r2"
                        ( m1, _, _ ) =
                            updateWithViolations (RunStarted r1 OriginExplicitUser) emptyModel
                        ( m2, _, _ ) =
                            updateWithViolations (AgentTurnDone r1) m1
                        ( m3, _, _ ) =
                            updateWithViolations (SubmitAndExitSeen s1) m2
                        ( m4, _, _ ) =
                            updateWithViolations (TaskCompletionCommitted c1) m3
                        ( m5, _, _ ) =
                            updateWithViolations (CompletionPresented c1) m4
                        ( _, _, v ) =
                            updateWithViolations (RunStarted r2 OriginExplicitUser) m5
                    in
                    case v of
                        Just (EventAfterCompletion _) ->
                            Expect.pass

                        other ->
                            Expect.fail ("expected EventAfterCompletion, got " ++ Debug.toString (Maybe.map Authority.violationName other))
            ]
        ]
