# qualification-report.md — ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-01

**Outcome: `PASS_BOUNDARY_CLASSIFIED`** (corrected under
`ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-CORRECTION01`)

The causal boundary is classified. **No harness-owned defect was reproduced.**

> **CORRECTION01 summary.** Three overclaims found by expert review were
> corrected; the corrections are evidence-only and touch no production code.
>
> | | Parent ACT claim | Corrected claim |
> |---|---|---|
> | **F1** | "257 compaction boundaries" | **257 requests carried a compacted summary; 16 compaction EVENTS observed** (summary-identity changes). Retention 257/257 unchanged. |
> | **F2** | "186 novel results ⇒ productive" | tiers separated: `EMPTY` 26 / `CONTENT_DISTINCT` 342 / `NONEMPTY_DUPLICATE_BODY` 3 / `FACTUALLY_NOVEL` **UNPROVEN**. New per-source novelty measurement added. **H4 → INCONCLUSIVE.** |
> | **F3** | "readiness established at turn 271" | **first recorded verdict COVERAGE at turn 271**; independent sufficiency **UNPROVEN**; 8/10 first assertions later **REFINED**. **H1 SUPPORTED but not proved exclusive.** |
>
> **H2 and H5 are unchanged and were re-verified against the same captures.**

The autonomous non-completion is attributable to **H1 — model stopping
judgment**: the model continued choosing tools despite an explicit completion
obligation and a working completion route, both present simultaneously in
every one of the 277 pre-intervention provider requests. The *sufficiency of
the evidence* half of H1 is now explicitly **UNPROVEN**, and H4 is
**INCONCLUSIVE** rather than refuted.

---

## 1. Findings

### F1 — The completion contract was fully live throughout the autonomous run

`submit_and_exit` was present in the **provider-visible tool schema of 277 /
277** autonomous provider requests, from iteration 1 to iteration 277, with a
byte-stable 9-tool list. The completion-obligation text was present in **277 /
277** requests. `maxOutputTokens` was **16384** in every request.

This is the direct, authoritative answer to "did the model see an equivalent
tool schema, state or completion opportunity?": **yes, and continuously so.**

### F2 — The model never emitted a completion call

Zero `submit_and_exit` tool calls exist in the autonomous phase. Nothing was
dispatched, so nothing could be rejected or lost. All 277 autonomous assistant
turns contained at least one tool call, so the runtime's zero-tool-call
completion re-injection path
(`sdk/packages/agents/src/agent-runtime.ts:2031-2045`) was **never reached**.

### F3 — First recorded verdict coverage was reached at turn 271 (CORRECTED)

Under the frozen rubric (`ROUND_C_FROZEN_VERDICT_ASSERTION_RUBRIC_V1`), all
ten subjects R1–R10 had a **recorded verdict assertion** by transcript turn
271 — **≈ 39 minutes** into a run that lasted 2 h 46 m 45 s. The model then
spent a further 174 turns / 202 tool calls / 71,194 output tokens / ≈ 1 h 42 m
refining, without emitting.

**CORRECTION01 F3 — this is now bounded.** The rubric measures the model's
*own* adjudication language, so turn 271 establishes **first recorded verdict
COVERAGE**, **not** independent factual sufficiency. The corrected probe
shows **8 of 10 subjects' first assertions were later REFINED** (R2, R3, R4,
R5, R6, R7, R9, R10); only R1 and R8 were stable. `last_turn_all_ten_verdicts_STABLE`
is **`null`**, and independent readiness is **UNPROVEN**. The model may have
been correcting early errors — which is exactly why the successor experiment
must measure **independently assessed** verdict quality.

### F4 — The post-readiness work added new source content (CORRECTED)

202 tool calls after turn 271 used **202 distinct command payloads** (zero
repeats). New verdict assertions appeared in every 50-turn window to the end
of the run.

**CORRECTION01 F2 — the tier is now stated honestly.** "186 novel results"
was a body-level diversity measurement, not proof of factual novelty; the
correct label is `CONTENT_DISTINCT` 186, with `FACTUALLY_NOVEL` **UNPROVEN**.

The stronger, mechanically verifiable measurement is **per-source novelty**:
of **136** source-attributable reads, **129** added at least one
previously-unseen line from that source and only **7** were pure re-reads,
adding **4,388** new distinct lines. So the post-readiness work was **not** a
literal re-litigation of settled questions. Whether every verdict change was
*warranted* is **not** established, which is why **H4 is INCONCLUSIVE**
rather than refuted.

