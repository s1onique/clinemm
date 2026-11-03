# ACT-CLINEMM-COMMAND-PROCESS-OUTCOME-TRACE-BRIDGE01 — Evidence Report

**Type:** Bounded production implementation + causal qualification
**Priority:** P1 — harness evaluation observability
**Branch:** existing `main` (no ACT branch created)
**Predecessor:** `ACT-CLINEMM-TRACE-DECISION-SUFFICIENCY-RECON01`
**Normative correction:** `docs/acts/ACT-CLINEMM-TRACE-DECISION-SUFFICIENCY-RECON01/CORRECTION01-SUCCESSOR-CONTRACT.md`

---

## 0. Terminal verdict

**`PASS_STRUCTURAL_VERIFIED`** — superseded by
**`PASS_STRUCTURAL_VERIFIED_CORRECTION01`**.

> **CORRECTION01 (see
> `CORRECTION01-EVIDENCE-PROVENANCE-AND-OFF-PATH-DELTA.md`).** The review of
> this report returned `HALT_EVIDENCE_PROVENANCE_AND_OFF_PATH_DELTA` with two
> P0 findings and one P2. Both P0 findings are **fixed** and the P2 is fixed:
>
> - **P0-2** — `executeShellCommands` stamped the correlation index into the
>   executor context **unconditionally**, including with tracing OFF. The
>   stamp is now **conditional** on the observation channel being **PRESENT**,
>   so the disabled path hands the executor the **exact predecessor context**.
>   The witnesses **discriminate** the defect (they fail against the
>   pre-correction production code).
> - **P0-1** — the necessity ablation ran over a hand-**authored** array that
>   this report called "CAPTURED process evidence". The ablation now runs over
>   the **real** `ModelBehaviorTraceRecorder`'s own output, produced by the
>   **real** `run_commands` tool and the **real** `CommandJobManager`, and
>   that capture is **committed** as source-bound evidence. The authored
>   fixture is **retained** as an explicitly-labelled **synthetic control**.
> - **P2** — the `git diff --check` blank-line-at-EOF diagnostic is fixed.
>
> The bridge, the event contract, the privacy allowlist, the per-command
> correlation and the delayed-background-completion behaviour are preserved
> unchanged.

The bridge is implemented at the real command-execution authorities, the RED
reproduction was genuine, every mandatory gate family passes, the executed
necessity ablation shows the exact process-success classification becomes
`CAPTURE_INSUFFICIENT` when the new category is removed — now over **real**
recorder output — and the trace-OFF path is neutral.

**No installed-dogfood qualification is claimed.** This ACT did not install a
VSIX.

---

## 1. Entry source HEAD/tree and hygiene

| Property | Value |
|---|---|
| `ENTRY_HEAD` | `baa66a6860a0f79ddedd6d37f18e1fcc71528323` |
| `ENTRY_TREE` | `bd1b7d2c67b822b1c257d2983c4c53afacad7f22` |
| Branch | `main` |
| `git status --porcelain=v1 -uall` (entry) | **0 entries** — clean |
| Stashes (entry) | `stash@{0}: WIP on main: d46223b51 ... BCB re-registration` — **preserved, never popped or modified** |
| Worktrees (entry) | `clinemm` (main), `/private/tmp/cline-fork-baseline` (detached `265044bf`), `clinemm-m31-action-first` (`38e726c4`), `clinemm-m31-bounded` (detached `0366ea50`) — **none touched** |
| Push / branch / install | NONE / NONE / NONE |

The previously reported HEAD was **confirmed to be the actual entry HEAD**, not
merely assumed.

**Hygiene verdict: clean. `HALT_UNEXPECTED_DIRT` not triggered.**

### Baseline failures recorded at entry

| Baseline | Class | Evidence |
|---|---|---|
| `sdk/packages/core` typecheck — 40 pre-existing `error TS` diagnostics in unrelated command-policy / orchestrator test files | `BASELINE_FAILURE` | baseline count measured with the change stashed = **40**; with the change = **40** — identical, zero new diagnostics |
| `apps/vscode` vitest — failing test files | `BASELINE_FAILURE` (environmental) | the identical failing-file SET was captured twice under the SAME procedure — once with the change stashed and once with it applied — and is **identical**: **23 files** each, zero new, zero removed. See §11 gate 6 for the procedure and the one apparent difference that was closed by direct measurement |
| `bash.supervised.bash-startup-env.test.ts` — 3 `mktemp` failures | `BASELINE_FAILURE` (sandbox `mktemp` restriction) | reproduced identically on the stashed baseline |
| `src/generated/hosts/vscode/protobus-services.ts` imports two non-existent modules | `BASELINE_FAILURE` (stale generated protobuf, the `rcnc02` limitation) | reproduced identically on the stashed baseline; resolved by the repository's own `bun run protos` build step, not by an unrelated repair |
| vitest worker teardown `EPERM: operation not permitted, kill` | `BASELINE_FAILURE` (sandbox) | occurs after all assertions; present on baseline runs too |

---

## 2. C0 — Exact producer/correlation map

Source inspection at `ENTRY_HEAD` established the four observation seams.

| Path | Authority seam | Identity already present | Missing join the bridge adds |
|---|---|---|---|
| **A. Foreground** | `vscode-run-commands-tool.ts` — `executeForeground` reads `process.getCompletionDetails()`; the exit code is FIRST authoritative there | `context.sessionId` / `runId` / `toolCallId`; the trace sink + identity via `context.metadata` | `commandIndex` — the executor cannot tell command 0 from command 1 in a batch |
| **B. Background, synchronous terminal** | `manager.start()` returns the manager's authoritative terminal snapshot (`start.state`, `start.exitCode`, `start.signal`, `start.jobId`) | the same context identity; `jobId` | `commandIndex`; and the classification must not be inferred from the wrapper error |
| **C. Background, asynchronous terminal** | `CommandJobManager.finalize()` (`command-job-manager.ts:2450`) — the REAL exit code and the exact terminal class are known here, **independently of whether the model polls `command_status`** | `jobId`; `ownerSessionId` | the launch-time `(sessionId, toolCallId, commandIndex)` binding — captured at launch, never reconstructed from the currently-active session |
| **D. Batched commands** | `definitions.ts` — `Promise.all(commands.map(...))` over the positional `commandIndex` | the positional `commandIndex` | the `commandIndex` is not propagated to the executor — the fanout preserves ARRAY order, not temporal order, so the index is the only sound key |

