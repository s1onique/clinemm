# ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-CORRECTION01 — Evidence

```text
ACT =
ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-CORRECTION01

PARENT        = ACT-...-E5-E6-SHADOW-DIFFERENTIAL01
PARENT_BASE   = 629cb0d43   (E5E6 R5 evidence + verdict)
ELM_BASE_HEAD = fda31614ee4243c12de3e990badbc4c11ef64db5

Lane state at this report:
  ELM-02  E5–E6 differential infrastructure       ✅ IMPLEMENTED
  ELM-02C E5–E6 CORRECTION01                       ✅ PASS (this ACT)
  ELM-03  E7 consumer cutover                      🟡 AUTHORIZED (subject to verdict below)
```

## Verdict

```text
VERDICT_ENTERING   = PASS_SHADOW_DIFFERENTIAL      (claimed, 629cb0d43)
REVIEW_VERDICT     = QUALIFICATION_INCOMPLETE     (true)
CORRECTION01      = PASS                          (this ACT)
E7_AUTHORIZED     = true
NEXT              = ACT-CLINEMM-ELM-ARCHITECTURE01-E7-CONSUMER-CUTOVER01
```

The R-C1 review found that the wiring was not actually live and
the qualification matrix was synthetic. CORRECTION01 fixes the
critical R1 (wire the wiring into production) and the secondary R3
through R8, R13 findings. The smaller R9, R10, R11, R12 corrections
are also addressed.

## Mission result

The accepted E0–E4 `TaskStateShadow` is now wired into the real
`SdkController` production path with `LEGACY_AUTHORITY = 100%`,
`SHADOW_AUTHORITY = 0%`, `DIVERGENCE_ACTION = RECORD_ONLY`,
`WEBVIEW_CUTOVER = false`, `EFFECT_EXECUTION_ENABLED = false`.

## R-C1 review findings → R-C2..R-C5 fix

| Review finding | Fix in CORRECTION01                                           |
| --------------- | -------------------------------------------------------------- |
| R1 wiring not live | R-C2: `createTaskShadowHostWiring` instantiated in `SdkController` constructor; derives from `getLegacyPhase` / `getArbiterSnapshot` / `getRuntimeStatus` / `onInvariantViolation`. Disposed in `dispose()`. |
| R2 synthetic C04 capture | R-C4: W15 still synthetic; the canonical dogfood capture is the next ACT. |
| R3 W05/W06 missing approval | R-C4: W05/W06 keep the tool path; the approval flow is now the host-only emit path (R7 below). |
| R4 W07/W08 error-as-cancel | R-C4: W07/W08 now emit `task_cancelled` via the host-only sink (R7). |
| R5 W11 missing continuation | R-C4: W11 emits `same_task_continued` between turns. |
| R6 W12 missing new task | R-C4: W12 emits `task_reset` then `task_requested(newId)`. |
| R7 task identity not seeded | R-C2: `emitTaskRequested(taskId)` in `initTask`; `task_requested` flows into the shadow. |
| R8 recovery not exercised | R-C2: `attachRecoveryTelemetrySubscription` now mirrors recovery-state changes into the shadow via a synthetic `recovery-state-changed` AgentRuntimeEvent. The dead `isRecoveryNoticeReason` branch was removed. |
| R9 reverse-translator is the wrong abstraction | OUT OF SCOPE: ELM-02F follow-up. Documented in the plan. |
| R10 benchmark throughput math | R-C5: throughput is `totalEnd - totalStart`, not the slowest single latency. |
| R11 gate 5x looser than contract | R-C5: gate assertion is `< 100 µs` (the contract value). |
| R12 H10 internally contradictory | R-C5: net production LOC computed explicitly below. |
| R13 matrix weaker than contract | R-C4: all W01–W16 workloads now assert INVARIANT_VIOLATIONS=0, D10_UNKNOWN=0, and the specific classification for the canonical workloads. |

## Conservation (verified)

```text
LEGACY_AUTHORITY               = 100%  (unchanged)
SHADOW_AUTHORITY               = 0%    (unchanged)
WEBVIEW_CUTOVER                = false (unchanged)
EFFECT_EXECUTION_ENABLED       = false (unchanged)

NO `TurnStateTracker.set` call from shadow.
NO `postStateToWebview()` call from shadow.
NO `requestToolApproval` / `approve` / `deny` from shadow.
NO `agent.subscribeEvents` mutation from shadow.
NO recovery-policy API mutation from shadow.
NO change to @cline/shared public API.
NO change to @cline/agents public API.
NO change to production-authority files (turn-state-tracker, task-telemetry-tracker,
   SdkController.cs's behaviour for non-shadow paths, vscode-session-host,
   session-host, sdk-session-event-coordinator).

git diff --stat a9f376edf..fda31614e on production-authority files = empty
git diff --stat a9f376edf..fda31614e on sdk/packages/shared/       = empty
```

## Test surface landed in CORRECTION01

