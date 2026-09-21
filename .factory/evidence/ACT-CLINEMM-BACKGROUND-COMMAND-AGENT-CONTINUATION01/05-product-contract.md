# Product Contract — AGCONT01

> **SUPERSEDED BY CORRECTION CYCLE 2 (Factory reviewer, 2026-09-21).**
>
> The original "HYBRID_A_AND_C" / "HALT_PRODUCT_CONTRACT_REQUIRED... NO"
> verdict is superseded. The product contract is genuinely AMBIGUOUS:
>
> - F4 places output management on the MODEL (tmp-file convention).
> - F4 does NOT categorically forbid runtime-level notify-on-terminal.
> - F4 does NOT categorically require it either.
> - The runtime's structural choice (no re-entry seam) is canonical but
>   not doctrinally mandated.
> - The upstream `background-terminal` example plugin uses notify-on-
>   terminal as the default, demonstrating the pattern is permitted
>   upstream; ClineMM chose not to integrate it.
>
> The bounded observation: the current implementation has no re-entry
> seam. Whether that structural choice is the correct product semantics
> is HALT_PRODUCT_CONTRACT_REQUIRED — successor ACT
> ACT-CLINEMM-BACKGROUND-COMMAND-WAIT-SEMANTICS01.

## Question

When a user asks "wait until this command finishes" and the agent
detaches via Proceed While Running, what is the runtime's
contractual obligation at the moment the command becomes terminal?

## What the ACT's section 9 enumerated

```
Contract A: MODEL POLLING
   agent itself must continue polling until command finishes

Contract B: ASYNC CONTINUATION
   agent may yield; terminal event must re-enter the agent automatically

Contract C: USER-RETURN
   Proceed While Running means agent relinquishes obligation;
   user must explicitly resume/re-prompt later
```

## What the ClineMM production doctrine actually says

The canonical `run_commands` tool description
(`sdk/packages/core/src/extensions/tools/definitions.ts:669-676`):

> "For long-running commands, run them in background and redirect
>  output to a tmp file that you can read from later."

The doctrine says:

- The model is told the right pattern: background + tmp log + poll.
- The runtime has no synchronous wait primitive exposed to the model.
- The schema has no `await_completion` / `wait_until_done` flag.
- The "Proceed While Running" feature
  (`apps/vscode/src/core/controller/task/proceedWhileRunningCommand.ts`)
  is a USER UX affordance for detaching a running foreground
  command so the user can keep using their terminal. It is NOT
  a runtime promise to re-invoke the model.

What the doctrine does NOT say:

- It does NOT mandate that the runtime NEVER wake the model on
  terminal (the upstream `background-terminal` example plugin uses
  a notify-on-terminal pattern, demonstrating it is permitted upstream).
- It does NOT mandate that the runtime ALWAYS wake the model on
  terminal.
- It does NOT explicitly bind Contract A to "user said wait
  until finished" — that's a user-side request that the runtime
  has no flag to disambiguate.

The runtime's contract at the moment of terminality is:

```
process exits naturally
-> CommandJobManager publishes terminal lifecycle
-> SdkController.updateBackgroundCommandState(false, undefined)
   (cards projection: TaskHeader, Cancel button)
-> SdkSessionEventCoordinator.reevaluateDeferredContinuation()
   (turn-state projection: awaiting_followup)
-> no agent re-entry, by structural choice (canonical ClineMM
   contract for run_commands, but NOT a doctrinal mandate)
-> user can interact
```

The runtime commits to **projection** updates (TaskHeader, Cancel
button, awaiting_followup phase) but NOT to **agent continuation**.
Contract C is the closest match for runtime behavior, with Contract A
as the model's recommended behavior. Contract B (automatic agent
re-entry) is the upstream example plugin's pattern; ClineMM chose
not to integrate it.

## What the LIVE specimen demonstrated

The user request was: "Run this command and wait until it
finishes: sh -c 'echo STARTED; sleep 480; echo FINISHED'"

The model:
1. Issued `run_commands` (the command will hit the 30s default
   timeout and be auto-proceeded to background by the
   `FOREGROUND_COMMAND_AUTO_PROCEED_MS = 300_000ms` watchdog).
2. Said "The command is running. Let me wait for it to finish."
3. Polled once or twice.
4. Emitted a `done` event WITHOUT an attempt_completion / submit_and_exit.

Step 4 violates the doctrine. The model did not follow Contract A
correctly — it stopped polling and yielded. The runtime honored
the yielded turn by committing awaiting_followup when the
CommandJob became terminal (BTCONT01 fix).

## Verdict on contract (CORRECTION CYCLE 2)

```
PRODUCT CONTRACT = AMBIGUOUS
  A (model-driven polling) - RECOMMENDED for the model
  C (user-return after detach) - WHAT THE RUNTIME PROVIDES
  B (automatic agent re-entry) - NOT in ClineMM run_commands;
                                upstream example plugin uses it
HALT_PRODUCT_CONTRACT_REQUIRED = YES
```

There is no doctrinal mandate for Contract B in ClineMM's
production code. Adding Contract B would be a NEW PRODUCT
FEATURE, not a runtime repair.

## Decision

HALT_PRODUCT_CONTRACT_REQUIRED = YES (for the broader question).

The runtime does not have a contract that disambiguates
"wait until finished" from "fire-and-forget". The user's
intent is conveyed only via model prose, and the runtime has
no flag to disambiguate. The structural choice (no re-entry
seam) is canonical but not doctrinally mandated; the upstream
example plugin demonstrates an alternative.

Per the ACT's section 50 stop rule:

> If product semantics cannot distinguish:
>   wait for result
> from:
>   fire-and-forget
> STOP

The product semantics in ClineMM's run_commands path genuinely
cannot distinguish these two cases at the runtime level. STOP.

The bounded observation under this ACT is:

```
CURRENT_TURN_ENDED                     = PROVEN
TERMINAL_TO_AGENT_REENTRY_SEAM_EXISTS  = ABSENT (structural)
BTCONT_TURN_STATE_CONTINUATION         = PASS
WAIT_UNTIL_FINISHED_PRODUCT_CONTRACT   = UNRESOLVED
```

## Final verdict (CORRECTION CYCLE 2)

HALT_PRODUCT_CONTRACT_REQUIRED.

The bounded observation is that the current agent turn genuinely
ended (the model emitted `done`) and the runtime correctly
honored it by committing awaiting_followup. The current
implementation structurally has no terminal->AgentRuntime
consumer. Whether this structural choice matches the user's
"wait until it finishes" intent is a product-surface decision
that requires product input and is out of scope for this ACT.

The success ACT is:
`ACT-CLINEMM-BACKGROUND-COMMAND-WAIT-SEMANTICS01`

Its purpose is to choose between:

(a) model polling only (current canonical contract; rely on F4)
(b) explicit per-command notify-on-terminal (match upstream
    `background-terminal` example plugin's `notifyParent` default)
(c) some other bounded async-continuation semantic

Only after that decision should any runtime implementation ACT
exist.

Per the ACT's stop rule (section 50): STOP, with
HALT_PRODUCT_CONTRACT_REQUIRED.

HALT_REPAIR_EXCEEDS_PROVEN_CAUSE.
