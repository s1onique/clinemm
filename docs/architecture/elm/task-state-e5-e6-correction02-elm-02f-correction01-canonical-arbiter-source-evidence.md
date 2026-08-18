# ELM-02F-CORRECTION01 — Evidence: Canonical arbiter source replacement

**Subject:** ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-F1-CANONICAL-RUNTIME-EVENT-SEAM01-ELM-02F-CORRECTION01

**ENTRY_HEAD:** `64c5189b0` (ELM-02F plan tightening)
**EXIT_HEAD:**  `<this commit's tip>`
**PLAN:**       docs/architecture/elm/task-state-e5-e6-correction02-elm-02f-correction01-canonical-arbiter-source-plan.md

## 1. ACCEPTANCE VERDICT

```
ELM_02F_T1_CANONICAL_SOURCE       PASS  (3 / 3 tests)
ELM_02F_T2_LEGACY_INDEPENDENCE    PASS  (2 / 2 tests; ELM02F-N1 structural)
ELM_02F_T3_FALLBACK_EXACTNESS     PASS  (5 / 5 tests; ELM02F-N2 byte-equivalent)
ELM_02F_T4_SOURCE_SELECTION       PASS  (5 / 5 tests; two-absence-state collapse)
ELM_02F_T5_MAPPING                PASS  (6 / 6 tests; field-by-field exactness)
ELM_02F_T6_TYPES                  PASS  (no any; no unjustified casts;
                                          @ts-expect-error enforces
                                          CANONICAL_MAPPER_ACCEPTS_TURN_PHASE = false)
ELM_02F_T7_EXISTING_QUALIFICATION PASS  (12/12 C4 + 7/7 C3 + 5/5 C-REAL +
                                          20/20 lifecycle all unchanged)
ELM_02F_T8_NECESSITY              PASS  (3 / 3 tests; dual of T2)

ELM_02F_CORRECTION01_VERDICT  = PASS iff T1..T8  →  ELM_02F_CORRECTION01 = PASS

CANONICAL_ARBITER_SOURCE       = AGENT_RUNTIME_SNAPSHOT
C25_ARB_SOURCE_RESIDUE         = CLOSED
E7_AUTHORIZED                  = true   (UNBLOCK)
```

## 2. PRODUCTION CHANGE SUMMARY

The legacy mirror at `apps/vscode/src/sdk/SdkController.ts:565-580`
is replaced by a canonical-source selection. The selection is:

```ts
const sdkHost = this.sessions?.getActiveSession()?.sdkHost
const sessionId = this.sessions?.getActiveSession()?.sessionId
const canonical = sdkHost?.runtimeSnapshot?.(sessionId)
if (canonical) {
    return mapAgentRuntimeStateSnapshotToArbiterSnapshot(canonical)
}
return legacyArbiterSnapshotFromTurnPhase(this.turnStateTracker.currentPhase)
```

The `?.()` chain is load-bearing — it implements CONTRACT_2 of the
plan (the two absence states, Hub/Remote host absent vs Local active
but no AgentRuntime instance, collapse at the consumer).

The mapper and the legacy fallback are **separate functions**, per
the reviewer's heuristic `CANONICAL_MAPPER_ACCEPTS_TURN_PHASE = false`:

* `mapAgentRuntimeStateSnapshotToArbiterSnapshot(snapshot)` — accepts ONLY a snapshot.
* `legacyArbiterSnapshotFromTurnPhase(phase)` — accepts ONLY a phase.

Neither function can read the other's input by construction.

## 3. ACCESS-CHAIN IMPLEMENTATION

The 5-link public chain implemented in this commit:

| # | Layer | File | Method |
|---|-------|------|--------|
| 1 | `AgentRuntime` (`@cline/agents`) | `sdk/packages/agents/src/agent-runtime.ts:895` | `snapshot(): LiveAgentRuntimeStateSnapshot` (existing public method, called as-is) |
| 2 | `SessionRuntime` (orchestrator) | `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts` | NEW: `snapshot(): LiveAgentRuntimeStateSnapshot \| undefined` (returns `this.activeRuntime?.snapshot()`) |
| 3 | `LocalRuntimeHost` | `sdk/packages/core/src/runtime/host/local-runtime-host.ts` | NEW: `getActiveRuntimeSnapshot(sessionId: string \| undefined): LiveAgentRuntimeStateSnapshot \| undefined` |
| 4 | `RuntimeHost` interface | `sdk/packages/core/src/runtime/host/runtime-host.ts` | NEW optional: `getActiveRuntimeSnapshot?(sessionId: string \| undefined): LiveAgentRuntimeStateSnapshot \| undefined` |
| 5 | `ClineCore` | `sdk/packages/core/src/ClineCore.ts` | NEW: `getActiveRuntimeSnapshot(sessionId): LiveAgentRuntimeStateSnapshot \| undefined` |
| 6 | `SdkSessionHost` interface | `apps/vscode/src/sdk/session-host.ts` | NEW optional: `runtimeSnapshot?(sessionId: string \| undefined): AgentRuntimeStateSnapshot \| undefined` |
| 7 | `VscodeSessionHost` | `apps/vscode/src/sdk/vscode-session-host.ts` | NEW: `runtimeSnapshot(sessionId): AgentRuntimeStateSnapshot \| undefined` (proxies to `ClineCore`) |
| 8 | Mapper | `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts` (NEW file) | `mapAgentRuntimeStateSnapshotToArbiterSnapshot` |
| 9 | Selection | `apps/vscode/src/sdk/SdkController.ts:565-602` (REPLACED closure) | uses mapper + legacy fallback |

The plan's §1.1 access chain table referenced `BuiltRuntime.snapshot()`,
but the actual `AgentRuntime` reference lives in `SessionRuntime`
(orchestrator) as `private activeRuntime: AgentRuntime | null`
(line 381, set line 956, cleared line 994). Adding a method to
`SessionRuntime` is cleaner than reaching through `BuiltRuntime` /
`LeadAgentHandle` — fewer surfaces, no widening of
`LeadAgentHandle`, no touching `DefaultRuntimeBuilder`. The
behavior is identical from the plan's perspective: the
canonical snapshot reaches the controller via a public
chain, not a private reach-through.

## 4. T8_NECESSITY DUAL OF T2

The dual-witness structure (T2 + T8) is the strongest single
improvement in the tightened plan. Together they pin down
the right causal relationship:

```
T2:  same canonical snapshot + different legacy TurnPhase
       → IDENTICAL canonical ArbiterSnapshot
    (canonical arbiter is independent of legacy phase)

T8:  same legacy TurnPhase + different canonical snapshot
       → DIFFERENT canonical ArbiterSnapshot
    (canonical arbiter tracks real canonical mutations)
```

The implementation enforces T2 by structural separation (the
canonical mapper does NOT accept a `TurnPhase`); the tests
enforce both T2 and T8 with concrete fixtures.

## 5. REVIEWER HEURISTICS APPLIED

The reviewer's three tightenings are encoded as code/tests:

```
Tightening #1: T3 split into T3A / T3B / T3C
   ✓ T3A STRUCTURAL_SHAPE_EQUIVALENCE  → T1 tests
   ✓ T3B SEMANTIC_INDEPENDENCE         → T2 tests
   ✓ T3C FALLBACK_EQUIVALENCE          → T3 tests

Tightening #2: ELM02F-N1 / N2 + T8 necessity
   ✓ ELM02F-N1: same snapshot + different phase → identical arbiter
     [T2 tests + @ts-expect-error enforces signature]
   ✓ ELM02F-N2: runtimeSnapshot === undefined → exact pre-ELM-02F
     [T3 tests verify byte-equivalence to pre-ELM-02F closure]
   ✓ T8: real mutation changes the canonical arbiter
     [T8 tests]

Tightening #3: no private reach-through
   ✓ SessionRuntime.snapshot() returns this.activeRuntime?.snapshot()
     (public method on public AgentRuntime.snapshot(); no reach-through)
   ✓ LocalRuntimeHost.getActiveRuntimeSnapshot(sid) reads
     active.agent.snapshot?.() (no private field access)
   ✓ VscodeSessionHost.runtimeSnapshot() proxies through ClineCore
     (single-level delegation, no encapsulation violations)
```

