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

The mechanical end-state on `this._latest` is the same: both contracts
preserve the prior carrier slot when no new value is produced. They
are NOT identical at the producer boundary (one is dedup-on-equality at
the runtime emitter; the other is guard-on-undefined at the
coordinator).

**But that mechanical-equivalence argument conflates two different
semantic claims:**

- Normal absence claims: **the authoritative runtime W was evaluated
  and did not change** (`before === after`). Keeping the previous
  carrier value is therefore justified by *runtime equality*.
- Manual absence claims: **no new W value was supplied** by the
  producer (the guard fires because the field is non-numeric). It
  does **NOT**, by itself, establish that the new W equals the
  previous W. Manual compaction may have just radically changed the
  effective message projection.

So:

```
NO_VALUE
≠
VALUE_UNCHANGED
```

This is exactly the distinction the post-compaction bug exploited:
compaction changed the effective context but the host retained the
old W. Canonizing "retain previous W" merely because both code paths
happen to leave `_latest` untouched would have prevented us from
seeing that bug.

**ABSENCE_SEMANTICS_EQUAL = NOT_YET_PROVEN** at the producer-boundary
semantic level. The mechanical end-state is the same, but the
*justification* for preserving the prior value is different, and
whether manual absence is reachable when manual compaction succeeded
is itself an open question.

The next ACT (F1-CHARACTERIZATION) must answer the bounded question:

> **Can successful manual compaction on current production code ever
> return `currentWorkingContextEstimate === undefined`?**

- If structurally unreachable
  → `MANUAL_ABSENCE_ON_SUCCESS = UNREACHABLE`
  → the absence distinction becomes irrelevant to Outcome B.
- If reachable
  → a separate contract question opens (retain old W? clear W?
    mark W unavailable?). Do **not** silently answer it during
    factorization.

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

| Discriminator                    | Answer          | Load-bearing evidence |
| -------------------------------- | --------------- | --------------------- |
| `SAME_SEMANTIC_VALUE`            | YES             | Both represent host-visible working-context occupancy for the compacted transcript. Same producer (`publishWorkingContextEstimate` / `publishWorkingContextEstimateMetadataOnly` in `compaction.ts:824-915`) computes both. Same lifetime: "until the next normal prepare-turn" (chain 2 §2.3; `sdk-compaction.ts:62-66`). **The semantic *quantity* is the same; the semantic *state-owner* is not** (see `SAME_OWNER` below). |
| `SAME_STATE_OWNER`               | NO              | Normal: agents-owned (`state.currentWorkingContextEstimate`, `working-context-state-changed` event payload). Manual: vscode-owned (coordinator `publishPostCompactionW` callback projection value from core producer). The runtime is not invoked. Upstream: `@cline/core` owns compaction; `@cline/agents` owns the turn loop + runtime events (`sdk/packages/README.md:13-16`). |
| `SAME_EVENT_DOMAIN`              | NO              | `working-context-state-changed` is emitted by `AgentRuntime` from its OWN state (`agent-runtime.ts:1315-1347`); manual compaction does NOT mutate that state (trace 1) and CANNOT legitimately emit the event (trace 3). Fabricating one would require writing to `state.currentWorkingContextEstimate` from outside the runtime OR emitting a synthesized snapshot that lies about runtime state — both layering/semantic violations. |
| `ABSENCE_SEMANTICS_EQUAL`        | **NOT_YET_PROVEN** | Mechanical end-state on `this._latest` is the same (both contracts preserve prior carrier value on no-new-W), but the *justification* differs: normal absence = runtime equality (`before === after`); manual absence = no value supplied (guard on `typeof !== "number"`). `NO_VALUE ≠ VALUE_UNCHANGED`. See §3.6.3. **Pending discriminator: `SUCCESS_WITHOUT_W_REACHABLE` (F1-CHARACTERIZATION).** If structurally unreachable, this row becomes IRRELEVANT_TO_OUTCOME_B. |
| `SHARED_PUBLICATION_SEAM_EXISTS` | NO              | No shared seam exists that would carry both. Normal publishes via the `working-context-state-changed` runtime event from `AgentRuntime`. Manual publishes via a coordinator `publishPostCompactionW` callback. The only candidate seam — synthesizing a runtime event from manual compaction — would require violating `agent-runtime.ts:945` (state bind) AND trace 3 (subscription legitimacy). |
| `SELECTED_OUTCOME`               | B               | See §3.9. |

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
- The carrier-slot **mechanical** absence semantics are equivalent
  (both preserve prior value on no-new-W), but their *semantic
  justifications* differ (normal = runtime equality; manual = no
  value supplied) — see §3.6.3. This is why
  `ABSENCE_SEMANTICS_EQUAL = NOT_YET_PROVEN` rather than YES, and is
  the bounded P1 carried into F1-CHARACTERIZATION.
