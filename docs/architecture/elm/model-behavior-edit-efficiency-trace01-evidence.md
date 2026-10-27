# ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01 — Source-Bound Evidence

**Status:** `PASS_STRUCTURAL_ONLY` (the editing-efficiency trace, its
executable witnesses and the comparator section are structurally complete and
green; live qualification requires installed-VSIX captures of actual editing
tasks — see §9).

**ENTRY_HEAD:** `6cb09708f9f87780292b391d046bb7c4c7b644f0` (main).
**Scope:** the EXISTING Model Behavior Trace, extended — not a second
recorder.

---

## 1. Objective (as built)

Determine how effectively M3 and M3.1 modify source files, and keep the
chain's links separate:

```
edit requested → authorized → executor invoked → mutation applied
  → file revision observed → subsequent revision → verification
```

A generic tool success is **never** treated as evidence of a source
modification. The three links that can be observed are recorded as three
distinct event kinds.

---

## 2. R0 — The actual production seams (reconnaissance)

| Layer | File | What it can authoritatively report |
|---|---|---|
| Tool registry | `sdk/packages/core/src/extensions/tools/definitions.ts:1183-1190` | Which native editing tool EXISTS. `editor` and `apply_patch` are **mutually exclusive**: when the editor executor is present the `apply_patch` tool is not registered at all. |
| Host override | `apps/vscode/src/sdk/sdk-diff-edit-coordinator.ts` | The host wraps the SDK executors to add a diff preview; it delegates to `createEditorExecutor()` / `createApplyPatchExecutor()`. |
| Write layer | `sdk/packages/core/src/extensions/tools/executors/editor.ts`, `.../apply-patch.ts` | The ONLY layer that knows whether a file was written, whether the write was a no-op, and whether a multi-file patch partially applied. |
| Runtime | `sdk/packages/agents/src/agent-runtime.ts` | The authorization state (`approved` / `rejected` / `skipped`) and the C1.2 `toolExecutionInvoked` authority. |
| Recorder | `sdk/packages/shared/src/runtime/model-behavior-trace.ts` | The bounded ring, the sanitizer, the ephemeral keyed fingerprints, the toggle and the dump. |

### 2.1 Which layer reports which link

| Link | Authority | Why |
|---|---|---|
| **edit requested** | `AgentRuntime` (the tool boundary) | Only the runtime knows the authorization state; the executor cannot infer it. |
| **authorized** | `AgentRuntime` | Same. The outcome is tracked STRUCTURALLY, never by reading a message string. |
| **executor invoked** | `AgentRuntime` (C1.2 `toolExecutionInvoked`) | Set immediately before `tool.execute(...)`. |
| **mutation applied** | The write layer | The only layer that performs the write. |
| **partial application** | The write layer | `applyChanges` writes file-by-file, so a later failure leaves earlier files mutated. |

### 2.2 The routing of `editor` and `apply_patch`

The registry registers the editor tool **else** the patch tool — never both.
The trace therefore records exactly one native editing tool per run, and the
`edit_application.toolName` field names the tool that ACTUALLY ran. The
`effective_model_config` event already carries the full `toolNames` list, so
the real availability of both tools is visible in the same capture.

---

## 3. What was added to the existing flight recorder

**No new recorder, no new command, no new public protocol field.** The
existing `Cline Debug: Toggle Model Behavior Trace` and
`Cline Debug: Dump Model Behavior Trace` are unchanged.

### 3.1 New event kinds

| Event | Payload |
|---|---|
| `edit_attempt` | `toolCallId`, `toolName`, `operation`, `fileIdentity`, `targetCount`, `requestedChars`, `approvalOutcome`, `executionInvoked` |
| `edit_application` | `toolName`, `outcome`, `failureCategory?`, `requestedFileCount`, `mutatedFileCount`, `unmutatedFileCount`, `noOp`, `fileMutations?`, `durationMs?`, `provenance` |
| `edit_failure` | `failureCategory`, `mutatedFileCount?`, `requestedFileCount?`, `unmutatedFileCount?` |

### 3.2 Privacy

* No raw path, no old/new text, no patch body, no command is ever recorded.
* File identity and content version are **ephemeral keyed HMACs** computed by
  the recorder, which owns the key. They are stable WITHIN one capture and
  not comparable across captures.
* The runtime additionally **discards** a sink fingerprint that echoes the
  path back (`fingerprintEditPath`), so a misbehaving sink cannot leak the
  filesystem layout.
* The digests are truncated to 32 hex characters so they always survive the
  payload sanitizer's length ceiling.

### 3.3 Disabled-path guarantees

* `DEFAULT_OFF`: the recorder produces nothing until the operator toggles it.
* The executor's observation channel is **absent** when the trace is off, so
  the disabled path performs no extra read, no fingerprint and no allocation.
* The runtime adds the sink to the tool-context metadata ONLY when
  `isTraceEnabled()` is true (`session-runtime-orchestrator.ts`).
* Instrumentation failures are swallowed at every entry point: an edit can
  never fail because of the trace.

### 3.4 Bounded cost

Files larger than `EDIT_OBSERVATION_MAX_FILE_BYTES` (512 KiB) are written
normally, but their content is not measured; the observation records
`MEASUREMENT_SKIPPED_SIZE_LIMIT` rather than letting diagnostics slow the
edit.


---

## 4. Edit failures (structural classification)

The categories are produced from **typed** executor results, never by
substring-searching model-generated error prose:

`text_not_found`, `multiple_matches`, `invalid_patch`, `hunk_mismatch`,
`path_rejected`, `permission_denied`, `approval_rejected`, `timeout`,
`runtime_abort`, `unknown`.

