# ACT-CLINEMM-COMMAND-PROCESS-OUTCOME-TRACE-BRIDGE01-CORRECTION01

**Bounded correction of the two P0 findings raised against BRIDGE01.**
**Reviewer verdict addressed:** `HALT_EVIDENCE_PROVENANCE_AND_OFF_PATH_DELTA`
**Parent commit:** `d46e33530` (BRIDGE01, `PASS_STRUCTURAL_VERIFIED`)
**Scope:** two bounded corrections. No architecture change, no process
supervision change, no repository-wide review.

---

## 0. What this correction changed, and what it did not

| Finding | Status | Where |
|---|---|---|
| **P0-1** — the necessity ablation ran over a hand-AUTHORED array presented as "CAPTURED process evidence" | **FIXED** | §2 |
| **P0-2** — `executeShellCommands` stamped the correlation index into the executor context UNCONDITIONALLY, including with tracing OFF | **FIXED** | §1 |
| **P2** — `git diff --check` reported a blank line at EOF in `REPORT.md` | **FIXED** | §4 |

The production bridge, the event contract, the privacy allowlist, the
per-command correlation, and the delayed-background-completion behaviour are
**preserved unchanged**. The BRIDGE01 witness suites still pass. Two
production seams were touched:

- `sdk/packages/core/src/extensions/tools/definitions.ts` — the stamp site is
  now CONDITIONAL (§1.2);
- `sdk/packages/core/src/extensions/tools/executors/command-process-observation.ts`
  — one new exported predicate, `isCommandProcessObservationChannelPresent`
  (§1.1).

---

## 1. P0-2 — the disabled-path context delta

### 1.1 The defect

BRIDGE01's `executeShellCommands` built the per-command context like this:

```ts
const indexedContext: AgentToolContext = {
    ...commandContext,
    metadata: {
        ...(commandContext.metadata ?? {}),
        [COMMAND_PROCESS_OBSERVATION_INDEX_METADATA_KEY]: commandIndex,
    },
}
const output = await withTimeout(executor(command, cwd, indexedContext), ...)
```

This ran **unconditionally**. With tracing OFF, the executor therefore
received a context object the predecessor never produced: a new `metadata`
identity, carrying a new key. The reviewer's finding was precise — *this does
not demonstrate an actual command-result regression, but it does establish an
unconditional production-context delta that contradicts the frozen
disabled-path neutrality contract.* That finding is accepted in full.

### 1.2 The fix

The stamp is now conditional on the observation channel being **PRESENT**:

```ts
const observationChannelPresent =
    isCommandProcessObservationChannelPresent(commandContext.metadata)
const indexedContext: AgentToolContext = observationChannelPresent
    ? { ...commandContext, metadata: { ...(commandContext.metadata ?? {}), [KEY]: commandIndex } }
    : commandContext
```

`isCommandProcessObservationChannelPresent` is the **single authority** for
that decision, exported from the observation module so the stamp site and the
report site cannot disagree.

### 1.3 Why PRESENCE, and not the recorder's enable bit

This is the one design decision in this correction that needed care, because
the obvious reading of "stamp only when tracing is off" breaks a different
contract.

There are **two different states**, and BRIDGE01 conflated them:

| State | Meaning | Correct behaviour |
|---|---|---|
| **ABSENT** | No sink is wired at all — the runtime has no recorder. | The executor receives the **EXACT predecessor context**. No new key, no new object shape, **no context delta at all**. |
| **DISABLED** | A sink IS wired, but the recorder's enable bit is off. | The channel is structurally present, so the correlation index **is** carried; the enable bit is consulted at **observation** time, so **nothing is emitted**. |

Consulting the enable bit at *stamp* time was the wrong predicate, and the
witnesses caught it: with the enable-bit predicate, BRIDGE01's own **G7**
witness — *"toggling ON after the handoff emits the terminal fact"* — **failed**.
The reason is structural: a background command handed off while the recorder
was disabled would lose its `commandIndex` **forever**, so the delayed terminal
fact could never be correlated back to its position in the batch.

The enable bit is a **runtime toggle**, not a property of the channel's
wiring. The two decisions are therefore kept apart:

- **this predicate** decides whether the executor's **CONTEXT** changes at all
  — a stable, structural property;
- `readObservationChannel` (unchanged) decides whether an **OBSERVATION** is
  emitted — a volatile, per-event property, consulted at observation time.

So the disabled path produces **no recorder event** while still preserving the
correlation identity a later toggle needs.

### 1.4 The witnesses, and their discriminating power

`sdk/packages/core/src/extensions/tools/command-process-observation.test.ts` —
the `createShellTool — disabled-path context neutrality (CORRECTION01)` suite,
5 witnesses:

| Witness | Asserts |
|---|---|
| `CORR01-1` | channel ABSENT → the executor receives the **same object** (`toBe`), with **no** `__clineCommandProcessObservationIndex` key |
| `CORR01-2` | channel PRESENT but recorder DISABLED → the index **is** carried (indices 0 and 1), and **zero** observations are emitted |
| `CORR01-3` | OFF vs ON → **identical** results (`JSON.stringify` equality) **and** an **identical scheduling-order witness** (not just identical bytes) |
| `CORR01-4` | channel ACTIVE → the index **is** still stamped (0 and 1) and the bridge still emits both observations |
| `CORR01-5` | the predicate is the single authority: absent sink → false; sink without `onProcessObservation` → false; sink reporting disabled → **true** (the toggle is not the predicate); enabled → true; no probe → true; **failing probe** → true |

**Discrimination was measured, not assumed.** With the production stamp
reverted to BRIDGE01's unconditional form, `CORR01-1` and `CORR01-2` **FAIL**
(2 failed / 6 passed); with the correction applied, **8/8 pass**. The
witnesses therefore genuinely discriminate the defect.

The **host-level** counterpart was added to
`apps/vscode/src/sdk/__tests__/command-process-outcome-trace-bridge01.test.ts`
as `G8-CORR01` ×2:

- channel ABSENT → the tool-call context carries **no** correlation index and
  its metadata is **exactly `{}`** — the predecessor shape;
- channel PRESENT → the host emits **two** observations with **two distinct**
  positional indices (0 and 1).

### 1.5 The G7 contract is intact

BRIDGE01's G7 witnesses still pass **unchanged** — including
*"toggling ON after the handoff emits the terminal fact (still explicitly
partial)"*, which is the witness that caught the enable-bit predicate (§1.3).
The correction therefore does not trade one contract for another.

---

## 2. P0-1 — the evidence provenance of the necessity ablation

### 2.1 The defect

BRIDGE01's C5 ablation ran over `CAPTURED_WITH_PROCESS` — a hard-coded array
authored **inside the test file**, with invented timestamps and invented
events. The suite was named *"C5 — executed necessity ablation over CAPTURED
process evidence"* and §8 of the report described the ablation as *"executed
over the CAPTURED process evidence, not over a conceptual table"*.

That promoted a **constructed** fixture to **captured** evidence. The
constructed fixture also placed `tool_finish` **before** the foreground process
observations, which is **not** the observed foreground execution order.

### 2.2 The fix — the ablation now runs over REAL recorder output

A new suite,
`apps/vscode/src/sdk/__tests__/command-process-outcome-real-capture-ablation01.test.ts`,
produces a **real, source-bound capture**:

1. the **real** `ModelBehaviorTraceRecorder` is armed;
2. the **real** `createVscodeRunCommandsTool` runs a **real** command through
   the **real** `CommandJobManager` — a real subprocess, a real exit code, a
   real job id, a real background handoff;
3. the recorder is fed through a sink wired **exactly like the production
   `modelBehaviorTraceSink`** — `onToolStart`, `onToolFinish` and
   `onProcessObservation` all land in the **same** recorder buffer, so the
   capture contains **both** the tool-activity events **and** the per-command
   process events;
4. the recorder's **own retained records** are serialized to JSONL. That
   string — the recorder's output, **not** an authored array — is what the
   normalizer parses and what the ablation removes a category from.

The capture is then **written to the ACT evidence directory**, so the claim is
bound to a committed artifact:
`docs/acts/ACT-CLINEMM-COMMAND-PROCESS-OUTCOME-TRACE-BRIDGE01/evidence/real-process-capture.jsonl`.

### 2.3 The real capture, as committed

```jsonl
{"seq":1,"timestamp":"...","traceId":"...","event":"tool_start","evidenceBoundary":"partial_identity","sessionId":"session-real-capture","runId":"run_realcapture01","payload":{"toolCallId":"call-real-capture","toolName":"run_commands","origin":"model_requested"}}
{"seq":2,"timestamp":"...","traceId":"...","event":"process_observation","evidenceBoundary":"partial_identity","sessionId":"session-real-capture","runId":"run_realcapture01","payload":{"toolCallId":"call-real-capture","commandIndex":0,"executionMode":"background","terminalState":"running","jobId":"cmd_mw0ks5y97ia3alew","provenance":"REAL_PRODUCTION_SEAM","source":"background_job_manager_handoff"}}
{"seq":3,"timestamp":"...","traceId":"...","event":"tool_finish","evidenceBoundary":"partial_identity","sessionId":"session-real-capture","runId":"run_realcapture01","payload":{"toolCallId":"call-real-capture","toolName":"run_commands","outcome":"success"}}
{"seq":4,"timestamp":"...","traceId":"...","event":"process_observation","evidenceBoundary":"partial_identity","sessionId":"session-real-capture","runId":"run_realcapture01","payload":{"toolCallId":"call-real-capture","commandIndex":0,"executionMode":"background","terminalState":"exited","exitCode":7,"jobId":"cmd_mw0ks5y97ia3alew","provenance":"REAL_PRODUCTION_SEAM","source":"background_job_manager_terminal"}}
```