### F5 — Contract retention held; the compaction count is corrected (CORRECTION01 F1)

**16 compaction EVENTS** were observed, not 257: a summary *persists* across
requests, so the parent ACT's "257 compaction boundaries" was a request count
mistaken for an event count. The authoritative discriminator is a change in
the carried summary's **identity** (a new compaction replaces the summary).

**257 / 257** requests carrying a compacted summary retained the task
contract, the runtime completion obligation **and** the canonical evidence
record. **0 / 277** provider requests lacked the obligation.

What is **not** established: that the canonical evidence was preserved *in
full* across a compaction — the `<!-- cline-evidence:begin -->` record is a
bounded projection, and the probe verifies its presence, not its
completeness. **H3 is NARROWED accordingly.**

### F6 — No budget, truncation or generation boundary was applied

Maximum output tokens used in any autonomous turn: **3,130** of 16,384
(19.1 %). p50: 380 (2.3 %). Zero truncations, zero `max-tokens` finish reasons.

### F7 — The four phases separate cleanly and the positive control is valid

| Phase | Span (UTC) | Turns | Tool calls | `submit_and_exit` |
|---|---|---|---|---|
| **A** autonomous evidence gathering | 09:16:09 → 12:02:54 | 277 | 371 | **0** |
| **B** gap before operator instruction | 12:02:54 → 12:31:44 (28 m 50 s) | — | — | — |
| **C** operator-directed synthesis | 12:31:44 → 12:41:00 | 1 | 0 | — |
| **D** post-intervention completion | 12:41:00 → 12:44:39 | 3 | 4 | **2** |

Phase D is a **positive control for the completion route only**. It is
explicitly **not** used to claim that phase A autonomously converged — and it
would not support that claim even if it were, because phase D ran under an
operator-authored instruction to stop investigating.

### F8 — The post-intervention completion was itself deferred by a harness barrier

The first `submit_and_exit` (index 652) was acknowledged
(`"submitted (verified=true)"`) but the harness then injected a
`runtime-control: completion_continuation_control` message (index 654) because
**2 held terminal observations** (`cmd_mwq8uq4wdcl42pgm`,
`cmd_mwqczg4qd18da05z`) had not been consumed. The model issued two
`command_status` calls (index 656), then re-issued `submit_and_exit` (index
659), which succeeded. This confirms the deferred-completion barrier was live
and functioning — and confirms it was **not** the cause of the autonomous
non-completion (it never engaged during phase A).


---

## 2. Limitations (explicit)

1. **The reason for the 28 m 50 s quiescence in interval B is
   `UNAVAILABLE_FROM_TRACE`.** The session artifact does not record why no
   iteration 278 was dispatched. The ACT does not invent a cause. This does
   not affect the classification: the absence of `submit_and_exit` is
   established independently and the quiescence is consistent with it.
2. **The readiness rubric is a proxy (CORRECTION01 F3).** It measures *the
   model's own recorded adjudication language*, not an external oracle for
   "sufficient evidence". Turn 271 is therefore **first recorded verdict
   COVERAGE**, and independent factual sufficiency is **UNPROVEN**. The
   measured refinement rate (**8 of 10** first assertions were later
   refined) is positive evidence that the first assertions were not final, so
   no defensible synthesis turn can be named for all ten subjects. The
   parent ACT's assertion that "necessary evidence was available throughout
   all 277 requests" is **withdrawn**.
2b. **Factual novelty is unproven (CORRECTION01 F2).** `CONTENT_DISTINCT`
   (342) and the per-source novelty figures (129/136 reads added new content)
   are diversity/source-content measurements. Whether a given result
   contributed a new **decision-relevant fact** would require an independent
   adjudication of R1–R10, which this ACT does not perform. **H4 is
   INCONCLUSIVE**, not refuted.
3. **The per-subject evidence matrix (§ 3 of `readiness-analysis.md`) reports
   the model's adjudications**, not an independent re-adjudication of the
   Keycloak findings. Re-adjudicating R1–R10 is a different act and is not
   claimed here.
4. **Only one historical session was available.** There is no second sample
   of the same model against the same task, so this ACT establishes *what
   happened* with high confidence but not *how reproducible* the behaviour
   is.
5. **The system prompt carried no completion instruction**
   (`submit_and_exit` absent from the 4,297-byte system prompt). The
   obligation reached the model only through the runtime-synthetic user
   message. This is by design (the reminder is the canonical channel) and is
   not itself a defect, but it does mean the obligation's visibility depends
   on that one channel surviving — which F5 shows it did, 257 times.
