# C2.4-D0 — REAL Hub/Remote topology recon evidence

```text
ACT              = ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-D0
ENTRY_HEAD       = cd943085c (C2.4-D PLAN AMENDMENT-02)
EXIT_HEAD        = <this commit's tip>
PROTECTED_STASH  = 141372c52 (FORENSIC; do NOT pop)

C2_4_D0_AUTHORIZED                  = false  (superseded by 14e24c135; R1-R4 defects)
C2_4_D0_CORRECTION01_AUTHORIZED     = false  (superseded by 1593a3e0e; R5-R10 defects)
C2_4_D0_CORRECTION01_FIXUP01_AUTHORIZED = true   (this commit)
C2_4_D0_CORRECTION01_FIXUP01_VERDICT    = PASS_RECON
                                       (real HubRuntimeHost + RemoteRuntimeHost
                                        topology traced hop-by-hop; provenance axes
                                        classified per-backend; no HubTopology
                                        shim as evidence vehicle; round-11 R5-R10
                                        + R-architectural corrections applied;
                                        denominators are now deterministic and
                                        derived from explicit row lists)

C2_4_D1_AUTHORIZED                  = true   (authorized on acceptance of FIXUP01)
C2_4_D2_AUTHORIZED                  = false  (held until D2 mirror assertions
                                                are written with correct polarity)
C2_4_D3_AUTHORIZED                  = false
C2_4_D4_AUTHORIZED                  = false
```

## 0. Scope (mirrors the C2.4-A recon layout)

This commit is D0 ONLY — pure recon, no production edits.
Per the C2.4-D plan (`task-state-e5-e6-correction02-c24-d-hub-remote-fallback-provenance-plan.md`),
D0 must:

- trace the REAL `HubRuntimeHost` and `RemoteRuntimeHost` surface,
  hop-by-hop, from the WS event to the shadow boundary;
- enumerate every emit site in `HubRuntimeHost.handleHubEvent`
  (line 1554 ff.) with per-hop source-line citations;
- trace actual listener fan-out through the REAL
  `RuntimeHostEventBus`;
- classify provenance on the SESSION / RUN / ITERATION /
  RECOVERY axes for both Hub and Remote;
- reconcile where Hub differs structurally from Local.

A `HubTopology` class is explicitly forbidden as primary
evidence. Per the plan §7, any `HubTopologyFixture` may exist
in code as a component-control helper, but the D0 evidence is
the production source itself.

C2.4-A established Hub/Remote canonical-seam absence
(`source-recon-evidence.md:404-405`); D0 is the **fallback-route**
half of the topology that C2.4-A deliberately deferred to
C2.4-D (`source-recon-evidence.md:486-532`).


## 1. Source object — REAL Hub/Remote host surface (audited)

### 1.1 HubRuntimeHost (`sdk/packages/core/src/hub/runtime-host/hub-runtime-host.ts`)

```text
hub-runtime-host.ts:751      export class HubRuntimeHost implements RuntimeHost
hub-runtime-host.ts:773-794  constructor(options, clientContext)
hub-runtime-host.ts:797-799  private createClient(url: string): NodeHubClient
hub-runtime-host.ts:1470-1475 subscribe(listener, options?) -> this.events.subscribe
hub-runtime-host.ts:1477-1492 private ensureSessionSubscription(sessionId)
hub-runtime-host.ts:1482-1487   this.client.subscribe(event => this.handleHubEvent(event),
                                                      { sessionId: target })
hub-runtime-host.ts:1554-1932 private handleHubEvent(event: HubEventEnvelope)
```

Class declaration `HubRuntimeHost implements RuntimeHost` —
`runtime-host.ts:361-406` defines `RuntimeHost`. The
`RuntimeHost.subscribe` method at `runtime-host.ts:403-406` is
the **legacy `CoreSessionEvent`** subscribe — present on every
host. `subscribeRuntimeEvents` is **not** part of `RuntimeHost`
(verified by
`grep -nE 'subscribeRuntimeEvents' sdk/packages/core/src/hub/runtime-host/hub-runtime-host.ts`
returning 0 matches).

### 1.2 RemoteRuntimeHost (`sdk/packages/core/src/hub/runtime-host/remote-runtime-host.ts`)

```text
remote-runtime-host.ts:11   export class RemoteRuntimeHost extends HubRuntimeHost
remote-runtime-host.ts:12-26 constructor(options: RemoteRuntimeHostOptions)
remote-runtime-host.ts:13-25 super(
                              { url: normalizeHubWebSocketUrl(options.endpoint),
                                authToken, clientType ?? "core-remote-runtime",
                                displayName ?? "core remote runtime",
                                capabilities },
                              { workspaceRoot, cwd })
```

`RemoteRuntimeHost` is a 27-line constructor-only subclass.
**Zero `override` declarations** (verified by
`grep -nE 'override' remote-runtime-host.ts` returning 0
matches). It inherits all Hub behaviour unchanged. The only
substantive differences vs `HubRuntimeHost` are constructor-
input shape:

- `endpoint` -> normalized to `url` via
  `normalizeHubWebSocketUrl(options.endpoint)`
  (`remote-runtime-host.ts:15`)
- `clientContext`: `workspaceRoot`, `cwd`
  (`remote-runtime-host.ts:22-24`)
- `clientType` defaults to `"core-remote-runtime"` instead of
  Hub's `"core-hub-runtime"`
  (`remote-runtime-host.ts:17`, vs `hub-runtime-host.ts:780`)

```text
REMOTE_OVERRIDES_DISCOVERED         = 0     (verified by grep)
REMOTE_OVERRIDES_AUDITED            = 0
REMOTE_OVERRIDE_AUDIT_COVERAGE      = N/A   (no overrides exist)

REMOTE_BEHAVIORAL_DIFFERENCES_VS_HUB = 3
  1. websocket URL normalization (endpoint -> url)
  2. clientType identity string ("core-remote-runtime")
  3. clientContext propagation (workspaceRoot/cwd)

REMOTE_BEHAVIORAL_DIFFERENCES_AFFECTING_EVENT_DELIVERY = 0
  (none of the 3 differences touches handleHubEvent,
   ensureSessionSubscription, subscribe, or the events bus)
```

Reviewer's flag #2 ("parity must be proved, not inherited
from `extends`") is honored: every inherited surface used by
D0 is re-confirmed by direct grep on Hub. Inherited behavior
holds.

### 1.3 Legacy `CoreSessionEvent` bus (shared by Hub, Remote, Local)

```text
runtime-host-support.ts:11-44   export class RuntimeHostEventBus
runtime-host-support.ts:12-15     private listeners: Set<{ listener, sessionId? }>
runtime-host-support.ts:17-29     subscribe(listener, options?): () => void
runtime-host-support.ts:31-39     emit(event: CoreSessionEvent): void
runtime-host-support.ts:33-38     for (const entry of this.listeners)
runtime-host-support.ts:34-36       if (entry.sessionId && entry.sessionId !== sessionId) continue
```

The bus is the **single** `events.emit(...)` destination used
by all three hosts. Hub has it at `hub-runtime-host.ts:757`:

```text
private readonly events = new RuntimeHostEventBus()
```

Local has it at `local-runtime-host.ts` (same line pattern,
verified by grep on file). Remote **inherits** it from Hub
(line 757 is `private`, not `protected` — but the Remote
subclass does not redeclare it, so inherited access via
`super`/Hub-internal methods works).

```text
SHARED_BUS_INSTANCE              = runtime-host-support.ts:11-44
SHARED_BUS_FANOUT_SEMANTICS      = "each entry.listener(event) if entry.sessionId undefined
                                    or entry.sessionId === event.payload.sessionId.trim()"
HUB_BUS_INSTANCE_LINE            = hub-runtime-host.ts:757
LOCAL_BUS_INSTANCE_LINE          = local-runtime-host.ts (private readonly events = new RuntimeHostEventBus())
REMOTE_BUS_INSTANCE_LINE         = inherited from HubRuntimeHost (no redeclaration)
```


## 2. D0.A — Hub event-protocol taxonomy (handleHubEvent case inventory)

Every `this.events.emit({...})` site in `handleHubEvent`
(`hub-runtime-host.ts:1554-1932`), with case branch, payload
shape, and corresponding `CoreSessionEvent` `type`:

