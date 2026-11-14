# ACT-CLINEMM-FLINT-COMPACTION-FAILURE-RECON01 — CORRECTION01

**Verdict: `HALT_SKIP_ATTRIBUTION_UNPROVEN` → the no-skip claim is WITHDRAWN.**
The parent ACT's finding "the screenshot's 'skipped' label belongs to a different
session" is **refuted**. The screenshot belongs to session
`1794617111057_i279p` — the investigated 96K run — and the third summarizer
attempt was a **skip** (`compaction-skipped`), not a success.

Two further corrections follow from the same evidence:

* the **trigger accounting** comparison was made against the wrong quantity, and
* **Probe D's tail-index evidence** does not support the claim it was cited for.

**Scope: documentation only.** No production change, no new live run, no
additional review cycle. This is a bounded evidence correction over the
artifacts already consumed by the parent ACT.

---

## 0. What the parent ACT claimed, and what is wrong with it

| # | Parent ACT claim | Status |
|---|---|---|
| C1 | "This session never produced a `compaction-skipped` … the screenshot's 'skipped' label belongs to a **different session**." (REPORT §2, §10.1) | **REFUTED** — see §1, §2 |
| C2 | "the three observed compaction boundaries fired on the runtime's REQUEST ESTIMATE" (discriminators.txt Probe A) | **REFUTED** — see §4 |
| C3 | Probe D: "`tailCarriesIt = true` … the obligation survived **through the preserved canonical tail**", cited at canonical indices 26–27 | **REFUTED** — see §5 |
| C4 | "All three substantive compaction attempts SUCCEEDED; no compaction was ever skipped" (commit message) | **REFUTED** — attempt 3 was skipped; attempts 1, 2, 4 succeeded |
| C5 | "Terminal-completion obligation survived compaction via the preserved tail." | **REFUTED** — the obligation did **not** survive |
| C6 | Primary verdict `EXPECTED_ACCOUNTING_DIFFERENCE`; "no accounting-contract defect reproduces" | **UNRESOLVED / OPEN** — see §7 |

Everything else in the parent ACT — the W/P estimator-bias analysis, the
summary-fidelity matrix, the misspelled-root propagation (H5), the ENOENT
recovery cost, the wall-clock attribution, the 8,192-token summarizer cap, and
the absence of an agentic→basic fallback — is **preserved unchanged**.

---

## 1. C1 — the screenshot belongs to session `1794617111057_i279p`

### 1.1 Timing (canonical transcript, session-local elapsed counter)

The session manifest records `started_at = 2026-11-14T00:45:11.174Z`; the first
canonical message carries `ts = 1794617111288` (00:45:11.288Z). The screenshot's
`28:50 Working` counter therefore places the observation at
`00:45:11.288Z + 28m50s = 01:14:01.288Z` (04:14:01 at +03:00).

The third summarizer attempt occupies a **closed window** in the canonical
transcript, bounded by the two main requests that flank it:

| Event | Canonical idx | Message id | UTC |
|---|---:|---|---|
| main request before attempt 3 | 157 | `msg_MAog9anW` | 01:11:11.192Z |
| **screenshot (`28:50 Working`)** | — | — | **01:14:01.288Z** |
| main request after attempt 3 | 160 | `msg_R54EA2vP` | 01:16:18.537Z |

The screenshot falls **170 s into a 307 s window** whose only content is the
third summarizer attempt (Kapitsa line 365: `prompt 3139 … 8192 tokens …
length`). The 256K session `1794619955958_0zlig` did not start until
01:32:35Z — **18 minutes after** the screenshot.

### 1.2 The Kapitsa `length` event is inside the same window

Kapitsa logs completions, not requests, so the attempt-3 summarizer request
cannot be timestamped directly. It is bounded by the two flanking main
requests above, and the only provider activity between them is line 365.

### 1.3 The sibling session is excluded by its own start time

`1794619955958_0zlig` — the 256K completed run — has
`started_at = 2026-11-14T01:32:35Z` and contains **no** compaction sidecar
(no `*.compaction.json` in its session directory). It cannot have produced a
compaction divider at 01:14:01Z.

---


## 2. C1 — the UI event producer and the persistence boundary

### 2.1 The rendered label is NOT the status-notice slug

The parent ACT argued from absence:

> `grep -rl 'compaction-skipped'` over the entire `~/.vscodium-roz/cline-data/`
> tree returns **nothing**; the string is absent from this session's transcript,
> sidecar, manifest and evaluation events.

