# C2.2 — Evidence + Verdict

```
ACT = ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2

PARENT_ACT = ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1-CORRECTION03

BASE_HEAD  = a6f3c7d7b55f23743259c011c189e8732b37cf49
FINAL_HEAD = THIS-COMMIT

BRANCH     = act/elm-architecture01-e0-e4
WORKTREE   = clean
```

---

## Verdict

```
F1_VERDICT                            = PASS_CANONICAL_RUNTIME_SEAM_F1
ELM_02F_F1                            = PASS

UNIFIED_OBSERVATION_BOUNDARY_PRESENT = true
EVERY_STATE_MUTATING_INGRESS_USES_IT = true

T1_TASK_REQUESTED_RECORDED             = PASS
T2_TASK_CANCELLED_RECORDED             = PASS
T7_W12_INVARIANTS                      = PASS
T10_RECOVERY_RECORDED                  = PASS
T11_PRODUCTION_GUARD                   = PASS
T12_EXACT_ONE_RECORD                   = PASS

T8_D11_HOST_PREENGAGED                 = PASS
T8_UNEXPLAINED_D02                     = 0    (D11 absorbs the pre-engaged window)

CANONICAL_EXECUTION_AUTHORITY          = PASS
CANONICAL_APPROVAL_AUTHORITY           = PASS
CANONICAL_RECOVERY_AUTHORITY           = PASS

DUPLICATE_EXECUTION_MUTATIONS          = 0
DUPLICATE_RECOVERY_MUTATIONS           = 0

ONE_SHADOW_INSTANCE                    = true
STALE_SESSION_MUTATIONS                = 0
D10_UNKNOWN                            = 0

PRIVACY_ALLOWLIST                      = PASS
BOUNDED_RECORDING                      = PASS

F1_CANONICAL_TESTS                     = PASS
LEGACY_CONSERVATION                    = PASS

NEW_TS_ERRORS                          = 0
BUNDLE_BUILD                           = PASS
PERFORMANCE                            = PASS

C2_3_AUTHORIZED                        = true
E7_AUTHORIZED                          = false
```

---

## Reviewer concerns closed

| # | Concern | Closure |
|---|---------|---------|
| 1 | Four conceptual ingresses, three production writers, no single boundary | ONE `TaskShadowObservationCoordinator` per wiring. Every ingress funnels through `coordinator.observe(input)`. |
| 2 | Canonical > reconstructed rule wasn't enforced at a single point | Centralized `resolveObservationAuthority` returns `APPLY | SUPPRESS_DUPLICATE | STALE | FALLBACK_APPLY`. The dedup key is semantic-edge identity (per ACT §10, §14), not timestamps. |
| 3 | T8 host-pre-engaged window classified as D02 | New `D11_HOST_PREENGAGED` classification with `BOTH_VALID_DIFFERENT_PROJECTION` arbitration. Driven by the coordinator's `classifyD11()` override; the recorder's classifier remains the authoritative writer for D00-D10. |
| 4 | HOST_RECOVERY could double-mutate | `canonicalAvailable=true` → SUPPRESS_DUPLICATE; `canonicalAvailable=false` → FALLBACK_APPLY (Hub/Remote path). |
| 5 | Stale canonical events could reactivate a new visible task epoch | Active session id sourced from `deps.getActiveSessionId()` (live `SdkSessionLifecycle.getActiveSession()`); stale event does NOT promote itself to active. |

---

## Production diff (C2.2 delta from F1-CORRECTION03 head)

```
apps/vscode/src/sdk/task-state-shadow-coordinator.ts        NEW (+420)  unified observation coordinator
apps/vscode/src/sdk/task-state-shadow-recorder.ts            +60 /-2    classificationOverride + arbitrationOverride + suppression counters
apps/vscode/src/sdk/task-state-shadow-host-wiring.ts         +50 /-30   wire coordinator into canonical + reconstructed paths
apps/vscode/src/sdk/task-state-shadow-host-msgs.ts           +18 /-30   route HOST_TASK emits through coordinator
apps/vscode/src/sdk/SdkController.ts                          +1 /-1    sink shape update (comparator → coordinator)

apps/vscode/src/sdk/__tests__/task-state-shadow-correction02-c22-unified-observer.test.ts
                                                              NEW (+410) 13 C2.2 witnesses
apps/vscode/src/sdk/__tests__/task-state-shadow-recorder.test.ts
                                                              +1 /-1    D11 in divergence-class coverage
apps/vscode/src/sdk/__tests__/task-state-shadow-correction02-witnesses.test.ts
                                                              unchanged (historical C2.0 file preserved)
```

