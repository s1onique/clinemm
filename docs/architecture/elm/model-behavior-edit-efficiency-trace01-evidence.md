# ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01 — Source-Bound Evidence

**Status:** `PASS_STRUCTURAL_ONLY` (the editing-efficiency trace, its
executable witnesses and the comparator section are structurally complete and
green; live qualification requires installed-VSIX captures of actual editing
tasks — see §9).

**ENTRY_HEAD:** `6cb09708f9f87780292b391d046bb7c4c7b644f0` (main).
**CORRECTION:** `ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01-CORR01`
applied on top of `f65b722e5` — see §5.1–§5.3, §6.1.1 and §8.1.
**Scope:** the EXISTING Model Behavior Trace, extended — not a second
recorder.

---

## 0. CORR01 — what this correction fixed

The review of `f65b722e5` returned `HALT_EDIT_EVIDENCE_CORRELATION` with two
source-confirmed P0 evidence defects and two bounded P1 implementation
issues. All four are corrected here:

| ID | Defect | Correction |
|---|---|---|
| **P0-1** | The comparator fabricated evidence of file changes: a read-only `run_commands` satisfied the `FILE_CHANGES_OBSERVED` predicate | Shell activity without native edit telemetry is now `EDIT_ORIGIN_UNOBSERVED`; an observed file change requires an independent real workspace delta (§5.1) |
| **P0-2** | The native edit application lost its tool-call identity, so applications could not be joined to their attempts | The executor forwards the runtime's `toolCallId` verbatim; the comparator joins by EXACT session/run/tool-call identity only (§5.3) |
| **P0-3** | The applied-mutation accounting counted one per successful operation, not per mutated file | The accounting is layered: operations, files written, verified content changes, unverified changes, no-ops and partial mutations (§5.2) |
| **P1-1** | The M2 mutation witness did not discriminate the defect | The witness evaluates the ACTUAL reversion invariant against the mutated executor and demonstrates RED, with a GREEN control (§6.1.1) |
| **P1-2** | `apply_patch` computed the patch-target count outside the observation guard | The count is computed inside the guard, restoring the trace-OFF fast path (§3.3, M3) |

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
| `edit_application` | `toolCallId?`, `toolName`, `outcome`, `failureCategory?`, `requestedFileCount`, `mutatedFileCount`, `unmutatedFileCount`, `noOp`, `fileMutations?`, `durationMs?`, `provenance` |
| `edit_failure` | `toolCallId?`, `failureCategory`, `mutatedFileCount?`, `requestedFileCount?`, `unmutatedFileCount?` |

**`toolCallId` on the write layer (CORR01).** The runtime already stamped the
tool-call identity into the trusted tool-context metadata, but the executor
did not forward it, so an application/failure could not be joined to its
`edit_attempt`. The executor now forwards the identity **verbatim** on the
application, the failure and the raw payload. The identity is never
synthesized: when the runtime supplied none, the observation carries no
`toolCallId` and stays unverified.

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
* The `apply_patch` executor computes its patch-target count **inside** the
  `if (observation)` guard (CORR01), so the disabled path performs no
  additional scan of the patch body.
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

No Git command is executed inside a shell tool call for instrumentation.

### 5.1 The edit-origin marker (CORR01)

The trace observes the **WRITE LAYER**, not the workspace. There is no
independent workspace-delta source, so the trace cannot establish that a
shell call changed anything.

The pre-CORR01 comparator inferred `FILE_CHANGES_OBSERVED` from the mere
PRESENCE of a shell call. That fabricated an observation — a read-only
`run_commands` satisfied the predicate, and the report then claimed a file
change that nothing had measured.

The corrected rule:

| Situation | Marker |
|---|---|
| Shell activity, no native edit telemetry, **no independent workspace delta** | `EDIT_ORIGIN_UNOBSERVED` |
| An independent real workspace delta establishes a file change | `FILE_CHANGES_OBSERVED / EDIT_ORIGIN_UNAVAILABLE` |
| Native edit telemetry present | `NATIVE_EDIT_ORIGIN_OBSERVED` |

No independent workspace-delta source exists today, so the second row is
never reached; the field exists so the distinction cannot be re-collapsed
into a guess. The JSON summary exposes `workspaceDeltaObserved` and
`editOriginUnobserved` separately.