That grep cannot establish absence, because the string it searches for is never
persisted in that form. The producer chain is:

| Layer | File:line | Value |
|---|---|---|
| SDK producer | `sdk/packages/core/src/extensions/context/compaction.ts:802` | `emitStatusNotice?.(\`${noticePrefix}compaction-skipped\`, { …, phase: "skipped", … })` — a **transient diagnostic slug** |
| VS Code translator | `apps/vscode/src/sdk/message-translator.ts:1461-1484` `parseCompactionNoticeMetadata` | maps `phase:"skipped"` → `{ status: "skipped", mode: "auto" }` |
| VS Code translator | `apps/vscode/src/sdk/message-translator.ts:1501-1509` `buildCompactionMessage` | emits `say:"compaction"` with `text = JSON.stringify(info)` → **`{"status":"skipped","mode":"auto"}`** |
| Webview | `apps/vscode/webview-ui/src/components/chat/CompactionRow.tsx:42-43` | `if (info.status === "skipped") return "Compaction skipped"` |

**Probe 4** (`apps/vscode/src/sdk/__tests__/zz-act-correction01-ui-producer.test.ts`,
run against the real `parseCompactionNoticeMetadata` / `buildCompactionMessage`)
asserts and confirms:

* the row body is exactly `{"status":"skipped","mode":"auto"}`;
* it contains **neither** `"compaction-skipped"` **nor** `"Compaction skipped"`;
* therefore `grep -rl 'compaction-skipped'` **provably cannot find the row**, no
  matter whether the row exists.

The parent ACT's inference — "the string is absent, therefore no skip was
displayed" — is **invalid**. The direct UI evidence (the screenshot) stands
against an argument that can never reach it.

### 2.2 The persistence boundary

The persisted artefacts are two different layers, and **neither** stores the
divider:

| Artefact | Path | Content | Contains the divider? |
|---|---|---|---|
| Canonical transcript | `1794617111057_i279p.messages.json` | 207 messages, roles `user`/`assistant` only | **No** — 0 occurrences of `say:"compaction"`; the divider is a webview projection, not a canonical message |
| Compaction sidecar | `1794617111057_i279p.compaction.json` | the **successful** compaction result (4 compacted messages + `source_message_count = 163`) | **No** — a sidecar is written only on success; a skipped attempt writes nothing |
| Evaluation events | `diagnostics/myc-evaluation/.../events.jsonl` | `session_start`, `prime_*`, `task_started`, `task_ended`, `session_end` | **No** — the evaluator never subscribed to compaction notices |

So "absence from persisted artefacts" is **structurally guaranteed** for *every*
compaction outcome, successful or skipped. It carries **zero** information
about whether a skip occurred.

---


## 3. C1/C4 — attempt 3 was a skip (the decisive discriminator)

### 3.1 The `previousSummary` identity chain

The agentic summarizer request carries the previous compaction's summary as
`previousSummary` (`buildSummaryRequest`). Its **identity** therefore reveals
whether the *previous* attempt's result was applied:

| Attempt | Kapitsa line | Finish / out | `previousSummary` carried | ⇒ previous attempt's outcome |
|---:|---:|---|---|---|
| 1 | 321 | `stop` / 4,396 | **none** | first compaction |
| 2 | 339 | `stop` / 5,924 | **S1** (sha `a07d493872a96d79`, 2,849 B) | attempt 1 **APPLIED** |
| 3 | 365 | **`length` / 8,192** | **S2** (sha `5775aa10b4ee85c2`, 3,831 B) ≠ S1 | attempt 2 **APPLIED** |
| 4 | 367 | **`length` / 8,192** | **S2** — *byte-identical to attempt 3's* | **attempt 3 DISCARDED ⇒ SKIP** |
| 5 | 387 | `cancelled` / 3,870 | **S3** (sha `6267387b0f89edf8`, 1,890 B) | attempt 4 **APPLIED** |

**Probe 5** (`sdk/packages/core/src/extensions/context/zz-act-correction01-prevsummary.test.ts`)
reads the five real captured summarizer requests
(`~/Downloads/cap_86d49c582868073a.ai_sdk_prompt.{1..5}.provider-request.json`),
extracts the `previousSummary` block, and fingerprints it:

```
[PROBE5] previousSummary fingerprints=
  ["none","a07d493872a96d79","5775aa10b4ee85c2","5775aa10b4ee85c2","6267387b0f89edf8"]
```

