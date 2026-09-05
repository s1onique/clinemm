# 03 — F1 RECON: SAME_* discriminator (frozen) + selected outcome

> Captured 2026-09-05 at ENTRY_HEAD `b8d11710e`.
> Mode = RECON only; discriminator is judgment over already-captured chains
> (chains 1 + 2 in `01-normal-turn-chain.md` and `02-manual-compaction-chain.md`).
> NO production edit proposed in this file. The selected outcome gates the
> production edit that will follow in a separate ACT (F1-CHARACTERIZATION /
> F1-RED-GREEN).

## 3.1 Reviewer's sharpening (third-C1)

Per `Factory reviewer · runtime/state architect · compaction engineer`
(2026-09-05, PASS_F1_RECON_ENTRY), the load-bearing question is sharper
than the one previously highlighted about missing W:

> **After successful manual compaction, is there an authoritative
> runtime/session state field whose value becomes the returned
> `currentWorkingContextEstimate`, or is that number only a result of
> the one-shot compaction projection?**

The reviewer required me to mechanically trace four things in this file:

1. Does manual `compactSessionMessages()` mutate
   `AgentRuntimeStateSnapshot.currentWorkingContextEstimate` or any
   equivalent runtime-owned field?
2. Does it mutate persistent compaction/session state from which the
   next normal prepare-turn derives W?
3. Can an existing runtime subscription legitimately observe that
   mutation without inventing an event?
4. Is the manual W valid beyond the immediate post-compaction
   projection, i.e. until the next normal prepare-turn?

And to explicitly record a new sub-discriminator
(`ABSENCE_SEMANTICS_EQUAL`) under `SAME_SEMANTIC_STATE`.

## 3.2 Trace 1: manual compaction vs `AgentRuntimeStateSnapshot.currentWorkingContextEstimate`

**NO mutation of agents-owned state.**

