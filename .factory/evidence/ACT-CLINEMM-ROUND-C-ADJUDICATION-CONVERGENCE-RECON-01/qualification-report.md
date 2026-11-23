# Qualification report — ACT-CLINEMM-ROUND-C-ADJUDICATION-CONVERGENCE-RECON-01

> **CORRECTION01 SUPERSEDES §8 (Successor decision) and part of §1.**
> On review, three load-bearing findings were upheld:
> - **P0-1 (chronology):** the R4 narrowing witnesses cited at canonical idx 148/194 are
>   **post**-boundary. The correct pre-boundary witness is **canonical idx 124**
>   (inside 0..125). H2 for 62→63 is re-proven on that witness.
> - **P0-2 (serializer):** the claim that the summaries' "Tool outputs are omitted"
>   assertion was **false** is **withdrawn** — it was truthful about the summarizer's
>   own input. The evidence loss is confirmed at the **serializer** boundary by 7
>   captured summarizer requests, each with 0 occurrences of the R4 witness.
> - **P0-3 (verdict loss):** R3, R7 and R8 verdicts were demonstrably lost at the 36→37
>   boundary and remain lost. **`NEXT_ACTION` changes from C to A.**
> - **H5** is reclassified `SUPPORTED` → **`INDETERMINATE`**.
>
> The authoritative successor decision is in `correction01-boundary-verification.md` §6.
> The original text of §8 is retained below as the record of what was first concluded.

**Verdict: `PASS_RECON_BOUNDARY_CLASSIFIED`**

**One independently adjudicated explanation of the repeated R4 evidence reads:**