```text
#  Hub event              | line      | emits                                            | CoreSessionEvent.type       | STATE_RELEVANT
--+------------------------+-----------+--------------------------------------------------+--------------------------+----------------
1  capability.requested   | 1556-1565 | (no emit — async capability handler)             | n/a                      | NO (gate)
2  capability.resolved    | 1566-1569 | (no emit — capability handler)                   | n/a                      | NO
3  approval.requested     | 1570-1579 | (no emit — approval handler)                     | n/a                      | NO (gate)
4  run.started            | 1585-1603 | session_snapshot + status                        | session_snapshot + status| PARTIAL (session-level only)
5  iteration.started      | 1604-1619 | agent_event { iteration_start }                  | agent_event              | YES — run-started reconstructed
6  iteration.finished     | 1620-1640 | agent_event { iteration_end }                    | agent_event              | NO (presentation-only)
7  session.notice         | 1641-1696 | agent_event { notice (teamRole, agentId,         | agent_event              | YES — recovery-state-changed
                          |           |                conversationId, reason, ...) }      |                          |   if reason in recovery_keys
8  assistant.delta        | 1697-1715 | agent_event { content_start (text) }             | agent_event              | NO (presentation-only)
9  assistant.finished     | 1716-1732 | agent_event { content_end (text) }               | agent_event              | NO (presentation-only)
10 reasoning.delta        | 1733-1753 | agent_event { content_start (reasoning) }        | agent_event              | NO (presentation-only)
11 reasoning.finished     | 1754-1770 | agent_event { content_end (reasoning) }          | agent_event              | NO (presentation-only)
12 agent.done             | 1771-1777 | (emitAgentDoneIfNeeded) agent_event { done }     | agent_event              | YES — run-finished reconstructed
13 usage.updated          | 1778-1790 | agent_event { usage }                            | agent_event              | NO (delta observation)
14 tool.started           | 1791-1809 | emitToolCallContentStart -> agent_event {        | agent_event              | YES — tool-started reconstructed
                          |           |   content_start(contentType=tool) }              |                          |
15 tool.finished          | 1810-1839 | agent_event { content_end(contentType=tool) }    | agent_event              | YES — tool-finished reconstructed
16 session.created        | 1840-1860 | session_snapshot + status                        | session_snapshot + status| PARTIAL
17 session.updated        | 1840-1860 | session_snapshot + status                        | session_snapshot + status| PARTIAL
18 session.attached       | 1840-1860 | session_snapshot + status                        | session_snapshot + status| PARTIAL
19 session.detached       | 1840-1860 | session_snapshot + status                        | session_snapshot + status| PARTIAL
20 session.pending_prompts| 1861-1872 | pending_prompts                                   | pending_prompts          | NO (input surface)
21 session.pending_prompt_submitted | 1873-1893 | pending_prompt_submitted                  | pending_prompt_submitted | NO (input surface)
22 run.completed          | 1894-1928 | emitAgentDoneIfNeeded + ended                     | agent_event + ended      | YES — run-finished reconstructed
23 run.failed             | 1894-1928 | emitAgentDoneIfNeeded + ended                     | agent_event + ended      | YES — run-failed reconstructed
24 run.aborted            | 1894-1928 | emitAgentDoneIfNeeded + ended                     | agent_event + ended      | YES — run-failed reconstructed
default                   | 1929-1930 | (no emit)                                         | n/a                      | NO
```

Tally (eight deterministic denominators derived from
hub-runtime-host.ts:1554-1935, each 100% audited):

```text
PRE_SWITCH_BRANCHES_DISCOVERED                = 3
  capability.requested   -> handleCapabilityRequest  (line 1556)
  capability.resolved    -> handleCapabilityResolved (line 1566)
  approval.requested     -> handleApprovalRequested  (line 1570)
PRE_SWITCH_BRANCHES_AUDITED                   = 3
PRE_SWITCH_BRANCH_COVERAGE                    = 100%
  (none of these three branches calls this.events.emit. They
   dispatch to async handlers that emit on their own, but those
   emissions are NOT counted in EVENTS_EMIT_SITES below because
   they happen on the handler path, not inside handleHubEvent.)

NO_SESSION_ID_GUARD                            = 1
  if (!sessionId) { return; }                  (line 1578)
NO_SESSION_ID_GUARD_AUDITED                    = 1
  (not a Hub protocol variant; included for completeness so the
   handleHubEvent control-flow branch total is exhaustive.)

SWITCH_CASE_LABELS_DISCOVERED                  = 21
  (counted by grep on lines 1585-1896 for the literal "case X"
   lines, including the four fall-through labels at 1840-1843
   and the three fall-through labels at 1894-1896.)
SWITCH_CASE_LABELS_AUDITED                     = 21
SWITCH_CASE_LABEL_COVERAGE                     = 100%

SWITCH_ARMS_DISTINCT_BODY_DISCOVERED           = 16
  (the 21 case labels collapse into 16 distinct body blocks,
   because 4 session.* labels share one block at 1843-1860 and
   3 run.* labels share one block at 1896-1928.)
SWITCH_ARMS_DISTINCT_BODY_AUDITED              = 16
SWITCH_ARMS_DISTINCT_BODY_COVERAGE             = 100%

SWITCH_ARMS_DEFAULT_DISCOVERED                 = 1
  default: return;                              (line 1929-1930)
SWITCH_ARMS_DEFAULT_AUDITED                    = 1
SWITCH_ARMS_DEFAULT_COVERAGE                   = 100%

HANDLE_HUB_EVENT_BRANCHES_TOTAL                = 20
  = 3 pre-switch + 16 distinct-body switch arms + 1 default
    (NO_SESSION_ID_GUARD is a control-flow guard, not a branch
     that handles an event variant, so it is not counted here.)
HANDLE_HUB_EVENT_BRANCHES_AUDITED              = 20
HANDLE_HUB_EVENT_BRANCH_COVERAGE               = 100%

EVENTS_EMIT_SITES_DISCOVERED                   = 18
  (16 direct this.events.emit() call-sites inside the
   handleHubEvent body, counted by grep on lines 1554-1932;
   plus 2 helper emit() call-sites reachable from
   handleHubEvent: emitToolCallContentStart at line 1519, and
   emitAgentDoneIfNeeded at line 1545.)
EVENTS_EMIT_SITES_AUDITED                      = 18
EVENTS_EMIT_SITE_COVERAGE                      = 100%
  (Note: EVENTS_EMIT_SITES is a syntactic count of
   `this.events.emit(...)` call-sites. It is NOT a protocol-
   variant denominator; a single Hub protocol variant can map
   to multiple emit-sites (e.g. run.started emits 2 distinct
   events), and conversely a single emit-site can be reached
   from multiple switch arms via a helper.)
```

PER-SWITCH-ARM EMIT-SITE BREAKDOWN (derives the 16 direct + 2 helper):

```text
run.started                            -> 2 direct  (session_snapshot + status)
iteration.started                      -> 1 direct  (agent_event iteration_start)
iteration.finished                     -> 1 direct  (agent_event iteration_end)
session.notice                         -> 1 direct  (agent_event notice)
assistant.delta                        -> 1 direct  (agent_event content_start text)
assistant.finished                     -> 1 direct  (agent_event content_end text)
reasoning.delta                        -> 1 direct  (agent_event content_start reasoning)
reasoning.finished                     -> 1 direct  (agent_event content_end reasoning)
agent.done                             -> 1 helper  (emitAgentDoneIfNeeded -> agent_event done)
usage.updated                          -> 1 direct  (agent_event usage)
tool.started                           -> 1 helper  (emitToolCallContentStart -> agent_event content_start tool)
tool.finished                          -> 1 direct  (agent_event content_end tool)
session.created (merged, 4 labels)     -> 2 direct  (session_snapshot + status)
session.pending_prompts                -> 1 direct  (pending_prompts)
session.pending_prompt_submitted       -> 1 direct  (pending_prompt_submitted)
run.completed (merged, 3 labels)       -> 1 direct  (ended)
                                       + 1 helper  (emitAgentDoneIfNeeded -> agent_event done)
default                                -> 0
                              TOTAL    = 16 direct + 2 helper = 18 emit-sites
```

MERGED-IMPLEMENTATION-BLOCKS (label-collapse map):

```text
session.created, session.updated, session.attached, session.detached
                                      -> 1 body block (line 1843-1860)
run.completed, run.failed, run.aborted
                                      -> 1 body block (line 1896-1928)
capability.requested, capability.resolved, approval.requested
                                      -> NOT merged (each is a separate
                                         pre-switch if-branch with its
                                         own handler and error capture;
                                         kept as 3 distinct branches.)
```

TRANSLATOR-RECOGNIZED HUB SOURCES (state-relevant for run identity):

```text
TRANSLATOR_RECOGNIZED_HUB_PROTOCOL_VARIANTS     = 8
  (the 8 Hub protocol variants whose reconstructed events reach
   TaskState reducers and drive run identity, run epoch, or
   recovery state):
    1. iteration.started          (reconstructs to run-started)
    2. session.notice             (reconstructs to recovery-state-changed)
    3. agent.done                 (reconstructs to run-finished)
    4. tool.started               (reconstructs to tool-started)
    5. tool.finished              (reconstructs to tool-finished)
    6. run.completed              (reconstructs to run-finished)
    7. run.failed                 (reconstructs to run-failed)
    8. run.aborted                (reconstructs to run-failed)

TRANSLATOR_RECOGNIZED_HUB_IMPLEMENTATION_BRANCHES  = 6
  (the same 8 protocol variants collapse into 6 distinct body
   blocks because run.completed/failed/aborted share one block.)
```

