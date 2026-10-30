# ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-OUTCOME-PROJECTION01 — EVIDENCE (TES-OUT-01)

## STATUS

- ACT: ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-OUTCOME-PROJECTION01
- ACT-TYPE: bounded production implementation
- VERDICT (final): `PASS_STRUCTURAL_ONLY`
- ENTRY_HEAD: `38e726c45de0b9412e6d3822bfd104fd7cbe2cbf` (branch `tool-execution-semantics-m3`; `main` at the same SHA)
- SUBJECT_HEAD: `f09a1e25f8a1dfe767dd7e075da7b8f0c96b3689`
- WORKTREE at closure: clean except the tracked delta of this ACT
- STASHES: 2/2 protected (unchanged; verified before and after)

---

## 1. Evidence block

```text
ENTRY_HEAD          = 38e726c45de0b9412e6d3822bfd104fd7cbe2cbf
SUBJECT_HEAD        = f09a1e25f8a1dfe767dd7e075da7b8f0c96b3689
CHANGED_FILES       = 8 production + 3 test + 2 documentation
RED_RESULT          = 12/12 failed (capability absent: recordToolStartedWithIdentity
                      / recordToolRuntimeOutcome undefined; outcome undefined on the wire)
GREEN_RESULT        = 15/15 host tracker + 8/8 webview + 3/3 SDK hook fan-out;
                      existing suites unchanged (64 tracker + 21 mechanism + 6 wiring)
ABLATION_RESULT     = producer seam neutered → 6/12 RED (TESOUT-01 load-bearing);
                      correction restored → 12/12 GREEN
TYPECHECK           = apps/vscode `tsc --noEmit` clean; webview `tsc --noEmit` clean;
                      sdk/packages/core `tsc -p tsconfig.dev.json` byte-identical to baseline
                      (56 pre-existing diagnostic lines, none in the changed files)
WEBVIEW_BUILD       = `bun run build` in apps/vscode/webview-ui → exit 0, built in 9.36s
LEGACY_CONSERVATION = legacy host (no `outcome` field) renders the V1 display unchanged
                      (TESOUTUI-02); the mechanism strip is untouched by the outcome
                      projection (TESOUTUI-07, TESOUT-11); `toolCalls` is unchanged
LIVE_UI_STATUS      = UNAVAILABLE — the sandbox cannot launch the Electron host
                      (SIGSEGV + `kill() failed: EPERM`); the BASELINE code fails
                      identically, so this is an environment limitation, not a regression
VERDICT             = PASS_STRUCTURAL_ONLY
```

---

## 2. C0 recon — the production seam

The typed outcome hook EXISTS in production and fires per tool
invocation, but it was **structurally unreachable by any host**: both
hook-merge layers dropped it.

```text
sdk/packages/shared/src/agents/recovery/types.ts
    export type ToolRuntimeOutcome =
      | { kind: "success";      toolName; toolCallId }
      | { kind: "failure";      toolName; toolCallId; failureClass; stableCode; ... }
      | { kind: "control_plane"; outcome: ControlPlaneOutcome; toolName?; toolCallId? }

sdk/packages/shared/src/agent.ts
    AgentRuntimeHooks.onToolRuntimeOutcome?: (ctx: AgentToolRuntimeOutcomeHookContext) => void | Promise<void>
    // doc: "Fires once per tool call after the runtime has produced a
    //       ToolRuntimeOutcome for that call. Read-only observation."

sdk/packages/agents/src/agent-runtime.ts
    executePreparedTool → await this.notifyToolRuntimeOutcome(prepared.toolCall, runtimeOutcome)
    notifyToolRuntimeOutcome → for (const hook of this.hooks.onToolRuntimeOutcome) await hook({ toolCall, outcome })
    // The hook's RETURN VALUE IS IGNORED → read-only by construction.

sdk/packages/core/src/hooks/hook-file-hooks.ts
    mergeAgentHooks → merged beforeRun/afterRun/beforeModel/afterModel/beforeTool/afterTool/onEvent
                       *** onToolRuntimeOutcome WAS DROPPED ***

sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts
    mergeRuntimeHooks → same seven hooks
                       *** onToolRuntimeOutcome WAS DROPPED ***
    createRuntimeHooks() → mergeRuntimeHooks([this.config.hooks, ...extension hooks])
```

