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

---

# ACT-CLINEMM-MODEL-BEHAVIOR-LIVE-PREFLIGHT01 — Live Capture

**Status:** `PASS_LIVE_CAPTURE` (capture proven) — comparability NOT achieved
**Reviewed source:** `dca6e08d58e8691f0a5ffc703f3a646b15e410bf`
**Priority:** P0 — the measurement blocker for M3/M3.1 comparison
**Scope:** ONE live preflight. No production behavior was modified.

---

## 1. Disposition

The preflight answers two separate questions, and they have DIFFERENT
answers:

| Question | Answer |
|---|---|
| Does the real flight recorder capture a real model run? | **YES — `PASS_LIVE_CAPTURE`** |
| Can the real capture establish M3/M3.1 comparability? | **NO — 7 of the 8 material dimensions are `unverified`** |

The capture mechanism is **PROVEN LIVE**. The comparability contract is
**NOT met**, and the reason is exactly the source-confirmed contradiction
the review predicted — now measured rather than inferred.

**No further structural review cycle is warranted.** The remaining gap is a
single bounded repair, described in §6.

---

## 2. What was executed, and what was REAL

The preflight drives the **production capture path** in the SDK:

| Component | Real? | Source |
|---|---|---|
| `ModelBehaviorTraceRecorder` (bounded ring, privacy sanitizer, ephemeral HMAC fingerprint key) | **YES** | `sdk/packages/shared/src/runtime/model-behavior-trace.ts` |
| `AgentRuntime` model-request + tool-execution observation call sites | **YES** | `sdk/packages/agents/src/agent-runtime.ts` |
| Provider gateway against the **live OpenRouter API** | **YES** | `sdk/packages/llms/src/providers/gateway.ts` |
| The **real MiniMax M3** model (`minimax/minimax-m3`) | **YES** | OpenRouter |
| The **real MiniMax M3.1** model (`minimax/minimax-m3.1-flash`) | **YES** | OpenRouter |
| Real tool execution by the runtime executor | **YES** | `AgentRuntime.executePreparedTool` |
| `scripts/compare-model-behavior-traces.ts` | **YES** | the production comparator |

Driver: `apps/vscode/src/dev/preflight/live-preflight-model-behavior-trace.ts`.

### What was NOT real, and why

* **The VS Code GUI host.** The recorder's capture path lives entirely in the
  SDK; `apps/vscode/src/sdk/model-behavior-trace-runtime.ts` is a thin
  adapter over the SDK recorder (it owns only the enable bit, the workspace
  flag, and the JSONL file sink). Driving the SDK directly therefore
  exercises the SAME production capture code the GUI toggle arms. The GUI

---

## 3. The live capture (actual records)

Both traces: **7 records, 0 dropped, `truncated: false`**.

```
[1] model_config         boundary=synthesized        run=undefined
[2] model_request_start  boundary=partial_identity   run=run_… iter=1
[3] model_request_finish boundary=partial_identity   run=run_… iter=1
[4] tool_start           boundary=partial_identity   run=run_… iter=1
[5] tool_finish          boundary=partial_identity   run=run_… iter=1
[6] model_request_start  boundary=partial_identity   run=run_… iter=2
[7] model_request_finish boundary=partial_identity   run=run_… iter=2
```

### 3.1 Model identity and event correlation — CONFIRMED

| Fact | M3 | M3.1 |
|---|---|---|
| Recorded model id | `minimax/minimax-m3` | `minimax/minimax-m3.1-flash` |
| Provider | `openrouter` | `openrouter` |
| Run id | `run_hDV2WcNv` | `run_nFiYSsf2` |
| Session id | `preflight-M3-…` | `preflight-M3.1-…` |
| Model attribution vs label | **MATCHES** | **MATCHES** |
| Comparator side status | `ok` | `ok` |

`classifyModelFamily()` correctly classifies `minimax/minimax-m3` as **M3**
and `minimax/minimax-m3.1-flash` as **M3.1**, so the model-attribution
refusal did NOT fire. The label/model binding is real and works.

