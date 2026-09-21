# 18 — Successor authorization (frozen)

This ACT authorizes exactly ONE bounded implementation successor
ACT. NO production code is modified by this ACT.

## 18.1 Selected successor

```text
SUCCESSOR_ACT_ID =
  ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01

SUCCESSOR_PURPOSE =
  Bounded async terminal->session stimulus:
  - add the notifyOnCompletion optional field to RunCommandsInputSchema
  - add the F4 appended paragraph about the new flag
  - implement the wake consumer on
    CommandJobManager.onCommandJobLifecycle
  - register the wake consumer alongside the existing turn-state
    consumer
  - bind the wake via PendingPromptsController.enqueue with
    delivery:"queue"
  - reuse the existing identity-correlating machinery for
    exactly-once semantics
  - add a focused test family mirroring the BTCONT01 test shape
    (real CommandJobManager + real wake consumer + real
    PendingPromptsController + identity tests)
```

## 18.2 What the successor MUST do

```text
1. Schema change:
   - Add `notifyOnCompletion?: boolean` to RunCommandsInputSchema
     in sdk/packages/core/src/extensions/tools/schemas.ts.
   - Keep `.strict()` to reject unknown fields.

2. Tool description change:
   - Append the notifyOnCompletion paragraph to
     buildRunCommandsDescription in
     sdk/packages/core/src/extensions/tools/definitions.ts:669-676.

3. Identity capture (session/coordinator seam — per §15.7.1):
   - At run_commands call time, capture
     (sessionId, taskId, epoch, notifyOnCompletion) at the
     SdkSessionEventCoordinator seam (or equivalent where
     options.getTask().taskId is reachable).
   - Store in a per-session identity map keyed by jobId:
     Map<jobId, { sessionId, taskId, epoch, notifyOnCompletion }>
   - The map lives at the session/coordinator seam, NOT on CommandJob.

4. Wake consumer:
   - New module that subscribes to
     CommandJobManager.onCommandJobLifecycle events.
   - On event "command_job_terminal_committed" (per-job, fires
     exactly once per terminal job — see §15.7.3):
     - look up identity at the session/coordinator seam
     - check conservation rules (sessionId, taskId, epoch,
       hasRunningBackgroundJobForOwner)
     - if notifyOnCompletion:true AND conservation pass AND no
       other notify=true job for owner:
         enqueue bounded generated prompt string via
         PendingPromptsController.enqueue with delivery:"queue"
     - if notifyOnCompletion:true AND another notify=true job
       still running for owner:
         HOLD the wake in the session/coordinator held set
         (FIFO by createdAtMs)
     - else: discard (notify=false is the default)

5. Wake prompt format (per §15.7.2):
   - Single function `formatTerminalWakePrompt(payload)` in the
     successor ACT's implementation module.
   - Returns a bounded string (hard cap 8 KB; soft target 4 KB).
   - Schema frozen in §15.7.2.
   - NOT a typed payload — PendingPromptsController accepts
     { prompt: string } only.

6. Multi-job held set (per §15.7.3):
   - Lives at the session/coordinator seam.
   - FIFO drain triggered when the last notify=true job terminates.
   - Wakes are dropped only when the session ends
     (PERSISTENCE = EPHEMERAL_ONLY).

7. Wiring:
   - Register the wake consumer alongside the existing
     SdkController.updateBackgroundCommandState callback at the
     SdkSessionLifecycle construction site (or a similar bounded
     place; the exact location is the successor ACT's choice).

8. Tests:
   - Add a focused test family mirroring the BTCONT01 test shape:
     - real CommandJobManager
     - real wake consumer
     - real PendingPromptsController
     - real session/coordinator identity map
     - real held set + FIFO drain
   - Cover S1-S11 from §16.
   - Specifically assert per-job terminal event semantics
     (NOT >0→0 cardinal transitions).

9. Documentation:
   - Update the run_commands tool description (already in §15).
   - Update the user-facing doctrine in docs/ — must state
     honestly that WAIT(v1) collapses to NOTIFY semantics and
     that strict WAIT is deferred.
   - Update the AGENTS.md / README.md if applicable.
```

## 18.3 What the successor MUST NOT do

```text
- DO NOT modify CommandJobManager internal CommandJob state
  machine semantics (the wake consumer is a subscriber, not a
  state-machine participant).
- DO NOT modify command_status / cancel_command / Proceed While
  Running.
- DO NOT modify the turn-state consumer
  (SdkController.updateBackgroundCommandState +
  reevaluateDeferredContinuation).
- DO NOT modify the Q5 deferral marker.
- DO NOT modify any card / TaskHeader / webview / protobuf surface.
- DO NOT introduce a new suspended-tool state machine (Candidate C).
- DO NOT make the wake fire for jobs whose notifyOnCompletion is
  false (Candidate A is preserved as the default).
- DO NOT introduce a `notifyParent` plugin (this is host-builtin,
  not plugin).
- DO NOT persist the wake intent in v1 (PERSISTENCE = EPHEMERAL_ONLY).
```

## 18.4 Scope budget

