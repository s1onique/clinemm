# 06 — Executable receipts

**Source HEAD for every execution below:** `b1ad2a0de0a45ef184d8e836cc6d17bb422cf92e` (branch `main`).
**Worktree state during all executions:** clean except for the untracked
`.factory/evidence/ACT-CLINEMM-WORKING-AFTER-COMPLETION-DISCRIMINATOR01/` directory.
**Production change:** ZERO. **Diagnostic probes added:** ZERO.

## 6.0 — Execution environment

| Item | Value |
|---|---|
| Host platform | darwin (macOS), arm64 |
| Package manager / task runner | `bun` (`$HOME/.bun/bin/bun`) |
| Runtime for vitest | Node (`/opt/homebrew/bin/node`, v26.0.0) — the extension host and vitest both run on Node |
| Test runner | `vitest` v4.1.10 (via `bunx vitest run`) |
| `apps/vscode` config | `vitest.config.ts` (canonical) |
| `apps/vscode/webview-ui` config | the package's own `vitest` config |
| Network | not required; no network call was made |
| Wall clock (session) | 2026-11-16, tests executed 18:34–18:37 local (+03:00) |

**Scope discipline:** 21 focused test files were executed across **3** invocations. **No broad
sweep** was run (`test:unit`, `test:vitest` over the whole package, `test:integration`,
`test:e2e`) — none was needed, because no demonstrated causal dependency required it.

---

## 6.1 — Invocation A — the C9/C10 + BCB + turn-phase authority boundary

```
cd apps/vscode && bunx vitest run --config vitest.config.ts \
  src/sdk/__tests__/post-terminal-working-cancel-repro01.ptwcr01.test.ts \
  src/sdk/__tests__/post-terminal-working-cancel-correction01.ptwcr01c01.test.ts \
  src/sdk/__tests__/background-completion-barrier01.bcb01.test.ts \
  src/sdk/__tests__/background-completion-barrier01-correction01.bcb01-c.test.ts \
  src/sdk/__tests__/background-completion-barrier01-correction02.bcb01-c2.test.ts \
  src/sdk/__tests__/background-completion-barrier01-correction03.bcb01-c3.test.ts \
  src/sdk/__tests__/background-completion-barrier01-correction04.bcb01-c4.test.ts \
  src/sdk/__tests__/turn-phase-contract01.tpc01.test.ts
```

| File | Tests | Duration |
|---|---|---|
| `background-completion-barrier01.bcb01.test.ts` | 14 | 1162 ms |
| `background-completion-barrier01-correction01.bcb01-c.test.ts` | 8 | 17 ms |
| `background-completion-barrier01-correction02.bcb01-c2.test.ts` | 5 | 687 ms |
| `background-completion-barrier01-correction03.bcb01-c3.test.ts` | 6 | 4 ms |
| `background-completion-barrier01-correction04.bcb01-c4.test.ts` | 5 | 146 ms |
| `post-terminal-working-cancel-repro01.ptwcr01.test.ts` | 15 | 18 ms |
| `post-terminal-working-cancel-correction01.ptwcr01c01.test.ts` | 10 | 15 ms |
| `turn-phase-contract01.tpc01.test.ts` | 60 | 125 ms |

```
 Test Files  8 passed (8)
      Tests  123 passed (123)
   Duration  5.21s
```

**Exit code: 0.**

### The assertions this boundary actually needs

| Required invariant (per §C5) | Witness | Result |
|---|---|---|
| A settled turn with a **legitimate outstanding** background obligation must **not** falsely complete | `bcb01` BCB-02 / BCB-INT-01 (real `run_commands` + `CommandJobManager`); `bcb01-c` BCB-13 | **PASS** |
| A settled turn with **all obligations discharged** must not remain indefinitely in a nonterminal authority state | `bcb01` BCB-25 (REAL integration: `run_commands` + `command_status` → barrier releases → exactly 1 commit); `bcb01-c4` BCB-31 (fires exactly 1 continuation at the terminal-idle re-evaluation, none at submit time) | **PASS** |
| A **committed terminal phase** must not be overwritten by a stale streaming publication | `c9c10cdap01` (below), `ptwcr01c01` R1 | **PASS** |
| A BCB hold must publish a **truthful non-running** phase, not `Working` | `ptwcr01c01` R1 — "a terminated, BCB-held turn projects a TRUTHFUL non-running phase"; the projection seams render the truthful affordance (not `Working` / `Cancel`) | **PASS** |
| The turn-phase vocabulary and writer↔phase ownership map are exact | `tpc01` (T-01…T-14 + `CHART_01_EXPECTED_EDGES` + `TURN_PHASE_WRITER_MAP`) | **PASS** |

**Evidence level: `REAL_PRODUCTION_SEAM`** — every witness above drives the real
`SdkSessionEventCoordinator`, the real `TurnStateTracker`, the real `CommandJobManager`, and
the real Elm kernels. `bcb01` BCB-25 is a REAL integration case (real `run_commands` +
`command_status` through the real manager).