**Event correlation is real and exact.** The `tool_start` and `tool_finish`
records carry the SAME `toolCallId` and the SAME `argumentFingerprint`:

| | `toolCallId` | `argumentFingerprint` (prefix) |
|---|---|---|
| M3 | `call-61de243d-d433-48cc-8738-0f81eb0d8223` | `d2c7f6797cb3ac0d…` |
| M3.1 | `call_3abac55c9c0a48f5a7d53f1d` | `b195b6294e994962…` |

The tool boundary reports `origin: "model_requested"`,
`executionInvoked: true`, `outcome: "success"`, `outputSizeChars: 24` and
`durationMs: 1`. The `model_request_finish` records report
`finishReason: "tool-calls"` with `toolCallCount: 1` — a real provider
response, and a real tool call, on both models.

### 3.2 The fingerprint is per-trace ephemeral — CONFIRMED

The two traces use the SAME normalized argument (`{"value":"alpha"}`) and
produce **DIFFERENT** fingerprints. This confirms the ephemeral-key
property holds on live data: a dump cannot be used as a cross-trace rainbow
table.

### 3.3 Buffer truncation and dropped records — NONE

| | M3 | M3.1 |
|---|---|---|
| `truncated` | `false` | `false` |
| `droppedCount` | `0` | `0` |
| `totalRecorded` / `retainedCount` | `7` / `7` | `7` / `7` |
| `retainedBytes` | 3581 | 3597 |

The 8,192-record / 4 MiB ring limits were never approached, so the
truncation path is untested at this scale but was NOT engaged.

### 3.4 Effective reasoning configuration — NOT CAPTURED

`reasoningEffort` and `thinkingEnabled` are `UNAVAILABLE_FROM_TRACE` on
BOTH sides. The production path does not record them at the point the
snapshot is taken.

### 3.5 Provider-confirmed model identity — NOT CAPTURED

`providerConfirmedModelId` is `UNAVAILABLE_FROM_TRACE` on both sides. The
provider did not expose a confirmed identity at configuration time. The
model id that IS recorded is the CONFIGURED id, not a provider-confirmed
one. The comparator's informational comparison therefore reports
`runtimeModelId` / `selectedModelId` as `different` — which is EXPECTED and
CORRECT, because that is the intended difference under test.

---

## 4. Measured missing material dimensions

The comparator's verdict on the LIVE traces:

```
compatible = false
comparability.status = "inconclusive"
```

**7 of the 8 material dimensions are `unverified`; the one that resolves
proves the comparator's KNOWN+KNOWN path works on live data:**

| Material dimension | M3 | M3.1 | Result |
|---|---|---|---|
| `extensionVersion` | `4.1.16-5a1c485cb` | `4.1.16-5a1c485cb` | **`equal`** |
| `sourceHead` | `UNAVAILABLE_FROM_TRACE` | `UNAVAILABLE_FROM_TRACE` | `unverified` |
| `userContextCeiling` | `UNAVAILABLE_FROM_TRACE` | `UNAVAILABLE_FROM_TRACE` | `unverified` |
| `reasoningEffort` | `UNAVAILABLE_FROM_TRACE` | `UNAVAILABLE_FROM_TRACE` | `unverified` |
| `thinkingEnabled` | `UNAVAILABLE_FROM_TRACE` | `UNAVAILABLE_FROM_TRACE` | `unverified` |
| `toolCount` | `UNAVAILABLE_FROM_TRACE` | `UNAVAILABLE_FROM_TRACE` | `unverified` |
| `toolNames` | `[]` | `[]` | `unverified` |
| `maxOutputTokens` | `UNAVAILABLE_FROM_TRACE` | `UNAVAILABLE_FROM_TRACE` | `unverified` |

`extensionVersion` is KNOWN on BOTH sides and compares **`equal`**. This is
the decisive control: it proves the comparator's `equal` path is reachable
from a LIVE trace, and that the `unverified` results above are caused by
genuinely-absent data rather than by a broken comparison.

