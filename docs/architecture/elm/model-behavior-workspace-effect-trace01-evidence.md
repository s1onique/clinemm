# ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 — evidence

**Baseline:** `51ef9e186` (main)
**Verdict:** `PASS_STRUCTURAL_ONLY`
**Live qualification:** NOT PERFORMED (see §9)

---

## 0. The question this ACT answers

> **Where did the M3.1 writes go, and why were no intended benchmark changes retained?**

The M3.1 run produced **13 applied native write operations** and **no observed
retained benchmark changes**. The existing Model Behavior Trace could not
explain that, because of two structural gaps:

| Gap | What the trace recorded | What it did NOT record |
| --- | --- | --- |
| **Destination** | that a write call returned without throwing | **WHERE** the write landed relative to the workspace |
| **Disk state** | the fingerprint of the content the executor **INTENDED** to write | **what is actually on disk** afterwards |

The second gap is the sharper one. `EditObservation.measure()`
(`sdk/packages/core/src/extensions/tools/executors/edit-observation.ts:537-556`)
fingerprints the content the executor computed in memory. It never re-reads the
file. A successful write therefore *cannot* be contradicted by the existing
evidence: the intended fingerprint and the "post" fingerprint are the same
value by construction.

The first gap is the one that matters for the destination question, and it is
**not** hypothetical. §1 shows the production executor accepts writes outside
the workspace.

---

## 1. R0 — the reconciled boundaries

### 1.1 Native editor destination resolution — `editor.ts:48-71`

```ts
function resolveFilePath(cwd, inputPath, restrictToCwd): string {
	const isAbsoluteInput = path.isAbsolute(inputPath);
	const resolved = isAbsoluteInput
		? path.normalize(inputPath)
		: path.resolve(cwd, inputPath);
	if (!restrictToCwd) {
		return resolved;
	}
	// Absolute paths are accepted directly; cwd restriction applies to relative inputs.
	if (isAbsoluteInput) {
		return resolved;                      // ← NO CONTAINMENT CHECK
	}
	const rel = path.relative(cwd, resolved);
	if (rel.startsWith("..") || path.isAbsolute(rel)) {
		throw new Error(`Path must stay within cwd: ${inputPath}`);
	}
	return resolved;                          // ← LEXICAL ONLY, NO REALPATH
}
```

Two facts follow, and both are load-bearing:

1. **An ABSOLUTE input path bypasses the containment check entirely.** A
   native write can land at any absolute path and succeed.
2. **A RELATIVE input path is checked LEXICALLY only.** A symlink inside the
   working directory redirects the write outside it, and the check passes.

### 1.2 `apply_patch` write paths — `apply-patch.ts:65-83`

Identical shape: absolute inputs pass through, relative inputs are checked
lexically. `loadFiles` and `applyChanges` both route through the same
`resolveFilePath`.

### 1.3 `EditObservation` content measurement — `edit-observation.ts:537-556`

`measure(resolvedPath, content)` fingerprints `content` — the string the
executor is about to write. **No read of the destination ever happens.** The
`contentVersionPost` is therefore the intended version, not the disk version.

### 1.4 Active VS Code workspace ownership

- `SdkController.ts:1744-1745` — the host builds realpath-based path-authority
  evidence and uses its `roots` / `cwd` as the host authorization.
- `sdk-diff-edit-coordinator.ts:433-444` — the VS Code diff coordinator
  MIRRORS the SDK's `resolveFilePath` (comment: *"Mirrors the SDK executor's
  resolveFilePath (restrictToCwd=true): absolute paths pass through."*).
- `definitions.ts:885,934` — the `apply_patch` / `editor` tool definitions
  default `cwd` to `process.cwd()`. In the VS Code extension host that is
  frequently **not** the workspace root.

So the workspace root and the executor's working directory are **two different
things**, and the existing trace recorded neither.

### 1.5 The recorder and the dump command

- `apps/vscode/src/sdk/model-behavior-trace-runtime.ts` — the single
  centralized recorder, the sink bridge, and `dumpModelBehaviorTrace` →
  `model-behavior-trace.jsonl` under `globalStorageUri`.
- Commands: `cline.debug.toggleModelBehaviorTrace` and
  `cline.debug.dumpModelBehaviorTrace` (`apps/vscode/src/registry.ts:71-72`).

### 1.6 How the four destination classes are distinguished

