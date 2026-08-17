# ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01 — Recon & contract

```text
ACT =
ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01
```

## Frozen inputs

```text
ENGINEERING_FROZEN_HEAD = fda31614ee4243c12de3e990badbc4c11ef64db5
CLOSURE01_HEAD          = e7015cddc9d1327d794a6d2d51005a2020dcb541
CLOSURE02_HEAD          = 08875d02f0d1e029992a701a82e291012d566166

E5_E6_BASE              = 08875d02f0d1e029992a701a82e291012d566166

MAIN_HEAD               = a9f376edf
MAIN_STASH              = a7fab1952 (DO NOT POP)
```

## Mission

Move the accepted E0–E4 `TaskStateShadow` from synthetic differential
testing to real production-path observation. Preserving:

```text
LEGACY_AUTHORITY          = 100 %
SHADOW_AUTHORITY          = 0 %
DIVERGENCE_ACTION         = RECORD_ONLY
WEBVIEW_CUTOVER           = false
EFFECT_EXECUTION_ENABLED  = false
```

The result is **evidence about equivalence**, not a migration.

## Architectural finding (architectural scope only)

Production today delivers **legacy `AgentEvent`** to the host through
`sdkHost.subscribe(handler)`. The canonical `AgentRuntimeEvent` is
only emitted to internal core subscribers
(`session-runtime-orchestrator.subscribeEvents` →
`RuntimeEventAdapter.translate()` → legacy `AgentEvent`).

The accepted `TaskStateShadow.adaptRuntimeEvent()` consumes
`AgentRuntimeEvent` directly. For E5–E6 we therefore need a
**host-side reverse-translator** that reconstructs the runtime-event
subset the shadow cares about from the legacy `CoreSessionEvent`
stream. This translator lives in `apps/vscode/src/sdk/`; it does not
change `@cline/core` semantics. A future ACT (out of E5–E6 scope)
should add a parallel `subscribeRuntimeEvents` seam on the core side
to eliminate the reverse-translation.

## Hard scope boundary

### Allowed production changes

```text
apps/vscode/src/sdk/
    task-state-shadow.ts               (interface — preserved)
    task-state-shadow-observer.ts      (new — Legacy → Runtime event reverse-translator)
    task-state-shadow-recorder.ts      (new — bounded classified ring buffer)
    task-state-shadow-host-wiring.ts   (new — controller-lifetime orchestrator)
    <no other host files unless an existing seam proves insufficient>
```

### Forbidden

```text
NO TurnStateTracker writer deletion/change
NO TaskTelemetryTracker semantic change
NO AgentRuntime lifecycle semantic change
NO AgentRuntime call-shape change
NO webview consumer migration
NO ChatRow / RequestStartRow behavioural change
NO tool execution change
NO approval policy change
NO recovery policy change
NO context accounting
NO stateVersion/epoch work
NO Factory / Leamas closure-protocol work
NO EFFECT_EXECUTION_ENABLED = true
NO change to @cline/shared public API
NO change to @cline/agents public API
```

If E5–E6 starts "fixing" legacy behaviour, it has escaped scope.

## Differential evidence contract

Privacy-safe (no prompt, no assistant text, no reasoning, no tool
arguments/outputs, no API payloads, no control keys, no file
contents).

```ts
interface TaskShadowDifferentialRecord {
    readonly seq: number
    readonly timestamp: number
    readonly event: TaskMsg["type"] | "noop"
    readonly legacyPhase: TurnPhase
    readonly shadowPhase: TurnPhase
    readonly lifecycleKind: TaskLifecycleState["kind"]
    readonly modelStreaming: boolean
    readonly activeToolCount: number
    readonly awaitingApproval: boolean
    readonly toolCalls: number
    readonly recoveryBudgetFailures: number

    // E5 additions:
    readonly taskEpochOrOpaqueTaskKey: string | undefined
    readonly runtimeStatus: AgentRunStatus | undefined
    readonly classification: DivergenceClass
    readonly arbitration?: ArbitrationOutcome
}
```

## Divergence taxonomy

```text
D00_AGREE                       — legacy == shadow
D01_LEGACY_FALSE_IDLE           — legacy=idle, shadow=streaming|awaiting_approval
D02_SHADOW_FALSE_ACTIVE         — shadow active, canonical runtime says no activity
D03_TERMINAL_ORDERING           — legacy terminal vs shadow active, or converse
D04_APPROVAL_PRECEDENCE         — disagreement involving awaiting_approval
D05_TOOL_CARDINALITY            — mismatch attributable to parallel / orphan / duplicate tools
D06_RESUME_BOUNDARY             — disagreement around resumable / same_task_continued
D07_FAILURE_MAPPING             — failed / error mismatch
D08_FOLLOWUP_EXTERNAL           — host-only awaiting_followup projection
D09_EVENT_GAP                   — shadow lacks enough input to project
D10_UNKNOWN                     — unclassified
```