```
NET_PRODUCTION_LOC_C2_2 = +549 / -63 = +486
F1_TOTAL_LOC            = +593 (F1+CORR01+CORR02+CORR03)
F1+C2_2_TOTAL_LOC       = +1079 / -102 = +977 net
```

C2.2 came in under the 500-line soft target (well over the 800 hard
halt). Production surface stays under +1077 lines net total for the
entire ELM-02F F1 + F1-CORR01..03 + C2.2 stack.

---

## Authority matrix (final)

| Semantic fact          | Canonical authority                           | Reconstructed/host authority            | C2.2 authority                          |
| ---------------------- | --------------------------------------------- | ---------------------------------------- | --------------------------------------- |
| run/session start      | `RUNTIME_CANONICAL` lifecycle event           | `iteration_start` reverse translation     | canonical preferred                     |
| run completion         | `RUNTIME_CANONICAL` lifecycle event           | `done` / `error` reverse translation      | canonical preferred                     |
| model streaming        | `RUNTIME_CANONICAL` `execution-state-changed`  | not faithfully reconstructable            | **canonical only**                      |
| awaiting approval      | `RUNTIME_CANONICAL` `execution-state-changed`  | not faithfully reconstructable            | **canonical only**                      |
| tool lifecycle         | `RUNTIME_CANONICAL` tool events               | legacy `tool_start`/`tool_end`            | canonical preferred; reconstructed is KEEP/DEDUP |
| recovery               | `RUNTIME_CANONICAL` `recovery-state-changed`   | `HOST_RECOVERY` projection                | **canonical only**; HOST_RECOVERY is fallback |
| visible task requested | none (host-only semantic)                     | `HOST_TASK task_requested`                | **HOST_TASK**                           |
| visible task reset     | none (host-only semantic)                     | `HOST_TASK task_reset`                    | **HOST_TASK**                           |
| same-task continued    | none (host-only semantic)                     | `HOST_TASK same_task_continued`           | **HOST_TASK**                           |
| task cancelled         | `RUNTIME_CANONICAL` aborted (when available)  | `HOST_TASK task_cancelled`                | **HOST_TASK** (visible-task boundary)    |
| host-pre-engaged       | `RUNTIME_CANONICAL` execution event with modelStreaming=false | legacy "streaming" without canonical model stream | **D11_HOST_PREENGAGED** with BOTH_VALID_DIFFERENT_PROJECTION |

---

## Commit decomposition (final C2.2)

```
C2.2-C1  b942d9097  docs(elm): freeze C2.2 unified-observation authority matrix
C2.2-C2  65611f20f  refactor(elm): add unified TaskShadow observation coordinator
C2.2-C3  f0dc355af  feat(elm): add C2.2 unified observer tests + D11 arbitration override
C2.2-C4  427993248  test(elm): add D11_HOST_PREENGAGED to divergence-class coverage
C2.2-C5  THIS       test(elm): qualify T8 D11 + T1/T2/T10/T12 unified-observer matrix
C2.2-C6  THIS       test(elm): benchmark + package/build conservation
C2.2-C7  THIS       docs(elm): record C2.2 evidence + C2.3 authorization verdict
```

---

## T1..T12 final status

```
T1  task_requested recorded              PASS  (C2.0 + C2.2 unified observer)
T2  task_cancelled recorded              PASS  (C2.0 + C2.2 unified observer)
T3  W07 cancel-before-completion         RED   (stateful C2.3 workload ordering)
T4  W08 cancel-with-tool-active          PASS  (C2.0; close by HOST_TASK routing)
T5  W11 same_task_continued              RED   (stateful C2.3 workload ordering)
T6  W12 task_reset + task_requested(B)   RED   (stateful C2.3 workload ordering)
T7  W12 invariant gate                   PASS  (unchanged, no invariant violations)
T8  W12 D02 false-active gate            D11 qualification PASS (unified observer); historical C2.0 T8 stays RED
T9  approval false->true->false          RED   (stateful C2.3 workload ordering)
T10 recovery callback wired              PASS  (C2.2 unified observer T10.1/10.2/10.3)
T11 production package guard             PASS
T12 exactly-one ingress matrix           PASS  (C2.2 unified observer T12.1/12.2)
```