> The repeated R4 reads are **`PREVIOUS_EVIDENCE_UNAVAILABLE`** — the compaction
> summaries dropped the R4 source evidence, its provenance and the model's
> adjudication progress, and asserted the **false** claim that "tool outputs are
> omitted in the transcript". The model, seeing an empty R4 context, re-read the
> sources it had already read. The repetition is **exactly boundary-aligned**:
> `cat startup.sh` occurs 3 times — once before any compaction, once after each of the
> two compactions, and nowhere else.
>
> The cause is **H1 (source evidence lost)** together with **H4 (the investigation was
> genuinely still open)**. It is **not** H3 (the evidence was *not* provider-visible
> before the re-reads) and **not** an H5 general convergence failure *as the cause of
> the R4 rereads* (the re-reads are boundary-aligned; H5 is nonetheless **supported as
> an independent finding** about the session's failure to terminate).

---

## 1. What this ACT establishes

| # | Claim | Label |
|---|---|---|
| 1 | The R4 witness fact (`/opt/keycloak/bin/kc.sh build` + `start --optimized`) was independently verified **before** the 36→37 compaction and is **absent** from both generated summaries. | REAL |
| 2 | The 36→37 and 62→63 boundaries are reproduced exactly: 74 and 126 canonical messages, 6 and 9 provider-visible messages. | REAL |
| 3 | Both summaries assert **"Tool outputs are omitted in the transcript"**, and that assertion is **false** — the outputs were in the canonical history *and* in the summarizer's own input. | REAL |
| 4 | Immediately after the 36→37 boundary, the model's own words are *"Let me re-read startup.sh"* — and it then issues `cat startup.sh` + `cat Dockerfile.roz` (idx 74). | REAL |
| 5 | Immediately after the 62→63 boundary, it issues `cat startup.sh` again (idx 146) and re-greps `PersistedConfigSource` (idx 148) — a term that had appeared **10 times** before the boundary and **0 times** after it. | REAL |
| 6 | No source change occurred between the reads: HEAD `42de653b…` and a clean tree observed identically at canonical idx 3, 75 and 155. | REAL |
| 7 | The production seam explains the loss: `renderStructuredToolPayload()` renders a `run_commands` payload's **string** stdout as the literal `[result omitted]`; the source-file-fact path is **off by default** *and* gated on the tool name `read_files`, which the observed tool is not. | REAL_PRODUCTION_SEAM |
| 8 | The existing production-seam suite for exactly this mechanism passes at `ENTRY_HEAD`: **39 passed (39)**, exit 0. | REAL |
| 9 | The model **never formed an R4 verdict** in 196 messages, while it did form verifiable verdicts for R1, R3, R7 and R8. Three of those four (R3, R7, R8) were formed **before** the 36→37 compaction and **lost** at it. | REAL |

## 2. What this ACT does **not** establish

- It does **not** establish that a **terminal R4 decision** was lost. No R4 verdict ever
  existed. The loss is of **evidence and of in-progress adjudication**.
- It does **not** establish a **defect in the compaction mechanism that is not already
  known**: the `[result omitted]` behaviour was identified and documented by
  `ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01`, and the automatic repair it proposed

## 3. Evidence limitations

| Limitation | Effect |
|---|---|
| `cap_run_rX-Rbi8y` does not exist on this machine. | The provider-request material was recovered from the `compaction_candidate_snapshot` files instead — which are the *actual provider request payloads* for the same boundaries, carrying strictly more information. No causal claim depends on the missing run id. Recorded as `UNAVAILABLE_FROM_TRACE`. |
| The 36→37 generated summary is not stored standalone. | It was recovered as `apiMessages[0]` of the next captured provider request — i.e. exactly the bytes the model saw at that boundary. Cross-capture reconstruction; the summary's bytes are `REAL`. |
| The session was still `idle`/growing at capture; the transcript ends mid-investigation. | The **final** R4 reasoning (idx 194) is the last observable state, not a completed adjudication. The run's true terminal verdict for R4 is `UNKNOWN` and is reported as such. |
| Provider-request *input* is used to establish what the model could see. | Per the ACT's own rule, provider-request input is **never** treated as a model response to that same request. Responses are taken only from canonical assistant `thinking` blocks and tool calls. |
| The `run_commands` tool result content is a **nested** `[{query, result, success}]` structure. | A flat text extraction that stops at the block level silently misses all tool output. The first two analysis passes in this ACT made that mistake; the final numbers come from a recursive traversal. The corrected traversal is the one reported. |
| Tool-call argument arrays vs strings. | The production `run_commands` executor accepts both. In this run, idx 6/52/146/148 used a JSON **string** and idx 60/74/166 used an **array**. Both are recorded; neither is malformed, and this is **not** the `commands:null` issue (which belongs to `fetch_web_content` / `read_files` / `search_codebase`, a separate causal chain). |
| Only two boundaries were analysed in depth. | The session contains 4 compaction candidates (36→37, 62→63, 97→96, 98→97). The later two were inspected for R4 relevance and are not R4-relevant; they were not reconstructed. |

## 4. Production delta

**NONE.** No tracked file was added, modified or deleted. The only repository writes are
the eight new files in this evidence directory. `FINAL_HEAD == ENTRY_HEAD ==
a493eff078ec5c8f2b6c874ad8f4a85009d1b64f`.

## 5. Executed gates

| Gate | Result |
|---|---|
| `bun x vitest run src/extensions/context/compaction.evidence-fidelity01.test.ts --config vitest.config.ts` (cwd `sdk/packages/core`) | **39 passed (39)**, exit 0 |
| Canonical conservation (frozen snapshot) | 196 messages · 97 tool calls · 97 tool results · 0 unmatched · 0 duplicate call ids |
| Boundary conservation (36→37) | `msg_NFcQJe45` → canonical index 73 → prefix **74** ✔ |
| Boundary conservation (62→63) | `msg_7ztXgjkW` → canonical index 125 → prefix **126** ✔; sidecar `source_last_message_key` matches ✔ |
| Probe matrix, 3 authority boundaries × 2 boundaries | computed on the frozen snapshot; all counts in `compaction-boundary-comparison.md` |
| Privacy gate | 0 raw transcripts / provider payloads / canonical transcript bodies committed |

No lint, typecheck or full-suite gate was run: this ACT changed **no production
source**, so there is nothing for a typecheck or lint to gate. The one executed suite
is the production-seam RED for the mechanism under classification, run to validate the
source reading (not to qualify a repair).

## 6. Decision boundary classification (the ACT's success condition)

**At least one concrete R4 decision boundary is classified against the real available
evidence:**

| Boundary | Model action | Classification | Mechanism |
|---|---|---|---|
| **36→37** (canonical idx 74) | `cat startup.sh` + `cat Dockerfile.roz` | **`PREVIOUS_EVIDENCE_UNAVAILABLE`** | the 36→37 summary dropped the R4 evidence and falsely stated the outputs were omitted; the model's own reasoning says "Let me re-read startup.sh" |
| **62→63** (canonical idx 146) | `cat startup.sh` + `grep Dockerfile.roz` | **`PREVIOUS_EVIDENCE_UNAVAILABLE`** | the 62→63 summary dropped the R4 evidence *and* the `PersistedConfigSource` narrowing reasoning (10 → 0 occurrences) |
| **62→63** (canonical idx 148) | `git grep PersistedConfigSource` | **`NEW_EVIDENCE`** relative to the model-visible context; **`REDUNDANT_REACQUISITION`** relative to the canonical record | a fact acquired 10× before the boundary and lost by it |

**The minimum causal counterexample (H1) is fully satisfied** at canonical idx 74 —
see `adjudication-state-matrix.md` §4.

  was **contained (default off)** by `ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-CONTAINMENT-01`

## 7. Why the alternative readings were rejected

- **"`R4 claims X` is not `R4 verified as X`."** — Applied. The summary's single
  surviving R4 mention is the *task-contract quotation of the original allegation*,
  verified by position (all four occurrences inside `cline-task-contract:begin…end`).
  It carries **zero** adjudication information, because the model already had it
  verbatim and unconditionally.
- **"File inspected" is not "Evidence sufficient."** — Applied. The summary lists
  `startup.sh` and `Dockerfile.roz` under `## Files → Read`, but no content, no line,
  no call id. The 36→37 summary even says `Read: none recorded in transcript` while
  listing four paths.
- **"An original severity/confidence is not a new verdict."** — Applied. "Original:
  Severity 4/5, Confidence 3.5/5" is inside the task contract, and is the *Round B*
  rating, not the model's.
- **"A successful command is not proof its contents resolved the finding."** — Applied.
  All six reads succeeded; only reads #1–#3 and #6 actually resolved anything, and
  #1–#3 did not resolve R4 either (R4 was still open at idx 194).
- **"Exact-string loss is not necessarily semantic fact loss."** — Applied *in both
  directions*. The counterevidence that the summary's `counterevidence`/`NARROWED` hits
  were rubric text was established by position, not by string counting. And the R4
  *facts* were genuinely lost (0 occurrences of the source text, the build line, the
  docs quote and `PersistedConfigSource` in both summaries) — so here exact-string
  loss **does** track semantic loss for the facts, while it does **not** for the
  rubric words.
- **"Provider-request input cannot be treated as a model response to that same
  request."** — Applied. The 36→37 boundary's *model responses* (idx 74's thinking and
  tool call) are taken from the canonical assistant message `msg_gHY0jZJL`, which is
  also present as `apiMessages[5]` of the 63 candidate — the same message object, so
  the two views agree.

