# S2 — the queued BCB continuation, the `resumable` phase, and the Resume affordance

## The review's S2 requirement (verbatim)

> Resolve S2: the real queued BCB continuation reaches the model-run dispatch
> seam while the phase remains `resumable`. Establish whether control-only
> model execution is intentionally non-active from the user's perspective. If
> so, prove the Resume affordance cannot cause unsafe concurrent dispatch.
> Otherwise, correct the phase transition and preserve terminal BCB
> convergence.

## The establishment: control-only execution IS intentionally non-active

The BCB continuation is HOST-OWNED CONTROL TRAFFIC, not user-visible work.
Two independent production facts establish it.

### 1. The continuation prompt never reaches the model as a user turn

`SdkController.buildSdkControllerEnqueueCompletionContinuation`
(`apps/vscode/src/sdk/SdkController.ts:846`) stamps the structural authority
discriminator on the send:

```ts
await active.sdkHost.send({
    sessionId,
    prompt,
    delivery: "queue",
    runtimeControlKind: "completion_continuation_control",
})
```

The runtime (`sdk/packages/core/src/runtime/host/local-runtime-host.ts:2462`)
converts that into a BRAND-GATED envelope:

```ts
const messageMetadata: Record<string, unknown> = {
    runtimeAuthority: "host_runtime_control",
    kind: runtimeControlKind,
    userRunSpan: 0,
}
const envelope: AgentMessage = { id: ..., role: "user", content: [...], metadata: messageMetadata }
markHostRuntimeControl(envelope)
```

The orchestrator
(`sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:1014`)
promotes the branded envelope onto the model's PRIVILEGED `instructions`
channel — it is NEVER a visible user turn, and it never appears in the
user's transcript.

### 2. `resumable` is the EXISTING non-running affordance, already wired

The BCB-hold `resumable` is not a new phase invented for this defect. It is
the established production affordance for "the run produced no terminal
response, so the honest next action is Resume":

| writer | site | meaning |
| --- | --- | --- |
| `session-event-bcb-hold-resumable` | `sdk-session-event-coordinator.ts:4087` | completion HELD |
| `session-event-turn-complete-containment-failed-resumable` | `sdk-session-event-coordinator.ts:1287` | containment failed |
| `controller-cancel-task` | `SdkController.ts:4310` | user cancelled |

The webview already renders it (`webview-ui/src/components/chat/chat-view/shared/buttonConfig.ts:426`):

```ts
case "resumable":
    return BUTTON_CONFIGS.resume_task   // "Resume Task", primaryAction: "proceed"
```

**CONCLUSION.** Keeping the committed phase `resumable` while the host-owned
## The concurrency proof

### The mutual-exclusion chain (all REAL production code)

1. **The user's Resume is NOT a direct dispatch.** The `resumable` phase
   renders "Resume Task" -> `primaryAction: "proceed"` ->
   `TaskServiceClient.askResponse({ responseType: "yesButtonClicked" })` ->
   `Controller.task.handleWebviewAskResponse` -> `TaskProxy` ->
   `SdkController.askResponse` -> `SdkFollowupCoordinator.askResponse`
   (`apps/vscode/src/sdk/sdk-followup-coordinator.ts:93`).

   There, the session IS running (the BCB continuation's
   `pending_prompt_submitted` set `sessions.setRunning(true)` at
   `sdk-session-event-coordinator.ts:3346`), so the follow-up takes the
   `queueToActiveSession` branch (`sdk-followup-coordinator.ts:111`):

   ```ts
   if (activeSession && (activeSession.isRunning || submittedDuringActiveTurn)) {
       await this.queueToActiveSession(activeSession, prompt, images, files)
       return
   }
   ```

   `queueToActiveSession` sends with `delivery: "queue"`
   (`sdk-followup-coordinator.ts:171`) — NOT an immediate dispatch.

2. **`LocalRuntimeHost.runTurn` short-circuits a queued delivery.**
   (`sdk/packages/core/src/runtime/host/local-runtime-host.ts:1259`)

   ```ts
   if (delivery === "queue" || delivery === "steer") {
       this.pendingPromptsController.enqueue(input.sessionId, {...})
       return undefined
   }
   ```

   Nothing runs. The prompt only joins the queue.

3. **`PendingPromptsController.drain()` refuses to dispatch while a run is
   in flight.** (`sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:530`)

   ```ts
   if (session.aborting || session.drainingPendingPrompts) return
   if (!session.agent.canStartRun()) return
   ```

   and `SessionRuntimeOrchestrator.canStartRun()` is the runtime's OWN
   in-flight predicate (`sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:577`):

   ```ts
   canStartRun(): boolean {
       return !this.running && !this.shutdownCalled
   }
   ```

4. **The queue is a SERIAL pipeline, not a fan-out.** `drain()` shifts one
   entry at a time under the `drainingPendingPrompts` latch and re-drains
   from `finally` (`pending-prompt-service.ts:648`). In production
   `deps.send` IS `runTurn`
   (`local-runtime-host.ts:460`: `send: (input) => this.runTurn(input)`),
   and `runTurn` awaits the whole agent run — so the latch is held for the
   duration of the model run.

### The witnesses

| witness | what it proves | load-bearing? |
| --- | --- | --- |
| `B2PO01-S2c` | the concurrency OUTCOME through the REAL `PendingPromptsController` in the production shape (the dispatch seam is held for the run's duration): the Resume is QUEUED, never dispatched concurrently, and drains SERIALLY after the control run ends | yes (the production latch+gate shape) |
| `B2PO01-S2d` | the SECOND, INDEPENDENT line of defence in isolation: with the drain latch RELEASED and only the runtime's `canStartRun()` gate standing between the queued Resume and a dispatch, the gate refuses | **yes — RED when `canStartRun()` is disabled** |

The S2d ablation was run and is recorded: with
`canStartRun: () => true` substituted for the runtime predicate, S2d fails
with

```
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
```

and with the production predicate restored it is GREEN. The S2c/S2d
witnesses therefore rest on the REAL runtime gate, not on a synthetic
stand-in.

### The phase transition is NOT changed

The BCB-hold `resumable` and the terminal BCB convergence are untouched by
this establishment. The B2 guard still suppresses the `streaming`
re-assertion for the host-owned continuation, the barrier's own release
path (`reevaluateDeferredCompletionBarrier`) remains the ONLY writer of a
terminal phase for the held obligation, and the Elm completion authority is
never consulted on the hold path.

## S2 VERDICT

**PASS — control-only execution is intentionally non-active, and the Resume
affordance provably cannot cause unsafe concurrent dispatch.**

control continuation executes is INTENTIONAL non-active presentation. The
user is not shown a "Working" spinner for traffic they did not request and
cannot influence.

**Therefore the review's conditional resolves to the PROVE branch:** the
Resume affordance must be proven unable to cause unsafe concurrent dispatch.
