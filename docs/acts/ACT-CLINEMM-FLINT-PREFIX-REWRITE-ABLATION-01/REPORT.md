**Repository:** `clinemm` (`s1onique/clinemm`), branch `main`
**Source HEAD:** `cefe2b0dc95762d42efd553642b1da989a1ef2fd`
**Production modification:** none
# ACT-CLINEMM-FLINT-PREFIX-REWRITE-ABLATION-01

**Decision:** `ABLATION_CONFOUNDED_BY_COMPACTION`

**Repository:** `clinemm` (`s1onique/clinemm`), branch `main`
**Source HEAD:** `cefe2b0dc95762d42efd553642b1da989a1ef2fd`
**Production modification:** none
**Live qualification:** not run; the offline ablation already changes the compaction decision before the expensive request.

## 0. Terminal result

```text
ACT:
ACT-CLINEMM-FLINT-PREFIX-REWRITE-ABLATION-01

VERDICT:
ABLATION_CONFOUNDED_BY_COMPACTION

REPRODUCED:
YES — the real production MessageBuilder reproduced the historical rewrite at
provider-request iteration 11, including the exact two stale-read markers and
the prior-prefix break.

CAUSAL DISCRIMINATOR:
Raising minOutdatedRewriteBytes from 65,536 to 131,072 preserves 21 of 22
provider-bound messages as the prior prefix at iteration 11, but raises the
request estimate from 61,384 to 93,658 tokens. Under the effective 96,000-token
operating ceiling, the ablation crosses the 86,400-token compaction trigger
(93,658 >= 86,400), while the control does not (61,384 < 86,400).

Therefore the cache-preserving arm and the compacting arm are different request
paths. A latency/cache effect cannot be attributed to prefix reuse alone.
```

## 1. Identity and method

### 1.1 Inputs

| Evidence | Identity |
|---|---|
| Repository HEAD | `cefe2b0dc95762d42efd553642b1da989a1ef2fd` |
| Transcript | `~/Downloads/1794609208867_ks9o6.messages.json`, 371,215 bytes, SHA-256 `02ba96fd27b7c6317d3444ca7c07e237860c99dd3b34eb9dc10ed273c0ab9e6d` |
| Compaction artifact | `~/Downloads/1794609208867_ks9o6.compaction.json`, 76,498 bytes, SHA-256 `0945cdee353e3dccd57761e3342f1c3397d782773b74ca5c724f6fe186663803` |
| Provider captures | `/tmp/flint-96k-capture.uM3DSA`, including iterations 10–12 |
| Live profile | `~/.vscodium-roz/cline-data/globalState.json`: `userContextCeiling=96000`; `~/.vscodium-roz/cline-data/settings/providers.json`: OpenAI-compatible base URL `http://127.0.0.1:8000/v1`, model `flint:16gb` |

The replay imports the real production class directly:

```ts
import { MessageBuilder } from
  "sdk/packages/core/src/session/services/message-builder.ts";
```

Both arms use the same chronological transcript and the same tool-result cap:

```ts
new MessageBuilder({
  maxToolResultChars: 48_000,
  minOutdatedRewriteBytes: 65_536, // control
  // or 131_072                 // ablation
});
```

No other builder option changes. The request estimate uses the production
`estimateRequestInputTokens` estimator. The compaction trigger uses the
production policy: effective ceiling 96,000, trigger ratio 0.9, and the
production previous-request underestimate correction.

### 1.2 Chronology mapping

The transcript contains 37 canonical messages. Provider-request iteration 10 is
represented by canonical messages 0–28 (the second `.gitlab-ci.yml` read is
message 27 and the model request is message 28). Iteration 11 is represented by
messages 0–30, after the third `.gitlab-ci.yml` read at message 29. Iteration
12 is represented by messages 0–33.

The real provider captures independently show the same seam:

| Iteration | Captured estimate | Prefix break | Stale markers |
|---|---:|---|---|
| 10 | 83,485 | none relative to 9 | 0 |
| 11 | 67,555 | first changed provider message = 5 | 2 (provider messages 5 and 19) |
| 12 | 80,293 | none relative to 11 | 2 |

The historical capture is therefore reproduced, not inferred.


## 2. Phase 1 — deterministic replay

### 2.1 Exact message-level change at iteration 11

At canonical end 30, control and ablation differ in exactly two messages:

| Provider-bound message | Tool result | Control | Ablation |
|---|---|---|---|
| 5 | `call_9yjhf9dD5bMlM8OZA4YfKuXH` / `.gitlab-ci.yml` | `[outdated - see the latest file content]` | original 47,253-character file result |
| 19 | `call_uwW1Y3r7ngJDGfz6Qwr9zcsc` / `.gitlab-ci.yml` | `[outdated - see the latest file content]` | original 47,253-character file result |

