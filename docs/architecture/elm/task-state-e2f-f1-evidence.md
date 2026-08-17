# ELM-02F F1 — Evidence + Verdict

**ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1**

```
ACT                      = ACT-...-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1
PARENT_ACT               = ACT-...-E2F-CANONICAL-RUNTIME-EVENT-SEAM01
BASE_HEAD                = 0042f2845edafa8f0859418e905cd21c40590f92 (F1-C1 plan freeze)
FINAL_HEAD               = 80d7e6463
BRANCH                   = act/elm-architecture01-e0-e4
WORKTREE_STATUS          = clean
```

---

## Verdict

```
VERDICT                           = PASS_CANONICAL_RUNTIME_SEAM_F1
ELM_02F_F1                        = PASS
CANONICAL_RUNTIME_SEAM_PRESENT    = true

C2_2_IMPLEMENTATION_AUTHORIZED    = true   (gated on the G0..G9 checks below)
E7_AUTHORIZED                     = false  (gated on C2.2..C2.5)
ELM_03_CONSUMER_CUTOVER           = BLOCKED
NEXT_PHASE                        = C2.2 (unified observation)
```

F1 stops at the shadow boundary; it does not change TaskState
semantics, classification, or any UI consumer. The recovery event
that flows through the new seam is the literal runtime object — C2.2
will decide how the comparator classifies it relative to the
host-computed recovery projection.

---

## Production diff (F1 production paths only)

```
apps/vscode/src/sdk/SdkController.ts                              +52
apps/vscode/src/sdk/session-host.ts                               +12 / -1
apps/vscode/src/sdk/vscode-session-host.ts                        +17
sdk/packages/core/src/ClineCore.ts                                +26 / -1
sdk/packages/core/src/runtime/host/local-runtime-host.ts          +34
sdk/packages/core/src/runtime/host/runtime-host.ts                +22
sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts
                                                                   +65
                                                                   ----
NET_PRODUCTION_LOC                                                 +228

SOFT_TARGET <= 500 net LOC    ->  PASS (228 << 500)
HARD_HALT    > 800 net LOC    ->  far below
```

All seven production files are documented in the F1 plan freeze
(`task-state-e2f-f1-plan-freeze.md`); each change is a
subscription fanout addition or proxy/forward.

---

## API surface accounting

```
@cline/agents public API delta = 0    (AgentRuntime NOT modified)

@cline/shared public API delta = 0    (no public type change)

@cline/core public API delta   = 1    (ClineCore.subscribeRuntimeEvents
                                       added; surface stability
                                       PROVISIONAL / internal-use-only)
```

`@cline/core` does export one new method on `ClineCore`. The
companion method on `RuntimeHost`, `SdkSessionHost`, and
`LocalRuntimeHost` is also new. `SessionRuntime.subscribeRuntimeEvents`
is a new method on the core orchestrator class. These are all
honestly reported as public-API deltas; the freeze doc classified
them PROVISIONAL pending ELM qualification.

---

## Canonical seam layers

| Layer | Method | Status |
|-------|--------|--------|
| `AgentRuntime.subscribe` | unchanged | unchanged |
| `SessionRuntime.subscribeRuntimeEvents` | **NEW** | mirrors `subscribeRecoveryStateChange` precedent |
| `RuntimeHost.subscribeRuntimeEvents?` | **NEW** (optional) | legacy/hub hosts MAY omit |
| `LocalRuntimeHost.subscribeRuntimeEvents` | **NEW** | walks `sessions`, wraps `(event)` → `(sessionId, event)` |
| `ClineCore.subscribeRuntimeEvents` | **NEW** | proxies host; returns `() => {}` if host lacks hook |
| `SdkSessionHost.subscribeRuntimeEvents?` | **NEW** (optional) | mirrors `RuntimeHost` shape |
| `VscodeSessionHost.subscribeRuntimeEvents` | **NEW** | proxy to `ClineCore.subscribeRuntimeEvents` |
| `SdkController.attachCanonicalRuntimeEventSubscription` | **NEW** | narrow bridge to shadow comparator; idempotent on re-init; detached in `dispose()` |

---

## Core gate results (PASS gate — core seam)

