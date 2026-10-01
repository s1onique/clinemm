module Domain exposing
    ( Model
    , Msg(..)
    , Effect(..)
    , HoldReason(..)
    , Violation(..)
    , TaskState(..)
    , RunState(..)
    , JobLifecycle(..)
    , ObservationState(..)
    , PromptState(..)
    , TerminalKind(..)
    , RunOrigin(..)
    , PromptOrigin(..)
    , TaskRef(..)
    , RunRef(..)
    , JobRef(..)
    , OwnerRef(..)
    , PromptRef(..)
    , CompletionRef(..)
    , SubmitRef(..)
    , EvidenceRef(..)
    , JobState
    , initialModel
    , emptyModel
    , taskRefToString
    , runRefToString
    , jobRefToString
    , ownerRefToString
    , promptRefToString
    , completionRefToString
    , submitRefToString
    , jobRunningCount
    , unconsumedOwnedTerminalCount
    )

{-| Pure data layer for the completion-authority Elm shadow kernel.

This module holds *only* types and pure constructors. It does not import
anything from `Authority` or `Codec`. The closed vocabulary and identity
wrappers are FROZEN for ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SHADOW01.

CORRECTION02 (P0-2): the lifecycle of a background job is folded into
`JobLifecycle`. A consumed terminal is no longer counted as a running
background job.

CORRECTION02 (P0-1): removed `CompletionNotCommitted` from `HoldReason`
(it belongs in presentation authority, not task-completion authority).

CORRECTION02 (P0-2 export fix): `ObservationState(..)` is *still
exposed* because `Authority.handleTerminalObserved`, `Authority.lifecycleName`,
and `Domain.unconsumedOwnedTerminalCount` pattern-match and construct
its constructors. Hiding it would require either re-exposing each
constructor individually or forcing callers to import `Domain.JobTerminal
Observation`-as-data, which Elm does not support. The architectural
"fold" is that observation is now part of `JobLifecycle`, not that the
nested enum disappears from the module surface.

Adding a new variant here is a breaking change for the historical
replay harness, the bounded invariant tests, and the wire contract.
-}


-- ---------------------------------------------------------------------------
-- Identity wrappers
-- ---------------------------------------------------------------------------


type TaskRef
    = TaskRef String


type RunRef
    = RunRef String


type JobRef
    = JobRef String


type OwnerRef
    = OwnerRef String


type PromptRef
    = PromptRef String


type CompletionRef
    = CompletionRef String


type SubmitRef
    = SubmitRef String


taskRefToString : TaskRef -> String
taskRefToString (TaskRef s) =
    s


runRefToString : RunRef -> String
runRefToString (RunRef s) =
    s


jobRefToString : JobRef -> String
jobRefToString (JobRef s) =
    s


ownerRefToString : OwnerRef -> String
ownerRefToString (OwnerRef s) =
    s


promptRefToString : PromptRef -> String
promptRefToString (PromptRef s) =
    s


completionRefToString : CompletionRef -> String
completionRefToString (CompletionRef s) =
    s


submitRefToString : SubmitRef -> String
submitRefToString (SubmitRef s) =
    s


{-| Open a possibly-missing identity reference into the typed view Elm
uses internally. Used by the codec so that identity absence is honest
rather than synthesized.

`PROVENANCE_UNRESOLVED` is reported when the historical evidence does
not carry the value. Per ACT §25, Elm never manufactures correlation.
-}
type EvidenceRef a
    = Known a
    | Unavailable


-- ---------------------------------------------------------------------------
-- Origin / kind enums (closed, FROZEN)
-- ---------------------------------------------------------------------------


type RunOrigin
    = OriginExplicitUser
    | OriginPendingPromptDrain
    | OriginDeferredContinuation
    | OriginModeContinuation
    | OriginSessionResume
    | OriginUnknown String


type PromptOrigin
    = PromptExplicitUser
    | PromptPendingPromptDrain
    | PromptDeferredContinuation
    | PromptModeContinuation
    | PromptUnknown String


type TerminalKind
    = TerminalOwned
    | TerminalBackgroundNotOwned


-- ---------------------------------------------------------------------------
-- Task / run / job / prompt state machines
-- ---------------------------------------------------------------------------


type TaskState
    = Idle
    | Active
    | AwaitingAuthority
    | CompletionCommitted
    | Completed
    | Cancelled


type RunState
    = RunActive
    | RunDone


{-| Background-job lifecycle (CORRECTION02, P0-2).

A job's observation state is *part of* its lifecycle, not a separate
orthogonal field. After `TerminalObserved J` fires, the job is
`JobTerminal ObservationConsumed`, which means:

  - it is no longer counted as a running background job (P0-2),
  - but if it is owned, it may still hold completion on
    `UnconsumedTerminalObservation` until *both* observed AND
    consumed in the host system.

In this kernel we collapse observation & consumption into a single
state machine because the wire contract has only one observation
event (`terminal_observed`). Per-host double-flag tracking belongs
in the TS adapter.
-}
type JobLifecycle
    = JobRunning
    | JobTerminal ObservationState


{-| CORRECTION02: still part of the vocabulary but no longer exposed
as a top-level constructor list — it lives inside `JobLifecycle`.
-}
type ObservationState
    = ObservationPending
    | ObservationConsumed


type PromptState
    = PromptQueued
    | PromptDequeued
    | PromptScheduled
    | PromptRunning RunRef
    | PromptConsumed


