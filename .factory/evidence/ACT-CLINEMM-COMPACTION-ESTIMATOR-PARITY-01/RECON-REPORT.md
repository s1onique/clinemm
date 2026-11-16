# ACT-CLINEMM-COMPACTION-ESTIMATOR-PARITY-01 — Recon Report

**Primary verdict: `REPRODUCED_ESTIMATOR_DEFECT`**

*The defect also changes automatic-compaction eligibility: all six Round C
compactions were premature under the session's own calibration.*

**Session:** `1794860704742_kxlwr` · **Source HEAD:** `c1aff630fdf6669b9b1e63ec927796e6f5423f07` ·
**Branch:** `main` · **Repository:** `s1onique/clinemm` ·
**Trace SHA-256:** `631a506d0719314373bab801dfc70f646cca508318f87c59cdc5e3e2a1e517df` (verified) ·
**Implementation authorization:** DIAGNOSTIC/TEST ONLY — no estimator repair was made.

---

## 1. The three questions, answered independently

### Q1 — Does ClineMM systematically overestimate the input tokens of the *same actual provider request*, and by how much?

**Yes — by ~1.49× on the median, and the overcount is a property of the ESTIMATOR, not of the comparison.**

| Quantity | Median |
|---|---:|
| Estimated (decision candidate) / provider-reported `inputTokens` | **1.497827** |
| p10 / p90 | 1.177215 / 1.664711 |
| min / max | 1.150903 / 1.730474 |
| Mean estimated excess | **21,009.2 tokens** |
| Population | 107 non-compacting pairs |

