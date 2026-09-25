# ACT-CLINEMM-BACKGROUND-COMMAND-COMPLETION-OWNERSHIP-CORRELATION01 — RECON

## Repository trust at ACT entry

```text
HEAD    = 7fefbd011a213c91ec84a6492092d14c6eebbddc
status  = clean (no tracked dirt)
```

Ancestry (last 6 commits, matches the expected lineage):

```text
7fefbd011 ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01/AUTHORIZATION: reviewer C1 GO on successor ACT
cd3392e78 ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01/FINAL: reviewer C1 PASS_WITH_NONBLOCKING_RESIDUE — close cleanly
419bca890 ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01/CORRECTION01: reviewer P1 (BCTPA-P7b over-suppression) + verdict downgrade
1e9efc9e7 ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01: ACT.md evidence packet
89e67318d ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01: bounded presentation arbitration (origin = TERMINAL_WAKE_TURN)
24e7ef263 ACT-CLINEMM-CONTINUATION-CARDINALITY-CORRELATION-LOSS01: relabel closure as COMPOSED proof (corrects overclaim)
```

## Inherited RED (must reproduce before any fix)

From `ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01` (BCTPA-P7b, reviewer P1):

```text
BCTPA-P7b: filter over-suppresses unrelated completion_result
           messages during active notify.

  Given:
    activeNotifyCount > 0 for background job J
    explicit_user turn K emits completion_result
    the completion is NOT the premature ack of J

  Current behavior: completion_result IS suppressed (BROAD)
  Desired behavior: completion_result flows through (NARROW)

  Current filter predicate:
    outstandingAutonomousWork =
      pendingPromptAuthorityUnknown ||
      pendingPromptsKnown > 0 ||
      activeNotifyCount > 0
```


## Bounded current filter (production location)

`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:514-535` (the
`if (result.messages.length > 0) { ... }` block immediately above
`appendAndEmit`):

```ts
if (result.messages.length > 0) {
    const completionMessages: Array<{ say?: string; type?: string; ask?: string }> = []
    for (const m of result.messages) {
        if (m.say === "completion_result") {
            completionMessages.push({ say: m.say, type: m.type })
        }
    }
    if (completionMessages.length > 0) {
        const pendingPromptCountRead: PendingPromptCountRead = this.options.getPendingPromptCount?.(
            activeSession.sessionId,
        ) ?? { available: false }
        const pendingPromptAuthorityUnknown = pendingPromptCountRead.available !== true
        const pendingPromptsKnown = pendingPromptCountRead.available === true ? pendingPromptCountRead.count : 0
        const activeNotifyCount =
            this.options.getActiveNotifyCount?.(activeSession.sessionId, this.options.getTask?.()?.taskId) ?? 0
        const outstandingAutonomousWork =
            pendingPromptAuthorityUnknown || pendingPromptsKnown > 0 || activeNotifyCount > 0
        if (outstandingAutonomousWork) {
            result.messages = result.messages.filter((m) => m.say !== "completion_result")
        }
    }
}
```

The predicate is purely AGGREGATE. It cannot distinguish "completion
belongs to active job J" from "completion belongs to unrelated work K
that happens to be running while J is alive".

## Candidate signal table

