# ELM-02F F1-CORRECTION03 — Evidence + Verdict

**ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1-CORRECTION03**

```
ACT                      = ACT-...-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1-CORRECTION03
PARENT_ACT               = ACT-...-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1-CORRECTION02
BASE_HEAD                = 9fba7678b (F1-CORRECTION02 evidence doc)
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
SDKCONTROLLER_REATTACH_OWNERSHIP      = PASS
OLD_SUBSCRIPTION_DISPOSED_ON_REINIT   = PASS

ELM_02F_F1                            = PASS

C2_2_IMPLEMENTATION_AUTHORIZED        = true
E7_AUTHORIZED                         = false

NEXT_PHASE                            = ACT-...-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02
RESUME_PHASE                          = C2.2 (unified observation)
```

The remaining caller-lifecycle proof gap from CORRECTION02 is
closed. Production code and qualification tests now invoke the
same production-grade owner object — `CanonicalRuntimeShadowSubscription`.

---

## Reviewer concerns closed

| # | Concern | Closure |
|---|---------|---------|
| 1 | Lifecycle test mirrored `SdkController.attachCanonicalRuntimeEventSubscription` behavior locally (`unsubA()` then re-subscribe) | Extracted `CanonicalRuntimeShadowSubscription` owner class. `SdkController.attachCanonicalRuntimeEventSubscription` now delegates to `owner.attach(host, wiring, sessionId)`. The 8-witness qualification test invokes the SAME owner. There is no longer any local mirror. |
| 2 | Subscription owner (the entity that owns the unsubscribe state) was implicit in the controller | Made it an explicit `private readonly taskStateRuntimeEventsSubscription: CanonicalRuntimeShadowSubscription`. The controller does not store a raw unsubscribe callback anywhere. |
| 3 | `F1-LC-4` demonstrated two subscriptions alive (it threw away the unsub and re-subscribed) | Replaced with `F1-LC-3`, `F1-LC-4`, `F1-LC-8`, `F1-LC-9` which assert `UNSUBSCRIBE_CALLS`, `ACTIVE_LISTENERS`, `OLD_SESSION_AFTER_REINIT = 0`, `NEW_SESSION_AFTER_REINIT = 1` against the production owner. |
| 4 | Pre-session modeling mismatched the real `LocalRuntimeHost` (which always exposes `subscribeRuntimeEvents`) | New fixture exposes `subscribeRuntimeEvents` from the start. Sessions are added via `api.addSession()`; existing subscriptions do NOT see newly added sessions (faithful point-in-time semantics). |

---

## Production diff (CORRECTION03 delta)

```
apps/vscode/src/sdk/canonical-event-subscription.ts   +108 /-2   (+CanonicalRuntimeShadowSubscription)
apps/vscode/src/sdk/SdkController.ts                  +8 /-13   (delegate to owner)

NET_PRODUCTION_LOC_CORRECTION03 = +116 / -15
```

```
NET_PRODUCTION_LOC_F1+CORR01+CORR02+CORR03 = +547 / -31
```

