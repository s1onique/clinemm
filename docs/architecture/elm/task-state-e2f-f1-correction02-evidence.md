# ELM-02F F1-CORRECTION02 — Evidence + Verdict

**ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1-CORRECTION02**

```
ACT                      = ACT-...-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1-CORRECTION02
PARENT_ACT               = ACT-...-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1-CORRECTION01
BASE_HEAD                = f3fc47e08 (F1-CORRECTION01 evidence doc)
FINAL_HEAD               = TBD (this correction)
BRANCH                   = act/elm-architecture01-e0-e4
WORKTREE_STATUS          = clean
```

---

## Verdict

```
F1_VERDICT                            = PASS_CANONICAL_RUNTIME_SEAM_F1

SESSION_RUNTIME_CANONICAL_SEAM        = PASS
LOCAL_RUNTIME_HOST_SEAM               = PASS
VSCODE_PROXY                          = PASS
TYPED_CANONICAL_ORIGIN                = PASS
F1_PRODUCTION_LIFECYCLE               = PASS

ELM_02F_F1                            = PASS

C2_2_IMPLEMENTATION_AUTHORIZED        = true
E7_AUTHORIZED                         = false

NEXT_PHASE                            = ACT-...-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02
RESUME_PHASE                          = C2.2 (unified observation)
```

The remaining lifecycle proof gap from CORRECTION01 is closed.
Production code and qualification tests now invoke the same
`subscribeCanonicalRuntimeEventsToShadow` helper — there is no
longer a local mirror in any test file.

---

## Reviewer concerns closed

| # | Concern | Closure |
|---|---------|---------|
| 1 | Lifecycle test mirrored `SdkController.attachCanonicalRuntimeEventSubscription` locally | Extracted the listener-filter logic (sessionId guard + typed envelope) into `apps/vscode/src/sdk/canonical-event-subscription.ts`. `SdkController.attachCanonicalRuntimeEventSubscription` now delegates to `subscribeCanonicalRuntimeEventsToShadow`; the qualification test calls the SAME function. |
| 2 | `POINT_IN_TIME` contract not frozen | Documented as a typed freeze in `canonical-event-subscription.ts` with the explicit `REQUIRED CALLER INVARIANT`. |
| 3 | F1-H4-C1 description claimed pre-session behavior the test does not exercise | Corrected: F1-H4-C1 = post-session point-in-time path; pre-session no-op → re-attach pattern lives in F1-LC-1. |

---

## Production diff (CORRECTION02 delta)

```
apps/vscode/src/sdk/canonical-event-subscription.ts   NEW (+80)   production helper
apps/vscode/src/sdk/SdkController.ts                 +5 /-13    delegate to helper
```

```
NET_PRODUCTION_LOC_CORRECTION02 = +85 / -13   (2 files)
```

Combined F1 + CORRECTION01 + CORRECTION02 production LOC: previous +346 /-3 + 85/-13 = **+431 /-16** net production code across all of F1 + both corrections. Still under the 500 soft target.

---

## API surface accounting

```
@cline/agents public API delta = 0    (AgentRuntime NOT modified)

@cline/shared public API delta = 0    (no public type change)

@cline/core public API delta   = 1    (ClineCore.subscribeRuntimeEvents added;
                                       surface stability PROVISIONAL)

@cline/vscode public API delta = 1+1+1 (TaskShadowCanonicalEvent +
                                        TaskShadowRuntimeOrigin +
                                        subscribeCanonicalRuntimeEventsToShadow
                                        + Unsubscribe type)
```

The new export `subscribeCanonicalRuntimeEventsToShadow` is the
canonical seam's only production helper. The controller uses it;
the test uses it; there is no other implementation.

---

## Test totals after CORRECTION02

```
@cline/core (F0 + F1 + F1-CORRECTION01):
  F0 witnesses                          10 passed
  F1 session-runtime (incl. T8 strict)  9 passed
  F1 local-runtime-host (initial)       3 passed
  F1 local-runtime-host (CORR01)        4 passed
  F1 bench/dual-stream                  4 passed
  @cline/core runtime/ total           516 passed

@cline/vscode (F1 + CORRECTION01 + CORRECTION02):
  task-state-shadow.test                3 passed
  task-state-shadow-host-wiring.test    8 passed
  task-state-shadow-recorder.test      16 passed
  task-state-shadow-observer.test       9 passed
  vscode-session-host proxy (CORR01)    4 passed
  task-state-shadow-host-wiring (CORR01) 8 passed
  sdk-controller-production-lifecycle (CORR02)  6 passed
```

**Total F1+CORRECTION01+CORRECTION02 witnesses: 54 vscode + 30 core tests pass.**

The 3-test mirror from CORRECTION01 was retired; the 6-test
production-path test supersedes it.

---

## Gate results

### Core seam gates

