# readiness-analysis.md — ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-01

**Goal (G2):** determine the earliest point at which the agent had enough
available evidence to produce an acceptable R1–R10 report — *not* the earliest
point at which the model claimed it was finished.

---

## 1. The frozen rubric (normative statement)

This rubric was fixed **before** any readiness outcome was inspected, and is
implemented verbatim in `tools/readiness-probe.py`.

> **ROUND_C_FROZEN_VERDICT_ASSERTION_RUBRIC_V1**
>
> A turn *T* is an **EVIDENCE-READINESS POINT** for subject *R* if, at *T*, the
> model's own recorded reasoning for *R* contains a **VERDICT ASSERTION** — a
> statement that adjudicates *R* against the frozen Round B claim — rather than
> merely describing an open question.
>
> A **VERDICT ASSERTION** for *R* is any of these statement classes appearing
> in the assistant's `thinking`/`reasoning` block at turn *T*, in the **same
> sentence** as the subject token `R1`…`R10`:
>
> | Class | Meaning |
> |---|---|
> | `CONFIRMED` | the R claim survives falsification |
> | `REFUTED` | the R claim does not survive falsification |
> | `NARROWED` | the R claim survives only in a reduced scope |
> | `CONDITIONAL` | the R claim survives conditionally on a stated precondition |
> | `SUFFICIENT` | the evidence for R is sufficient to decide it |
>
> **Deliverable readiness** is the earliest turn at which *every* subject
> `R1`…`R10` has at least one verdict assertion.

**Explicitly excluded as readiness signals** (per the ACT's instruction not to
infer readiness from confidence or later statements): final-answer length,
model self-confidence, the model's claim that it is "done", and any statement
made *after* the candidate readiness turn.

---

## 2. Result

```
$ python3 tools/readiness-probe.py \
    --session-dir ~/.vscodium-roz/cline-data/sessions/1795252560069_t82cp \
    --out readiness-probe.json
```

| Subject | First-verdict turn (transcript index) | Verdict classes |
|---|---|---|
| R1 | 153 | `CONFIRMED` |
| R2 | 134 | `CONFIRMED` |
| R3 | 229 | `NARROWED` |
| R4 | 221 | `CONDITIONAL`, `CONFIRMED`, `NARROWED` |
| R5 | 192 | `CONFIRMED` |
| R6 | 64 | `CONDITIONAL`, `NARROWED` |
| R7 | 177 | `CONFIRMED` |
| R8 | 271 | `CONFIRMED` |
| R9 | 56 | `CONFIRMED`, `NARROWED` |
| R10 | 53 | `CONFIRMED` |