Two properties are worth naming explicitly, because both were wrong in the
constructed fixture:

- **The ordering is the observed one.** The `running` handoff (`seq` 2)
  precedes the `tool_finish` (`seq` 3), and the authoritative terminal fact
  (`seq` 4) arrives **after** the tool call returned. The constructed fixture
  had put `tool_finish` first.
- **The exit code is the process's own.** `exitCode: 7` is the code
  `/bin/sh -c 'sleep 0.2; exit 7'` actually produced. It was not written into
  the fixture.

### 2.4 The ablation over the real capture

| Phase | Q2 (exact process-success classification) | Tool-activity sequence |
|---|---|---|
| **BASELINE** (process records present) | **ANSWERABLE** — `exited_nonzero_7` (the real exit code) | observable — `tool_start:run_commands`, `tool_finish:run_commands` |
| **ABLATION** (only the `process_observation` category removed) | **`CAPTURE_INSUFFICIENT`** — the classifier finds **zero** per-command facts and does **not** infer any | **UNCHANGED and still observable** |
| **RESTORE** (process records put back) | **ANSWERABLE** again — `exited_nonzero_7` | observable |

The decisive observation is unchanged and is now measured on real evidence: in
the ABLATION phase the aggregate tool outcome **still reads `success`** — the
exact defect the bridge removes. The aggregate cannot distinguish one
command's nonzero exit from another's clean exit.

### 2.5 The constructed fixture is RETAINED — as a synthetic control

The authored fixture was **not** deleted. It is a perfectly good control for
the **NORMALIZER's** behaviour, and the review explicitly asked that it be
preserved. It was, however, **renamed and relabelled**:

| | BRIDGE01 | CORRECTION01 |
|---|---|---|
| Constant | `CAPTURED_WITH_PROCESS` | `SYNTHETIC_CONTROL_WITH_PROCESS` |
| Suite | `C5 — executed necessity ablation over CAPTURED process evidence` | `C5 — SYNTHETIC CONTROL: the normalizer ablation over an AUTHORED fixture` |
| Witnesses | `BASELINE` / `ABLATION` / `RESTORE` | `SYNTHETIC CONTROL BASELINE` / `… ABLATION` / `… RESTORE` |
| Claim it carries | real-evidence **necessity** | **normalizer behaviour only** |

The file's header now states plainly that the suite is a synthetic control
and points at the real-capture suite for the necessity claim.

---

## 3. Executed gates

All commands were run in this workspace. `bun` was invoked as
`bun x vitest …` / `bun run …` per the repository toolchain rules.

| # | Gate | Command | Result |
|---|---|---|---|
| 1 | Core SDK — per-command observations + disabled-path neutrality | `cd sdk/packages/core && bun x vitest run src/extensions/tools/command-process-observation.test.ts --config vitest.config.ts` | **8 passed** (RED-01, RED-03, RED-04, CORR01-1 … CORR01-5) |
| 2 | VSCode — bridge conservation + OFF-path context | `cd apps/vscode && CLINEMM_EXPERIMENTAL_SANDBOX=off bun x vitest run src/sdk/__tests__/command-process-outcome-trace-bridge01.test.ts --config vitest.config.ts` | **14 passed** (G2 ×5, G4, G5, G7 ×2, G8 ×2, G8-CORR01 ×2, G9) |
| 3 | VSCode — portable normalizer + SYNTHETIC CONTROL | `cd apps/vscode && bun x vitest run src/sdk/__tests__/command-process-outcome-portable-normalizer01.test.ts --config vitest.config.ts` | **8 passed** (G10 ×2, PORT-1, PORT-2, G9/PORT, C5/CTRL ×3) |
| 4 | VSCode — REAL-capture ablation | `cd apps/vscode && CLINEMM_EXPERIMENTAL_SANDBOX=off bun x vitest run src/sdk/__tests__/command-process-outcome-real-capture-ablation01.test.ts --config vitest.config.ts` | **5 passed** |
| 5 | Shared SDK — the recorder | `cd sdk/packages/shared && bun x vitest run src/runtime/model-behavior-trace.test.ts --config vitest.config.ts` | **18 passed** |
| 6 | VSCode — trace runtime + dogfood + contract | `cd apps/vscode && CLINEMM_EXPERIMENTAL_SANDBOX=off bun x vitest run <10 trace suites> --config vitest.config.ts` | **120 passed** across 10 files |
| 7 | VSCode — dogfood default + run-commands tool | `cd apps/vscode && CLINEMM_EXPERIMENTAL_SANDBOX=off bun x vitest run src/sdk/model-behavior-trace-dogfood-default.test.ts src/sdk/vscode-run-commands-tool.test.ts --config vitest.config.ts` | **64 passed** |
| 8 | `sdk/packages/shared` typecheck | `cd sdk/packages/shared && bun run typecheck` | **0 errors** |
| 9 | `apps/vscode` typecheck | `cd apps/vscode && bun x tsc --noEmit` | **0 errors** |
| 10 | `sdk/packages/core` typecheck | `cd sdk/packages/core && bun run typecheck` | **40 errors — identical to the stashed baseline** (zero new) |
| 11 | Biome — SDK packages | `bun x --bun @biomejs/biome check --diagnostic-level=error <3 SDK files>` | **clean** |
| 12 | Biome — extension | `cd apps/vscode && bun x --bun @biomejs/biome check --config-path ./biome.jsonc --diagnostic-level=error <3 extension files>` | **clean** |
| 13 | SDK build | `bun run build:sdk` | **success** |
| 14 | `git diff --check` | `git diff --check` | **clean** |

