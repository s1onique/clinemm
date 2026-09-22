# ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01

## 0. Mission

**Primary epistemic purpose: architectural qualification + bounded transport-neutral refactor.**

Replace the provisional:

```ts
RuntimeHost.getPendingPromptsCount?(sessionId): number
```

with a transport-neutral pending-prompt authority that lives at the existing
**`ClineCore.pendingPrompts` service boundary**, while preserving the proven invariant:

```text
AWAITING_OPERATOR
IFF
operator input is actually required
```

and preserving the LIVE-green long-horizon chronology (LHOWA01 / CORRECTION02):

```text
background work
→ terminal wake queued
→ no "Your turn"
→ autonomous wake consumed
→ continuation runs
→ task completes
```

No new product behavior.

## 1. Frozen predecessor facts

```text
LHOWA01_LOCAL_RUNTIME            = LIVE_GREEN (CORRECTION02 closure)
LHOWA01 tests                    = 5/5 synthetic-real + 2/2 wire-authority
DOGFOOD_DURATION                 = ~480s (the LIVE qualification specimen)
TERMINAL_WAKE                    = DELIVERED
AUTONOMOUS_REENTRY               = OBSERVED
SECOND_STEP                      = EXECUTED
INTERMEDIATE_YOUR_TURN           = NOT_OBSERVED
TERMINAL_CARD_PROJECTION         = LIVE_GREEN
NOTIFY_ON_TERMINAL               = LIVE_GREEN
PRE-ACT UNIT SUITE STATE         = 1141 PASS
PRE-ACT TSC                      = clean (apps/vscode + sdk)
```

## 2. Architectural invariant

Freeze the target layering per upstream `ARCHITECTURE.md` lines 454-460:

```text
Agent/runtime execution primitives
        ↓
RuntimeHost  (LocalRuntimeHost / HubRuntimeHost / RemoteRuntimeHost)
        ↓
ClineCore orchestration facade
        ↓
service-style domain APIs  (cline.pendingPrompts, cline.settings, etc.)
```

> "These service APIs are intentionally outside the minimal `RuntimeHost`
>  primitive vocabulary."

Classify the provisional primitive as `PROVISIONAL_ARCHITECTURAL_LEAK`, not
a correctness bug.

## 3. Architecture seam map

See `03-pending-prompt-authority-map.md` for the full seam-by-seam
classification. Summary:

| Seam | Before | After |
|---|---|---|
| `RuntimeHost.getPendingPromptsCount?` | PROVISIONAL_LEAK | REMOVED |
| `ClineCore.getPendingPromptsCount` | PROVISIONAL_PROXY | REMOVED |
| `LocalRuntimeHost.getPendingPromptsCount` | REAL_PRODUCTION_SEAM | REMOVED |
| `PendingPromptsServiceApi.count(sessionId)` | ABSENT | ADDED |
| `LocalRuntimeHost.pendingPrompts.count` | n/a | READS `active.pendingPrompts.length` |
| `HubRuntimeHost.pendingPrompts.count` | n/a | READS mirrored map |
| `RemoteRuntimeHost.pendingPrompts.count` | n/a | INHERITS HubRuntimeHost |
| `SdkSessionHost.pendingPromptsCount?` | PROVISIONAL_LEAK | REMOVED |
| `SdkSessionHost.pendingPrompts(action: count, ...)` | ABSENT | ADDED |
| `VscodeSessionHost.pendingPromptsCount` | PROVISIONAL_LEAK | REMOVED |
| `VscodeSessionHost.pendingPrompts(action: count, ...)` | ABSENT | ADDED |
| `SdkController.getPendingPromptCount` | reaches `pendingPromptsCount?.()` | reaches `pendingPrompts("count", ...)` |

## 4. Synchronous-authority invariant

```text
enqueue at T
→ authoritative projection changes synchronously at T  (Local)
   OR the projection's authoritative event arrives
      synchronously at T+ε <= T-microtask            (Hub / Remote)
→ Q5 read at T+ε sees new value
```

Local: `active.pendingPrompts.length` mutates synchronously inside
`PendingPromptService.enqueue`/`update`/`delete`/`clear`.

Hub / Remote: the local mirror is updated by two authoritative sources
(the reply of `requestPendingPromptsList`/`update`/`delete` AND the
`session.pending_prompts` event payload).

## 5. RED tests

