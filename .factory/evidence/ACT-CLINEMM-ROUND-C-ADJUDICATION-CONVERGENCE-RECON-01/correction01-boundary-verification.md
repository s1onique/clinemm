# CORRECTION01 — boundary verification of the Round C adjudication-convergence recon

**Applies to:** `ACT-CLINEMM-ROUND-C-ADJUDICATION-CONVERGENCE-RECON-01`
**Type:** bounded evidence correction. **No production changes.** **No new ACT authorised here.**
**Verdict change:** `PASS_RECON_BOUNDARY_CLASSIFIED` (narrowed retroactively), with
`NEXT_ACTION` changed from **C** to **A**.

---

## 0. Summary of the review outcome

The reviewer raised three load-bearing findings. **All three were verified against the
frozen evidence and all three were upheld.** Two of them change the causal conclusion
and the successor decision.

| Reviewer finding | Disposition | Effect on the conclusion |
|---|---|---|
| **P0-1** — the R4 adjudication-loss claim used post-compaction evidence (idx 148/194) | **UPHELD (citation wrong, substance right)** | The pre-boundary witness is canonical **idx 124**. H2 for 62→63 is re-proven on the correct witness. 36→37 stays `ADJUDICATION_NOT_YET_ESTABLISHED`. |
| **P0-2** — the summarizer never saw the stdout; the "outputs omitted" assertion was truthful | **UPHELD (substantive error in the original report)** | The original report's characterisation of the summary assertion as "false" is **withdrawn**. The evidence loss is re-classified at the **serializer boundary**, not the summarizer's truthfulness. The successor recommendation to "suppress the false Blocked assertion" is **withdrawn**. |
| **P0-3** — `NEXT_ACTION: C` ignores the R3/R7/R8 verdict losses | **UPHELD** | **Option A is now justified.** Three previously-established verdicts were demonstrably lost at a compaction boundary. |
| **H5 correction** — most cited H5 indices exceed the first cutoff | **UPHELD** | H5 is reclassified **`SUPPORTED` → `INDETERMINATE`**. |

---

## 1. P0-1 — chronology of the H2 witnesses

### 1.1 The defect