```

---

## 3. Per-subject evidence matrix (G2 required fields)

For each subject the ACT records the required decision, the source of the
supporting observation, the contradictory or weakening evidence, whether the
evidence was available to the model at that turn, whether additional tool calls
were necessary, and whether a correct answer could have been generated without
further investigation.

| R | Required decision | Supporting source & exact observation | Contradictory / weakening evidence | Evidence available at verdict turn? | Further tool calls necessary? | Correct answer generatable without further investigation? |
|---|---|---|---|---|---|---|
| **R1** image pin via CI `--set` | does a manual Helm upgrade revert to the stock image? | subchart default `quay.io/keycloak/keycloak:26.0.7` in `.helm/roz/values.yaml`; CI sets repo/tag/digest via `--set` at `.gitlab-ci.yml:262-264`; local render with `values.yaml + values-prod.yaml` (no `--set`) yields the stock image | a values file could pin `keycloakx.image` — checked, none does for prod; values-dev.yaml is the only exception | **Yes** — verdict at turn 153 | No (re-confirmed empirically at 636) | **Yes** — mechanism, default, CI lines and render were all in hand |
| **R2** synchronous carrier calls | can OTP senders exhaust request capacity? | sender implementation has hardcoded 3 s/10 s timeouts; active prod sender is `mts-omni` (values.yaml:206 default → prod) | the notification-service sender is configurable, so the "hardcoded" claim does not hold universally | **Yes** — verdict at turn 134 | No | **Yes**, with the scope qualifier the model applied |
| **R3** DB pool arithmetic | is the connection budget manually maintained? | pool max 80/pod; 11 pods ⇒ 880 > the documented 400 | no admission controller / PDB / HPA enforcement found | **Yes** — verdict at turn 229 | No | **Yes** — the claim survives, narrowed in scope |
| **R4** `kc.sh build` at startup | does the startup rebuild cause config drift? | `startup.sh` runs `kc.sh build`; upstream `Build.java` re-persists config via `PersistedConfigSource`; `kc.sh start` builds by default anyway | the build-time freemarker discriminator `roz-fm233` is **not** in the runtime env, so drift is real but the "mixed builds" framing is overstated | **Yes** — verdict at turn 221 | No | **Yes** — the model itself wrote *"I have enough for R4"* at turn 634, **later** than its own verdict at 221 |

---

## 4. The central discriminator: when did useful evidence acquisition end?

> *"When did useful evidence acquisition end, and what did the agent do
> afterward?"*

### 4.1 What the agent did after the readiness point (turn 271)

| Measure | Value | Evidence strength |
|---|---|---|
| Turns after turn 271 (before operator input) | **174** | measured |
| Tool calls after turn 271 | **202** | measured |
| Distinct command payloads after turn 271 | **202 / 202** (zero repeats) | measured — *diversity*, not information gain |
| Payloads executed more than once | **0** | measured |
| Tool results with `CONTENT_DISTINCT` bodies | **186** | measured — *body-level diversity only* |
| Tool results that were an exact repeat of an earlier result | **1** | measured |
| Tool results that were empty (failed fetch / no output) | **15** | measured |
| Tool results that were **factually novel** | **UNPROVEN** | requires independent adjudication of R1–R10 |
| Output tokens after turn 271 | **71,194** | measured |
| Wall-clock span of the whole autonomous phase | 10,004.6 s (2 h 46 m 45 s) | measured |

**CORRECTION01 F2.** The parent ACT reported "186 novel results" as proof
that the post-readiness work was productive. That conflated
`CONTENT_DISTINCT` with factual novelty. The corrected label is in the table
above. The stronger, mechanically verifiable measurement is per-source
novelty, reported in `novelty-probe.json` and summarised in
`causal-discriminators.md` § H4: of **136** source-attributable reads, **129**
added at least one previously-unseen line from that source and only **7** were
pure re-reads.

### 4.2 Was useful new information still being discovered near the end?

**Yes.** New verdict assertions — adjudications that changed the recorded state
of a subject — continued to appear in every 50-turn window up to the end of
the autonomous phase:

| Window (turn index) | Subjects receiving a new verdict assertion |
|---|---|
| 50–99 | R6, R9, R10 |
| 100–149 | R2, R9 |
| 150–199 | R1, R5, R7, R9, R10 |
| 200–249 | R2, R3, R4, R5 |
| 250–299 | R1, R4, R5, R6, R8, R9 |
| 300–349 | R1, R2, R3, R7, R10 |
| 350–399 | R1, R3, R4, R5, R6, R8, R10 |
| 400–449 | R1, R2, R3, R5, R6, R7 |
| 450–499 | R1, R2, R4, R5, R6, R8, R9, R10 |
| 500–549 | R1, R3, R7, R8 |
| 550–599 | R1 |
| 600–649 | R1, R4 |

---

## 5. A stronger, model-internal statement of readiness

Independent of the per-subject rubric, the model itself recorded explicit
sufficiency statements:

| Turn | Recorded statement (sanitised) | Class |
|---|---|---|
| 206 | *"…that is sufficient evidence"* | `SUFFICIENT` |
| 221 | R4 adjudicated (`NARROWED`) | verdict |
| **634** | *"I have enough for R4: the mechanism … is real and is Keycloak's default"* | `SUFFICIENT` |
| 636 | *"R1 fully confirmed"* | verdict |
| 638 | *"R1 confirmed empirically"* | verdict |
| 641 | *"Repo identity confirmed"* | verdict |
| 645 | CI job list established; *"No Maven test job"* | verdict |

Turn 634 is especially probative: the model stated it had enough for R4
**113 turns after** it had already adjudicated R4 at turn 221, and **362 turns
after** the readiness point — while `submit_and_exit` sat in the tool schema
of every request.

---

## 6. Interval B — the gap before the operator instruction

| Boundary | Timestamp (UTC) |
|---|---|
| Last autonomous assistant turn (index 648) | `2026-11-21T12:02:54.215Z` |
| Last autonomous provider request (iteration 277) | `2026-11-21T12:02:29.293Z` |
| Operator instruction (index 650) | `2026-11-21T12:31:44.747Z` |
| **Silent gap** | **1,730.5 s (28 min 50 s)** |

The autonomous phase simply **stopped**: the last autonomous provider request
was iteration 277 of 277, and no further provider request was issued for
28 min 50 s. The final autonomous turn contained a `run_commands` call; its
result was delivered (message index 649).

Two readings are consistent with the trace, and the trace does not
discriminate between them:

1. The run reached its iteration ceiling or a controlled stop and then sat
   idle awaiting operator input; or
2. The provider returned nothing actionable and the run fell quiescent.

**Both are consistent with `submit_and_exit` never having been called.** The
absence is established; the reason for the *quiescence* specifically is
`UNAVAILABLE_FROM_TRACE` — the session artifact does not record why no
iteration 278 was dispatched. This ACT does not invent a cause for it.

---

## 7. What the autonomous phase did NOT contain

| Check | Result |
|---|---|
| Autonomous assistant turns with **no** tool call | **0 / 277** |
| Autonomous assistant turns containing only text | **0 / 277** |
| Autonomous `submit_and_exit` tool calls | **0** |
| Autonomous `submit_and_exit` calls dispatched and then rejected | **0** (none were ever emitted) |
| Provider requests whose tool schema lacked `submit_and_exit` | **0 / 277** |
| Provider requests lacking the completion obligation text | **0 / 277** |

**This is the single most important structural fact in the ACT.** The runtime
has a completion-reminder re-injection path
(`sdk/packages/agents/src/agent-runtime.ts:2031-2045`) that fires when a turn
yields **no** tool calls. In the historical run that path was **never**
reached, because the model emitted a tool call on **every single one** of its
277 turns. The harness therefore never got a chance to prompt for completion,
because the model never gave it the opportunity.

That is the mechanism by which a "not complete until you call" obligation can
coexist with an indefinitely long run: the obligation is only re-asserted at
turn boundaries where the model stops calling tools — which is precisely the
behaviour the model never exhibited.


### 4.3 Interpretation — and the honest limit of this finding

Turn 271 is the **earliest** point at which all ten subjects had a recorded
verdict. It is *not* the point after which work became worthless. The model
kept refining verdicts — narrowing R4, empirically re-confirming R1 at turn
636, and producing materially new results (186 `CONTENT_DISTINCT` bodies after turn
271, all with distinct commands).

The correct reading, after CORRECTION01 F1/F2/F3, is:

* From turn 271 (≈ 39 minutes into a 2 h 47 m run) the model had **recorded
  a verdict for all ten subjects**, and from turn 634 it **explicitly said**
  it had enough for R4. Whether the report *could have been produced
  correctly* at that point is **UNPROVEN** — 8 of 10 subjects' first
  assertions were later refined, and the model may well have been correcting
  early errors.
* It spent a further **174 turns / 202 tool calls / 71,194 output tokens /
  ≈ 1 h 42 m** refining, and **still did not emit it**.
* The refinement was **not a redundant loop** in the literal sense: only 7 of
  136 source-attributable reads were pure re-reads, and 129 added new content
  from their source. Whether every verdict change was *warranted* is not
  established.

This distinction matters for the successor selection in
`qualification-report.md`: the harness cannot be said to have "wasted" the
post-readiness effort, because the effort demonstrably added new source
content. What the harness *did* fail to do is provide any pressure to stop.
The evidence-sufficiency half of the causal story remains open — which is
precisely why the successor is an **experiment with independently assessed
verdict quality**, not a repair.

| **R5** indexes not reproducible from migrations | are 6 prod indexes absent from Liquibase? | the 6 index names are enumerated in `pg-index-diff-20260624T070800Z/index_delta_db1_to_db2.sql`; the changelogs create only `PHONE_MESSAGE_TOKEN_CODE_PHONE_NUMBER`, `IDX_TOKEN_CODE_IP_CREATED` (MARK_RAN), `IDX_BCALL_PENDING_PHONE`, `IDX_BCALL_PENDING_IP` | some indexes (user_attribute / user_entity) may be created by Keycloak core Liquibase, so "absent from changelogs" ≠ "absent from schema" | **Yes** — verdict at turn 192 | No | **Yes**, with the direction caveat the model applied |
| **R6** OTP retention | are token-code rows purged? | only `insert` for `PHONE_MESSAGE_TOKEN_CODE`; no delete path; retention absent | retention may be handled operationally outside the code path | **Yes** — verdict at turn 64 | No | **Yes** — `CONDITIONAL`/`NARROWED` is a decidable answer |
| **R7** CI does not run tests | does CI skip tests? | job list (build-do, build-roz, watcher image/smoke/build, deployments, freemarker qualify) has **no** Maven test job; `-DskipTests` in the Docker build | the freemarker CI qualify script runs javac-based hermetic tests (not `mvn test`); test-file count is 47, not the 43 asserted in Round B | **Yes** — verdict at turn 177 | No | **Yes** |
| **R8** bootstrap-admin exposure | is a bootstrap admin committed? | the bootstrap-admin reference exists in the repo; the value was read **metadata-only** (no secret printed) | the value's sensitivity depends on whether it is a live credential | **Yes** — verdict at turn 271 | No | **Yes** — decidable from the reference plus commit history |
| **R9** missing NetworkPolicy / PDB / securityContext | are these absent from rendered manifests? | the rendered prod manifest kinds list contains no `NetworkPolicy` and no `PodDisruptionBudget`; the subchart has no default for either | the subchart may not template them at all (different from "defaulted off") | **Yes** — verdict at turn 56 | No | **Yes** |
| **R10** Helm hook ordering / rollback race | can the hooks mis-order or race? | hook annotations on the templates; the profiler watcher job is a pre/post hook | hook ordering is weight-based and deterministic; the race is narrow | **Yes** — verdict at turn 53 | No | **Yes** — `NARROWED` is a decidable answer |

**Supporting detail.** These findings are the model's own recorded
adjudications. The transcript's `thinking` blocks at the cited turns are the
primary source; the ACT republishes only the structural conclusion, never the
underlying command output or file content, because that content may include
credential material.

all_ten_subjects_verdicted=True
readiness_turn_index=271
cost_after_readiness={"output_tokens_after_readiness": 71194,
                      "tool_calls_after_readiness": 202,
                      "turns_after_readiness": 174}
```