The comparison is genuinely **same-request**. The production-seam suite proves
that the decision candidate and the dispatched provider projection carry the
**same** estimate (the resolver's published `apiMessageTokens +
requestOverheadTokens` equals `estimateRequestInputTokens` over the same
provider-visible input, exactly), and the trace confirms it empirically:
`providerReady.providerRequestBytes` tracks
`compaction_decision.apiMessagesJsonChars` within ~1,000–4,000 bytes on every
non-compacting request.

### Q2 — Which specific accounting component causes the difference?

**`CHARS_PER_TOKEN = 3`.** The estimator bills 3 characters per token; the
provider's actual tokenizer for this session's content bills **4.129**
characters per token on the message payload (**3.473** on the full wire bytes,
coefficient of variation **0.0732** — a very tight fit).

| Component | Verdict |
|---|---|
| **H1 — fixed 3-char divisor** | **SUPPORTED — dominant, decision-changing** |
| H2 — JSON/wire framing | Contributes ~5,692 constant tokens (system prompt + tool schemas, 5.8% of a typical candidate). Real and correctly attributed; **must not** be removed. **Not decisive** on its own. |
| H3 — structured result accounting | **NOT SUPPORTED** — `toolResultShortenedCount = 0` and `toolResultOmittedCount = 0` on every request; the API-safe projection is not smaller than what the decision measured. |
| H4 — provider usage normalization | **REFUTED** — see below. |
| H5 — request-correlation error | **REFUTED as the primary cause** — see below. |
| H6 — intentional safety margin | **REFUTED for this run** — the margin is real by design but exceeded the decision margin. |

#### H4 is refuted: `inputTokens` is the COMPLETE prompt; `cacheReadTokens` is a SUBSET

This is the single most important accounting fact in this ACT, and it is the
opposite of the naive reading.

The installed `@ai-sdk/openai-compatible` 3.0.82 maps:

```js
inputTokens: {
    total: promptTokens,                    // COMPLETE prompt
    noCache: promptTokens - cacheReadTokens,
    cacheRead: cacheReadTokens,             // SUBSET of total
}
```

and ClineMM reads `usage.inputTokens.total` (`ai-sdk.ts:1270-1271`). The
session's own internal consistency confirms it:

| Reading | Implied chars/token | Coefficient of variation |
|---|---:|---:|
| `providerRequestBytes / inputTokens` | **3.473** | **0.0732** (tight) |
| `providerRequestBytes / (inputTokens + cacheReadTokens)` | 3.127 | 0.2214 (loose) |

`inputTokens` is the quantity proportional to the wire payload. Adding
`cacheReadTokens` **breaks** that proportionality and double-counts the cached
portion. ClineMM's own cost formula corroborates the contract: it subtracts
`cacheReadTokens + cacheWriteTokens` from `inputTokens` before applying the
input price (`ai-sdk.ts:1180-1183`) — which is only correct if cached tokens
are a subset of `inputTokens`.

**This ACT did not add `cacheReadTokens` to `inputTokens`.**

> **Note for the reader of the original baseline.** The ~1.498× figure was
> computed as `estimate / inputTokens`. Because `inputTokens` is already the
> complete prompt, that figure is the honest same-request ratio — but it must
> not be decomposed as if `cacheReadTokens` were an extra quantity to add.
> The decomposition in `historical-parity.json` keeps both readings visible so
> the confusion cannot recur.


#### H5 is refuted as the primary cause — but the pairing METHOD did need fixing

The trace exports **no authoritative request identity** spanning decision,
dispatch and completion. `decisionId` is minted on the decision seam only;
`modelRequestId` is minted *after* that seam (`agent-runtime.ts:2915`) and is
not in `LATENCY_METADATA_ALLOWLIST`. The pairing is therefore
**`INFERRED_CHRONOLOGICAL_PAIRING`**, and this ACT retains that label.

The pairing **method** was corrected during this ACT: a positional
`zip(decisions, completions)` is wrong because there are 114 decisions and 113
completions, and a compaction decision is followed by a compaction *execution*
rather than by the provider request it pre-empted. The corrected
**order-preserving** pairing (each decision pairs with the first completion
starting strictly after it) moved the median from 1.50415 to **1.497827**.

**The correction matters and was necessary — but it does not explain the
discrepancy.** The ratio is ~1.50 either way.

### Q3 — Is that difference sufficient to cause automatic compaction that would otherwise be unnecessary?

**Yes. Proven, not extrapolated.**

The six compaction candidates were never submitted, so no provider ever
reported their usage — their true count is `LIVE_UNOBSERVABLE` as a
*measurement*. But the session provides a **bound** from its own 107 measured
pairs: applying the session's own observed 4.129 chars/token to each
candidate's measured `apiMessagesJsonChars`, plus its measured constant
overhead:

| decisionId | estimated | trigger | empirical true-token bound | would have compacted? |
|---|---:|---:|---:|---|
| `…#17#16` | 110,953 | 103,680 | 76,488 | **no** |
| `…#33#32` | 105,733 | 103,680 | 72,695 | **no** |
| `…#54#53` | 105,484 | 103,680 | 72,514 | **no** |
| `…#71#70` | 105,739 | 103,680 | 72,699 | **no** |
| `…#91#90` | 104,542 | 103,680 | 71,830 | **no** |
| `…#113#112` | 109,876 | 103,680 | 75,706 | **no** |

**Sensitivity.** Each candidate needed only a chars/token ratio of
**3.026–3.223** to have stayed below the trigger; the session's observed
ratio is **4.129**. Even at the most pessimistic candidate the estimate still
crosses. The conclusion is not knife-edge.

**Control.** Applying the same true-count rule to the 107 non-compacting rows
yields **0** that would have compacted. The estimator's overcount only ever
mattered at the trigger boundary — exactly where it should matter and nowhere
else. That is the signature of a decision-changing defect, not a uniform
harmless bias.

**Conservation (all asserted GREEN in the production-seam suite):** a
genuinely oversized request still compacts; the underestimate factor still
engages and scales the budget down; the unknown-model-limit path still fails
closed with no decision published; the final dispatch budget guard still
rejects an over-ceiling request **before** dispatch.

---

## 2. The trigger arithmetic reconciles exactly

For **all 114** decisions:


---

## 3. What was NOT done, and what remains unproven

- **No estimator repair.** `CHARS_PER_TOKEN`, `COMPACTION_TRIGGER_RATIO`, the
  context window, the estimator, the compaction algorithm and the provider
  request contents are all untouched. This ACT produced a diagnosis.
- **No live Strata probe.** The provider-side usage semantics for this
  historical run are established from the installed AI SDK contract plus the
  session's internal consistency — they are **not** from a captured raw
  provider response, and Strata server-side receipts were not retained.
- **No authoritative request identity.** The historical pairing remains
  `INFERRED_CHRONOLOGICAL_PAIRING`.
- **The candidates' true token counts are a bound, not a measurement.** An
  authoritative tokenizer count for the exact pre-compaction candidate would
  strengthen Q3 from *bound* to *measurement*. The bound is already decisive
  (3.026–3.223 vs an observed 4.129), so this is a strengthening, not a gap.
- **No claim about live Strata accuracy.** The synthetic fake provider in the
  suite establishes the accounting contract and the production seam's
  behaviour; it does not claim to reproduce a live deployment.

---

## 4. Recommended successor — one bounded repair ACT

**`ACT-CLINEMM-COMPACTION-ESTIMATOR-CALIBRATION01`**

Replace the fixed 3-chars-per-token divisor with a **calibrated, still
conservative** estimator, and prove it against the same six candidates.

Constraints the successor MUST satisfy:

1. **Do not simply raise the divisor to 4.** The estimator must remain
   conservative on **dense** content (minified sources, binary dumps,
   disassembly) — that is precisely what the underestimate factor exists for,
   and the trace shows it never engaged because the estimator never
   *under*-counted in this session. A successor that only relaxes the margin
   trades premature compaction for provider-overflow failures.
2. **Keep the underestimate factor as the dense-content safety net**, and
   consider *widening* its evidence window (it currently compares against the
   immediately previous request only).
3. **Retain the system prompt, tool schemas, JSON framing and image
   accounting.** They are real payload — the production-seam suite asserts
   each one contributes.
4. **Preserve the provider-usage contract**: `inputTokens` is the complete
   prompt; `cacheReadTokens` is a subset; never add them together.
5. **Preserve fail-closed behaviour** on an unknown context limit, the
   user-configured ceiling, overflow recovery, the final dispatch budget
   guard, the existing compaction strategies, and the provider request
   contents.
6. **Re-derive the calibration from measurement, not from this ACT's number.**
   The 4.129 figure is *this session's* rate for *this content*. A successor
   should calibrate across several sessions and content shapes, and should
   keep the estimator conservative relative to the observed distribution.

The successor's acceptance test is precise and already half-built: for the
same six candidates, a trusted count must fall below 103,680 **and** a
genuinely oversized request must still compact — the same shape of test the
current suite already runs.

---

## 5. Evidence index

| File | Content |
|---|---|
| `identity.json` | Repository identity, trace SHA-256, conservation receipt, every gate's command and result |
| `request-accounting-map.md` | The D/P/W/U boundary map, estimator boundaries, usage normalization, cache interpretation, source locations |
| `historical-parity.json` | Baseline statistics, ratio distribution, compaction-epoch breakdown, the six decisions, pairing authority, limitations |
| `production-seam-discriminator.json` | RED evidence, the exact seam exercised, synthetic-vs-real classification, correlation controls |
| `necessity-ablation.json` | Per-hypothesis verdicts, the three ablations, the necessity proof, the conservation checklist |
| `historical-parity-analysis.ts` | The deterministic offline analysis (re-runnable against any trace path) |
| `sdk/packages/core/src/extensions/context/compaction.estimator-parity01.test.ts` | The 19-test production-seam suite |

All committed artifacts are **metadata-only**. No raw prompt, message body,
command output, URL, credential or full request body is present. The uploaded
trace and the session files stay outside Git.

- `rawMaxInputTokens / underestimateFactor × COMPACTION_TRIGGER_RATIO`
  reproduces the reported `requestTriggerTokens` (103,680) — exact.
- `requestInputTokens >= requestTriggerTokens` reproduces the reported
  `shouldCompact` — **0 mismatches**.
- `compactionInitiated == shouldCompact` — **114/114**.
- `underestimateFactor == 1` for every decision: the provider never reported
  more than the estimate, so the under-count protection never engaged.

The trigger **comparison** is sound. The defect is in the **estimate**.
