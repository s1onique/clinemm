# S4 — the actual cancellation writer / fence semantics

## The review's S4 requirement (verbatim)

> Strengthen S4 with the actual cancellation writer/fence semantics.
> Specifically verify that a BCB-owned `resumable` cannot remain classified
> as BCB-owned after an explicit user cancellation and cause a late
> completion to bypass the cancellation straggler guard.

## The defect this witness is bounded to — CONFIRMED AT THE REAL SEAM

The predecessor's `bcbHoldResumablePublished` coordinator flag was
documented as:

> "set ONLY by the BCB-hold write and cleared by EVERY other phase write, so
> it can never describe a `resumable` this coordinator did not publish."

**THAT DOCUMENTATION IS FALSE IN PRODUCTION.** The flag is a
coordinator-private field, cleared ONLY at the coordinator's OWN
`setTurnPhase` write sites. The production CANCEL path never writes through
the coordinator:

`apps/vscode/src/sdk/SdkController.ts:4293` (`cancelTask`):

```ts
// Fence first: mark resumable before aborting so any straggler events from
// the aborted turn land on the wrong side of the UI mode.
this.turnStateTracker.setWithWriter(
    "resumable",
    undefined,
    this.writerIdentity("controller-cancel-task"),
)
...
await this.taskControl.cancelTask()
```

`SdkTaskControlCoordinator.cancelTask`
(`apps/vscode/src/sdk/sdk-task-control-coordinator.ts:180`) then raises the
fence BEFORE the abort:

```ts
// FENCE FIRST: raise the cancel fence synchronously BEFORE awaiting the abort.
this.options.raiseCancelFence?.()
...
await sdkHost.abort(sessionId)
...
this.options.sessions.setRunning(false)
```

and `raiseCancelFence` bumps the epoch (`SdkController.ts:2384`):

```ts
raiseCancelFence: () => {
    this.messageTranslatorState.clearApprovedToolMessageTs()
    this.messageTranslatorState.getMinter().bumpEpoch()
},
```

So the CANCEL:

- replaces the committed phase with `resumable` (a DIRECT tracker write), and
- raises the epoch fence, and
- sets the runtime not-running,

but it NEVER clears the coordinator's `bcbHoldResumablePublished`. The flag
survives the cancel and now describes a `resumable` the coordinator did NOT
publish — the CANCEL's.

### The consequence: the cancellation straggler guard is DISABLED

`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:3781` (pre-repair):

```ts
if (
    !activeSession.isRunning &&
    this.options.getTurnPhase?.() === "resumable" &&
    !this.bcbHoldResumablePublished
) {
    Logger.debug("[SdkController] turn-complete straggler after cancel; preserving resumable phase")
} else if (this.options.messageTranslatorState.wasErrorSeen()) {
    ...
} else if (this.options.messageTranslatorState.wasAttemptCompletionSeen()) {
    // ... NORMAL COMPLETION PATH — commits `completed`
}
```

With the flag stale-true the guard does NOT suppress, and the late
completion falls into the NORMAL completion path. It then either:

- re-publishes the BCB hold (re-registering a held obligation the user
  already cancelled), or
- once the held obligation drains, **COMMITS `completed` and a C10
  `task_completion_committed`** for a turn the user explicitly cancelled.

### The RED reproduction (real production seam)

The witness `apps/vscode/src/sdk/__tests__/post-terminal-working-cancel-b2po01-s4-cancel-fence.test.ts`
drives the REAL `SdkSessionEventCoordinator`, the REAL `TurnStateTracker`,
the REAL `MessageTranslatorState` / `MessageIdMinter` epoch fence, the REAL
BCB hold path, and the REAL cancellation writer/fence sequence (driven
through the REAL `SdkTaskControlCoordinator`).

Against the UNREPAIRED coordinator it fails:

```
B2PO01-S4a: AssertionError: expected [ { phase: 'resumable', …(1) } ] to have a length of +0 but got 1
B2PO01-S4b: AssertionError: expected [ { phase: 'completed', …(1) } ] to have a length of +0 but got 1
```