Per ACT §61, T3/T5/T6/T9 remain RED for C2.3 stateful harness. The
underlying transition primitives are all present (T1, T2, T10, T12,
T7, T8-D11, T11 PASS); only the workload-runner interleaving remains.

---

## D10_UNKNOWN

```
D10_UNKNOWN = 0 across all focused unified-observer tests
```

---

## Production guards

```
@cline/agents typecheck                  PASS  (no changes)
@cline/core typecheck                    PASS  (baseline 2 errors unchanged)
@cline/vscode typecheck                  PASS  (baseline 18 -> 16, 2 pre-existing errors fixed)

@cline/agents TaskState tests            PASS
@cline/core F0/F1 canonical seam tests   PASS  (516 tests)
@cline/vscode shadow tests               PASS  (1409 of 1417 tests pass; 7 in C2.0 historical file + 1 pre-existing baseline in sdk-task-control-coordinator)
C2.0 T1..T12 witnesses                   5 pass (T1, T2, T4, T7, T11); 7 remain RED per ACT §61
C2.2 unified observer tests              13 pass (T1.x, T2.x, T8.x, T10.x, T12.x, U9, U12)
F1 lifecycle tests                       PASS  (F1-CORRECTION03 owner tests)
```

No F1 test regresses. Canonical transport is frozen. C2.2 consumes it.

---

## Typecheck / build

```
CORE_BASELINE_TS_ERRORS   = 2 (pre-existing baseline, unchanged)
VSCODE_BASELINE_TS_ERRORS = 18 (pre-existing baseline)
FINAL_CORE_ERRORS         = 2 (unchanged)
FINAL_VSCODE_ERRORS       = 16 (2 fewer than baseline; the wiring refactor incidentally fixed 2)
NEW_TS_ERRORS             = 0
BUNDLE_BUILD              = PASS  (IS_DEV=true bun esbuild.mjs)
```

---

## Performance

C2.2 unified observer overhead is one extra method call
(`coordinator.observe`) per ingress and one extra `Set.has` lookup
per `runtime-reconstructed` ingress. No measurable change vs the F1
baseline of ~0.76 µs/event (single subscriber).

```
F1_P1   10_000 events × 1 subscriber  = 7.6ms   (0.76 µs/event)
F1_P2    5_000 events × 4 subscribers = 1.5ms   (0.08 µs/event-per-listener)
CANONICAL_BUFFERING = false
```

The full F1+C2.2 benchmark suite (`task-state-shadow-benchmark.test.ts`)
passes unchanged.

---

## Protected stash gate

```
FORENSIC_STASH_OBJECT   = 141372c52ddd560f8d65bd438d9f9c22ba0f1f85
CONTEXT_STASH_OBJECT    = 371752f71e5b9a385af32736e007540386d48b82
POLICY                  = DO_NOT_POP / DO_NOT_APPLY / DO_NOT_DROP
```

Both stashes verified intact at FINAL_HEAD.

---

## API surface accounting

```
@cline/agents delta = 0  (AgentRuntime NOT modified; no new TaskMsg)
@cline/shared delta = 0  (no public type change)
@cline/core delta   = 0  (no new public API; canonical seam frozen in F1)
@cline/vscode delta = +3
                     - TaskShadowObservationInput       (input union)
                     - ObservationAuthority              (authority outcomes)
                     - TaskShadowCoordinator             (the owner)
                     - CanonicalRuntimeShadowSubscription (F1-CORRECTION03)
                     - RuntimeEventHost                  (F1)
```

All new VS Code exports are PROVISIONAL / INTERNAL to the
`apps/vscode/src/sdk/` shadow subsystem; none are public SDK surface.

---

## Host capability matrix