## 8. Successor decision

> **CORRECTION01 — THIS SECTION IS SUPERSEDED. The authoritative decision is
> `NEXT_ACTION: A` (`ACT-CLINEMM-ADJUDICATION-CONTINUITY-RED-01`), recorded in
> `correction01-boundary-verification.md` §6.**
>
> The original reasoning below rejected Option A because *R4* never reached a verdict.
> That reasoning was **too narrow**: the same recon's own R1–R10 matrix established that
> **R3 (NARROWED, idx 64), R7 (CONFIRMED, idx 40) and R8 (CONFIRMED, idx 28)** were each
> formed inside the 36→37 covered prefix and each is **absent (0 occurrences)** from both
> the 36→37 and the 62→63 summaries. Those are previously established decisions that
> demonstrably disappear at compaction — the exact precondition Option A requires — and
> the behavioural consequence is observable (R7 is re-listed as outstanding at idx 154
> and re-verified).
>
> The original §8 also recommended targeting "the summarizer's **false** `Blocked`
> assertion". **That recommendation is withdrawn**: the assertion was truthful about the
> summarizer's own input, and suppressing it would reduce truthfulness without
> recovering any evidence.

### Original (superseded) reasoning, retained as the record

### `NEXT_ACTION: C — No repair ACT`

**Rationale:**

