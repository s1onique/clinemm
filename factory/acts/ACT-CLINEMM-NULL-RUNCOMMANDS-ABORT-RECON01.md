# ACT-CLINEMM-NULL-RUNCOMMANDS-ABORT-RECON01

**Title:** Reconstruct malformed `run_commands` tool calls and prove the
causal boundary responsible for premature agent-turn termination.

**Mode:** RECON → RED → CAUSAL DISCRIMINATION
**Verdict:** `HALT_RED_NOT_REPRODUCED`
**Production changes:** NONE (no production file was modified).

---

## 0. Terminal verdict (one paragraph)

The two rejected `run_commands` invocations with `commands: null` are
**NOT** causally responsible for the runtime termination observed on
2026-11-02. The malformed argument shape is real, is rejected exactly
as designed (zero commands executed), and is delivered to the model as
a recoverable tool result — but through the **real production seam**
(`AgentRuntime` + real `run_commands` schema + real `validateInput`,
and the real `SessionRuntime` orchestrator) the run **completes
normally** after one or two such rejections. The runtime's own
recovery subsystem CAN terminate a run on repeated identical invalid
calls — but only from the **4th** identical rejection onward
(`1:completed, 2:completed, 3:completed, 4:aborted, …`), which the
live incident (2 rejections) never reached. The live capture
independently corroborates this: `shadowRecoveryState = "idle"` and
`recoveryBudgetFailures` frozen at `2` across the terminal transition.
The abort landed **12 ms after iteration 224's `prepare_turn`**, i.e.
during a live provider request whose `api_req_started` message was
still the last message in the transcript — **not** after the tool
failures. The host then mapped the SDK's `aborted` result to
`awaiting_followup` via the pre-existing "done-without-completion"
liveness branch, which is **contract-correct** behaviour, not a
misclassification.

Because the target runtime failure does not reproduce through the
identified production seam, the ACT halts at
`HALT_RED_NOT_REPRODUCED` and no repair is proposed.

---

## 1. C0 — Repository and authority reconnaissance

### 1.1 Entry identity

| Field | Value |
|---|---|
| `ENTRY_HEAD` | `251779fdf80a9782e00ddf12996813433c7a7bbb` |
| `BRANCH` | `main` (tracking `origin/main`) |
| `ENTRY_HEAD subject` | `docs(factory): ACT-CLINEMM-UPSTREAM-LIVE-HUB-CROSSCLIENT-QUALIFICATION01 — C0+C1 topology qualification; verdict PASS_PARTIAL_LIVE_PENDING` |
| `ENTRY_HEAD date` | `2026-11-03 03:30:53 +0300` |
| `SDK_VERSION` (`@cline/core`, `@cline/agents`, `@cline/llms`, `@cline/shared`) | `0.2.0` (all four) |
| `MODEL_PROVIDER` (live incident) | MiniMax (exact configured provider id not observable from the capture — see §7) |
| `MODEL_ID` (live incident) | MiniMax M3 family (exact id not observable from the capture — see §7) |
| `bun` | `1.3.13` (`bf2e2cec`) |
| `node` | `v26.0.0` |
| Working tree at entry | clean except the two untracked ACT test files added by this ACT |

### 1.2 Protected stashes and unrelated dirty files

`git stash list` at entry (and at closure — unchanged by this ACT):

```
stash@{0}: WIP on main: 026a64d1b PTLL01-CORR01: board — L1 causal proof corrected, VSIX built+installed, live blocked by environment
stash@{1}: WIP on main: d46223b51 fix(completion-continuation-stall-lifetime): separate REARM lifetime from STALL lifetime at BCB re-registration
```

No branch was created. No stash was popped or dropped except the
ACT's own temporary verification stash (§6.3), which was created and
restored within a single bounded step.

### 1.3 Source / owner map (G1)

