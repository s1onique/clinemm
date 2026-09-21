# Product Contract — AGCONT01

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

This is unambiguously **Contract A** for the model's polling
behavior:

- The model is told the right pattern: background + tmp log + poll.
- The runtime has no synchronous wait primitive exposed to the model.
- The schema has no `await_completion` / `wait_until_done` flag.
- The "Proceed While Running" feature
  (`apps/vscode/src/core/controller/task/proceedWhileRunningCommand.ts`)
  is a USER UX affordance for detaching a running foreground
  command so the user can keep using their terminal. It is NOT
  a runtime promise to re-invoke the model.

The runtime's contract at the moment of terminality is:

```
process exits naturally
-> CommandJobManager publishes terminal lifecycle
-> SdkController.updateBackgroundCommandState(false, undefined)
   (cards projection: TaskHeader, Cancel button)
-> SdkSessionEventCoordinator.reevaluateDeferredContinuation()
   (turn-state projection: awaiting_followup)
-> no agent re-entry, by design
-> user can interact
```

This is a hybrid: the runtime commits to **projection** updates
(TaskHeader, Cancel button, awaiting_followup phase) but NOT to
**agent continuation**. Contract C is the closest match for
runtime behavior, with Contract A as the model's required
behavior.

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

## Verdict on contract

```
PRODUCT CONTRACT = HYBRID
  A (model-driven polling)  - REQUIRED for the model
  C (user-return after detach) - WHAT THE RUNTIME PROVIDES
  B (automatic agent re-entry) - NOT IN SCOPE for run_commands
```

There is no production doctrine for Contract B. Adding it would
be a NEW FEATURE, not a repair.

## Decision

HALT_PRODUCT_CONTRACT_REQUIRED... NO.

Per the ACT's section 50 stop rule:

> If product semantics cannot distinguish:
>   wait for result
> from:
>   fire-and-forget
> STOP

But the production doctrine DOES distinguish them, in a sense:
"wait for result" is a model-behavior contract (Contract A);
"fire-and-forget" is the natural fallback if the model doesn't
poll. The runtime does not promise automatic re-entry for either
case.

The defect is a model-docible behavior gap, not a runtime gap.
The fix is prompt-engineering (or model-side training), not
runtime repair.

The ACT's section 9 also says:

> If no current source/doctrine establishes it:
>   HALT_PRODUCT_CONTRACT_REQUIRED

But doctrine DOES exist; it just points to Contract A for the
model and Contract C for the runtime. The combination is the
correct answer.

Therefore the ACT's appropriate response is to:

1. Document the doctrine (already in code).
2. NOT add an automatic re-entry mechanism (it would resurrect
   the agent for the "start and return" case, violating C2).
3. Note the model-behavior gap as a future prompt-engineering
   concern (out of scope for this runtime ACT).

## Final verdict

CASE_AC3_AGENT_TURN_GENUINELY_COMPLETE — the agent turn
genuinely ended (the model emitted `done`); the runtime honored
the end-of-turn by committing awaiting_followup. The user's
"wait until it finishes" instruction was an instruction TO THE
MODEL, not a contract with the runtime. The model should not
have yielded until the work was actually complete.

Per the ACT's stop rule (section 50): STOP.

HALT_REPAIR_EXCEEDS_PROVEN_CAUSE.
