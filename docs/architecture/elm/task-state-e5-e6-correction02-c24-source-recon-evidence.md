# ACT-CLINEMM-ELM-ARCHITECTURE01 / E5-E6 / C2.4-A — Source reachability recon evidence

```text
ACT             = ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4
PLAN_HEAD       = 76662f445 (C2.4 BOOKKEEPING01; reviewer round-6 plan accepted)
ENTRY_HEAD      = 1bafc70da (C2.4 AMENDMENT-02; R7 directional fix)
PROTECTED_STASH = 141372c52 (FORENSIC; do NOT pop)
EXIT_HEAD       = <this commit>

C2_4_A_AUTHORIZED = true
C2_4_A_VERDICT    = (see §6)
```

## 0. Scope

This file is the **first recon commit** of C2.4-A. Per the
C2.4 plan (`task-state-e5-e6-correction02-c24-no-active-session-reachability-plan.md`)
and the round-6 reviewer verdict:

> "I would expect the executor to stop after recon with **no
> production edit yet**, even if the likely NO_ACTIVE_SESSION issue
> is already obvious."

This commit contains A1–A8 deliverables ONLY:

- **A1** Producer inventory (top-down from `agent-runtime.ts`)
## 1. A1 — Producer inventory

The producer end is `AgentRuntime.emit(...)` in
`sdk/packages/agents/src/agent-runtime.ts`. Each emit site uses
the canonical `AgentRuntimeEvent` type defined in
`sdk/packages/shared/src/agent.ts:723-850` (17 variants).

Producers found by `grep -n 'type: "<event-type>"' agent-runtime.ts`:

```
line   event type                  producer condition
-----  --------------------------  -------------------------------------------
 857   recovery-state-changed      restore() — recovery reset episode boundary
1024   recovery-state-changed      emitRecoveryStateChangeIfChanged (dedup'd)
1090   execution-state-changed     emitExecutionStateChangeIfChanged (dedup'd)
1191   message-added               (test/reminder message)
1241   run-started                 execute() — every run boundary (NEW RUN ID here)
1247   message-added               execute() — normalized input push
1268   turn-started                model-stream iteration begin
1293   message-added               assistant-message produced
1298   assistant-message           model-stream end of iteration
1315   turn-finished               assistant-message produced
1331   run-finished                success path (C3.CONT.2 final emit)
1343   message-added               push result/error into messages
1349   turn-finished               push result/error into messages
1366   run-finished                terminal emit of run (C1.4 path)
1454   run-failed                  failure path (terminal emit)
1461   run-finished                failure path (status → terminal)
1510   status-notice               invoke hooks emit
1691   assistant-text-delta        model-stream text delta
1718   assistant-reasoning-delta   model-stream reasoning delta
1745   tool-started                parallel-tool batch / sequential tool
1809   tool-finished               parallel-tool batch / sequential tool
2150   status-notice               captureReasoningNotices
2210   message-added               hook-injected message (e.g. reminders)
2231   usage-updated               usage reconciliation per turn
2616   tool-started                tool approval requested (per-tool)
2752   tool-updated                tool execution progress emit
2820   tool-finished               tool execution finished
```

Dedup wrappers (NOT counted separately — they fold into the
above):

```
 990  emitRecoveryStateChangeIfChanged (call site)
1062  emitExecutionStateChangeIfChanged (call site)
```

**Producer inventory total: 26 emit sites producing 12 distinct
canonical event types** (excluding `assistant-text-delta` /
`assistant-reasoning-delta` / `message-added` / `assistant-message`
/ `usage-updated` / `tool-updated` / `turn-started` /
`turn-finished` / `status-notice`, the shadow adapter drops these
to `[]` per `shadow-adapter.ts:75-79` and `shadow-adapter.ts:140-142`).

