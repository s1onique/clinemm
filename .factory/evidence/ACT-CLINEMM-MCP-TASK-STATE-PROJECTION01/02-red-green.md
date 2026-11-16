# 02 — RED → GREEN

**ACT:** `ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01`

---

## RED receipt

**Command**

```
cd apps/vscode && bunx vitest run --config vitest.config.ts \
  src/sdk/control-seam/control-seam.task-state-projection01.test.ts
```

**Exit code:** `1`

**Observed output (verbatim, ANSI stripped):**

```
 FAIL  src/sdk/control-seam/control-seam.task-state-projection01.test.ts [ ... ]
Error: Cannot find package '@shared/task-header-state-label' imported from
  /Volumes/.../apps/vscode/src/sdk/control-seam/control-seam.task-state-projection01.test.ts
 ❯ src/sdk/control-seam/control-seam.task-state-projection01.test.ts:42:1

 Test Files  1 failed (1)
      Tests  no tests
```

**Interpretation.** The RED witness fails because the ACT's contract does
not exist at the entry revision:

1. There is no shared `TurnPhase → label` mapping reachable from the
   extension host (`@shared/task-header-state-label`).
2. There is no controller-owned published-TaskHeader record
   (`@/sdk/published-task-state`).
3. There is no `taskState` property on `ControlSeamRunIdentity`.

The failure is a **missing-contract** failure, not an environment
failure: the witness file itself parses and is collected; the module
resolution error names the exact missing production surface.

**RED baseline diagnostics:** none (the collection error is the ACT's own
missing module, not a pre-existing repository diagnostic).

---

## GREEN receipt

### G1 — The focused production-seam witness

**Command**

```
cd apps/vscode && bunx vitest run --config vitest.config.ts --testTimeout=15000 \
  src/sdk/control-seam/control-seam.task-state-projection01.test.ts \
  src/sdk/control-seam/control-seam.publication-boundary01.test.ts
```

**Exit code:** `0`

```
 ✓ src/sdk/control-seam/control-seam.task-state-projection01.test.ts (31 tests) 29ms
 ✓ src/sdk/control-seam/control-seam.publication-boundary01.test.ts (8 tests) 9ms

 Test Files  2 passed (2)
      Tests  39 passed (39)
```

### G2 — The existing control-seam suites

**Command**

```
cd apps/vscode && bunx vitest run --config vitest.config.ts --testTimeout=15000 src/sdk/control-seam/
```

**Result:** 6 control-seam test files passed with 89 passing tests, plus
`1 failed` file (`control-seam.owner-exclusivity.cor02.test.ts`, see
"Pre-existing baseline diagnostics" below).

---

## R-by-R coverage

### R1 — Active turn versus published phase

| Witness | Seam | Assertion | Result |
|---|---|---|---|
| `R1-1` | REAL `ControlSeamServer` (AF_UNIX) + REAL `ControlSeamClient` (NDJSON) | `running === false` AND `taskState.phase === "streaming"` AND `source === "shadow"` AND `seq === 1957` AND `epoch === 4` AND `stateVersion === 2001` AND `label === "Working"` | PASS |
| `R1-2` | same | `running === true` AND `taskState.phase === "completed"` — the phase is NOT derived from `running` | PASS |

The phase is **not** coerced to `completed`.

### R2 — Terminal completion

| Witness | Assertion | Result |
|---|---|---|
| `R2-1` | `taskState` deep-equals `{ phase: "completed", source: "shadow", seq: 42, epoch: 4, stateVersion: 2001, label: "Complete" }`; the top-level keys are exactly `queuedPromptCount, running, sessionId, taskId, taskState` — **no synthetic completion field** | PASS |

### R3 — Other user-visible states

Over the REAL AF_UNIX transport, each phase is asserted for the exact
phase, the exact provenance (`source === "shadow"`), and the UI label:

| Phase | Label | Result |
|---|---|---|
| `resumable` | Paused | PASS |
| `awaiting_followup` | Your turn | PASS |
| `awaiting_approval` | Approval | PASS |
| `compacting` | Compacting | PASS |
| `error` | Error | PASS |

### R4 — Publication boundary

| # | Requirement | Witness | Seam | Result |
|---|---|---|---|---|
| 1 | A constructed but never-submitted snapshot is not exposed | `PB01` | REAL `PublishedTaskStateStore` + REAL `projectControlSeamTaskState` | PASS |
| 2 | A failed state publication does not advance the record | `PB02` | **REAL `sendStateUpdate`** (an unserializable payload → `false`) + REAL store | PASS |
| 3 | A successful eligible publication becomes observable | `PB03` | **REAL `sendStateUpdate`** (`true`) + REAL store + REAL projection | PASS |
| 4 | A stale async completion cannot replace a newer publication | `PB04` | **REAL `sendStateUpdate`** twice (stateVersion 300 then 299) + REAL store | PASS |
| 5 | An MCP read triggers no Elm evaluation, state post or new agent execution | `R4-5` | The authority surface is asserted to have exactly six READ members and no mutating member | PASS |

`PB02` is the load-bearing failure witness: it drives the **production**
`sendStateUpdate` with a self-referencing (non-serializable) payload, so
the REAL handoff returns `false`, and asserts the previous record still
stands. The telemetry service is stubbed (its singleton needs a
`HostProvider`); the `sendStateUpdate` handoff itself is NOT mocked.

