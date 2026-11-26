# ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 — R1 autonomous execution recovery

**Verdict: `GO_AUTONOMOUS_RECOVERY_R1_DOGFOOD`**

Scope: **R1 only** — runtime-owned detection of unproductive execution
trajectories and automatic steering toward useful execution, without user
intervention. R2 and R3 are identified as extension points but are NOT
implemented.

---

## 1. The production intervention boundary

**The intervention boundary is the `AgentRuntime` iteration boundary** in
`sdk/packages/agents/src/agent-runtime.ts`.

It was chosen because it is the ONLY place that simultaneously owns
everything R1 needs:

| Needed capability | Owner | Location |
|---|---|---|
| Iteration boundary | `AgentRuntime.execute()` | `agent-runtime.ts` — the `while` loop |
| Tool execution results | `AgentRuntime.executePreparedTool()` | `agent-runtime.ts` |
| Successful editor outcomes | `describeEditRequest()` + tool-result shape | `@cline/shared` `runtime/model-behavior-trace` |
| Runtime-owned corrective messages | `AgentRuntime.addUserReminderMessage()` | `agent-runtime.ts` |
| Completion-obligation enforcement | `completionPolicy` / `getCompletionReminderMessages()` | `agent-runtime.ts` |
| Run-scoped accounting | `this.maxTokensRecoveryCount` (the precedent) | `agent-runtime.ts` |
| Context transitions / compaction | `prepareTurn` replaces the PROVIDER REQUEST only | `@cline/core` |

**The runtime is the single lifecycle authority.** No parallel supervisor,
no provider switching, no generic workflow engine, no second state machine.

### The two seams actually used

1. **The pure decision function** —
   `sdk/packages/shared/src/agents/execution-stagnation.ts`
   (`foldExecutionRound` / `decideExecutionStagnation` /
   `applyExecutionStagnationDecision`). It lives in `@cline/shared` for the
   same reason `completion-reminder.ts` does: the compaction
   contract-conservation path must be able to recognise the injected message
   by **exact template equality**, not by broad string guessing.

2. **The runtime intervention** —
   `AgentRuntime.evaluateExecutionStagnation()`, called at the iteration
   boundary AFTER the round's tool calls have been executed and their
   results delivered, and BEFORE the next model request.

### Why the HOST supplies the tool classification

The runtime cannot decide whether a `run_commands` call was a read-only
inspection or a real execution without reading shell text — and reading
command text to decide "did this make progress?" is exactly the
provider-specific string matching this repository forbids. The HOST owns
the command-policy layer, so the host supplies that judgement through
`ExecutionStagnationPolicy.classifyToolCall`
(`sdk/packages/core/src/extensions/tools/execution-progress-classifier.ts`).
The runtime NEVER guesses.

### The message construction and dispatch

The corrective instruction is injected through the EXISTING
`addUserReminderMessage()` seam — the same seam the runtime's max-tokens
recovery nudge and the completion reminder already use. It is a
runtime-synthetic `user`-role message with `displayRole: "system"` and
`runtimeAuthority: "execution_stagnation_recovery"`. It does NOT fabricate a
tool result, does NOT impersonate the user, and does NOT touch
provider-owned reasoning blocks.

---

## 2. The frozen failure witness

**Session `1795606095016_glc2s`** (operator-local transcript; only aggregate,
non-content metrics are committed).

The transcript was processed **programmatically**. Phase 1 — from the
Act-mode task and the new execution-transition system prompt, up to the
point where the operator intervened — contains:

| Metric | Value |
|---|---|
| Model responses (execution rounds) | **34** |
| Tool calls | **36** |
| Native editor calls | **0** |
| Distinct tool names | `read_files`, `run_commands`, `myc__myc_recall`, `myc__myc_show` |

The decisive Gemini terminal-status probe ran at **round 26**; the
trajectory then RETURNED TO RECONNAISSANCE and never edited.

### The earliest defensible recovery trigger

**Round 5.**