The original report cited **canonical idx 148** ("canonical idx 148 thinking; restated
and sharpened at idx 194") as the pre-compaction witness for the R4 narrowing, in
`causal-discriminators.md` §2 and `adjudication-state-matrix.md` §4.

Both indices are **after** the 62→63 boundary (canonical 0..125). Citing them as
pre-compaction evidence is chronologically impossible.

### 1.2 The correction

The R4 narrowing reasoning exists in the canonical record at **canonical idx 124**,
which is **inside** the 62→63 covered prefix (0..125). Verbatim from the canonical
`thinking` block at idx 124:

> "…So the bake is preserved across startup re-builds. That's a **strong falsification
> of the 'mixed build/drift' mechanism**, at least for the freemarker case."

and, in the same block:

> "So startup.sh's build + `start --optimized` = documented pattern… the build at
> startup is **redundant work, but not drift-prone**. **Revised severity maybe 2/5.**"

Measured on the canonical prefix 0..125:

| Probe | Occurrences in canonical 0..125 | Source index |
|---|---|---|
| `falsification of the` | 1 | idx 124 |
| `mixed build/drift` | 1 | idx 124 |
| `bake is preserved` | 1 | idx 124 |

### 1.3 Corrected H2 status

| Boundary | Pre-boundary adjudication state | H2 limb | Status |
|---|---|---|---|
| **36→37** (prefix 0..73) | **none** — the model's own words at idx 72: "Now I need authoritative upstream docs: 1. Keycloak `kc.sh build` semantics: does running build at startup cause drift / is it required?" | decision limb: **not met** (no decision existed) | **`ADJUDICATION_NOT_YET_ESTABLISHED`** — unchanged |
| **62→63** (prefix 0..125) | **a bounded, source-grounded narrowing of the R4 claim at idx 124**: the "mixed build/drift" mechanism is falsified at least for the freemarker case; revised severity ≈ 2/5; the mechanism is "redundant work, but not drift-prone" | decision limb: **met** (a supported narrowing with a mechanism and a revision) | **`SUPPORTED`** — re-proven on idx 124 |

**H2's counterexample at 62→63 now satisfies all four G7 conditions on
chronologically valid witnesses:**

| G7 condition | Met? | Corrected evidence |
|---|---|---|
| 1. A source-supported R4 adjudication existed before compaction | **YES** | canonical idx 124 (inside 0..125): the "mixed build/drift" mechanism falsified for the freemarker case, revised severity ≈ 2/5 |
| 2. The summary/continuation omitted it | **YES** | 0 occurrences of `falsification of the`, `mixed build/drift`, `bake is preserved`, the docs quote and `PersistedConfigSource` in the 62→63 summary |
| 3. The model subsequently re-investigated the same uncertainty | **YES** | canonical idx 146 re-reads `startup.sh`; idx 148 re-greps `PersistedConfigSource` (10 → 0 occurrences across the boundary) |
| 4. No intervening source change justified reopening | **YES** | HEAD `42de653b…` and a clean tree observed identically at canonical idx 3, 75, 155 |

### 1.4 What did **not** change

- The 36→37 boundary remains `ADJUDICATION_NOT_YET_ESTABLISHED`.
- The model **never** formed a terminal R4 verdict in 196 messages (0 verdict-shaped
  statements). The item lost at 62→63 is a **supported narrowing**, not a final verdict.
- The `cat startup.sh` boundary-alignment finding (indices **6, 74, 146**) is unaffected
  and re-verified.

---

## 2. P0-2 — the transformation boundary: two distinct requests

### 2.1 The defect

The original report stated that the summaries' `## Blocked` assertion
("Tool outputs are omitted in the transcript") was **false**, because the tool outputs
were present in the canonical history and in the captured pre-compaction provider

### 2.2 The corrected production sequence

`REAL_PRODUCTION_SEAM` — the agentic compaction path in
`sdk/packages/core/src/extensions/context/agentic-compaction.ts`:

```
summaryInputBudget.messages
  → serializeConversation(summaryInputBudget.messages)      compaction-shared.ts:438
    → serializeMessage(message)                             compaction-shared.ts:387
      → flattenToolResultContent(block.content, block.name) compaction-shared.ts:344
        → renderToolResultBlocks(...)                       compaction-shared.ts:308
          → renderStructuredToolPayload(...)                compaction-shared.ts:258
              → string stdout  ⇒  "[result omitted]"
  → buildSummaryRequest({previousSummary, conversationText, fileOps})
  → generateSummary({systemPrompt, request})                summary-generation.ts:4
      → handler.createMessage(systemPrompt, [{role:"user", content: request}])
```

`generateSummary()` goes through the **same provider handler** as the main model, so
**both** requests are captured by `provider-request-capture` when capture is enabled.

### 2.3 The decisive captured artifact — the ACTUAL summarizer requests

The summarizer requests for this session are captured at
`~/.vscodium-roz/cline-data/provider-request-captures/`, run id
**`cap_41f75c5386d5db78`** (7 files, `cap_41f75c5386d5db78.ai_sdk_prompt.{1..7}.provider-request.json`).

Each has `payload.system` = *"Summarize the provided coding session into a concise
continuation note with detailed next steps."* — the agentic summarizer's system prompt,
distinct from the main model's.

| # | timestamp | `[result omitted]` markers in the summarizer's conversation text | occurrences of `/opt/keycloak/bin/kc.sh build` |
|---|---|---|---|
| 1 | 2026-11-22T22:09:27.030Z | 79 | **0** |
| 2 | 2026-11-22T22:21:01.859Z | 70 | **0** |
| 3 | 2026-11-22T22:42:42.417Z | 46 | **0** |
| 4 | 2026-11-22T22:55:35.700Z | 52 | **0** |
| 5 | 2026-11-23T01:02:12.706Z | 34 | **0** |
| 6 | 2026-11-23T01:14:57.428Z | 34 | **0** |
| 7 | 2026-11-23T01:32:30.273Z | 32 | **0** |

A verbatim excerpt from the captured summarizer request #1's conversation text:

```
[Bot tool calls]: run_commands(commands=["cd …/keycloak && grep -rn 'mvn test\|mvn -.*test\|surefire' …"])

[Tool result]: [succeeded] #1: [result omitted]
[succeeded] #2: [result omitted]
[succeeded] #3: [result omitted]
[succeeded] #4: [result omitted]
```

**This is the decisive P0-2 evidence and it is `REAL`:**

1. The summarizer **never** received the stdout of any `run_commands` call — 32 to 79
   `[result omitted]` markers per request, and **zero** occurrences of the R4 witness
   fact in any of the 7 requests.

### 2.5 Corrected classification

| | Original report | CORRECTION01 |
|---|---|---|
| Where the stdout is lost | "the summarizer's input" (implied the main request was equivalent) | **the serializer boundary**: `renderStructuredToolPayload()` renders a string `run_commands` stdout as `[result omitted]` before the summarizer request is built |
| Is the `Blocked` assertion false? | claimed **YES** | **NO — it is truthful about the summarizer's own input.** The claim that it was false **is withdrawn**. |
| Is the summarizer's request available? | not recovered | **RECOVERED** — `cap_41f75c5386d5db78`, 7 requests, private, not committed |
| Successor action "suppress the false `Blocked` assertion" | recommended | **WITHDRAWN.** The reviewer is right: suppressing it could make the summarizer less truthful without recovering any evidence. |

**The load-bearing conclusion is UNCHANGED and is now better grounded:** important R4
source evidence was present in the canonical record and in the main-model request, and
was **absent from the summarizer's input**, and therefore absent from the generated
summary. The loss is real; its *mechanism* is the serializer, not the summarizer's
truthfulness.

---

## 3. P0-3 — R3 / R7 / R8: previously established decisions that were lost

This is the most consequential correction. Measured against the exact covered prefixes:

| Finding | Verdict formed (canonical) | Verdict phrase | In canonical 0..73 | In 36→37 summary | In 62→63 summary |
|---|---|---|---|---|---|
| **R8** | idx 28 | `R8's claim of committed bootstrap admin creds is CONFIRMED as an observation` | **1** | **0** | **0** |
| **R7** | idx 40 | `R7 verdict: CONFIRMED (observation-level) but severity may be narrowed` | **1** | **0** | **0** |
| **R3** | idx 64 | `R3 is NARROWED: the risk is a manual process with a comment, no automated enforcement (true)` | **1** | **0** | **0** |
| R4 | never | — | 0 | 0 | 0 |
| R1 | idx 144 (**post** the last boundary) | `R1 CONFIRMED` | 0 | 0 | 0 |

Supporting evidence specific to each verdict is also lost:

| Evidence marker | canonical 0..73 | 36→37 summary | 62→63 summary |
|---|---|---|---|
| `KC_BOOTSTRAP_ADMIN` (R8's object) | 8 | 0 | 0 |
| `quay.io/keycloak/keycloak:26.0.7` (R1's object) | 12 | 0 | 0 |
| `396` (R3's pool arithmetic) | 6 | 1 | 1 |

**Three previously established, source-grounded decisions — all formed inside the
36→37 covered prefix — are absent from the 36→37 summary, and remain absent from the
62→63 summary.** They are gone from the continuing model context for the remainder of
the session.


---

## 4. H5 — reclassified to `INDETERMINATE`

The original report claimed the H5 witnesses occurred "before any compaction". That is
wrong. Exact timing against the first cutoff (canonical idx 73):

| Witness class | Cited indices | PRE-73 | POST-73 |
|---|---|---|---|
| Java-test counts | 36, 114, 116, 154 | **1** (idx 36) | 3 |
| `helm template` renders | 16, 18, 20, 32, 102, 104, 142, 176, 186 | **5** | 4 |
| `tar … keycloakx-7.0.1.tgz` | 28, 134, 136, 138, 140, 170 | **1** | 5 |

**Most of the cited redundancy is post-boundary.** And on inspection the post-boundary
instances are not redundant:

- idx 114 / 116 / 154 are **necessary re-verification of R7 after its verdict was lost**
  (see §3). Each corrected a *different* prior count (73 → 43 → precise), and idx 154
  explicitly re-lists R7 as outstanding. A finding whose verdict was erased has to be
  re-verified; that is the defect under study, not an independent convergence failure.
- The `helm template` renders addressed **different sub-questions** (image line,
  replicas, pool, NetworkPolicy/PDB, sed line range), not the same question twice.
- The `tar` attempts included **explicit error recovery** — the model diagnosed its own
  failure ("tar extraction failed because the tgz path… Let me retry").

**What remains real:** the session did not converge — no verdict matrix, no terminal
tool call, 5 findings still open at the final turn. But that is an **outcome**, and the
original report's evidence does not establish its **cause**. A general model
convergence defect is one candidate explanation; loss of adjudication is another, and
the latter is now demonstrated (§3).

**Corrected status: `INDETERMINATE`.** The absence of terminal completion is `REAL`;
the general-convergence-defect hypothesis is not established.

---

## 5. Corrected hypothesis summary

| Hypothesis | Original | Corrected | Basis |
|---|---|---|---|
| **H1 — source evidence lost** | `SUPPORTED` | **`SUPPORTED`** (mechanism refined) | Loss is at the **serializer** boundary (`renderStructuredToolPayload` → `[result omitted]`), confirmed by 7 captured summarizer requests with 0 witness occurrences. The read that followed is `PREVIOUS_EVIDENCE_UNAVAILABLE`. |
| **H2 — adjudication progress lost** | `SUPPORTED` | **`SUPPORTED` at 62→63 only, on the corrected witness idx 124**; `REFUTED` (decision limb) at 36→37 | Chronologically valid pre-boundary witness now cited. |
| **H3 — evidence retained, unnecessary reverification** | `REFUTED` | **`REFUTED`** | Unchanged: relevant evidence was not provider-visible before the re-reads. |
| **H4 — legitimate adversarial investigation** | `SUPPORTED` | **`SUPPORTED`** | Unchanged: the R4 counterevidence was genuinely incomplete. |
| **H5 — general convergence failure** | `SUPPORTED` | **`INDETERMINATE`** | Most cited witnesses are post-boundary and are explained by lost-verdict re-verification. |

**A sixth, previously-unnamed finding is now established and is the strongest of the
set — call it H6:**

> **H6 — previously established adjudication outcomes are lost at compaction.**
> R8 CONFIRMED, R7 CONFIRMED and R3 NARROWED were each formed inside the 36→37
> covered prefix and each is absent (0 occurrences) from both generated summaries.
> The behavioural consequence is observable: R7 was re-listed as outstanding at idx 154
> and re-verified.

H6 is the finding that makes **Option A** the correct successor.

---

## 6. Corrected successor decision

### `NEXT_ACTION: A — ACT-CLINEMM-ADJUDICATION-CONTINUITY-RED-01`

**Justification:** the precondition *"a previously established decision demonstrably
disappears at compaction"* is now satisfied by three independent findings (R8, R7, R3),
each verified against the exact covered prefix and each observed to be re-investigated
afterwards.

**Constraints carried into the successor ACT (from the review and from this correction):**

1. The RED must target **preservation of source-grounded adjudication outcomes**, not
   raw source-file excerpts. A verdict is a bounded, model-authored statement; its
   confidentiality and provenance are demonstrable, unlike arbitrary source text.
   This is the distinction that avoids re-proposing the withdrawn fact-carry-forward
   feature.
2. The successor must begin with a **production-seam RED** and **security-constrained
   conservation tests**.
3. **Do not** target suppression of the summarizer's `Blocked` assertion. The
   summarizer's statement is truthful about its own input; suppressing it would reduce
   truthfulness without recovering evidence.
4. The successor must **not** re-open the contained excerpt carry-forward
   (`SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED = false`).

**No repair design is frozen in this correction ACT.**

---

## 7. Executed gates for this correction

| Gate | Result |
|---|---|
| P0-1 boundary re-verification against canonical 0..73 / 0..125 | done; R4 narrowing located at idx 124 |
| P0-2 summarizer-request recovery | 7 requests recovered from `cap_41f75c5386d5db78`; 0 witness occurrences in all 7 |
| P0-2 production-seam probe (serializer vs provider) | executed, both assertions passed, probe files removed; `git status` clean of tracked changes |
| P0-3 verdict-presence measurement for R1/R3/R7/R8 in both summaries | done; 1 → 0 for R3/R7/R8 |
| H5 timing re-classification against idx 73 | done |
| `bun x vitest run src/extensions/context/compaction.evidence-fidelity01.test.ts` | 39 passed (39), exit 0 |
| Worktree | no tracked file added, modified or deleted; HEAD unchanged |

**Labels for the new evidence:** the 7 summarizer requests are `REAL` (captured
production artifacts) but `PRIVATE` — they are **not** committed. Their hashes are
recorded in `artifact-hashes.json` under `private_input_artifacts`.

**Behavioural consequence, observed in the canonical record:** at canonical idx 154
(post-62→63) the model re-lists R7 as still outstanding — *"I still need evidence for
… **R7 (43 tests + skipTests)** …"* — and re-runs the Java-test count. It had already
adjudicated R7 at idx 40. The re-verification at idx 114/116/154 is therefore
**necessary work caused by the loss of the verdict**, not a convergence failure. This is
the same mechanism as the R4 re-reads, now demonstrated on a finding that *had* a
verdict.

### 3.1 This satisfies the Option A precondition

The prior ACT's gate for an adjudication-continuity successor was: *"a previously
established decision demonstrably disappears at compaction"*.

| Condition | Met? | Evidence |
|---|---|---|
| A previously established decision existed | **YES ×3** | R8 CONFIRMED (idx 28), R7 CONFIRMED (idx 40), R3 NARROWED (idx 64) — each a verdict-shaped, source-grounded statement with a mechanism |
| It demonstrably disappears at compaction | **YES** | each verdict phrase: 1 occurrence in canonical 0..73, **0** in the 36→37 summary, **0** in the 62→63 summary |
| The disappearance is observable behaviourally | **YES** | R7 re-listed as outstanding at idx 154 and re-counted; R3's arithmetic re-derived later |
| It is not a mere severity/confidence restatement | **YES** | each carries a *mechanism* and a *revision*, not a restated severity |

**Option A is therefore justified**, and the reviewer's refinement is correct: the RED
must target **the preservation of source-grounded adjudication outcomes**, not raw
source-file excerpts — because a verdict is a small, bounded, model-authored statement
whose confidentiality and provenance are demonstrable, unlike arbitrary source text.

2. The summarizer's own `## Blocked` section in the produced summary —
   *"Exact outputs of many successful commands are omitted from the transcript"* —
   is therefore **truthful about its own input**. It is not a hallucination and not a
   false statement about the canonical record.

### 2.4 The two boundaries, side by side

| | Main-model provider request | Summarizer request |
|---|---|---|
| Artifact | `compaction_candidate_snapshot` (`#37#36`, `#63#62`) and `cap_41f75c5386d5db78.ai_sdk_prompt.{1..7}` | `cap_41f75c5386d5db78.ai_sdk_prompt.{1..7}` |
| `tool_result` payload | `{query, result: "<full stdout>", success}` | rendered to `[succeeded] #N: [result omitted]` |
| R4 witness present? | **YES** | **NO** (0 / 7 requests) |
| Production function | the provider handler's message mapping | `serializeConversation` → `flattenToolResultContent` → `renderStructuredToolPayload` |

An independent production-seam probe (executed, then removed) confirmed both sides:

```
SUMMARIZER RENDERED: "[Tool result]: [succeeded] cat: [result omitted]"
PROVIDER CARRIES WITNESS: true
```

request. It then recommended, as a successor action, *"target the summarizer's false
'Blocked' assertion … suppressing it carries no confidentiality surface"*.

**Both the characterisation and the recommendation are wrong.** The captured
pre-compaction provider request is the **main-model** request. It is **not** the
summarizer's request.

| `re-persisted` | 2 | idx 124 + one earlier |
| `PersistedConfigSource` | 10 | idx 124 and others |
| `ordinal 200` | 8 | idx 124 and others |

**All four distinguishing phrases occur at exactly one canonical index: 124.** No
post-boundary index is required.