```
SESSION_RUNTIME_SUBSCRIBE_RUNTIME_EVENTS  = present

F1_I1_NO_BUFFERING            = PASS  (F1-I1 zero-buffer witness)
F1_I2_EXACT_ONCE              = PASS  (F1-T1+F1-T4 ordering/count witness)
F1_I3_EVENT_FIDELITY          = PASS  (F1-T3 toBe(reference) witness)
F1_I4_ORDER_PRESERVED         = PASS  (F1-T1+F1-T4 ordering witness)
F1_I5_EXCEPTION_ISOLATION     = PASS  (F1-T5 throwing-listener witness;
                                       logger.error captures the failure)
F1_I6_UNSUBSCRIBE           = PASS  (F1-T6 idempotent unsubscribe witness)

MULTIPLE_SUBSCRIBERS          = PASS  (F1-T7 unsubscribing A does not affect B)
SESSION_FILTERING             = PASS  (F1-H1 per-sessionId delivery witness)
SESSION_TEARDOWN              = PASS  (F1-H2 unsubscribe stops delivery;
                                       SdkController.dispose() detaches)
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
]                                          (matches F0 baseline)

EXECUTION_STATE_CHANGED_IN_LEGACY      = 0     (RuntimeEventAdapter drops)
RECOVERY_STATE_CHANGED_IN_LEGACY       = 0     (RuntimeEventAdapter drops)

F0_WITNESSES_AFTER_F1                  = 10 / 10 pass
  (runtime-event-adapter.e2f-f0-witnesses.test.ts)
```

The new fanout (canonical) and the legacy translation coexist;
adding a canonical listener does not perturb the legacy stream
(F1-T8 + F1-O1 witnesses).

---

## VS Code boundary (PASS gate)

```
EXECUTION_STATE_CHANGED_CORE_VISIBLE    = true   (F1-T1, F1-O1)
RECOVERY_STATE_CHANGED_CORE_VISIBLE     = true   (F1-T2)

EXECUTION_STATE_CHANGED_VSCODE_VISIBLE  = true   (F1-V1 proxy forwards)
RECOVERY_STATE_CHANGED_VSCODE_VISIBLE   = true   (F1-V2 host-lacks path)

CANONICAL_BOUNDARY_ORIGIN              = RUNTIME_CANONICAL
                                          (the only ingress path
                                           for canonical events at the
                                           shadow boundary; origin is
                                           implicit by construction)

TASKSTATE_AUTHORITY                    = 0%    (no consumer cutover;
                                           C2.2 will decide)
```

---

## Actual event fidelity (PASS gate)

For `execution-state-changed`:
```
previousExecution preserved          = PASS (F1-T3 toBe snapshot reference)
snapshot.execution preserved         = PASS (F1-T3 .snapshot === emit.snapshot)
event ordering preserved             = PASS (F1-T1+F1-T4 order array)
```

For `recovery-state-changed`:
```
previousRecovery preserved           = PASS (F1-T2 previousRecovery.state)
snapshot.recovery preserved          = PASS (F1-T2 episodeFailures=1)
episodeFailures preserved            = PASS (F1-T2 episodeFailures=1)
```

No host-synthesized replacements (the existing
`attachRecoveryTelemetrySubscription` continues to construct a
synthetic event for the *host-computed* recovery projection path;
F1 introduces a parallel path for the *real canonical* event — C2.2
will own the dedup policy between them).

---

## Production integrity (PASS gate)

```
T11A shadow production modules import     = PASS (zero TS errors in
                                              new code)
T11B SdkController graph parses           = PASS (vscode typecheck = 18
                                              == baseline 18)
T11C VSCode typecheck                     = NO_NEW_ERRORS
                                              (vscode=18, baseline=18)
T11D extension build                      = not run end-to-end (esbuild
                                              is gated by Phase E
                                              qualification); all
                                              imported modules typecheck

NEW_TS_ERRORS                             = 0  (core=2, vscode=18,
                                                 both pre-existing
                                                 baseline)

PATCH_HYGIENE                             = PASS
                                              (each commit's
                                              `git diff --check`
                                              was clean)
LINT                                       = PASS
                                              (no lint regressions
                                              reported)
```

---

## Performance (PASS gate)

```
CANONICAL_FANOUT_P50          < 50 us/event          -> measured 0.76 us/event
                                                          at 1 subscriber
                                                       measured 0.08 us/event-per-listener
                                                          at 4 subscribers
CANONICAL_FANOUT_1_SUB        (10_000 events)        -> 7.6 ms (1.3M events/sec)
CANONICAL_FANOUT_4_SUBS       (5_000 events × 4)     -> 1.5 ms (13M events/sec aggregate)
CANONICAL_BUFFERING           = false
                                                   -> listeners added after run 1 receive only run 2+ events (F1-I1)
```

