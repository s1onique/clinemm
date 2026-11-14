# ACT-CLINEMM-COMPACTION-TASK-CONTRACT-CONSERVATION-RECON01 — REPORT

**Primary verdict: `RECON_COMPLETE_ONE_BOUNDED_REPAIR`**

The active task contract is **reproducibly lost** across Agentic compaction at the
real production projector / provider-preparation boundary, and a **bounded
existing-authority carry-forward** conserves it with **no new persistence, no
second task-state owner, and no canonical-history mutation**.

---

## 1. Final report contract

### 1.1 Primary verdict

`RECON_COMPLETE_ONE_BOUNDED_REPAIR`.

The RED reproduces at the real seam; Candidate C1 passes the feasibility,
lifecycle and adversarial tests; the implementation cost is one pure
transformation plus one call site.

### 1.2 Entry and final HEAD

| Item | Value |
|---|---|
| Repository | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm` |
| Remote (origin) | `git@github.com:s1onique/clinemm.git` |
| Branch | `main` |
| Entry HEAD | `e854053b64c46e94a2d910775168406a56ea35f2` |
| Final HEAD | `e854053b64c46e94a2d910775168406a56ea35f2` — **unchanged** (recon only) |
| Worktree at entry | CLEAN |
| `stash@{0}` | Preserved verbatim; stash count 1 |

Ancestry of the expected predecessors, all confirmed `YES`:
`753f4adad`, `a02a040e1`, `e854053b6` (the last is HEAD itself).

### 1.3 Verified runtime identity

`node v26.0.0` (VS Code extension host runtime) and `bun 1.3.14` (tooling),
resolved at `/opt/homebrew/bin`. `bun` was **not** on the default `PATH` in this
shell. Vitest `v4.1.10`. Full detail: `evidence/identity.txt`.

### 1.4 Original task contract: source and provenance

Extracted by hand from the canonical transcript — **not** from the generated
summary under test. Full table with source hashes: `evidence/contract-sources.tsv`.

| Contract field | Source | Authority | Provenance |
|---|---|---|---|
| Objective | canonical idx **0** (`260c8d9a…`) | **user-authored** | "What does this project do?" + investigate README / structure / providers / CI / charts / git history; explain purpose, subsystems, production behavior, deployment architecture, local dev workflow |
| Scope | canonical idx **0** | user-authored | the repository under test (private checkout path withheld) |
| Constraints | canonical idx **0** | user-authored | **"Do not modify any files."** (read-only) |
| Deliverable | canonical idx **0** | user-authored | an explanation of purpose, subsystems, production behavior, deployment architecture, local dev workflow |
| **Completion** | canonical idx **1** (`msg_DuOUUe3v`) and **27** (`msg_SLg3GrwG`) | **RUNTIME-SYNTHETIC** | `[SYSTEM] This run is not complete until you call one of these terminal completion tools: submit_and_exit. …` |
| Supersession / Amendment | canonical idx **26** | user-authored | "Continue" |
| Progress | canonical idx 2..206 | mixed | *not* an instruction; observable only |

**The single most consequential finding of this ACT** is the completion field's
provenance. The completion obligation is **not** a user-authored instruction.
It is a **runtime-synthesized** message produced by
`sdk/packages/agents/src/agent-runtime.ts:1726`
(`getCompletionToolReminderMessage`), gated by
`completionPolicy.requireCompletionTool`
(`sdk/packages/core/src/runtime/orchestration/runtime-builder.ts:882,919`).

It is injected **once per run** (`agent-runtime.ts:1828`) and re-injected **only
when a turn ends with zero tool calls** (`agent-runtime.ts:1959`). A mid-run
compaction ends no run, so the obligation is never re-emitted. It is persisted in
the canonical transcript as a `user`-role message with `metadata.userRunSpan = 0`
— distinguishable from user turns by the **existing** production classifier.

The `userRunSpan: 0` classification is directly observable in the capture:
idx 0 and idx 26 have no `userRunSpan` (user turn starts); idx 1 and idx 27 have
`userRunSpan: 0` (runtime reminders).

### 1.5 Exact missing obligations

Missing from the 48-message provider-visible continuation:

1. **The terminal-completion obligation** — absent in every form, literal **and**
   semantic. This is the load-bearing loss.
2. **The read-only constraint** ("Do not modify any files") — absent as an
   instruction, though the summary reports "No files modified" as a *fact*.
3. **The verbatim user task text** — absent verbatim; the summary preserves its
   **meaning** ("Investigate what the Keycloak-based project does and explain
   its purpose, major subsystems, production behavior, deployment architecture,
   and local development workflow"), but not as an authoritative instruction.

The `submit_and_exit` **tool schema remained advertised** throughout. Tool
availability is not evidence that the instruction survived.

### 1.6 First boundary where each obligation disappears

| Obligation | First disappearance boundary | Mechanism |
|---|---|---|
| **Completion obligation** | **the summarizer output of attempt 1** — it was in attempt 1's input and absent from attempt 1's summary | **B — summary loss**, then made permanent by **A — input loss** |
| Read-only constraint | same attempt-1 summary | B — summary loss (semantic fact retained, instruction lost) |
| Verbatim task text | same attempt-1 summary | B — summary loss (semantics retained) |

**The precise mechanism.** At the first compaction the canonical transcript has
no prior `compaction_summary` message, so `findLatestSummaryIndex` returns `-1`
and the fold window is the whole 163-message prefix. The captured attempt-1
summarizer request (`cap_86d49c582868073a…1`) contains **all three** markers.

Attempt 1's **generated summary preserved the objective and the read-only
constraint semantically but omitted the completion obligation entirely** — the
2,848-byte `previousSummary` carried by attempt 2 contains "Keycloak" and the
task restatement, but **none** of the three literal markers.

From the **second** compaction onward, the runtime's `context.messages` is the
**projected** history (sidecar summary + canonical tail), so
`findLatestSummaryIndex` finds the projected summary at index 0 and
`newMessagesToFold = messagesToSummarize.slice(latestSummaryIndex + 1)`
(`agentic-compaction.ts:81-84`). Canonical indices 0 and 1 fall outside that
window, and the only remaining carrier is `previousSummary` — which never
contained the completion obligation. The captured summarizer requests for
attempts 2, 3, 4 and 5 contain **none** of the three markers. The loss is
therefore **permanent and self-reinforcing** from attempt 2 onward.

`previousSummary` identity chain (measured, and consistent with the parent
ACT's correction):

| Captured request | `previousSummary` | sha256(16) | bytes | identity |
|---|---|---|---|---|
| attempt 2 | attempt 1's output | `9a0e07c66bc5d8ae` | 2,848 | attempt 1 **applied** |
| attempt 3 | attempt 2's output | `2067582dd6652bbe` | 3,830 | attempt 2 **applied** |
| attempt 4 | **identical to attempt 3's** | `2067582dd6652bbe` | 3,830 | attempt 3 **DISCARDED** (the `compaction-skipped`) |
| attempt 5 | **byte-identical to the persisted sidecar summary** | `5356fee3e0c27a2b` | 1,890 | attempt 4 **applied + persisted** |

The persisted sidecar therefore holds **attempt 4's** summary (1,890 bytes), not
attempt 1's. The obligation was already absent from attempt 1's output, so every
descendant summary — including the persisted one — lacks it.

Mechanism classification (mandatory discriminator):

* **A — Input loss:** CONFIRMED for attempts 2–5 (the obligation was outside
  the fold window and absent from `previousSummary`).
* **B — Summary loss:** CONFIRMED at attempt 1 (the obligation was available to
  the summarizer and absent from its result).
* **C — Projection loss:** **REJECTED.** The projector is faithful — it
  propagates the loss with 0 orphaned tool results and byte-identical
  re-projection.
* **D — Authority substitution:** **SUPPORTED.** The obligation existed only as
  a run-scoped runtime message; once the run-scoped carrier was cut, nothing
  carried the authority forward.

**Response-side caveat:** the attempt-1 *response body* was never captured (only
request-stage captures exist). The claim "the summarizer omitted it" is
established from the **request-side boundary** (the obligation was in the
input) plus the **absence in the persisted summary and in every later
`previousSummary`**. The summarizer's internal reasoning is
`UNAVAILABLE_FROM_TRACE`.

Full 17-stage trace: `evidence/loss-boundary.tsv`.

### 1.7 Real RED reproduction results

`Harness`: `sdk/packages/core/src/session/models/zz-act-contract-recon-red.test.ts`
(disposable) — drives the **real** `projectSessionCompactionState` against the
**real** sidecar and **real** canonical transcript.

| Check | Result |
|---|---|
| RED-1 source integrity (conversation id, source count, source-prefix hash, boundary, last-message identity, successful projection) | **PASS** |
| RED-2 information loss (8 separate assertions) | **PASS** |
| RED-3 desired conservation property | **FAIL (the RED)** |
| Counts | original 207 → source prefix 163 → projected **48** (4 sidecar + 44 tail) |
| Tool-use/result pairing in the baseline projection | **0 orphans — intact** |
| Exit code | **1** |

Verdict: `RED REPRODUCED` — **not** `HALT_RED_NOT_REPRODUCED`, and the capture was
`CAPTURE_SUFFICIENT`.

Detail: `evidence/red-reproduction.txt`.

### 1.8 Candidate / ablation comparison

Candidate **C1 — existing-authority carry-forward**: reconstruct the contract
from the existing canonical history using the **existing** production authority
classifier (`isTurnStartMessage` / `getUserRunSpan`), and append it to the
**existing** `compaction_summary` message produced by the **existing**
`buildSummaryMessage`.

| Metric | A (baseline) | B (candidate) | C (negative control) |
|---|---|---|---|
| Active objective available | **NO** | **YES** | **NO** |
| Active completion obligation available | **NO** | **YES** | **NO** |
| Read-only constraint available | **NO** | **YES** | **NO** |
| Later amendments respected | n/a | **YES** (idx 26, user authority) | n/a |
| Tool pairing preserved | PASS (0 orphans) | PASS (0 orphans) | PASS (0 orphans) |
| Canonical history changed | NO | NO | NO |
| Added request tokens | 0 | **263** | 0 |
| Reference / persistence changes | NO | NO (7 sidecar keys unchanged) | NO |
| Provider-visible request valid | PASS | PASS | PASS |

A and C are byte-identical; B differs from them by **exactly** the candidate
carry-forward. The obligation's presence tracks that difference — the
carry-forward is **structurally necessary**.

Detail: `evidence/ablation.txt`.

### 1.9 Adversarial conservation results

**21 / 21 scenarios PASS, exit code 0.** All use small deterministic fixtures
with independently hand-authored expectations.

Objective retained · terminal instruction retained · read-only retained ·
later amendment retained (latest wins) · explicit cancellation not revived ·
multiple user turns · assistant plan **not** elevated · malicious file-read
instruction **not** promoted · malicious tool-output instruction **not**
promoted · long task with **no silent truncation** · multiple compactions with
**no duplication** · previous summary **not** re-promoted · session restoration
equivalent · history rollback follows restored history · hash-mismatch boundary
untouched · tool-only tail pairing unchanged · completed task gets **no
artificial** obligation · **no** invented terminal requirement · basic-path
scope limit recorded · no silent budget truncation · deterministic output.

Two honest limitations recorded:
* The basic-compaction path was **not** qualified — C1 is defined against the
  agentic path only, and no claim is made about it.
* Cancellation is carried as authoritative text with "most recent wins"
  ordering; C1 does not interpret cancellation semantics.

Detail: `evidence/adversarial-matrix.txt`.

### 1.10 Added prompt-token and runtime complexity costs

| Cost | Value |
|---|---|
| Added request bytes | **787** |
| Added estimated tokens | **263** (`ceil(bytes/3)`, the production estimator convention) |
| As a fraction of the 230,400-token effective ceiling | **~0.11 %** |
| As a fraction of the 103,440-token pre-compaction size | **~0.25 %** |
| Fixed-size truncation | **none** — source text is carried verbatim |

Production implementation cost (complexity discriminator):

| Dimension | Assessment |
|---|---|
| Production seams requiring modification | **1–2** — one pure transformation (new helper) + one call site in the agentic compaction path |
| Existing task record sufficient? | **Yes** — the canonical transcript plus the existing classifier; no new task record |
| New public protocol field | **No** |
| New persisted state | **No** — the sidecar keeps its 7 keys |
| Manual vs automatic compaction | the same agentic path; both covered by the one call site |
| Multi-compaction sessions | safe: the contract is reconstructed from the **original** canonical turn each time, so it does not duplicate (verified: each marker occurs exactly once) |
| Session restoration | equivalent (verified: id/ts regeneration does not change the contract) |
| Risk of stale / overridden instructions | **low** — "most recent wins" ordering; superseded instructions are carried as history, never as current |
| Risk of authority escalation | **low and bounded** — user text and runtime text are labelled in separate sections; assistant/tool/file content is never promoted (21/21 adversarial) |
| Second canonical task owner | **none created** |
| New persistent instruction registry | **none created** |
| General-purpose prompt-rewriting framework | **none required** |

This is squarely a "bounded pure transformation plus a small reuse of an
existing task-authority source". It is **not** a complexity-driven NO_GO.

### 1.11 Executed test / typecheck gates

| Gate | Result |
|---|---|
| Focused production compaction suites (13 files) | **275 / 275 passed**, exit 0 |
| Disposable loss-boundary harness | **9 / 9 passed**, exit 0 |
| Disposable C1 probe + ablation | **4 / 4 passed**, exit 0 |
| Disposable adversarial matrix | **21 / 21 passed**, exit 0 |
| Disposable RED harness | 1 failed / 4 passed, exit 1 — **the intentional RED** |
| All disposable probes together | 1 failed / 38 passed — **the intentional RED** |
| Focused typecheck (`bun tsc -p tsconfig.dev.json --noEmit`) | 40 **pre-existing** diagnostics, **0 ACT-owned**, **0** in the exercised production seams |
| `git diff --check` | no output, exit 0 |
| Worktree / stash | only 5 disposable untracked probe files; `stash@{0}` preserved |
| Live provider requests | **none** |
| Canonical persisted sessions modified | **none** |

Detail: `evidence/gates.txt`.

### 1.12 One bounded successor recommendation

> **ACT-CLINEMM-COMPACTION-TASK-CONTRACT-CONSERVATION-REPAIR01** — carry the
> active task contract forward across Agentic compaction using the **existing**
> canonical history and the **existing** authority classifier, through the
> **existing** `compaction_summary` message. No new persistence, no new
> protocol field, no second task owner, no canonical-history mutation.

**Exact RED for the successor** (must fail on the unmodified implementation and
pass after the repair):

1. `projectSessionCompactionState` over the real sidecar + real canonical
   transcript of `1794617111057_i279p` produces a 48-message projection whose
   **first** message carries, as an authoritative instruction:
   * the verbatim user task text from canonical idx 0,
   * the verbatim read-only constraint from canonical idx 0,
   * the verbatim runtime completion obligation from canonical idx 27,
   * the later user amendment from canonical idx 26,
   with **user** authority and **runtime** authority in separately labelled
   sections.
2. The same projection has **0 orphaned tool_result** blocks, and its messages
   `[1..47]` are byte-identical to the current baseline.
3. The persisted sidecar schema is unchanged (**7** keys) and the existing
   source-prefix-hash mismatch rejection still rejects.
4. The 21-scenario adversarial matrix passes unchanged (it already passes; the
   successor must keep it green while adding the historical-session assertion).

**Conservation contract** (the properties the repair must hold):

* the active objective, the mandatory read-only/scope constraints, the
  applicable completion requirement, later user amendments and explicit
  cancellations all remain available to the continuing agent;
* role/authority distinctions are preserved — user text, runtime text,
  assistant text, tool output and repository content are never merged;
* tool-use/result pairing, the compaction identity (`compaction_summary`
  metadata kind), the sidecar schema, the source-prefix hash and the
  restoration path are all unchanged;
* the overhead is bounded and **not** silently truncating (measured baseline:
  **787 bytes / 263 tokens** on the historical session);
* no tool is executed or re-executed, no progress is fabricated, no permanent
  system prompt is modified, and the entire original transcript is **not**
  reintroduced.

**Explicitly out of scope for the successor:** basic-compaction qualification
(unless separately scoped), behavioural claims about Flint's completion
behaviour, and any live benchmark.

---

## 2. Ownership map (OBSERVABLE / UNAVAILABLE_FROM_TRACE)

| # | Boundary | Production owner | Status |
|---|---|---|---|
| 1 | Where the original user task is stored | canonical transcript, `user` role, `metadata.userRunSpan` unset → `isTurnStartMessage === true` | **OBSERVABLE** |
| 2 | Which representation is canonical and durable | the canonical transcript (`*.messages.json`, append-only, 207 msgs) | **OBSERVABLE** |
| 3 | How user amendments / cancellations are represented | later `user` turn-start messages (idx 26) | **OBSERVABLE** |
| 4 | Where the completion obligation is established | `AgentRuntime.getCompletionToolReminderMessage` (`agent-runtime.ts:1726`), gated by `completionPolicy.requireCompletionTool` (`runtime-builder.ts:882,919`); emitted once per run (`agent-runtime.ts:1828`) | **OBSERVABLE** |
| 5 | Where the Agentic summarizer obtains its input | `serializeConversation(summaryInputBudget.messages)` → `buildSummaryRequest` (`agentic-compaction.ts:161-167`) | **OBSERVABLE** (request-side captured) |
| 6 | Where the compacted prefix is replaced | `runAgenticCompaction` → `result.messages = [summary, ...messages.slice(cutIndex)]` (`agentic-compaction.ts:227-235`) | **OBSERVABLE** |
| 7 | Where summary and tail are assembled | `buildSummaryMessage` + `messages.slice(cutIndex)` (`agentic-compaction.ts:227-235`) | **OBSERVABLE** |
| 8 | Where the sidecar is persisted | `createSessionCompactionState` (`session-compaction.ts:140`) via `createCompactionStateAwarePrepareTurn` (`compaction.ts:929,952`) | **OBSERVABLE** |
| 9 | How the sidecar is restored | `projectSessionCompactionState` (`session-compaction.ts:168`), used by `compaction.ts:913` and `local-runtime-host.ts:2150,2174` | **OBSERVABLE** |
| 10 | Which messages/instructions the model receives after compaction | the 48-message projection → `MessageBuilder.buildForApi` → the captured 3-message provider request | **OBSERVABLE** |
| — | The attempt-1 summarizer **response body** | not captured on disk (only request-stage captures exist) | **UNAVAILABLE_FROM_TRACE** |
| — | The summarizer's internal reasoning about why it omitted the obligation | no observable surface | **UNAVAILABLE_FROM_TRACE** |
| — | The route by which compaction was initiated in this run | the parent's trigger-accounting correction left this open; **not reopened** by this ACT | **UNAVAILABLE_FROM_TRACE** (out of scope) |
| — | Flint's internal decision process | not observable; **not inferred** | **UNAVAILABLE_FROM_TRACE** |

---

## 3. Existing durable-authority reconnaissance

| Candidate | Authoritative | Durable | Current | Safe | Bounded | Available | Compatible | Verdict |
|---|---|---|---|---|---|---|---|---|
| Canonical first user turn | YES | YES | YES | YES | YES | YES | YES | **VIABLE — primary source** |
| Canonical runtime reminder (idx 27) | YES (runtime) | YES | YES | YES | YES | YES | YES | **VIABLE — completion obligation** |
| User-run classifier (`isTurnStartMessage`, `getUserRunSpan`) | n/a | n/a | YES | YES | YES | YES | YES | **VIABLE — authority separator** |
| Session manifest `prompt` | PARTIAL | NO | n/a | n/a | NO | NO | NO | rejected — first prompt only; no amendments; not at the compaction seam |
| Session manifest (other fields) | NO | NO | n/a | n/a | YES | YES | NO | rejected — status/provider/model/cwd only |
| Active task configuration | YES | n/a | n/a | n/a | NO | NO | NO | rejected — not persisted at the compaction seam |
| Existing system prompt | NO | n/a | n/a | n/a | YES | YES | NO | rejected — measured to contain no task contract |
| Previous compaction summary | NO | YES | PARTIAL | YES | YES | YES | YES | rejected as an authority source — it is precisely what propagated the loss |
| Compaction sidecar `messages` | NO | YES | PARTIAL | n/a | YES | YES | NO | rejected — holds the lossy summary |
| Canonical transcript (whole) | NO | YES | YES | YES | **NO** | YES | YES | rejected — too large; used only via the classifier |

**Key design question answered:** *Can the active task contract be reconstructed
from existing canonical sources at compaction time without introducing a new
source of truth?* — **YES.** The canonical transcript is durable, the authority
classifier already exists in production, and the reconstruction is a pure
transformation over existing data. No new source of truth is needed.

---

## 4. Alternative explanations (independent evaluation)

| Hypothesis | Verdict | Basis |
|---|---|---|
| **H1** the summarizer omitted an available obligation | **SUPPORTED** | attempt-1 summarizer **request** contained the obligation (captured); the persisted summary and every later `previousSummary` lack it. Response body uncaptured → the omission is established at the request/output boundary, not by reading the model's reasoning. |
| **H2** the summarizer never received the obligation | **SUPPORTED for attempts 2–5; REJECTED for attempt 1** | attempts 2–5 captured requests contain none of the three markers; attempt 1's request contains all three. |
| **H3** the compaction projector removed a preserved obligation | **REJECTED** | the projector propagates the loss faithfully: 0 orphans, byte-identical re-projection, the summary it receives already lacks the obligation. |
| **H4** no durable task-authority source exists | **REJECTED** | the canonical transcript is durable and the authority classifier is already in production; C1 reconstructs the contract from them with 0 new state. |
| **H5** the contract was lost but Flint's behaviour was independent | **NOT EXCLUDED — remains open** | the contract loss is proven; no behavioural discriminator was executed (none is authorized). The run was user-aborted with no terminal completion. |
| **H6** Flint had sufficient instructions and chose continued investigation | **NOT ESTABLISHED** | the prior ACT's basis for H6 was withdrawn when the tail-carrier evidence was refuted. The post-compaction request is now shown to lack the obligation, so H6 is no longer supported as stated. |
| **H7** truncated summarizer output caused the loss | **NOT THE CAUSE OF THE CONTRACT LOSS** | two attempts finished at the 8,192-token cap and were accepted; attempt 1 (which produced the persisted summary) carried the obligation in its input regardless. Truncation is a separate, out-of-scope concern. |

**The causal distinction is preserved.** PROVEN: a required instruction
disappeared from the captured provider-visible continuation. NOT PROVEN: that
this disappearance caused Flint's subsequent refusal or failure to finish.

---

## 5. Model-comprehension limitation

This ACT executed **no live provider request**. The offline probe establishes
exact message preservation, instruction provenance, provider-request structure,
compaction-budget impact, deterministic projection and correct restoration.

It does **not** establish, and does not claim:

* whether Flint interprets the preserved instruction correctly;
* whether Flint chooses `submit_and_exit`;
* whether the task finishes faster;
* whether answer quality changes;
* whether local inference latency improves.

These remain `NOT_EXECUTED` / `INFERRED` and belong to a later behavioural
qualification.

---

## 6. Evidence artifacts

```
docs/acts/ACT-CLINEMM-COMPACTION-TASK-CONTRACT-CONSERVATION-RECON01/
├── REPORT.md                        this document
└── evidence/
    ├── identity.txt                 repository / runtime / artefact identity, hashes
    ├── contract-sources.tsv         the extracted contract: index, role, authority, source hash
    ├── red-reproduction.txt         RED-1 / RED-2 / RED-3, counts, pairing, exit code
    ├── loss-boundary.tsv            the 17-stage trace with OBSERVABLE classifications
    ├── candidate-probe.txt          C1 design, size, identity, durable-authority recon
    ├── adversarial-matrix.txt       21 scenarios, results, limitations
    ├── ablation.txt                 A / B / C metrics and structural-necessity analysis
    └── gates.txt                    every executed command, result and exit status
```

No raw transcript, complete provider request, credential, private source file,
unredacted system prompt or sensitive tool output is committed. Evidence carries
only structural indices, source roles, redacted excerpts, SHA-256 hashes, byte
and token counts, commands and exit statuses. The raw material remains in the
existing operator-local protected locations (`~/Downloads`, `~/.cline-data/…`).

---

## 7. Repository protection

No push. No PR. No stash manipulation — `stash@{0}` preserved verbatim. No
production TypeScript modified. No dependency update. No installed-extension
change. No summarizer configuration change. No context-ceiling tuning. No
task-header work. No new session persistence format. No permanent task-contract
registry. No second canonical state owner. No prompt-injection authority
promotion. No React updater side effects. No telemetry subsystem. No broad test
cleanup. No speculative causality claim. No live Flint/Kapitsa run. No new
persistence or telemetry subsystem.

The five disposable probe files are removed after evidence capture, so no
failing RED test is left in the normal suite and **ACT-owned diagnostics = 0**.
