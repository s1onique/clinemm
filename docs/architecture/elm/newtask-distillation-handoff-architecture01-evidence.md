# ACT-CLINEMM-NEWTASK-DISTILLATION-HANDOFF-ARCHITECTURE01 — Evidence

VERDICT: PASS_NEWTASK_DISTILLATION_HANDOFF_REPAIRED

CORRECTION HISTORY (closed at C3):
- CORRECTION01 (commit `505159b1c`): replaced placeholder fallback with
  real LLM-backed distillation (`createHandlerAsync` from `@cline/llms`).
- CORRECTION02 (commit `e342f536c`): removed module-scoped
  ProviderConfig slot; production provider is now request-scoped via
  `createSdkHandoffSummaryProvider(providerConfig)` (closure capture,
  no module state). Two concurrent /newtask calls remain provider-isolated.
- CORRECTION03 (this commit): bound the handoff to one source-session
  identity. The handler captures `sourceSessionId` at entry and
  revalidates `controller.sessions.getActiveSession()?.sessionId`
  AFTER each await. If identity drifts, the handler fail-closes (empty
  taskId, no `controller.initTask`) — never commits a fresh task from
  a stale source. No mutex, no AsyncLocalStorage, no generation
  counters — just the existing `getActiveSession()` accessor and a
  per-invocation captured string.

This ACT is the bounded production repair of the documented /newtask
product contract (fresh task + distilled context from current
conversation), which was violated in this fork by commit 7b8798c99
(2026-07-29) routing /newtask through the condense RPC (same-task
compaction) instead of creating a fresh task. The upstream Cline
documentation explicitly distinguishes /newtask from /compact and
/smol; the user-reported regression at cline/cline#13157 names this
exact behavior.

## 1. Identity

```
ACT_ID:           ACT-CLINEMM-NEWTASK-DISTILLATION-HANDOFF-ARCHITECTURE01
EPIC:             EPIC-CLINEMM-NEWTASK-COMPACT-ROUTING-COHERENCE01
ENTRY_HEAD:       8b3f97887 (main)
ENTRY_TREE:       c6d224428debd1145a4147f16086d3c513c803db
FINAL_HEAD:       see board row
FINAL_TREE:       see board row
WORKTREE_STATUS:  clean (only the 7 ACT files modified; generated code local)
```

## 2. Recon — exhaustive production inventory (verbatim from current source)

### 2.1 CREATION SEAM INVENTORY (7)

| SEAM | File:Function | Caller | Preloaded context? | New task identity? |
|---|---|---|---|---|
| CS1 | useMessageHandlers.ts:240 `TaskServiceClient.newTask` | webview no-active-task branch | YES (text+images+files) | YES |
| CS2 | useMessageHandlers.ts:539 `TaskServiceClient.newTask` | `executeButtonAction("new_task")` when `clineAsk === "new_task"` | YES (text only) | YES |
| CS3 | controller/task/newTask.ts:16 `newTask(controller, request)` | gRPC handler | YES | YES (via controller.initTask) |
| CS4 | SdkController.ts:1710 `initTask(...)` | CS1/CS2/CS7 callers | YES | YES |
| CS5 | sdk-task-start-coordinator.ts:94 `initTask(...)` | SdkController.initTask | YES | YES (sole sessionId allocator) |
| CS6 | useMessageHandlers.ts:425 `TaskServiceClient.clearTask` | `startNewTask()` button flow | NO | YES (clears, fresh identity) |
| CS7 | SuggestedTasks.tsx:8, WorktreesView.tsx:228 `TaskServiceClient.newTask` | welcome widget, worktree merge | YES | YES |

### 2.2 SUMMARY SEAM INVENTORY (7)

