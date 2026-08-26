# EPIC-QUALITY-SUBSTRATE

> Quality-substrate ACT family: vitest baseline, runtime-task-progression, typecheck baseline + recon, code-coverage baseline + ratchet, and the FACTORIZE intake that operationalized the historical `FACTORIZATION01` alias. See `.factory/epic-board.md` for the active index and links to in-flight epics.

## Current status

- Status: ACTIVE — closed substrate + open frontier (typecheck + coverage baselines)
- Priority: P1 (quality-substrate; gates every other code change)
- Current frontier: 2 OPEN items listed under "Open work" — `TYPECHECK-ZERO-BASELINE01` and `CODE-COVERAGE-BASELINE01`. The factorization work is closed at the intake phase; further Factorize waves are tracked in `.factory/epics/factory-infrastructure.md` (FACT-001..006 doctrine lives there).
- Blocked by: n/a

## Contract / durable conclusions

- **Vitest baseline is closed at zero failures.** `TEST-BASELINE-ZERO-FAILURES01` is the canonical gate: `bunx vitest run --config vitest.config.ts` returns `CANONICAL_VITEST_FAILURES=0`; `NEW_SKIPS_ADDED=0`. Any future regression breaks this gate.
- **Runtime-task-progression is closed at the canonical seam** (three-stage: source-level fixes + CORRECTION02). Future CLOSED_LIVE upgrade is optional and may run when a live Cline-- extension host is available.
- **Typecheck baseline is OPEN / HIGH.** `TYPECHECK-ZERO-BASELINE01` is the open gate. The recon behind it (`TYPECHECK-ZERO-BASELINE-RECON01`) is closed.
- **Code-coverage baseline is OPEN / HIGH.** `CODE-COVERAGE-BASELINE01` is the open gate. The ratchet ACT (`CODE-COVERAGE-RATCHET01`) is closed (with correction01, correction02); it enforces non-regression once the baseline is set.
- **Factorize doctrine lives in `factory-infrastructure.md`.** This file owns the quality-substrate ACT family; the FACT-001..006 / FORK-001 / ELM-001 doctrine and the per-Fn waves (F0..F5) belong to the factory-infrastructure epic. The FACTORIZATION01 row here is a SUPERSEDED historical alias retained for context; the operational successor is `EPIC-CLINEMM-FACTORIZE01` (intake ACT `ACT-CLINEMM-FACTORY-BOARD-DURABILITY-AND-FACTORIZE-INTAKE01`, 2026-08-21).


## ACT ledger

| ACT / Source ID | Verdict | Source line range (pre-sharding) | Purpose |
|---|---|---|---|
| `TEST-BASELINE-ZERO-FAILURES01` | CLOSED (canonical `vitest run` returns 1672 pass / 0 fail; `CANONICAL_VITEST_FAILURES=0`; `NEW_SKIPS_ADDED=0`) | L3648-3706 | Vitest baseline-zero-failures gate |
| `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-LIVE-RECON01` | CLOSED (three-stage closure: source-level fixes end-to-end; optional future CLOSED_LIVE upgrade) | L3707-3766 | Runtime-task-progression at the canonical seam |
| `TYPECHECK-ZERO-BASELINE01` | **OPEN / HIGH** | L3767-3788 | Typecheck zero-baseline gate |
| `ACT-CLINEMM-TYPECHECK-ZERO-BASELINE-RECON01` | CLOSED | (under `TYPECHECK-ZERO-BASELINE01`) | Typecheck baseline recon |
| `ACT-CLINEMM-TYPECHECK-BASELINE-RECON01` | CLOSED (advertised in the same section) | (under `TYPECHECK-ZERO-BASELINE01`) | Earlier typecheck recon baseline |
| `CODE-COVERAGE-BASELINE01` | **OPEN / HIGH** | L3789-3807 | Code-coverage baseline gate |
| `ACT-CLINEMM-CODE-COVERAGE-RATCHET01` (incl. correction01, correction02) | CLOSED / HIGH | L3808-3825 | Coverage ratchet (non-regression enforcement once the baseline is set) |
| `EPIC-CLINEMM-FACTORIZATION01` | SUPERSEDED by `EPIC-CLINEMM-FACTORIZE01` (intake ACT `ACT-CLINEMM-FACTORY-BOARD-DURABILITY-AND-FACTORIZE-INTAKE01`, 2026-08-21) | L3826-3845 | Historical factorization alias; same `recon / one seam / no giant rewrite` rule as the operational successor |
| `ACT-CLINEMM-TEST-BASELINE-FAILURES-RECON01` | CLOSED | (under `TEST-BASELINE-ZERO-FAILURES01`) | Earlier failures recon |