| candidate signal | producer | consumer | survives to C10? | unique per job? | internal/public | sufficient? | evidence |
|---|---|---|---|---|---|---|---|
| `jobId` (per-job, on the wake prompt) | `BackgroundNotifyCoordinator.registerMarker` (`vscode-run-commands-tool.ts:768`) | `notificationMarkers` Map (keyed by jobId) | YES (the marker map is the source of truth) | YES (key is the jobId) | internal (no serialization, ephemeral, per `apps/vscode/src/sdk/background-notify-coordinator.ts:343`) | Partial — marker IS a per-job handle but completion messages flowing through C10 have NO jobId field today | `background-notify-coordinator.ts:343-398` |
| `toolCallId` (per-agent_event) | `AgentEvent.content_start.toolCallId` | `MessageTranslatorState.streamingToolTs` (timestamp only; not toolCallId) | Partial — present in the agent_event stream, NOT on the translated completion_result message | YES (the runtime mints unique toolCallIds per tool call) | internal (in-memory stream; not on wire) | No — the run_commands toolCallId and the attempt_completion toolCallId are DIFFERENT ids (separate tool calls in the same turn); we would need to MAP from run_commands toolCallId → jobId, which dies at the `vscode-run-commands-tool.ts:768-815` registerMarker call (the toolCallId is never re-exposed to the coordinator) | `vscode-run-commands-tool.ts:755-816` |
| `taskId` | many producers; unique per task lifetime | many consumers | YES | NO (multiple jobs in the same task share it; the frozen CCARD demonstrates multi-job within one taskId) | both (persisted on tasks; also internal across event streams) | No — too coarse for per-job ownership under multi-job scenarios | `background-notify-coordinator.ts:78-83`, `command-job-manager.ts:964-1004` |
| `sessionId` | SDK runtime | everywhere | YES | NO (multiple jobs in the same session share it) | both | No — too coarse | `background-notify-coordinator.ts:77-83` |
| `epoch` | `MessageIdMinter` | turn/state trackers | YES | NO (per turn, not per job) | internal | No — too coarse for per-job ownership under multi-job scenarios | `sdk-session-event-coordinator.ts:634` |
| `message.id` | minter | UI | YES | NO (per message, not per job) | both | No — UUID per message; no stable relation to any job | `message-id-minter.ts` |
| `origin` (`explicit_user` / `pending_prompt_drain`) | C4 lifecycle | C9/C10 | YES (derived from origin) | NO — the origin is the TURN provenance, not the JOB provenance. A turn with origin=explicit_user can host BOTH (a) the run_commands tool that started J and (b) a later unrelated tool call. Origin is turn-scoped, not job-scoped. | internal | No — same origin (`explicit_user`) covers both the premature ack of J AND an unrelated K. See `apps/vscode/src/sdk/continuation-cardinality-authority.ts` and BCTPA01 test §623-775 for the BCTPA-P7 vs BCTPA-P7b shape that fails this test | `continuation-cardinality-authority.ts`, `sdk-session-event-coordinator.ts:582` |
| Notification marker (`BackgroundNotifyCoordinator.notificationMarkers`) | `registerMarker({jobId, sessionId, taskId})` at `vscode-run-commands-tool.ts:768-772`; consumed by `consumeTerminal` | the same coordinator; `activeNotifyCountForOwner(sessionId, taskId)` | YES | YES (keyed by jobId; one marker per job) | internal (ephemeral, process-only, NOT serialized) | **SUFFICIENT for the lookup half** — the marker map is already an exact per-job identity table. The gap is the OTHER half: knowing which `jobId` THIS completion belongs to. | `background-notify-coordinator.ts:343-398`, `apps/vscode/src/sdk/background-notify-coordinator.ts:372-387` |
| Translator state (`MessageTranslatorState`) | `setAttemptCompletionSeen`, `setTerminalResponseCommittedThisTurn`, `spawnAgentEntries`, `streamingToolTs`, etc. | `wasAttemptCompletionSeen`, `wasTerminalResponseCommittedThisTurn` | YES (the state lives in-process for the duration of the turn) | NO (per-turn, not per-job) | internal | **PARTIAL — the right structural seam, but does not yet carry jobId**. The translator already tracks `streamingToolName` / `streamingToolTs` / `spawnAgentEntries` (a Map keyed by toolCallId for parallel spawn_agent calls). Adding a parallel `launchedBackgroundJobIds: Set<string>` populated by the same code path that triggers `registerMarker` follows the existing internal-only pattern. | `apps/vscode/src/sdk/message-translator.ts:130-340` and `message-translator.ts:420-450` (the `spawnAgentEntries` Map precedent) |
| `CommandJob.ownerSessionId` (internal field on CommandJob) | `CommandJobManager.start({...ownerSessionId})` at construction time | `hasRunningBackgroundJobForOwner(sessionId)` | YES | NO (per session, not per turn — and only tracks RUNNING state, not the wake-promise-pending window) | internal (NOT in `CommandJobSnapshot` per the contract at `command-job-manager.ts:964-1004`) | **NO** — `ownerSessionId` is a session-level slot. Under multi-job concurrency it answers "does THIS owner have ANY running job" (yes/no aggregate) but NOT "does this turn's completion belong to job J specifically". Also: it answers RUNNING state, not "wake is in flight for J" — different lifetime windows. | `command-job-manager.ts:964-1004`, `vscode-session-host.ts:692-712` |