- The two ingresses are mechanically compatible at the carrier slot
  (both take a number | null and write unconditionally; both preserve
  `UNDEFINED_W_STALE_REUSE = FORBIDDEN`).

There IS therefore a single carrier slot with two legitimate producer
ingresses. That is exactly Outcome B's definition. **Outcome B does
NOT depend on absence-semantics equality at the producer boundary**;
it depends only on:

```
two honest producers
one host cache
one mutation primitive (per §3.9.4)
```

The common factor can still be just the assignment of an actual W
value; the absence case is separately handled by the
`SUCCESS_WITHOUT_W_REACHABLE` discriminator.

B-prime is not appropriate because the factor that IS shared (the
carrier slot) is the factor B-prime would deny.

### 3.9.4 B implementation skeleton (for the next ACT, not this one)

Per the fourth-C1 design correction: keep the B factorization
**smaller**. The architectural prior is the same (two legitimate
producer ingresses → one mutation primitive → one cache); but the
implementation does NOT need new state, new enums, or new public
surface to achieve it.

**PROVEN_TARGET = ONE_ASSIGNMENT_PRIMITIVE** (minimal, justified by
the discriminator):

```ts
private assign(estimate: number | undefined): void {
    this._latest = typeof estimate === "number" ? estimate : null
}

observe(event) {
    this.assign(event.snapshot.currentWorkingContextEstimate)
}

setLatest(estimate) {
    this.assign(estimate)
}
```

(A rename of `setLatest` to a more accurate seam name, e.g.
`setLatestFromManualProjection`, is acceptable — naming is not
state. Justification for the rename is observability, not
provenance.)

**NOT_YET_JUSTIFIED** (deferred until a real downstream consumer or
invariant demands it):

- Provenance recording per write (`W_INGRESS` enum).
- A second mutable provenance field alongside `_latest`.
- A public W_INGRESS enum surface.
- A new projection field on the carrier.

If tests need to prove which ingress executed, use injection/spies at
the ingress boundary (e.g. count `assign` calls with a probe
parameter; spy on `setLatest` directly). **Do not turn test
observability into architecture.**

Before/after shape (for the ACT that lands it, not this one):

```
MUTATION SEMANTICS BEFORE = duplicated
  (observe: number|null normalization; setLatest: number|null
   normalization — same intent, two sites)

MUTATION SEMANTICS AFTER  = one primitive
  (private assign() owns the unconditional normalization)

PRODUCERS                  = still two, legitimately
  (observe from runtime event; setLatest from manual projection
   callback)

NEW STATE                  = zero
  (no provenance field, no ingress enum, no projection field)
```

The factorization objective is **two honest producers writing one
host cache through one assignment primitive**. Provenance is a
different problem.

**Do NOT**:

- Delete `setLatest` (F0 deletion predicate preserved).
- Fabricate a runtime event from manual compaction.
- Change the runtime event's payload contract
  (`snapshot: this.snapshot()`).
- Add provenance state, a `W_INGRESS` enum, or a new projection
  field.

### 3.9.5 Minimal-B soundness predicate

Per the fourth-C1 correction: the predicate for B is smaller than the
proposed 7-condition version. Provenance constraints (former 6) and
runtime-event-contract constraints (former 7) are NOT part of the B
predicate — they belong to either:

- the F0 deletion predicate (if we were deleting `setLatest`), or
- a future invariant justified by a real downstream consumer.

The B soundness predicate is:

> The minimal-B factorization is sound when ALL of the following hold
> (none of which depend on the factorization itself for their truth):
>
> 1. Every successful producer of host-visible W can reach one of the
>    two legitimate ingresses (runtime event OR manual projection
>    callback) WITHOUT going through the other.
> 2. Both ingresses normalize to the same carrier-slot write
>    (`typeof === "number" ? value : null`) via the shared
>    `assign()` primitive — i.e. **MUTATION_SEMANTICS are unified**, no
>    longer duplicated.
> 3. Manual compaction updates the bar BEFORE the divider's
>    `postStateToWebview()` so the next published `ExtensionState`
>    carries the new W.
> 4. Skipped/failed compaction publishes NO W; the carrier slot keeps
>    its prior authoritative value from the runtime event stream.