- The only writer of `this.state.currentWorkingContextEstimate` in
  `@cline/agents` is the runtime itself at the prepare-turn boundary
  (`agent-runtime.ts:945`, inside `restore()` — resets to `undefined`).
  The runtime is what captures the producer's W into its own state when
  `prepareTurnForModelRequest` returns
  (`agent-runtime.current-working-context-state-bind.test.ts:5-9`:
  "captured verbatim from the producer-side `prepareTurn` return value
  at the prepare-turn boundary (NOT recomputed by the agent runtime)").
- `compactSessionMessages()` in `apps/vscode/src/sdk/sdk-compaction.ts:77-186`
  does **not** instantiate or invoke any `AgentRuntime`. It calls
  `createContextCompactionPrepareTurn({...}, { mode: "manual" })`
  directly (line 93-112), invokes the returned `compact(...)` function
  with a hand-built request (line 118-134), and returns
  `CompactSessionMessagesResult` to the caller. The W field on that
  result is just a value computed by the core producer seam
  (`publishWorkingContextEstimate` /
  `publishWorkingContextEstimateMetadataOnly`,
  `compaction.ts:824-915`) and surfaced by the producer's return value.
  It is never bound to an `AgentRuntime` instance.

**Verdict for trace 1: NO mutation of agents-owned state.**

## 3.3 Trace 2: persistent compaction/session state vs W

**YES — but only the message-level compaction artifact, NOT the runtime's W.**

- `compactSessionMessages()` returns
  `{ compacted: true, messages: result.messages,
     compactionState: createSessionCompactionState({...}),
     currentWorkingContextEstimate: result.currentWorkingContextEstimate }`
  (`sdk-compaction.ts:168-185`).
- `compactionState` is the **persistent compaction sidecar**
  (`createSessionCompactionState`, session-compaction-state model in
  `@cline/core`).
- The coordinator (`sdk-compaction-coordinator.ts:391+`) eventually
  persists this sidecar into the session. The next normal prepare-turn
  on that session will be a different producer call that ALSO
  independently recomputes W from the FINAL request shape
  (`publishWorkingContextEstimateMetadataOnly`,
  `compaction.ts:885-915`). The manual compaction's W is NOT cached
  anywhere that the next prepare-turn consults; it is one-shot
  projection data surfaced to the host for UI freshness, never re-read
  by the prepare-turn pipeline.
- The manual W is therefore "valid only until the next normal
  prepareTurn", as captured in chain 2 §2.3 and in
  `sdk-compaction.ts:62-66` ("the persistent top working-context bar
  updates at the same moment the divider does ... until the next
  message triggers a fresh prepareTurn").

**Verdict for trace 2: persistent message artifact yes; W no.**

## 3.4 Trace 3: can a runtime subscription legitimately observe the mutation?

**NO.**

- The only event type that propagates W is `working-context-state-changed`,
  emitted by `emitWorkingContextStateChangeIfChanged` in
  `agent-runtime.ts:1315-1347`. Its payload is
  `snapshot: this.snapshot(), previousWorkingContextEstimate: before`,
  i.e. it draws the W from `this.state.currentWorkingContextEstimate`.
- Because trace 1 is NO, manual compaction never sets that field. There
  is therefore no legitimate `working-context-state-changed` event
  emission path that could carry the manual W — fabricating one would
  require either (a) writing to `this.state.currentWorkingContextEstimate`
  from outside the runtime (a layering violation), or (b) emitting the
  event with a synthesized snapshot that lies about runtime state (a
  semantic violation; the event contract says
  `snapshot: this.snapshot()` because the runtime is the authority).

**Verdict for trace 3: cannot subscribe to the mutation, because the
mutation does not exist in the runtime's state domain.**

## 3.5 Trace 4: validity of manual W beyond the immediate projection

**YES, but with a precise lifetime.**

- The manual W is a fresh, deterministic estimate of the compacted
  working-context occupancy: it is computed by the SAME core producer
  helper (`publishWorkingContextEstimate` /
  `publishWorkingContextEstimateMetadataOnly`, `compaction.ts:824-915`)
  from the compacted message array, the same systemPrompt, and the same
  tool set. If we trust `publishWorkingContextEstimate` as the source of
  W in the normal path (we do — see
  `compaction.working-context-authority-publish.test.ts` and the
  STATE_BIND committed test), then this number is semantically the same
  W the next prepareTurn would have computed, modulo any user message
  appended between the compaction and the next prepareTurn.
- Therefore the manual W is *valid host-visible W for the compacted
  state*. Its lifetime is "until the next prepareTurn, at which point
  the runtime's own W computation supersedes it".

**Verdict for trace 4: YES, valid until next normal prepare-turn.**

## 3.6 Trace 5 (sub-discriminator): ABSENCE_SEMANTICS_EQUAL

The reviewer's sharpened question about absence semantics:

```
NORMAL_EVENT_ABSENCE_SEMANTICS   = ?
MANUAL_RESULT_ABSENCE_SEMANTICS  = ?
ABSENCE_SEMANTICS_EQUAL          = YES | NO
```

### 3.6.1 NORMAL_EVENT_ABSENCE_SEMANTICS

The `observe(event)` carrier code (`working-context-host-capture.ts:174-198`)
DOES carry an ASSIGNMENT contract:
> "Including `undefined` (normalized to `null` here) is the only way to
> propagate the runtime's fail-closed W lifetime to the host side.
> Stale-W reuse is FORBIDDEN."

But the runtime side dedups at the EMITTER (`agent-runtime.ts:1319`:
`if (before === after) return { willEmit: false, ... }`), and the runtime
ALWAYS writes a numeric value (the producer never returns `undefined`
for W from `publishWorkingContextEstimate`). So the assignment-event
contract on the host side is a **defensive normalization** that the
runtime's emit contract makes practically unreachable in production —
the runtime never emits a `working-context-state-changed` event with
`snapshot.currentWorkingContextEstimate === undefined` while the
runtime is alive. (It is reachable only on `restore()` at
`agent-runtime.ts:945`, which resets the field before the next emit.)

So in production, NORMAL_EVENT_ABSENCE_SEMANTICS reduces to
**"no event when W did not change"** — i.e. an optional-publication
contract at the boundary that observers care about.

### 3.6.2 MANUAL_RESULT_ABSENCE_SEMANTICS

`compactSessionMessages()` returns
`currentWorkingContextEstimate?: number` (`sdk-compaction.ts:68`).

Documented absence cases (`sdk-compaction.ts:54-67`):
> "undefined when the producer returned no W (legacy / pre-repair path)
> or when `compacted === false` (no projection to publish)."

The coordinator's guard (`sdk-compaction-coordinator.ts:582`):
```ts
if (typeof result.currentWorkingContextEstimate === "number") {
    this.options.publishPostCompactionW?.(result.currentWorkingContextEstimate)
}
```
skips `setLatest` when W is undefined. The carrier slot therefore keeps
its prior value (which, per `02-manual-compaction-chain.md` §2.5, is
typically the pre-compaction prepareTurn W — i.e. the LAST HOST-VISIBLE
AUTHORITATIVE W from the runtime event stream).

So MANUAL_RESULT_ABSENCE_SEMANTICS = **"no new W publication this
compaction; the prior runtime-emitted W remains authoritative"**.

### 3.6.3 ABSENCE_SEMANTICS_EQUAL?

```
NORMAL_EVENT_ABSENCE_SEMANTICS   = "no W change => no event => prior
                                    carrier slot stays"
MANUAL_RESULT_ABSENCE_SEMANTICS  = "no W publication => no setLatest =>
                                    prior carrier slot stays"
```

Both contracts preserve the prior carrier slot when no new value is
produced. They are NOT identical at the producer boundary (one is
dedup-on-equality at the runtime emitter; the other is guard-on-undefined
at the coordinator), but their **end-state effect on the carrier slot is
the same**: keep the prior authoritative value.

**ABSENCE_SEMANTICS_EQUAL = YES (at the carrier slot, not at the
producer boundary).** This is the property the F1 outcome must preserve.

## 3.7 Architectural prior (per third-C1)

The reviewer's prior:
> "core owns the persisted compaction artifact while agents owns the
> stateless runtime loop. That makes **Outcome B currently the
> architectural prior**, but only a prior, not the verdict."

Confirmed by `sdk/packages/README.md:13-16`:
- `@cline/agents`: stateless turn loop / runtime event emission
- `@cline/core`: stateful orchestration, session lifecycle/storage, context
  pipeline (compaction is core-owned; see also `sdk/ARCHITECTURE.md`)

The manual `compactSessionMessages` in `apps/vscode/src/sdk/sdk-compaction.ts`
calls into `@cline/core`'s `createContextCompactionPrepareTurn` (core
producer) and returns the result to a vscode-owned coordinator. The
normal `prepareTurnForModelRequest` call is wrapped by
`@cline/core`'s `createCompactionStateAwarePrepareTurn` (core producer)
and consumed by `@cline/agents`'s `AgentRuntime` (agents owner), which
binds W into its own state and emits the runtime event.

**Both chains consume the same core producer for W computation.** But the
OWNERSHIP of the resulting W is different:

- Normal chain: W is consumed by `AgentRuntime` (agents-owned) and bound
  to `state.currentWorkingContextEstimate` (agents-owned) before the
  runtime event fires (agents-owned).
- Manual chain: W is consumed by the coordinator (vscode-owned) and
  surfaced through `publishPostCompactionW` to the host carrier. The
  W is **NOT** bound to any `AgentRuntime` instance — it is a projection
  value, not runtime state.

## 3.8 Frozen discriminator table

| Discriminator                    | Answer | Load-bearing evidence |
| -------------------------------- | ------ | --------------------- |
| `SAME_SEMANTIC_STATE`            | YES    | Both represent host-visible working-context occupancy for the compacted transcript. Same producer (`publishWorkingContextEstimate` / `publishWorkingContextEstimateMetadataOnly` in `compaction.ts:824-915`) computes both. Same lifetime: "until the next normal prepare-turn" (chain 2 §2.3; `sdk-compaction.ts:62-66`). |
| `SAME_OWNER`                     | NO     | Normal: agents-owned (`state.currentWorkingContextEstimate`, `working-context-state-changed` event payload). Manual: vscode-owned (coordinator `publishPostCompactionW` callback projection value from core producer). The runtime is not invoked. Upstream: `@cline/core` owns compaction; `@cline/agents` owns the turn loop + runtime events (`sdk/packages/README.md:13-16`). |
| `SAME_EVENT_DOMAIN`              | NO     | `working-context-state-changed` is emitted by `AgentRuntime` from its OWN state (`agent-runtime.ts:1315-1347`); manual compaction does NOT mutate that state (trace 1) and CANNOT legitimately emit the event (trace 3). Fabricating one would require writing to `state.currentWorkingContextEstimate` from outside the runtime OR emitting a synthesized snapshot that lies about runtime state — both layering/semantic violations. |
| `ABSENCE_SEMANTICS_EQUAL`        | YES    | At the carrier slot: both contracts preserve the prior authoritative value when no new value is produced. NORMAL_EVENT_ABSENCE = dedup-on-equality at runtime emitter. MANUAL_RESULT_ABSENCE = guard-on-undefined at coordinator (line 582). Different producer-boundary contracts, same carrier-slot end-state. |
| `SHARED_PUBLICATION_SEAM_EXISTS` | NO     | No shared seam exists that would carry both. Normal publishes via the `working-context-state-changed` runtime event from `AgentRuntime`. Manual publishes via a coordinator `publishPostCompactionW` callback. The only candidate seam — synthesizing a runtime event from manual compaction — would require violating `agent-runtime.ts:945` (state bind) AND trace 3 (subscription legitimacy). |
| `SELECTED_OUTCOME`               | B      | See §3.9. |

## 3.9 Selected outcome: B (one carrier assignment primitive, two legitimate producer ingresses, do NOT fabricate event)

### 3.9.1 Why B and not A

Outcome A ("delete `setLatest` and route through the runtime event")
requires:

- Trace 1 to be YES (manual compaction would have to mutate
  `AgentRuntimeStateSnapshot.currentWorkingContextEstimate`). **It does not.**
- Trace 3 to be YES (a runtime subscription could observe the mutation).
  **It cannot — the mutation does not exist.**

Without those, A would require synthesizing a `working-context-state-changed`
event from outside the runtime, which:

1. Violates the event's contract (`snapshot: this.snapshot()` — runtime is
   authority).
