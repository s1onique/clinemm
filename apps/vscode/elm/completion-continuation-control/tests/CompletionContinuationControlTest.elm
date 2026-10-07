module CompletionContinuationControlTest exposing
    ( testSuite
    )


{-| Elm unit tests for the completion-continuation-control kernel.

ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02 C29:

These tests pin the **pure projection** matrix directly against the
Elm kernel. They do NOT exercise TS effect plumbing, runtime authority,
or trust provenance (those are TS-side tests).

Precedence fixtures (C4):
  CTRL-01 HELD + observations + retry   -> ObserveThenRetry
  CTRL-02 HELD + no observations        -> FailClosed ObservationUnavailable
  CTRL-03 not held + retry              -> RetryCompletion
  CTRL-04 not held + retry unavailable  -> FailClosed RetryUnavailable
  CTRL-05 stalled                       -> FailClosed StalledNoProgress
  CTRL-06 session/task mismatch         -> FailClosed SessionMismatch / TaskMismatch
  CTRL-07 already committed             -> FailClosed AlreadyCommitted
  CTRL-08 malformed                     -> FailClosed MalformedFacts
-}
import Domain exposing
    ( CapabilityMap
    , Directive(..)
    , FailureReason(..)
    , emptyCapabilityMap
    , factsDefaults
    )
import Expect
import Fuzz
import Policy
import Test exposing
    ( Test
    , describe
    , fuzz
    , test
    )


withObs : Bool -> CapabilityMap
withObs v =
    Domain.capabilityMapSet Domain.ObserveHeldResults v emptyCapabilityMap


withRetry : Bool -> CapabilityMap
withRetry v =
    Domain.capabilityMapSet Domain.CanRetryCompletion v emptyCapabilityMap


testSuite : Test
testSuite =
    describe "CompletionContinuationControl kernel"
        [ describe "CTRL-01 HELD + observations + retry"
            [ test "ObserveThenRetry" <|
                \_ ->
                    Policy.decide
                        { unconsumedCount = 2
                        , observation = withObs True
                        , completion = withRetry True
                        , stalledNoProgress = False
                        , sessionMatches = True
                        , taskMatches = True
                        , alreadyCommitted = False
                        }
                        |> Expect.equal ObserveThenRetry
            ]
        , describe "CTRL-02 HELD + no observation"
            [ test "FailClosed ObservationUnavailable" <|
                \_ ->
                    Policy.decide
                        { unconsumedCount = 1
                        , observation = emptyCapabilityMap
                        , completion = withRetry True
                        , stalledNoProgress = False
                        , sessionMatches = True
                        , taskMatches = True
                        , alreadyCommitted = False
                        }
                        |> Expect.equal (FailClosed ObservationUnavailable)
            ]
        , describe "CTRL-03 not held + retry"
            [ test "RetryCompletion" <|
                \_ ->
                    Policy.decide
                        { unconsumedCount = 0
                        , observation = withObs True
                        , completion = withRetry True
                        , stalledNoProgress = False
                        , sessionMatches = True
                        , taskMatches = True
                        , alreadyCommitted = False
                        }
                        |> Expect.equal RetryCompletion
            ]
        , describe "CTRL-04 not held + retry unavailable"
            [ test "FailClosed RetryUnavailable" <|
                \_ ->
                    Policy.decide
                        { unconsumedCount = 0
                        , observation = emptyCapabilityMap
                        , completion = emptyCapabilityMap
                        , stalledNoProgress = False
                        , sessionMatches = True
                        , taskMatches = True
                        , alreadyCommitted = False
                        }
                        |> Expect.equal (FailClosed RetryUnavailable)
            ]
        , describe "CTRL-05 same-fingerprint stall"
            [ test "FailClosed StalledNoProgress even with capabilities" <|
                \_ ->
                    Policy.decide
                        { unconsumedCount = 2
                        , observation = withObs True
                        , completion = withRetry True
                        , stalledNoProgress = True
                        , sessionMatches = True
                        , taskMatches = True
                        , alreadyCommitted = False
                        }
                        |> Expect.equal (FailClosed StalledNoProgress)
            ]
        , describe "CTRL-06 identity mismatch"
            [ test "FailClosed SessionMismatch" <|
                \_ ->
                    Policy.decide
                        { unconsumedCount = 1
                        , observation = withObs True
                        , completion = withRetry True
                        , stalledNoProgress = False
                        , sessionMatches = False
                        , taskMatches = True
                        , alreadyCommitted = False
                        }
                        |> Expect.equal (FailClosed SessionMismatch)
            , test "FailClosed TaskMismatch" <|
                \_ ->
                    Policy.decide
                        { unconsumedCount = 1
                        , observation = withObs True
                        , completion = withRetry True
                        , stalledNoProgress = False
                        , sessionMatches = True
                        , taskMatches = False
                        , alreadyCommitted = False
                        }
                        |> Expect.equal (FailClosed TaskMismatch)
            ]
        , describe "CTRL-07 already committed"
            [ test "FailClosed AlreadyCommitted" <|
                \_ ->
                    Policy.decide
                        { unconsumedCount = 0
                        , observation = withObs True
                        , completion = withRetry True
                        , stalledNoProgress = False
                        , sessionMatches = True
                        , taskMatches = True
                        , alreadyCommitted = True
                        }
                        |> Expect.equal (FailClosed AlreadyCommitted)
            ]
        , describe "CTRL-08 malformed"
            [ test "FailClosed MalformedFacts on negative unconsumedCount" <|
                \_ ->
                    Policy.decide
                        { unconsumedCount = -1
                        , observation = withObs True
                        , completion = withRetry True
                        , stalledNoProgress = False
                        , sessionMatches = True
                        , taskMatches = True
                        , alreadyCommitted = False
                        }
                        |> Expect.equal (FailClosed MalformedFacts)
            ]
        , describe "precedence — identity takes priority over stall"
            [ test "session mismatch > stalled > held+capabilities" <|
                \_ ->
                    Policy.decide
                        { unconsumedCount = 5
                        , observation = withObs True
                        , completion = withRetry True
                        , stalledNoProgress = True
                        , sessionMatches = False
                        , taskMatches = True
                        , alreadyCommitted = False
                        }
                        |> Expect.equal (FailClosed SessionMismatch)
            , test "stalled > held+capabilities" <|
                \_ ->
                    Policy.decide
                        { unconsumedCount = 5
                        , observation = withObs True
                        , completion = withRetry True
                        , stalledNoProgress = True
                        , sessionMatches = True
                        , taskMatches = True
                        , alreadyCommitted = False
                        }
                        |> Expect.equal (FailClosed StalledNoProgress)
            , test "alreadyCommitted > held+capabilities" <|
                \_ ->
                    Policy.decide
                        { unconsumedCount = 5
                        , observation = withObs True
                        , completion = withRetry True
                        , stalledNoProgress = False
                        , sessionMatches = True
                        , taskMatches = True
                        , alreadyCommitted = True
                        }
                        |> Expect.equal (FailClosed AlreadyCommitted)
            ]
        , describe "C9 facts-isolation"
            [ fuzz Fuzz.int "negative unconsumedCount is always MalformedFacts" <|
                \n ->
                    let
                        facts =
                            { unconsumedCount = n - 1
                            , observation = withObs True
                            , completion = withRetry True
                            , stalledNoProgress = False
                            , sessionMatches = True
                            , taskMatches = True
                            , alreadyCommitted = False
                            }
                    in
                    Policy.decide facts
                        |> Expect.equal (FailClosed MalformedFacts)
            ]
        ]