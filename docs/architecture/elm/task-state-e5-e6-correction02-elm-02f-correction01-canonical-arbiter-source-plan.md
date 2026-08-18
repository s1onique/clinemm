# ELM-02F-CORRECTION01 — Canonical arbiter source replacement

**Subject:** ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-ELM-02F-CORRECTION01

**ENTRY_HEAD:** `<C25-C5 terminal commit>`
**EXIT_HEAD:**  `<this commit's tip>`
**OPENED_BY:**  C25-C5 (`docs/architecture/elm/task-state-e5-e6-correction02-c25-c5-terminal-e7-authorization-evidence.md`)
**DEPENDS_ON:** C25-C4 (12 adversarial tests, typecheck gate, dispose-safety sharpening)

## 1. SCOPE

A bounded production change that replaces the
`LEGACY_MIRROR` arbiter source with the canonical
`AgentRuntime.snapshot()` projection. This is the
explicit E7 unblock.

```
PRODUCTION_SEMANTIC_DELTA = small (1 closure + 1 getter + 1 mapping function)
PRODUCTION_LOC_DELTA      = ~40 lines
PUBLIC_API_DELTA          = +1 method on `SdkSessionHost`
                          = `runtimeSnapshot(): AgentRuntimeStateSnapshot | undefined`
PROTOCOL_DELTA            = 0
HUB_PRODUCTION_DELTA      = 0 (unchanged; this ACT does not touch the hub path)
REMOTE_PRODUCTION_DELTA   = 0
TEST_DELTA                = +1 dedicated qualification file
                          ~10-20 tests covering:
                          - getter returns the snapshot when host is alive
                          - getter returns undefined when no session is active
                          - getter returns undefined when session is disposed
                          - the SdkController.getArbiterSnapshot uses the
                            getter when defined and falls back to the
                            legacy mirror only when undefined
                          - the wiring classifier sees identical shapes
                            whether fed the new mapping or the legacy
                            mirror (shape-only equivalence)
DOC_DELTA                 = 1 production-source comment update
                          (the "until ELM-02F lands" note removed)
                          + 1 evidence doc
CONFIG_DELTA              = 0
```

## 2. WHY THIS SHAPE

The current production closure at `SdkController.ts:565-580`
is:

```ts
getArbiterSnapshot: () => {
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

This is `LEGACY_MIRROR`: it derives the arbiter from the
legacy `turnStateTracker.currentPhase` projection, NOT
from the canonical `AgentRuntime.snapshot()`.

The replacement:

1. **Add** `runtimeSnapshot()` to the `SdkSessionHost`
   interface in `apps/vscode/src/sdk/session-host.ts`.

   ```ts
   runtimeSnapshot?(): AgentRuntimeStateSnapshot | undefined
   ```

2. **Implement** it in `VscodeSessionHost`
   (`apps/vscode/src/sdk/vscode-session-host.ts`) by
   reading the `LocalRuntimeHost`'s `runtime.snapshot()`.

3. **Replace** the `getArbiterSnapshot` closure in
   `SdkController.ts` to read the new getter and map the
   `AgentRuntimeStateSnapshot` to the `ArbiterSnapshot`
   shape. The map function (`AgentRuntimeStateSnapshot ->
   ArbiterSnapshot`) is exactly the shape already
   exercised by the C25-C4 `liveBaseSnapshot()` fixture
   (post-R11-a: `recovery` → state + `execution` →
   execution).

4. **Fallback**: if the getter returns `undefined` (no
   active session host — i.e. HUB/REMOTE fallback paths),
   the legacy mirror projection is preserved as the
   defensive default. This matches the C2.4-D-HUB
   classification: the canonical event source is
   unreachable on HUB/REMOTE paths, so the
   `FALLBACK_APPLY` semantics already cover that
   scenario.

The mapping function is intentionally trivial (it's
basically a type-cast + field extraction) and is
unit-testable without VS Code dependencies.

## 3. ACCEPTANCE GATE

```
ELM_02F_T1_PRODUCTION_REPLACEMENT = DONE
ELM_02F_T2_UNIT_QUALIFICATION     = PASS  (~10-20 tests)
ELM_02F_T3_SHAPE_EQUIVALENCE      = PASS
  * for every (phase, status) tuple the legacy mirror
    could produce, the new getter-driven mapping produces
    an identical ArbiterSnapshot;
  * for every AgentRuntimeStateSnapshot the new mapping
    accepts, the produced ArbiterSnapshot is well-formed
    and matches the existing C25-C4 fixture assertions
ELM_02F_T4_FALLBACK_PRESERVED     = PASS
  * when runtimeSnapshot() returns undefined, the
    legacy mirror projection is used unchanged
ELM_02F_T5_TYPE_EQUIVALENCE       = PASS
  * the new mapping function's input/output types are
    TypeScript-exact (no `any`, no `as` casts outside
    the map boundary)
ELM_02F_T6_C25_TESTS_UNCHANGED    = PASS
  * all 12 C25-C4 adversarial tests still pass against
    the new closure without modification

ELM_02F_CORRECTION01_VERDICT      = PASS
CANONICAL_ARBITER_SOURCE          = AGENT_RUNTIME_SNAPSHOT
C25_ARB_SOURCE_RESIDUE            = CLOSED
E7_AUTHORIZED                     = true   (UNLOCK)
```

## 4. POST-ELM-02F-CORRECTION01 BOARD

```
ELM-02F-CORRECTION01  🟢 NEXT (this commit's exit)
E7                    🟢 NEXT (after ELM-02F-CORRECTION01)
```

The actual E7 backend activation is its own separate
ACT — ELM-02F-CORRECTION01 only unblocks the
`C25_ARB_SOURCE_RESIDUE` dependency.