Host path that reaches the runtime hook bag:

```text
SdkController (1603) → new SdkSessionConfigBuilder({ onToolRuntimeOutcome })
  → SdkSessionConfigBuilder.build() → config.hooks = { ...buildAgentHooks(...), onToolRuntimeOutcome }
  → ClineCore.start → splitCoreSessionConfig → localRuntime.hooks
  → prepareLocalRuntimeBootstrap → mergeAgentHooks → hooks
  → LocalRuntimeHost → agentConfig.hooks
  → SessionRuntime → createRuntimeHooks() → mergeRuntimeHooks → AgentRuntime config.hooks
  → AgentRuntime.registerHooks → hooks.onToolRuntimeOutcome.push(...)
```

Verdict: **reachable with a bounded additive fix** (two one-line merge
fan-outs + one host option). `HALT_WRONG_PRODUCTION_SEAM` did NOT apply.

---

## 3. Empirical probe — the load-bearing runtime truth

A throwaway probe drove the REAL `AgentRuntime` (the built
`@cline/agents` bundle) with a scripted model and recorded, per case,
both the emitted `tool-started` runtime events and the
`onToolRuntimeOutcome` outcomes. It was removed after the run (it was a
probe, not a committed test).

```text
POLICY_DISABLED  events=[tool-started:t-1]  outcomes=[t-1:control_plane]
HOST_DENY        events=[tool-started:t-1]  outcomes=[t-1:control_plane]
SUCCESS          events=[tool-started:t-1]  outcomes=[t-1:success]
UNKNOWN_TOOL     events=[tool-started:t-1]  outcomes=[t-1:failure]
```

### Consequence 1 — a pre-existing comment was factually wrong

`apps/vscode/src/sdk/SdkController.ts` claimed:

```text
"The runtime emits one `tool-started` per tool invocation that reached the
executor; control-plane DENY/REJECT/UNKNOWN_TOOL never emit this event,
so the counter naturally excludes them."
```

The probe proves this FALSE: `AgentRuntime.executePreparedTool` emits
`tool-started` at the TOP of the method, BEFORE the pre-execution
control-plane block. The counted `toolCalls` therefore DOES include
policy-disabled / host-DENY / user-reject / unknown-tool calls.

The stale comment has been corrected in place, and the V2 projection
handles the consequence correctly (a `control_plane` terminal is
`unknown`, never a success and never a failure).

### Consequence 2 — the join key is authoritative

`onToolRuntimeOutcome` fires EXACTLY ONCE per tool invocation and the
hook context carries the SAME `AgentToolCallPart.toolCallId` that the
`tool-started` event carries. The join is therefore by identity, never
chronological.

Hook cardinality was MEASURED (the probe), not inferred from tool-start
cardinality — as the ACT requires.

---

## 4. RED reproduction

Test file: `apps/vscode/src/sdk/__tests__/tool-outcome-projection.tes02.test.ts`

It drives the REAL production `TaskTelemetryTracker` with REAL typed
`ToolRuntimeOutcome` values (the production discriminants imported from
`@cline/shared`, not test-invented constants).

RED output (before the implementation):

```text
TypeError: tracker.recordToolStartedWithIdentity is not a function.
TypeError: tracker.recordToolRuntimeOutcome is not a function.
AssertionError: expected undefined to deeply equal
  { succeeded: 1, failed: 1, pending: 1, unknown: 0 }
Tests  12 failed (12)
```

Scenario (ACT §5): start task A; observe three canonical tool starts;
complete one with typed success; complete one with typed failure; leave
one pending.

```text
toolCalls = 3
succeeded = 1
failed    = 1
pending   = 1
unknown   = 0
```

---

## 5. GREEN — executable suites

### Host tracker (new)

```text
src/sdk/__tests__/tool-outcome-projection.tes02.test.ts   Tests  15 passed (15)
```

### Webview rendering + validator (new)

```text
src/components/chat/task-header/TaskHeaderTelemetry.outcome.tes02.test.tsx   8 passed
```

### SDK hook fan-out (new)

