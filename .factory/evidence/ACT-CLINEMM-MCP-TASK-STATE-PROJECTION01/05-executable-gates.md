# 05 — Executable gates

**ACT:** `ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01`
**Working directory for every command:** `apps/vscode`
unless stated otherwise.

**Toolchain:** `bun 1.3.14`, `node v26.0.0` (both resolved from
`/opt/homebrew/bin`; the sandbox's default `PATH` does not include
them, so each command below prefixes
`export PATH="/opt/homebrew/bin:$HOME/.bun/bin:$PATH"`).

---

## C5 — Minimum executable gates

| # | Gate | Command | Exit | Result |
|---|---|---|---|---|
| 1 | New focused RED → GREEN production-seam witness | `bunx vitest run --config vitest.config.ts --testTimeout=15000 src/sdk/control-seam/control-seam.task-state-projection01.test.ts src/sdk/control-seam/control-seam.publication-boundary01.test.ts` | `0` | **39 passed / 0 failed** |
| 2 | Existing control-seam authority / protocol / server / proxy tests | `bunx vitest run --config vitest.config.ts --testTimeout=15000 src/sdk/control-seam/` | `1` | 6 files passed (89 tests) + 1 file failing **pre-existing** (see below) |
| 3 | Existing task-header Elm authority tests | `bunx vitest run --config vitest.config.ts --testTimeout=15000 src/sdk/__tests__/task-header-authority-cutover.authority03.test.ts src/sdk/__tests__/task-header-unobserved-idle-demotes-completed.tuidc01.test.ts src/sdk/__tests__/task-header-unbound-shadow-authority.tusa01.test.ts src/sdk/__tests__/task-header-canonical-task-activity-ownership.cta01.test.ts src/sdk/__tests__/sdk-controller-w1-epoch-stateversion-stamping.test.ts` | `0` | **51 passed / 0 failed** (5 files) |
| 4 | Existing state-publication / epoch-fencing tests relevant to the changed path | covered by (1) `PB01`–`PB08` (REAL `sendStateUpdate` + the store) and (3) `sdk-controller-w1-epoch-stateversion-stamping.test.ts` | `0` | **PASS** |
| 5 | Existing React updater-purity tests (the change reaches webview code) | `cd webview-ui && bunx vitest run src/components/chat/chat-view/__tests__/react-updater-purity-probe.test.tsx src/components/chat/chat-view/__tests__/c2-correction02-fixup04-updater-purity.test.ts` | `0` | **7 passed / 0 failed** (2 files) |
| 5b | The existing webview TaskHeader label matrix (the change reaches `taskHeaderTelemetryHelpers.ts`) | `cd webview-ui && bunx vitest run src/components/chat/task-header/taskHeaderTelemetryHelpers.test.ts` | `0` | **45 passed / 0 failed** (1 file) |
| 6a | Relevant TypeScript check — the extension host | `bunx tsc --noEmit` | `0` | **clean** |
| 6b | Relevant TypeScript check — the webview | `cd webview-ui && bunx tsc --noEmit` | `0` | **clean** |
| 7a | Scoped lint | `bunx biome lint --config-path ./biome.jsonc --no-errors-on-unmatched --files-ignore-unknown=true --diagnostic-level=error src/sdk/control-seam/ src/sdk/published-task-state.ts src/shared/task-header-state-label.ts src/core/controller/state/subscribeToState.ts src/sdk/SdkController.ts` | `0` | `Checked 21 files in 286ms. No fixes applied.` |
| 7b | `git diff --check` | `git diff --check HEAD` | `0` | **clean** (no whitespace errors) |

### Gate 2 detail — the single failing file

`src/sdk/control-seam/control-seam.owner-exclusivity.cor02.test.ts`
→ `COR02-R1` / `COR02-R2` fail with
`ERR_UNSUPPORTED_ESM_URL_SCHEME: ... Received protocol 'bun:'`.

**Classification: `BASELINE_DIAGNOSTIC` (pre-existing, not ACT-owned).**
Verified by running the identical command in a pristine detached
worktree at `HEAD` (`5dc139480`) with the same `node_modules` linked:
the same two tests fail with the same error at the same ~30 s mark. The
test spawns a worker whose entry uses the `bun:` module scheme; the Node
ESM loader used by the test harness cannot load it. See
`02-red-green.md` for the verbatim receipts.

### Gate 5 note

The ACT touches `apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts`
(only the label TEXT source), so the React updater-purity suites and the

---

## Full-suite comparison (not a C5 gate — a regression sweep)