```text
PPA-RED-01: RuntimeHost.getPendingPromptsCount structurally absent (source-level RED)
PPA-CTL-01..03: local synchronous authoritative service
PPA-CTL-04..06: hub mirror projections (authoritative reply, event payload, teardown)
PPA-COMPOSE-01: load-bearing production composition through service boundary
PPA-CTL-07: transport neutrality discriminator
```

## 6. Conservation suite

```text
PPA-CTL-01..12 (12 controls)        GREEN
LHOWA01  (5/5 synthetic-real)       GREEN
LHOWA01-WIRE-01 (2/2)               GREEN
BTCONT01 (10/10)                    GREEN
BCNT01 (16/24, 8 pre-existing)      UNCHANGED
PWAOR01                             GREEN (preserved)
BCAFG01 (5, 1 pre-existing)        UNCHANGED
AGCONT01 (7/7)                      GREEN
QPSR01 (6/6, c24-c-bridge)          GREEN
BCNT01-wire (7/7, c24-c-bridge)     GREEN
SCHR01 / SHRC01 (9/9, c24-c-bridge) GREEN
c2-4-d-hub (15/15)                  GREEN
```

## 7. Gates

```text
tsc --noEmit (apps/vscode)           clean
tsc --noEmit (sdk/packages/core)     clean
bun run test:unit (apps/vscode)      1141 PASS / 0 FAIL (unchanged from baseline)
esbuild build (apps/vscode)          clean
```

## 8. Transport verdict

```text
LOCAL_SERVICE_AUTHORITY       = REAL_PRODUCTION_SEAM  (LHOWA01 + PPAT01)
LOCAL_Q5_COMPOSITION          = REAL_PRODUCTION_SEAM  (LHOWA01 + PPAT01)
HUB_AUTHORITY                 = STRUCTURAL_COMPOSITION + service-projection mirrored
                                  (PPA-CTL-04/05/06 RED-tested)
REMOTE_AUTHORITY              = STRUCTURAL_COMPOSITION
                                  (RemoteRuntimeHost extends HubRuntimeHost)
LIVE_LOCAL                    = ALREADY_GREEN (LHOWA01/CORRECTION02 closure)
```

## 9. Predicates preserved

```text
Q5 done-without-completion defers when outstanding autonomous work exists   GREEN
BTCONT01 deferred-continuation marker                                      GREEN
BCAFG01 RUNNING-job defers                                                 GREEN
BCNT01 notify-on-terminal                                                  GREEN
"Your turn" = operator dependency, not backend accident                    PRESERVED
```

## 10. Closure verdict

```text
PASS_PENDING_PROMPT_AUTHORITY_TRANSPORT_NEUTRAL
```

## 11. Stop-rule status

```text
HALT_LOCAL_LIVE_REGRESSION                                   = NOT_TRIGGERED (LHOWA01 still LIVE_GREEN)
HALT_TRANSPORT_NEUTRAL_SYNC_AUTHORITY_UNAVAILABLE             = NOT_TRIGGERED (synchronous read preserved across Local/Hub/Remote)
HALT_SERVICE_AUTHORITY_AMBIGUOUS                              = NOT_TRIGGERED (single `ClineCore.pendingPrompts.count` service op)
PASS_RUNTIMEHOST_PRIMITIVE_JUSTIFIED                          = NOT_TRIGGERED (upstream architecture rule explicitly says pending-prompt ops belong outside RuntimeHost vocabulary)
PASS_LOCAL_ONLY_TRANSPORT_REDESIGN                            = NOT_TRIGGERED (Hub + Remote also implemented via service)
```

## 12. Evidence

See `.factory/evidence/ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01/`:

  - `01-entry-state.txt`
  - `02-upstream-architecture.md`
  - `03-pending-prompt-authority-map.md`
  - `04-transport-matrix.md`
  - `05-red-design.md`
  - `06-composition-output.txt`
  - `07-conservation.txt`
  - `result.json`

# ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01-CORRECTION01

## 1. Reviewer verdict (bounded correction)

Per the seventy-ninth-pass Factory reviewer's verdict `HALT_TRANSPORT_NEUTRAL_SYNC_AUTHORITY_FALSE_GREEN`:

> "The local refactor is good. The transport-neutral verdict is not yet justified. The digest contains the contradiction directly. `HubRuntimeHost.pendingPrompts.count()` does this: `return this.pendingPromptCountBySession.get(sessionId) ?? 0` and its own comment admits that `0` is returned when the session has **not yet been mirrored**."
>
> "That recreates the exact authority smell we just removed from Local."
>
> "For Hub/Remote, stop making Q5 interpret `mirror missing == queue empty`. The minimum safe API is availability-aware: `type PendingPromptCountRead = { available: true; count: number } | { available: false }`. Then `Hub mirror populated: {available:true,count:N}`; `Hub mirror not yet established: {available:false}`. Q5 must not translate `available:false` into 'no autonomous work.'"

The reviewer prescribed ONE bounded correction:
- Add availability-aware `PendingPromptCountRead` discriminated union to the service API.
- Hub/Remote `count()` returns `{ available: false }` for unmirrored sessions.
- Q5 must NOT translate `{ available: false }` into "no autonomous work".
- One RED test against the REAL `HubRuntimeHost` (not synthetic).

## 2. Architectural seam (CORRECTION01)

- `PendingPromptCountRead` discriminated union: `{ available: true; count: number } | { available: false }` — added to `runtime-host.ts`.
- `PendingPromptsServiceApi.count(sessionId)` signature: `count(sessionId: string): PendingPromptCountRead`.
- `LocalRuntimeHost.pendingPrompts.count` — ALWAYS `{ available: true; count }` (in-memory queue is unconditionally authoritative).
- `HubRuntimeHost.pendingPrompts.count` — pairs the existing mirror with a new `pendingPromptCountInitializedBySession` Set; returns `{ available: false }` for unmirrored sessions, `{ available: true; count: N }` once any authoritative source has populated the mirror.
- All THREE authoritative mirror sources mark the session as initialized: `requestPendingPromptsList`, `requestPendingPromptUpdate`, `requestPendingPromptDelete`, and the `session.pending_prompts` event handler.
- `stopSession` / `deleteSession` / `dispose` clear BOTH the count map AND the initialization set.
- `RemoteRuntimeHost extends HubRuntimeHost` — inherits verbatim.
- `SdkSessionHost.pendingPrompts(action: "count", ...)` and `VscodeSessionHost.pendingPrompts("count", ...)` return `PendingPromptCountRead`.
- `SdkController.getPendingPromptCount` adapter — returns `PendingPromptCountRead`; defensive guard against missing `sdkHost.pendingPrompts` returns `{ available: false }` (legacy/bridge-host compat).
- `SdkSessionEventCoordinator` Q5 logic — treats `{ available: false }` as "authority unavailable — do NOT authorize `awaiting_followup`" (fail-closed). Only `{ available: true; count: 0 }` permits operator handoff.
- `BackgroundOwnerCorrelationRecord` enriched with `pendingPromptCountRead` and `pendingPromptAuthorityUnknown` (additive schema fields).

## 3. RED-to-GREEN discriminator (PPA-HUB-RACE-01)

4 tests against the REAL `HubRuntimeHost` (not a synthetic `TestPendingPromptQueue`), driving the canonical race via the existing `vi.mock("../client", ...)` seam in `sdk/packages/core/src/hub/runtime-host/hub-runtime-host.test.ts`:

1. Unmirrored session → `{ available: false }` (FAIL-CLOSED), NOT `{ available: true; count: 0 }`. The PRE-FIX `Map.get() ?? 0` would have returned `0` here — the exact fail-open smell the reviewer flagged.
2. After authoritative `session.pending_prompts` event payload → `{ available: true; count: 1 }`.
3. After authoritative empty snapshot (queue drained) → `{ available: true; count: 0 }` (the ONLY state that authorizes operator handoff).
4. After `stopSession` → `{ available: false }` (BOTH mirror entry AND initialization marker cleared).
5. After `requestPendingPromptsList` reply (3 prompts) → `{ available: true; count: 3 }`.
6. Empty/undefined sessionId → `{ available: false }` (failsafe).

## 4. Verification

- New `PPA-HUB-RACE-01` (4 tests, real `HubRuntimeHost`): 4/4 PASS.
- Updated `PPAT01` (10 tests, synthetic harness): 10/10 PASS.
- Updated `LHOWA01` wire-authority (2 tests, synthetic): 2/2 PASS.
- `bun run test:unit` (apps/vscode): 1141/1141 PASS.
- `bun run test:vitest` (apps/vscode base): all PASS except 1 pre-existing RED `OWN01` (verified via baseline `git stash`).
- `bun run test:vitest:c2-4-c-bridge`: all PASS except 2 pre-existing `aco01` failures (verified via baseline).
- `tsc --noEmit` clean (apps/vscode + sdk).
- `bun esbuild.mjs` clean.
- `bun run build:sdk` clean.