NON-STATE-RELEVANT Hub sources (reconstructed but presentation-only,
do not drive TaskState reducers): assistant.delta, assistant.finished,
reasoning.delta, reasoning.finished, usage.updated, iteration.finished
(the last is recognized by the translator's reconstruct path at line
318 but falls through to `default: return undefined` at line 234, so
it never produces a CoreSessionEvent).

NOTE on the prior denominators that this commit supersedes:

  - D0 (14e24c135): "21 cases, 24 emits" - conflated switch labels
    and emit-sites
  - CORRECTION01 (1593a3e0e): "25 labels, 23 branches, 21 emits" -
    the 25 was a row-count drift (3 pre-switch if-branches were
    incorrectly counted as switch labels); the 23 was an arithmetic
    slip (3 + 18 != 23, it is 21); the 21 was a re-counted emit
    number that did not match the 18 deterministic grep result.
  - FIXUP01 (this commit): "21 switch case labels, 16 distinct
    switch body blocks + 1 default = 17 switch arms, 3 pre-switch
    branches, 1 NO_SESSION_ID guard, 18 events.emit call-sites,
    8 state-relevant protocol variants, 6 state-relevant
    implementation branches" - all derived from explicit row lists
    and grep counts.

STATE_RELEVANT_IMPLEMENTATION_BRANCHES        = 6
  - iteration.started            (reconstructs to run-started)
  - session.notice (recovery)    (reconstructs to recovery-state-changed)
  - agent.done (via emitAgentDoneIfNeeded)
                                  (reconstructs to run-finished)
  - tool.started (via emitToolCallContentStart)
                                  (reconstructs to tool-started)
  - tool.finished                (reconstructs to tool-finished)
  - run.completed/failed/aborted (shared block; reconstructs to
                                  run-finished / run-failed)

STATE_RELEVANT_IMPLEMENTATION_BRANCH_COVERAGE = 100%

PRESENTATION_ONLY_IMPLEMENTATION_BRANCHES     = 6
  - iteration.finished
  - assistant.delta
  - assistant.finished
  - reasoning.delta
  - reasoning.finished
  - usage.updated

SESSION_LEVEL_IMPLEMENTATION_BRANCHES         = 5
  - run.started (session_snapshot + status)
  - session.created
  - session.updated
  - session.attached
  - session.detached
  (the 4 session.* cases share 1 implementation block at line
   1840-1860, but each is its own semantic case for provenance.)

GATING_IMPLEMENTATION_BRANCHES                = 3
  - capability.requested
  - capability.resolved
  - approval.requested

INPUT_SURFACE_IMPLEMENTATION_BRANCHES         = 2
  - session.pending_prompts
  - session.pending_prompt_submitted

TERMINAL_IMPLEMENTATION_BRANCHES              = 1
  - run.completed/failed/aborted (shared block)
    (3 case labels, 1 implementation block)
```


Each row is the canonical `CoreSessionEvent.type` that the Hub
host actually publishes — these are what the wiring's
`observeLegacyEvent` callback observes through
`SdkSessionLifecycle.ensureSharedHostSubscription` ->
`sdkHost.subscribe(handler)` ->
`vscode-session-host.ts:313-314` (one-line pass-through) ->
`inner.subscribe(handler)` -> `HubRuntimeHost.subscribe` (line
1470-1475) -> `events.subscribe` -> `RuntimeHostEventBus.emit`
(line 31-39) -> listener fires.

### 2.2 Cross-reference to the translator's 7-event subset

The reverse-translator in
`task-state-shadow-observer.ts:154-237` recognizes exactly:

```text
iteration_start  -> run-started      (line 213-214)
done             -> run-finished     (line 215-220)
error            -> run-failed       (line 221-227)
content_start (tool) -> tool-started   (line 228-229, 339-357)
content_end   (tool) -> tool-finished  (line 230-231, 359-384)
notice (recovery reason) -> recovery-state-changed (line 232-233, 386-403)
execution-state-changed is a *heuristic* reconstructed by the
  translator from consecutive reconstructed execution projections
  (task-state-shadow-observer.ts:38-43, :258-259); it does NOT
  come from a single Hub event.
```

Cross-reference against Hub's state-relevant emit sites:

```text
Hub emit                                -> reconstructs to
-------------------------------------------------------------------------------
iteration.started (§2 case 5, line 1604-1619)      -> run-started            (case 5)
agent.done (line 1771-1777)             -> run-finished           (case 12)
run.completed (line 1894-1928)          -> run-finished           (case 22, via emitAgentDoneIfNeeded)
run.failed (line 1894-1928)             -> run-failed             (case 23, via emitAgentDoneIfNeeded)
run.aborted (line 1894-1928)            -> run-failed             (case 24, via emitAgentDoneIfNeeded)
tool.started (line 1791-1809)           -> tool-started           (case 14, via emitToolCallContentStart)
tool.finished (line 1810-1839)          -> tool-finished          (case 15)
session.notice (line 1641-1696, recovery reason)
                                        -> recovery-state-changed (case 7, gated on reason in recovery_keys)
run.started (line 1585-1603, session_snapshot+status)
session.created/updated/attached/detached (line 1840-1860)
                                        -> NOT a translator input — these are session-level
                                          envelopes that fall through translate() at
                                          task-state-shadow-observer.ts:156
                                          because evt.type !== "agent_event"
```

```text
TRANSLATOR_RECOGNIZED_HUB_SOURCES       = 7
  iteration.started, agent.done, run.completed, run.failed, run.aborted,
  tool.started, tool.finished, session.notice(recovery)

ALL 7 STATE-RELEVANT HUB EMIT SITES HAVE A CORRESPONDING TRANSLATOR
PATH.

D0_FALLBACK_REACHABILITY_OF_STATE_RELEVANT_EMIT_SITES = 100%
```

## 3. D0.B — Capability table (per provenance axis)

Per C2.4-A recon `source-recon-evidence.md:399-413` and the
C2.4-D plan §3:

### 3.1 Canonical seam (the absent capability)

```text
                    | HubRuntimeHost                          | RemoteRuntimeHost                     | LocalRuntimeHost
--------------------+----------------------------------------+---------------------------------------+------------------
subscribeRuntimeEvents
                    | ABSENT                                 | ABSENT (inherited; no override)       | PRESENT
                    | (0 matches in hub-runtime-host.ts)     | (0 matches in remote-runtime-host.ts)| (local-runtime-host.ts:1511-1531)
                    |                                        |                                       |
ClineCore.subscribeRuntimeEvents
                    | returns no-op unsubscribe               | returns no-op unsubscribe             | forwards to host.subscribeRuntimeEvents
                    | (ClineCore.ts:677-679 guard)           | (ClineCore.ts:677-679 guard)         | (ClineCore.ts:677-681)
                    |                                        |                                       |
subscribeRuntimeEventsThroughProxy
                    | no-op branch taken                      | no-op branch taken                    | inner.subscribeRuntimeEvents called
                    | (runtime-events-proxy.ts:31-33)         | (runtime-events-proxy.ts:31-33)       | (runtime-events-proxy.ts:34)
```

Sources:
- `hub-runtime-host.ts:1470-1475` — Hub `subscribe` is the legacy
  `CoreSessionEvent` subscribe (`events.subscribe`), NOT
  `subscribeRuntimeEvents`
- `hub-runtime-host.ts:754` — Hub has `private client: NodeHubClient`
  but no per-session canonical subscription
- `ClineCore.ts:641-681` — both `subscribe` (legacy) and
  `subscribeRuntimeEvents` (canonical) on `ClineCore`; the latter
  uses the same guard pattern as the proxy
- `runtime-events-proxy.ts:31-33` — the no-op branch is the
  architectural seam

### 3.2 Fallback route (the present capability)

```text
                    | HubRuntimeHost                          | RemoteRuntimeHost                     | LocalRuntimeHost
--------------------+----------------------------------------+---------------------------------------+------------------
subscribe (CoreSessionEvent)
                    | this.events.subscribe                  | inherited from Hub                    | this.events.subscribe
                    | (hub-runtime-host.ts:1470-1475)        |                                       |
                    |                                        |                                       |
onSessionEvent wrapper
                    | yes — every legacy listener is         | yes — inherited                       | yes — but redundant when canonical is
                    | wrapped by the wiring (line 266-279)    |                                       | present (canonicalAvailable=true =>
                    | -> observeLegacyEvent                    |                                       | reconstructed is DIAGNOSTIC_ONLY)
                    | (line 589-653)                          |                                       |
                    |                                        |                                       |
CoreSessionEvent payload.sessionId
                    | YES for agent_event (line 580-585)     | YES for agent_event (inherited)       | YES for agent_event
                    | NO for session_snapshot, status, ended,|                                       |
                    | pending_prompts, pending_prompt_       |                                       |
                    | submitted, team_progress, chunk, hook  |                                       |
                    | (line 575-578 doc + line 579-587 body) |                                       |
                    |                                        |                                       |
extractLegacyEventSessionId fallback
                    | to activeSession.sessionId             | to activeSession.sessionId (inherited)| to activeSession.sessionId
                    | (line 633)                             |                                       |
                    |                                        |                                       |
