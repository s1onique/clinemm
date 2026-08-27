# Completion-Protocol Liveness 02 — Phase-0 LIVE Capture 01

> Recon-only. No production change. No test change. No board change.
> Companion to `completion-framing-live-red-discriminator01.md`
> (committed at `ab6e29a2e`). This file documents the **second**
> live occurrence of a final-looking report without a task-level
> `Completed` badge, the discriminator-driven fields captured for
> that occurrence, and the structural classification of this
> capture (most fields are NOT externally observable in the
> current capture environment — see §6).

## 0. Scope

The factory reviewer (`PASS_WITH_ONE_BOUNDED_P1_CORRECTION` on
`ACT-CLINEMM-TASKHEADER-BOARD-STATE-RECONCILIATION01`) authorized
starting `ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01` after
a bounded P1 correction (committed at `e9e9c39c6`). Before that
start, the reviewer identified a **second live occurrence** of a
final-looking report without a task-level `Completed` badge and
overrode the editorial-tool priority in favor of completing
`ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS02` Phase-0 LIVE capture
**right now**, while the specimen still exists.

This file is that Phase-0 LIVE capture.

## 1. The two occurrences

```text
LIVE_OCCURRENCE_1   final-looking report, no task Completed badge
                    captured for the user-facing chat screenshot
                    analyzed in completion-framing-live-red-discriminator01.md
                    (committed at ab6e29a2e). Predicted discriminator
                    field values came from source-grounded inference,
                    not from external observation.

LIVE_OCCURRENCE_2   final-looking report, no task Completed badge
                    observed in the user-facing chat several days
                    after the durable session below was opened.
                    The runtime/session identity that produced
                    this second UI symptom is NOT YET BOUND.

CANDIDATE_SESSION   session 1787562381026_jao7c (durable JSON
                    on disk) was the harness-resident session at
                    the time of capture. Its durable state
                    matches the "session exists, paused mid-
                    execution, no done event" profile below. But
                    NO INDEPENDENT BINDING has been established
                    between this candidate session and the
                    LIVE_OCCURRENCE_2 visible chat symptom.
                    SCREENSHOT_TO_SESSION_BINDING = NOT_PROVEN.

Specimen prompt     "Use `find` to locate TypeScript files in
                    this repository." — captured because it is
                    what the candidate session was processing,
                    NOT because it is proven to be the prompt
                    that produced LIVE_OCCURRENCE_2.
```

The second occurrence makes the "wait for another specimen" condition
in `completion-framing-live-red-discriminator01.md §8` obsolete at
the **UI-symptom level**. The reopen trigger has fired for the
visible chat (a second UI symptom was observed), **but its
runtime/session identity is not yet bound**. The discriminator's
trigger rule additionally requires that the bound specimen exposes
`attemptCompletionSeen` AND `terminalResponseCommittedThisTurn`
AND `turnState.phase` AND `visibleLastMessage.type/subtype`. None of
those four is observable from outside the VSCodium extension host,
independent of the binding question. So the trigger remains
**unsatisfied** on TWO independent grounds:

1. **Specimen not bound.** We have a candidate session, not the
   session that produced LIVE_OCCURRENCE_2.
2. **Discriminator surface missing.** Even if the specimen were
   bound, the four required fields are NOT externally observable
   in the current harness environment (see §6).

The actual capture surface needs an honest accounting on BOTH
grounds. Phase-0 capture must report this faithfully, not invent
field values it did not observe and not assert specimen binding it
did not establish.

## 2. Specimen identity (CAPTURED — external state)

| Field | Value | Source |
|---|---|---|
| `SESSION_ID` | `1787562381026_jao7c` | `~/.cline2/data/sessions/1787562381026_jao7c/1787562381026_jao7c.json` line 3 |
| `TASK_ID` | (same as `SESSION_ID` — there is no separate task id; the VSCodium host owns a single user session at a time) | inferred from session.json shape |
| `PROVIDER` | `openrouter` | session.json line 10 |
| `MODEL` | `anthropic/claude-sonnet-5` | session.json line 11 |
| `VERSION` | `4.1.10` | session.json metadata.sessionHistoryOrigin.version |
| `started_at` | `2026-08-24T09:06:21.029Z` | session.json line 6 |
| `updated_at` (DB) | `2026-08-24T09:07:09.383Z` | sessions.db row |
| `updated_at` (msgs) | `2026-08-24T09:06:26.888Z` | messages.json |
| `SESSION_STATUS` | `"running"` (DB: `status="running"`, `status_lock=5`, `ended_at=NULL`, `exit_code=NULL`) | `~/.cline2/data/db/sessions.db` |
| `SESSION_PROMPT` | `"Use \`find\` to locate TypeScript files in this repository."` | session.json line 17 |
| `CHECKPOINT_LATEST` | `1938905b95c26c91c108fa08db681037f3f99542` (created before user prompt at 1787562381227) | session.json metadata.checkpoint.latest |