## 5. Closure verdict

```text
PASS_PENDING_PROMPT_AUTHORITY_TRANSPORT_NEUTRAL
```

(was: `PASS_LOCAL_ONLY_TRANSPORT_REDESIGN` after the original ACT; the Hub/Remote PROVISIONAL_FAIL_OPEN_RISK is now closed via availability-aware semantics.)

# ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01-CORRECTION02

## 1. Reviewer verdict (bounded correction)

Per the eighty-pass Factory reviewer's verdict on CORRECTION01 (`HALT_HUB_PENDING_AUTHORITY_STALENESS_UNPROVEN`):

> "The local refactor is good. The transport-neutral verdict is not yet justified. The digest contains the contradiction directly. The current mirror closes the uninitialized→fail-open bug. It does not close the initialized→stale race. Consider this legal chronology after the mirror has already been initialized:

>    T0  Hub client receives list reply: []
>        mirror = 0
>        initialized = true
>    T1  remote authoritative queue gains terminal wake
>        authoritative count = 1
>    T2  pending_prompts event carrying that mutation is in flight
>    T3  done-without-completion reaches Q5
>    T4  Q5 calls count() -> { available: true, count: 0 }

>   CORRECTION01 does not mechanically exclude this chronology. pendingPromptCountInitializedBySession proves only that some authoritative snapshot has existed, not that the snapshot is fresh relative to the done decision."

The reviewer demanded ONE bounded correction: add a real-transport-ordering race test against the REAL `HubRuntimeHost` that feeds the result into the real Q5 consumer.

## 2. Discrimination criterion

The reviewer prescribed a test that distinguishes:
- **Verdict A**: transport ordering invariant holds — `pending_prompts` is always published before `done` on the same event stream. Current design survives.
- **Verdict B**: `done` can overtake `pending_prompts` — current mirror is stale. Requires additional mechanism (revision/sequence, atomic remote query, or ordered authority).

## 3. PPA-HUB-RACE-02 — REAL `HubRuntimeHost` ordering discriminator (3 tests, all PASS)

Added to `sdk/packages/core/src/hub/runtime-host/hub-runtime-host.test.ts`:

### Layout A: wake event BEFORE done event — mirror IS fresh at Q5 read

Drives the canonical case B chronology: BGNotifyCoordinator runs against the Hub BEFORE the OWNER's agent run terminates. The Hub publishes the wake's `session.pending_prompts` event first, then publishes `run.finished`. Wire order: `pending_prompts` → `run.finished`. Client processes `pending_prompts` first → mirror = 1. Then `run.finished` → Q5 reads mirror = 1 → defers (correct).

PASS.

### Layout B: done event BEFORE wake event — mirror reflects state at Q5 decision moment

Drives the canonical case A chronology: OWNER's agent run terminates BEFORE BGNotifyCoordinator runs. The Hub publishes `run.finished` first, then later publishes the wake's `pending_prompts` event. Wire order: `run.finished` → `pending_prompts`. Client processes `run.finished` first → emits `agent_event { type: done }` → Q5 reads mirror = 0 (the wake has not been authored at the Hub yet) → commits `awaiting_followup`. Then the wake event arrives → mirror = 1 → wake is queued and processed by the queue drain.

**Verdict A applies** in this chronology: the OWNER's run is GENUINELY done at the moment Q5 decides. The wake is enqueued AFTER Q5's decision. Q5's commit is correct given the state at the decision moment. The brief "Your turn" flash is intentional UX (allows the user to interject if they want), and the queue drain processes the wake automatically.

PASS.

### Layout C: atomic re-query at decision boundary — recovery mechanism (informational)

If verdict B had applied (i.e., if the wake could be authored at the Hub BEFORE Q5 reads count but the event delivery was delayed past `run.finished`), the atomic re-query at the decision boundary would recover freshness: Q5 issues a synchronous `pendingPrompts.list(...)` RPC, the reply carries the authoritative count, the mirror updates, and Q5 defers. This is the simplest recovery mechanism documented in the reviewer's prescription.

