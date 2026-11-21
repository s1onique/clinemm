# causal-discriminators.md — ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-01

> **CORRECTION01 notice.** This file was corrected under
> `ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-CORRECTION01` after expert
> review. Three overclaims were corrected:
>
> * **F1** — "257 compactions" → **257 requests carried a compacted summary;
>   16 compaction EVENTS were observed** (summary-identity changes). The
>   retention conclusion (257/257) is unchanged.
> * **F2** — "novel results ⇒ information gain" → the result tiers are now
>   `EMPTY` / `NONEMPTY` / `CONTENT_DISTINCT`, and `FACTUALLY_NOVEL` is
>   explicitly **unproven**. A separate per-source novelty measurement was
>   added; H4 is downgraded from REFUTED to **INCONCLUSIVE**.
> * **F3** — "readiness established at turn 271" → **first recorded verdict
>   COVERAGE at turn 271**; independent factual sufficiency is **UNPROVEN**,
>   and 8 of 10 subjects' first assertions were later refined.
>
> The H2 and H5 conclusions are **unchanged** and were re-verified.
> Section headings below carry the corrected values inline.

**Verdict in one line:** no harness-owned defect was reproduced. The
autonomous non-completion is best explained by **H1 (model stopping
judgment)**; H4 is **INCONCLUSIVE**, H3 is narrowed to **contract retention
established**, and H2 and H5 are **REFUTED**.

---

## Method note: how each hypothesis was discriminated

Each hypothesis was tested against **the real production boundary**, not
against a reconstruction:

* the **provider-visible request payload** (captured at the `ai_sdk_prompt`
  stage) is the authoritative record of what the model was shown — including
  the **tool schema** and the **completion obligation text**;
* the **session transcript** is the authoritative record of what the model
  emitted and what the harness dispatched;
* the **compaction sidecar** and the **provider requests** are the
  authoritative records of what survived compaction.

Where a relation could not be authoritatively joined, it is labelled
`INFERRED` or `UNAVAILABLE_FROM_TRACE` — never silently assumed.

---

## H1 — Model stopping judgment

> *The model had the evidence and a usable completion route but continued
> choosing tools.*

**Verdict: SUPPORTED — this is the primary cause.**

### Required discriminator

> "show that the necessary evidence, completion instruction and tool
> availability coexisted in the same pre-intervention model-visible state."

This is the one hypothesis the trace can answer **exactly**, because the
provider request capture contains the complete model-visible state.

### Evidence

| Precondition | Evidence | Source |
|---|---|---|
| Tool availability | `submit_and_exit` present in the tool schema of **277 / 277** autonomous provider requests | `provider-request-captures/cap_run_3tw2rDtz_*.json` → `payload.tools` |
| Completion instruction | completion-obligation text present in **277 / 277** autonomous provider requests | same captures → `payload.messages` |
| Necessary evidence | **UNPROVEN** — see CORRECTION01 F3 below | `readiness-probe.json` |
| Opportunity to act | the model emitted a tool call on **277 / 277** autonomous turns, so the tool route was continuously available | transcript, `timeline.jsonl` |

**The decisive observation.** The *observable* preconditions — tool
availability, completion instruction, and opportunity to act — are satisfied
**simultaneously and continuously** in every single one of the 277
pre-intervention requests. There is no turn at which the model lacked the
tool or the instruction.

**CORRECTION01 F3 — what is NOT claimed.** The parent ACT asserted that the
"necessary evidence" precondition also held in all 277 requests, citing a
readiness point of turn 271. That was a promotion beyond the rubric:

* The rubric measures the model's **own recorded adjudication language**. It
  establishes **first recorded verdict COVERAGE at turn 271**, not
  independent factual sufficiency. Independent readiness is **UNPROVEN**.
* The measurement shows why the promotion was wrong: **8 of 10 subjects'
  first verdict assertions were later REFINED** (R2, R3, R4, R5, R6, R7, R9,
  R10). Only R1 and R8 were stable. A first assertion that was later refined
  was, on the model's own account, not final — so its turn is **not** a
  defensible synthesis point for that subject.
* Consequently no turn can be claimed as a point of *defensible* synthesis
  for all ten subjects, and `last_turn_all_ten_verdicts_STABLE` is `null`.