Attempts 3 and 4 carry the **same** `previousSummary`. If attempt 3's summary
had been accepted, attempt 4 would carry *attempt 3's* summary. It does not.
**Attempt 3's result was discarded** — i.e. the agentic strategy returned
`undefined`, which is exactly the `compaction-skipped` branch.

### 3.2 Corroboration from the persisted sidecar

The sidecar's `metadata.summary` is **byte-identical** to attempt 5's
`previousSummary` body (1,890 B, exact string equality), and the sidecar's
`updated_at = 2026-11-14T01:18:03.500Z` coincides with attempt 4's boundary
(not attempt 3's). The persisted artifact is therefore **attempt 4's** result.
Attempt 3 produced **no** persisted state.

### 3.3 The production branch that emits the skip

`agentic-compaction.ts:202-220` rejects **only emptiness**:

```ts
const rawSummary = summaryResult.text.trim();
if (!rawSummary) {
  options.logger?.log("Skipped agentic compaction: summarizer returned no summary text", {
    severity: "warn",
    …
    likelyCause: summaryResult.reasoningChars > 0
      ? "output_budget_consumed_by_reasoning"
      : "empty_response",
  });
  return undefined;          // <-- the skip
}
```

`summary-generation.ts:27-41` accumulates `text` from `chunk.type === "text"`
and `reasoningChars` from `chunk.type === "reasoning"`. A `length`-truncated
response whose entire 8,192-token budget was consumed by reasoning yields
`text === ""` ⇒ `return undefined` ⇒ `compaction.ts:801-822` emits
`auto-compaction-skipped` with `phase:"skipped"` ⇒ the webview renders
**"Compaction skipped"**.

**Probe 2** (`sdk/packages/core/src/extensions/context/zz-act-correction01-skip.test.ts`)
drives the **real production pipeline** with a summarizer stream of
`reasoning` + `done{incompleteReason:"max_tokens"}` (no text chunk):

```
[PROBE2-empty] result=undefined notices=[
  "auto-compacting:{…,\"phase\":\"started\",…}",
  "auto-compaction-skipped:{…,\"phase\":\"skipped\",\"iteration\":1,\"maxInputTokens\":1800}"
]
```

and the control (same `length` class, **non-empty** text) is accepted:

```
[PROBE2-nonempty] result=defined notices=[…, "auto-compacted:{…,\"phase\":\"completed\",…}"]
```

**The discriminator is text emptiness, not the `length` finish itself.** The
parent ACT's Probe B.2 asserted this control shape, but then classified the
live attempt 3 as "accepted" on the strength of an aggregate 8,192-token count.
The Kapitsa log reports **aggregate** output tokens only; it does **not**
separate text from reasoning. There is **no response-side capture** on disk
(only `*.provider-request.json` captures exist — 622 files, all request-stage).
The ACT's statement "text present and non-empty" for attempt 3 was therefore
**never evidenced**; it was an inference, and the `previousSummary` identity
chain now contradicts it.

### 3.4 Why the empty-text skip is a *known* failure mode of this fork

The production code already documents it, in two places:

* `compaction-shared.ts:30-34` — `DEFAULT_SUMMARY_MAX_OUTPUT_TOKENS = 8_192`
  was raised from 4,096 because "models that reason by default can spend part
  of a tight budget on thinking and **return no summary text at all, which
  skips compaction entirely**."
* `compaction-shared.ts:807-812` — "reasoning models need headroom beyond
  their thinking output or **no summary text ever arrives and compaction is
  skipped**."


## 4. C2 — the trigger accounting compared the wrong quantities

### 4.1 The production trigger is scaled, not fixed

`compaction.ts:417-437`:

```ts
const actualPreviousInputTokens = context.previousRequestInputTokens > 0 ? … : 0;
const underestimateFactor =
  actualPreviousInputTokens > 0 && requestInputTokens > 0
    ? Math.min(MAX_INPUT_UNDERESTIMATE_FACTOR, Math.max(1, actualPreviousInputTokens / requestInputTokens))
    : 1;
const maxInputTokens = rawMaxInputTokens / underestimateFactor;
const requestTriggerTokens = maxInputTokens * COMPACTION_TRIGGER_RATIO;
const shouldCompact = requestInputTokens >= requestTriggerTokens;
```

`actualPreviousInputTokens` is the **provider's actual** count for the
previous request (`agent-runtime.ts:3088` → `this.state.lastRequestInputTokens = event.usage.inputTokens`),
while `requestInputTokens` is the **estimator's** count for the current
request. The trigger therefore depends on the W-vs-P relationship at every
boundary and is **not** a constant 207,360.

### 4.2 The accounting, recomputed with the production resolver

Inputs: `contextWindow = 256_000`, `maxInputTokens` absent (Auto), so
`rawMax = 256_000 × 0.9 = 230_400`; `COMPACTION_TRIGGER_RATIO = 0.9`.

| Boundary | W (captured estimate) | P of previous request | `underestimateFactor` | effective trigger | `W / trigger` | `shouldCompact` |
|---|---:|---:|---:|---:|---:|:--:|
| attempt 1 / iter 7 | 85,546 | 63,671 | 1.000000 | 207,360 | 0.4125 | **false** |
| attempt 2 / iter 22 | 87,044 | 69,557 | 1.000000 | 207,360 | 0.4198 | **false** |
| attempt 3 / iter 45 | 81,367 | 59,047 | 1.000000 | 207,360 | 0.3924 | **false** |
| attempt 4 / iter 46 | 93,917 | 64,957 | 1.000000 | 207,360 | 0.4529 | **false** |
| attempt 5 / iter 62 | 85,686 | 64,220 | 1.000000 | 207,360 | 0.4132 | **false** |

**Probe 1** (`sdk/packages/core/src/extensions/context/zz-act-correction01-trigger.test.ts`)
runs this against the **real** `resolveEffectiveMaxInputTokens`,
`COMPACTION_TRIGGER_RATIO` and `MAX_INPUT_UNDERESTIMATE_FACTOR`:

```
[PROBE1]  rawMax=230400 factor=1 maxInputTokens=230400.0 trigger=207360.0
          W=93917 shouldCompact=false W/trigger=0.4529
[PROBE1b] boundaries=5 crossingTheProductionTrigger=0
```

**Zero of the five boundaries crossed the production trigger.** The parent
ACT's Probe A statement — "the three observed compaction boundaries fired on
the runtime's REQUEST ESTIMATE" — is **false**.

Note that `underestimateFactor` is 1.0 at every boundary precisely *because*
the estimator over-counts in this corpus (W/P = 1.223–1.358, i.e. W > P), so
`max(1, P/W)` clamps to 1. That is consistent with the parent ACT's finding
that the estimator bias is a stable over-count — but it means the ACT's
conclusion "the observed trigger behaviour is consistent with [the 230,400
ceiling]" is not supportable: the observed behaviour is equally (and more
simply) consistent with **the trigger never firing on the request-estimate
path at all**.

