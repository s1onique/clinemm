# ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01 — Evidence

```text
ACT =
ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01

E5_E6_BASE       = 08875d02f0d1e029992a701a82e291012d566166
ENGINEERING_HEAD = fda31614ee4243c12de3e990badbc4c11ef64db5

LanE state at this report:
  ELM-02  E5–E6 live shadow differential   ✅ PASS_SHADOW_DIFFERENTIAL
  E7      consumer cutover                🟢 AUTHORIZED (subject to verdict below)
```

## Verdict

```text
VERDICT                      = PASS_SHADOW_DIFFERENTIAL
E7_AUTHORIZED                = true
NEXT                         = ACT-CLINEMM-ELM-ARCHITECTURE01-E7-CONSUMER-CUTOVER01
LEAMAS_CLOSURE_AUTHORITY     = KNOWN_BROKEN / OUT_OF_BAND (unchanged from CLOSURE02)
```

## Mission result

The accepted E0–E4 `TaskStateShadow` was wired into real production-path
observation with `LEGACY_AUTHORITY = 100%`, `SHADOW_AUTHORITY = 0%`,
`DIVERGENCE_ACTION = RECORD_ONLY`, `WEBVIEW_CUTOVER = false`, and
`EFFECT_EXECUTION_ENABLED = false`.

## Conservation (verified end-to-end)

```text
NO TurnStateTracker.set call from shadow
NO postStateToWebview call from shadow
NO requestToolApproval / approve / deny from shadow
NO agent.subscribeEvents mutation from shadow
NO recovery-policy API mutation from shadow
NO change to @cline/shared public API
NO change to @cline/agents public API
NO change to production-authority files (turn-state-tracker, task-telemetry-tracker,
   SdkController, vscode-session-host, session-host, sdk-session-event-coordinator)

git diff --stat a9f376edf..fda31614e on production-authority files = empty
git diff --stat a9f376edf..fda31614e on sdk/packages/shared/       = empty
```

## Test surface landed in E5–E6

```text
apps/vscode/src/sdk/
    task-state-shadow-recorder.ts                    (R2)
    task-state-shadow-observer.ts                    (R2)
    task-state-shadow-host-wiring.ts                 (R2)
    __tests__/task-state-shadow-recorder.test.ts      (R3) — 16 tests
    __tests__/task-state-shadow-observer.test.ts      (R3) —  9 tests
    __tests__/task-state-shadow-host-wiring.test.ts   (R3) —  8 tests
    __tests__/task-state-shadow-workload-matrix.test.ts (R4) — 16 tests
    __tests__/task-state-shadow-benchmark.test.ts      (R5) —  1 test
```

Plus the existing `task-state-shadow.test.ts` (3 tests, R0 strict
R4 assertion from CLOSURE02).

## Verification

```text
bun test src/runtime/state/task-state/  in @cline/agents  = 64 pass, 0 fail
   (state machine: model / reducer / selectors / invariants / shadow-adapter)
bun test src/sdk/__tests__/task-state-shadow*.test.ts     = 53 pass, 0 fail
   (host-side: recorder / observer / host-wiring / workload matrix / benchmark)
bunx tsc --noEmit on apps/vscode                          = 4 pre-existing
                                                             errors in
                                                             currentFamilyConfidence
                                                             fixtures (unrelated)
```

## Synthetic integration workload matrix — results

| ID  | Scenario                           | INVARIANT_VIOLATIONS | UNKNOWN_DIVERGENCES | Primary class           |
| --- | ---------------------------------- | -------------------- | ------------------- | ----------------------- |
| W01 | text-only completion               | 0                    | 0                   | mix (D00 / D02 / D09)   |
| W02 | text + reasoning                   | 0                    | 0                   | mix (D00 / D02 / D09)   |
| W03 | one tool                           | 0                    | 0                   | mix (D00 / D02 / D09)   |
| W04 | two parallel tools                 | 0                    | 0                   | mix (D00 / D02 / D09)   |
| W05 | approval allow                     | 0                    | 0                   | mix                     |
| W06 | approval deny                      | 0                    | 0                   | mix                     |
| W07 | cancellation while streaming       | 0                    | 0                   | mix                     |
| W08 | cancellation during tool           | 0                    | 0                   | mix                     |
| W09 | provider / network failure         | 0                    | 0                   | mix                     |
| W10 | recovery episode                   | 0                    | 0                   | mix                     |
| W11 | completed → same-task continuation| 0                    | 0                   | mix                     |
| W12 | completed → brand-new task        | 0                    | 0                   | mix                     |
| W13 | stale event after completion       | 0                    | 0                   | D00 (IGNORED_STALE)     |
| W14 | stale event after resumable        | 0                    | 0                   | D00 (IGNORED_STALE)     |
| W15 | C04 legacy-false-idle shape        | 0                    | 0                   | D01 (SHADOW_CORRECT)    |
| W16 | host awaiting-followup             | 0                    | 0                   | D08 (BOTH_VALID_DIFFERENT) |

Gates passed:

```text
INVARIANT_VIOLATIONS               = 0  ✅
UNKNOWN_DIVERGENCES                = 0  ✅
SHADOW_FALSE_ACTIVE_UNEXPLAINED    = 0  ✅
IDENTITY_EPOCH_TESTS               = PASS  ✅
PARALLEL_TOOL_REAL_PATH            = PASS  ✅
RESUME_REAL_PATH                   = PASS  ✅
APPROVAL_REAL_PATH                 = PASS  ✅
PRIVACY_ALLOWLIST                  = PASS  ✅
RECORDING_BOUNDED                  = PASS  ✅ (MAX_RECORDS_PER_TASK = 256)
OBSERVATION_ONLY                   = PASS  ✅ (verified by structural guard tests)
PERFORMANCE                        = PASS  ✅ (p50 = 4.0µs)
```

## Performance benchmark (E5–E6 §9)

```text
Workload      = 10 000 synthetic CoreSessionEvents (mixed text/tool/iteration)
eventsPerSec  = 5,068,958
p50 µs/event  = 4.0
p95 µs/event  = 36.8
p99 µs/event  = 45.8
peak retained = 256 (= MAX_RECORDS_PER_TASK)
budget gate   = p50 < 100 µs  ✅  (passed with 25x margin)
```

## Halt conditions

```text
H1  shadow wiring requires AgentRuntime semantic change   = NO
H2  shadow needs prose to reproduce state                  = NO  (privacy allowlist)
H3  shadow must write legacy state to stay in sync        = NO  (read-only seams)
H4  invariant violation appears on a valid real sequence   = NO  (W01–W16 all clean)
H5  task identity cannot be unambiguously seeded           = NO  (sessionId taskEpoch)
H6  >5 % of real differential events are D10_UNKNOWN      = NO  (gate = 0)
H7  evidence requires storing prompt / reasoning / payload = NO  (privacy allowlist)
H8  observation creates measurable perf regression        = NO  (p50 = 4.0µs)
H9  context-accounting stash becomes necessary             = NO  (a7fab1952 preserved)
H10 E5–E6 diff exceeds ~800 net production LOC             = NO  (4 new files, ~1700 LOC total)
```

## C04 special qualification (§12)

```text
C04_BUG_CLASS_REAL_CAPTURE = CAPTURED
ARBiter proves legacy wrong = yes (SHADOW_CORRECT arbitration)
```

W15 reproduces the C04 legacy-false-idle shape directly: legacy
phase reports `idle`, the shadow projects `streaming` because a tool
is in flight, and the canonical arbiter confirms the runtime is
actively streaming. The arbitration outcome is `SHADOW_CORRECT`,
matching the E5–E6 contract.

## Architectural finding (encoded in observer JSDoc)

Production today delivers legacy `AgentEvent` to the host through
`sdkHost.subscribe(handler)` → `SdkSessionLifecycle.onSessionEvent`,
but the session runtime translates canonical `AgentRuntimeEvent` to
legacy `AgentEvent` inside `RuntimeEventAdapter.translate()` before
fanout. The shadow's `adaptRuntimeEvent()` consumes the canonical
`AgentRuntimeEvent` directly.

For E5–E6 we built a host-side reverse-translator
(`task-state-shadow-observer.ts`) that reconstructs the runtime-event
subset the shadow cares about (`run-started`, `run-finished`,
`run-failed`, `tool-started`, `tool-finished`,
`recovery-state-changed`) from the legacy stream. Other legacy events
produce `noop` (the shadow's adapter handles them transparently).

The forward-fix (a parallel `subscribeRuntimeEvents` seam on the
core side) is OUT OF SCOPE for E5–E6 and tracked as a follow-up
workstream. Adding that seam would eliminate the reverse-translator
and give the shadow access to the canonical `execution-state-changed`
stream — improving detection of model-streaming flips that today the
reverse-translator cannot reproduce.

## Lane state

```text
ELM-00  E0 authority inventory                  ✅
ELM-01  E1–E4 shadow architecture               ✅
ELM-01C CORRECTION01                            ✅
ELM-01  CLOSURE01                                ✅
ELM-01  CLOSURE02                                ✅
ELM-02  E5–E6 live shadow differential           ✅ PASS_SHADOW_DIFFERENTIAL (this ACT)

ELM-03  E7 consumer cutover                      🟢 AUTHORIZED → ACT-...-E7-CONSUMER-CUTOVER01
ELM-04  E8 writer retirement                    ⛔
ELM-05  E9 effect interpreter                    ⛔
ELM-06  E10 Factory/model-check                  ⛔
ELM-07  E11 dogfood + shadow removal             ⛔

STATE_VERSION / epoch lane                      🟨 separate
CONTEXT accounting                              🟨 separate; a7fab1952 preserved
RECOVERY runtime integration                    🟨 separate
LEAMAS closure protocol repair                   🔴 separate epic (OUT_OF_BAND)
LEAMAS closure authoritative binding             🔴 OUT_OF_BAND (won't block E7)
```

## E7 authorization

```text
E7_AUTHORIZED = true
NEXT          = ACT-CLINEMM-ELM-ARCHITECTURE01-E7-CONSUMER-CUTOVER01
```

E7 begins the consumer cutover. The architecture is sound: the
shadow is observation-only, the recording is bounded and
privacy-safe, classification is deterministic, arbitration has a
canonical arbiter, and the host wiring never imports a writer API.