## Open work

Two open items:

- **`TYPECHECK-ZERO-BASELINE01`** (L3767-3788). Status: OPEN / HIGH. The recon behind it is closed; the gate itself is not yet zero. Reopen / new-work conditions: a future typecheck regression on the canonical `tsc --noEmit -p apps/vscode/tsconfig.json` (the gate is GREEN twice on prior commit; future runs must also exit 0 with 0 diagnostics).
- **`CODE-COVERAGE-BASELINE01`** (L3789-3807). Status: OPEN / HIGH. The ratchet ACT is closed and ready to enforce non-regression once the baseline is set; the baseline itself is not yet fixed.

Reopen / new-work conditions:

- Vitest baseline regresses (any failure count > 0).
- Runtime-task-progression defect reproduces at the canonical seam.
- Code-coverage baseline moves without an explicit ACT authorizing the move.

## Deferred work

None directly in this epic. The future CLOSED_LIVE upgrade of `RUNTIME-TASK-PROGRESSION01` is optional and may run when a live Cline-- extension host is available — it is deferred work but tracked under the same ACT.

## Historical detail

### Quality substrate — L3644-3848 (pre-sharding)

````text
SOURCE: .factory/epic-board.md L3644-3848 (pre-sharding). VERBATIM: yes; trims: leading/trailing blank lines collapsed

## Quality substrate

Four QA epics plus a deferred architecture epic. Quality substrate precedes long product-work cycles because a green baseline + monotonic coverage ratchet makes every subsequent Cline-- ACT cheaper to qualify.

### TEST-BASELINE-ZERO-FAILURES01

- ID: `EPIC-CLINEMM-TEST-BASELINE-ZERO-FAILURES01`
- STATUS: **CLOSED** at commit `a87ef52e6...` (this commit) — exact-head canonical command `cd apps/vscode && bunx vitest run --config vitest.config.ts` returns **1672 pass / 0 fail** (50.51s, 51.44s on two consecutive runs); `CANONICAL_VITEST_FAILURES=0`; `NEW_SKIPS_ADDED=0`

**Goal.** Default canonical test gate = zero unexplained failures. **Achieved** at this commit.

**Canonical command** (the actual command that produced the historical "1667 pass / 5 pre-existing fail" count):

```
cd apps/vscode && bunx vitest run --config vitest.config.ts
```

The runner `apps/vscode/scripts/run-bun-tests.ts` and `apps/vscode/scripts/run-bun-unit-tests.ts` are **not** the canonical command: those runners execute Vitest-API tests under `bun test`, which lacks `vi.advanceTimersByTimeAsync`, `vi.stubEnv`, `vi.unstubAllEnvs`, `expect().toHaveBeenCalledExactlyOnceWith`, etc., and would produce a false-positive 46-line failure inventory. The bun runners are an alternate execution surface that documents a known-incompatibility state, not the canonical gate.

**First ACT** (closed in this commit): `ACT-CLINEMM-TEST-BASELINE-FAILURES-RECON01` — exact-head RED-first recon, causal classification, bounded repair.

**Causal classification (5 historical failures, all repaired in this ACT):**

| ID | File | Test | Category | Causal seam | Repair |
| --- | --- | --- | --- | --- | --- |
| F1 | `apps/vscode/src/sdk/__tests__/task-state-shadow-correction02-c21-recon.test.ts` | C2.1-A: initTask setTurnPhase(streaming) ordering | **TEST_DEFECT** | `REPO_ROOT` hardcoded to a deleted sibling-worktree path (`/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-elm-architecture01`) at line 25 of the test file; leak from commit `809e94083` | Replaced with `findRepoRoot()` that walks up from the test file to find `.git/HEAD`; assertion logic unchanged |
| F2 | same file | C2.1-B: RuntimeEventAdapter seam | **TEST_DEFECT** | same `REPO_ROOT` | same fix |
| F3 | same file | C2.1-B: Shadow adapter canonical mapping | **TEST_DEFECT** | same `REPO_ROOT` | same fix |
| F4 | same file | C2.1-B: AgentRuntime ordering | **TEST_DEFECT** | same `REPO_ROOT` | same fix |
| F5 | `apps/vscode/src/sdk/sdk-task-control-coordinator.test.ts` | SdkTaskControlCoordinator > settles a pending question when switching tasks | **PRODUCT_DEFECT** | `SdkInteractionCoordinator.clearPending` (line 472) set `this.pendingAskResolve = undefined` without calling the saved resolve, leaving `handleAskQuestion`'s return-promise dangling across task switches; sibling method `resolvePendingAskQuestion(undefined)` correctly resolves with `""` (line 382) | `clearPending` now invokes the saved resolve with `""`, mirroring the sibling method's contract |