The parent ACT's §4 framing — comparing provider token counts (P) against an
estimator threshold — is the specific error the correction identifies. The
correct comparison is W against a **scaled** trigger; on that comparison the
trigger did not fire.

**This does not re-open the accounting-contract question.** It removes the
ACT's basis for asserting that the trigger *did* fire on the request estimate,
and it leaves the route by which compaction was actually initiated
**unidentified**. That gap is stated in §7 rather than papered over.

## 5. C3/C5 — Probe D: the obligation did NOT survive compaction

### 5.1 The cited indices precede the cut

The sidecar records `source_message_count = 163`; the compacted prefix is
canonical `[0..162]` and the preserved tail is canonical `[163..206]`.
The parent ACT cited canonical indices **26–27** as evidence that the
obligation survived *through the preserved tail*. Indices 26–27 are
**inside the compacted prefix** — they cannot evidence tail preservation.

### 5.2 Where the obligation actually lives

The instruction text is
`"[SYSTEM] This run is not complete until you call one of these terminal
completion tools: submit_and_exit…"`.

| Location | Carries the instruction? |
|---|---|
| Canonical `[0..162]` (compacted prefix) | **yes** — at canonical indices **1** and **27** (plus an incidental tool-error string listing at 137) |
| Canonical `[163..206]` (preserved tail) | **no** |
| Sidecar `messages[0].metadata.summary` | **no** |
| Sidecar `system_prompt` | **no** |
| The 48-message projection sent to the provider | **no** |

**Probe 3** (`sdk/packages/core/src/extensions/context/zz-act-correction01-obligation.test.ts`)
uses the **real** `projectSessionCompactionState` against the **real** sidecar
and canonical transcript:

```
[PROBE3] cut=163 projectedLen=48 summaryCarriesIt=false
         systemPromptCarriesIt=false prefixCarriesIt=true
         tailCarriesIt=false carryingIndices=[1,27]
```

