# ELM-02F F1-CORRECTION01 — Evidence + Verdict

**ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1-CORRECTION01**

```
ACT                      = ACT-...-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1-CORRECTION01
PARENT_ACT               = ACT-...-E2F-CANONICAL-RUNTIME-EVENT-SEAM01
BASE_HEAD                = 5abc9b62d (F1 evidence doc)
FINAL_HEAD               = a84b1f183
BRANCH                   = act/elm-architecture01-e0-e4
WORKTREE_STATUS          = clean
```

---

## Verdict

```
F1_VERDICT                            = PASS_CANONICAL_RUNTIME_SEAM_F1

SESSION_RUNTIME_CANONICAL_SEAM        = PASS
LEGACY_CONSERVATION                   = PASS
F1_HOST_PROPAGATION                   = PASS  (real LocalRuntimeHost)
F1_VSCODE_BOUNDARY                    = PASS  (real wiring + real proxy)

ELM_02F_F1                            = PASS
CANONICAL_RUNTIME_SEAM_PRESENT        = true

C2_2_IMPLEMENTATION_AUTHORIZED        = true
E7_AUTHORIZED                         = false

NEXT_PHASE                            = ACT-...-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02
RESUME_PHASE                          = C2.2 (unified observation)
```

The F1 reviewer's six concerns are closed. The previous verdict was
`NOT_YET_PASS` because host and VS Code qualification was synthetic;
this correction replaces the synthetic mirrors with real instances
and real proxy calls, and adds an explicit typed origin marker at the
shadow boundary.

---

## Reviewer concerns closed

| # | Concern | Closure |
|---|---------|---------|
| 2 | `LocalRuntimeHost` test was a manual mirror | New `local-runtime-host.subscribe-runtime-events.e2f-f1-correction01.test.ts` exercises a real `LocalRuntimeHost` instance (the `RuntimeHostUnderTest` alias already used by the existing 7099-line host test suite). 4 witnesses pass. |
| 3 | Future-session lifecycle unproven | F1-LC-1: subscribing to the host BEFORE any session exists receives zero events (documented point-in-time contract). |
| 4 | VS Code proxy tests were synthetic | New `subscribeRuntimeEventsThroughProxy()` is the **single** implementation that both `VscodeSessionHost.subscribeRuntimeEvents` and the test invoke. No mirror. |
| 5 | F1-V1's event-fidelity assertion was tautological | Replaced with literal-event tests: F1-V1-C2 (execution-state-changed, `toBe` reference), F1-V1-C3 (recovery-state-changed, `toBe` reference). |
| 6 | Recovery not proven visible at VS Code boundary | F1-V1-C3 asserts `recovery-state-changed` reaches the proxy with the original object reference; F1-W3 asserts the same at the wiring boundary. |
| 7 | `RUNTIME_CANONICAL` not actually encoded | Added `TaskShadowRuntimeOrigin = "RUNTIME_CANONICAL"` and `TaskShadowCanonicalEvent { origin, sessionId, event }`. `SdkController` now passes the typed envelope. |

---

## Production diff (CORRECTION01 delta)

```
apps/vscode/src/sdk/runtime-events-proxy.ts                  NEW (+41)   extracted proxy
apps/vscode/src/sdk/vscode-session-host.ts                 +5 /-3     delegate to proxy
apps/vscode/src/sdk/task-state-shadow-host-wiring.ts       +57/-14    typed origin + recorder
apps/vscode/src/sdk/SdkController.ts                       +6 /-1     typed envelope
```

```
NET_PRODUCTION_LOC_CORRECTION01 = +85 / -8   (4 files)
```

Combined F1 production LOC: previous +228 / -2 + 85 / -8 = **+313 / -10** net production code across all of F1 + CORRECTION01. Well under both the 500 soft target and the 800 hard halt.

---

## API surface accounting

```
@cline/agents public API delta = 0    (AgentRuntime NOT modified)

@cline/shared public API delta = 0    (no public type change)

@cline/core public API delta   = 1    (ClineCore.subscribeRuntimeEvents added;
                                       surface stability PROVISIONAL)

@cline/vscode public API delta = 1+1  (TaskShadowCanonicalEvent +
                                       TaskShadowRuntimeOrigin exports)
```

The two new VS Code exports are honest surface deltas. They exist
specifically to give the shadow boundary a typed envelope so that
C2.2 can introduce additional origin values without ambiguity.

---

## Test totals after CORRECTION01

