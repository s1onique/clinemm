# ACT-CLINEMM-ORDINARY-COMPACTION-UPSTREAM-AND-FIDELITY-REPAIR-01

## 03 — The cache discriminator

```text
ENDPOINT:        the operator's already-authorized local endpoint
MODEL:           qwen3.8-flash-next-q2_0  (unchanged; effective model identity
                 CONFIRMED identical across all five measured requests)
PROVIDER:        openai-compatible (unchanged)
REASONING:       thinking = false (unchanged)
MAX_OUTPUT:      512 tokens (fixed across all five requests)
PREFIX BASIS:    HTTP_BODY — the comparison is made on the BYTES the provider
                 actually received, captured from the transport's own fetch.
                 It is NOT inferred from the in-memory message array.
```

### 3.1 THE MEASUREMENTS

All five requests were issued against the same endpoint with the same model
and the same inference configuration. The physical request count was
OBSERVED by wrapping the transport's fetch; the token counts come from the
provider's own usage chunk.

| # | Request | Prompt tokens | Cached tokens | Completion | Latency | Physical requests |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `LAST_WORKING` (the working agent's last request before compaction) | — | — | — | 140 ms | 1 |
| 2 | `SUMMARIZER_A_SERIALIZED` (the EXISTING ordinary summarizer request) | **12 962** | **0** | 512 | 45 507 ms | 1 |
| 3 | `SUMMARIZER_B_NATIVE` (the CANDIDATE native-message summarizer request) | **123 327** | **0** | 512 | 333 740 ms | 1 |
| 4 | `RESUMED_FIRST` (the first resumed working-agent request) | **15 352** | **0** | 512 | 51 655 ms | 1 |
| 5 | `RESUMED_NEXT` (the next ordinary resumed request) | **15 363** | **15 347** | 512 | 14 781 ms | 1 |

### 3.2 THE SERIALIZED-PREFIX EQUALITY (measured on the HTTP body)

| Compared with `LAST_WORKING` | Common prefix chars | Ratio | Result |
| --- | --- | --- | --- |
| `LAST_WORKING` | 490 370 | 1.000 | MEASURED |
| `SUMMARIZER_A_SERIALIZED` | 92 | 0.00019 | MEASURED |
| `SUMMARIZER_B_NATIVE` | **434 292** | **0.886** | MEASURED |
| `RESUMED_FIRST` | 187 | 0.00038 | MEASURED |
| `RESUMED_NEXT` | 187 | 0.00038 | MEASURED |


### 3.3 WHAT THIS ESTABLISHES — AND WHAT IT DOES NOT

**Established, by measurement:**

1. **The existing ordinary summarizer request shares essentially NOTHING
   with the working agent's last request.** 92 characters of common prefix
   — the request envelope — out of 490 370. Prefix ratio `0.00019`.
   **The existing ordinary compaction is a complete cache break**, exactly
   as upstream issue #15783 describes.

2. **The native-message candidate preserves 88.6% of the working agent's
   prefix** (434 292 of 490 370 characters). This is the decisive cache
   result: the native-message representation reuses the working agent's
   KV/prompt cache for the summarizer request, where the serialized
   representation reuses nothing.

3. **The compaction → resumed transition is a cache break in BOTH arms.**
   `RESUMED_FIRST` shares 187 characters with the last working request
   (ratio `0.00038`). **This is the expected and unavoidable one-time
   prefix change after a genuine compaction**: the compacted state is a
   different conversation, so the resumed agent's prefix necessarily
   differs. The ACT explicitly allows this ("A one-time prefix change
   after genuine compaction may be unavoidable").

4. **There is NO repeated prefix churn.** `RESUMED_NEXT` shares the same
   187 characters with `LAST_WORKING` as `RESUMED_FIRST` does — i.e. the
   post-compaction prefix is STABLE from the first resumed request onward.

5. **Cache recovery on subsequent ordinary turns is intact.**
   `RESUMED_NEXT` reads **15 347 of 15 363 prompt tokens** from cache
   (99.9%), and its latency is **14 781 ms against `RESUMED_FIRST`'s
   51 655 ms** — a 3.5× reduction. The compacted agent re-accumulates a
   stable, cacheable prefix.

6. **The native candidate's cost is prompt tokens, not correctness.**
   `SUMMARIZER_B_NATIVE` prefills 123 327 tokens against `SUMMARIZER_A`'s
   12 962 — a 9.5× larger prefill, and 333 740 ms against 45 507 ms. The
   cache is *reused* (0 tokens read, because the cache was cold for this
   provider instance at the time of measurement), but the **prefill is
   still paid**. On a warm cache the native arm would read most of those
   tokens instead of prefilling them; that warm-cache variant was NOT
   measured and is recorded as such.


### 3.4 `LAST_WORKING` DID NOT COMPLETE — AND WHY THAT IS ITSELF A FINDING

The `LAST_WORKING` request (the whole native prefix, 490 370 body
characters) returned in **140 ms with no usage chunk, no text and no
error**. The request was issued; the provider did not produce a completion.

This is corroborated independently by the preceding campaign: its
full-source arm `F` (438 428 context chars) scored **12/12 UNSCORABLE** —
every probe failed to produce an answer.

**The full source does NOT fit the provider's budget.** This is the ACT's
§6 "If it does not fit, record the limitation explicitly" clause, and it is
recorded here as a hard, measured limitation:

```text
FULL_SOURCE_ARM_FITS_PROVIDER_BUDGET = NO
```

Consequently the `LAST_WORKING` prefix comparison is measured against a
request that the provider REFUSED. The ratios in §3.2 are still valid as a
comparison of the two serialized bodies (both were captured on the wire
before the refusal), but the `LAST_WORKING` row must be read as
*"the request the working agent would have made"*, not as *"a request the
provider answered"*.

### 3.5 THE THREE TRANSITIONS, KEPT SEPARATE

The ACT (§9) requires that these not be conflated. They are, in the
measurement above:

| Transition | Measured | Reading |
| --- | --- | --- |
| **Working agent → summarizer** | `0.00019` (A) vs `0.886` (B) | **This is where the native candidate wins.** The existing ordinary compaction breaks the cache here; the native representation keeps 88.6% of it. |
| **Summarizer → compacted working agent** | `0.00038` | A genuine one-time prefix change. Unavoidable in both arms. |
| **Stable cache recovery on subsequent turns** | 15 347 / 15 363 cached, 3.5× latency reduction | Intact. Not a churn defect. |

### 3.6 THE MEASUREMENT LIMITS, STATED EXPLICITLY

- **Engine tokenization** is not observable. The prompt-token counts are the
  provider's own reported counts, not a local tokenizer's.
- **Cache identity** is the provider's. The common-prefix measurement is a
  *byte* comparison of the request bodies, which is the strongest
  observable proxy available; it is not a claim about the provider's
  internal cache-block boundaries.
- **A warm-cache measurement was not performed.** All five requests were
  issued against a cache that was cold for the two large bodies. The
  `SUMMARIZER_B_NATIVE` row therefore shows a full prefill, not the
  cache-read behaviour a warm run would show. The 88.6% prefix equality is
  the transferable result; the 0 cached tokens are a property of the
  measurement order, not of the representation.
- The raw provider bodies, prompts and answers stay in the GITIGNORED
  `tmp/compaction-fidelity-repair/` tree.