## Existing exact-marker lookup shape (key finding)

`apps/vscode/src/sdk/background-notify-coordinator.ts:343` declares:

```ts
private readonly notificationMarkers = new Map<string, NotificationMarker>()
```

The Map is **keyed by `jobId`**. Adding an exact-lookup method
`hasActiveNotify(jobId): boolean` is a trivial
`return this.notificationMarkers.has(jobId)` — no new state, no new
protocol, no persistence, no public wire impact. The coordinator is
already process-ephemeral and internal-only. This is the right
replacement for the over-broad `activeNotifyCount > 0` aggregate.

## Required closure (the gap)

The C10 filter at `sdk-session-event-coordinator.ts:514-535` currently
has:

  - AGGREGATE "any autonomous work exists" predicate (3 inputs OR'd)
  - NO notion of "which job does this completion belong to"

To narrow to the desired invariant

```text
suppress(C) IFF owner(C) == J AND outstanding(J) == true
```

we need TWO halves:

  1. **Per-job ownership of the current completion message.**
     Who owns C? In production today: nobody — there is no field that
     says "this completion belongs to job J". The translator knows
     about the `attempt_completion` toolCallId, the `streamingToolName`,
     and the turn outcome flags — but NONE of those carry jobId.

  2. **Per-job liveness lookup.**
     "Is job J still outstanding?" The marker Map at
     `background-notify-coordinator.ts:343` is the canonical exact
     answer (`notificationMarkers.has(jobId)`). The aggregate
     `activeNotifyCountForOwner` is too coarse.

## RECON CONCLUSION

```
EXISTING_SIGNAL_SUFFICIENT = false (the message itself carries no
                              jobId; the marker IS per-job but the
                              coordinator has no path from completion
                              to jobId today)
INTERNAL_HINT_REQUIRED = true (turn-local ownership hint in
                             MessageTranslatorState — same lifetime,
                             same ephemerality, no public exposure)
PUBLIC_PROTOCOL_REQUIRED = false (no new field on the wire; the
                                 ownership hint stays in-process at
                                 the extension-host)
```

Half (2) needs NO new state — the exact lookup already exists in the
underlying Map; only the API surface is missing.

Half (1) needs an internal hint. The smallest seam that does not leak
to the public protocol is a `Set<string>` on `MessageTranslatorState`,
populated at the SAME seam where the production code already calls
`BackgroundNotifyCoordinator.registerMarker({jobId, ...})` —
i.e., the `run_commands(notifyOnCompletion=true)` backgrounded
handoff at `vscode-run-commands-tool.ts:755-816`.

The `spawnAgentEntries` Map on `MessageTranslatorState`
(`message-translator.ts:420-450`) is the structural precedent: it is
a per-turn, internal-only, ephemeral Map keyed by toolCallId. Adding
`launchedBackgroundJobIds: Set<string>` follows the exact same shape.

## Existing-turn-job-mapping recon (Candidate B)

The translator's streaming tool state tracks `streamingToolTs`,
`streamingToolName`, `streamingToolInput` (the latter two populated
from `content_start`, the former exposed for `content_end` to reuse
the partial row) — but NONE of these hold the `toolCallId` of the
tool that emitted them. (`message-translator.ts:130-160`)

The `spawnAgentEntries` Map (`message-translator.ts:420-450`) is the
only per-turn keyed collection today and it is keyed by `toolCallId`
— which the translator DOES capture for spawn_agent via
`addSpawnAgent(toolCallId, prompt)`. The existing pattern proves the
translator CAN retain per-call identity; we just need to populate it
for `run_commands(notify=true)` at the same seam.

## Causal classification (per ACT §8)

```
OWNERSHIP_CORRELATION_CLASS = B. TOOLCALL_JOB_MAPPING_NOT_THREADED
```

Justification:

  - The jobId is minted in `CommandJobManager.start(...)` at
    `apps/vscode/src/sdk/vscode-run-commands-tool.ts:742-822`.
  - The marker is registered at `vscode-run-commands-tool.ts:768-772`.
  - The `MessageTranslatorState` does NOT see this jobId — the
    run_commands `content_start` event carries the toolCallId but the
    tool RESULT (which contains `status: "running", jobId`) is
    consumed by the tool handler and not threaded into the translator
    state.
  - By the time `attempt_completion` is translated for the same turn,
    the jobId is in the BackgroundNotifyCoordinator Map but the
    coordinator has no path from "this completion_result message" back
    to the jobId.
  - The marker map IS a per-job identity table; it just lacks an exact
    `hasActiveNotify(jobId)` API (only the aggregate
    `activeNotifyCountForOwner` exists).

## Causal discriminator for the fix

The bounded repair is the SMALLEST POSSIBLE DIFF that closes the
inherited RED:

  1. Add `hasActiveNotify(jobId): boolean` to
     `BackgroundNotifyCoordinator` — exact lookup against the existing
     `notificationMarkers` Map. (No new state, no protocol change.)

  2. Add a per-turn `launchedBackgroundJobIds: Set<string>` to
     `MessageTranslatorState`. (Internal-only; cleared at turn end
     per the same lifetime as the other per-turn fields.)

  3. Populate that Set at the SAME seam where the production code
     already calls `BackgroundNotifyCoordinator.registerMarker` —
     `vscode-run-commands-tool.ts:755-816` — by also writing to
     `MessageTranslatorState.recordLaunchedBackgroundJob(jobId)` (or
     equivalent).

  4. Change the C10 filter at `sdk-session-event-coordinator.ts:514-535`
     from:

     ```ts
     if (outstandingAutonomousWork) {
         result.messages = result.messages.filter((m) => m.say !== "completion_result")
     }
     ```

     to:

     ```ts
     const completionMessagesFiltered: ClineMessage[] = []
     for (const m of result.messages) {
         if (m.say === "completion_result") {
             const ownedJobIds = this.options.messageTranslatorState.getLaunchedBackgroundJobIds()
             let ownedAndOutstanding = false
             for (const jid of ownedJobIds) {
                 if (this.options.hasActiveNotify?.(jid) === true) {
                     ownedAndOutstanding = true
                     break
                 }
             }
             if (!ownedAndOutstanding) {
                 completionMessagesFiltered.push(m)
             }
             // else: suppress (this completion belongs to an owned job
             // that is still outstanding — the wake_drain turn will own
             // the terminal completion)
         } else {
             completionMessagesFiltered.push(m)
         }
     }
     result.messages = completionMessagesFiltered
     ```

  5. Preserve the fail-closed authority shape: when
     `getLaunchedBackgroundJobIds()` returns an empty set, the filter
     does NOT suppress — that is exactly the desired behavior for
     unrelated completion K (no ownership → no suppression).

The discriminator:

  | scenario | ownedJobIds | hasActiveNotify(any) | filter decision |
  |----------|-------------|----------------------|-----------------|
  | Frozen bug (premature J) | `[J]` | true (marker alive) | SUPPRESS ✓ |
  | Wake completion for J | `[]` (J already consumed) | false (no marker) | VISIBLE ✓ |
  | Unrelated K (P7b RED → GREEN) | `[]` | n/a — never consulted | VISIBLE ✓ |
  | J1/J2 active, completion of J1 | `[J1]` | true (J1 marker alive) | SUPPRESS ✓ |
  | J1/J2 active, completion of completed J1 | `[J1]` | false (J1 marker consumed) | VISIBLE ✓ |
  | No-job completion (R5) | `[]` | n/a | VISIBLE ✓ |

This matches the conservation matrix R1–R13 in §14 of the ACT plan
without reopening any of the closed seams.

## Out-of-scope reaffirmation

This ACT does NOT:
- Reopen delivery-semantics OOM repair
- Reopen jobId correlation repair (CCC01/C4→C8)
- Reopen deriveOrigin precedence
- Reopen wake duplication as the leading hypothesis
- Hide duplicate UI cards
- Add UI dedupe
- Add string/content match
- Add timer/race heuristic
- Add a public protocol field on completion_result
- Persist job ownership across turns

It DOES add:
- ONE exact-lookup method (`hasActiveNotify`) on an already-internal
  coordinator
- ONE ephemeral per-turn Set on an already-internal translator state
- ONE mutation at an already-existing seam (the same call site that
  registers the marker)
- ONE filter narrowing at the already-existing filter site

All four are bounded to the existing internal seams, no wire impact,
no public API impact, no persistence impact.