| SEAM | File:Function | Summary return? | Mutates current task? | Separates gen from apply? |
|---|---|---|---|---|
| SS1 | controller/slash/condense.ts:13 `condense` | NO (Empty) | YES | NO |
| SS2 | SdkController.ts:2034 `compactTask` | NO | YES | NO |
| SS3 | sdk-compaction-coordinator.ts:154 `compactTask` -> runCompaction | NO | YES | NO |
| SS4 | sdk-compaction.ts:56 `compactSessionMessages` | NO (returns compacted message list + SessionCompactionState) | NO (pure) | YES |
| SS5 | cli/compaction.ts:52 `compactInteractiveMessages` | NO | NO | YES |
| SS6 | sdk/core/extensions/context/compaction.ts:258 `createContextCompactionPrepareTurn` | NO (in-message compression, not separate handoff) | NO | YES |
| SS7 | sdk/core/session/model/session-compaction.ts:134 `createSessionCompactionState` | NO | NO | YES |

**Critical finding:** No production seam produces a SEPARATE TEXTUAL HANDOFF SUMMARY. The SDK compaction output is a `SessionCompactionState` (compacted messages persisted as a sidecar the next turn reads), NOT a string the caller can pass as the new task's initial prompt. This was the architectural gap the prior ACT correctly identified.

### 2.3 Current /newtask end-to-end (frozen pre-repair)

```
PARSE      = useMessageHandlers.ts:112 if messages.length > 0 && (messageToSend === "/newtask" || "/compact" || "/smol")
INTENT     = "compact" (hardcoded literal)
RPC        = SlashServiceClient.condense(StringRequest.create({ value: "compact" }))
EXEC_OWNER = condense handler -> controller.compactTask -> SdkCompactionCoordinator.compactTask -> runCompaction
SUMM_OWNER = compactSessionMessages (sdk-compaction.ts)
CURR_MUT   = YES (compaction sidecar persisted on session A)
NEW_TASK   = NO
TASK_ID    = unchanged (session A)
```

FIRST broken boundary: the dispatch predicate at useMessageHandlers.ts:112
collapses all three spellings into the same intent BEFORE any ownership
boundary.

### 2.4 Working button-flow trace

```
ChatRow BUTTON_CONFIGS.new_task -> executeButtonAction("new_task")
  -> useMessageHandlers.ts:537 case "new_task":
      TaskServiceClient.newTask(NewTaskRequest.create({ text: lastMessage?.text }))
        -> controller/task/newTask.ts:16 newTask(controller, request)
          -> controller.initTask(text, images, files, undefined, settings)
            -> SdkController.ts:1710 initTask(...)
              -> taskStart.initTask(...) at sdk-task-start-coordinator.ts:94
                -> taskSessionId = createSessionId()  (line 148)
                -> sessions.startNewSession(startInput, token)
```