No other message changes. The two changed messages are 3,230 and 282 bytes in
control, versus 52,166 and 49,218 bytes in ablation.

### 2.2 Prior-prefix preservation

| Arm | Iteration 11 messages | Exact prior-prefix messages | First changed index |
|---|---:|---:|---:|
| Control (65,536) | 22 | 5 | 5 |
| Ablation (131,072) | 22 | 21 | 21 |

The control matches the captured provider boundary exactly: only the first five
provider messages remain byte-identical before the stale-read rewrite. The
ablation keeps the entire previous provider-visible prefix through provider
message 20; only the newly appended final read is new.

### 2.3 Output sizes and full-result availability

| Arm | Prepared message JSON bytes | Production request estimate | Outdated markers |
|---|---:|---:|---:|
| Control | 185,215 | 61,384 | 2 |
| Ablation | 283,087 | 93,658 | 0 |

At the 48,000-character cap, both complete read results remain below the cap.
The control replaces both full results with stale markers. The ablation keeps
both full results, including the byte-identical `.gitlab-ci.yml` content. The
latest read remains present in both arms.

### 2.4 Control reproducibility

The control replay reproduces the historical rewrite at exactly the observed
boundary. It does not reproduce the captured request's absolute token estimate
(the replay uses the canonical transcript and production estimator; the capture
includes AI-SDK formatting/tool-schema overhead), but the causal seam and
message-level rewrite are exact. This is sufficient to proceed and is not
`HALT_RED_NOT_REPRODUCED`.

## 3. Phase 2 — causal discriminator

### 3.1 Answers to the five requested questions

1. **Does preventing the rewrite preserve the previous provider-visible prefix?**
   **Yes.** The ablation preserves 21 of 22 prior messages exactly; control
   preserves only 5.

2. **Does it increase the request beyond the effective 96K operating budget?**
   **No at iteration 11 itself:** 93,658 < 96,000. It is, however, above the
   86,400-token compaction trigger.

3. **Does it trigger compaction before the expensive request?**
   **Yes.** Production policy computes `shouldCompact` as
   `requestInputTokens >= requestTriggerTokens`. At iteration 11:
   - control: 61,384 < 86,400 → no compaction;
   - ablation: 93,658 >= 86,400 → compaction before the request.
   The next chronological request also remains over trigger (97,829 estimated).

4. **Does it introduce additional large duplicate content?**
   **Yes.** The ablation retains the earlier 47,253-character `.gitlab-ci.yml`
   read while also adding the third byte-identical 47,253-character read. The
   two-message delta is 97,872 bytes, and total prepared bytes rise by 97,872.

5. **Does it preserve file freshness, ranged reads, and correct tool-result representation?**
   **Yes for the representation and authorization boundary.** The builder still
   records the same read locators and does not alter read authorization or file
   access. The latest read remains the fresh owner; in the ablation the old
   read remains visible as an older duplicate. This is semantically fresh with
   respect to the latest read, but it intentionally retains large superseded
   content rather than replacing it with the stale marker.

### 3.2 Why the result is confounded

The cache-preserving arm changes the request from a non-compacting path to a
compacting path before the expensive provider request. It therefore changes:

- provider-visible prefix eligibility;
- request size;
- compaction invocation and summarizer work;
- post-compaction message projection;
- prefill/decode work.

These effects cannot be separated by merely raising the rewrite threshold. In
particular, increased cache eligibility is not evidence of a latency win.

## 4. Phase 3 — live qualification decision

**Not run.** The offline discriminator already proves that the higher-threshold
arm triggers compaction at the same iteration where the control does not. A
live run would therefore measure a compound cache+compaction treatment, not
prefix-cache reuse alone. It cannot produce the causal attribution requested
by this ACT.

A live probe was attempted in an isolated data directory to verify the local
Flint path, but the CLI entered an unrelated repeated-user-message loop and
was terminated; no valid matched benchmark was obtained. This attempt is not
used as evidence for the verdict.

## 5. Successor boundary

The discriminator supports considering an append-only deduplication repair for
byte-identical read results only after the rewrite/cache tradeoff is isolated.
Such a repair must:

- preserve the already-cached prefix byte-for-byte;
- keep the latest read as the fresh content owner;
- preserve ranged-read locators and tool-result shape;
- preserve existing authorization and content-freshness invariants;
- avoid triggering compaction earlier merely to preserve cache eligibility.

No production change is made by this ACT.

## 6. Evidence

- `evidence/replay-full.out` — every chronological prefix, message hash, byte
  count, estimate, stale-marker count, and prior-prefix count for both arms.
- `evidence/replay-iterations.out` — chronological request estimate, byte count,
  and stale-marker count for both arms.
- Focused production test gate: `bun x vitest run
  src/session/services/message-builder.test.ts --config vitest.config.ts` →
  **53/53 PASS**.