S4b is the SEVERE case: the held obligation drains while the cancelled turn
is settling, so the BCB hold no longer re-registers and the late completion
falls all the way through to the IMMEDIATE C10 commit — a **fabricated
`completed`** for a cancelled turn.


## The repair — the classification becomes SELF-CONSISTENT

The root cause is carrying "who published the committed phase" in
coordinator-private state that the cancel path cannot reach. The repair
derives the fact from the AUTHORITATIVE committed state instead.

### 1. The committed writer identity travels WITH the committed phase

`apps/vscode/src/sdk/turn-state-tracker.ts`:

```ts
setWithWriter(phase: TurnPhase, anchorTs: number | undefined, identity: TurnStateWriterIdentity): void {
    this.phase = phase
    this.anchorTs = anchorTs
    this.seq = this.minter.nextSeq()
    // B2PO01: the committed writer identity travels WITH the committed
    // phase. Any writer that replaces the phase (including the production
    // CANCEL path, which writes this tracker directly) replaces the
    // identity in the same mutation, so a consumer can never observe a
    // phase paired with a STALE writer.
    this.writerId = identity.writerId
    ...
}

get currentWriterId(): TurnStateWriterIdentity["writerId"] {
    return this.writerId
}
```

### 2. The straggler guard reads the AUTHORITATIVE fact

`apps/vscode/src/sdk/sdk-session-event-coordinator.ts`:

```ts
const committedWriterId = this.options.getTurnPhaseWriterId?.()
const committedPhaseIsBcbHold =
    committedWriterId === undefined
        ? this.bcbHoldResumablePublished
        : committedWriterId === "session-event-bcb-hold-resumable"
if (
    !activeSession.isRunning &&
    this.options.getTurnPhase?.() === "resumable" &&
    !committedPhaseIsBcbHold
) {
    Logger.debug("[SdkController] turn-complete straggler after cancel; preserving resumable phase")
} else if (...)
```

The private flag remains a NECESSARY conjunct (it records that THIS
coordinator published the BCB hold) but is no longer SUFFICIENT on its own.
When the `getTurnPhaseWriterId` option is absent the coordinator falls back
to the flag alone, so existing harnesses keep their behaviour.

### 3. The option is wired in production

`apps/vscode/src/sdk/SdkController.ts:2611`:

```ts
getTurnPhaseWriterId: () => this.turnStateTracker.currentWriterId,
```

### Why the epoch fence alone was NOT sufficient

The cancel DOES bump the epoch, so the deferred-completion barrier's identity
triple stops matching and `isDeferredCompletionBarrierLiveFor` returns
`false`. That protects the B2 BCB-hold guard — but it does NOT protect the
turn-complete straggler guard, which reads only the committed PHASE and the
(coordinator-private) BCB flag. The two guards are independent; the epoch
fence secures one and not the other.

## The witnesses

| witness | what it proves |
| --- | --- |
| `B2PO01-S4` (in `post-terminal-working-cancel-b2-prompt-origin01.b2po01.test.ts`) | the S4 scenario with the ACTUAL production cancellation sequence — the DIRECT `controller-cancel-task` tracker write, then the epoch fence, then the abort, then not-running — and asserts the committed writer is the CANCEL's and that the late completion writes NO phase at all |
| `B2PO01-S4a` (in `post-terminal-working-cancel-b2po01-s4-cancel-fence.test.ts`) | the same sequence driven through the REAL `SdkTaskControlCoordinator`, asserting the production fence-before-abort ordering (`["fence", "abort"]`) and that the cancellation straggler guard is ACTIVE (the late completion writes NO phase) |
| `B2PO01-S4b` (same file) | the SEVERE shape: the held obligation drains after the cancel, so the late completion would otherwise commit `completed`; asserts NO `completed` and NO C10 |

**Both S4a and S4b are load-bearing**: with the repair reverted, both go RED
(S4a re-publishes the BCB hold; S4b fabricates `completed`).

## S4 VERDICT

**PASS — a BCB-owned `resumable` can no longer remain classified as
BCB-owned after an explicit user cancellation, and a late completion can no
longer bypass the cancellation straggler guard.**