**What survives.** The claim that does **not** depend on readiness is the one
that carries the causal weight: the model had a **working completion route**
and an **explicit completion obligation** in every one of the 277 requests,
and **never invoked it** — not once, and not even on the turns where it
recorded explicit sufficiency. The model's own words confirm it considered
itself to have enough: at turn 634 — 113 turns after it had already
adjudicated R4 — it wrote *"I have enough for R4: the mechanism (rebuild at
startup) is real and is Keycloak's default"*, and at turns 636/638 *"R1 fully
confirmed"* / *"R1 confirmed empirically"*. It kept choosing tools anyway.

**This is why H1 is SUPPORTED but not proved EXCLUSIVE.** H1 requires that
the model had the evidence and continued anyway. The "continued anyway" and
"had a usable completion route" halves are directly measured. The "had the
evidence" half is **not** independently established, so H1 cannot be shown to
be the *only* contributor. H4 is correspondingly INCONCLUSIVE (see below).

### Controls / counterexamples

* **Counterexample checked:** did the model ever *lack* the tool? No — the
  tool schema is byte-stable across all 277 captures (same 9 tools).
* **Counterexample checked:** did the model ever *lack* the instruction? No —
  the obligation text is present in all 277 captures.
* **Control that should NOT fail:** the `command_status` tool was also
  available pre-intervention and the model used it at iterations 29 and 90 —
  showing the model exercises the tools it is given when it wants to, and that
  the schema was not merely present but usable.
* **Control that should NOT fail:** the *same* model, in the *same* session,
  called `submit_and_exit` twice after the operator instruction — proving the
  route was live end-to-end in that same runtime, in that same session, with
  the same schema.

### Why the harness's existing re-prompt never fired

`AgentRuntime.getCompletionReminderMessages()`
(`sdk/packages/agents/src/agent-runtime.ts:2031-2045`) re-injects the
obligation **only when a turn produces zero tool calls**. The historical model
produced a tool call on **every** turn (277/277), so that path was never
taken. The obligation was present, but the harness had **no mechanism to
re-assert it mid-run**.

**This is a genuine structural observation about the harness — but it is NOT a
harness-owned *defect* under this ACT's definition**, because:

1. the completion contract was **exposed** (tool present),
2. the completion contract was **preserved** (through **16 compaction
   events**; 257 / 257 requests carrying a compacted summary retained it —
   CORRECTION01 F1),
3. the completion contract was **enforceable** (a `completesRun` call
   terminates the run — proven by the two post-intervention calls),
4. and the harness's existing conservation guarantees all held.

The missing piece is *pressure to stop*, not a broken completion path. The ACT
forbids introducing "an arbitrary stop-after-N-tools rule", and this ACT does
not propose one.

---

## H2 — Harness completion-contract failure

> *ClineMM failed to expose, preserve or enforce the correct task-completion
> path.*

**Verdict: REFUTED.**

### Required discriminator

> "inspect actual tool schemas, model-visible completion obligations,
> tool-call dispatch and terminal lifecycle events before and after
> intervention. Do not infer the pre-intervention contract solely from
> successful later calls."

This hypothesis is tested **solely** against pre-intervention state. The
post-intervention calls are treated as corroboration only, never as the proof.

### Evidence — expose

| Check | Result |
|---|---|
| `submit_and_exit` in the pre-intervention tool schema | **277 / 277** requests |
| Tool schema stability | identical 9-tool list across all 277 requests: `skills`, `read_files`, `search_codebase`, `fetch_web_content`, `editor`, `submit_and_exit`, `run_commands`, `command_status`, `cancel_command` |
| `submit_and_exit` available from iteration 1 | yes — iteration 1 capture already contains it |

The registration path is intact and was **not** gated off: the host derived
`enableSubmitAndExit = true` (the reminder naming `submit_and_exit` could
only be produced by `getRequiredCompletionToolNames()` finding a registered
`completesRun` tool — `sdk/packages/agents/src/agent-runtime.ts:1791-1799`),
and `runtime-builder.ts:882-886` sets `requireCompletionTool: true` from the
same registration.

### Evidence — preserve

See H3 below: **257 / 257 requests carrying a compacted summary** preserved the
task contract, the runtime completion obligation and the canonical evidence
record. (CORRECTION01 F1: 16 compaction EVENTS, not 257 — the 257 is a request
count.)

### Evidence — enforce

* The tool declares `lifecycle.completesRun = true`
  (`sdk/packages/core/src/extensions/tools/definitions.ts:1241-1243`).