1. **Option A (`ACT-CLINEMM-ADJUDICATION-CONTINUITY-RED-01`) is not warranted.**
   Its precondition is "a previously established decision demonstrably disappears at
   compaction". **No R4 decision was ever established.** At the 36→37 boundary the
   classification is `ADJUDICATION_NOT_YET_ESTABLISHED`. At the 62→63 boundary what
   disappears is *in-progress narrowing*, not a decision. A repair targeted at
   "adjudication continuity" would be aimed at an artefact that did not exist. It
   would also be, in substance, a re-proposal of the excerpt carry-forward that
   `ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-CONTAINMENT-01` **contained (default
   off)** at `ENTRY_HEAD` — a path that was already found to have an unbounded
   credential-format confidentiality surface.

2. **Option B (`ACT-CLINEMM-AUTONOMOUS-CONVERGENCE-RED-01`) is not warranted on the
   R4 evidence.** Its precondition is "sufficient evidence and adjudication remain
   provider-visible but the model continues materially redundant investigation".
   That is **false** at the R4 boundaries: 0 relevant evidence and 0 adjudication were
   provider-visible. The redundant reads were *forced*, not gratuitous.
   **However**, H5 **is** independently `SUPPORTED` — the session never converged
   (no verdict matrix, no terminal tool, 5 findings still open at idx 194) and shows
   substantial pre-compaction redundancy (3 counts of the same Java-test quantity,
   8 `helm template` renders, 6 failed `tar` attempts). That is a *different* claim
   from "the compaction caused the R4 rereads", and it needs its own evidence base
   (the other nine findings, and a live run) before a RED can be specified against
   a demonstrated stopping boundary.

3. **The correct next step is therefore C: no repair ACT, and return to observing
   autonomous completion** — with the following concrete, evidence-backed
   recommendations recorded here for whoever acts next:

   - **Re-observe with the named capture run.** The single biggest limitation is that
     `cap_run_rX-Rbi8y` was absent; a re-run with the capture enabled would give the
     per-request provider payloads needed to measure whether the **provider-visible**
     continuation (not just the canonical record) still loses evidence at boundaries
     beyond 62→63, and to measure the *fidelity* of the generated summary directly
     rather than by probe-string counting.
   - **Target the summarizer's false "Blocked" assertion, not the tool output.** Both
     summaries told the model the outputs were omitted when they were present. That
     assertion is what converted a recoverable context loss into a *re-read*. A
     successor may legitimately test whether the summarizer can be prevented from
     asserting absence of evidence that is present in its own input — but that is a
     **summarizer-truthfulness** question, not an evidence-carry-forward question,
     and it carries no confidentiality surface, because it would not copy any content.
   - **Separate the two failure modes before acting on either.** This ACT shows two
     independent defects with different owners: (a) **evidence loss at compaction**
     (this ACT's subject, already known and already contained), and (b) **non-convergence
     of the agent** (H5, not demonstrated at the R4 boundary). Any successor that
     conflates them will target the wrong seam.

**A successor ACT, if one is later authorised, must begin with a production-seam RED
and security-constrained conservation tests.** No such design is frozen here.

  at `ENTRY_HEAD`. This ACT adds the **causal weight at a named decision boundary** and
  the **R4-specific adjudication classification**, not a new mechanism.
- It does **not** quantify the total waste of Round C. Only the R4 chain and the
  controls were reconstructed, as the ACT scoped.
- It does **not** attribute tokens, cache misses, or wall-clock cost to the redundant
  reads. Those are `UNAVAILABLE_FROM_TRACE`.
- It does **not** re-run a Round C task, change production behaviour, enable source-file
  excerpt carry-forward, introduce an R1–R10 ledger, modify the `beforeModel`
  checkpoint, change `submit_and_exit`, add provider diagnostics, change tool-call
  argument validation, or touch `commands:null`.