The editor executor raises `EditOperationError` (a typed error carrying the
category); the patch executor's `DiffError` is mapped onto the patch
categories; a Node `errno` code maps onto the filesystem categories.

---

## 5. Shell-origin separation

`run_commands` can also modify source files, but a successful command does
not establish which files changed. The comparator therefore keeps:

* **shell call count and execution outcome** (separate activity),
* **independently observed workspace changes** (the native-edit counters),
* **native-editor-attributed modifications**.

A run with shell calls but no native edit observation is reported as
`FILE_CHANGES_OBSERVED / EDIT_ORIGIN_UNAVAILABLE` — never as "zero edits".
No Git command is executed inside a shell tool call for instrumentation.

---

## 6. Executable witnesses

| ID | Scenario | Evidence |
|---|---|---|
| E01 | Successful targeted replacement | one applied mutation, changed content version |
| E02 | Replacement text absent | failure, `text_not_found`, zero mutations, file unchanged |
| E03 | Multiple matches | `multiple_matches` rejection, zero mutations |
| E04 | Successful no-op | applied, `noOp: true`, identical pre/post version |
| E05 | File created | no pre-version, new post-version |
| E06 | A → B → A | reversion recognized (final version == initial version) |
| E07 | A → B → C | churn measured, **no** reversion claimed |
| E08 | Multi-file patch succeeds | every target observed (`2 of 2`) |
| E09 | Multi-file patch partially applies | `1 of 2 files mutated` preserved, NOT "0 applied" |
| E10 | Approval denied | attempt recorded with `approvalOutcome: "rejected"`, executor NOT invoked, no application event |
| E10b | Authorized edit | exactly ONE attempt (no double counting) |
| E11 | Editing via shell command | NO native-editor attribution invented |
| E12 | Same filename, different sessions | correlation isolated by session/run/tool-call id |
| E13 | Trace OFF | zero observations, identical semantic result |
| E14 | Sensitive file/path/content | never exposed in the JSONL |
| E14b | A sink that echoes the path | discarded; identity reported unavailable |
| E15 | Tool-level success, inner edit failure | failure NOT mislabeled as applied |
| E16 | Final snapshot after several edits | retained vs reverted distinguished |
| E17 | Tool routing | the recorded tool is the one that actually ran |

The mutation-producing executor is **never mocked**: the tests drive the REAL
`createEditorExecutor()` / `createApplyPatchExecutor()` against REAL
temporary files.

### 6.1 RED/GREEN mutation witnesses

`edit-efficiency-trace01.mutation.test.ts` rewrites the production executor
source into a scratch copy and imports the mutated module:

| Mutation | Target | Result |
|---|---|---|
| **M1** | The catch block reports the failure as `applied` | The E02 witness goes RED: the false success classification is detected. |
| **M2** | The PRE content version is dropped | The E06 witness goes RED: the reversion becomes indistinguishable from churn. |

### 6.2 Test totals

| Suite | Result |
|---|---|
| `sdk/packages/core` — edit-efficiency witnesses | 18 passed |
| `sdk/packages/agents` — agent-runtime witnesses | 7 passed |
| `sdk/packages/shared` — recorder witnesses | 18 passed |
| `apps/vscode` — comparator + runtime witnesses | 75 passed (all trace suites) |

---

## 7. The comparator's Editing Efficiency section

`scripts/compare-model-behavior-traces.ts` gains an **Editing Efficiency**
section (Markdown + JSON) reporting, for M3 and M3.1:

native edit attempts, applied mutations, failures, distinct files modified,
edits per file, no-op edits, reverted mutations, revision churn, time to the
first **applied** edit, observed file-write duration, shell calls (separate
activity), accepted executable gates, and the edit-origin marker.

Provenance is explicit: mutation counts are `REAL_PRODUCTION_SEAM`; churn and
reversion are `INFERRED`. The section states that these numbers do **not**
rank the models.

---

## 8. Verification and closure

| Gate | Result |
|---|---|
| Real editor/patch mutation boundaries exercised | PASS (16 core witnesses) |
| Failed writes cannot masquerade as successful edits | PASS (E02, E15, M1) |
| Partial multi-file application accurately represented | PASS (E09) |
| Revision churn and reversion witnesses | PASS (E06, E07, M2) |
| Native and shell-origin evidence distinct | PASS (E11) |
| No sensitive source data leaked | PASS (E14, E14b) |
| Trace OFF execution conserved | PASS (E13) |
| Existing Model Behavior Trace tests | PASS (unchanged behaviour) |
| SDK build | PASS (`bun run build:sdk`) |
| TypeScript | PASS (no new diagnostics; the SDK typecheck count is unchanged from the baseline) |
| Biome | PASS (all touched files clean) |
| Extension build | PASS (`bun esbuild.mjs`) |

**Closure: `PASS_STRUCTURAL_ONLY`.**

---

## 9. Live qualification (not performed here)

Live qualification requires installed-VSIX captures of ACTUAL editing tasks
run against M3 and M3.1, with the trace toggled on, then compared with
`scripts/compare-model-behavior-traces.ts`. This ACT delivers the
instrumentation and the structural evidence; the live capture is a separate
step.

---

## 10. NOT changed

Edit behaviour, approval policy, tool routing, model configuration, lifecycle
semantics, the recorder's ring/sanitizer/toggle/dump, the public protocol
surface, the React/webview layer, the comparator's fail-closed comparability
decision, and the existing Model Behavior Trace event kinds. No new recorder,
no generic observability framework, no unrelated refactor.
