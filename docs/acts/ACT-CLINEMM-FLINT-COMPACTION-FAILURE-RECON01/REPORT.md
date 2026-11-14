# ACT-CLINEMM-FLINT-COMPACTION-FAILURE-RECON01 — REPORT

> ## ⚠️ SUPERSEDED IN PART — SEE `CORRECTION01.md`
>
> **This report's primary verdict `EXPECTED_ACCOUNTING_DIFFERENCE` and its
> finding "no compaction was ever skipped in this session" are WITHDRAWN.**
>
> A bounded evidence correction (`CORRECTION01.md`, same directory) establishes:
>
> * the "Compaction skipped" screenshot **belongs to this session**
>   (`1794617111057_i279p`), not to another one — its `28:50 Working` counter
>   places it at 01:14:01Z, 170 s into the closed 01:11:11Z→01:16:18Z window
>   that contains the **third** summarizer attempt;
> * that third attempt was a **`compaction-skipped`**, not a success — the
>   `previousSummary` carried by attempt 4 is byte-identical to attempt 3's,
>   proving attempt 3's result was discarded;
> * the rendered UI label ("Compaction skipped") is produced from a
>   `{"status":"skipped"}` JSON payload, so `grep -rl 'compaction-skipped'`
>   **cannot** establish that no skip was displayed — the inference this
>   report relied on is invalid;
> * the trigger accounting compared provider token counts (P) against an
>   estimator threshold; on the production comparison (W vs. the scaled
>   trigger), **no** boundary crossed the trigger;
> * Probe D's "obligation survived via the preserved tail" is **false** — the
>   cited indices 26–27 precede the cut at 163, and the obligation is absent
>   from the tail, the summary, the system prompt, and the 48-message
>   projection sent to the provider.
>
> **Unchanged:** the W/P estimator-bias analysis, the 8,192-token summarizer
> cap, the no-fallback contract analysis, H5 (misspelled-root propagation,
> 10 ENOENT reads, ≈3.2 min recovery cost), the wall-clock attribution, and
> the manual-vs-basic compaction comparison. Read this report together with
> `CORRECTION01.md`; where they conflict, **`CORRECTION01.md` governs**.

**Primary verdict: `EXPECTED_ACCOUNTING_DIFFERENCE`** *(WITHDRAWN — see the
correction banner above and `CORRECTION01.md` §7.3)*

The W/P/B token-accounting difference is fully explained by valid accounting domains and **no
accounting-contract defect reproduces**. The run's compaction behaviour was **correct**: all three
substantive compaction attempts succeeded, the persisted sidecar projected correctly, and no
compaction was ever skipped in this session. The 96K Agentic run's failure to finish is
**model-generated continuation behaviour (H6)**, not a ClineMM compaction-orchestration defect.

**No production repair is warranted.** No successor repair ACT is proposed. See §10.

---

## 1. Entry, identity and repository state

| Item | Value |
|---|---|
| Repository | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm` (`git@github.com:s1onique/clinemm.git`) |
| Branch | `main` |
| Entry HEAD | `753f4adad282ad81384065cb9a1a057702ba6f61` — *"fix(core): conserve cross-locator read freshness"* |
| Expected predecessor | `753f4adad282ad81384065cb9a1a057702ba6f61` — **identical to HEAD**; ancestor check: YES; diff: none |
| Final HEAD | `753f4adad282ad81384065cb9a1a057702ba6f61` (unchanged — this ACT is reconnaissance only) |
| Worktree | CLEAN at entry; only the new `docs/acts/ACT-CLINEMM-FLINT-COMPACTION-FAILURE-RECON01/` added; **zero TypeScript modifications** |
| `stash@{0}` | Preserved verbatim: `WIP on main: d46223b51 fix(completion-continuation-stall-lifetime): …` (stash count = 1) |

### Installed runtime identity — **VERIFIED**

```
~/.vscodium-roz/extensions/s1onique.clinemm-4.1.16-5a1c485cb-753f4adad/
  package.name    = clinemm
  package.version = 4.1.16-5a1c485cb-753f4adad
  package.main    = ./dist/extension.js
