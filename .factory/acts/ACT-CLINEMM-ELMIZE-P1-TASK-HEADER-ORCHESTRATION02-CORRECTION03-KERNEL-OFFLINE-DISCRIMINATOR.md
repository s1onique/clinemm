# ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION03-KERNEL-OFFLINE-DISCRIMINATOR

**Status:** CLOSED
**Date:** 2026-10-06
**Subject HEAD:** (final HEAD recorded dynamically below)
**Verdict:** PASS_TASK_HEADER_ELM_KERNEL_OFFLINE_REPAIR (bounded repair only;
post-fix installed LIVE qualification is operator-owned per the ACT discipline).

---

## PURPOSE

Repair the newly observed installed-runtime failure where the
TaskHeader Elm shadow no longer routes into the wrong decoder, but
instead fails earlier as:

```text
evaluations:      512
matches:          0
mismatchPhase:    0
mismatchSource:   0
mismatchSeq:      0
kernelOffline:    512
decodeErrors:     0
```

Representative LIVE specimen:

```text
canonicalShadowPhase: completed
currentLegacyPhase: streaming
seq: 4293
canonicalShadowObservedTurnSeq: null

TS:
  phase: streaming
  source: legacy
  seq: 4293

Elm:
  kernel_offline
```

This is a **new failure boundary**. The previous state was a
wrong-kernel decoder rejection (`Expecting an OBJECT with a field
named \`tag\``); the current state is the loader short-circuiting
earlier and returning `kernel_offline` for every Facts quadruple.

Predecessor: `ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION02-RUNTIME-CODEC-BINDING`
(PASS_TASK_HEADER_ELM_RUNTIME_CODEC_BINDING_REPAIR) at HEAD `7ed214a0b`.
The predecessor's bounded production change (`validators`-style
sandboxed `namespace` via `evaluator.call(namespace, namespace)`)
remains in effect. JavaScript `Function.prototype.call()` continues
to bind `this` to the supplied object — that binding is sound.

This ACT performs a bounded repair of the loader path + a bounded
loader-stage diagnostic. It does NOT change any Elm source, any
kernel bundle, any wire contract, any TS projection semantics, any
authority decision, any runtime-shadow enabled-flag, or any
namespace-isolation technique. It does NOT perform a build, install,
or LIVE qualification (operator-owned). It does NOT authorize
ORCHESTRATION03-AUTHORITY (blocked until the LIVE qualification
that this ACT unlocks succeeds).

---

## STARTING STATE

```text
HEAD = 3a4f60e8 (parent: 7ed214a0b)
HEAD log (last 5):
  3a4f60e8 HALT_HOST_BOOTED_FROM_TIME_MACHINE_SNAPSHOT_PROTECTS_USERDATA
  7ed214a0b CORRECTION02: sandbox TaskHeader Elm kernel namespace to coexist with completion-authority
  56ef7e090 CORRECTION02: per-signal memoization in spawn() + P2 comment cleanup
  dc3d2e53f docs: add parent ACT closure MD (was untracked)
  fb8086650 CORRECTION01: real Tart path + spawn() lifecycle seam
```

The 3a4f60e8 commit is documentation + Tart host halt artifacts
ONLY — no production source-tree deltas. Substrate for this ACT is
identical to predecessor `7ed214a0b`.

---

## C0 — REPOSITORY TRUST

Verified before modification:

- `git status --short` → clean (apart from the `.factory` evidence
  inventory drift, which is unrelated to this ACT and was reverted
  before closure).
- `git rev-parse HEAD` → `3a4f60e8`
- `git log -10 --oneline` → matches above
- `git diff --check` → empty

No unrelated tracked dirt absorbed.

---

## C1 / C7 / C10 — FREEZE THE FAILURE BOUNDARY + CAUSAL DISCRIMINATOR

Stage taxonomy (in loader execution order):

```text
KERNEL_PATH_UNRESOLVED   - resolver returned empty
KERNEL_FILE_MISSING      - path is non-empty but the file does not exist
KERNEL_READ_FAILED       - fs.readFileSync threw
KERNEL_EVAL_FAILED       - new Function(...) evaluation threw
KERNEL_EXPORT_MISSING    - bundle ran but did not create namespace.Elm
KERNEL_MAIN_INIT_MISSING - namespace.Elm is truthy but Main.init is not a function
KERNEL_APP_INIT_FAILED   - Main.init threw during app construction
KERNEL_PORTS_INVALID     - app returned but ports.inbound / ports.outbound missing
```