-- ---------------------------------------------------------------------------
-- Hold reasons (Effect labels) and Violations
-- ---------------------------------------------------------------------------


{-| The set of reasons *task* completion may be HELD.

CORRECTION02 (P0-1): `CompletionNotCommitted` is NOT a hold reason
for task-completion authority. The causal order is:

    authority satisfied (no holds)
    → AuthorizeTaskCompletion
    → TS commits completion
    → TaskCompletionCommitted arrives as fact
    → presentation authority is now satisfied
    → AuthorizeCompletionPresentation

Anything that confuses "no commit yet" with "authority not satisfied"
inverts the order.
-}
type HoldReason
    = ActiveRun
    | RunningBackgroundJob
    | UnconsumedTerminalObservation
    | PendingPrompt
    | ScheduledContinuation


{-| Illegal or incomplete transitions. The first violation discovered
during replay is the diagnostic output; replay does NOT abort on
violation (each subsequent event still updates the model so the
final state can be inspected).
-}
type Violation
    = RunStartedWhileRunActive RunRef RunRef
    | RunClosedByOtherRef RunRef RunRef
    | PromptScheduledWithoutDequeue PromptRef
    | ContinuationStartedWithoutSchedule PromptRef RunRef
    | DuplicateCompletionRef CompletionRef CompletionRef
    | PresentationBeforeCommit CompletionRef
    | ScheduledContinuationWhileCommitted
    | EventAfterCompletion Msg
    | UnknownStage String
    | DuplicateObservation JobRef
    | IdentityMismatch String
      -- CORRECTION02 (P0-4): TaskCompletionCommitted while a hold
      -- reason still applies. The kernel rejects the commit and the
      -- model is left unchanged.
    | TaskCompletionCommittedWhileHeld HoldReason
      -- CORRECTION02 (P0-3): AgentTurnDone that does not match any
      -- PromptRunning runRef (i.e. a run finishes without consuming
      -- the continuation prompt it was started for).
    | PromptRunningUnconsumedAtRunClose PromptRef RunRef


-- ---------------------------------------------------------------------------
-- Closed Msg vocabulary (FROZEN for SHADOW01)
-- ---------------------------------------------------------------------------


{-| The minimal closed set of *factual events* the kernel can receive.
Derived decisions (`shouldHoldCompletion`, `canFinalize`,
`isCompletionAuthorized`, `hasOutstandingWork`) are NOT in this set;
they are computed from the model by `Authority.update`.

Adding a constructor is a breaking change for the historical replay
fixtures and the wire codec.
-}
type Msg
    = TaskStarted TaskRef
    | RunStarted RunRef RunOrigin
    | AgentTurnDone RunRef
    | TerminalRegistered JobRef OwnerRef TerminalKind
    | TerminalObserved JobRef
    | PendingPromptEnqueued PromptRef PromptOrigin
    | PendingPromptDequeued PromptRef
    | ContinuationScheduled PromptRef
    | ContinuationStarted PromptRef RunRef
    | SubmitAndExitSeen SubmitRef
    | TaskCompletionCommitted CompletionRef
    | CompletionPresented CompletionRef
    | TaskCancelled
    | ExecuteTurnPreludeEnter RunRef


-- ---------------------------------------------------------------------------
-- Effects (predicted, never executed)
-- ---------------------------------------------------------------------------


type Effect
    = HoldCompletion HoldReason
    | AuthorizeContinuation PromptRef
    | AuthorizeTaskCompletion
    | AuthorizeCompletionPresentation
    | NoEffect


-- ---------------------------------------------------------------------------
-- Model
-- ---------------------------------------------------------------------------


type alias Model =
    { task : TaskState
    , activeRun : Maybe RunRef
    , runs : List ( RunRef, RunState )
    , jobs : List ( JobRef, JobState )
    , prompts : List ( PromptRef, PromptState )
    , submitCount : Int
    , commitReadyRun : Maybe RunRef
    , committedCompletion : Maybe CompletionRef
    , presentedCompletion : Maybe CompletionRef
    }


{-| CORRECTION02 (P0-2): `observation` field is folded into `lifecycle`.
-}
type alias JobState =
    { owner : OwnerRef
    , kind : TerminalKind
    , lifecycle : JobLifecycle
    }


emptyModel : Model
emptyModel =
    { task = Idle
    , activeRun = Nothing
    , runs = []
    , jobs = []
    , prompts = []
    , submitCount = 0
    , commitReadyRun = Nothing
    , committedCompletion = Nothing
    , presentedCompletion = Nothing
    }


-- ---------------------------------------------------------------------------
-- Tiny derived projections (pure, exposed for tests/harness)
-- ---------------------------------------------------------------------------


{-| Count of jobs that are still `JobRunning`. CORRECTION02 P0-2: this
must not include observed terminals.
-}
jobRunningCount : Model -> Int
jobRunningCount model =
    List.length
        (List.filter
            (\( _, job ) -> job.lifecycle == JobRunning)
            model.jobs
        )


{-| Count of owned jobs whose terminal observation is still pending.
This is the I4 hold source.
-}
unconsumedOwnedTerminalCount : Model -> Int
unconsumedOwnedTerminalCount model =
    List.length
        (List.filter
            (\( _, job ) ->
                job.kind == TerminalOwned
                    && job.lifecycle == JobTerminal ObservationPending
            )
            model.jobs
        )


{-| Initial model used by tests that want the task explicitly active
from the first event. The replay harness always uses `emptyModel`.
-}
initialModel : Model
initialModel =
    emptyModel