```

The exported version string **embeds the source commit** `753f4adad`, which is exactly the repo
HEAD and exactly the expected predecessor. The installed runtime is therefore **this source tree**,
not an unknown build.

Belt-and-braces confirmation against the shipped bundle `dist/extension.js` (27,407,264 bytes,
sha256 `9f0fa35d85e46059…`): the compiled agentic-compaction code is byte-identical in behaviour
to `sdk/packages/core/src/extensions/context/agentic-compaction.ts`, including the exact
production strings *"Skipped agentic compaction: summarizer returned no summary text"*,
*"output_budget_consumed_by_reasoning"* and *"Skipped agentic compaction: summarizer budget
exhaustined"*. **Installed path confirmed before drawing runtime conclusions.**

### Evidence inventory (authoritative sources actually consumed)

| Source | Role |
|---|---|
| `~/.vscodium-roz/cline-data/sessions/1794617111057_i279p/*.messages.json` (1,199,385 B, sha256 `02c5a312…`) | canonical transcript, 207 messages |
| `…/1794617111057_i279p.compaction.json` (47,556 B, sha256 `2cba633c…`) | compaction sidecar |
| `…/1794617111057_i279p.json` | session manifest (`status: "cancelled"`, `ended_at 01:31:29.300Z`) |
| `~/.cache/kapitsa/logs/serve-8000.log` (90,990 B, sha256 `b0ff7776…`) | **provider-side** request log: prompt tokens, cache tokens, output tokens, finish reason, timings |
| `~/Downloads/cap_run_*.json` (71) + `~/Downloads/cap_86d49c*.json` (5) | provider-request captures (full payloads) |
| `~/.vscodium-roz/cline-data/globalState.json`, `settings/models.json`, `settings/providers.json` | actual run settings |
| `~/.vscodium-roz/cline-data/diagnostics/myc-evaluation/1794617111057_i279p/events.jsonl` | evaluation events |

The `~/Downloads` copies of the transcript and sidecar are **hash-identical** to the profile copies.
Full paths, sizes, hashes and mtimes: `evidence/identity.txt`.

---

## 2. Compaction chronology — five attempts, three successes, zero skips

Every value below is read from the Kapitsa server log and cross-checked against the canonical
transcript's assistant `metrics.inputTokens` / `cacheReadTokens` (verified to match for **71/71**
main requests).

| # | Kapitsa line | Summarizer request P | Output tokens | Provider finish | Outcome |
|---|---|---|---|---|---|
| 1 | 321 | 1,844 | 4,396 | `stop` | **SUCCESS** — next main request P drops 68,859 → 16,769 |
| 2 | 339 | 3,100 | 5,924 | `stop` | **SUCCESS** — next main request P drops 70,499 → 19,804 |
| 3 | 365 | 3,139 | **8,192** | **`length`** | Truncated but **accepted**; superseded by attempt 4 (this attempt's trigger request was P = 64,957) |
| 4 | 367 | 3,403 | **8,192** | **`length`** | Truncated but **accepted and persisted** — sidecar written; trigger request P = 75,341; next main request P drops 75,341 → 14,670 |
| 5 | 387 | 2,707 | 3,870 | `cancelled` | **User abort** at 01:29:27 — not a compaction failure |

Full 22-field classification (mode, strategy, trigger, summarizer sent, summary returned,
parse/validation, basic fallback, usable result, state persisted, projection applied):
`evidence/compaction-attempts.tsv`.

* Mode: `auto` for all five.
* Strategy requested and executed: `agentic` for all five. Proven: `buildSummaryRequest` is
  referenced **only** by `agentic-compaction.ts` (`basic-compaction.ts` makes no LLM request at
  all), and the captured summarizer payloads are in `buildSummaryRequest` format. The profile's
  `global-settings.json` has no `compactionStrategy`, so the global default `agentic`
  (`global-settings.ts:274-276`) applied.
* Effective model and summarizer provider: `flint:16gb` / `openai-compatible`
  (`http://127.0.0.1:8000/v1`) for both the main requests and the summarizer requests — the
  summarizer used the *active* provider, not a separate one.

### The meaning of the observed `compaction-skipped`

**This session never produced a `compaction-skipped`.**

* `grep -rl 'compaction-skipped'` over the entire `~/.vscodium-roz/cline-data/` tree returns
  **nothing**; the string is absent from this session's transcript, sidecar, manifest and
  evaluation events.
* The production path that emits it is `compaction.ts:801-822`: it fires **only** when the
  strategy returned `undefined` (i.e. `result?.messages` is falsy), and it is tagged
  `reason: "no_result"`.
* In this session every attempt returned a usable result, so the branch was never entered.

**Conclusion:** the screenshot's "skipped" label belongs to a **different session**, not to
`1794617111057_i279p`. Under this ACT's §3.1 taxonomy, the skipped-compaction boundary **did not
occur** in the investigated run, so none of the eight skip categories apply to it.

---

## 3. The `length` events — explained exactly

The two `length` rows are the **summarizer** requests, not the main requests.

| Property | Value | Evidence class |
|---|---|---|
| Raw finish reason | `length` | Kapitsa serve log (provider-side) |
| Normalized finish reason | `max-tokens` | `ai-sdk.ts:1026-1042` `mapFinishReason("length") → "max-tokens"` |
| `incompleteReason` | `max_tokens` | `compat.ts:591-603` |
| Output tokens produced | **exactly 8,192** (both attempts) | Kapitsa serve log |
| Effective output cap | **8,192** = `DEFAULT_SUMMARY_MAX_OUTPUT_TOKENS` | `compaction-shared.ts:34` |
| Requested `max_tokens` as sent on the wire | **`UNAVAILABLE_FROM_TRACE`** | Kapitsa logs completion, not the request body; no summarizer request-body capture exists |
| Generated text vs reasoning tokens | text present and non-empty; reasoning share not separately reported by the provider | Kapitsa log reports only the aggregate output token count |
| Provider's configured response limit | Kapitsa's own server-side cap; not exposed | `UNAVAILABLE_FROM_TRACE` |

**The upstream-reported 1,024-token limit does not apply to this fork.** The effective cap is
8,192, established independently of the wire value: `resolveSummaryMaxOutputTokens()`
(`compaction-shared.ts:813-827`) returns `min(DEFAULT_SUMMARY_MAX_OUTPUT_TOKENS, modelInfo.maxTokens)`
when no explicit `maxOutputTokens` is configured, and `flint:16gb` reports no `maxTokens`, so the
8,192 default applies unchanged. Both attempts terminated at exactly 8,192 tokens, which confirms
the resolved cap empirically.

### Why the truncation did not skip the compaction

The production acceptance gate for the agentic strategy is `agentic-compaction.ts:202-220`:

```ts
const rawSummary = summaryResult.text.trim();
if (!rawSummary) { /* log "…returned no summary text"; return undefined */ }
```

It rejects **only emptiness**. It does **not** inspect `incompleteReason`. A `length`-truncated
response carrying 8,192 tokens of text is non-empty, so it was **accepted**.

This is confirmed end-to-end by observation, not by inference:

* the request immediately following attempt 4 (iteration 47, 01:18:03.567Z) has **3 messages** and
  opens with `"Context summary:\n\n## Continuation Note …"` — i.e. it carried the compacted
  projection;
* the persisted sidecar (`updated_at 2026-11-14T01:18:03.500Z`) contains that same summary and
  `metadata.tokensBefore = 103440`.

Note the contrast with the **CLI** path `summarize-conversation.ts:163-172`, which *does* reject
on `incompleteReason`. The extension used the agentic path, so that stricter gate never applied.
This divergence is real but is **not** what went wrong here.

### Fallback boundary — proven contract

`compaction.ts:659-681`:

* The agentic → basic fallback is a **catch** block. It fires only when `runBuiltinStrategy`
  **throws** (and the strategy is `agentic`, and the error is not a cancellation).
* It does **not** fire when the agentic strategy **returns `undefined`** (empty summary text,
  budget exhaustion, `cutIndex <= 0`). In that case: no fallback, no projection, no persisted
  state, canonical and projected histories unchanged, and the trigger is re-evaluated on the next
  iteration — i.e. the attempt is retried.
* In this run the fallback **never executed**: no summarizer request errored. The five finishes
  were `stop` (2), `length` (2), `cancelled` (1).

A `length` response and a later skip are therefore **not** causally connected here, and the
question does not arise: **no skip occurred**.

---

## 4. W / P / B accounting

Three separate authorities, kept separate.

### W — working-context estimate

Traced `estimateRequestInputTokens` → `prepareTurn` → `currentWorkingContextEstimate` →
extension state → `TaskHeader`:

* Producer: `compaction.ts:1026-1040` (`publishWorkingContextEstimate`) and `:1087-1118`
  (`publishWorkingContextEstimateMetadataOnly`) — both call the canonical estimator
  `estimateRequestInputTokens({systemPrompt, messages, tools})`
  (`sdk/packages/shared/src/llms/tokens.ts:94-129`).
* The consumer: `agent-runtime.ts:3951-4125` copies the value **verbatim** into
  `state.currentWorkingContextEstimate` and fails closed to `undefined` when the producer omits it.
* The estimator is `ceil(jsonChars / 3)` (`CHARS_PER_TOKEN = 3`), i.e. a deliberate **over**-count.
* W therefore **includes** tool schemas and the system prompt, and reflects the *final returned
  request shape* (post-compaction), not the pre-compaction transcript.

### P — provider input tokens

Kapitsa's `chat: prompt N (cached M)`, verified identical to the canonical transcript's assistant
`metrics.inputTokens` / `cacheReadTokens` for **71/71** main requests.

**Kapitsa's prompt count includes cached input. Cached tokens are never subtracted.** The
`noncached` column in the evidence is informational only.

### B — compaction budget

| Field | Value |
|---|---|
| `userContextCeiling` | **ABSENT** → Auto |
| Model metadata (actual) | `contextWindow = 256000`, `maxInputTokens` absent |
| `resolveEffectiveMaxInputTokens` | `256000 × 0.9` = **230,400** |
| `applyUserContextCeiling(230400, undefined)` | **230,400** |
| Effective max input tokens | **230,400** |
| `COMPACTION_TRIGGER_RATIO` | 0.9 → trigger = **207,360** |
| Auto target tokens | `floor(207360 × 0.7)` = **145,152** |
| Budget provenance | `context_window_derived` (model reported no `maxInputTokens`) |
| `tokensBefore` at the persisted boundary (sidecar) | **103,440** |

**The operator's 96,000-token ceiling was NOT active for this run.** Had it been set, the
effective ceiling would have been 96,000 and the trigger 86,400.

### The matched-request discriminator (boundary #3b — the persisted sidecar)

| Quantity | Value |
|---|---|
| W (actual captured provider request, iteration 46) | 93,917 |
| Request identity (canonical assistant message id) | `msg_R54EA2v` + `P` |
| P (Kapitsa prompt tokens for that request) | 75,341 |
| P cached | 65,518 (non-cache-read 9,823) |
| B (sidecar `tokensBefore`) | 103,440 |
| W / P | **1.247** |
| B / P | **1.373** |

Across all 71 main requests the W/P ratio is **1.223 – 1.358** — a *constant* estimator bias,
not drift, and not a wrong-authority bug. The estimator intentionally over-counts at 3 chars/token
for this YAML/Go/Helm-heavy corpus.

**One important correction to a tempting reading.** A W/P ratio near **4.0** appears if W is
computed from the *raw canonical transcript* (343,940 est. tokens for the 163-message prefix vs
P = 75,341). That figure is **not** the live W. The provider request at that boundary was
**59 messages / 264,964 bytes** (`cap_run_UyTw6PKK_46`), not the canonical 163 messages /
1,031,818 bytes: the request the provider received was already the *compacted projection* plus
MessageBuilder projection. W computed from the raw canonical file measures a different object
and must not be compared to P. **H4 (context counter uses wrong authority) is rejected for the
live path.**

**Verdict on the accounting: `EXPECTED_ACCOUNTING_DIFFERENCE`.** W and P are different
authorities measuring different things (runtime estimate vs provider tokenizer); B is the same
estimator family as W; the gaps are stable, bounded and explained. **No accounting-contract
defect reproduces.** No token-estimation constant was changed.

Full table: `evidence/token-authorities.tsv`.

---

## 5. Continuation-summary fidelity

Source: sidecar `source_message_count = 163`, `source_prefix_hash = sha256:17bfe0d8…`,
`source_last_message_key = id:msg_dPCWFjbg`, compared against canonical `messages[0..162]`.

### Groundedness matrix

| Field | Verdict | Evidence |
|---|---|---|
| Task objective | **Preserved semantically, not verbatim** | summary states "Investigate the Keycloak-based project at …; no files modified."; the literal question "What does this project do?" is **not** reproduced |
| Read-only constraint | **Preserved** | "no files modified" in Goal; "No files edited." in Highlights; `details.modifiedFiles = []` |
| Canonical repository root | **WRONG in 8 of 11 listed paths** | summary uses `<home>/Users/**chistryakov**/…`; correct root is `<home>/Users/chistyakov/…` |
| Completed work | **Supported** | README, structure, both Helm charts, CI, compose, `.env`, startup — all present in the source prefix's tool inputs |
| Remaining work | **Actually unfinished** | "Complete `.gitlab-ci.yml` stage/job inspection…" — the prefix still has open CI reads at idx 201/203 |
| Previously failed operations | **Not falsely reported successful** | the two `zsh:1: unmatched "` failures are not claimed to have succeeded |
| File paths | **Mixed; traceable to source** | `chistryakov` ×8, `.gitignore_placeholder_never_used` ×1 |
| Terminal completion obligation | **Not in the summary; present elsewhere** | see Probe D below |
| Project findings | **Supported** | ROZ/roznanie.ru + DO/znanierussia.ru, keycloakx, profiler watcher, external-secrets, ingress — all in the inspected files |
| Tool-result references | **No fabricated provenance** | every cited path exists in the source prefix's tool inputs |

