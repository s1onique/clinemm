# ACT-CLINEMM-CONTINUATION-CARDINALITY-CORRELATION-LOSS01 / 02-recon

PHASE 2 — RECON THE ACTUAL PRODUCTION PATH

## Status

PASS — first real production boundary at which `wake_created.jobId`
ceases to exist is located.

## Production chain (call graph, frozen in this ACT)

```
BackgroundNotifyCoordinator.consumeTerminal
  -> buildSdkControllerEnqueueTerminalWake
  -> SdkSessionHost.send -> LocalRuntimeHost.runTurn
  -> PendingPromptsController.enqueue
  -> drain -> onBeforeDrain (C5) -> onBeforeDispatch (C6) -> deps.send
  -> re-enters LocalRuntimeHost.runTurn
  -> onRunTurnStarted (C7) -> executeTurn -> onAgentTurnDone (C8)
```

## Boundary table (static type / runtime / capture)

| # | Boundary                              | File:line                                         | Static permits jobId? | Runtime forwards? | Capture exposes?      |
|---|---------------------------------------|---------------------------------------------------|-----------------------|-------------------|-----------------------|
| 1 | consumeTerminal input                 | background-notify-coordinator.ts:388             | YES (jobId: string)   | YES               | n/a                   |
| 2 | wake_created record (held path)       | background-notify-coordinator.ts:484-489         | YES                   | YES (recorded)    | record (not callback) |
| 3 | wake_created record (immediate path)  | background-notify-coordinator.ts:514-517         | YES                   | YES               | record                |
| 4 | **enqueueTerminalWake callback sig**  | background-notify-coordinator.ts:281             | **NO**                | **NO**            | **NO**                |
| 5 | **buildSdkControllerEnqueueTerminalWake destructure** | SdkController.ts:720       | n/a                   | **NO**            | **NO**                |
| 6 | **sdkHost.send call site**            | SdkController.ts:730                              | YES                   | **NO** (omits jobId) | **NO**             |
| 7 | SdkSessionHost.send                    | vscode-session-host.ts:544-556                    | YES (pass-through)    | YES               | n/a                   |
| 8 | LocalRuntimeHost.send -> runTurn       | local-runtime-host.ts                             | YES                   | YES               | n/a                   |
| 9 | runTurn -> resolvedDelivery           | local-runtime-host.ts:1172-1214                   | YES                   | YES               | n/a                   |
|10 | enqueue at queue/steer short-circuit  | local-runtime-host.ts:1205-1212                   | YES                   | YES               | YES                   |
|11 | PendingPromptsController.enqueue      | pending-prompt-service.ts:329-345                 | YES                   | YES               | YES                   |
|12 | onEnqueue payload (C4)                 | pending-prompt-service.ts (NOT EXAMINED)          | YES                   | (TBD by RED)      | YES                   |
|13 | drain -> onBeforeDrain (C5)           | pending-prompt-service.ts:445-452                 | YES                   | YES               | YES                   |
|14 | onBeforeDispatch (C6)                 | pending-prompt-service.ts:467-473                 | YES                   | YES               | YES                   |
|15 | deps.send payload                      | pending-prompt-service.ts:475-504                 | YES                   | YES               | YES                   |
|16 | VscodeSessionHost onBeforeDrain       | vscode-session-host.ts:464-475                   | YES                   | YES               | YES                   |
|17 | VscodeSessionHost onBeforeDispatch    | vscode-session-host.ts:476-489                   | YES                   | YES               | YES                   |
|18 | VscodeSessionHost onEnqueue           | vscode-session-host.ts:455-463                   | YES                   | YES               | YES                   |
|19 | re-entering runTurn at executeTurn    | local-runtime-host.ts:1234-1240                  | YES                   | YES               | n/a                   |
|20 | C7 capture payload                     | local-runtime-host.ts:1227-1233                  | YES                   | YES (when present)| YES                   |
|21 | C8 capture payload                     | local-runtime-host.ts:1248-1255                  | YES                   | YES (when present)| YES                   |

## Where does jobId first cease to exist?

**Boundary #4 (enqueueTerminalWake callback signature) is the FIRST
real production boundary at which wake_created.jobId ceases to exist.**


## Evidence (file paths + line numbers)

### Producer side (jobId IN scope)