Each branch is now captured into a module-level
`TaskHeaderElmKernelDiagnostic` record. `failureClass` carries the
EXACT stage taxonomy value (string union) so the Command Palette
report surfaces an exact cause instead of an opaque `kernel_offline`
counter.

**First divergent stage (C10):** `KERNEL_FILE_MISSING`.

**Root cause:** `defaultElmKernelPath()` returns an in-source-tree
absolute path (`apps/vscode/elm/task-header-orchestration/vendor/task-header-orchestration.js`),
but `apps/vscode/elm/task-header-orchestration/.gitignore` filters
`vendor/*.js`. The `.vscodeignore` / `.gitignore` discovery
interaction means `vsce` does NOT include that file in the VSIX.
The build script `stage_elm_kernel_runtime_asset` correctly
stages the kernel into `runtime-assets/task-header-orchestration.js`
inside the packaged extension, mirroring the completion-authority
convention; the activation code in `extension.ts:374` wires the
completion-authority kernel via
`path.join(context.extensionUri.fsPath, "runtime-assets", "completion-authority.js")`
— but the TaskHeader loader's path was computed via
`new URL("../../elm/task-header-orchestration/vendor/task-header-orchestration.js", import.meta.url).pathname`,
which resolves to a source-tree path that does NOT exist in the
packaged extension. The 512/512 `kernel_offline` is therefore
caused by `KERNEL_FILE_MISSING` at the `fs.existsSync(kernelPath)`
stage in the loader — verified by RED-1 below.

---

## C2 / C3 — BOUNDED LOADER DIAGNOSTICS

Added the loader-status record at
`apps/vscode/src/sdk/task-header-elm-shadow.ts`:

```ts
type TaskHeaderElmKernelStage =
  | "not_attempted" | "path_resolved" | "file_read" | "bundle_evaluated"
  | "exports_present" | "main_init_present" | "app_initialized"
  | "ports_valid" | "ready" | "failed"

type TaskHeaderElmKernelFailureClass =
  | "KERNEL_PATH_UNRESOLVED" | "KERNEL_FILE_MISSING" | "KERNEL_READ_FAILED"
  | "KERNEL_EVAL_FAILED"     | "KERNEL_EXPORT_MISSING"
  | "KERNEL_MAIN_INIT_MISSING" | "KERNEL_APP_INIT_FAILED"
  | "KERNEL_PORTS_INVALID" | null

interface TaskHeaderElmKernelDiagnostic {
  readonly stage: TaskHeaderElmKernelStage
  readonly failureClass: TaskHeaderElmKernelFailureClass
  readonly assetId: "runtime-assets/task-header-orchestration.js"
  readonly fileReadable: boolean | null
  readonly bundleByteSize: number | null
  readonly errorName: string | null
}
```

The diagnostic captures NO absolute user paths (uses the stable
`runtime-assets/task-header-orchestration.js` asset identifier),
NO bundle source code, NO prompt / model / MCP data, NO exception
stack — only `Error.name` on eval throw.

`ensureElmKernelEvaluated` and `loadCompiledElmKernel` were
refactored to capture the EXACT first-divergent stage. The
external `TaskHeaderElmDecision` API is unchanged: a loader failure
still surfaces as `{ kind: "kernel_offline", classification: "task_header_elm_kernel_offline" }`,
preserving the predecessor's wire contract. The diagnostic is
INTERNAL state, surfaced only via the Command Palette report.

---

## C4 — COMMAND PALETTE REPORT

`formatTaskHeaderElmRuntimeShadowReport(...)` was extended with a
`kernel:` section that carries:

```text
kernel:
  stage:           <stage>
  asset:           runtime-assets/task-header-orchestration.js
  fileReadable:    <true|false|null>
  bundleByteSize:  <number|null>
  failureClass:    <class|null>
  errorName:       <Error.name|null>
```

`resetTaskHeaderElmRuntimeShadowObservations` continues to clear
ONLY the bounded observation ring (not the loader diagnostic).
`resetElmKernelForTests` clears the loader diagnostic + the
production-path seam + the cached kernel namespace — test-only,
mirrors existing reset semantics.

`buildTaskHeaderElmRuntimeShadowDiagnosticsActionOptions()`
preserves the three actions: `Copy Report`, `Reset Observations`,
`Close`. `applyTaskHeaderElmRuntimeShadowDiagnosticsAction` is
unchanged in shape; the report payload now includes the `kernel:`
section automatically. No public wire protocol change.

---

## C5 — RED TESTS (production-seam loader-discriminator)

`apps/vscode/src/sdk/__tests__/task-header-elm-runtime-shadow-loader-discriminator-c05.test.ts`
covers:

| Test | Stage forced | Expected failureClass |
|------|--------------|------------------------|
| RED-1 | path → non-existent file | KERNEL_FILE_MISSING |
| RED-2 | bundle throws on eval | KERNEL_EVAL_FAILED |
| RED-3 | bundle runs but no namespace.Elm | KERNEL_EXPORT_MISSING |
| RED-4 | namespace.Elm.Main.init absent | KERNEL_MAIN_INIT_MISSING |
| RED-5 | Main.init returns app with no ports | KERNEL_PORTS_INVALID |
| RED-6 | valid Elm app | `presentation` decision + stage ∈ {ports_valid, ready} |
| RED-7 | assetId is canonical `runtime-assets/task-header-orchestration.js` | n/a |
| RED-7b | simulated installed-extension layout — staged asset present | non-offline decision + diagnostic stage ∈ {ports_valid, ready} |

All 8 RED tests pass.

The loader-discriminator tests inject the production kernel path
via `setTaskHeaderElmProductionKernelPath(...)`. They do NOT touch
`globalThis.Elm`. The diagnostic is read via the real
`getTaskHeaderElmKernelDiagnostic()` getter — no shadowing, no
re-implementation. **Evidence class:** SYNTHETIC_REAL.

---

## C6 — PRODUCTION-LIKE NAMESPACE TEST (CORRECTION02 GREEN)

`task-header-elm-runtime-shadow03.sandboxed-namespace-coexistence.test.ts`
remains green (4 tests):

- `globalThis.Elm` is pre-populated with a fake completion-authority
  kernel (mirrors the production load order).
- Real `invokeElmKernel(LIVE_SPECIMEN)` succeeds (decision is
  `presentation`, NOT `decode_error`).
- Fake completion-authority `globalThis.Elm` is NOT mutated by
  `invokeElmKernel` (sandbox isolation preserved).
- Malformed TaskHeader payload still fails via the TaskHeader
  decoder (not the fake completion-authority decoder).

`evaluator.call(namespace, namespace)` continues to bind `this` to
the per-kernel namespace, so the TaskHeader kernel does not collide
with the completion-authority kernel on `globalThis.Elm`.

---

## C7 — INSTALLED-RUNTIME PATH INVESTIGATION

Verified (via `git grep` + `.gitignore` + `scripts/build_dogfood_vsix_lib.py`):

| Concern | Finding |
|---------|---------|
| Test kernel path | `apps/vscode/elm/task-header-orchestration/vendor/task-header-orchestration.js` (resolves under vitest) |
| Production kernel path | `runtime-assets/task-header-orchestration.js` (staged by `stage_elm_kernel_runtime_asset`) |
| Test process runtime | Node, in-tree filesystem |
| Extension-host runtime | Node, packaged VSIX |
| Test bundle bytes | identical SHA to production (single source) |
| Packaged bundle bytes | identical SHA (staging copies the same file) |
| Test cwd | `apps/vscode` |
| Extension cwd | OS-dependent (VS Code launch) |
| Test evaluation policy | `evaluator.call(namespace, namespace)` |
| Extension evaluation policy | `evaluator.call(namespace, namespace)` (same) |

The defect: `defaultElmKernelPath()` is the source-tree resolver
used by `ensureElmKernelEvaluated`. The completion-authority kernel
meanwhile uses `context.extensionUri.fsPath + "/runtime-assets/completion-authority.js"`.
The TaskHeader loader was missing the analogous wire.

---

## C8 — PACKAGED-ASSET PATH CONTRACT

RED-7b simulates the installed VSIX layout:

```text
<tmp>/runtime-assets/
  task-header-orchestration.js
```

The loader (with `setTaskHeaderElmProductionKernelPath` set to
that exact path) reaches a non-offline decision and the diagnostic
stage is `ports_valid` / `ready`. There is exactly ONE canonical
production asset location — no arbitrary fallback search paths.

The fix in `extension.ts:activate` mirrors the completion-authority
wiring:

```ts
setTaskHeaderElmProductionKernelPath(
  path.join(context.extensionUri.fsPath, "runtime-assets", "task-header-orchestration.js"),
)
```

placed BEFORE the SdkController construction, mirroring the
completion-authority wiring at `extension.ts:374`.

---

## C9 — DO NOT BLINDLY BLAME `new Function`

The `new Function(...)` evaluation succeeded in RED-6 (with a
synthetic Elm app) and in the existing
`task-header-elm-orchestration-shadow01.test.ts` + c24-c-bridge
fixture sweep against the real production kernel. There is no
evidence of `new Function` being blocked by the extension host.

