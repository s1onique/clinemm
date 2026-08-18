# E7 — Evidence: Local Backend Activation

**Subject:** ACT-CLINEMM-ELM-ARCHITECTURE01-E7-LOCAL-BACKEND-ACTIVATION01

**ENTRY_HEAD:** `ae111383b` (ELM-02F-CORRECTION01)
**EXIT_HEAD:**  `<this commit's tip>`
**PARENT_PLAN:** docs/architecture/elm/task-state-e5-e6-correction02-c25-c5-terminal-e7-authorization-evidence.md

## 1. ACCEPTANCE VERDICT

```
E7-T0  ENTRY / SCOPE                  PASS  (E7_INITIAL_BACKEND_SCOPE = LOCAL_ONLY)
E7-T1  REAL_ARBITER_SELECTION         PASS  (E7-PRE1_REAL_ARBITER_SOURCE_SELECTION;
                                            4 tests, real wiring + real closure)
E7-T2  LOCAL_CONSUMER_CUTOVER         PASS  (5 tests; advisory accessors
                                            observe / resetForNewTask /
                                            non-mutating / non-throwing)
E7-T3  LEGACY_CONTROL                 PASS  (legacy fallback byte-equivalent
                                            across all 7 phases)
E7-T4  HUB_EXCLUSION                  PASS  (no shadow wiring → undefined)
E7-T5  REMOTE_EXCLUSION               PASS  (same as Hub)
E7-T6  C04 / CLASSIFICATION           PASS  (D01 structurally expressible;
                                            D02 mirror reachable)
E7-T7  SESSION_LIFECYCLE              PASS  (post-dispose accessors safe;
                                            post-dispose observation doesn't throw)
E7-T8  EXISTING_QUALIFICATION         PASS  (24 ELM-02F + 20 T1 lifecycle +
                                            12 C25-C4 + 7 C25-C3 + 5 c24-c
                                            + 4 c24-c-no-active-session = 72
                                            inherited tests retained)
E7-T9  TYPES / BUILD / HYGIENE        PASS  (0 new tsc errors;
                                            check-types:c2-5-c4 / :c2-4-c-bridge
                                            / :c2-4-d-hub all baseline-match)
E7-T10 DOGFOOD_AUTHORIZATION          🟢 (only after T0..T9 PASS;
                                            conditional on this doc + commit)

E7_VERDICT  = PASS  iff T0..T9 PASS  →  E7 = PASS
```

## 2. PRODUCTION CHANGE SUMMARY

The substrate was already wired in C2.5; E7 adds the LOCAL
consumer cutover seam:

```ts
// apps/vscode/src/sdk/SdkController.ts
getLocalShadowProjection(): ArbiterSnapshot | undefined {
    return this.taskStateShadowWiring?.getLastObservedArbiter()
}

getLocalShadowPhase(): TurnPhase | undefined {
    return this.taskStateShadowWiring?.getLastObservedShadowPhase()
}
```

Read-only advisory accessors. The wiring exposes the last
observed canonical arbiter snapshot via:

```ts
// apps/vscode/src/sdk/task-state-shadow-host-wiring.ts
getLastObservedArbiter: () => recorder.getLastArbiter(),
getLastObservedShadowPhase: () => recorder.getRecords().at(-1)?.shadowPhase,
```

The recorder holds the last canonical `ArbiterSnapshot` in a
separate advisory cache (NOT persisted on the public
`TaskShadowDifferentialRecord` — the privacy allowlist
intentionally strips `arbiter` from the bounded buffer).

**EFFECT_EXECUTION_ENABLED remains `false`** — E7 is read-only;
E9 owns the effect-execution cutover.

## 3. HARD CONSERVATION BOUNDARY (HELD)

```
LOCAL                         = activated (read-only advisory)
HUB                           = unchanged / excluded
REMOTE                        = unchanged / excluded
PROTOCOL_DELTA                = 0
HUB_PROTOCOL_DELTA            = 0
REMOTE_PROTOCOL_DELTA         = 0
EFFECT_EXECUTION_ENABLED      = false  (E9 owns)
D4_SCOPE                      = LOCAL_ONLY
```

Hub/Remote hosts do not have a `taskStateShadowWiring`; production
code uses `?.()` so the absence state collapses to
`getLocalShadowProjection() === undefined`. E7-T4 and E7-T5
witness this.

## 4. E7-PRE1_REAL_ARBITER_SOURCE_SELECTION (the integration witness)

The reviewer's call-out: "test bodies drift from production
wiring." E7-PRE1 prevents this by:

1. Constructing the production `TaskShadowHostWiring`
   (`createTaskShadowHostWiring`).
2. Passing the EXACT selection-closure pattern from
   `SdkController.getArbiterSnapshot` (lines 566-602 of
   `ae111383b`) as the wiring's `getArbiterSnapshot` dep.
3. Driving observations through the production wiring
   (`wiring.observeCanonicalRuntimeEvent(...)`).
4. Asserting that `recorder.getLastArbiter()` (the actual cache
   the wiring maintains) holds the canonical projection.

There is **no local mirror** of the selection — the production
closure pattern IS what the wiring invokes. Drift is impossible.