2. Violates layering (writing to `AgentRuntime.state` from outside the
   runtime instance).
3. Lies to every other observer of `working-context-state-changed` (they
   would observe a W that was not the runtime's own computation).

A is therefore NOT justified by the source.

### 3.9.2 Why B and not C

Outcome C ("use a shared W publication seam exposed by core") requires a
shared seam to exist. **It does not.** The normal seam is `AgentRuntime`'s
runtime event (agents-owned); the manual seam is the coordinator's
`publishPostCompactionW` callback (vscode-owned). There is no third
seam in `@cline/core` that both chains could publish through. (The core
producer returns the W value as part of its prepareTurn result; it does
not publish it independently.)

C is therefore NOT justified by the source.

### 3.9.3 Why B and not B-prime

Outcome B-prime (`NOT_FACTORIZABLE_AS_SINGLE_EVENT_SOURCE`) is the
correct fallback when there is no shared carrier slot or when the two
ingresses cannot be made semantically equivalent at the cache level.

In this case:

- Both ingresses already converge on the SAME carrier slot
  (`this._latest` in `WorkingContextHostCapture`).
- The carrier-slot absence semantics are equivalent (trace 5).
- The two ingresses are mechanically compatible (both take a number | null
  and write unconditionally; both preserve `UNDEFINED_W_STALE_REUSE = FORBIDDEN`).

There IS therefore a single carrier slot with two legitimate producer
ingresses. That is exactly Outcome B's definition. B-prime is not
appropriate because the factor that IS shared (the carrier slot) is the
factor B-prime would deny.

### 3.9.4 B implementation skeleton (for the next ACT, not this one)

Outcome B, with the discriminator frozen, becomes:

- **Keep** both ingresses: `observe(event)` (canonical, runtime-emit)
  and `setLatest(estimate)` (transport-only bypass for the manual
  compaction producer seam).
- **Unify** their semantics on the carrier slot:
  - Both write `this._latest = typeof w === "number" ? w : null`
    (already true; the carrier code preserves this invariant).
  - Both treat absence as "leave the prior value alone" (already true
    at runtime emit time via `agent-runtime.ts:1319` dedup and at
    coordinator call time via `sdk-compaction-coordinator.ts:582`
    guard).
- **Add provenance**: each `this._latest = ...` write records the
  ingress source (the `W_INGRESS` enum: `RUNTIME_EVENT` |
  `MANUAL_COMPACTION`), so the host can mechanically distinguish the
  two producer sources when needed (e.g. for the post-restore test
  that asserts the bar reflects the manual compaction W).
- **Rename for clarity**: keep `setLatest` as a testable public seam
  but rename to something provenance-revealing, e.g.
  `setLatestFromManualProjection(estimate)`. The runtime ingress
  keeps `observe(event)`. Both feed the same carrier slot.
- **Do NOT** delete `setLatest`. **Do NOT** fabricate a runtime event.
- **Do NOT** change the runtime event's payload contract
  (`snapshot: this.snapshot()`).

### 3.9.5 Restated non-circular deletion predicate for B

Because B does NOT delete `setLatest`, the deletion predicate from
F0 §19.3 is reframed for B's consolidation contract:

> The B-consolidation is sound when ALL of the following hold (none of
> which depend on the consolidation itself for their truth):
>
> 1. Every successful producer of host-visible W can reach one of the
>    two legitimate ingresses (runtime event OR manual projection
>    callback) WITHOUT going through the other.
> 2. Both ingresses preserve `UNDEFINED_W_STALE_REUSE = FORBIDDEN`
>    (unconditional assignment semantics, prior value retained on
>    no-new-W cases).
> 3. Manual compaction updates the bar BEFORE the divider's
>    `postStateToWebview()` so the next published `ExtensionState`
>    carries the new W.
> 4. Normal prepare-turn publication via runtime event remains
>    unchanged in payload contract, dedup, and timing.
> 5. Skipped/failed compaction publishes NO W (the carrier slot keeps
>    its prior authoritative value from the runtime event stream).
> 6. (B-specific) The carrier slot records provenance per write so
>    downstream observers can distinguish the two ingresses.
> 7. (B-specific) The runtime event's payload contract is unchanged;
>    manual compaction does NOT fabricate events.

Conditions 1–5 are the original F0 deletion predicate restated (none
deleted because B is not deletion); 6–7 are the additional B-specific
constraints.

## 3.10 What this commit does NOT do

- NO production source touched.
- NO test code touched.
- NO RED tests yet (the next ACT, F1-CHARACTERIZATION, will add the
  GREEN characterization tests + a regression test for the
  manual-compaction-W-only-from-setLatest path; the existing tests at
  `sdk-compaction-w-publish-recon01.test.ts` already cover the
  producer-seam-to-carrier behavior and are GREEN at HEAD).
- NO `setLatest` deletion.
- NO runtime event fabrication.
- NO refactor of either ingress.
- NO cleanup of F0's blank-at-EOF residue (P2 deferred per third-C1).
- NO repair of `.factory/gate-summary.json`.

## 3.11 F1 traceability

ENTRY_HEAD         = b8d11710e7c9ad6a58ebd1f636670cc5529c2f52
FROZEN_AT          = b8d11710e7c9ad6a58ebd1f636670cc5529c2f52
DESCENDS_FROM      = F0 §19.3 frozen replacement language + F0 §17
                     recommendation + F0 §18 final report + third-C1
                     reviewer's load-bearing sharpening
PRODUCED_BY        = F1 RECON discriminator freeze (no production
                     touched)
NEXT_EVIDENCE_FILE = (none — F1 RECON complete; next ACT is
                     F1-CHARACTERIZATION with GREEN characterization
                     + selected-outcome documentation)
