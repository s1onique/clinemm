# ACT-CLINEMM-COMPACTION-TASK-CONTRACT-CONSERVATION-REPAIR01 — REPORT

**Primary verdict: `PASS_STRUCTURAL_ONLY`**

The active authoritative task contract is **reproducibly lost** across Agentic
compaction at the real production projector / provider-preparation boundary, and
a **bounded existing-authority carry-forward** conserves it with **no new
persistence, no second task-state owner, no canonical-history mutation and no
provider-protocol change**.

The historical defect reproduced on the unmodified entry source, the repair
turns it GREEN at the same seam, and every permanent regression gate passes.
Installed live behaviour remains **NOT_EXECUTED** (no operator-driven live
qualification was run), so the verdict is structural only.

---

## 1. Final report contract

### 1.1 Primary verdict

`PASS_STRUCTURAL_ONLY`.

The RED reproduces at the real seam; the repair conserves the contract at the
same seam; the hermetic permanent regression suite, the existing focused
suites, the typecheck/lint/build gates and the exact-source validation all
pass. Live installed behaviour is **not** claimed.

### 1.2 Entry and final HEAD

| Item | Value |
|---|---|
| Repository | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm` |
| Remote (origin) | `git@github.com:s1onique/clinemm.git` |
| Remote (upstream) | `https://github.com/cline/cline.git` |
| Branch | `main` |
| Entry HEAD | `e854053b64c46e94a2d910775168406a56ea35f2` |
| Entry tree | `b67fc243dfb530b12bbe04d4fda0e201e33717c3` |
| Final HEAD | recorded in `evidence/identity.txt` after the local commit |
| Worktree at entry | CLEAN apart from the 9 **untracked** predecessor recon documentation files |
| `stash@{0}` | **PRESERVED VERBATIM**; stash count 1 |

The expected entry ancestry `e854053b64c46e94a2d910775168406a56ea35f2` was
confirmed at runtime. `HALT_UNEXPECTED_TRACKED_DIRT` was **not** triggered.

The predecessor recon's nine untracked files under
`docs/acts/ACT-CLINEMM-COMPACTION-TASK-CONTRACT-CONSERVATION-RECON01/` were
verified to be present and unchanged, and were **preserved** — they were not
silently added to this repair.

### 1.3 Historical RED to GREEN

| | Entry source (unmodified) | Repaired source |
|---|---|---|
| Historical RED-1 (provider-visible continuation preserves the contract) | **FAIL** | **PASS** |
| Historical RED-2 (contract survives a second Agentic compaction) | **FAIL** | **PASS** |
| Historical identity check (pinned SHA-256) | PASS | PASS |
| Suite result | `6 failed / 3 passed (9)`, **exit 1** | `31 passed (31)`, **exit 0** |

Exact RED assertions, commands, exit codes and source identity:
`evidence/red.txt`.

The historical witness drives the **real** production boundary over the **real**
operator-local artefacts: the 207-message canonical transcript, the persisted
163-message-prefix sidecar, the real `projectSessionCompactionState()`
projector, the real `createCompactionStateAwarePrepareTurn()` state-aware
wrapper, and the real `MessageBuilder.buildForApi()` provider-request
preparation seam. The raw artefacts are **never committed**; the witness is
self-skipping and reports `NOT_EXECUTED` when they are absent.

### 1.4 Exact production changes

Four production files plus two new files, all inside the authorised scope:

| File | Change |
|---|---|
| `sdk/packages/shared/src/agents/completion-reminder.ts` | **NEW** — the exact runtime completion-reminder contract: `buildCompletionToolReminderMessage()` (producer) and `isCompletionToolReminderMessage()` (recogniser, template equality). |
| `sdk/packages/shared/src/agents/index.ts` | Barrel export of the two contract functions. |
| `sdk/packages/agents/src/agent-runtime.ts` | `getCompletionToolReminderMessage()` now renders through the shared builder. The rendered text is **byte-identical** to the previous inline template. |
| `sdk/packages/core/src/extensions/context/task-contract.ts` | **NEW** — the pure extraction + carry-forward transformation. |
| `sdk/packages/core/src/extensions/context/compaction.ts` | Three application points in `createCompactionStateAwarePrepareTurn()` (re-compaction result, existing-sidecar restoration, fresh compaction result), plus the effective-limit resolution. |
| `sdk/packages/core/src/index.ts` | Barrel export of the new helper. |