### Provenance of the "misspelled paths" and the "placeholder filename"

**These are not summarizer inventions.**

* `chistryakov` appears **279 times** in the 163-message source prefix (earliest at canonical
  idx 59, `msg_mS1-n7i2`). The summarizer reproduced an error already present in its input.
* `.gitignore_placeholder_never_used` appears **3 times** in the source prefix (earliest at
  canonical idx 108, `msg_TcQji10j`) and once in the summary.

The summarizer is **not** penalised for either. Separation of causes:

* newly invented summary claims — **none found**
* errors copied from prior model output — the root typo and the placeholder filename
* incorrect tool results — **none found in the summary**
* information dropped during summarization — the literal task question; the exact username
  directory; the two failed shell invocations
* still available elsewhere in the resumed context — the completion obligation (Probe D)

### Progress conservation

| Metric | Value |
|---|---|
| Tool calls before the sidecar cut (idx 0–162) | 70 |
| Tool calls after the cut (idx 163–206) | 44 |
| Distinct read paths before / after | 12 / 18 |
| Read paths repeated after compaction | 5 |
| Repeated commands (identical) | 1 |
| **Failed attempts caused by incorrect paths** | **10 ENOENT reads** (all 5 repeated read paths) |
| New useful source coverage after the cut | 6 additional distinct paths + 4 new CI sections |

