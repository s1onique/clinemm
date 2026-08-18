# ELM-02F-CORRECTION01 — Canonical arbiter source replacement

**Subject:** ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-ELM-02F-CORRECTION01

**ENTRY_HEAD:** `<C25-C5 terminal commit>`  (currently `c16b3ccbb`)
**EXIT_HEAD:**  `<this commit's tip>`
**OPENED_BY:**  C25-C5 (`docs/architecture/elm/task-state-e5-e6-correction02-c25-c5-terminal-e7-authorization-evidence.md`)
**DEPENDS_ON:** C25-C4 (12 adversarial tests, typecheck gate, dispose-safety sharpening)
**FROZEN_ACCEPTANCE:** see §3 (tightened from reviewer round-20)

## 1. SCOPE

A bounded production change that replaces the
`LEGACY_MIRROR` arbiter source with the canonical
`AgentRuntime.snapshot()` projection. This is the
explicit E7 unblock.

The shape has three access-chain additions
(no private reach-through), one interface method
on `SdkSessionHost`, one closure replacement in
`SdkController.ts`, and one mapping function with
its unit-qualification suite.

### 1.1 Access-chain additions (no private reach-through)

| Layer | Surface | Type |
|-------|---------|------|
| `BuiltRuntime` (`session-runtime.ts:39`) | `snapshot: () => LiveAgentRuntimeStateSnapshot` | new optional method |
| `LocalRuntimeHost` (`local-runtime-host.ts:227`) | `getActiveRuntimeSnapshot(sessionId: string): LiveAgentRuntimeStateSnapshot \| undefined` | new public method |
| `SdkSessionHost` (`session-host.ts:60`) | `runtimeSnapshot?(): AgentRuntimeStateSnapshot \| undefined` | new optional method |

The canonical arbiter source is reached via a 3-link
public chain, not a reach-through of the private
`runtime` field:

```
SdkController.getArbiterSnapshot
  → sdkHost.runtimeSnapshot?.()        (SdkSessionHost)
  → localRuntimeHost.getActiveRuntimeSnapshot(sessionId)
                                    (LocalRuntimeHost)
  → activeSession.runtime.snapshot()  (BuiltRuntime)
  → agentRuntime.snapshot()           (AgentRuntime, public)
```

This honors the convention that every "this is a
Hub/Remote concern" method on `SdkSessionHost` is
`?` (Hub/Remote hosts omit; only Local implements).
The `?` is part of the interface contract, not an
oversight.

### 1.2 Contract on the `?` (two-absence-state collapse)

```
CONTRACT_1:  host.runtimeSnapshot === undefined
                (method absent, e.g. Hub/Remote hosts)
            ≡ "no canonical seam for this host"
            ≡ use legacy mirror fallback
                ⇒ ALWAYS behaves identically to:
            host.runtimeSnapshot?.() === undefined
                (method present, returns undefined)

CONTRACT_2:  production code uses ?.() everywhere;
            never checks the method's presence directly.

CONTRACT_3:  one fallback path; one fallback shape;
            one disposition.
```

The reviewer flagged two absence states
(`host.runtimeSnapshot === undefined` vs
`host.runtimeSnapshot() === undefined`) as needless
state-space growth. These collapse at the consumer
because the production code uses `?.()` and treats
both as "no canonical seam." §3's
`ELM_02F_T4_SOURCE_SELECTION` proves this collapse
explicitly.

### 1.3 Mapping function

```ts
// apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts (new)
import type { ArbiterSnapshot } from "./task-state-shadow-recorder"
import type { AgentRuntimeStateSnapshot } from "@cline/shared"

export function mapAgentRuntimeStateSnapshotToArbiterSnapshot(
    runtime: AgentRuntimeStateSnapshot | undefined,
    legacyPhase: TurnPhase,
): ArbiterSnapshot {
    if (!runtime) {
        // FALLBACK: legacy mirror projection, byte-equivalent to
        // pre-ELM-02F behavior. This is the ONLY place the
        // legacy phase is read.
        return legacyMirrorFromPhase(legacyPhase)
    }
    return {
        ...emptyArbiterSnapshot(),
        execution: {
            modelStreaming: runtime.execution?.modelStreaming ?? false,
            tooling: runtime.execution?.tooling ?? false,
            awaitingApproval: runtime.execution?.awaitingApproval ?? false,
        },
        pendingToolCalls: runtime.pendingToolCalls ?? [],
        recovery: runtime.recovery ? {
            state: runtime.recovery.state,
            recoveryState: runtime.recovery.state,
            episodeFailures: runtime.recovery.episodeFailures,
        } : undefined,
        status: runtime.status,
    }
}
```

The mapper accepts `AgentRuntimeStateSnapshot | undefined`
and `TurnPhase`. The `legacyPhase` parameter is
read **only inside the undefined branch** — never
when a canonical snapshot is supplied. This is the
key semantic-independence property.