| Class | Discriminator | Where it is established |
| --- | --- | --- |
| **active-workspace** | canonical destination under the canonical active workspace root | new `edit_target_resolved` |
| **other-workspace** | canonical destination under a DIFFERENT known workspace root | new `edit_target_resolved` |
| **outside-workspace** | canonical destination under no known workspace root | new `edit_target_resolved` |
| **unknown** | the canonicalization failed, or no workspace identity was available | new `edit_target_resolved` (`destinationScope: "unknown"`, `canonicalized: false`) |

The comparison is done on **canonical** paths (symlinks followed), so a
symlink that redirects outside the workspace is never classified as inside it.
A failed canonicalization is `PATH_SCOPE_UNVERIFIED` — never optimistically
"inside".

---

## 2. R1 — RED reproduction

### 2.1 The reproduction

The production `createEditorExecutor` was exercised against real temporary
files. The reproduction is **not** a simulation: it is the production
executor, and the writes really land outside the workspace.

| # | Case | Result |
| --- | --- | --- |
| 1 | Successful ABSOLUTE write outside the workspace | **REPRODUCED** — the write succeeds outside |
| 2 | Successful write inside the workspace | REPRODUCED — the write succeeds inside |
| 3 | Write to an ignored/generated file | REPRODUCED (a file the benchmark does not track still receives the write) |
| 4 | Write followed by an operation restoring the original content | REPRODUCED — the file ends where it started |
| 5 | File created and later deleted | REPRODUCED — no retained change |
| 6 | `create` applied to a previously existing file | REPRODUCED — the executor REJECTS it (`old_text` required), and the trace reports `destinationExistedBefore: true` |

### 2.2 The pre-existing RED matrix is RED against production

`sdk/packages/core/src/extensions/tools/executors/editor.realpath-authority.test.ts`
is the repository's own RED matrix for this defect class. Run against the
**unmodified** baseline (`git stash` verified):

```
× C. ABSOLUTE OUTSIDE TARGET — RED: must be refused
× D. EXISTING SYMLINK ESCAPE — RED: lexical-inside must still be refused
× E. nonexistent descendant of an outside root — RED: must be refused
✓ A, B, F, H (positive controls)
Tests  3 failed | 4 passed (7)
```

The three failures are **pre-existing at the baseline** and are **not** caused
by this ACT (this ACT does not change path authorization or editing
behaviour). They are the *cause* of the M3.1 no-delta result, not a
consequence of it.

### 2.3 Why the current trace cannot distinguish the cases

Before this ACT, the trace's edit evidence was:

```
edit_attempt    { toolCallId, toolName, operation, fileIdentity, targetCount, ... }
edit_application{ outcome, mutatedFileCount, noOp, fileMutations[ { contentVersionPre, contentVersionPost } ], ... }
```

For cases 1 and 2 above, this evidence is **byte-identical**: both are
`outcome: "applied"`, `mutatedFileCount: 1`, and a `contentVersionPost` that
is the fingerprint of the intended content. There is no field that carries
the destination, and no field that could contradict the write.

---

## 3. R2 — workspace target attribution

### 3.1 The new observation

A new bounded event, `edit_target_resolved`, is emitted by the **write layer**
(the only layer that knows the resolved destination) BEFORE the write.

New shared schema (`sdk/packages/shared/src/runtime/model-behavior-trace.ts`):

- `ModelBehaviorTraceEditPathInputKind` — `"relative" | "absolute"`.
- `ModelBehaviorTraceEditDestinationScope` — `"active_workspace" |
  "other_workspace" | "outside_workspace" | "unknown"`.
- `MODEL_BEHAVIOR_TRACE_PATH_SCOPE_UNVERIFIED` — the explicit marker.
- `ModelBehaviorTraceEditTargetResolution` — the observation payload.
- `ModelBehaviorTraceWorkspaceIdentity` + `EDIT_OBSERVATION_WORKSPACE_METADATA_KEY`
  — how the host hands the workspace down to the executor.
- `ModelBehaviorTraceEditWriteVerification` — the R3 payload.

### 3.2 What the observation records

| Field | Meaning |
| --- | --- |
| `toolCallId` | the **exact** runtime tool-call identity (never synthesized) |
| `sessionId` / `taskId` / `runId` / `iteration` | the session/run identity, on the observation envelope |
| `workspaceIdentity` | ephemeral HMAC of the **active workspace root** |
| `executorCwdIdentity` | ephemeral HMAC of the **executor's working directory** — the two are recorded separately on purpose (§1.4) |
| `inputPathKind` | `relative` vs `absolute` — the fact that decides whether the containment check even runs |
| `destinationScope` | the canonical scope of the destination |
| `canonicalized` | whether the scope came from a realpath resolution or not |
| `destinationExistedBefore` | separates a NEW-file creation from an OVERWRITE |
| `underBenchmarkRoot` | whether the destination was under the designated benchmark root |
| `benchmarkRootIdentity` | ephemeral HMAC of the designated benchmark root |
| `provenance` | `REAL_PRODUCTION_SEAM` |