**The repeated reads are not wasteful range reads — every one of them failed.** All five repeated
paths use the misspelled `chistryakov` root; the observed tool result was

```
"Error reading file: ENOENT: no such file or directory, stat '.../chistryakov/.../values.yaml'"
```

Recovery cost after the sidecar boundary (01:18:03 → 01:21:13): idx 172 (misspelled read_files →
ENOENT on 10 paths) → idx 174 (`pwd` + `ls` of the home root) → idx 176 (`pwd`) → idx 179
(same values files via relative paths → success). **≈ 3.2 minutes and 4 model requests** spent
rediscovering the repository root. The continuation then added **genuinely new** coverage
(`.helm/*/templates/*`, `.roz-themes/.env`, `Chart.lock` files, `startup.sh`, CI sections
1–60 / 60–130 / 216–320 / 1630–1760) — it did not merely re-tread old ground.

### Completion readiness — **H6, model-generated continuation behaviour**

At the sidecar boundary (01:18:03) the original requirements were **already substantially
satisfied** by observable evidence. The model's own recorded reasoning confirms it:

* idx 201: *"Now, the final deliverable. I think I should now write the comprehensive final
  summary of the investigation and submit it."*
* idx 203: *"I now have a comprehensive picture. … Now write the final answer: …"*

— and it nevertheless issued **8 further tool calls** instead of synthesising, ending with a
username-directory probe (idx 203) and a `pwd` (idx 205) that the transcript shows was
unnecessary.