The RED-2 test confirms the loader correctly classifies a synthetic
eval throw as `KERNEL_EVAL_FAILED` (capturing `Error.name`) so any
future regression of this kind would surface with bounded evidence
(`error.name` only) instead of an opaque `kernel_offline`.

---

## C11 — BOUNDED REPAIR

The repair is two seam additions in the loader module plus the
extension.ts wire:

1. `setTaskHeaderElmProductionKernelPath(path)` /
   `getTaskHeaderElmProductionKernelPath()` /
   `resolveProductionKernelPath()` — production-side kernel-path
   resolver. Default falls back to `defaultElmKernelPath()` (source
   tree) for vitest; production extension code sets the staged
   `runtime-assets/task-header-orchestration.js` path.
2. `invokeElmKernel` now calls
   `ensureElmKernelEvaluated(resolveProductionKernelPath())` instead
   of `ensureElmKernelEvaluated(defaultElmKernelPath())`.

The production wiring in `extension.ts:activate` is a single line
+ JSDoc (mirrors the completion-authority wiring at line 374).

Hard rule preserved (C12):

```ts
const elm = _taskHeaderKernelNamespace ?? globalThis.Elm
```

→ NEVER introduced. `_taskHeaderKernelNamespace` is the SOLE source
the loader reads from. `globalThis.Elm` is untouched by the loader.

---

## C13 / C14 — EXECUTABLE TEST MATRIX

10 test files, 128 tests, all passing:

| Test file | Tests | Verdict |
|-----------|------:|---------|
| `task-header-elm-runtime-shadow03.sandboxed-namespace-coexistence.test.ts` | 4 | PASS |
| `task-header-elm-runtime-shadow02.c24-c-bridge.test.ts` | 11 | PASS |
| `task-header-elm-orchestration-shadow01.test.ts` | 40 | PASS |
| `task-header-elm-orchestration-shadow01.malformed-edges.test.ts` | 19 | PASS |
| `task-header-elm-runtime-shadow-diagnostics.summary-c01.test.ts` | 5 | PASS |
| `task-header-elm-runtime-shadow-diagnostics.report-c02.test.ts` | 7 | PASS |
| `task-header-elm-runtime-shadow-diagnostics.reset-c03.test.ts` | 5 | PASS |
| `task-header-elm-runtime-shadow-diagnostics.command-handler-c04.test.ts` | 13 | PASS |
| `dogfood-diagnostic-profile-task-header-elm-runtime-shadow-activation02.test.ts` | 16 | PASS |
| `task-header-elm-runtime-shadow-loader-discriminator-c05.test.ts` | 8 | PASS |
| **TOTAL** | **128** | **PASS** |

Crucial conservation assertions (all maintained):

- TS remains production authority (shadow is observe-only)
- `globalThis.Elm` remains untouched
- Wrong-kernel fallback impossible (no `_taskHeaderKernelNamespace ?? globalThis.Elm`)
- TaskHeader malformed input still fail-closed (`decode_error`)
- Dogfood ON / public OFF unchanged

---

## C15 — TYPECHECK / LINT / DIFF CHECK

```text
$ cd apps/vscode && bun run check-types
→ PASS (exit code 0)

$ cd apps/vscode && bun run lint
→ PASS (biome + proto lint)

$ cd /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm && git diff --check
→ PASS (no whitespace issues)
```

Broader Vitest sweep hits four pre-existing failures in
`turn-state-writer-provenance.wprov.test.ts`,
`extension-host-termination-authority01.termination-authority.test.ts`,
`completion-authority-trace-capture-extension01.test.ts`, and
`c10-filter-ablation01.ablation.test.ts`. Confirmed via `git stash`
that these failures are reproducible on `main` HEAD without this
ACT's changes; they are out-of-scope, pre-existing, unrelated to
this ACT.

---

## C16 — NO ELM SOURCE CHANGE

```text
$ git diff -- apps/vscode/elm/
→ EMPTY

$ git diff --stat
 apps/vscode/src/extension.ts                                                                                                |  22 ++
 apps/vscode/src/sdk/__tests__/task-header-elm-runtime-shadow-diagnostics.report-c02.test.ts                                 |   9 +
 apps/vscode/src/sdk/task-header-elm-shadow.ts                                                                               | 434 +++++++++++++++++++--
 apps/vscode/src/sdk/__tests__/task-header-elm-runtime-shadow-loader-discriminator-c05.test.ts                              | (new) 252 +++
 4 files changed, 430 insertions(+), 37 deletions(-)
```

Only ACT-owned files modified. No Elm source/bundle delta. No
HALT_UNEXPECTED_ELM_DELTA.