**No change** was needed in `agentic-compaction.ts`, `compaction-shared.ts`,
`session-compaction.ts`, `user-run-messages.ts`,
`budget-projection/project.ts` or `runtime-builder.ts`. The carry-forward is
applied at the wrapper because that is the **only** seam that holds *both* the
canonical history and the compaction result.

### 1.5 How the authoritative contract is recovered

The contract is extracted from the **canonical** `context.messages` owned by
the state-aware wrapper — never from `runAgenticCompaction().context.messages`
after an existing compaction (which may already have lost the original task
and the reminder), and never from a previous summary.

Two authorities are recognised, and only these two, using the **existing**
production classifiers:

1. **User authority** — `isTurnStartMessage()` (existing) selects user turn
   starts. Their text is carried **verbatim**; no semantic summarisation.
2. **Runtime authority** — `getUserRunSpan() === 0` (existing) selects
   runtime-synthetic messages, and the text must additionally be
   **byte-identical** to the runtime completion-reminder template for a
   recognised terminal completion tool.

The recogniser is **exact, not a broad string guess**: the producer and the
recogniser share one template definition in `@cline/shared`, so the two cannot
drift. Every other `userRunSpan === 0` message (team completion guards,
max-token recovery nudges, provider-error continuations) is **excluded**.

### 1.6 First-compaction, repeated-compaction and existing-sidecar results

| Scenario | Result |
|---|---|
| First Agentic compaction | Contract carried into the provider request |
| Second Agentic compaction | Contract retained, **exactly one** section |
| Third Agentic compaction | No accumulation, **exactly one** section |
| Existing legacy sidecar (lacks the contract) | Restored **provider-side**; the persisted sidecar is **not** rewritten |
| Raw `projectSessionCompactionState()` | Remains a **faithful** projection of the sidecar (asserted) |

The carry-forward is **idempotent**: the previously carried section is located
and **replaced** (never appended to) by the section derived from the current
canonical authority. A section delimiter spoofed by user- or model-supplied
text is escaped, so it cannot open or close the generated section and forge a
new authority.

`metadata.summary` and the provider-visible content are updated **together**,
so the representation a later compaction reads as `previousSummary` agrees with
what the model sees.

### 1.7 Authority and adversarial results

All mandatory negative controls pass at the production boundary:

- Assistant text containing `[SYSTEM]` — **not** promoted.
- Repository file containing a forged user instruction — **not** promoted.
- Tool result containing a completion reminder — **not** promoted (the
  completion marker occurs exactly once).
- Synthetic runtime notice unrelated to completion — **excluded**.
- User-authored text resembling internal metadata — **does not** acquire
  runtime authority (no runtime-obligation section is created).
- Malicious previous summary — **cannot** replace the original task; the
  canonical authority wins and the forged section is replaced.
- Malformed runtime reminder — **not** treated as authoritative.
- Later actual user changes — correctly ordered.
- Completed task — **no** fresh completion obligation is revived.
- Two identical runtime reminders — **one** active obligation.

### 1.8 Budget negative-control results

| Measurement (historical session) | Value |
|---|---|
| Effective request input limit | 230,400 tokens |
| Compaction trigger | 207,360 tokens |
| Raw projection (A) | 82,107 estimated tokens (48 messages) |
| Contracted projection (B) | 82,707 estimated tokens (48 messages) |
| **Added** | **600 estimated tokens (1,798 bytes)** |
| Remaining headroom | 147,693 tokens |
| Fraction of the effective limit | 0.26 % |