**First recorded verdict COVERAGE: transcript turn 271**
(2026-11-21T09:55:18.482Z), the turn at which R8 received its first verdict
assertion.

---

## 2.1 CORRECTION01 F3 — the readiness claim is NARROWED

The parent ACT reported turn 271 as the "earliest independently defensible
synthesis point" and asserted that the necessary evidence was therefore
available for the whole run. **That was a promotion beyond the rubric**, and
this section replaces it.

**What the rubric actually measures.** It detects *the model's own recorded
adjudication language*. It therefore establishes **first recorded verdict
COVERAGE** — the earliest turn at which all ten subjects had some recorded
verdict assertion. It does **not** establish independent factual sufficiency.

**The measurement that shows the promotion was wrong.** The rubric can now
also report per-subject verdict **stability**:

| Subject | First assertion | Stability |
|---|---|---|
| R1 | 153 | `STABLE` |
| R2 | 134 | `REFINED` |
| R3 | 229 | `REFINED` |
| R4 | 221 | `REFINED` |
| R5 | 192 | `REFINED` |
| R6 | 64 | `REFINED` |
| R7 | 177 | `REFINED` |
| R8 | 271 | `STABLE` |
| R9 | 56 | `REFINED` |
| R10 | 53 | `REFINED` |

**8 of 10 subjects** had their first verdict assertion **later refined**
(R2, R3, R4, R5, R6, R7, R9, R10). Only R1 and R8 were stable. A first
assertion that the model itself later refined was, on the model's own
account, **not final** — so its turn is **not** a defensible synthesis point
for that subject.