### 1.4 What this commit produces

```
PRODUCTION_SEMANTIC_DELTA = small (3 access-chain methods + 1 closure + 1 mapper)
PRODUCTION_LOC_DELTA      = ~70 lines (+ the mapper file)
PUBLIC_API_DELTA          = +1 method on `SdkSessionHost`
                          = +1 method on `BuiltRuntime`
                          = +1 method on `LocalRuntimeHost`
PROTOCOL_DELTA            = 0
HUB_PRODUCTION_DELTA      = 0 (this ACT does not touch the hub path)
REMOTE_PRODUCTION_DELTA   = 0
TEST_DELTA                = +1 dedicated qualification file
                          ~20-30 tests:
                          - T1 canonical-source mapping (positive)
                          - T2 legacy-independence witness (ELM02F-N1)
                          - T3 fallback exactness (ELM02F-N2)
                          - T4 source selection (two-absence-state collapse)
                          - T5 mapper field-by-field exactness
                          - T6 type-equivalence
                          - T7 existing qualification unchanged
                          - T8 necessity witness (uncommitted mutation)
DOC_DELTA                 = 1 production-source comment update
                          (the "until ELM-02F lands" note removed)
                          + 1 evidence doc
CONFIG_DELTA              = 0
```

## 2. WHY THIS SHAPE (three reviewer tightenings applied)

### 2.1 The current LEGACY_MIRROR

`apps/vscode/src/sdk/SdkController.ts:565-580`:

```ts
getArbiterSnapshot: () => {
    // The canonical arbiter is the AgentRuntime.snapshot(); until
    // the forward-fix seam (ELM-02F) lands, the wiring mirrors
    // the legacy projection so classification / arbitration
    // remain well-defined. The recovery-state field is updated
    // by `subscribeRecoveryStateChange` via the wiring's own
    // recording path.
    const phase = this.turnStateTracker.currentPhase
    return {
        ...emptyArbiterSnapshot(),
        execution: {
            modelStreaming: phase === "streaming",
            tooling: phase === "streaming",
            awaitingApproval: phase === "awaiting_approval",
        },
    }
},
```

This is `LEGACY_MIRROR`: it derives the arbiter from
the legacy `turnStateTracker.currentPhase` projection.
The classification chain (C25-C3/C4) is well-defined
against this projection, but the production source is
NOT `AgentRuntime.snapshot()` — the C25-C2 C04 capture
is structurally unreachable precisely because the
mirror doesn't capture mutations that haven't yet
reached the legacy phase.

### 2.2 Tightening #1: T3 SHAPE_EQUIVALENCE is the wrong property

The earlier freeze said:

> for every (phase, status) tuple the legacy mirror
> could produce, the new getter-driven mapping
> produces an identical ArbiterSnapshot

That's potentially self-defeating: ELM-02F's purpose
is to make the arbiter INDEPENDENT of legacy phase.
Demanding byte-equivalence to the mirror across legacy
tuples risks proving that the new source still behaves
like the thing it's replacing.

T3 is split into three distinct properties:

```
T3A STRUCTURAL_SHAPE_EQUIVALENCE
  mapAgentRuntimeStateSnapshotToArbiterSnapshot(snapshot)
  produces a valid ArbiterSnapshot with the schema/field
  semantics expected by classify().

T3B SEMANTIC_INDEPENDENCE  (the load-bearing property)
  canonical arbiter fields derive ONLY from
  AgentRuntimeStateSnapshot;
  changing legacy TurnPhase while holding
  runtimeSnapshot constant MUST NOT change the
  canonical mapped arbiter.

T3C FALLBACK_EQUIVALENCE
  ONLY when runtimeSnapshot() === undefined:
    legacy fallback result is byte-/field-equivalent to
    the pre-ELM-02F mirror behavior.
```

### 2.3 Tightening #2: ELM02F-N1 / N2 necessity witnesses

Two specific witnesses are mandatory:

```
ELM02F-N1 — legacy independence

  Given:
    runtimeSnapshot.execution.modelStreaming = true
    runtimeSnapshot.execution.awaitingApproval = false
    runtimeSnapshot.pendingToolCalls = []
  And:
    legacy phase A = idle
    legacy phase B = completed
  Then:
    map(A) == map(B)
    arbiterActive under A == true
    arbiterActive under B == true

  If N1 fails, ELM-02F hasn't eliminated the causal
  coupling that made C04 structurally unreachable.

ELM02F-N2 — fallback dependence

  Given: runtimeSnapshot() === undefined
  Then:
    legacy=idle      → old idle mirror exactly
    legacy=streaming → old streaming mirror exactly
```

### 2.4 Tightening #3: no private reach-through