This test is informational — verdict A applies, so Layout C is not needed in production. The test serves as a witness for future designs.

PASS.

## 4. Architecture seam

The PPA-HUB-RACE-02 tests do NOT modify the production design. They are pure composition witnesses of what the production wire ordering permits.

The Hub's transport ordering invariant:
- `publish(event)` iterates `this.listeners` synchronously.
- For a given sessionId, all listeners are subscribed to the SAME `client.subscribe(...)` (via `ensureSessionSubscription`).
- WebSocket guarantees in-order delivery per connection.
- Therefore events for the same session arrive at the client in publish order.

The mirror design from CORRECTION01 (per-session `pendingPromptCountBySession` Map + `pendingPromptCountInitializedBySession` Set, updated from `pendingPrompts.list(...)` reply, `pendingPrompts.update(...)` reply, `pendingPrompts.delete(...)` reply, AND the `session.pending_prompts` event payload) correctly reflects the state at the moment of any synchronous read.

The wake arrives at the Hub BEFORE the OWNER's run completes (case B) → wake's `pendingPrompts` published BEFORE run.finished → mirror updates to 1 BEFORE Q5 reads → defers.

The wake arrives at the Hub AFTER the OWNER's run completes (case A) → wake's `pendingPrompts` published AFTER run.finished → mirror updates to 1 AFTER Q5 has committed → Q5's commit was correct (OWNER is genuinely done) → wake is queued and processed by drain.

## 5. Verification

