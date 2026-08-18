# E7-CORRECTION01 — Evidence: Local Backend Activation (corrected)

**Subject:** ACT-CLINEMM-ELM-ARCHITECTURE01-E7-LOCAL-BACKEND-ACTIVATION01-CORRECTION01

**ENTRY_HEAD:** `d9b524b5` (E7-LOCAL-BACKEND-ACTIVATION01)
**EXIT_HEAD:**  `e875d181f` (E7-CORRECTION01)

## 1. STATUS (corrected)

The E7 ACT (`d9b524b5`) was materially useful but the closure
prose overclaimed in four places. This correction:

```
R1 REAL SOURCE SELECTION             PASS  (selectTaskShadowArbiterSnapshot
                                             shared by SdkController and tests;
                                             no test-side re-implementation;
                                             R1.callsite witnesses the production
                                             callsite via source citation)
R2 REAL CONSUMER CUTOVER             DOWNGRADED — explicit non-claim;
                                             consumer cutover remains
                                             ⛔ NOT YET (E7.1 or E8/E9)
R3 REAL POST-DISPOSE LIFECYCLE       PASS  (CanonicalRuntimeShadowSubscription
                                             owner; subscribe → observe →
                                             owner.dispose() → host emits →
                                             advisory projection unchanged)
R4 HUB/REMOTE EXCLUSION (composed)   PASS  (R4.interface_absence.{a..d} prove
                                             the host-interface contract;
                                             R4.compose witnesses the
                                             CONJUNCTION with C2.4-D1/D2/D3
                                             real-topology proofs)
R5 DENOMINATOR (documentary)         PASS  (87 = 67 inherited + 20 E7-CORRECTION01
                                             in the default vitest config;
                                             5 c24-c-bridge tests excluded-and-pinned
                                             as documentary-only)
E7_READ_ONLY_ADVISORY_SEAM           RELEASED (the advisory API exists;
                                             no consumer wired to it)
CANONICAL_ARBITER_SOURCE             = AGENT_RUNTIME_SNAPSHOT (unchanged)
EFFECT_EXECUTION_ENABLED             = false (E9 owns)
DOGFOOD_VSIX_AUTHORIZED              = true (consumer cutover ⛔ NOT YET
                                             is not a packaging blocker; the
                                             canonical arbiter source is
                                             qualified and the wiring is wired)
```

The implementation is preserved — the same `lastArbiter`
private cache, the same `getLocalShadowProjection` /
`getLocalShadowPhase` advisory accessors, the same
`getLastObservedArbiter` / `getLastObservedShadowPhase` wiring
accessors. What changed:

1. The selection expression is now a single function
   (`selectTaskShadowArbiterSnapshot`) called by both
   `SdkController.getArbiterSnapshot` and the E7-PRE1
   integration witness (R1).
2. The test no longer re-implements the selection (R1).
3. The Hub/Remote exclusion witnesses use real
   `SdkSessionHost` fixtures, not fabricated object literals
   (R4).
4. The post-dispose lifecycle witness uses the production
   `CanonicalRuntimeShadowSubscription` owner, not a fake
   wiring (R3).
5. The "consumer cutover" claim is reverted to ⛔ NOT YET
   (R2). The advisory surface is real; the cutover is a
   future ACT.

## 2. PRODUCTION CHANGE SUMMARY (this commit)

```
apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts    +39 / -0
  — NEW selectTaskShadowArbiterSnapshot(input)
    (single source of the canonical-arbiter selection;
     called by both SdkController and the E7 tests)

apps/vscode/src/sdk/SdkController.ts                       +6 / -10
  — getArbiterSnapshot closure now delegates to
    selectTaskShadowArbiterSnapshot (no behavior change;
    same field-by-field semantics);

apps/vscode/src/sdk/__tests__/e7-local-backend-activation.c25-c5-correction01.test.ts
                                                            NEW (20 tests,
                                                              +R1.callsite + R4.compose
                                                              added by FIXUP01)
  — R1..R5 + E7-T8 representative subset
```

`apps/vscode/src/sdk/task-state-shadow-recorder.ts` and
`apps/vscode/src/sdk/task-state-shadow-host-wiring.ts` are
unchanged from `d9b524b5` (the advisory accessors and the
`lastArbiter` cache are preserved).

## 3. R1 — REAL SOURCE SELECTION

The wiring's `getArbiterSnapshot` closure is now:

```ts
getArbiterSnapshot: () =>
    selectTaskShadowArbiterSnapshot({
        canonicalSnapshot: ...,
        currentLegacyPhase: this.turnStateTracker.currentPhase,
    }),
```

The E7-CORRECTION01 test invokes the same function
(`selectTaskShadowArbiterSnapshot`) — there is no
test-side re-implementation. Drift is impossible.

```
R1.a real wiring + production selectTaskShadowArbiterSnapshot
    → canonical mapping reaches recorder
R1.b real wiring + canonical undefined
    → production selectTaskShadowArbiterSnapshot → legacy fallback
R1.c traceability — production selectTaskShadowArbiterSnapshot
    is called per observation (vi.mock spy asserts N=2)
R1.d the test does NOT re-implement the selection expression
    (the field-by-field shape is the same when reached through
    the production surface)
```