```text
sdk/packages/core/src/runtime/orchestration/
  session-runtime-orchestrator.tool-outcome-hook.tes02.test.ts               3 passed
```

### Existing suites (must remain green)

```text
apps/vscode  src/sdk/task-telemetry-tracker.test.ts                          64 passed
apps/vscode  src/sdk/__tests__/tool-mechanism-classifier.test.ts              21 passed
apps/vscode  src/sdk/SdkController.task-telemetry-wiring.test.ts              6 passed
sdk/core     src/hooks/hook-file-hooks.test.ts                    22 passed | 1 skipped
sdk/core     src/runtime/orchestration/session-runtime-orchestrator.test.ts    62 passed
sdk/core     src/runtime/orchestration/runtime-builder.routing-evals.swcm02.test.ts  12 passed
webview      src/components/chat/task-header/TaskHeaderTelemetry.test.tsx     46 passed
webview      src/components/chat/task-header/TaskHeaderTelemetry.gauge.test.tsx 13 passed
webview      src/components/chat/task-header/TaskHeaderTelemetry.myc-chip.test.tsx 12 passed
webview      src/components/chat/task-header/TaskHeaderTelemetry.live-green-dom.test.tsx 5 passed
webview      src/components/chat/task-header/TaskHeader.test.tsx              8 passed
webview      src/components/chat/task-header/taskHeaderTelemetryHelpers.test.ts 45 passed
```

---

## 6. Ablation (one bounded cycle)

Ablation seam: the producer fold inside
`TaskTelemetryTracker.recordToolRuntimeOutcome` — the switch that turns
a typed terminal outcome into `succeeded` / `failed` / `unknown`.

Ablation applied (all three counter increments removed):

```text
FAIL TESOUT-01  expected { succeeded: +0, failed: +0, …(2) } to deeply equal { succeeded: 1, failed: 1, …(2) }
FAIL TESOUT-02  expected +0 to be 3
FAIL TESOUT-04  expected +0 to be 1
FAIL TESOUT-06  expected +0 to be 1
FAIL TESOUT-07  expected +0 to be 1
FAIL TESOUT-08  expected +0 to be 1
Tests  6 failed | 6 passed (12)
```

Correction restored:

```text
Tests  12 passed (12)
```

The load-bearing RED genuinely depends on the producer seam — it is not a
tautological assertion over test-local constants.

---

## 7. Conservation + legacy behaviour

```text
toolCalls                        UNCHANGED by this ACT (same counter, same increments)
mechanism.total === toolCalls    UNCHANGED (V1 contract intact)
succeeded+failed+pending+unknown === toolCalls   (host build + webview validator)
legacy host (no `outcome`)       V1 display unchanged (TESOUTUI-02)
malformed / non-conserving       V1 fallback, NO silent repair (TESOUTUI-03/04)
```

---

## 8. Executable gates

```text
apps/vscode `tsc --noEmit`                → clean (exit 0)
apps/vscode/webview-ui `tsc --noEmit`     → clean (exit 0)
sdk/packages/core `tsc -p tsconfig.dev.json --noEmit`
    → 56 diagnostic lines, IDENTICAL to the stashed baseline (verified by
      stash / pop). None of them are in the changed files
      (hook-file-hooks.ts, session-runtime-orchestrator.ts).
apps/vscode/webview-ui `bun run build`    → exit 0, built in 9.36s
Biome (apps/vscode/biome.jsonc)           → 8 files checked, no findings
Biome (sdk/biome.json)                    → 3 files checked, no findings
```

### Pre-existing failures (NOT regressions)

The `apps/vscode/src/sdk/` vitest sweep has 10 failing files. The failure
set was captured before and after the change (`git stash push -u` →
run → `git stash pop`) and is **identical**:

```text
command-job-manager.sandbox-integration.test.ts            (2 failed)
completion-authority-trace-capture-extension01.test.ts     (2 failed)
host-blocked-outcome-consumer-probe01.hbocp01.test.ts      (1 failed)
continuation-pathological-corpus01.swcm04.test.ts          (11 failed)
host-blocked-outcome-lifecycle-owner01.hbclo01.test.ts     (5 failed)
host-blocked-outcome-publication01.hbop01.test.ts          (8 failed)
darwin-seatbelt-safe-yolo-sensitive-read-confinement01.c2-green.test.ts (11 failed)
sdk-task-history.test.ts                                   (33 failed)
sdk-session-event-coordinator.test.ts                      (2 failed)
vscode-run-commands-tool.background-state.test.ts          (6 failed)
darwin-seatbelt-safe-yolo-network-open01.c1-green.test.ts  (2 failed)
```