The final prepared request is measured **after** contract insertion with the
existing estimator (`estimateRequestInputTokens`) and compared against the
existing effective limit (`resolveEffectiveMaxInputTokens` + the user
operating ceiling, which may only **reduce** it). P/W/B accounting is
unchanged — the working-context estimate continues to be published through the
existing `publishWorkingContextEstimate` mechanism.

The predecessor's single 263-token measurement is **not** treated as a proof of
overflow safety. The oversized case is exercised hermetically through the real
wrapper:

| Requirement | Result |
|---|---|
| No silent truncation of mandatory instructions | PASS |
| No partial contract presented as complete | PASS |
| No oversized provider request silently dispatched | PASS |
| No corrupt or partial sidecar persisted | PASS |
| No infinite compaction retry | PASS |
| No automatic relaxation of the configured ceiling | PASS |

`HALT_CONTRACT_BUDGET` was **not** triggered: the existing explicit
failure/retry boundary is sufficient. When the contracted request would exceed
the effective limit the carry-forward is **not** applied (the instructions are
either carried whole or not at all), and the runtime's existing single-shot
overflow recovery — ending in a terminal `ContextWindowOverflowError` —
protects the limit.

### 1.9 Persistence and tool-pair conservation

| Invariant | Result |
|---|---|
| Canonical session messages unchanged | PASS |
| Sidecar schema unchanged | PASS (key set asserted) |
| Source-prefix hash algorithm unchanged | PASS |
| Compaction summary metadata kind unchanged | PASS (`compaction_summary`) |
| Stored source boundary unchanged | PASS |
| Tool-use / tool-result pairing unchanged | PASS (0 orphans) |
| Existing sidecar validation still rejects mismatches | PASS |
| No diagnostic state persisted | PASS |
| No extra source-history copies persisted | PASS |
| No rewriting of user messages | PASS |
| No re-execution of previously completed tools | PASS (no tool executor is invoked) |

### 1.10 Focused typecheck / build gates