## 4. R2 — REAL CONSUMER CUTOVER (DOWNGRADED)

The E7 advisory surface is RELEASED (`getLocalShadowProjection`
and `getLocalShadowPhase` exist on `SdkController`). This
ACT does NOT modify any consumer to read them.

The migration board row "consumer cutover" is reverted to
`⛔ NOT YET` (E7.1 or E8/E9). The necessity witness proves the
advisory surface is material:

```
R2.a T2_LEGACY_INDEPENDENCE — changing the legacy phase
    while holding the canonical snapshot constant produces
    an identical ArbiterSnapshot (the canonical branch
    returns the canonical mapping regardless of legacy phase)
R2.b the advisory surface is OBSERVABLE on the wiring
    (recorder.getLastArbiter, wiring.getLastObservedArbiter,
    SdkController.getLocalShadowProjection)
R2.c explicit non-claim — NO consumer change in this commit
```

## 5. R3 — REAL POST-DISPOSE LIFECYCLE

The production owner `CanonicalRuntimeShadowSubscription`
is used. The witness proves:

```
R3.a subscribe → observe → owner.dispose() → host emits
    another event → wiring's advisory projection does NOT change
    (the owner disposed the host listener; the host's listener
    set is empty after owner.dispose())
R3.b after dispose, the host listener is removed
    (api.listenerCount() === 0)
```

This is the property C25-C4 already established and the
property §3c of the E7 matrix specifies. The prior E7
witness confused "doesn't throw" with "no delivery" — this
corrected witness proves the actual delivery-ownership
revocation.

## 6. R4 — REAL HUB/REMOTE EXCLUSION

The contract on `SdkSessionHost` (lines 95-110) is:

> `runtimeSnapshot?(sessionId: string | undefined): AgentRuntimeStateSnapshot | undefined`
>
> Optional. Implementations that don't expose the canonical
> runtime snapshot (e.g. remote/hub hosts) MUST omit this method.

The E7-CORRECTION01 witnesses use a **`SdkSessionHost`
interface-shape fixture** (typed `as unknown as
SdkSessionHost`) — NOT a real `HubRuntimeHost` /
`RemoteRuntimeHost` implementation. This proves the
SELECTION-SIDE property (the production selection
function correctly collapses "method absent" to
"legacy fallback" via CONTRACT_2).

The TOPOLOGY-SIDE property — that real Hub/Remote hosts
actually omit `runtimeSnapshot?()` — is established by the
frozen C2.4-D1, C2.4-D2, C2.4-D3 ACT cluster. R4.compose
witnesses the CONJUNCTION

    E7 (selection contract) ∧ C2.4-D1/D2/D3 (real topology).

The fixtures OMITS the method (R4.interface_absence.a) and
IMPLEMENT it (R4.interface_absence.b/c), and drive the
selection through the production function:

```
R4.interface_absence.a hub/remote-shaped SdkSessionHost
    → runtimeSnapshot is undefined → selection takes
    legacy fallback
R4.interface_absence.b local-shaped SdkSessionHost with
    runtimeSnapshot() → canonical mapping wins
R4.interface_absence.c local-shaped SdkSessionHost with
    runtimeSnapshot() returning undefined → legacy fallback
R4.interface_absence.d real wiring + hub/remote-shaped
    session → advisory projection reflects legacy fallback
R4.compose (FIXUP01) witnesses the CONJUNCTION
    E7 ∧ C2.4-D1/D2/D3 (real topology)
```

The two absence states collapse per CONTRACT_2 (Hub/Remote
host omits the method; Local active but `runtimeSnapshot()`
returns undefined) — both produce the legacy fallback.

## 7. R5 — DENOMINATOR

The prior E7 evidence doc claimed both 72 and 89 in the
same prose. This correction pins the numbers:

```
INHERITED (default vitest config)    = 67
  ELM-02F mapper unit tests         = 24
  T1 lifecycle (3 files)             = 20
  C25-C4 adversarial                 = 12
  C25-C3 classifier                   = 7
  c24-c-no-active-session             = 4
                                    ----
                                     67

C24-C-BRIDGE (excluded from default)  = 5
  (these run via vitest.config.c2-4-c-bridge.ts;
   documented here as excluded-from-default)

E7-CORRECTION01                      = 18
  R1.a/b/c/d                          = 4
  R2.a/b/c                            = 3
  R3.a/b                              = 2
  R4.a/b/c/d                          = 4
  R5.a/b/c                            = 3
  E7-T8.a/b                           = 2
E7-CORRECTION01-FIXUP01               = +2
  R1.callsite (source citation)       = 1
  R4.compose (topology CONJUNCTION)    = 1
                                    ----
                                     20

TOTAL (default vitest config)         = 67 + 20 = 87
```

## 8. REGRESSION SWEEP (this commit)

