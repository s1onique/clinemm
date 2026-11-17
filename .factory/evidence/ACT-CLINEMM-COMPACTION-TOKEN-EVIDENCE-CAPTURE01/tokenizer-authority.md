# ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01 — Tokenizer Authority

**Target:** ClineMM dogfood / Qwen IQ3_S / Strata
**Strata endpoint:** `http://192.168.50.111:8080` (the remote Strata server;
the locally installed `kapitsa` v0.2.35 on `:8000` is a DIFFERENT provider
and is out of scope for this target)
**Model:** `qwen3.8-flash-next-iq3_s` · `n_ctx: 131072`
**Strata modifications:** NOT AUTHORIZED · **Unmerged Strata `/tokenize` PR:**
NOT transplanted, NOT used

---

## 1. Route inventory (verified against the installed Strata)

| Route | Method | Result |
|---|---|---|
| `/health` | GET | `{"status":"ok","max_context":131072,"model":"qwen3.8-flash-next-iq3_s","api_key":true,"service":"strata"}` |
| `/v1/models` | GET | `qwen3.8-flash-next-iq3_s`, `meta.n_ctx = 131072` |
| `/v1/chat/completions` | POST | works; reports `usage.prompt_tokens` + `usage.prompt_tokens_details.cached_tokens` |
| `/v1/messages/count_tokens` | POST | works; returns `{"input_tokens":N}` |
| `/v1/tokenize` | GET + POST | **404 — the route does not exist** |
| `/tokenize` | GET + POST | **404** |
| `/count_tokens` | GET + POST | **404** |
| `/openapi.json`, `/docs` | GET | **404** |

**Option A (an existing Strata local tokenizer/template path) is
UNAVAILABLE.** The installed Strata exposes no tokenizer-only route. This
independently confirms that the unmerged Strata `/tokenize` PR is not
present, and the ACT does not transplant it.

Note: `/v1/messages/count_tokens` answers to POST only — a GET returns 404.
This was verified explicitly, because a GET-only probe would have
mis-classified the route as absent.

---

## 2. The Anthropic counting route: equivalence measurement

`/v1/messages/count_tokens` accepts the ANTHROPIC request shape. Its
`tools` parameter requires `{name, input_schema}`; the OpenAI
`{type:"function", function:{...}}` shape is rejected with HTTP 400.

A controlled A/B was run against the LIVE Strata: the same content was
submitted twice — once through `count_tokens` (Anthropic shape) and once
through `/v1/chat/completions` (OpenAI shape, `max_tokens: 1`), and the
route's count was compared with the provider's ACTUAL reported
`usage.prompt_tokens`.

### 2.1 No tools: EXACT equivalence

| Case | `count_tokens` | actual OpenAI `prompt_tokens` | delta |
|---|---:|---:|---:|
| simple (1 user message) | 55 | 55 | **0** |
| system prompt | 62 | 62 | **0** |
| long text (120x sentence) | 1252 | 1252 | **0** |
| tool-result shaped turn | 79 | 79 | **0** |

**Four of four no-tool cases match EXACTLY.** For the system-prompt and
message portion, the Anthropic route is a byte-for-byte equivalent counter
of the OpenAI-format request.

### 2.2 With tools: a DETERMINISTIC, per-tool UNDER-count

| Case | tools | `count_tokens` | actual OpenAI `prompt_tokens` | delta |
|---|---:|---:|---:|---:|
| tool, empty schema | 1 | 269 | 278 | **-9** |
| tool, 1 property | 1 | 271 | 288 | **-17** |
| tool, 2 properties | 1 | 271 | 297 | **-26** |
| tool, 200-char description | 1 | 295 | 312 | **-17** |
| two tools | 2 | 290 | 324 | **-34** |

A tool-count sweep with an identical tool shape (2 properties) isolates the
offset as exactly linear in the tool count:

| tools | `count_tokens` | actual OpenAI | delta | per tool |
|---:|---:|---:|---:|---:|
| 0 | 55 | 55 | 0 | — |
| 1 | 271 | 297 | -26 | **-26** |
| 2 | 290 | 342 | -52 | **-26** |
| 3 | 309 | 387 | -78 | **-26** |
| 4 | 328 | 432 | -104 | **-26** |

### 2.3 The mechanism

`tool_choice: "none"` makes the OpenAI route drop the tools entirely
(`prompt_tokens` = 55, i.e. the no-tool count) while `count_tokens` still
returns 271. So the two routes render the tool inventory with DIFFERENT
serializations: the Anthropic route renders a shorter tool-schema block
than the OpenAI route does.

The per-tool offset is therefore a function of the tool SCHEMA (9 / 17 / 26
tokens for the shapes measured), not a fixed constant. It cannot be
recovered from the request alone without reimplementing the OpenAI-side
tool serialization, which is exactly the work this ACT is forbidden to
import from the unmerged Strata PR.

---

## 3. Classification

**`TOKENIZER_FORMAT_NOT_EQUIVALENT`** — for the FULL OpenAI-compatible
request.

More precisely, the finding is **split**:

| Request portion | `count_tokens` authority |
|---|---|
| system prompt + messages | **EXACT** (delta 0 in 4/4 measured shapes) |
| tool schemas | **NOT EQUIVALENT** (deterministic per-tool under-count, schema-dependent) |

### 3.1 Why this is NOT "an independent comparison only"

The ACT's option B says: if the request formats, templates or tools differ,
classify it as `TOKENIZER_FORMAT_NOT_EQUIVALENT` and do NOT use its count
to certify an unsubmitted OpenAI candidate.

The measurement supports that classification **for a candidate that carries
tools**. ClineMM's real requests ALWAYS carry tools — the tool inventory is
part of the request the compaction decision measured, and the estimator
explicitly bills it (`requestOverheadTokens` is the difference between the
full request estimate and the API-message estimate; PARITY01 measured it at
~5,692 tokens on the historical session).

So for the target configuration the route is **not** a usable authority for
the candidate as a whole.

### 3.2 The one route that IS an exact authority today

For a candidate whose tool inventory is EMPTY, `/v1/messages/count_tokens`
reproduces the provider's own count EXACTLY. That is a genuine,
usable authority — but the ClineMM dogfood configuration has a non-empty
tool inventory, so it does not apply to the candidate this ACT needs to
count.

### 3.3 What would be required to use it anyway

Two bounded, NON-inference options exist, and neither was exercised:

1. **Derive the tool-schema offset from a paired observation.** Submit the
   candidate's messages+system through `count_tokens` (exact), and compute
   the tool block's OpenAI-side token cost by a single paired measurement
   of the SAME tools with and without the message body. This still requires
   an inference request to observe the OpenAI-side tool rendering, so it is
   a **controlled minimal-generation comparison** (C4 option C), not a
   tokenization-only measurement.
2. **Reconstruct the OpenAI tool serialization locally and count it with
   the model's own tokenizer.** This is the unmerged Strata PR's job. It is
   explicitly out of scope.

---

## 4. Option C — the controlled minimal-generation probe (PREPARED, NOT RUN)

The ACT may prepare the probe but must not run unapproved shadow requests
against the live Strata instance. **No shadow request was run by this ACT.**

The probe, when an operator opts in, is:

- a direct OpenAI-compatible request to `/v1/chat/completions`;
- the captured candidate's messages, system prompt, tools, thinking/template
  settings and provider-adapter behaviour, reproduced EXACTLY;
- `max_tokens: 1` — the ONE intentionally changed field;
- NO tool execution in the probe harness;
- the provider-reported `prompt_tokens` captured as the measurement;
- overflow / rejection classified SEPARATELY from a count.

**Equivalence requirement.** The probe is only authoritative if the changed
generation settings do not alter the FORMATTED PROMPT. `max_tokens` bounds
the COMPLETION, not the prompt, so it does not alter the prompt
formatting — but this must be verified, not assumed: the same probe
re-issued with and without the tool inventory would show whether the tool
block is present in the rendered prompt.

**If template equivalence cannot be established, the result is
`SHADOW_PROBE_NOT_EQUIVALENT`, not an authoritative candidate token
count.**

### 4.1 The probe's remaining risk

The probe runs INFERENCE. It therefore measures the provider's count for a
request that was never dispatched by ClineMM. It is a measurement of the
candidate, not a measurement of the dispatch. It is admissible as the
candidate's count ONLY if the formatted prompt is proven equivalent.

---

## 5. The provider-reported usage contract (established, unchanged)

From the live Strata responses:

```json
"usage": {
  "prompt_tokens": 296,
  "completion_tokens": 1,
  "total_tokens": 297,
  "prompt_tokens_details": { "cached_tokens": 0 }
}
```

and the timings block:

```json
"timings": { "cache_n": 0, "prompt_n": 296, "predicted_n": 1, ... }
```

`prompt_n` equals `prompt_tokens`, so the reported prompt count is the
COMPLETE prompt. `cached_tokens` is a SUBSET of it (it was 0 or a strict
prefix of the prompt in every observation).

**This confirms the contract PARITY01 established from the AI SDK, now
observed directly at the provider:** `inputTokens` is the complete prompt,
`cacheReadTokens` is a subset, and the two must never be added together.
The ACT's completion record preserves that contract and pins it with a
witness.

---

## 6. What the ACT can and cannot certify

| Claim | Status |
|---|---|
| The decision -> dispatch -> usage join is AUTHORITATIVE | **ACHIEVED** (this ACT) |
| The exact pre-compaction candidate is captured | **ACHIEVED** (this ACT) |
| The exact candidate's TRUE token count is known | **NOT ACHIEVED** |
| `count_tokens` equals the provider count for the full OpenAI request | **REFUTED** (per-tool offset) |
| `count_tokens` equals the provider count for the messages+system portion | **ACHIEVED** (delta 0, 4/4 shapes) |
| A trusted count below the trigger for the exact candidate | **NOT ESTABLISHED** |

**Therefore this ACT does NOT classify as `REPRODUCED_ESTIMATOR_CAUSALITY`.**
It establishes the missing evidence boundary and measures the tokenizer
route's authority. The composition of an exact candidate count with the
authoritative dispatch parity remains the next step.