The reviewer's `CANONICAL_MAPPER_ACCEPTS_TURN_PHASE = false`
heuristic is enforced by:

1. The function signatures: the canonical mapper accepts ONLY
   a snapshot; the legacy fallback accepts ONLY a phase.
2. Type-level tests with `@ts-expect-error`:
   `T2.b` and `T3.e` verify that mixing the parameters fails at
   typecheck.

## 6. TWO-ABSENCE-STATE COLLAPSE

```
hostA — Local, runtimeSnapshot() returns snapshot  → canonical mapping
hostB — Local, runtimeSnapshot() returns undefined  → legacy fallback
hostC — Hub/Remote, runtimeSnapshot method absent   → legacy fallback

hostB ≡ hostC  (byte-identical legacy fallback)
```

Production code uses `?.()` everywhere; never branches on method
presence. The T4.e test verifies the selection function does NOT
inspect `'runtimeSnapshot' in host`, etc.

## 7. FILES CHANGED (production)

```
apps/vscode/src/sdk/SdkController.ts                52 ++++/----
apps/vscode/src/sdk/session-host.ts                 25 +++-
apps/vscode/src/sdk/vscode-session-host.ts          17 +++
sdk/packages/core/src/ClineCore.ts                  33 ++++
sdk/packages/core/src/runtime/host/local-runtime-host.ts    34 ++++
sdk/packages/core/src/runtime/host/runtime-host.ts  21 +++
sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts  22 +++
                                                            ─────
                                                       188 LOC additions
                                                        16 LOC deletions

NEW mapper: apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts  (~140 LOC)
NEW tests:   apps/vscode/src/sdk/__tests__/task-state-shadow-arbiter-mapper.c25-c5-elm02f.test.ts
                                                            (~430 LOC, 24 tests)
```

PRODUCTION_SEMANTIC_DELTA: 1 closure replaced + 6 new public
methods + 1 new mapper file. HUB / REMOTE unchanged.

## 8. REGRESSION SWEEP (this commit)

```
ELM-02F mapper unit tests             24 / 24 PASS  (~8ms)
T1 lifecycle (3 files)                20 / 20 PASS
C25-C4 adversarial                    12 / 12 PASS
C25-C3 classifier                     7 / 7  PASS
C-REAL bridge (C-REAL-1..5)            5 / 5  PASS
                                      ──────
                          total:     68 / 68 PASS

typecheck:c2-5-c4 (REFRESHED)         1 diag matches baseline (TaskModel)
typecheck:c2-4-c-bridge               1 diag matches baseline
typecheck:c2-4-d-hub                  1 diag matches baseline
tsc --noEmit -p tsconfig.json         28 pre-existing errors, 0 new from
                                      this commit
git diff --check                      exit 0
git diff --check bcf1e2f35..HEAD      exit 0  (C2.5 cumulative)
protected stashes intact              (FORENSIC + CONTEXT)
```

## 9. POST-ELM-02F-CORRECTION01 BOARD

```
ELM-02F-CORRECTION01                  ✅ CLOSED (this commit)
  T1 canonical source                 ✅
  T2 legacy independence              ✅ (load-bearing)
  T3 fallback exactness               ✅
  T4 source selection                 ✅
  T5 mapping exactness                ✅
  T6 types                            ✅
  T7 existing qualification           ✅
  T8 necessity                        ✅

C25_ARB_SOURCE_RESIDUE                CLOSED
CANONICAL_ARBITER_SOURCE              = AGENT_RUNTIME_SNAPSHOT
E7_AUTHORIZED                         = true   (UNBLOCK)

E7                                    🟢 NEXT (E7 backend activation ACT)
```
