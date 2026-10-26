# ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01 — Source-Bound Evidence

**Status:** `PASS_STRUCTURAL_ONLY`
**Reviewed source:** `b22855b4a83a958904d9d87c31e4d6c298d355da`
**Priority:** P1 — observability / model qualification
**Scope:** bounded, opt-in, model-agnostic flight recorder + offline A/B comparator.

---

## 1. Objective (as built)

A bounded, opt-in flight recorder that answers:

> When M3.1 appears to loop, is it actually making repeated model decisions,
> encountering runtime failures, losing context, or performing productive work
> that merely requires more calls?

The recorder is **model-agnostic**: no provider- or model-specific branch
exists anywhere in the capture path. The only model-shaped logic is the
tool-name category map (read/search/write/test/command/other), which is a
name classifier and not a model branch.

**Nothing was changed** in: model requests, prompts, tool execution,
compaction policy, lifecycle authority, or loop-detector behavior. Every
capture site is a fire-and-forget observation whose return value is never
read.

---

## 2. Recon — the actual production seams

| Observable | Production seam | Source |
|---|---|---|
| Model request start | `AgentRuntime.generateAssistantMessage` — immediately before the provider stream opens | `sdk/packages/agents/src/agent-runtime.ts` |
| Model request finish | Same method — after the stream ends and the usage delta is known | `sdk/packages/agents/src/agent-runtime.ts` |
| Provider failure / abort | `AgentRuntime.openTaskLifecycleStream` — the real `model.stream(...)` boundary | `sdk/packages/agents/src/agent-runtime.ts` |
| Tool start / finish | `AgentRuntime.executePreparedTool` — the real executor boundary, with `toolExecutionInvoked` as the C1.2 authority | `sdk/packages/agents/src/agent-runtime.ts` |
| Loop-detector verdict | `SessionRuntime.inspectLoopForToolCall` — observes the UNCHANGED `LoopDetectionTracker.inspect()` verdict | `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts` |
| Compaction boundary + budget provenance | `createContextCompactionPrepareTurn` — reuses the existing `Context compaction diagnostics` / `Context compaction completed` log events | `sdk/packages/core/src/extensions/context/compaction.ts` |
| Effective input-budget resolution | `resolveEffectiveMaxInputTokens` → `applyUserContextCeiling` → `DEFAULT_MAX_INPUT_TOKENS` | `sdk/packages/core/src/extensions/context/compaction-shared.ts` |
| Run termination reason | `SessionRuntime.buildLegacyResult` — the production `finishReason` | `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts` |
| SDK logger adapter | `createSdkLogger()` → host `Logger.debug/log/error` | `apps/vscode/src/sdk/cline-session-factory.ts` |
| Command registration | `registry.ts` (`.debug.*` ids), `package.json` (`contributes.commands`), `extension.ts` (`registerCommand`) | `apps/vscode/src/{registry.ts,package.json,extension.ts}` |

### Evidence-boundary classifications

Every record carries an `evidenceBoundary`:

| Value | Meaning |
|---|---|
| `observed` | Directly observed runtime fact with session + task + run identity. |
| `partial_identity` | Some correlation identity was unavailable. |
| `no_identity` | No session/task/run identity — the record cannot be correlated to an execution. |
| `synthesized` | The value was derived (e.g. the config snapshot), not raw. |
| `inferred_budget` | The effective budget was inferred by the production resolver. |

Records are **never** correlated by timestamp alone: every correlation field
is carried explicitly, and an unavailable identity is **omitted**, never
guessed.

---

## 3. Operator interface

| Command | ID | Behavior |
|---|---|---|
| `Cline Debug: Toggle Model Behavior Trace` | `cline.debug.toggleModelBehaviorTrace` | Flips the persisted workspace flag **and** the live recorder bit immediately. Already-running sessions are affected for subsequent events — no extension reload, no task restart. |
| `Cline Debug: Dump Model Behavior Trace` | `cline.debug.dumpModelBehaviorTrace` | Writes `<globalStorageUri>/model-behavior-trace.jsonl`. Unconditional: works after tracing was disabled, and **never clears the evidence**. Reports `NO_CAPTURE` when nothing was recorded. |

**Default OFF in every build.** There is no dogfood/public profile that arms
the recorder — the persisted workspace flag, written only by the toggle
command, is the sole arming path (`apps/vscode/src/sdk/__tests__/model-behavior-trace-command-registration.test.ts`, `CMD01.4`).

---

## 4. Capture schema

JSONL. One record per line; the final line is a `{"kind":"summary"}` object
carrying the truncation metadata, so the dump is self-describing.

### Correlation fields on every record