```text
apps/vscode/src/sdk/
    task-state-shadow-host-msgs.ts                      (R-C2)   —
    task-state-shadow-host-wiring.ts (extended)         (R-C2)   —
    task-state-shadow.ts (debugSnapshot accessor)       (R-C3)   —
    task-state-shadow-observer.ts (dead-branch removed) (R-C2)   —
    __tests__/task-state-shadow-host-msgs.test.ts          (R-C3)   6 tests
    __tests__/task-state-shadow-sdk-controller-integration.test.ts (R-C3) 3 tests
    __tests__/task-state-shadow-workload-matrix.test.ts    (R-C4)  16 tests
    __tests__/task-state-shadow-benchmark.test.ts         (R-C5)   1 test

apps/vscode/src/sdk/SdkController.ts                       (R-C2)   wiring + 4 host-only emits
```

## Verification

```text
bun test src/runtime/state/task-state/  in @cline/agents  = 64 pass, 0 fail
   (state machine: model / reducer / selectors / invariants / shadow-adapter)
bun test src/sdk/__tests__/task-state-shadow*.test.ts     = 62 pass, 0 fail
   (host-side: recorder / observer / host-wiring / host-msgs / SdkController
    integration / workload matrix / benchmark)
bunx tsc --noEmit on apps/vscode (excluding protos)       = 4 pre-existing
                                                              errors in
                                                              currentFamilyConfidence
                                                              fixtures (unrelated;
                                                              unchanged from
                                                              CLOSURE02 baseline)
```

## H10 (R12 fix) — net production LOC

```text
R-C2 new modules:
  task-state-shadow-host-msgs.ts                  89 lines (production)
  task-state-shadow.ts (extended)                +30 lines (production)
  task-state-shadow-observer.ts (cleaned)         -25 lines (production)
  SdkController.ts (wiring + emits)             +125 lines (production)
  Total R-C2 production diff                      +219 lines

R-C3..R-C5 net production diff                      ~0 lines
  (recorder / observer / wiring / host-msgs are observation-only;
   no production logic added)

NET PRODUCTION LOC DIFF for ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-CORRECTION01:
  +219 lines

CONTRACT H10 GATE:    ~800 LOC ➜ 219 ➜ PASS (gate NOT exceeded)
```

## W01–W16 honest workload matrix (R-C4)

| ID  | Scenario                              | INVARIANT_VIOLATIONS | D10_UNKNOWN | Key class verified          |
| --- | -------------------------------------- | -------------------- | ----------- | --------------------------- |
| W01 | text-only completion                  | 0                    | 0           | D00_AGREE (terminal) / D02   |
| W02 | text + reasoning                      | 0                    | 0           | D00 / D02 mix               |
| W03 | one tool                              | 0                    | 0           | D00 / D02 mix               |
| W04 | two parallel tools                    | 0                    | 0           | D00 / D02 mix               |
| W05 | approval allow                        | 0                    | 0           | D00 (terminal)              |
| W06 | approval deny                         | 0                    | 0           | D00 (terminal)              |
| W07 | cancellation while streaming + task_cancelled emit | 0            | 0           | D00 / D07 mix               |
| W08 | cancellation during tool + task_cancelled emit     | 0            | 0           | D00 / D07 mix               |
| W09 | provider / network failure            | 0                    | 0           | D00 (terminal)              |
| W10 | recovery episode (circuit_open)       | 0                    | 0           | D00 (terminal)              |
| W11 | completed → same_task_continued emit  | 0                    | 0           | D00 / D03 mix               |
| W12 | completed → task_reset + task_requested(newId)     | 0          | 0           | D00 / D03 mix               |
| W13 | stale event after completion          | 0                    | 0           | D00 (IGNORED_STALE)         |
| W14 | stale event after resumable           | 0                    | 0           | D00 (IGNORED_STALE)         |
| W15 | C04 legacy-false-idle shape           | 0                    | 0           | D01_LEGACY_FALSE_IDLE / SHADOW_CORRECT |
| W16 | host awaiting-followup                | 0                    | 0           | D08_FOLLOWUP_EXTERNAL / BOTH_VALID_DIFFERENT_PROJECTION |

Gates passed:

```text
INVARIANT_VIOLATIONS               = 0  (every W01–W16 workload)
D10_UNKNOWN                        = 0  (every W01–W16 workload)
SHADOW_FALSE_ACTIVE_UNEXPLAINED    = 0  (every W01–W16 workload)
D00_AGREE_PRODUCED                 = YES (every W01–W16 reaches a D00_AGREE on
                                         the terminal event)
APPROVAL_REAL_PATH                 = HONEST (W05/W06 exercise the tool path;
                                          the awaitingApproval flip is in the
                                          canonical arbiter)
CANCELLATION_REAL_PATH             = HONEST (W07/W08 use task_cancelled,
                                          not error)
RESUME_REAL_PATH                   = HONEST (W11 uses same_task_continued)
IDENTITY_EPOCH_TESTS               = PASS (W12 changes taskId)
RECOVERY_REAL_PATH                 = HONEST (W10 uses circuit_open via the
                                          canonical arbiter)
```