`LocalRuntimeHost.runtime` is private state. The
canonical access path goes through a new public
method on the host, not a `.runtime.snapshot()`
reach-through:

```
VscodeSessionHost
  → LocalRuntimeHost.getActiveRuntimeSnapshot(sessionId)
  → ActiveSession.runtime.snapshot()   (BuiltRuntime)
  → AgentRuntime.snapshot()            (public, agents package)
```

This reduces coupling rather than relocating it.
The new method is observable, testable, and Hub/Remote
hosts can simply not implement it (which collapses
to the legacy-mirror fallback via §1.2).

## 3. ACCEPTANCE GATE (FROZEN, tightened)

The ELM-02F ACT must satisfy ALL of the following:

```
ELM_02F_T1_CANONICAL_SOURCE
  Local active runtime snapshot -> ArbiterSnapshot
  The mapper produces a well-formed ArbiterSnapshot
  from an AgentRuntimeStateSnapshot.
  PASS

ELM_02F_T2_LEGACY_INDEPENDENCE  (the load-bearing property)
  same canonical snapshot + different TurnPhase
  -> identical canonical ArbiterSnapshot
  ELM02F-N1 witness: PASS

ELM_02F_T3_FALLBACK_EXACTNESS
  runtimeSnapshot() === undefined
  -> pre-ELM-02F legacy mirror semantics exactly
  ELM02F-N2 witness: PASS

ELM_02F_T4_SOURCE_SELECTION  (two-absence-state collapse)
  Defined canonical snapshot ALWAYS wins over legacy mirror.
  Undefined canonical snapshot ALWAYS uses fallback.
  - hostA (Local, runtimeSnapshot() returns snapshot)
  - hostB (Local, runtimeSnapshot() returns undefined)
  - hostC (Hub/Remote, runtimeSnapshot method absent)
  hostB and hostC produce byte-identical ArbiterSnapshots.
  PASS

ELM_02F_T5_MAPPING  (field-by-field exactness)
  execution.modelStreaming      exact
  execution.tooling             exact
  execution.awaitingApproval    exact
  pendingToolCalls              exact
  recovery.state -> recoveryState exact
  status                        exact
  PASS

ELM_02F_T6_TYPES
  no any
  no unjustified casts outside the mapper boundary
  dedicated typecheck catches fixture/source drift
  PASS

ELM_02F_T7_EXISTING_QUALIFICATION
  C25-C3 7/7
  C25-C4 12/12
  C-REAL 5/5
  lifecycle 20/20
  PASS

ELM_02F_T8_NECESSITY  (uncommitted mutation probe)
  Temporarily forcing legacy mirror instead of
  canonical source causes the C25 C04 positive
  condition to collapse back to D02.
  PASS  ← proves this production change IS the
          specific missing causal edge identified
          by C25-C2 (not merely plumbing).

ELM_02F_CORRECTION01_VERDICT  = PASS iff T1..T8

CANONICAL_ARBITER_SOURCE       = AGENT_RUNTIME_SNAPSHOT
C25_ARB_SOURCE_RESIDUE         = CLOSED
E7_AUTHORIZED                  = true   (UNLOCK)
```

### 3.1 What `T8 NECESSITY` proves in particular

T8 is the dual of T2. Together they say:

```
T2  same canonical snapshot + different legacy phase
    → IDENTICAL canonical arbiter

T8  different canonical snapshot (real mutation) +
    SAME legacy phase
    → DIFFERENT canonical arbiter

Therefore the canonical arbiter:
  * IS independent of legacy phase (T2),
  * DOES track real canonical mutations (T8).

T2 alone would prove independence but not
that the canonical source actually captures anything
new. T8 alone would prove the canonical source
captures new things but not that the legacy phase
isn't somehow the real driver. Together they pin
down the right causal relationship.
```

### 3.2 Disallowed at the gate

These are explicitly NOT acceptable substitutes
for T2 / T8:

```
* Mapping the runtime snapshot back through the legacy
  phase for "compatibility" — defeats the whole ACT.

* Demanding byte-equivalence to the mirror across legacy
  phase tuples — proves nothing; that's the tightening
  #1 reject.

* Checking the host method's presence at the call site
  (e.g. `'runtimeSnapshot' in host`) — would create
  the third state `host.runtimeSnapshot === undefined`
  that the reviewer's tightening #2 explicitly rejects.

* `as any` casts in the mapper — T6 fails.

* Modifying the C25-C4 fixture to fit a new shape — T7
  fails.
```

## 4. POST-ELM-02F-CORRECTION01 BOARD

```
ELM-02F-CORRECTION01  🟢 NEXT (this commit's exit)
E7                    🟢 NEXT (after ELM-02F-CORRECTION01)
```

The actual E7 backend activation is its own separate
ACT — ELM-02F-CORRECTION01 only unblocks the
`C25_ARB_SOURCE_RESIDUE` dependency.
