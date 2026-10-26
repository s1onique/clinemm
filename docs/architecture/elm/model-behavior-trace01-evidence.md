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
| `apps/vscode` `src/sdk/__tests__` (60 of 372 files, per-file) | 10 failures in `background-command-notify-on-terminal01.bcnt01` + related background-command notification files — **all pre-existing**: with this ACT's source files reverted to `b22855b4a` (keeping `node_modules`/`dist` intact) the same file fails the **same 10 of 24** tests with the **same names** |
| TypeScript | `bun run build:sdk` clean; `apps/vscode` `tsc --noEmit` clean |
| Biome lint | clean (root `sdk/` + `apps/vscode` full tree: 2436 files) |
| Biome format | clean on every changed file |
| `git diff --check` | clean |
| Relevant SDK build | `bun run build:sdk` green |

**Environment note:** the sandbox denies `kill(2)` on vitest worker
processes (`EPERM`), so a single large parallel vitest invocation crashes
at teardown before its JSON report flushes — and even a 20-file invocation
is affected. Every suite was therefore run **per-file** with
`--reporter=json --outputFile=…`, which produces the counts quoted above.
This is a harness limitation, not a test failure: the affected logs contain
**zero** `×`/`FAIL` test lines, only teardown `EPERM` errors.

**Baseline methodology.** Pre-existing failures were established by
reverting this ACT's source files to `b22855b4a` **in place** (keeping the
installed `node_modules` and the built `dist`, so the SDK packages resolve
identically) and re-running the same test files. A separate baseline
`git worktree` was tried first and rejected: without the built `dist` it
reports 0 tests, which would silently turn a comparison into a false pass.
The in-place revert is the method that actually exercises the same
resolution path.

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

---

# ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01 — Comparator & Fast-Path Correction

**Status:** `PASS_STRUCTURAL_ONLY` (unchanged closure level)
**Baseline reviewed:** `1006751a6819c19d63a6b1b73cfd7c9ccd4cca5e`
**Priority:** P0 — evidence correctness
**Scope:** one bounded correction. The recorder architecture is NOT reopened.

---

## 1. Why this correction exists

The structural review accepted the recorder but found two source-confirmed
evidence defects in the A/B comparator:

1. `extractConfig()` returned `{}` when a trace contained no `model_config`
   event, and the comparator then substituted `UNAVAILABLE_FROM_TRACE` for
   every missing field. Two equally-missing configurations therefore compared
   EQUAL and produced `compatible: true` — a false positive on exactly the
   case that is easiest to reach (configuration is recorded only during
   `buildSessionConfig()`, and the toggle arms the recorder on an
   already-running session).

2. `acceptedGateCount` was inferred from successful tools whose NAMES
   contained `test`/`vitest`/`build`/`lint`. ClineMM runs shell verification
   through `run_commands`, whose command and results are deliberately NOT
   recorded. A successful `run_commands` could therefore count as zero
   gates, while a tool merely named `run_tests` could count as an accepted
   gate without independent proof of its assertions.

A third issue was found in the production seam: the awaited fingerprint call
inside `AgentRuntime.executePreparedTool()` introduced an extra microtask
suspension point even when the recorder was disabled.

---

## 2. Comparability is now FAIL-CLOSED

`scripts/compare-model-behavior-traces.ts` now computes a three-state result
for every configuration dimension:

| State | Meaning |
|---|---|
| `equal` | Both sides KNOWN and identical. The only state that proves the dimension cannot confound the comparison. |
| `different` | Both sides KNOWN and different. Material. |
| `unverified` | At least one side UNKNOWN. **Two equally-unknown values are NOT a match** — they are equally unknown. |

The comparison is refused (`compatible: false`) when any of these hold:

| Refusal | Code | Why |
|---|---|---|
| No `model_config` snapshot | `missing_model_config` | The configuration is UNKNOWN. |
| More than one DISTINCT snapshot | `ambiguous_model_config` | The trace spans multiple sessions/models. |
| Recorded model does not match the label | `model_attribution_mismatch` | An "M3" trace containing M3.1 events is mislabelled. |
| Multiple runs/sessions, none selected | `multi_run_unscoped` | Activity from several runs must not be aggregated against one snapshot. |
| The selected run is absent | `selected_run_absent` | The scope does not exist. |
| Truncated capture | `truncated_capture` | The counts are LOWER BOUNDS, not exhaustive. |
| A material dimension is `different` | (dimension) | The dimension demonstrably differs. |
| A material dimension is `unverified` | (dimension) | Source/build parity is UNPROVEN. |

The overall verdict is one of:

* `compatible`   — every material dimension is KNOWN and EQUAL, both traces
  are correctly labelled, unambiguous, and complete.
* `incompatible` — a determinate mismatch (different known values, a
  mislabelled trace, an ambiguous trace).
* `inconclusive` — the evidence was insufficient (missing configuration, an
  unverified dimension, a truncated capture).