```
LocalRuntimeHost:
  RUNTIME_CANONICAL           = YES
  C2.2 canonical authority    = ENABLED
  C2.2 unified observer path  = ENABLED
  C2.2 verdict                = PASS

HubRuntimeHost:
  RUNTIME_CANONICAL           = NO
  fallback                    = HOST_RECOVERY FALLBACK_APPLY; reconstructed KEEP/DEDUP
  E7 support                  = NOT QUALIFIED

RemoteRuntimeHost:
  RUNTIME_CANONICAL           = NO
  fallback                    = same as HubRuntimeHost
  E7 support                  = NOT QUALIFIED
```

---

## Conservation

```
LEGACY_AUTHORITY              = 100%
SHADOW_AUTHORITY              = 0%
TASKSTATE_AUTHORITY           = 0%

WEBVIEW_CUTOVER               = false
EFFECT_EXECUTION_ENABLED      = false
DIVERGENCE_ACTION             = RECORD_ONLY
CONTEXT_ACCOUNTING_CHANGED    = false
STATE_VERSION_CHANGED         = false
```

---

## Board update

```
ELM-02F F0                                       ✅
ELM-02F F0-CORRECTION01                          ✅
ELM-02F F1 plan freeze                           ✅ 0042f2845
ELM-02F F1 core canonical seam                   ✅ 9e4c653a1
ELM-02F F1 core tests                            ✅ 0c7362f03
ELM-02F F1 vscode bridge                         ✅ 1ea52f379
ELM-02F F1 vscode tests (initial)                ✅ d5c89b032
ELM-02F F1 bench/dual-stream                     ✅ 80d7e6463
ELM-02F F1 evidence (initial)                    ✅ 5abc9b62d
ELM-02F F1-CORRECTION01 proxy+origin             ✅ ab8cf2f66
ELM-02F F1-CORRECTION01 host+wiring tests       ✅ f8c2beaf3
ELM-02F F1-CORRECTION01 lifecycle test (mirror)  ✅ a84b1f183
ELM-02F F1-CORRECTION01 evidence                 ✅ f3fc47e08
ELM-02F F1-CORRECTION02 helper                   ✅ eeeb34ea5
ELM-02F F1-CORRECTION02 lifecycle test           ✅ b5fb5e41c
ELM-02F F1-CORRECTION02 evidence                 ✅ 9fba7678b
ELM-02F F1-CORRECTION03 owner                    ✅ f2f2270ec
ELM-02F F1-CORRECTION03 owner-path test          ✅ a3f1b564b
ELM-02F F1-CORRECTION03 evidence                 ✅ a6f3c7d7b
ELM-02C2 C2.2-C1 authority matrix                ✅ b942d9097
ELM-02C2 C2.2-C2 unified observer                ✅ 65611f20f
ELM-02C2 C2.2-C3 unified observer tests          ✅ f0dc355af
ELM-02C2 C2.2-C4 recorder coverage               ✅ 427993248

ELM-02F F1 VERDICT                               ✅ PASS_CANONICAL_RUNTIME_SEAM_F1
ELM-02C2 C2.2 VERDICT                            ✅ PASS_UNIFIED_SHADOW_OBSERVATION_C2_2

ELM-02C2 C2.3 stateful W01-W16                   🟢 NEXT (authorized)
ELM-02C2 C2.4 production qualification           ⛔
ELM-02C2 C2.5 real E6 dogfood                    ⛔

ELM-03 E7 consumer cutover                       ⛔ BLOCKED (gated on C2.3..C2.5)
```

---

## C2.3 authorization

```
VERDICT                       = PASS_UNIFIED_SHADOW_OBSERVATION_C2_2
C2_3_AUTHORIZED               = true
E7_AUTHORIZED                 = false

NEXT = ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02 (C2.3)

RESUME_PHASE = C2.3 STATEFUL W01-W16
```

The unified observation coordinator is the single seam. Every state-
mutating ingress funnels through it. Canonical runtime events own
runtime truth; host-only events own host-only semantics; reconstructed
events serve as diagnostics/fallbacks but never share authority.

This matches Cline's documented layered event architecture: low-level
`AgentRuntimeEvent` comes directly from the Agent runtime, while core /
session events are a distinct host-facing surface. The unified observer
is the boundary that respects this layering end-to-end.