```
SESSION_RUNTIME_SUBSCRIBE_RUNTIME_EVENTS  = present

F1_I1_NO_BUFFERING            = PASS  (F1-I1 zero-buffer witness)
F1_I2_EXACT_ONCE              = PASS  (F1-T1+F1-T4 ordering/count witness)
F1_I3_EVENT_FIDELITY          = PASS  (F1-T3 toBe(reference) witness)
F1_I4_ORDER_PRESERVED         = PASS  (F1-T1+F1-T4 ordering witness)
F1_I5_EXCEPTION_ISOLATION     = PASS  (F1-T5 throwing-listener witness)
F1_I6_UNSUBSCRIBE             = PASS  (F1-T6 idempotent unsubscribe witness)

MULTIPLE_SUBSCRIBERS          = PASS  (F1-T7)
SESSION_FILTERING             = PASS  (F1-H4-C1, F1-H4-C3)
SESSION_TEARDOWN              = PASS  (F1-H4-C2, F1-H4-C4, F1-LC-3)
```

### Host lifecycle gates

```
F1_H4_C1   POST-SESSION POINT_IN_TIME = PASS  (real LocalRuntimeHost)
F1_H4_C2   UNSUBSCRIBE_STOPS_DELIVERY = PASS  (real LocalRuntimeHost)
F1_H4_C3   MULTIPLE_SUBSCRIBERS       = PASS  (real LocalRuntimeHost)
F1_H4_C4   EVENT_REFERENCE_PRESERVED  = PASS  (real LocalRuntimeHost)
```

### VS Code boundary gates

```
F1_V1_C1   INNER_HAS_HOOK_FORWARDS    = PASS  (production proxy)
F1_V1_C2   EXEC_REFERENCE_PRESERVED   = PASS  (toBe)
F1_V1_C3   RECOVERY_REFERENCE_PRESERVED = PASS  (toBe)
F1_V2_C1   INNER_LACKS_HOOK_NOOP      = PASS  (idempotent)
F1_V2_C2   NOOP_UNSUBSCRIBE_IDEMPOTENT = PASS
F1_W1      WIRING_EXPOSES_OBSERVER    = PASS
F1_W2      EXEC_RECORDS_RECEIVED      = PASS
F1_W3      RECOVERY_RECORDS_RECEIVED  = PASS
F1_W4      TYPED_ORIGIN_LITERAL       = PASS  (compile-time)
F1_W5      EXEC_FLIPS_SHADOW_PHASE    = PASS  (streaming vs idle)
F1_W6      ACCEPT_TYPED_ENVELOPE      = PASS
F1_W7      NOOP_WIRING_IMPLEMENTS     = PASS
F1_W8      CANONICAL_SEAM_INDEPENDENT = PASS  (not via wrapped onSessionEvent)
```

### Production-path lifecycle gates (F1-CORRECTION02)

```
F1_LC_1   PRE_SESSION_NOOP            = PASS  (production helper invoked)
F1_LC_2   POST_SESSION_DELIVERS       = PASS  (production helper invoked)
F1_LC_3   PRIOR_SUBSCRIPTION_DISPOSED = PASS  (production helper invoked)
F1_LC_4   REINIT_FILTERS_BY_SESSIONID = PASS  (production helper invoked)
F1_LC_5   STALE_SESSION_FILTERED      = PASS  (production helper invoked)
F1_LC_6   EXACTLY_ONE_PER_EVENT       = PASS  (production helper invoked)
```

### Legacy conservation

```
LEGACY_F0_SEQUENCE = exact PASS  (F1-T8 now uses toEqual)
LEGACY_EVENT_COUNT = 5           (matches F0 baseline)
RUNTIME_EVENT_ADAPTER_CHANGED    = false
```

### Performance

```
F1_P1   10_000 events × 1 subscriber  = 7.6ms   (0.76 us/event)
F1_P2    5_000 events × 4 subscribers = 1.5ms   (0.08 us/event-per-listener)
CANONICAL_BUFFERING = false
```

### Production integrity

```
NEW_TS_ERRORS                        = 0
                                          core=2 (baseline unchanged)
                                          vscode=18 (baseline unchanged)
BUNDLE_BUILD                         = PASS  (verified `IS_DEV=true bun esbuild.mjs`)
ESBUILD                              = PASS
```

### Conservation

```
LEGACY_AUTHORITY              = 100%
SHADOW_AUTHORITY              = 0%
WEBVIEW_CUTOVER               = false
EFFECT_EXECUTION_ENABLED      = false
DIVERGENCE_ACTION             = RECORD_ONLY
CONTEXT_ACCOUNTING_CHANGED    = false
STATE_VERSION_CHANGED         = false
FORENSIC_STASH_INTACT          = true
CONTEXT_STASH_INTACT           = true
```

---