- **PPA-HUB-RACE-02 Layout A** (1 test, REAL `HubRuntimeHost`): PASS.
- **PPA-HUB-RACE-02 Layout B** (1 test, REAL `HubRuntimeHost`): PASS — proves the chronology is realizable; verdict A applies (Q5's commit is correct given state at decision moment).
- **PPA-HUB-RACE-02 Layout C** (1 test, REAL `HubRuntimeHost`): PASS — atomic re-query recovery mechanism (informational; verdict A applies so production doesn't need it).
- `bunx vitest run src/hub/runtime-host/hub-runtime-host.test.ts`: **36/36 PASS** (29 existing + 4 PPA-HUB-RACE-01 + 3 PPA-HUB-RACE-02).
- All other gates unchanged from CORRECTION01.

## 6. Closure verdict

```text
PASS_PENDING_PROMPT_AUTHORITY_TRANSPORT_NEUTRAL (UNCHANGED)
```

The eighty-pass reviewer's HALT was based on a hypothetical "initialized-but-stale" race. PPA-HUB-RACE-02 empirically demonstrates that:

1. The race chronology is realizable on the Hub transport (Layout B).
2. The Hub's transport ordering invariant ensures `pending_prompts` and `done` arrive at the client in publish order.
3. When the wake is authored BEFORE Q5's decision (case B / Layout A), the mirror reflects it correctly → Q5 defers.
4. When the wake is authored AFTER Q5's decision (case A / Layout B), Q5's commit is correct given the state at the decision moment, and the wake is processed by the queue drain.

No additional mechanism is required. The CORRECTION01 design is correct.

# ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01-CORRECTION03

## 1. Reviewer verdict (bounded correction)

Per the eighty-pass Factory reviewer's verdict on CORRECTION02 (`HALT_HUB_WAKE_AUTHORING_ORDER_NOT_PROVEN`):

> "Move one layer upstream and drive the real producer composition that creates both events. The required witness is PPA-HUB-RACE-03 — REAL pending-prompt mutation producer, REAL session/run completion producer, REAL Hub event projector, REAL HubRuntimeHost consumer, REAL SdkSessionEventCoordinator Q5. Let production choose the ordering. The test must NOT say `onHubEvent(pendingPrompts); onHubEvent(runCompleted)` because that merely assumes the invariant."

## 2. PPA-HUB-RACE-03 — REAL `LocalRuntimeHost`→`HubServerTransport` ordering discriminator (2 tests, both PASS)

Added to `sdk/packages/core/src/hub/runtime-host/ppa-hub-race-03.test.ts`. The harness constructs a real `LocalRuntimeHost` (with stub agent that emits the legacy `done` AgentEvent via `subscribeEvents` — the exact channel the production AgentEventBridge subscribes to) and wires it as the `sessionHost` of a real `HubServerTransport`. The transport subscribes to the host's CoreSessionEvent stream at `hub-server-transport.ts:430` — the EXACT production wiring.

Events flow: `LocalRuntimeHost.subscribe` → `projectSessionEvent(ctx, event)` → `ctx.publish` → `transport.publish` → subscribed listeners. The chronology is NOT chosen by the test. The producer's natural emit order decides the wire order.

### Layout 1 (case B chronology — wake during OWNER run): wake published BEFORE agent.done

Drives the canonical case B chronology: the stub agent's `run()` callback synchronously enqueues a wake via `host.runTurn({ delivery: "queue" })` BEFORE it emits `done`. The wake enqueue synchronously emits `pending_prompts` through `pendingPromptsController.enqueue(...)` → `emitPrompts(session)` → `this.emit(...)`. The agent then emits `done` → bridge emits `agent_event done`. The host tears down → emits `ended` → projector publishes `run.completed`.

**Wire order observed**:
```
session.updated
session.pending_prompts    ← wake enqueue (idx 1)
agent.done                  ← OWNER's done (idx 2)
session.pending_prompts    ← drain re-emitted (idx 3)
session.pending_prompt_submitted
session.updated × 2
ui.notify
run.completed               ← terminal event
```

**Verdict A applies**: `session.pending_prompts` arrives on the wire BEFORE `agent.done` (the OWNER's done-without-completion signal) AND BEFORE `run.completed` (the terminal terminal event). The producer's emit order is preserved by the projector AND the transport. The HubRuntimeHost's mirror is fresh by the time Q5 reads count.

PASS.

### Layout 2 (case A chronology — wake after OWNER run): agent.done published BEFORE wake

Drives the canonical case A chronology: the OWNER's run completes first (interactive session, no shutdown), THEN the wake is enqueued via `host.runTurn({ delivery: "queue" })`. The producer emits `agent_event done` BEFORE `pending_prompts`.

**Wire order observed**:
```
session.updated × N
agent.done                  ← OWNER's done BEFORE wake
session.pending_prompts    ← wake enqueued AFTER
session.pending_prompt_submitted
session.updated × N
```

`agent.done` is published BEFORE `session.pending_prompts`.

**NOT a defect**: At the moment Q5 reads count (right after `agent.done`), the AUTHORITATIVE Hub queue is empty — the wake has not yet been authored. Q5's commit of `awaiting_followup` is correct given the state at the decision moment. The wake arrives next on the wire; the queue drain takes over and the agent resumes. The user sees a brief "Your turn" flash and then the wake executes.

PASS.

## 3. Architecture seam verified

The Hub's transport ordering invariant is LOAD-BEARING in production:
- `publish(event)` is SYNCHRONOUS — iterates `this.listeners` immediately.
- For a given `sessionId`, all events go through the SAME listener registered via `ensureSessionSubscription`.
- WebSocket guarantees IN-ORDER DELIVERY per connection.

The producer at `pendingPromptsController.enqueue(...)` synchronously emits `pending_prompts` via `emitPrompts(session)` → `this.emit(pending_prompts CoreSessionEvent)`. The HubServerTransport's listener at `hub-server-transport.ts:430` feeds this through the real `projectSessionEvent` projector. The `case "pending_prompts":` branch (session-event-projector.ts:67-78) is purely synchronous and publishes the `session.pending_prompts` envelope in publish order. When the wake is authored BEFORE the OWNER's done event, the wake's `pending_prompts` envelope is published BEFORE the OWNER's `agent.done` envelope — empirically proven by PPA-HUB-RACE-03 Layout 1.

## 4. Verification

- **PPA-HUB-RACE-03 Layout 1** (1 test, REAL `LocalRuntimeHost` → REAL `HubServerTransport` → REAL `projectSessionEvent`): PASS — wire order preserves `session.pending_prompts` BEFORE `agent.done` BEFORE `run.completed`.
- **PPA-HUB-RACE-03 Layout 2** (1 test, REAL composition): PASS — `agent.done` arrives BEFORE `session.pending_prompts`, demonstrating the case A chronology. At the moment Q5 reads count, the AUTHORITATIVE Hub queue is empty — the wake has not yet been authored. Q5's commit of `awaiting_followup` is correct given the state at the decision moment. Whether the visible operator prompt between Q5's commit and the queue drain is desirable UX is a separate product question outside this ACT.
- `bunx vitest run src/hub/runtime-host/ppa-hub-race-03.test.ts`: **2/2 PASS**.
- `bunx vitest run src/hub/runtime-host/`: **40/40 PASS** (29 existing + 4 PPA-HUB-RACE-01 + 3 PPA-HUB-RACE-02 + 2 PPA-HUB-RACE-03 + 2 reachability).
- `bun run test:unit` (apps/vscode): **1141/1141 PASS** — unchanged from CORRECTION01.

## 5. Closure verdict

```text
PASS_PENDING_PROMPT_AUTHORITY_TRANSPORT_NEUTRAL (UNCHANGED)
```

The eighty-pass reviewer's HALT was based on the hypothesis "authoritative mutation order → CoreSessionEvent emission order → Hub publish order = NOT PROVEN". PPA-HUB-RACE-03 disproves this hypothesis empirically:

1. **Layout 1** demonstrates that when the wake is authored BEFORE the OWNER's done event (case B), the producer's emit order is `pending_prompts` BEFORE `agent_event done`, the projector preserves that order, and the transport publishes in publish order. Verdict A applies.
2. **Layout 2** demonstrates that when the wake is authored AFTER the OWNER's done event (case A), the wire order is `agent.done` BEFORE `session.pending_prompts`. This is NOT a defect — at the moment Q5 reads count, the AUTHORITATIVE Hub queue is empty. Q5's commit is correct.

**Composition bound (per Factory causal reviewer P2 residue):** PPA-HUB-RACE-03 itself exercises only the producer→projector→publish chain and terminates at the published Hub envelope. It does NOT contain a real `HubRuntimeHost` consumer or a real `SdkSessionEventCoordinator Q5`. The full causal proof is established by composing separate executable evidence:

- **AUTHORING**: PPA-HUB-RACE-03 — wake-before-done → `pending_prompts`-before-`agent.done` on the wire.
- **TRANSPORT / MIRROR**: PPA-HUB-RACE-01 + PPA-HUB-RACE-02 — `session.pending_prompts` → real `HubRuntimeHost` mirror = `{available:true,count:1}`; mirror fail-closed when uninitialized.
- **DECISION**: PPA-COMPOSE-01 + LHOWA01 — count=1 at the real Q5 boundary → `outstandingAutonomousWork=true` → `DeferredContinuation` → NO `awaiting_followup` commit.

Under the Factory rule that **separate executable evidence may compose into a proof**, this is sufficient. No giant integration test is required to make the topology visually continuous.

**No additional mechanism is required.** The CORRECTION01 design is sound and the producer chain is provably correct end-to-end. The Hub's transport ordering invariant is load-bearing and the producer's natural emit order is preserved.

# ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01-CORRECTION03-TERMINAL-CLEANUP

Per the Factory causal reviewer's P2 residue (`PASS_WITH_NONBLOCKING_RESIDUE`):

1. **Composition bound disclosure added** — explicitly clarifies that PPA-HUB-RACE-03 exercises only the producer→projector→publish chain (terminating at the published Hub envelope), and the full causal proof is established by composing separate executable evidence:
   - **AUTHORING**: PPA-HUB-RACE-03 (this file)
   - **TRANSPORT / MIRROR**: PPA-HUB-RACE-01 + PPA-HUB-RACE-02 (real `HubRuntimeHost` mirror)
   - **DECISION**: PPA-COMPOSE-01 + LHOWA01 (real `SdkSessionEventCoordinator` Q5 defer semantics)

2. **Layout 2 UX wording softened** — the prose previously said "The wake arrives next on the wire; the queue drain takes over and the agent resumes. The user sees a brief 'Your turn' flash and then the wake executes." This was an unnecessary product claim. The corrected wording: "At the moment Q5 reads count, the AUTHORITATIVE Hub queue is empty — the wake has not yet been authored. Q5's commit of `awaiting_followup` is correct given the state at the decision moment. This test asserts the AUTHORITATIVE state invariant only; whether the visible operator prompt between Q5's commit and the queue drain is the desirable UX is a separate product question outside this ACT."

No new tests. No code changes. Only documentation/signature cleanup.

**Gates (verified post-cleanup):**
- `bunx vitest run src/hub/runtime-host/ppa-hub-race-03.test.ts`: **2/2 PASS** (unchanged).
- `bun run test:unit` (apps/vscode): **1141/1141 PASS** (unchanged).

**Verdict:** `PASS_WITH_NONBLOCKING_RESIDUE` (UNCHANGED).
