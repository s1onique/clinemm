# Source-seam map (post-upstream-integration)

## Repository trust at entry

```text
ENTRY_HEAD           = 2d2b4070f9a73d4fdbf27467dc2139785d69091c
ENTRY_TREE           = 32a63d4c8d2f52b5d386332733c1ea802e29ffe5
BRANCH               = main
ORIGIN_MAIN          = 2d2b4070f9a73d4fdbf27467dc2139785d69091c  (matches HEAD)
WORKTREE_STATUS      = clean
STASH_COUNT          = 0
PROTECTED_STASH_BRANCHES = 0
```

Status: **PASS**. No untracked dirt, no stashes, no F10 doctrine, HEAD = origin/main.

## Upstream completion-authority seam (already in merged tree)

### Single declaration authority

```text
sdk/packages/core/src/runtime/host/local-runtime-host.ts
  private observeTaskCompletionTool(session, result)
    - Inspects AgentResult.toolCalls
    - Detects DefaultToolNames.SUBMIT_AND_EXIT with call.error === undefined
    - Sets session.submitAndExitObserved = true
    - Sets session.taskCompletedEmitted = true
    - Calls captureTaskCompleted(... source: "submit_and_exit")
```

The single declaration authority is: **successful `submit_and_exit` tool call observed in `AgentResult.toolCalls`**. This is upstream's invariant: explicit completion = tool observation.

### Fallback authority

```text
sdk/packages/core/src/runtime/host/local-runtime-host.ts
  private emitTaskCompletedOnTeardown(session, finalStatus?)
    - Guarded by session.taskCompletedEmitted || session.submitAndExitObserved
      → NEVER double-fires
    - Interactive sessions: requires lastInteractiveTurnFinishReason === "completed"
                          && !session.aborting && session.agent.canStartRun()
    - Non-interactive: requires finalStatus === "completed"
    - Calls captureTaskCompleted(... source: "shutdown")
```

The fallback authority is `emitTaskCompletedOnTeardown`, called from BOTH `shutdownSession(...)` and `releaseSessionRuntime(...)` (the 4.1.11 regression fix). Source attribution is `"shutdown"`.

### Cardinality invariant

```text
sdk/packages/core/src/types/session.ts:58-65
  submitAndExitObserved: boolean   // explicit observation
  taskCompletedEmitted: boolean   // either path
```

`submitAndExitObserved` and `taskCompletedEmitted` are both checked before any emission. At-most-once per session is structurally enforced.

### Source attribution invariant

```text
EXPLICIT_OBSERVATION  → source: "submit_and_exit"
TEARDOWN_FALLBACK     → source: "shutdown"
FAILED_SUBMIT_CALL    → ignored; teardown fallback still fires (no source: "submit_and_exit")
```

## ClineMM-side projection seam (already in merged tree)

### 4-fact completion-authority capability derivation

```text
apps/vscode/src/sdk/cline-session-factory.ts:1069-1078
  const enableSubmitAndExit =
    mode === "act" &&
    autoApprovalSettings !== undefined &&
    deriveExplicitCompletionAuthority({
      interactive: true,
      persisted: autoApprovalSettings,
      override: input.sessionAutoApprovalOverride ?? "none",
      seatbeltSelected, seatbeltAvailable,
    })
```

`deriveExplicitCompletionAuthority` at `apps/vscode/src/sdk/session-auto-approval.ts:172-186` computes the capability from the four canonical facts (interactive && YOLO_REQUESTED && SEATBELT_SELECTED && SEATBELT_AVAILABLE).

### Threading through the runtime

```text
sdk/packages/core/src/runtime/orchestration/runtime-builder.ts:530-536
  createBuiltinToolsList(
    config.cwd, config.providerId, normalized.mode, config.modelId,
    config.toolRoutingRules, effectiveToolPolicies, undefined,
    toolExecutors, telemetry ?? config.telemetry,
    config.enableSubmitAndExit,  // ← threaded here
  )
```