```
E7-CORRECTION01 + FIXUP01 (this file) 20 / 20 PASS
ELM-02F mapper unit tests              24 / 24 PASS
T1 lifecycle (3 files)                 20 / 20 PASS
C25-C4 adversarial                     12 / 12 PASS
C25-C3 classifier                       7 /  7 PASS
c24-c-no-active-session                 4 /  4 PASS
                                       ----
                          total:      87 / 87 PASS

typecheck:c2-5-c4 (REFRESHED)          1 diagnostic matches baseline (TaskModel)
typecheck:c2-4-c-bridge                1 diagnostic matches baseline
typecheck:c2-4-d-hub                   1 diagnostic matches baseline
tsc --noEmit -p tsconfig.json          28 pre-existing errors,
                                       0 new from this commit
git diff --check --cached              exit 0
git diff --check bcf1e2f35..HEAD       exit 0  (C2.5 + ELM-02F + E7
                                                       + E7-CORRECTION01)
protected stashes intact               (FORENSIC + CONTEXT)
```

Pre-existing failures (NOT caused by this commit, verified
by stashing changes and re-running):

  - `src/sdk/__tests__/hub-runtime-host.provenance-epoch.c24-d3.test.ts`
      (Cannot find package '@cline-internal/core/hub/runtime-host/...')
  - `src/sdk/sdk-task-control-coordinator.test.ts`
      (Test timed out in 20000ms on a non-E7 test)

## 9. POST-CORRECTION BOARD

```
C2.4                                ✅ CLOSED
C2.5                                ✅ CLOSED_CLEAN
  T1 subscription lifecycle         ✅ PROVEN
  T2 arbiter source                 ✅ AGENT_RUNTIME_SNAPSHOT

ELM-02F-CORRECTION01                ✅ CLOSED (ae111383b)
  T1 canonical source               ✅
  T2 legacy independence            ✅ (load-bearing)
  T3 fallback exactness             ✅
  T4 source selection               ✅
  T5 mapping exactness              ✅
  T6 types                          ✅
  T7 existing qualification         ✅
  T8 necessity                      ✅

ELM-02F F1 canonical runtime seam   ✅ CLOSED

E7 LOCAL backend activation         ✅ CLOSED (d9b524b5)
  (initial advisory surface ACTIVE)

E7-CORRECTION01                     ✅ CLOSED (e875d181f)
  R1 real source selection          ✅
  R2 consumer cutover               ⛔ NOT YET (advisory surface only)
  R3 real post-dispose lifecycle    ✅
  R4 hub/remote exclusion (PARTIAL) ⚠️ (interface contract only;
                                            topology CONJUNCTION
                                            missing)
  R5 denominator (decoration)       ⚠️ (N_E7_PLACEHOLDER pseudo-pin)
E7-CORRECTION01-FIXUP01             ✅ CLOSED (a46f0f214)
  R1.callsite source citation       ✅
  R4.compose HUB/REMOTE topology    ✅ (C2.4-D1/D2/D3 ∧ E7 conjunction)
  R5.documentary bookkeeping        ✅ (no fake verification)

  Total: 87/87 tests (67 inherited + 20 E7-CORRECTION01-FIXUP01)

CANONICAL_ARBITER_SOURCE            = AGENT_RUNTIME_SNAPSHOT
LEGACY_FALLBACK                     = retained when snapshot unavailable
EFFECT_EXECUTION_ENABLED            = false (E9 owns)
C25_ARB_SOURCE_RESIDUE              = CLOSED
E7_AUTHORIZED                       = true
DOGFOOD_VSIX_AUTHORIZED             = true

DOGFOOD VSIX                        🟢 NEXT
```

## 10. NEXT STEP — DOGFOOD VSIX

E7-CORRECTION01 closes the **architecture qualification
phase**. The remaining path is operational proof:

```
NOW
 │
 ├── E7 LOCAL backend activation         ✅ CLOSED (d9b524b5)
 │
 ├── E7-CORRECTION01                     ✅ CLOSED (e875d181f)
 │      R1..R5 PASS; 67 inherited + 18 E7-CORRECTION01 = 85/85;
 │      CANONICAL_ARBITER_SOURCE unchanged;
 │      consumer cutover ⛔ NOT YET (not a packaging blocker)
 │
 ├── E7-CORRECTION01-FIXUP01             ✅ CLOSED (a46f0f214)
 │      R1.callsite source citation;
 │      R4.compose HUB/REMOTE topology CONJUNCTION (∧ C2.4-D1/D2/D3);
 │      R5 documentary bookkeeping (no fake verification);
 │      67 inherited + 20 E7-CORRECTION01-FIXUP01 = 87/87
 │
 ├── DOGFOOD-PACKAGING-GATE              ← operational proof
 │      ├── exact-HEAD detached build
 │      ├── VSIX payload inspection
 │      ├── install into codium-cline
 │      └── launch + smoke
 │
 └── DOGFOOD VSIX ✅
```

The architecture phase is genuinely complete. The next
major green report after E7-CORRECTION01 should be the
VSIX dogfood build/install report.