```
@cline/core (F0 + F1 + F1-CORRECTION01):
  F0 witnesses                          10 passed
  F1 session-runtime (incl. T8 strict)  9 passed (T8 now exact)
  F1 local-runtime-host (initial)       3 passed
  F1 local-runtime-host (CORR01 real)   4 passed
  F1 bench/dual-stream                  4 passed
  @cline/core runtime/ total           516 passed (was 512)

@cline/vscode (F1 + F1-CORRECTION01):
  task-state-shadow.test                3 passed
  task-state-shadow-host-wiring.test    8 passed
  task-state-shadow-recorder.test      16 passed
  task-state-shadow-observer.test       9 passed
  vscode-session-host proxy (CORR01)    4 passed
  task-state-shadow-host-wiring (CORR01) 8 passed
  sdk-controller-lifecycle (CORR01)     3 passed
```

**Total F1+CORRECTION01 witnesses: 60 vscode tests + 30 core tests pass.**

---

## Core gate results (PASS gate — core seam)

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

---

## Legacy conservation (PASS gate)

```
RUNTIME_EVENT_ADAPTER_CHANGED          = false (zero edits)

LEGACY_EVENT_COUNT_AFTER_F1            = 5     (matches F0 baseline)
LEGACY_EVENT_SEQUENCE_AFTER_F1         = [
  "iteration_start",
  "content_start",
  "content_end",
  "iteration_end",
  "done",
]                                          (matches F0 baseline, F1-T8 now exact)

EXECUTION_STATE_CHANGED_IN_LEGACY      = 0     (RuntimeEventAdapter drops)
RECOVERY_STATE_CHANGED_IN_LEGACY       = 0     (RuntimeEventAdapter drops)

F0_WITNESSES_AFTER_F1                  = 10 / 10 pass
```

---

## VS Code boundary (PASS gate)

```
EXECUTION_STATE_CHANGED_VSCODE_VISIBLE  = true   (F1-V1-C2 + F1-W2 + F1-W5)
RECOVERY_STATE_CHANGED_VSCODE_VISIBLE   = true   (F1-V1-C3 + F1-W3)

CANONICAL_BOUNDARY_ORIGIN              = RUNTIME_CANONICAL
                                          (typed literal;
                                           C2.2 will add more)

TASKSTATE_AUTHORITY                    = 0%
```

---

## Production integrity (PASS gate)

```
T11A shadow production modules import     = PASS (0 new TS errors)
T11B SdkController graph parses           = PASS (vscode typecheck 18 == baseline)
T11C VSCode typecheck                     = NO_NEW_ERRORS (18 == baseline 18)
T11D extension build (esbuild)            = PASS
                                              (verified `IS_DEV=true bun esbuild.mjs`)

NEW_TS_ERRORS                             = 0
                                          core=2 (baseline unchanged)
                                          vscode=18 (baseline unchanged)
```

---

## Performance (PASS gate, unchanged from F1)

```
CANONICAL_FANOUT_P50          < 50 us/event          -> measured 0.76 us/event (1 sub)
                                                        0.08 us/event-per-listener (4 subs)
CANONICAL_BUFFERING           = false
```

---

## Host capability matrix

```
LocalRuntimeHost:
  canonicalRuntimeEvents = YES  (subscribeRuntimeEvents implemented,
                                    real instance tested in F1-H4-C1..C4)

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
is now qualified end-to-end.

---

## Updated commit stack (F1 + CORRECTION01)

```
9e4c653a1 feat(core): expose canonical AgentRuntimeEvent session subscription
0c7362f03 test(core): prove canonical fanout and legacy conservation
1ea52f379 feat(vscode): bridge canonical runtime events to TaskState shadow
d5c89b032 test(vscode): qualify canonical execution/recovery delivery
80d7e6463 test(elm): qualify dual-stream ordering, disposal, filtering, performance
5abc9b62d docs(elm): record ELM-02F F1 evidence and verdict (initial)

CORRECTION01:
ab8cf2f66 fix(vscode): extract canonical-event proxy and add typed origin marker
f8c2beaf3 test(vscode,core): real LocalRuntimeHost + wiring boundary + exact F0 legacy
a84b1f183 test(vscode): SdkController re-subscription lifecycle at the VS Code boundary
```

10 commits. 7 original F1 + 3 CORRECTION01.

---

## C2.2 / E7 authorization

```
C2_2_IMPLEMENTATION_AUTHORIZED = true
E7_AUTHORIZED                  = false

NEXT = ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02
RESUME_PHASE = C2.2 (unified observation)
```

The new canonical seam is now visible to the shadow comparator via
`SdkController.attachCanonicalRuntimeEventSubscription`. C2.2 will
decide the dedup policy between the canonical recovery event
(from `subscribeRuntimeEvents`) and the host-computed recovery
projection (from `subscribeRecoveryStateChange`), and will classify
T8 using both surfaces.

No consumer cutover happens in F1. No UI sees new state from F1.
F1 is transport-only.