**Falsifiability of the F5 fix.** Three existing tests already assert the symmetric contract for `clearPending`:
- `apps/vscode/src/sdk/sdk-interaction-coordinator.test.ts` line 488: `await expect(decisionPromise).resolves.toEqual({action: "continue", ...})` after `clearPending("Task cleared")` — proves mistake-limit promise is resolved.
- Same file line 578: `await expect(approvalPromise).resolves.toEqual({approved: false, reason: "Task cancelled"})` after `clearPending("Task cancelled")` — proves tool-approval promise is resolved.

Both regressions tests run GREEN after the bounded fix (102/102 across the four interaction/task/mode/followup coordinator files). The F5 test was the missing coverage that exposed the bug; the fix preserves the established contract for the other two pending-promise classes.

**Repeatability evidence** (formerly-failing tests, 5 isolated runs each):

- `task-state-shadow-correction02-c21-recon.test.ts`: 5/5 GREEN (5 tests each run).
- `settles a pending question when switching tasks`: 5/5 GREEN (in ~7ms each, vs the previous 20008ms timeout).

**Suite-load failure (out of scope, by design):** `hub-runtime-host.provenance-epoch.c24-d3.test.ts` is excluded from the base `vitest.config.ts` and runs under the dedicated `vitest.config.c2-4-d-hub.ts` (which adds the `@cline-internal/core/hub/runtime-host/hub-runtime-host` resolve.alias). Verified the dedicated config passes 11/11. Same exclusion pattern applies to the c2-4-c-bridge test. These are NOT test failures; they are suite-load failures whose dedicated configs live in `ci:check-all`.

**Forbidden moves NOT performed:**

- No `test.skip` / `describe.skip` / `it.skip` added.
- No `todo` conversions.
- No retry / timeout inflation on the failing test.
- No assertion weakening (assertion bodies unchanged).
- No file exclusion from `vitest.config.ts`.
- No allow-failure CI behavior added.

**"Pre-existing" classification policy** — enforced going forward: "pre-existing" is permitted only as ACT-ownership / history metadata on the canonical-failure rows; it is **not** a causal category for any future ACT (the six-bucket taxonomy replaces it).

**Out of scope for this ACT** (still OPEN):

- `EPIC-CLINEMM-TYPECHECK-ZERO-BASELINE01` (~36 pre-existing `tsc --noEmit -p .` errors in apps/vscode; this ACT confirmed zero new typecheck errors introduced by the bounded fixes).
- `EPIC-CLINEMM-CODE-COVERAGE-BASELINE01` (coverage recon).
- `EPIC-CLINEMM-CODE-COVERAGE-RATCHET01` (depends on coverage baseline; monotonic threshold increase).

**CI parity note (per §28):** `.github/workflows/ext-vscode-test.yml` runs the unit suite (mocha, separate gate); vitest execution is local + the dedicated c2-4-c-bridge / c2-4-d-hub configs in `ci:check-all`. PARITY=PARTIAL — vitest is not yet a CI gate; recorded under `EPIC-CLINEMM-GITHUB-ACTIONS01` for future ACT.

### RUNTIME-TASK-PROGRESSION01

- ID: `EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION01`
- STATUS: CLOSED at the canonical seam (three-stage closure: `f50cc7560` + `8b7ab7428` + CORRECTION02) — source-level fixes landed end-to-end, no live dogfood capture required. The future-state CLOSED_LIVE upgrade is optional and may run when a live Cline-- extension host is available.

**Goal.** When the runtime owns an asynchronous command/tool job, the task must either progress to completion (model continues polling `command_status` and consumes the terminal state), surface an explicit recoverable failure (timeout, deadline exceeded, spawn failed, cancelled), or remain actively cancellable via `cancel_command`. The TaskHeader / next-action projection must accurately reflect runtime-owned state — `Waiting` only when genuinely awaiting user input, not when a background job is still alive.

**Forbidden terminal state:**

```
runtime work remains outstanding
  AND
next_action_owner = HUMAN / Waiting
  AND
no actionable user continuation exists
```

**Upstream radar cluster** (retained — NOT promoted):