## Host capability matrix

```
LocalRuntimeHost:
  canonicalRuntimeEvents = YES  (subscribeRuntimeEvents implemented,
                                    real instance tested in F1-H4-C1..C4,
                                    production helper integrated with
                                    SdkController in F1-LC-1..6)

HubRuntimeHost:
  canonicalRuntimeEvents = NO   (no production implementation in this
                                    repo; the seam is OPTIONAL on
                                    RuntimeHost — no fabrication)

RemoteRuntimeHost:
  canonicalRuntimeEvents = NO   (same; if VS Code production ever uses
                                    these hosts, halt and report
                                    capability gap)
```

The VS Code production path goes through `LocalRuntimeHost`, which
is now qualified end-to-end (real instance + production helper).

---

## Caller invariant (the F1-CORRECTION02 freeze)

```ts
// apps/vscode/src/sdk/canonical-event-subscription.ts

export function subscribeCanonicalRuntimeEventsToShadow(
    inner: {
        subscribeRuntimeEvents?: (
            listener: (
                sessionId: string,
                event: AgentRuntimeEvent,
            ) => void,
        ) => () => void
    },
    wiring: TaskShadowHostWiring,
    sessionId: string,
): Unsubscribe {
    return subscribeRuntimeEventsThroughProxy(inner, (evtSessionId, event) => {
        if (evtSessionId && evtSessionId !== sessionId) {
            // Stale session — ignore.
            return
        }
        wiring.observeCanonicalRuntimeEvent({
            origin: "RUNTIME_CANONICAL",
            sessionId,
            event,
        })
    })
}
```

```
LOCAL_RUNTIME_SUBSCRIPTION_MODEL = POINT_IN_TIME

REQUIRED CALLER INVARIANT:
after every startSession / reinit / setActiveSession,
the caller MUST refresh the canonical subscription via
subscribeCanonicalRuntimeEventsToShadow(host, wiring, sessionId).
```

The SdkController enforces this invariant via
`attachCanonicalRuntimeEventSubscription`, which is called from:
- `initTask` (new task)
- `reinitExistingTaskFromId` (resume existing task)
- The `startNewSession` resolution callback (post-session attach)

See `apps/vscode/src/sdk/SdkController.ts:1661`.

---

## Updated commit stack (F1 + CORRECTION01 + CORRECTION02)

```
F1_PLAN_FREEZE          (1):
0042f2845  docs(elm): freeze ELM-02F F1 implementation contract

F1_AFTER_FREEZE         (6):
9e4c653a1  feat(core): expose canonical AgentRuntimeEvent session subscription
0c7362f03  test(core): prove canonical fanout and legacy conservation
1ea52f379  feat(vscode): bridge canonical runtime events to TaskState shadow
d5c89b032  test(vscode): qualify canonical execution/recovery delivery
80d7e6463  test(elm): qualify dual-stream ordering, disposal, filtering, performance
5abc9b62d  docs(elm): record ELM-02F F1 evidence and verdict (initial)

F1_CORRECTION01         (4):
ab8cf2f66  fix(vscode): extract canonical-event proxy and add typed origin marker
f8c2beaf3  test(vscode,core): real LocalRuntimeHost + wiring boundary + exact F0 legacy
a84b1f183  test(vscode): SdkController re-subscription lifecycle at the VS Code boundary
f3fc47e08  docs(elm): record ELM-02F F1-CORRECTION01 evidence and verdict

F1_CORRECTION02         (3):
eeeb34ea5  refactor(vscode): extract production canonical-event subscription helper
b5fb5e41c  test(vscode): production-path lifecycle test + F1-H4-C1 description fix
9fba7678b  docs(elm): record ELM-02F F1-CORRECTION02 evidence and verdict

F1_CORRECTION03         (3):
f2f2270ec  refactor(vscode): extract CanonicalRuntimeShadowSubscription owner
              test(vscode): production-path owner lifecycle test (8 witnesses)
              docs(elm): record ELM-02F F1-CORRECTION03 evidence
```

Total = 17 commits.

---

## C2.2 / E7 authorization

```
C2_2_IMPLEMENTATION_AUTHORIZED = true
E7_AUTHORIZED                  = false

NEXT = ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02
RESUME_PHASE = C2.2 (unified observation)
```

The new canonical seam is now visible to the shadow comparator via
`SdkController.attachCanonicalRuntimeEventSubscription`, which
delegates to `subscribeCanonicalRuntimeEventsToShadow` — the same
production helper the qualification test exercises. C2.2 will
decide the dedup policy between the canonical recovery event
(from `subscribeRuntimeEvents`) and the host-computed recovery
projection (from `subscribeRecoveryStateChange`), and will classify
T8 using both surfaces.

No consumer cutover happens in F1. No UI sees new state from F1.
F1 is transport-only.
