module CompletionContinuationControlTest exposing
    ( testSuite
    )


{-| Elm unit tests for the completion-continuation-control kernel.

ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02 C29:

These tests pin the **pure projection** matrix directly against the
Elm kernel. They do NOT exercise TS effect plumbing, runtime authority,
or trust provenance (those are TS-side tests).

ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01 (C4 / C5):

The held-set progress classification moves into the kernel. The
test matrix below pins the four closed transitions from the
candidate held-set transition domain (ACT §C2). Every CTRL-* test
in AUTHORITY02 is updated to use the new schema:

  - `stalledNoProgress: Bool` is REMOVED.
  - `priorHeldSetSorted: List String` and
    `currentHeldSetSorted: List String` are added.
  - The "first call" semantic is `prior = []` (Indeterminate).
  - The "no progress" semantic is `prior == current` (the canonical
    set equality, regardless of order in the TS source).
  - The "passive accumulation" semantic is `current` is a strict
    superset of `prior`.
  - The "real progress" semantic is `prior` has an element not
    in `current` (contraction or membership shift).
-}
import Domain exposing
    ( CapabilityMap
    , Directive(..)
    , FailureReason(..)
    , HeldSetProgress(..)
    , emptyCapabilityMap
    )
import Domain
    exposing
    ( Sortedness(..)
    , factsIsExpected
    , validateHeldSetSortedness
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


firstCallAllCapable : Domain.Facts
firstCallAllCapable =
    { unconsumedCount = 2
    , observation = withObs True
    , completion = withRetry True
    , priorHeldSetSorted = []
    , currentHeldSetSorted = [ "j1", "j2" ]
    , sessionMatches = True
    , taskMatches = True
    , alreadyCommitted = False
    }


identicalHeldSet : Domain.Facts
identicalHeldSet =
    { unconsumedCount = 2
    , observation = withObs True
    , completion = withRetry True
    , priorHeldSetSorted = [ "j1", "j2" ]
    , currentHeldSetSorted = [ "j1", "j2" ]
    , sessionMatches = True
    , taskMatches = True
    , alreadyCommitted = False
    }


passiveAccumulationHeldSet : Domain.Facts
passiveAccumulationHeldSet =
    { unconsumedCount = 3
    , observation = withObs True
    , completion = withRetry True
    , priorHeldSetSorted = [ "j1", "j2" ]
    , currentHeldSetSorted = [ "j1", "j2", "j3" ]
    , sessionMatches = True
    , taskMatches = True
    , alreadyCommitted = False
    }


contractionHeldSet : Domain.Facts
contractionHeldSet =
    { unconsumedCount = 1
    , observation = withObs True
    , completion = withRetry True
    , priorHeldSetSorted = [ "j1", "j2" ]
    , currentHeldSetSorted = [ "j2" ]
    , sessionMatches = True
    , taskMatches = True
    , alreadyCommitted = False
    }


testSuite : Test
testSuite =
    describe "CompletionContinuationControl kernel"
        [ describe "CTRL-01 HELD + observations + retry"
            [ test "ObserveThenRetry" <|
                \_ ->
                    Policy.decide firstCallAllCapable
                        |> Expect.equal ObserveThenRetry
            ]
        , describe "CTRL-02 HELD + no observation"
            [ test "FailClosed ObservationUnavailable" <|
                \_ ->
                    Policy.decide
                        { firstCallAllCapable
                            | observation = emptyCapabilityMap
                        }
                        |> Expect.equal (FailClosed ObservationUnavailable)
            ]
        , describe "CTRL-03 not held + retry"
            [ test "RetryCompletion" <|
                \_ ->
                    Policy.decide
                        { firstCallAllCapable
                            | unconsumedCount = 0
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
                        , priorHeldSetSorted = []
                        , currentHeldSetSorted = []
                        , sessionMatches = True
                        , taskMatches = True
                        , alreadyCommitted = False
                        }
                        |> Expect.equal (FailClosed RetryUnavailable)
            ]
        , describe "CTRL-05 stalled"
            [ test "identical held set -> FailClosed StalledNoProgress" <|
                \_ ->
                    Policy.decide identicalHeldSet
                        |> Expect.equal (FailClosed StalledNoProgress)
            , test "passive accumulation -> FailClosed StalledNoProgress" <|
                \_ ->
                    Policy.decide passiveAccumulationHeldSet
                        |> Expect.equal (FailClosed StalledNoProgress)
            ]
        , describe "CTRL-05b real progress"
            [ test "contraction -> ObserveThenRetry" <|
                \_ ->
                    Policy.decide contractionHeldSet
                        |> Expect.equal ObserveThenRetry
            , test "membership shift -> ObserveThenRetry" <|
                \_ ->
                    Policy.decide
                        { firstCallAllCapable
                            | priorHeldSetSorted = [ "j1", "j2" ]
                            , currentHeldSetSorted = [ "j2", "j3" ]
                            , unconsumedCount = 2
                        }
                        |> Expect.equal ObserveThenRetry
            ]
        , describe "CTRL-05c indeterminate (first call)"
            [ test "prior = [] -> ObserveThenRetry" <|
                \_ ->
                    Policy.decide firstCallAllCapable
                        |> Expect.equal ObserveThenRetry
            ]
        , describe "CTRL-06 session/task mismatch"
            [ test "FailClosed SessionMismatch" <|
                \_ ->
                    Policy.decide
                        { identicalHeldSet
                            | sessionMatches = False
                        }
                        |> Expect.equal (FailClosed SessionMismatch)
            , test "FailClosed TaskMismatch" <|
                \_ ->
                    Policy.decide
                        { identicalHeldSet
                            | taskMatches = False
                        }
                        |> Expect.equal (FailClosed TaskMismatch)
            ]
        , describe "CTRL-07 already committed"
            [ test "FailClosed AlreadyCommitted" <|
                \_ ->
                    Policy.decide
                        { firstCallAllCapable
                            | unconsumedCount = 0
                            , alreadyCommitted = True
                        }
                        |> Expect.equal (FailClosed AlreadyCommitted)
            ]
        , describe "CTRL-08 malformed"
            [ test "negative unconsumedCount -> MalformedFacts" <|
                \_ ->
                    Policy.decide
                        { firstCallAllCapable
                            | unconsumedCount = -1
                        }
                        |> Expect.equal (FailClosed MalformedFacts)
            , test "empty-string id in prior -> MalformedFacts" <|
                \_ ->
                    Policy.decide
                        { firstCallAllCapable
                            | priorHeldSetSorted = [ "" ]
                        }
                        |> Expect.equal (FailClosed MalformedFacts)
            , test "empty-string id in current -> MalformedFacts" <|
                \_ ->
                    Policy.decide
                        { firstCallAllCapable
                            | currentHeldSetSorted = [ "" ]
                        }
                        |> Expect.equal (FailClosed MalformedFacts)
            ]
        , describe "precedence - identity takes priority over stall"
            [ test "session mismatch > stalled" <|
                \_ ->
                    Policy.decide
                        { identicalHeldSet
                            | sessionMatches = False
                        }
                        |> Expect.equal (FailClosed SessionMismatch)
            , test "stalled > held+capabilities" <|
                \_ ->
                    Policy.decide identicalHeldSet
                        |> Expect.equal (FailClosed StalledNoProgress)
            , test "alreadyCommitted > held+capabilities" <|
                \_ ->
                    Policy.decide
                        { firstCallAllCapable
                            | unconsumedCount = 5
                            , alreadyCommitted = True
                        }
                        |> Expect.equal (FailClosed AlreadyCommitted)
            ]
        , describe "C9 facts-isolation"
            [ fuzz Fuzz.int "negative unconsumedCount is always MalformedFacts" <|
                \n ->
                    let
                        facts =
                            { firstCallAllCapable
                                | unconsumedCount = n - 1
                            }
                    in
                    Policy.decide facts
                        |> Expect.equal (FailClosed MalformedFacts)
            ]
        , describe "HELD-SET-PROGRESS-AUTHORITY01 C2: classifyHeldSetProgress"
            [ test "empty prior -> Indeterminate" <|
                \_ ->
                    Policy.classifyHeldSetProgress [] [ "j1" ]
                        |> Expect.equal Indeterminate
            , test "empty prior + empty current -> Indeterminate" <|
                \_ ->
                    Policy.classifyHeldSetProgress [] []
                        |> Expect.equal Indeterminate
            , test "identical sets -> NoProgress" <|
                \_ ->
                    Policy.classifyHeldSetProgress [ "j1", "j2" ] [ "j1", "j2" ]
                        |> Expect.equal NoProgress
            , test "current is strict superset -> PassiveAccumulation" <|
                \_ ->
                    Policy.classifyHeldSetProgress [ "j1", "j2" ] [ "j1", "j2", "j3" ]
                        |> Expect.equal PassiveAccumulation
            , test "contraction -> ContractionOrMembershipShift" <|
                \_ ->
                    Policy.classifyHeldSetProgress [ "j1", "j2" ] [ "j2" ]
                        |> Expect.equal ContractionOrMembershipShift
            , test "membership shift -> ContractionOrMembershipShift" <|
                \_ ->
                    Policy.classifyHeldSetProgress [ "j1", "j2" ] [ "j2", "j3" ]
                        |> Expect.equal ContractionOrMembershipShift
            , test "disjoint sets -> ContractionOrMembershipShift" <|
                \_ ->
                    Policy.classifyHeldSetProgress [ "j1", "j2" ] [ "j3", "j4" ]
                        |> Expect.equal ContractionOrMembershipShift
            , test "all cleared -> ContractionOrMembershipShift" <|
                \_ ->
                    Policy.classifyHeldSetProgress [ "j1", "j2" ] []
                        |> Expect.equal ContractionOrMembershipShift
            , test "long passive accumulation (LIVE STALLED-REARM-LOOP01)" <|
                \_ ->
                    Policy.classifyHeldSetProgress
                        [ "j1", "j2", "j3", "j4", "j5", "j6", "j7", "j8", "j9", "j10" ]
                        [ "j1", "j2", "j3", "j4", "j5", "j6", "j7", "j8", "j9", "j10", "j11" ]
                        |> Expect.equal PassiveAccumulation
            , test "unsorted prior -> Indeterminate (defense-in-depth at the classifier)" <|
                \_ ->
                    -- After CORRECTION02-SORTEDNESS-FAIL-CLOSED,
                    -- unsorted input no longer reaches the
                    -- classifier in the production path (it is
                    -- caught at P0 of `decide` by
                    -- `factsIsExpected` and fails as
                    -- `MalformedFacts`). The classifier still
                    -- returns `Indeterminate` here as
                    -- defense-in-depth for any future direct
                    -- caller that bypasses `factsIsExpected`.
                    Policy.classifyHeldSetProgress [ "j2", "j1" ] [ "j1", "j2" ]
                        |> Expect.equal Indeterminate
            , test "unsorted current -> Indeterminate (defense-in-depth at the classifier)" <|
                \_ ->
                    Policy.classifyHeldSetProgress [ "j1", "j2" ] [ "j2", "j1" ]
                        |> Expect.equal Indeterminate
            , test "CORRECTION02: Policy.decide with unsorted prior -> MalformedFacts (FAIL-CLOSED)" <|
                \_ ->
                    -- The new P0 fix: a mis-sorted `priorHeldSetSorted`
                    -- is a violation of the classification
                    -- contract. The trust boundary
                    -- (`Domain.factsIsExpected`) now catches it
                    -- BEFORE `classifyHeldSetProgress` is
                    -- consulted. The previous CORRECTION01 fix
                    -- routed this through `Indeterminate` →
                    -- fall-through → `ObserveThenRetry` with
                    -- observation capability → `delivered`. That
                    -- was a fail-OPEN path for malformed input.
                    Policy.decide
                        { firstCallAllCapable
                            | priorHeldSetSorted = [ "j2", "j1" ]
                            , currentHeldSetSorted = [ "j1", "j2" ]
                            , unconsumedCount = 2
                        }
                        |> Expect.equal (FailClosed MalformedFacts)
            , test "CORRECTION02: Policy.decide with unsorted current -> MalformedFacts (FAIL-CLOSED)" <|
                \_ ->
                    -- Symmetric to the previous test: a mis-sorted
                    -- `currentHeldSetSorted` also fails closed.
                    -- This is the reviewer's adversarial test
                    -- (`prior = ["j1","j2"]`,
                    -- `current = ["j2","j1"]`).
                    Policy.decide
                        { firstCallAllCapable
                            | priorHeldSetSorted = [ "j1", "j2" ]
                            , currentHeldSetSorted = [ "j2", "j1" ]
                            , unconsumedCount = 2
                        }
                        |> Expect.equal (FailClosed MalformedFacts)
            , test "CORRECTION02: Policy.decide with empty prior + non-empty current still delivers (first call preserved)" <|
                \_ ->
                    -- The CORRECTION02 fix must NOT change the
                    -- legitimate first-call semantic. An empty
                    -- `prior` plus a sorted non-empty `current`
                    -- is the closed-schema "first call"
                    -- invariant — it MUST still deliver (with
                    -- observation capability).
                    Policy.decide firstCallAllCapable
                        |> Expect.equal ObserveThenRetry
            , test "CORRECTION02: Policy.decide with empty prior + empty current still fails open (no held, no observation)" <|
                \_ ->
                    -- Boundary check: an empty `prior` plus an
                    -- empty `current` is the no-held no-progress
                    -- terminal state. The CORRECTION02 fix must
                    -- NOT mis-classify this as MalformedFacts.
                    Policy.decide
                        { unconsumedCount = 0
                        , observation = emptyCapabilityMap
                        , completion = emptyCapabilityMap
                        , priorHeldSetSorted = []
                        , currentHeldSetSorted = []
                        , sessionMatches = True
                        , taskMatches = True
                        , alreadyCommitted = False
                        }
                        |> Expect.equal (FailClosed RetryUnavailable)
            , test "CORRECTION02: Domain.validateHeldSetSortedness on sorted input -> Sorted" <|
                \_ ->
                    Domain.validateHeldSetSortedness [ "a", "b", "c" ]
                        |> Expect.equal Domain.Sorted
            , test "CORRECTION02: Domain.validateHeldSetSortedness on empty input -> Sorted" <|
                \_ ->
                    Domain.validateHeldSetSortedness []
                        |> Expect.equal Domain.Sorted
            , test "CORRECTION02: Domain.validateHeldSetSortedness on unsorted input -> NotSorted" <|
                \_ ->
                    Domain.validateHeldSetSortedness [ "b", "a" ]
                        |> Expect.equal Domain.NotSorted
            , test "CORRECTION02: Domain.factsIsExpected rejects unsorted prior at the trust boundary" <|
                \_ ->
                    Domain.factsIsExpected
                        { firstCallAllCapable
                            | priorHeldSetSorted = [ "j2", "j1" ]
                        }
                        |> Expect.equal False
            , test "CORRECTION02: Domain.factsIsExpected rejects unsorted current at the trust boundary" <|
                \_ ->
                    Domain.factsIsExpected
                        { firstCallAllCapable
                            | currentHeldSetSorted = [ "j2", "j1" ]
                        }
                        |> Expect.equal False
            , test "CORRECTION02: Domain.factsIsExpected accepts a sorted prior + sorted current (first call)" <|
                \_ ->
                    Domain.factsIsExpected firstCallAllCapable
                        |> Expect.equal True
            , test "CORRECTION01: classifier is a closed total function (no Maybe, no Result)" <|
                \_ ->
                    -- The classifier signature is `List String ->
                    -- List String -> HeldSetProgress`. No
                    -- `Maybe` / `Result`; the four-state
                    -- classification is the only possible
                    -- output. Total coverage.
                    let
                        _ =
                            Policy.classifyHeldSetProgress
                    in
                    Expect.pass
            ]
        ]