---

## 6.2 — Invocation B — the C10 / continuation / containment / publication boundary

```
cd apps/vscode && bunx vitest run --config vitest.config.ts \
  src/sdk/__tests__/c9-c10-commit-driven-authority-publication01.c9c10cdap01.test.ts \
  src/sdk/__tests__/c9-c10-statechart-causal-repair01.c9c10scr01.test.ts \
  src/sdk/__tests__/c9-c10-statechart-causal-repair01.c9c10scr01-cons.test.ts \
  src/sdk/__tests__/completion-continuation-structural-authority01.ccsa01.test.ts \
  src/sdk/__tests__/completion-presentation-authority01.cpa01.test.ts \
  src/sdk/__tests__/continuation-cardinality-authority01.ccard01.test.ts \
  src/sdk/__tests__/containment-failure-c10-authority01.cfc10a01.test.ts \
  src/sdk/__tests__/containment-failure-c10-authority-repair01.cfc10ar01.test.ts \
  src/sdk/__tests__/completed-task-compaction-authority01.ctca01.test.ts \
  src/sdk/__tests__/completion-continuation-rearm01.rearm01.test.ts \
  src/sdk/__tests__/completion-continuation-stalled-rearm-loop01.ccsrl01.test.ts
```

| File | Tests | Duration |
|---|---|---|
| `c9-c10-commit-driven-authority-publication01.c9c10cdap01.test.ts` | 20 | 9 ms |
| `c9-c10-statechart-causal-repair01.c9c10scr01.test.ts` | 5 | 6 ms |
| `c9-c10-statechart-causal-repair01.c9c10scr01-cons.test.ts` | 14 | 8 ms |
| `completion-continuation-structural-authority01.ccsa01.test.ts` | 10 | 3 ms |
| `completion-presentation-authority01.cpa01.test.ts` | 14 | 8 ms |
| `continuation-cardinality-authority01.ccard01.test.ts` | 12 | 5 ms |
| `containment-failure-c10-authority01.cfc10a01.test.ts` | 19 | 141 ms |
| `containment-failure-c10-authority-repair01.cfc10ar01.test.ts` | 25 | 134 ms |
| `completed-task-compaction-authority01.ctca01.test.ts` | 6 | 15 ms |
| `completion-continuation-rearm01.rearm01.test.ts` | 7 | 787 ms |
| `completion-continuation-stalled-rearm-loop01.ccsrl01.test.ts` | 13 | 51 ms |

```
 Test Files  11 passed (11)
      Tests  145 passed (145)
   Duration  3.91s
```

**Exit code: 0.**

---

## 6.3 — Invocation C — the webview TaskHeader projection boundary

```
cd apps/vscode/webview-ui && bunx vitest run \
  src/components/chat/task-header/taskHeaderTelemetryHelpers.test.ts \
  src/components/chat/task-header/TaskHeaderTelemetry.test.tsx
```

| File | Tests | Duration |
|---|---|---|
| `taskHeaderTelemetryHelpers.test.ts` | 45 | 4 ms |
| `TaskHeaderTelemetry.test.tsx` | 54 | 74 ms |

```
 Test Files  2 passed (2)
      Tests  99 passed (99)
   Duration  855ms
```

**Exit code: 0.**

`taskHeaderTelemetryHelpers.test.ts` is the witness for **T-09** (the TaskHeader label is a
*PROJECTION* of the committed phase, not a lifecycle state) — the exact claim that the
incident's "Working" label depends on. It is a **pure** function test with no React
updater involved, satisfying the ACT's React-restriction constraint by construction.

---

## 6.4 — Totals

| Invocation | Files | Assertions | Exit code |
|---|---|---|---|
| A — C9/C10 + BCB + turn phase | 8 | 123 | 0 |
| B — C10 + continuation + containment + publication | 11 | 145 | 0 |
| C — webview TaskHeader projection | 2 | 99 | 0 |
| **TOTAL** | **21** | **367** | **0** |

**Broad-sweep suites deliberately NOT run:** `bun run test:unit`, `bun run test:vitest`
(whole package), `bun run test:integration`, `bun run test:e2e`. None was required by a
demonstrated causal dependency; the ACT's own instruction was "No broad test sweep unless a
demonstrated causal dependency requires it".

---

## 6.5 — Failures observed, and their identity

Two failures were encountered during exploration. **Both are PRE-EXISTING and neither is
ACT-owned.** Each is identified by failure identity, not by aggregate count.

### Failure 1 — `completion-authority-elm-authority-counter-dump01.test.ts`

```
 ❯ src/sdk/__tests__/completion-authority-elm-authority-counter-dump01.test.ts:39:18
    39|   expect(source).toMatch(/DumpCompletionAuthorityElmAuthority\s*:\s*prefix\s*\+/)
```