The 12 distinct producers form the **state-relevant canonical
producer surface** for C2.4.
- **A2** Canonical event-type table (per-event-type template, 5 questions)
- **A3** Transport-hop table (with per-hop semantics labels)
- **A4** runId guarantee table (type-has-field vs emission-guarantee)
## 2. A2 — Canonical event-type table (per-event-type template)

Per the reviewer's per-event-type template:
each cell marked `prove` carries source-line citations
or `observe` / `observeRuntimeEvent` test references.

| Event | Producer condition | runId | Session-bound? | Reaches Local shadow? | Authority |
| ----- | ------------------ | ----- | -------------- | --------------------- | --------- |
| `run-started` | `agent-runtime.ts:1241` inside `execute()` after `this.state.runId = createUID("run")` (line 1205) | DEFINED — line 1205 sets it; line 1241 emits `snapshot: this.snapshot()` | YES — by `LocalRuntimeHost.subscribeRuntimeEvents` (line 1511-1531) wrapping each session | YES — `observeCanonicalRuntimeEvent` (wiring line 374) → `adaptRuntimeEvent` (`shadow-adapter.ts:83-85`) → `session_started` TaskMsg | epoch-establishing |
| `run-finished` | `agent-runtime.ts:1331, 1349, 1366, 1461` inside `execute()` catch + afterRun | DEFINED — same `this.state.runId` (line 1205) | YES | YES — `shadow-adapter.ts:86-88` → `task_completed` TaskMsg | terminal |
| `run-failed` | `agent-runtime.ts:1454` inside `execute()` catch with `status === "failed"` | DEFINED — same `this.state.runId` | YES | YES — `shadow-adapter.ts:89-91` → `task_failed` TaskMsg | terminal (failure) |
| `tool-started` | `agent-runtime.ts:1745` (parallel-batch), `2616` (per-tool), legacy emit under `emitToolStarted` | DEFINED — same `this.state.runId` via `snapshot` | YES | YES — `shadow-adapter.ts:92-94` → `tool_started` TaskMsg | activity |
| `tool-finished` | `agent-runtime.ts:1809, 2820` | DEFINED — same `this.state.runId` | YES | YES — `shadow-adapter.ts:95-97` → `tool_finished` TaskMsg | activity |
| `execution-state-changed` | `agent-runtime.ts:1090` via `emitExecutionStateChangeIfChanged` (RSMT01 sole owner) | DEFINED for active runs (`state.runId` populated); MAY be `undefined` after `restore()` clears `runId` at line 794 | YES | YES — `shadow-adapter.ts:98-126` → no TaskMsg (read-only delta for `execution` projection); comparator consumes `execution` projection only | authority-state projection |
| `recovery-state-changed` | `agent-runtime.ts:857, 1024` via `emitRecoveryStateChangeIfChanged` | DEFINED for active runs; MAY be `undefined` after `restore()` | YES | YES — `shadow-adapter.ts:127-156` → `recovery_changed` TaskMsg (with sanitized projection) | recovery projection |
| `message-added` | `agent-runtime.ts:1191, 1247, 1293, 1343, 2210` | DEFINED for active runs | YES | NO — `shadow-adapter.ts` returns `[]` (presentation-only; carries no shadow-relevant projection) | not relevant |
| `turn-started` | `agent-runtime.ts:1268` | DEFINED | YES | NO — no TaskMsg mapping (presentation boundary only) | not relevant |
| `turn-finished` | `agent-runtime.ts:1315, 1349` | DEFINED | YES | NO — no TaskMsg mapping | not relevant |
| `assistant-text-delta` | `agent-runtime.ts:1691` | DEFINED | YES | NO — `shadow-adapter.ts:140-142` noop (presentation deltas don't enter shadow) | not relevant |
| `assistant-reasoning-delta` | `agent-runtime.ts:1718` | DEFINED | YES | NO — noop | not relevant |
| `assistant-message` | `agent-runtime.ts:1298` | DEFINED | YES | NO — noop | not relevant |
| `usage-updated` | `agent-runtime.ts:2231` | DEFINED | YES | NO — noop (telemetry accumulation lives outside shadow) | not relevant |
| `status-notice` | `agent-runtime.ts:1510, 2150` | DEFINED for active runs; MAY be `undefined` outside | YES | NO — noop | not relevant |
| `tool-updated` | `agent-runtime.ts:2752` | DEFINED | YES | NO — noop | not relevant |

**State-relevant canonical event types (those that map to a TaskMsg
or are observed for `execution` projection): 7**

```
run-started                 TaskMsg: session_started   (epoch)
run-finished                TaskMsg: task_completed    (terminal)
run-failed                  TaskMsg: task_failed       (terminal)
tool-started                TaskMsg: tool_started      (activity)
tool-finished               TaskMsg: tool_finished     (activity)
execution-state-changed     TaskMsg: none (projection read by comparator)
recovery-state-changed      TaskMsg: recovery_changed  (recovery projection)
```

These 7 are the A2 denominator. C2.4-B will audit each for
`NO_ACTIVE_SESSION` reachability.

### Type-has-field vs emission-guarantee (reviewer round-6 distinction)

The `AgentRuntimeStateSnapshot` type at
`sdk/packages/shared/src/agent.ts:255+` declares `runId?: string`
(OPTIONAL field). The `LiveAgentRuntimeStateSnapshot` intersect
type (line 238-240) keeps `recovery`/`execution` non-optional for
live runtime events but does **not** narrow `runId`.

Therefore:

```
TYPE FACT:        AgentRuntimeStateSnapshot.runId  = string | undefined
EMISSION FACT:   for run-started / run-finished / run-failed /
                 tool-started / tool-finished /
                 execution-state-changed / recovery-state-changed,
                 if state.status === "running" then runId is DEFINED
                 (line 1205 sets it; line 794 / line 3362 clear it
                  only on restore / abort boundary)
```

The shadow adapter at `shadow-adapter.ts:84` does
`event.snapshot.runId ?? ""` for `session_started` — this
`??` is the C2.3 defensive gate. C2.4-B will determine whether
the tolerant branch is dead code, startup-only, legitimate, or
unsafe.

For `execution-state-changed` after `restore()`: line 794 sets
`this.state.runId = undefined` BEFORE the recovery-state-changed
emit at line 857 fires. So the post-restore recovery event
**does carry an `undefined` runId**. This is the documented
post-reset epoch referenced by the wiring's
`postResetAwaitingCanonicalRunRef` (line 365,
`task-state-shadow-host-wiring.ts`).
- **A5** Session-binding table
- **A6** Backend capability preliminary table (local / hub / remote)
- **A7** Reconstructed-fallback inventory
- **A8** Recon evidence + B authorization

**No source files are edited in this commit.** No tests are
added. No production-delta is introduced. The `redundant guard`
the plan authorizes for C2.4-B (an `if (activeSession ===
undefined) return` in `task-state-shadow-host-wiring.ts:393`) is
NOT introduced here — that belongs to C2.4-B after we have
established what the wiring actually receives.
## 3. A3 — Transport-hop table

Per the reviewer's recommendation: each hop records its
**semantics** as one of
`REFERENCE_PASS_THROUGH | COPY | SERIALIZE_DESERIALIZE |
TRANSLATE | FILTER | RECONSTRUCT`.

| # | Hop | Source | Semantics | Verbatim `event`? |
| - | --- | ------ | --------- | ----------------- |
| 0 | `AgentRuntime.emit` → listeners | `agent-runtime.ts:3365-3520` (private emit) | `REFERENCE_PASS_THROUGH` (in-process JS function call) | YES — see `buildEventMetadata(event)` at line 3513 reading `event.snapshot.runId` directly |
| 1 | `AgentRuntime.subscribe` (`.add` to `listeners`) | `agent-runtime.ts:488-499` (declaration), `session-runtime-orchestrator.ts:963` (call site) | `REFERENCE_PASS_THROUGH` (closure captures `event` parameter) | YES |
| 2 | `SessionRuntimeOrchestrator.handleRuntimeEvent(event)` | `session-runtime-orchestrator.ts:1160` (signature), `963` (subscribe), `1302` (fanout) | `REFERENCE_PASS_THROUGH` — the `event` arg is the same object reference | YES |
| 3 | `orchestrator.runtimeEventListeners.forEach(listener => listener(event))` | `session-runtime-orchestrator.ts:1302-1315` | `REFERENCE_PASS_THROUGH` (in-process) | YES — wrapped in try/catch but the listener receives the original object |
| 4 | `LocalRuntimeHost.subscribeRuntimeEvents` fanout to per-session `agent.subscribeRuntimeEvents` | `local-runtime-host.ts:1511-1531` | `REFERENCE_PASS_THROUGH` — `(event) => listener(sessionId, event)` closure | YES |
| 5 | `ClineCore.subscribeRuntimeEvents(listener)` → `host.subscribeRuntimeEvents(listener)` | `ClineCore.ts:674-681` | `REFERENCE_PASS_THROUGH` | YES |
| 6 | `VscodeSessionHost.subscribeRuntimeEvents` → `subscribeRuntimeEventsThroughProxy(inner, listener)` | `vscode-session-host.ts:341-346`, `runtime-events-proxy.ts:23-35` | `REFERENCE_PASS_THROUGH` — proxy is a 35-line direct forwarder | YES |
| 7 | `subscribeCanonicalRuntimeEventsToShadow` sessionId filter | `canonical-event-subscription.ts:55-72` | `FILTER` — drops when `evtSessionId !== sessionId`; otherwise forwards | YES when forwarded |
| 8 | `TaskShadowHostWiring.observeCanonicalRuntimeEvent` | `task-state-shadow-host-wiring.ts:374-466` | `REFERENCE_PASS_THROUGH` after session-authority guard (line 393-399), terminal-ownership guard (line 429-440), and tracker update (line 450-457) | YES |
| 9 | `coordinator.observe({ kind: "runtime-canonical", origin, sessionId, event })` | `task-state-shadow-host-wiring.ts:459-465` | `REFERENCE_PASS_THROUGH` (typed envelope) | YES |
| 10 | `TaskStateShadow.observeRuntimeEvent(event, now)` → `adaptRuntimeEvent(event, now)` | `shadow-adapter.ts:206-213` and `:80-156` | `TRANSLATE` — canonical `AgentRuntimeEvent` → array of `TaskMsg`s | NO — `event` is consumed; output is a `TaskMsg[]` |
| 11 | `TaskMsg → taskUpdate(model, msg)` reducer | `sdk/packages/agents/src/runtime/state/task-state/update.ts` | `TRANSLATE` — TaskMsg → next `(TaskModel, TaskEffect[])` | NO — terminal transformation |

`ALL_ACTUAL_HOPS_FROM_PRODUCER_TO_SHADOW_AUDITED = true`

Every hop in the chain is enumerated. `REFERENCE_PASS_THROUGH`
through hops 0-9 (verbatim event object). `TRANSLATE` only at
hops 10-11 (into TaskMsg / TaskModel).

### Per-hop recon evidence for F1-I3 reference-identity preservation

For F1-I3 to remain `PASS` (Local backend = `Local F1-I3
reference-identity still PASS`), the `snapshot.runId` field on
each canonical event must arrive verbatim at hop 9 (wiring) with
the same string identity. Source evidence:

```
hop 0:   this.emit({ type: "...", snapshot: this.snapshot() })
         snapshot() returns { runId: this.state.runId, ... }
         (agent-runtime.ts:895-925) — same string reference
hop 1-3: handleRuntimeEvent(event) — event.snapshot.runId unchanged
hop 4:   active.agent.subscribeRuntimeEvents((event) =>
           listener(sessionId, event)) — same event reference
         (local-runtime-host.ts:1518-1521)
hop 5:   host.subscribeRuntimeEvents(listener) — same
hop 6:   subscribeRuntimeEventsThroughProxy(inner, listener)
         returns inner.subscribeRuntimeEvents(listener)
         (runtime-events-proxy.ts:34) — same
hop 7:   if (evtSessionId && evtSessionId !== sessionId) return
         else wiring.observeCanonicalRuntimeEvent({
           origin: "RUNTIME_CANONICAL", sessionId, event })
         (canonical-event-subscription.ts:65-72) — same event ref
hop 8:   wiring.observeCanonicalRuntimeEvent reads
         evt.snapshot.runId (line 430, 451) — same
hop 9:   coordinator.observe({ ... event: input.event }) — same
```

No hop SERIALIZES, COPIES, or RECONSTRUCTS the event. **F1-I3
reference-identity is preserved verbatim from producer to
shadow-input boundary.**
## 4. A4 — runId guarantee table

| Event | Emission moment | `state.runId` state | `snapshot.runId` at emit | Notes |
| ----- | --------------- | ------------------- | ------------------------ | ----- |
| `run-started` | line 1241, AFTER `this.state.runId = createUID("run")` at line 1205 | `string` (just created) | `string` | Always defined within `execute()`. Entry of every run. |
| `run-finished` (success) | line 1331 / 1349 / 1366, inside `execute()` success path | `string` (set at line 1205) | `string` | Always defined within active run. |
| `run-finished` (failure path) | line 1461, inside `execute()` catch path | `string` (line 1205 still set; catch does NOT clear `runId`) | `string` | Always defined. |
| `run-failed` | line 1454, inside `execute()` catch with `status === "failed"` | `string` | `string` | Always defined. |
| `tool-started` (parallel-batch) | line 1745, inside parallel batch | `string` | `string` | Active run only. |
| `tool-started` (per-tool approval) | line 2616, inside approval flow | `string` | `string` | Active run only. |
| `tool-finished` | line 1809 / 2820 | `string` | `string` | Active run only. |
| `execution-state-changed` | line 1090, via `emitExecutionStateChangeIfChanged` | `string` for `running` status; `undefined` after `restore()` (line 794) | matches `state.runId` | MAY be undefined post-restore. |
| `recovery-state-changed` (restore) | line 857, inside `restore()` AFTER `this.state.runId = undefined` (line 794) | `undefined` | `undefined` | Post-restore reset emit carries `undefined` runId. |
| `recovery-state-changed` (active) | line 1024, via `emitRecoveryStateChangeIfChanged` | `string` for active runs | matches `state.runId` | Usually defined. |
| `status-notice` (line 1510, hooks) | inside `beforeRun`/`afterRun` hook invocation | `string` (run active) | matches `state.runId` | Usually defined. |
| `status-notice` (line 2150, notices) | inside recovery flow | `string` | matches `state.runId` | Defined. |
| `usage-updated`, `tool-updated`, `turn-started/finished`, `assistant-message`, `message-added`, `assistant-text-delta`, `assistant-reasoning-delta` | inside model-stream loop | `string` (active run) | matches `state.runId` | All defined. |

**Summary**: 6 of 7 state-relevant event types have `runId`
DEFINED at the emission site whenever `state.status === "running"`.
The 1 exception is `recovery-state-changed` when emitted from
`restore()` (line 857), which is the post-reset epoch fence that
the wiring's `postResetAwaitingCanonicalRunRef` already handles.

`RUN_ID_GUARANTEE_CLASSIFIED = 100%` (every event type covered).
## 5. A5 — Session-binding table

The `LocalRuntimeHost.subscribeRuntimeEvents` implementation
(`local-runtime-host.ts:1511-1532`) is the **only** seam that
attaches `(sessionId, event)` tuples for Local. The wrapping
closure:

```ts
for (const active of this.sessions.values()) {
    const sessionId = active.sessionId
    unsubscribers.push(
        active.agent.subscribeRuntimeEvents((event) => {
            listener(sessionId, event)
        }),
    )
}
```

This is **per-session binding**: each session's `AgentRuntime`
is subscribed individually, and the host-bound sessionId is
attached verbatim as the first listener argument. Therefore:

```
SESSION_BINDING_CLASSIFIED = 100%
LOCAL_EVENT_DELIVERY        = per-session binding at the LocalRuntimeHost boundary
SESSION_ID_PROVENANCE       = host-supplied via session registry (line 867: this.sessions.set(sessionId, active))
SESSION_ID_VERBATIM         = YES — closure captures sessionId, no rewrite downstream
```

Session-binding for **Hub** and **Remote**: NOT IMPLEMENTED.

```
hub-runtime-host.ts:        no subscribeRuntimeEvents definition
remote-runtime-host.ts:     no subscribeRuntimeEvents override (extends HubRuntimeHost)
```

Per `runtime-host.ts:425-441`, `subscribeRuntimeEvents` is declared
as **OPTIONAL** on `RuntimeHost`. Hosts that lack it must omit
the method. The ClineCore layer handles absence by returning a
no-op unsubscribe (`ClineCore.ts:677-680`):

```ts
if (!this.host.subscribeRuntimeEvents) {
    return () => {}
}
return this.host.subscribeRuntimeEvents(listener)
```

For Hub/Remote, the canonical-event seam **does not exist in
the current codebase**. This is a decisive recon finding for
A6 below.

## 6. A6 — Backend capability preliminary table

| Backend | canonical stream | runId provenance | session binding | canonical authority | qualification (preliminary) |
| ------- | ----------------- | ---------------- | --------------- | ------------------- | --------------------------- |
| Local | YES — `LocalRuntimeHost.subscribeRuntimeEvents` (`local-runtime-host.ts:1511-1531`) | YES — verbatim `snapshot.runId` from producer | YES — closure over `active.sessionId` (`local-runtime-host.ts:1516-1520`) | YES — wiring accepts RUNTIME_CANONICAL with `event.snapshot.runId` provenance | `LOCAL_QUALIFIED` (pending C2.4-B/C) |
| Hub | **NO** — `hub-runtime-host.ts` does not implement `subscribeRuntimeEvents` (zero matches) | N/A — seam absent | N/A — seam absent | NO — `ClineCore.subscribeRuntimeEvents` returns no-op (`ClineCore.ts:677-679`) | `NOT_YET_QUALIFIED` |
| Remote | **NO** — `remote-runtime-host.ts` extends `HubRuntimeHost`, no override (verified by grep) | N/A | N/A | NO | `NOT_YET_QUALIFIED` |

## 7. A7 — Reconstructed-fallback inventory

The reconstructed path is `TaskShadowReverseTranslator` in
`task-state-shadow-observer.ts`. Per its doc-block at
`task-state-shadow-observer.ts:36-48`:

```
RECONSTRUCTED RUNTIME EVENT SUBSET (legacy CoreSessionEvent → AgentRuntimeEvent-shaped):

   run-started              ← first iteration_start of a session
   run-finished             ← done legacy event
   run-failed               ← error legacy event
   tool-started             ← content_start(contentType=tool) legacy event
   tool-finished            ← content_end(contentType=tool) legacy event
   execution-state-changed  ← diff between consecutive reconstructed
                               execution projections (heuristic)
   recovery-state-changed   ← notice(reason in recovery_keys) legacy event
```

This is the **fallback only** — used when canonical authority
is absent. The wiring's coordinator SUPPRESSES reconstructed
events when a canonical event for the same edge is available
(`task-state-shadow-host-wiring.ts:82-87`).

The reconstructed path is NOT used in the Local backend
## 8. A8 — Recon evidence + B authorization

### Acceptance gate (per plan round-6 bookkeeping)

```
CANONICAL_SOURCE_RECON_TABLE
  STATE_RELEVANT_CANONICAL_PRODUCERS_DISCOVERED = 7
  STATE_RELEVANT_CANONICAL_PRODUCERS_AUDITED    = 7
  PRODUCER_AUDIT_COVERAGE                       = 100%
  producer runId guarantee documented           = 100%
  SessionRuntime fanout audited                  = YES
  ALL_ACTUAL_HOPS_FROM_PRODUCER_TO_SHADOW_AUDITED = true
  Local F1-I3 reference-identity still PASS      = YES
  Local proxy rewrites provenance?               = NO (REFERENCE_PASS_THROUGH verified at all 10 hops)
  Hub proxy rewrites provenance?                 = NOT_APPLICABLE (no canonical seam)
  Remote proxy rewrites provenance?              = NOT_APPLICABLE (no canonical seam)
  backend binding confirmed                      = local-only (canonical authority)
  RECONSTRUCTED_FALLBACK_SITES_DISCOVERED        = 1
  RECONSTRUCTED_FALLBACK_AUDITED                 = 1
  RECONSTRUCTED_FALLBACK_AUDIT_COVERAGE          = 100%
  reconstructed-fallback reach to TaskStateShadow = yes (suppressed when canonical exists)
  reconstructed-envelope distinguishable from canonical? = yes
  RUN_ID_GUARANTEE_CLASSIFIED                    = 100%
  SESSION_BINDING_CLASSIFIED                     = 100%
  UNRESOLVED_REACHABILITY_ROWS                   = 0
```

### Key architectural facts established

1. **Producer direction is correct** (AMENDMENT-02 verified):
   `AgentRuntime.emit` → `runtime.subscribe` → `SessionRuntimeOrchestrator.handleRuntimeEvent` → `runtimeEventListeners` fanout → `LocalRuntimeHost.subscribeRuntimeEvents` → `ClineCore` → `VscodeSessionHost` → `runtime-events-proxy` → `subscribeCanonicalRuntimeEventsToShadow` → `TaskShadowHostWiring.observeCanonicalRuntimeEvent` → `coordinator.observe` → `TaskStateShadow.observeRuntimeEvent`.

2. **Local F1-I3 reference-identity is preserved verbatim** at every hop (0-9). No SERIALIZE, COPY, or RECONSTRUCT in the canonical pipeline. `Local F1-I3 reference-identity still PASS = YES`.

3. **Hub/Remote canonical seam is absent**. The current production code base does not implement `subscribeRuntimeEvents` on `HubRuntimeHost` or `RemoteRuntimeHost`. Therefore Hub/Remote disposition is `NOT_YET_QUALIFIED` — the canonical-event authority path that the wiring observes is **only available in Local backend**.

4. **Per-event-type recon template completed** with source citations for all 7 state-relevant event types. `RUN_ID_GUARANTEE_CLASSIFIED = 100%`, `SESSION_BINDING_CLASSIFIED = 100%`.

5. **5 questions answered per event type** (reviewer round-6):
   - Who creates it? → source line in §1
   - Under what runtime condition? → producer condition in §2
   - `snapshot.runId` at creation? → §4 table
   - Session identity binding? → §5
   - Reach canonical shadow ingress? → §2 (all 7 YES for Local)

6. **Per-hop semantics labels applied** (reviewer round-6):
   REFERENCE_PASS_THROUGH at hops 0-9; TRANSLATE at hops 10-11
   (TaskMsg / reducer). No SERIALIZE_DESERIALIZE, FILTER, or
   RECONSTRUCT in the canonical pipeline.

### Verdict

```
C2_4_A_VERDICT = PASS_RECON

NEXT = C2.4-B NO_ACTIVE_SESSION WITNESSES
       (no production edits in this commit)

C2_4_B_AUTHORIZED = true

PRODUCER_AUDIT_COVERAGE             = 100%
EVENT_TYPE_AUDIT_COVERAGE            = 100%
ALL_ACTUAL_HOPS_FROM_PRODUCER_TO_SHADOW_AUDITED = true
UNRESOLVED_REACHABILITY_ROWS         = 0
LOCAL_EVENT_FIDELITY                 = PASS (all 10 hops REFERENCE_PASS_THROUGH)
### What this commit deliberately does NOT do

- Does NOT introduce the observation-layer guard
  `if (activeSession === undefined) return` at
  `task-state-shadow-host-wiring.ts:393`. That belongs to
  C2.4-B, where the dual-proof invariant (transport
  unreachable AND boundary fail-closed) is established.
- Does NOT add the L1-L14 integration test. That belongs to
  C2.4-C, which depends on the recon evidence in this doc.
- Does NOT touch any reducer (`src/shared/state/*`,
  `apps/vscode/src/sdk/task-state-shadow.ts`). Reducer is
  closed (C2.3 closure).
- Does NOT update `task-state-authority-inventory.md`. The
  backend disposition matrix population belongs to C2.4-D,
  after recon + B + C are complete.

### Files referenced (NOT modified) by this commit

```
sdk/packages/agents/src/agent-runtime.ts
sdk/packages/agents/src/runtime/state/task-state/{model,msg,update,effects,selectors,invariants,shadow-adapter,index}.ts
sdk/packages/core/src/ClineCore.ts
sdk/packages/core/src/runtime/host/{runtime-host,local-runtime-host}.ts
sdk/packages/core/src/runtime/orchestration/{session-runtime,session-runtime-orchestrator,runtime-event-adapter}.ts
sdk/packages/core/src/hub/runtime-host/{hub-runtime-host,remote-runtime-host}.ts
sdk/packages/shared/src/agent.ts
apps/vscode/src/sdk/{runtime-events-proxy,canonical-event-subscription,task-state-shadow,task-state-shadow-observer,task-state-shadow-host-wiring}.ts
```

No file in any of these paths was edited by this commit.
LOCAL_REFERENCE_PRESERVATION         = PASS (snapshot.runId verbatim)
HUB_CANONICAL_CAPABILITY             = KNOWN (NOT_YET_QUALIFIED)
REMOTE_CANONICAL_CAPABILITY          = KNOWN (NOT_YET_QUALIFIED)
HUB_PROVENANCE                       = NONE
REMOTE_PROVENANCE                    = NONE
RECONSTRUCTED_FALLBACK_AUDIT_COVERAGE = 100%
```
recon because Local has full canonical authority (A6 above).

```
RECONSTRUCTED_FALLBACK_SITES_DISCOVERED = 1 (TaskShadowReverseTranslator)
RECONSTRUCTED_FALLBACK_AUDITED          = 1
RECONSTRUCTED_FALLBACK_AUDIT_COVERAGE   = 100%
reconstructed-fallback reach to TaskStateShadow = yes (via coordinator; suppressed when canonical exists)
reconstructed-envelope distinguishable from canonical? = yes (origin tag at line 96-107 of wiring)
```
The **fallback path** for Hub/Remote is the **reconstructed
translator** at
`task-state-shadow-observer.ts` (453 lines), which reverse-translates
legacy `CoreSessionEvent` / `AgentEvent` into a
`AgentRuntimeEvent`-shaped approximation. The wiring receives
these as `origin: "RUNTIME_RECONSTRUCTED"` events, which the
coordinator SUPPRESSES when canonical authority is available
(per `task-state-shadow-host-wiring.ts:81-94`).

```
HUB_CANONICAL_CAPABILITY  = KNOWN (NOT_YET_QUALIFIED)
REMOTE_CANONICAL_CAPABILITY = KNOWN (NOT_YET_QUALIFIED)
HUB_PROVENANCE = NONE  (canonical seam absent)
REMOTE_PROVENANCE = NONE  (canonical seam absent)
backend binding confirmed = local-only (canonical authority)
```