```
background-notify-coordinator.ts:388-532
  consumeTerminal({jobId, terminalState, exitCode, reason, ...}) {
    // C2 captured WITH jobId (line 405)
    captureContinuationCardinalityAuthorityRecord({
      stage: "notify_consume_enter",
      origin: "background_terminal",
      jobId: input.jobId,
    })
    // For each held entry (lines 469-489):
    this.options.enqueueTerminalWake({
      sessionId: activeOwner.sessionId,
      prompt: formatTerminalWakePrompt({jobId: h.jobId, ...}),
    })
    // C3 captured WITH jobId (lines 484-489)
    captureContinuationCardinalityAuthorityRecord({
      stage: "wake_created",
      origin: "background_terminal",
      jobId: h.jobId,
    })
    // For immediate entry (lines 497-517):
    this.options.enqueueTerminalWake({...})
    captureContinuationCardinalityAuthorityRecord({
      stage: "wake_created",
      origin: "background_terminal",
      jobId: input.jobId,
    })
```

### Callback contract (TYPE LOSS here)

```
background-notify-coordinator.ts:281
  enqueueTerminalWake: (input: { sessionId: string; prompt: string }) => void
```

The jobId is NOT a parameter.

### Host implementation (CONSUMES the loss)

```
SdkController.ts:707-744
  export function buildSdkControllerEnqueueTerminalWake(options: {...}):
    (input: { sessionId: string; prompt: string }) => void {
    return ({ sessionId, prompt }) => {           // param HAS no jobId
      const active = options.getActiveSession()
      if (!active || active.sessionId !== sessionId) return
      try {
        void active.sdkHost.send({                // OMITTED jobId
          sessionId, prompt, delivery: "queue"
        }).catch(...)
      } catch (error) { options.logger.warn(...) }
    }
  }
```

### Static type at send() call site

```
runtime-host.ts:253-275
  export interface SendSessionInput {
    sessionId: string;
    prompt: string;
    mode?: AgentMode;
    userImages?: string[];
    userFiles?: string[];
    delivery?: "queue" | "steer";
    timeoutMs?: number;
    /** Optional correlation token ... (jobId?: string) */
    jobId?: string;
  }
```

`SendSessionInput` ALREADY permits `jobId?: string`. The host
simply does not supply it.

## Classification per ACT §5

This is a **TYPE LOSS AT THE CALLBACK CONTRACT** combined with
**RUNTIME LOSS AT THE HOST CALL SITE**. Both must be repaired
together to restore correlation.

Specifically:

  CORRELATION_LOSS_CLASS = F. MULTIPLE_LOSS

  (a) Boundary #4 (enqueueTerminalWake callback signature) — type
      does not permit jobId.
  (b) Boundary #5 (buildSdkControllerEnqueueTerminalWake destructure) —
      destructures only the typed input fields.
  (c) Boundary #6 (sdkHost.send call) — does not supply jobId even
      though SendSessionInput permits it.

These three boundaries are the minimal connected chain.

(The producer side #1-#3 and the SDK side #7-#21 are NOT broken —
they all preserve jobId when supplied. The C7/C8 capture hooks
report `origin = explicit_user` because deriveOrigin's jobId
fallback is never reached: with
`delivery === undefined && jobId === undefined`, it returns
"explicit_user".)

## Next: §3 correlation sentinel (RED discriminator)

Now that the first loss boundary is located, the RED sentinel test
(§3, §4) will drive a real production seam end-to-end and assert
that the sentinel is preserved through C4-C8. The expectation (per
the LIVE failure): sentinel will be observed at wake_created but
will be missing at C4-C8, confirming the recon.

Specifically:

- Boundaries #1-#3: jobId is in scope, captured in `wake_created` records.
- Boundary #4: The `enqueueTerminalWake` callback type definition
  (background-notify-coordinator.ts:281) does NOT carry jobId.
  This is a TYPE LOSS.
- Boundary #5: The host destructures only `{sessionId, prompt}`
  (SdkController.ts:720).
- Boundary #6: The host's `sdkHost.send(...)` call
  (SdkController.ts:730) omits `jobId`. SendSessionInput permits it;
  the host simply does not supply it.

Therefore: **all C4-C8 capture records will receive
`input.jobId === undefined`** for terminal-wake-derived runs.