- **Failure identity:** `ELAUTHORITY01.A` — "registry.ts exposes DumpCompletionAuthorityElmAuthority command id".
- **Cause:** the test asserts the source text contains `DumpCompletionAuthorityElmAuthority: prefix + …`.
  `apps/vscode/src/registry.ts:192` actually contains
  ``DumpCompletionAuthorityElmAuthority: `${prefix}.debug.dumpCompletionAuthorityElmAuthority` ``.
- **Attribution by history:** the template-literal form was introduced by `363bdf7db`
  ("fix(aice01): evidence-provenance correction — … source-bound export, durability"); the
  test's regex dates from `5f9330c55`
  ("ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-AUTHORITY-COUNTER-DUMP01: expose live authority counters").
  **A source-text assertion drift between two commits — neither of which is this ACT.**
- **Relation to the incident boundary:** **NONE.** The failure is about the *counter-dump
  command registration* in `registry.ts`. The incident boundary is the deferred C10 release
  path in `sdk-session-event-coordinator.ts`. The command **is** registered
  (`registry.ts:192`); only the test's regex is stale.
- **Status:** PRE-EXISTING, **not repaired** by this ACT (production change budget = ZERO, and
  repairing it would be an unauthorised change to an unrelated seam).

### Failure 2 — `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeader.test.tsx`

```
 FAIL  src/components/chat/task-header/TaskHeader.test.tsx [ … ]
Error: Cannot find module '…/@react-aria+toggle@3.13.1+…/node_modules/react-aria/private/toggle/useToggle'
 imported from …/@react-aria/toggle/dist/import.mjs
Did you mean to import "react-aria/dist/exports/private/toggle/useToggle.cjs"?
```

- **Failure identity:** a **collection/module-resolution** failure — the suite never ran; **zero
  assertions executed**. It is NOT an assertion failure.
- **Cause:** an ESM/CJS interop problem in the pinned `@react-aria/toggle@3.13.1` dependency
  resolution (bun `node_modules/.bun/…` layout), unrelated to any ClineMM source.
- **Relation to the incident boundary:** **NONE.** The file is a React component test; the
  incident's UI claim (T-09) is proven by the **pure** `taskHeaderTelemetryHelpers.test.ts`
  (45 assertions, invocation C — PASS).
- **Status:** PRE-EXISTING environment/dependency issue, **not repaired** by this ACT.

### Net effect on the ACT

**No ACT-owned diagnostic remains.** No test was added, modified, removed or skipped. No
deliberately failing test was left in the default suite. The two failures above are recorded
with their identities and are **not** counted as ACT results.

---

## 6.6 — Evidence-level labels for the conclusions

| Conclusion | Label | Basis |
|---|---|---|
| The installed bundle is built from source `1d9a37bcd` | `REAL_PRODUCTION_SEAM` | marker discrimination against `dist/extension.js` + `git show` of both candidate revisions |
| MCP `running` == `ActiveSession.isRunning`, not the committed phase | `REAL_PRODUCTION_SEAM` | `control-seam-authority.ts:78–99` + `sdk-session-lifecycle.ts:315–326` |
| The BCB hold wrote `resumable` at 18:00:43.541 | `LIVE` | the incident store's own `held_phase_published` observation |
| All conservation predicates cleared at 18:04:29.118 | `LIVE` | the incident store's own `c10_reevaluated` observation |
| No `completed` phase was ever committed/published for the task | `LIVE` | 1178-row publication trace (zero `completed` rows for the task) + the incident store (no `completion_committed`) |
| The last published phase was `streaming` → "Working" + Cancel | `LIVE` | publication 1957 + `stateLabel("streaming")` |
| The publication pipeline itself is healthy | `LIVE` | control: publication 2998 published `completed` for the next session |
| The Elm authority was ENABLED | `LIVE` | `extension.ts:669` unconditional init + the packaged `runtime-assets/completion-authority.js` present in the installed extension |
| The Elm authority's **decision** at 18:04:29.118 | **`UNAVAILABLE_FROM_TRACE`** | the BCB flight-recorder capsule was never checkpointed (checkpoint `savedAt` is pre-incident; PID 98318 still alive) |
| The process-group-absence proof for the incident's jobs | **`UNAVAILABLE_FROM_TRACE`** | the incident store's `coverage` array is empty; no PID was probed (per the ACT) |
| The committed phase's `seq`, and the exact last-writer identity at pub 1957 | **`LIVE_UNOBSERVABLE`** | not present in the publication record; the per-write provenance ring is stale (Nov 3) |
| The webview DOM at 18:06 | **`LIVE_UNOBSERVABLE`** | the operator screenshot is the only UI evidence and is **not** atomic with the MCP reads |
| The BCB hold's `resumable` was written but never published | `INFERRED` | the write is `LIVE` (incident store); the absence of a publication is `LIVE` (zero `resumable` rows); the interleaving inside the handler is inferred |
| The conservation / hold / release / publication machinery is intact | `SYNTHETIC_REAL` | 367 executed assertions over the real seams (invocations A–C) |
| A defect is **not** reproduced against the current source | `NOT_REPRODUCED` | the same 367 assertions |
