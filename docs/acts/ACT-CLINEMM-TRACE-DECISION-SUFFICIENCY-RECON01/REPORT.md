# ACT-CLINEMM-TRACE-DECISION-SUFFICIENCY-RECON01 — Recon Report

**Type:** Production-seam reconnaissance / evidence qualification
**Status:** COMPLETE — terminal verdict below
**Branch:** existing `main` (no ACT branch created)
**Production delta:** ZERO. No runtime, React, Elm, protobuf, public wire contract, tracing recorder or test implementation was modified.

> **CORRECTION01 — `ACT-CLINEMM-TRACE-DECISION-SUFFICIENCY-RECON01-CORRECTION01-SUCCESSOR-CONTRACT.md`**
> (documentation-only; zero production delta; this recon's measured findings, conformance gates,
> privacy assessment and `PASS_RECON_WITH_GAPS` verdict are **unchanged**).
>
> CORRECTION01 repairs **two** things in this report:
>
> 1. **§7.2** — the necessity table is a **`HYPOTHESIS_ONLY`** necessity argument, **not** an executed
>    ablation of this specimen (its "Full" row is a hypothetical configuration this capture was never
>    in).
> 2. **§11** — the proposed successor contract asserted a **false cardinality** (one exit-status
>    scalar per *invocation*, when one invocation executes **N commands**) and a **false observation
>    time** (a background job's terminal status is observed **after** `tool_finish`). The corrected
>    contract is in **CORRECTION01 §4**; disposition **`HALT_SUCCESSOR_CONTRACT_FALSE_CARDINALITY`**.
>
> A related causal claim is **narrowed** (§4 D1): the trace rules out substantial *identical-call
> repetition*, not *semantic cycling through different commands*.
>
> **§0's central finding — that the exit status is observed by the production seam and then
> discarded at the trace boundary — is CONFIRMED and unchanged.**

---

## 0. Terminal verdict

**`PASS_RECON_WITH_GAPS`** — one bounded successor is justified: a **command-process outcome trace bridge**.

**The terminal question, answered:**

> *What is the smallest additional observation, if any, that would change our ability to decide whether a long-running ClineMM agent is productively solving its task?*

**One scalar per `run_commands` invocation: the process exit status** (`exitCode`, plus `state` for the background class) — carried on the **existing** `tool_finish` event, correlated by the **already-existing** `toolCallId`.

> **CORRECTION01 (`ACT-CLINEMM-TRACE-DECISION-SUFFICIENCY-RECON01-CORRECTION01-SUCCESSOR-CONTRACT.md`):
> the sentence above is superseded. The correct unit is **per command**, not per invocation, and the
> background terminal result arrives **after** `tool_finish`. The corrected contract is in
> **CORRECTION01 §4**; the disposition is **`HALT_SUCCESSOR_CONTRACT_FALSE_CARDINALITY`**. The
> paragraph below — the *finding* that the exit status is observed and then discarded at the trace
> boundary — is **unchanged and confirmed**.

That is the whole answer. The production authority that already observes it exists and is already correlated; the fact is simply **dropped at the trace boundary**. No new process monitor, no new identity namespace, no new event kind, and no new runtime observation boundary is required.

---

## 1. Entry HEAD, tree and repository hygiene

| Property | Value |
|---|---|
| `ENTRY_HEAD` | `14aaa2af1e7f38e9e37eab304763577be492b84c` |
| `ENTRY_TREE` | `aa889b64b9f5458aed9f7459ed9952ddd4c052dd` |
| Branch | `main` |
| `git status --porcelain=v1 -uall` | **0 entries** (clean) |
| Protected stash | `stash@{0}: WIP on main: d46223b51 …` — **INTACT, untouched** |
| Worktrees | 4, all untouched (`/private/tmp/cline-fork-baseline`, `…-m31-action-first`, `…-m31-bounded`) |
| Push / branch / install | NONE / NONE / NONE |

The previously established closure HEAD `6bdc07c8d2651bfb93331552342f2912697dc406` was treated as a **historical anchor only**. The actual HEAD was discovered with `git rev-parse HEAD` and differs.

**Hygiene verdict: clean. `HALT_UNEXPECTED_DIRT` not triggered.**

### 1.1 Implementation identities inspected at this HEAD

| Authority | Path | Status at HEAD |
|---|---|---|
| Native recorder / schema | `sdk/packages/shared/src/runtime/model-behavior-trace.ts` | present (74 382 B) |
| Flight-recorder bridge | `apps/vscode/src/sdk/model-behavior-trace-runtime.ts` | present (846 lines) |
| Normalizer | `apps/vscode/src/sdk/normalize-agent-trace.ts` | present (1 420 lines) |
| Command tool | `apps/vscode/src/sdk/vscode-run-commands-tool.ts` | present (1 972 lines) |
| Background process owner | `apps/vscode/src/sdk/command-job-manager.ts` | present (3 579 lines) |
| Background status consumer | `apps/vscode/src/sdk/command-status-tool.ts` | present (652 lines) |
| Independent evaluator | `scripts/evaluate-agent-fixture.ts` | present (62 858 B) |
| Portable specification | `docs/acts/ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01/agent-trace-v0.1.md` | present |
| Native-to-portable mapping | `docs/acts/ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01/cline-native-to-portable.md` | present |

---

## 2. Capture identity and native event census (C0)

The operator-provided capture was located at `/Volumes/UserData/Users/chistyakov/Downloads/model-behavior-trace.jsonl` and **re-verified against the actual bytes** — the frozen identity table was treated as a claim to check, not a fact to copy.

### 2.1 Identity — **VERIFIED**

| Property | Frozen expectation | Recomputed from bytes | Match |
|---|---|---|---|
| SHA-256 | `e2f2fa3bf35d2205504890468af6ce96727366ba63c08b231c89b3284717f49b` | `e2f2fa3bf35d2205504890468af6ce96727366ba63c08b231c89b3284717f49b` | ✅ |
| File size | 4 202 370 bytes | 4 202 370 | ✅ |
| Total recorder events | 7 941 | 7 941 (`summary.truncation.totalRecorded`) | ✅ |
| Retained events | 7 902 | 7 902 | ✅ |
| Dropped events | 39 | 39 | ✅ |
| Dropped sequence range | 1–39 | `droppedFromSeq=1`, `droppedToSeq=39` | ✅ |
| Last retained sequence | 7 941 | 7 941 | ✅ |
| Terminal summary | Present | Present (line 7 903, `kind:"summary"`) | ✅ |
| Active session at dump | Yes | Yes (§4.3) | ✅ |

**Gate C0: PASS — capture identity verified.**

### 2.2 Structural integrity (recomputed)

| Property | Value |
|---|---|
| Parse errors | **0** |
| Unrecognized lines | **0** |
| Duplicate sequences | **0** |
| Sequence ordering | **strictly increasing** over retained range |
| Retained seq range | `40 … 7941` |
| Gaps within retained range | **0** (contiguous) |
| Distinct trace ids | 1 (`mbt_c7b5bf162337fcd0c68aa09b`) — agrees with the summary |
| Capture window | `2026-11-02T10:53:41.349Z` → `2026-11-02T12:25:30.109Z` (≈ 91 min) |

### 2.3 Native event census (recomputed from the file)

| Count | Event | Portable family |
|---:|---|---|
| 1 022 | `tool_finish` | tool |
| 1 022 | `tool_start` | tool |
| 1 022 | `loop_verdict` | run |
| 947 | `model_wire_reasoning` | model |
| 946 | `effective_model_config` | model |
| 946 | `model_request_start` | model |
| 946 | `model_request_finish` | model |
| 946 | `compaction_diagnostics` | context |
| 26 | `edit_attempt` | workspace |
| 24 | `edit_target_resolved` | workspace |
| 24 | `edit_application` | workspace |
| 20 | `edit_write_verification` | workspace |
| 4 | `edit_failure` | workspace |
| 2 | `edit_checkpoint_observation` | workspace |
| 2 | `model_config` | model |
| 2 | `run_terminated` | run |
| 1 | `compaction_completed` | context |
| **0** | **`model_request_error`** | — |
| **0** | **`model_request_abort`** | — |
| **7 902** | **total retained** | |

**Two absences are load-bearing and are carried forward as findings, not as defects of the capture:**
`model_request_error` = 0 and `model_request_abort` = 0 across 946 requests. The recorder *can* emit both (`model-behavior-trace-runtime.ts:318-323`); the specimen simply contains none.

### 2.4 Reconciliation with the previous audit's numbers

The previous audit's "≈857 model iterations, 805 `run_commands` invocations, 21 editor attempts" is **partially reproduced and partially corrected**:

| Previous audit observation | Recomputed | Note |
|---|---|---|
| ≈857 model iterations | **857** `model_request_start` in `run_2FlP7a2y` | ✅ reproduced |
| 805 `run_commands` invocations | **949** `run_commands` tool finishes | ❌ **corrected upward** |
| 21 editor attempts | **26** `edit_attempt` | ❌ corrected (+5) |

The `805` figure appears to have counted only one of the two sessions. Total `tool_start`/`tool_finish` is **1 022**, of which **949** are `run_commands` — the dominant tool. This correction matters: the previous audit understated command volume by ~18%.

---

## 3. Portable coverage and completeness (C1)

The production normalizer was executed **unmodified**:

```bash
bun apps/vscode/src/sdk/normalize-agent-trace.ts \
  --in <verified capture> --out <tmp>/model --harness cline
# normalized 7902/7902 native records; truncated=true;
# families={"model":3787,"run":1024,"tool":2044,"context":947,"workspace":100}
```

Outputs were written to a **temporary directory** and are **not committed**.

### 3.1 Verification of the ten required properties

| # | Requirement | Result | Evidence |
|---|---|---|---|
| 1 | Every recognized native event maps to a portable family | **PASS** | 16 native types → 5 families; `byNativeEventType` counts equal the native census exactly |
| 2 | No silently unnormalized records | **PASS** | `unnormalizedRecords: 0` |
| 3 | Summary consumed separately, not emitted as an agent event | **PASS** | 0 portable records carry `kind:"summary"`; `sourceTraceId`/`sourceDumpedAt` appear only in the coverage report |
| 4 | Truncation propagated to every portable record | **PASS** | `traceTruncated !== true` on **0** of 7 902 records |
| 5 | `COMPLETE` not asserted for the truncated specimen | **PASS** | `completeness: "PARTIAL"`, `traceComplete: false`; sole reason: *"the recorder declares the capture truncated (droppedCount=39); the retained records are a LOWER BOUND, not a total"* |
| 6 | Unknown identities remain unknown | **PASS** | `run_iyRB-chY` classified `unknown` (22 records); `providerConfirmedModelId`, `reasoningEffort`, `temperature`, `topP`, `maxOutputTokens`, `toolCount`, `sourceHead` all carry `UNAVAILABLE_FROM_TRACE` verbatim |
| 7 | No joins by timestamp proximity | **PASS** | Coverage names 1 refused `wire_request_without_request_id` and 1 refused `wire_request_without_run_id` — the 947 wire records are **not** joined to the neighbouring request |
| 8 | Tool-call identities retain owner scope | **PASS** | `runIdNamespace` carried on every record: `agent_runtime` 5 928, `session_orchestrator` 1 024, none 950; `dual_run_id_namespace` refusal count 1 970 |
| 9 | Requested / wire / provider-reported reasoning stay separate | **PASS** | `requestedThinking` + `reasoningEffortAdvertised` (agent) vs `wireThinkingMode` + `wireOutputTokenLimit` (transport) vs `reasoningContentBytes` (provider); `requestedReasoningEffort`, `wireOutputConfigEffort`, `providerReportedReasoningTokens` correctly `unavailable` |
| 10 | Privacy filtering removes forbidden keys at every depth | **PASS** | `privacyFilteredFields: {"toolNames": 948}` — catalog names replaced by a count; depth cap 4 reached, nothing deeper emitted |

**Gate C1: `PASS_PORTABLE_PARTIAL`.**

### 3.2 Coverage matrix (from `model.coverage.json`)

| Family | Observed | Unavailable |
|---|---|---|
| `model` | requestedThinking, reasoningEffortAdvertised, wireThinkingMode, wireOutputTokenLimit, reasoningContentBytes, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, requestDurationMs, finishReason, toolCallCount, toolSchemaCount, messageCount, thinkingEnabled, reasoningEffort, selectedModelId, runtimeModelId, providerConfirmedModelId | requestedReasoningEffort, wireOutputConfigEffort, providerReportedReasoningTokens |
| `tool` | toolName, toolCallId, origin, outcome, executionInvoked, durationMs, outputSizeChars, argumentFingerprint | — |
| `workspace` | operation, outcome, failureCategory, approvalOutcome, executionInvoked, noOp, requestedFileCount, mutatedFileCount, unmutatedFileCount, writeReturned, readbackAttempted, readbackMatched, fileExistsAfterWrite, observedTargetCount, targetCount, durationMs, provenance | — |
| `context` | mode, strategy, requestInputTokens, maxInputTokens, effectiveMaxInputTokens, requestTriggerTokens, userContextCeiling, inputBudgetSource, shouldCompact, usedFallbackBudget, tokensBefore, tokensAfter, tokensSaved, messagesBefore, messagesAfter | — |
| `run` | finishReason, durationMs, iterations, verdict, hasMessage | — |
| **`process`** | — | *(family has NO native producer — `normalize-agent-trace.ts:1063-1066`)* |
| **`acceptance`** | — | *(family has NO native producer — `normalize-agent-trace.ts:1103-1106`)* |

> The `process` and `acceptance` families are **intentionally empty by design**, and this is the formal statement of the two evidence gaps this ACT quantifies.

---

## 4. Model / tool execution reconstruction (C2)

### 4.1 Sessions, runs and namespaces

| Session | Task | Records | Runs | Iterations |
|---|---|---:|---|---|
| `1793616786525_0qnaz` | `conv_1793616787362_igtyymb` | 934 | `run_jXb8sj89` (agent), `run_1793616787362_xd1n0d` + `run_1793617658297_xtrnh2` (orchestrator), `run_iyRB-chY` (unknown) | ≤ 90 |
| `1793618126076_fp4aa` | `conv_1793618126649_etlm91s` | 6 966 | `run_2FlP7a2y` (agent), `run_1793618126649_beozgl` (orchestrator) | ≤ 857 |
| *(none)* | — | 2 | — | — |

Two disjoint run-id namespaces coexist, exactly as the mapping document records. **`run_iyRB-chY` matches neither shape and is reported `unknown`, never guessed.**

### 4.2 Model requests

| Quantity | Value |
|---|---|
| `model_request_start` | 946 |
| `model_request_finish` | 946 |
| **Requests without an exact terminal pair** | **1** (seq 7 938, iteration 857 — the *last* request; see §4.3) |
| `model_request_error` | 0 |
| `model_request_abort` | 0 |
| `finishReason` | `tool-calls` × 946 (**100 %**) |

Tokens, summed over the 946 **finished** requests only:

| Token class | Total |
|---|---:|
| input | 177 134 388 |
| output | 261 241 |
| cache read | 176 337 586 |
| cache write | 0 |

Cache read is **99.6 %** of input — the session reused context heavily.

### 4.3 Provider / model configuration

| Field | Value |
|---|---|
| selected / runtime provider | `minimax` |
| selected / runtime model | `MiniMax-M3` |
| provider-confirmed model | `UNAVAILABLE_FROM_TRACE` |
| thinkingEnabled | `false` |
| contextWindow / maxInputTokens | 1 048 576 |
| userContextCeiling | 512 000 (`userCeiling`, `explicit`) |
| effectiveMaxInputTokens | 512 000 |
| extensionVersion | `4.1.16-5a1c485cb` |
| extensionBundleSha256 | `40d305b29e2dcd6f040a7b18a3609b75dd8d803337a2d0a1d9f8bbb9c8990cad` |
| `sourceHead` | `UNAVAILABLE_FROM_TRACE` |

> **Note for the manifest (C6):** the capture carries an `extensionBundleSha256` and `extensionVersion`, but **`sourceHead` is `UNAVAILABLE_FROM_TRACE`**. A past `sourceHead` must **not** be backfilled from today's checkout.

### 4.4 Tool invocations — outcome and duration

| Tool | Invocations | `outcome=success` | `outcome=error` | Distinct arg fingerprints | Max repeat | Duration p50 / p95 / max (ms) |
|---|---:|---:|---:|---:|---:|---|
| `run_commands` | **949** | **949** | **0** | **948** | **2** | 50 / 12 879 / 15 055 |
| `command_status` | 32 | 32 | 0 | 25 | — | 8 030 / 30 011 / 30 032 |
| `editor` | 26 | 26 | 0 | 26 | 1 | 5 / 112 / 121 |
| `cancel_command` | 4 | 4 | 0 | 4 | 1 | 162 / 614 / 614 |
| `read_files` | 7 | 7 | 0 | 7 | 1 | 4 / 5 / 5 |
| `submit_and_exit` | 2 | 2 | 0 | 2 | 1 | 1 / 1 / 1 |
| `myc__myc_recall` | 1 | 1 | 0 | 1 | 1 | 43 |
| `myc__myc_prime` | 1 | 1 | 0 | 1 | 1 | 14 |

**Every `tool_start` has exactly one `tool_finish` and vice versa** — 1 022/1 022, zero unpaired on either side.

**The 949/949 all-success `run_commands` result is the pivotal observation of this ACT** — and it is *not* evidence of 949 successful commands. See §4.6 and §5.

### 4.5 Loop-verdict distribution

| Verdict | Count | Meaning (production `LoopDetectionTracker`, `loop-detection.ts:136-157`) |
|---|---:|---|
| `ok` | **1 021** | no *consecutive identical* call detected |
| `soft` | **1** | soft threshold (3 consecutive identical) reached → recovery notice appended |
| `hard` | **0** | hard threshold (5 consecutive identical) → run aborted |

By tool: `ok|run_commands` 949, `ok|command_status` 31, `ok|editor` 26, `ok|read_files` 7, `ok|submit_and_exit` 2, `ok|cancel_command` 4, `ok|myc__myc_recall` 1, `ok|myc__myc_prime` 1, `soft|command_status` 1.

**The production loop detector — the real, unchanged one — reached `soft` exactly once in 1 022 tool calls and `hard` never.** This independently corroborates the fingerprint evidence: the agent was **not** making consecutive identical calls.

### 4.6 The discriminators, applied

**D1 — Repetition is not necessarily looping.** 949 `run_commands` calls produced **948 distinct argument fingerprints**; exactly one fingerprint recurred (twice). The production detector agreed (`soft` ×1, `hard` ×0, both on `command_status`, not `run_commands`). **This is activity, not repetition.** High iteration count alone proves nothing here. **CORRECTION01 (narrowing): this rules out substantial *identical-call repetition* only. It does NOT rule out *semantic cycling through different commands*, and no claim is made about the agent's strategy quality.**

**D2 — Tool success is not command success.** **Confirmed and decisive.** `tool_finish.outcome` is computed at `agent-runtime.ts:4857` as `result.isError ? "error" : "success"`. `result.isError` is set by the SDK shell wrapper at `definitions.ts:366-372` when a `CommandExitError` is caught. A `CommandExitError` carries `exitCode` (`bash.ts:444-452`), **but only the boolean `isError` crosses the boundary — the exit-code value never does.** Consequently `outcome: "success"` proves *"the executor returned without throwing"* and **does not prove `exitCode == 0`**. Empirically: **949/949 `run_commands` succeeded**, yet **the trace contains no exit-code-like key at all** (a scan of every payload key in all 7 902 records for `/exit|code|signal|job|process|status|state/i` returned the **empty set**), and **0 records carry a `jobId`**.

**D3 — Edit application is not retained progress.** Four distinct stages are kept separate and observed:
`edit_attempt` (26) → `edit_target_resolved` (24) → `edit_application` (24; outcomes `applied`/`rejected`) → `edit_write_verification` (20; `readbackMatched`) → `edit_checkpoint_observation` (2, at dump time). The retained-state claim lives **only** on the checkpoint record. Observed: 4 `edit_failure` events (`text_not_found`, `mutatedFileCount: 0`) — real, distinguished failures. At dump time, **9 targets `present`** in the long session and **1** in the short one. No shell-side mutation is visible to this family.

**D4 — Compaction does not prove recovery.** Exactly **1** compaction completed: `tokensBefore 461 752 → tokensAfter 59 222`, `tokensSaved 402 530`, `messagesBefore 940 → messagesAfter 39`, strategy `agentic`, trigger 460 800, ceiling 512 000. The **budget transition is established**; whether the model retained relevant information is **not** observable from this fact. After compaction, `requestInputTokens` continued to climb (last five: 445 999 → 449 544, still below the 460 800 trigger). Only `shouldCompact=true` occurred once, consistent with a single compaction event.

**D5 — Open runs are not failed runs.** The capture's last three records are `model_request_start` (seq 7 938), `model_wire_reasoning` (seq 7 939), then the two dump-time checkpoint observations (7 940, 7 941). The single unpaired request is the **final in-flight request** of session `1793618126076_fp4aa`, which has **no `run_terminated` record**. That session is **active at dump time** — an **open run**, explicitly **not** a failure and **not** an abandonment. The other session terminated cleanly twice (`finishReason: "completed"`, 90 iterations / 870 858 ms; then 3 iterations / 17 014 ms).

### 4.7 Execution timeline (compact)

| Phase | Window | Facts |
|---|---|---|
| Session A start | 10:53:41 | `run_jXb8sj89` begins at iteration 4; session A carries 156 tool calls over 90 iterations |
| Session A compaction | — | 89 `compaction_diagnostics` in session A |
| Session A terminal | — | `run_1793616787362_xd1n0d` `completed`, 90 iter, 870.9 s; then `run_1793617658297_xtrnh2` `completed`, 3 iter, 17.0 s |
| Session B start | — | `run_2FlP7a2y`, iterations 1…857, **no gaps** |
| Session B body | — | 857 model requests; 866 tool calls; **846 iterations with exactly 1 tool call, 10 with 2, 1 with none**; input tokens grew 53 368 → 461 752 |
| Session B compaction | — | single `agentic` compaction: 461 752 → 59 222 tokens, 940 → 39 messages |
| Session B tail | 12:25:27.979 | request 857 **in flight** (no terminal pair) |
| Dump | 12:25:30.109 | 2 × `edit_checkpoint_observation`; summary written; **session B still active** |

### 4.8 Factual anomaly table

| # | Observation | Discriminator | Interpretation |
|---|---|---|---|
| A1 | 949/949 `run_commands` `outcome=success`, 0 errors | **D2** | The trace **cannot** distinguish a shell that exited 0 from one that exited non-zero. |
| A2 | No exit-code / signal / jobId key exists in **any** of 7 902 payloads | **D2** | The fact is not merely unjoined — it is **never recorded**. |
| A3 | 948/949 distinct argument fingerprints; max repeat 2 | **D1** | Not consecutive-identical repetition. Production detector agrees (`soft`×1, `hard`×0). |
| A4 | 0 `model_request_error`, 0 `model_request_abort` across 946 requests | — | No runtime/provider failure is observable. Consistent with "the recorder can emit them; this run had none". |
| A5 | 1 model request with no terminal pair — the **last** one | **D5** | Open run, not failure. |
| A6 | Session B has **no** `run_terminated` | **D5** | Session active at dump. |
| A7 | 4 `edit_failure` with `text_not_found`, `mutatedFileCount: 0` | **D3** | Real edit failures are observable and distinguished. |
| A8 | 6 `edit_attempt` without a matching `edit_application` | **D3** | Attempts that did not reach application (approval/target resolution). |
| A9 | `command_status` durations cluster at ~30 000 ms (MAX_STATUS_WAIT_MS) | **C** | Delayed completion, **not** failure. 1 `soft` loop verdict arose here. |
| A10 | `run_1793616787362_xd1n0d` (`completed`, 90 iter) vs `run_jXb8sj89` (agent-runtime, 87 distinct iterations) | **C** | Two namespaces: the same logical run's records do **not** share a run id. |
| A11 | `run_iyRB-chY` — 22 records, iterations 1–3 | — | Identity matches **neither** known shape; correctly left `unknown`. |
| A12 | `model_config.toolNames` = 0 names / `toolCount` = `UNAVAILABLE_FROM_TRACE`, while `effective_model_config.toolCount` = 22 | — | The build-time snapshot precedes catalog resolution; the effective snapshot carries the count. Catalog **identity** remains unavailable. |
| A13 | 39 dropped events (seq 1–39) | — | The capture is a **lower bound**; the first 39 events are permanently lost. |

---

## 5. Background and foreground process authority map (C3)

### 5.1 The production path

```
run_commands (apps/vscode/src/sdk/vscode-run-commands-tool.ts)
  ├─ FOREGROUND (vscodeTerminal)
  │    executeForeground() ─▶ terminalManager ─▶ VscodeTerminalProcess
  │        └─ OSC 633 "D" marker ─▶ osc633Parser.ts:136 ─▶ this.exitCode
  │        └─ onDidEndTerminalShellExecution ─▶ completionDetails.exitCode
  │    ─▶ getCompletionDetails()  { exitCode, signal, terminalClosed, unobservedCommand }
  │    ─▶ exitCode ≠ 0  ⇒  throw CommandExitError(exitCode, result)   [line 716]
  │
  └─ BACKGROUND (backgroundExec)
       CommandJobManager.start()  → CommandJobSnapshot { state, exitCode?, signal?, elapsedMs }
       finalize(job, state, { exitCode, signal })                        [line 2450]
       start.exitCode === 0 && state === "exited" ⇒ return stdout        [line 1859]
       start.exitCode !== 0                    ⇒ throw CommandExitError   [line 1878]
       terminalPromise → TerminalTransition { jobId, terminalState, becameIdle }

CommandExitError ─▶ definitions.ts:366-372 ─▶ { success: false } ─▶ result.isError
                                                          │
agent-runtime.ts:4849  observeToolBoundary("finish", { outcome: result.isError ? "error":"success", ... })
                                                          │
model-behavior-trace-runtime.ts:327 ─▶ recorder.record("tool_finish", …)
```

**The last three arrows are where the fact is lost.** The exit code is known at `vscode-run-commands-tool.ts:1859` / `:716` and is collapsed into a boolean at `definitions.ts:366`, from which only `outcome` survives into the trace.

### 5.2 Required authority table

| Dimension | Background | Foreground | Evidence class |
|---|---|---|---|
| **Process started** | `CommandJobManager.start` → `state:"running"`, `process` handle | `executeForeground` → terminal send | `REAL` — both |
| **Exact execution identity** | `jobId` (`command-job-manager.ts:2117` `makeStartResult`) | VS Code terminal instance + OSC 633 sequence | `REAL` — background; **weak** — foreground |
| **Owner session/task** | `ownerSessionId` (latched at launch); `hasRunningBackgroundJobForOwner` | terminal-manager session binding | `REAL` — background; **partial** — foreground |
| **Tool-call correlation** | **NO.** `toolCallId` ↔ `jobId` join **does not exist** in the trace. The `jobId` **is** model-visible (`vscode-run-commands-tool.ts:1808-1816` returns `{status:"running", jobId, …}`) and `command_status` takes it as input (`command-status-tool.ts:227`) — but the link is **model-mediated**, never recorded. | **NO.** No `jobId` concept. | **GAP** |
| **Terminal status** | `state` ∈ `running` \| `exited` \| `deadline_exceeded` \| `cancelled` \| `spawn_failed` \| `containment_failed` | inferred from exit code / `terminalClosed` / `unobservedCommand` | `REAL` — background; **derived** — foreground |
| **Exit code** | `snapshot.exitCode` (`command-job-manager.ts:2478-2480`) | `completionDetails.exitCode` (`VscodeTerminalProcess.ts:611`) | `REAL` — **both**, but **absent from the trace** |
| **Signal / termination reason** | `snapshot.signal`; `containmentFailed` ∈ `pgid_unset` \| `substrate_alive` \| `substrate_eperm` \| `substrate_unknown`; `TerminationReason` ∈ `natural` \| `deadline` \| `cancel` | signal ⇒ `CommandTerminationError` ⇒ `success:false` | `REAL` — background; **class-only** — foreground |
| **Duration** | `snapshot.elapsedMs` | wall-clock at the tool boundary | `REAL` — both |
| **Delayed status availability** | `terminalPromise` + `status({jobId, waitMs})`; later fact observable via `command_status` | n/a (foreground blocks) | `REAL` — background |
| **Native trace currently records it** | **NO** — `UNAVAILABLE_FROM_TRACE` | **NO** — `UNAVAILABLE_FROM_TRACE` | **GAP (both)** |

### 5.3 Sub-question findings

**A. Background mode.** `CommandJobManager.start` → `finalize(job, state, {exitCode, signal})` (`:2450`) latches the real process exit status onto the job (`:2478-2483`); `makeStartResult` (`:2117`) projects it into `StartCommandJobResult`; `status()` (`:2844`) returns it to `command_status`, which forwards `state` / `exitCode` / `signal` to the model (`command-status-tool.ts:339-350, 376-383`). **The real process exit status is observed at a real production seam. It is not recorded in the trace.**

> `finalize` is also where the PGID-conservation invariant is proven (`postcondition === "gone"` ⇒ clean terminal; otherwise the state is **overwritten** with `containment_failed`). This is a strictly richer terminal taxonomy than `outcome:"success"|"error"` can express.

**B. Foreground mode.** `VscodeTerminalProcess` captures the exit code from the OSC 633 `D` marker (`osc633Parser.ts:136`) and from `onDidEndTerminalShellExecution` (`:78, :133, :388`), preferring the event source, and exposes it via `getCompletionDetails()` (`:611-613`). **A caveat that must be preserved:** the exit code is available **only when shell integration reports it**. The code explicitly documents the gap at `VscodeTerminalProcess.ts:374-381`: *"A lost exit code silently reports the command as successful to the agent (no exitCode means no CommandExitError below) — worth a log since it's otherwise invisible."* The tool layer also models `terminalClosed` and `unobservedCommand` as distinct, non-success dispositions (`:682-701`). **So foreground has an authoritative exit code *when available*, and an explicit "unknown" path when not.**

**C. Delayed completion.** A job returning `RUNNING` is **not** treated as success: the tool returns the `runningPayload` JSON (`:1816`) with `status:"running"` and no exit code; the terminal fact arrives later via `terminalPromise` (`:1783, :1852`) and via a subsequent `command_status` call. `MAX_STATUS_WAIT_MS` is the observed `command_status` ceiling — the ~30 000 ms durations in the specimen are **waiting for a delayed terminal fact, not failures**.

**D. Multiple jobs.** The manager keeps a per-job `active` Map; `getActiveJobIds()`, `getActiveCommandJobs()` and `getActiveJobOwnershipSnapshot()` (`:3094, :3196, :3259`) expose **per-job** id/state/owner. The runner's projection is explicitly **per-job**, not aggregate (`:1743-1784`: *"every job for which run_commands returns status:'running' emits exactly one (true, thatJobId) BEFORE any terminal tuple for that job"*). **Separate identity and separate terminal state per job are preserved by the production authority** — the specimen shows **32 `command_status` calls** with **25 distinct argument fingerprints**, consistent with several distinct jobs being polled.

### 5.4 Gate C3

**Exact existing authority map delivered.** The process outcome authority **already exists on both paths** and is **already identity-bound** on the background path (`jobId`, owner, per-job terminal state). The sole missing element is the **recording of that fact into the native trace**, and — on the background path — the **`toolCallId ↔ jobId` join**.

---

## 6. Existing workspace, lifecycle and acceptance authorities (C4)

### 6.1 Workspace

| Observable | Available? | Source |
|---|---|---|
| Editor requested | **YES** | `edit_attempt` (26) — `operation`, `targetCount`, `requestedChars`, `approvalOutcome` |
| Write applied | **YES** | `edit_application` (24) — `outcome` ∈ applied/rejected, `mutatedFileCount`, `unmutatedFileCount`, `noOp`, `fileMutations` |
| Independent read-back matched | **YES** | `edit_write_verification` (20) — `writeReturned`, `readbackAttempted`, `readbackMatched`, `fileExistsAfterWrite`, `intendedContentFingerprint` vs `actualContentFingerprint` |
| Checkpoint measured | **YES** | `edit_checkpoint_observation` (2) — `observedTargetCount`, `targets[].state` |
| Final retained workspace delta | **PARTIAL** | Checkpoint is a **dump-time** filesystem observation. It establishes retained state **at measurement time**, and the schema (`sdk/packages/shared/src/runtime/model-behavior-trace.ts:183-198`) states it is *"the ONLY authority for a retained-change classification"*. It **cannot** be retroactively represented as task-completion-time state. |
| Shell-side file mutations | **NO** | A shell command restoring original content produces **no native editor event**; the last read-back still describes the file as changed. Documented in the recorder's own schema comment (`model-behavior-trace.ts:186-196`). **Unobservable to the editor trace by construction.** |

### 6.2 Acceptance — the independent evaluator

`scripts/evaluate-agent-fixture.ts` (62 858 B) already provides, independently of the model trace:

| Capability | Present | Export |
|---|---|---|
| Fixture commit / tree verification | ✅ | `sha256File`, `sha256Bytes`, `canonicalDigest`, `canonicalJson` |
| Starting workspace identity | ✅ | `materializeFixture`, `buildEvaluationWorkspace`, `FixtureIdentity` |
| Final workspace digest | ✅ | `digestWorkspace` |
| Test execution + exit status | ✅ | `spawnSyncProcess`, `ProcessOutcome` (`ProcessEndKind`) |
| Structured test results | ✅ | `parseJunitReport` → `StructuredTestResults` |
| Scope / protected-file checks | ✅ | `inventoryCandidate`, `CandidateChange`, `matchesGlob` |
| Trial / experiment identity | ✅ | `AgentFixtureManifest`, `experimentId` / `trialId` fields |
| Verdict + provenance | ✅ | `AcceptanceVerdict`, `AcceptanceReasonCode`, `EvidenceProvenance`, `buildAcceptanceArtifact` |

**Independence is preserved and was NOT weakened.** The evaluator is a separate authority; no agent-reported claim was imported as correctness evidence. Its own test file states the separation explicitly: *"The evaluator validates neither `real.coverage.json` nor the normalized sample. It is `INDEPENDENT_ACCEPTANCE`, reported separately from the evidence-pack normalization pass."*

**But it was not run against this specimen** — the operator-supplied fixture was not on this host (see §10). So for **this** capture, acceptance evidence is **`CAPTURE_INSUFFICIENT`**.

### 6.3 Run lifecycle

| Observation | Present | Source |
|---|---|---|
| Run termination | ✅ | `run_terminated` (2) — `finishReason`, `durationMs`, `iterations` |
| Loop-detector verdict | ✅ | `loop_verdict` (1 022) — `ok`/`soft`/`hard`, from the unchanged production `LoopDetectionTracker` |
| Continuation | ✅ | `command_status` (32) + background terminal projection per job |
| Background obligation | ✅ | `BackgroundNotifyCoordinator`, `terminalPromise` |
| Task-completion authority | ⚠️ **DISTINCT** | The orchestrator's `finishReason` (`completed`) is a **runtime** fact. It is **not** task-completion authority in the acceptance sense. |
| Transcript-tail `completion_result` | ❌ **NOT equated** | Deliberately not used as correctness evidence. |
| Independent acceptance | ❌ **absent for this capture** | See §6.2. |

---

## 7. Decision-sufficiency answers and offline ablation (C5)

### 7.1 The three questions

| Q | Question | Answer | Basis |
|---|---|---|---|
| **Q1** | Is the agent doing work? | **YES** | 946 model requests finished, 1 022 tool invocations finished, all with exact start/finish pairs; 857/857 iterations of the long run accounted for with **zero gaps**. This is the weakest claim and it is established. |
| **Q2** | Is the agent's execution succeeding? | **`CAPTURE_INSUFFICIENT`** | The trace contains **no exit code, no signal, no terminal state and no job id** for any command. `outcome:"success"` proves only *"the executor did not throw"*. 949/949 all-success is **uninformative** about process success precisely because it is a boolean collapse. |
| **Q3** | Is the work improving the task's correctness? | **`CAPTURE_INSUFFICIENT`** | Zero acceptance-family records, zero structured test-result records, and no evaluator run against this specimen. Workspace checkpoints establish **retained state**, not **correctness**. |

### 7.2 Necessity discriminator — offline evidence ablation

> **CORRECTION01 (`ACT-CLINEMM-TRACE-DECISION-SUFFICIENCY-RECON01-CORRECTION01-SUCCESSOR-CONTRACT.md`):
> the table below is a `HYPOTHESIS_ONLY` necessity argument, NOT an executed ablation of this
> specimen.** Its **Full** row is a *hypothetical* configuration in which Q2 and Q3 are answerable;
> §7.1 establishes that for **this** capture both are `CAPTURE_INSUFFICIENT`. The table becomes an
> executed ablation only once process outcomes are actually captured and the proposed discriminator
> is exercised against real evidence. See CORRECTION01 §3 and §5.4.

Purely offline: each evidence category is removed from the analysis; no source mutation, no model replay.

| Configuration | Q1 activity | Q2 execution success | Q3 correctness |
|---|---|---|---|
| **Full** *(hypothetical — NOT this specimen)* | answerable | answerable | answerable |
| **− Process result** | answerable | **`CAPTURE_INSUFFICIENT`** | answerable |
| **− Workspace checkpoint** | answerable | answerable | **`CAPTURE_INSUFFICIENT`** |
| **− Independent acceptance** | answerable | answerable | **`CAPTURE_INSUFFICIENT`** |
| **− Activity** | **unanswerable** | answerable | answerable |

**Classification: `HYPOTHESIS_ONLY` (necessity argument), not `EXECUTED_ABLATION`.**

The argument each row makes is about **necessity**: *if* a category were present, removing it would
kill exactly one decision. It does **not** establish that this specimen exhibits that
configuration — it does not, for Q2 or Q3.

### 7.3 What this establishes

The trace's own contribution to decision-sufficiency is **exactly one of the three questions (Q1)**. The other two are **composable from authorities that already exist but were not exercised against this capture**:

- **Q2** becomes answerable by recording the exit status the background manager and the foreground terminal process **already observe**.
- **Q3** becomes answerable by running the **already-existing** independent evaluator against the capture's workspace — an offline, harness-neutral composition requiring **no production change at all**.

> **Important consequence:** Q3 is answerable *today*, offline, by composition. Only Q2 requires a production-seam change.

---

## 8. Contract conformance and privacy (C6, C7)

### 8.1 Conformance matrix against `agent-trace/0.1`

| Contract | Assessment | Basis |
|---|---|---|
| Native-to-portable event mapping | **PASS** | 16 native types → 5 families, `unnormalizedRecords: 0` |
| Completeness and truncation | **PASS** | `PARTIAL`; truncation on 7 902/7 902; summary counts internally consistent and re-derived from bytes |
| Correlation and namespaces | **PASS** | `runIdNamespace` carried; 4 refusal classes named; no timestamp joins |
| Requested / wire / provider reasoning distinction | **PASS** | three separate field groups; unavailable fields left unavailable |
| Tool vs process separation | **PASS** | `process` family exists with **no producer** — the contract does **not** let tool success masquerade as process success |
| Editor application vs retained state | **PASS** | `edit_application` carries no `retained` flag; retained state lives only on `edit_checkpoint_observation` |
| Acceptance authority independence | **PASS** | `acceptance` family has **no producer** in the adapter; only the evaluator may write it |
| Privacy filtering | **PASS** | fail-closed allowlist; `toolNames` → count (948 dropped); depth cap 4; zero absolute paths in 7 902 records |
| Provenance labels | **PASS** | `REAL` / `SYNTHETIC` / `INFERRED` / `UNAVAILABLE_FROM_TRACE`; `evidenceQuality`/`correlationCompleteness` axes kept separate |
| Experiment-manifest readiness | **PARTIAL** | see §8.2 |

### 8.2 Experiment manifest — the 18 fields

| Field | Source | Status |
|---|---|---|
| `experimentId` | independent | **UNAVAILABLE** (not in trace) |
| `trialId` | independent | **UNAVAILABLE** (not in trace) |
| `harnessName` | trace | **observed** — `cline` (adapter option) |
| `harnessSourceHead` | independent | **UNAVAILABLE** — trace carries `sourceHead: UNAVAILABLE_FROM_TRACE`. **Must not be backfilled from today's checkout.** The capture *does* carry `extensionVersion 4.1.16-5a1c485cb` and `extensionBundleSha256 40d305b2…` — a usable *artifact* identity, not a source head. |
| `harnessArtifactVersion` | trace | **observed** — `4.1.16-5a1c485cb` |
| `harnessArtifactSha256` | trace | **observed** — `40d305b2…8990cad` |
| `modelProvider` | trace | **observed** — `minimax` |
| `exactModelId` | trace | **observed** — `MiniMax-M3` (runtime-resolved); `providerConfirmedModelId` = `UNAVAILABLE_FROM_TRACE` |
| `requestedReasoning` | trace | **observed** — `requestedThinking: "off"`, `reasoningEffortAdvertised: false` |
| `verifiedWireReasoning` | trace | **observed** — `wireThinkingMode: "disabled"`, `wireOutputTokenLimit: 32000` |
| `promptSha256` | independent | **UNAVAILABLE** — the trace carries prompt **lengths** (`systemPromptChars 81167`), never content, so no digest is derivable |
| `fixtureSourceHead` | independent | **UNAVAILABLE** for this specimen (operator fixture not on host) |
| `fixtureTreeSha` | independent | **UNAVAILABLE** for this specimen |
| `fixtureStartingFilesSha256` | independent | **UNAVAILABLE** for this specimen |
| `toolCatalogFingerprint` | — | **`UNAVAILABLE_FROM_TRACE`** — CORR02 established catalog identity is unavailable; the adapter exports `toolCatalogCount` only (`toolCount: 22` at the effective snapshot) |
| `toolPermissionsFingerprint` | independent | **UNAVAILABLE** — not recorded |
| `runtimeEnvironment` | partial | **observed** — provider/model/budget/token facts; **UNAVAILABLE** for OS/shell/terminal-profile identity |
| `traceCoverage` | trace | **observed** — `completeness: PARTIAL`, `truncated: true`, `droppedCount: 39`, `nativeRecordsRead: 7902`, `portableRecordsWritten: 7902`, `unnormalizedRecords: 0` |

**Manifest readiness: `PARTIAL`** — 8 of 18 fields are trace-observed, 1 is explicitly unavailable by contract, 9 require independent collection.

### 8.3 Documentary drift (P2, non-blocking)

`agent-trace-v0.1.md` still lists `toolCatalogFingerprint` as a manifest field (**:301**) and as the source for *"tool availability and permissions"* (**:331**). CORR02 established that catalog identity is **`UNAVAILABLE_FROM_TRACE`** without an independent trusted identity authority, and the implementation reports exactly that (`normalize-agent-trace.ts:350, :1352`; `coverage.toolCatalogIdentity: UNAVAILABLE_FROM_TRACE`).

**Classification: P2 wording drift.** Recorded for terminal cleanup. **CORR03 is not reopened** and no behaviour is changed here.

### 8.4 Privacy assessment (C7)

The recon was strictly observational. No captured command was executed, replayed or re-derived; no prompt, reasoning text, command text, stdout/stderr, credential, environment value, absolute path, provider request body or user-workspace source was read, printed or committed.

Verification over the **7 902 portable records**:

| Check | Result |
|---|---|
| Longest string value anywhere | **64 chars** (an `argumentFingerprint`) |
| Strings longer than 200 chars | **0** |
| Absolute paths (`^/`, `^[A-Za-z]:[\\/]`, `^\\\\`) | **0** |
| Credential-bearing keys | **0** (matches were `inputTokens` / `outputTokens` / `cacheReadTokens` — **counts**) |
| Prompt/reasoning content | **0** — `systemPromptChars` is a **numeric length** (`number`), verified by type |
| Raw output / stdout / stderr | **0** — only `outputSizeChars` (a count) |
| Max nesting depth | **4** (the contract's cap) |
| Records missing a required envelope key | **0** |
| Records with `traceTruncated !== true` | **0** |
| Records carrying the dump summary | **0** |

**Privacy verdict: PASS.** The only strings in the portable artifact are fingerprints, ids and enumerated tokens.

---

## 9. Ranked evidence gaps (C9)

Ranked by decision improved ÷ cost. "New runtime instrumentation necessary?" is answered **only** after the source and evidence reconnaissance above.

| Rank | Candidate | Decision improved | Current authoritative producer | Missing correlation / measurement | Privacy risk | Semantic-change risk | Effort | **New runtime instrumentation necessary?** |
|---:|---|---|---|---|---|---|---|---|
| **1** | **Command-process outcome trace bridge** | **Q2 — "is execution succeeding?"** | `CommandJobManager.finalize` (`:2450`) and `VscodeTerminalProcess.getCompletionDetails()` (`:611`) | The exit status is **observed then discarded** at `definitions.ts:366`. Background additionally lacks a `toolCallId ↔ jobId` join. **CORRECTION01: the observation is per *command*, and the background terminal result arrives after `tool_finish`.** | **Low** — status codes only; no text, no argv | **Low** — read-only, additive recording; **CORRECTION01: the observation boundary is not preordained (CORRECTION01 §4.1)** | **Small** | **YES — but bounded to a record/encode change, not a new monitor.** The producer already exists. |
| 2 | External progress / acceptance milestones | Q3 — "is correctness improving?" | `scripts/evaluate-agent-fixture.ts` (already complete) | The evaluator must be **run** against the capture's workspace. Nothing is missing in production. | Low (already privacy-designed) | **None** — offline | Very low | **NO** — composition only |
| 3 | Exact execution-to-tool correlation (`toolCallId ↔ jobId`) | Attribution of a process outcome to the exact tool call | `jobId` is already minted by the manager and already **model-visible** (`vscode-run-commands-tool.ts:1810`) | The join is **model-mediated only**; it is never recorded | Low | Low | Small | **Folded into #1** — the same bridge carries both |
| 4 | Workspace checkpoints at declared lifecycle boundaries | D3 — retained progress over time | `edit_checkpoint_observation` producer exists | Checkpoints exist only at dump time; the *measurement time* must not be conflated with task-completion time | Low | Low | Medium | **NO** — needs a trigger, not a new authority |
| 5 | Larger / segmented captures | Coverage of long investigations | Recorder ring limits (`MAX_RECORDS 8192`, `MAX_BYTES 4 MiB`) | 39 events lost at the head | None | None | Trivial | **NO** — no new evidence semantics |
| 6 | More loop-detector heuristics | Semantic loop detection | `LoopDetectionTracker` (production, unchanged) | The detector already fired `soft`×1 / `hard`×0 with **948/949 distinct fingerprints** — it is **not** the binding constraint | Low | Medium | Medium | **NO** — and **lowest priority**: the bottleneck is process outcomes, not loop detection |

**Explicitly NOT proposed:** semantic model-loop detection from iteration count. 857 iterations with 948/949 distinct command fingerprints and a production detector that reached `hard` **zero** times is **not** evidence of looping. Adding heuristics here would optimize the wrong axis.

---

## 10. Executable gates, limitations and terminal verdict (C8)

### 10.1 Executed focused tests (existing suites only — no new suite created)

| Suite | Command | Result | Class |
|---|---|---|---|
| Agent-trace contract + comparator | `bunx vitest run --config vitest.config.ts src/sdk/__tests__/agent-trace-contract-recon01.test.ts src/sdk/__tests__/compare-model-behavior-traces.test.ts` | **45/45 PASS**, exit 0 | **`EXECUTED_PASS`** |
| Command-job-manager lifecycle | `bunx vitest run … src/sdk/command-job-manager.test.ts src/sdk/command-job-manager.owner-session-id.test.ts` | `command-job-manager.test.ts` **PASS**; `owner-session-id.test.ts` **7 failed / 2 passed** | **`BASELINE_FAILURE`** (see below) |
| `run_commands` foreground/background classification | `bunx vitest run … src/sdk/__tests__/run-commands-nonterminal-classification01.rcnc01.test.ts src/sdk/__tests__/run-commands-nonterminal-original-tool-result-discriminator01.rcnc02.test.ts` | **PASS** | **`EXECUTED_PASS`** |
| Independent evaluator | `bun test scripts/__tests__/evaluate-agent-fixture.test.ts` | **18 pass / 10 skip / 0 fail**, exit 0 | **`EXECUTED_PASS`** (with **`CAPTURE_INSUFFICIENT`** on the 10 skipped) |

**The `owner-session-id.test.ts` blocker, preserved exactly.** All 7 failures assert `start.state === "running"` but receive **`"spawn_failed"`** (e.g. `:183`, `:206`, `:323`, `:360`). The working tree was clean and the test file is **unmodified at HEAD** (`git diff HEAD` empty), so this is not a recon-induced regression. **Root cause, reproduced independently:** this host's sandbox denies process-group signalling — `kill(-pgid, 0)` fails with **`EPERM`** for a plain `spawn(..., {detached:true})` in a standalone script, and vitest's own pool teardown reports `errno: -1, code: 'EPERM', syscall: 'kill'`. The manager's spawn path requires that signalling, so every job start fails. **Classification: `BASELINE_FAILURE` (environmental), not `EXECUTED_FAIL`.** No repair was attempted — it is not owned by this ACT.

**The evaluator's 10 skipped witnesses, preserved exactly.** They are gated by `REAL_FIXTURE_AVAILABLE` / `REPAIR_AVAILABLE` (`scripts/__tests__/evaluate-agent-fixture.test.ts:77, :405`), which read the operator environment variables `CLINE_ACCEPTANCE_FIXTURE_REPO`, `CLINE_ACCEPTANCE_MANIFEST` and `CLINE_ACCEPTANCE_REPAIR_DIR`. **None are set on this host**, so the frozen-fixture end-to-end witnesses cannot run. **Classification: `CAPTURE_INSUFFICIENT` (missing operator fixture) — the blocker, not a failure.** The 18 executed witnesses (including *"observes the real exit code"*, *"FAIL-08: a non-zero exit is not a success even when stdout claims otherwise"*, and *"INCOMPLETE-01: a timeout is distinguishable from a non-zero exit"*) confirm the evaluator's process-outcome authority is live and correct.

### 10.2 Limitations

| # | Limitation |
|---|---|
| L1 | The capture is a **lower bound**: 39 events (seq 1–39) are permanently lost. Every count here is *"at least"*. |
| L2 | The specimen contains **no** acceptance evidence, so Q3 was assessed as `CAPTURE_INSUFFICIENT` **for this capture** — not as a defect of the evaluator. |
| L3 | The evaluator's frozen-fixture end-to-end witnesses could not execute (§10.1). The evaluator's *capabilities* are established **structurally**; its *verdict on this specimen* is **not** established. |
| L4 | `command-job-manager.owner-session-id.test.ts` could not execute its spawn-dependent assertions in this sandbox (§10.1). |
| L5 | The foreground exit code is authoritative **only when shell integration reports it** (`VscodeTerminalProcess.ts:374-381`). A successor must record *"exit code unknown"* as a distinct value rather than collapsing it to success. |
| L6 | Foreground commands have **no** `jobId`; only the background path carries a process identity. A successor must therefore treat foreground and background as two distinct correlation shapes, not one. |
| L7 | Only **one** real capture was analysed. Conclusions about the *recorder's* behaviour are broad; conclusions about *this session* are narrow. |
| L8 | Shell-side file mutations remain **unobservable** to the editor trace by construction. |
| L9 | The 396 pre-existing epic-board validator issues are pre-existing and **out of scope** (P2, non-blocking). |

### 10.3 Terminal verdict

**`PASS_RECON_WITH_GAPS`**

**Why not `PASS_RECON_DECISION_SUFFICIENT`:** Q2 (execution success) is unanswerable from the specimen, and the ablation shows process results are **load-bearing** for exactly that question.

**Why not `NO_NEW_INSTRUMENTATION_NEEDED`:** Q3 is answerable today by offline composition, but **Q2 is not** — the exit status is observed in production and then **discarded** at the trace boundary. One bounded recording change closes it.

**Why not `CAPTURE_INSUFFICIENT`:** the required specimen was found and **verified byte-for-byte** against the frozen identity, and it supported every executed gate. **CORRECTION01: the ablation in §7.2 is a `HYPOTHESIS_ONLY` necessity argument, not an executed ablation of this specimen — it is not counted as a supporting gate.**

**Why not `HALT_CONTRACT_VIOLATION`:** no new privacy, completeness or provenance violation was established. The adapter reported `PARTIAL` for the truncated specimen; privacy filtering held at every depth.

**Why not `HALT_UNEXPECTED_DIRT`:** the tree was clean at entry and remains clean apart from the two intended documentation artifacts.

---

## 11. The one selected successor (C10) — proposal only, **not implemented**

### `ACT-CLINEMM-COMMAND-PROCESS-OUTCOME-TRACE-BRIDGE01`

> **CORRECTION01 (`ACT-CLINEMM-TRACE-DECISION-SUFFICIENCY-RECON01-CORRECTION01-SUCCESSOR-CONTRACT.md`):
> the contract below was CORRECTED. The original proposal — *"one exit-status scalar on the existing
> `tool_finish` event"* — is **not implementable**: `tool_finish` fires **once per tool call** while
> **N command outcomes** exist, and it fires **before** a background job's terminal status does.
> The corrected contract is in **CORRECTION01 §4** and is normative where it differs from this
> table. Disposition: **`HALT_SUCCESSOR_CONTRACT_FALSE_CARDINALITY`**.

| Field | Value |
|---|---|
| **Source seam** | `apps/vscode/src/sdk/vscode-run-commands-tool.ts` — the point where the exit status is already known: `:716` (foreground, `completionDetails.exitCode`) and `:1859/:1878` (background, `start.state` + `start.exitCode`). The recording boundary itself is `sdk/packages/agents/src/agent-runtime.ts:4849` (`observeToolBoundary("finish", …)`), which already carries the correlated `toolCallId`. **CORRECTION01: this boundary fires once per tool call and cannot carry per-command cardinality or a background terminal status — see CORRECTION01 §4.1.** |
| **Missing fact** | The process **exit status** of a `run_commands` invocation: the exit code value, the terminal class (`exited` / `deadline_exceeded` / `cancelled` / `spawn_failed` / `containment_failed` / `unknown`), and — background only — the `jobId`. **CORRECTION01: per *command*, not per invocation — one `run_commands` call may execute N commands with N different outcomes (`definitions.ts:284-285`, `Promise.all`).** |
| **Exact identity & lifecycle** | The `toolCallId` is minted by the runtime and **already pairs start↔finish by construction** (`agent-runtime.ts:4508-4509`). The background `jobId` is minted by `CommandJobManager` and already **model-visible** (`:1810`). The join is therefore `toolCallId → jobId`, both already-existing identifiers — **no new identity namespace is required**. For foreground there is **no** `jobId`: the record must carry the exit code and an explicit `unknown` when shell integration did not report one (`VscodeTerminalProcess.ts:374-381`). **CORRECTION01: the correlation key is `(session, toolCallId, commandIndex) → jobId` where established — never a timestamp join.** |
| **RED reproduction** | With the bridge absent, `tool_finish` for a `run_commands` call carries **no** exit-status field. A RED witness: run a command that exits non-zero (and one that is killed by a signal), assert the recorded `tool_finish` carries the exit code — today it carries only `outcome:"success"` (a per-command failure is caught inside `executeShellCommands` and never reaches the boundary — CORRECTION01 §2.3), so `outcome:"success"` is indistinguishable from a silent no-op. This is directly observable in the specimen: **949/949 `run_commands` are `outcome:"success"`, and the trace contains no exit-code-like key at all.** **CORRECTION01: the RED must also include a MIXED-COMMAND control (two commands, different outcomes) and a DELAYED-COMPLETION control (background `RUNNING`, terminal result later).** |
| **Necessity / ablation** | §7.2: removing the process-result category changes Q2 from *answerable* to **`CAPTURE_INSUFFICIENT`**, and changes nothing else. **This is the only category whose removal changes exactly one decision.** **CORRECTION01: this is a `HYPOTHESIS_ONLY` necessity argument, NOT an executed ablation of the specimen (§7.2). It becomes an executed ablation only once process outcomes are captured.** |
| **Conservation tests** | (a) The recorder's disabled path performs **no** extra work and **no** extra `await` (the existing `agent-runtime.ts:4515-4521` discipline — fingerprint awaited only when the sink returns a promise); (b) **no** change to tool execution, exit-code semantics, approval, compaction policy or loop-detector behaviour; (c) the recorded exit code **equals** the value the process actually produced — verified against `CommandExitError.exitCode` and `CommandJobSnapshot.exitCode`; (d) a job returning `RUNNING` is **never** recorded as a process success — its terminal fact arrives later, and an interim record must say *"running, not yet terminal"*, never *"success"*; (e) `containment_failed` is preserved distinctly and **never** collapsed into `exited`. **CORRECTION01: add (f) per-command cardinality is preserved — a mixed-outcome batch yields distinct per-command entries, never one collapsed scalar; (g) `unknown` is preserved distinctly and never collapsed into `0`.** |
| **OFF-path neutrality** | The bridge is **default-OFF** like the recorder itself. With tracing off, the tool's execution order and result are **byte-identical** to today. The bridge is a *record/encode* change — **no new process monitor, no new timer, no new state, no new public field on any wire contract.** **CORRECTION01: "no new event kind" is NOT guaranteed.** Because `tool_finish` is closed before a background job's terminal status exists, an **additional internal trace event** may be required to carry the eventual authoritative result. Whether an existing event suffices is to be established **at the real seam** by the implementation ACT — see CORRECTION01 §4.1. Any additional event is **internal to the recorder**; the public wire contract is unchanged either way. |
| **Privacy limits** | Exit code, terminal class, `commandIndex` and `jobId` only. **No** command text, **no** argv, **no** stdout/stderr, **no** environment, **no** absolute path. `jobId` is a manager-minted opaque id (already model-visible), not a path. The existing fail-closed allowlist in `normalize-agent-trace.ts` must be extended to permit the new keys **explicitly** — an unfamiliar key still does not escape. A `process` family with a real producer may then exist for the first time; its `FAMILY_KEYS` entry is currently intentionally empty (`:1063-1066`). |
| **Removal conditions** | Any temporary diagnostic (e.g. a temporary log of the raw exit code during bring-up) must be removed at the end of the successor ACT, must never be enabled by default, and must never write to the trace, the recorder or any production state outside the recorder's own bounded ring. |
| **Why bounded to one causal purpose** | The successor has exactly one causal purpose: **record the process exit status that the production seam already observes, correlated by the identity that already exists.** It changes no decision semantics, no tool behaviour and no lifecycle authority. **CORRECTION01: the observation boundary is NOT preordained — the seam is to be established at the real production boundary (§4.1), within the constraints above (default-OFF, no execution-semantic delta, no public wire change, no new process monitor).** |

### 11.1 The orthogonally larger but *free* win (no successor required)

**Q3 requires no production change at all.** Running the existing independent evaluator against the capture's workspace — and recording its `AcceptanceArtifact` alongside the portable trace — would make *"is the work improving correctness?"* answerable today. This is **offline composition**, and it is **independent by construction** (supplying the trace does not change the evaluator's verdict — the evaluator's own witnesses assert exactly that: *"harness neutrality: the verdict is identical with and without a trace"*).

---

## 12. Evidence index

| Artifact | Location | Committed? |
|---|---|---|
| Verified capture | `/Volumes/UserData/Users/chistyakov/Downloads/model-behavior-trace.jsonl` | **NO** — operator-provided, outside the repo |
| Normalized portable stream | `/tmp/clinemm-recon-out/model.normalized.jsonl` (temporary) | **NO** — temporary evidence |
| Coverage report | `/tmp/clinemm-recon-out/model.coverage.json` (temporary) | **NO** — temporary evidence |
| Offline analysis scripts | `/tmp/clinemm-recon/*.mjs` (temporary) | **NO** — temporary probes |
| This report | `docs/acts/ACT-CLINEMM-TRACE-DECISION-SUFFICIENCY-RECON01/REPORT.md` | **YES** |
| Epic board update | `.factory/epic-board.md` | **YES** |

**No raw trace, complete normalized stream, command output or private experiment data is committed.**

### Production seams cited

`apps/vscode/src/sdk/vscode-run-commands-tool.ts:716, 1516-1517, 1743-1784, 1808-1816, 1859-1883` · `apps/vscode/src/sdk/command-job-manager.ts:54-87, 97-133, 196-239, 2450-2560, 2844-2892, 3075-3330` · `apps/vscode/src/sdk/command-status-tool.ts:218-240, 339-350, 376-383, 489, 530` · `apps/vscode/src/sdk/model-behavior-trace-runtime.ts:266-329, 412-423` · `apps/vscode/src/sdk/normalize-agent-trace.ts:656-768, 875-1007, 1013-1107, 1115-1357` · `sdk/packages/agents/src/agent-runtime.ts:3714-3731, 4507-4538, 4845-4864` · `sdk/packages/core/src/extensions/tools/definitions.ts:347-395` · `sdk/packages/core/src/extensions/tools/executors/bash.ts:444-452` · `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:2000-2060, 2075-2095` · `sdk/packages/core/src/runtime/safety/loop-detection.ts:95-157` · `sdk/packages/shared/src/runtime/model-behavior-trace.ts:50-58, 168-202, 210-221` · `apps/vscode/src/hosts/vscode/terminal/VscodeTerminalProcess.ts:60-78, 133, 275-276, 350-400, 440-460, 611-613` · `apps/vscode/src/hosts/vscode/terminal/osc633Parser.ts:29-48, 136-139` · `scripts/evaluate-agent-fixture.ts:78-87, 154-320, 670-761, 815-844, 978-1020, 1020-1157, 1308-1354, 1474-1501, 1727-1830`