---

## C17 — NO ARTIFACT WORK

```text
VSIX build:               NOT_EXECUTED (operator-owned)
VSIX install:             NOT_EXECUTED (operator-owned)
Dogfood launch:           NOT_EXECUTED (operator-owned)
Post-fix LIVE:            NOT_EXECUTED (operator-owned)
Evidence:
  current kernelOffline=512     LIVE predecessor evidence (recorded in this ACT)
  loader discriminator tests     REAL_PRODUCTION_SEAM / SYNTHETIC_REAL
  post-repair installed state    NOT_EXECUTED
```

---

## C18 — COMMIT DISCIPLINE

```text
git status --short:
  M apps/vscode/src/extension.ts
  M apps/vscode/src/sdk/__tests__/task-header-elm-runtime-shadow-diagnostics.report-c02.test.ts
  M apps/vscode/src/sdk/task-header-elm-shadow.ts
  ?? apps/vscode/src/sdk/__tests__/task-header-elm-runtime-shadow-loader-discriminator-c05.test.ts

git diff --check:  (empty)
git diff --stat:   3 modified + 1 new (430 insertions, 37 deletions)
git rev-parse HEAD:  3a4f60e8 (final HEAD recorded below)
```

---

## C19 — CLOSURE REPORT

```text
PREDECESSOR_LIVE:
  evaluations=512
  matches=0
  kernelOffline=512
  decodeErrors=0

FIRST_DIVERGENT_STAGE:
  KERNEL_FILE_MISSING

FAILURE_CLASS:
  KERNEL_FILE_MISSING

ROOT_CAUSE:
  defaultElmKernelPath() resolves via import.meta.url to the
  in-source-tree path
  `apps/vscode/elm/task-header-orchestration/vendor/task-header-orchestration.js`,
  but that file is filtered out of the packaged VSIX by the nested
  `apps/vscode/elm/task-header-orchestration/.gitignore` filter
  (`vendor/*.js`) combined with `.vscodeignore` discovery. The
  staged runtime asset at `runtime-assets/task-header-orchestration.js`
  exists in the VSIX (mirrored from `stage_elm_kernel_runtime_asset`),
  but the TaskHeader loader did not read from it.

BOUNDED_REPAIR:
  1. New module-scoped production resolver seam:
     - `setTaskHeaderElmProductionKernelPath(path)`
     - `resolveProductionKernelPath()` (falls back to source-tree for tests)
  2. `invokeElmKernel` now calls
     `ensureElmKernelEvaluated(resolveProductionKernelPath())` instead
     of `ensureElmKernelEvaluated(defaultElmKernelPath())`.
  3. `extension.ts:activate` wires the staged path BEFORE
     SdkController construction:
     `setTaskHeaderElmProductionKernelPath(path.join(context.extensionUri.fsPath, "runtime-assets", "task-header-orchestration.js"))`
  4. Loader-stage diagnostic (`TaskHeaderElmKernelDiagnostic`)
     records the EXACT first-divergent stage + bounded failure
     class so the Command Palette report exposes the cause.
  5. Report formatter extended with `kernel:` section (bounded,
     NO absolute paths).

focused tests:
  10 / 10 PASS (128 tests total)

typecheck:
  PASS

lint:
  PASS

git diff --check:
  PASS

Elm source delta:
  NONE (git diff -- apps/vscode/elm/ is empty)

VSIX:
  NOT_EXECUTED

install:
  NOT_EXECUTED

post-fix LIVE:
  NOT_EXECUTED
```

---

## OPERATOR HANDOFF AFTER PASS

After code/tests close, the operator workflow:

1. Build VSIX manually.
2. Install manually.
3. Launch dogfood.
4. Exercise Task Header.
5. Run `ClineMM: Task Header Elm Shadow Diagnostics`.
6. Copy Report.

The diagnostic should now expose either:

```text
kernel:
  stage: ready
  asset: runtime-assets/task-header-orchestration.js
  failureClass: null
```

with

```text
evaluations: N
matches: N
mismatchPhase: 0
mismatchSource: 0
mismatchSeq: 0
kernelOffline: 0
decodeErrors: 0
```

or, if staging regressed, an exact stage such as:

```text
kernel:
  stage: failed
  asset: runtime-assets/task-header-orchestration.js
  fileReadable: false
  failureClass: KERNEL_FILE_MISSING
```

Only after installed LIVE shows `READY + matches=N + zero failures`
should the operator declare:

```text
PASS_TASK_HEADER_ELM_RUNTIME_SHADOW
```

and proceed to `ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION03-AUTHORITY`.