`extensionVersion` is also the ONE material dimension the production path
already populates (`buildSessionConfig()` passes
`ExtensionRegistryInfo.version`), so it is the honest control to use.

The other dimensions that resolve are the informational ones the comparison
is SUPPOSED to see differ: `selectedProviderId` / `runtimeProviderId` are
`equal` (`openrouter`), and `selectedModelId` / `runtimeModelId` are
`different` (the models under test).

The comparator's own warning states the consequence exactly:

> 7 configuration dimension(s) could not be VERIFIED from the trace — "both
> sides unavailable" is NOT evidence that the two sides match.

### 4.1 The measurement blocker, precisely

**`scripts/compare-model-behavior-traces.ts` `MATERIAL_DIMENSIONS` requires
these values to be KNOWN and EQUAL. The production recorder cannot supply
them. Therefore `compatible: true` is UNREACHABLE from any production
trace, regardless of build parity, settings parity, or model behavior.**

This is now MEASURED on live data, not merely source-inferred.

### 4.2 Why the values are missing — at their production authority

| Dimension | Production authority | Why it is absent |
|---|---|---|
| `sourceHead` | `buildSessionConfig()` | passes `sourceHead: undefined` (`cline-session-factory.ts:1256`) |
| `toolCount` | `buildSessionConfig()` | passes `toolCount: undefined` (`cline-session-factory.ts:1255`) |
| `toolNames` | `buildSessionConfig()` | never passed; the adapter defaults it to `[]` |
| `userContextCeiling` | `buildSessionConfig()` | `undefined` when the user has not set an explicit ceiling (Auto) |
| `reasoningEffort` / `thinkingEnabled` | `buildSessionConfig()` | `reasoningConfig` does not always populate them |
| `maxOutputTokens` | `buildSessionConfig()` | `maxTokensPerTurn` is `undefined` unless explicitly configured |
| `extensionVersion` | `buildSessionConfig()` | **SUPPLIED** (`ExtensionRegistryInfo.version`) — resolves to `equal` |

**`extensionVersion` is the control, not a gap.** The production path DOES
supply it, and the live capture confirms it compares `equal`. It proves the
comparator's `equal` verdict is reachable from a live trace, and therefore
that the seven `unverified` results reflect genuinely-absent data rather
than a defective comparison.



---

## 5. Run-scoping — CONFIRMED DEFECT

The reviewer flagged that `scopeRecords()` retains every record with
`runId === undefined`. **The live capture confirms this exactly.**

Measured on the M3 trace with the run id selected:

```
runId=run_hDV2WcNv  total=7  scoped=7
records retained regardless of the selected run:
   seq=1  event=model_config  session=preflight-M3-1793036403155
```

The `model_config` record is the ONLY record with `runId: undefined`, and
it is retained by the scope filter no matter which run is selected. Every
other record (model request + tool events) carries the run id correctly.

**Consequence:** with a multi-session trace, selecting one run still pulls
in the `model_config` snapshot of every session, because that record has no
run id to scope it by. The comparator's `selectConfigValues()` mitigates
this by preferring the snapshot whose `runId` OR `sessionId` matches the
selected run — but a `model_config` record carries only a `sessionId`, so
the match succeeds by session, and the ambiguity check
(`ambiguous_model_config`) is evaluated over the WHOLE trace, not the
selected run.

**This is a real, reproducible scoping defect. It is NOT a live blocker for
this particular comparison** (both traces are single-session, so
`observedRuns.length === 1` and `observedSessions.length === 1` and the
`multi_run_unscoped` refusal does not fire). It becomes a blocker the moment
one dump spans more than one session — which is exactly the real operator
workflow (toggle once, run several tasks, dump once).

**The disposition is deliberately NOT to fix this by chronology.** The
reviewer forbade associating events by chronology, and the correct fix is
to give the `model_config` record the session/run identity it already
implies, so it can be scoped by a correlated identity.

---

## 6. Recommended disposition — ONE bounded repair

The predicted missing fields DID appear. Per the ACT's disposition rule,
open ONE bounded repair that:

1. **Binds source/build identity at the installed artifact manifest.**
   `resolveInstalledBundleIdentity()` already computes
   `extensionBundleSha256` from `<extension-root>/dist/extension.js` and is
   already the LOAD-BEARING identity used by the allocation profiler. That
   is the authority to bind `sourceHead` / `extensionVersion` — NOT a
   `git rev-parse` at runtime, which returns `unknown` in an installed VSIX.
   The VSIX release manifest must record the `SOURCE_HEAD -> bundle
   SHA-256` binding externally, exactly as the allocation-authority work
   already requires.

2. **Captures actual tool configuration at its production authority.** The
   effective tool list is known at the runtime, not at `buildSessionConfig()`
   time — `request.tools.length` is ALREADY recorded on
   `model_request_start` as `toolSchemaCount`. The repair must record the
   tool COUNT and NAMES at the point the tool list is actually assembled,
   so `toolCount` / `toolNames` become KNOWN values.

3. **Scopes `model_config` by a correlated identity** so the
   `model_config` record is attributable to the run/session it describes,
   and the ambiguity check is evaluated over the SELECTED run rather than
   the whole trace.

4. **Records the effective reasoning configuration** (`reasoningEffort`,
   `thinkingEnabled`) and the effective output/context budget
   (`maxOutputTokens`, `userContextCeiling`, `contextWindow`,
   `maxInputTokens`) at their production authorities.

**MUST NOT:** relax fail-closed comparability, fabricate unavailable
metadata, or infer task success / accepted executable gates from tool names.
The `acceptedExecutableGates` / `toolCallsPerAcceptedGate` metrics stay
`UNAVAILABLE_FROM_TRACE` — the live capture confirms the trace does not
record the executed command or its result.

---

## 7. Explicitly NOT established by this preflight

* **`PASS_LIVE` is NOT claimed for the GUI-installed VSIX path.** The
  capture path is proven live; the GUI trigger + file sink were not
  exercised, because Electron cannot launch in this environment (§2).
* **The historical 119k MiniMax session is STILL NOT proven to have used
  the `fallback_128k` budget.** No compaction occurred in either live trace
  (`compactionCount: 0`), so `inputBudgetSource` is not observed live.
* **No claim about which model is "better."** The live statistics are
  descriptive only. Both models made exactly one tool call and terminated
  with `finishReason: "stop"` after one round-trip.
* **Task success is NOT inferred.** The comparator reports
  `acceptedExecutableGates: "UNAVAILABLE_FROM_TRACE"` on both sides, and
  the live traces contain no test command or result.

---

## 8. Live statistics observed (descriptive only)

| Metric | M3 | M3.1 |
|---|---|---|
| `totalToolCalls` | 1 | 1 |
| `exactRepeatedActionCount` | 0 | 0 |
| `nonConsecutiveRepetitionCount` | 0 | 0 |
| `consecutiveErrorStreakMax` | 0 | 0 |
| `repeatedVerificationAttempts` | 0 | 0 |
| `compactionCount` | 0 | 0 |
| `verificationToolCallCount` | 0 | 0 |
| `acceptedExecutableGates` | `UNAVAILABLE_FROM_TRACE` | `UNAVAILABLE_FROM_TRACE` |
| `truncated` / `droppedCount` | `false` / 0 | `false` / 0 |