* `findCompletingToolMessage` (`agent-runtime.ts:5106-5123`) terminates the
  run on a **non-error** `completesRun` result.
* The dispatch path is exercised and green at the same source revision:
  `bun x vitest run src/extensions/tools/definitions.test.ts` → **87 passed**,
  exit `0` (`verification/01-production-seam-definitions-test.txt`).

---

## H3 — Compaction-induced progress loss

> *Previously gathered evidence or task obligations ceased to be available
> following compaction.*

**Verdict: NARROWED — contract retention ESTABLISHED; full evidence preservation NOT established.**

### Required discriminator

> "compare canonical evidence, persisted sidecars and provider-visible
> representations across real compaction boundaries."

### CORRECTION01 F1 — the compaction count was wrong

The parent ACT reported **"257 real compaction boundaries"**. That number
counted provider requests whose `messages[0]` was a compacted summary. A
summary **persists** across many requests, so that was a **state** count, not
an **event** count.

The corrected count is derived from authoritative state transitions: a new
compaction **replaces** the summary, so a change in the carried summary's
**identity** is the observable signature of a new compaction.

```
$ python3 tools/compaction-probe.py --capture-dir <private> --out compaction-probe.json
provider requests total                       : 277
requests carrying a compacted summary (STATE) : 257
requests without a compacted summary          : 20
distinct summary generations                  : 16
compaction EVENTS observed (identity change)  : 16
```

**16 compaction events**, across **16 distinct summary generations**, each
generation persisting for 1–38 subsequent requests. The structure is
consistent and verifiable: each generation appears as a base summary, then
reappears once more with the `## Active task contract (authoritative)`
section appended (a 41-byte delta, the task-contract carry-forward applied
to the already-compacted summary). That yields 8 compaction generations ×
2 projections = 16 distinct payloads.

### Evidence — retention (the H3 question)

| Check | Result |
|---|---|
| Requests carrying a compacted summary | **257** |
| Of those, carrying `## Active task contract (authoritative)` | **257 / 257** |
| Of those, carrying the runtime completion obligation | **257 / 257** |
| Of those, carrying the canonical evidence record (`<!-- cline-evidence:begin -->`) | **257 / 257** |

At the first compaction event (iteration 21) the compacted provider request
still contained, byte-for-byte:

* the **user-authored objective** (the full Round C task text),
* the **later user instructions** section,
* the **runtime completion obligation** (the exact reminder template),
* and the canonical verified-tool-outcome record.

The persisted sidecar
(`1795252560069_t82cp.compaction.json`, `source_message_count: 656`,
`source_prefix_hash: sha256:93d20e95…`, `source_last_message_key:
id:msg_NtYmvXtp`) shows the same contract section, with the operator
instruction correctly recorded under "Later user instructions (user authority)".

### What is and is not established

* **ESTABLISHED:** across every request that carried a compacted summary, the
  task contract, the runtime completion obligation and the canonical evidence
  record were all present (257/257). The **contract retention** mechanism did
  not lose the completion obligation or the contract.
* **NOT ESTABLISHED:** that the *canonical evidence* itself was preserved
  **in full** across a compaction. The `<!-- cline-evidence:begin -->` record
  is a bounded projection; the probe verifies its **presence**, not the
  **completeness** of every prior tool outcome. The parent ACT's "no evidence
  was lost" phrasing was stronger than this evidence supports.
* The parent ACT's `0 / 257 summaries lost …` framing was also mis-stated:
  the correct statement is `0 / 257 requests carrying a summary lacked …`.
  The number 257 is unchanged; only its meaning is corrected.

### Note on the excluded shortcut

The ACT instruction says not to reopen the already-qualified stable-prefix
repair without a new contradictory observation. No such observation was found:
the sidecar's `source_prefix_hash` and `source_last_message_key` are intact
and the contract section is present in both the sidecar and every
provider-visible projection.

### Verdict

**NARROWED.** Contract retention is established (257/257). Full evidence
preservation is **not** established. Neither the parent ACT's "REFUTED" nor a
broader "progress was lost" reading is supported.

---

## H4 — Ineffective evidence collection loop

> *The model repeatedly investigated already-resolved questions or changed its
> conclusion without new evidence.*

**Verdict: INCONCLUSIVE** (was: REFUTED — downgraded under CORRECTION01 F2).

### Required discriminator

> "classify redundant tool calls and finding changes by their actual source
> observations. A repeated command alone is not enough; the result must be
> assessed for information gain."

