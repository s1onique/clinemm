# ACT-CLINEMM-AUTONOMOUS-RECOVERY-TRIGGER-FORENSICS-01 — Causal Summary

**Scope:** evidence acquisition only. No production code was repaired.
**Verdict:** `CLASSIFIER_FALSE_PRODUCTIVITY_REPRODUCED` (primary) ·
`RECOVERY_NOT_ELIGIBLE_AS_DESIGNED` (secondary) · `CAPTURE_INSUFFICIENT` (not established).

---

## 0. What was replayed, and with what authority

The replay imports the **REAL** production modules, extracted byte-for-byte from the
installed extension source versions, and executes the **REAL** production decision path:

| Production artefact | Source | Verbatim? |
|---|---|---|
| `foldExecutionRound`, `decideExecutionStagnation`, `applyExecutionStagnationDecision`, `buildExecutionStagnationNoticeMessage`, `parseExecutionStagnationNoticeMessage` | `@cline/shared` `agents/execution-stagnation.ts` @ `b5bf8d34f` | YES (cmp-identical) |
| `createHostExecutionProgressClassifier`, `isInspectionCommandInput` | `@cline/core` `extensions/tools/execution-progress-classifier.ts` @ `b5bf8d34f` | YES (cmp-identical) |
| `AgentRuntime.classifyToolCallProductivity` / `resultReportsStillRunning` / `outputReportsStillRunningShape` / `classifyExecutionRound` / `observeExecutionRoundToolCall` / `applyHostProductivityVerdict` | `@cline/agents` `agent-runtime.ts` @ `b5bf8d34f` | YES (method bodies verified byte-identical between `b5bf8d34f` and `788e22197`) |

The two installed versions share a **byte-identical** classifier and decision function
(`git diff b5bf8d34f 788e22197` over `sdk/packages/shared/src/agents/execution-stagnation.ts`
and `sdk/packages/core/src/extensions/tools/` is empty), so one extraction serves both.