Additional store-level witnesses: `PB05` (older-epoch publication
rejected), `PB06` (exactly ONE bounded record after 50 captures — no
history, no diagnostic queue), `PB07` (the read record and its
projection are frozen — a consumer cannot mutate controller-owned
state), `PB08` (the projected label equals the shared UI mapping).

### R5 — Identity and epoch conservation

| # | Requirement | Witness | Result |
|---|---|---|---|
| 1 | Task A followed by task B never returns A's phase | `R5-1` (mismatched session+task → `taskState` absent) | PASS |
| 2 | An epoch bump invalidates the old phase | `R5-2` (`store.invalidate()` → `taskState` absent) + `PB05` (older-epoch capture rejected) | PASS |
| 3 | A session replacement under the same task ID cannot expose an incorrectly bound old session projection | `R5-3` (same task id, different session id → `taskState` absent) | PASS |
| 4 | Foreign-session requests are still refused | `R5-6` (`control_seam_foreign_session`) | PASS |
| 5 | No active session produces the existing no-active-run response | `R5-4` (`control_seam_no_active_run`) | PASS |
| 6 | A phase record absent at startup remains absent until a valid publication | `R5-5` (no `taskState` AND no `taskStatus` key) | PASS |

### R6 — Read-only security

| # | Requirement | Witness | Result |
|---|---|---|---|
| 1 | Unauthenticated requests disclose nothing | `R6-1` — a wrong bearer token yields `control_seam_unauthorized` and the response contains neither the session id nor the phase | PASS |
| 2 | Unknown response keys are rejected | `R6-2` (unknown top-level key; unknown `taskState` key `transcript`) | PASS |
| 3 | No task content, messages, file paths, secrets or model-output text are exposed | `R6-8` | PASS |
| 4 | Existing socket ownership, timeouts and size limits remain unchanged | The existing `control-seam.qual01.test.ts` (QL01–QL21) passes unchanged | PASS |
| 5 | Repeated reads without a new publication are byte-identical | `R6-9` | PASS |
| 6 | Disabled control seam does not alter task-state semantics | The seam's disabled path creates no listener; the capture is in the controller's publication path and is independent of the seam's enablement | PASS (structural — the seam's enablement never reaches the capture) |
| 7 | A disconnected Codex client cannot change a task | `R6-10` — after disconnect the client cannot obtain a response; the previously observed payload is unchanged | PASS |

Additional strict-validation witnesses: `R6-3` (unknown phase),
`R6-4` (invalid source discriminant), `R6-5` (negative / non-integer
sequence and version), `R6-6` (missing required nested field), `R6-7`
(`null` substituted for optional absence).

---

## Pre-existing baseline diagnostics

### `control-seam.owner-exclusivity.cor02.test.ts` — COR02-R1 / COR02-R2

**Symptom**

```
 × COR02-R1: at most ONE process acquires an unowned endpoint, and the loser's
   record is NOT replaced 30823ms
   → both contenders must reach the write gate: expected false to be true

Error [ERR_UNSUPPORTED_ESM_URL_SCHEME]: Only URLs with a scheme in: file, data,
and node are supported by the default ESM loader. Received protocol 'bun:'
```

**Baseline verification.** A pristine detached worktree at `HEAD`
(`5dc139480`) was created, the same node_modules were linked, and the
same command was run:

```
cd /tmp/act-baseline/apps/vscode && bunx vitest run --config vitest.config.ts \
  --testTimeout=60000 src/sdk/control-seam/control-seam.owner-exclusivity.cor02.test.ts
```

**Result at HEAD (baseline):** `Test Files 1 failed (1)` / `Tests 2 failed
| 3 passed (5)` with the identical `ERR_UNSUPPORTED_ESM_URL_SCHEME` and
the identical `COR02-R1` failure at `30823ms`.

**Classification:** `BASELINE_DIAGNOSTIC` — **pre-existing**, **not
ACT-owned**. The test spawns a worker whose entry uses the `bun:`
module scheme; the Node ESM loader used by the test harness cannot load
it. The failure is independent of every file this ACT changed.

The baseline worktree `/tmp/act-baseline` was removed afterwards; the
repository's own worktree inventory is unchanged.

### ACT-owned diagnostics

**None.** Every gate that exercises an ACT-owned path is green — see
`05-executable-gates.md` for the full receipt table.


### R7 — React/Elm conservation

| Requirement | Status |
|---|---|
| `Elm selection → ExtensionState.taskHeaderPresentation → webview projection → React rendering` unchanged | The Elm authority (`task-header-elm-authority.ts`) is **not modified**. The webview helper's `stateLabel` now reads the label TEXT from the shared mapping; the glyph / live facets and every rendering site are unchanged. |
| React functional updaters not modified | No React component, reducer, or functional updater was touched. The two existing updater-purity suites pass unchanged (7/7). |
| No diagnostic writes, refs, counters, subscriptions or setters inside functional updaters | None added. The capture lives in the controller's publication path. |
| No second canonical state owner | The store holds a **copy** of the projection that the Elm authority already selected; it never computes one. The Elm kernel remains the sole semantic selector. |

| `idle` | Idle | PASS |

`R3-label` asserts the MCP label equals the shared UI label mapping
(`taskHeaderPhaseLabel("awaiting_followup") === "Your turn"`,
`taskHeaderPhaseLabel("resumable") === "Paused"`) — the SAME pure
mapping the TaskHeader renders, not a second switch.