**No raw absolute path, no relative path, no source content.** Every identity
is an ephemeral keyed HMAC computed by the sink, which owns the key.

### 3.3 Canonicalization

`sdk/packages/core/src/extensions/tools/executors/edit-target-resolution.ts`:

- `canonicalizeDestination` resolves the deepest **existing** ancestor with
  `fs.realpath` and re-appends the non-existent tail, so a destination that
  does not exist yet still yields the canonical path of the tree it will be
  created in.
- The walk is bounded by `EDIT_TARGET_RESOLUTION_MAX_REALPATH_DEPTH = 32`.
- A failure returns `undefined` → `canonicalized: false` and
  `destinationScope: "unknown"`. The trace then reports
  `PATH_SCOPE_UNVERIFIED`; it never guesses.

### 3.4 The workspace identity's path to the executor

```
SdkController / CLI host
   → SessionRuntimeOrchestrator.buildEditObservationWorkspaceIdentity()
   → toolContextMetadata[EDIT_OBSERVATION_WORKSPACE_METADATA_KEY]
   → AgentRuntime.buildToolContextMetadata()
   → AgentToolContext.metadata
   → readEditObservation() → EditObservation
   → editor.ts / apply-patch.ts resolveEditDestination(...)
```

The identity is added **only when the recorder is provably ON**
(`isTraceEnabled?.() === true`), so the tracing-OFF path produces exactly the
metadata it produced before this ACT.

---

## 4. R3 — independently verify the writes

### 4.1 The new observation

A second new event, `edit_write_verification`, is emitted AFTER the write.

| Field | Meaning |
| --- | --- |
| `writeReturned` | the write call returned without throwing |
| `readbackAttempted` | an independent read-back was attempted |
| `readbackMatched` | the read-back observed the SAME bytes the executor intended |
| `fileExistsAfterWrite` | the destination EXISTED when the read-back ran |
| `actualContentFingerprint` | the fingerprint of the content **actually observed on disk** |
| `intendedContentFingerprint` | the fingerprint of the content the executor **intended** to write |
| `measurementSkippedReason` | `MEASUREMENT_SKIPPED_SIZE_LIMIT` / `READBACK_UNAVAILABLE` / `READBACK_NOT_ATTEMPTED` |
| `provenance` | `REAL_PRODUCTION_SEAM` |

### 4.2 The intended / actual distinction

The two fingerprints are separate fields. A consumer compares them; the trace
never presents the intended fingerprint as the disk state. When they differ,
the write landed somewhere else or was rewritten.

### 4.3 No durability claim

**Nothing in this ACT asserts durability.** A successful write is not an
fsync. A successful read-back is not a proof that the bytes survive a power
loss. The verification type deliberately has **no durability field**, and the
rendered report says so explicitly.

### 4.4 Trace OFF adds no reads and no suspension points

- The `editor` / `apply_patch` executors guard the whole resolution +
  read-back behind `if (observation)`. With the trace OFF, `readEditObservation`
  returns `undefined` and **no `realpath`, no `stat` and no read-back happens**.
- The orchestrator adds the workspace identity only when the recorder is
  provably ON.
- The runtime's `buildToolContextMetadata` returns the host metadata unchanged
  when no sink is attached.

Witnesses **W10** and **W-E2** prove both halves.

---

## 5. R4 — retention and progress checkpoints

### 5.1 The classification

For each observed edit target, the comparator reports exactly one of:

`RETAINED_CHANGED | REVERTED | DELETED | UNCHANGED | OUTSIDE_SCOPE | UNVERIFIED`

Driven by the sequence of independent read-backs observed for that target's
file identity:

| Condition | Classification |
| --- | --- |
| the destination was under no designated benchmark root | `OUTSIDE_SCOPE` |
| the destination was ABSENT at the last read-back | `DELETED` |
| the final observed content equals an EARLIER observed content | `REVERTED` |
| the final observed content differs from the first observed content | `RETAINED_CHANGED` |
| the final observed content equals the first observed content | `UNCHANGED` |
| no usable observation | `UNVERIFIED` |