**Replay fidelity gate (the ACT's own precondition):**

| Session | Observed R1 injections | Replayed R1 injections | Streak / tool-list / message-index match |
|---|---|---|---|
| A `1795612311440_l9mhl` | 2 | 2 | EXACT (msg 28 & 57; streak 5; tool lists `read_files, run_commands` and `run_commands`) |
| B `1795619309746_8h3tn` | 0 | 0 | EXACT |

The replay reproduces Session A's observed R1 decisions **exactly**, therefore Session B's
prediction (no intervention) is **established**, not merely asserted.

Independent cross-check: the **provider-request captures** (302 files) confirm
Session A carried an R1 notice from capture iteration 9 (= one iteration after the replay's
injection at round 8, matching the runtime's inject-after-the-round boundary), and Session B
carried **0** R1 notices and **0** R2 dispatches across **all 233** captured requests.

---

## 1. Production policy reachability (R2 → R1)

**R2 is reachable in Session B. The environment opt-in is real.** The extension-host
process for Session B (pid 34583) carries `CLINE_BOUNDED_OBJECTIVE_DOGFOOD=1` in its
environment (`ps -Eww`), and `isBoundedObjectiveDogfoodEnabled()` accepts exactly `"1"`.

**But enabling R2 does not touch R1.** The chain is:

```
buildSessionConfig()            apps/vscode/src/sdk/cline-session-factory.ts
  → executionStagnationPolicy { unproductiveRoundThreshold: 5, maxRecoveryInstructions: 2,
                                enabled: true, classifyToolCall: createHostExecutionProgressClassifier() }
  → boundedObjectivePolicy { enabled: true, maxActivations: 2, maxObjectiveRounds: 8,
                             maxSelectionInferences: 1 }   // ONLY when the dogfood env opt-in is set
  → LocalRuntimeHost             sdk/packages/core/src/runtime/host/local-runtime-host.ts:1395,1408
  → AgentRuntimeConfigBuilder    sdk/packages/core/src/runtime/config/agent-runtime-config-builder.ts:144,149
  → AgentRuntime                 sdk/packages/agents/src/agent-runtime.ts
```

The two policies are **independent keys on the same config object**. In
`AgentRuntime`, `this.executionStagnation` is written **only** by
`foldExecutionRound` (line 2411) and `applyExecutionStagnationDecision` (line 2438), and
is reset **only** by `createExecutionStagnationAccounting()` at the run boundary (line 3698).
The R2 path never writes it; it only **reads** it (lines 2927, 2960) to build the selection
context. Symmetrically, the R1 path never writes `boundedObjectiveActivations`,
`boundedObjectiveSelectionInferences` or `boundedObjectiveFacts`.

**Consequence:** enabling R2 neither enables, disables, re-thresholds, re-budgets, nor
re-accounts R1. Session B's R1 behaviour is **byte-identical to what Session A's R1
behaviour would have been** — the same policy, the same threshold, the same allowance,
the same classifier.

**R2's only entry point is the R1 `allowance_exhausted` branch**
(`agent-runtime.ts:2420-2434` → `activateBoundedObjectiveRecovery`). R2 is a *second
stage downstream of R1*, not an independent trigger. Therefore:

> **If R1 never fires, R2 is unreachable — by design.**
> `RECOVERY_NOT_ELIGIBLE_AS_DESIGNED` is supported for R2 in Session B.

---

## 2. The decisive discriminator: false productivity from `ssh`

### 2.1 The defect

`createHostExecutionProgressClassifier()` classifies a `run_commands` call as INSPECTION
**only when every command segment's PROGRAM is in a closed whitelist**:

```
INSPECTION_PROGRAMS = { cat, echo, file, find, git, grep, head, ls, nl, od,
                         printenv, pwd, rg, sed, stat, tail, tree, type, wc, which, whoami }
```

`splitSegments`/`unwrap` read only the **LOCAL first token** of each segment.
`ssh` is **not** in the whitelist, so the classifier stops there and never inspects the
**remote payload**. The documented default ("the default is deliberately `executed`:
the runtime must not declare a stall on the basis of an unrecognised command") then
applies to the *whole* command.

Verified against the real production classifier:

| Command | Production verdict | Ground truth |
|---|---|---|
| `ssh host 'grep -rn fsync ~/nim/lib'` | **executed** | inspection |
| `ssh host 'sed -n "330,420p" osproc.nim'` | **executed** | inspection |
| `ssh host 'ls $N/lib \| grep -E "^(sha2)"'` | **executed** | inspection |
| `ssh host 'N=...; find $N/lib -name osproc.nim'` | **executed** | inspection |
| `ssh host 'uname -a; which nim nimble gcc'` | **executed** | inspection |
| `cd /repo && git log --oneline -5 && ls` | inspected | inspection ✓ |
| `ssh host 'mkdir -p ~/nim && curl … && tar xf …'` | executed | execution ✓ (right answer, wrong reason) |

### 2.2 Session A: the false productivity

**10 rounds** in Session A consist **solely** of `ssh` calls whose remote payload is a
**pure inspection** (`grep`/`sed`/`ls`/`find`/`which`/`uname`). The production classifier
returns `"executed"` for each, and the runtime's
`classifyExecutionRound()` therefore returns `"executed"` — a **productivity signal**.

Effect on the R1 streak (Session A, run 2, rounds 1–8):

```
iter  1  msg 12  ssh 'uname -a; which nim nimble gcc'      -> executed  streak 0->0  (RESET)
iter  2  msg 14  ssh 'curl -sI …' + local sed               -> executed  streak 0->0  (RESET)
iter  3  msg 16  ssh 'mkdir/curl/tar' + local sed           -> executed  streak 0->0  (RESET)
iter  4  msg 18  cat/ls evidence                            -> inspected streak 0->1
iter  5  msg 20  find/ls                                    -> inspected streak 1->2
iter  6  msg 22  read_files                                 -> inspected streak 2->3
iter  7  msg 24  grep -rn                                   -> inspected streak 3->4
iter  8  msg 26  read_files                                 -> inspected streak 4->5  ==> R1 INJECT #1
```

The three `ssh` rounds at the head of run 2 are **false productivity**: they produced
**no implementation edit and no deliverable** — they only read remote Nim library
sources. They nonetheless reset the streak to 0, **delaying** the first R1 injection by
three rounds.

### 2.3 Session B: genuine productivity

Session B's 31 streak resets break down as:

* **8 `editor` rounds** → `successfulEdits = 1` → `"edited"` — **real implementation edits**
  (e.g. `nim/basaltctl/src/backend.nim`, `nim/basaltctl/src/lifecycle.nim`,
  `ansible/tests/test_basalt_lifecycle_wiring.py`).
* **23 command rounds** → `"executed"` — **real mutations and real executable runs**:
  `perl -pi -e 's/…/'` (source rewrite), `python3 <<EOF` (source rewrite),
  `cat > /tmp/nimprobe/p4.nim` (file creation), `nim c …` (compile),
  `timeout 900 python3 -m unittest discover -s ansible/tests` (**test run**),
  `git worktree add` / `git add -A` / `make_gate_summary.py` (evidence production).

**Only 1 of Session B's `ssh` calls** (`msg 410`, `cat … | head -20; grep -c "OK" …`)
carried a pure-inspection remote payload. Session B's dominant pattern was
**edit → build → test → edit**, i.e. **actual new engineering progress**.

### 2.4 Consequence

Because a productive round **resets** the streak, and Session B produced a genuinely
productive round roughly every 2–3 rounds, **Session B's stagnation streak never exceeded
3** — it never reached the threshold of 5.

| | Session A | Session B |
|---|---|---|
| Total rounds replayed | 34 | 232 |
| Productivity histogram | inspected 18, executed 16 | executed 122, inspected 48, awaiting 9, **edited 53** |
| Streak resets | 3 (**all** false: `ssh` inspection) | 31 (**all** genuine: edits / mutations / test runs) |
| **Max stagnation streak** | **5** (threshold) | **3** (threshold-2) |
| R1 injections (replayed / observed) | **2 / 2** | **0 / 0** |

**The streak-resetting observations in Session A represented NO actual new engineering
progress** (they were remote source reads mislabelled as executions). **Those in Session B
did** (real edits, real compiles, real test runs).

---

## 3. The competing hypotheses, adjudicated

### 3.1 `RUN_BOUNDARY_RESET_EXPLAINS_BEHAVIOR` — **NOT SUPPORTED**

The additional user instruction ("Build Nim tooling on …") **did** reset the run-scoped
accounting in **both** sessions — `AgentRuntime.execute()` calls
`createExecutionStagnationAccounting()` (line 3698):

| | Session A | Session B |
|---|---|---|
| Run 1 last round → streak / injections | 2 / 0 | 0 / 0 |
| Run 2 first round → streak / injections | **0 / 0** | **0 / 0** |

Because the reset applied **identically** to both sessions, it cannot discriminate between
them. Session A's two R1 injections both occurred **after** the reset, inside run 2.
**The run-boundary reset does not explain the difference.**

(Same for the completion-continuation boundary: `host_runtime_control` /
`completion_continuation_control` re-enters through `session.agent.continue(...)` →
`execute()` → accounting reset. Session B's runs 3–4 are those continuations; modelling
them as separate runs is what keeps the tail rounds 222–226 from producing a spurious
injection. With that modelling, Session B's maximum streak is 3.)

### 3.2 Compaction — **NOT a discriminator**

Session A's overflow-recovery compaction occurred at transcript index 46
(`source_message_count: 47`, `source_last_message_key: id:msg_o6HTsNmQ`,
`reason: overflow_recovery_compaction`), i.e. **between** the two R1 injections. It did
**not** reset the R1 accounting (injection counter persisted `1 → 1` across the
boundary) and it **preserved** the first notice
(`compaction.messages[5].metadata.runtimeAuthority === "execution_stagnation_recovery"`).
Session B had no compaction at all. Compaction is therefore not the discriminator either.

### 3.3 `RECOVERY_POLICY_NOT_REACHABLE` — **NOT SUPPORTED for R1** (R1 was reachable and DID fire in Session A)

R1 reached the runtime in both sessions — identical policy, identical forwarding chain,
identical classifier. R1 fired twice in Session A. The absence of R1 in Session B is a
**classifier** outcome, not a reachability outcome.

### 3.4 `RECOVERY_NOT_ELIGIBLE_AS_DESIGNED` — **SUPPORTED for R2**

R2's only entry point is the R1 `allowance_exhausted` branch (streak ≥ 5 **and**
`instructionsInjected ≥ 2`):

* **Session A**: `instructionsInjected` reached 2/2, but the streak never returned to 5
  afterwards (the `ssh` rounds reset it) → `allowance_exhausted` **never reached** →
  R2 never activated. Independently: Session A ran version `4.1.26-b5bf8d34f`, which
  **predates the R2 implementation entirely** — R2 did not exist in that build.
* **Session B**: `maxSelectionInferences: 1` is **run-scoped**, and the R1 allowance was
  never even touched (0 injections) → the branch was never reached.

**Even with the correct installed version and an explicit environment opt-in, R2 could
not fire in Session B, because R2 is downstream of an R1 branch that R1 never reached.**

### 3.5 `CAPTURE_INSUFFICIENT` — **NOT ESTABLISHED**

The captures were sufficient: 37 captures for Session A (31 iterations, `run_4iSCOZaN`
+ `run_BaVA53Rx`) and 233 for Session B (222 + 7 + 2 + 2). They independently reproduce
the observed R1 injection points and confirm the absence of any R1/R2 instruction in
Session B. Every replayed round had a complete tool input and tool result; **no
classifier input was unavailable**, so no `UNAVAILABLE_FROM_TRACE` marker was required
anywhere in the ledgers.

---

## 4. Conclusions

| Conclusion | Status | Basis |
|---|---|---|
| **`CLASSIFIER_FALSE_PRODUCTIVITY_REPRODUCED`** | **SUPPORTED (primary)** | The production host classifier reads only the local first token; `ssh` is not whitelisted, so remote inspection payloads are classified `"executed"`. 10 Session A rounds were false productivity; they reset the streak three times and delayed the first R1 injection. Session B's resets were genuine (`edited` 8, real mutations/test runs 23) and its streak never exceeded 3. |
| **`RECOVERY_NOT_ELIGIBLE_AS_DESIGNED`** | **SUPPORTED** | R2's sole entry point is the R1 `allowance_exhausted` branch. That branch was never reached in either session. R2 also did not exist in Session A's build. The environment opt-in was present and correct in Session B; the policy was reachable; it was simply not eligible. |
| `RUN_BOUNDARY_RESET_EXPLAINS_BEHAVIOR` | **NOT SUPPORTED** | The run-boundary reset applied identically to both sessions (streak and allowance → 0 at each run-2 start). Session A's injections occurred after the reset. |
| `RECOVERY_POLICY_NOT_REACHABLE` | **NOT SUPPORTED for R1** | R1 reached the runtime in both sessions and fired twice in Session A. R2's enablement does not modify R1's policy, forwarding, or accounting (disjoint write sets in `AgentRuntime`). |
| `CAPTURE_INSUFFICIENT` | **NOT ESTABLISHED** | All classifier inputs were present in the transcripts; the capture set independently confirmed both sessions' outcomes. |

### The one-sentence answer

> **R1 and R2 did not intervene in Session B because the production host classifier
> cannot see past the local first token: `ssh` is not in the inspection whitelist, so
> every remote read was reported as a productive `"executed"` round and reset the
> stagnation streak. Session A happened to keep its reads local (so it stalled and
> triggered R1 twice); Session B genuinely edited, compiled and tested (so it was
> productive, and its streak never even reached the threshold of 5). R2 is downstream of
> R1's `allowance_exhausted` branch, so it was structurally unreachable in both sessions
> regardless of the correct installed version and the explicit environment opt-in.**

### Corollaries (observations, not repairs — no production code was changed)

1. The classifier defect is **bidirectional**: it manufactures false productivity (Session
   A) *and* suppresses true stalls (Session B). It is a **false-stall / false-progress**
   defect in the same decision.
2. The "successful tool dispatch" was **not** substituted for "successful command
   execution" anywhere in the replay: the classifier consumed the real `tool_result`
   envelopes, `is_error` flags and structured `state`/`status`/`exitCode` markers.
3. Session B's single `ssh`-inspection round (msg 410) was a false productivity too — it
   simply did not need to carry the session, because genuine productivity already reset
   the streak.
4. The `ssh` defect is a **host-classifier** defect, not a runtime-accounting defect.
   The runtime accounting (`foldExecutionRound` / `decideExecutionStagnation`) behaved
   exactly as specified in both sessions.

---

## 5. Artifacts

| File | Content |
|---|---|
| `round-ledger.1795612311440_l9mhl.json` | Session A round ledger — 34 rounds, 4 runs, per-round tool identities, execution outcomes, production classification, streak before/after, remaining allowance, R1 decision, R2 eligibility |
| `round-ledger.1795619309746_8h3tn.json` | Session B round ledger — 232 rounds, 4 runs, same schema |
| `replay/replay.ts` | The replay driver (imports the real production modules) |
| `replay/production-classifier.ts` | Verbatim copies of `AgentRuntime`'s private classification methods (byte-identical across both versions) |
| `replay/prod/shared/agents/execution-stagnation.ts` | Verbatim `@cline/shared` decision function @ `b5bf8d34f` |
| `replay/prod/core/tools/execution-progress-classifier.ts` | Verbatim `@cline/core` host classifier @ `b5bf8d34f` |
| `replay/prod/core/tools/command-guard.ts` | Verbatim `command-guard.ts` @ `b5bf8d34f` (the classifier's only dependency) |
| `replay/prod/core/tools/schemas.ts` | Verbatim `schemas.ts` @ `b5bf8d34f` |

**Reproduce:** `bun .factory/evidence/ACT-CLINEMM-AUTONOMOUS-RECOVERY-TRIGGER-FORENSICS-01/replay/replay.ts`

**Frozen witnesses (read-only, unmodified):**
`~/.vscodium-lab/cline-data/sessions/1795612311440_l9mhl/` and
`~/.vscodium-lab/cline-data/sessions/1795619309746_8h3tn/`
