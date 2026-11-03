# ACT-CLINEMM-TRACE-DECISION-SUFFICIENCY-RECON01 — CORRECTION01 — Successor Contract Repair

**Type:** Bounded documentation correction of a *proposed, unimplemented* successor contract.
**Status:** COMPLETE — terminal verdict below.
**Branch:** existing `main` (no ACT branch created).
**Production delta:** ZERO. No runtime, recorder, normalizer, React, Elm, protobuf, wire contract or test implementation was modified. This ACT corrects a **contract**, not an implementation.

---

## 0. Terminal verdict

**`HALT_SUCCESSOR_CONTRACT_FALSE_CARDINALITY`** — the successor proposed by
`ACT-CLINEMM-TRACE-DECISION-SUFFICIENCY-RECON01` §11 is **not implementable as written**, and the
implementation ACT is therefore **blocked pending a corrected contract**.

The recon's own measured findings are **retained unchanged** and remain `PASS_RECON_WITH_GAPS`. This
ACT repairs exactly two things in the recon:

1. the **successor contract** (§11 of the recon report) — it asserts a cardinality and an observation
   time that the production seam does not have; and
2. the **ablation classification** (§7.2 of the recon report) — a counterfactual table was presented
   as an executed ablation of the specimen.

**What is NOT reopened:** the capture analysis, the conformance gates, the privacy assessment, the
`PARTIAL` completeness verdict, the 949/949 all-success finding, the Q1/Q2/Q3 answers, the
`BASELINE_FAILURE` classification of `command-job-manager.owner-session-id.test.ts`, and the
`PASS_RECON_WITH_GAPS` verdict of the recon itself.

---

## 1. Entry identity and hygiene

| Property | Value |
|---|---|
| `ENTRY_HEAD` | `3b9c9f59ac70484399c09c395b6920a794c6e22a` |
| `ENTRY_TREE` | `08dd02a580d0c394e3dced5d859769e0171a34c3` |
| Branch | `main` |
| `git status --porcelain=v1 -uall` | **0 entries** (clean at entry) |
| Stashes / worktrees | untouched |
| Push / branch / install | NONE / NONE / NONE |

**Hygiene verdict: clean. `HALT_UNEXPECTED_DIRT` not triggered.**

---

## 2. The two P0 defects in the proposed contract

The recon proposed: *"One scalar per `run_commands` invocation: the process exit status … carried on
the **existing** `tool_finish` event, correlated by the **already-existing** `toolCallId`."*

Both halves of that sentence are false against the production seam. Each defect below was established
by **source inspection of the production files at `ENTRY_HEAD`**, not by reading the recon's own
citations.

### 2.1 P0-A — one tool call is **not** one command

`createShellTool` accepts an **array** of commands and executes them **concurrently**:

| Fact | Production evidence at `ENTRY_HEAD` |
|---|---|
| The tool's output type is an **array** | `sdk/packages/core/src/extensions/tools/definitions.ts:742` — `AgentTool<RunCommandsInput, ToolOperationResult[]>` |
| Execution is **concurrent over the array** | `definitions.ts:284-285` — `return Promise.all(commands.map(async (command, commandIndex): Promise<ToolOperationResult> => { … }))` |
| Each command produces its **own** result | `definitions.ts:352-392` — each map body returns `{ query, result, success: true }` **or** `{ query, result, error, success: false }` (for `CommandExitError`, `CommandTerminationError` and the generic failure branch) |
| The per-command identity is **positional** | `definitions.ts:285` (the `commandIndex` map parameter), `definitions.ts:320` (the per-command capability slot), `definitions.ts:341` (the `commandIndex` carried on the `emitUpdate` envelope). The plan itself asserts `plan.commands[i].commandIndex === i` (`definitions.ts:432`). |

Therefore:

```text
1 toolCallId  →  N command executions  →  N potentially different outcomes
```

`ToolOperationResult` (`sdk/packages/core/src/extensions/tools/types.ts:27-38`) carries
`{ query, result, error?, success, duration? }` and **no `commandIndex` field** — the array is
positional, so the array index *is* the `commandIndex` at the result boundary, while the
`commandExecutionPlan` slot is the explicit `commandIndex` on the plan.

