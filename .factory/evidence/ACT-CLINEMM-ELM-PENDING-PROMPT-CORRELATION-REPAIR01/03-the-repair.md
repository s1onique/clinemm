# 03 — The production repair

## 03.1 Why the repair is at the LIFECYCLE chokepoint

The canonical runtime-event subscription is POINT_IN_TIME. It is attached to the
`SessionRuntime` that is live at attach time. Any production path that REPLACES the
`SessionRuntime` invalidates it.

Before this ACT, the rebind existed on exactly ONE path:

```
SdkFollowupCoordinator.resumeSessionFromTask
  -> onCanonicalRuntimeRebind(startResult.sessionId)
    -> SdkController.attachCanonicalRuntimeEventSubscription(sessionId)
```

But FIVE other production paths replace the `SessionRuntime` and had NO rebind. All
five funnel through `SdkSessionLifecycle.replaceActiveSession`:

| Caller | File | Trigger |
| --- | --- | --- |
| `SdkModeCoordinator` | `sdk-mode-coordinator.ts:301` | plan/act mode switch |
| `SdkSessionConfigChangeCoordinator` | `sdk-session-config-change-coordinator.ts:142` | MCP / config change |
| `SdkSessionAutoApprovalCoordinator` | `sdk-session-auto-approval-coordinator.ts:152` | auto-approval change |
| `SdkTerminalExecutionModeCoordinator` | `sdk-terminal-execution-mode-coordinator.ts:112` | terminal execution mode change |
| `SdkProviderChangeCoordinator` | `sdk-provider-change-coordinator.ts:132,257` | provider change |

`replaceActiveSession` -> `startNewSession` -> host `startSession` ->
`this.sessions.set(sessionId, active)` — a NEW `SessionRuntime` under the (often
IDENTICAL) session id. The previously attached listener keeps observing the disposed
runtime.

**This matches the incident shape exactly.** The incident bundle shows ONE
`run_turn_started` for FIVE `agent_turn_done` records in ONE session, and all five
`agent_turn_done` records carry the SAME `run_rCw8nsup` (because
`recordAgentTurnDone` reads the RETAINED runId map, which is only ever written by the
`run-started` handler). One `run-started` observed, five turns executed.

## 03.2 The repair (smallest sufficient)

### `apps/vscode/src/sdk/sdk-session-lifecycle.ts`

```ts
/**
 * ACT-CLINEMM-ELM-PENDING-PROMPT-CORRELATION-REPAIR01 / CPR01:
 * canonical runtime-event subscription REBIND hook.
 * ... (full rationale in the source)
 */
onCanonicalRuntimeRebind?: (sessionId: string) => void
```

and, in `replaceActiveSession`, immediately AFTER the replacement session is installed:

```ts
const { startResult, sdkHost } = result
this.setRunning(false)

// ACT-CLINEMM-ELM-PENDING-PROMPT-CORRELATION-REPAIR01 / CPR01:
// REBIND the canonical runtime-event subscription to the
// replacement session.
// ...
this.options.onCanonicalRuntimeRebind?.(startResult.sessionId)

return { oldSessionId, startResult, sdkHost }
```

### `apps/vscode/src/sdk/SdkController.ts`

```ts
onCanonicalRuntimeRebind: (replacedSessionId: string) => {
    const activeSessionId = this.sessions?.getActiveSession()?.sessionId
    if (activeSessionId && activeSessionId === replacedSessionId) {
        this.attachCanonicalRuntimeEventSubscription(activeSessionId)
    }
},
```

## 03.3 Why this shape

- **OPTIONAL hook.** A host that does not wire it keeps the legacy behavior. The
  lifecycle never depends on the shadow / authority wiring existing.
- **The identity fence is the SAME one the follow-up-resume rebind uses.** Re-attach
  only if the replaced session is STILL the active one at call time. A concurrent
  user intent that took over the active slot owns the subscription; attaching there
  would steal its listener pool.
- **One chokepoint, not five patches.** Fixing `replaceActiveSession` covers every
  current and future caller of it.
- **No overlap with the follow-up-resume rebind.** That path does NOT go through
  `replaceActiveSession`, so the two rebinds never double-fire.
- **Observation-only.** The canonical event stream feeds the shadow comparator and the
  diagnostic capture ring. It changes no run-whether / run-completion / continuation /
  queueing / presentation / MCP / myc decision.

## 03.4 CPR01-05 — the repair at the production seam

The REAL `SdkSessionLifecycle.replaceActiveSession` is exercised directly:

| Test | Assertion |
| --- | --- |
| `CPR01-05-RED` | without the hook, the replacement SUCCEEDS and the subscriber is NEVER told — the incident |
| `CPR01-05-GREEN` | with the hook, the subscriber is notified EXACTLY ONCE, with the replacement's session id |
| `CPR01-05-REFUSED` | a refused replacement (running session) does NOT fire the rebind — the subscriber is untouched |

`CPR01-05-RED` is a genuine RED against the PRE-repair production shape. It is
retained as the executable RED witness of the defect.