### CORRECTION01 F2 — the classification was too coarse, and so was the inference

The parent ACT used `information_gain = "none" | "content_present"` — a
**NONEMPTY** check — and then treated "186 novel results" as proof that the
post-readiness work was productive. Distinct command payloads and unique
result bodies are **diversity** measurements; they are not proof of new
decision-relevant facts.

The corrected classification separates three mechanically verifiable tiers
from the one that is not:

| Tier | Meaning | Status |
|---|---|---|
| `EMPTY` | no result body | **measurable** |
| `NONEMPTY` | a result body exists | **measurable** |
| `CONTENT_DISTINCT` | the body differs from every other body seen | **measurable** |
| `FACTUALLY_NOVEL` | the read contributed a new decision-relevant fact | **UNPROVEN — requires independent adjudication of R1-R10, which this ACT does not perform** |

### Body-tier measurement (whole autonomous phase)

```
$ python3 tools/novelty-probe.py --session-dir <private> --out novelty-probe.json
body tiers: {"CONTENT_DISTINCT": 342, "EMPTY": 26, "NONEMPTY_DUPLICATE_BODY": 3}
```

| Tier | Count |
|---|---|
| `EMPTY` | 26 |
| `CONTENT_DISTINCT` | 342 |
| `NONEMPTY_DUPLICATE_BODY` | 3 |
| `FACTUALLY_NOVEL` | **UNPROVEN** |

The 26 empty results are dominated by **failed external web fetches** — a
network-restriction artefact. The model detected this itself at turns
600-614 and adapted by reasoning from upstream source code instead.

---

## H5 — Output-budget or generation-boundary effects

> *Output limits, truncation, tool-turn policies or response handling prevented
> successful synthesis or terminality.*

**Verdict: REFUTED.**

### Required discriminator

> "show the relevant limit or boundary actually applied to a pre-intervention
> request. The final assisted response approaching its output limit does not
> independently prove this hypothesis."

### The limit actually applied

| Check | Value |
|---|---|
| `maxOutputTokens` in every autonomous provider request | **16384** (single distinct value across all 277) |
| Autonomous output tokens per turn — max | **3,130** (19.1 % of the limit) |
| Autonomous output tokens per turn — p50 | **380** (2.3 % of the limit) |
| Autonomous output tokens per turn — sum | 129,045 |
| Turns that hit the output ceiling | **0** |
| Truncated / `max-tokens` finish reasons in the autonomous phase | **0** |

The model used at most **19 %** of its output budget on any single
pre-intervention turn. There was no generation boundary anywhere near being
reached.

### The post-intervention control, and why it does *not* support H5

The first post-intervention assistant turn (transcript index 652) used
**16,148** output tokens — 98.5 % of the 16,384 limit. This is the *assisted*
response, and it is exactly the observation the ACT warns must not be used to
prove H5. It is recorded here as a **control**: it shows the model *can* use
the full budget when writing the report, and it confirms the limit was never
the obstacle in the autonomous phase (where the same model wrote at a p50 of
380 tokens/turn for 277 consecutive turns).

Note also the counterfactual this exposes: the autonomous model chose ~380
output tokens per turn — i.e. it was not writing a report, it was writing
*tool-call turns*. The missing report was never *attempted*, so no output
budget was ever spent on it.

### Tool-turn policies

`maxIterations` is the only iteration ceiling in the runtime
(`sdk/packages/agents/src/agent-runtime.ts:1918-1921`). The autonomous run
dispatched 277 iterations and then stopped — but **no** provider request was
issued after iteration 277, and **no** "exceeded maxIterations" error was
recorded in the session. The session's own manifest reports
`status: "completed"`, `exit_code: 0`. The **reason** for the 28 min 50 s
quiescence is `UNAVAILABLE_FROM_TRACE`; it is *not* evidence of a budget
truncation.

### Verdict

**REFUTED.** No output-budget, truncation or generation-boundary effect was
applied to any pre-intervention request.

---

## Combined verdict

