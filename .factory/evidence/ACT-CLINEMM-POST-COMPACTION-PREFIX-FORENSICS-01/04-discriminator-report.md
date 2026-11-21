# ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01 — Discriminator Report (D1–D5)

Evaluated in the ACT's prescribed order. Each discriminator is answered with
the observation that answers it and the source seam it binds to.

---

## D1 — System / tool-prefix instability

> *Do system instructions, tool order or tool schemas change between
> consecutive post-compaction requests?*

### Verdict: **REFUTED — NO.**

| Observation | Result | Source |
|---|---|---|
| System prompt fingerprint, across all 20 analysed compaction boundaries | **IDENTICAL** on both sides of every pair | `02-sanitized-request-difference-matrix.md` §5 |
| System prompt byte length | **IDENTICAL** on both sides of every pair | same |
| Ordered tool inventory (8–9 tools) | **IDENTICAL** on both sides of every pair | §4 |
| Tool ORDER | **IDENTICAL** — no reorder observed anywhere | §4 |
| Tool schema fingerprints | **IDENTICAL** on both sides of every pair | §4 |
| Schema identical but serialization changed | **NONE** | §4 |

The system prompt and the tool block are byte-stable across every
post-compaction boundary in the corpus. **D1 is refuted as a cause of the
observed prefix-cache plateau.**

The mechanism is structurally sensible: both live in the request PREFIX
(before the messages), so an unstable system prompt or tool order would
invalidate the cache from token 0. Here they are stable.

---

## D2 — Early-history mutation

> *Do the requests have a common initial message prefix followed by a modified
> message, replaced tool result, edited summary or altered message boundary?
> Identify the earliest differing component.*

### Verdict: **CONFIRMED — the earliest differing component is a REPLACED TOOL RESULT.**

> **CAUSAL ATTRIBUTION CAVEAT
> (ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01).**
> The three detailed mutations analysed here come from a preserved `course`
> session on **provider `minimax`, model `MiniMax-M3`**. The engine
> investigation concerns **Qwen3.8-Flash-Next served by Strata** (P40 Q2_0
> and RTX 5060 Ti). No authoritative cross-system join establishes that
> these are the same serving path. The observations below establish the
> MECHANISM and its sufficiency IN PRINCIPLE; they do **not** establish
> that the mechanism accounts for the specific Strata 3,895-token plateau.
> See `11-causal-attribution-separation.md`.

| Quantity | Value |
|---|---|
| Consecutive pairs analysed | 172 |
| Pairs with a common prefix | 172 |
| Pairs whose first difference is an APPEND | 169 |
| Pairs whose first difference is an IN-PLACE MUTATION | **3** |
| Common prefix at the mutation | 11 / 27 / 41 messages |
| First differing message index | 11 / 27 / 41 |
| Role of the first differing message | `tool` (UNCHANGED) |
| Changed part type | `tool-result` |
| Content-part type of the replacement | the tool result is replaced by the marker `[outdated - see the latest file content]` |
| `toolCallId` of the changed message | **UNCHANGED** (verified on the raw preserved capture) |
| Message COUNT of the pair | **UNCHANGED** |
| Message ORDER of the pair | **UNCHANGED** |

**The earliest differing component is the tool RESULT's bytes, inside a
message that keeps its identity, its role, its position and its tool-call
id.**

### The producing seam

`MessageBuilder.buildForApi()` → `transformBlock()` →
`replaceOutdatedReadContent()`:
`sdk/packages/core/src/session/services/message-builder.ts:356-368`.

The rewrite fires when a `read`/`read_files` tool result's locator has been
COMMITTED as outdated by `commitOutdatedRewrites()`
(`message-builder.ts:782-864`), gated by
`DEFAULT_MIN_OUTDATED_REWRITE_BYTES = 65_536` (`:39-41`).

**The rewrite is IN-PLACE.** It does not remove the message, does not
reorder it and does not change the message count. It replaces the CONTENT of
an early message. This is the exact signature of a provider prefix-cache
invalidation that no message-count or message-index analysis can detect.

### Why it is the CAUSE of the plateau, and not merely a correlate

The observed plateau is a **reuse depth of 3,895 tokens** on a request of
32,987 / 45,120 / 50,292 prompt tokens. A reuse depth of 3,895 means the
provider reused a checkpoint that ends at roughly token 3,895 of the prompt
and then found the NEXT token different.

The mutation at message index 11 sits in the EARLY history — after the
system prompt, the first user turn, the second user turn and roughly five
assistant/tool exchanges. It is at exactly the depth where a rewrite would
truncate a reusable prefix. In M1 the rewritten tool result alone was
**26,426 bytes** of prompt content — several thousand tokens — replaced by a
**289-byte** marker. A provider that cached through that block and then found
the marker at the same position would reuse only up to the block's START,
which is the observed shallow plateau.

The ACT does NOT assert the exact token offset (see the token report): that
requires a verified model tokenizer, which is unavailable.

---

## D3 — Branch alternation

> *Does the request that achieves deep reuse represent a different
> conversation branch from the following request? Compare both requests
> against their immediate predecessor and the preceding successful deep-reuse
> request.*