6. **The installed VSIX bundle differs from the working-tree bundle**
   (different sha256). The installed artifact is the one that produced the
   session; the source at `ENTRY_HEAD` is what the provenance file binds it
   to. No claim in this ACT depends on the local bundle.

---

## 3. Conservation check (ACT § 6)

| Guarantee | Status | Evidence |
|---|---|---|
| Canonical evidence authority | **PRESERVED** | sidecar `source_prefix_hash` / `source_last_message_key` intact; canonical evidence record present in every compaction summary |
| Task-contract continuation | **PRESERVED** | 257/257 summaries carry the contract section + runtime obligation |
| Successful tool-call/result correlation | **PRESERVED** | 371/371 autonomous calls matched exactly one result; 0 orphans |
| Failed / ambiguous result rejection | **PRESERVED** | 5 error results present and distinguishable; 1 exact-duplicate result correctly observable |
| Request-budget fail-closed | **PRESERVED** | `TaskContractBudgetError` path intact (`task-contract.ts:503-514`); 0 budget errors in the session, i.e. the guard never had to fire |
| Sidecar/resume integrity | **PRESERVED** | sidecar `source_message_count: 656`, `source_last_message_key: id:msg_NtYmvXtp` consistent with the transcript tail |
| Exact session/task/epoch terminality | **PRESERVED** | session `status: completed`, `exit_code: 0`; `task.completed` sourced from `submit_and_exit` |

**Forbidden shortcuts — none taken:** no stop-after-N-tools rule; no
diagnostic side effects in React functional updaters; no prompt, compaction
policy or tool-authorization change; no Strata or cache-policy change; no new
harness comparison; no synthetic observations substituted for live evidence;
no expansion into orchestration redesign.

**Production changes: NONE.** `git status --porcelain` is empty apart from the
ACT-owned evidence directory.


---

## 4. Successor selection (ACT § 9)

The ACT's branching rule:

> *"If a harness-owned defect is reproduced, propose exactly one bounded
> repair ACT tied to the verified cause. If the model continued despite
> sufficient evidence, a valid completion contract and no reproduced harness
> defect, formulate a controlled model-versus-harness convergence experiment.
> Do not silently turn that result into a ClineMM bug."*

**The second branch applies.** No harness-owned defect was reproduced, and the
model did continue despite sufficient evidence under a valid contract.

### Proposed successor: a controlled model-versus-harness convergence experiment

**Proposed ACT id:** `ACT-CLINEMM-ROUND-C-CONVERGENCE-EXPERIMENT-01`

**Shape:** an A/B experiment, run on the *same* model, *same* task and *same*
tool schema, varying **only** whether a mid-run completion affordance is
present. **No production behaviour changes**; the affordance is injected by the
experiment harness, not by a product change.

**CORRECTION01 — start with one bounded paired pilot**, not another
unrestricted multi-hour run. The parent ACT's open question is now sharper:
H1's "had the evidence" half is **UNPROVEN**, so the experiment must
establish, in the same run, (a) whether the affordance produces autonomous
completion, and (b) whether the verdict quality is preserved. A single
paired pilot on a shortened task is sufficient to discriminate
model-limited convergence from harness-limited convergence; a multi-hour
unrestricted run is not, and repeats the failure mode this ACT just analysed.

| Arm | Configuration | Measures |
|---|---|---|
| **Control** | current production contract (obligation at run start + on zero-tool-call turns) — i.e. exactly the historical condition | whether the model converges autonomously |
| **Treatment** | the same, plus a **periodic, evidence-neutral** completion affordance delivered as a runtime-synthetic user message at a fixed cadence (e.g. every N turns) that asks the model to submit if the deliverable is ready, and **never** instructs it to stop investigating otherwise | whether the model converges, and how much quality is lost vs. the control |

**Why this and not a repair:**

* A repair would have to change the product's completion contract on the basis
  of a single observation, with no evidence that the harness is at fault. The
  ACT's own rules forbid that.
* The post-readiness evidence shows that the *work* was productive
  (202 distinct commands, 186 `CONTENT_DISTINCT` bodies; 129 / 136
  source-attributable reads added new content). A blunt stop would destroy
  value; a cadence affordance tests the specific hypothesis ("would a
  periodic reminder have converted this model?") without truncating work.
* The treatment arm is explicitly **not** a stop-after-N-tools rule: it never
  forbids a tool call, and the model remains free to keep investigating.

**Primary endpoint:** autonomous `submit_and_exit` within a defined wall-clock
and turn budget.

**Secondary endpoints (to detect the cost of the affordance):**

* **independently assessed verdict quality** between arms — this is now the
  decisive secondary endpoint, because CORRECTION01 F3 left the evidence-
  sufficiency question open. The quality assessment must be performed by an
  assessor that did **not** watch the arm, and must be independent of the
  model's own recorded adjudication language (which is what the parent ACT's
  rubric measured, and what this correction narrowed);