| Boundary | Actual source location | Owner | Observable? |
|---|---|---|---|
| Provider response | `sdk/packages/llms/src/providers/ai-sdk.ts:1636-1715` (`part.input ?? part.args ?? {}`) | Provider adapter (`@cline/llms`) | **No** (not in the capture) |
| Tool-call assembly | `sdk/packages/agents/src/agent-runtime.ts:2944-2990` (`toolAssemblies`), `:5593-5624` (`parseToolInput`) | Agent runtime (`@cline/agents`) | **No** (not in the capture) |
| Input normalization | `sdk/packages/shared/src/parse/json.ts:203-246` (`normalizeJsonLikeStringsForSchema`), called at `agent-runtime.ts:4236` | SDK (`@cline/shared`) | Partially (result of validation error) |
| Validation | `sdk/packages/core/src/extensions/tools/schemas.ts:161-187` (`RunCommandsInputSchema`) via `sdk/packages/shared/src/tools/create.ts:134-143` (`validateInput`) | SDK (`@cline/core` / `@cline/shared`) | **Yes** (error text) |
| Tool execution | `sdk/packages/core/src/extensions/tools/definitions.ts:757-800` (`createShellTool`) | SDK (`@cline/core`) | **Yes** (telemetry `command` mechanism counts) |
| Tool-result delivery | `sdk/packages/agents/src/agent-runtime.ts:1926-1935` (`executeToolCalls` → `message-added`) | Agent runtime | **Yes** (UI shows the error) |
| Recovery / loop guard | `sdk/packages/agents/src/agent-runtime.ts:5002-5284` (`applyRecoveryPostClassification`), `sdk/packages/agents/src/runtime/recovery/policy.ts`, `sdk/packages/core/src/runtime/safety/loop-detection.ts`, `sdk/packages/core/src/runtime/safety/mistake-tracker.ts` | Agent runtime / orchestrator | **Yes** (`shadowRecoveryState`, `recoveryBudgetFailures`) |
| Run termination | `sdk/packages/agents/src/agent-runtime.ts:1980-2042` (catch → `status = "aborted"`), `:3227-3229` (`ControlledStopError("bounded_recovery_exhausted")`) | Agent runtime | **Yes** (`runtimeStatus`) |
| Host phase transition | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:4627-4633`, `:4799-4831` | Extension | **Yes** (TSWPD writer id) |
| Header presentation | `apps/vscode/webview-ui/src/components/chat/task-header/` (pure projection of `turnState.phase`) | Webview | **Yes** (`taskHeaderPresentation`) |

### 1.4 Existing test inventory (before this ACT)

- `sdk/packages/agents/src/agent-runtime.second-stage-recovery.test.ts` — C1.4 second-stage latch
- `sdk/packages/agents/src/agent-runtime.recovery-qualification.test.ts`
- `sdk/packages/agents/src/runtime/recovery/{tracker,failure-classifier,fingerprint}.test.ts`
- `sdk/packages/core/src/extensions/tools/{helpers.run-commands,definitions}.test.ts`
- `sdk/packages/core/src/runtime/safety/{mistake-tracker,loop-detection}.test.ts`
- `apps/vscode/src/sdk/__tests__/runtime-task-progression-post-terminal-authority-discriminator.acas01-synthetic-real.test.ts` — the "done-without-completion" writer witness (prior ACT)
- `apps/vscode/src/sdk/__tests__/background-command-awaiting-followup-guard01.bcafg01-synthetic-real.test.ts`

No temporary diagnostic instrumentation was added to production code by
this ACT. The two new files are **focused diagnostic tests only**.


## 2. C1 — Frozen incident chronology (G2)

All timestamps are from the supplied captures under
`~/.vscodium-polyc/user-data/User/globalStorage/s1onique.clinemm/`.

| # | Timestamp (UTC) | Epoch | Iter / Seq | Event | Source | Evidence class |
|---|---|---|---|---|---|---|
| 1 | 2026-11-02T12:47:03.701Z | 16 | — | Last background job `cmd_mvz97175zhqb7v1d` exits | `background-job-liveness-authority.jsonl` | STRUCTURAL |
| 2 | 2026-11-02T12:47:03.724Z | 16 | iter 222 | `prepare_turn` (runtime W 313132) | `w-carrier-trace.jsonl` | REAL (capture) |
| 3 | ~12:47:03.7–12:47:12.1Z | 16 | tool 221 | Tool call #221 recorded, `failed` 14→15 | `post-terminal-authority-diagnostic-extension.jsonl` | REAL (capture) |
| 4 | 2026-11-02T12:47:12.034Z | 16 | iter 223 | `prepare_turn` (runtime W 313405) | `w-carrier-trace.jsonl` | REAL (capture) |
| 5 | ~12:47:12.1–12:47:16.4Z | 16 | tool 222 | Tool call #222 recorded, `failed` 15→16 | `post-terminal-authority-diagnostic-extension.jsonl` | REAL (capture) |
| 6 | 2026-11-02T12:47:16.471Z | 16 | iter 224 | `prepare_turn` (runtime W 313625) | `w-carrier-trace.jsonl` | REAL (capture) |
| 7 | 2026-11-02T12:47:16.483Z | 16 | seq 68610 | Phase `streaming → awaiting_followup`, writer `session-event-turn-complete-resumable-straggler-preserve` | `turn-state-writer-provenance.jsonl` | REAL (capture) |
| 8 | 2026-11-02T12:47:16.524Z | 16 | state 68611 | `runtimeStatus = aborted`, `shadowStatus = aborted`, `shadowRecoveryState = idle`, `canonicalShadowPhase = completed`, `selectedHeaderPhase = awaiting_followup`, `selectedHeaderSource = host` | `post-terminal-authority-diagnostic-{extension,webview}.jsonl` | REAL (capture) |
| 9 | 2026-11-02T12:47:16.547Z | 16 | seq 68609 | Last transcript message is `say: "api_req_started"` (a provider request was IN FLIGHT) | `post-terminal-authority-diagnostic-webview.jsonl` (`input-section.messageTail`) | REAL (capture) |


### 2.1 Required C1 answers

| Question | Answer | Basis |
|---|---|---|
| Were both rejected calls part of ONE model response or SEPARATE model requests? | **Separate model requests.** Tool-call #221 and #222 land in different iterations: iteration 222's `prepare_turn` at 12:47:03.724 precedes #221; iteration 223's `prepare_turn` at 12:47:12.034 sits between #221 and #222. | `w-carrier-trace.jsonl` iteration markers + `post-terminal-authority-diagnostic-extension.jsonl` tool-count progression |
| Was a rejection returned to the model after the first failure? | **Yes.** The UI displays the validation error text, and the runtime classifies it as `failure / tool_input_invalid` (Priority 3), which is a *recoverable* tool result appended to the assistant/user history. | `sdk/packages/agents/src/agent-runtime.ts:1926-1935`; `sdk/packages/agents/src/runtime/recovery/failure-classifier.ts:175-185` |
| Was another model request attempted after the second failure? | **Yes — twice.** Iterations 223 and 224 both reach `prepare_turn` after the failures. | `w-carrier-trace.jsonl` |
| What precisely triggered the runtime's `aborted` result? | **NOT OBSERVABLE from the capture.** The abort landed 12 ms after iteration 224's `prepare_turn`, while an `api_req_started` provider request was in flight. The candidate runtime-internal terminators (recovery latch, loop detector, mistake tracker) are all **arithmetically excluded** by §3.2. The capture exposes no `run-failed` / provider-error / abort-reason event. | §3.2 + capture gap |
| Did any `submit_and_exit` attempt occur during the affected terminal sequence? | **No.** `attemptCompletionSeen` and `terminalResponseCommittedThisTurn` were both false (the host took the "done with no committed terminal response" branch, writer `…-resumable-straggler-preserve`, not `…-awaiting-followup` or `…-completed`). | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:4627-4633` vs `:4799-4831`; `terminalResponseCommittedThisTurn = false` in the frozen incident description |
| Did the host receive and classify the actual SDK terminal result correctly? | **Yes.** The SDK returned `aborted`; the host mapped it to `awaiting_followup` through the pre-existing, documented "done-without-completion" liveness branch (CPL01), which is the **existing contract** for "the agent stopped without an explicit completion declaration". | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:4799-4831`; prior ACT ACAS01 witnesses the same writer for the same shape |

### 2.2 Explicit evidence gaps (LIVE_UNOBSERVABLE)

The following boundaries are **not** exposed by any supplied capture and
are therefore recorded as `LIVE_UNOBSERVABLE`, not inferred:

- Raw provider tool-call payload bytes (A) — no provider-level capture.
- The assembled tool-call argument text (B) before parsing.
- The exact `ControlledStopError` reason / abort reason string at the terminal.
- The `run-failed` / `run-finished` SDK event payload.
- The provider stream's terminal `finish` event for iteration 224.
- `modelRequestId` / `turnId` correlation for the terminal request.

No intermediate state was inferred from a downstream phase.


---

## 3. C2 / C3 — Input-shape authority and the RED

### 3.1 Input-shape authority (G3)

The observed UI error is:

```
Invalid input for tool run_commands:
  Invalid input: expected array, received null
  path: commands