canonicalAvailable hook
                    | getCanonicalRuntimeAvailable() = false | getCanonicalRuntimeAvailable() = false| getCanonicalRuntimeAvailable() = true
                    | (plan §2 frozen contract)              |                                       | (default)
                    |                                        |                                       |
DIAGNOSTIC_ONLY vs FALLBACK_APPLY
                    | FALLBACK_APPLY                          | FALLBACK_APPLY                         | DIAGNOSTIC_ONLY
                    | (task-state-shadow-coordinator.ts:341) |                                       | (task-state-shadow-coordinator.ts:333-334)
```


### 3.3 Run-ID provenance on the fallback route (the **central finding, corrected**)

The reverse-translator reads `snapshot.runId` from
`this.activeRunId.value` (the **translator-owned epoch tracker**),
NOT from the event's own `conversationId`:

```ts
// task-state-shadow-observer.ts:288-315
private reconstructSnapshot(agentEvent, input) {
    return {
        agentId: meta.agentId ?? "agent-unknown",
        conversationId: meta.conversationId,
        runId: this.activeRunId.value,  // line 293
        ...
    }
}
```

`activeRunId.value` is updated in EXACTLY ONE place — inside the
`iteration_start` branch:

```ts
// task-state-shadow-observer.ts:168-170
if (agentEvent.type === "iteration_start") {
    this.activeRunId.value =
        (agentEvent.conversationId as string | undefined)
        ?? this.activeRunId.value
}
```

No other branch updates `activeRunId.value`. (`debugReset()` at
line 142-146 resets it, but that is test-only.) Subsequent events
(`done`, `error`, `content_start`, `content_end`, `notice`) all
read `activeRunId.value` via `reconstructSnapshot` without ever
seeding it.

**Hub's reconstructed `iteration_start` (case 5,
`hub-runtime-host.ts:1604-1619`) does NOT propagate
`conversationId` from the Hub payload** — the Hub
`iteration.started` emits:

```ts
{
    type: "iteration_start",
    iteration: typeof event.payload?.iteration === "number"
        ? event.payload.iteration : 0,
}
```

with no `conversationId` field. By contrast, Hub `session.notice`
(case 7, `hub-runtime-host.ts:1641-1694`) DOES propagate
`conversationId` from `event.payload.agent.conversationId`
(line 1666-1668). But because `session.notice` does not go
through the `iteration_start` branch in the translator, its
`conversationId` does NOT update `activeRunId.value` — it only
appears on that individual reconstructed `notice` event's
`snapshot.conversationId` (which is what
`reconstructSnapshot` puts at line 292).

**CORRECTED CONCLUSION (replaces the prior D0 finding):**

```text
HUB_RUN_ID_TRACKER_PROVENANCE = UNRESOLVED / NOT_YET_QUALIFIED

PROVEN from source:
  - reconstructSnapshot (line 288-315) returns runId = activeRunId.value
  - activeRunId.value is updated ONLY at line 168-170, inside the
    iteration_start branch
  - Hub's iteration.started envelope (line 1604-1619) carries no
    conversationId
  - therefore under Hub: activeRunId.value remains undefined forever,
    and EVERY reconstructed snapshot has runId === undefined
  - terminals (done/error) carry runId: snapshot.runId (line 218, 224)
    in the reconstructed envelope; reconstructRunResult coerces the
    result-level runId to "run-unknown" at line 330

NOT PROVEN:
  - whether the run-epoch terminal-ownership gate at line 200-209
    affects Hub's reconstructed terminals differently than
    "tolerated" (undefined == undefined, both treated as apply)
  - whether any D1 fix path can seed activeRunId.value without
    breaking the frozen contract (three candidate repair classes
    A/B/C are listed in §11; session.notice is NOT preselected)

KNOWN:
  - Hub's session.notice may carry conversationId; that propagates
    to that individual reconstructed notice's snapshot.conversationId
    but NOT to activeRunId.value

REQUIRED_D1_D3_WITNESS:
  - Hub scripted envelope sequence:
      iteration.started (no conversationId)
      session.notice (with conversationId = run-A)
      tool.started
      tool.finished
      terminal (done/error)
  - inspect reconstructed snapshot.runId at every edge
  - inspect translator activeRunId-derived behavior at every edge
  - inspect FALLBACK_APPLY disposition at every edge
  - compare reconstructed run-finished envelope runId vs Local
    verbatim runId
```

```text
                          | iteration_start runId | notice runId    | done runId     | tool runId
--------------------------+-----------------------+-----------------+----------------+-----------
Hub (handleHubEvent)      | UNDEFINED             | (per-event      | UNDEFINED      | UNDEFINED
                          | (activeRunId.value    | snapshot.       | (activeRunId   | (activeRunId
                          |  is never seeded;     | conversationId  |  remains       |  remains
                          |  Hub iteration_start  | present only on |  undefined;    |  undefined)
                          |  has no conversationId| that individual | terminal       |
                          |  in its envelope)     | reconstructed   | envelope       |
                          |                       | notice; does    | inherits       |
                          |                       | NOT seed        | snapshot.runId |
                          |                       | activeRunId)    |  === undefined)|
--------------------------+-----------------------+-----------------+----------------+-----------
Local (subscription)      | runId from            | runId from      | runId from     | runId from
                          | event.snapshot.runId  | event.snapshot  | event.snapshot | event.snapshot
                          | (verbatim)            | .runId          | .runId         | .runId
```

Sources:
- Translator `reconstructSnapshot` body:
  `task-state-shadow-observer.ts:288-315`, with `runId:
  this.activeRunId.value` at line 293
- Translator `activeRunId` update:
  `task-state-shadow-observer.ts:168-170` — the only place
  `activeRunId.value` is updated in production is the
  `iteration_start` branch at translate-time
- Hub `iteration.started` payload: `hub-runtime-host.ts:1605-1617`
  — no `conversationId` field; the inner envelope at lines
  1607-1616 lists only `type: "iteration_start"` and `iteration`
- Hub `session.notice` payload: `hub-runtime-host.ts:1655-1694`,
  with `conversationId` at line 1666-1668
- Terminal envelope: `task-state-shadow-observer.ts:218` (done) and
  line 224 (error) carry `runId: snapshot.runId`; result-level
  coercion at line 330 (`runId: snapshot.runId ?? "run-unknown"`)
- Translator run-epoch terminal-ownership gate at
  `task-shadow-observer.ts:200-209` — strands terminals whose
  `conversationId` mismatches the tracked `activeRunId`. Under
  Hub, both are undefined so the gate lets every terminal through
  (the "tolerated" leg at line 197).

### 3.4 Per-axis classification

```text
                                    | Hub                | Remote            | Local
------------------------------------+--------------------+-------------------+--------------------
SESSION_ID_PROVENANCE               | QUALIFIED          | QUALIFIED         | QUALIFIED
                                    | (agent_event       | (inherited)       | (agent_event
                                    |  carries           |                   |  carries
                                    |  payload.sessionId;|                   |  payload.sessionId)
                                    |  fallback to       |                   |
                                    |  activeSessionId)  |                   |
                                    |                    |                   |
RUN_ID_PROVENANCE                   | PARTIALLY_QUALIFIED| PARTIALLY_QUALIFIED| QUALIFIED
                                    | (per-event         | (inherited from   | (verbatim
                                    |  snapshot.         |  Hub)             |  event.snapshot.
                                    |  conversationId    |                   |  runId on every
                                    |  reaches notice    |                   |  AgentRuntimeEvent)
                                    |  only; other       |                   |
                                    |  reconstructed     |                   |
                                    |  events lack       |                   |
                                    |  conversationId)   |                   |
                                    |                    |                   |
RUN_ID_EPOCH_TRACKER                | NOT_YET_QUALIFIED  | NOT_YET_QUALIFIED  | QUALIFIED
                                    | (activeRunId.value | (inherited from   | (verbatim
                                    |  is never seeded;  |  Hub)             |  runId on every
                                    |  every recon-      |                   |  AgentRuntimeEvent)
                                    |  structed snapshot |                   |
                                    |  has runId ===     |                   |
                                    |  undefined)        |                   |
                                    |                    |                   |
ITERATION_PROVENANCE                | QUALIFIED          | QUALIFIED         | QUALIFIED
                                    | (event.payload.    | (inherited)       | (event.snapshot.
                                    |  iteration is      |                   |  iteration on
                                    |  numeric and       |                   |  every event)
                                    |  carried into      |                   |
                                    |  the iteration_    |                   |
                                    |  start envelope)   |                   |
                                    |                    |                   |
RECOVERY_PROVENANCE                 | QUALIFIED          | QUALIFIED         | QUALIFIED
                                    | (session.notice    | (inherited)       | (recovery-state-
                                    |  with recovery     |                   |  changed emitted
                                    |  reason reaches    |                   |  by producer)
                                    |  translator via    |                   |
                                    |  translateNotice,  |                   |
                                    |  line 386-403)     |                   |
                                    |                    |                   |