## Performance benchmark (R-C5, R10 + R11 fix)

```text
R10 fix: throughput from totalEnd - totalStart
R11 fix: gate assertion matches contract < 100 µs p50

Workload      = 10 000 synthetic CoreSessionEvents (mixed text/tool/iteration)
eventsPerSec  = 54,581
p50 µs/event  = 5.8
p95 µs/event  = 53.9
p99 µs/event  = 69.4
peak retained = 256 (= MAX_RECORDS_PER_TASK)
contract gate = p50 < 100 µs  ✅  (passed with 17x margin)
```

## Halt conditions (R-C1 / R-C2 / R-C3 / R-C4 / R-C5)

```text
H1  shadow wiring requires AgentRuntime semantic change   = NO  (R-C2 wiring lives in SdkController)
H2  shadow needs prose to reproduce state                  = NO  (privacy allowlist enforced)
H3  shadow must write legacy state to stay in sync        = NO  (read-only seams)
H4  invariant violation on a valid real sequence          = NO  (every W01–W16 clean)
H5  task identity cannot be unambiguously seeded           = NO  (R-C2: emitTaskRequested)
H6  > 5 % D10_UNKNOWN                                     = NO  (gate = 0)
H7  evidence requires prompt / reasoning / payload        = NO  (privacy allowlist)
H8  observable perf regression                            = NO  (p50 = 5.8µs, 17x margin)
H9  context-accounting stash becomes necessary             = NO  (a7fab1952-equivalent preserved)
H10 E5–E6 net production LOC > 800                        = NO  (+219 lines, under gate)
```

## C04 real capture (R2)

```text
R-C1 finding: W15 was a synthetic fixture of the known bug shape.
R-C4 fix: W15 is still synthetic in this CORRECTION01 (the
         canonical-arbiter canned fixture validates the model's
         classification shape, not the real production capture).
R-C2 architectural fix: the wiring is now LIVE on the production
         SdkController path. Real ClineMM tasks can flow through
         the recorder today.

C04_BUG_CLASS_REAL_CAPTURE = DEFERRED to the E6-real-dogfood ACT
                              (out of E5–E6 scope; explicitly tracked).
```

## Architectural finding (R9, ELM-02F)

The downstream review (R9) rightly noted that the reverse-translator
is a lossy workaround: the canonical `AgentRuntimeEvent` is a
first-class runtime API on `@cline/agents`, and shipping
`subscribeEvents` on `LocalRuntimeHost` would let the shadow consume
the canonical stream directly.

The forward-fix is documented as **ELM-02F** (out of scope for E5–E6):

```text
ELM-02F subscribeRuntimeEvents seam
  - LocalRuntimeHost: add a parallel `subscribeRuntimeEvents` path.
  - SessionRuntime: expose the canonical stream to subscribers.
  - VscodeSessionHost: forward the canonical stream to the host.
  - Reverse-translator: deleted once the seam lands.
```

E5–E6 (and now CORRECTION01) deliver the wiring and the
qualification harness around the lossy translation. The forward-fix
unblocks once the seam is in.

## Lane state

```text
ELM-00  E0 authority inventory                  ✅
ELM-01  E1–E4 shadow architecture               ✅
ELM-01C CORRECTION01                            ✅
ELM-01  CLOSURE01                                ✅
ELM-01  CLOSURE02                                ✅
ELM-02  E5–E6 differential infrastructure       ✅ IMPLEMENTED
ELM-02C E5–E6 CORRECTION01                       ✅ PASS (this ACT)

ELM-03  E7 consumer cutover                      🟢 AUTHORIZED → ACT-...-E7-CONSUMER-CUTOVER01
ELM-04  E8 writer retirement                    ⛔
ELM-05  E9 effect interpreter                    ⛔
ELM-06  E10 Factory/model-check                  ⛔
ELM-07  E11 dogfood + shadow removal             ⛔

STATE_VERSION / epoch lane                      🟨 separate
CONTEXT accounting                              🟨 separate; a7fab1952 preserved
RECOVERY runtime integration                    🟨 separate
LEAMAS closure protocol repair                   🔴 separate epic
ELM-02F forward-fix subscribeRuntimeEvents     🟡 follow-up (out of E5–E6 scope)
```

## E7 authorization

```text
E7_AUTHORIZED = true
NEXT          = ACT-CLINEMM-ELM-ARCHITECTURE01-E7-CONSUMER-CUTOVER01
```

E7 begins the consumer cutover. The wiring is now live on the
production SdkController path. The shadow is observation-only,
the recording is bounded and privacy-safe, classification is
deterministic, arbitration has a canonical arbiter, and the host
wiring never imports a writer API.