**CORRECTION02 P1 — the metric was renamed and the overclaim removed.**
CORRECTION01 published `last_stable_coverage_turn = null` and used it to
assert that there is "no turn at which all ten subjects had a verdict that was
never subsequently revised". That did not follow from the measurement: the
metric tested only whether each subject's **first** assertion was revised,
which cannot establish that no **later** point had stable coverage. The
metric is now `first_assertion_stability` and the unsupported conclusion is
withdrawn.

Consequently:

* `all_first_assertions_stable` = **false**;
  `turn_all_first_assertions_stable` = **`null`** — meaning *at least one
  first assertion was later revised*, and **nothing more**. The artifact
  carries an explicit note that a null value does **not** establish that no
  later stable turn exists.
* The companion metric `last_verdict_change_turn` = **638** — the last turn
  at which any subject produced a verdict assertion — is reported instead,
  because it *is* answerable from the trace.
* **Independent readiness is `UNPROVEN`.**
* The parent's "readiness established" phrasing is **withdrawn**.

**What survives.** The readiness analysis still establishes a *bounded and
honest* cost figure: after turn 271 the model performed **174 further turns
/ 202 tool calls / 71,194 output tokens** without submitting. And it still
records the model's own explicit sufficiency statements (turn 634: *"I have
enough for R4"*). What it does **not** establish is that the report could
have been produced correctly at turn 271 — only that the model *believed* it
had enough from turn 271 onward, and kept working.

**Consequence for the causal claim.** The H1 verdict does not rest on
readiness. It rests on the two directly measured facts: the completion route
and the completion obligation were present in **277 / 277** pre-intervention
requests, and the model invoked the route **0** times. The readiness
analysis is now a **supporting** observation, not a load-bearing premise.