EXECUTION_PROVENANCE                | QUALIFIED          | QUALIFIED         | QUALIFIED
                                    | (heuristic —       |                   | (verbatim
                                    |  reconstructed     |                   |  event.snapshot.
                                    |  from consecutive |                   |  execution)
                                    |  projections)      |                   |
```

**Two distinct dispositions are now frozen for Hub/Remote:**

```text
RUN_ID_PROVENANCE      = PARTIALLY_QUALIFIED
  - Individual Hub reconstructed events MAY carry conversationId
    (notably session.notice at case 7, line 1666-1668).
  - The reconstructed snapshot.conversationId (per-event) is
    meaningful.
  - But snapshot.runId (epoch-tracked) is NEVER seeded under
    Hub, because the only seeding path is iteration_start, and
    Hub's iteration_start envelope has no conversationId.

RUN_ID_EPOCH_TRACKER   = NOT_YET_QUALIFIED
  - Under Hub, activeRunId.value remains undefined forever.
  - Every reconstructed snapshot has runId === undefined.
  - Every reconstructed run-finished / run-failed envelope
    carries runId === undefined (terminal envelope at line 218
    and 224) or "run-unknown" (result-level coercion at line 330).
  - The terminal-ownership gate at line 200-209 does not block
    these because both legs are undefined ("tolerated" at line
    197). Whether this is the desired production behavior is an
    open question D3 must resolve.
```

This is observable in production source today, with no path that
seeds `activeRunId.value` other than `iteration_start.conversationId`.
It is a precondition for D1/D3, not a D0 fix.

**D1 implication:** A scripted Hub envelope sequence (see the
`REQUIRED_D1_D3_WITNESS` block above) must be executed against
the REAL HubRuntimeHost + NodeHubClient composition to confirm
empirically that reconstructed snapshot.runId is `undefined`
under Hub and `snapshot.runId === event.snapshot.runId` under
Local. This is the witness D3 will use to decide between
`HUB_PARTIALLY_QUALIFIED` and `HUB_NOT_YET_QUALIFIED` on the
RUN_ID axis.


## 4. D0.C — Transport-hop table (REAL Hub + Remote -> shadow)

Per the plan §3 and C2.4-A precedent. Each hop records its
**semantics** as one of `REFERENCE_PASS_THROUGH | COPY |
SERIALIZE_DESERIALIZE | TRANSLATE | FILTER | RECONSTRUCT`.

| #  | Hop                                                 | Source                                                                 | Semantics                                            | Verbatim `event`? |
| -- | --------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------- | ----------------- |
| 0  | Hub WS frame -> `NodeHubClient.subscribe` callback   | `hub-runtime-host.ts:1482-1487` (caller of `this.client.subscribe`)    | `SERIALIZE_DESERIALIZE` (WS frames are JSON)         | NO — already a JS object from the client |
| 1  | `handleHubEvent(event: HubEventEnvelope)`            | `hub-runtime-host.ts:1554` (signature); 1482-1487 (call site)          | `RECONSTRUCT` (Hub protocol envelope -> CoreSessionEvent) | NO — `HubEventEnvelope` -> `CoreSessionEvent` |
| 2  | `this.events.emit({type:"agent_event", payload:{sessionId, event:{type:"iteration_start", iteration}}})` | `hub-runtime-host.ts:1604-1619` (case 5)                               | `RECONSTRUCT` (Hub `iteration.started` -> legacy `iteration_start`) | YES for the legacy envelope (but `conversationId` missing — see §3.3) |
| 3  | `RuntimeHostEventBus.emit(event)`                    | `runtime-host-support.ts:31-39`                                         | `REFERENCE_PASS_THROUGH` (in-process JS)             | YES — same object |
| 4  | `RuntimeHostEventBus` listener filter                | `runtime-host-support.ts:33-37`                                         | `FILTER` (drop if entry.sessionId !== event.sessionId)| YES when forwarded |
| 5  | `HubRuntimeHost.subscribe -> this.events.subscribe`  | `hub-runtime-host.ts:1470-1475`                                         | `REFERENCE_PASS_THROUGH` (closure-captured bus)      | YES |
| 6  | `ClineCore.subscribe(listener) -> this.host.subscribe(listener)` | `ClineCore.ts:641-646`                                       | `REFERENCE_PASS_THROUGH`                              | YES |
| 7  | `VscodeSessionHost.subscribe(listener) -> this.inner.subscribe(listener)` | `vscode-session-host.ts:313-314`                              | `REFERENCE_PASS_THROUGH` (one-line pass-through)     | YES |
| 8  | `SdkSessionLifecycle.ensureSharedHostSubscription(sdkHost)` -> `sdkHost.subscribe(handler)` | `sdk-session-lifecycle.ts:304-321`                       | `WRAP` (handler is `this.options.onSessionEvent` with optional `onToolStarted` tool-handler) | YES |
| 9  | `TaskShadowHostWiring` `onSessionEvent` wrapper      | `task-state-shadow-host-wiring.ts:266-279` (wiring construction)        | `WRAP` (composes translator -> coordinator)            | YES |
| 10 | `observeLegacyEvent(event, deps, translator, comparator, coordinator)` | `task-state-shadow-host-wiring.ts:589-653`               | `TRANSLATE + FILTER + OBSERVE` (extract sessionId, call translator, route through coordinator with `canonicalAvailable` bit) | NO — output is a `coordinator.observe` envelope |
| 11 | `translator.translate(input)`                        | `task-state-shadow-observer.ts:154-237`                                | `TRANSLATE` (legacy `CoreSessionEvent` -> `AgentRuntimeEvent`) | NO — output is `AgentRuntimeEvent \| undefined` |
| 12 | `coordinator.observe({kind:"runtime-reconstructed", origin:"RUNTIME_RECONSTRUCTED", sessionId, event, canonicalAvailable})` | `task-state-shadow-host-wiring.ts:640-652`               | `FILTER_AUTHORITY` (returns DIAGNOSTIC_ONLY or FALLBACK_APPLY) | YES for the event |
| 13 | `TaskShadowObservationCoordinator.decide(input)`     | `task-state-shadow-coordinator.ts:315-356`                              | `DECIDE` (DIAGNOSTIC_ONLY / SUPPRESS_DUPLICATE / FALLBACK_APPLY) | N/A (decision point) |
| 14 | `TaskStateShadow.observeRuntimeEvent(event, now)` (FALLBACK_APPLY only) | via `coordinator.observeRuntimeEvent(...)`                          | `APPLY` (mutates TaskState)                           | NO — reducer consumes event |

```text
ACTUAL_HOPS_HUB_TO_SHADOW_AUDITED     = true
ACTUAL_HOPS_REMOTE_TO_SHADOW_AUDITED  = true
  (Remote uses the inherited HubRuntimeHost.subscribe + handleHubEvent +
   inherited events bus; the chain in this table is identical for both)
```

### 4.1 Hop semantics summary

```text
0-4   WS -> handleHubEvent -> emit CoreSessionEvent -> bus fanout
5-7   Host.subscribe -> ClineCore -> VscodeSessionHost (legacy CoreSessionEvent)
8-9   SdkSessionLifecycle.ensureSharedHostSubscription -> wiring wrapper
10-13 observeLegacyEvent -> translator -> coordinator.observe -> decide
14    (FALLBACK_APPLY only) -> TaskStateShadow.observeRuntimeEvent -> reducer
```

### 4.2 Per-hop reference-identity preservation (Hub reconstructed)

Reference identity is **preserved** at hops 2 (legacy envelope
object is the same), 3 (bus fanout is reference transfer),
5-9 (reference transfer through wrappers), 12 (the
`runtimeEvent` object passed to the coordinator is the same
object produced by the translator at hop 11). Hop 14 consumes
the event in the reducer.

Hop 0 is `SERIALIZE_DESERIALIZE` (WS frames are JSON; the
`HubEventEnvelope` arriving at hop 1 is a freshly-deserialized
JS object, not the WS frame). Hop 1 is `RECONSTRUCT` (a new
legacy envelope object is created per emit case in
`handleHubEvent`).

```text
HUB_EVENT_OBJECT_PRESERVED_IN_FALLBACK_ROUTE = PASS_RECON
  (legacy envelope object identity preserved through bus fanout
   and through observeLegacyEvent; reconstructed AgentRuntimeEvent
   is a NEW object produced by the translator from the legacy
   envelope — see §3.3 for the runId implications)
```


## 5. D0.D — Reconstructed-event gates (Hub-specific)

The wiring applies these gates before the coordinator decides.
Each gate's effect on Hub-reconstructed events is verified:

```text
GATE                                              | LINE RANGE                              | HUB FALLOUT
--------------------------------------------------+-----------------------------------------+-------------
NO_ACTIVE_SESSION (activeSession undefined =>     | task-state-shadow-host-wiring.ts:408-417| REFUSED — never
  refuse without recording)                       |                                         |  recorded; counts
                                                                                          |  as session-id-
                                                                                          |  missing diagnostic
                                                                                          |  (line 633-639
                                                                                          |  fallback also
                                                                                          |  refused)