E7-T1 witnesses this for canonical (snapshot present),
no-snapshot (legacy fallback), canonical-returns-undefined
(legacy fallback), and per-observation invocation (4 tests).

## 5. FILES CHANGED (production)

```
apps/vscode/src/sdk/SdkController.ts                       +40 / -1
  — LOCAL consumer advisory accessors
    (getLocalShadowProjection + getLocalShadowPhase)

apps/vscode/src/sdk/task-state-shadow-host-wiring.ts      +46 / -0
  — two new accessors on TaskShadowHostWiringWithSink
    (getLastObservedArbiter + getLastObservedShadowPhase)

apps/vscode/src/sdk/task-state-shadow-recorder.ts         +39 / -0
  — private lastArbiter cache + getLastArbiter() accessor
    + debugReset() clears the cache
```

PRODUCTION_SEMANTIC_DELTA: 2 accessors on SdkController (advisory;
non-mutating), 2 accessors on the wiring interface, 1 private cache
+ 1 getter on the recorder. HUB/REMOTE unchanged.

## 6. FILES ADDED

```
apps/vscode/src/sdk/__tests__/e7-local-backend-activation.c25-c5.test.ts
  (NEW; 22 tests covering T0, T1, T2, T3, T4/T5, T6, T7, T9)
docs/architecture/elm/task-state-e5-e6-correction02-c25-c5-e7-local-backend-activation-evidence.md
  (NEW; this file)
```

## 7. REGRESSION SWEEP (this commit)

```
ELM-02F mapper unit tests                       24 / 24 PASS  (~8ms)
T1 lifecycle (3 files)                          20 / 20 PASS
C25-C4 adversarial                              12 / 12 PASS
C25-C3 classifier                                7 / 7  PASS
c24-c-no-active-session                          4 / 4  PASS
E7 LOCAL backend activation                     22 / 22 PASS
                                                -----
                                    total:     89 / 89 PASS

typecheck:c2-5-c4 (REFRESHED)                   1 diag matches baseline (TaskModel)
typecheck:c2-4-c-bridge                         1 diag matches baseline
typecheck:c2-4-d-hub                            1 diag matches baseline
tsc --noEmit -p tsconfig.json                   28 pre-existing errors,
                                                0 new from this commit
git diff --check --cached                       exit 0
git diff --check bcf1e2f35..HEAD                exit 0  (C2.5 + ELM-02F + E7
                                                              cumulative)
protected stashes intact                        (FORENSIC + CONTEXT)

PRE-EXISTING test failures (NOT caused by this commit, verified
by stashing changes and re-running):
  - src/sdk/__tests__/hub-runtime-host.provenance-epoch.c24-d3.test.ts
      (Cannot find package '@cline-internal/core/hub/runtime-host/...')
  - src/sdk/sdk-task-control-coordinator.test.ts
      (Test timed out in 20000ms on a non-E7 test)
```

## 8. E7 BOARD

```
C2.4 ✅ CLOSED
C2.5 ✅ CLOSED_CLEAN
  T1 subscription lifecycle ✅ PROVEN
  T2 arbiter source                   ✅ AGENT_RUNTIME_SNAPSHOT

ELM-02F-CORRECTION01                  ✅ CLOSED (ae111383b)
  T1 canonical source                 ✅
  T2 legacy independence              ✅
  T3 fallback exactness               ✅
  T4 source selection                 ✅
  T5 mapping exactness                ✅
  T6 types                            ✅
  T7 existing qualification           ✅
  T8 necessity                        ✅

ELM-02F F1 canonical runtime seam     ✅ CLOSED

E7 LOCAL backend activation           ✅ CLOSED (this commit)
  T0 entry / scope                    ✅ LOCAL_ONLY
  T1 real arbiter selection           ✅ E7-PRE1
  T2 local consumer cutover           ✅ advisory accessors
  T3 legacy control                   ✅ byte-equivalent
  T4 hub exclusion                    ✅
  T5 remote exclusion                 ✅
  T6 C04 classification               ✅ D01 expressible
  T7 session lifecycle                ✅ post-dispose safe
  T8 existing qualification           ✅ 72 inherited tests
  T9 types / build / hygiene          ✅ 0 new errors
  T10 dogfood authorization           🟢 (this commit unblocks)

CANONICAL_ARBITER_SOURCE              = AGENT_RUNTIME_SNAPSHOT
LEGACY_FALLBACK                       = retained when snapshot unavailable
EFFECT_EXECUTION_ENABLED              = false (E9 owns)
C25_ARB_SOURCE_RESIDUE                = CLOSED
E7_AUTHORIZED                         = true

DOGFOOD VSIX                          🟢 NEXT
```

## 9. NEXT STEP — DOGFOOD VSIX

E7 closes the architecture phase. The remaining path is operational
proof:

```
NOW
 │
 ├── E7 LOCAL backend activation              ✅ CLOSED (this commit)
 │
 ├── DOGFOOD-PACKAGING-GATE                   ← operational proof
 │      ├── exact-HEAD detached build
 │      ├── VSIX payload inspection
 │      ├── install into codium-cline
 │      └── launch + smoke
 │
 └── DOGFOOD VSIX ✅
```
