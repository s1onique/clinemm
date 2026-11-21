# causal-discriminators.md — ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-01

**Verdict in one line:** no harness-owned defect was reproduced. The
autonomous non-completion is best explained by **H1 (model stopping
judgment)**, with H5 and H4 excluded and H3 refuted at the artifact level.

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
| Necessary evidence | all ten subjects had a recorded verdict assertion by turn 271 | `readiness-probe.json` |
| Opportunity to act | the model emitted a tool call on **277 / 277** autonomous turns, so the tool route was continuously available | transcript, `timeline.jsonl` |

**The decisive observation.** All three preconditions are satisfied
*simultaneously and continuously* — not merely at some point — in every single
one of the 277 pre-intervention requests. There is no turn at which the model
lacked the evidence, the instruction, or the tool.

**The model's own words confirm it had enough.** At turn 634 — 113 turns after
it had already adjudicated R4 — the model wrote *"I have enough for R4: the
mechanism (rebuild at startup) is real and is Keycloak's default"*, and at
turns 636/638 *"R1 fully confirmed"* / *"R1 confirmed empirically"*. It kept

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
2. the completion contract was **preserved** (through 257 compactions),
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

See H3 below: 257 / 257 compaction summaries preserved the obligation.

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

**Verdict: REFUTED at the artifact level.**

### Required discriminator

> "compare canonical evidence, persisted sidecars and provider-visible
> representations across real compaction boundaries."

### Real compaction boundaries identified

The autonomous run compacted **257 times**. Real boundaries are directly
observable in the provider requests: `messages[0]` becomes a
`Context summary:` user message and the message count drops (e.g. iteration
103 → 104: **55 → 17** messages).

### Evidence

| Check | Result |
|---|---|
| Compaction summaries inspected | **257** (iterations 21…277) |
| Summaries **missing** the `## Active task contract (authoritative)` section | **0** |
| Summaries **missing** the runtime completion obligation | **0** |
| Summaries carrying the canonical evidence record (`<!-- cline-evidence:begin -->`) | **yes** (verified at iteration 104) |
| Provider requests lacking the obligation text anywhere | **0 / 277** |
| Provider requests lacking the task-contract section | 20 (iterations 10–20, i.e. **before** the first compaction — not a loss) |

At the first real boundary (iteration 104) the compacted provider request
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

### Note on the excluded shortcut

The ACT instruction says not to reopen the already-qualified stable-prefix
repair without a new contradictory observation. No such observation was found:
the sidecar's `source_prefix_hash` and `source_last_message_key` are intact
and the contract section is present in both the sidecar and every
provider-visible projection.

### Verdict

**REFUTED.** Evidence and task obligations were fully preserved across every
real compaction boundary.

---

## H4 — Ineffective evidence collection loop

> *The model repeatedly investigated already-resolved questions or changed its
> conclusion without new evidence.*

**Verdict: REFUTED.**

### Required discriminator

> "classify redundant tool calls and finding changes by their actual source
> observations. A repeated command alone is not enough; the result must be
> assessed for information gain."

### Whole autonomous phase

| Measure | Value |
|---|---|
| Tool calls | 371 |
| Distinct command payloads | **369** |
| Payloads executed more than once | 2 |
| Tool results that were empty (no information) | 34 |
| Tool results with content | 337 |
| **Non-informative results (empty or exact normalised duplicate)** | **34 / 371 = 9.2 %** |

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
| **H1** model stopping judgment | **SUPPORTED (primary)** | tool + instruction + evidence coexisted in 277/277 pre-intervention requests; 0 calls emitted; model stated sufficiency at turn 634 |
| **H2** harness completion-contract failure | **REFUTED** | tool in schema 277/277; contract preserved 257/257; enforcement path green; 0 calls to reject |
| **H3** compaction-induced progress loss | **REFUTED** | 0/257 summaries lost the contract or obligation |
| **H4** ineffective evidence collection loop | **REFUTED** | 369/371 distinct payloads; post-readiness 202/202 distinct, 186 novel results |
| **H5** output-budget / generation-boundary | **REFUTED** | max 3,130 / 16,384 output tokens per autonomous turn (19.1 %); 0 truncations |

**No harness-owned defect was reproduced.** Per the ACT's G4 rules, this
means there is no RED witness to construct for a harness repair, and no
bounded harness-repair ACT may be proposed. The finding is model behaviour
under a fully functional completion contract.

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

### After the readiness point (turn 271) — the decisive window

| Measure | Value |
|---|---|
| Tool calls | 202 |
| Distinct command payloads | **202 / 202** |
| Payloads executed more than once | **0** |
| Results with novel content | **186** |
| Results that were an exact repeat | **1** |
| Results that were empty | 15 |

**Zero repeated commands and 186 novel results.** The post-readiness work was
*productive*, not redundant. This is the single most important reason the ACT
does **not** attribute the 2 h 47 m to a harness-side evidence-collection
defect: the harness was not forcing the model to re-answer settled questions.

### Finding changes

Verdict assertions changed state for all ten subjects across the run, and new
ones kept appearing in every 50-turn window to the end (§ 4.2 of
`readiness-analysis.md`). The model's conclusions were *refined with new
evidence*, not changed without it.

### Verdict

**REFUTED.** The evidence-collection loop was effective. The model was not
re-litigating settled questions; it was deepening the record.

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