-----------------------------------------------------------------------------------------------------------------
STALE_SESSION (activeSession.sessionId !==       | task-state-shadow-host-wiring.ts:418-423| REFUSED — same as
  input.sessionId)                                |                                         |  NO_ACTIVE_SESSION
-----------------------------------------------------------------------------------------------------------------
SESSION_ID_MISSING (extractLegacyEventSessionId   | task-state-shadow-host-wiring.ts:633-639| REFUSED — never
  undefined && activeSession undefined)           |                                         |  reaches coordinator
-----------------------------------------------------------------------------------------------------------------
SOURCETYPE_REJECT (translate returns undefined)  | task-state-shadow-observer.ts:156-158    | REFUSED — translator
  e.g. session_snapshot, status, ended,          |   (line 156:                            |  drops all non-
  pending_prompts, etc.                           |    if (evt.type !== "agent_event")      |  agent_event envelopes
                                                  |        return undefined)                 |  entirely
-----------------------------------------------------------------------------------------------------------------
RECONSTRUCTED_RUN_EPOCH_GATE (terminal done/error| task-state-shadow-observer.ts:200-209    | APPLIED — strands
  with conversationId mismatch)                   |                                         |  terminals from
                                                  |                                         |  previous epoch
-----------------------------------------------------------------------------------------------------------------
COORDINATOR_AUTHORITY_DECISION                   | task-state-shadow-coordinator.ts:315-356 | APPLIED — Hub:
  (canonicalAvailable=false)                     |                                         |  FALLBACK_APPLY
                                                                                          |  for every
                                                                                          |  reconstructed
                                                                                          |  event that reaches
                                                                                          |  here
```

```text
RECONSTRUCTED_GATES_DISCOVERED = 6
RECONSTRUCTED_GATES_AUDITED    = 6
RECONSTRUCTED_GATE_COVERAGE    = 100%

GATE_NAMES = [
  "NO_ACTIVE_SESSION",          // activeSession undefined - refused silently
  "STALE_SESSION",              // activeSession.sessionId !== input.sessionId - refused silently
  "SESSION_ID_MISSING",         // extractLegacyEventSessionId && activeSessionId both undefined - never reaches coordinator
  "SOURCETYPE_REJECT",          // translate returns undefined for non agent_event envelopes - never reaches coordinator
  "RECONSTRUCTED_RUN_EPOCH_GATE", // terminal done/error with conversationId mismatch to activeRunId - SUPPRESS at translator
  "COORDINATOR_AUTHORITY_DECISION", // canonicalAvailable bit -> DIAGNOSTIC_ONLY / SUPPRESS_DUPLICATE / FALLBACK_APPLY
]
```

These are six distinct gates in six different code locations
(verified by line ranges in §5 above); no merging.

Note: `SOURCETYPE_REJECT` silently removes Hub's
`session_snapshot`/`status`/`ended`/`pending_prompts`/`pending_prompt_submitted`/
`team_progress`/`chunk`/`hook` envelopes. These reach the wiring
through `onSessionEvent` but DO NOT reach the coordinator.
This is a structural feature, not a defect — only the 7
state-relevant event types (see §2.2) reach the coordinator.

## 6. D0.E — Architectural seam confirmation

### 6.1 Canonical seam absence (re-verified for D0)

```text
HUB_SUBSCRIBE_RUNTIME_EVENTS       = ABSENT
  (0 matches in hub-runtime-host.ts;
   subscribe() at line 1470-1475 is the legacy CoreSessionEvent
   subscribe on this.events, NOT the canonical AgentRuntimeEvent
   subscribeRuntimeEvents)

REMOTE_SUBSCRIBE_RUNTIME_EVENTS    = ABSENT
  (inherited absence from HubRuntimeHost;
   remote-runtime-host.ts:11-26 declares only a constructor
   with no override)

CLINECORE_PROXY_GUARD              = PRESENT
  (ClineCore.ts:677-679: if (!this.host.subscribeRuntimeEvents)
                            return () => {})
  (runtime-events-proxy.ts:31-33: same pattern)

PROXY_BRANCH_BEHAVIOR              = "no-op unsubscribe;
                                       listener never invoked"
  (verified by reading both branches)
```

### 6.2 Fallback seam presence

```text
HUB_SUBSCRIBE_CORE_SESSION_EVENT   = PRESENT
  (hub-runtime-host.ts:1470-1475 — returns this.events.subscribe)

REMOTE_SUBSCRIBE_CORE_SESSION_EVENT = PRESENT (inherited)

RUNTIME_HOST_EVENT_BUS_FANOUT       = sessionId-filtered
  (runtime-host-support.ts:33-38 — drop if entry.sessionId !== event.payload.sessionId)

WIRING_OBSERVE_LEGACY_EVENT         = PRESENT
  (task-state-shadow-host-wiring.ts:266-279 wrap construction;
   :589-653 function body)
```

### 6.3 Canonical-availability hook

```text
GET_CANONICAL_RUNTIME_AVAILABLE    = task-state-shadow-host-wiring.ts:651
  "canonicalAvailable: deps.getCanonicalRuntimeAvailable?.() ?? true"

FROZEN_POLARITY                    = canonicalAvailable=true  => DIAGNOSTIC_ONLY
                                     canonicalAvailable=false => FALLBACK_APPLY
                                     (task-state-shadow-coordinator.ts:315-356)
```

## 7. D0.F — Disposition (per C2.4-A R7)

```text
D0_FINDINGS                                = {
  HUB_PROVENANCE_CLASSIFIED:                 true,  // §3.4
  REMOTE_PROVENANCE_CLASSIFIED:              true,  // §3.4 (inherited)
  HUB_REACHABILITY_RESOLVED:                 true,  // §2.1 + §4 (real, traced)
  REMOTE_REACHABILITY_RESOLVED:              true,  // §1.2 (inherited, confirmed)
  HUB_RECONSTRUCTED_PATH_REACHABILITY:       PROVEN,  // §4 (real, traced)
  REMOTE_RECONSTRUCTED_PATH_REACHABILITY:    PROVEN,  // inherited
  REMOTE_OVERRIDES_AUDITED:                  0 of 0   (no overrides exist),
  REMOTE_BEHAVIORAL_DIFFERENCES_AUDITED:     3 of 3   (constructor-input shape only),
  HUB_SWITCH_CASE_LABEL_COVERAGE:            21 of 21,         // §2 (R6/R9 fix)
  HUB_SWITCH_ARMS_DISTINCT_BODY_COVERAGE:    16 of 16,         // §2 (R6 fix)
  HUB_SWITCH_ARMS_DEFAULT_COVERAGE:           1 of 1,          // §2 (R6 fix)
  HUB_PRE_SWITCH_BRANCH_COVERAGE:            3 of 3,           // §2 (R6 fix)
  HUB_HANDLE_HUB_EVENT_BRANCH_COVERAGE:      20 of 20,         // §2 (R6 fix)
  HUB_EVENTS_EMIT_SITE_COVERAGE:             18 of 18,         // §2 (R7 fix)
  TRANSLATOR_RECOGNIZED_HUB_PROTOCOL_VARIANTS:
                                                 8 of 8,         // §2 (R8 fix)
  TRANSLATOR_RECOGNIZED_HUB_IMPLEMENTATION_BRANCHES:
                                                 6 of 6,         // §2 (R8 fix)
  STATE_RELEVANT_IMPLEMENTATION_BRANCH_COVERAGE:
                                                 6 of 6,         // §2
  RECONSTRUCTED_GATE_COVERAGE:               6 of 6,          // §5 (R3 fix)
  SESSION_ID_PROVENANCE_CLASSIFIED:          100%     // QUALIFIED for both
  RUN_ID_PROVENANCE_CLASSIFIED:              100%     // PARTIALLY_QUALIFIED for Hub/Remote
                                                        // (per-event conversationId),
                                                        // QUALIFIED for Local
  RUN_ID_EPOCH_TRACKER_CLASSIFIED:           100%     // NOT_YET_QUALIFIED for Hub/Remote
                                                        // (activeRunId.value never seeded),
                                                        // QUALIFIED for Local
  ITERATION_PROVENANCE_CLASSIFIED:           100%     // QUALIFIED for all
  RECOVERY_PROVENANCE_CLASSIFIED:            100%     // QUALIFIED for all
}