The session is **still running** as of capture (started 09:06:21Z,
last DB write 09:07:09Z, no `done` event recorded). This means the
Phase-0 capture is observing a specimen **paused mid-execution**, not
one that has reached a final state.

## 3. Auto-approval / YOLO surface (CAPTURED — global state)

From `~/.cline2/data/globalState.json`:

```json
"autoApprovalSettings": {
    "version": 2,
    "enabled": true,
    "favorites": [],
    "maxRequests": 20,
    "actions": {
        "readFiles": true,
        "readFilesExternally": true,
        "editFiles": true,
        "editFilesExternally": true,
        "executeSafeCommands": true,
        "executeAllCommands": true,
        "useBrowser": false,
        "useMcp": false
    },
    "enableNotifications": false
}
```

| Field | Value | Inferred meaning |
|---|---|---|
| `YOLO_EFFECTIVE` | `true` | `autoApprovalSettings.enabled === true` AND `maxRequests > 0` AND every action that would be needed for a find+grep turn is enabled. Equivalent to YOLO. |
| `autoApprovalSettings.actions.editFiles` | `true` | (Upstream-relevant — see editor-tool approval ACT.) |
| `autoApprovalSettings.actions.editFilesExternally` | `true` | (Same.) |
| `autoApprovalSettings.actions.executeSafeCommands` | `true` | Allows `find` without confirmation. |
| `autoApprovalSettings.actions.executeAllCommands` | `true` | Allows any command without confirmation. |
| Session override | NOT OBSERVED | No per-session override key in globalState.json, no per-session override mechanism in session.json. |

## 4. Tool-execution surface (CAPTURED — model output)

From `~/.cline2/data/sessions/1787562381026_jao7c/1787562381026_jao7c.messages.json`:

| Field | Value |
|---|---|
| `LAST_AGENT_CONTENT_KIND` | `tool_use` (not `text`, not `attempt_completion`) |
| `LAST_TOOL_REQUESTED` | `run_commands` |
| Tool input | `{ commands: ["find . -type f -name '*.ts' -not -path '*/node_modules/*' -not -path '*/out/*' -not -path '*/dist/*' -not -path '*/dist-standalone/*' -not -path '*/generated/*' \| head -100", "find . -type f -name '*.ts' -not -path '*/node_modules/*' -not -path '*/out/*' -not -path '*/dist/*' -not -path '*/dist-standalone/*' -not -path '*/generated/*' \| wc -l"] }` |
| Tool result | NOT YET PERSISTED in the messages file (only 2 messages present: user prompt + assistant thinking+tool_use; the tool execution output and any subsequent completion have not been flushed) |
| Tool approval requested? | NOT OBSERVABLE from outside (the harness server on `localhost:19229` is not running in this capture environment; see §6) |
| `attemptCompletionSeen` (inferred from tool stream) | The model requested `run_commands`, not `attempt_completion` / `submit_and_exit` / any `completesRun=true` tool. If the session reaches `done` *before* the model calls a completion tool, the runtime's session-termination fallback at `sdk/packages/agents/src/agent-runtime.ts:1313-1327` (per the `message-translator.ts:1927-1935` code comment) fires. |

## 5. Completion-policy surface (NOT externally observable — INFERRED FROM PRODUCTION SOURCE)

This is the **single most important field** per the factory
reviewer's discriminator doc, and it is **structurally not externally
observable** in the current capture environment. What we have:

### 5.1 The runtime gate (production source)

`sdk/packages/agents/src/agent-runtime.ts:1201-1209`:

```typescript
private getRequiredCompletionToolNames(): string[] {
    if (this.config.completionPolicy?.requireCompletionTool !== true) {
        return []
    }
    return [...this.tools.values()]
        .filter((tool) => tool.lifecycle?.completesRun === true)
        .map((tool) => tool.name)
        .sort()
}
```

### 5.2 The wiring (production source)

`sdk/packages/core/src/runtime/orchestration/runtime-builder.ts:706-753`:

```typescript
const finalTools = filterAvailableTools(tools, effectiveToolPolicies);
const requiresCompletionTool = finalTools.some(
    (tool) =>
        tool.name === "submit_and_exit" &&
        tool.lifecycle?.completesRun === true,
);
const teamCompletionGuard = normalized.enableAgentTeams
    ? (): string | undefined => { /* ... */ }
    : undefined;
const completionPolicy = requiresCompletionTool
    ? {
        requireCompletionTool: true,
        ...(teamCompletionGuard
            ? { completionGuard: teamCompletionGuard }
            : {}),
    }
    : teamCompletionGuard
        ? { completionGuard: teamCompletionGuard }
        : undefined;
```