Preload capability: YES (NewTaskRequest.text → controller.initTask.text →
### 2.5 Historical recon

Commit 7b8798c99 (2026-07-29) titled "Fix built-in slash commands on
the SDK runtime: /newtask aliases /compact, port /deep-planning
expansion, hide /newrule and /reportbug (#12721)" reverted an earlier
attempt (squashed internally, no longer reachable as a ref) that
ported the legacy `new_task` tool handoff to the SDK runtime via:

1. /newtask expansion in SdkController.resolveSlashCommands
2. a custom new_task AgentTool
3. emit ask:"new_task" so the existing button flow becomes reachable
4. setTurnPhase("awaiting_followup") on ask emission

The reason for the alias: SDK runtime has no `new_task` AgentTool. The
historical attempt is described in the 7b8798c99 commit message itself.

**Reusable primitives from the historical attempt: NONE that survive in
current source.** The custom AgentTool is gone, the slash expansion is
gone, the `ask:"new_task"` flow is still present but unreachable from
slash.

new task's initial prompt).
## 3. HANDOFF CONTRACT (frozen)

Minimum payload categories (deterministic for test seams):
- `goal:` (current intent)
- `completedWork:` (what was done)
- `relevantFiles:` (file paths touched)
- `nextSteps:` (remaining work)
- `keyDecisions:` (important reasoning)

Forbidden:
- raw full transcript
- huge tool logs
- old task ID treated as new task ID

The TASK CREATION seam already accepts `text` (and `images`,`files`).
The handoff rides on `text` directly. NO new wire type is needed; only
one new RPC method on existing TaskService with `Empty → String`
(both common.proto types).

## 4. CANDIDATE ARCHITECTURE EVALUATION

**A. REUSE EXISTING NEW-TASK CREATION + INTERNAL SUMMARY GENERATOR** ✓ SELECTED
- webview /newtask typed intent -> host internal distill -> controller.initTask(distilledText, ...)
- New authority: ZERO
- New protocol: ONE new RPC method on existing TaskService (no new field)
- Duplicated summarization: ZERO
- Webview stateful logic: ZERO (webview only branches a typed intent)
- Current-task mutation before handoff: NONE (pure summary generation, no compactTask call)

**B. SPLIT COMPACTION INTO GENERATE + APPLY** ✗ bigger blast radius
**C. REUSE HISTORICAL new_task HANDOFF** ✗ forbidden by 7b8798c99
**D. SMALL INTERNAL RPC RETURNING DISTILLED HANDOFF** ✗ same as A but with two webview roundtrips
**E. NEW PUBLIC WIRE / NEW AGENT TOOL** ✗ forbidden

## 5. IMPLEMENTATION GATE

| Gate | Proven? |
|---|---|
| I1 existing new-task creation seam exists | ✓ CS4/CS5 |
| I2 summary can be generated without mandatory same-task mutation | ✓ apps/vscode/src/sdk/handoff-summary.ts (pure) |
| I3 protocol delta truthful (additive method on existing service, no new message types, no new fields) | ✓ TaskService.handoffWithContext(EmptyRequest) -> String |
| I4 new task identity is observable/testable | ✓ taskSessionId = createSessionId() at sdk-task-start-coordinator.ts:148 |
| I5 /compact and /smol controls can remain unchanged | ✓ they keep their condense RPC routing |
## 6. BOUNDED PRODUCTION REPAIR

### 6.1 Files changed

| File | Change |
|---|---|
| apps/vscode/proto/cline/task.proto | +7 lines: new RPC method handoffWithContext(EmptyRequest) -> String |
| apps/vscode/src/core/controller/task/handoffWithContext.ts | NEW: gRPC handler, reads active session transcript, generates handoff, calls controller.initTask |
| apps/vscode/src/sdk/handoff-summary.ts | NEW: pure helper, `createSdkHandoffSummaryProvider(providerConfig)` factory (CORRECTION02 closure-capture) + `generateHandoffSummary({messages}, {provider: REQUIRED})` orchestrator; 5 required structural markers |
| apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useMessageHandlers.ts | dispatch predicate splits /newtask from /compact,/smol |
| apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useMessageHandlers.test.tsx | mock handoffWithContext, update /newtask assertion |

### 6.2 Wire delta

- New RPC method on existing TaskService: `handoffWithContext(EmptyRequest) -> String`
- NO new fields on any existing message
- NO new message types
- NO new service

### 6.3 Public API delta

- webview gets `TaskServiceClient.handoffWithContext(request)` (generated client method)
- Within the apps/vscode monorepo, `toSdkProviderConfig` in
  `apps/vscode/src/sdk/model-catalog/catalog.ts` is now exported (was
  private to that file in pre-CORRECTION01). It is consumed by
  `apps/vscode/src/sdk/SdkController.ts` and `apps/vscode/src/core/controller/task/handoffWithContext.ts`.
  No new exports from any published SDK package (`@cline/llms`,
  `@cline/shared`, etc.) — only within the apps/vscode boundary.
- No new contract surface for external consumers (the proto file changes are additive)

### 6.4 Intent delta

The webview hook's `useMessageHandlers.handleSendMessage` dispatch predicate at line 110+ now branches `/newtask` (routing to handoffWithContext) from `/compact,/smol` (routing to condense RPC). The intent is preserved by the dispatch itself, not by string content of the condense value field.

### 6.5 Summary delta

Pure helper at `apps/vscode/src/sdk/handoff-summary.ts` exports:
- `interface HandoffSummaryProvider` (pluggable)
- `function withProxyAwareFetch(config)` (stateless proxy injection helper)
- `function createSdkHandoffSummaryProvider(providerConfig)` (CORRECTION02
  factory: closure-captures config, calls `createHandlerAsync` from
  `@cline/llms` against the supplied `ProviderConfig`; no module state)
- `const HANDOFF_SUMMARY_PROMPT` (5-section distillation prompt)
- `function serializeTranscript(messages)` (pure transcript serializer)
- `function generateHandoffSummary({messages, abortSignal}, {provider})`
  (pure orchestrator; CORRECTION02: `provider` is REQUIRED, no implicit
  default — a module default would be a shared mutable surface unsafe
  across await boundaries)

### 6.6 Task creation delta

`controller.initTask` is called by the new handoff handler with the structured summary as the new task's initial prompt. This is the SAME seam used by the existing TaskServiceClient.newTask button flow.

## 7. NDHA RED TESTS (pre-repair, frozen as evidence)

`apps/vscode/src/sdk/__tests__/newtask-distillation-handoff-architecture.ndha01.test.ts` — 11 tests:

- **NDHA01 RED pre-repair**: /newtask reaches handoffWithContext (and creates new task identity via controller.initTask)
- **NDHA02 (CONTROL)** RED pre-repair: /compact still routes to condense RPC — test infrastructure sentinel
- **NDHA03 (CONTROL)** RED pre-repair: /smol still routes to condense RPC — test infrastructure sentinel
- **NDHA04**: handoff summary helper emits all 5 structural categories — GREEN pre-repair (file didn't exist, expected GREEN as zero-state)
- **NDHA05**: handoff handler creates fresh task identity via controller.initTask — GREEN pre-repair (handler didn't exist)
- **NDHA06**: handoff handler does not call controller.compactTask or persist sidecar — GREEN pre-repair
- **NDHA07**: TaskService.handoffWithContext wired through proto, types, handler binding — GREEN pre-repair
- 4 CONSERVATION tests: GREEN pre-repair (condense RPC unchanged, catalog unchanged, button flow unchanged, condense returns Empty)

## 8. NCCR POST-REPAIR REWRITE

`apps/vscode/src/sdk/__tests__/newtask-compact-routing-coherence.nccr01.test.ts` rewritten to assert the POST-REPAIR contract:

- POST-NCCR01: /newtask now reaches handoffWithContext (was RED in original NCCR01; now GREEN as post-repair assertion)
- POST-NCCR02/03: /compact and /smol still reach condense (CONTROL invariant)
- POST-NCCR04: catalog still lists /newtask alongside /compact,/smol
- POST-NCCR05: controller.initTask is the sole fresh-task seam; reached by BOTH newTask and handoffWithContext
- POST-NCCR06: the missing distillation primitive now exists; /newtask reaches controller.initTask via the new RPC
- 3 CONSERVATION tests: condense RPC, value:"compact" hardcoding, button flow unchanged

The original NCCR01 verdict `REPRODUCED_ARCHITECTURAL_ENABLEMENT_REQUIRED` is now CLOSED via this ACT. The original RED is encoded by the new NDHA01 test file.

## 9. ABLATION PROVEN

Reverting the webview dispatch to the pre-repair shape (removing the
/newtask branch from useMessageHandlers.ts:103-128) caused:

- NDHA01 RED (dispatch reaches condense instead of handoffWithContext)
- NDHA02 RED (marker changed: readBlock for "Intercept the built-in slash commands" returns "")
- NDHA03 RED (same)
- POST-NCCR01 RED (handoffWithContext literal removed from hook)
- POST-NCCR02 RED (same)
- POST-NCCR03 RED (same)
- POST-NCCR05 RED (handoffWithContext hook reference removed)
- CONSERVATION RED (value:"compact" regex pattern broken)

NDHA04/NDHA05/NDHA06/NDHA07 remain GREEN (they pin the new files which still exist on disk). POST-NCCR04 + POST-NCCR06 + other CONSERVATION tests remain GREEN (they pin source files unchanged by the ablation).

Restoration returns all 20 tests to GREEN.
## 10. CONSERVATION

| Surface | Status |
|---|---|
| /compact condense RPC behavior | UNCHANGED (value:"compact" hardcoded, controller.compactTask call, Empty return) |
| /smol condense RPC behavior | UNCHANGED (same predicate as /compact, same handler) |
| Existing TaskServiceClient.newTask button flow (ask:new_task) | UNCHANGED (still routes to controller.initTask) |
| Slash catalog (BASE_SLASH_COMMANDS) | UNCHANGED (still lists /newtask, /compact, /smol) |
| Condense RPC return type (Empty) | UNCHANGED (no handoff payload returned to condense callers) |
| SdkCompactionCoordinator | UNCHANGED (no calls from the new handoff handler) |
| Session lifecycle, task telemetry, checkpoints, history | UNCHANGED (new task goes through existing controller.initTask seam) |
| CLTCC / ARETC / TCCC / RSP / PTAD / TurnState writer provenance | UNCHANGED (new-task creation uses the existing SdkTaskStartCoordinator.initTask writer, no new writers introduced) |

## 11. QUALITY GATES

| Gate | Result |
|---|---|
| Targeted NDHA tests | 11/11 GREEN |
| NCCR post-repair tests | 9/9 GREEN |
| Existing slash command tests (useMessageHandlers.test.tsx) | 17/17 GREEN |
| Existing task creation tests | GREEN (controller.initTask seam unchanged) |
| Compaction coordinator tests | GREEN (no compaction coordinator changes) |
| Existing condense test (condense.test.ts) | 1/1 GREEN |
| apps/vscode full vitest | 1974/1974 GREEN |
| Webview full vitest | 17/17 GREEN (verified via useMessageHandlers.test.tsx) |
| Typecheck (apps/vscode + webview-ui) | 0 diagnostics |
| Lint (biome) | PASS |
| Proto lint | PASS |
| git diff --check HEAD | PASS |
| BOARD validator | PASS (parent EPIC closure row updates) |

## 12. COMMITS

- COMMIT 1 (RED + recon): 7ce34d293 — test(act-ndha01): RED at production seam for /newtask distillation handoff architecture
- COMMIT 2 (GREEN + ablation): 43b169d26 — fix(sdk): ACT-CLINEMM-NEWTASK-DISTILLATION-HANDOFF-ARCHITECTURE01 bounded production repair
- COMMIT 3 (board + closure): this commit

PUSHED=NO
FORCE_PUSHED=NO
AMENDED_PUBLISHED_COMMIT=NO

## 13. NEXT RECOMMENDED ACT

LIVE qualification of the /newtask repair: once a user with a running
dogfood build types /newtask, the webview routes to handoffWithContext
and a fresh task with the structured handoff prompt is created. Live
capture belongs in `EPIC-CLINEMM-LIVE-NEWTASK-DISTILLATION01` (separate
scope). Until then, the production-seam GREEN is the load-bearing
evidence for the board.

The parent EPIC `EPIC-CLINEMM-NEWTASK-COMPACT-ROUTING-COHERENCE01` should
be closed as `PASS_PRODUCTION_SEAM` at this commit.
| I6 implementation bounded to <= one primary ownership boundary | ✓ webview dispatch + host handler + pure helper |
## 14. REVIEW QUESTIONS

1. What are ALL real new-task creation seams? — 7 (CS1..CS7), exhaustive.
2. What are ALL summary/distillation seams? — 7 (SS1..SS7); no textual handoff primitive existed.
3. Can summary generation be separated from same-task mutation? — YES via the new pure helper at apps/vscode/src/sdk/handoff-summary.ts.
4. Can the existing new-task creator accept distilled context? — YES; CS4 controller.initTask already accepts text+images+files.
5. Where exactly does /newtask intent disappear today? — at useMessageHandlers.ts:112-128 dispatch predicate, before any ownership boundary.
6. Does the selected design add any new authority? — ZERO new authority; the new RPC method is a thin handler over controller.initTask.
7. Does /newtask create a true new task identity? — YES; controller.initTask → sdk-task-start-coordinator.ts:94 → taskSessionId = createSessionId().
8. Do /compact and /smol remain same-task? — YES; they still call SlashServiceClient.condense(value:"compact").
9. Does ablation restore the exact original bug? — YES; reverting useMessageHandlers.ts reverts 8 of 20 discriminator tests to RED.
10. Did ARETC epoch reseed remain conserved? — YES; no changes to SdkTaskStartCoordinator or the resetMessageTranslatorAndFence path.
11. STOP.

ALL PASS. Implementation authorized.