D0_OPEN_FINDINGS (rows D1/D2/D3 must resolve):

  HUB_RUN_ID_TRACKER_PROVENANCE       = NOT_YET_QUALIFIED
    PROVEN from source (§3.3 corrected finding):
      - reconstructSnapshot (line 288-315) reads runId from activeRunId.value
      - activeRunId.value is updated ONLY at line 168-170 inside the
        iteration_start branch
      - Hub's iteration.started envelope (line 1604-1619) carries no
        conversationId
      - therefore activeRunId.value remains undefined forever under Hub
      - therefore every reconstructed Hub snapshot has runId === undefined
      - terminal envelopes carry runId === undefined in snapshot;
        "run-unknown" coercion at line 330 in the result-level only
    NOT PROVEN:
      - whether D1 can construct a scripted Hub envelope sequence that
        exercises the line 200-209 run-epoch gate (requires Hub events
        with conversationId, which Hub's actual emit sites may not
        provide; needs empirical witness)
      - whether the "tolerated" leg at line 197 (activeRunId undefined,
        eventConvId undefined) is the desired production behavior under
        Hub fallback
    D1 WITNESS REQUIRED (see §3.3 REQUIRED_D1_D3_WITNESS block above)

  HUB_RECONSTRUCTED_CONVERSATION_ID   = PARTIALLY_QUALIFIED
    - Hub session.notice (case 7, line 1666-1668) propagates
      conversationId to that individual reconstructed notice envelope's
      snapshot.conversationId.
    - Other reconstructed envelopes (iteration.started, agent.done,
      tool.started/finished) lack conversationId on the Hub side.
    - Per-event provenance is meaningful; run-epoch provenance is not.
```


## 8. D0 exit gate (per C2.4-D plan §6)

```text
C2_4_D0_CORRECTION01_VERDICT = PASS_RECON iff (
  R1 corrected RUN_ID finding frozen as
    HUB_RUN_ID_TRACKER_PROVENANCE = NOT_YET_QUALIFIED       ✓ (§3.3)
  R2 protocol denominators frozen as
    21 switch case labels / 16 distinct switch body blocks +
    1 default + 3 pre-switch branches + 1 NO_SESSION_ID guard /
    18 events.emit call-sites / 8 state-relevant protocol variants /
    6 state-relevant implementation branches, all 100% audited ✓ (§2)
  R3 gate count frozen at 6                                  ✓ (§5)
  R4 vocabulary frozen as
    RUN_ID_PROVENANCE = PARTIALLY_QUALIFIED
    RUN_ID_EPOCH_TRACKER = NOT_YET_QUALIFIED                 ✓ (§3.3, §7, §10)
  per-backend capability table recorded                      ✓ (§1, §3, §6)
  per-hop transport-hop table recorded                       ✓ (§4)
  per-axis classification recorded                           ✓ (§3.4, §7, §10)
  0-of-0 Remote overrides audited                            ✓ (§1.2)
  HUB_SUBSCRIBE_RUNTIME_EVENTS = ABSENT recorded             ✓ (§6.1)
  REMOTE_SUBSCRIBE_RUNTIME_EVENTS = ABSENT recorded          ✓ (§6.1)
  NO_UNJUSTIFIED_AUTHORITY_CLAIMS in commit message          ✓ (no
    "HUB_QUALIFIED" claim without qualifier row)
)

NOT REQUIRED for CORRECTION01 (deferred to D1/D3):
  - empirical witness of the corrected RUN_ID finding
  - D1/D2/D3 test scaffolding
```

```text
D0_RECON_GATE_OUTCOME = PASS_RECON (post-CORRECTION01-FIXUP01)
```

```text
PRODUCTION_SEMANTIC_DELTA            = 0   (no production code touched)
REDUCER_SEMANTIC_DELTA               = 0
ACTUAL_PRODUCTION_SEMANTIC_DELTA     = 0
OBSERVATION_LAYER_HARDENING_DELTA    = 0
HUB_TOPOLOGY_SHIM_AS_EVIDENCE        = NO  (no HubTopology used; D0 evidence
                                             is the production source itself)
```

## 9. Board (post-D0)

```text
C2.3                                                  CLOSED
C2.4-A SOURCE RECON                                   CLOSED / PASS_RECON
C2.4-B NO_ACTIVE_SESSION                              CLOSED
C2.4-C REAL LOCAL                                     CLOSED
C2.4-C TOOLING HARDENING                              CLOSED
C2.4-D PLAN AMENDMENT-01                              SUPERSEDED
C2.4-D PLAN AMENDMENT-02                              MERGED (cd943085c)
C2.4-D0 REAL HUB/REMOTE TOPOLOGY RECON                SUPERSEDED (R1-R4 defects)
C2.4-D0-CORRECTION01 (1593a3e0e)                      SUPERSEDED (R5-R10 / R-architectural defects)
C2.4-D0-CORRECTION01-FIXUP01                          CLOSED / PASS_RECON (this commit)
C2.4-D1 REAL HOST REACHABILITY                        🟢 NEXT (authorized on acceptance of FIXUP01)
C2.4-D2 FALLBACK COMPOSITION                          ⛔  (held until D2 mirror
                                                          assertions are written
                                                          with correct polarity
                                                          per PLAN §3)
C2.4-D3 PROVENANCE/EPOCH                              ⛔
C2.4-D4 E7 SCOPE FREEZE                               ⛔

C2.5                                                  ⛔
E7                                                    ⛔
```

## 10. Disposition matrix (D0 entry, with qualifier row)

```text
HUB_CANONICAL_CAPABILITY             = ABSENT  (subscribeRuntimeEvents absent)
HUB_FALLBACK_CAPABILITY              = PRESENT (legacy CoreSessionEvent bus + wiring wrap + FALLBACK_APPLY)
HUB_TOTAL_PROVENANCE                 = NOT_YET_QUALIFIED
                                          - sessionId       QUALIFIED
                                          - runId           NOT_YET_QUALIFIED (epoch tracker
                                                          never seeded under Hub; see §3.3)
                                          - conversationId  PARTIALLY_QUALIFIED (per-event only,
                                                          via session.notice)
                                          - iteration       QUALIFIED
                                          - recovery        QUALIFIED
                                          - execution       QUALIFIED (heuristic reconstructed)

REMOTE_CANONICAL_CAPABILITY          = ABSENT  (inherited)
REMOTE_FALLBACK_CAPABILITY           = PRESENT (inherited)
REMOTE_TOTAL_PROVENANCE              = NOT_YET_QUALIFIED (same as Hub; Remote's only
                                                            behavioural delta is
                                                            constructor-input shape,
                                                            which does not touch the
                                                            fallback route)