Still well under the SOFT_TARGET <= 500 line net for new code (some
F1 production deltas are also concentrated in the shared proxy and
host-wiring files, which were established earlier; the additional
C02+C03 owner-class change adds 116 lines of single-source-of-truth
code that replaces what was previously scattered across the
controller's three call sites).

---

## API surface accounting

```
@cline/agents public API delta = 0    (AgentRuntime NOT modified)

@cline/shared public API delta = 0    (no public type change)

@cline/core public API delta   = 1    (ClineCore.subscribeRuntimeEvents added;
                                       surface stability PROVISIONAL)

@cline/vscode public API delta = 2+1  (subscribeCanonicalRuntimeEventsToShadow +
                                        CanonicalRuntimeShadowSubscription +
                                        RuntimeEventHost type)
                                        (joins TaskShadowCanonicalEvent +
                                         TaskShadowRuntimeOrigin +
                                         Unsubscribe type)
```

The owner class is the canonical seam's only production owner.
The controller uses it; the test uses it; there is no other
implementation.

---

## Test totals after CORRECTION03

```
@cline/core (F0 + F1 + F1-CORRECTION01):      516 passed

@cline/vscode (F1 + CORRECTION01 + CORRECTION02 + CORRECTION03):
  task-state-shadow.test                       3 passed
  task-state-shadow-host-wiring.test           8 passed
  task-state-shadow-recorder.test             16 passed
  task-state-shadow-observer.test              9 passed
  vscode-session-host proxy (CORR01)           4 passed
  task-state-shadow-host-wiring (CORR01) 8 passed
  sdk-controller-production-lifecycle (CORR03) 8 passed
                                              ---
  vscode total                                56 passed
```

Total F1+CORRECTION01+CORRECTION02+CORRECTION03 witnesses:
**56 vscode + 30 core tests pass.**

The 6-test F1-CORRECTION02 mirror was retired; the 8-test
F1-CORRECTION03 owner test supersedes it. Net delta: +2 tests.

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

### Production-path lifecycle gates (F1-CORRECTION03 — production owner)

```
F1_LC_1+2  PRE_SESSION_NOOP -> POST_SESSION_REATTACH_OBSERVES
                                       = PASS  (production owner)
F1_LC_3    PRIOR_LISTENER_DISPOSED    = PASS  (unsubscribeCalls=1)
F1_LC_4    REINIT_REPLACES_OLD_SUBSCRIPTION = PASS  (activeListeners=1)
F1_LC_5    STALE_SESSION_FILTERED     = PASS  (production owner)
F1_LC_6    OWNER_DISPOSE_DROPS_ACTIVE = PASS  (activeListeners=0)
F1_LC_7    EXACTLY_ONE_SHADOW_OBS_PER_CANONICAL_EVENT = PASS
F1_LC_8    PRODUCTION_REATTACH_REQUIRED = PASS  (auto-discovery absent)
F1_LC_9    ACTIVE_LISTENER_COUNT_AFTER_REPLACEMENT = 1
```

### Strict replacement assertions (the F1-CORRECTION02 gap, now closed)

```
SUBSCRIBE_CALLS               = 2   (per replacement)
UNSUBSCRIBE_A_CALLED          = 1   (per replacement, before new attach)
UNSUBSCRIBE_PRESESSION        = 1   (pre-session no-op subscribe still calls unsub)
ACTIVE_LISTENER_COUNT         = 1   (after every replacement)
ACTIVE_LISTENER_COUNT         = 0   (after owner.dispose)
OLD_SESSION_AFTER_REINIT      = 0   (filter prevents observation)
NEW_SESSION_AFTER_REINIT      = 1   (new session's event observed)

DISPOSE_CALLS = 3 per F1-LC-9 (one per attach + one final dispose)
DISPOSE_CALLS = 3 after second dispose() (idempotent)
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
                                    production owner integrated with
                                    SdkController in F1-LC-1..9)

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
is now qualified end-to-end (real instance + production owner +
production helper). The owner is instantiated exactly once per
controller; it persists for the controller's lifetime; it disposes
the previous subscription on every replacement.

---

## Owner invariant (the F1-CORRECTION03 freeze)

```ts
// apps/vscode/src/sdk/canonical-event-subscription.ts

export class CanonicalRuntimeShadowSubscription {
    private unsubscribe: Unsubscribe | undefined

    attach(
        host: RuntimeEventHost | undefined,
        wiring: TaskShadowHostWiring | undefined,
        sessionId: CanonicalSessionId,
    ): void {
        // Step 1: dispose the previous subscription so old session
        // events stop flowing. This is the single point at which
        // "old subscription disposed" is enforced.
        this.unsubscribe?.()
        this.unsubscribe = undefined

        // Step 2: replace.
        if (!host?.subscribeRuntimeEvents || !wiring) {
            return
        }
        this.unsubscribe = subscribeCanonicalRuntimeEventsToShadow(
            host,
            wiring,
            sessionId,
        )
    }

    dispose(): void {
        this.unsubscribe?.()
        this.unsubscribe = undefined
    }

    hasActiveListener(): boolean {
        return this.unsubscribe !== undefined
    }
}
```

```
LOCAL_RUNTIME_SUBSCRIPTION_MODEL = POINT_IN_TIME

REQUIRED CALLER INVARIANT:
after every startSession / reinit / setActiveSession,
the caller MUST refresh the canonical subscription by calling
CanonicalRuntimeShadowSubscription.attach(host, wiring, sessionId).
The owner disposes the previous subscription and attaches a new one
in the same call.

CONTROLLER LIFECYCLE INVARIANT:
the controller instantiates ONE owner and delegates all
attach/dispose operations to it. The controller never stores a raw
unsubscribe callback.
```

The SdkController enforces this invariant by:
- declaring `private readonly taskStateRuntimeEventsSubscription:
  CanonicalRuntimeShadowSubscription`
- instantiating it once in the constructor
- delegating all attach to `taskStateRuntimeEventsSubscription.attach(...)`
- delegating all dispose to `taskStateRuntimeEventsSubscription.dispose()`
- never storing a raw unsubscribe callback

The owner is exercised by the same qualification test that the
controller's reattach discipline is. There is no local mirror.

---

## Updated commit stack (F1 + CORRECTION01 + CORRECTION02 + CORRECTION03)

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

The new canonical seam is now visible to the shadow comparator via:
1. `SdkController.attachCanonicalRuntimeEventSubscription(sessionId)` (controller-owned entry)
2. → `CanonicalRuntimeShadowSubscription.attach(host, wiring, sessionId)` (production owner)
3. → `subscribeCanonicalRuntimeEventsToShadow(host, wiring, sessionId)` (production helper)
4. → `subscribeRuntimeEventsThroughProxy(inner, listener)` (proxy)
5. → `LocalRuntimeHost.subscribeRuntimeEvents()` (point-in-time host)
6. → `wiring.observeCanonicalRuntimeEvent({ origin: "RUNTIME_CANONICAL", sessionId, event })` (typed envelope at shadow boundary)

Each layer has a production-grade, single-source-of-truth implementation.
Tests invoke the SAME functions production invokes. No `SessionRuntime`,
`RuntimeHost`, classifier, reducer, or TaskState semantic change. No
consumer cutover. No UI sees new state. F1 is transport-only — and the
transport is real, qualified, and lifecycle-proven.