### 5.2 The accounting layers (CORR01)

The pre-CORR01 comparator collapsed four DIFFERENT facts into one
`appliedMutations` counter that incremented once per successful
`edit_application`. The corrected model keeps them apart:

| Metric | Meaning |
|---|---|
| `successfulEditOperations` | edit operations that completed without an error (an OPERATION count) |
| `filesWritten` | files the write layer actually wrote (the MUTATED-FILE count) |
| `filesWithVerifiedContentChange` | written files whose CONTENT was observed to change |
| `filesWithUnverifiedContentChange` | written files whose content measurement was SKIPPED — unverified, not unchanged |
| `noOpEditOperations` | successful operations that left every written file byte-identical |
| `partialMutationOperations` | operations that wrote at least one file AND failed (a partially applied multi-file patch) |

| Actual event | Pre-CORR01 | CORR01 |
|---|---|---|
| Successful two-file patch | 1 | `successfulEditOperations: 1`, `filesWritten: 2` |
| Failed patch after first write | 0 | `failedEdits: 1`, `filesWritten: 1`, `partialMutationOperations: 1` |
| Successful no-op write | 1 | `filesWritten: 1`, `noOpEditOperations: 1`, `filesWithVerifiedContentChange: 0` |

### 5.3 Causal correlation (CORR01)

An application is joined to its `edit_attempt` **only** by EXACT identity:
the same session, the same run and the same tool-call id. The join is
never made by timestamp proximity and never by array adjacency — with
several edits in one run, adjacency would happily pair a write with the
wrong request.

* An application whose identity is **missing** stays UNVERIFIED. The write
  really happened, so it is counted on its own, but it is never paired.
* An application whose identity matches **more than one** attempt is
  **ambiguous** and is rejected rather than paired.

The summary exposes `correlatedEditApplications`, `uncorrelatedEditApplications`
and `unfulfilledEditAttempts`, with `correlationProvenance: "EXACT_IDENTITY"`.

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
| E18 | Tool-call identity (CORR01) | the application and the failure carry the SAME `toolCallId` as the attempt |
| E19 | No trusted identity (CORR01) | the observation carries NO `toolCallId`, so it stays unverified |

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
| **M3** | The patch-target scan is hoisted out of the `if (observation)` guard | The tracing-OFF fast-path contract goes RED: the disabled path would scan the patch body. |

Every mutation has a **GREEN CONTROL**: the SAME predicate is evaluated
against the REAL production implementation and must hold. Without the
control, a predicate that always returned the broken value would also
"prove" that the mutation is detected.

#### 6.1.1 The M2 witness defect (CORR01)

The pre-CORR01 M2 witness was **vacuous in two independent ways**:

1. It asserted only the SHAPE of the mutated output (`[B, A]`, length 2).
   That shape is produced by BOTH the mutated and the unmutated
   implementation once the POST versions are collected on their own, so the
   witness could not discriminate the defect at all — it would have passed
   against the broken code.
2. Its textual mutation targeted the FIRST `recordMutation` call site in
   `editor.ts`, which is the `createFile` path. The witness exercises the
   `replaceInFile` path, so the mutation never touched the code under test.

The corrected witness:

* evaluates the **ACTUAL reversion invariant** — the exact predicate the E06
  witness asserts — against the mutated implementation and asserts it
  **FAILS**;
* anchors the mutation on the `replaceInFile` call site, so it really
  rewrites the code path the witness exercises;
* carries a GREEN CONTROL that asserts the same invariant **HOLDS** against
  the production implementation.

### 6.2 Comparator witnesses

`apps/vscode/src/sdk/__tests__/model-behavior-editing-efficiency-comparator01.test.ts`
drives the REAL comparator CLI as a subprocess:

| ID | Scenario | Evidence |
|---|---|---|
| CE01/CE02 | attempts, operations, written files, failures, files, edits-per-file | reported from the OBSERVED edit events |
| CE03 | a no-op edit | counted as a no-op AND as a write, never as a content change |
| CE04 | A → B → A | reversion recognized |
| CE05 | A → B → C | churn measured WITHOUT falsely claiming a reversion |
| CE06/CE07 | shell activity | separate; the origin is `EDIT_ORIGIN_UNOBSERVED`, never an observed file change |
| CE08 | accepted executable gates | stay `UNAVAILABLE_FROM_TRACE` |
| CE09 | exact tool-call identity (CORR01) | the application is joined to its attempt |
| CE10 | missing identity (CORR01) | the application stays UNVERIFIED — adjacency is not an identity |
| CE11 | ambiguous identity (CORR01) | the pair is REJECTED, not guessed |
| CE12 | two-file patch / partial patch (CORR01) | 1 operation ↔ 2 files; a failed-after-first-write patch is a PARTIAL mutation |
| CE13 | skipped content measurement (CORR01) | UNVERIFIED, never counted as "unchanged" |

### 6.3 Test totals

| Suite | Result |
|---|---|
| `sdk/packages/core` — edit-efficiency witnesses | 19 passed |
| `sdk/packages/core` — edit-efficiency mutation witnesses | 5 passed |
| `sdk/packages/agents` — agent-runtime witnesses | 7 passed |
| `sdk/packages/shared` — recorder witnesses | 18 passed |
| `apps/vscode` — comparator witnesses | 11 passed |

---

## 7. The comparator's Editing Efficiency section

`scripts/compare-model-behavior-traces.ts` gains an **Editing Efficiency**
section (Markdown + JSON) reporting, for M3 and M3.1:

native edit attempts, successful edit operations, files written, files with a
verified content change, files with an unverified content change, no-op edit
operations, partial-mutation operations, failures, distinct files modified,
edits per file, reverted mutations, revision churn, correlated / uncorrelated
applications, unfulfilled attempts, time to the first **applied** edit,
observed file-write duration, shell calls (separate activity), accepted
executable gates, and the edit-origin marker.

Provenance is explicit: mutation counts are `REAL_PRODUCTION_SEAM`; churn and
reversion are `INFERRED`; the application-to-attempt join is
`EXACT_IDENTITY`. The section states that these numbers do **not** rank the
models.

---

## 8. Verification and closure

| Gate | Result |
|---|---|
| Real editor/patch mutation boundaries exercised | PASS (19 core witnesses) |
| Failed writes cannot masquerade as successful edits | PASS (E02, E15, M1) |
| Partial multi-file application accurately represented | PASS (E09, CE12) |
| Revision churn and reversion witnesses | PASS (E06, E07, M2 + GREEN control) |
| Native and shell-origin evidence distinct | PASS (E11, CE06/CE07) |
| The tool-call identity reaches the write layer | PASS (E18, E19) |
| The application-to-attempt join is exact-identity only | PASS (CE09, CE10, CE11) |
| The edit-origin marker never fabricates a file change | PASS (CE06/CE07) |
| The accounting layers are separated | PASS (CE12, CE13) |
| No sensitive source data leaked | PASS (E14, E14b) |
| Trace OFF execution conserved | PASS (E13, M3 + GREEN control) |
| Existing Model Behavior Trace tests | PASS (unchanged behaviour) |
| SDK build | PASS (`bun run build:sdk`) |
| TypeScript | PASS (no new diagnostics; the deduplicated core diagnostic set is IDENTICAL to the baseline — 29 before, 29 after, zero added, zero removed) |
| Biome | PASS (all touched files clean) |
| `apps/vscode` typecheck | PASS (`tsc --noEmit`, exit 0) |

### 8.1 Targeted RED/GREEN (CORR01)

Each correction was demonstrated RED against the pre-CORR01 behaviour and
GREEN after it:

| Correction | Reverted | RED observed |
|---|---|---|
| P0-2 tool-call identity | the `toolCallId` forwarding removed from all three executor sites | E18: `expected undefined to be 'call-42'` / `'call-99'` — 2 failed |
| P0-1 edit-origin marker | the fabricated `FILE_CHANGES_OBSERVED / EDIT_ORIGIN_UNAVAILABLE` restored | CE06/CE07: `expected 'FILE_CHANGES_OBSERVED / EDIT_ORIGIN_U…' to be 'EDIT_ORIGIN_UNOBSERVED'` — 1 failed |
| P0-3 + correlation | the one-per-operation counter restored, and the join relaxed to adjacency / ambiguity-tolerant | CE10, CE11, CE12 — 3 failed (`expected 1 to be +0`, `expected 1 to be 3`) |

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