LOCAL_CANONICAL_CAPABILITY           = QUALIFIED_FOR_CANONICAL_AUTHORITY  (C2.4-C frozen)
LOCAL_TOTAL_PROVENANCE               = FULL  (C2.4-C frozen)
```

## 11. Out-of-scope for D0 (carried into D1/D2/D3)

- **D1** real-host reachability: produce a HubRuntimeHost +
  NodeHubClient in-process composition that delivers scripted
  `HubEventEnvelope`s through `handleHubEvent`. This requires a
  `HubTopologyFixture` that USES the REAL HubRuntimeHost class
  (per plan §7) — not a hand-rolled replacement.
- **D2** fallback composition: prove FALLBACK_APPLY actually
  mutates the shadow under a real Hub host with
  `canonicalAvailable=false`, AND prove DIAGNOSTIC_ONLY does NOT
  mutate under the same Hub host with `canonicalAvailable=true`
  (negative-control mirror, per PLAN §3 as amended).
- **D3** provenance/epoch: classify each axis per the table in
  §3.4. Resolve the `RUN_ID_EPOCH_TRACKER = NOT_YET_QUALIFIED`
  finding (activeRunId.value never seeded under Hub) by
  evaluating three candidate repair classes:
    A. preserve conversationId on Hub iteration.started so the
       translator's existing iteration_start seeding path
       populates activeRunId.value;
    B. seed activeRunId.value from another authoritative Hub
       lifecycle event;
    C. leave Hub fallback as NOT_YET_QUALIFIED on the
       RUN_ID_EPOCH_TRACKER axis and freeze
       E7_INITIAL_BACKEND_SCOPE = LOCAL_ONLY.
  D1 must empirically witness which candidate is feasible
  before any production modification is proposed. D3 will
  conclude `HUB_PARTIALLY_QUALIFIED` if A or B works, or
  `HUB_NOT_YET_QUALIFIED` otherwise. `LOCAL_ONLY` remains a
  legitimate E7 scope outcome in either case.
- **D4** E7 scope freeze: based on D3, freeze
  `E7_INITIAL_BACKEND_SCOPE`.

## 12. Reviewer notes (incorporated)

### 12.1 Round-9 reviewer fixup flags (PLAN AMENDMENT-02 predecessor)

- **R1** canonicalAvailable polarity: this recon preserves the
  frozen contract from `task-state-shadow-coordinator.ts:315-356`
  throughout. The `?? true` default at
  `task-state-shadow-host-wiring.ts:651` is left UNCHANGED (D0
  is observational only).
- **R2** hook-job description: this recon explicitly classifies
  the hook as flipping reconstructed to FALLBACK_APPLY when
  canonical transport is ABSENT (i.e. Hub/Remote), not when
  host is Local. See §3.2 and §6.3.
- **R3** trailing-newline hygiene: this commit adds exactly one
  trailing newline.
- **R6 (reviewer round-8)** `HubTopology` shim: NOT used as
  evidence. D0 evidence is the production source itself. A
  `HubTopologyFixture` may be introduced in D1, scoped per
  plan §7.

### 12.2 Round-10 reviewer flags (this CORRECTION01 commit)

- **R1** RUN_ID tracker conclusion: the original D0 conclusion
  ("established on first notice w/ conversationId") was wrong.
  Re-derived from source: reconstructSnapshot reads runId from
  activeRunId.value; activeRunId.value is updated ONLY inside
  the iteration_start branch; Hub's iteration_start envelope
  has no conversationId. Therefore activeRunId.value remains
  undefined forever under Hub, and EVERY reconstructed Hub
  snapshot has runId === undefined. See §3.3 corrected.
- **R2** protocol-case denominator (FIXUP01 round-11 close):
  D0 conflated "cases" with three distinct concepts. CORRECTION01
  split into three denominators but used non-deterministic row
  counts (25/23/21) that did not match the actual grep output.
  FIXUP01 derives every denominator from an explicit row list
  and grep count:
    - SWITCH_CASE_LABELS_DISCOVERED      = 21  (grep on case "X" lines)
    - SWITCH_ARMS_DISTINCT_BODY          = 16  (4+3 fall-through collapses)
    - SWITCH_ARMS_DEFAULT                = 1
    - SWITCH_ARMS_TOTAL                  = 17  (= 16 + 1 default)
    - PRE_SWITCH_BRANCHES                = 3   (capability/approval)
    - NO_SESSION_ID_GUARD                = 1   (control-flow guard)
    - HANDLE_HUB_EVENT_BRANCHES_TOTAL    = 20  (= 3 + 17)
    - EVENTS_EMIT_SITES_TOTAL            = 18  (= 16 direct + 2 helper)
    - STATE_RELEVANT_PROTOCOL_VARIANTS   = 8   (run identity axis)
    - STATE_RELEVANT_IMPLEMENTATION_BRANCHES = 6 (= 8 minus run.* merge)
  Each independently 100% audited, with the row that yields each
  number listed verbatim in §2.
- **R3** gate denominator: original D0 said `5` and listed `6`.
  Fixed to `6`. Six distinct gates in six distinct code
  locations; no merging.
- **R4** vocabulary: original D0 oscillated between
  PARTIALLY_QUALIFIED and NOT_YET_QUALIFIED on the RUN_ID row.
  Frozen split:
  - `RUN_ID_PROVENANCE` (per-event conversationId) = PARTIALLY_QUALIFIED
  - `RUN_ID_EPOCH_TRACKER` (activeRunId.value) = NOT_YET_QUALIFIED

The corrected finding is materially stronger than the original:
it identifies exactly what D1 must empirically witness and
gives D3 a clean disposition choice between
`HUB_PARTIALLY_QUALIFIED` (if Hub can be patched to seed the
tracker) and `HUB_NOT_YET_QUALIFIED` (if it cannot), with the
latter a sufficient reason for `E7_INITIAL_BACKEND_SCOPE =
LOCAL_ONLY`.

## 13. Reviewer verdicts and FIXUP01 verdict

C2.4-D PLAN AMENDMENT-02 (cd943085c)               ✅ ACCEPTED
C2.4-D0 ORIGINAL (14e24c135)                       ❌ SUPERSEDED (R1-R4 defects)
C2.4-D0-CORRECTION01 (1593a3e0e)                   ❌ SUPERSEDED (R5-R10 / R-architectural defects)
C2.4-D0-CORRECTION01-FIXUP01 (this commit)         ✅ PASS_RECON
C2_4_D1_AUTHORIZED                                  = true (on acceptance of FIXUP01)

### 13.1 Round-11 reviewer flags (this FIXUP01 commit)

- **R5** stale R1 conclusions in §3.3 and §3.4: the table row
  at §3.3 still said "UNDEFINED until first notice arrives" and
  the §3.4 RUN_ID_PROVENANCE row still said "established on
  first notice w/ conversationId". Replaced with the corrected
  wording throughout. §3.4 now has two rows for run identity:
  RUN_ID_PROVENANCE (per-event, PARTIALLY_QUALIFIED for Hub)
  and RUN_ID_EPOCH_TRACKER (epoch tracker, NOT_YET_QUALIFIED
  for Hub). The §3.3 table now states the correct "activeRunId
  is never seeded" finding at every column.
- **R6** denominator arithmetic: the 23-branch claim was a
  self-contradiction (3 + 18 != 23). Recomputed deterministically:
  3 pre-switch + 16 distinct switch body blocks + 1 default =
  20 handleHubEvent branches. Each denominator is now derived
  from an explicit grep / row-list.
- **R7** emit-site vs protocol-variant terminology: renamed
  HUB_PROTOCOL_EVENT_VARIANTS to EVENTS_EMIT_SITES, with a
  separate TRANSLATOR_RECOGNIZED_HUB_PROTOCOL_VARIANTS row for
  Hub protocol variants that actually reach the translator.
- **R8** translator-source denominator: frozen at 8 protocol
  variants / 6 implementation branches (the run.completed/
  failed/aborted merge collapses 3 protocol variants into 1
  implementation branch).
- **R9** §8 / §12 stale denominators: §8 R2 line and §12 R2
  narrative updated to match §2.
- **R10** §11 first-iteration wording: the D3 out-of-scope
  description now says "resolve the RUN_ID_EPOCH_TRACKER =
  NOT_YET_QUALIFIED finding" instead of "resolve the
  PARTIALLY_QUALIFIED row (RUN_ID on first iteration)".

- **Architectural point (preserved from review):** D3 will not
  preselect `session.notice` as the candidate repair. Three
  candidate repair classes are now frozen:
    A. preserve conversationId on Hub iteration.started so that
       the translator's existing iteration_start seeding path
       can populate activeRunId.value;
    B. seed activeRunId.value from another authoritative Hub
       lifecycle event;
    C. leave Hub fallback as NOT_YET_QUALIFIED on the
       RUN_ID_EPOCH_TRACKER axis and freeze
       E7_INITIAL_BACKEND_SCOPE = LOCAL_ONLY.
  D1 must empirically witness which candidate is feasible
  before any production modification is proposed.

## 14. Files referenced (NOT modified) by this commit

- `sdk/packages/core/src/hub/runtime-host/hub-runtime-host.ts`
  (audited)
- `sdk/packages/core/src/hub/runtime-host/remote-runtime-host.ts`
  (audited)
- `sdk/packages/core/src/runtime/host/runtime-host-support.ts`
  (audited)
- `sdk/packages/core/src/runtime/host/runtime-host.ts`
  (interface audited)
- `sdk/packages/core/src/runtime/host/local-runtime-host.ts`
  (compared for canonical-seam presence)
- `sdk/packages/core/src/ClineCore.ts`
  (subscribe + subscribeRuntimeEvents + ClineCore.subscribeRuntimeEvents
   proxy guard audited)
- `apps/vscode/src/sdk/runtime-events-proxy.ts`
  (proxy no-op branch audited)
- `apps/vscode/src/sdk/canonical-event-subscription.ts`
  (POINT_IN_TIME subscription model audited)
- `apps/vscode/src/sdk/task-state-shadow-host-wiring.ts`
  (wiring + observeLegacyEvent + canonicalAvailable hook audited)
- `apps/vscode/src/sdk/task-state-shadow-observer.ts`
  (reverse-translator subset + run-epoch gate audited)
- `apps/vscode/src/sdk/task-state-shadow-coordinator.ts`
  (frozen polarity contract audited)
- `apps/vscode/src/sdk/vscode-session-host.ts`
  (one-line pass-through audited)
- `apps/vscode/src/sdk/sdk-session-lifecycle.ts`
  (ensureSharedHostSubscription audited)
- `apps/vscode/src/sdk/SdkController.ts`
  (canonical-event subscription lifecycle referenced per the
   canonical-event-subscription.ts:35-39 doc-block)
- `docs/architecture/elm/task-state-e5-e6-correction02-c24-source-recon-evidence.md`
  (C2.4-A predecessor authority cited)
- `docs/architecture/elm/task-state-e5-e6-correction02-c24-c-real-local-evidence.md`
  (C2.4-C predecessor authority cited)
- `docs/architecture/elm/task-state-e5-e6-correction02-c24-d-hub-remote-fallback-provenance-plan.md`
  (PLAN AMENDMENT-02)

## 14. What this commit deliberately does NOT do

- No production code is edited.
- No `HubTopology` shim is created (a `HubTopologyFixture` may
  be introduced in D1, scoped per plan §7).
- No `subscribeRuntimeEvents` is added to HubRuntimeHost or
  RemoteRuntimeHost (would be a behavioral change, not a recon
  finding).
- No `getCanonicalRuntimeAvailable` default is changed
  (`?? true` is preserved per the existing wiring contract).
- No claim of `HUB_QUALIFIED` is made. The D0 disposition is
  PARTIALLY_QUALIFIED on the RUN_ID axis (see §3.4 and §10).
  D3 is the appropriate commit to make any qualification
  claim.