| Upstream issue | Cluster | Notes |
| --- | --- | --- |
| #12079 | command-skipped-then-stall | "Command execution shows 'skipped' in Cline terminal and hangs on 'thinking' — requires extension restart to recover" |
| #4177 | terminal-output-missing-stall | "Cline gets stuck when terminal output is missing from executed commands, especially blocking commands" |
| #10549 | long-running-tool-timeout-ambiguity | "'run_commands' tool silently times out at 30s with misleading error" |
| #10015 / #10031 | skipped-command-stall (dominant) | 2 issues |
| (cluster: model-thinking-stall) | 1 issue | runtime genuinely stuck in thinking; UI is accurate; runtime never advances |
| (cluster: prompt-never-sent) | 1 issue | runtime never sends the next model request |

These are **radar** — they are *related* upstream runtime evidence, NOT proof of any Cline-- causal defect. Promotion to EXACT_MAP requires the issue to demonstrate a direct Cline-- continuation failure (runtime loses the running job) and not merely a runtime stall where the model has no pending request.

**First ACT** (closed in this commit, CAPTURE_INSUFFICIENT): `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-LIVE-RECON01`.

**Canonical production seams identified** (all well-tested GREEN 20/20 under vitest):

| Seam | File | Lines | Mechanism |
| --- | --- | --- | --- |
| JOB_CREATION | `apps/vscode/src/sdk/command-job-manager.ts` | 324, 412 | `exitTransitions.set(id, exitTransition)` |
| JOB_REGISTRY | `apps/vscode/src/sdk/command-job-manager.ts` | 575 | `exitTransitions.delete(evictId)` — bounded FIFO eviction (terminal jobs only) |
| RUNNING_RESPONSE | `apps/vscode/src/sdk/vscode-run-commands-tool.ts` | 625-633 | `{status: "running", jobId, elapsedMs, deadlineRemainingMs, outputTruncated, stdout}` JSON |
| POLL_OR_WAIT | `apps/vscode/src/sdk/command-job-manager.ts` | 592-624, 609-622 | `status()` races `exitTransitions.get(job.id)` against a local ad-hoc timer; no mutable waiter list |
| COMPLETION | `apps/vscode/src/sdk/command-job-manager.ts` | 567-578 | `active → terminal` on finalize; FIFO eviction |
| CONTINUATION | `apps/vscode/src/sdk/command-status-tool.ts` | 100-150 | `command_status` tool is **observation-only**; model polls; runtime does NOT push |
| TASK_STATE | `apps/vscode/src/sdk/SdkController.ts` | 831, 2037, 2113, 2675 | `isRunning` flag projection to webview |
| TASKHEADER_PROJECTION | `apps/vscode/src/sdk/SdkController.ts` | 2673-2675 | `backgroundCommandRunning` projection — **DEAD STATE** |

**Dead-state finding.** `SdkController.updateBackgroundCommandState(running, taskId)` is defined at line 2605 but has no production call sites. The webview therefore never receives `backgroundCommandRunning: true`. This is a separate presentation issue (the TaskHeader cannot show `Working` for background `run_commands` even if it wanted to) but it is **not** a continuation defect. It may be an intentional stub for forward compatibility. A future ACT may classify it `OBSOLETE_TEST` (dead code) or `INTENTIONAL_UNSUPPORTED` (stub) once intent is confirmed.

**Future-ACT capture requirements** to promote this epic to `OPEN / LIVE`:

1. Real Cline-- VS Code extension host must be running with an active task turn.
2. A `run_commands` invocation must return a RUNNING payload (not a terminal payload).
3. The model must fail to issue the next `command_status` poll (or the runtime must lose the job) **while the host process tree is still alive**.
4. The TaskHeader must show `Waiting` (or equivalent next-action-owner = HUMAN) during that window.
5. `exitTransitions.get(job.id)` and `job.state` must be inspectable to discriminate "runtime lost the job" from "model never polled".
6. `command_status` logs / Cline-- output channel / webview state payloads must be available for correlation.

Without all six, the ACT cannot RED-reproduce and must HALT with CAPTURE_INSUFFICIENT.

**Upstream mapping policy.** The 5 `RUNTIME_THINKING_STALL` issues and the 23 `RELATED_TOOL_RUNTIME` issues remain radar. An upstream issue is mapped to this epic **only** when its failure contract satisfies the six conditions above. None do, today.

### TYPECHECK-ZERO-BASELINE01

- ID: `EPIC-CLINEMM-TYPECHECK-ZERO-BASELINE01`
- STATUS: OPEN / HIGH

**Goal.** Default canonical typecheck = zero unexplained errors.

**Why separate from TEST-BASELINE-ZERO-FAILURES01.** Test gate ≠ typecheck gate. The repo currently carries two distinct flavors of tolerated debt (e.g. `1667 pass / 5 pre-existing fail` test failures and `41 pre-existing` SDK typecheck errors). Conflating them hides half of the debt.