`projectedLen = 48` reproduces the parent ACT's Probe C exactly (4 + 44 = 48),
so the projection itself is unchanged — only the *conclusion* drawn from it
changes.

The two tail hits at canonical 201 and 203 (which the parent ACT did not cite)
are the **model's own thinking text** ("…then submit via `submit_and_exit`",
"…and then call `submit_and_exit` with a summary") — the model's *decision*,
not the carried *obligation*. Consequence is not obligation.

### 5.3 Independent confirmation from the captured provider request

The post-compaction main request (`~/Downloads/cap_run_UyTw6PKK_47_*.provider-request.json`,
3 messages, 01:18:03.567Z) was inspected:

* the string `"not complete until"` is **absent**;
* the only occurrence of `submit_and_exit` is inside the **tool schema
  description** (`"Submit the final answer and exit the conversation…"`).

**The obligation instruction was not in the request the model received after
compaction.**

### 5.4 Consequence for the parent ACT's H6 classification

H6 ("Flint independently continues unnecessary research") was the parent
ACT's *primary* hypothesis, and it rested on Probe D: "the obligation survived
… no failing production-seam reproduction, therefore no additional
completion-instruction patch is warranted". With the obligation **not**
surviving, that inference is withdrawn:

* the model's post-compaction behaviour (8 further tool calls after it had

## 6. The screenshot is reconciled with the third attempt

Putting §1–§3 together, the observation is fully accounted for:

1. At 01:11:11Z the run reaches the third compaction boundary.
2. The summarizer is issued with an 8,192-token output cap on a
   reasoning-enabled provider.
3. The provider returns `finish_reason = length` at exactly 8,192 aggregate
   output tokens — with **no text chunk**, only reasoning
   (the aggregate count cannot separate the two; no response-side capture exists).
4. `agentic-compaction.ts:203` rejects the empty summary ⇒ `undefined`.
5. `compaction.ts:802` emits `auto-compaction-skipped` with `phase:"skipped"`.
6. The webview renders **"Compaction skipped"** at ~01:14:01Z — 170 s into the
   attempt-3 window, matching the screenshot's `28:50 Working`.
7. No sidecar is written, no projection is applied, and the next iteration
   re-evaluates the trigger — producing attempt 4, which succeeded.
8. Attempt 3's summary appears in **no** subsequent request (`previousSummary`
   at attempt 4 is still S2) and in **no** persisted artefact.

The "Compaction skipped" row is a **transient UI projection**. It is not in
the canonical transcript, not in the sidecar, and not in the evaluation
events — for *any* outcome. Its absence from those files is not evidence of
its absence from the screen.

---

## 7. What this correction does and does not settle

### Settled

* **C1 / C4** — the screenshot belongs to `1794617111057_i279p`; attempt 3 was
  a `compaction-skipped`; the parent ACT's "no skip occurred" and "the
  screenshot belongs to another session" are withdrawn.
* **C2** — the trigger comparison used the wrong quantity; on the production
  comparison, **no** boundary crossed the trigger.
* **C3 / C5** — the completion obligation did **not** survive compaction; the
  tail-index citation does not support the claim it was made for.

### Explicitly NOT settled (open, and not to be papered over)

1. **The route by which compaction was actually initiated** in this run is
   **not identified**. The production `shouldCompact` evaluation is false at
   every observed boundary, so the five summarizer requests must have come
   through a path this ACT has not traced. Candidates that remain open
   include the `messageTriggerTokens` budget, a non-request-estimate trigger
   source, and the `createCompactionStateAwarePrepareTurn` re-compaction
   branch. **This correction does not claim any of them** — it records that the
   parent ACT's trigger accounting does not describe what happened.
2. **Whether the empty-text skip is the exact mechanism of attempt 3** is
   *demonstrated as reachable and consistent* (Probe 2 + the `previousSummary`
   chain + the reasoning-enabled provider), but the attempt-3 response body
   was never captured, so the absence of a text chunk is inferred from the
   `length` finish, the reasoning-enabled provider, and the discard — not
   directly observed.
3. **C6 (`EXPECTED_ACCOUNTING_DIFFERENCE`)** is **not** re-affirmed and not
   refuted; it is **OPEN**, because the accounting basis it relied on (the
   trigger firing on the request estimate) is now shown to be false.