**A single exit-status scalar on `tool_finish` cannot represent a mixed batch** — e.g. a command
that exited `0`, a command that exited `1`, and a command that is still running in the background.
Collapsing N outcomes to one scalar would manufacture a fact the seam never observed. **This is the
`HALT_SUCCESSOR_CONTRACT_FALSE_CARDINALITY` disposition.**

### 2.2 P0-B — background completion happens **after** `tool_finish`

In background mode the tool returns **before** the process's terminal status exists:

| Step | Production evidence at `ENTRY_HEAD` |
|---|---|
| The `RUNNING` handoff returns to the model | `apps/vscode/src/sdk/vscode-run-commands-tool.ts:1808-1816` — `const runningPayload = { status: "running" as const, jobId: start.jobId, elapsedMs, deadlineRemainingMs, outputTruncated, stdout }` then `return JSON.stringify(runningPayload)` |
| The terminal fact is observed **later** | `vscode-run-commands-tool.ts:1851-1855` — `start.terminalPromise.then(({ jobId, terminalState }) => { notifyBackgroundStateChange(false, jobId, terminalState, …) })` |
| The terminal promise is resolved by the manager | `apps/vscode/src/sdk/command-job-manager.ts:1185` (`terminalTransitions` map), `:1838-1856` (promise creation), `:2645-2654` (resolution with `terminalState`) |
| The terminal class is decided at finalize | `command-job-manager.ts:2450` (`finalize`), `:2557-2571` (terminal state selection, including `containment_failed`) |

The authoritative event order is therefore:

```text
tool_start            — command submitted
tool_finish           — returned RUNNING (jobId); the process is still alive
   … process continues independently …
terminal observation  — exit status / terminal class observed later
```

**`tool_finish` cannot truthfully carry a terminal exit code that has not yet been observed.** For a
background job, the value observable at `tool_finish` is `RUNNING` — which is **nonterminal**, and
must never be recorded as a process success.

### 2.3 The 949/949 all-success finding is **stronger** than the recon stated

The recon attributed the collapse to `definitions.ts:366`. The full causal chain is:

| Step | Production evidence at `ENTRY_HEAD` |
|---|---|
| A per-command failure is **caught inside** `executeShellCommands` | `definitions.ts:357-392` — the `catch` branch returns `success: false` **inside the array**; it does **not** re-throw |
| `createTool` is a **pure passthrough** | `sdk/packages/shared/src/tools/create.ts:110-158` — it returns `{ …, execute: config.execute }` and derives nothing from the output value |
| The runtime stores the array as the output and sets **no** `isError` | `sdk/packages/agents/src/agent-runtime.ts:4729` — `result = { output }` |
| The trace boundary collapses to one boolean | `agent-runtime.ts:4857` — `outcome: result.isError ? "error" : "success"` |

Consequence: `tool_finish.outcome` for a `run_commands` call is `"success"` **unless the whole tool
throws at the top level**. A command that exited non-zero is *visible only inside the output array*,
which the boundary never inspects. **This is why 949/949 `run_commands` recorded
`outcome:"success"`.**

> **This strengthens the recon's central finding and does not weaken it.** The recon's conclusion —
> *"the trace records the boolean tool outcome, never the process exit status"* — is **correct and
> confirmed**. The correction is only about **where** the successor must observe, and **at what
> cardinality**.

---

## 3. P0-C — the ablation is a **counterfactual**, not an executed ablation

The recon's §7.2 table is introduced as *"Necessity discriminator — offline evidence ablation"* and
concludes *"The specimen supports the ablation. It is not a fabricated success."*

But its own **Full** row reads `answerable / answerable / answerable` — while §7.1 states, for the
same specimen, that **Q2 is `CAPTURE_INSUFFICIENT`** and **Q3 is `CAPTURE_INSUFFICIENT`**. The table's
baseline row is therefore a **hypothetical configuration in which both are answerable**, and the
"Full" row is not a state this specimen was ever in.

**Classification correction:** the §7.2 table is a **necessity argument** — *"if the process-result
category were present, removing it would kill exactly Q2"* — and must be labelled
**`HYPOTHESIS_ONLY`** until process outcomes are actually captured and the proposed discriminator is
exercised against real evidence. It is **not** an executed ablation of the specimen, and it does not
establish that the specimen supports the ablation.