Root cause is the sandbox's process restriction
(`EPERM: operation not permitted, kill` / `spawn_failed`), which also
makes the vitest forks-pool teardown abort before the summary is
printed. The one file that appeared only in the post-change run
(`darwin-seatbelt-safe-yolo-network-open01.c1-green.test.ts`) was
verified to fail IDENTICALLY on the stashed baseline in isolation
(`NETWORK_OPEN_FAILED: ... state=spawn_failed`).

### Sandbox notes (environment, not defects)

```text
sdk/packages/agents vitest  → every suite fails to load with
   "TypeError: undefined is not an object (evaluating 'z.object')".
   This is a PRE-EXISTING environment failure: the checked-in
   agent-runtime.outcome-integration.test.ts fails identically on the
   untouched baseline. The ACT's affected suites all live in
   apps/vscode and sdk/packages/core, which run correctly.

apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.js
   (+ .js.map) — a STALE, gitignored, untracked `tsc` build artifact
   (dated Sep 20) that shadowed the TypeScript source in Vite's
   resolution order and made the webview import a helper module
   without `isUsableOutcomeProjection`. It was the ONLY `.js` artifact
   under webview-ui/src and is not regenerated by the current
   `noEmit: true` tsconfig. It was deleted so the TypeScript source is
   the single source of truth. Nothing tracked was touched.
```

---

## 9. Live UI demonstration — UNAVAILABLE

The debug harness (`apps/vscode/src/dev/debug-harness/server.ts`) was
launched with the documented env scrub:

```text
env -u ELECTRON_RUN_AS_NODE -u ELECTRON_NO_ATTACH_CONSOLE -u VSCODE_CLI
    -u VSCODE_CODE_CACHE_PATH -u VSCODE_CRASH_REPORTER_PROCESS_TYPE
    -u VSCODE_CWD -u VSCODE_ESM_ENTRYPOINT -u VSCODE_HANDLES_UNCAUGHT_ERRORS
    -u VSCODE_IPC_HOOK -u VSCODE_NLS_CONFIG -u VSCODE_PID
    -u VSCODE_L10N_BUNDLE_LOCATION
    bun apps/vscode/src/dev/debug-harness/server.ts --auto-launch --skip-build
```

The harness server came up (`Debug harness server listening on
http://localhost:19229`, sourcemap loaded, 8783 source files), but the
Electron host died:

```text
Unhandled rejection (ignored, server stays up): Process failed to launch!
[pid=7002] exception while trying to kill process: SystemError: kill() failed: EPERM
[pid=7002] <process did exit: exitCode=null, signal=SIGSEGV>
```

The BASELINE code (my change stashed, extension rebuilt from the
baseline) fails IDENTICALLY — so the live UI qualification is blocked
by the sandbox's process restriction, not by this ACT.

Consequence: the installed-UI demonstration is an explicit successor.
Per the ACT's §10, a structurally completed production slice is NOT held
for unrelated packaging infrastructure.

---

## 10. Execution conservation

```text
which tools run / when they run        unchanged
approval policy                        unchanged
tool arguments / results                unchanged
cancellation and retry behavior        unchanged
runtime completion authority            unchanged
model calls / reasoning settings       unchanged
ELM task-state ownership                unchanged
MYC accounting                         unchanged
existing model-behavior recorder        unchanged
```

The outcome hook is READ-ONLY by construction: `AgentRuntime
.notifyToolRuntimeOutcome` ignores the hook's return value. The host
observer writes only into the in-memory `TaskTelemetryTracker`; no
diagnostic write happens inside a React functional updater (the
projection is a plain object produced during render).

---

## 11. Commit record

```text
SUBJECT_HEAD = f09a1e25f8a1dfe767dd7e075da7b8f0c96b3689
```