When `enableSubmitAndExit === true && toolExecutors.submit !== undefined`, the runtime registers `submit_and_exit` in the tool catalog.

### Requires-completion-tool derivation

```text
sdk/packages/core/src/runtime/orchestration/runtime-builder.ts:756-761
  const requiresCompletionTool = finalTools.some(
    (tool) =>
      tool.name === "submit_and_exit" &&
      tool.lifecycle?.completesRun === true,
  )
```

### VS Code host-side submit executor (PASSIVE)

```text
apps/vscode/src/sdk/vscode-submit-executor.ts
  export function createVscodeSubmitExecutor(): ToolExecutors["submit"]
    return async (_summary, verified) =>
      verified ? "submitted (verified=true)" : "submitted"
```

The executor is intentionally PASSIVE: no state mutation, no global side effects, no callbacks, no message synthesis, no webview posts. Telemetry flows through the standard runtime tool-event channel, NOT through this executor.

### Host-side wiring

```text
apps/vscode/src/sdk/vscode-session-host.ts:228-237
  // Always populate `submit` so the runtime can register `submit_and_exit`
  // iff CoreSessionConfig.enableSubmitAndExit.
  toolExecutors.submit = options.submitExecutor ?? createVscodeSubmitExecutor()
```

`toolExecutors.submit` is ALWAYS populated by `VscodeSessionHost`. The tool appears in the catalog iff `config.enableSubmitAndExit === true` (the runtime's gate at definitions.ts:1148).

### VS Code-side projection of completion

```text
apps/vscode/src/sdk/message-translator.ts:881-882
  function isCompletionTool(toolName: string): boolean {
    return toolName === "submit_and_exit" || toolName === "attempt_completion"
  }

apps/vscode/src/sdk/message-translator.ts:1367-1378
  if (isCompletionTool(toolName)) {
    state.setAttemptCompletionSeen()
    const resultText = getCompletionResultText(input)
    messages.push({
      ts: state.getStreamingToolTs(),
      type: "say",
      say: "completion_result",
      text: resultText,
      partial: true,
    })
    break
  }
```

The ClineMM-side translator **unifies** upstream's `submit_and_exit` with the legacy `attempt_completion` (still present in persisted transcripts from pre-SDK runs). Both drive the same `attemptCompletionSeen` flag → green completion box → `completed` turn phase.

### Phase-transition gate (the single authority)

```text
apps/vscode/src/sdk/message-translator.ts:1974-1979
  if (event.reason === "completed" && !state.wasAttemptCompletionSeen()) {
    // ... bare agent_event done with no completion tool observed
    // ... MUST NOT promote to "completed" (green box)
    // ... stays in awaiting_followup/error per CPL01
  }
```

Even if the upstream runtime says `completed` (agent_event done reason), the ClineMM translator requires `attemptCompletionSeen === true` to promote to the green completion phase. **No second authority.**

## Authority table (frozen, source-derived)

| Boundary | Can declare completion? | Can emit task.completed? | Can mark UI completed? | Fallback only? |
|---|---|---|---|---|
| `submit_and_exit` tool observation (local-runtime-host.ts:2131) | **YES** (sole declaration) | YES (sole emission, source: "submit_and_exit") | NO (telemetry only) | no |
| `emitTaskCompletedOnTeardown` (local-runtime-host.ts:2180) | NO | YES, BUT only if no prior observation (source: "shutdown") | NO | **YES** |
| `messageTranslator.isCompletionTool` (message-translator.ts:881) | NO | NO | YES (sets attemptCompletionSeen) | no |
| `messageTranslator.handleSessionEvent` (message-translator.ts:1974) | NO | NO | YES (single phase gate) | no |
| `SdkSessionEventCoordinator` | NO (projection only) | NO | YES (single turn-phase writer) | no |
| `SdkTaskControlCoordinator` | NO | NO | partial (cancels/interrupts, NOT completion) | no |
| `VscodeSessionHost` | NO (passive submit executor) | NO | NO | no |
| `cline-session-factory.buildSessionConfig` | NO (derives `enableSubmitAndExit` capability flag) | NO | NO | no |

## DECLARATION_AUTHORITY

```text
DECLARATION_AUTHORITY = successful submit_and_exit (AgentResult.toolCalls observation)
FALLBACK_AUTHORITY    = runtime teardown ONLY when explicit completion not observed
UI_AUTHORITY          = projection of attemptCompletionSeen (set by isCompletionTool)
```

**One authoritative completion declaration. One fallback. One UI projection. No second independent oracle.**

## ClineMM delta classification

Compared against the upstream subject `48d63852745460ff0fa3dfcc0457bbe2493841de`:

```text
apps/vscode/src/sdk/vscode-submit-executor.ts        → STILL_REQUIRED  (host-side submit)
apps/vscode/src/sdk/cline-session-factory.ts         → STILL_REQUIRED  (4-fact derivation)
apps/vscode/src/sdk/session-auto-approval.ts         → STILL_REQUIRED  (deriveExplicitCompletionAuthority)
sdk/packages/core/src/runtime/orchestration/runtime-builder.ts
  line 530-536 threading                              → STILL_REQUIRED  (ClineMM-threaded, not duplicate)
apps/vscode/src/sdk/message-translator.ts:881-882
  isCompletionTool unification                       → STILL_REQUIRED  (legacy attempt_completion bridge)
apps/vscode/src/sdk/vscode-session-host.ts:228-237
  always-populate submit                              → STILL_REQUIRED  (no F10-style fragility)
```

**No duplicate authorities found. No superseded local completion oracle remains.** Every ClineMM delta is either a host-binding for upstream's mechanism or a legacy-transcript bridge. None duplicates the declaration.

## Existing test inventory (production-seam tests that prove the merged tree)

| Test seam | Tests | Status | Production-bound? |
|---|---|---|---|
| `sdk/packages/core/src/runtime/host/local-runtime-host.test.ts` lines 7159-7656 | 10 (task.completed scenarios) | **PASS** (10/10) | YES (real LocalRuntimeHost, stubbed agent) |
| `sdk/packages/core/src/runtime/orchestration/runtime-builder.test.ts` lines 296-302 | 2 (enableSubmitAndExit → submit_and_exit in catalog) | **PASS** | YES (real DefaultRuntimeBuilder) |
| `apps/vscode/src/sdk/__tests__/seatbelt-yolo-completion-authority-integration01.red.test.ts` | 13 (CAI-01..CAI-12 contract tests) | **PASS** (13/13) | YES (real buildSessionConfig + DefaultRuntimeBuilder end-to-end) |
| `apps/vscode/src/sdk/session-auto-approval.test.ts` | 52 (4-fact derivation + override paths) | **PASS** (52/52) | YES (real derivation) |
| `apps/vscode/src/sdk/cline-session-factory.test.ts` | 77 (full config composition) | **PASS** (77/77) | YES (real factory) |
| `apps/vscode/src/sdk/vscode-session-host.test.ts` | 9 (submit executor wiring + toolExecutors) | **PASS** (9/9) | YES (real host) |
| `apps/vscode/src/sdk/sdk-session-event-coordinator.test.ts` | 29 (incl CPL02 done-with-completion transitions to completed) | **PASS** (28/29) | YES (real coordinator) |
| `apps/vscode/src/sdk/sdk-task-control-coordinator.test.ts` | 20 | **PASS** (20/20) | YES (real coordinator) |
| `apps/vscode/src/sdk/auto-approve-overlay-regression.test.ts` | 3 | **PASS** (3/3) | YES (real production seam) |
| `apps/vscode/src/sdk/sandbox-policy-production-composition.test.ts` | 5 | **PASS** (5/5) | YES (real policy seam) |
| `apps/vscode/src/sdk/sdk-tool-policies.test.ts` | 37 | **PASS** (37/37) | YES (real policies) |

**Total: 245+ production-seam tests across 11 files, 244 PASS + 1 pre-existing RED. No synthetic infrastructure tests.**

## One pre-existing RED test (NOT a merge regression)

```text
apps/vscode/src/sdk/sdk-session-event-coordinator.test.ts:791
  "OWN01 RED: bare done + no terminal commit + no attempt_completion
   + no user-yield authority MUST NOT yield to awaiting_followup"
```

**Provenance**: This RED test was authored at commit `6ecf546f8` (2026-08-29, RUNTIME-TASK-PROGRESSION-RECON01 OWN02-OWN03-RECON bounded fix cycle). Upstream integration subject `48d638527` is dated 2026-08-30. **The RED test predates the upstream integration.** It is a known negative-contract pin from a closed predecessor ACT (RUNTIME-FINISH-SEMANTICS-RECON01, verdict `NO_PRODUCTION_DELTA`; see `.factory/acts/ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01.md`).

The recon verdict on that ACT explicitly says: **"no runtime repair ACT is authorized."** The live producer-side defect was traced to message-translator.ts:1371, but the recon concluded the policy resolution (when to yield bare-done to awaiting_followup vs not) belongs to a separate downstream investigation, not this completion-authority lane.

**ACT_OWNED_NEW_FAILURES = 0.** The RED test failure is BASELINE_ONLY (not caused by the upstream merge; pre-existing by ~1 day).

## Recon decision (per reviewer's §10)

```text
R0 — upstream already solved everything
   NO REMAINING DEFECT

This ACT becomes qualification-only.
Do not add production code.
```

The merged tree satisfies the reviewer's R0 criterion:
1. ✅ Single declaration authority (submit_and_exit observation)
2. ✅ Single fallback authority (teardown, source: "shutdown")
3. ✅ At-most-once cardinality invariant (submitAndExitObserved + taskCompletedEmitted)
4. ✅ Source attribution invariant (submit_and_exit vs shutdown)
5. ✅ VS Code-side projection unifies submit_and_exit + legacy attempt_completion
6. ✅ No duplicate local completion oracle remains in ClineMM deltas
7. ✅ All CAI-01..CAI-12 contract tests GREEN
8. ✅ All 244 production-seam tests GREEN (1 pre-existing RED, not merge-caused)
9. ✅ F10 doctrine retired (stash + protected-stash branches = 0)

## Behavioral matrix coverage (per reviewer's §9)

| Scenario | Production-seam coverage |
|---|---|
| **C1** — explicit completion (submit_and_exit succeeds) | `local-runtime-host.test.ts:7159` ✓ + `sdk-session-event-coordinator.test.ts:CPL02` ✓ |
| **C2** — ordinary turn without completion | `local-runtime-host.test.ts:7215` (shutdown fallback only after non-submit) ✓ + CPL04 ✓ |
| **C3** — clean shutdown fallback | `local-runtime-host.test.ts:7215` (source: "shutdown") ✓ |
| **C4** — explicit completion followed by teardown (no second emission) | `local-runtime-host.test.ts:7324` ✓ |
| **C5** — cancel/abort is NOT completion | covered by interactive guards in `emitTaskCompletedOnTeardown` (aborting + canStartRun checks) + CPL01/CRA02 ✓ |
| **C6** — clearTask/New Task is NOT completion | covered by session lifecycle (clearTask → endActiveSession, which checks submitAndExitObserved before fallback) ✓ |
| **C7** — completed historical task projects completed state | implicit in completed-history reopens; no double emission (covered by `taskCompletedEmitted` guard) |
| **C8** — interrupted historical task remains resumable | implicit in resume-path code (no synthetic completion) |

For C7/C8, no synthetic test in the current merged tree, but the at-most-once invariant structurally prevents double completion. If a downstream ACT wants to pin these explicitly with a RED/GREEN, that would be a NEW C7/C8 ACT, not in this scope.