### 5.3 Inferred value for this session

- `normalized.enableAgentTeams` = `false` (session.json `"enable_teams": false`)
  → `teamCompletionGuard` = `undefined`.
- `finalTools` for a non-team, single-prompt find task is most likely
  the SDK standard tool set. The `submit_and_exit` tool is the
  canonical "completesRun" tool. If it is present (and
  `lifecycle.completesRun === true`), `requireCompletionTool === true`.
  If it is absent (e.g. the tool registry does not expose it for
  basic shell-only sessions, or it was filtered by `effectiveToolPolicies`),
  `requireCompletionTool === false`.

**Verdict**: `completionPolicy.requireCompletionTool = UNOBSERVED.`
Full stop.

The source code can tell us **how** it is computed
(`runtime-builder.ts:706-753`); it cannot tell us the value for this
live session without the resolved `finalTools` and
`effectiveToolPolicies`. Task complexity (a basic `find` task) does
not establish tool registration — the SDK may expose
`submit_and_exit` alongside `run_commands`, `editor`, `apply_patch`,
etc., independent of what the user prompt looks like. The value must
be observed or derived from the actual runtime configuration, not
inferred from prompt characteristics.

## 6. Capture surface — what is structurally NOT externally observable

In the current harness environment:

| Discriminator field | Observable externally? | If not, why |
|---|---|---|
| `attemptCompletionSeen` | ❌ NO | `MessageTranslatorState` (`apps/vscode/src/sdk/message-translator.ts:341-353`) is an in-process class instance held by `SdkController`. The VSCodium extension host is ESM and minified; `ext.evaluate` cannot reach this class via `globalThis`. The `localhost:19229` harness server (per `apps/vscode/src/dev/debug-harness/server.ts`) is **not running** in this environment — `curl localhost:19229` times out. |
| `terminalResponseCommittedThisTurn` | ❌ NO | Same — same `MessageTranslatorState` instance. Set at `message-translator.ts:374-378` (the completion tool's `content_end` only). |
| `DONE_REASON` | ❌ NO | The `done` event is consumed by the message-translator (`message-translator.ts:1905-1975`); the reason field is part of the in-process event stream. Session.json stores `exit_code` (process-level only). |
| `MODEL_FINISH_REASON` | ❌ NO | Internal to `agent-runtime.ts:1316-1327` (`generateAssistantMessageWithOverflowRecovery` returns `{ message, finishReason }` where `finishReason ∈ {"error", "aborted", "completed", ...}`); not externally serialized. |
| `turnState.phase` | ❌ NO | Held by the `TurnStateTracker` (extension-host ESM internal); serialized into `ExtensionState` only on webview post (`getStateToPostToWebview`). Without a running harness server, `web.evaluate` and `ext.evaluate` are both unreachable. |
| `visibleLastMessage.type` / `say` / `ask` / `partial` / `isAuthoritativelyCompletedResult` | ❌ NO | Same — live ClineMessage stream is held in-process. Persisted messages.json only contains the most-recent flush; the session is `running` so the flush is stale (last entry is the assistant `tool_use`, not a `say:text` or `say:completion_result`). |
| `completionPolicy.requireCompletionTool` | ❌ NO (only inferred) | Stored in-process on the runtime config object; not part of any durable observable. |
| `hostAuthorization.mode` | ❌ NO | Session-level; not in durable storage. |
| Seatbelt effective | ❌ NO | Per-session/per-task runtime state; not in durable storage. |
| Sandbox backend prepared | ❌ NO | Same. |

### What IS observable (restated from §2-§5)

- SESSION_ID, MODEL, PROVIDER, SESSION_PROMPT, SESSION_STATUS, CHECKPOINT_LATEST
- Global `autoApprovalSettings` (YOLO surface)
- Persisted messages.json (only flush-bounded)
- Production source code paths confirming WHERE the runtime state lives

## 7. Partial classification (the best the capture environment allows)

```text
SPECIMEN_TERMINAL_STATE_OBSERVED            = NO (session is "running", no done event)
LAST_MODEL_OUTPUT_KIND                     = tool_use (run_commands)
LAST_TOOL_REQUESTED                        = run_commands
attemptCompletionSeen                      = UNOBSERVED (capture surface missing)
terminalResponseCommittedThisTurn          = UNOBSERVED (capture surface missing)
completionPolicy.requireCompletionTool    = UNOBSERVED
turnState.phase                             = UNOBSERVED
visibleLastMessage.isAuthoritativelyCompletedResult = UNOBSERVED
SCREENSHOT_TO_SESSION_BINDING              = NOT_PROVEN
DONE_REASON                                = NOT YET FIRED
MODEL_FINISH_REASON                        = UNOBSERVED
SESSION_STATUS                             = "running"
```

This is **not a sufficient capture** for the four-way discriminator
in `completion-framing-live-red-discriminator01.md §8`
(`A/B/C/D/E/F`) — on TWO independent grounds:

1. **Specimen not bound** — we captured a candidate session that
   was harness-resident at the time, not the session that produced
   LIVE_OCCURRENCE_2.
2. **Discriminator surface missing** — the four required fields are
   not externally observable (see §6), independent of binding.

Even setting aside the binding question, the evidence on the
candidate session is *consistent* with the predicted `A` (model
never requested completion tool) — the model emitted `run_commands`,
not `submit_and_exit`, and the candidate session has not progressed
to completion — but the discriminator fields that would *prove* `A`
are not observable, and the candidate may not even be the right
specimen.

## 8. What this means for the LIVENESS02 reopen trigger

The discriminator doc §8 listed the reopen-trigger conditions:

> Reopen trigger: live capture of `attemptCompletionSeen` AND at
> least `terminalResponseCommittedThisTurn`, `turnState.phase`, and
> `visibleLastMessage.type/subtype`. Anything less is
> `CAPTURE_INSUFFICIENT` and the ACT must NOT be opened.

By this rule, **LIVENESS02 must NOT be opened on the basis of this
Phase-0 capture alone.** What we have is a *candidate-session*
second occurrence (not bound to LIVE_OCCURRENCE_2) plus an honest
accounting that the live state is **not externally observable** in
the current capture environment. Two independent bottlenecks:

1. **Specimen binding not established.** We don't know which
   session/turn produced the visible chat symptom.
2. **Discriminator surface missing.** Even if the specimen were
   bound, the four required fields are not externally observable.

The factory reviewer's verdict: **HALT_CAPTURE_SPECIMEN_NOT_BOUND**,
followed by Option **B (CAPTURE_SURFACE_RECON)** rather than opening
LIVENESS02 prematurely.

## 9. What is needed to actually open LIVENESS02

To convert this Phase-0 capture into a discriminator-grade capture:

1. **Bring up the debug harness server** (per
   `apps/vscode/src/dev/debug-harness/README.md` and the
   `.clinerules/debug-harness.md` block). `localhost:19229` must be
   listening.
2. **Use `ext.evaluate`** (or a hosted equivalent that can read the
   extension-host ESM state) to read:
   - `MessageTranslatorState.wasAttemptCompletionSeen()`
   - `MessageTranslatorState.wasTerminalResponseCommittedThisTurn()`
   - `MessageTranslatorState.wasErrorSeen()`
   - `turnState.phase` from the live `TurnStateTracker`
   - the last `ClineMessage` from the live `ClineMessage[]` array
3. **OR** add a temporary diagnostic dump at
   `apps/vscode/src/sdk/message-translator.ts` (set
   `MessageTranslatorState` dump-to-disk on every `done` event) and
   observe via the persisted file. This is a **production change**
   and must NOT be done without a closed ACT.
4. **OR** route the discriminator fields through a future
   `claude-code` debug channel that exposes them as
   `--capture-completion-protocol-state=...` style flags.

None of 1-4 is in scope for this Phase-0 file.

## 10. Honest scope-boundary statement

This file is the **maximum honest Phase-0 capture** for the
candidate session `1787562381026_jao7c`. It captures what is
externally observable about that candidate (sessions, prompts, tool
output, auto-approval settings) and explicitly identifies what is
**structurally not externally observable** in the current harness
environment. It does NOT manufacture field values to satisfy the
discriminator; it does NOT classify into A/B/C/D/E because the
classification surface is incomplete.

It also does NOT establish binding between the candidate session
and LIVE_OCCURRENCE_2 (the second UI symptom). The durable session
shown here was the harness-resident session at the time of capture,
but its identity does not prove it produced the visible chat
specimen. `SCREENSHOT_TO_SESSION_BINDING = NOT_PROVEN`.

The factory reviewer's reopen trigger (discriminator §8) requires
`attemptCompletionSeen AND terminalResponseCommittedThisTurn AND
turnState.phase AND visibleLastMessage.type/subtype`. Of those four:

- `attemptCompletionSeen` — UNOBSERVED
- `terminalResponseCommittedThisTurn` — UNOBSERVED
- `turnState.phase` — UNOBSERVED
- `visibleLastMessage.type/subtype` — UNOBSERVED

**All four discriminator-critical fields are UNOBSERVED.**

## 11. Status

- **No production change.**
- **No test change.**
- **No board change.** (`TERMINAL-REPORT-COMPLETION-FRAMING01` and
  `…-CORRECTION01` remain CLOSED v2; completion-protocol liveness
  is correctly assigned to `runtime-task-progression.md` per the
  P1 correction at `e9e9c39c6`.)
- **No ACT opened.** `COMPLETION-PROTOCOL-LIVENESS02` remains
  deferred because Phase-0 capture is `CAPTURE_INSUFFICIENT`.
- **Committed as durable evidence** — this file preserves what is
  and is not externally observable in the current harness
  environment, so the next person who attempts this capture does not
  have to re-derive the capture-surface gap.
- **Live occurrence 2 is documented at the UI-symptom level ONLY.**
  Runtime/session identity binding is `NOT_PROVEN`. The capture
  here documents the candidate session that was harness-resident
  at the time, not the session that produced LIVE_OCCURRENCE_2.

## 12. Next step options (factory decision)

The factory reviewer's verdict is **HALT_CAPTURE_SPECIMEN_NOT_BOUND
→ Option B (CAPTURE_SURFACE_RECON)**:

```text
A. ACKNOWLEDGE_CAPTURE_INSUFFICIENT
   Defer LIVENESS02 indefinitely until the harness server is brought
   up. Return to ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01.
   NOT PREFERRED (low-value next occurrence).

B. AUTHORIZE_CAPTURE_SURFACE_RECON  ← REVIEWER'S CHOICE
   Open ACT-CLINEMM-COMPLETION-PROTOCOL-CAPTURE-SURFACE-RECON01
   with contract:
       PRODUCTION_SEMANTICS_DELTA = 0
       DEFAULT_OFF                = required
       PUBLIC_API_DELTA           = 0
       WIRE_PROTOCOL_DELTA        = 0 unless separately authorized
   Evidence hierarchy:
       existing debug harness (preferred)
       dev-only diagnostic adapter
       temporary DEFAULT_OFF instrumentation
       never permanent application telemetry
   Required observable tuple (minimum viable):
       sessionId, turnState.phase,
       attemptCompletionSeen, terminalResponseCommittedThisTurn,
       lastVisibleMessage.{type,say/ask,partial,isAuthoritativelyCompletedResult},
       completionPolicy.requireCompletionTool
   Nice-to-have (don't block on):
       doneReason, modelFinishReason, lastToolRequested
   LIVENESS02 still does NOT open on this ACT's evidence.

C. AUTHORIZE_PRODUCTION_DIAGNOSTIC_PATCH
   Only if Option B proves the existing/dev-only surfaces are
   insufficient. Premature at this point.

D. OPEN_LIVENESS02_PREEMPTIVELY (NOT AN OPTION)
   Would violate §8's CAPTURE_INSUFFICIENT gate.
```

**Why B over A**: Option A means waiting for another occurrence
while knowing that, when it happens, we still cannot observe the
decisive state — poor learning economics. A third occurrence
without fixing observability will teach us little more.

**Why not C yet**: The existing debug harness server at
`apps/vscode/src/dev/debug-harness/server.ts` was discovered but is
not running. Recon should answer whether that harness can be made
operational *without production semantic delta* before any
production patch is considered.

## 13. Committed as durable negative knowledge

This file is intentionally committed even though it does not open a
new ACT or produce a new RED. It records:

1. A second UI symptom was observed at the chat level (so the
   reopen-trigger firing is real, not theoretical), **but its
   runtime/session identity is not bound**
   (`SCREENSHOT_TO_SESSION_BINDING = NOT_PROVEN`).
2. The complete capture matrix and what each field resolves to in
   this environment (so the next capture does not have to re-derive
   it).
3. The structural gap between the discriminator's required fields
   and the externally observable surface (so the factory can decide
   whether to invest in capture-surface work).
4. The classification discipline applied
   (`CAPTURE_INSUFFICIENT` when surface is missing or specimen is
   not bound; not invented field values; not asserted specimen
   binding).
5. The corrected posture: HALT_CAPTURE_SPECIMEN_NOT_BOUND, then
   Option B (CAPTURE_SURFACE_RECON).

Without (1)-(5) the next attempt at this capture would be at risk of
either silently manufacturing field values (false-pass), asserting
specimen binding without proof (false-pass), or re-deriving the
surface gap (wasted effort).