The full `vitest.config.ts` suite was run twice on the SAME tree: once
with the ACT's changes applied, and once with them reverted in place
(the tracked changes were `git stash`-ed and the four new files moved
aside, then restored). This isolates the ACT's effect exactly — no
worktree/artifact differences.

| Run | Test files | Tests |
|---|---|---|
| **ACT tree** | `63 failed | 463 passed | 6 skipped (532)` | `168 failed | 5852 passed | 56 skipped (6076)` |
| **HEAD baseline** (same tree, ACT reverted) | `63 failed | 461 passed | 6 skipped (530)` | `168 failed | 5813 passed | 56 skipped (6037)` |

The ACT tree has **+2 passing files** (the two new ACT test files) and
**+39 passing tests** (the ACT's 39 witnesses) — and the SAME 63 failing
files with the SAME 168 failing tests.

**Failing-file set difference (both directions):**

```
comm -23 <ACT failing files> <BASELINE failing files>   → (empty)
comm -13 <ACT failing files> <BASELINE failing files>   → (empty)
```

**The failing-file sets are IDENTICAL. Zero ACT-owned regressions.**

### BASELINE_DIAGNOSTICS

- `control-seam.owner-exclusivity.cor02.test.ts` → `COR02-R1`,
  `COR02-R2` — `ERR_UNSUPPORTED_ESM_URL_SCHEME` (`bun:` scheme). Present
  identically at HEAD. Not ACT-owned.
- The remaining 62 full-suite failures are pre-existing repository drift
  (unrelated suites: `command-job-manager`, `myc-prime-automation`,
  `bootstrap-*`, `provider-instance-identity`, `webview-state-session-listing`,
  `v2-capture.cache-ordering`, `tool-runtime-reliability-recon02`, …).
  None of them imports or exercises the control seam, the published-task-state
  store, the shared label mapping, or `sendStateUpdate`.

### ACT_OWNED_DIAGNOSTICS

**NONE.**

---

## A regression the ACT introduced and then corrected

The FIRST full-suite comparison surfaced four files that failed on the
ACT tree but not at HEAD:

```
src/sdk/SdkController.test.ts
src/sdk/__tests__/ask-response-epoch-turnstate-coherence.aretc01-c01-real-seam.test.ts
src/sdk/__tests__/background-handoff-turnstate-discriminator.bhtd01-synthetic-real.test.ts
src/sdk/__tests__/runtime-epoch-transition-active-turnstate-repair01.synthetic-real.test.ts
```

**Root cause.** The ACT added `this.publishedTaskState.invalidate()` to
`SdkController.resetMessageTranslatorAndFence()` and
`SdkController.clearTask()`. Three of those four suites invoke the
production method on a **hand-built plain object**
(`SdkController.prototype.clearTask.call(controller)`, and a
`new Function(...)` harness that compiles the literal production method
body), which **bypasses the constructor's field initializers**. The
store field was `undefined` and the call threw.

**Correction.** The invalidation calls use the optional form
`this.publishedTaskState?.invalidate()`. In a real controller the store
ALWAYS exists, so the ACT's identity/epoch semantics are unchanged; the
optional form only tolerates the plain-object harnesses.

**Verification:** those four files now pass `68/68`, and the full-suite
comparison above shows exact parity with the baseline.

---

## A historical-evidence side effect (corrected)

The full-suite runs regenerate a timestamp in
`.factory/evidence/act-seatbelt-yolo-approval-friction-recon01/inventory.summary.md`
(a historical ACT's evidence file that one of its own tests writes). It
was reverted with `git checkout --` after each run; the historical
evidence is unchanged and it is **not** part of this ACT's diff.

---

## Commands the repository provides (as determined from `apps/vscode/package.json`)

| Script | Definition | Relevance |
|---|---|---|
| `test:vitest` | `vitest run --config vitest.config.ts` | The configuration used by every gate above. |
| `check-types` | `bun run protos && bunx tsc --noEmit && bun run check-types:compat && cd webview-ui && bunx tsc --noEmit` | The type gate (run per-part here to keep the receipts separable). |
| `lint` | `biome lint --config-path ./biome.jsonc … && bun run lint:proto` | The lint gate (scoped here to the changed files). |
| `format` | `biome format --config-path ./biome.jsonc --changed --since main …` | The format gate. |

No global configuration was changed. The existing Vitest configurations
were used as-is; no new config file was added.

TaskHeader label matrix were run. **No React component, reducer, or
functional updater was modified**, and both purity suites pass unchanged.