Conditions 1, 3, 4 are the original F0 §19.3 non-circular deletion
conditions, restated for B's *consolidation* contract (B does not
delete `setLatest`; condition 2 is the consolidation's own
contribution).

The four conditions together guarantee:

```
PRODUCERS                  = two honest ingresses
MUTATION SEMANTICS         = one primitive
CARRIER STATE              = one cache value, no provenance
RUNTIME EVENT              = unchanged
FABRICATED EVENT           = zero
```

Which is exactly the B factorization objective — nothing more.

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
- NO `assign()` primitive introduced (deferred to the ACT that lands
  the factorization).
- NO `W_INGRESS` enum, NO per-write provenance field, NO new
  projection field on the carrier (deferred to a future ACT that
  demonstrates a real downstream consumer need).
- NO cleanup of F0's blank-at-EOF residue (P2 deferred per third-C1).
- NO repair of `.factory/gate-summary.json`.

## 3.11 F1 traceability

ENTRY_HEAD         = b8d11710e7c9ad6a58ebd1f636670cc5529c2f52
FROZEN_AT          = b8d11710e7c9ad6a58ebd1f636670cc5529c2f52
DESCENDS_FROM      = F0 §19.3 frozen replacement language + F0 §17
                     recommendation + F0 §18 final report + third-C1
                     reviewer's load-bearing sharpening + fourth-C1
                     reviewer's bounded P1 + design correction
PRODUCED_BY        = F1 RECON discriminator freeze + fourth-C1
                     correction landing (no production touched)
NEXT_EVIDENCE_FILE = (none — F1 RECON complete; next ACT is
                     F1-CHARACTERIZATION with the bounded
                     `SUCCESS_WITHOUT_W_REACHABLE` discriminator +
                     selected-outcome documentation)

## 3.12 Fourth-C1 correction log (PASS_WITH_ONE_BOUNDED_P1)

### 3.12.1 Reviewer verdict (verbatim)

> PASS_WITH_ONE_BOUNDED_P1 — C1: GO TO F1 CHARACTERIZATION

The architectural prior (Outcome B) survived the review. One bounded
P1 was identified (`ABSENCE_SEMANTICS_EQUAL` overclaimed) and one
design correction (provenance recording was speculative).

### 3.12.2 Bounded P1: ABSENCE_SEMANTICS_EQUAL overclaimed

**Claim frozen by third-C1**:
> "ABSENCE_SEMANTICS_EQUAL = YES (at the carrier slot, not at the
> producer boundary)."

**Fourth-C1 finding**: the claim conflates two different semantic
justifications.

- Normal absence: `before === after` ⇒ authoritative runtime W was
  evaluated and did not change. Carrier retains prior value by
  *runtime equality*.
- Manual absence: `typeof !== "number"` ⇒ no new W was supplied.
  Carrier retains prior value by *absence of input*. **It does NOT
  establish `new W == previous W`.**

```
NO_VALUE      ≠     VALUE_UNCHANGED
```

**Correction applied**:
- §3.6.3 reframed: ABSENCE_SEMANTICS_EQUAL = **NOT_YET_PROVEN** at
  the producer-boundary semantic level.
- §3.8 frozen table: row updated from YES → NOT_YET_PROVEN with the
  pending discriminator `SUCCESS_WITHOUT_W_REACHABLE` (F1-CHARACTERIZATION).

### 3.12.3 Bounded P1 does NOT refute Outcome B

The fourth-C1 explicitly verified that Outcome B does NOT depend on
absence-semantics equality:

> "Because Outcome B depends on the fact that there are:
>   two honest producers
>   one host cache
> It does not depend on their no-value boundary semantics being
> identical."

So Outcome B is preserved. What changes:

- §3.9.5 predicate: shrunk from 7 conditions to **4** (B-specific
  provenance + runtime-event-contract conditions removed; they
  belong elsewhere).
- §3.9.4 implementation skeleton: shrunk to **PROVEN_TARGET =
  ONE_ASSIGNMENT_PRIMITIVE** with explicit **NOT_YET_JUSTIFIED**
  list (provenance, ingress enum, projection field).

### 3.12.4 Design correction: provenance is not yet justified