* the number of tool calls and output tokens per arm;
* the number of post-readiness tool calls in the treatment arm (to detect that
  the affordance merely interrupts work rather than enabling it);
* the **per-source novelty** metric (from `tools/novelty-probe.py`) in each
  arm, so that a treatment arm that converges by *abandoning* investigation
  is distinguishable from one that converges after doing the work.

**Stopping rule:** if the treatment arm does not converge autonomously, or
converges with a material verdict-quality regression, the result is recorded
as **model-limited convergence** and the harness contract is left unchanged —
which is itself a valuable, publishable outcome.

### Explicitly NOT proposed

* A `submit_and_exit` availability or prompt repair (no defect found).
* A compaction, task-contract or budget change (no defect found; 257/257
  clean).
* Any change to Strata or its cache policy.
* Any merge with `ACT-CLINEMM-COMPACTION-STABLE-PREFIX-LIVE-QUALIFICATION-01`
  — that qualification **remains open and separate**, as instructed.

---

## 5. Exit-criteria self-check

| Exit criterion | Status |
|---|---|
| Autonomous and assisted phases are separated | ✅ §F7 — four intervals with exact timestamps |
| The completion-tool path is inspected at the real production boundary | ✅ provider-visible tool schema in all 277 pre-intervention requests; registration, obligation, enforcement seams mapped in `source-map.md` §3 |
| Evidence readiness is established or explicitly marked unknown | ✅ **explicitly marked unknown**: first recorded verdict COVERAGE at turn 271; independent sufficiency **UNPROVEN** (CORRECTION01 F3) |
| The five hypotheses are supported, rejected or marked unobservable using exact evidence | ✅ H1 SUPPORTED (not proved exclusive); H2 REFUTED; H3 NARROWED; H4 INCONCLUSIVE; H5 REFUTED — each with its required discriminator, evidence, controls and counterexamples |
| Every harness-owned defect claim has a reproducing RED and relevant control | ✅ **vacuously satisfied** — no harness-owned defect claim is made; the production seam was exercised green as a control (`verification/01-production-seam-definitions-test.txt`, exit 0, 87 passed) |
| Artifacts are sanitized and bound to exact source identities | ✅ `artifact-hashes.json`; timeline carries fingerprints only, no raw text or credentials |
| No production change was made | ✅ `git status --porcelain` empty apart from the ACT evidence directory |

**Dispositions (CORRECTION01):** `HALT_RED_NOT_REPRODUCED` is recorded for
each of H2, H3, H4 and H5 individually (no RED could be constructed because no
defect exists; for H4 the correct record is `INCONCLUSIVE`, which is not a
defect finding in either direction). `HALT_P0` does **not** apply: no
correctness or security blocker was established. `CAPTURE_INSUFFICIENT` does
**not** apply: the required causal observations (tool schema, obligation text,
compaction boundaries, token counts, dispatch correlation) were all present
and were joined authoritatively.

**CORRECTION01 exit requirements — all met:**

| Requirement | Status |
|---|---|
| Correct the compaction count or mark it unavailable | ✅ **corrected**: 16 compaction EVENTS (identity-change transitions) vs 257 requests carrying a summary; both numbers published with their meaning (`compaction-probe.json`) |
| Relabel the novelty/readiness measurements to their actual evidence strength | ✅ tiers separated (`EMPTY`/`NONEMPTY`/`CONTENT_DISTINCT`); `FACTUALLY_NOVEL` marked unproven; readiness relabelled as first recorded verdict COVERAGE with stability measured |
| Narrow H3/H4 conclusions where necessary | ✅ H3 REFUTED → **NARROWED**; H4 REFUTED → **INCONCLUSIVE**; H1 SUPPORTED → **SUPPORTED, not proved exclusive** |
| Re-run the existing probes, regenerate affected artifacts and hashes, and commit | ✅ all five probes re-run; `timeline.jsonl`, `readiness-probe.json`, `compaction-probe.json`, `novelty-probe.json` regenerated; `artifact-hashes.json` regenerated; committed |