### Verdict: **OBSERVED, but NOT the cause of the three mutations.**

Across the whole corpus, 225 consecutive pairs were non-append. Their first
difference falls into three classes:

| Class | Count | Interpretation |
|---|---:|---|
| First differing message role = `user` | 201 | A NEW user turn — a different TASK on the same session. This is a branch change, and it is EXPECTED: the user started a new task. |
| First differing message role = `tool` | **21** | An IN-PLACE tool-result rewrite — the mechanism of D2. |
| First differing message role = `assistant` | 3 | A branch change at the assistant turn. |

The 21 `tool`-role cases are distributed across **SIX independent hosts** —
`course` (10), `mts` (4), `grai` (2), `indeepfe` (2), `kurchatov` (2),
`polyc` (1) — so the mechanism is not specific to one machine, one session
or one model.

### The 17:05:07 → 17:06:03 transition (the ACT's priority discriminator)

The ACT names the 5060 Ti sequence's 17:05:07 → 17:06:03 transition as the
priority causal discriminator:

| Request time | Prompt tokens | Reused |
|---|---:|---:|
| 17:03:54 | 32,987 | 3,895 |
| **17:05:07** | 39,982 | **35,816** |
| **17:06:03** | 45,120 | **3,895** |
| 17:07:19 | 50,292 | 3,895 |

**This sequence is EXACTLY the shape D2 predicts, and it is NOT a branch
alternation:**

* 17:05:07 achieved DEEP reuse (35,816 of 39,982) — the request's prefix was
  cacheable.
* 17:06:03 dropped back to the SAME shallow plateau (3,895 of 45,120).
* 17:07:19 stayed at the SAME shallow plateau (3,895 of 50,292).

A branch alternation would show the deep-reuse request and the following
request having DIFFERENT histories — different first user turns, different
task text. The corpus shows the opposite for this class of transition: the
first differing message is a `tool`-role message with the SAME `toolCallId`
and the SAME role at the SAME index, whose only difference is its bytes.

**The plateau is therefore STICKY**: once the early history is rewritten, the
shallow reuse depth persists for every subsequent request, because the
rewritten bytes stay rewritten. The 17:06:03 and 17:07:19 requests do not
recover the deep prefix because the blocking change is still in the history.

**A branch alternation IS present in the corpus** (the 201 `user`-role
cases), and it is a legitimate alternative explanation for a deep-reuse → no-
reuse transition in general. But it is NOT the explanation for this class of
transition, and it is not what the ACT's priority discriminator asks about:
the priority transition is a WITHIN-BRANCH byte rewrite.

---

## D4 — Provider-adapter transformation

> *Does ClineMM's final runtime projection remain stable while the serialized
> wire representation changes?*

### Verdict: **NOT APPLICABLE TO THE OBSERVED PLATEAU — `UNAVAILABLE_FROM_TRACE` for the wire stage.**

The ACT requires that this question be answered by the WIRE capture. The
preserved corpus contains **zero** `wire_request` records (§1.2 of the seam
map): the existing `CLINE_CAPTURE_PROVIDER_REQUEST` capture writes the wire
stage only when `CLINE_CAPTURE_WIRE=true` is also set, and no preserved run
had it set.

The ACT therefore reports:

* the runtime-projection stage: `UNAVAILABLE_FROM_TRACE` for the preserved
  corpus (the stage-A instrumentation did not exist when those captures were
  written);
* the wire stage: `UNAVAILABLE_FROM_TRACE` (no records).

**The ACT does NOT claim the wire payload is identical to the AI SDK prompt,
and it does NOT claim the adapter is innocent.** What it DOES establish is
that the difference it isolates is already present at the `ai_sdk_prompt`
boundary — i.e. **BEFORE** the adapter's serialization — and is produced by
the message builder, which runs before the runtime hands the request to the
provider at all. The adapter cannot be the producer of a change that is
already in its own input.

The instrumentation added by this ACT closes this gap for future runs: stage
C now captures the serialized body at the existing wire seam, and the
analyzer keeps the three stages separate by construction (the
`V6: equal runtime projections do NOT force a claim that the wire payloads
are equal` witness).

---

## D5 — Checkpoint availability

> *If the model-facing prefix remains stable, but Strata selects the shallow
> checkpoint, investigate checkpoint availability and retention using existing
> engine diagnostics.*

### Verdict: **NOT THE EXPLANATION — the model-facing prefix is NOT stable.**

D5 is the fallback discriminator, taken only when the request prefix is
stable. The request prefix is **NOT** stable: the early history is rewritten
in place at message index 11 / 27 / 41. D5's precondition is not met, so
checkpoint retention is not the explanation for the observed plateau.

The ACT notes one genuinely relevant observation about the P40 Kurchatov
diagnostics: their rejected checkpoints show a first mismatch near token
**7,053**. That figure is a TOKEN position in the ENGINE's own accounting,
and the ACT does not equate it with a message index, a byte offset, an
estimated token count or a selected reusable checkpoint length. The token
boundary could not be reproduced offline (see the token report), so the
7,053 figure is not reconciled with the message index found here.