| Hypothesis | Verdict | Basis |
|---|---|---|
| **H1** model stopping judgment | **SUPPORTED (primary), not proved exclusive** | tool in schema 277/277 and obligation 277/277; 0 calls emitted; model stated sufficiency at turn 634. The "had the evidence" half is UNPROVEN (F3) |
| **H2** harness completion-contract failure | **REFUTED** (unchanged) | tool in schema 277/277; obligation 277/277; contract retained 257/257; enforcement path green; 0 calls to reject |
| **H3** compaction-induced progress loss | **NARROWED** (was REFUTED) | 16 compaction EVENTS (not 257); contract/obligation/evidence-record retained 257/257; full evidence completeness NOT established |
| **H4** ineffective evidence collection loop | **INCONCLUSIVE** (was REFUTED) | per-source novelty 129/136 reads added new content (redundancy clause strongly evidenced against); unwarranted-change clause unassessed |
| **H5** output-budget / generation-boundary | **REFUTED** (unchanged) | max 3,130 / 16,384 output tokens per autonomous turn (19.1 %); 0 truncations |

**No harness-owned defect was reproduced.** Per the ACT's G4 rules, this
means there is no RED witness to construct for a harness repair, and no
bounded harness-repair ACT may be proposed. The finding is model behaviour
under a completion contract that was exposed, retained and enforceable
throughout — with the explicit caveat that the *sufficiency of the evidence*
is unproven and H4 therefore remains open.

---

## The structural observation that *is* actionable (but is not a defect)

The harness's only mid-run completion pressure is the zero-tool-call
re-injection at `agent-runtime.ts:2031-2045`. A model that *always* calls a
tool never triggers it. This ACT records that as an **observation about the
current contract shape**, explicitly **not** as a defect, and explicitly
**not** as a licence to add a stop-after-N-tools rule (which the ACT forbids
and which would be wrong: the post-readiness work was productive, so cutting
it short would have destroyed value).

The successor proposal in `qualification-report.md` is therefore a
**controlled model-versus-harness convergence experiment**, not a repair.


The 34 non-informative results are dominated by **failed external web
fetches** (`keycloak.org`, `raw.githubusercontent.com`, `github.com`) — a
network-restriction artefact, not an evidence loop. The model detected this
itself at turns 600–614 and adapted by reasoning from upstream source code
instead.

### The stronger, mechanically verifiable measurement: per-source novelty

`CONTENT_DISTINCT` is still only a body-level observation. A stricter and
more defensible measurement is available: for every read attributable to a
**source** (a file path or a URL), compare the normalised lines against the
union of lines already seen from that **same** source. A read that adds no
unseen line is a **pure re-read**; a read that adds unseen lines contributed
**new source content** to that source.

```
source reads: 136 total; 129 added new lines; 7 were pure re-reads
total new distinct lines added: 4388
distinct sources read: 50
```

| Measure | Value |
|---|---|
| Source-attributable reads | 136 |
| Reads that added >=1 previously-unseen line from that source | **129** |
| Pure re-reads (no new line from that source) | **7** |
| Total new distinct lines added | **4,388** |
| Distinct sources read | 50 |

### Why H4 is nevertheless INCONCLUSIVE rather than REFUTED

The per-source measurement is strong evidence against the *literal* form of
H4 — "the model repeatedly investigated already-resolved questions" — because
re-reading the same source overwhelmingly added new content rather than
re-deriving the same facts (only 7 of 136 reads were pure re-reads).

But H4 has a second clause: *"or changed its conclusion without new
evidence"*. Settling that clause requires judging whether each verdict
change was warranted by the new evidence — which is an **independent
adjudication of R1-R10** and therefore **out of scope for this ACT**. The
verdict-class trajectory (CORRECTION01 F3) shows the model *did* change
conclusions for 8 of 10 subjects after their first assertion; whether those
changes were evidence-driven is **not established here**.

**Verdict: INCONCLUSIVE.** The redundancy clause is strongly evidenced
against; the unwarranted-change clause is unassessed. The parent ACT's
"REFUTED" was stronger than the evidence supports.

* Existing coverage `sdk/packages/core/src/runtime/host/local-runtime-host.test.ts:8262-8490`
  pins `task.completed` with `source=submit_and_exit`, the `source=shutdown`
  fallback, exactly-once emission, and no duplicate after shutdown.

### Evidence — the thing that is *not* a defect

There were **zero** pre-intervention `submit_and_exit` calls. Nothing was
dispatched, so nothing could be rejected. There is no dropped call, no
malformed call, no timed-out call, and no tool-authorization refusal in the
autonomous phase. A harness cannot reject a call that was never made.

### Verdict

**REFUTED.** Every sub-clause of the hypothesis — expose, preserve, enforce —
holds at the real production boundary. The contract was fully live.

choosing tools anyway.