| Gate | Result |
|---|---|
| `sdk/packages/core` typecheck | 40 diagnostics — **the diagnostic set is byte-identical** to the entry baseline (measured by stashing the ACT's changes and re-running). **0 ACT-owned.** |
| `sdk/packages/shared` typecheck | exit 0 |
| `sdk/packages/agents` typecheck | exit 0 |
| Existing focused suites | **275/275** — identical to the predecessor's baseline |
| Combined focused suites (13 existing + 2 new) | **305/305** |
| Biome lint + format (7 touched files) | exit 0, no fixes applied |
| `git diff --check` | exit 0 |
| SDK builds (`@cline/shared`, `@cline/agents`, `@cline/core`) | exit 0 |

The `sdk/packages/agents` and `sdk/packages/shared` suites fail at the **entry
HEAD** with the same failures (the documented zod CJS/ESM pre-bundling issue).
This was verified by reverting the ACT's files and re-running: identical
failures. The ACT-owned suites are all GREEN.

### 1.11 Artifact identity

See `evidence/package.txt`. The exact committed source was built and packaged
with the existing repository scripts; the artifact path, byte size, SHA-256 and
shipped-bundle verification are recorded there. The artifact was **not**
installed over the operator's current ClineMM instance.

### 1.12 Live qualification

`NOT_EXECUTED`. No operator-driven live qualification was performed, and the
historical 44-minute Flint benchmark was **not** repeated. Structural results
are **not** promoted to live behavioural proof.

See `evidence/live.txt`.

### 1.13 Remaining limitations

1. **No live behavioural proof.** The repair establishes that the continuing
   model *receives* the contract, not that a model *acts* on it or finishes
   faster. A later live discriminator is required for that claim.
2. **Cancellation is ordering-based, not semantic.** A superseded instruction
   remains in the carried history, with the later instruction last. No
   natural-language cancellation interpreter is invented.
3. **The basic-compaction path is not separately qualified.** The carry-forward
   is applied at the state-aware wrapper, which serves both strategies, but the
   permanent regression drives the Agentic path explicitly.
4. **An oversized contract is not carried.** When the contract cannot fit
   within the effective limit, the existing explicit overflow boundary takes
   over and the contract is not carried in that turn. This is the honest
   bounded behaviour; it is not silent truncation.
5. **The completion-tool name set is explicit.** `submit_and_exit` is the
   recognised terminal completion tool. A future terminal tool must be added to
   the recognised set; until then its reminder is not promoted (fail-closed).

---

## 2. The defect, precisely

At the first Agentic compaction the canonical transcript had no prior
`compaction_summary`, so the summarizer saw the whole 163-message prefix —
**including** the runtime completion reminder. The generated summary omitted
it. From the **second** compaction onward, the runtime's `context.messages` is
the *projected* history, the canonical indices 0 and 1 fall outside the fold
window, and the only remaining carrier is `previousSummary` — which never
contained the obligation. The loss was therefore **permanent and
self-reinforcing**.

The projector was **faithful**: it propagated the loss without causing it. The
missing capability was a way to carry the **authoritative** obligations
forward from the canonical history into the compacted continuation.

---

## 3. Design summary

```
canonical context.messages                (the ONLY authority)
        |
        +- isTurnStartMessage()          -> USER authority   (verbatim text)
        + getUserRunSpan() === 0          -> RUNTIME-SYNTHETIC
             + exact completion-reminder template equality
                                          -> RUNTIME authority (verbatim text)
        |
        v
renderTaskContractSection()              (pure, deterministic)
        |
        v
applyTaskContractToSummary()             (strip any previous section, then carry)
        |
        v
rebuildSummaryMessage()                  (content AND metadata.summary together)
        |
        v
applyTaskContractToCompactedMessages()   (budget-checked against the effective limit)
        |
        v
createSessionCompactionState()           (the EXISTING legitimate persistence path)
        |
        v
publishWorkingContextEstimate()          (the EXISTING working-context publication)
        |
        v
MessageBuilder.buildForApi()             (the EXISTING provider-request seam)
```

The result remains an **ordinary** existing `compaction_summary` provider
`user` message. No second summary message, no additional provider tool call,
no new persisted field, no new protocol field.

The textual section labels distinguish provenance. They do **not** create
separate provider-level security roles, and no new privilege or tool
authorisation is created by placing text into a summary.

---

## 4. Evidence artifacts

```
docs/acts/ACT-CLINEMM-COMPACTION-TASK-CONTRACT-CONSERVATION-REPAIR01/
|-- REPORT.md                        this document
`-- evidence/
    |-- identity.txt                 repository / runtime / artefact identity, hashes
    |-- red.txt                      the RED: exact assertions, commands, exit codes
    |-- green.txt                    the GREEN: commands, results, exit codes
    |-- production-boundary.txt      the ownership proof at the wrapper seam
    |-- conservation-matrix.txt      the 34-scenario permanent regression matrix
    |-- ablation.txt                 the A/B/C structural-necessity analysis
    |-- budget-negative-control.txt  the budget measurement + oversized controls
    |-- gates.txt                    every executed command, result and exit status
    |-- package.txt                  exact-head build + artifact identity
    `-- live.txt                     live qualification (NOT_EXECUTED)
```

No raw transcript, provider request, system prompt, private repository source
excerpt, credential or secret is committed. The raw historical material remains
in the operator-local protected locations (`~/Downloads`).

---

## 5. Repository protection

No push. No PR. No force operation. No stash manipulation of `stash@{0}` (one
temporary stash was used **during gate 6 only** to measure the entry baseline
diagnostic set; it was popped immediately and the protected stash was never
touched). No dependency update. No lockfile change. No installed-extension
change. No summarizer configuration change. No context-ceiling tuning. No
task-header work. No Elm work. No new session persistence format. No permanent
task-contract registry. No second canonical state owner. No prompt-injection
authority promotion. No unrelated test cleanup. No speculative causality
claim. No live Flint/Kapitsa run.