### 3.1 Regression set comparison — zero new failures

Two failing-file sets were captured under the **same procedure**, once with
the correction stashed and once with it applied:

| Suite area | Stashed baseline | With the correction | Delta |
|---|---|---|---|
| `sdk/packages/core` — `src/extensions/tools/` | 2 files / 6 tests failed (`editor.realpath-authority.test.ts` ×3, `bash.supervised.bash-startup-env.test.ts` ×3) | **identical** | **zero new** |
| `apps/vscode` — `src/sdk/vscode-run-commands-tool.background-state.test.ts` | 6 tests failed | **identical** | **zero new** |

Both baseline failures are the **documented pre-existing** ones: the
headless stub's `getShellForProfile` resolves to `"unknown"` so every
background spawn fails with `containment_failed` before the command runs
(the `vscode-run-commands-tool.background-state.test.ts` suite), and the
sandbox `mktemp` restriction (`bash.supervised.bash-startup-env.test.ts`).
They reproduce identically on the pristine baseline.

### 3.2 Discrimination measurement (P0-2)

| Production stamp | `CORR01-1` | `CORR01-2` | Other witnesses | Total |
|---|---|---|---|---|
| BRIDGE01's unconditional form | **FAIL** | **FAIL** | pass | 2 failed / 6 passed |
| CORRECTION01's conditional form | pass | pass | pass | **8 passed** |

---

## 4. P2 — repository hygiene

The `git diff --check` diagnostic (`REPORT.md:607: new blank line at EOF`) is
fixed: the trailing blank line was removed from `REPORT.md`. `git diff
--check` now reports **clean** on the whole change set (gate 14 above).

---

## 5. Limitations — unchanged and explicitly not claims

- **No installed-dogfood qualification is claimed.** This correction did not
  install a VSIX and did not run an installed dogfood. Per the reviewer's
  instruction, installed-dogfood qualification is authorized **directly** once
  these two proofs are established — it is the next step, not a claim made
  here.
- **The real capture exercises the BACKGROUND path** (the `CommandJobManager`
  path) because that is the path that produces a delayed terminal fact, which
  is what the ablation needs to demonstrate. The FOREGROUND path's real
  capture is in `evidence/process-observation-excerpt.jsonl` (§7 of the main
  report) and its witnesses are G2/G4/G5 in the bridge suite.
- The **synthetic control** remains in the tree. It now carries only the
  normalizer-behaviour claim (§2.5).
- The sandbox `EPERM: operation not permitted, kill` worker-teardown artifact
  is unchanged and still aborts a whole-suite `vitest run` before its summary
  — the reason the regression comparison above is per-suite and set-compared.

---

## 6. Verdict

**`PASS_STRUCTURAL_VERIFIED_CORRECTION01`**

Both P0 findings are fixed and the fixes are measured, not asserted:

- the disabled-path context delta is removed, the witnesses **discriminate**
  the defect (they fail against the pre-correction production code), and the
  G7 toggle contract is preserved;
- the necessity ablation now runs over the **real** recorder's own output
  from the **real** production seams, and that capture is **committed** as
  source-bound evidence.

The constructed fixture is preserved as a clearly-labelled synthetic control.
The P2 hygiene defect is fixed. No architecture was reopened, no process
supervision was touched, no repository-wide review was repeated.