### The smallest valid recording path

The repository ALREADY has the established observation channel: the agent
runtime stamps the trace sink and the correlation identity onto
`AgentToolContext.metadata` (`agent-runtime.ts:3602-3609`, the
`EDIT_OBSERVATION_SINK_METADATA_KEY` / `EDIT_OBSERVATION_IDENTITY_METADATA_KEY`
mechanism used by the edit instrumentation). The executor receives that
context.

The bridge therefore **reuses that channel** and adds exactly ONE thing it was
missing: the per-command positional index. **No new global correlation
registry was introduced.**


| Layer | Change |
|---|---|
| Core SDK | `executeShellCommands` stamps `commandIndex` into the per-command context metadata (`COMMAND_PROCESS_OBSERVATION_INDEX_METADATA_KEY`) |
| Core SDK | new `command-process-observation.ts` — the single narrow reporting channel (`reportCommandProcessObservation`) |
| VSCode host | the foreground executor reports at `getCompletionDetails()`; the background executor reports the handoff, the synchronous terminal, and the delayed terminal at the manager's `finalize()` boundary |
| Recorder | one new sink channel + one new native event (`process_observation`) |
| Portable normalizer | `process_observation` → the portable `process` family (the family's FIRST native producer) + the per-family payload allowlist |

---

## 3. RED evidence (genuine reproduction)

The RED was captured against the **pre-bridge** production code at
`ENTRY_HEAD`.

### RED-01 / RED-03 / RED-04 — the per-command defect at the real `createShellTool` seam

`sdk/packages/core/src/extensions/tools/command-process-observation.test.ts`
drives the REAL production `createShellTool` (the production `run_commands`
tool) with a deterministic injected executor that plays the role of the
process authority.

**Pre-bridge result — all three assertions failed on the PRODUCTION
observation, not on a TypeScript error or a setup failure:**

```
FAIL  RED-01: records one DISTINCT process observation per command in a mixed-outcome batch
AssertionError: expected [] to have a length of 2 but got +0

FAIL  RED-03: records an EXPLICIT unknown exit status when no exit code was observed
AssertionError: expected [] to have a length of 1 but got +0

FAIL  RED-04: concurrent invocations with OVERLAPPING command indices never cross owners
AssertionError: expected [] to have a length of 4 but got +0

 Test Files  1 failed (1)
      Tests  3 failed (3)
```

**Exit code of the RED run: 1 (failing assertions).** The recorder emitted
**ZERO** per-command process observations — the exact information-loss defect
the ACT describes. The trailing `EPERM: operation not permitted, kill` is the
known sandbox worker-teardown artifact and occurs AFTER the assertions.

### RED-02 — the delayed background terminal

`apps/vscode/src/sdk/__tests__/command-process-outcome-trace-bridge01.test.ts`
G4 drives the REAL `CommandJobManager` with a REAL subprocess. Pre-bridge the
terminal observation never arrived:

```
Error: the terminal observation never arrived
```

This is the second half of the defect: a background command that outlives its
tool call produced **no eventual terminal fact at all**.

**`HALT_RED_NOT_REPRODUCED` was NOT triggered** — both halves reproduced
against the real production seams.

---

## 4. Implemented event contract

### 4.1 The native event

`process_observation` — ONE command's genuine process outcome, observed at the
authority that owns the process.

### 4.2 Required identity

| Field | Where | Provenance |
|---|---|---|
| `sessionId` | observation **envelope** (and the portable `identity`) | the runtime's own stamp |
| `runId` | observation **envelope** (and the portable `identity`) | the runtime's own stamp |
| `runIdNamespace` | portable `identity` | classified by the normalizer's existing shape rule |
| `toolCallId` | payload | the runtime's own stamp |
| `commandIndex` | payload | the positional index of the command in its batch |
| `jobId` | payload (background only, where established) | minted by `CommandJobManager` |

The correlation key is `(sessionId, toolCallId, commandIndex)`. A missing
owner identity is NEVER inferred: the observation is simply not emitted, and
the recorder's own `classifyEvidenceBoundary` marks the record
`partial_identity` / `no_identity`.

### 4.3 The terminal classes

| State | Meaning |
|---|---|
| `running` | Background handoff; terminal outcome NOT yet observed. NEVER a success. |
| `exited` | A real process terminal observation. |
| `cancelled` | Host-owned cancellation outcome. |
| `deadline_exceeded` | Host execution deadline reached. |
| `spawn_failed` | No successful process spawn. |
| `containment_failed` | Terminal containment invariant failed. |
| `unknown` | A required terminal fact could not be established. |

`exitCode` is carried **only** when the process authority actually reported
one. An absent exit code means "not observed" — it is **never** 0, and it is
**never** synthesized from a wrapper error. In particular the foreground
`CommandExitError(1)` convention (used for "terminal closed" and "completion
could not be observed") is **never** reported as an observed exit code.

### 4.4 Cardinality

- Zero or one observed nonterminal handoff per command.
- At most one authoritative terminal observation per command.
- A terminal result MAY arrive after the enclosing `tool_finish`.
- A pre-execution rejection is `spawn_failed`, never an exited subprocess.
- A callback delivered twice does not create two terminal records (the fast
  path reports synchronously and does **not** also attach a delayed listener).
- When the recorder is disabled at an observation boundary, no record is
  emitted — and a capture spanning a toggle remains explicitly PARTIAL.

### 4.5 Privacy

Allowed new facts: the existing opaque correlation identifiers, `commandIndex`,
the execution mode, the observation kind, the terminal class, the ACTUAL
observed exit code, the termination signal, the background `jobId`, and
bounded structural `provenance` / `source` labels.

The recorder's existing fail-closed sanitizer is used unmodified as the
inbound gate, and the portable normalizer's per-family ALLOWLIST is the
outbound gate. No command string, argument array, query preview, stdout,
stderr, shell environment, absolute path, raw tool output, prompt/reasoning
content, credential, or process environment is carried.

---

## 5. Minimal changed-source inventory

| File | Change |
|---|---|
| `sdk/packages/shared/src/runtime/model-behavior-trace.ts` | the `process_observation` event; the terminal-state / execution-mode / observation-payload types; the two metadata keys; the `onProcessObservation` sink channel; `args`/`argv` added to the forbidden-key set |
| `sdk/packages/shared/src/index.ts` | exports for the new symbols |
| `sdk/packages/core/src/extensions/tools/definitions.ts` | stamps `commandIndex` into the per-command context metadata — **CORRECTION01: conditionally**, only when the observation channel is PRESENT |
| `sdk/packages/core/src/extensions/tools/executors/command-process-observation.ts` | **NEW** — the single narrow reporting channel; **CORRECTION01** adds the exported `isCommandProcessObservationChannelPresent` predicate |
| `sdk/packages/core/src/index.ts` | exports the reporting channel |
| `sdk/packages/core/src/extensions/tools/command-process-observation.test.ts` | **NEW** — RED-01/03/04 witnesses; **CORRECTION01** adds the CORR01-1…5 disabled-path neutrality witnesses |
| `apps/vscode/src/sdk/vscode-run-commands-tool.ts` | the foreground report at `getCompletionDetails()`; the background handoff, synchronous-terminal, delayed-terminal and launch-failure reports |
| `apps/vscode/src/sdk/model-behavior-trace-runtime.ts` | the recorder's `onProcessObservation` channel |
| `apps/vscode/src/sdk/normalize-agent-trace.ts` | `process_observation` → the portable `process` family; the `process` family payload allowlist |
| `apps/vscode/src/test/cline-core-vitest-stub.ts` | re-exports the reporting channel so the host executor's observation path is the production one under vitest |
| `apps/vscode/src/sdk/__tests__/command-process-outcome-trace-bridge01.test.ts` | **NEW** — G2/G3/G4/G5/G7/G8/G9 witnesses; **CORRECTION01** adds the G8-CORR01 ×2 host-level OFF-path witnesses |
| `apps/vscode/src/sdk/__tests__/command-process-outcome-portable-normalizer01.test.ts` | **NEW** — G10/PORT-1/PORT-2/G9-PORT witnesses; **CORRECTION01** re-badges C5 as an explicitly-labelled **SYNTHETIC CONTROL** |
| `apps/vscode/src/sdk/__tests__/command-process-outcome-real-capture-ablation01.test.ts` | **NEW (CORRECTION01)** — the necessity ablation over a **REAL**, source-bound recorder capture |
| `docs/acts/ACT-CLINEMM-COMMAND-PROCESS-OUTCOME-TRACE-BRIDGE01/evidence/process-observation-excerpt.jsonl` | **NEW** — the privacy-safe excerpt (§7) |
| `docs/acts/ACT-CLINEMM-COMMAND-PROCESS-OUTCOME-TRACE-BRIDGE01/evidence/real-process-capture.jsonl` | **NEW (CORRECTION01)** — the real recorder capture the necessity ablation runs over (§8.1) |
| `docs/acts/ACT-CLINEMM-COMMAND-PROCESS-OUTCOME-TRACE-BRIDGE01/CORRECTION01-EVIDENCE-PROVENANCE-AND-OFF-PATH-DELTA.md` | **NEW (CORRECTION01)** — the correction report |

**No React, Elm, task-header state, completion authority, approval, shell
execution, background-job containment, command policy, model-facing result,
public protobuf, or wire schema was touched.**

---

## 6. GREEN evidence

### 6.1 The focused suites

| Suite | Command | Result |
|---|---|---|
| Core SDK — per-command observations | `cd sdk/packages/core && bun x vitest run src/extensions/tools/command-process-observation.test.ts --config vitest.config.ts` | **8 passed** (RED-01, RED-03, RED-04, **CORR01-1…5**) |
| VSCode — bridge conservation | `cd apps/vscode && CLINEMM_EXPERIMENTAL_SANDBOX=off bun x vitest run src/sdk/__tests__/command-process-outcome-trace-bridge01.test.ts --config vitest.config.ts` | **14 passed** (G2 ×5, G4, G5, G7 ×2, G8 ×2, **G8-CORR01 ×2**, G9) |
| VSCode — portable normalizer + **synthetic control** | `cd apps/vscode && bun x vitest run src/sdk/__tests__/command-process-outcome-portable-normalizer01.test.ts --config vitest.config.ts` | **8 passed** (G10 ×2, PORT-1, PORT-2, G9/PORT, C5/CTRL ×3) |
| **VSCode — REAL-capture ablation (CORRECTION01)** | `cd apps/vscode && CLINEMM_EXPERIMENTAL_SANDBOX=off bun x vitest run src/sdk/__tests__/command-process-outcome-real-capture-ablation01.test.ts --config vitest.config.ts` | **5 passed** |
| Shared SDK — the recorder | `cd sdk/packages/shared && bun x vitest run src/runtime/model-behavior-trace.test.ts --config vitest.config.ts` | **18 passed** |
| VSCode — trace runtime + dogfood + contract | `bun x vitest run <10 trace suites> --config vitest.config.ts` | **120 passed** across 10 files |

### 6.2 Gate-by-gate

| Gate | Requirement | Result | Where |
|---|---|---|---|
| Real-seam RED→GREEN | Mandatory | **PASS** | §3 → §6.1 (3 RED assertions → 3 GREEN) |
| Mixed-command cardinality | Mandatory | **PASS** | RED-01: two commands, one `toolCallId`, distinct `commandIndex`, distinct exit codes (0 and 3) |
| Background delayed terminal | Mandatory | **PASS** | G4: `running` at the handoff → tool call RETURNED → `exited` with the REAL exit code 7 arriving later, same `jobId` + `toolCallId` |
| Foreground unknown exit | Mandatory | **PASS** | G2 ×3: exit code unavailable, terminal closed, unobserved command → `unknown`, **no exit code**, never 0 |
| Concurrency/owner conservation | Mandatory | **PASS** | G5: two concurrent jobs, overlapping `commandIndex` 0, distinct owners and distinct exit codes (11 / 13), distinct `jobId`s, no cross-owner attribution, exactly one terminal record per owner |
| Containment and cancellation | Mandatory | **PASS** | The classes are carried verbatim from the manager (`cancelled` / `deadline_exceeded` / `spawn_failed` / `containment_failed`); a containment failure is never collapsed into an ordinary clean exit; a launch failure is `spawn_failed` with NO exit code |
| Trace-OFF neutrality | Mandatory | **PASS** | G8: tracing OFF emits no observation; the execution ORDER witness is identical (`acquire → run`); tracing ON vs OFF yields byte-identical tool results |
| Privacy allowlist | Mandatory | **PASS** | G9 + G9/PORT: `command` / `args` / `stdout` / `stderr` / `env` redacted by the recorder; the portable allowlist DROPS them plus absolute paths and unknown nested objects |
| Historical normalizer compatibility | Mandatory | **PASS** | G10: the frozen pre-bridge fixture keeps its original counts; `byFamily.process` is absent; no pre-bridge record carries a process fact |
| Executed necessity ablation over **REAL** recorder output | Mandatory | **PASS** | §8.1 (CORRECTION01) — the ablation runs over the real `ModelBehaviorTraceRecorder`'s own output, committed as `evidence/real-process-capture.jsonl` |
| Disabled-path executor-context neutrality | Mandatory | **PASS** | §9 (CORRECTION01) — CORR01-1…5 + G8-CORR01 ×2; the witnesses **fail** against the pre-correction production code |
| Affected TypeScript typechecks | Mandatory | **PASS** | `sdk/packages/shared` — **0 errors**; `apps/vscode` — **0 errors**; `sdk/packages/core` — **40 errors, identical to the stashed baseline** |
| Biome on changed files | Mandatory | **PASS** | 12 changed files checked at `--diagnostic-level=error` — **clean** (root config for the SDK packages, `apps/vscode/biome.jsonc` for the extension) |

---

## 7. Command cardinality and delayed-completion proof

**Artifact:** `evidence/process-observation-excerpt.jsonl`
(SHA-256 `42e611b7ce89dd18b79520da55dc157672c974d9f0bb5bceeedc084b84a1d7c7`)

The excerpt is a REAL capture produced by the production seams: a foreground
`run_commands` invocation with TWO commands and a REAL background job driven
through the REAL `CommandJobManager`. It contains **no command text, no
output, and no paths** — only structural scalars.

```jsonl
{"seq":1,"timestamp":"2026-11-03T10:11:21.519Z","traceId":"mbt_26581c746ff10d365a3b1f6d","event":"process_observation","evidenceBoundary":"partial_identity","sessionId":"session-demo","runId":"run_demo0001","payload":{"toolCallId":"call-mixed","commandIndex":0,"executionMode":"foreground","terminalState":"exited","exitCode":0,"provenance":"REAL_PRODUCTION_SEAM","source":"foreground_terminal_completion"}}
{"seq":2,"timestamp":"2026-11-03T10:11:21.519Z","traceId":"mbt_26581c746ff10d365a3b1f6d","event":"process_observation","evidenceBoundary":"partial_identity","sessionId":"session-demo","runId":"run_demo0001","payload":{"toolCallId":"call-mixed","commandIndex":1,"executionMode":"foreground","terminalState":"exited","exitCode":3,"provenance":"REAL_PRODUCTION_SEAM","source":"foreground_terminal_completion"}}
{"seq":3,"timestamp":"2026-11-03T10:11:21.573Z","traceId":"mbt_26581c746ff10d365a3b1f6d","event":"process_observation","evidenceBoundary":"partial_identity","sessionId":"session-demo","runId":"run_demo0001","payload":{"toolCallId":"call-bg","commandIndex":0,"executionMode":"background","terminalState":"running","jobId":"cmd_mw0j2nn49rem94zu","provenance":"REAL_PRODUCTION_SEAM","source":"background_job_manager_handoff"}}
{"seq":4,"timestamp":"2026-11-03T10:11:21.857Z","traceId":"mbt_26581c746ff10d365a3b1f6d","event":"process_observation","evidenceBoundary":"partial_identity","sessionId":"session-demo","runId":"run_demo0001","payload":{"toolCallId":"call-bg","commandIndex":0,"executionMode":"background","terminalState":"exited","exitCode":7,"jobId":"cmd_mw0j2nn49rem94zu","provenance":"REAL_PRODUCTION_SEAM","source":"background_job_manager_terminal"}}
```

**Reading the excerpt:**

- **Mixed batch** (`seq` 1–2): ONE `toolCallId` (`call-mixed`), TWO distinct
  `commandIndex` values, TWO distinct exit codes (**0** and **3**). Before
  the bridge this tool call produced exactly ONE aggregate outcome.
- **Delayed terminal** (`seq` 3–4): the background command's NONTERMINAL
  handoff at `10:11:21.573`, then the AUTHORITATIVE terminal fact at
  `10:11:21.857` — **284 ms later, and after the enclosing tool call had
  already returned**. The terminal fact carries the SAME `jobId`
  (`cmd_mw0j2nn49rem94zu`) and the SAME `toolCallId` (`call-bg`), so the
  delayed fact is exactly bound to the originating command. Its exit code is
  **7** — the code the process really produced.

---

## 8. Necessity ablation (EXECUTED)

> **CORRECTION01.** This section originally described the ablation as running
> over "the CAPTURED process evidence". That was **inaccurate**: the input was
> a hand-**authored** array inside the test file, with invented timestamps and
> invented events, and it placed `tool_finish` **before** the foreground
> process observations — not the observed execution order. The ablation now
> runs over the **real** recorder's own output (§8.1) and the authored
> fixture is retained only as a **synthetic control** (§8.2).

### 8.1 The ablation over a REAL, source-bound recorder capture

**Artifact:** `evidence/real-process-capture.jsonl`

The capture is produced by the **real** `ModelBehaviorTraceRecorder`, fed
through a sink wired exactly like the production `modelBehaviorTraceSink`, by
the **real** `createVscodeRunCommandsTool` running a **real** command through
the **real** `CommandJobManager`. The recorder's **own retained records** are
what the normalizer parses and what the ablation removes a category from.

The capture contains **both** the tool-activity events and the per-command
process events, in the **observed** order: the `running` handoff precedes the
`tool_finish`, and the authoritative terminal fact arrives **after** the tool
call returned, carrying the **real** exit code (7) the process produced.

| Phase | Q2 (exact process-success classification) | Tool-activity sequence |
|---|---|---|
| **BASELINE** (process records present) | **ANSWERABLE** — `exited_nonzero_7` | observable — `tool_start:run_commands`, `tool_finish:run_commands` |
| **ABLATION** (only the `process_observation` category removed) | **`CAPTURE_INSUFFICIENT`** — the classifier finds **zero** per-command facts and does **not** infer any | **UNCHANGED and still observable** |
| **RESTORE** (process records put back) | **ANSWERABLE** again — `exited_nonzero_7` | observable |

The decisive observation: in the ABLATION phase the aggregate tool outcome
**still reads `success`** — exactly the defect the bridge removes. The
aggregate cannot distinguish one command's nonzero exit from another's clean
exit.

**Witness:** `apps/vscode/src/sdk/__tests__/command-process-outcome-real-capture-ablation01.test.ts`
(5 witnesses: the capture is real, BASELINE, ABLATION, RESTORE, and the
source-binding of the committed artifact).

### 8.2 The SYNTHETIC CONTROL (retained, relabelled)

`apps/vscode/src/sdk/__tests__/command-process-outcome-portable-normalizer01.test.ts`
retains the authored fixture — renamed `SYNTHETIC_CONTROL_WITH_PROCESS` and
re-badged `C5 — SYNTHETIC CONTROL`. It establishes **normalizer** behaviour
(the process family maps, the allowlist drops hostile fields, the pre-bridge
fixture is not retroactively reinterpreted, the classifier returns
`CAPTURE_INSUFFICIENT` rather than inferring an outcome). It does **not**
carry the real-evidence necessity claim, and no longer claims to.

---

## 9. Trace-OFF neutrality

> **CORRECTION01.** BRIDGE01's `executeShellCommands` stamped the correlation
> index into the per-command executor context **unconditionally** — including
> with tracing OFF. That was an unconditional production-context delta, even
> though it produced no command-result regression. The stamp is now
> **conditional** on the observation channel being **PRESENT**, so the
> disabled path hands the executor the **exact predecessor context**. The
> "Exact executor context" row below is the new evidence for that.

| Property | Result | Evidence |
|---|---|---|
| No recorder event while disabled | **PASS** | G8: zero observations with tracing OFF; CORR01-2: the channel is present but disabled → **zero** observations emitted |
| **Exact executor context while disabled** | **PASS (CORRECTION01)** | CORR01-1: channel ABSENT → the executor receives the **same object** (`toBe`) with **no** `__clineCommandProcessObservationIndex` key; G8-CORR01 (host level): the tool-call context's metadata is exactly `{}` |
| Identical tool results | **PASS** | G8: `JSON.stringify(offResult) === JSON.stringify(onResult)`; CORR01-3: the same equality, asserted at the SDK seam |
| Identical execution ORDER | **PASS** | G8: the ordering witness is `["acquire", "run"]` in both runs — comparing returned bytes alone would NOT have proven this; CORR01-3: an explicit per-command scheduling-order witness, identical in both modes |
| No added `await` on the disabled path | **PASS** | the reporting channel is a synchronous, non-awaited call; the delayed terminal listener is `void`-ed and only ever installed on the RUNNING branch, which is reached identically in both modes |
| No change to cancellation / deadline semantics | **PASS** | the bridge adds no `await` to the execution path and does not touch the manager's termination authority |
| Identical number/order of command starts | **PASS** | G5 proves the per-command fanout order is unchanged; the `commandIndex` stamp is metadata-only |
| The toggle contract survives the conditional stamp | **PASS (CORRECTION01)** | G7 ×2 unchanged: toggling OFF mid-job leaves the capture explicitly PARTIAL; toggling ON after the handoff still emits the delayed terminal fact. The stamp predicate is the channel's **PRESENCE**, not the enable bit — a background command handed off while disabled keeps its `commandIndex` so the delayed fact stays correlatable |
| No new permanent public API or wire field | **PASS** | the new event is an INTERNAL recorder event; no protobuf, no public wire schema, no public setting |
| Public default OFF / dogfood implicit ON / dogfood explicit OFF | **PASS** | unchanged — `model-behavior-trace-dogfood-default.test.ts` (T01–T15) passes unchanged |
| Toggle OFF during an active job | **PASS** | G7: the later terminal observation is NOT emitted; the capture is explicitly PARTIAL; the `running` handoff is never restated as a success |
| Toggle ON after the handoff | **PASS** | G7: the terminal fact IS emitted with the real exit code; the missing handoff is NOT manufactured |
| Dump after disabling | **PASS** | unchanged (T15) |

---

## 10. Privacy and backward-compatibility results

### 10.1 Adversaries (G9)

Injected into the source observation and asserted to never reach the portable
output: `command`, `args`, `stdout`, `stderr`, `env` (nested), an absolute
path, and an unknown nested object.

| Layer | Result |
|---|---|
| The recorder's fail-closed sanitizer (inbound) | `command` / `args` / `stdout` / `stderr` / `env` → `[REDACTED_BY_TRACE_SCHEMA]` |
| The portable per-family ALLOWLIST (outbound) | all of the above, plus the absolute path and the unknown nested object, are **DROPPED** entirely; the drops are ACCOUNTED FOR in the `dropped` list |

Two forbidden-key additions were required and made: `args` and `argv`. The
`args` key was previously absent from the recorder's forbidden set, so an
argument ARRAY passed the inbound sanitizer — a real (if narrow) privacy
hole that the ACT's G9 gate exposed and that is now closed.

### 10.2 Backward compatibility (G10)

A frozen PRE-BRIDGE fixture (2 × `tool_start`, 2 × `tool_finish`, NO
`process_observation`) normalizes with its ORIGINAL counts:

- `byNativeEventType["tool_start"] === 2`, `["tool_finish"] === 2`
- `byNativeEventType["process_observation"]` is **absent**
- `byFamily.process` is **absent** (the coverage report only lists families
  that actually appear)
- `byFamily.tool === 4`
- Every portable record remains in the `tool` family, and **no** pre-bridge
  record carries `exitCode`, `terminalState`, or `commandIndex`.

**The historical 949 `run_commands` tool finishes are NOT retroactively
reinterpreted as 949 successful processes.** The historical specimen was

---

## 11. Focused executable gates

| # | Gate | Command | Exit | Result |
|---|---|---|---|---|
| 1 | Core SDK per-command observations + disabled-path neutrality (RED-01/03/04 → GREEN, CORR01-1…5) | `cd sdk/packages/core && bun x vitest run src/extensions/tools/command-process-observation.test.ts --config vitest.config.ts` | 0 | **8 passed** |
| 2 | VSCode bridge conservation (G2/G4/G5/G7/G8/G9) + G8-CORR01 ×2 | `cd apps/vscode && CLINEMM_EXPERIMENTAL_SANDBOX=off bun x vitest run src/sdk/__tests__/command-process-outcome-trace-bridge01.test.ts --config vitest.config.ts` | 0 | **14 passed** |
| 3 | VSCode portable normalizer + C5 SYNTHETIC CONTROL (G10/PORT/G9-PORT/C5) | `cd apps/vscode && bun x vitest run src/sdk/__tests__/command-process-outcome-portable-normalizer01.test.ts --config vitest.config.ts` | 0 | 8 passed |
| 3b | **VSCode REAL-capture necessity ablation (CORRECTION01)** | `cd apps/vscode && CLINEMM_EXPERIMENTAL_SANDBOX=off bun x vitest run src/sdk/__tests__/command-process-outcome-real-capture-ablation01.test.ts --config vitest.config.ts` | 0 | **5 passed** |
| 4 | Shared SDK recorder | `cd sdk/packages/shared && bun x vitest run src/runtime/model-behavior-trace.test.ts --config vitest.config.ts` | 0 | 18 passed |
| 5 | VSCode trace runtime + dogfood + contract (10 suites) | `cd apps/vscode && CLINEMM_EXPERIMENTAL_SANDBOX=off bun x vitest run src/sdk/__tests__/w-carrier-trace-runtime.test.ts src/sdk/__tests__/w-carrier-trace-command-registration.test.ts src/sdk/__tests__/w-carrier-trace-runtime-w-observe-roundtrip.test.ts src/sdk/__tests__/w-carrier-trace-production-dump-roundtrip.test.ts src/sdk/__tests__/agent-trace-contract-recon01.test.ts src/sdk/__tests__/compare-model-behavior-traces.test.ts src/sdk/__tests__/model-behavior-trace-command-registration.test.ts src/sdk/__tests__/model-behavior-wire-reasoning-trace01.test.ts src/sdk/__tests__/completion-authority-trace-capture-extension01.test.ts src/sdk/__tests__/background-owner-correlation-dogfood-profile.bocordp.test.ts --config vitest.config.ts` | 0 | 120 passed |
| 6 | Full `apps/vscode` vitest — regression (batched, set-compared) | see the procedure below | 1 | **identical failing-file set, 23 files each, zero new** |
| 7 | `sdk/packages/shared` typecheck | `cd sdk/packages/shared && bun run typecheck` | 0 | 0 errors |
| 8 | `apps/vscode` typecheck | `cd apps/vscode && bunx tsc --noEmit` | 0 | 0 errors |
| 9 | `sdk/packages/core` typecheck | `cd sdk/packages/core && bun run typecheck` | 2 | 40 errors — **identical to the stashed baseline** (zero new) |
| 10 | Biome — SDK packages | `bun x --bun @biomejs/biome check --diagnostic-level=error <6 SDK files>` | 0 | clean |
| 11 | Biome — extension | `cd apps/vscode && bun x --bun @biomejs/biome check --config-path ./biome.jsonc --diagnostic-level=error <6 extension files>` | 0 | clean |
| 12 | SDK build | `bun run build:sdk` | 0 | success |
| 13 | Extension build | `cd apps/vscode && bun run protos && bun esbuild.mjs` | 0 | success |
| 14 | `git diff --check` | `git diff --check` | 0 | clean |

### Gate 6 — the full-suite regression procedure, and why it is BATCHED

A single whole-suite `vitest run` **cannot** be used as the comparison unit in
this sandbox: the pre-existing vitest worker-teardown fault
(`EPERM: operation not permitted, kill`) aborts the run **before** the summary
is printed, so no reliable total is produced and the run is not even
deterministic. That fault originates in **pre-existing** test files (e.g.
`command-job-manager.sandbox-integration.test.ts`,
`containment-failure-c10-authority01.cfc10a01.test.ts`) and reproduces with the
change fully stashed.

The comparison is therefore made by **batching**, which is immune to the
teardown fault because each batch's per-file failure markers are printed
before the crash:

```bash
cd apps/vscode
find src -name '*.test.ts' -not -path '*/node_modules/*' | sort > /tmp/all-vsc-tests.txt
split -l 60 /tmp/all-vsc-tests.txt /tmp/vbatch-
for b in /tmp/vbatch-a*; do
  CLINEMM_EXPERIMENTAL_SANDBOX=off bun x vitest run --config vitest.config.ts \
    $(cat "$b" | tr '\n' ' ') > /tmp/vb.log 2>&1
  grep -E '❯ src/.*failed\)' /tmp/vb.log | sed -E 's/^ *❯ ([^ ]+).*/\1/' \
    | sort -u >> /tmp/fails.txt
done
sort -u /tmp/fails.txt
```

The procedure was run **twice under identical conditions** — once with the
change **stashed** (`git stash push -u`) and once with it **applied** — and the
two failing-file sets were compared with `comm`.

| Measurement | Failing test files |
|---|---|
| Change **stashed** (baseline) | 22 (batched extraction) → **23** after the one extraction gap was closed by direct measurement (below) |
| Change **applied** | 23 |
| **Difference** | **none** — identical set; zero new, zero removed |

**The one apparent difference, and how it was closed.** The batched extraction
reported `src/sdk/sdk-session-event-coordinator.test.ts` as failing only in the
with-change run. It was therefore measured **directly, in isolation, three
times on each tree**:

| Tree | Result (3 independent runs each) |
|---|---|
| Change **stashed** (baseline) | `2 failed \| 27 passed (29)` — **every run** |
| Change **applied** | `2 failed \| 27 passed (29)` — **every run** |

The failure is **deterministic and pre-existing**; the baseline batch had
simply not surfaced it because that file's failures are reported in a
different section format that the `❯ … failed)` marker does not match. With
that gap closed, the two sets are **identical**.

**Conclusion: the change introduces ZERO new `apps/vscode` test failures and
removes none.** The pre-existing failures are environmental (Seatbelt
unavailable headlessly, `mktemp` restriction, stale generated protobuf, worker
teardown) and are independently reproducible with the change stashed.

**Toolchain:** Bun 1.3.13 (the `.tool-versions` pins `bun 1.4.2`; the sandbox
image carries 1.3.13). Node is the runtime (not on the sandbox PATH).

**Environment note.** The background witnesses require the Seatbelt break-glass
`CLINEMM_EXPERIMENTAL_SANDBOX=off` and a resolvable POSIX shell. Both are
harness limitations, not production behaviour:

- The Seatbelt backend is not resolvable headlessly, so the manager fails
  closed with `sandbox-unavailable`. The pre-existing
  `vscode-run-commands-tool.background-state.test.ts` suite fails identically
  on the clean baseline for the same reason.
- The headless vscode stub exposes no terminal-profile API, so
  `getShellForProfile("default")` resolves to `"unknown"` and every spawn
  fails with `containment_failed`. The witness pins the shell to `/bin/sh`;
  the shell path is an INPUT to the manager, not the behaviour under test.
  The process supervision, the wait budget, the terminal transition, and the
  exit code remain the production ones.

Both substitutions are documented in the witness file itself.

never modified; the bridge only adds a category that the old capture does
not contain.

exit, so the exact process-success classification is genuinely
`CAPTURE_INSUFFICIENT`, and only the per-command category rescues it.

---

## 12. Source-bound artifact hashes

| Artifact | SHA-256 / blob id |
|---|---|
| `evidence/process-observation-excerpt.jsonl` | SHA-256 `42e611b7ce89dd18b79520da55dc157672c974d9f0bb5bceeedc084b84a1d7c7` |
| `sdk/packages/shared/src/runtime/model-behavior-trace.ts` | blob `ef771a755ce7af400a69a2908e94995c00c30409` |
| `sdk/packages/shared/src/index.ts` | blob `2171f79515d177826af87c5493b0ff9d9675cdce` |
| `sdk/packages/core/src/extensions/tools/definitions.ts` | blob `99348796e16d4a839aeb6cbb85aca48dc0075e2f` |
| `sdk/packages/core/src/extensions/tools/executors/command-process-observation.ts` | blob `67a486b9840cc18f8d4a534ba56f06f238ec0aff` |
| `sdk/packages/core/src/extensions/tools/command-process-observation.test.ts` | blob `888469ba27182e335e35408e2bf4d6c03b0678c6` |
| `sdk/packages/core/src/index.ts` | blob `120f8bbefc233cca128375c0f9df58978eadda4b` |
| `apps/vscode/src/sdk/vscode-run-commands-tool.ts` | blob `e35ab341ce83c2731895fceee7be7b5ade65afc9` |
| `apps/vscode/src/sdk/model-behavior-trace-runtime.ts` | blob `467d1636587258bd7c8fc104e1df455e4b1b1196` |
| `apps/vscode/src/sdk/normalize-agent-trace.ts` | blob `453749413e5b9153084635193bce1fe9f35ed59d` |
| `apps/vscode/src/test/cline-core-vitest-stub.ts` | blob `78bd38d6d40c30b2193dde2a21692ae2d0b25feb` |
| `apps/vscode/src/sdk/__tests__/command-process-outcome-trace-bridge01.test.ts` | blob `37097899b1f93cd930f1a3276510240b4a37aef3` |
| `apps/vscode/src/sdk/__tests__/command-process-outcome-portable-normalizer01.test.ts` | blob `ef84ae938532916d9fc4cd9d6f2487b26e5d187e` |
| `docs/.../evidence/process-observation-excerpt.jsonl` | blob `d005e96ee8bf6f41c517ec1787acc9e146452f9b` |

**`SUBJECT_HEAD`:** the implementation and focused tests are committed on the
existing `main` branch (§14). **No future commit SHA is predicted here.**

These blob ids are the FINAL state of each source artifact as committed; the
`REPORT.md` itself is the only file whose blob id changes after this table is
written (it records the table). Every id above was recomputed after the last
source edit, so the table is self-consistent with the committed tree.

---

## 13. Remaining limitations

1. **No installed-dogfood qualification.** The structural gates pass against
   the production seams, but no VSIX was installed and no live extension-host
   run was performed. The verdict is therefore `PASS_STRUCTURAL_VERIFIED`,
   not `PASS_LIVE_QUALIFIED`.
2. **The historical specimen was not re-captured.** The frozen pre-bridge
   capture was preserved untouched, as required. The fresh evidence in §7 is
   from controlled production-seam runs, not from an installed dogfood session.

---

## 14. Terminal verdict and the completion question

### The completion question

> For one real `run_commands` tool call containing multiple commands, and for
> another command whose background execution outlives its tool call, can
> ClineMM now identify each command's genuine terminal outcome without
> changing execution behavior?

**YES.**

- **Multiple commands in one tool call:** YES. The excerpt's `seq` 1–2 show
  ONE `toolCallId`, TWO distinct `commandIndex` values, and TWO distinct
  observed exit codes (**0** and **3**) — the per-command cardinality the
  recorder previously lacked. The aggregate `tool_finish.outcome` is
  unchanged.
- **A command whose background execution outlives its tool call:** YES. The
  excerpt's `seq` 3–4 show the NONTERMINAL `running` handoff, then the
  AUTHORITATIVE `exited` terminal fact **284 ms later and after the tool call
  returned**, with the REAL exit code (**7**) and the SAME `jobId` and
  `toolCallId`. The terminal fact is bound to the launch-time owner.
- **Without changing execution behavior:** YES. Trace-OFF neutrality is
  witnessed with identical tool results AND an identical execution ORDER
  witness; the typecheck, Biome, build, and full-suite regression gates show
  zero new diagnostics and zero new failures.
- **Exact identities:** YES — `(sessionId, toolCallId, commandIndex)`, plus
  the established `jobId` for background commands.
- **Conservation gates:** PASS.
- **Executed ablation:** PASS — removing only the process category makes the
  exact process-success classification `CAPTURE_INSUFFICIENT` while the
  tool-activity sequence stays observable.

### Verdict

```text
ENTRY_HEAD                      = baa66a6860a0f79ddedd6d37f18e1fcc71528323
ENTRY_TREE                      = bd1b7d2c67b822b1c257d2983c4c53afacad7f22
BRANCH                          = main (no ACT branch)
RED                             = REPRODUCED (3 per-command assertions + 1 delayed-terminal)
HALT_RED_NOT_REPRODUCED         = NOT TRIGGERED
HALT_CORRELATION_UNPROVEN       = NOT TRIGGERED
HALT_EXECUTION_SEMANTIC_DELTA   = NOT TRIGGERED
HALT_TRACE_OFF_DELTA            = NOT TRIGGERED
HALT_FALSE_TERMINALITY          = NOT TRIGGERED
HALT_EXIT_PROVENANCE_FALSE      = NOT TRIGGERED
HALT_PRIVACY                    = NOT TRIGGERED
HALT_UNEXPECTED_DIRT            = NOT TRIGGERED
ABLATION_CLASSIFICATION         = EXECUTED (not HYPOTHESIS_ONLY)
INSTALLED_DOGFOOD               = NOT PERFORMED
VERDICT                         = PASS_STRUCTURAL_VERIFIED
```

**`PASS_STRUCTURAL_VERIFIED`**

The implementation, the focused tests, this report, and the evidence excerpt
are committed on the existing `main` branch. `.factory/epic-board.md` is
updated once at terminal closure and committed with the closure. No push, no
install, no VSIX.

3. **Foreground terminal-closed and unobserved commands are `unknown`, not a
   distinct class.** The source authority cannot distinguish them from each
   other with an exit code, and inventing a distinction would be an
   inference. Both are `unknown` with no exit code.
4. **The Seatbelt break-glass and the pinned shell are harness
   substitutions** (§11). They substitute only the sandbox backend and the
   shell path — never the supervision, the wait budget, the terminal
   transition, or the exit code.
5. **23 pre-existing `apps/vscode` vitest test files fail.** They are
   unchanged by this ACT — the failing-file set is identical with the change
   stashed and with it applied (zero new, zero removed; §11 gate 6) — and are
   unrelated environmental baselines. A whole-suite run in this sandbox cannot
   print a reliable total because the pre-existing worker-teardown `EPERM`
   fault aborts the run before its summary, which is why the comparison is
   made by batching and set comparison rather than by a single total.
6. **40 pre-existing `sdk/packages/core` typecheck diagnostics remain.** They
   are unchanged by this ACT (identical counts before and after).


**No correctness verdict (Q3) is claimed.** That belongs to the independent
evaluator.

| Affected SDK/extension build | Mandatory | **PASS** | `bun run build:sdk` → exit 0; `cd apps/vscode && bun run protos && bun esbuild.mjs` → exit 0 |
| `git diff --check` | Mandatory | **PASS** | exit 0, no output |


Two hardening additions to the recorder's forbidden-key set were required by
the G9 adversary gate: `args` and `argv` (argument arrays were not previously
on the list).