4. **The root cause of the run's non-completion** is **not** re-decided. H6 is
   withdrawn as a *primary* classification (its evidentiary basis is gone);
   H5 stands as a demonstrated cost. A successor investigation would be needed
   to re-classify, and **no new live run is proposed here**.

### Deliberately unchanged

* The parent ACT's **H5** finding, its **W/P estimator-bias** analysis, the
  **8,192-token summarizer cap** conclusion, the **no agentic→basic fallback**

## 8. Gates executed for this correction

| Gate | Result |
|---|---|
| Probe 1 — trigger accounting (real `resolveEffectiveMaxInputTokens` / `COMPACTION_TRIGGER_RATIO` / `MAX_INPUT_UNDERESTIMATE_FACTOR`) | **PASS** — trigger 207,360, `shouldCompact=false`, 0/5 boundaries cross |
| Probe 2 — skip branch (real `createContextCompactionPrepareTurn` + real agentic strategy) | **PASS** — empty-text `length` ⇒ `auto-compaction-skipped` + no projection; non-empty control ⇒ `auto-compacted` |
| Probe 3 — obligation survival (real `projectSessionCompactionState` + real sidecar/transcript) | **PASS** — `tailCarriesIt=false`, carriers `[1,27]` ⊂ prefix, absent from the 48-message projection |
| Probe 4 — UI producer / persistence boundary (real `parseCompactionNoticeMetadata` + `buildCompactionMessage`) | **PASS** — row body `{"status":"skipped","mode":"auto"}` contains neither searched string |
| Probe 5 — attempt-3 discard (real captured summarizer requests) | **PASS** — fingerprints `none, a07d…, 5775…, 5775…, 6267…` |
| Existing compaction regression suites (6 files: compaction, working-context publish, working-context ratio, cut-snap, summarize-conversation, session-compaction) | **160 passed / 160**, exit 0 |
| Probe files | disposable — **deleted** after evidence capture; ACT-owned diagnostics = 0 |
| Production TypeScript modified | **none** |

### Artefact identity (recomputed at correction time; unchanged from the parent ACT)

| Artefact | Size | sha256 (16) |
|---|---:|---|
| `1794617111057_i279p.messages.json` | 1,199,385 | `02c5a31231787330` |
| `1794617111057_i279p.compaction.json` | 47,556 | `2cba633cd2e1f27d` |
| `1794617111057_i279p.json` | 2,312 | `0ec0a73841ee43de` |
| `~/.cache/kapitsa/logs/serve-8000.log` | 90,990 | `b0ff7776eb01a747` |

No raw transcript, provider payload, system prompt or private source excerpt is
committed by this correction. No secrets. No network transmission. No push, no
PR, no stash manipulation, no installed-extension change.

  contract analysis, the **misspelled-root** provenance (279 occurrences), the
  **10 ENOENT reads / ≈3.2 min** recovery cost, the **wall-clock attribution**
  (98.8 % provider elapsed), and the **manual-vs-basic compaction** comparison
  are all **preserved**.
* The **disposition of the repair candidate** is unchanged: "reject a
  `length`-truncated summarizer and fall back to basic compaction" remains
  **not warranted as a repair** — but it is now motivated by a *real, observed*
  skip rather than by a non-event, and it must be re-evaluated against the
  emptied-output mechanism rather than against the parent's "truncation was
  accepted" premise.

---

  written "I now have a comprehensive picture") is **no longer** evidence of
  "the model chose to continue when it was already done";
* the parent ACT's own summary-fidelity findings already showed the
  compaction **dropped the literal task question** ("What does this project
  do?" — Probe C.4) and the completion obligation (this §5). Those are the
  same class of loss, and both are now established.

The H5 finding (the misspelled repository root propagated by the summary,
causing 10 ENOENT reads and ≈3.2 min of path rediscovery) is **unchanged**.

---


---

And this run's provider was reasoning-enabled:
`~/.vscodium-roz/cline-data/settings/providers.json` →
`providers["openai-compatible"].settings.reasoning = { enabled: true, effort: "medium" }`.
The summarizer inherits the **active** provider config
(`compaction-shared.ts` `resolveSummarizerConfig` → `withSummarizerDefaults`),
so the summarizer ran with reasoning enabled and an 8,192-token output cap —
the exact configuration the comments above describe.

The upstream symptom the operator referenced (truncated summarizer output ⇒
skip) is therefore **mechanically present in this fork**, and the third
attempt's `length` finish is its signature.

---