**Claim frozen by third-C1** (in §3.9.4):
> "add `W_INGRESS = RUNTIME_EVENT | MANUAL_COMPACTION` and record
> provenance per write."

**Fourth-C1 finding**: nothing in the discriminator demonstrates a
consumer that needs provenance. Adding provenance would yield:

```
one cache value
+ a second mutable provenance value
+ consistency invariant between them
+ tests
+ future consumers
```

That is the opposite of the current ACT's purpose. The factorization
objective is:

```
two legitimate producer ingresses
→ one mutation primitive
→ one cache
```

Achieved minimally by a single private `assign()` method called from
both ingresses — **zero new state**.

**Correction applied**:
- §3.9.4: speculative provenance REMOVED. The implementation skeleton
  is now strictly one private primitive + two ingress wrappers.
- §3.10: explicit "NO `W_INGRESS` enum, NO per-write provenance
  field, NO new projection field" added.
- §3.9.5: condition 6 (provenance) removed from the B predicate.

### 3.12.5 Narrowed wording: SAME_SEMANTIC_VALUE vs SAME_STATE_OWNER

**Claim frozen by third-C1**:
> "SAME_SEMANTIC_STATE = YES"

**Fourth-C1 finding**: the two values are semantically the same
**quantity** but not the same **state-ownership instance**.

```
SAME_SEMANTIC_VALUE = YES
SAME_STATE_OWNER    = NO
```

is more precise.

**Correction applied**:
- §3.8 frozen table: row renamed `SAME_SEMANTIC_STATE` →
  `SAME_SEMANTIC_VALUE` and the split is now explicit; new
  `SAME_STATE_OWNER` row inserted.
- No ACT-level rename (the discriminator row stays inside this
  evidence file only).

### 3.12.6 Next ACT slice (the bounded characterization)

Per the fourth-C1: do NOT open another grand recon. Continue F1 as
**CHARACTERIZATION** with one epistemic purpose:

> **Can current successful manual compaction on production code ever
> return `currentWorkingContextEstimate === undefined`?**

The characterization matrix is bounded to four cases:

| Case                                                               | `compacted` | Producer W | Required observation |
| ------------------------------------------------------------------ | ----------: | ---------: | -------------------- |
| successful current manual compaction                               |        true |     number | publish exactly that W |
| no-op / cannot compact                                             |       false |  undefined | no publication       |
| producer contract violation / injected successful result without W |        true |  undefined | characterize current behavior; do NOT decide policy yet |
| normal runtime unchanged W                                         |         n/a |  same number | no event; prior carrier retained |

The third row is load-bearing:

- If `compacted=true && W=undefined` is structurally impossible on
  the current producer seam, then
  `MANUAL_ABSENCE_ON_SUCCESS = UNREACHABLE` and the absence
  distinction becomes irrelevant to Outcome B.
- If it IS reachable, a separate contract question opens (retain old
  W? clear W? mark W unavailable?). Do NOT silently answer that
  during factorization.

### 3.12.7 Fourth-C1 verdict (verbatim summary)

```
ACT              = ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-
                   AUTHORITY01
RECON            = PASS
OUTCOME_B        = ACCEPTED
P0               = NONE
P1               = ABSENCE_SEMANTICS_EQUAL overclaimed;
                   characterize whether successful current manual
                   compaction can return no W before freezing that
                   invariant.
DESIGN_RESIDUE   = provenance recording NOT justified; do not add it
                   absent a consumer/invariant.
P2               = EOF hygiene only
PRODUCTION_EDIT  = NOT YET
NEXT             = bounded F1 characterization

C1: GO. Keep Outcome B, but make it smaller: prove the successful-
manual-compaction absence case, then factorize the assignment
primitive, not the event topology — and don't invent provenance
state unless evidence forces it.
```

### 3.12.8 Repository identity after fourth-C1 corrections

F0_CLOSURE_HEAD          = 49e7069c1eb56adf753286d72427f7bf17755925
LEAMAS_P2_ADDENDUM_HEAD  = 0debc0cc133ce54f02eff3e6e0d673c2571cbf40
F1_RECON_HEAD            = b8d11710e7c9ad6a58ebd1f636670cc5529c2f52
F1_DISCRIMINATOR_HEAD    = f737f43d3a4daf73f62a07b453e9077459625613
F1_CORRECTION04_HEAD     = (this commit; recorded in epic board line 1)
BRANCH                   = main
WORKTREE                 = clean