Observed provider-side request facts (from the live records, NOT from the
comparator's heuristics):

| | M3 | M3.1 |
|---|---|---|
| request 1 `finishReason` | `tool-calls` | `tool-calls` |
| request 1 `inputTokens` / `outputTokens` | 443 / 44 | 458 / 28 |
| request 1 `requestDurationMs` | 1456 | 1142 |
| request 2 `finishReason` | `stop` | `stop` |
| request 2 `inputTokens` / `outputTokens` | 510 / 4 | 508 / 4 |

---

## 9. Files

**New**

---

## 10. Reproducing this preflight

```bash
# 1. Build the SDK packages (the preflight consumes their `dist/`).
bun run build:sdk

# 2. Capture the live traces (real OpenRouter API, real M3 + real M3.1).
cd apps/vscode
bun src/dev/preflight/live-preflight-model-behavior-trace.ts \
  --out /tmp/clinemm-preflight \
  --api-key "$OPENROUTER_API_KEY"

# 3. Run the REAL comparator over the captured traces.
cd ../..
bun scripts/compare-model-behavior-traces.ts \
  --m3  /tmp/clinemm-preflight/trace-M3.jsonl \
  --m3.1 /tmp/clinemm-preflight/trace-M3.1.jsonl \
  --md  /tmp/clinemm-preflight/comparison.md \
  --json /tmp/clinemm-preflight/comparison.json
```

Step 2 is the only step that needs a credential. Steps 1 and 3 are fully
offline.

### Expected output of step 3 (stable across runs)

```
compatible = false
comparability.status = "inconclusive"
comparability.m3.status  = "ok"
comparability.m31.status = "ok"
```

The `comparability.*.status` values are `ok` — the capture itself is sound
and correctly labelled. The `inconclusive` verdict comes from the
configuration-dimension comparison, exactly as tabulated in §4: 7 material
dimensions are `unverified`, and only `extensionVersion` resolves (to
`equal`).


---

## 11. Stability across independent live captures

The preflight was executed THREE times against the live OpenRouter API. The
verdict is identical every time:

| Run | `compatible` | `comparability.status` | material `equal` | material `unverified` | side statuses |
|---|---|---|---|---|---|
| 1 (pre-`extensionVersion` fix) | `false` | `inconclusive` | 0 | 8 | `ok` / `ok` |
| 2 | `false` | `inconclusive` | 1 (`extensionVersion`) | 7 | `ok` / `ok` |
| 3 | `false` | `inconclusive` | 1 (`extensionVersion`) | 7 | `ok` / `ok` |

Runs 2 and 3 are the authoritative measurements (the driver passes
`extensionVersion`, matching production). Run 1 is retained only to show
that the `extensionVersion` control is load-bearing: adding the value the
production path already supplies moved exactly one dimension from
`unverified` to `equal` and changed nothing else.

**The verdict is not a one-off.** Every live capture produced a
`model_config` snapshot with 7 of the 8 material dimensions unavailable,
and the comparator refused the comparison every time.

### A note on the `M3.1` model id

`minimax/minimax-m3.1-flash` is the MiniMax M3.1 model as exposed by
OpenRouter at the time of this preflight. It is **not** in the bundled
`@cline/llms` catalog (`catalog.generated.ts`), which lists M3 but no M3.1
entry. The preflight drives the model id directly through the gateway, so
the capture is unaffected — but a VS Code user picking M3.1 from the model
picker would not find it until the catalog is refreshed. That is a
**catalog freshness** issue, independent of the recorder.

* `apps/vscode/src/dev/preflight/live-preflight-model-behavior-trace.ts` —
  the live preflight driver. It is a DEV-ONLY diagnostic driver; it
  modifies no production behavior and is not part of the extension's
  production path.

**Unchanged**
* No production file was modified. The preflight ran against the code at
  `dca6e08d58e8691f0a5ffc703f3a646b15e410bf` exactly as reviewed.

  host is the trigger and the file sink, not the capture.

  The GUI could not be used in this environment for an INDEPENDENT reason:
  the Electron binary segfaults on launch (`--version` exits 139) for BOTH
  the bundled test VS Code and the system VS Code, while Chromium runs
  normally. That is an environment-level Electron fault, unrelated to this
  ACT, and it is recorded here only so the next reviewer does not re-attempt
  it.

* **The `model_config` snapshot VALUES.** These are written through the
  SAME production adapter (`recordModelBehaviorTraceConfig`) with the SAME
  values `buildSessionConfig()` passes — INCLUDING the values it passes as
  `undefined`. The preflight deliberately does NOT enrich them, because
  the whole point is to MEASURE the production gaps rather than mask them.

which is a host-side capability probe, not a recorded field.