Classification per ACT §5.3: **Model-generated continuation behaviour.** Explicitly **not**:

* *compaction-induced information loss* — the goal subject, the read-only constraint and the
  completion obligation all remained reachable, and the model's own reasoning shows it knew it had
  enough material;
* *insufficient completion instruction* — Probe D shows the obligation survived;
* *runtime completion-gating defect* — **no completion-gate event fired at all**; the run ended
  by **user abort**, not by a gate rejecting a finished answer;
* *unresolved without a controlled discriminator* — the discriminator is available and was run.

**Remaining uncertainty (stated explicitly):** the model's internal decision process cannot be
inferred from chronology alone. This classification rests on the model's **own recorded
reasoning text** plus the observable **absence of a completion attempt**, not on an inference from
timing.

Full detail: `evidence/summary-fidelity.txt`.

---

## 6. Executed discriminators

| Probe | Question | Result |
|---|---|---|
| **A** | Can the real budget/trigger resolver reproduce the captured decision? | **PASS.** Effective ceiling 230,400; trigger 207,360; target 145,152; 96K counterfactual (ceiling 96,000 / trigger 86,400) reproduced. Not `HALT_POLICY_NOT_REPRODUCED`. |
| **B** | What does the captured summarizer response produce through the real result-handling path? | The captured `length` responses produce a **valid, accepted summary** — not a skip, not an exception, not a fallback. A synthetic empty-text control shows the *empty* class (not the truncated class) is what would emit `compaction-skipped`. |
| **C** | Does the sidecar project and restore deterministically? | Projection **succeeds**, is byte-identical on re-projection, has **zero orphaned tool_result** blocks, and preserves the tail. The recomputed `source_prefix_hash` **differs** from the stored one because the hash input includes `metrics`/`modelInfo` and the sidecar was written mid-run while the on-disk transcript was re-serialised afterwards — a documented property of the v2 hash, not a defect. The literal task objective **is lost** from the projection. |
| **D** | Does the terminal-completion obligation survive compaction? | **YES** — `summaryCarriesIt = false`, `tailCarriesIt = **true**`, `systemPromptCarriesIt = false`. The obligation survived **through the preserved canonical tail**. No failing production-seam reproduction, therefore **no additional completion-instruction patch is warranted**. |