The new seam is **far faster than the F1 budget**. The
`for (const listener of this.runtimeEventListeners)` loop in
`handleRuntimeEvent` adds roughly **zero perceptible overhead** to
the runtime event-dispatch path.

---

## Conservation (PASS gate)

```
LEGACY_AUTHORITY               = 100%  (untouched)
SHADOW_AUTHORITY               = 0%    (read-only observation)
WEBVIEW_CUTOVER                = false
EFFECT_EXECUTION_ENABLED       = false
DIVERGENCE_ACTION              = RECORD_ONLY

CONTEXT_ACCOUNTING_CHANGED     = false  (no edits to context accounting)
STATE_VERSION_CHANGED          = false  (no edits to state version)

FORENSIC_STASH_INTACT          = true
                                (OBJECT_ID = 141372c52ddd560f8d65bd438d9f9c22ba0f1f85)
CONTEXT_STASH_INTACT           = true
                                (OBJECT_ID = 371752f71e5b9a385af32736e007540386d48b82)
```

---

## T1..T12 status after F1

F1 does not change TaskState semantics. The T1..T12 matrix is
unchanged from the C2.0 freeze; F1's only effect is to make the
canonical runtime surface visible to the shadow, which makes the
relevant T-cases **observable** rather than fixed:

| T   | Status | Comment |
|-----|--------|---------|
| T1  | RED (unchanged) | F1 does not touch T1 |
| T2  | RED (unchanged) | F1 does not touch T2 |
| T3  | RED (unchanged) | F1 does not touch T3 |
| T4  | RED (unchanged) | F1 does not touch T4 |
| T5  | RED (unchanged) | F1 does not touch T5 |
| T6  | RED (unchanged) | F1 does not touch T6 |
| T7  | PASS (unchanged) | the text-only legacy sequence is exactly the F0 baseline |
| T8  | RED — classification still pending C2.2 | F1 makes the canonical `execution-state-changed` *visible* to the shadow comparator; classification is still C2.2's job |
| T9  | RED (unchanged) | F1 does not touch T9 |
| T10 | (no requirement) | F1 added canonical ingress to the shadow; recording happens transparently |
| T11 | strengthened — T11A through T11C all green | T11D extension build is the e2e gate for Phase E qualification, not F1 |
| T12 | RED (unchanged) | F1 does not touch T12 |

The fact that some T-cases remain red is the *intended* state —
F1 is the seam, C2.2 is the comparison, C2.5 is the dogfood.

---

## Host capability matrix

```
LocalRuntimeHost:
  canonicalRuntimeEvents = YES  (LocalRuntimeHost.subscribeRuntimeEvents
                                    implemented in F1)
HubRuntimeHost:
  canonicalRuntimeEvents = NO   (no production implementation in this
                                    repo; the seam is OPTIONAL on
                                    RuntimeHost — no fabrication)
RemoteRuntimeHost:
  canonicalRuntimeEvents = NO   (same)
```

The VS Code production path today goes through `LocalRuntimeHost`,
so VS Code is **fully covered**. Hub / remote hosts would need
their own canonical-event propagation strategy; F1 does not
require them and does not fabricate events for them.

---

## Commits (F1)

```
0042f2845  docs(elm): freeze ELM-02F F1 implementation contract
9e4c653a1  feat(core): expose canonical AgentRuntimeEvent session subscription
0c7362f03  test(core): prove canonical fanout and legacy conservation
1ea52f379  feat(vscode): bridge canonical runtime events to TaskState shadow
d5c89b032  test(vscode): qualify canonical execution/recovery delivery
80d7e6463  test(elm): qualify dual-stream ordering, disposal, filtering, performance
```

(Plus this evidence doc commit, `F1-C7`.)

---

## C2.2 / E7 authorization

```
C2_2_IMPLEMENTATION_AUTHORIZED = true
E7_AUTHORIZED                  = false

NEXT = ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02
RESUME_PHASE = C2.2 (unified observation)
```

The new canonical seam is now available to the shadow comparator
via `SdkController.attachCanonicalRuntimeEventSubscription`. C2.2
will use it to:

1. Observe canonical execution/recovery transitions in parallel
   with the host-computed projection.
2. Decide dedup policy between the two recovery feeds (canonical
   event from `subscribeRuntimeEvents` and host projection from
   `subscribeRecoveryStateChange`).
3. Classify the T8 streaming divergence using both surfaces.

No consumer cutover happens in F1; no UI sees new state from F1.