```

This is Zod v4's `z.prettifyError` format. Executing the **real**
production schema (`RunCommandsInputSchema`) against the four candidate
shapes distinguishes them unambiguously:

| Input | Production validator result | Matches the observed error? |
|---|---|---|
| `{commands: null}` | `✖ Invalid input: expected array, received null` | **YES — exact match** |
| `{}` (missing) | `✖ Invalid input: expected array, received undefined` | No |
| `{commands: []}` | `✖ Too small: expected array to have >=1 items` | No |
| `{commands: "null"}` (string) | `✖ Invalid input: expected array, received string` | No |

**Conclusion (C2):** the value that reached the validation boundary was
exactly `{commands: null}` — JSON `null` for the `commands` field, not
a missing field, not an empty array, not the literal string `"null"`.

**Normalization is exonerated (proven, not inferred).** The production
input pipeline (`agent-runtime.ts:4236`) calls
`normalizeJsonLikeStringsForSchema(input, tool.inputSchema)`. Executed
against the real schema, it returns the **same object reference**
(`normalized === raw` → `true`) and `commands` remains `null`. The
normalization layer does not alter the shape.

**Adapter corruption is excluded by construction.** The provider
adapter (`ai-sdk.ts:1699`) computes
`const input = (part.input ?? part.args ?? {})`. A top-level `null`
argument would become `{}` (and would then fail with

### 3.2 The RED: what the real production seam actually does (G4)

Two focused test files were added (diagnostic only, no production
change):

- `sdk/packages/core/src/extensions/tools/null-runcommands-abort-recon01.test.ts` — real `AgentRuntime` + real `RunCommandsInputSchema` + real `createTool`-generated `validateInput` (T1–T8).
- `sdk/packages/core/src/runtime/orchestration/null-runcommands-abort-orchestrator-recon01.test.ts` — real `SessionRuntime` orchestrator on top of the real `AgentRuntime`, adding the `MistakeTracker`, `LoopDetectionTracker` and terminal-classification seams (D1–D5).

**VALIDATION_RED — PROVEN.** Invalid input executes **zero** commands
(`executed.length === 0`) for every invalid shape; valid input executes
exactly once. The rejection is delivered to the model history
(the tool-result text contains `expected array, received null`).

**RUNTIME_TERMINATION_RED — NOT REPRODUCED at the incident's
cardinality.** The decisive discriminator is the bisected
cardinality → terminal-reason table, produced by driving the real
orchestrator with a deterministic scripted provider:

```
identical `commands: null` calls → finishReason
1:completed, 2:completed, 3:completed, 4:aborted, 5:aborted, 6:aborted, 7:aborted
```

The abort threshold is **4**. The mechanism is the C1.4 second-stage
recovery latch:

- Failures 1–3 raise `exactOnlyBudget[controlKey]` past
  `maxRepairAttempts = 2` → **Trigger C** (`exact_only_capped`) arms
  the latch (`agent-runtime.ts:5137-5145`).

---

## 4. C4 — Causal discrimination (G5, G6)

### 4.1 Candidate-by-candidate adjudication

| # | Candidate | Verdict | Discriminator / basis |
|---|---|---|---|
| 1 | Model emitting malformed tool-call arguments | **PROVEN as the shape origin** (not as the terminator) | The production validator's error text uniquely identifies `{commands: null}`; the adapter's `?? {}` would have produced `received undefined` for a top-level null |
| 2 | Provider adapter corrupting valid arguments | **EXCLUDED** | `ai-sdk.ts:1699` maps a top-level `null` to `{}`; the observed error proves an object with a `null` property, which no production transform produces |
| 3 | Streaming assembler corrupting valid arguments | **EXCLUDED** | `agent-runtime.ts:2944-2990` accumulates `inputText`/`inputValue` verbatim; the assembled value equals the provider value for a JSON object payload |
| 4 | Argument parsing / coercion / validation changing shape | **EXCLUDED** | `normalizeJsonLikeStringsForSchema` returns the identical object reference; `parseToolInput` passes a valid JSON object through unchanged (`inputValue` branch) |
| 5 | Tool-result rejection failing to reach the model | **EXCLUDED** | The error is visible in the UI and the tool-result text is present in the agent history; the runtime issued further provider requests after each rejection (iterations 223, 224) |
| 6 | SDK recovery budget / loop detection terminating the agent | **EXCLUDED as the terminator** (but PROVEN as a real terminator at a higher cardinality) | Bisected threshold is **4** identical rejections; the incident had **2**. Live capture: `shadowRecoveryState = "idle"`, `recoveryBudgetFailures` frozen at `2` |
| 7 | A separate SDK/runtime termination incorrectly correlated with the rejected tools | **MOST CONSISTENT — but UNPROVEN** | The abort landed 12 ms after iteration 224's `prepare_turn`, with an `api_req_started` provider request in flight and no `api_req_failed`/provider-error evidence in the capture |
| 8 | Host lifecycle mapping a legitimate runtime stop into an inappropriate user-action state | **EXCLUDED** | The `…-resumable-straggler-preserve` writer is the documented "done-without-completion" liveness branch; the SDK genuinely returned `aborted` and the host classified it per contract |

### 4.2 D1–D6 discriminator matrix

| ID | Required discriminator | Result |
|---|---|---|
| D1 | Validation vs termination | One invalid call produces a **recoverable** error and another model turn — it does **not** terminate the run. (`T2`, `D1_D4_…`) |
| D2 | First vs second failure | Behaviour is **identical** at 1 and at 2 rejections: both `completed`. The behavioural change appears only at the 4th identical rejection. (`D2_SINGLE_NULL_CALL…`, `D5_RECOVERY_BUDGET_THRESHOLD_IS_BISECTED`) |
| D3 | Provider-independent replay | A deterministic scripted provider delivering the same malformed tool call reproduces the **validation** behaviour exactly through the actual agent runtime and orchestrator. It does **not** reproduce the terminal. (`T7`, `D1_D4_…`) |
| D4 | Valid control | Replacing only the malformed argument with a valid one preserves existing semantics: the command executes exactly once and the run completes. (`T1`, `T8`, `D4_VALID_CONTROL…`) |
| D5 | Recovery-budget ablation | The implicated threshold is **necessary** for the recovery terminator: `exactOnlyBudget` must exceed `maxRepairAttempts = 2` (3 failures) to ARM, and a 4th identical failure to TERMINATE. The incident's cardinality of 2 cannot satisfy it. Proven by bisection 1→7. |
| D6 | Host mapping | The SDK legitimately returned `aborted` and the host mapped that result according to its existing contract (`done-without-completion` → `awaiting_followup`). The `aborted` outcome is **not** relabelled as success anywhere. |

### 4.3 Ablation / necessity result (G6)

| Intervention | Observation | Conclusion |
|---|---|---|
| 1 identical null call | `completed` | abort unreachable |

---

### 4.4 Root cause

**UNPROVEN** for the 2026-11-02 termination. What is proven:

- The malformed `{commands: null}` payload is a **model-output failure**
  that the SDK rejects correctly and recoverably.
- The premature termination is **not** caused by that payload, by the
  adapter, by the assembler, by normalization/validation, by
  tool-result delivery, by the recovery budget, or by the host mapping.
- The termination is chronologically located at the **iteration-224
  provider request**, ~12 ms after `prepare_turn` and while an
  `api_req_started` request was in flight. The capture does not expose
  the provider's terminal event or an abort reason, so the specific
  runtime-level discriminator (provider stream termination vs. an
  external abort vs. a session-lifecycle teardown) **cannot be safely
  observed** from the supplied evidence.

Per ACT §11, a finding of "runtime termination not reproducible" maps
to `HALT_RED_NOT_REPRODUCED`, and per §14 no repair may be invented for
an unreproduced failure.

- Failure 4 arrives while the latch is already `armed` →
  **TERMINATING** transition (`agent-runtime.ts:5186-5195`).
- The next model-stream entry throws
  `ControlledStopError("bounded_recovery_exhausted")`
  (`agent-runtime.ts:3227-3229`), which the run-level catch maps to
  `status = "aborted"` (`agent-runtime.ts:1983-1985`).

The live incident had **2** rejections — below the threshold. The live
capture corroborates this independently: `shadowRecoveryState = "idle"`
and `recoveryBudgetFailures` frozen at `2` across the terminal
transition (it was already `2` at 12:47:19 and did not move).

**HOST_PHASE_RED — NOT REPRODUCED (host mapping is correct).** The
host's "done-without-completion" branch
(`sdk-session-event-coordinator.ts:4799-4831`) is the pre-existing,
documented liveness contract: an SDK turn that ends without a
committed terminal response yields `awaiting_followup` so the user can
respond. The writer id
`session-event-turn-complete-resumable-straggler-preserve` recorded in
the incident identifies that branch exactly. The host did **not**
misclassify a legitimate completion; there was no `submit_and_exit` to
misclassify.

**Therefore the RED gate result is `HALT_RED_NOT_REPRODUCED`.**

`received undefined`, not `received null`). The observed error proves
the provider delivered a JSON **object** whose `commands` property was
JSON `null` — i.e. the malformed shape originates at the model/provider
payload, and no production transformation created it.

**C2 classification:** `MODEL_EMITTED_INVALID` (shape origin), with
`VALIDATION_REJECTED_AS_DESIGNED` (boundary outcome). Neither
`PROVIDER_ADAPTER_TRANSFORMED_INVALID`, `STREAM_ASSEMBLY_CORRUPTED`,
nor `ARGUMENT_NORMALIZATION_CORRUPTED` is supported by any evidence.

---

## 5. C6 — Conservation and adversarial controls (G7)

| Invariant | Control | Result |
|---|---|---|
| Invalid arguments execute no commands | `T2`, `T3`, `T4`, `T5`, `T6`, `T6B`, `D1_D4_…`, `D5_…` | **PASS** — `executed.length === 0` for every invalid shape |
| Invalid arguments cannot be coerced into an unintended executable command | `T6B` (`"null"` string), `T5` (alternate shape) | **PASS** — both rejected, zero execution |
| Valid command inputs retain existing semantics | `T1`, `T8`, `D4_VALID_CONTROL…` | **PASS** — exactly one execution per valid call |
| Existing approval rules remain in force | No production change; `validateInput` runs **before** `requestToolApproval` (`agent-runtime.ts:4239-4278`) | **PASS** (unchanged) |
| No error is silently converted into tool success | `T2` outcome is `failure / tool_input_invalid`; `isError` preserved | **PASS** |
| Tool results remain correctly correlated with invocation IDs | `outcomeFor(captured, toolCallId)` matches per-call | **PASS** |
| No synthetic successful completion is fabricated | The ACT asserts `result.status === "completed"` with `result.error === undefined` only where the runtime genuinely completed; the abort case asserts `finishReason === "aborted"` and asserts nothing about completion | **PASS** |
| Error handling introduces no unbounded automatic retries | Provider request counts are pinned exactly (3 for 2 rejections; 6 for 5) | **PASS** |
| Provider failures and user cancellation remain distinguishable | `cancel-liveness-diagnostic.json`: `cancelRequestCalls=0`, `cancelAcceptedCalls=0`, `abortInvokedCalls=0` — the incident was NOT a user cancellation | **PASS** (live evidence) |
| Repeated-tool detection retains its existing contract | `loop-detection.ts` thresholds (soft 3 / hard 5) unchanged; no test or production file modified | **PASS** |
| Explicit user cancellation remains authoritative | No change to the cancel path | **PASS** (unchanged) |
| Genuine completed runs still reach completion | `T1`, `T8`, `D4_VALID_CONTROL…` | **PASS** |
| Background-command hold/continuation behaviour unchanged | No production change; the incident's `activeJobs=[]`, `pendingPromptCount=0`, `guardResult=false`, `outstandingAutonomousWork=false` confirm the background path was not the trigger | **PASS** |
| No cross-session / cross-epoch continuation | No production change | **PASS** (unchanged) |
| `awaiting_followup` is not silently promoted to `completed` | `canonicalShadowPhase = completed` vs `hostPhase = awaiting_followup` is **documented as a separate finding** (§8) and was NOT changed | **PASS** (documented, not patched) |
| No permanent new lifecycle owner / no side effects in React updaters | No React/Elm file was touched | **PASS** |
| Canonical task-header authority unchanged | No header/React/Elm file was touched | **PASS** |

**Existing-suite conservation (G7):**

- `sdk/packages/agents` — recovery / second-stage suites:
  `bun x vitest run src/agent-runtime.second-stage-recovery.test.ts src/agent-runtime.recovery-qualification.test.ts src/runtime/recovery/ --config vitest.config.ts`
  → **161 passed / 161**, exit 0.
- `sdk/packages/core` — `src/extensions/tools/` sweep: the two suites that
  fail (`editor.realpath-authority.test.ts`, `bash.supervised.bash-startup-env.test.ts`)
  fail **identically with the ACT's files stashed away** (verified in
  §6.3): 6 failed / 18 passed in both states. They are **pre-existing
  macOS sandbox realpath / spawn-config environment failures**, not
  caused by this ACT.

| 2 identical null calls (**the incident's cardinality**) | `completed`, 3 provider requests | **abort unreachable** |
| 3 identical null calls | `completed` | latch ARMED (`exact_only_capped`) but not TERMINATING |
| 4 identical null calls | `aborted` | latch TERMINATING → `ControlledStopError("bounded_recovery_exhausted")` → `status = "aborted"` |
| 2 valid calls (control) | `completed`, 2 commands executed | valid semantics preserved |

The recovery-budget threshold is **necessary but not sufficient** for the
observed abort, and the incident did not reach it. The terminator that
actually fired on 2026-11-02 lies **outside** the malformed-tool-call
causal chain.

---

## 6. Executable gates (G8) and environment findings

### 6.1 Commands executed and their actual exit status

All commands were run with `PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"`
and `BUN_TMPDIR=/tmp` (the sandbox denies bun's default temp dir).

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `cd sdk/packages/core && bun x vitest run src/extensions/tools/null-runcommands-abort-recon01.test.ts src/runtime/orchestration/null-runcommands-abort-orchestrator-recon01.test.ts --config vitest.config.ts` | **0** | **13 passed / 13** (2 files) |
| 2 | `cd sdk/packages/agents && bun x vitest run src/agent-runtime.second-stage-recovery.test.ts src/agent-runtime.recovery-qualification.test.ts src/runtime/recovery/ --config vitest.config.ts` | **0** | **161 passed / 161** (7 files) |
| 3 | `cd sdk/packages/core && bun tsc -p tsconfig.dev.json --noEmit` | **2** | **40 pre-existing TS errors; 0 attributable to the ACT's files** (baseline was 41 including 1 ACT-attributable `TS4104`, which was fixed) |
| 4 | `cd sdk/packages/core && bun x vitest run src/extensions/tools/executors/editor.realpath-authority.test.ts src/extensions/tools/executors/bash.supervised.bash-startup-env.test.ts --config vitest.config.ts` (with the ACT's files stashed away) | **1** | **6 failed / 18 passed** — identical to the with-ACT state ⇒ **pre-existing** |
| 5 | `bun run build:sdk` (repo root) | **1** | `tsc` stage fails on **pre-existing** missing deps (see §6.2). The `bun.mts` bundle stage succeeded, so the gitignored `sdk/packages/llms/dist/` was refreshed (no tracked-file change; `bun.lock` unchanged) |
| 6 | `bun install --cache-dir /tmp/buntmp` (repo root) | **0** | 121 packages installed; `bun.lock` **unchanged**; repaired the stale `@jerome-benoit/sap-ai-provider@4.8.0` → `5.0.3` resolution |

**Build exit code:** `1` — from `bun run build:sdk`, caused by pre-existing
missing type packages, **not** by the ACT (the ACT adds no production
source). The `bun.mts` bundle step that produces the runtime `dist/`
succeeded.

### 6.2 Pre-existing environment defects observed (not caused by this ACT)

1. **Stale / incomplete `node_modules`.** `@jerome-benoit/sap-ai-provider`
   was installed at `4.8.0` while `sdk/packages/llms/package.json` and
   `bun.lock` pin `5.0.3`; the v4 package does not export the `/v4`
   subpath that `sdk/packages/llms/src/providers/vendors/community.ts:33`
   imports. This made **every** core-package test that transitively
   imports `@cline/llms` fail to even load (`session-runtime-orchestrator.test.ts`
   was affected too — i.e. it was broken before this ACT). Repaired by
   `bun install` (lockfile unchanged).
2. **Missing type-only packages** for the `tsc` stage of `build:sdk`:
   `lucide-react`, `mermaid`, `@shadcn/react/message-scroller`,
   `@langfuse/core`, `@opentelemetry/context-async-hooks`.
3. **`vitest` worker teardown `kill EPERM`** on this macOS sandbox for
   every `pool: "forks"` suite (cosmetic; the suite result is still
   reported correctly).
4. **6 pre-existing test failures** in
   `src/extensions/tools/executors/editor.realpath-authority.test.ts`
   (3) and `src/extensions/tools/executors/bash.supervised.bash-startup-env.test.ts`
   (3), caused by macOS `/private/var` realpath semantics and a
   `SpawnConfig` shape drift — reproduced identically with the ACT's
   files stashed away.

### 6.3 Pre-existing-failure control (bounded, reversible)

To prove the 6 failures are not ACT-attributable, the ACT's two untracked
test files were temporarily stashed with
`git stash push -u -- <the two files>`, the failing suites were re-run
(6 failed / 18 passed — identical), and the stash was immediately popped.
The two pre-existing protected stashes (`stash@{0}`, `stash@{1}`) were
untouched and remain in place.



---

## 7. C8 — Decision matrix

| Decision-matrix row | Applies? | Why |
|---|---|---|
| Model emits null, runtime handles correctly, model stops → `MODEL_OUTPUT_FAILURE` | **PARTIALLY** | The model DID emit `{commands: null}` and the runtime handled it correctly (recoverable rejection, zero execution, model continued). But the model did **not** stop — the runtime continued through iterations 223 and 224. The *termination* is therefore not explained by this row. |
| Model emits valid args but adapter produces null → `ADAPTER_CORRUPTION_PROVEN` | **NO** | Excluded (§4.1 #2). |
| Streaming assembly changes valid args to null → `STREAM_ASSEMBLY_DEFECT_PROVEN` | **NO** | Excluded (§4.1 #3). |
| Validation error is delivered but runtime incorrectly aborts → `RUNTIME_RECOVERY_DEFECT_PROVEN` | **NO** | The validation error IS delivered, and the runtime does **not** abort at the incident's cardinality. The runtime's recovery abort is **as specified** and only fires at ≥4 identical rejections. |
| Budget exhaustion deterministically terminates the run as specified → `RECOVERY_POLICY_TERMINATION_PROVEN` | **NO (for this incident)** | The policy termination is **proven as implemented** (threshold 4), but the incident had 2 rejections and the live `shadowRecoveryState` was `idle`. It is proven to be a *real* terminator, **not** this incident's terminator. |
| SDK fails legitimately, host maps status correctly → `EXPECTED_HOST_MAPPING` | **YES** | The host's "done-without-completion" → `awaiting_followup` mapping is the existing documented contract and matches the recorded writer id. |
| SDK result is misclassified by host → `HOST_LIFECYCLE_DEFECT_PROVEN` | **NO** | Excluded (§4.1 #8). |
| Runtime termination not reproducible → `HALT_RED_NOT_REPRODUCED` | **YES — THIS IS THE VERDICT** | The malformed-call → termination chain does not reproduce through the real production seam at the incident's cardinality. |
| Required evidence unavailable → `CAPTURE_INSUFFICIENT` | **PARTIALLY** | The capture is sufficient to exclude the malformed-call chain, but insufficient to observe the *actual* terminal discriminator (§2.2). Because the primary question ("which boundary is responsible for the interruption") cannot be answered positively, the ACT closes at `HALT_RED_NOT_REPRODUCED` and §10 specifies the exact future live capture that would reopen it. |

**Smallest responsible defect:** the *only* defect proven in this ACT is
the model's malformed tool-call payload (`MODEL_EMITTED_INVALID`) — a
model-output quality problem, **not** the interruption's cause. It does
not by itself justify a repair ACT, because the SDK handles it correctly.

---

## 8. Separate findings explicitly NOT broadened into this ACT

Per ACT §9, the following are recorded as separate findings and were
deliberately **not** investigated further, **not** patched, and **not**
folded into the causal chain:

1. **`canonicalShadowPhase = completed` vs `hostPhase = awaiting_followup`.**
   The Elm/shadow canonical phase says `completed` while the host phase
   says `awaiting_followup`. This is the exact mismatch the prior ACT
   `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01` (ACAS01) characterised
   for a different specimen (task `1788297479245_hv9w5`, epoch 4). It is
   a **host/Elm authority-ownership** question, independent of the
   malformed tool call. No Elm/React/header file was touched.
2. **Background-job / continuation-authority work** was already closed
   and is excluded by the incident evidence itself
   (`activeJobs=[]`, `pendingPromptCount=0`, `activeNotifyCount=0`,
   `outstandingAutonomousWork=false`, `guardResult=false`, last job
   terminal 12.8 s before the abort).
3. **Cancellation** is excluded by `cancel-liveness-diagnostic.json`
   (`cancelRequestCalls=0`, `cancelAcceptedCalls=0`, `abortInvokedCalls=0`).


---

## 9. C10 — Evidence package (G9)

Retained artifacts live in
`factory/acts/ACT-CLINEMM-NULL-RUNCOMMANDS-ABORT-RECON01/`.

| path | evidence_class | source_head | capture_scope |
|---|---|---|---|
| `…/input-shape-authority.txt` | REAL_PRODUCTION_SEAM | ENTRY_HEAD | production schema + normalization + validator |
| `…/red-witness.txt` | SYNTHETIC_REAL | ENTRY_HEAD | real AgentRuntime + real SessionRuntime + scripted provider |
| `…/orchestrator-discriminator.txt` | SYNTHETIC_REAL | ENTRY_HEAD | cardinality → finishReason bisection 1..7 |
| `…/live-chronology.txt` | REAL | LIVE (2026-11-02 capture) | frozen incident timeline |
| `…/gates.txt` | REAL | ENTRY_HEAD | all executed commands + exit codes |

`MANIFEST.sha256` in that directory carries the byte size and SHA-256 of
every artifact, computed against the **final HEAD** after execution.
The live captures themselves are **not** copied into the repository
(they live under the VS Code global-storage directory and may contain
unrelated content); their paths and the derived chronology are recorded
in `live-chronology.txt`.

### 9.1 Required content checklist

| Required item | Where |
|---|---|
| 1. Source ownership map | §1.3 |
| 2. Frozen incident chronology | §2 |
| 3. Raw/assembled/parsed/validated argument comparison | §3.1 + `input-shape-authority.txt` |
| 4. Exact RED witness | §3.2 + `red-witness.txt` |
| 5. Causal discriminator and ablation result | §4.2, §4.3 + `orchestrator-discriminator.txt` |
| 6. Negative controls | §5 (T3/T4/T5/T6/T6B, D2 single-call, D4 valid control) |
| 7. Executable test results | §6.1 + `gates.txt` |
| 8. Explicit gaps and unknowns | §2.2, §7 |
| 9. Root-cause verdict | §4.4, §7 |
| 10. Proposed successor repair | §10 — **NONE** (not authorized; cause not proven) |

---

## 10. C11 — Terminal close and the exact live capture that reopens this

**Verdict: `HALT_RED_NOT_REPRODUCED`.**

No successor repair ACT is proposed. ACT §12 forbids repairing an
unreproduced failure, and the only proven defect (the model's malformed
`{commands: null}` payload) is already handled correctly by the SDK.

### 10.1 What future live capture would reopen the investigation

A **new** incident of the same shape is not required — the existing
capture can be reopened only if the following **new** evidence becomes
available. Any one of these is sufficient to reopen:

1. **The SDK run-terminal event for the affected turn** — i.e. the
   `run-finished` / `run-failed` event payload with its `status`,
   `error.message` and `error.name`. This alone would separate
   `ControlledStopError("bounded_recovery_exhausted")` from a provider
   error from a user abort. *(Capture seam: the `AgentRuntime` event

### 10.2 Final report (ACT §15 format)

```text
ACT:
ACT-CLINEMM-NULL-RUNCOMMANDS-ABORT-RECON01

VERDICT:
HALT_RED_NOT_REPRODUCED

ENTRY_HEAD:
251779fdf80a9782e00ddf12996813433c7a7bbb

EVIDENCE_HEAD:
<final HEAD — see factory/acts/ACT-CLINEMM-NULL-RUNCOMMANDS-ABORT-RECON01/MANIFEST.sha256>

BRANCH:
main

SDK_VERSION:
@cline/core 0.2.0 / @cline/agents 0.2.0 / @cline/llms 0.2.0 / @cline/shared 0.2.0

MODEL_PROVIDER:
MiniMax (live incident; exact configured provider id LIVE_UNOBSERVABLE from the capture)

MODEL_ID:
MiniMax M3 family (live incident; exact id LIVE_UNOBSERVABLE from the capture)

PRODUCTION_SEAM:
sdk/packages/core/src/extensions/tools/schemas.ts:161-187  (RunCommandsInputSchema)
  -> sdk/packages/shared/src/tools/create.ts:134-143       (auto-generated validateInput)
  -> sdk/packages/agents/src/agent-runtime.ts:4239-4278   (pre-approval validation gate)
  -> sdk/packages/agents/src/agent-runtime.ts:5002-5284   (applyRecoveryPostClassification)
  -> sdk/packages/agents/src/agent-runtime.ts:3227-3229   (ControlledStopError("bounded_recovery_exhausted"))
  -> sdk/packages/agents/src/agent-runtime.ts:1980-2042   (catch -> status="aborted")
  -> sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:2146-2206 (deriveFinishReason)
  -> apps/vscode/src/sdk/sdk-session-event-coordinator.ts:4799-4831 (host phase -> awaiting_followup)

OBSERVED_FAILURE:
Two consecutive `run_commands` calls were rejected with
"Invalid input: expected array, received null" at path `commands`;
no command executed; the run then reported runtimeStatus=aborted with
no submit_and_exit, and the host rendered the header as `Your turn`
(awaiting_followup, source=host) while the canonical shadow phase was
`completed`.

RED:
command:
  cd sdk/packages/core && bun x vitest run \
    src/extensions/tools/null-runcommands-abort-recon01.test.ts \
    src/runtime/orchestration/null-runcommands-abort-orchestrator-recon01.test.ts \
    --config vitest.config.ts
assertions:
  T2  `{commands:null}` -> rejected BEFORE execution (executed.length === 0),
      outcome = failure/tool_input_invalid, tool-result text contains
      "expected array, received null"
  T7  two consecutive `{commands:null}` calls -> 2 recoverable failures,
      executed.length === 0, provider request count === 3,
      result.status === "completed", result.error === undefined
  D5  identical-null-call cardinality -> finishReason:
      1:completed, 2:completed, 3:completed, 4:aborted, 5:aborted, 6:aborted, 7:aborted
result:
  Test Files 2 passed (2) | Tests 13 passed (13)  (exit 0)


CONSERVATION:
  invalid input executes zero commands                      PASS (T2,T3,T4,T5,T6,T6B,D1,D5)
  invalid input not coerced into an executable command       PASS (T5,T6B)
  valid input semantics preserved                            PASS (T1,T8,D4)
  approval rules unchanged (validateInput precedes approval) PASS (unchanged)
  no error converted into tool success                      PASS (T2 outcome=isError)
  tool results correlated with invocation ids                PASS (outcomeFor per id)
  no synthetic successful completion fabricated             PASS
  no unbounded automatic retries                            PASS (request counts pinned)
  provider failure vs user cancellation distinguishable      PASS (live: 0 cancel calls)
  repeated-tool detection contract unchanged                PASS (thresholds 3/5, no edit)
  explicit cancellation remains authoritative                PASS (unchanged)
  genuine completed runs still reach completion              PASS (T1,T8,D4)
  background-command hold/continuation unchanged             PASS (no production edit)
  no cross-session / cross-epoch continuation               PASS (unchanged)
  awaiting_followup not promoted to completed                PASS (mismatch documented, not patched)
  no new lifecycle owner / no React updater side effects     PASS (no React/Elm edit)
  canonical task-header authority unchanged                  PASS (no header edit)
  existing @cline/agents recovery suites                      PASS 161/161 (exit 0)
  pre-existing core tools failures unchanged                 PASS (6 failed/18 passed identical with files stashed)

EXECUTABLE_GATES:
  cd sdk/packages/core && bun x vitest run \
    src/extensions/tools/null-runcommands-abort-recon01.test.ts \
    src/runtime/orchestration/null-runcommands-abort-orchestrator-recon01.test.ts \
    --config vitest.config.ts                      -> exit 0 (13/13)
  cd sdk/packages/agents && bun x vitest run \
    src/agent-runtime.second-stage-recovery.test.ts \
    src/agent-runtime.recovery-qualification.test.ts src/runtime/recovery/ \
    --config vitest.config.ts                      -> exit 0 (161/161)
  cd sdk/packages/core && bun tsc -p tsconfig.dev.json --noEmit
                                                   -> exit 2 (40 pre-existing errors; 0 ACT-attributable)
  bun run build:sdk (repo root)                    -> exit 1 (pre-existing missing type deps; ACT adds no production source)
  bun install --cache-dir /tmp/buntmp (repo root)   -> exit 0 (bun.lock unchanged)

LIVE_STATUS:
LIVE_UNOBSERVABLE (for the terminal discriminator).
The supplied 2026-11-02 captures ARE live historical evidence and WERE
analysed (chronology, telemetry, writer provenance, header selection,
cancel liveness). They do not expose the SDK run-terminal event, the
abort reason, or the provider's terminal finish event. No live provider
session was re-run and no historical event was recreated.

CHANGES:
  Production source changes: NONE.
  New test files (diagnostic only):
    sdk/packages/core/src/extensions/tools/null-runcommands-abort-recon01.test.ts
    sdk/packages/core/src/runtime/orchestration/null-runcommands-abort-orchestrator-recon01.test.ts
  Reports / evidence:
    factory/acts/ACT-CLINEMM-NULL-RUNCOMMANDS-ABORT-RECON01.md
    factory/acts/ACT-CLINEMM-NULL-RUNCOMMANDS-ABORT-RECON01/*.txt
    factory/acts/ACT-CLINEMM-NULL-RUNCOMMANDS-ABORT-RECON01/MANIFEST.sha256
  Environment-only (no tracked file changed; bun.lock untouched):
    bun install (repaired stale @jerome-benoit/sap-ai-provider 4.8.0 -> 5.0.3)
    bun run build:sdk bundle stage (refreshed gitignored sdk/packages/llms/dist)

REMAINING_UNKNOWN:
  1. The exact runtime exit discriminator that produced status="aborted"
     on 2026-11-02T12:47:16.52Z (provider stream termination vs. external
     abort vs. session-lifecycle teardown). Not exposed by any supplied
     capture.
  2. The provider's terminal `finish` event / error for iteration 224.
  3. The raw provider tool-call payload for the two rejected calls
     (representation A) — the error text proves the VALUE at the
     validation boundary was `{commands:null}`, but the raw bytes are
     not captured.
  4. The exact configured MiniMax provider id and model id.
  5. Whether the iteration-224 provider request completed, was cancelled
     upstream, or was terminated by a local stream/timeout path.
  6. The canonicalShadowPhase(completed) vs hostPhase(awaiting_followup)
     ownership mismatch — deliberately left as a separate finding.

NEXT_ACT:
NONE.
Not because the incident is fully explained (it is not), but because
ACT §12/§14 forbid inventing a repair for an unreproduced failure, and
the malformed-tool-call chain is proven NOT to be the cause. The
reopening condition is the live capture specified in §10.1 — the single
highest-value item being the SDK run-terminal event (status +
error.message + error.name) for the affected turn.
```

ROOT_CAUSE:
UNPROVEN for the 2026-11-02 termination.
PROVEN: the malformed `{commands:null}` payload is a MODEL_OUTPUT_FAILURE
that the SDK rejects correctly and recoverably (zero execution, error
delivered to the model, model continues). It is NOT the terminator.
PROVEN EXCLUSIONS: provider adapter, stream assembler, input
normalization/coercion, validation, tool-result delivery, recovery
budget (threshold 4, incident had 2), loop detection, mistake tracker,
host phase mapping.
MOST CONSISTENT (unproven): a separate SDK/runtime termination at the
iteration-224 provider request (abort 12 ms after prepare_turn, with an
api_req_started request in flight). LIVE_UNOBSERVABLE from the capture.

CAUSAL_DISCRIMINATOR:
intervention: vary ONLY the number of identical `{commands:null}`
  run_commands calls delivered by a deterministic scripted provider
  through the real SessionRuntime + AgentRuntime + production schema
  and the real production validator.
observation: finishReason stays `completed` for 1, 2 and 3 rejections and
  flips to `aborted` at 4 (C1.4 second-stage latch: Trigger C arms at 3,
  TERMINATING at 4, ControlledStopError("bounded_recovery_exhausted") ->
  status="aborted").
conclusion: the incident's cardinality (2) CANNOT reach the recovery
  terminator; the malformed-call chain is causally excluded.
  Live capture agrees: shadowRecoveryState === "idle" and
  recoveryBudgetFailures frozen at 2 across the terminal transition.

ABLATION:
necessity result: the recovery-budget threshold (exactOnlyBudget >
  maxRepairAttempts=2 to ARM, plus one more identical failure to
  TERMINATE) is NECESSARY for the recovery terminator and is NOT
  REACHED at 2 rejections. 1 -> completed, 2 -> completed, 3 -> completed,
  4 -> aborted. The live incident's runtimeStatus=aborted therefore has
  a cause OUTSIDE the malformed-tool-call chain.

   stream already emits it; the host's session-event bridge is where it
   must be retained.)*
2. **The provider stream's terminal `finish` event** for the iteration
   that was in flight (`reason` + `requestId` + any `error`), together
   with the provider adapter's `error`/`isRetryable` classification.
3. **The abort reason string** reaching the orchestrator — i.e. the
   argument passed to `activeRuntime.abort(...)` /
   `session.agent.abort(reason)` at the terminal instant.
4. **The raw provider tool-call payload** (bounded, redacted) for the
   two rejected `run_commands` calls, to confirm representation (A) was
   already `{commands: null}` and that no adapter/assembler stage
   altered it.

None of these is a new public protocol field; each is a retention
decision on an already-emitted internal event.