Detail: `evidence/discriminators.txt`.

---

## 7. Hypothesis evaluation

| Hypothesis | Verdict | Basis |
|---|---|---|
| **H1** summarizer output truncated | **PARTIALLY TRUE, NOT THE FAILURE CAUSE** | 2 of 5 responses truncated at 8,192 tokens (`finish_reason=length`), but the text was non-empty and **accepted**; the compaction succeeded and the projection applied |
| **H2** agentic fallback fails | **REJECTED** | the fallback is a catch block; no summarizer request threw; it was never entered |
| **H3** incorrect effective context ceiling | **REJECTED** | the ceiling in force was the model's own 230,400 (Auto); the 96K value was inactive and would not have moved the trigger anyway (86,400 > all three observed provider counts) |
| **H4** context counter uses wrong authority | **REJECTED for the live path** | W/P is a stable 1.223–1.358 across 71 requests; the ~4.0 figure comes only from measuring the raw canonical transcript, which is not the request the provider received |
| **H5** compaction summary damages continuation | **SUPPORTED AS A CONTRIBUTOR, NOT ROOT CAUSE** | the summary propagated the misspelled root → 10 ENOENT reads → ≈3.2 min / 4 requests of rediscovery; and dropped the literal task question. But the error originated upstream (279 prior occurrences) and the model recovered via relative paths |
| **H6** Flint independently continues unnecessary research | **SUPPORTED — PRIMARY** | obligation present after compaction, evidence base already sufficient (model's own idx-201/203 reasoning), 8 further tool calls issued instead of synthesising |
| **H7** Kapitsa long-context latency dominates | **PARTIALLY TRUE, NOT THE FAILURE CAUSE** | 98.8% of wall clock is provider request elapsed, but latency did not cause the non-completion — the run was cut short by the **user abort** |

Multiple hypotheses coexist. **H6 is primary; H5 is a real secondary cost.**

---

## 8. Wall-clock attribution

Non-overlapping attribution derived from canonical transcript timestamps (assistant response time
minus preceding tool-result time), cross-checked against the Kapitsa log.

| Label | Seconds | Share |
|---|---:|---:|
| `REQUEST_ELAPSED` | 2,621.9 | 98.8% |
| `TOOL_EXECUTION` | 31.9 | 1.2% |
| `COMPACTION_ELAPSED` | included in `REQUEST_ELAPSED` (5 summarizer requests: 701.8 s of provider time) | — |
| `UNATTRIBUTED_GAP` | **0.0** | 0.0% |
| Total (sum) | 2,653.8 | vs. session span 2,656.4 s |

Provider-side split inside the session window (76 Kapitsa rows): prefill 601.3 s, decode 2,068.8 s.
Main requests 1,968.3 s; summarizer requests 701.8 s.

The three longest single requests were the two `length` summarizer generations
(140.8 s and 104.4 s decode) and the main request `msg_R54EA2v_P`
(53.4 s prefill + 108.5 s decode) — i.e. the run's latency was dominated by long-context
prefill/decode on a 4-slot local Apple-M3-Max server, **not** by tool execution.

**Historical baselines (context only, not a controlled comparison):** the sibling sessions
`1794609208867_ks9o6` (ended 00:44:55, `status: failed`), `1794606517194_x1js5`
(`failed`) and `1794599235421_7adcr` (`failed`) **all also failed**. Their settings, turn counts,
cache state and source versions are not matched to the 96K run, so **no claim is made that a 96K
ceiling is intrinsically slower** — that comparison is uncontrolled.

---

## 9. Basic-compaction alternative (analytic, not enabled)

Not enabled anywhere during this ACT — it is a finding, not an assumption.

| Property | Basic | Agentic (observed) |
|---|---|---|
| Output size | deterministic, bounded by `totalTargetTokens` | model-dependent (observed 4,396 / 5,924 / 8,192 output tokens) |
| Determinism | **fully deterministic** | non-deterministic; here it produced a summary with a **wrong repository root** in 8/11 paths |
| Tool-pair correctness | preserved by construction (`isSafeCutBoundary`, `buildBudgetProjection`) | preserved (Probe C: zero orphans) |
| Original task preservation | typed prompts always survive verbatim; the concluding assistant answer of older turns is kept | the literal first-turn question was **dropped** in this run |
| Known-fact preservation | file/command inventory only — no semantic findings | semantic findings preserved (two tenants, keycloakx, profiler watcher) **but** the root typo was propagated |
| Post-compaction request size | bounded by the target; measured 19,804 and 16,769 in the two observed agentic outcomes | same order |
| Information discarded | all narrative findings, all reasoning | reasoning and, here, the literal question |

Basic compaction would have eliminated the LLM summarization request entirely — removing both
`length` events and ~701.8 s of provider time — but would have discarded the semantic findings
that the task actually asked for ("explain its purpose, major subsystems, production behavior…
"). Its suitability for this workload is therefore **not** established, and no global change is
warranted.

---

## 10. Closure decision — one bounded next action

**Primary verdict: `EXPECTED_ACCOUNTING_DIFFERENCE`.**

The W/P/B differences are explained by valid accounting domains, and no accounting-contract
defect reproduces. Separately recorded:

1. **No compaction was skipped** in this session; the screenshot's "skipped" belongs to another
   session.
2. **The two `length` events were summarizer-output truncation at the fork's effective 8,192-token
   cap**, and they **did not** cause the compaction to fail — the truncated text was accepted and
   both compactions succeeded.
3. **The continuation failed to finish because the model kept researching after it had already
   decided it had enough** (H6), at a cost amplified by a misspelled repository root propagated
   from the summary (H5).

### Why no repair is proposed

The one candidate repair — *reject a `length`-truncated summarizer response and fall back to basic
compaction* — was evaluated against a necessity/ablation check:

* **existing behaviour**: a length-truncated summarizer is accepted; the projection carries the
  truncated summary; the next request shrinks (75,341 → 14,670, observed).
* **repaired behaviour**: the truncated summarizer is rejected; basic compaction runs; the next
  request must still shrink, but the compacted transcript carries the deterministic dropped-work
  summary instead of the model's note.

A probe asserting *"a `length`-truncated summarizer yields a basic-compaction projection"* would
RED today and GREEN after the repair — so the repair is **implementable**. But it would **not**
change the observed non-completion: in this run the truncated summaries were accepted and the
continuation failed for reasons unrelated to truncation (H6). Applying it would swap a summary
that was semantically useful for one that is mechanically lossy, at the cost of discarding the
findings the task asked for (§9).

**The necessity check fails: the repair is not warranted by this evidence.** Per ACT §7, stop at
recon.

### The one bounded next action (not a repair)

The open question is *behavioural*, and it needs an experiment this ACT is not authorised to run
(a new live Flint task is out of scope). The smallest action that would settle it:

> **A single, controlled, read-only continuation probe**: replay the captured sidecar projection
> (summary + preserved tail, 48 messages) against the *same* model and settings, with a
> completion-obligation prompt identical to the original turn's, and observe whether the model
> synthesises or continues investigating. This distinguishes "the model was already positioned to
> finish and chose not to" (H6) from "the resumed context still withholds something the model
> needs" (a variant of H5), with a single request and no new live benchmark.

If that probe synthesises, H6 is confirmed and the remaining work is a **model/prompt behaviour**
question, not a ClineMM compaction-orchestration defect — and no compaction repair should be
made. If it continues investigating, the summary-fidelity loss becomes the load-bearing cause and
a bounded successor ACT (improving the agentic summary's path fidelity) is justified.

**No successor repair ACT is proposed at this time.**

---

## 11. Security and evidence handling

* **No raw transcript, provider-request payload, system prompt or private source excerpt is
  committed.** All evidence files contain only counts, hashes, identifiers, timings, token
  figures and redacted findings.
* No secrets appear in the report or the evidence files. (The operator's `providers.json` contains
  an API key; it is referenced only by path and hash, never transcribed.)
* The investigated Keycloak repository was **not modified**; it was read only through the
  captured transcript.
* Exact input hashes, identifiers and structure are preserved in `evidence/identity.txt` so every
  count, chronology and causal claim is reproducible without publishing private material.
* Raw private evidence remains in the existing protected operator-local locations
  (`~/.vscodium-roz/cline-data/…`, `~/.cache/kapitsa/logs/…`, `~/Downloads/…`) and was not
  copied into the repository.
* No network transmission of captured contents.

---

## 12. Evidence artifacts

```
docs/acts/ACT-CLINEMM-FLINT-COMPACTION-FAILURE-RECON01/
├── REPORT.md                        this document
└── evidence/
    ├── identity.txt                 repository / extension / file identity, hashes, settings
    ├── timeline.tsv                 75-row event timeline (canonical ts + Kapitsa rows)
    ├── compaction-attempts.tsv      all 5 attempts, 22 fields each
    ├── token-authorities.tsv        W/P/B for all 71 requests + budget provenance
    ├── summary-fidelity.txt         groundedness matrix, progress conservation, readiness
    ├── discriminators.txt           Probes A–D and the causal discrimination
    └── gates.txt                    executed gates and their outcomes
```

### Gates

| Gate | Result |
|---|---|
| Focused Vitest (8 suites: compaction, working-context publish, working-context ratio, cut-snap, summarize-conversation, session-compaction, message-builder, message-builder-read-dedup) | **248 passed / 248**, exit 0 |
| Disposable probe suite | 10 tests, 7 pass / 3 fail — the 3 failures were **probe-expectation** defects that produced findings (recorded), not production failures; the file was **deleted** after capture |
| Focused typecheck (`bun run typecheck` in `sdk/packages/core`) | exit 2, **40 pre-existing** diagnostics; this ACT modified **zero** TypeScript files (verified with `git status --short -- sdk/ apps/` → empty and `git diff --name-only HEAD -- <failing dirs>` → empty) → **ACT-owned type errors = 0** |
| `git diff --check` | no output, exit 0 |
| Worktree / stash | only the new docs directory; `stash@{0}` preserved; stash count 1 |
| ACT-owned diagnostics | **0** (probe removed; no mutable diagnostic globals added; no production state semantics changed) |
| Full core suite | deliberately **not** run — out of scope for a docs-only recon |

### Repository protection

No push. No PR. No stash manipulation. No installed-extension change. No dependency upgrade. No
broad formatting or unrelated cleanup. `stash@{0}` and all unrelated evidence preserved.