The recon's §7.3 conclusion that *"Q3 is answerable today, offline, by composition"* remains sound:
it does not depend on the ablation table, and the independent evaluator already exists and is
independence-preserving.

### 3.1 A related causal claim narrowed

The recon (and the epic board) state that the agent was *"**not** looping"*, citing 948/949 distinct
argument fingerprints and a production `LoopDetectionTracker` that reached `soft`×1 / `hard`×0.

**Narrowed wording (this ACT's canonical form):**

> The trace **rules out substantial identical-call repetition** (948/949 distinct fingerprints, max
> repeat 2, `hard`×0). It **does not** rule out **semantic cycling through different commands**.
> No claim is made about the agent's strategy quality.

---

## 4. The corrected successor contract

The successor remains **one bounded ACT** (`ACT-CLINEMM-COMMAND-PROCESS-OUTCOME-TRACE-BRIDGE01`),
still **default-OFF**, still **no public wire change**, still **no new process monitor**. Only the
**observation boundary**, the **cardinality**, and the **terminality semantics** change.

| Requirement | Corrected contract |
|---|---|
| **Command cardinality** | Preserve `commandIndex` and the **individual** command outcome. One recorded entry per executed command. **Never** collapse N outcomes to one scalar. |
| **Foreground** | Exact exit code **where observed**; an explicit **`unknown`** otherwise (shell integration reported no code — `VscodeTerminalProcess.ts:374-381`). |
| **Background handoff** | `RUNNING` is **nonterminal**. It is recorded as such and **never** as a process success. |
| **Background completion** | Capture the **eventual authoritative result**, even though it arrives **after** the original tool call returned. |
| **Correlation** | Exact `(session, toolCallId, commandIndex) → jobId` **where established**. **No timestamp joins.** |
| **Terminal taxonomy** | Distinguish `exited`, `cancelled`, `deadline_exceeded`, `spawn_failed`, `containment_failed` and `unknown`. Never collapse `containment_failed` into `exited`; never collapse `unknown` into `0`. |
| **Recorder** | Default-**OFF**. **No execution-semantic delta.** Privacy-safe. |
| **Proof** | Real-seam **RED→GREEN**, **mixed-command controls**, **delayed-completion controls**, and a **necessity ablation** executed against captured evidence. |

### 4.1 The observation boundary is **not** preordained

The recon fixed the boundary in advance ("on the **existing** `tool_finish` event"). §2.1 and §2.2
show that `tool_finish` **cannot** carry the required facts:

- it fires **once per tool call**, while N command outcomes exist; and
- it fires **before** a background job's terminal status exists.

**Therefore the boundary must be established at the actual production seam, not assumed.** The two
candidate seams, and what each can and cannot carry:

| Candidate seam | Can carry | Cannot carry |
|---|---|---|
| `tool_finish` (`agent-runtime.ts:4849`) | the single tool-level boolean; `toolCallId` | per-command cardinality; a background terminal status that does not yet exist |
| **per-command execution** (`definitions.ts:284-395`, inside `executeShellCommands`) | the per-command outcome, keyed by `commandIndex` | a background job's **terminal** status — the command's own result at that point is the `RUNNING` handoff payload |

A background job's terminal status is only observable at the **manager** seam
(`CommandJobManager.finalize` / `terminalPromise`, `command-job-manager.ts:2450`, `:2645-2654`),
which is **after** the tool call has returned.

**Consequence:** a faithful implementation of this contract **may require an additional internal
trace event** for the background terminal result, because the `tool_finish` event is closed before
that fact exists. **Whether an existing event can carry every observation, or an additional internal
event is required, is to be determined by the implementation ACT at the real seam — it is not
preordained here, and it is not preordained *against* it either.**

Constraints that hold regardless of which seam is chosen:

- **No public wire change.** Any additional event is **internal** to the recorder.
- **No new process monitor.** The manager already observes the terminal fact.
- **No timestamp joins.** Correlation is by `(session, toolCallId, commandIndex)` and, where
  established, `jobId`.
- **Default-OFF, no execution-semantic delta.** With tracing off, tool execution order and results
  are byte-identical to today.

### 4.2 The privacy envelope is unchanged

Exit code, terminal class, `commandIndex` and `jobId` only. **No** command text, **no** argv, **no**
stdout/stderr, **no** environment, **no** absolute path, **no** duration-of-a-nonterminal-claim.
`jobId` is a manager-minted opaque id (already model-visible), not a path.

The existing fail-closed allowlist in `apps/vscode/src/sdk/normalize-agent-trace.ts` must be extended
to permit the new keys **explicitly** — an unfamiliar key still does not escape
(`normalize-agent-trace.ts:670-675`). The `process` family's `FAMILY_KEYS` entry is currently
intentionally empty (`normalize-agent-trace.ts:1063-1066`); it may gain a real producer only if the
implementation places the facts in that family.

> **Implementation note (not a contract change):** the recorder's payload sanitizer allows arrays of
> scalars (`sdk/packages/shared/src/runtime/model-behavior-trace.ts:1854-1856`) and the portable
> normalizer caps payload depth at 4 (`normalize-agent-trace.ts:640`, `:705`). A per-command array
> fits these bounds; the implementation ACT must still verify the depth and the fail-closed
> allowlist at the real seam rather than assume them.

## 5. Required proof for the implementation ACT

### 5.0 Executable evidence executed by THIS ACT

The P0 claims above are not assertion-only. Two read-only probes were executed against the
**built SDK** (`sdk/packages/core/dist/index.js`) at `ENTRY_HEAD`, plus a source-claim verifier.

**(a) False cardinality, at the real `createShellTool` seam.** One `run_commands` invocation with two
commands whose outcomes differ:

```text
tool.name           = run_commands
isArray(output)     = true
output.length       = 2 (N commands)
per-command success: [0] success=true  |  [1] success=false  (Command exited with code 3)
runtime result.isError = undefined
tool_finish.outcome    = success
VERDICT: FALSE CARDINALITY CONFIRMED: 2 commands with DIFFERENT outcomes collapse to ONE 'success' scalar
```

This is the decisive executable evidence: **a command that failed with exit code 3 is invisible to
the trace boundary**, which records `success`. A single exit-status scalar on `tool_finish` could
not have carried this batch.

**(b) `commandIndex` is the per-command ordering discriminator**, observed on the `emitUpdate`
envelope inside `executeShellCommands`:

```text
emitUpdate envelopes: [{"chunk":"alpha","commandIndex":0,...},{"chunk":"beta","commandIndex":1,...},{"chunk":"gamma","commandIndex":2,...}]
commandIndex sequence: 0,1,2
positional & unique: YES
VERDICT: commandIndex IS the per-command ordering discriminator — the required cardinality key
```

**(c) Source-claim verifier** — 10/10 P0 source claims confirmed by pattern match against the
production files at `ENTRY_HEAD` (`createShellTool` array type; `Promise.all` over `commands`; the
per-command `catch` returning `success:false` **without** re-throw; `commandIndex` on the envelope;
the `RUNNING` handoff; `terminalPromise.then`; the manager's `terminalState`; `result = { output }`
with no `isError`; the `result.isError` boundary collapse; `createTool` as a pure passthrough).

**(d) Unaffected production gates re-executed** (this ACT changed **no** production file — the
working tree contained **no** `.ts`/`.tsx`/`.js`/`.json` change):

| Gate | Result | Class |
|---|---|---|
| Agent-trace contract + comparator (`agent-trace-contract-recon01` + `compare-model-behavior-traces`) | **45/45 PASS** | `EXECUTED_PASS` |
| `run_commands` foreground/background classification (`run-commands-nonterminal-classification01.rcnc01`) | **5/5 PASS** | `EXECUTED_PASS` |
| `run-commands-nonterminal-original-tool-result-discriminator01.rcnc02` | **collection failure** — `Cannot find package '@core/controller/file/openFocusChainFile'`; `apps/vscode/src/core/controller/file/openFocusChainFile.ts` does **not** exist and the generated `protobus-services.ts` references it | **`BASELINE_FAILURE` (stale generated protos; pre-existing, unrelated — this ACT changed no source file)** |

The `EPERM: operation not permitted, kill` messages emitted while vitest tears down its worker
forks are the **same** environmental sandbox limitation the recon already classified as
`BASELINE_FAILURE` (the sandbox denies `kill(-pgid, 0)`). They are **not** a regression of this ACT.

> **Scope discipline:** the `rcnc02` collection failure and the `owner-session-id` baseline failures
> are **recorded, not repaired**. Repairing unrelated infrastructure is out of scope for a
> documentation-only contract correction.

---

The recon's §11 already required a RED witness and conservation tests. The correction **adds** the
controls that the false cardinality and the temporal gap make necessary:

1. **Real-seam RED→GREEN.** The RED must be reproduced at the **actual production seam**, not at a
   mock. A test-runner failure is not a production RED.
2. **Mixed-command controls.** A single tool call with **at least two** commands whose outcomes
   **differ** (e.g. one exiting `0`, one exiting non-zero), proving the recorded evidence carries
   **both** outcomes distinctly and never a single collapsed scalar.
3. **Delayed-completion controls.** A background job that returns `RUNNING` and terminates **after**
   the tool call has returned, proving the eventual authoritative result is captured and that the
   interim record says *"running, not yet terminal"* — never *"success"*.
4. **Necessity ablation, executed.** The ablation must be run against **captured** evidence once
   process outcomes exist. Until then the ablation claim remains `HYPOTHESIS_ONLY` (§3).
5. **Conservation.** The recorded exit code **equals** the value the process actually produced
   (against `CommandExitError.exitCode` and `CommandJobSnapshot.exitCode`); `containment_failed` is
   preserved distinctly; `unknown` is preserved distinctly; the recorder's disabled path performs no
   extra work and no extra `await` (the existing `agent-runtime.ts:4515-4521` discipline).

---

## 6. What this ACT did and did not do

**Did:**

- Established the two P0 defects and the ablation mis-classification **against the production source
  at `ENTRY_HEAD`**, with file:line evidence for each claim.
- **Executed** the decisive proof at the real `createShellTool` seam (§5.0): one invocation, two
  commands, different outcomes, one collapsed `success` — a failing command (exit code 3) is
  **invisible** to the trace boundary.
- Repaired the recon report's §7.2 classification and §11 successor contract in place, so the
  committed document no longer asserts a false cardinality, a false observation time, or an executed
  ablation that was never executed.
- Narrowed the *"not looping"* causal claim to the evidence that supports it (§3.1).
- Preserved the recon's measured findings, its `PASS_RECON_WITH_GAPS` verdict, its `PARTIAL`
  completeness result, its conformance gates and its privacy assessment **unchanged**.

**Did not:**

- Modify any production file. **Production delta: ZERO.**
- Re-run the capture analysis, re-verify the capture bytes, or re-adjudicate the conformance gates.
- Repair the pre-existing `command-job-manager.owner-session-id.test.ts` baseline failures — they
  remain a **`BASELINE_FAILURE` (environmental)** classification and are out of scope.
- Launch a new broad reconnaissance.
- Preordain whether the existing `tool_finish` event can carry every required observation, or
  whether an additional internal event is needed.

---

## 7. Final disposition

```text
RECON_VERDICT                    = PASS_RECON_WITH_GAPS   (unchanged)
RECON_CAUSAL_CLAIMS               = NARROWED (§3.1)
ABLATION_CLASSIFICATION           = HYPOTHESIS_ONLY (§3, §7.2 of the recon report)
SUCCESSOR_CONTRACT               = CORRECTED (§4) — NOT YET IMPLEMENTABLE
DISPOSITION                      = HALT_SUCCESSOR_CONTRACT_FALSE_CARDINALITY
NEXT                             = one bounded correction to the bridge contract, then
                                    implementation once cardinality and temporal observation
                                    are resolved
REVIEW_ROUNDS                    = none further unless new P0 evidence appears
```

**Evidence**

- `docs/acts/ACT-CLINEMM-TRACE-DECISION-SUFFICIENCY-RECON01/REPORT.md` — §7.2 and §11 as corrected
  by this ACT.
- `docs/acts/ACT-CLINEMM-TRACE-DECISION-SUFFICIENCY-RECON01/CORRECTION01-SUCCESSOR-CONTRACT.md` —
  this document.