**First ACT.** `ACT-CLINEMM-TYPECHECK-ZERO-BASELINE-RECON01` — reproduce and classify the current baseline with the same classification taxonomy as the test-baseline ACT.
- STATUS: CLOSED at this commit (canonical `tsc --noEmit -p apps/vscode/tsconfig.json` GREEN twice, exit 0, 0 diagnostics)

**Goal.** Default canonical typecheck = zero unexplained errors.

**Why separate from TEST-BASELINE-ZERO-FAILURES01.** Test gate ≠ typecheck gate. The repo carried two distinct flavors of tolerated debt (test failures and SDK typecheck errors). Conflating them hides half of the debt.

**Closed by** `ACT-CLINEMM-TYPECHECK-BASELINE-RECON01`. RED-first recon at exact head `ed6d569b6`: 36 deterministic diagnostics in 7 files, clustered into 9 causal clusters (1 PRODUCT_DEFECT, 8 TEST_DEFECT/ENVIRONMENT_DEPENDENT), all 9 repaired with bounded fixes. No `PRE_EXISTING` causal class used. `NEW_TYPE_SUPPRESSIONS=0`. No assertion weakening, no strictness turning off, no test exclusions added. The vitest config exclude list was extended by 1 entry (D3) to mirror the existing dedicated C2.4-D hub config pattern (D2 was already there; the dedicated vitest config already had D3 in its include list; the dedicated tsconfig and base tsconfig were out of sync and are now aligned).

**Outcome:** canonical `tsc --noEmit` exits 0 with 0 diagnostics; canonical vitest remains 1672/0 (~51s).

**CI parity note:** `apps/vscode/package.json:check-types` is the canonical local gate; `.github/workflows/ext-vscode-test.yml` does not currently gate the canonical tsc command. PARITY=PARTIAL — recorded under `EPIC-CLINEMM-GITHUB-ACTIONS01` for future ACT.

### CODE-COVERAGE-BASELINE01

- ID: `EPIC-CLINEMM-CODE-COVERAGE-BASELINE01`
- STATUS: OPEN / HIGH

**Goal.** Establish a baseline coverage measurement **before** any ratchet is set.

**Must answer first.**

  which workspaces / packages are covered?
  which source paths are intentionally excluded?
  which coverage kind: line / function / branch / statement?
  do tests exercise production code or generated / adapter noise?
  can reports compose across workspace test suites?

**Output.** Machine-readable exact-head coverage report committed alongside the ACT that produces it.

**Rule.** No arbitrary initial percentage target. Recon first.

### CODE-COVERAGE-RATCHET01

- ID: `EPIC-CLINEMM-CODE-COVERAGE-RATCHET01`
- STATUS: CLOSED / HIGH (closed by `ACT-CLINEMM-CODE-COVERAGE-RATCHET01`, correction01, correction02)

**Invariant.**

  new coverage >= qualified baseline

(preferable to: `coverage >= arbitrary 80%`.)

**Thresholds.**

- thresholds increase monotonically
- intentional threshold changes are explicit commits
- CI must NOT silently rewrite thresholds (do not rely on `thresholds.autoUpdate` in CI)
- per-file or changed-code policy **deferred** until `CODE-COVERAGE-BASELINE01` recon is complete

### FACTORIZATION01

- ID: `EPIC-CLINEMM-FACTORIZATION01`
- STATUS: SUPERSEDED by `EPIC-CLINEMM-FACTORIZE01` (intake ACT `ACT-CLINEMM-FACTORY-BOARD-DURABILITY-AND-FACTORIZE-INTAKE01`; 2026-08-21)

**Goal.** Progressively factorize Cline-- along real production seams.

**Rule.**

  recon first
  one bounded seam at a time
  no giant "modularization" rewrite

**Rationale.** Factorization because a concrete seam reduces coupling / testing cost — not because "factorization" itself is virtuous.

**Scope.** Intentionally unfrozen. Detailed design belongs to a future architectural discussion.

**Next action.** Future architectural discussion only. **No ACT in this board delta.**

**Supersession.** This DEFERRED epic retained the original `recon / one seam / no giant rewrite` rule but had no ACT-backed waves. `EPIC-CLINEMM-FACTORIZE01` (intake ACT `ACT-CLINEMM-FACTORY-BOARD-DURABILITY-AND-FACTORIZE-INTAKE01`) is the operational successor: same rule, plus a bounded wave plan (F0 inventory → F0B baseline → F1..F4 → F5) and source-derived doctrine (FACT-001..006, FORK-001, ELM-001). All factorization work should reference `EPIC-CLINEMM-FACTORIZE01` rows from this point forward; this DEFERRED row remains as a historical alias.

---
````