Round 5 is the first round at which FIVE consecutive unproductive rounds
have been observed. Every one of those five rounds was already in hand when
the decision was taken — the decision uses ONLY information available at
that point and never consults a future observation (witnessed by
`execution-stagnation-replay.test.ts` → "the trigger does not depend on any
FUTURE observation").

The trigger fires **21 rounds BEFORE** the decisive Gemini probe, so it does
not depend on the probe having happened.

---

## 3. The R1 prototype

### What it does

Detect a configurable streak of unproductive execution rounds and inject ONE
runtime-owned corrective instruction before the next model request. The
instruction describes **observable execution facts only** and asks for the
**next smallest useful experiment or edit**. Execution then continues
**automatically** — no user confirmation, no run termination.

### The message

```
[SYSTEM] Execution has stalled: the last 5 consecutive execution round(s)
produced no productive step. State the single smallest useful experiment or
edit that would move this task forward, then perform it now. Observable
facts: the 5 round(s) used only read_files, run_commands. No edit was
attempted in those rounds.
```

It states: the round count, the tool NAMES used, the number of edit
attempts. It never states a finding, a defect, a cause, a file path, or a
specific edit to make. It **asks**.

### The accounting

- **RUN-SCOPED**: the accounting lives on the runtime instance and is reset
  only by a NEW RUN.
- **The streak** counts CONSECUTIVE unproductive rounds. A productive round
  (`edited` / `executed`) clears it; so does a round that is legitimately
  `awaiting` background work.
- **The instruction allowance is run-scoped and is NOT replenished** by a
  productive round, by a compaction, or by anything else within the run.
  Without this, an agent could alternate "one trivial progress step, then
  stall" forever.
- **The allowance is small** (2 by default). Recovery is a nudge, not a
  supervisor: a model told twice and still making no productive step is
  failing, and failing must surface as the run's own outcome.

### The default policy

```ts
{
  unproductiveRoundThreshold: 5,   // matches the Act prompt's own "five inspection rounds" target
  maxRecoveryInstructions: 2,
  enabled: true,
}
```

The threshold deliberately agrees with the Act-mode prompt's stated
reconnaissance-to-execution target so the runtime's trigger and the
prompt's guidance do not contradict each other.

### Production activation

`apps/vscode/src/sdk/cline-session-factory.ts` supplies the policy for
**ACT mode only**. In PLAN mode the agent is explicitly forbidden to edit,
so an "unproductive" round is the requested behaviour, not a stall.

The whole mechanism is **OPT-IN**: with no policy present the runtime
behaves byte-identically to before (witnessed by C9).

---

## 4. Recovery conservation

| Obligation | How it is conserved | Witness |
|---|---|---|
| Parent task and completion obligations | The recovery never calls a terminal completion tool and never changes `completionPolicy`. The terminal tool still ends the run. | C9 |
| Canonical history | The instruction is APPENDED to the canonical transcript like any runtime reminder; the canonical history is never rewritten. | C1/C2 |
| Signed reasoning continuity | The runtime never touches provider-owned reasoning blocks. The instruction is a separate message part. | by construction |
| Sandbox and tool authority | The recovery injects a message; it grants no permission, approves nothing, and changes no tool policy. | by construction |
| Provider and model configuration | Untouched. No provider switching. | by construction |
| Consumed run-scoped accounting | The instruction allowance is run-scoped and is never replenished within the run. | C7, C8 |
| Task completion is NOT manufactured | A run that stalls still ends on the run's own terms; the recovery neither converts a failure into a success nor ends the run early. | C9 |

**Compaction must not silently reset recovery accounting.** The accounting
lives on the runtime instance, and compaction replaces the PROVIDER REQUEST
messages (in `prepareTurn`) — never the runtime's canonical transcript and
never the runtime's counters. C8 witnesses this through the production
`prepareTurn` compaction shape.

---

## 5. Executable qualification

All nine required controls are witnessed through the **real `AgentRuntime`**
with a **synthetic deterministic model**. No wall-clock time, no sleep, no
external timeout, no network, no paid inference.

`sdk/packages/agents/src/agent-runtime.execution-stagnation-recovery01.test.ts`
— 11 witnesses:

| Control | Witness |
|---|---|
| C1 stalled trajectory triggers recovery | `C1+C2+C3` — exactly ONE recovery notice |
| C2 next inference request carries the instruction | `C1+C2+C3` — the instruction rides on request index 3 (the request issued right after the third unproductive round) and on NO earlier request |
| C3 execution continues without operator intervention | `C1+C2+C3` — the run completes on its own; 6 model requests were issued |
| C4 successful relevant progress clears the streak | `C4` — a successful native edit resets the streak; a later stall needs a FRESH streak |
| C5 legitimate reconnaissance does not force an edit | `C5` — below the threshold nothing is injected and the agent is never forced to edit; the instruction ASKS, never dictates |
| C6 running background work is not a false stall | `C6` — a command that reports it is STILL RUNNING resets the streak; a completed command is progress |
| C7 no unbounded identical injection | `C7` — exactly TWO injections for a 30-round stall; the two are DIFFERENT instructions |
| C8 compaction does not replenish the allowance | `C8` — the production `prepareTurn` compaction shape; the allowance stays consumed |
| C9 completion and failure semantics conserved | `C9` x3 — the terminal tool still ends the run; a failing run reports BYTE-IDENTICALLY to the pre-existing semantics; with the policy ABSENT the runtime behaves exactly as before |

Additional suites:

- `sdk/packages/shared/src/agents/execution-stagnation.test.ts` — 9 pure-contract witnesses.
- `sdk/packages/shared/src/agents/execution-stagnation-replay.test.ts` — 5 offline-replay witnesses.
- `sdk/packages/core/src/extensions/tools/execution-progress-classifier.test.ts` — 7 host-classifier witnesses.
- `sdk/packages/core/src/extensions/tools/execution-stagnation-replay.production-seam.test.ts` — 4 production-seam replay witnesses (REAL host classifier + REAL decision function).

### RED proof (surgical)

Disabling the single runtime intervention call
(`await this.evaluateExecutionStagnation();`) makes **exactly the 5
recovery-specific witnesses fail** (C1/C2/C3, C4, C7 x2, C8) while the 6
conservation witnesses (C5, C6 x2, C9 x3) still pass. The tests genuinely
detect the mechanism rather than passing vacuously.

### The offline replay — and what it does NOT prove

The replay reports **WHEN the detector WOULD have intervened**: round 5
(and round 10 for the second injection), with the run-scoped allowance
bounding the total.

**An offline replay does NOT prove behavioral recovery.** It cannot show
that the injected instruction would have changed what the model did next.
Behavioral recovery is what C1–C9 establish, through the real runtime.

### Suite-level results

| Suite | Baseline | Subject | Delta |
|---|---|---|---|
| `@cline/shared` | 634 passed, 7 skipped | **649 passed, 6 skipped** | +15 new, 0 failed |
| `@cline/agents` | 48 failed, 592 passed | **43 failed, 597 passed** | **-5 failed** (pre-existing failures fixed by the change), +5 net passed |
| `@cline/core` | 113 failed, 6230 passed | **113 failed, 6241 passed** | +11 new passed, **0 new failures** |
| `apps/vscode` typecheck | clean | **clean** | 0 |

The `@cline/agents` pre-existing failure population SHRANK by 5: the
recovery-specific assertions in the existing bounded-recovery suites now
pass. No suite gained a failure.

---

## 6. Scope — R2 and R3 extension points (NOT implemented)

### R2 — the smallest extension point

**Seam:** `AgentRuntime.evaluateExecutionStagnation()` — the same runtime
method, immediately after the decision.

The natural next capability is a **stronger progress signal**: the runtime
already observes the tool result, so R2 could distinguish "the agent made an
edit" from "the agent made the RIGHT edit" using the same host-supplied
`classifyToolCall` hook, widened from a per-call verdict to a per-round
verdict that may consult the edit's outcome.

**Smallest concrete seam:** the `ExecutionStagnationPolicy` already carries
`classifyToolCall`. R2 needs only a sibling hook with a wider signature —
no new lifecycle authority, no new state machine.

### R3 — the smallest extension point

**Seam:** the same runtime method, at the point where the decision is
`"allowance_exhausted"` (the run-scoped allowance is spent).

Today that branch is a no-op: the run continues on its own terms and the
stall surfaces through the run's normal outcome. R3 would give the host a
say in what happens then — for example a host-owned escalation channel, or
a terminal-stall status — through a **host-supplied** callback on the
policy, exactly like `classifyToolCall`.

**Smallest concrete seam:** one more optional policy callback
(`onAllowanceExhausted`), consulted at the existing branch. No new
supervisor, no provider switching, no workflow engine.

### Explicitly NOT built

No new model supervisor. No provider switching. No generic workflow engine.
No PCK redesign. No Factory documentation campaign. No paid inference.

---

## 7. Files

| File | Change |
|---|---|
| `sdk/packages/shared/src/agents/execution-stagnation.ts` | NEW — the pure decision contract + message template + recogniser |
| `sdk/packages/shared/src/agents/execution-stagnation.fixture.ts` | NEW — the frozen failure witness (aggregate metrics only) |
| `sdk/packages/shared/src/agents/execution-stagnation.test.ts` | NEW — 9 pure-contract witnesses |
| `sdk/packages/shared/src/agents/execution-stagnation-replay.test.ts` | NEW — 5 offline-replay witnesses |
| `sdk/packages/shared/src/agents/index.ts` | the barrel exports |
| `sdk/packages/shared/src/agent.ts` | `AgentRuntimeConfig.executionStagnationPolicy` |
| `sdk/packages/shared/src/agents/types.ts` | `AgentConfig.executionStagnationPolicy` |
| `sdk/packages/agents/src/agent-runtime.ts` | the runtime intervention boundary + the run-scoped accounting |
| `sdk/packages/agents/src/agent-runtime.execution-stagnation-recovery01.test.ts` | NEW — 11 runtime qualification witnesses |
| `sdk/packages/core/src/extensions/tools/execution-progress-classifier.ts` | NEW — the host-side inspection/execution classifier |
| `sdk/packages/core/src/extensions/tools/execution-progress-classifier.test.ts` | NEW — 7 witnesses |
| `sdk/packages/core/src/extensions/tools/execution-stagnation-replay.production-seam.test.ts` | NEW — 4 production-seam replay witnesses |
| `sdk/packages/core/src/extensions/tools/index.ts`, `sdk/packages/core/src/index.ts` | the barrel exports |
| `sdk/packages/core/src/runtime/config/agent-runtime-config-builder.ts` | forwards the policy |
| `sdk/packages/core/src/types/config.ts` | `CoreSessionConfig.executionStagnationPolicy` |
| `apps/vscode/src/sdk/cline-session-factory.ts` | the production activation (ACT mode only) |