### 5.2 The aggregate counts

`trackedTargetCount` (inside the benchmark root), `untrackedTargetCount`
(outside it) and `ignoredTargetCount` (membership never established) are
**three separate counts**. The git-tracked file count is reported in a
**separate, explicitly git-scoped** field (`gitTrackedFileCount`), because
"tracked by git" and "present in the tree" are different questions. The
comparator never conflates git status with the full filesystem.

### 5.3 Scope and budgets

- Reconciliation is scoped to the **designated benchmark root** and the
  **observed targets**. The comparator NEVER recursively hashes the monorepo.
- The instrumented read-back is bounded by the existing
  `EDIT_OBSERVATION_MAX_FILE_BYTES` (512 KiB); a larger file is written
  normally and only the MEASUREMENT is skipped (`MEASUREMENT_SKIPPED_SIZE_LIMIT`).
- The canonicalization walk is bounded by 32 levels.
- Incomplete results keep their explicit markers (`PATH_SCOPE_UNVERIFIED`,
  `READBACK_UNAVAILABLE`, `UNAVAILABLE_FROM_TRACE`); nothing is reported as a
  clean zero.

### 5.4 Honesty about shell activity

The comparator reports shell activity as **activity**
(`shellActivityWithoutObservedMutation`), never as an observed mutation. The
trace observes the write layer; it cannot attribute a filesystem change to a
shell command. This matches the existing `EDIT_ORIGIN_UNOBSERVED` rule.

### 5.5 The reconciliation points

The read-back after each write is the observation point. The final observed
state of a target — the state at the last read-back — is the checkpoint state.
The comparator reconciles the initial state (the first observed content, or
the pre-write version) against that final state. The `run_terminated` event
and the operator Dump both preserve the whole sequence, so the reconciliation
is reproducible from the dump alone.

---

## 6. R5 — the Workspace Progress section

The comparator's markdown and JSON now carry a **`## Workspace Progress`**
section with:

- Time to first write inside the intended workspace.
- Applied writes outside the intended workspace.
- Independently verified write outcomes (matching / diverging / unverified).
- Files modified and retained at checkpoint, plus reverted and deleted.
- Time and tool calls since the last retained change.
- Native edit failures and unfulfilled attempts.
- Shell activity without observed mutations.

**The existing accepted-test-gate result stays `UNAVAILABLE_FROM_TRACE`** — the
new section adds no model-quality score and triggers no automatic agent
intervention.

---

## 7. R6 — executable evidence

### 7.1 The new witness suites

| Suite | File | Witnesses |
| --- | --- | --- |
| W01–W12 | `sdk/packages/core/src/extensions/tools/executors/edit-workspace-effect-trace01.test.ts` | 12 |
| CW01–CW12 | `apps/vscode/src/sdk/__tests__/model-behavior-workspace-progress-comparator01.test.ts` | 11 |
| W-E1/W-E2 | `sdk/packages/core/src/runtime/orchestration/session-runtime.model-behavior-trace.test.ts` | 2 |

### 7.2 The required witnesses

| Required witness | Where | Result |
| --- | --- | --- |
| Outside-workspace write classified correctly | W01, CW01 | PASS |
| Symlinked destination not misclassified as inside | W03 | PASS |
| Successful write with unavailable read-back stays unverified | W06, CW04 | PASS |
| File A → B → A classified as reverted | W07, CW06 | PASS |
| Created-then-deleted file not classified as retained | W08, CW07 | PASS |
| Existing-file overwrite not misidentified as new-file creation | W09 | PASS |
| Ignored and untracked files distinguished | CW08 | PASS |
| Missing causal identity cannot join events | W12, CW09 | PASS |
| Trace OFF preserves execution behavior | W10, W-E2 | PASS |
| Privacy sanitizer rejects source text, raw paths and secrets | W11 | PASS |
| Other-workspace distinguished from outside | W04 | PASS |
| Read-back divergence reported | CW05 | PASS |
| Accepted-test-gate result stays UNAVAILABLE | CW11 | PASS |
| Workspace evidence absence reported as UNAVAILABLE | CW10 | PASS |
| Workspace Progress section rendered | CW12 | PASS |

### 7.3 The targeted RED/GREEN

The observation layer was **mutated in place** (the two sink handlers in
`edit-observation.ts` were short-circuited) and the W-suite re-run:

```
× W01  × W02  × W03  × W04  × W05  × W06  × W07  × W08  × W09
✓ W10 (trace-OFF control — passes in BOTH states, as required)
× W11  × W12
Tests  11 failed | 1 passed (12)
```

**11 failed, 1 passed.** The RED is attributable to the new observation layer
alone: the trace-OFF control passes in both states, proving the disabled path
is untouched. The file was then restored **byte-for-byte** and the suite
returned to 12/12.

---

## 8. Focused gates

| Gate | Result |
| --- | --- |
| W-suite (`edit-workspace-effect-trace01.test.ts`) | **12 passed** |
| CW-suite (`model-behavior-workspace-progress-comparator01.test.ts`) | **11 passed** |
| Orchestrator wiring (`session-runtime.model-behavior-trace.test.ts`) | **7 passed** (5 pre-existing + 2 new) |
| `editor.test.ts` / `apply-patch.test.ts` | **23 passed** |
| `edit-efficiency-trace01.test.ts` | **19 passed** |
| Comparator/comparability suites (4 files) | **59 passed** |
| `agent-runtime.edit-efficiency-trace01.test.ts` + `agent-runtime.model-behavior-trace.test.ts` | **16 passed** |
| **SDK build** (`bun run build:sdk`) | **PASS** |
| **`apps/vscode` typecheck** (`tsc --noEmit`, exit 0, zero diagnostics) | **PASS** |
| `sdk/packages/core` build typecheck (`tsconfig.build.json`) | **PASS** |
| **Biome** (root + `apps/vscode` configs) | **PASS** (the one `any` info matches the pre-existing comparator-test pattern) |

### 8.1 Pre-existing failures (NOT caused by this ACT)

Each was verified by `git stash`-ing this ACT's changes and re-running the
identical command:

- `editor.realpath-authority.test.ts` cases **C / D / E** — the documented
  path-authority defect class. **3 failed at the baseline too.**
- `sdk/packages/core` `bun run typecheck` — the script type-checks TEST files
  that carry known pre-existing diagnostics. **Identical diagnostics at the
  baseline.**
- `apps/vscode` `src/sdk/__tests__/` — 9 failures in the `c24-c-bridge` /
  background-continuation suites. **Identical 9 failures at the baseline**, in
  isolation and in the full run. These are the suites the repository's own
  `sdk-transport-integration` rules document as requiring a dedicated vitest
  config.

---

## 9. The live qualification — NOT PERFORMED

`PASS_LIVE_WORKSPACE_EFFECTS` requires a native installed-VSIX run showing:

```
edit attempt → actual write → resolved workspace → read-back → retained workspace state
```

**This ACT did not perform that run.** The structural evidence is complete and
executable; the live qualification is a separate, bounded step against an
installed VSIX.

**What the structural evidence already establishes about the M3.1 question:**

1. The destination is now observable. A write that lands outside the
   workspace produces `destinationScope: "outside_workspace"` with
   `underBenchmarkRoot: false` — the fact the M3.1 trace could not express.
2. The disk state is now independently observable. The
   `actualContentFingerprint` is measured by a read-back, not derived from the
   executor's intent.
3. The production executor **does** accept absolute paths outside the workspace
   and **does** follow symlinks out of it (§2.2). This is the mechanism that
   can produce "13 applied writes, 0 retained benchmark changes" — and it is
   confirmed against the unmodified baseline.
4. The retention classification is now exact: A → B → A is `REVERTED`, a
   created-then-deleted file is `DELETED`, and an out-of-scope target is
   `OUTSIDE_SCOPE` — none of them can be reported as a retained change.

**What it does NOT establish:** that the M3.1 run itself used absolute paths,
or which files it touched. The M3.1 JSONL predates this feature, so it carries
no destination evidence and no read-back; the comparator therefore reports its
workspace figures as `UNAVAILABLE_FROM_TRACE` rather than inventing them.

**The next bounded step** is the live qualification against an installed VSIX,
which will produce a trace that DOES carry the new evidence and settle the
M3.1 attribution directly.

---

## 10. Preservation

- **No** path authorization change. `resolveFilePath` is untouched in both
  executors.
- **No** editing behaviour change. The writes, the results and the error
  strings are identical.
- **No** new recorder. The single centralized recorder is reused; the two new
  events are new *kinds* within it.
- **No** model-policy change, no context change, no architecture change.
- **No** change to the comparator's fail-closed comparability decision, to the
  accepted-test-gate result, or to the existing editing-efficiency accounting.
- The pre-existing `stash@{0}` and `stash@{1}` were **preserved**.