## Canonical arbiter

When legacy and shadow disagree, do not default to legacy:

```text
streaming        ⇒ AgentRuntime snapshot execution.modelStreaming
tooling          ⇒ pendingToolCalls / canonical tool events
approval         ⇒ execution.awaitingApproval
runtime terminal ⇒ AgentRuntime run lifecycle
awaiting_followup⇒ HOST INTERACTION (host-only projection)
```

Every classified divergence resolves to:

```text
LEGACY_CORRECT              | SHADOW_CORRECT
BOTH_VALID_DIFFERENT_PROJECTION | INSUFFICIENT_EVIDENCE
```

## Bounded recorder

```text
MAX_RECORDS_PER_TASK = 256
INVARIANT_VIOLATIONS > 0   ⇒  hard diagnostic in qualification builds
```

Track:

```text
eventsObserved
comparisons
agreements
divergences
divergenceCountsByClass
invariantViolations
droppedRecords
```

## Runtime enablement

Internal dev/debug flag, default-on in current build:

```text
CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL = "1"  (default on; set "0" to disable)
```

No user-visible setting. No network telemetry. Local evidence only.

## Performance budget

Synthetic workload of ≥ 10 000 `CoreSessionEvent`s must process with
`p50 observation overhead < 100 µs / event`. Report `events/sec`,
`µs/event`, peak retained records, approximate memory bound.

## Synthetic integration workload matrix

Workloads W01–W16 (spec §10). Each workload emits a deterministic
`CoreSessionEvent` stream that flows through the reverse-translator
and into the recorder.

| ID  | Scenario                           | Expected outcome |
| --- | ---------------------------------- | ---------------- |
| W01 | text-only completion               | D00_AGREE |
| W02 | text + reasoning                   | D00_AGREE |
| W03 | one tool                           | D00_AGREE |
| W04 | two parallel tools                 | D00_AGREE |
| W05 | approval allow                     | D00_AGREE |
| W06 | approval deny                      | D00_AGREE |
| W07 | cancellation while streaming       | D00_AGREE |
| W08 | cancellation during tool           | D00_AGREE |
| W09 | provider / network failure         | D00_AGREE |
| W10 | recovery episode                   | D00_AGREE |
| W11 | completed → same-task continuation | D00_AGREE |
| W12 | completed → brand-new task         | D00_AGREE |
| W13 | stale event after completion       | D09_EVENT_GAP (expected) |
| W14 | stale event after resumable        | D09_EVENT_GAP (expected) |
| W15 | known C04 legacy-false-idle shape  | D01_LEGACY_FALSE_IDLE (expected) |
| W16 | host awaiting-followup             | D08_FOLLOWUP_EXTERNAL (expected) |

Gates:

```text
INVARIANT_VIOLATIONS  = 0
UNKNOWN_DIVERGENCES   = 0
SHADOW_FALSE_ACTIVE   = 0 (unexplained)
```

## Halt conditions (H1–H10)

Stop and report rather than "fix around" any of:

```text
H1   shadow wiring requires AgentRuntime semantic change
H2   shadow needs prose to reproduce state
H3   shadow must write legacy state to stay in sync
H4   invariant violation appears on a valid real sequence
H5   task identity cannot be unambiguously seeded
H6   > 5 % of real differential events are D10_UNKNOWN
H7   evidence requires storing prompt / reasoning / tool payload
H8   observation creates measurable user-visible perf regression
H9   context-accounting stash or unrelated SdkController work becomes necessary
H10  E5–E6 diff exceeds ~800 net production LOC without compelling reason
```

H4 / H5 are particularly serious architectural signals.

## Test requirements

```text
- shadow subscriber receives each runtime event exactly once
- legacy phase sampled at defined instant (synchronous)
- no recursive posting
- no legacy writes
- no webview writes
- no tool / approval / recovery effects
- task identity seeded correctly
- shadow disposed / reset correctly
- ring buffer bounded (256 records)
- classification deterministic
- privacy allowlist exact (no message prose / tool input / etc.)
- R4 strict assertion preserved
```

## Conservation tests (structural guards)

```text
- TaskShadowComparator (and observer) cannot import writer APIs
  (compile-time via dependency-boundary test)
- differential module cannot import postStateToWebview
- EFFECT_EXECUTION_ENABLED === false at runtime
- webview has zero TaskState imports
- shadow never calls TurnStateTracker.set()
```

## E7 authorization decision

At closure, produce **one** of:

```text
VERDICT = PASS_SHADOW_DIFFERENTIAL         → E7 AUTHORIZED
VERDICT = MODEL_CORRECTION_REQUIRED        → E7 BLOCKED; specific narrow correction ACT
VERDICT = QUALIFICATION_INCOMPLETE         → E7 BLOCKED; missing workload / evidence
```

No automatic E7.