```text
Expected production files touched (rough):
  - sdk/packages/core/src/extensions/tools/schemas.ts (add 1 field)
  - sdk/packages/core/src/extensions/tools/definitions.ts
    (append 1 paragraph)
  - apps/vscode/src/sdk/<new>notify-on-terminal-wake.ts (new file,
    the wake consumer module)
  - apps/vscode/src/sdk/<new>notify-on-terminal-format.ts or similar
    (formatTerminalWakePrompt function per §15.7.2)
  - apps/vscode/src/sdk/<new>notify-on-terminal-identity-map.ts
    or similar (per-session identity map per §15.7.1)
  - apps/vscode/src/sdk/sdk-session-event-coordinator.ts OR
    equivalent (register identity capture + held set)
  - apps/vscode/src/sdk/SdkController.ts or similar wiring site
    (wire wake consumer to CommandJobManager.onCommandJobLifecycle)
  - tests: 1 new test family mirroring BTCONT01 shape

NOT touched:
  - apps/vscode/src/sdk/command-job-manager.ts (CommandJob record
    structure UNCHANGED; the wake consumer is a SUBSCRIBER to
    onCommandJobLifecycle, not a CommandJob state-machine
    participant). The notification identity owner lives at the
    coordinator seam, NOT on CommandJob.

Expected documentation files touched (rough):
  - docs/features/<something>.mdx or similar (user-facing doctrine)
    Must state honestly that WAIT(v1) collapses to NOTIFY and that
    strict WAIT is deferred.

Boundary discipline:
  - No model prompt changes beyond the appended paragraph.
  - No system prompt changes.
  - No prompt-builder changes.
  - No Q5 follow-up coordinator changes.
  - No BTCONT01 / AGCONT01 / PWAOR re-litigation.
  - No CommandJob record structure changes (per §15.7.1 / §18.2 #3).
```

## 18.5 Risk register (handoff to successor ACT)

```text
R1: identity check too loose → late wake fires for superseded task
    Mitigation: capture identity at run_commands call time
    (sessionId + taskId + epoch) and check on each terminal event;
    the wake consumer is STRICTLY STRICTER than the turn-state
    consumer.

R2: identity check too strict → wake never fires
    Mitigation: identity is captured at run_commands call time and
    read from the per-session map; if taskId is undefined, fall back
    to sessionId-only identity (acceptable for non-task contexts).

R3: wake prompt content too long → token waste
    Mitigation: cap stdoutTail and stderrTail at ~80 lines each;
    total prompt bounded at hard cap 8 KB, soft target 4 KB
    (per §15.7.2).

R4: wake prompt poisons the model context
    Mitigation: the wake is a new turn (delivery:"queue" → drain
    → runTurn → fresh context window). It does NOT inject into
    the previous turn's context.

R5: wake fires multiple times for one job
    Mitigation: the wake consumer subscribes to the per-job
    "command_job_terminal_committed" lifecycle event, which fires
    EXACTLY ONCE per terminal job (per §15.7.3). The CommandJob
    terminal-once invariant + the held-set FIFO drain guarantee
    at-most-once enqueue.

R6: wake fires for the wrong session
    Mitigation: sessionId is captured at run_commands call time
    at the coordinator seam and bound to the wake prompt;
    PendingPromptsController.enqueue is invoked with the captured
    sessionId; routing is by sessionId.

R7: containment_failed wake → false "done"
    Mitigation: per §11.3 / §14.6, containment_failed does NOT
    wake. The wake consumer subscribes ONLY to
    "command_job_terminal_committed", NOT to
    "command_job_containment_failed". Diagnostic only.

R8: extension restart loses wake
    Mitigation: ACCEPTED in v1. PERSISTENCE = EPHEMERAL_ONLY.
    User-facing doctrine states this explicitly. Future cycle may
    add PERSISTED.

R9: multi-job wakes accumulate
    Mitigation: per-job terminal events drive a session/coordinator
    held set (per §15.7.3). The held set is drained FIFO when the
    last notify=true job terminates. Bounded by maxTerminalJobs.
```

## 18.6 Why exactly one successor ACT

```text
Per ACT body §41:

  "B selected:
     ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01
     Purpose:
       bounded async terminal->session stimulus"

The contract is bounded: one schema field, one new consumer,
identity rules reused. Splitting this into multiple successor
ACTs would multiply the cost without changing the surface.

D (multi-mode) split is NOT authorized in v1 because the
"wait" mode (Candidate C) requires architecture we do not have.
A future ACT may add "wait" mode if the suspended-tool state
machine is funded.

A (polling-only) split is NOT authorized because the LIVE
specimen proved it does not honor the user's "wait until
finished" intent.
```

## 18.7 What this ACT explicitly STOPs after §18.6

```text
Per ACT body §48:

  STOP. Do not:
    - add notifyParent
    - add a new proto field
    - add terminal->AgentRuntime wake (the wake is via
      PendingPromptsController, not via a direct AgentRuntime call)
    - change system prompts
    - make the model poll differently
    - alter DeferredContinuation
    - change BTCONT
    - change PWAOR
    - fix stale cards
    - add queueing (the existing queue is reused)
    - implement persistence (v1 is ephemeral-only)
  Instead produce exactly one bounded successor ACT for the
  chosen behavior.
```

## 18.8 Epistemic purpose handoff

```text
This ACT's purpose:   PRODUCT-CONTRACT SELECTION
Successor's purpose:  BOUNDED IMPLEMENTATION OF THE SELECTED CONTRACT

The successor ACT will:
  - inherit the contract freeze from §14-§17
  - own the production change
  - own the test family
  - own the documentation update
  - own its own recon for any new information discovered

The successor ACT will NOT:
  - re-open the contract decision
  - re-litigate Candidate A vs B vs C vs D
  - introduce a different user-intent representation
  - introduce persistence in v1
```