`timestamp, traceId, sessionId, taskId, runId, iteration, event, providerId, modelId`

### Event kinds

`model_config`, `model_request_start`, `model_request_finish`,
`model_request_error`, `model_request_abort`, `tool_start`, `tool_finish`,
`loop_verdict`, `compaction_diagnostics`, `compaction_completed`,
`run_terminated`.

### Model configuration

Selected / SDK-resolved / provider-confirmed identities are **distinct**.
A provider-confirmed identity is populated only when the provider actually
exposed one — it is never inferred from the request. Omitted/default
provider settings are recorded as `UNAVAILABLE_FROM_TRACE` rather than
guessed.

Recorded: configured provider/model, runtime provider/model, returned
provider model identity, thinking enabled, reasoning effort, temperature,
top-p, max output tokens, context window / max input, user context ceiling,
tool count/names, source HEAD / extension version.

### Request lifecycle

Start/finish, duration, input/output/cache token usage, finish reason,
tool-call count, invalid-tool-call count, provider failures, aborts, and
run-termination reason. Active model/tool time is measured separately from
elapsed wall-clock task age (`requestDurationMs` vs the run's `durationMs`).

### Tool execution

Tool name, category, correlated `toolCallId`, outcome class, duration,
output **size** (never content), execution-invoked flag, skip reason, and
the loop-detector verdict where observable. Model-requested calls are
distinguished from host-control calls via `origin`.

### Context and compaction

The existing structured `Context compaction diagnostics` /
`Context compaction completed` events are reused, with the required
fields: `mode, strategy, modelId, iteration, requestInputTokens,
maxInputTokens, requestTriggerTokens, userContextCeiling, shouldCompact,
tokensBefore, tokensAfter`, plus the new **`inputBudgetSource`**.

`inputBudgetSource` is one of `modelMaxInputTokens | contextWindow |
userCeiling | fallback_128k`, resolved from the **actual inputs** the
production resolver consumed. This is what explains a compaction around
119k in a session displaying a 1M context: the 128k fallback won.

---

## 5. Storage and privacy

* **Bounded ring**: 8,192 records **and** a 4 MiB byte cap (both enforced
  independently). Dropped records are **reported** with count and sequence
  range (`droppedCount`, `droppedFromSeq`, `droppedToSeq`) — an incomplete
  trace is never presented as exhaustive.
* **No disk writes until Dump.**
* **Privacy**: the payload sanitizer structurally drops a denylist of
  content-bearing keys (`command`, `prompt`, `apiKey`, `authorization`,
  `stdout`, `path`, `reasoning`, `text`, `output`, `input`, `env`, …).
  Long strings are reduced to `[STRING:<len>]`.
* **Fingerprints**: an ephemeral per-trace HMAC-SHA256 key. The same
  normalized arguments produce the same fingerprint **within** one trace
  (so repetition is detectable); a different trace produces a different
  fingerprint (so a dump is not a cross-session rainbow table); and the key
  never leaves the recorder, so low-entropy values are not recoverable by
  dictionary attack.
* **Recorder failures never affect execution**: every public entry point
  catches its own errors and degrades to a no-op.
* Instrumentation is outside React functional updaters (no React involved).

---

## 6. Loop and progress analysis

No replacement loop detector was implemented. The production
`LoopDetectionTracker.inspect()` verdict is **observed**, not re-derived.

The offline comparator computes: total tool calls, exact repeated-action
count, non-consecutive repetition, consecutive error streak, repeated
verification attempts, time to first file edit, time to first executable
gate, compactions and repeated actions after compaction, tool calls per
accepted gate, and completion/termination reason.

Every repetition number is reported as a **heuristic**, and the comparator
states explicitly that expected retries, polling, and repeated tests after a
source change are not pathological looping. A lower tool-call count is
explicitly **not** treated as evidence of a better model.

---

## 7. A/B comparator

`scripts/compare-model-behavior-traces.ts --m3 <a.jsonl> --m3.1 <b.jsonl> [--md out.md] [--json out.json]`

Emits a compact Markdown comparison and a machine-readable JSON summary
covering configuration differences, repetition/error statistics, timeline
sections around compactions and suspected loops, and completion/gate
evidence.

A comparison is marked `compatible: false` when the traces differ
materially in **source HEAD**, extension version, user context ceiling,
reasoning effort, thinking mode, tool count/names, or max output tokens —
in those cases a difference cannot be attributed to the model.

---

## 8. Executable witnesses

55 new assertions across four packages, all passing.

| Gate | Assertion | Witness |
|---|---|---|
| T01 | Default OFF produces no records | `sdk/packages/shared/src/runtime/model-behavior-trace.test.ts`; `apps/vscode/src/sdk/model-behavior-trace-runtime.test.ts` |
| T02 | Runtime toggle works without session recreation | same two files |
| T03 | **Real SDK event** produces a correctly correlated trace record | `sdk/packages/agents/src/agent-runtime.model-behavior-trace.test.ts` (real `AgentRuntime` + scripted model) |
| T04 | Tool start/finish match by tool-call identity | agents witness (real runtime) + core orchestrator witness |
| T04b | **MUTATION** — incorrect tool-call correlation is detected | agents witness |
| T05 | Non-consecutive repeated actions remain detectable | shared recorder witness |
| T06 | Expected retries remain distinguishable from model repetition | shared recorder witness |
| T07 | Model/configuration changes are recorded accurately | apps/vscode runtime witness |
| T08 | Missing metadata exposes the 128k fallback | `sdk/packages/core/src/runtime/observability/model-behavior-trace.test.ts` |
| T09 | Existing compaction policy unchanged | core budget-provenance witness (agreement with the production resolver over 10 input combinations) |
| T10 | Existing loop-detector behavior unchanged | `sdk/packages/core/src/runtime/orchestration/session-runtime.model-behavior-trace.test.ts` (real orchestrator + real `LoopDetectionTracker`) |
| T10c | The loop detector is NOT fed when `loopDetection: false` | core orchestrator witness |
| T11 | Dump is bounded, parseable and reports truncation | shared recorder + apps/vscode runtime witnesses |
| T12 | Sensitive content is not recorded | shared recorder + apps/vscode runtime witnesses |
| T13 | Trace ON/OFF produces equivalent execution results | agents witness + core orchestrator witness |
| T14 | Comparator detects material configuration mismatch | `apps/vscode/src/sdk/__tests__/compare-model-behavior-traces.test.ts` (drives the REAL script as a subprocess) |

### Real-path coverage (the ACT's minimum)

* **Real `SessionRuntimeOrchestrator` event path** —
  `sdk/packages/core/src/runtime/orchestration/session-runtime.model-behavior-trace.test.ts`
  drives the production orchestrator with the production
  `LoopDetectionTracker` and the production tool-boundary handling.
* **Actual SDK logger adapter** —
  `apps/vscode/src/sdk/__tests__/model-behavior-trace-command-registration.test.ts`
  (`LOG01.1`–`LOG01.3`) asserts the production `createSdkLogger()` adapter
  forwards `debug`/`log`/`error` to the host logger, that it is the adapter
  handed to the SDK session, and that the compaction diagnostics flow
  through `config.logger?.debug` / `config.logger?.log`.

### Negative / mutation witnesses

1. **Budget provenance** (`core/.../model-behavior-trace.test.ts`):
   - `MUTATION: a drifting production budget breaks the agreement check` —
     mutates the production budget by +1 and proves the agreement assertion
     then fails.
   - `MUTATION: the fallback source is derived, not hard-coded` — the same
     effective budget reached via the model path yields
     `source: "modelMaxInputTokens"`, not `"fallback_128k"`, proving the
     source is derived from the inputs.
2. **Tool-call correlation** (`agents/.../model-behavior-trace.test.ts`):
   `T04b` mutates the finish boundary's `toolCallId` and proves the
   correlation assertion then fails.

---

## 9. Verification

| Check | Result |
|---|---|
| New focused tracer tests | **55 passed** (shared 13, agents 5, core 15, apps/vscode 22) |
| Adjacent orchestrator tests | `session-runtime-orchestrator.test.ts` 62/62, `runtime-event-adapter.test.ts` 42/42, `session-runtime.subscribe-runtime-events.e2f-f1.test.ts` 9/9, `runtime-prepare-turn-w-strip` 2/2 |
| Adjacent compaction / safety tests | `compaction.test.ts` 94/94, `compaction.real-producer-seam-red.test.ts` 1/1, `mistake-tracker.test.ts` 11/11 |
| `@cline/agents` full suite | **203/203 passed** |
| `@cline/shared` full suite | 240 passed / 10 failed — **all 10 pre-existing** (`createTool` zod-schema tests; verified identical failure with this ACT's changes stashed) |
| TypeScript | `bun run build:sdk` clean; `apps/vscode` `tsc --noEmit` clean |
| Biome lint | clean (root `sdk/` + `apps/vscode` full tree: 2436 files) |
| Biome format | clean on every changed file |
| `git diff --check` | clean |
| Relevant SDK build | `bun run build:sdk` green |

**Environment note:** the sandbox denies `kill(2)` on vitest worker
processes (`EPERM`), so a single large parallel vitest invocation crashes
at teardown before its JSON report flushes. Every suite was therefore run
per-file (or in small batches) with `--reporter=json --outputFile=…`, which
produces the counts quoted above. This is a harness limitation, not a test
failure.

---

## 10. Explicit limitations and non-observable facts

These are classified rather than guessed, per the ACT's "if any required
event is not observable without changing public SDK/protocol interfaces,
classify it explicitly" requirement.

1. **Provider-confirmed model identity** — not exposed by the provider
   APIs at configuration time. Recorded as `UNAVAILABLE_FROM_TRACE`; it is
   never invented.
2. **First-token latency** — the SDK captures a first-chunk lifecycle
   event, but the ACT's schema does not require it and the recorder does
   not add a speculative field. Request duration and output throughput are
   measurable from the recorded start/finish pair.
3. **Per-tool output error classification beyond `error`** — the runtime
   exposes `isError` and the skip reason, not a richer taxonomy. The
   recorder records what exists: outcome class, execution-invoked flag,
   skip reason, and output size.
4. **Runtime-generated vs host-control tool origin** — the `AgentRuntime`
   distinguishes locally-executed tools from provider-executed ones via
   `toolCall.execution`. The recorder captures that. A finer
   "host-control call" class is not observable at the agent-runtime seam;
   it is recorded as `origin: "model_requested"` only for the calls the
   agent runtime executes.
5. **Tool count at session creation** — the effective tool set is composed
   by the SDK runtime builder (tool presets + MCP tools + extensions) after
   `buildSessionConfig` returns. The config snapshot records
   `toolCount: UNAVAILABLE_FROM_TRACE` rather than a pre-runtime guess.
6. **Source HEAD at runtime** — the extension has no reliable runtime
   notion of the checkout HEAD. The config snapshot records the extension
   version and leaves `sourceHead` as `UNAVAILABLE_FROM_TRACE`; the
   comparator reads `sourceHead` from the dump, so an operator may
   annotate it, and a mismatch there is flagged as material.

---

## 11. Closure

* `PASS_STRUCTURAL_ONLY` — all executable gates pass, the recorder is
  default OFF, and no model settings or loop prevention were modified.
* `PASS_LIVE` is **not** claimed: it requires the newly installed VSIX to
  capture real M3 and M3.1 runs, which this environment cannot perform
  (no live provider credentials / VS Code host).

### Files

**New**
* `sdk/packages/shared/src/runtime/model-behavior-trace.ts`
* `sdk/packages/shared/src/runtime/model-behavior-trace.test.ts`
* `sdk/packages/core/src/runtime/observability/model-behavior-trace.ts`
* `sdk/packages/core/src/runtime/observability/model-behavior-trace.test.ts`
* `sdk/packages/agents/src/agent-runtime.model-behavior-trace.test.ts`
* `sdk/packages/core/src/runtime/orchestration/session-runtime.model-behavior-trace.test.ts`
* `apps/vscode/src/sdk/model-behavior-trace-runtime.ts`
* `apps/vscode/src/sdk/model-behavior-trace-runtime.test.ts`
* `apps/vscode/src/sdk/__tests__/model-behavior-trace-command-registration.test.ts`
* `apps/vscode/src/sdk/__tests__/compare-model-behavior-traces.test.ts`
* `scripts/compare-model-behavior-traces.ts`

**Modified**
* `sdk/packages/shared/src/{index.ts,agent.ts,agents/types.ts}` — export the
  recorder + sink; add the optional sink to `AgentConfig` /
  `AgentRuntimeConfig`.
* `sdk/packages/agents/src/agent-runtime.ts` — observation call sites at the
  real request / tool boundaries.
* `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts`
  — loop-verdict + run-termination observation.
* `sdk/packages/core/src/extensions/context/compaction.ts` — compaction
  boundary observation with budget provenance.
* `sdk/packages/core/src/runtime/config/agent-runtime-config-builder.ts` —
  forward the sink.
* `sdk/packages/core/src/types/config.ts` — optional sink on
  `CoreSessionConfig`.
* `sdk/packages/core/vitest.config.ts` — pre-bundle zod (the shared barrel
  evaluates `z.object(...)` at module scope).
* `apps/vscode/src/{registry.ts,package.json,extension.ts}` — the two debug
  commands.
* `apps/vscode/src/sdk/{cline-session-factory.ts,vscode-session-host.ts}` —
  attach the sink; record the model config snapshot at session creation.
* `apps/vscode/biome.jsonc` — exclude the new diagnostic runtime from the
  `use-cache-service` grit rule (matching the sibling diagnostic runtimes).