`compatible: true` is now reachable ONLY from `status === "compatible"`.

### Explicit run scoping

`--m3-run <runId>` / `--m3.1-run <runId>` scope a comparison to one run.
The selected run's configuration snapshot is used, the other runs' records
are excluded from the statistics, and the ambiguity check is evaluated over
the selected run only.

---

## 3. Executable-gate evidence is no longer implied

The `acceptedGateCount` metric has been REMOVED. In its place:

| Metric | Meaning |
|---|---|
| `verificationToolCallCount` | How many tool calls were NAMED like a verification. A **tool-name heuristic**. |
| `verificationToolNameHeuristic` | Always `true` — the metric is explicitly labelled as a heuristic. |
| `acceptedExecutableGates` | Always `UNAVAILABLE_FROM_TRACE`. |
| `toolCallsPerAcceptedGate` | Always `UNAVAILABLE_FROM_TRACE`. |
| `timeToFirstVerificationNamedToolMs` | Time to the first verification-NAMED tool call — NOT a time-to-accepted-gate. |

No raw command arguments are parsed and no test output is collected. A
generic successful `run_commands` event is NOT automatically a successful
test gate, and a tool named `run_tests` is not evidence either.

---

## 4. Tracing-OFF preserves the execution order

`await`ing a promise ALWAYS introduces a microtask suspension point, even
when the awaited value is `undefined`. The fingerprint was awaited on EVERY
tool call, so the disabled recorder changed the execution order between the
tool-start boundary and the tool execution.

The fix:

* `ModelBehaviorTraceSink` gains an optional, synchronous
  `isTraceEnabled?: () => boolean` — a pure read of the recorder's enable
  bit.
* `AgentRuntime.fingerprintToolArguments()` is no longer `async`. It returns
  `undefined` synchronously when tracing is provably OFF, so the call site
  awaits NOTHING and NO suspension point is introduced.
* When `isTraceEnabled()` is ABSENT, the runtime cannot prove tracing is
  off, so it requests the fingerprint exactly as before — the behaviour of
  every pre-existing sink is unchanged.
* The VS Code sink exposes `isTraceEnabled: () => recorder.isEnabled()`.

The recorder remains default-OFF, and the privacy-safe fingerprint is
preserved when tracing is ON.

---

## 5. Witnesses

### Comparator (apps/vscode/src/sdk/__tests__/compare-model-behavior-traces.test.ts)

| ID | Witness |
|---|---|
| C01 | Two traces with NO `model_config` → NOT compatible (the old comparator said `compatible: true`). |
| C02 | An M3-labelled trace containing M3.1 events → model attribution REJECTED. |
| C03 | Two runs with different context ceilings → rejected (unscoped). |
| C03b | The same trace with `--m3-run` → scoped, compatible, and the other run's activity excluded. |
| C04 | Different KNOWN source identities → incompatible (material). |
| C05 | Two fully identified, compatible configurations → compatible. |
| C06 | Accepted executable gates → `UNAVAILABLE_FROM_TRACE`; the old `acceptedGateCount` metric is GONE. |

### Tracing-OFF fast path (sdk/packages/agents/src/agent-runtime.model-behavior-trace.test.ts)

| ID | Witness |
|---|---|
| C07 | Tracing OFF: the fingerprint is NEVER requested, and the tool-start boundary and the tool execution are ADJACENT. |
| C08 | Tracing OFF: the observable order matches a runtime with NO sink at all. |
| C09 | Tracing ON: the fingerprint IS requested and IS recorded on the boundary. |
| C10 | A sink WITHOUT the enablement signal keeps the original (awaited) behavior. |

### Extension-host runtime (apps/vscode/src/sdk/model-behavior-trace-runtime.test.ts)

| ID | Witness |
|---|---|
| C11 | The sink exposes the LIVE enablement signal. |
| C12 | The fingerprint is unavailable while OFF and privacy-safe while ON. |

**Mutation witness:** removing the `isTraceEnabled` fast path from
`AgentRuntime.fingerprintToolArguments` makes C07 FAIL
(`expected [ 'fingerprint', … ] to not include 'fingerprint'`), proving the
witness is load-bearing.

---

## 6. Explicitly NOT established

* The historical 119k MiniMax session is STILL NOT proven to have used the
  `fallback_128k` budget. The fallback-provenance tests establish HOW a
  128k effective budget can arise; the causal claim requires a real trace
  containing `inputBudgetSource: "fallback_128k"`.
* `PASS_LIVE` is NOT claimed. It requires the installed VSIX to capture real
  M3 and M3.1 runs.

## 7. Unchanged

No change to model requests, prompts, compaction policy, loop detection, or
lifecycle authority. The recorder's public schema was NOT expanded — the
only schema change is the OPTIONAL `isTraceEnabled` signal on the sink,
which is a host-side capability probe, not a recorded field.
